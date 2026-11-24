import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tick } from '../lib/scan/tick.js';
import { fetchAndExtract } from '../lib/scan/tarball.js';

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fixture-a');

// In-memory store implementing the tick's store interface.
function memoryStore() {
  const scans = new Map();
  const repos = new Map();
  const flags = [];
  const refs = [];
  const unresolved = [];
  const events = [];
  const repoFlags = [];
  const blobs = new Map();
  let flagSeq = 0;
  return {
    scans, repos, flags, refs, unresolved, events, repoFlags, blobs,
    async claimScan() {
      for (const scan of scans.values()) {
        // Mirrors the real claim RPC minus the 1-minute silence window:
        // a 'cloning' scan is re-claimable (a dead download must retry).
        if (scan.status === 'queued' || scan.status === 'cloning') {
          return { scan_id: scan.id, scan_repo_id: scan.repo_id, scan_owner_id: scan.owner_id, scan_status: scan.status, scan_progress: scan.progress, scan_caps: scan.caps };
        }
      }
      return null;
    },
    async getScan(id) { return scans.get(id) || null; },
    async getRepo(id) { return repos.get(id) || null; },
    async updateScan(id, patch) {
      const scan = scans.get(id);
      Object.assign(scan, patch);
    },
    async getLatestDoneScan() { return null; },
    async getScanFlags() { return []; },
    async getUserStates() { return []; },
    async upsertRepoFlag(row) { repoFlags.push(row); },
    async clearRepoFlagUserStatus() {},
    async insertFlagEvent(row) { events.push(row); },
    async insertFlags(rows) {
      const out = rows.map((r) => ({ ...r, id: `flag-${++flagSeq}` }));
      flags.push(...out);
      return out.map(({ id, key, provider }) => ({ id, key, provider }));
    },
    async insertReferences(rows) { refs.push(...rows); },
    async insertUnresolved(rows) { unresolved.push(...rows); },
    async getSettings() { return null; },
    async getProviderToken() { return null; },
    async storagePut(path, buffer) { blobs.set(path, Buffer.from(buffer)); },
    async storageGet(path) {
      const b = blobs.get(path);
      if (!b) throw new Error('not found: ' + path);
      return b;
    },
    async storageRemove(paths) { for (const p of paths) blobs.delete(p); },
    async heartbeat() {},
  };
}

// A fixture tarball built with the real tar CLI from a directory tree.
// The fetch seam substitutes it for the network download; extraction,
// caps, parsing, age, and finalize all run through the real code.
function tarballOf(dir, topName) {
  const parent = dirname(dir);
  const out = join(mkdtempSync(join(tmpdir(), 'fdc-tb-')), 'fixture.tar.gz');
  execFileSync('tar', ['-czf', out, '-C', parent, topName]);
  return readFileSync(out);
}

// The host API stub: repo metadata for the size check, one commit per
// file for the age step (a single 2025-01-10 commit, so every flag is
// old and untouched, as the old git-age fixture was).
const stubFetch = async (url) => {
  if (url.includes('/commits?path=')) {
    return { status: 200, ok: true, json: async () => [{ commit: { committer: { date: '2025-01-10T10:00:00Z' } } }] };
  }
  return { status: 200, ok: true, json: async () => ({ size: 100, default_branch: 'main' }) };
};

test('one tick scans fixture-a end to end', async () => {
  const tarball = tarballOf(fixtureDir, 'fixture-a');
  const store = memoryStore();
  const repoId = 'repo-1';
  const scanId = 'scan-1';
  store.repos.set(repoId, { id: repoId, host: 'github.com', full_name: 'test/fixture-a' });
  store.scans.set(scanId, {
    id: scanId, repo_id: repoId, owner_id: null, status: 'queued',
    progress: {}, caps: { max_mb: 100, max_files: 10000 }, claim_hash: 'x',
  });
  const result = await tick(store, {
    fetchImpl: stubFetch,
    budgetMs: 60000,
    fetchAndExtract: (args) => fetchAndExtract({ ...args, downloadImpl: async () => tarball }),
  });
  assert.equal(result.status, 'done');
  const scan = store.scans.get(scanId);
  assert.equal(scan.status, 'done');
  // 9 flags: 7 from checkout.js (ignored_flag excluded) + 2 config flags.
  assert.equal(store.flags.length, 9);
  const byKey = new Map(store.flags.map((f) => [f.key, f]));
  assert.equal(byKey.get('static_flag').status, 'stale');
  // Possible, not likely: the dynamic key on line 16 is in the same file,
  // and the same-file rule caps every flag it could touch.
  assert.equal(byKey.get('static_flag').confidence, 'possible');
  assert.equal(byKey.get('new_checkout_enabled').status, 'watch');
  assert.equal(byKey.get('maintenance_mode').status, 'stale');
  assert.equal(byKey.get('json_flag_a').status, 'stale');
  assert.equal(byKey.get('json_flag_a').confidence, 'possible');
  assert.equal(byKey.has('ignored_flag'), false);
  // Rollout unknown everywhere: no provider token, so no diff and "up to N".
  assert.equal(byKey.get('new_checkout_enabled').loc_up_to, true);
  assert.equal(byKey.get('new_checkout_enabled').diff, null);
  assert.ok(byKey.get('new_checkout_enabled').deletable_loc > 0);
  // One unresolved dynamic reference.
  assert.equal(store.unresolved.length, 1);
  assert.equal(store.unresolved[0].reason, 'dynamic_key');
  // Storage artifacts are deleted on finalize.
  assert.equal(store.blobs.size, 0);
});

test('a scan with no JS/TS files fails with the fixed cause', async () => {
  const parent = mkdtempSync(join(tmpdir(), 'fdc-empty-'));
  const dir = join(parent, 'empty');
  mkdirSync(dir);
  writeFileSync(join(dir, 'README.md'), '# hello\n');
  const tarball = tarballOf(dir, 'empty');
  const store = memoryStore();
  store.repos.set('repo-1', { id: 'repo-1', host: 'github.com', full_name: 'test/empty' });
  store.scans.set('scan-1', { id: 'scan-1', repo_id: 'repo-1', owner_id: null, status: 'queued', progress: {}, caps: { max_mb: 100, max_files: 10000 }, claim_hash: 'x' });
  try {
    const result = await tick(store, {
      fetchImpl: stubFetch,
      budgetMs: 60000,
      fetchAndExtract: (args) => fetchAndExtract({ ...args, downloadImpl: async () => tarball }),
    });
    assert.equal(result.status, 'failed');
    assert.equal(result.cause, 'no_js_ts_files');
    assert.equal(store.scans.get('scan-1').error, 'No JavaScript or TypeScript files found in this repo.');
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test('a scan stuck in cloning re-runs the fetch and finishes', async () => {
  // Regression: the fetch block used to run only for 'queued', so a tick
  // that died mid-download left the scan in 'cloning' forever (every
  // re-claim skipped all steps and returned). Seed the scan as the dead
  // tick left it: status 'cloning', one attempt recorded.
  const tarball = tarballOf(fixtureDir, 'fixture-a');
  const store = memoryStore();
  const repoId = 'repo-1';
  const scanId = 'scan-1';
  store.repos.set(repoId, { id: repoId, host: 'github.com', full_name: 'test/fixture-a' });
  store.scans.set(scanId, {
    id: scanId, repo_id: repoId, owner_id: null, status: 'cloning',
    progress: { step: 'cloning', cloning_attempts: 1 }, caps: { max_mb: 100, max_files: 10000 }, claim_hash: 'x',
  });
  const result = await tick(store, {
    fetchImpl: stubFetch,
    budgetMs: 60000,
    fetchAndExtract: (args) => fetchAndExtract({ ...args, downloadImpl: async () => tarball }),
  });
  assert.equal(result.status, 'done');
  assert.equal(store.scans.get(scanId).status, 'done');
  assert.equal(store.flags.length, 9);
  // No cloning_attempts assertion here: finalize overwrites progress with
  // the done summary, so the attempt count only exists mid-scan. The 9
  // flags are the proof the fetch re-ran: without it there is no tarball,
  // no parse, and no flags.
});
