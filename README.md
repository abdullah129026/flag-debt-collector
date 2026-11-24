# Flag Debt Collector

Find the flags your codebase forgot, and count what deleting them saves.

Paste a public repo URL. The scan finds feature flags, checks each one for age, rollout, and reachability, and shows the deletion diff with the lines it would remove. Nothing is deleted for you. Deleting code is always your call, in your own repo.

Live site: https://flag-debt-collector.vercel.app

## Try it

No signup for the first scan. Paste a public GitHub or GitLab repo URL on the landing page and watch the report build. Anonymous scans are limited to 3 per IP per UTC day.

## Quickstart (local, under 5 minutes)

```bash
git clone https://github.com/abdullah129026/flag-debt-collector.git
cd flag-debt-collector
npm install
cp .env.example .env.local
npm run dev
```

Open http://localhost:3000 and paste a public repo URL.

Scans need a Supabase project. Create one on the free tier, run the migrations in `supabase/migrations/` in order, and fill in the four Supabase values in `.env.local` (see `.env.example`). Without them the app still runs, but `/api/health` reports `db: unconfigured` and scans refuse with a clear error instead of failing halfway.

## How a scan works

1. Download the repo as a tarball from the host (GitHub codeload or the GitLab archive API), capped at 100 MB and 10,000 files. No git binary is needed: the Vercel runtime does not have one.
2. Parse the code (AST-first) and verify each flag against a real SDK import, so config maps and string matches do not count as flags.
3. Age each flag from the host's commit history (labeled approx), check rollout against the provider (LaunchDarkly, ConfigCat) when a token is connected, and count call sites.
4. Compute deletable lines from a real unified diff, generated in pure JS and verified by applying it back to the original content before storing it.
5. The download is deleted when the scan finishes. Source files are never stored.

The tick loop advances one scan per minute, in 7-second chunks, so a scan of up to 1,000 files finishes in under 5 minutes and up to the 10,000-file cap in under 30 minutes.

## What it stores, and what it never stores

Stored: flag names, file paths, line numbers, LOC counts, deletion diffs. For signed-in accounts: email, saved repos, scan settings, and provider tokens (encrypted, only the last 4 characters shown).

Never stored: source files, secret values found in scanned code, repo contents of any kind. Anonymous scans purge after 30 days. Analytics events carry aggregates only (flag counts, deletable lines), never repo names or file contents.

## Limits

- Public repos on github.com and gitlab.com only in v1. Private repos need the GitHub App, which is the first post-launch item.
- Scan caps: 100 MB, 10,000 files. Queue depth: 10 scans.
- Quotas: 3 anonymous scans per IP per UTC day, 20 per day signed in.
- Flags are LaunchDarkly, Unleash, Flagsmith, ConfigCat, `process.env`, and config-file flags. Env and config flags cap at Stale: they never earn a signal for rollout, so they can never be called Deletable on rollout evidence alone.

## Tests

```bash
npm test    # 72 tests, node:test, zero test dependencies
npm run build
```

## Deploy

See [DEPLOY.md](DEPLOY.md) for the click-by-click deploy: Supabase project, migrations, Vault secrets, Vercel import, env vars, site-URL audit, pg_cron setup, demo seed, and the verification sweep. Rollback is one paragraph in the same file.

## Docs

- [PLAN.md](PLAN.md): product plan, architecture, risk register, launch plan.
- [DESIGN.md](DESIGN.md): design direction and tokens.
- [DESIGN-COPY.md](DESIGN-COPY.md): every screen, specced against the design system.
- [BACKEND.md](BACKEND.md): API routes, schema, scan pipeline, deviations.
- [QA.md](QA.md): the phase-5 polish and QA results.

## Status

v0.1.0. Launchable, not launched: the code is ready and the deploy steps are in DEPLOY.md. The demo scan on the landing page runs after the first deploy.
