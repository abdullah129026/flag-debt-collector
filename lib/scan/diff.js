// Deletion diff via real git: write the modified content, take `git diff`,
// restore the file, then prove the diff applies with `git apply --check`
// before it is stored. A diff that came from git applies by construction;
// the check is the belt and braces the PLAN requires.

import { execFile } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { countRemovedLines } from './loc.js';

function run(repoDir, args, input) {
  return new Promise((resolve, reject) => {
    const child = execFile('git', args, { cwd: repoDir, timeout: 15000, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`git ${args[0]} failed: ${(stderr || '').trim().split('\n')[0] || error.message}`));
        return;
      }
      resolve(stdout);
    });
    if (input !== undefined) {
      child.stdin.end(input);
    }
  });
}

// Returns {diff, removed} or null when the content is unchanged.
export async function makeDiff(repoDir, relPath, newContent, originalContent) {
  if (newContent === originalContent) return null;
  const full = join(repoDir, relPath);
  writeFileSync(full, newContent);
  try {
    const diff = await run(repoDir, ['diff', '--', relPath]);
    await run(repoDir, ['checkout', '--', relPath]);
    await run(repoDir, ['apply', '--check', '-'], diff);
    return { diff, removed: countRemovedLines(diff) };
  } catch (e) {
    try {
      await run(repoDir, ['checkout', '--', relPath]);
    } catch {
      // Already restored or never changed; the original error stands.
    }
    throw e;
  }
}
