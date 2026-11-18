# DESIGN.md: Feature Flag Debt Collector (project 5)

Phase-1, design decisions. Status: awaiting Abdullah's approval (gate).
System: Meta Astryx, neutral theme, dark-first, Inter. No custom design
system, no per-project redesign. This file is the one committed direction.
Phase-2 wires the components against it.

## 1. Committed direction

The product is an evidence ledger, not a scoreboard. Every number shows
its proof next to it: age from git history, rollout from the provider,
call sites by file, the deletion diff line by line. Nothing is a grade.
There is no health score and no maintainability rating (PLAN 0.1, scope
OUT). The dashboard shows concrete counts over time: flags removed, lines
deleted.

The look follows from that. Neutral monochrome chrome, color only on
data. The page furniture (shell, tables, forms, buttons) is near-black,
near-white, and grey. Color appears in exactly one place: flag status
and confidence, where it means something. A visitor should be able to
tell the state of a flag from its shape and text alone, with the color
off.

The landing page is a tool page, not a marketing site. The pitch, the
paste box, and the three-line data contract sit above the fold. A real
sample report is embedded below, so the value is visible before any
input. Copy is plain and specific: what the scan reads, what it stores,
what it never touches.

Voice: short sentences, numbers with their source, no adjectives doing
the work of evidence. Error messages name the cause and the next action,
never just "failed".

## 2. System: Astryx, pinned and verified

Astryx is consumed whole: tokens, components, page templates, one
built-in theme. App code uses Astryx components and semantic tokens
only. No hardcoded hex or pixel values in app code, no one-off look.

Pinned versions, verified against the npm registry on 2026-11-16:

| Package | Pinned version |
|---|---|
| `@astryxdesign/core` | 0.7.16 |
| `@astryxdesign/theme-neutral` | 0.7.16 |
| `@astryxdesign/cli` | 0.7.16 (dev) |
| `@stylexjs/stylex` | 0.19.2 |

All three Astryx packages converged on 0.7.16 (published 2026-11-16,
hours before this phase). The brief's 0.7.14/0.7.15 pins are stale.
The 0.7.16 changelog is additive for this project: Table column and
row virtualization, Table infinite scroll, entry-error behavior on
date/time/number inputs, Lightbox caption changes, an AppShell SSR
fix. Nothing in it breaks the plan, and the Table additions help the
flag list directly.

Theme: neutral. Mode: dark only in v1. The app renders `<Theme
mode="dark">` and ships no light toggle. Light mode is a hook, not a
v1 feature: the tokens exist in both modes, the app picks one. This
keeps phase-2 verification to a single mode and matches "dark-first"
from the brief.

Peer requirements fit the stack: React 19 or later, `@stylexjs/stylex`
^0.19.0. Next.js 16 with React 19 meets them. Astryx is a TypeScript
dependency consumed as a library; app code stays plain JS.

### Inter override, verified in the built output

The neutral theme ships Figtree. Inter is the program-wide typeface,
so the theme is extended with a font override. Three override shapes
were built and compared in a scratch project (not in the repo):

- A: raw token overrides (`tokens: {'--font-family-body': 'Inter, ...'}`).
  Failed. The root scope renders Inter, but the theme's coarse-pointer
  adaptation block (under 1024px, touch screens) re-declares the base
  theme's tokens and brings Figtree back on phones.
- B: typography scale config (`typography: {body: {family: 'Inter',
  fallbacks: '...'}, heading: {family: 'Inter', fallbacks: '...'}}`).
  Passed. The adaptation re-resolves against the child typography, so
  Inter holds on touch screens too.
- C: raw tokens plus a child adaptation rule re-asserting Inter. Works
  by cascade order, but leaves dead Figtree references in the CSS.
  Rejected as messier than B.

Variant B is the locked override. Verification, all run 2026-11-16
against the pinned 0.7.16 packages:

1. `npx astryx theme build` on the extended theme produces
   `flag-debt.css` (27.2 KB). `--font-family-body` and
   `--font-family-heading` are the Inter stack in the root scope and
   in the coarse-pointer adaptation block. Zero occurrences of
   "Figtree" in the whole file. The build note names only "Inter" as a
   font to load.
2. The built JS module carries the same values in its tokens object
   (`"--font-family-body": "Inter, ..."`), zero Figtree.
3. A server render of `<Theme theme={flagDebtTheme} mode="dark">` with
   a real Heading, Text, and Button renders without error and emits
   `data-astryx-theme="flag-debt" data-theme="dark"`. The font itself
   is not in the CSS: the build note says fonts are named but not
   loaded, and the app must load them. Phase-3 loads Inter with
   `next/font` and the token names the family. Phase-2 re-verifies the
   rendered font in the real app.

Theme source (phase-2 writes this into the repo as
`src/themes/flag-debt/flagDebtTheme.mjs`, with a `flagDebtTheme.doc.mjs`
descriptor beside it). The flat `src/themes/flag-debt.mjs` path in the
phase-1 draft did not survive contact with the CLI: `theme list` and
`theme add` only discover a theme in the folder layout (a descriptor
whose `name` matches the parent directory, a source module with the
same stem). The source content is unchanged; only the path moved, so
the theme is discoverable and `theme add` generates the
`astryx-themes` module.

```js
import {defineTheme} from '@astryxdesign/core/theme';
import {neutralTheme} from '@astryxdesign/theme-neutral';

export const flagDebtTheme = defineTheme({
  name: 'flag-debt',
  extends: neutralTheme,
  typography: {
    body: {
      family: 'Inter',
      fallbacks: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
    },
    heading: {
      family: 'Inter',
      fallbacks: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
    },
  },
});
```

The theme is built with `npx astryx theme build` and added with
`theme add`. The generated `astryx-themes` module is the only wiring
point. Never hand-edit generated theme output.

## 3. Tokens as law

Values below are the dark-mode resolutions of the neutral theme,
read from the built 0.7.16 CSS. They are law: app code references the
token name, never the value. If a value looks wrong, the theme changes,
not the component.

### Color (dark)

| Token | Value | Use |
|---|---|---|
| `--color-background-body` | #1b1b1b | Page background |
| `--color-background-surface` | #262626 | Raised surfaces, table header |
| `--color-background-card` | #1b1b1b | Cards sit on the body, separated by border |
| `--color-background-popover` | #1b1b1b | Menus, dialogs |
| `--color-text-primary` | #ffffff | Headings, body text, flag keys |
| `--color-text-secondary` | #9e9e9e | Meta text, timestamps, counts |
| `--color-text-disabled` | #525252 | Disabled text only, never for readable content |
| `--color-border` | #ffffff1A | Hairline borders on everything |
| `--color-border-emphasized` | #525252 | Borders that must read: inputs, focused rows |
| `--color-accent` | #f1f1f1 | Primary actions, selected states (near-white, not a brand color) |
| `--color-text-info` | #a1caff | Watch status, links, info |
| `--color-text-success` | #90ca90 | Active status, removed confirmations |
| `--color-text-warning` | #eec448 | Stale status, caution copy |
| `--color-text-error` | #ffaea7 | Deletable status, destructive actions, errors |
| `--color-background-red` | #5b2b28 | Deletable row tint, danger banners |
| `--color-background-yellow` | #453a1c | Stale row tint, warning banners |
| `--color-background-green` | #2b422b | Active row tint, success banners |
| `--color-background-blue` | #253c5a | Watch row tint, info banners |

Status tints are backgrounds, never borders. No one-sided accent
border anywhere in the product: a row that needs emphasis gets a
background tint plus a full hairline border, or a Badge, never a
colored left edge. No gradients. No shadows at rest; the modal is the
only shadowed surface.

### Type

Inter for body and headings, loaded via `next/font`. Code uses the
theme's monospace stack (`--font-family-code`: ui-monospace, SF Mono,
Monaco, Consolas, Liberation Mono, Courier New, monospace).

Type scale (theme values, base 14px):

| Token | Size |
|---|---|
| `--font-size-4xs` | 0.375rem (6px) |
| `--font-size-3xs` | 0.4375rem (7px) |
| `--font-size-2xs` | 0.5rem (8px) |
| `--font-size-xs` | 0.625rem (10px) |
| `--font-size-sm` | 0.75rem (12px) |
| `--font-size-base` | 0.875rem (14px) |
| `--font-size-lg` | 1.0625rem (17px) |
| `--font-size-xl` | 1.25rem (20px) |
| `--font-size-2xl` | 1.5rem (24px) |
| `--font-size-3xl` | 1.8125rem (29px) |
| `--font-size-4xl` | 2.1875rem (35px) |
| `--font-size-5xl` | 2.625rem (42px) |

Headings use the theme's text styles (`--text-heading-1` through
`--text-heading-6`), body copy uses `--text-body`. Flag keys, file
paths, and LOC counts render in the code face at body size. Numbers
that are the point of a row (deletable LOC, flag age) render at body
size in primary text, never oversized for decoration.

### Radius, motion, spacing

Radius: `--radius-inner` 0.375rem (6px), `--radius-element` 0.625rem
(10px), `--radius-container` 0.75rem (12px), `--radius-page` 1.75rem
(28px), `--radius-full` 9999px for dots and pills.

Motion: `--duration-fast` 125ms, `--duration-medium` 300ms,
`--duration-slow` 700ms. Micro-interactions use fast and medium only
(150-300ms budget from the blueprint). Slow is for page-level
transitions, not for hover or press feedback. Reduced motion is
respected by the theme; app code adds no motion of its own.

Spacing: the theme's 8px grid, semantic spacing tokens only. App
code never writes a hardcoded pixel gap, margin, or padding. Layout
comes from Astryx Layout and AppShell, not from hand-rolled grids.

Icons: Lucide outline icons from the neutral theme's icon registry.
One weight, one style, everywhere. No emoji as icons, no custom SVG
icons in v1.

## 4. Flag status visual language

Six statuses, one Badge each. Every Badge carries a shape and text,
so state never depends on color alone. Shapes are Lucide icons in the
Badge.

| Status | Text | Color tokens | Shape |
|---|---|---|---|
| Deletable | Deletable | error text on red tint | circle with an x |
| Stale | Stale | warning text on yellow tint | clock |
| Watch | Watch | info text on blue tint | eye |
| Active | Active | success text on green tint | check |
| Ignored | Ignored | secondary text, no tint | pause |
| Removed | Removed | secondary text, no tint | check with a line through the flag key |

Confidence rides next to status as a small plain Badge with text
only: definite, likely, possible, uncertain. Uncertain gets the
warning tint, the other three are uncolored. The reason for a
confidence tier is one click away on the flag detail page, never
hidden.

Rollout reads as text: a number with a percent sign, "n/a" for
env/config flags, "unknown (no token)" when no provider is connected,
"unknown (token invalid)" when the token fails. The two unknowns are
different strings and sort differently. Reachable reads as text with
a shape: reachable, tests only, not referenced.

Deletable LOC reads as a number on the row and as "up to N" when the
winning value is unknown. "Up to N" lines are never added to the
headline total. The headline total sums definite and likely flags
with a known winning value only, and the page says so next to the
number. The formula is printed on the flag detail page.

## 5. Component map (locked, Astryx 0.7.16)

Every screen is built from these. If a screen needs a component not
listed here, phase-2 records the gap and builds it from Astryx
primitives and tokens, never as a one-off look.

| Need | Astryx component |
|---|---|
| App shell, nav | AppShell, TopNav, SideNav, Breadcrumbs |
| Page structure | Layout, LayoutHeader, LayoutPanel, LayoutContent, Card |
| Headings and body | Heading, Text, Link |
| Buttons | Button, ButtonGroup |
| Flag table | Table (density compact/balanced/spacious, sorting, selection, pagination, row virtualization) |
| Status and confidence | Badge, StatusDot |
| Density and view switches | SegmentedControl, ToggleButtonGroup |
| Detail sections | TabList (exists in 0.7.16; the brief's "no Tabs" note was written against 0.7.15 and is stale) |
| Forms and filters | TextInput, TextArea, Selector, CheckboxInput, Switch, FormLayout |
| Confirmations | Dialog, AlertDialog |
| Diff viewer | CodeBlock (line numbers, highlighted lines, copy button), built from primitives: added lines get the green tint, removed lines the red tint, context lines uncolored |
| Code display | Code, CodeBlock |
| Empty states | EmptyState (three distinct designs: no flags, none stale, candidates need a human look) |
| Banners | Banner (rescan in progress, token invalid, queue full) |
| Feedback | Toast, ProgressBar, Spinner, Skeleton |
| Pagination | Pagination |

Three pieces have no prebuilt component and are built from
primitives in phase-2, recorded here so they are not discovered in
phase-4:

1. Dense sortable table with filter chips: Astryx Table plus Badge
   chips for applied filters (removable, with clear-all) and a
   SegmentedControl for density. "Showing N of M" is Text under the
   table. Sorting uses the Table's sort control with `aria-sort`.
2. Diff viewer: CodeBlock with highlighted lines for added and
   removed lines, a header naming the file, and the copy button.
   No syntax highlighting of the diff itself; the code face and the
   two tints carry the meaning.
3. Filter chips: Badge plus a small Button to dismiss, composed in
   app code. There is no Chip component in 0.7.16.

No charts package is used. The product needs none: counts over time
render as a plain table of numbers, not a chart.

## 6. User flows

### Flow 1: anonymous first scan (the landing flow)

Landing, paste a public repo URL, no signup. The three-line data
contract sits above the button. The button starts the scan and the
page moves to scan progress: current step (queued, cloning, parsing,
age, provider, done, failed), queue position, elapsed time, and the
report URL with a copy button from the start. Closing the tab loses
nothing. The report page is public by scan id.

Edge states: private repo ("This repo is private. Public repos only
in v1."), not found ("No repo at that URL."), non-allowlisted host,
no JS/TS files, over caps (100 MB, 10,000 files), clone timeout,
anonymous quota used (3 per IP per UTC day, reset at midnight UTC),
queue full (10 queued scans). Each names the cause and the next
action. A failed scan never says only "failed". The progress page
shows the failure with a retry button and the same paste box.

### Flow 2: triage a flag (the core loop)

Dashboard flag table, default sort by status rank, then deletable
LOC, then age. The sort formula is printed on the page. A row opens
the flag detail page: call sites grouped by file with a production
versus test split, history timeline, signals, the LOC formula, the
diff, and the unresolved references for that flag in their own
section.

Ignore lives on the row and the detail page. It opens a Dialog that
requires a reason (kill switch, seasonal, permanent, other with
text). The reason is stored and the flag leaves the deletable total.
Mark removed lives on the detail page. It records the intent; the
next rescan confirms it, and if the flag reappears it returns to
Active with an event noting the reappearance.

Edge states: a flag with an unresolved reference is capped at
possible confidence and excluded from the deletable total. A flag
whose winning value is unknown shows both branches and no diff, and
lets the user pick the winning value, after which the diff and LOC
compute. A kill-switch flag (provider-marked non-temporary, or a key
matching the kill-switch name list) is capped at Stale with the
reason shown on the row; the user can override the cap on the detail
page, recorded as an event.

### Flow 3: sign in and save

Magic-link sign in from the landing page or the report page. The
claim cookie attaches an anonymous scan and its repo to the new
session. Signed-in users get a repos list, rescan on demand, and
removal tracking over time. While a rescan runs, the dashboard keeps
the old data with a "Rescanning, updated X ago" Banner. New results
replace the old ones on completion.

Edge states: expired magic link (request a fresh one), a scan opened
on another device (the report opens, the claim does not transfer),
rescan of a repo that is now private (the private-repo error, with
the GitHub App note).

### Flow 4: connect a provider token

Settings, provider tokens. A token field per provider with a "Test
connection" button, last-4 display, and revoke. A valid LaunchDarkly
token fills rollout % from the flag-statuses API, production
environment only. ConfigCat needs no token: when a ConfigCat config
is found in the repo, settings says so and rollout is fetched without
one.

Edge states: an invalid or expired token shows an error Banner in
settings and makes rollout read "unknown (token invalid)", distinct
from "unknown (no token)". A token test that fails names the cause
(wrong token, no access to the project, provider down) and the fix.

### Flow 5: export and delete

CSV export of the flag list from the dashboard, owner only. Export
carries flag names, ages, rollout, call-site counts, and LOC, never
source code. Delete a scan (owner only, from the report page or the
repos list) with a confirmation Dialog. Delete a project removes its
repos, scans, flags, and findings. Delete the account is a two-step
typed-DELETE Dialog, the same pattern as project 4.

Edge states: export with zero flags exports the headers and a note,
never an empty file that looks broken. Delete during a running scan
cancels the scan first. Anonymous scans purge after 30 days and the
report page says so.

## 7. Page inventory

Phase-2 and design-copy spec each of these. No screen gets built
before its blueprint entry exists.

Landing, scan progress, public report, dashboard, flag detail, repos
list, settings, login, docs, terms, privacy, 404, error. The app
shell (AppShell with TopNav and SideNav) is shared across the
signed-in pages. The landing and public report pages use a minimal
top bar, not the app shell, so a first-time visitor meets the tool,
not the product chrome.

## 8. Accessibility and responsive rules

Contrast, computed against the dark tokens (WCAG AA needs 4.5:1 for
body text): primary 17.2:1, secondary 6.4:1, info 10.2:1, warning
10.4:1, success 9.1:1, error 9.7:1, accent 15.2:1 on the body
background. On surface (#262626) the same pairs run 15.1:1 down to
5.6:1. Disabled text is 2.2:1 and is used only for text that is
disabled by design. Phase-5 re-verifies every pair on the real pages.

Focus is visible on every interactive element through the theme's
focus ring. Status is never color alone (shape plus text, section 4).
Tables carry `aria-sort` on the sorted column, filters are removable
chips with clear-all, and every list shows "Showing N of M". Dialogs
trap focus and return it on close. Toasts announce through a live
region. Motion respects reduced-motion preference.

Responsive: the flag table is the hard case. At 375px it scrolls
horizontally inside its Card with the flag key column pinned, never
squeezes columns to unreadable widths. Density defaults to balanced
and the user can switch to compact or spacious; the choice persists.
Touch targets are at least 44px. The coarse-pointer adaptation in
the theme already scales type up on touch screens; app layouts must
not fight it.

## 9. Decisions — APPROVED 2026-11-17 (Abdullah in chat, as a block, no vetoes)

1. Astryx neutral, dark-only in v1, no light toggle. Light mode is a
   hook.
2. Monochrome chrome with color only on flag status and confidence.
   No brand color, no gradients.
3. The status visual language in section 4: six Badges with shape,
   text, and tint, confidence as a plain text Badge beside them.
4. TabList for flag detail sections. The brief said no Tabs; 0.7.16
   ships a real TabList, so the note is corrected.
5. Density defaults to balanced, user-switchable to compact or
   spacious, persisted.
6. Inter via the typography scale config (variant B), verified in the
   built CSS, the built JS module, and a server render. Figtree is
   gone everywhere, including the touch adaptation.
7. Pins: core 0.7.16, theme-neutral 0.7.16, cli 0.7.16, stylex 0.19.2.
8. The diff viewer and filter chips are built from Astryx primitives
   in phase-2 (section 5). No new dependency is added for them.

## 10. What phase-2 owns

The theme file (`src/themes/flag-debt/flagDebtTheme.mjs` plus its built artifacts
and the generated `astryx-themes` module), every core component in
all states against the theme, the three primitive-built pieces from
section 5, and a gallery page demoing the set. This file sets the
direction; phase-2 proves the components carry it.

### Phase-2 findings (2026-11-18, recorded at the gate)

Approved by Abdullah 2026-11-18 10:30 PKT ("Approved — keep the defaults"): all 4 findings accepted as-is, no vetoes.

- Watch and Ignored Badges render text-only. The neutral icon
  registry in 0.7.16 holds 29 glyphs and has no eye and no pause
  (closest are eyeSlash, which means the opposite of Watch, and
  stop, which would misread as a pause). Status still reads from
  text alone, per the rule in section 1, so text-only is accepted
  for these two rather than inventing a custom glyph.
- CodeBlock diff mode is `isDiff`, not `highlightLines`:
  `highlightLines` takes one highlight color only and cannot paint
  added green and removed red. `isDiff` over `language="plaintext"`
  does exactly that, with no syntax highlighting of the diff.
- AlertDialog has no text-input slot, so the typed-DELETE
  confirmation cannot live inside it. Delete-scan confirms with one
  click in the gallery; account deletion (phase-4) keeps the
  two-step typed-DELETE pattern and builds the input from
  primitives if the component still lacks the slot.
- Pagination only renders past one page. The gallery pages the flag
  table at 3 per page so the control shows; the "Showing N of M"
  text stays dynamic.
