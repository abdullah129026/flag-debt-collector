import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFileContent, parseIgnoreFile, listJsFiles, ignoreMatch, globToRegex } from '../lib/scan/parse.js';

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fixture-a');

function parseFixture(rel, ignore) {
  return parseFileContent(readFileSync(join(fixtureDir, rel), 'utf8'), rel, ignore);
}

test('parser finds import-verified LaunchDarkly refs and guard shapes', () => {
  const out = parseFixture('src/checkout.js', null);
  const refs = out.references.map((r) => `${r.key}|${r.provider}|${r.kind}|${r.line}`).sort();
  assert.deepEqual(refs, [
    'ENABLE_LEGACY_BILLING|env|env|53',
    'beta_search|launchdarkly|sdk|23',
    'beta_search|launchdarkly|sdk|46',
    'ignored_flag|launchdarkly|sdk|17',
    'maintenance_mode|launchdarkly|sdk|40',
    'new_checkout_enabled|launchdarkly|sdk|7',
    'new_checkout_enabled|launchdarkly|sdk|24',
    'old_banner|launchdarkly|sdk|31',
    'old_banner|launchdarkly|sdk|32',
    'promo_banner|launchdarkly|sdk|27',
    'static_flag|launchdarkly|sdk|13',
  ].sort());
  const sites = out.sites.map((s) => `${s.key}|${s.shape}|${s.stmt.start.line}`).sort();
  assert.deepEqual(sites, [
    'ENABLE_LEGACY_BILLING|if|53',
    'beta_search|combined|46',
    'beta_search|ternary|23',
    'maintenance_mode|early-return|40',
    'new_checkout_enabled|if|24',
    'old_banner|if|32',
    'promo_banner|logical|27',
  ].sort());
});

test('dynamic keys are unresolved, never guessed', () => {
  const out = parseFixture('src/checkout.js', null);
  assert.equal(out.references.some((r) => r.key.includes('dynamic')), false);
  assert.deepEqual(out.unresolved, [{ file: 'src/checkout.js', line: 16, reason: 'dynamic_key' }]);
});

test('a variable-held variation result is a call site, not a guard', () => {
  const out = parseFixture('src/checkout.js', null);
  // if (enabled) at line 8 creates no site: the parser does not do dataflow.
  assert.equal(out.sites.some((s) => s.stmt.start.line === 8), false);
  assert.equal(out.references.some((r) => r.key === 'new_checkout_enabled' && r.line === 7), true);
});

test('config-file flags come from flags.json', () => {
  const out = parseFixture('flags.json', null);
  assert.deepEqual(
    out.references.map((r) => `${r.key}|${r.provider}|${r.kind}`).sort(),
    ['json_flag_a|config|config', 'json_flag_b|config|config'],
  );
});

test('.flagdebtignore excludes by key and by path glob', () => {
  const rules = parseIgnoreFile(readFileSync(join(fixtureDir, '.flagdebtignore'), 'utf8'));
  assert.equal(rules.flagKeys.has('ignored_flag'), true);
  assert.equal(ignoreMatch('src/ignored/old.js', rules), true);
  assert.equal(ignoreMatch('src/checkout.js', rules), false);
  assert.equal(globToRegex('src/ignored/**').test('src/ignored/deep/x.js'), true);
  assert.equal(globToRegex('*.test.js').test('src/x.test.js'), false);

  const out = parseFixture('src/checkout.js', rules);
  assert.equal(out.references.some((r) => r.key === 'ignored_flag'), false);
  const { files } = listJsFiles(fixtureDir, rules);
  assert.equal(files.includes('src/ignored/old.js'), false);
  assert.equal(files.includes('src/checkout.js'), true);
  assert.equal(files.includes('flags.json'), true);
});

test('unparseable file is recorded, not fatal', () => {
  const out = parseFileContent('const x = {{{', 'src/broken.js', null);
  assert.equal(out.unparseable, true);
  assert.deepEqual(out.unresolved, [{ file: 'src/broken.js', line: 1, reason: 'unparseable' }]);
  assert.deepEqual(out.references, []);
});

test('name-only calls without an SDK import are not flags', () => {
  const code = `
    function variation(name) { return true; }
    const x = variation('not_a_flag');
    const y = obj.isEnabled('also_not_a_flag');
  `;
  const out = parseFileContent(code, 'src/plain.js', null);
  assert.deepEqual(out.references, []);
  assert.deepEqual(out.unresolved, []);
});

test('a flags.json holding an OpenAPI doc yields no config flags', () => {
  const openapi = JSON.stringify({
    openapi: '3.0.0',
    info: { title: 'API', version: '1.0.0' },
    servers: [{ url: 'https://example.com' }],
    paths: { '/x': { get: { responses: {} } } },
    tags: [],
  });
  assert.deepEqual(parseFileContent(openapi, 'Specs/flags.json', null).references, []);
  // A bare boolean map in the same filename still counts.
  const bare = JSON.stringify({ dark_mode: true, new_ui: { enabled: true, percentage: 50 } });
  assert.deepEqual(
    parseFileContent(bare, 'flags.json', null).references.map((r) => r.key).sort(),
    ['dark_mode', 'new_ui'],
  );
});
