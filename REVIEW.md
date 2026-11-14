# REVIEW.md: PLAN.md for project 5 (phase-0 review)

Two reviewers read the draft PLAN.md on 2026-11-14 (architecture, UI/UX). Full notes: `hidden_files/research-0.0-p5/review-architecture.md` and `review-uiux.md`. Every BLOCKER was fixed in the plan; SHOULDs and NOTEs were fixed or recorded below.

## Architecture review: 5 blockers, all fixed

1. Shallow clone made flag age uncomputable. Fixed: full clone with `--filter=blob:none`, `--depth 1` forbidden, and the knock-on recorded (blobs download on demand, so the cap is enforced by the pre-clone API size check plus a post-checkout `du` measurement).
2. The multi-tick scan assumed the clone survives in `/tmp` across Vercel invocations. It does not. Fixed: the clone tick uploads a git bundle (history) and a HEAD tarball (files) to a private Supabase Storage bucket; later ticks download what they need.
3. A tick killed at the 10s ceiling left the scan stuck forever. Fixed: the claim takes queued scans plus any non-terminal scan whose heartbeat is older than 10 minutes; every tick refreshes the heartbeat.
4. The git dependency was unverified and the fallback could not work. Fixed: phase-3 slice 1 starts with a go/no-go spike (git, blob filter, pg_net trigger). The fallback is now a real GitHub API path (repo tree plus oldest commit per file, capped, ages labeled "approx", flags capped at possible, never Deletable), needing an optional `GITHUB_TOKEN` env var.
5. The 5-minute scan criterion contradicted the tick math. Fixed: ticks are budget-driven (as much as fits in ~8s), and the criterion is restated per repo size (under 5 minutes up to 1,000 files, under 30 minutes up to the 10,000-file cap).

## Architecture review: SHOULDs and NOTEs

- User state lost on rescan. Fixed: new `repo_flags` table carries Ignored and marked-Removed across scans; finalize diffs against the previous scan.
- Kill-switch flags mechanically reached Deletable. Fixed: provider non-temporary marker and a name-pattern list cap them at Stale, with a user override recorded as an event.
- LOC formula only covered `if/else`. Fixed: supported shapes table (if/else, ternary, `&&`, early return, combined conditions) with LOC per shape, `git apply --check` required in phase-3 tests, call-site list instead of a diff for unsupported shapes.
- Rollout had no environment dimension; ConfigCat SDK key unsourced. Fixed: `rollout_by_env` jsonb, production environment only in v1, ConfigCat key supplied at scan time.
- Env/config flags could never earn signal 1. Fixed: stated explicitly, capped at Stale, never Deletable.
- `useFlags()` property access missing. Fixed: resolver traces hook returns and destructuring, with golden fixtures.
- Caps and DNS re-check hand-waved. Fixed: pre-clone size check plus `du` enforcement, argv-only `execFile`, DNS re-check dropped in favor of the allowlist.
- pg_cron mechanism unnamed, pattern unproven. Fixed: pg_net named, verified end to end in slice 1, external pinger as fallback.
- Age step cost. Fixed: batched log per key, one blame per file.
- RLS blocked the public report. Fixed: public-read policy on scans, flags, references when visibility is public.
- Retention purge never built. Fixed: pg_cron purge job in phase-3 slice 4.
- Notes: `.flagdebtignore` format defined (gitignore globs plus `flag: <key>`); config-file recognition rule defined; IP extraction and queue-depth cap (10) specified; LaunchDarkly endpoints named for slice 3; demo-scan rollout expectation set in the flow.

## UX review: 7 blockers, all fixed

1. Shallow clone broke the age column. Fixed with the architecture fix above.
2. Status model contradicted itself (Active and Watch both covered 1 signal). Fixed: Active is 0 signals only.
3. "Reachable" was undefined. Fixed: column definitions added (reachable, tests only, not referenced).
4. Rollout % conflated snapshot with duration. Fixed: "100% now" plus the provider flag, never a duration; exact text for env/config flags ("n/a") and unknown sorting defined.
5. Deletable total had no summation rule. Fixed: headline total sums definite and likely flags with a known winning value only; "up to N" shown separately; no-winning-value detail state specced (no diff, both branches, user picks the winning value).
6. Public report link contradicted the privacy promise. Fixed: unguessable UUIDs, no source code stored (locations only), deletion diff named in the contract, anonymous scans purge after 30 days, owner delete at any time.
7. First run stranded the user during a 5-minute scan. Fixed: progress page shows the report URL with copy button, queue position, elapsed time, and the tab-close behaviour.

## UX review: SHOULDs and NOTEs

- Failure and quota states missing. Fixed: error taxonomy table with per-cause message and next action.
- Caps discovered only by failing. Fixed: caps in the landing contract, pre-clone size check.
- Ignore and Removed flows had no UI. Fixed: dialog with required reason, Ignored filter, mark-removed with rescan confirmation, events timeline on detail.
- Confidence buried. Fixed: confidence chip on every list row.
- Rescan state unspecified. Fixed: old data plus "Rescanning" banner, replace on completion.
- Provider-token UX missing. Fixed: test connection, invalid-token banner, distinct "unknown" texts, ConfigCat no-token note.
- Research requirements dropped from Scope IN. Fixed: density modes, `aria-sort`, filter chips, "Showing N of M" carried into Scope IN.
- Sort order opaque. Fixed: default sort formula defined and printed on the dashboard.
- `.flagdebtignore` had no user surface. Fixed: report lists applied rules and their effect.
- Notes: three distinct empty states specced; signal 2 is all-sites-unchanged; flag detail groups by file with a prod vs test split; Astryx gap (diff viewer, dense table, code display) must be resolved in phase-1/2 per ADR 6.

## Outcome

20 architecture findings (5 blockers) and 20 UX findings (7 blockers) were addressed. No finding was left open. The plan as committed reflects all of them.
