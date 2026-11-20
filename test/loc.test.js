import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFileContent } from '../lib/scan/parse.js';
import { applyDeletions, countRemovedLines } from '../lib/scan/loc.js';

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fixture-a');
const code = readFileSync(join(fixtureDir, 'src/checkout.js'), 'utf8');

function sitesFor(key) {
  return parseFileContent(code, 'src/checkout.js', null).sites.filter((s) => s.key === key);
}

test('if guard unwraps the winning branch', () => {
  const { newContent, changed } = applyDeletions(code, sitesFor('new_checkout_enabled'), true);
  assert.equal(changed, true);
  assert.equal(newContent.includes('if (flags.new_checkout_enabled)'), false);
  assert.equal(newContent.includes('return <NewCheckout />;'), true);
});

test('ternary replaces with the winning arm', () => {
  const { newContent } = applyDeletions(code, sitesFor('beta_search').filter((s) => s.shape === 'ternary'), true);
  assert.equal(newContent.includes("const label = 'new search';"), true);
  assert.equal(newContent.includes('old search'), false);
});

test('early-return guard deletes when the flag is always true', () => {
  const { newContent } = applyDeletions(code, sitesFor('maintenance_mode'), true);
  assert.equal(newContent.includes('if (!flags.maintenance_mode) return;'), false);
  assert.equal(newContent.includes('return renderMaintenance();'), true);
});

test('early-return guard keeps the code when the flag is always false', () => {
  const { newContent, changed } = applyDeletions(code, sitesFor('maintenance_mode'), false);
  assert.equal(changed, false);
  assert.equal(newContent, code);
});

test('combined guard produces no deletion', () => {
  const { newContent, changed, skipped } = applyDeletions(code, sitesFor('beta_search').filter((s) => s.shape === 'combined'), true);
  assert.equal(changed, false);
  assert.equal(skipped, 1);
  assert.equal(newContent, code);
});

test('logical guard deletes the guarded expression when always false', () => {
  const { newContent } = applyDeletions(code, sitesFor('promo_banner'), false);
  assert.equal(newContent.includes('flags.promo_banner && <Promo />'), false);
});

test('countRemovedLines counts diff removals, not the header', () => {
  const diff = '--- a/x.js\n+++ b/x.js\n@@ -1,3 +1,2 @@\n context\n-removed\n+added\n';
  assert.equal(countRemovedLines(diff), 1);
});
