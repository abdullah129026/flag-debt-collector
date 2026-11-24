# Backend

Next.js 16 App Router, plain JavaScript. Supabase (Postgres + Auth) is the
only backend service. No ORM, no queue service: the scan tick is a cron
endpoint that claims work from the database and resumes from stored
progress, so a scan survives the 10-second function limit by running across
many ticks.

## Routes

All API routes return one error shape: `{error: {code, message}}`.

| Method and path | Auth | What it does |
| --- | --- | --- |
| GET /api/health | none | 200 when the DB answers, 503 `degraded`/`unconfigured` otherwise |
| POST /api/scans | optional | Queue a public-repo scan. Anonymous: 3 per IP per UTC day. Signed-in: 20 per day. Returns `scan_id` and `report_url` |
| GET /api/scans/[id] | public (private scans need owner) | Scan status, progress, headline counts |
| DELETE /api/scans/[id] | owner | Cancel a running scan, then delete it and its flags |
| GET /api/scans/[id]/flags | public | Flags sorted status, LOC desc, age desc; 500-row cap |
| GET /api/scans/[id]/csv | owner | CSV export of the scan's flags |
| GET /api/repos | signed-in | The user's repos, with latest scan status |
| DELETE /api/repos/[id] | owner | Delete a repo and its scans |
| POST /api/repos/[id]/rescan | owner | Queue a fresh scan of a repo |
| GET /api/flags/[id] | public | Flag detail, call sites, events, same-file unresolved refs |
| POST /api/flags/[id]/ignore | owner | Ignore a flag (only from active or reopened) |
| POST /api/flags/[id]/unignore | owner | Un-ignore (only from ignored) |
| POST /api/flags/[id]/mark-removed | owner | Mark removed (only from deletable or stale) |
| POST /api/flags/[id]/reopen | owner | Reopen (only from ignored or removed) |
| POST /api/flags/[id]/override-cap | owner | Override the scan cap on a flag (body: `cap_days`, 0-3650) |
| GET /api/cron/scan-tick | CRON_SECRET bearer | Claim one scan, run up to 7 seconds of work, save progress |
| GET /api/cron/purge | CRON_SECRET bearer | Delete anonymous scans older than 30 days, keep the latest per repo |
| GET /api/settings | signed-in | The user's scan settings, with defaults |
| PUT /api/settings | signed-in | Update staleness days and the delete cap |
| GET /api/settings/tokens | signed-in | Which providers have a stored token (never the token) |
| POST /api/settings/tokens | signed-in | Store a provider token, encrypted with the Vault key |
| DELETE /api/settings/tokens | signed-in | Delete a provider token |
| POST /api/settings/tokens/test | signed-in | Test a token against the provider API |
| DELETE /api/account | signed-in | Delete the account (typed confirmation, deletes the auth user) |
| GET /auth/callback | none | Magic-link callback, sets session cookies, attaches claimed scans |

The signed-in gate for pages lives in `src/proxy.js`. With a `src/`
directory the proxy file must sit in `src/`, not at the project root: a
root `proxy.js` is silently ignored and the gate never runs. When Supabase
env vars are unset, the gate falls back to checking for a session cookie
name; when they are set, it verifies the session.

## How a scan runs

1. `POST /api/scans` validates the URL (github.com or gitlab.com, HTTPS,
   no userinfo, no ports, no IP literals), checks quota and queue depth
   (10), and inserts the scan as `queued`.
2. The tick (`GET /api/cron/scan-tick`, fired every minute by pg_cron)
   claims one scan with `claim_scan()` (`FOR UPDATE SKIP LOCKED`, 1-minute
   claim window, heartbeat refreshed during long steps), then runs
   fetch, parse, age, provider rollout, finalize in order, saving progress
   after each step. A tick does at most 7 seconds of work and re-queues
   the scan for the next tick when it runs out of time.
3. Fetch downloads the repo tarball (GitHub codeload, or the GitLab
   archive API) and stores it as the artifact. Parse and finalize
   rebuild from that tarball, so there is no separate clone and no git
   in the runtime at all. Caps (100 MB, 10,000 files) are enforced on
   the download and again during extraction. The fetch step runs for a
   queued scan and for one stuck in 'cloning': a tick that dies
   mid-download must retry on re-claim, not skip the step. Every hop
   is time-boxed to fit the 10s function cap: repo metadata 3s, the
   download 6s (a stalled download aborts with download_timeout and
   retries, up to 3 attempts), the host-API age calls 3s each with an
   early stop at the tick deadline.
4. Parse is AST-first (`@babel/parser`): SDK calls are only counted when
   the matching SDK import is present in the file. `useFlags()` is read
   through property access and destructuring. Dynamic keys are recorded as
   unresolved, never guessed. `.flagdebtignore` excludes paths and keys.
5. Age comes from the host API (oldest commit per file, capped at 100
   files, labeled approximate) for GitHub and GitLab. Rename detection
   is off and flags cap at possible confidence. The `SCANNER_AGE_SOURCE`
   variable stays set to `github-api` as the recorded mode; the code no
   longer branches on it.
6. Rollout: LaunchDarkly flag-statuses API (a flag counts as 100% only
   when its status is `launched`, otherwise null), ConfigCat public
   `config.json` (fetched with the SDK key found in the repo, or a stored
   key for signed-in users). Env and config flags have no rollout.
7. Finalize computes the three signals, status, confidence, deletable LOC
   (from a real unified diff, generated in pure JS with Myers' algorithm
   and verified by applying it back to the original content before
   storing), and the headline total: definite and likely flags with a
   known winning value only, ignored and removed excluded, "up to N"
   never added. The landing page's demo numbers come from `GET /api/demo`,
   the latest done scan of the demo repo.

## Data model

Migrations live in `supabase/migrations/`. Tables: `repos`, `scans`,
`repo_flags`, `flags`, `references`, `unresolved_references`,
`flag_events`, `provider_tokens`, `settings`, `meta`. RLS is on, with
public-read policies for public scans, and every table has explicit
minimal grants to `service_role` only. pgcrypto is pinned to the public
schema. `scripts/pg-cron-setup.sql` schedules the scan tick every minute
and the purge daily; it expects `<APP_URL>` and the Vault `cron_secret`
to be filled in at deploy time.

## Environment variables

See `.env.example`. Required: `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`. Optional: `GITHUB_TOKEN`,
`NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST`,
`SCANNER_AGE_SOURCE`. Two gotchas carried from project 4: use the legacy
service_role JWT, not the new-style `sb_secret_...` key, and the
CRON_SECRET value lives in Vercel env vars and the Supabase Vault, never
in the repo.

## Deviations from PLAN.md

- Claim window is 1 minute, not 10. The plan's 10-minute window breaks
  the 5-minute whole-scan budget for multi-tick scans: a live tick
  refreshes its heartbeat during long steps, so 1 minute of silence
  means the tick is dead, never stolen. Migration 0004.
- Tarball artifacts, no git at all. The Vercel Node runtime has no git
  binary (proven 2026-11-24: the first live demo seed failed twice with
  `git clone` ENOENT, misreported as "No repo at that URL"). The fetch
  step downloads the host tarball and stores it; parse and finalize
  rebuild by extracting it. Age comes from the host API, diffs are
  generated in pure JS. The fetch failure taxonomy names its own cause
  (not_found, private_repo, download_failed, download_timeout, over_caps)
  instead of mapping everything to not_found. Migration 0006 widens the
  `age_source` check for `gitlab-api` and `unknown`.
- The landing page's demo numbers were static until the fix: `GET
  /api/demo` now serves the latest done scan of the demo repo, and the
  landing fetches it on load. The seed script drives the tick until the
  scan is done or failed (it used to stop after the first tick, because
  intermediate statuses are not `queued`).
- A tick that dies mid-download used to strand the scan in 'cloning'
  forever: the fetch step only ran for 'queued', so every re-claim
  skipped all steps and returned. The fetch now runs for 'queued' or
  'cloning' (fixed 2026-11-24, the first live scan proved it). The
  seed's own fetches are capped at 15s with the status poll retried,
  after the first seed run hung 300s on an unanswered call and crashed.
- Same-file unresolved rule: a dynamic or unresolved reference caps
  every flag recorded in that file at `possible`. Conservative, and
  documented on the flag row.
- LaunchDarkly percentage: the flag-statuses API returns a status, not a
  percentage. Rollout is 100 only when the status is `launched`,
  otherwise null. The "launched after 7+ days" rule is the API's own
  definition, not something the scanner re-checks.
- A `flags.json` that holds a non-flag document (an OpenAPI spec was the
  real case) yields no flags. A bare flag map counts only when every
  value is a boolean or a rollout object with scalar fields.
- `jsconfig.json` maps `@/*` to the project root. The alias was used by
  every route but never configured, so the first production build
  failed on `@/lib/validate` until the file was added.

## Testing

`npm test` runs the suite with `node --test "test/*.test.js"` (plain
`node --test test/` does not pick the files up on this setup). 72 tests,
green. Coverage: URL validation, the detection engine against golden
fixture `test/fixtures/fixture-a/` (SDK shapes, guards, ignore rules,
config flags), LOC and the pure-JS diff (the generated diff is applied
back to the original content in the test), signals and the full tick
pipeline end to end against the fixture through an in-memory store
(including a scan stuck in 'cloning' resuming and finishing),
tarball download and extraction against real GNU tar output, host-API
age for GitHub and GitLab (including the deadline stop and the per-call
timeout), CSV output. The detection engine was
mutation-checked: removing `variation` from the client methods failed 3
golden tests, and the restore was byte-identical.

## Unverified at the end of phase-3

- No Supabase project exists yet (phase-6 creates it). Migrations and
  routes are tested against pure functions, golden fixtures, and an
  in-memory store, not live Postgres.
- Git in the Vercel Node runtime is proven absent (2026-11-24, first live
  demo seed). The scan pipeline no longer uses git anywhere: tarball
  fetch, host-API age, pure-JS diffs.
- The LaunchDarkly adapter is written against the documented API and
  never verified against a live account. No token in v1 by gate decision.
- pg_cron firing end to end is unconfirmed (project 4's is too). The
  fallback is an external free pinger hitting the tick endpoint.
- The signed-in sweep, the ingest round-trip, and the demo scan all
  await the phase-6 deploy. `scripts/seed-demo.mjs` runs the demo scan
  once the app is live.
