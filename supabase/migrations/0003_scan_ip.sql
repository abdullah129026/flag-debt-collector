-- Anonymous quota needs the request IP on the scan row. Stored as inet, used
-- only to count today's anonymous scans for that IP. Never returned by the API.
alter table public.scans add column if not exists created_by_ip inet;
create index scans_ip_day_idx on public.scans (created_by_ip, created_at) where owner_id is null;
