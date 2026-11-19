# DESIGN-COPY.md: Feature Flag Debt Collector (project 5)

Design blueprint. Status: approved by Abdullah 2026-11-19 19:17 PKT ("Approved — keep the defaults"). All 10 gate notes in section 18 accepted as-is.
Every screen is specced against the approved phase-2 system (DESIGN.md,
Astryx neutral 0.7.16, dark-only, Inter via the variant B typography
config). No product screen gets built before its blueprint entry exists.
Phase-4 builds page by page from this file, in the order below.

## 0. How to read this file

Each screen entry names its route, its purpose in one line, its layout
(top to bottom), the exact Astryx components it uses, the tokens that
matter, every state it can be in, and the edge cases phase-4 must handle.
Shared patterns live in sections 1-3 so screen entries do not repeat them.
The states matrix in section 17 is the phase-5 checklist: a screen is
not done until every cell in its row has been seen.

Rules that hold on every screen:

- App code uses Astryx components and semantic tokens only. No hardcoded
  hex or pixel values, no one-sided accent border, no gradients, no
  shadows at rest (the modal is the only shadowed surface).
- Inter for body and headings, loaded via `next/font`. Flag keys, file
  paths, and LOC counts render in the code face at body size.
- Status is never color alone: every status Badge carries shape and
  text. Watch and Ignored Badges are text-only (the 0.7.16 icon registry
  has no eye and no pause; phase-2 finding, accepted at the gate).
- Numbers show their proof next to them. The deletable total sums
  definite and likely flags with a known winning value only, and the
  page says so next to the number. "Up to N" lines are never added to
  the headline total.
- Error messages name the cause and the next action, never just
  "failed".
- Copy is plain and specific. Short sentences. No adjectives doing the
  work of evidence.

Modern-web-guidance checks done for this blueprint (guides retrieved
2026-11-19): `responsive-table`, `sortable-table`, `tabs`, `dialog`,
`light-dismiss-a-dialog`. Where a guide and a DESIGN.md decision
disagree, the decision stands and the check is recorded in the screen
entry. The flag table keeps the DESIGN.md horizontal-scroll rule at
375px (key column pinned) instead of the guide's stacked-card
transform, because the table has six sortable columns and the stacked
form would hide the sort state. The table wrapper still follows the
guide: `tabindex="0"`, `role="region"`, named by the table caption,
sticky header row, and a `min-inline-size` so columns never collapse.

## 1. Shared shell

Two shells, no more.

### 1.1 Signed-in shell (dashboard, flag detail, repos, settings)

AppShell with TopNav and SideNav, the contained example from the
phase-2 gallery, built out. TopNav heading is the wordmark "Flag Debt
Collector" in semibold Text, linking to `/dashboard`. TopNav items:
Dashboard, Repos, Settings. The current page is marked selected
(`isSelected`) and reads as selected from text and position, not color
alone. SideNav sections: "Flags" (Dashboard, Repos), "Account"
(Settings). Breadcrumbs sit under the TopNav on every signed-in page:
the first crumb is the parent page, the last crumb is the current page
(`isCurrent`). Content width 960, padding 4, VStack gap 6, the same
rhythm as the gallery page.

Signed-out visitors who reach a signed-in route are redirected to
`/login` (307). The redirect preserves the destination: after sign-in
the user lands on the page they asked for. No app chrome ever flashes
for a signed-out visitor.

### 1.2 Minimal top bar (landing, scan page, login, docs, terms, privacy)

A slim bar with the wordmark on the left and one link on the right:
"Sign in" on the landing and scan pages, "Back to the scan tool" on
login. No SideNav, no app chrome. A first-time visitor meets the tool,
not the product chrome. The footer on public pages carries Docs,
Privacy, Terms, and the GitHub repo link.

### 1.3 Toasts

One Toast component, bottom of the viewport, live region. Every
mutation that succeeds shows one Toast with the result in plain words
("Flag ignored. new_checkout_enabled left the deletable total.",
"Scan 2026-11-18-a1b2 deleted."). Every mutation that fails shows one
Toast with the cause and the fix, and the page stays where it was.
Toasts never stack past one: a new Toast replaces the old one.

## 2. Shared patterns

### 2.1 Banners

Banner, four statuses. Banner copy names the cause and the next action.

- Info: "Rescanning, updated X ago" while a rescan runs. The dashboard
  keeps the old data under it.
- Warning: "Scan queue full. 10 scans are queued. Try again in a few
  minutes, or wait for a slot to open."
- Error: "LaunchDarkly token invalid. Rollout reads unknown (token
  invalid). Paste a new token in Settings, then test the connection."
- Success: used once, on the report page, when a scan finishes while
  the visitor is watching ("Scan complete. 6 flags found, 2 deletable.").

Banners are dismissable where the gallery shows them dismissable. The
rescan Banner is not dismissable: it describes live state, and hiding
it would hide that the data is stale.

### 2.2 Skeletons

Every async view renders its skeleton first. The flag table skeleton
is three Skeleton rows at table density, inside the same Card the table
will fill, so the layout does not shift when the data arrives. The
flag detail skeleton is a Skeleton heading, a Skeleton Badge row, and
three Skeleton lines for the call-site list. The scan progress page
never shows a bare Spinner: it shows the current step, the queue
position, and elapsed time (section 5).

### 2.3 Tables

All tables are Astryx Table with the three plugins from the gallery:
`useTableSortable`, `useTableSelection`, `useTablePagination`. Density
comes from a SegmentedControl (Compact, Balanced, Spacious), default
balanced, persisted per user (localStorage for anonymous visitors, the
account for signed-in users). Sorting follows the sortable-table guide:
a `<button>` inside each sortable `<th>`, `aria-sort` on the sorted
`<th>` only, never `aria-sort="none"`, one visually hidden
`role="status"` element announcing "Sorted by X, ascending, N rows".
Sorting reorders the existing rows; it never rebuilds the table, so
focus and row selection survive a sort. Numbers sort as numbers, using
the raw value (age in days, LOC as a count) even when the displayed
text is formatted ("1,204"). Unknown rollout sorts after known values.

Filter chips sit above every list table: a neutral Badge naming the
filter plus a small ghost icon-only Button to dismiss it, and a "Clear
all" ghost Button when any filter is applied. When no filters are
applied the row reads "No filters applied." in supporting Text. Every
list shows "Showing N of M" under the table, and the count updates when
filters change.

Pagination renders only past one page (phase-2 finding). Page size is
25 rows on the dashboard and the report, 10 on the repos list. The
"Showing N of M" text stays dynamic at one page.

At 375px the table scrolls horizontally inside its Card with the flag
key column pinned, per DESIGN.md section 8. Columns never squeeze
below legibility. The wrapper carries `tabindex="0"` and
`role="region"` and is named by the table caption, so keyboard users
can scroll it.

### 2.4 Dialogs

Two components, two jobs. Dialog (purpose "form") for the ignore flow,
which takes input. AlertDialog for one-click destructive confirmations
(delete scan, delete repo). The typed-DELETE account flow cannot live
inside AlertDialog (no text-input slot, phase-2 finding), so it is
built from primitives in section 14.3.

Dialog behavior, checked against the dialog guide: Esc closes, focus
returns to the invoker, focus starts on the safe action (Cancel) in a
destructive confirmation, every dialog is named by its heading. A
non-destructive dialog (ignore) light-dismisses: a click on the
backdrop closes it. A destructive confirmation does not light-dismiss:
a stray click must never discard a typed confirmation, so only Esc and
the Cancel button close it. Esc while text is typed keeps the dialog
open (the dirty-form guard in section 14.3); Esc with an empty field
closes it. The page never scrolls behind an open dialog.

### 2.5 Empty states

Three distinct designs, from the gallery, never one generic frame.

- No flags at all: "No flags found in N files scanned." Next action:
  check the ignore rules, scan another repo. Primary action: "Scan a
  repo".
- Flags found, none stale or deletable: "N flags, all active." The
  counts are shown. Primary action: "Rescan repo".
- Candidates all uncertain or dynamic: "N candidates need a human
  look." The unresolved list is named. Primary action: "Review
  candidates".

A 0 LOC total on a real repo reads as a result, never as a broken
scan. The page says "0 lines deletable" with the reason ("every flag
is active" or "winning values unknown") beside it.

### 2.6 Error states

A failed scan always names the cause and the next action (PLAN 0.1
taxonomy). The seven causes and their copy are fixed text, reused on
the landing page, the scan page, and the report page:

- Private repo: "This repo is private. Public repos only in v1."
  Next action: sign in and wait for the GitHub App, or scan a public
  repo.
- Not found: "No repo at that URL. Check the owner and name." Next
  action: fix the URL and retry.
- Non-allowlisted host: "Only github.com and gitlab.com repos are
  supported." Next action: use a supported host.
- No JS/TS files: "No JavaScript or TypeScript files found in this
  repo." Next action: scan a JS/TS repo.
- Over caps: "This repo is over the scan caps (100 MB, 10,000 files)."
  Next action: narrow the scan later; v1 cannot split a repo.
- Clone timeout: "The clone timed out. The repo may be too large or
  the host slow." Next action: retry, or scan a smaller repo.
- Anonymous quota used: "You have used 3 anonymous scans today.
  Quota resets at midnight UTC." Next action: sign in for 20 scans
  a day.

A page-level error (the dashboard cannot reach the database, the
report id does not exist) renders the error screen in section 15.2, not
a blank page and not a 500 with no copy.

## 3. Routes

| Route | Screen | Shell |
|---|---|---|
| `/` | Landing | Minimal top bar |
| `/login` | Login | Minimal top bar |
| `/auth/callback` | Magic-link callback (no screen: exchanges the code, attaches the claim cookie, redirects) | None |
| `/scans/[id]` | Scan progress while running, public report when done | Minimal top bar |
| `/dashboard` | Dashboard (signed-in flag table) | Signed-in shell |
| `/dashboard/flags/[flagId]` | Flag detail | Signed-in shell |
| `/repos` | Repos list | Signed-in shell |
| `/settings` | Settings | Signed-in shell |
| `/docs` | Docs | Minimal top bar |
| `/terms` | Terms | Minimal top bar |
| `/privacy` | Privacy | Minimal top bar |

The scan page and the report page share one route by design: the
progress page shows the report URL with a copy button from the start,
and when the scan finishes the same URL shows the report. Closing the
tab loses nothing. The flag detail route takes the flag row id, not
the flag key: keys repeat across scans and providers, ids do not.

## 4. Landing (`/`)

Purpose: the pitch, the paste box, and the data contract above the
fold, then a real sample report so the value is visible before any
input.

Layout, top to bottom:

1. Minimal top bar. Right link: "Sign in".
2. Hero. Heading level 1, the one-line pitch: "Find the flags your
   codebase forgot, and count what deleting them saves." Supporting
   Text, one sentence: what the scan reads and what it never touches,
   in plain words.
3. Paste box. TextInput labelled "Repo URL", placeholder
   `https://github.com/acme/shop-web`, description "Public repos only
   in v1." Primary Button "Scan this repo". The three-line data
   contract sits directly above the button, as Text in the supporting
   size:
   - "Reads flag definitions and references via read-only access."
   - "Stores flag name, age, rollout %, file paths, line numbers,
     LOC counts, and the deletion diff for your flags. Never stores
     source files, never writes to the repo."
   - "Repos up to 100 MB and 10,000 files. The full clone is
     downloaded, scanned, then deleted."
   The contract is visible before the button, not behind a link.
4. Sample scan. Heading level 2: "A real scan, before you paste
   anything." The demo repo report embedded: the headline total ("X
   flags, Y lines deletable") with the link "See the full report",
   then the top three flag rows (key in Code, status Badge,
   confidence Badge, age, deletable LOC) in the same table styling as
   the dashboard. No signup is needed to open the full report.
5. How it works. Heading level 2. Three steps, numbered, no more:
   "1. Paste a public repo URL." "2. The scan runs: clone, parse,
   age, provider." "3. The report shows every flag with age,
   rollout, call sites, deletable LOC, and the diff." Each step is
   one sentence.
6. What it never does. Heading level 2. Four lines, each one sentence:
   never stores source files, never writes to the repo, never
   auto-deletes, anonymous scans purge after 30 days.
7. The number, honestly. Heading level 2. "X flags, Y lines
   deletable" from the demo repo, with the link to the full report.
   The number is whatever the demo repo actually yields.
8. Free note and CTA. "Free to use. No signup for the first scan."
   Primary Button "Scan a repo" (scrolls to the paste box).
9. Footer. Docs, Privacy, Terms, GitHub repo link.

States:

- Default: paste box empty, button enabled. The button stays enabled
  with an empty field; submitting an empty field shows the inline
  error "Paste a repo URL first." and focuses the field.
- Invalid URL (not a URL, wrong host, private-looking path): inline
  error under the field naming the problem ("Only github.com and
  gitlab.com repos are supported." or "That does not look like a repo
  URL. Use https://github.com/owner/repo."). The field keeps the
  typed text. No Toast: the error belongs to the field.
- Queue full: the scan starts, then the scan page shows the queue-full
  Banner. The landing page itself does not block on queue state.
- Anonymous quota used: the scan page shows the quota error (section
  2.6). The landing page shows the same copy inline under the field
  when the API returns it, so the visitor does not travel to a second
  page to learn it.

Analytics: landing pageview, referrer. `scan_started` fires when the
button starts a scan (aggregates only, never the repo URL).

Responsive: at 375px the paste box and button stack full width, the
sample rows become the horizontally scrolling table from section 2.3,
the three steps stack vertically. At 768px the hero and paste box stay
single column; the sample table keeps all six columns. At 1440px the
content width stays 960, centered.

## 5. Scan progress (`/scans/[id]`, while running)

Purpose: show the scan moving, not a spinner. The visitor can close
the tab at any point: the report URL is on the page from the start.

Layout, top to bottom:

1. Minimal top bar. Right link: "Sign in".
2. Heading level 1: the repo name in Code, for example
   `acme/shop-web`. Supporting Text: "Scan 2026-11-18-a1b2", the scan
   id in Code.
3. Progress. ProgressBar labelled with the current step, value label
   showing percent where the step reports one. Under it, a Text line
   with the step name, the queue position, and elapsed time, updated
   as the scan polls: "Parsing files. Queue position 2. Elapsed
   1m 12s." Steps in order: queued, cloning, parsing, age, provider,
   done, failed. Each step shows its own line when active; finished
   steps read as plain Text with a check shape, never as a spinner.
4. Report URL. A Card with the report URL in Code and a secondary
   Button "Copy link". Copying shows the Toast "Report link copied."
   The URL is the page URL itself.
5. What happens next. Supporting Text: "When the scan finishes, this
   page shows the report. Anonymous scans purge after 30 days."

States:

- Queued: ProgressBar at 0, "Queued. Queue position N." No step is
  active yet. The report URL is already shown.
- Running: the current step, queue position (hidden once the scan
  starts), elapsed time. The page polls the scan status; it does not
  reload.
- Failed: the Banner error with the fixed copy from section 2.6, the
  cause and the next action. Below it, the same paste box from the
  landing page (TextInput + primary Button "Scan again") so the
  visitor can retry without going back. The failed scan id stays on
  the page for reference.
- Done: the page becomes the report (section 6). A success Banner
  shows once when the visitor is watching: "Scan complete. 6 flags
  found, 2 deletable." It does not show on a later visit to the same
  URL.

Analytics: `scan_started` (from the landing page), `scan_completed`
(flag count, stale count, deletable LOC as aggregates, never repo
names or code).

Responsive: single column at all widths. The ProgressBar is full
width. At 375px the report URL wraps and the copy button sits below
it, full width.

## 6. Public report (`/scans/[id]`, when done)

Purpose: the shared link. Anyone with the URL reads the report, no
signup. The owner (claim cookie or signed-in owner) gets the extra
actions in section 6.5.

Layout, top to bottom:

1. Minimal top bar. Right link: "Sign in" (or "Dashboard" when the
   visitor is signed in).
2. Heading level 1: the repo name in Code. Supporting Text: "Scanned
   2026-11-18, 09:12 PKT. 10,000 files, 41 call sites." The counts
   are real: files scanned and call sites found.
3. Headline total. Heading level 2, plain Text: "2 flags deletable,
   2,066 lines." Under it, supporting Text stating the rule: "Counts
   definite and likely flags with a known winning value only. 341
   more lines are up to N (winning value unknown)." The second
   sentence appears only when such lines exist.
4. Flag table. The same Table as the dashboard (section 2.3):
   columns Flag (Code), Status (Badge), Confidence (plain Badge),
   Age (days, tabular numbers), Rollout, Reachable, Deletable LOC
   (tabular numbers, "up to N" where the winning value is unknown).
   Rollout reads as a number with a percent sign, "n/a" for env and
   config flags (on or off only), "unknown (no token)" when no provider
   is connected, and "unknown (token invalid)" when the token fails.
   Default sort: status rank (Deletable, Stale, Watch, Active,
   Ignored, Removed), then deletable LOC descending, then age
   descending. The sort formula is printed under the heading in
   supporting Text: "Sorted by status, then deletable lines, then
   age." Any column sort replaces it, and the `role="status"`
   announcement names the new sort. Density SegmentedControl,
   filter chips with clear-all, "Showing N of M", pagination past
   one page. A row opens the flag detail page (section 8) when the
   visitor is the owner; for a public visitor the row expands inline
   to show the call sites and the diff (no separate page, no sign-in
   wall).
5. Empty states. The three distinct designs from section 2.5, chosen
   by the result: no flags at all, none stale, candidates need a
   human look. Each shows the files-scanned count.
6. Unresolved references. When the scan found any, a section after
   the table: Heading level 2 "Unresolved references (3)". Each row
   names the file path in Code, the line, and the reason ("dynamic
   key", "config indirection"). No call-site text is stored or shown,
   only the location and the reason. Supporting Text: "These
   references could not be resolved to a flag key. Any flag they
   touch is capped at possible confidence and excluded from the
   deletable total."
7. Applied ignore rules. When a `.flagdebtignore` file applied, a
   section listing every rule and how many flags or paths it excluded:
   "Ignored 2 flags by key, 14 paths by glob." The rules are shown
   as Code lines. A paste-URL visitor sees the rules that applied and
   a link: "Sign in to add your own rules."
8. Footer note. Supporting Text: "Anonymous scans purge after 30
   days. The deletion diff is stored for your flags; source files
   are never stored."

Owner-only actions (section 6.5): a signed-in owner or the claim
cookie holder sees a secondary Button "Export CSV" and a destructive
Button "Delete this scan" in the heading row. Export carries flag
names, ages, rollout, call-site counts, and LOC, never source code.
Delete opens the AlertDialog in section 14. A public visitor sees
neither button.

States:

- Loading: the table skeleton (section 2.2) inside the same Card.
- No flags: empty state (a). None stale: empty state (b).
  Candidates uncertain: empty state (c).
- Scan id does not exist: the error screen (section 15.2) with "No
  scan at this link. Check the URL." and a link to the landing page.
- Scan still running: the progress view (section 5), not the report.

Analytics: `report_viewed` on load. `export_clicked` when the owner
exports (aggregates only).

Responsive: the table rule from section 2.3 at 375px. The headline
total stays one line at body size, never oversized for decoration.
The owner buttons stack below the heading at 375px.

## 7. Dashboard (`/dashboard`)

Purpose: the signed-in flag table for the selected repo, with the
removal counts over time. This is the core loop: scan, triage, delete,
count.

Layout, top to bottom:

1. Signed-in shell. Breadcrumbs: "Repos / acme/shop-web".
2. Heading level 1: the repo name in Code. Supporting Text: "Last
   scan 2026-11-18, 09:12 PKT." Rescans are on demand in v1: there is
   no scheduled rescan, and no "Next rescan" line (PLAN 0.2 lists
   scheduled rescans as a design hook, not a v1 feature).
3. Counts row. Three Cards in a row (stacked at 375px), each with a
   Heading level 2 number and supporting Text: "Flags removed" (count
   over time), "Lines deleted" (count over time), "Deletable now"
   (the headline total from section 6). The counts are plain
   cumulative numbers, never a chart, never a blended score, never a
   grade. The two "over time" counts grow as removals are confirmed;
   there is no separate counts table.
4. Rescan Banner. While a rescan runs: info Banner "Rescanning,
   updated X ago." The table below keeps the old data until the new
   results arrive. The Banner is not dismissable.
5. Actions row. Primary Button "Rescan repo". Secondary Button
   "Export CSV". SegmentedControl for density (Compact, Balanced,
   Spacious), default balanced, persisted.
6. Filter chips row. Status filter (Selector: All, Deletable, Stale,
   Watch, Active, Ignored, Removed), confidence filter (Selector:
   All, definite, likely, possible, uncertain), and a TextInput
   "Filter by flag key". Each applied filter becomes a removable
   chip; "Clear all" removes them all. The repo filter is not a chip
   here: the dashboard is already scoped to one repo, and switching
   repos happens on the repos list.
7. Flag table. Columns: Flag (Code), Status (Badge), Confidence
   (plain Badge), Age, Rollout, Reachable, Deletable LOC. Rollout
   reads as a number with a percent sign, "n/a" for env and config
   flags, "unknown (no token)" when no provider is connected, and
   "unknown (token invalid)" when the token fails. Default
   sort: status rank, then deletable LOC, then age, with the formula
   printed in supporting Text above the table. Row actions, on hover
   and on focus, in the last column: "Ignore" (ghost Button) and a
   row link to the flag detail page. Ignored flags stay visible under
   the Ignored filter and are excluded from the deletable total; the
   total line says so. Removed flags show the key struck through.
   "Showing N of M" under the table. Pagination past one page.
8. Kill-switch cap note. When a flag is capped at Stale by the
   kill-switch rule (provider-marked non-temporary, or a key matching
   the kill-switch name list: `kill`, `killswitch`, `emergency`,
   `maintenance`, `circuit-breaker`), the row shows supporting Text
   under the status Badge: "Capped at Stale: kill switch." The
   override lives on the flag detail page (section 8).

States:

- Loading: table skeleton (section 2.2).
- No repos yet (signed-in user with no saved repo): EmptyState "No
  repos yet." Description: "Scan a public repo to see its flags
  here." Primary action "Scan a repo" (goes to the landing page
  paste box). This is the first-run state for a new account.
- Repo with no flags: empty state (a). None stale: empty state (b).
  Candidates uncertain: empty state (c).
- Rescan running: Banner plus old data (section 7.4). The Rescan
  button is disabled while a rescan runs, with disabled Text "Rescan
  in progress".
- Rescan of a repo that is now private: the private-repo error from
  section 2.6, with the GitHub App note, shown as an error Banner
  above the old data. The old data stays readable.
- Token invalid: error Banner (section 2.1) above the table. Rollout
  reads "unknown (token invalid)" on every row.
- Export with zero flags: the CSV exports the headers and a note row,
  never an empty file that looks broken. Toast: "Exported 0 flags."
- Database unreachable: the error screen (section 15.2), not a blank
  table.

Analytics: `export_clicked` on CSV export. `scan_started` on Rescan.

Responsive: counts row stacks at 375px. The table scrolls
horizontally with the key column pinned. Filter controls stack full
width at 375px. Touch targets are at least 44px.

## 8. Flag detail (`/dashboard/flags/[flagId]`)

Purpose: the evidence for one flag, everything a developer needs to
decide whether to delete it. One flag, one page, no grade.

Layout, top to bottom:

1. Signed-in shell. Breadcrumbs: "Repos / acme/shop-web / Scan
   2026-11-18-a1b2 / new_checkout_enabled".
2. Heading level 1: the flag key in Code. Beside it: the status Badge
   and the confidence Badge. When the status is Removed, the key
   renders struck through. Supporting Text under the heading: the
   confidence reason in one sentence, for example "Definite: 3
   signals, import-verified, literal keys." The reason is always
   visible here, never hidden behind a click.
3. Signals. A Card listing the three staleness signals with their
   state (met or not met) and the evidence for each:
   - "Settled rollout: 100% now in production (LaunchDarkly)." or
     "Settled rollout: not met. Rollout is 25%."
   - "Old and untouched: created 412 days ago, no call-site change
     in 411 days."
   - "Narrow or quiet: 3 production call sites." or "Narrow or
     quiet: references only in tests."
   Env and config flags show the cap instead of the first signal:
   "Rollout signal does not apply: env flags are on or off. Capped
   at Stale." Kill-switch flags show: "Capped at Stale: kill switch
   (provider-marked non-temporary, or key matches the kill-switch
   name list: kill, killswitch, emergency, maintenance,
   circuit-breaker)." with a secondary Button
   "Override cap" that opens a Dialog recording the override as an
   event.
4. LOC formula. A Card with the formula printed in full, so the
   number can be checked by hand: "Deletable LOC = lines in the
   losing branch + the guard lines + the flag definition line, from
   AST node spans. Known winning value: true. 1,204 lines." Two
   rules from the supported-shapes table apply here and on the row:
   a combined condition (`flag && isAdmin`) counts only the lines
   guarded solely by the flag, and when the flag is one operand of a
   wider condition the LOC reads "up to N" with the note "the other
   operand still guards the code"; "up to N" for a known winning
   value is the max over the supported shapes, never a sum across
   branches. When the winning value is unknown, the Card reads: "Up
   to 1,204 lines. The winning value is unknown, so no diff is
   shown. Pick the winning value below to compute the diff."
   followed by a Selector ("Winning value: true / false") and a
   primary Button "Compute diff". After the pick, the diff and LOC
   compute and the Card updates.
5. TabList. Four tabs, single row, scrollable when they do not fit,
   selection follows focus (the panels are instant, no fetch cost),
   selected tab marked by underline plus `aria-selected`, never
   color alone:
   - "Call sites": grouped by file, production first, then tests.
     Each file row: file path in Code, call-site count, and the line
     numbers. Production and test call sites are split under two
     subheadings ("Production (3)", "Tests (1)"). A file with no
     production call site reads "tests only".
   - "History": the `flag_events` timeline, newest first. Each event:
     date, action, actor, reason text. The actions are the four in
     PLAN 0.3 (ignored, unignored, marked_removed, confirmed_removed)
     plus two this blueprint adds: `reopened` (a user reopened a
     Removed flag) and `reappeared` (a marked-removed flag was found
     again by a rescan, returning it to Active). The scan events are
     there too: "Added in commit a1b2c3d, 2025-09-30", "Rollout
     reached 100% in production, 2026-02-14", "Flagged deletable by
     scan 2026-11-18-a1b2".
   - "Signals": the same three signals as section 8.3, repeated
     here for the tab reader, with the per-signal evidence.
   - "Diff": the deletion diff viewer (section 8.6).
   The tab panels share one grid cell so hidden panels leave no empty
   strip. Panel padding lives on a child wrapper inside the panel.
6. Diff viewer. CodeBlock, `isDiff` over `language="plaintext"`,
   line numbers on, copy button in the header, header naming the
   file. Added lines read green, removed lines red, context lines
   plain. The diff is the unified diff text, never applied
   automatically, never a PR. Every generated diff passed
   `git apply --check` in phase-3 tests before it was stored; the
   page does not re-check it. When the flag is outside the supported
   code shapes, there is no diff: the tab reads "No diff for this
   flag. The call sites are listed under Call sites." and the flag
   is capped at possible confidence. When the winning value is
   unknown, the tab shows both branches, states the assumption
   needed, and links to the winning-value picker in section 8.4.
7. Unresolved references for this flag. When any exist, their own
   section after the TabList: Heading level 2 "Unresolved references
   (2)". Each row: file path in Code, line, reason. Supporting Text:
   "This flag is capped at possible confidence and excluded from the
   deletable total because of these references."
8. Actions row. Secondary Button "Ignore flag" (opens the ignore
   Dialog, section 14.2). When the flag is already Ignored, the button
   reads "Un-ignore flag" and opens a confirmation Dialog with the
   reason recorded. Secondary Button "Mark removed" (records the
   intent; the next rescan confirms it). When the flag is marked
   removed, the button is disabled with disabled Text "Removal
   pending next rescan". When the flag is Removed, the actions row
   reads "Removed and confirmed by scan 2026-11-20-c3d4." with a
   secondary Button "Reopen flag" (records a `reopened` event; the
   flag returns to Active on the next scan if it reappears, and a
   `reappeared` event is recorded if it is found again).

States:

- Loading: skeleton heading, Badge row, three Skeleton lines.
- Flag not found: the error screen (section 15.2).
- Unresolved reference present: confidence capped at possible, the
  flag excluded from the deletable total, the section in 8.7 shown.
- Winning value unknown: no diff, both branches shown, picker in
  8.4.
- Kill-switch cap: section 8.3 shows the cap and the override Button.
- Rescan in progress: the info Banner from section 2.1 above the
  heading, the old data kept.

Responsive: the TabList scrolls horizontally at 375px, one row, never
wraps. The actions row stacks full width. The diff viewer scrolls
horizontally inside its Card.

## 9. Repos list (`/repos`)

Purpose: the signed-in user's saved repos, with their latest scan and
a way to rescan or remove each one.

Layout, top to bottom:

1. Signed-in shell. Breadcrumbs: "Repos".
2. Heading level 1: "Repos". Supporting Text: "N repos saved."
3. Actions row. Primary Button "Scan a repo" (goes to the landing
   page paste box). The paste box itself is not duplicated here: the
   landing page owns it.
4. Repos table. Columns: Repo (Code, linking to `/dashboard` for
   that repo), Last scan (date and time, or "Never scanned"),
   Flags (count), Deletable (count and LOC), Status (Badge of the
   latest scan: done, running, failed), Actions (ghost Buttons:
   "Rescan", "Delete"). Sorting on Repo, Last scan, Deletable. Page
   size 10. "Showing N of M" under the table.
5. Empty state. No repos: EmptyState "No repos yet." Description:
   "Scan a public repo to see its flags here." Primary action "Scan
   a repo".

States:

- Loading: table skeleton.
- A repo whose latest scan failed: the Status cell reads "Failed"
   with the cause in supporting Text under it ("Clone timed out."),
   and the Rescan Button is the next action.
- A repo with a scan running: the Status cell reads "Running" with
   the step, and the Rescan Button is disabled.
- A repo deleted while viewing (from another tab or device): the
  error screen (section 15.2) with "That repo no longer exists." and
  a link back to the repos list.
- Delete: the AlertDialog in section 14 ("Delete this repo?").

Responsive: the table scrolls horizontally at 375px with the repo
column pinned. The actions row stacks.

## 10. Settings (`/settings`)

Purpose: provider tokens, scan defaults, and the account danger zone.
One page, three sections, in this order. No tab navigation: the page
is short enough to scroll.

Layout, top to bottom:

1. Signed-in shell. Breadcrumbs: "Settings".
2. Heading level 1: "Settings".
3. Provider tokens. Heading level 2. One Card per provider:
   LaunchDarkly, ConfigCat, Unleash, Flagsmith. Each Card holds: the
   provider name, a TextInput for the token (password-style, value
   masked), a secondary Button "Test connection", and, when a token
   is saved, supporting Text "Saved, ending in ....a1b2" with a ghost
   Button "Revoke". LaunchDarkly is the only provider with
   token-based rollout fetching in v1; ConfigCat rollout is fetched
   without a token, from the public config.json. Unleash and
   Flagsmith Cards carry the note
   "Detection only in v1. Rollout fetching is a design hook." and
   their token fields are disabled with disabled Text "Rollout
   fetching is not in v1." ConfigCat needs no token: its Card reads
   "No token needed. When a ConfigCat config is found in the repo,
   rollout is fetched from the public config.json." and shows the
   token field disabled. A token test that fails names the cause
   ("Wrong token.", "No access to this project.", "Provider is
   down.") and the fix under the field, as an inline error, and the
   field keeps the typed text. A token test that passes shows the
   Toast "LaunchDarkly connected." An invalid or expired token shows
   the error Banner (section 2.1) at the top of the page and makes
   rollout read "unknown (token invalid)" everywhere.
4. Scan defaults. Heading level 2. FormLayout: NumberInput "Staleness
   threshold (days)", default 90, integer only, range 1-365, entry
   errors reported in place ("Whole days only." for fractions).
   CheckboxInput "Include test call sites" with description "Count
   references from test files as reachable." (default on, per the
   gallery). There is no weekly-rescan switch in v1: scheduled
   rescans are a design hook (PLAN 0.2), and rescans are on demand
   only. TextArea "Ignore rules" with description "One rule
   per line. A path glob, or flag: <key> to ignore one flag key.
   Applies on the next rescan." plus supporting Text listing the
   rules currently in force from the repo's `.flagdebtignore` file,
   so the two sources never disagree silently. Primary Button "Save
   settings". Saving shows the Toast "Settings saved."
5. Account. Heading level 2. A Card with the signed-in email in Text,
   a secondary Button "Sign out", and the danger zone: Heading level
   3 "Delete account", supporting Text "Deletes your account, repos,
   scans, flags, and provider tokens. This cannot be undone.",
   destructive Button "Delete account" opening the typed-DELETE flow
   in section 14.3.

States:

- Loading: form skeleton (three Skeleton lines).
- Token test in flight: the Test button shows loading, the field is
  disabled.
- Save in flight: the Save button shows loading.
- Save failed: inline error under the form ("Could not save. Check
  your connection and try again.") and the form keeps its values.

Responsive: single column at all widths. The provider Cards stack.
The token field and Test button stack full width at 375px.

## 11. Login (`/login`)

Purpose: magic-link sign-in, nothing else. No password, no social
login in v1.

Layout, top to bottom:

1. Minimal top bar. Right link: "Back to the scan tool".
2. A Card, centered, content width 480. Heading level 1: "Sign in".
   Supporting Text: "We email you a sign-in link. No password."
3. FormLayout: TextInput labelled "Email", placeholder
   "you@example.com", primary Button "Email me a sign-in link".
   The button is disabled while the send is in flight, with the
   loading state.
4. States, all inside the same Card so the layout never shifts:
   - Sending: button loading, field disabled.
   - Sent: the form is replaced by Text "Check your email. We sent
     a sign-in link to you@example.com." with a secondary Button
     "Send a new link" and supporting Text "Links expire after 1
     hour. Request a fresh one if it expired."
   - Invalid email: inline error under the field ("That does not
     look like an email address.") and the field keeps the text.
   - Send failed: an error Banner inside the Card ("Could not send
     the link. Check your connection and try again.") with the form
     intact below it, so the visitor can retry without retyping.
   - Expired link (arriving from `/auth/callback` with an expired
     code): the Card shows Text "That link expired. Request a fresh
     one." with the form below it, pre-filled with the email when
     known.
5. Below the Card, supporting Text: "Signing in attaches your
   anonymous scans to your account. A scan opened on another device
   still opens; only the claim does not transfer."

Analytics: `signup_completed` when the callback exchanges the code
for a new account (first sign-in only).

Responsive: the Card is full width with padding 4 at 375px, 480 wide
and centered above that.

## 12. Docs (`/docs`)

Purpose: the product explained in one page, for the visitor who wants
to understand the scan before pasting a URL.

Layout, top to bottom:

1. Minimal top bar. Right link: "Sign in".
2. Heading level 1: "How it works". Supporting Text: one sentence
   naming the three steps.
3. Sections, each a Heading level 2 with short Text and a Code
   example where it helps:
   - "Paste a public repo URL." The caps (100 MB, 10,000 files),
     the hosts (github.com, gitlab.com), the anonymous quota (3 per
     IP per UTC day), the signed-in quota (20 per day).
   - "What the scan reads." Flag definitions and references via
     read-only access. The detection rule in plain words: AST first,
     import-verified SDK call shapes for LaunchDarkly, Unleash,
     Flagsmith, ConfigCat, plus env-var and config-file flags.
   - "What the scan stores." Flag name, age, rollout %, file paths,
     line numbers, LOC counts, the deletion diff. Never source files.
   - "What the numbers mean." The three staleness signals, the
     status model (Active, Watch, Stale, Deletable, Ignored,
     Removed), the confidence tiers (definite, likely, possible,
     uncertain), the LOC formula, the default sort formula. The
     supported code shapes table from PLAN 0.1, in full.
   - "What it never does." Never writes to the repo, never
     auto-deletes, never opens a PR, never stores secret values.
   - "Private repos." Public-URL-only in v1. The GitHub App
     (Contents Read, Metadata Read, selected repos only) is the
     upgrade path, with the exact permission list shown.
   - "`.flagdebtignore`." The format, one rule per line, `#`
     comments, path globs and `flag: <key>` rules, with an example.
4. Footer.

States: a static page. If the docs content fails to load, the error
screen (section 15.2) applies. No skeleton: the page is server
rendered.

## 13. Terms (`/terms`) and Privacy (`/privacy`)

Purpose: the legal pages, written against the real data inventory
(findings only, clone deleted, secrets never stored), human-reviewed
before launch (phase-6).

Layout: minimal top bar, Heading level 1, the content in Text with
Heading level 2 sections, footer. Privacy states, in plain language:
what is stored (flag names, file paths, line numbers, LOC counts,
deletion diffs), what is never stored (source files, secret values),
the 30-day anonymous purge, one-click project and account deletion
with the timeline. Terms states the free-to-use scope, the caps, and
that the tool shows diffs and never deletes code itself.

States: static pages. "Last updated" date shown under the heading.

## 14. Deletion patterns (the long tail)

Every destructive action in the product follows one of three patterns.
No destructive action is a bare Button with no confirmation, and no
confirmation ever confirms on a stray click.

### 14.1 One-click AlertDialog: delete a scan, delete a repo

AlertDialog, the gallery component. Title names the thing: "Delete
this scan?" Description names the blast radius in numbers: "Scan
2026-11-18-a1b2 for acme/shop-web will be deleted, along with its 6
flags and 41 call sites. This cannot be undone." Action Button
"Delete scan" (destructive variant), Cancel Button "Keep scan"
(ghost, autofocus). Esc closes, focus returns to the invoker, no
light-dismiss. On confirm: the scan row is gone, the Toast reads
"Scan 2026-11-18-a1b2 deleted." On failure: the Toast names the cause
and the dialog stays open with the form intact.

Delete a repo uses the same pattern: "Delete this repo?" Description:
"acme/shop-web will be deleted, along with its 3 scans, 18 flags,
and provider settings. This cannot be undone." Action "Delete repo".

Delete during a running scan cancels the scan first, then deletes.
The dialog description says so: "The running scan will be cancelled
first."

### 14.2 Dialog with a reason: ignore, un-ignore, mark removed

Ignore opens a Dialog (purpose "form") with the gallery layout:
title "Ignore new_checkout_enabled", subtitle "The flag leaves the
deletable total. The reason is stored with the flag.", a Selector for
the reason (kill switch, seasonal, permanent, other), a TextArea for
a note, Cancel (ghost) and "Ignore flag" (primary). The reason is
required: submitting with no reason shows the inline error "Pick a
reason first." and focuses the Selector. When "other" is picked, the
note becomes required too ("Say why this flag stays."). On confirm:
Toast "Flag ignored. new_checkout_enabled left the deletable total."
and the deletable total on the page updates at once.

Un-ignore opens the same Dialog with the title "Un-ignore
new_checkout_enabled" and the reason Selector (the reason for
un-ignoring is stored the same way). Mark removed is a one-click
confirmation Dialog (not an AlertDialog, because it records an intent
rather than deleting): title "Mark new_checkout_enabled removed?",
description "The next rescan confirms it. If the flag is still there,
it returns to Active and the event is recorded.", action "Mark
removed". The kill-switch cap override uses the same Dialog shape:
title "Override the kill-switch cap?", description "This flag will be
treated as deletable. The override is recorded as an event.",
action "Override cap".

### 14.3 Typed-DELETE: delete account

Two steps, built from primitives, because AlertDialog has no
text-input slot (phase-2 finding).

Step 1: a Dialog with title "Delete your account?", description
naming the blast radius: "Deletes your account, 2 repos, 5 scans,
and your provider tokens. This cannot be undone." Buttons: "Cancel"
(ghost, autofocus) and "Continue" (destructive). No light-dismiss.

Step 2: the same Dialog swaps its body to the typed confirmation:
Text "Type DELETE to confirm." A TextInput labelled "Type DELETE",
with the placeholder "DELETE". The destructive Button "Delete my
account" stays disabled until the field reads exactly `DELETE`
(case-sensitive, no trimming of inner spaces). The Cancel Button
reads "Keep my account" and is always available. Esc while text is
typed does not close the dialog: the dirty-form guard keeps it open
and shows inline Text "Your typed confirmation will be lost. Choose
Keep my account to cancel." (the message space is reserved, so no
control moves under the pointer). A second Esc with an empty field
closes it. On confirm: the account, repos, scans, flags, and tokens
are deleted, the session ends, and the visitor lands on the landing
page with a Toast "Your account was deleted." On failure: the dialog
stays open, the error names the cause, the typed text is kept.

### 14.4 Revoke a provider token

Settings, per provider Card. Ghost Button "Revoke" beside the saved
token line. One-click AlertDialog: title "Revoke the LaunchDarkly
token?", description "Rollout will read unknown (no token) until a
new token is saved. Saved scans keep their rollout values.",
action "Revoke token". On confirm: Toast "LaunchDarkly token revoked."
The token field clears and the Card returns to its unsaved state.

### 14.5 Remove an ignore rule

Settings, scan defaults. Each rule in force is listed with a ghost
icon-only Button to remove it. Removing a rule takes effect on the
next rescan; the page says so next to the list ("Changes apply on the
next rescan.") and shows a Toast "Rule removed. It stops applying on
the next rescan." No confirmation dialog: removing a rule deletes
nothing, it only changes the next scan.

### 14.6 Uninstall (the GitHub App, post-launch hook)

Private repos are OUT in v1, so there is no GitHub App to uninstall
yet. The uninstall pattern is specced now so phase-4 does not invent
it later: uninstalling the App revokes its access and the repos it
served become "Disconnected" on the repos list (Status cell reads
"Disconnected", Rescan disabled, Delete still available), with a
Banner on the repos list: "The GitHub App was removed. 2 repos are
disconnected. Reconnect the App or delete them." The data is kept
until the user deletes the repo; uninstalling never deletes data
silently.

## 15. 404 and error screens

### 15.1 404

Route: any unknown path. Minimal top bar. Heading level 1: "This page
does not exist." Supporting Text: "Check the URL, or go back to the
scan tool." Primary Button "Go to the scan tool" (links to `/`),
secondary Button "See the docs" (links to `/docs`). No stack trace,
no status code shown to the visitor. The 404 page returns HTTP 404.

### 15.2 Error screen (page-level failure)

Route: any page that cannot load its data (database unreachable,
report id malformed, dashboard query failed). The signed-in shell when
the visitor is signed in, the minimal top bar otherwise. Heading level
1: "Something went wrong." Supporting Text naming the cause in plain
words where it is known: "The database did not answer. Try again in a
few minutes." or "No scan at this link. Check the URL." Primary Button
"Try again" (reloads the page), secondary Button "Go to the scan
tool". The error is logged server-side with the request id; the id is
shown in supporting Text ("Reference: req_01j...") so Abdullah can
find it in the logs. No stack trace is shown.

### 15.3 Signed-out redirect

Not a screen: a 307 to `/login` with the destination preserved
(section 1.1). The login page after sign-in returns the visitor to
the destination. A signed-out visitor never sees app chrome.

## 16. Analytics events, placed

PostHog free tier, cookieless config, session replay off (approved at
the phase-0 gate). Events fire with aggregates only, never repo names,
repo URLs, file contents, keystrokes, or per-user paths.

| Event | Fires on |
|---|---|
| Landing pageview + referrer | Landing load |
| `scan_started` | Scan button on the landing page, Rescan on the dashboard and the repos list |
| `scan_completed` | Scan reaches done (flag count, stale count, deletable LOC as aggregates) |
| `report_viewed` | Public report load |
| `export_clicked` | CSV export from the report or the dashboard |
| `signup_completed` | Magic-link callback exchanges the code for a new account |

No other events in v1. The ignore, delete, and settings actions are
audit events in `flag_events` and the server log, not analytics.

## 17. States matrix (phase-5 checklist)

Every screen times loading, empty, and error. A screen is not done
until every cell in its row has been seen on a screenshot.

| Screen | Loading | Empty | Error |
|---|---|---|---|
| Landing | n/a (server rendered) | n/a | Invalid URL inline error; quota inline error; queue-full Banner on the scan page |
| Scan progress | ProgressBar with step, queue position, elapsed time | n/a | All seven failure causes, fixed copy, retry paste box |
| Public report | Table skeleton | No flags; none stale; candidates need a human look | Scan id does not exist (error screen); scan still running (progress view) |
| Dashboard | Table skeleton | No repos; no flags; none stale; candidates need a human look | DB unreachable (error screen); token invalid Banner; rescan of a now-private repo Banner; export with zero flags |
| Flag detail | Skeleton heading, Badges, lines | n/a (a flag always has call sites or an explicit none) | Flag not found (error screen); winning value unknown (both branches, picker); unresolved references section |
| Repos list | Table skeleton | No repos | Latest scan failed (Status cell + cause); scan running (Rescan disabled); repo deleted while viewing (error screen) |
| Settings | Form skeleton | No token saved (empty Card state) | Token test failed inline; save failed inline; token invalid Banner |
| Login | n/a | n/a | Invalid email inline; send failed Banner; expired link state |
| Docs | n/a | n/a | Content fails to load (error screen) |
| Terms / Privacy | n/a | n/a | Content fails to load (error screen) |
| 404 | n/a | n/a | n/a (the page is the error state) |
| Error screen | n/a | n/a | n/a (the page is the error state) |

## 18. Gate notes (judgment calls for Abdullah)

1. The scan page and the report page share one route (`/scans/[id]`).
   The progress page shows the report URL from the start, and the same
   URL shows the report when the scan finishes. The alternative (two
   routes) adds a redirect and a second URL to share. Recommend: keep
   one route.
2. The flag detail route takes the flag row id
   (`/dashboard/flags/[flagId]`), not the flag key. Keys repeat across
   scans and providers, ids do not. Recommend: keep the id route.
3. The flag table keeps the DESIGN.md horizontal-scroll rule at 375px
   (key column pinned) instead of the stacked-card transform from the
   responsive-table guide, because six sortable columns lose their sort
   state in the stacked form. The table wrapper still follows the guide
   (keyboard-scrollable region, caption-named, sticky header).
   Recommend: keep the scroll rule.
4. The typed-DELETE account flow is built from primitives, not
   AlertDialog, because AlertDialog has no text-input slot (phase-2
   finding). The two-step flow in section 14.3 is the spec. Recommend:
   keep it.
5. Unleash and Flagsmith token fields are disabled in v1 with the
   "Rollout fetching is not in v1" note. Detection of their SDK calls
   is IN; rollout fetching is a hook. Recommend: keep the fields
   visible but disabled, so the v1 boundary is honest.
6. The demo repo for the landing sample scan is still unpicked (the
   phase-3 slice 1 sizing spike picks it; fallback is Abdullah's
   link-rot-killer repo, per the phase-0 gate). The landing entry
   above uses placeholder counts ("X flags, Y lines") until the pick
   lands. Recommend: keep the placeholders in this file, fill them in
   phase-4 from the real demo scan.
7. No new components are needed beyond the phase-2 set. The diff
   viewer (CodeBlock `isDiff`), filter chips (Badge plus Button), and
   the typed-DELETE dialog (primitives) were the three gaps, and all
   three were built or specced in phase-2 or here. The duration chart
   does not exist in this product: counts over time are plain
   cumulative numbers in Cards (section 7.3), never a chart.
8. Confidence tier for unresolved references: PLAN.md is internally
   inconsistent here. Its LOC paragraph caps a flag touched by an
   unresolved or dynamic reference at possible confidence, while its
   confidence-tier definition says uncertain covers "any
   unresolved/dynamic reference". This blueprint uses possible
   throughout, matching the LOC paragraph and the exclusion rule
   (possible flags are excluded from the deletable total). Recommend:
   keep possible, and correct PLAN.md 0.1 at the gate so the tier
   definition reads "uncertain: the winning value is unknown or the
   evidence is too thin to call".
9. Two new `flag_events` actions: `reopened` and `reappeared`
   (section 8.5). PLAN 0.3 lists only ignored, unignored,
   marked_removed, confirmed_removed, but PLAN 0.1 already requires
   an event when a marked-removed flag reappears, without naming it.
   Recommend: extend the enum with these two actions.
10. Weekly rescan is cut from v1 (sections 7.2 and 10.4). PLAN 0.2
    lists scheduled rescans as a design hook and says v1 rescans on
    demand only; the earlier draft of this file specced a working
    weekly switch, which contradicted it. Recommend: keep the cut.
    The Switch in the phase-2 gallery stays as a component demo, not
    a product promise.
