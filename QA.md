# QA

Run this checklist in phase-5 (polish and QA) and again at phase-6 launch
readiness. Pages are built in phase-4; the backend checks marked done
were verified on 2026-11-20 against the local production server.

## Backend checks (done 2026-11-20)

- `GET /` returns 200; `/design-system` returns 200.
- `GET /api/health` returns 503 `{"status":"degraded","db":"unconfigured"}` with no env vars set.
- `POST /api/scans` returns 503 without env vars.
- `GET /api/cron/scan-tick` and `/api/cron/purge` return 401 without a bearer token.
- Signed-out `/dashboard` and `/repos` return 307 to `/login?next=...`.
- `GET /api/scans/not-a-uuid` returns the one error shape, code `unconfigured`.
- `next build` is clean (all 18 API routes, auth callback, landing, design-system).
- 40 unit and integration tests green, including the full tick pipeline
  end to end against the golden fixture.

## Per-page checks (phase-5)

For every page, check each state it can be in: loading, populated,
empty, error, and signed-out. A page is not done until its screenshot
has been viewed at 375, 768, and 1440 pixels.

- Landing: hero shows the demo scan numbers from the live scan, not
  placeholder copy. The scan form rejects a non-GitHub URL with an
  inline message. No layout shift while the hero loads.
- Login and signup: magic-link sending, sent, and error states all
  render. A bad or expired link shows a recovery action, not a blank page.
- Dashboard (repos): empty state with a scan CTA when the user has no
  repos. Each row shows the latest scan status and headline LOC. The
  rescan button queues a new scan and the row updates.
- Repo detail: the scan list shows status, progress, and counts. Deleting
  a repo asks for confirmation and removes its scans.
- Scan report: the flag table sorts by status, then LOC desc, then age
  desc. The headline total matches the rule (definite and likely, known
  winning value only, "up to N" never added). Unresolved references are
  listed, not hidden. CSV download returns the same flags the table shows.
- Flag detail: call sites show the guard shape and the exact lines. The
  diff renders only when a winning value is known; otherwise both
  branches show with the assumption stated. Ignore, un-ignore, mark
  removed, reopen, and cap override each change the status and write an
  event, and each refuses the wrong starting state with a clear message.
- Settings: staleness days and delete cap save and persist. Token test
  reports success or the provider's error, never the token. Deleting a
  token removes rollout data on the next scan.
- Account delete: the typed confirmation is required, the auth user is
  deleted, and the session ends.
- Legal (terms, privacy): real copy, human-reviewed, no lorem ipsum.
- 404 and 500: branded, with a way back to the dashboard or landing.

## Accessibility and responsive

- Every interactive element is reachable by keyboard, with a visible
  focus ring.
- Forms label every field; errors are announced, not color-only.
- Contrast passes on text and status badges in the dark theme.
- No horizontal overflow at 375 pixels; tables scroll inside their card,
  the page does not.
- Touch targets are at least 44 pixels on mobile.

## OWASP basics

- Every route validates its inputs (URL allowlist, UUID ids, integer
  ranges, enum values) and returns the one error shape on failure.
- Cron routes require the bearer CRON_SECRET; a missing or wrong token
  is 401.
- Owner-only routes check the session or the claim cookie; a signed-in
  user cannot read, delete, or act on another user's scan, repo, or flag
  (verify by requesting a second user's id directly).
- Provider tokens are stored encrypted via the Vault RPC and never
  returned by any route. `CRON_SECRET` and service keys never appear in
  logs or responses.
- Anonymous scans are capped at 3 per IP per UTC day; signed-in at 20
  per day; queue depth is capped at 10.
- The scan URL allowlist blocks non-HTTPS, userinfo, ports, and IP
  literals. Cloned repos are never executed: the scanner parses text
  only, and `git apply --check` runs before any stored diff.
- Session cookies are httpOnly and same-site. The magic-link callback
  sets them on the redirect response.
- No secrets in the repo: `.env.example` documents names only, and the
  seed script takes secrets from the environment.

## Launch checks (phase-6)

- Migrations 0001-0005 run clean on the live Supabase project; the demo
  scan runs end to end with `scripts/seed-demo.mjs`.
- pg_cron fires the scan tick every minute (check the run log), or the
  external pinger fallback is in place.
- Signed-in sweep: every page and route works with a real session.
- Uptime monitor is up. Backups are confirmed. Rollback plan is written.
- Supabase site URL and redirect URLs point at the live domain before
  the first sign-in.
