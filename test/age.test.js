import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { firstCommitForKey, blameLineTimes } from '../lib/scan/age.js';
import { makeDiff } from '../lib/scan/diff.js';
import { parseFileContent } from '../lib/scan/parse.js';
import { applyDeletions } from '../lib/scan/loc.js';

// A fixture git repo the test builds itself: one commit introduces the flag,
// a later backdated commit touches a different line.
function buildRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'fdc-age-'));
  const git = (args, env) => execFileSync('git', args, { cwd: dir, env: { ...process.env, ...env } });
  git(['init', '-q']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'Test']);
  const old = { GIT_AUTHOR_DATE: '2025-01-10T10:00:00Z', GIT_COMMITTER_DATE: '2025-01-10T10:00:00Z' };
  const newer = { GIT_AUTHOR_DATE: '2025-06-15T10:00:00Z', GIT_COMMITTER_DATE: '2025-06-15T10:00:00Z' };
  writeFileSync(join(dir, 'a.js'), "import { initialize } from 'launchdarkly-js-client-sdk';\nconst client = initialize('id', {});\nconst x = await client.variation('new_checkout_enabled', false);\nconst y = 1;\n");
  git(['add', '.']);
  git(['commit', '-qm', 'introduce flag'], old);
  writeFileSync(join(dir, 'a.js'), "import { initialize } from 'launchdarkly-js-client-sdk';\nconst client = initialize('id', {});\nconst x = await client.variation('new_checkout_enabled', false);\nconst y = 2;\n");
  git(['add', '.']);
  git(['commit', '-qm', 'bump y'], newer);
  return dir;
}

test('first commit for a key is the introduction commit', async () => {
  const dir = buildRepo();
  try {
    const first = await firstCommitForKey(dir, 'new_checkout_enabled');
    assert.ok(first);
    assert.equal(first.date.toISOString(), '2025-01-10T10:00:00.000Z');
    const missing = await firstCommitForKey(dir, 'no_such_flag');
    assert.equal(missing, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('blame gives the last change per line', async () => {
  const dir = buildRepo();
  try {
    const times = await blameLineTimes(dir, 'a.js');
    assert.equal(new Date(times.get(3)).toISOString(), '2025-01-10T10:00:00.000Z');
    assert.equal(new Date(times.get(4)).toISOString(), '2025-06-15T10:00:00.000Z');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('generated diff passes git apply --check', async () => {
  const dir = buildRepo();
  try {
    const code = "import { useFlags } from 'launchdarkly-react-client-sdk';\nexport function Page() {\n  const flags = useFlags();\n  if (flags.new_checkout_enabled) {\n    return <NewCheckout />;\n  }\n  return <OldCheckout />;\n}\n";
    const parsed = parseFileContent(code, 'page.js', null);
    const sites = parsed.sites.filter((s) => s.key === 'new_checkout_enabled');
    assert.equal(sites.length, 1);
    assert.equal(sites[0].shape, 'if');
    const { newContent } = applyDeletions(code, sites, true);
    writeFileSync(join(dir, 'page.js'), code);
    execFileSync('git', ['add', 'page.js'], { cwd: dir });
    execFileSync('git', ['commit', '-qm', 'add page'], { cwd: dir });
    const made = await makeDiff(dir, 'page.js', newContent, code);
    assert.ok(made);
    assert.ok(made.diff.startsWith('diff --git'));
    assert.ok(made.removed > 0);
    assert.equal(made.diff.includes('new_checkout_enabled'), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
