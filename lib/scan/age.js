// Flag age from git history. Creation is the first `git log -S` hit, with a
// `git log -G` pass to catch renames and moves that -S misses. Last change
// comes from one `git blame -w` per file, parsed for every call-site line.
// Git is invoked argv-only via execFile, never through a shell, with a
// timeout per call. No git output is logged (it can contain code).

import { execFile } from 'node:child_process';

export function runGit(repoDir, args, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd: repoDir, timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        const e = new Error(`git ${args[0]} failed: ${stderr.trim().split('\n')[0] || error.message}`);
        e.code = 'git_failed';
        reject(e);
        return;
      }
      resolve(stdout);
    });
  });
}

// First commit that introduced the key, or null. -S counts occurrences, so
// a commit that adds the key in one file and removes it in another nets
// zero; -G (regex on added/removed lines) catches renames and moves.
export async function firstCommitForKey(repoDir, key, run = runGit) {
  let earliest = null;
  for (const flag of ['-S', '-G']) {
    try {
      const out = await run(repoDir, ['log', '--reverse', '--format=%H %cI', flag, key, '--']);
      const first = out.split('\n').find((line) => line.trim());
      if (!first) continue;
      const [sha, date] = first.split(' ');
      const at = new Date(date);
      if (!Number.isNaN(at.getTime()) && (!earliest || at < earliest.date)) {
        earliest = { sha, date: at };
      }
    } catch {
      // One flag failing must not fail the scan; the flag gets created_at null.
    }
  }
  return earliest;
}

// author-time per line for one file, from a single blame. -w ignores
// whitespace-only reformats.
export async function blameLineTimes(repoDir, file, run = runGit) {
  const out = await run(repoDir, ['blame', '-w', '--line-porcelain', '--', file]);
  const times = new Map();
  let line = 0;
  let time = null;
  for (const raw of out.split('\n')) {
    if (raw.startsWith('author-time ')) {
      time = Number(raw.slice('author-time '.length)) * 1000;
    } else if (raw.startsWith('\t')) {
      line += 1;
      if (time !== null) times.set(line, time);
    }
  }
  return times;
}

// Age for a set of flags: {key: {createdAt, lastChangedAt}} where the
// last-changed time is the newest blame time across the flag's call sites.
// A flag with no -S/-G hit gets createdAt null and is capped at possible.
export async function computeAge(repoDir, flags, run = runGit) {
  const byFile = new Map();
  for (const flag of flags) {
    for (const ref of flag.references || []) {
      if (!byFile.has(ref.file)) byFile.set(ref.file, []);
      byFile.get(ref.file).push(ref);
    }
  }
  const blameCache = new Map();
  const out = {};
  for (const flag of flags) {
    const created = await firstCommitForKey(repoDir, flag.key, run);
    let lastChanged = null;
    for (const ref of flag.references || []) {
      if (!blameCache.has(ref.file)) {
        try {
          blameCache.set(ref.file, await blameLineTimes(repoDir, ref.file, run));
        } catch {
          blameCache.set(ref.file, new Map());
        }
      }
      const t = blameCache.get(ref.file).get(ref.line);
      if (t && (!lastChanged || t > lastChanged)) lastChanged = t;
    }
    out[flag.key] = {
      createdAt: created ? created.date.toISOString() : null,
      lastChangedAt: lastChanged ? new Date(lastChanged).toISOString() : null,
    };
  }
  return out;
}
