-- Flag Debt Collector schema. Run in order; Supabase project first.
-- Rules: explicit minimal grants to service_role on every new table, never
-- GRANT ALL to anon or authenticated. pgcrypto pinned to public (new
-- Supabase projects install extensions into the extensions schema).

create extension if not exists pgcrypto with schema public;

-- Repos. owner_id null means an anonymous (paste-URL) repo.
create table public.repos (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid null,
  host text not null,
  full_name text not null,
  default_branch text,
  access_kind text not null default 'public_url',
  created_at timestamptz not null default now()
);
create unique index repos_owner_unique on public.repos (owner_id, host, full_name) where owner_id is not null;
create unique index repos_anon_unique on public.repos (host, full_name) where owner_id is null;

-- Scans. status is the pipeline step; updated_at is the heartbeat, a tick
-- refreshes it, and a non-terminal scan with a heartbeat older than 10
-- minutes is re-claimable. claim_hash is the SHA-256 of the claim token.
create table public.scans (
  id uuid primary key default gen_random_uuid(),
  repo_id uuid not null references public.repos (id) on delete cascade,
  owner_id uuid null,
  status text not null default 'queued'
    check (status in ('queued', 'cloning', 'parsing', 'age', 'provider', 'done', 'failed')),
  progress jsonb not null default '{}',
  caps jsonb not null default '{"max_mb": 100, "max_files": 10000}',
  error text,
  claim_hash text,
  started_at timestamptz,
  finished_at timestamptz,
  next_scan_at timestamptz,
  visibility text not null default 'public',
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index scans_claim_idx on public.scans (status, updated_at);
create index scans_repo_idx on public.scans (repo_id, created_at desc);

-- Repo-level flag entity. User state (ignored, marked removed, cap override)
-- lives here and survives rescans; per-scan evidence lives in flags.
create table public.repo_flags (
  id uuid primary key default gen_random_uuid(),
  repo_id uuid not null references public.repos (id) on delete cascade,
  key text not null,
  provider text not null,
  user_status text null check (user_status in ('ignored', 'marked_removed')),
  reason text,
  cap_override boolean not null default false,
  updated_at timestamptz not null default now(),
  unique (repo_id, key, provider)
);

-- Per-scan flag evidence. One row per (scan, key, provider).
create table public.flags (
  id uuid primary key default gen_random_uuid(),
  scan_id uuid not null references public.scans (id) on delete cascade,
  repo_id uuid not null references public.repos (id) on delete cascade,
  key text not null,
  provider text not null,
  kind text not null check (kind in ('sdk', 'env', 'config')),
  status text not null check (status in ('active', 'watch', 'stale', 'deletable', 'ignored', 'removed')),
  confidence text not null check (confidence in ('definite', 'likely', 'possible', 'uncertain')),
  signals jsonb not null default '{}',
  created_at_git timestamptz,
  last_changed_at timestamptz,
  age_source text check (age_source in ('git', 'github-api')),
  rollout_pct int check (rollout_pct between 0 and 100),
  rollout_source text,
  rollout_by_env jsonb,
  winning_value boolean,
  references_count int not null default 0,
  deletable_loc int not null default 0,
  loc_up_to boolean not null default false,
  loc_formula text,
  diff text,
  unique (scan_id, key, provider)
);
create index flags_scan_idx on public.flags (scan_id);
create index flags_repo_idx on public.flags (repo_id);

-- Call sites. File path and line only, never source text.
create table public.references (
  id uuid primary key default gen_random_uuid(),
  flag_id uuid not null references public.flags (id) on delete cascade,
  file_path text not null,
  line int not null,
  column int,
  kind text not null check (kind in ('call', 'definition', 'test', 'config'))
);
create index references_flag_idx on public.references (flag_id);

-- References the resolver could not tie to a flag key. Location and
-- reason only, never call-site text.
create table public.unresolved_references (
  id uuid primary key default gen_random_uuid(),
  scan_id uuid not null references public.scans (id) on delete cascade,
  file_path text not null,
  line int not null,
  reason text not null check (reason in ('dynamic_key', 'config_indirection', 'unparseable'))
);
create index unresolved_scan_idx on public.unresolved_references (scan_id);

-- Audit events. The four PLAN actions plus reopened and reappeared
-- (DESIGN-COPY section 8.5) and cap_override.
create table public.flag_events (
  id uuid primary key default gen_random_uuid(),
  repo_flag_id uuid references public.repo_flags (id) on delete cascade,
  flag_id uuid references public.flags (id) on delete cascade,
  actor_id uuid,
  action text not null check (action in ('ignored', 'unignored', 'marked_removed', 'confirmed_removed', 'reopened', 'reappeared', 'cap_override')),
  reason text,
  created_at timestamptz not null default now()
);
create index flag_events_repo_flag_idx on public.flag_events (repo_flag_id, created_at desc);
create index flag_events_flag_idx on public.flag_events (flag_id, created_at desc);

-- Provider tokens, encrypted at rest (see 0002 RPCs). Reads return last4
-- only; the raw token is never returned to the client.
create table public.provider_tokens (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  provider text not null,
  token_enc bytea not null,
  last4 text not null,
  created_at timestamptz not null default now(),
  unique (owner_id, provider)
);

-- Per-account scan settings. One row per owner, created on first save.
create table public.settings (
  owner_id uuid primary key,
  staleness_days int not null default 90 check (staleness_days between 1 and 365),
  include_test_sites boolean not null default true,
  ignore_rules text not null default '',
  updated_at timestamptz not null default now()
);

-- Single heartbeat row, so the monitor can tell a stuck queue from an
-- empty one.
create table public.meta (
  key text primary key,
  value jsonb not null default '{}'
);
insert into public.meta (key, value) values ('heartbeat', '{"last_scan_tick_at": null}');

-- Claim one scan for a tick: queued first, else any non-terminal scan
-- whose heartbeat is older than 10 minutes (stale-claim reaper). SKIP
-- LOCKED keeps two ticks from claiming the same scan.
create or replace function public.claim_scan()
returns table (scan_id uuid, scan_repo_id uuid, scan_owner_id uuid, scan_status text, scan_progress jsonb, scan_caps jsonb)
language plpgsql
security definer
as $$
declare
  picked public.scans%rowtype;
begin
  select s.* into picked
  from public.scans s
  where s.status = 'queued'
     or (s.status in ('cloning', 'parsing', 'age', 'provider')
         and s.updated_at < now() - interval '10 minutes')
  order by s.created_at asc
  limit 1
  for update skip locked;

  if not found then
    return;
  end if;

  update public.scans set updated_at = now() where id = picked.id;
  return query select picked.id, picked.repo_id, picked.owner_id, picked.status, picked.progress, picked.caps;
end;
$$;

-- Row level security, on for every table.
alter table public.repos enable row level security;
alter table public.scans enable row level security;
alter table public.repo_flags enable row level security;
alter table public.flags enable row level security;
alter table public.references enable row level security;
alter table public.unresolved_references enable row level security;
alter table public.flag_events enable row level security;
alter table public.provider_tokens enable row level security;
alter table public.settings enable row level security;
alter table public.meta enable row level security;

-- Public read: a scan and its flags, references, and unresolved list are
-- readable by anyone when the scan is public (the shared report link).
create policy scans_public_read on public.scans
  for select using (visibility = 'public');
create policy scans_owner_all on public.scans
  for all using (owner_id = auth.uid());
create policy flags_public_read on public.flags
  for select using (exists (select 1 from public.scans s where s.id = flags.scan_id and s.visibility = 'public'));
create policy flags_owner_read on public.flags
  for select using (exists (select 1 from public.scans s where s.id = flags.scan_id and s.owner_id = auth.uid()));
create policy references_public_read on public.references
  for select using (exists (select 1 from public.flags f join public.scans s on s.id = f.scan_id where f.id = references.flag_id and s.visibility = 'public'));
create policy references_owner_read on public.references
  for select using (exists (select 1 from public.flags f join public.scans s on s.id = f.scan_id where f.id = references.flag_id and s.owner_id = auth.uid()));
create policy unresolved_public_read on public.unresolved_references
  for select using (exists (select 1 from public.scans s where s.id = unresolved_references.scan_id and s.visibility = 'public'));
create policy unresolved_owner_read on public.unresolved_references
  for select using (exists (select 1 from public.scans s where s.id = unresolved_references.scan_id and s.owner_id = auth.uid()));

-- Owner-scoped rows: repos, repo flags, events, settings.
create policy repos_owner_all on public.repos
  for all using (owner_id = auth.uid());
create policy repo_flags_owner_all on public.repo_flags
  for all using (exists (select 1 from public.repos r where r.id = repo_flags.repo_id and r.owner_id = auth.uid()));
create policy flag_events_owner_read on public.flag_events
  for select using (actor_id = auth.uid());
create policy settings_owner_all on public.settings
  for all using (owner_id = auth.uid());

-- Minimal grants. service_role does the writes; anon reads public scans
-- only; authenticated reads its own rows through the policies above.
grant select, insert, update, delete on public.repos to service_role;
grant select, insert, update, delete on public.scans to service_role;
grant select, insert, update, delete on public.repo_flags to service_role;
grant select, insert, update, delete on public.flags to service_role;
grant select, insert, update, delete on public.references to service_role;
grant select, insert, update, delete on public.unresolved_references to service_role;
grant select, insert, update, delete on public.flag_events to service_role;
grant select, insert, update, delete on public.provider_tokens to service_role;
grant select, insert, update, delete on public.settings to service_role;
grant select, insert, update, delete on public.meta to service_role;

grant select on public.scans to anon, authenticated;
grant select on public.flags to anon, authenticated;
grant select on public.references to anon, authenticated;
grant select on public.unresolved_references to anon, authenticated;
grant select, insert, update, delete on public.repos to authenticated;
grant select, insert, update, delete on public.scans to authenticated;
grant select, insert, update, delete on public.repo_flags to authenticated;
grant select, insert, update, delete on public.flag_events to authenticated;
grant select, insert, update, delete on public.settings to authenticated;

revoke all on function public.claim_scan() from public;
grant execute on function public.claim_scan() to service_role;
