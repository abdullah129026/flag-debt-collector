-- Claim window: 10 minutes -> 1 minute. The PLAN's 10-minute re-claim
-- window makes a multi-tick scan take 10 minutes per tick, which breaks
-- the 5-minute whole-scan budget for repos up to 1,000 files. A live tick
-- refreshes its heartbeat during long steps (clone, parse loop), so 1
-- minute of silence still means the tick is dead, never stolen.

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
         and s.updated_at < now() - interval '1 minute')
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

revoke all on function public.claim_scan() from public;
grant execute on function public.claim_scan() to service_role;
