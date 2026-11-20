// Scan tick: one invocation advances one claimed scan as far as the 7s
// budget allows, storing progress so the next tick resumes, never restarts.
// Steps: queued -> cloning -> parsing -> age -> provider -> done (finalize
// runs inside the provider step when budget remains, else the next tick
// re-enters provider and finalizes from the saved state).
// A tick that dies mid-step leaves a fresh heartbeat; the claim RPC only
// re-claims after 1 minute of silence, and every long step refreshes the
// heartbeat, so a live tick is never stolen. (PLAN said 10 minutes; 1 minute
// is what keeps the 5-minute scan budget reachable. See BACKEND.md.)

import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cloneAndBundle, repoFromBundle } from './clone.js';
import { parseFileContent, listJsFiles, parseIgnoreFile } from './parse.js';
import { computeAge } from './age.js';
import { approxAgeForFiles } from './age-fallback.js';
import { fetchRollout } from '../providers/index.js';
import { finalizeScan } from './finalize.js';
import { checkRepoSize, FAILURE_MESSAGES, MAX_FILES } from './url.js';

export const TICK_BUDGET_MS = 7000;
const artifact = (scanId, name) => `scans/${scanId}/${name}`;
const ARTIFACTS = (scanId) => [
  artifact(scanId, 'history.bundle'),
  artifact(scanId, 'parse-state.json'),
  artifact(scanId, 'age-state.json'),
  artifact(scanId, 'provider-state.json'),
];

async function loadState(store, scanId, name) {
  try {
    return JSON.parse((await store.storageGet(artifact(scanId, name))).toString('utf8'));
  } catch {
    return null;
  }
}

async function rebuildRepo(store, scanId, bundleFn) {
  const workDir = mkdtempSync(join(tmpdir(), 'fdc-repo-'));
  const bundle = await store.storageGet(artifact(scanId, 'history.bundle'));
  writeFileSync(join(workDir, 'history.bundle'), bundle);
  const repoDir = await bundleFn(join(workDir, 'history.bundle'), workDir);
  return { workDir, repoDir, cleanup: () => rmSync(workDir, { recursive: true, force: true }) };
}

export async function tick(store, opts = {}) {
  const now = opts.now || new Date();
  const budgetMs = opts.budgetMs || TICK_BUDGET_MS;
  const deadline = Date.now() + budgetMs;
  const fetchImpl = opts.fetchImpl || fetch;
  const ageSource = opts.ageSource || process.env.SCANNER_AGE_SOURCE || 'git';
  // Seams for tests: the clone functions take a URL in production; a test
  // substitutes a local fixture repo for the URL.
  const cloneFn = opts.cloneAndBundle || cloneAndBundle;
  const bundleFn = opts.repoFromBundle || repoFromBundle;

  const claimed = await store.claimScan();
  if (!claimed) return { claimed: false };
  const scan = {
    id: claimed.scan_id,
    repo_id: claimed.scan_repo_id,
    owner_id: claimed.scan_owner_id,
    status: claimed.scan_status,
    progress: claimed.scan_progress || {},
    caps: claimed.scan_caps || {},
  };
  const repo = await store.getRepo(scan.repo_id);
  const [owner, repoName] = (repo.full_name || '/').split('/');
  const heartbeat = async () => store.updateScan(scan.id, { updated_at: new Date().toISOString() });

  const fail = async (cause, message) => {
    await store.updateScan(scan.id, {
      status: 'failed', error: message, finished_at: now.toISOString(),
      updated_at: now.toISOString(), progress: { ...scan.progress, step: 'failed', cause },
    });
    await store.storageRemove(ARTIFACTS(scan.id)).catch(() => {});
    return { claimed: true, scan_id: scan.id, status: 'failed', cause };
  };
  const setStatus = async (status, progress) => {
    scan.status = status;
    scan.progress = { ...scan.progress, ...progress, step: status };
    await store.updateScan(scan.id, { status, progress: scan.progress, updated_at: new Date().toISOString() });
  };

  try {
    // --- cloning ---------------------------------------------------------
    if (scan.status === 'queued') {
      const size = await checkRepoSize(
        { host: repo.host, owner, repo: repoName },
        fetchImpl, process.env.GITHUB_TOKEN,
      );
      if (!size.ok) return fail(size.cause, FAILURE_MESSAGES[size.cause]);
      const attempts = (scan.progress.cloning_attempts || 0) + 1;
      await setStatus('cloning', { cloning_attempts: attempts });
      let cloned;
      try {
        cloned = await cloneFn(`https://${repo.host}/${repo.full_name}`, { onHeartbeat: heartbeat });
      } catch (e) {
        if (e.code === 'over_caps') return fail('over_caps', FAILURE_MESSAGES.over_caps);
        if (e.code === 'clone_timeout' && attempts < 3) {
          await store.updateScan(scan.id, {
            status: 'queued', updated_at: new Date().toISOString(),
            progress: { ...scan.progress, step: 'queued', cloning_attempts: attempts },
          });
          return { claimed: true, scan_id: scan.id, status: 'queued', retry: true };
        }
        return fail(e.code === 'clone_timeout' ? 'clone_timeout' : 'not_found',
          e.code === 'clone_timeout' ? FAILURE_MESSAGES.clone_timeout : FAILURE_MESSAGES.not_found);
      }
      await store.storagePut(artifact(scan.id, 'history.bundle'), readFileSync(cloned.bundlePath));
      const filesTotal = cloned.files;
      cloned.cleanup();
      await setStatus('parsing', { files_done: 0, files_total: filesTotal });
    }

    // --- parsing ---------------------------------------------------------
    let parseState = null;
    if (scan.status === 'parsing') {
      parseState = (await loadState(store, scan.id, 'parse-state.json')) || {
        nextIndex: 0, references: [], sites: [], unresolved: [], configcatKeys: [], filesScanned: 0,
      };
      const { workDir, repoDir, cleanup } = await rebuildRepo(store, scan.id, bundleFn);
      try {
        let ignoreRules = null;
        try {
          ignoreRules = parseIgnoreFile(readFileSync(join(repoDir, '.flagdebtignore'), 'utf8'));
        } catch {
          ignoreRules = null;
        }
        const { files, overCaps } = listJsFiles(repoDir, ignoreRules, (scan.caps && scan.caps.max_files) || MAX_FILES);
        if (overCaps) return fail('over_caps', FAILURE_MESSAGES.over_caps);
        if (files.length === 0) return fail('no_js_ts_files', FAILURE_MESSAGES.no_js_ts_files);
        for (let i = parseState.nextIndex; i < files.length; i++) {
          if (Date.now() > deadline) {
            parseState.nextIndex = i;
            await store.storagePut(artifact(scan.id, 'parse-state.json'), Buffer.from(JSON.stringify(parseState)));
            await setStatus('parsing', { files_done: i, files_total: files.length });
            return { claimed: true, scan_id: scan.id, status: 'parsing', files_done: i, files_total: files.length };
          }
          const rel = files[i];
          const content = readFileSync(join(repoDir, rel), 'utf8');
          const parsed = parseFileContent(content, rel, ignoreRules);
          parseState.filesScanned += 1;
          for (const r of parsed.references) parseState.references.push(r);
          for (const s of parsed.sites) parseState.sites.push({ ...s, file: rel });
          for (const u of parsed.unresolved) parseState.unresolved.push(u);
          for (const k of parsed.configcatKeys) {
            if (!parseState.configcatKeys.includes(k)) parseState.configcatKeys.push(k);
          }
          if (i % 50 === 0) await heartbeat();
        }
        parseState.nextIndex = files.length;
        parseState.filesTotal = files.length;
        parseState.appliedIgnore = ignoreRules ? ignoreRules.rawRules : [];
        await store.storagePut(artifact(scan.id, 'parse-state.json'), Buffer.from(JSON.stringify(parseState)));
        await setStatus('age', { files_done: files.length, files_total: files.length });
      } finally {
        cleanup();
      }
    }

    // --- age -------------------------------------------------------------
    let ageState = null;
    if (scan.status === 'age') {
      parseState = parseState || (await loadState(store, scan.id, 'parse-state.json'));
      const flagKeys = [...new Set((parseState.references || []).map((r) => r.key))];
      const flags = flagKeys.map((key) => ({
        key,
        references: (parseState.references || []).filter((r) => r.key === key),
      }));
      if (ageSource === 'github-api' || opts.gitAvailable === false) {
        const files = [...new Set((parseState.references || []).map((r) => r.file))];
        const approx = await approxAgeForFiles(owner, repoName, files, fetchImpl, process.env.GITHUB_TOKEN);
        ageState = {};
        for (const flag of flags) {
          let created = null;
          let changed = null;
          for (const ref of flag.references) {
            const a = approx[ref.file];
            if (!a) continue;
            if (!created || a.createdAt < created) created = a.createdAt;
            if (!changed || a.lastChangedAt > changed) changed = a.lastChangedAt;
          }
          ageState[flag.key] = { createdAt: created, lastChangedAt: changed, approx: true };
        }
      } else {
        const { workDir, repoDir, cleanup } = await rebuildRepo(store, scan.id, bundleFn);
        try {
          ageState = await computeAge(repoDir, flags);
        } finally {
          cleanup();
        }
      }
      await store.storagePut(artifact(scan.id, 'age-state.json'), Buffer.from(JSON.stringify(ageState)));
      await setStatus('provider', {});
    }

    // --- provider + finalize --------------------------------------------
    if (scan.status === 'provider') {
      parseState = parseState || (await loadState(store, scan.id, 'parse-state.json'));
      ageState = ageState || (await loadState(store, scan.id, 'age-state.json')) || {};
      let providerState = await loadState(store, scan.id, 'provider-state.json');
      if (!providerState) {
        const flags = [...new Map((parseState.references || []).map((r) => [`${r.provider}:${r.key}`, { key: r.key, provider: r.provider }])).values()];
        const settings = (await store.getSettings(scan.owner_id)) || {};
        providerState = await fetchRollout({
          flags, settings,
          tokenGetter: (p) => store.getProviderToken(scan.owner_id, p),
          repoConfigCatKeys: parseState.configcatKeys || [],
          fetchImpl,
        });
        await store.storagePut(artifact(scan.id, 'provider-state.json'), Buffer.from(JSON.stringify(providerState)));
      }
      if (Date.now() > deadline) {
        return { claimed: true, scan_id: scan.id, status: 'provider', waiting: true };
      }
      const { workDir, repoDir, cleanup } = await rebuildRepo(store, scan.id, bundleFn);
      try {
        const result = await finalizeScan(store, scan, repo, repoDir, parseState, ageState, providerState, { now });
        await store.storageRemove(ARTIFACTS(scan.id)).catch(() => {});
        await store.heartbeat().catch(() => {});
        return { claimed: true, scan_id: scan.id, status: 'done', ...result };
      } finally {
        cleanup();
      }
    }

    return { claimed: true, scan_id: scan.id, status: scan.status };
  } catch (e) {
    // A tick that dies unexpectedly leaves the scan in its step with a fresh
    // heartbeat; the next tick re-claims it after 1 minute of silence.
    await store.updateScan(scan.id, { updated_at: new Date().toISOString() }).catch(() => {});
    throw e;
  }
}
