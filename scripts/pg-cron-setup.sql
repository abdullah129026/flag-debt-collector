-- pg_cron setup for Flag Debt Collector. Run once, in the Supabase SQL
-- editor, after the phase-6 deploy (the live URL and CRON_SECRET must exist).
-- Replace <APP_URL> with the deployed origin, e.g.
-- https://flag-debt-collector.vercel.app, and create the Vault secret first:
--   select vault.create_secret('<CRON_SECRET value>', 'cron_secret');
-- (The CRON_SECRET value itself lives in the Vercel env vars.)
--
-- Two jobs:
--   scan-tick  every minute: advances one queued (or stale-claimed) scan.
--   purge      daily 04:00 UTC: purges anonymous scans older than 30 days.
--
-- If pg_cron via pg_net does not fire end to end (project 4's pg_cron is
-- still unconfirmed), the fallback is an external free pinger hitting the
-- same two endpoints with the same bearer secret.

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

select cron.schedule(
  'fdc-scan-tick',
  '* * * * *',
  $$
  select net.http_get(
    url := '<APP_URL>/api/cron/scan-tick',
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    )
  );
  $$
);

select cron.schedule(
  'fdc-purge',
  '0 4 * * *',
  $$
  select net.http_get(
    url := '<APP_URL>/api/cron/purge',
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    )
  );
  $$
);
