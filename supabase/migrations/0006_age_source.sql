-- Widen the age_source check: tarball scans get age from the host API,
-- so GitLab scans record 'gitlab-api', and rows carried forward with no
-- age at all record 'unknown' (a confirmed-removed flag from an earlier
-- scan). Existing rows hold 'git' or 'github-api' and are unaffected.
alter table public.flags drop constraint if exists flags_age_source_check;
alter table public.flags add constraint flags_age_source_check
  check (age_source in ('git', 'github-api', 'gitlab-api', 'unknown'));
