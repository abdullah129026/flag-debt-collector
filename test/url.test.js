import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRepoUrl, checkRepoSize } from '../lib/scan/url.js';

test('parseRepoUrl accepts a plain github url', () => {
  const r = parseRepoUrl('https://github.com/acme/shop-web');
  assert.equal(r.ok, true);
  assert.equal(r.host, 'github.com');
  assert.equal(r.fullName, 'acme/shop-web');
  assert.equal(r.url, 'https://github.com/acme/shop-web');
});

test('parseRepoUrl strips .git and trailing slash, tolerates www', () => {
  assert.equal(parseRepoUrl('https://github.com/acme/shop-web.git').ok, true);
  assert.equal(parseRepoUrl('https://github.com/acme/shop-web/').repo, 'shop-web');
  assert.equal(parseRepoUrl('https://www.gitlab.com/acme/shop').host, 'gitlab.com');
});

test('parseRepoUrl rejects bad input with the fixed causes', () => {
  assert.equal(parseRepoUrl('').cause, 'not_found');
  assert.equal(parseRepoUrl('not a url').cause, 'not_found');
  assert.equal(parseRepoUrl('http://github.com/acme/shop').cause, 'non_allowlisted_host');
  assert.equal(parseRepoUrl('https://bitbucket.org/acme/shop').cause, 'non_allowlisted_host');
  assert.equal(parseRepoUrl('https://github.com/acme').cause, 'not_found');
  assert.equal(parseRepoUrl('https://github.com/acme/shop/extra').cause, 'not_found');
  assert.equal(parseRepoUrl('https://user:pass@github.com/acme/shop').cause, 'non_allowlisted_host');
  assert.equal(parseRepoUrl('https://github.com:8443/acme/shop').cause, 'non_allowlisted_host');
});

const stubFetch = (status, body) => async () => ({
  status,
  ok: status >= 200 && status < 300,
  json: async () => body,
});

test('checkRepoSize reads the github size field', async () => {
  const r = await checkRepoSize({ host: 'github.com', owner: 'acme', repo: 'shop' }, stubFetch(200, { size: 51200 }));
  assert.equal(r.ok, true);
  assert.equal(r.sizeMb, 50);
});

test('checkRepoSize fails fast over the cap and on 404', async () => {
  const over = await checkRepoSize({ host: 'github.com', owner: 'acme', repo: 'big' }, stubFetch(200, { size: 200 * 1024 }));
  assert.deepEqual(over, { ok: false, cause: 'over_caps' });
  const missing = await checkRepoSize({ host: 'github.com', owner: 'acme', repo: 'nope' }, stubFetch(404, {}));
  assert.deepEqual(missing, { ok: false, cause: 'not_found' });
});

test('checkRepoSize returns unknown when the api cannot answer', async () => {
  const r = await checkRepoSize({ host: 'github.com', owner: 'acme', repo: 'shop' }, async () => { throw new Error('down'); });
  assert.deepEqual(r, { ok: true, unknown: true });
  const r2 = await checkRepoSize({ host: 'github.com', owner: 'acme', repo: 'shop' }, stubFetch(500, {}));
  assert.deepEqual(r2, { ok: true, unknown: true });
});
