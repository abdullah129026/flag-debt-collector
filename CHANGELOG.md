# Changelog

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
