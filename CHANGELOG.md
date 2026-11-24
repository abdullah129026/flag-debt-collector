# Changelog

## 0.1.2 — 2026-11-24

The first live scan proved the tarball pipeline could strand a scan: a
tick that died mid-download left the scan in 'cloning' forever, because
the fetch step only ran for 'queued' and every re-claim skipped it.

- The fetch step runs for 'queued' or 'cloning', so a dead download
  retries on re-claim instead of sticking the scan.
- Every fetch hop is time-boxed to the 10s function cap: repo metadata
  3s, the tarball download 6s, host-API age calls 3s each with an early
  stop at the tick deadline (partial ages, scan still finishes).
- The seed caps every call at 15s and retries a failed status poll,
  after the first seed run hung 300s on an unanswered call and crashed.

## 0.1.1 — 2026-11-24

Post-launch fix: scans could not run on Vercel (no git binary in the
serverless runtime, so `git clone` failed and every failure was
misreported as "No repo at that URL").

- Repos are fetched as tarballs (GitHub codeload, GitLab archive API)
  and extracted with node:zlib plus a small tar reader; no binary is
  assumed in the runtime. Caps (100 MB, 10,000 files) are enforced on
  the download and during extraction.
- Age comes from the host API for GitHub and GitLab (labeled approx,
  rename detection off, flags cap at possible). Migration 0006 widens
  the `age_source` check for `gitlab-api` and `unknown`.
- Deletion diffs are generated in pure JS (Myers) and verified by
  applying them back to the original content.
- Fetch failures name their own cause: not_found, private_repo,
  download_failed, download_timeout, over_caps.
- The landing page's demo numbers now come from `GET /api/demo`, the
  latest done scan of the demo repo. The seed script drives the tick
  until the scan is done or failed.

## 0.1.0 — 2026-11-23

First launchable version.

- Scan a public GitHub or GitLab repo URL: clone, AST-first flag detection with SDK import verification, git age, provider rollout, deletable LOC from the real diff.
- Flag statuses: Active, Watch, Stale, Deletable, Ignored, Removed, with confidence tiers and a winning-value picker for the deletion diff.
- Dashboard with counts, filters, density control, rescan, and CSV export. Flag detail with signals, call sites, diff viewer, ignore, mark-removed, reopen, and rollout-cap override.
- Provider tokens: LaunchDarkly (flag statuses per environment), ConfigCat (public config, no token needed). Unleash and Flagsmith fields are present but disabled in v1.
- Anonymous scans (3 per IP per day) with a claim cookie, signed-in scans (20 per day), queue depth 10, scan caps 100 MB and 10,000 files.
- Tick pipeline: one scan per minute, 7-second budget per tick, resume from stored progress. pg_cron jobs for the tick and the 30-day anonymous purge.
- Magic-link auth, signed-in route gate, typed-DELETE account flow, settings with scan defaults.
- Landing page with the honest demo-scan placeholder (no number shown until the scan runs), docs, terms, privacy, 404 and error screens.
- Design system on Meta Astryx (theme-neutral, dark-only), Inter throughout, 52 tests green, `next build` clean.
