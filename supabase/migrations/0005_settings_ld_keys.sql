-- LaunchDarkly needs a project key and an environment key next to the token
-- (the flag-statuses endpoint takes both as path parameters). Production is
-- the only environment in v1.

alter table public.settings add column if not exists ld_project_key text;
alter table public.settings add column if not exists ld_env_key text not null default 'production';
