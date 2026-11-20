import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, cpSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tick } from '../lib/scan/tick.js';
import { cloneAndBundle } from '../lib/scan/clone.js';

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
        if (scan.status === 'queued') {
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

function buildFixtureRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'fdc-tick-'));
  const git = (args, env) => execFileSync('git', args, { cwd: dir, env: { ...process.env, ...env } });
  git(['init', '-q']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'Test']);
  cpSync(join(fixtureDir, 'src'), join(dir, 'src'), { recursive: true });
  cpSync(join(fixtureDir, 'flags.json'), join(dir, 'flags.json'));
  cpSync(join(fixtureDir, '.flagdebtignore'), join(dir, '.flagdebtignore'));
  const old = { GIT_AUTHOR_DATE: '2025-01-10T10:00:00Z', GIT_COMMITTER_DATE: '2025-01-10T10:00:00Z' };
  git(['add', '.']);
  git(['commit', '-qm', 'fixture'], old);
  return dir;
}

const stubFetch = async () => ({ status: 200, ok: true, json: async () => ({ size: 100 }) });

test('one tick scans fixture-a end to end', async () => {
  const repoDir = buildFixtureRepo();
  const store = memoryStore();
  const repoId = 'repo-1';
  const scanId = 'scan-1';
  store.repos.set(repoId, { id: repoId, host: 'github.com', full_name: 'test/fixture-a' });
  store.scans.set(scanId, {
    id: scanId, repo_id: repoId, owner_id: null, status: 'queued',
    progress: {}, caps: { max_mb: 100, max_files: 10000 }, claim_hash: 'x',
  });
  try {
    const result = await tick(store, {
      fetchImpl: stubFetch,
      budgetMs: 60000,
      cloneAndBundle: (_url, opts) => cloneAndBundle(repoDir, opts),
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
  } finally {
    rmSync(repoDir, { recursive: true, force: true });
  }
});

test('a scan with no JS/TS files fails with the fixed cause', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fdc-empty-'));
  const git = (args, env) => execFileSync('git', args, { cwd: dir, env: { ...process.env, ...env } });
  git(['init', '-q']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'Test']);
  writeFileSync(join(dir, 'README.md'), '# hello\n');
  git(['add', '.']);
  git(['commit', '-qm', 'readme'], { GIT_AUTHOR_DATE: '2025-01-10T10:00:00Z', GIT_COMMITTER_DATE: '2025-01-10T10:00:00Z' });
  const store = memoryStore();
  store.repos.set('repo-1', { id: 'repo-1', host: 'github.com', full_name: 'test/empty' });
  store.scans.set('scan-1', { id: 'scan-1', repo_id: 'repo-1', owner_id: null, status: 'queued', progress: {}, caps: { max_mb: 100, max_files: 10000 }, claim_hash: 'x' });
  try {
    const result = await tick(store, {
      fetchImpl: stubFetch,
      budgetMs: 60000,
      cloneAndBundle: (_url, opts) => cloneAndBundle(dir, opts),
    });
    assert.equal(result.status, 'failed');
    assert.equal(result.cause, 'no_js_ts_files');
    assert.equal(store.scans.get('scan-1').error, 'No JavaScript or TypeScript files found in this repo.');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
