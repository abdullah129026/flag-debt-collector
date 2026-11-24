// Seeds the demo scan against the live app and drives it to completion.
// Usage: APP_URL=https://<app> CRON_SECRET=<secret> node scripts/seed-demo.mjs
// The scan is created as an anonymous scan (it counts against the IP quota),
// then the script calls the scan tick itself until the scan finishes. Run
// it once after the phase-6 deploy; the landing page links to this scan.
const APP_URL = process.env.APP_URL;
const CRON_SECRET = process.env.CRON_SECRET;
const DEMO_REPO = 'https://github.com/abdullah129026/api-contract-firewall';

if (!APP_URL || !CRON_SECRET) {
  console.error('set APP_URL and CRON_SECRET first');
  process.exit(1);
}

async function json(url, opts = {}) {
  const res = await fetch(url, { ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${opts.method || 'GET'} ${url} -> ${res.status}: ${JSON.stringify(body)}`);
  return body;
}

const created = await json(`${APP_URL}/api/scans`, {
  method: 'POST',
  body: JSON.stringify({ repo_url: DEMO_REPO }),
});
const scanId = created.scan_id;
console.log(`scan ${scanId} created (claim token kept in the scan row)`);

// Drive the tick until the scan finishes, up to 10 minutes. The scan
// moves through queued, cloning, parsing, age, provider, then done or
// failed, so the loop runs until a terminal status, not just queued.
const deadline = Date.now() + 10 * 60 * 1000;
let state = { scan: { status: created.status, progress: null } };
while (!['done', 'failed'].includes(state.scan.status) && Date.now() < deadline) {
  // A tick can die at the function time cap; the scan resumes on the next
  // tick, so a failed tick call is logged and retried, not fatal.
  try {
    await json(`${APP_URL}/api/cron/scan-tick`, { headers: { Authorization: `Bearer ${CRON_SECRET}` } });
  } catch (e) {
    console.log(`tick call failed (${e.message}), retrying`);
  }
  state = await json(`${APP_URL}/api/scans/${scanId}`);
  console.log(`status=${state.scan.status} progress=${state.scan.progress?.step ?? '-'}`);
  if (!['done', 'failed'].includes(state.scan.status)) await new Promise((r) => setTimeout(r, 5000));
}
if (!['done', 'failed'].includes(state.scan.status)) {
  console.error('scan did not finish in 10 minutes; check /api/health and the server logs');
  process.exit(1);
}
if (state.scan.status === 'failed') {
  console.error(`scan failed: ${state.scan.error || 'unknown error'}`);
  process.exit(1);
}
const flags = await json(`${APP_URL}/api/scans/${scanId}/flags`);
console.log(`done: ${state.scan.status}, ${flags.flags.length} flags, headline ${state.counts?.deletable_loc ?? 0} deletable lines`);
console.log(`view it at ${APP_URL}/scans/${scanId}`);
