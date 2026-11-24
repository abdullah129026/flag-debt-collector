// Scan tick: one invocation advances one claimed scan as far as the 7s
// budget allows, storing progress so the next tick resumes, never restarts.
// Steps: queued -> fetching -> parsing -> age -> provider -> done (finalize
// runs inside the provider step when budget remains, else the next tick
// re-enters provider and finalizes from the saved state).
// A tick that dies mid-step leaves a fresh heartbeat; the claim RPC only
// re-claims after 1 minute of silence, and every long step refreshes the
// heartbeat, so a live tick is never stolen. (PLAN said 10 minutes; 1 minute
// is what keeps the 5-minute scan budget reachable. See BACKEND.md.)

import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fetchAndExtract, repoFromTarball } from './tarball.js';
import { parseFileContent, listJsFiles, parseIgnoreFile } from './parse.js';
import { approxAgeForFiles, approxAgeForGitLabFiles } from './age-fallback.js';
import { fetchRollout } from '../providers/index.js';
import { finalizeScan } from './finalize.js';
import { checkRepoSize, FAILURE_MESSAGES, MAX_FILES } from './url.js';

export const TICK_BUDGET_MS = 7000;
const artifact = (scanId, name) => `scans/${scanId}/${name}`;
const ARTIFACTS = (scanId) => [
  artifact(scanId, 'repo.tar.gz'),
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

async function rebuildRepo(store, scanId, extractFn) {
  const workDir = mkdtempSync(join(tmpdir(), 'fdc-repo-'));
  const tarball = await store.storageGet(artifact(scanId, 'repo.tar.gz'));
  const repoDir = await extractFn(tarball, workDir);
  return { workDir, repoDir, cleanup: () => rmSync(workDir, { recursive: true, force: true }) };
}

export async function tick(store, opts = {}) {
  const now = opts.now || new Date();
  const budgetMs = opts.budgetMs || TICK_BUDGET_MS;
  const deadline = Date.now() + budgetMs;
  const fetchImpl = opts.fetchImpl || fetch;
  // Seams for tests: the fetch function takes repo coordinates in
  // production; a test substitutes a local fixture tarball for the download.
  const fetchFn = opts.fetchAndExtract || fetchAndExtract;
  const extractFn = opts.repoFromTarball || repoFromTarball;

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
    // --- fetching --------------------------------------------------------
    // Runs for a queued scan and for a scan stuck in 'cloning': a tick
    // that dies mid-download leaves the scan in 'cloning', and a re-claim
    // must retry the fetch, not skip it (the old code only ran this block
    // for 'queued', so a dead download stuck the scan forever). The
    // 1-minute silence window in claim_scan is the guard against stealing
    // a live download, and the download itself is capped at 6s, well
    // inside the 10s function cap, so a stalled hop aborts cleanly
    // instead of dying silently.
    if (scan.status === 'queued' || scan.status === 'cloning') {
      const size = await checkRepoSize(
        { host: repo.host, owner, repo: repoName },
        fetchImpl, process.env.GITHUB_TOKEN,
      );
      if (!size.ok) return fail(size.cause, FAILURE_MESSAGES[size.cause]);
      const attempts = (scan.progress.cloning_attempts || 0) + 1;
      await setStatus('cloning', { cloning_attempts: attempts });
      let fetched;
      try {
        fetched = await fetchFn({
          host: repo.host, owner, repo: repoName, ref: size.defaultBranch,
          fetchImpl, token: process.env.GITHUB_TOKEN, onHeartbeat: heartbeat,
          timeoutMs: 6000,
        });
      } catch (e) {
        if (e.code === 'over_caps') return fail('over_caps', FAILURE_MESSAGES.over_caps);
        if (e.code === 'download_timeout' && attempts < 3) {
          await store.updateScan(scan.id, {
            status: 'queued', updated_at: new Date().toISOString(),
            progress: { ...scan.progress, step: 'queued', cloning_attempts: attempts },
          });
          return { claimed: true, scan_id: scan.id, status: 'queued', retry: true };
        }
        // Every other fetch failure names its own cause: a missing repo is
        // not_found, a failed download is download_failed. Nothing here
        // falls through to not_found by default.
        const cause = ['not_found', 'private_repo', 'download_failed', 'download_timeout'].includes(e.code)
          ? e.code
          : 'download_failed';
        return fail(cause, FAILURE_MESSAGES[cause]);
      }
      await store.storagePut(artifact(scan.id, 'repo.tar.gz'), fetched.tarballBuffer);
      const filesTotal = fetched.files;
      fetched.cleanup();
      await setStatus('parsing', { files_done: 0, files_total: filesTotal });
    }

    // --- parsing ---------------------------------------------------------
    let parseState = null;
    if (scan.status === 'parsing') {
      parseState = (await loadState(store, scan.id, 'parse-state.json')) || {
        nextIndex: 0, references: [], sites: [], unresolved: [], configcatKeys: [], filesScanned: 0,
        skippedPaths: 0, ignoredFlagKeys: [],
      };
      const { workDir, repoDir, cleanup } = await rebuildRepo(store, scan.id, extractFn);
      try {
        let ignoreRules = null;
        try {
          ignoreRules = parseIgnoreFile(readFileSync(join(repoDir, '.flagdebtignore'), 'utf8'));
        } catch {
          ignoreRules = null;
        }
        const { files, overCaps, skippedByIgnore } = listJsFiles(repoDir, ignoreRules, (scan.caps && scan.caps.max_files) || MAX_FILES);
        if (overCaps) return fail('over_caps', FAILURE_MESSAGES.over_caps);
        if (files.length === 0) return fail('no_js_ts_files', FAILURE_MESSAGES.no_js_ts_files);
        // The file list is deterministic, so the count is the same on resume.
        parseState.skippedPaths = skippedByIgnore || 0;
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
          for (const k of parsed.skippedFlagKeys || []) {
            if (!parseState.ignoredFlagKeys.includes(k)) parseState.ignoredFlagKeys.push(k);
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
      // No git in the runtime, so age always comes from the host API: the
      // GitHub commits list per file, or the GitLab equivalent. Ages are
      // "approx", rename detection is off, and flags cap at possible
      // confidence (see BACKEND.md). The SCANNER_AGE_SOURCE variable no
      // longer selects anything; it stays set to github-api as the
      // recorded mode.
      const files = [...new Set((parseState.references || []).map((r) => r.file))];
      // One commits-list call per file, sequential. Each call is capped at
      // 3s and the loop stops at the tick deadline (leaving 500ms to store
      // state), so a slow host API yields partial ages instead of killing
      // the tick: files not reached stay unknown and the scan still
      // finishes. The age step re-runs from parse-state on re-claim, so a
      // killed tick is recoverable either way.
      const approx = repo.host === 'gitlab.com'
        ? await approxAgeForGitLabFiles(owner, repoName, files, fetchImpl, { deadlineMs: deadline - 500 })
        : await approxAgeForFiles(owner, repoName, files, fetchImpl, process.env.GITHUB_TOKEN, { deadlineMs: deadline - 500 });
      const source = repo.host === 'gitlab.com' ? 'gitlab-api' : 'github-api';
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
        ageState[flag.key] = { createdAt: created, lastChangedAt: changed, approx: true, source };
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
      const { workDir, repoDir, cleanup } = await rebuildRepo(store, scan.id, extractFn);
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
