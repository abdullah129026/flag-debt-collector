// Clone step: git clone --filter=blob:none, then a git bundle of HEAD so a
// later tick can rebuild the repo (files + history) from one durable object
// in Storage. Nothing is assumed to survive in /tmp between ticks.
// Git is invoked argv-only via execFile, never through a shell, and never
// with --recurse-submodules (CVE-2026-111760).

import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MAX_MB, MAX_FILES } from './url.js';

export function runGit(dir, args, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd: dir, timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        const e = new Error(`git ${args[0]} failed: ${(stderr || '').trim().split('\n')[0] || error.message}`);
        e.code = error.killed ? 'clone_timeout' : 'git_failed';
        reject(e);
        return;
      }
      resolve(stdout);
    });
  });
}

function measureTree(dir) {
  let bytes = 0;
  let files = 0;
  const walkDir = (d) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      if (entry.name === '.git') continue;
      const full = join(d, entry.name);
      if (entry.isDirectory()) walkDir(full);
      else if (entry.isFile()) {
        files += 1;
        bytes += statSync(full).size;
      }
    }
  };
  walkDir(dir);
  return { bytes, files };
}

// Clone a repo and persist a bundle. Returns {workDir, bundlePath, files,
// sizeMb, cleanup}. The caller uploads the bundle to Storage, then calls
// cleanup. Throws an error with code 'clone_timeout' or 'over_caps' (mapped
// to the fixed failure taxonomy by the tick) or 'git_failed'.
export async function cloneAndBundle(url, { onHeartbeat } = {}) {
  const workDir = mkdtempSync(join(tmpdir(), 'fdc-clone-'));
  const repoDir = join(workDir, 'repo');
  const bundlePath = join(workDir, 'history.bundle');
  const cleanup = () => rmSync(workDir, { recursive: true, force: true });
  try {
    await runGit(workDir, ['clone', '--filter=blob:none', '--no-checkout', url, repoDir], 90000);
    if (onHeartbeat) await onHeartbeat();
    await runGit(repoDir, ['checkout', 'HEAD'], 90000);
    if (onHeartbeat) await onHeartbeat();
    const { bytes, files } = measureTree(repoDir);
    const sizeMb = bytes / (1024 * 1024);
    if (sizeMb > MAX_MB || files > MAX_FILES) {
      const e = new Error('over caps');
      e.code = 'over_caps';
      throw e;
    }
    await runGit(repoDir, ['bundle', 'create', bundlePath, 'HEAD'], 60000);
    return { workDir, repoDir, bundlePath, files, sizeMb, cleanup };
  } catch (e) {
    cleanup();
    throw e;
  }
}

// Rebuild a working repo from a bundle file: clone from the bundle, check
// out HEAD. Returns the repo dir. The caller owns cleanup of workDir.
export async function repoFromBundle(bundlePath, workDir) {
  const repoDir = join(workDir, 'repo');
  await runGit(workDir, ['clone', '-q', bundlePath, repoDir], 60000);
  await runGit(repoDir, ['checkout', '-q', 'HEAD'], 60000);
  return repoDir;
}
