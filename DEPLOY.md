# Deploy guide

Everything here is a click you do, in order. Nothing in this file needs
code changes. The app is Next.js 16 on Vercel, Postgres + Auth on
Supabase (free tiers). If Vercel gives the project a different domain
than `flag-debt-collector.vercel.app`, use your real domain everywhere
this file says `<APP_URL>`.

## 0. What you need

- A Supabase account (free) and a Vercel account (free).
- The Vercel account must be the real one, `abdullahshaak@gmail.com`,
  team `Shah`. The wrong account (`abshahaab@gmail.com`) cannot join
  team Shah on the free tier, and a project imported there cannot be
  transferred later. Check the account in the top-right corner before
  importing.
- Optional: a Resend account (free, 100 emails/day) for sign-in emails,
  an UptimeRobot account (free) for the uptime monitor, and a PostHog
  account (free tier) for analytics.

## 1. Create the Supabase project

1. Supabase dashboard → New project. Name it `flag-debt-collector`.
   Note the project ref (the subdomain in the URL).
2. SQL Editor → New query. Paste `supabase/migrations/0001_schema.sql`,
   run it. Repeat for `0002_provider_tokens.sql`,
   `0003_scan_ip.sql`, `0004_claim_window.sql`, then
   `0005_settings_ld_keys.sql`, in that order. Each should report
   success.
3. Check Table Editor shows: `repos`, `scans`, `repo_flags`, `flags`,
   `references`, `unresolved_references`, `flag_events`,
   `provider_tokens`, `settings`, `meta`.

## 2. Generate the two secrets

Two values, generated once and reused below. In PowerShell or Git
Bash (openssl is not on your Windows PATH, so use node):

```sh
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Run it twice: once for `CRON_SECRET`, once for
`PROVIDER_TOKEN_ENC_KEY`. Keep both somewhere safe; they are not
stored anywhere else.

- `CRON_SECRET`: the bearer token pg_cron uses to call the scan tick
  and the purge.
- `PROVIDER_TOKEN_ENC_KEY`: the key the provider-token RPCs use to
  encrypt LaunchDarkly tokens at rest.

## 3. Store the two Vault secrets

Supabase dashboard → SQL Editor:

```sql
select vault.create_secret('<CRON_SECRET>', 'cron_secret');
select vault.create_secret('<PROVIDER_TOKEN_ENC_KEY>', 'provider_token_enc_key');
```

The names must match exactly: the pg_cron script reads `cron_secret`,
migration 0002 reads `provider_token_enc_key`.

## 4. Import on Vercel and set env vars

1. Vercel (real account, team `Shah`) → Add New → Project → import
   `abdullah129026/flag-debt-collector`.
2. Environment Variables (Production), five required values:
   - `NEXT_PUBLIC_SUPABASE_URL` = `https://<project-ref>.supabase.co`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` = anon key (Project Settings → API)
   - `SUPABASE_URL` = same URL as above
   - `SUPABASE_SERVICE_ROLE_KEY` = service_role key (Project Settings → API)
   - `CRON_SECRET` = the value from step 2
3. Optional values (set them now if you have them, or later):
   - `GITHUB_TOKEN` = a read-only personal access token. It raises the
     GitHub API limit for the pre-clone size check and the no-git age
     fallback from 60 to 5,000 requests/hour. Without it scans still
     work for small repos.
   - `NEXT_PUBLIC_POSTHOG_KEY` + `NEXT_PUBLIC_POSTHOG_HOST` =
     `https://us.i.posthog.com`, for analytics. Leave unset and the
     site sends no analytics.
   - `SCANNER_AGE_SOURCE` = `git` (default). Only set `github-api` if
     the first live scan proves git is missing from the Vercel runtime
     (see step 10).
4. Deploy. Wait until the deployment carries the Production label.

Two gotchas, both carried from project 4. First, use the legacy
service_role JWT for `SUPABASE_SERVICE_ROLE_KEY`: the new-style secret
key (`sb_secret_...`) from the Supabase dashboard is rejected with 401
by this project's gateway. Second, set every var for Production (and
Preview if you want preview deploys to work); a var set for preview
only does not reach production, and the health check will report
`db: unconfigured`.

## 5. Audit the Supabase site URL before the first sign-in

Authentication → URL Configuration:

- Site URL = `https://<APP_URL>` (the default is localhost; leave it and
  every magic link points at localhost and sign-in fails).
- Redirect URLs: add `https://<APP_URL>/**`.
- Request a fresh magic link after changing this; links sent before
  the fix stay dead.

## 6. Custom SMTP (so anyone can sign in)

The built-in sender only reaches team addresses at 2 emails/hour.
Authentication → Emails → SMTP settings: enable custom SMTP with
Resend (free, 100/day) and your Resend API key. Then set the cap at
Authentication → Rate Limits. Without this step, only Supabase team
members can sign in to the demo.

## 7. Schedule the scan tick and the retention purge

1. Open `scripts/pg-cron-setup.sql`, replace `<APP_URL>` with the live
   domain, and run the whole file once in the SQL Editor.
2. Database → Cron jobs: confirm two jobs exist, `fdc-scan-tick`
   (every minute) and `fdc-purge` (daily 04:00 UTC).
3. If pg_cron via pg_net does not fire end to end (project 4's pg_cron
   is still unconfirmed), the fallback is an external free pinger
   hitting the same two endpoints with the same bearer secret.

## 8. Seed the demo scan

The landing page shows the demo scan's real numbers, so run this once
after the deploy, from the repo root:

```sh
APP_URL=https://<APP_URL> CRON_SECRET=<value from step 2> node scripts/seed-demo.mjs
```

It creates an anonymous scan of `abdullah129026/api-contract-firewall`
(the demo repo picked in phase 3: 10 env flags, highest count under
the caps) and drives the tick until the scan finishes, up to 10
minutes. It prints the scan id when done. Until it runs, the landing
page shows the honest "demo scan has not run yet" placeholder and no
number. Note the honest catch: all 10 demo flags are env flags, so the
headline deletable LOC is 0 until a provider is connected or the
winning-value picker is used. The landing page shows the real numbers
either way.

## 9. Uptime monitor (free tier)

UptimeRobot → Add New Monitor:

- Monitor Type: HTTPS, Friendly Name: `flag-debt-collector health`.
- URL: `https://<APP_URL>/api/health`.
- Monitoring Interval: 5 minutes. Alert contact: your email.

Add a second monitor on `https://<APP_URL>/` if you want the landing
page covered too. The regular hits also keep the Supabase project
awake, which matters because free projects pause after a week of
inactivity.

## 10. Backups (free-tier reality)

Supabase Free has no automatic backups: daily backups kept 7 days are
a Pro feature. Until the service moves to Pro, back up by hand:

```sh
supabase link --project-ref <project-ref>
supabase db dump -f flag-debt-collector-$(date +%F).sql
```

Store the dump off-site (not in this repo). The CSV export in the
product is a second copy of your own flag data, not a database backup.
Upgrade to Pro the moment other people depend on the service: that is
when daily backups and no pausing start mattering.

## 11. Verification sweep

Do this after the deploy lands, against the production domain, and
record the result. A green build proves nothing; this sweep does.

| Route | Expect |
|---|---|
| `/`, `/docs`, `/login`, `/terms`, `/privacy`, `/og.png` | 200 |
| `/dashboard`, `/repos`, `/settings`, `/dashboard/flags/[id]` signed out | 307 to `/login?next=...` |
| `/api/health` | 200 with `db: connected` |
| `/api/cron/scan-tick` without a bearer token | 401 |
| `/api/cron/purge` without a bearer token | 401 |
| `/api/scans/[id]/csv` for a scan you do not own | 404, never the file |

Signed-in check (mandatory, redirects hide crashes): sign in with a
magic link, then open `/dashboard`, `/repos`, `/settings`, and one
`/dashboard/flags/[id]` while signed in. All four must render 200.

End-to-end (this also settles the two unconfirmed phase-3 items):
paste a public repo URL as an anonymous scan and watch it finish, then
sign in and rescan it from the dashboard. Both reports must list real
flags with ages, rollout, call sites, deletable lines, and a diff.
Download the CSV from a report and check it opens with the flag rows.
Delete a scan, delete a repo, and confirm both disappear from the
dashboard. If the first live scan fails on git, set
`SCANNER_AGE_SOURCE=github-api` in Vercel env vars, redeploy, and
re-run the scan: ages will read "approx", rename detection is off, and
flags cap at possible confidence. Check Vercel → Logs after the sweep;
a clean log after the signed-in check is real evidence.

## 12. Rollback plan

Vercel keeps every deployment: open the project → Deployments, find
the previous production deployment, and use instant rollback. No
migration in this release changes an existing column, so rolling back
code never needs a database rollback. If a migration ever fails
mid-run, re-run it from the file (migrations are written to be safe to
re-run) or restore from the manual dump in step 10. If `CRON_SECRET`
ever leaks, generate a new value, update both the Vercel env var and
the Vault `cron_secret`, and redeploy. If the provider token key ever
leaks, generate a new `provider_token_enc_key`, update the Vault
secret, and re-save every provider token in Settings (tokens encrypted
under the old key cannot be decrypted under the new one).

## 13. Launch

Launch itself is a human decision, not part of this guide. When it
happens, the plan in `PLAN.md` section 0.5 applies: demo scan live
with its public report link, README quickstart, Terms + Privacy
human-reviewed, Show HN post (Tue-Thu, 8-11am US Eastern) with a
hand-written first comment, dev.to build-in-public walkthrough, two
niche Reddit subs with authorship disclosed, UptimeRobot monitors
live, changelog at 0.1.0.
