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

// Drive the tick until the scan leaves queued/processing, up to 10 minutes.
const deadline = Date.now() + 10 * 60 * 1000;
let state = { scan: { status: created.status, progress: null } };
while (['queued', 'processing'].includes(state.scan.status) && Date.now() < deadline) {
  await json(`${APP_URL}/api/cron/scan-tick`, { headers: { Authorization: `Bearer ${CRON_SECRET}` } });
  state = await json(`${APP_URL}/api/scans/${scanId}`);
  console.log(`status=${state.scan.status} progress=${state.scan.progress?.step ?? '-'}`);
  if (['queued', 'processing'].includes(state.scan.status)) await new Promise((r) => setTimeout(r, 5000));
}
if (['queued', 'processing'].includes(state.scan.status)) {
  console.error('scan did not finish in 10 minutes; check /api/health and the server logs');
  process.exit(1);
}
const flags = await json(`${APP_URL}/api/scans/${scanId}/flags`);
console.log(`done: ${state.scan.status}, ${flags.flags.length} flags, headline ${state.counts?.deletable_loc ?? 0} deletable lines`);
console.log(`view it at ${APP_URL}/scans/${scanId}`);
