import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeDiff } from '../lib/scan/diff.js';
import { parseFileContent } from '../lib/scan/parse.js';
import { applyDeletions } from '../lib/scan/loc.js';

// Minimal unified-diff applier (test only): proves the generated diff
// reproduces the new content when applied to the original. Covers the
// cases where both files end with a newline, which is every file the
// scanner deletes from.
function applyDiff(original, diff) {
  const lines = original === '' ? [] : original.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  const out = [];
  let pos = 0;
  for (const line of diff.split('\n')) {
    if (line.startsWith('@@')) {
      const m = /@@ -(\d+),?\d* \+(\d+),?\d* @@/.exec(line);
      const target = Number(m[1]) === 0 ? 0 : Number(m[1]) - 1;
      while (pos < target) { out.push(lines[pos]); pos += 1; }
      continue;
    }
    if (line.startsWith('diff ') || line.startsWith('---') || line.startsWith('+++') || line === '' || line.startsWith('\\')) continue;
    if (line.startsWith(' ')) { out.push(lines[pos]); pos += 1; }
    else if (line.startsWith('-')) { pos += 1; }
    else if (line.startsWith('+')) { out.push(line.slice(1)); }
  }
  while (pos < lines.length) { out.push(lines[pos]); pos += 1; }
  return out.join('\n') + '\n';
}

const CODE = "import { useFlags } from 'launchdarkly-react-client-sdk';\nexport function Page() {\n  const flags = useFlags();\n  if (flags.new_checkout_enabled) {\n    return <NewCheckout />;\n  }\n  return <OldCheckout />;\n}\n";

test('generated diff for a flag deletion applies back to the original', () => {
  const parsed = parseFileContent(CODE, 'page.js', null);
  const sites = parsed.sites.filter((s) => s.key === 'new_checkout_enabled');
  assert.equal(sites.length, 1);
  assert.equal(sites[0].shape, 'if');
  const { newContent } = applyDeletions(CODE, sites, true);
  const made = makeDiff('page.js', newContent, CODE);
  assert.ok(made);
  assert.ok(made.diff.startsWith('diff --git'));
  assert.ok(made.removed > 0);
  assert.equal(made.diff.includes('new_checkout_enabled'), true);
  assert.equal(applyDiff(CODE, made.diff), newContent);
});

test('makeDiff splits far-apart changes into two hunks', () => {
  const a = ['l1', 'l2', 'l3', 'l4', 'l5', 'l6', 'l7', 'l8', 'l9', 'l10', 'l11', 'l12', 'l13', 'l14', 'l15'].join('\n') + '\n';
  const b = ['l1', 'CHANGED', 'l3', 'l4', 'l5', 'l6', 'l7', 'l8', 'l9', 'l10', 'l11', 'l12', 'l13', 'l14', 'CHANGED2'].join('\n') + '\n';
  const made = makeDiff('f.js', b, a);
  assert.equal((made.diff.match(/^@@/gm) || []).length, 2);
  assert.equal(applyDiff(a, made.diff), b);
});

test('makeDiff handles insertion-only and unchanged content', () => {
  const a = 'one\ntwo\n';
  const b = 'one\ntwo\nthree\n';
  const made = makeDiff('f.js', b, a);
  assert.ok(made);
  assert.equal(made.removed, 0);
  assert.equal(applyDiff(a, made.diff), b);
  assert.equal(makeDiff('f.js', a, a), null);
});

test('makeDiff marks a missing trailing newline', () => {
  const a = 'one\ntwo';
  const b = 'one\nthree';
  const made = makeDiff('f.js', b, a);
  assert.ok(made.diff.includes('\\ No newline at end of file'));
  assert.ok(made.diff.includes('-two'));
  assert.ok(made.diff.includes('+three'));
});
