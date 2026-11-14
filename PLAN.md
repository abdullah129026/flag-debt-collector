# PLAN.md: Feature Flag Debt Collector (project 5)

Repo: abdullah129026/flag-debt-collector. Stack: Next.js 16 (App Router, plain JS) + Supabase (Postgres, Auth) + Vercel. Design: Meta Astryx, neutral theme, dark-first, Inter via the font token override. Deadline: Sat 2026-11-21.

One-line pitch: find the flags your codebase forgot, and count what deleting them saves.

## 0.0 Research sprints

Five sprints ran in parallel on 2026-11-14. Full notes live in `hidden_files/research-0.0-p5/`. What each sprint settled:

### Architect + DevOps

- Detection is AST first, regex as fallback. Production scanners (FlagShark, PostHog's stale-flag scanner, Uber's Piranha) parse with an AST and cross-check matches against known SDK call shapes; regex alone cannot tell a flag reference from a same-named string. Source: https://flagshark.com/how-it-works/
- Flag age comes from git history: `git log -S "key" --reverse` gives the introduction commit (creation date); `git log -G` catches renames and moves that `-S` misses; `git blame -w` gives last-change date only, and is fooled by reformats without `-w`. A renamed flag looks newer than it is unless `-G` is also checked. Source: https://www.learncodefast.org/courses/git/blame
- Rollout % and reachability come from each provider's API, not from code. LaunchDarkly marks a flag `launched` per environment after 7+ days serving one variation and exposes a `temporary` field; Unleash exposes `potentiallyStale` and `lastSeenAt`; Flagsmith tags flags Stale after 30+ days with no change; ConfigCat serves the full flag setup in a public CDN `config.json` (rollout readable, no evaluation history). Env vars and config files have no rollout: a flag is on or off. Sources: https://devtocash.com/blog/2026-11-07-feature-flag-cleanup-agent-stale-launched-flags-code-references-dead-code-removal-pr, https://atono.io/blog/feature-flag-technical-debt-stale-flags
- Free tiers force an async, queued scanner. Project 3 verified on Hobby that Vercel functions have a HARD 10s ceiling and maxDuration is not honored. Render free has no background workers, spins down after 15 idle minutes, and shares a 750-hour monthly budget across the workspace. So the scan-request endpoint only enqueues a job row; a scheduled trigger advances it in small chunks, storing progress so a timeout resumes rather than restarts. Sources: https://www.natecue.com/en/learn/tech/serverless-functions-explained/, https://convika.com/compare/render-free-tier-production/

### Product manager + UX researcher

- Stale flags are expensive. DoorDash reported 56,000 flags across 623 repos, 1,659 stale as of May 2026, 1-2 hours per manual cleanup; its automated system produced engineer-approved removal PRs for 45 of 50 flags at $4.79 and 13.8 minutes each. About 25% of flags persist for over eight years in open-source projects. Knight Capital lost about $460M in 45 minutes partly because of a repurposed stale flag. Source: https://arxiv.org/html/2610.31351v1
- Flag platforms detect staleness but do not finish the cleanup in code. LaunchDarkly code references show where a flag key appears and its Vega agent can open a removal PR only for LaunchDarkly flags; Flagsmith tags Stale after a configurable quiet period; most platforms surface staleness without generating a cleanup diff. The gap is a repo-first, vendor-agnostic tool that shows every call site and produces the deletion diff. Sources: https://launchdarkly.com/docs/home/flags/code-references, https://launchdarkly.com/docs/home/flags/manage/flag-cleanup-vega, https://docs.flagsmith.com/managing-flags/stale-flags
- The open-source precedent is narrow. Uber's Piranha deletes flag-related code by AST transform (about 2,000 stale flags removed at Uber) but the open-source version covers Objective-C, Swift, and Java only, and it needs the flag name, expected treatment, and author supplied by hand. Room exists for a tool that works on JS/TS repos, infers the winning branch from rollout state, and assumes no single provider. Sources: https://www.uber.com/in/en/blog/piranha/, https://arxiv.org/html/2610.31351v1
- First run should be zero-trust: paste a public repo URL first, no install; a read-only GitHub App limited to selected repos is the upgrade path for private repos. Trusted scanners state the exact permission list before install (Contents Read, Metadata Read, nothing else). Sources: https://docs.iriscode.co/cloud/connect-github, https://www.trylyra.ai/blog/github-app-permissions/
- Developers trust a deletable-LOC number only when it shows its evidence, defaults to keeping code, and is verified by a build. A real 26,412-line deletion used two evidence sources, defaulted every candidate to ALIVE, and required proof a candidate was dead (214 of 231 deleted, no rollback). Report deletions next to rollbacks and incidents, never rank individuals. Sources: https://docs.skylos.dev/concepts/dead-code, https://dev.to/yureki_lab/how-i-deleted-26000-lines-of-dead-code-with-claude-code-in-one-sprint-4hj7

### Designer

- One row per flag, not per reference. Semgrep groups findings by rule with matches nested underneath; the same mistake in forty files is one decision, not forty. Source: https://docs.semgrep.dev/semgrep-supply-chain/findings
- Rank by severity x reachability, not one blended score. Semgrep's Priority tab shows only critical/high and reachable findings. The flag list default-sorts by a transparent combination the user can see and change (age x rollout % x still-reachable), with the formula shown on the row. Source: https://docs.semgrep.dev/semgrep-supply-chain/findings
- Dense tables need density modes, visible sort/filter state, and a result count. Ship compact/comfortable/spacious heights, show the sorted column and direction with `aria-sort`, show applied filters as removable chips with clear-all, always show "Showing N of M". Every state is designed: skeleton rows, "no flags match these filters, clear filters", and a distinct first-run state with a primary action. Sources: https://www.setproduct.com/blog/data-table-ui-design, https://www.studioariel.design/blog/ux-best-practices-for-tables/
- Show payoff as effort x value, never a fake health grade. SonarQube's A-E maintainability rating is widely criticized as misleading, and a 2024 benchmark found its output aligns poorly with human expert judgment. The honest view is two axes (value of removal against ease of removal) plus concrete counts over time (flags removed, LOC deleted), not a rising score. Sources: https://cloudtsoftwareconsulting.com/uncategorized/a-misleading-maintainability-rating/, https://aiko.dev/visualising-and-prioritizing-technical-debt/, https://arxiv.org/html/2408.10754v1/
- The landing page must state exactly what the scan reads, stores, and never touches, before asking for repo access. Copy Semgrep's structure: reads flag definitions and references via read-only access; stores flag name, age, rollout %, file paths, and LOC counts; never stores source code, never writes to the repo. Add a no-signup sample scan of a public repo so trust is demonstrated, not claimed. (Plan refinement: the deletion diff is stored for your flags, and no source files are stored; the exact contract is in 0.1.) Sources: https://raw.githubusercontent.com/fproulx-boostsecurity/semgrep/develop/PRIVACY.md, https://docs.semgrep.dev/semgrep-multimodal/privacy

### Engineer + QA

- Parser: `@babel/parser` covers JS + TS (with TS and JSX plugins); acorn is JS-only and fastest; the TypeScript compiler API is the only type-aware option and is only needed if flag resolution needs type info. Pragmatic default is `@babel/parser`. Source: https://www.pkgpulse.com/guides/acorn-vs-babel-parser-vs-espree-javascript-ast-parsers-2026
- Dynamic flag names are a hard static-analysis limit. Resolve string literals, template literals with no expressions, and constant-foldable concatenations; anything built from variables, config, or interpolation is recorded as an unresolved/dynamic reference with its call site, never silently counted as "no reference" and never guessed. Source: https://www.flaglint.dev/docs/concepts/how-flaglint-works/
- False positives are the trust killer. Name-only grep false-positives on any same-named method (for example `variation()`); FlagLint traces a full provenance chain from a known SDK import to the call on that binding. A flag needs two of three staleness signals to be a candidate and all three to be near-certain; one signal is never proof (an ops/kill-switch flag sits at 100% on purpose). Confidence tiers: definite / very likely / possible / uncertain. Sources: https://www.flaglint.dev/docs/concepts/how-flaglint-works/, https://www.dif.sh/blog/detect-unused-feature-flags/
- Testing: small hand-built fixture repos plus golden JSON outputs, normalised before comparison (sort keys, strip timestamps and paths). Unit-test the AST walker, name resolution, and git-history age math in isolation; integration-test the whole pipeline (clone a local fixture repo, scan, report) and the failure paths (unparseable file, huge repo, timeout). A mutation check (break the resolver on purpose, confirm a golden fails) proves the goldens bite. Sources: https://dev.to/hackrs_6393/characterize-first-then-refactor-a-golden-corpus-harness-with-a-mutation-gate-3m6k, https://deepwiki.com/jeresig/stack-scraper/6.2-writing-and-running-tests
- Cloning arbitrary repos server-side is the biggest security surface. Allowlist hosts (github.com, gitlab.com), require HTTPS, reject userinfo, unusual ports, and IP literals, re-validate after DNS resolution. Never pass `--recurse-submodules`: Git patched CVE-2026-111760 (Nov 10, 2026), a recursive clone of a malicious repo can execute attacker code via a crafted submodule path. Cap clone size, file count, and wall-clock time per scan, delete the clone after the scan, never execute anything from it, never log or persist secrets found in it, and send a user's token only to the allowlisted host it belongs to. Sources: https://www.getprbl.com/fix/ssrf-user-url, https://www.openwall.com/lists/oss-security/2026/11/11/10

### Marketing + legal

- Positioning: the incumbents sell flag management, not cleanup. LaunchDarkly's Vega cleanup agent is LaunchDarkly-only with an AI provider and Enterprise requirement; ConfigCat surfaces "zombie flags" inside its own platform but does not remove dead code from any repo. The gap is a free, vendor-neutral scanner that answers how many lines can be deleted and exactly where. Sources: https://launchdarkly.com/docs/home/flags/manage/flag-cleanup-vega, https://configcat.com/docs/zombie-flags/
- Launch channels: Show HN first (something people can try right now, ideally without signup, plain title, hand-written first comment, Tue-Thu 8-11am US Eastern, answer every comment), then niche Reddit subs and dev.to tutorials, GitHub as the long-tail channel (a public repo with a working scan and a sample report is what readers click). Sources: https://www.studio1hq.com/blog/how-to-launch-on-hacker-news-show-hn, https://business.daily.dev/resources/where-to-launch-developer-tool/
- Privacy: do not keep the clone, keep only findings, delete on request, and say so in plain language. ShipDoctor deletes the working copy when the scan finishes and keeps only findings; RepoReady deletes analysis results when the project is deleted. Store only flag names, file paths, line numbers, and LOC counts; offer one-click project and account deletion with a stated timeline. Sources: https://app.shipdoctor.co/privacy, https://repoready.ai/privacy
- Secrets in scanned code: never store them, treat any hit as compromised, warn the user to rotate. A scanner will inevitably encounter API keys; it must never persist secret values, must redact them in stored findings and logs, and should surface a warning ("possible secret found at file:line, rotate it") rather than displaying the value. Sources: https://devactivity.com/insights/securing-your-code-preventing-secret-leaks-in-public-github-repositories-a-smart-goal-for-developers/
- Analytics: track the scan funnel with a privacy-first tool, not user behaviour. Plausible is cookieless by default and needs no consent banner; PostHog's free tier (1M events/month) adds funnels but needs careful cookieless configuration, session replay stays off. Events: `scan_started`, `scan_completed` (flag count, stale count, deletable LOC as aggregates, never repo names or code), `report_viewed`, `export_clicked`, `signup_completed`, plus landing pageviews and referrers. Sources: https://posthog.com/compare/posthog-vs-plausible, https://dev.to/contrite42/posthog-vs-plausible-vs-fathom-which-analytics-tool-to-run-for-your-saas-in-2026-109m

## 0.1 PRD-lite

### Problem (from the user's pain, not the technology)

A developer ships a flag to roll out a feature, the rollout finishes, and the flag stays. Six months later the codebase has `if (new_checkout_enabled)` wrapped around dead branches in a dozen files, nobody remembers what the flag did, and nobody dares delete it because deleting the wrong branch breaks production. The cost is real: DoorDash measured 1-2 hours per manual cleanup across 1,659 stale flags, and a repurposed stale flag cost Knight Capital about $460M in 45 minutes. The pain is not "I cannot see my flags", every platform already shows them. The pain is "I cannot prove this flag is safe to delete, and I cannot see what deleting it removes".

### Primary user + what success looks like for them

Primary user: a solo developer or small-team developer with a JS/TS repo that has grown past its first few flags. Success for them looks like this: they paste a repo URL, wait a few minutes, and get a list where the top flag says "created 14 months ago, last changed 11 months ago, 100% rollout now and provider-marked launched, 3 call sites in 2 files, deleting it removes 47 lines", with the exact diff shown. They delete it, the build stays green, and the dashboard counts it. A second user, the portfolio reader (hiring manager), succeeds when the scan, the reasoning, and the code are all inspectable in one repo.

### MVP success criteria (measurable)

1. A scan of a real public JS/TS repo completes end to end (queue, clone, parse, age, rollout where a provider is connected, report) and lists every flag with age, references, rollout %, and deletable LOC. Zero false "Deletable" verdicts on the golden fixture set (every golden passes, and the mutation check proves a broken resolver fails a golden).
2. The launch demo scan of one real repo quantifies a non-zero deletable LOC total with the evidence visible for the top flag (age, rollout, call sites, diff). The number is whatever the repo actually yields; the criterion is that it is shown with its evidence, not that it clears a threshold.
3. The live site passes the signed-in sweep by Nov 21: landing, login, dashboard, flag detail, settings all render; an anonymous scan and a signed-in rescan both complete; no page 500s. A scan of a repo up to 1,000 files finishes in under 5 minutes wall clock; up to the 10,000-file cap, under 30 minutes. Queue wait is excluded from that budget and shown as a queue position.

### Flag state model (transitions are binding)

Flags carry one status. The scanner assigns the first four; the user assigns the last two.

| Status | Meaning | How it is set |
|---|---|---|
| Active | 0 staleness signals | Scanner, on every scan |
| Watch | Exactly 1 staleness signal | Scanner |
| Stale | Exactly 2 staleness signals | Scanner |
| Deletable | All 3 staleness signals | Scanner |
| Ignored | User decided this flag stays (kill switch, seasonal, permanent) | User, with a reason; excluded from deletable totals until un-ignored |
| Removed | User deleted it in their repo and the next scan confirmed it is gone | User marks removed, scanner confirms absence on rescan; if it reappears, back to Active |

Staleness signals (a flag needs 2 to be Stale, 3 to be Deletable):

1. Settled rollout: the provider reports 100% one variation right now, or marks the flag launched/stale. Providers give a snapshot, not a duration, so the UI never claims "100% for 90 days"; it shows "100% now" plus the provider flag. Env and config flags can never earn this signal from repo data: their value lives in deployment config, not the repo. They are capped at Stale, never Deletable.
2. Old and untouched: created more than 90 days ago (first `git log -S` hit) and no call-site change in the last 90 days (`git blame -w`). All call sites must be unchanged: one recently touched site resets the clock.
3. Narrow or quiet: the provider reports the flag stale/launched, or every reference sits in tests, stories, or docs (no production call site), or the flag has exactly one call site.

Kill-switch carve-out: a flag the provider marks non-temporary or permanent (LaunchDarkly `temporary: false`) is capped at Stale, never Deletable, even with 3 signals. So is a flag whose key matches the kill-switch name list (`kill`, `killswitch`, `emergency`, `maintenance`, `circuit-breaker`): the reason is shown on the row, and the user can override the cap on the detail page, recorded as an event. An ops flag sits at 100% on purpose; the plan does not call it deletable.

### Supported code shapes (deletable LOC and diff)

The LOC formula only covers shapes the scanner understands. Anything else gets a call-site list, not a diff.

| Shape | LOC counted when the winning value is known |
|---|---|
| `if (flag) { A } else { B }` | Losing branch lines + the guard lines |
| Ternary `flag ? A : B` | Losing arm lines |
| `flag && <Component />` or `flag && expr` | The guarded expression lines |
| Early-return guard `if (!flag) return;` | The guard lines, when the flag is the whole condition |
| Combined condition `flag && isAdmin` | Only the lines guarded solely by the flag; if the flag is one operand of a wider condition, LOC is "up to N" with the note that the other operand still guards the code |

Every generated diff must pass `git apply --check` in phase-3 tests before it is stored. "Up to N" for a known winning value is the max over the supported shapes, never a sum across branches. Flags outside the supported shapes show their call sites and no diff, and are capped at possible confidence.

Confidence tiers ride on top of the status and are always shown: definite (3 signals, import-verified, literal keys), likely (2 signals, import-verified), possible (2 signals but one reference is dynamic or the key came from config), uncertain (any unresolved/dynamic reference touches this flag, or the winning value is unknown). A flag with an unresolved reference can never be Deletable.

Deletable LOC is computed, never estimated silently. For a flag with a known winning value, the losing branch is dead: LOC = lines in the losing branch + the guard lines (`if` line and braces) + the flag definition line when the flag is defined in code. The count comes from AST node spans. When the winning value is unknown (no provider connected), LOC is shown as "up to N" with the assumption stated on the row, and it is never added to the headline total. The headline deletable total sums definite and likely flags with a known winning value only; "up to N" lines are shown separately as "up to N more lines (winning value unknown)". When the winning value is unknown the detail page shows no diff: it shows both branches, states the assumption needed, and lets the user pick the winning value, after which the diff and LOC compute. Dynamic or unresolved references cap the flag at possible confidence and exclude it from the deletable total. The formula is printed on the flag detail page so the number can be checked by hand.

### First-run flow (v1)

1. Landing page: paste a public repo URL, no signup. The three-line data contract sits above the button: reads flag definitions and references via read-only access; stores flag name, age, rollout %, file paths, line numbers, LOC counts, and the deletion diff for your flags; never stores source files, never writes to the repo. The contract also states the caps (repos up to 100 MB and 10,000 files) and that the full clone is downloaded, scanned, then deleted.
2. Scan starts immediately. Anonymous quota is 3 scans per IP per UTC day. A progress page polls the scan status (queued, cloning, parsing, age, provider, done, failed) and shows the current step, the queue position, and elapsed time, not a spinner. The page shows the report URL with a copy button from the start: closing the tab loses nothing, the public report link still opens the finished report. The claim cookie ties the scan to this browser for delete and attach; on another device the link still opens the report, only the claim does not transfer.
3. Report page is public by scan id (unguessable UUID), like a shared link: flag table, top deletable total, per-flag evidence, deletion diff per flag. No signup needed to read it. The anonymous demo scan shows rollout "unknown" unless a provider token is connected, and the page says so rather than hiding the column. Anonymous scans auto-purge after 30 days; the scan owner (claim cookie or signed-in owner) can delete a scan at any time.
4. Sign in (magic link) to save repos, rescan on demand, connect a provider token for rollout %, and track removals over time. An anonymous scan attaches to the new session via a claim cookie (same pattern as project 3).

### Scan failure states (error taxonomy)

A failed scan always names the cause and the next action; "failed" alone is never the message.

| Cause | Message | Next action |
|---|---|---|
| Private repo | "This repo is private. Public repos only in v1." | Sign in and wait for the GitHub App, or scan a public repo |
| Not found | "No repo at that URL. Check the owner and name." | Fix the URL and retry |
| Non-allowlisted host | "Only github.com and gitlab.com repos are supported." | Use a supported host |
| No JS/TS files | "No JavaScript or TypeScript files found in this repo." | Scan a JS/TS repo |
| Over caps | "This repo is over the scan caps (100 MB, 10,000 files)." | Narrow the scan later; v1 cannot split a repo |
| Clone timeout | "The clone timed out. The repo may be too large or the host slow." | Retry, or scan a smaller repo |
| Anonymous quota used | "You have used 3 anonymous scans today. Quota resets at midnight UTC." | Sign in for 20 scans a day |

### Dashboard column definitions

- Reachable: whether the flag is evaluated in production code. Values are "reachable" (at least one production call site), "tests only" (references exist only in tests, stories, or docs), "not referenced" (defined in config, no code reference). Shown as text with a shape, never color alone.
- Rollout %: the provider value right now, or "n/a" for env/config flags (on/off only), or "unknown" when no provider is connected. Unknown sorts after known values in any rollout sort, and "unknown (no token)" reads differently from "unknown (token invalid)".
- Confidence: a chip on every list row next to the status (definite, likely, possible, uncertain), with the reason one click away on the detail page.
- Default sort: status rank first (Deletable, Stale, Watch, Active), then deletable LOC descending, then age descending. The formula is printed on the dashboard ("Sorted by status, then deletable lines, then age") and any column sort replaces it.
- Table behaviour (from the designer research): compact/comfortable/spacious density modes, `aria-sort` on the sorted column, applied filters as removable chips with clear-all, and "Showing N of M" on every list.

### Ignore and Removed flows

- Ignore lives on the flag row and the detail page. It opens a dialog that requires a reason (kill switch, seasonal, permanent, other with text). The reason is stored in `flag_events`. Ignored flags stay visible under an "Ignored" filter and are excluded from the deletable total.
- Mark removed lives on the flag detail page. It records the intent; the next rescan confirms it: if the flag is gone, status becomes Removed and the event is recorded; if it reappears, the flag returns to Active with an event noting the reappearance. `flag_events` history is viewable as a timeline on the flag detail page.
- While a rescan runs, the dashboard keeps the old data with a "Rescanning, updated X ago" banner. New results replace the old ones on completion; status transitions are recorded as events.

### Scope IN

- JS/TS repos only (.js, .jsx, .ts, .tsx, .mjs, .cjs), public by URL in v1.
- Detection via `@babel/parser` with import-verified SDK call shapes for LaunchDarkly, Unleash, Flagsmith, ConfigCat, plus env-var style flags (`process.env.*`) and config-file flags (JSON/YAML flag definitions per the recognition rule in 0.3). The resolver traces hook-return objects and property access (`useFlags()` plus `flags.myFlag` and destructuring), not just direct calls.
- Flag age from git history (`-S` creation, `-G` rename check, `blame -w` last change, one blame per file).
- Rollout % from the LaunchDarkly flag-statuses API (user token, encrypted; production environment only in v1) and ConfigCat `config.json` with a user-supplied SDK key (optional field at scan time; never stored for anonymous scans). Unleash and Flagsmith rollout are design hooks, not v1.
- Deletable LOC from AST branch spans, with the formula shown; deletion diff per flag (unified diff text, never applied automatically, never a PR).
- Dashboard: flag table (flag, age, rollout %, reachable, deletable LOC, confidence chip on every row), flag detail (call sites grouped by file with a production vs test split, history timeline, diff, signals, unresolved references for that flag in their own section), repos list, rescan with the old-data-plus-banner state, provider token settings, CSV export of the flag list. Table behaviour: density modes, `aria-sort`, filter chips with clear-all, "Showing N of M". Default sort is status rank, then deletable LOC, then age, with the formula printed on the page.
- Anonymous scans (claim cookie) plus magic-link sign-in; owner-scoped RLS; audit events for ignore, un-ignore, mark-removed, and confirmed-removed.
- `.flagdebtignore` file support: exclude paths and flag keys, read from the repo root at scan time. Format: one rule per line, `#` comments; a line is either a path glob in gitignore syntax or `flag: <key>` to ignore one flag key. The report lists every applied ignore rule and how many flags or paths it excluded. A signed-in repo owner can add rules in settings; they apply on the next rescan. A paste-URL user sees the rules that applied and can add their own after signing in.
- Provider token settings: per-account token entry with a "Test connection" button, last-4 display, and revoke. An invalid or expired token shows an error banner in settings and makes rollout read "unknown (token invalid)", distinct from "unknown (no token)". ConfigCat needs no token: when a ConfigCat config is found in the repo, settings says so and rollout is fetched without one.
- Seed script with fixture repos and one real demo scan; golden JSON test outputs.
- Landing, login, dashboard, flag detail, settings, docs, legal pages; OG image; README quickstart under 5 minutes.

### Scope OUT (binding)

- Other languages (Go, Python, Java, and the rest). The parser interface is built so a second language can be added later, but v1 ships JS/TS only.
- Private repos in v1. The upgrade path is a GitHub App (Contents Read, Metadata Read, selected repos only); v1 shows the exact permission list and says private repos are coming, it does not half-build OAuth `repo` scope.
- Auto-creating pull requests or auto-deleting code. The product shows the diff; the user deletes. PR creation is a design hook.
- Unleash and Flagsmith rollout fetching in v1 (detection of their SDK calls is IN; rollout % is a hook).
- Runtime evaluation data (no SDK installed in the user's app, no exposure counts). Staleness is static plus provider API only.
- Teams, workspaces, roles, and per-user ranking. One account owns its repos. Never rank individuals by deletions.
- Monetization, billing, and paid tiers. Free to use; Paddle is the merchant of record if it ever monetizes, per the brief.
- Mobile app. Responsive web only.
- A health score or maintainability grade. The dashboard shows concrete counts (flags removed, LOC deleted) over time, never a blended score.

## 0.2 Foresight (unstated but coming)

### BAKE IN NOW

1. Second-language parser slot: the walker takes a language adapter (parse file, find call shapes, resolve keys). JS/TS is the only adapter in v1, but the interface exists so Go or Python does not require a rewrite.
2. Scheduled rescans: scans carry `next_scan_at`; the queue already supports re-running a repo on a schedule, even though v1 only rescans on demand.
3. `.flagdebtignore`: exclusion rules for paths and flag keys, read from the repo root. Cheap now, painful to retrofit once users hit false positives.
4. Audit events: every ignore, un-ignore, mark-removed, and confirmed-removed is an event row with actor, reason, and timestamp. Deletion counts are only trusted if the history is complete.
5. Provider token storage via encrypted RPCs: tokens are stored with pgcrypto (same pattern as project 3), reads return last-4 only, the raw token is never logged or returned.
6. Unresolved/dynamic reference list: every scan stores its unresolved references with call sites. Without this list, a future "why did this flag disappear" question has no answer.
7. Scan caps as data, not constants: clone size, file count, and tick budget live on the scan row so a cap change does not need a deploy.
8. Public report links: scan reports are addressable by id from day one, so sharing a report never needs a later URL migration.

### DESIGN HOOKS

9. GitHub App for private repos: the repo row already carries `access_kind` (public_url vs github_app) so private repos slot in without a schema change.
10. Auto PR creation: the deletion diff is already computed and stored per flag; opening a PR later is a transport step on top of it, not a new analysis.
11. Unleash and Flagsmith rollout: the provider adapter interface (fetch rollout, fetch staleness) is the same one LaunchDarkly and ConfigCat use; adding a provider is one adapter, not a new pipeline.
12. Flag ownership from CODEOWNERS: the reference rows already carry file paths, so mapping a flag to an owner file is a lookup, not a rescan.
13. Slack or email alert when a new flag goes Stale: the scan-finalize step already computes status transitions, so an alert is a notification on an existing event.
14. Export as PDF report: the CSV export in v1 proves the report object is complete; a PDF renderer consumes the same object later.

### EXPLICITLY DEFERRED

15. Runtime evaluation data (installing an SDK in the user's app to count exposures). It would make staleness near-certain, but it changes the product from a scanner to an observability tool and needs a second consent story.
16. Teams and shared workspaces. Single-owner first; multi-user needs roles, invites, and billing decisions that are out of scope for a one-week build.
17. A CLI scanner. The web scan proves the engine; a CLI is packaging, not new analysis, and it can reuse the same detection library later.

## 0.3 System architecture

### Diagram

```
paste public repo URL (no signup) ──> POST /api/scans ──> scans row (queued)
                                                              │
sign in (magic link) ──> save repos, rescan, connect ─────────┤
provider token (LaunchDarkly) ──> encrypted RPC ──> provider_tokens
                                                              │
pg_cron every minute (via pg_net) ──> GET /api/cron/scan-tick (bearer CRON_SECRET)
                              │
                              ├── claim one scan: queued, or any non-terminal scan
                              │   whose heartbeat is older than 10 minutes (stale-claim reaper)
                              ├── clone: git clone --filter=blob:none, no submodules
                              │   (full history, blobs fetched on checkout; allowlisted
                              │   hosts only, pre-clone size check, caps enforced,
                              │   argv-only git invocation via execFile, never shell)
                              │   then upload a git bundle (history) + a HEAD tarball
                              │   (files) to a private Supabase Storage bucket;
                              │   later ticks download what they need, nothing
                              │   is assumed to survive in /tmp between ticks
                              ├── parse: @babel/parser per file, import-verified call shapes
                              │   (incl. useFlags() property access and destructuring),
                              │   budget-driven: as much as fits in ~8s per tick
                              ├── age: batched git log per key (cached) + one blame
                              │   per file, not per call site
                              ├── provider: LaunchDarkly API / ConfigCat config.json
                              │   (production environment only in v1)
                              └── finalize: signals, confidence, deletable LOC, diff, status;
                                  carry user state forward from repo_flags;
                                  delete the Storage objects
                                                              │
dashboard reads scans, flags, references ──> flag table, detail, CSV export
```

### Data model sketch

- `repos`: id, owner_id (nullable for anonymous), host, full_name, default_branch, access_kind (public_url), created_at. Unique on (owner_id, host, full_name) where owner is set.
- `scans`: id (unguessable UUID), repo_id, owner_id (nullable), status (queued, cloning, parsing, age, provider, done, failed), progress jsonb (step, files_done, files_total, queue_position), caps jsonb (max_mb, max_files), error text, claim_token hash, started_at, finished_at, next_scan_at, updated_at (heartbeat, refreshed by every tick; a scan whose heartbeat is older than 10 minutes is re-claimable). Anonymous scans purge after 30 days.
- `repo_flags`: id, repo_id, key, provider, user_status (ignored, marked_removed, or null), reason text, updated_at. This is the repo-level flag entity: user state lives here and survives rescans, while `flags` rows are per-scan evidence. Finalize carries user state forward by key+provider and confirms Removed by absence.
- `flags`: id, scan_id, repo_id, key, provider (launchdarkly, unleash, flagsmith, configcat, env, config), kind (sdk, env, config), status (active, watch, stale, deletable, ignored, removed), confidence (definite, likely, possible, uncertain), signals jsonb (settled_rollout, old_untouched, narrow_quiet), created_at_git, last_changed_at, rollout_pct, rollout_source, rollout_by_env jsonb, winning_value, references_count, deletable_loc, loc_formula text, diff text. Unique per scan on (scan_id, key, provider).
- `flag_events`: id, repo_flag_id, actor_id, action (ignored, unignored, marked_removed, confirmed_removed), reason text, created_at.
- Scan artifacts: a private Supabase Storage bucket (service_role only, 1 GB free tier) holds one git bundle and one HEAD tarball per in-flight scan, deleted on finalize or failure. A retention purge (pg_cron, phase-3 slice 4) deletes scan rows older than 30 days except the latest scan per repo, plus their flags, references, and Storage objects.
- RLS on, owner-scoped SELECT policies, plus a public-read policy: scans, flags, and references are readable by anon when the scan's visibility is public (visibility column, default public; a signed-in-only option is a hook). Explicit minimal grants to service_role only, never GRANT ALL to anon or authenticated; pgcrypto pinned to public (`create extension if not exists pgcrypto with schema public;`).
- `references`: id, flag_id, file_path, line, column, kind (call, definition, test, config). No source code is stored: no matched-line text, only the location.
- `unresolved_references`: id, scan_id, file_path, line, reason (dynamic key, config indirection). No call-site text is stored, only the location and the reason.
- `flag_events`: id, flag_id, actor_id, action (ignored, unignored, marked_removed, confirmed_removed), reason text, created_at.
- `provider_tokens`: id, owner_id, provider, encrypted token (pgcrypto, service_role RPCs only), last4, created_at.
- `meta`: single heartbeat row (last_scan_tick_at) so the monitor can tell a stuck queue from an empty one.
- RLS on, owner-scoped SELECT policies; explicit minimal grants to service_role only, never GRANT ALL to anon or authenticated; pgcrypto pinned to public (`create extension if not exists pgcrypto with schema public;`).
- Anonymous scans: owner_id null, claim token cookie (same pattern as project 3); on sign-in the claim attaches the scan and repo to the session.

### Scan pipeline (one tick, 7s budget)

1. Claim: one scan, `FOR UPDATE SKIP LOCKED`. The claim takes queued scans plus any non-terminal scan (cloning, parsing, age, provider) whose heartbeat is older than 10 minutes: a tick killed at the 10s ceiling leaves a stale heartbeat, and the next tick re-claims it and resumes from the stored progress. Every tick updates the heartbeat (`updated_at`) so a live scan is never stolen.
2. Clone (first tick): validate URL again (allowlist, HTTPS, no userinfo/ports/IP literals). There is no DNS re-check after resolution: git resolves DNS itself and pinning the IP is not something git supports, so the allowlist plus the URL-shape rejection is the control. Before cloning, check the repo size: for github.com, the REST API repo size field; for gitlab.com, the project API. If the size is already over the caps, fail fast with the over-caps message and never start the clone. Otherwise `git clone --filter=blob:none` into a temp dir (full history, no blobs until checkout; `--depth 1` is forbidden because age needs history), no `--recurse-submodules`, invoked argv-only via `execFile`, never through a shell. With `blob:none`, blobs download on demand, so the clone itself cannot enforce the cap: after checkout, measure the temp dir with `du` and abort with over-caps before parsing if it is over 100 MB or 10,000 files. Then upload two objects to a private Supabase Storage bucket (service_role only): a git bundle of the history (`git bundle create`, for the age step) and a tarball of the HEAD files (`git archive HEAD`, for the parse step). The local clone is deleted right after the upload. Nothing is assumed to survive in `/tmp` between ticks: Vercel functions are stateless, and a later tick on a cold instance finds no clone.
3. Parse: download the HEAD tarball from Storage into `/tmp`, walk files in a budget-driven loop (as much as fits in ~8s per invocation, not a fixed slice count), `@babel/parser` with TS and JSX plugins, import-verified call shapes per provider, plus env and config detection. The resolver traces hook-return objects and property access, not just direct calls: `const flags = useFlags(); flags.myFlag` and `const { myFlag } = useFlags()` are first-class shapes, with golden fixtures for them. Config-file flags use a recognition rule: a file named `flags.json`, `feature-flags.json`, or `*.flags.json`, or a JSON/YAML file with a top-level `flags` or `featureFlags` object whose values are booleans or rollout objects. Any other JSON key is not a flag. Store flags and references as found.
4. Age: download the git bundle from Storage, unbundle into `/tmp`, then batch the history work: one `git log -S` pass per distinct key (cached, not one process per call site) and one `git blame -w` per file, parsing the blame output for every call site in that file. A flag with no `-S` hit gets created_at null and confidence capped at possible.
5. Provider: if a LaunchDarkly token is connected, fetch flag state and rollout per key from the flag-statuses API, production environment only in v1; if the repo has a ConfigCat config, fetch the public `config.json` with the SDK key the user supplied at scan time (optional field; never stored for anonymous scans, stored encrypted for signed-in users). Without a key, ConfigCat flags show rollout "unknown". Store rollout_pct and rollout_source per flag, plus `rollout_by_env` jsonb for the per-environment values.
6. Finalize: compute the three signals, status, confidence, deletable LOC from AST spans, and the deletion diff. Then carry user state forward: diff the new scan against the previous scan's flags by key+provider, migrate Ignored and marked-Removed state from `repo_flags`, and confirm a marked-removed flag as Removed only when it is absent from the new scan. Delete the Storage objects (bundle and tarball) when the scan finalizes or fails. Set status done. Empty states are three distinct designs, not one: (a) no flags at all: "No flags found in N files scanned" with the next action (check ignore rules, scan another repo); (b) flags found, none stale or deletable: "N flags, all active" with the counts; (c) candidates all uncertain or dynamic: "N candidates need a human look" with the unresolved list. Each shows the files-scanned count. A 0 LOC total on a real repo must read as a result, never as a broken scan.

### Non-functional budgets

- Landing and public report pages: under 2s to first contentful paint on a cold Vercel hit.
- Dashboard flag list: under 1s for 500 flags (one query, no per-row queries).
- Scan tick: 7s wall-clock budget per invocation (under the 10s Hobby ceiling verified in project 3); each tick does as much work as fits in ~8s and stores progress, so a tick that times out resumes, never restarts. A scan whose heartbeat is older than 10 minutes is re-claimed by the next tick.
- Whole scan: under 5 minutes for a repo up to 1,000 files, under 30 minutes up to the 10,000-file cap, excluding queue wait.
- Quotas: anonymous 3 scans per IP per UTC day; signed-in 20 per day. Same pattern as project 3. The IP is the first entry of `x-forwarded-for` as set by the Vercel edge; spoofing is accepted for a free anonymous quota (the worst case is quota evasion, not data loss). Global queue depth is capped at 10 queued scans; past that, new scans are refused with "queue full, try later".
- Clone caps: 100 MB, 10,000 files, one scan claimed per tick (serial queue in v1).

### What breaks first at 10x / 100x

- The scan queue: one scan per tick, serial, is the first bottleneck. At 10x, allow N concurrent scans by claiming N rows per tick; at 100x the queue needs a real worker (Render paid, or a queue service), which is a paid-tier decision, not a code change.
- Supabase free tier: 500 MB database, 1 GB Storage, row limits, and the flags/references tables grow per scan. Old scans need a retention purge (keep the latest scan per repo plus 30 days, purge the rest; built as a pg_cron job in phase-3 slice 4).
- Vercel Hobby CPU: 4 CPU-hours per month. Parsing is CPU-bound; a few large repos eat the budget. The caps and the per-tick budget are the guardrail.
- Provider APIs: LaunchDarkly rate limits per token. Rollout fetching is batched per scan and cached on the flag row, never refetched per page view.

### Third-party exit strategies

- LaunchDarkly / ConfigCat: if a provider API goes away, rollout % shows "unknown" and the code-derived signals still work. No feature depends on a provider.
- Supabase: standard Postgres, `pg_dump` out. Auth is magic-link email; moving providers means re-issuing sessions, not migrating passwords.
- Vercel: plain Next.js, no Vercel-only APIs except the cron trigger, which pg_cron can replace (project 4 already runs pg_cron).
- `@babel/parser`: the walker sits behind a language-adapter interface; acorn or tree-sitter can replace it without touching the pipeline.
- Astryx: pinned versions (see ADR 6); if the beta breaks, the theme module is generated code we own and can vendor.

### ADRs

1. `@babel/parser` over tree-sitter or acorn. It covers JS + TS + JSX with no native binary, which matters on Vercel serverless, and it is the parser FlagLint's ecosystem uses. Acorn is faster but JS-only; the TS compiler API is type-aware but heavy. If flag resolution ever needs type info, the adapter interface lets us add the TS compiler API for that step only.
2. Chunked async scans on Vercel + pg_cron, no Render worker. The 10s Hobby ceiling (verified in project 3) rules out sync scans, and Render free has no background workers and sleeps after 15 idle minutes. Chunked ticks with stored progress fit both free tiers and match the proven project 4 pattern. The one thing project 4 did not have to solve is state between ticks: Vercel `/tmp` does not survive across invocations, so the clone tick persists a git bundle (history) and a HEAD tarball (files) to a private Supabase Storage bucket, and each later tick downloads what it needs.
3. Rollout % from provider APIs for LaunchDarkly and ConfigCat first, Unleash and Flagsmith as hooks. LaunchDarkly has the clearest staleness API and ConfigCat needs no auth, so both are demoable without a second account. Code-only signals still work with no provider connected.
4. Deletable LOC from AST branch spans, shown with its formula, never a silent estimate. A number a developer cannot check by hand is a number they will not trust. Dynamic or unresolved references exclude a flag from the deletable total.
5. Public-URL scans anonymous, private repos via GitHub App later. A paste-URL scan with no signup is what makes the landing page demoable and Show HN postable; OAuth `repo` scope is too broad to ask for, and a GitHub App with Contents Read and Metadata Read on selected repos is the correct private-repo path.
6. Astryx neutral theme, versions pinned, Inter via the font token override. Per the brief: `@astryxdesign/core 0.7.15`, `@astryxdesign/theme-neutral 0.7.14`, `@stylexjs/stylex`, plus `@astryxdesign/cli` as a dev dependency for `theme add`. The two Astryx packages may skew by a minor, so each is pinned to its own verified version, never one shared number. The neutral theme ships Figtree typography, so the Inter override must be verified in the rendered output in phase-1, not assumed from the token edit. Phase-1 and phase-2 must also confirm how the three non-standard pieces are built: the diff viewer, the dense sortable table with filter chips, and code display. If Astryx has no component for them, they are built from Astryx primitives and tokens, and that decision is recorded in phase-2, not discovered in phase-4.

## 0.4 Risk register

| # | Risk | Likelihood | Impact | Mitigation | Owner |
|---|---|---|---|---|---|
| 1 | A false "Deletable" verdict leads a user to delete code that is still needed | Medium | High | Two-signal minimum, three for Deletable; import-verified detection; confidence tiers shown; deletion diff shown before any action; the product never deletes or opens a PR itself; `.flagdebtignore` lets users exclude known-keep flags | Build (phase-3 detection rules) |
| 2 | Dynamic flag keys are invisible to static analysis, so a flag looks unreferenced when it is used | High | High | Unresolved/dynamic references are a first-class list with call sites; any flag touched by one is capped at possible confidence and excluded from the deletable total; the report states the count of unresolved references | Build (phase-3 resolver) |
| 3 | A malicious repo URL leads to SSRF, or a malicious repo executes code during clone | Medium | High | Host allowlist (github.com, gitlab.com), HTTPS only, reject userinfo/ports/IP literals; never `--recurse-submodules` (CVE-2026-111760); git invoked argv-only via `execFile`, never through a shell; never execute anything from a clone; caps enforced by the pre-clone API size check plus a post-checkout `du` measurement that aborts before parsing; clone deleted after the scan, artifacts deleted on finalize | Build (phase-3 clone step) |
| 4 | Git is missing, or `--filter=blob:none` is unsupported, in the Vercel Node runtime | Medium | High | Phase-3 slice 1 starts with a go/no-go spike (git presence, blob-filter support, pg_net trigger) before anything is built on git. Fallback is a GitHub API path: repo tree via the API plus the oldest commit touching each distinct file with a reference (one commits-list call per file, capped at 100 files; beyond that age is "unknown"). Ages from the fallback are labeled "approx", rename detection is unavailable, flags are capped at possible confidence and can never be Deletable. The fallback needs an optional `GITHUB_TOKEN` env var (5,000 requests/hour vs 60 unauthenticated). | Build (phase-3 slice 1) |
| 5 | The 10s Hobby ceiling plus a serial queue makes scans too slow or too few | Medium | Medium | 7s tick budget with resume-from-progress; caps keep scans small; one scan per tick in v1, N per tick later; the queue heartbeat row makes a stuck queue visible | Build (phase-3 queue) |
| 6 | Demand is unvalidated: nobody may want a standalone flag scanner when their platform already shows staleness | Medium | Medium | The wedge is vendor-neutral deletion evidence, not staleness display; record as a risk, not an assumption; launch measures it (scan_started to report_viewed conversion); Abdullah can share the landing with 2-3 dev friends before launch | Abdullah + launch |
| 7 | Secrets committed in a scanned repo leak through stored findings or logs | Medium | High | Never persist secret values; redact matched lines that look like secrets; store file and line only; warn the user to rotate; provider tokens are encrypted and never logged | Build (phase-3 storage) |
| 8 | Astryx 0.x beta breaks across a minor version | Medium | Medium | Exact versions pinned in package.json; theme module is generated code we own; phase-1 verifies the rendered output, and a break is caught by the build, not by users | Build (phase-1/2) |
| 9 | LaunchDarkly or ConfigCat changes its API and rollout fetching breaks | Low | Low | Rollout is one signal of three; a failed provider fetch degrades to "unknown", never fails the scan; the adapter interface isolates the change to one file | Build (phase-3 provider) |

## 0.5 Marketing & launch plan

### Positioning

For developers whose repos carry flags nobody dares delete. The platforms tell you a flag is stale; this tool tells you what deleting it removes, line by line, with the evidence. Free, vendor-neutral, no signup for the first scan. One line: "Find the flags your codebase forgot, and count what deleting them saves."

### Landing page outline

1. Hero: the one-line pitch, repo URL paste box, the three-line data contract above the button, "no signup" stated plainly.
2. Sample scan: a real report from the demo repo, embedded, so the value is visible before any input.
3. How it works: paste URL, scan runs, report shows flags with age, rollout, call sites, deletable LOC, and the diff. Three steps, no more.
4. What it never does: never stores source files, never writes to the repo, never auto-deletes. The privacy promise in plain language, including that the deletion diff is stored for your flags and anonymous scans purge after 30 days.
5. The number, honestly: "X flags, Y lines deletable" from the demo repo, with a link to the full report.
6. Free note, CTA to scan, footer with docs, privacy, terms.

### Analytics events plan (instrumented as built, never retrofitted)

Tool: Plausible (cookieless, no consent banner), wired in phase-4. If Abdullah prefers PostHog, the event names stay the same. Events: `scan_started`, `scan_completed` (flag count, stale count, deletable LOC as aggregates, never repo names or code), `report_viewed`, `export_clicked`, `signup_completed`, plus landing pageviews and referrers. No keystrokes, no file contents, no repo URLs, no per-user paths.

### Launch checklist (in order)

1. Demo scan of a real repo live on the site with its public report link.
2. README quickstart under 5 minutes, with the sample scan linked.
3. Terms + Privacy written against the real data inventory (findings only, clone deleted, secrets never stored) and human-reviewed.
4. Show HN post (Tue-Thu, 8-11am US Eastern), plain title, hand-written first comment, Abdullah answers every comment.
5. dev.to build-in-public walkthrough with the demo report linked.
6. Two niche Reddit subs, problem first, authorship disclosed.
7. UptimeRobot monitor on the landing page and `/api/health`.
8. Changelog started at 0.1.0.

## 0.6 Delivery plan

Phase map (one phase per day, Nov 14-21):

- Sat Nov 14: phase-0, this plan. Gate.
- Sun Nov 15: phase-1, design decisions (Astryx theme pick, Inter override verified in render, token overrides, flows). Gate.
- Mon Nov 16: phase-2, design system (Astryx components wired, every state verified against the reference). Gate.
- Tue Nov 17: design-copy (every screen specced, long tail included). Gate.
- Wed Nov 18: phase-3, backend. Slices in order: (1) scaffold + schema + scan queue + tick. Slice 1 starts with a go/no-go spike before anything is built on git: git presence and `--filter=blob:none` support in the Vercel Node runtime, and the pg_cron via pg_net trigger firing end to end (project 4's pg_cron is still unconfirmed, so this is verified here; fallback is an external pinger on the free tier). If git is absent, the GitHub API fallback path becomes primary with the limits in risk 4. (2) detection engine (parser, resolver, age, LOC, diff) with golden fixtures, including `useFlags()` property access and destructuring shapes; every generated diff passes `git apply --check` in tests. (3) provider rollout (LaunchDarkly flag-statuses API per environment, production only; ConfigCat config.json with a user-supplied SDK key) and encrypted token RPCs; the "launched after 7+ days serving one variation" claim is verified against the real API in this slice. (4) dashboard API, retention purge pg_cron job, seed, docs. Done when every endpoint is tested with no frontend dependency.
- Thu Nov 19: phase-4, frontend page by page from DESIGN-COPY.md, real backend data, analytics events instrumented as built.
- Fri Nov 20: phase-5, polish + QA (375/768/1440, focus rings, contrast, screenshot every state).
- Sat Nov 21: phase-6, launch readiness (env vars, backups, rollback plan, monitor, landing copy, OG image, README, changelog, Terms + Privacy, export/delete verified). Launch itself is Abdullah's decision.

Flex order if time slips: CSV export first, then provider rollout (LaunchDarkly), then the ConfigCat adapter. The detection engine and the deletable-LOC math are never cut: without them there is no product.

### Assumptions log

- Vercel Hobby still has a 10s function ceiling (verified in project 3, Oct 2026). If Vercel raises it, the tick budget can grow, but the chunked design stays.
- Git exists in the Vercel Node runtime and supports `--filter=blob:none`. Verified or replaced in phase-3 slice 1, never assumed.
- A public repo URL is enough for the launch demo; no private-repo support is promised for v1.
- An optional `GITHUB_TOKEN` env var (read-only, public data) raises GitHub API limits from 60 to 5,000 requests/hour for the pre-clone size check and the no-git fallback path. It is documented in `.env.example` and phase-6 env vars.
- Abdullah can provide a LaunchDarkly token for the rollout demo, or the demo leans on ConfigCat's public config. See Decisions needed.
- Astryx versions in the brief (core 0.7.15, theme-neutral 0.7.14) are still the latest verified at phase-1; if a newer minor is out, phase-1 re-verifies before pinning.

## Decisions needed (Abdullah answers before approval)

1. Demo repo for the launch scan: which real repo should the public sample report scan? His own flag-debt-collector repo has few flags; a bigger public JS/TS repo with known flags would show a better number. His pick, or a suggestion is welcome.
2. LaunchDarkly demo: does he have a LaunchDarkly account and a token to demo rollout %, or should the demo lean on ConfigCat's public config only? Without a token, rollout % shows "unknown" on the demo.
3. Private repos: is the GitHub App (Contents Read, Metadata Read, selected repos) a v1 must-have, or is public-URL-only acceptable for launch with private repos as the first post-launch item?
4. Scan caps: 100 MB clone and 10,000 files. Too generous for the free tier, or fine? Lower caps mean fewer repos scan at all.
5. Staleness thresholds: 90 days for "old and untouched" and for the rollout-settled window. Shorter (60 days) would surface more candidates; longer (180) fewer, safer ones. Keep 90?
6. Analytics: Plausible (needs an account, cookieless, no banner) or PostHog free tier (funnels, needs cookieless config) or no analytics in v1? The event names are fixed either way.
7. CSV export in v1: keep it, or cut it to protect the Nov 21 deadline? It is the first flex item if time slips.
