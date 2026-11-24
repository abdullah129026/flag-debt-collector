-- Scan artifacts bucket. The tick stores the repo tarball and the
-- parse/age/provider state JSON here; the purge route deletes them.
-- Private: only the service_role key touches it (the app never serves
-- these files, and the tarball holds repo source). The bucket was missing
-- on the first live deploy (no migration created it), so every tick died
-- uploading the tarball and the scan stuck in 'cloning'. Created by
-- migration, not the dashboard, so a fresh deploy gets it.
insert into storage.buckets (id, name, public, file_size_limit)
values ('scan-artifacts', 'scan-artifacts', false, 104857600)
on conflict (id) do nothing;
