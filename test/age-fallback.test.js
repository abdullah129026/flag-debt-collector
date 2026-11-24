import { test } from 'node:test';
import assert from 'node:assert/strict';
import { approxAgeForFiles, approxAgeForGitLabFiles, MAX_FALLBACK_FILES } from '../lib/scan/age-fallback.js';

const ghCommits = [
  { commit: { committer: { date: '2025-06-15T10:00:00Z' } } },
  { commit: { committer: { date: '2025-01-10T10:00:00Z' } } },
];
const glCommits = [
  { committed_date: '2025-06-15T10:00:00Z' },
  { committed_date: '2025-01-10T10:00:00Z' },
];

test('approxAgeForFiles takes the oldest and newest commit per file', async () => {
  const seen = [];
  const fetch = async (url) => {
    seen.push(url);
    return { ok: true, json: async () => ghCommits };
  };
  const out = await approxAgeForFiles('acme', 'shop', ['src/a.js', 'src/b.js'], fetch);
  assert.deepEqual(out['src/a.js'], { createdAt: '2025-01-10T10:00:00Z', lastChangedAt: '2025-06-15T10:00:00Z', approx: true });
  assert.ok(seen[0].includes('/commits?path=src%2Fa.js'));
});

test('approxAgeForFiles returns null per file the API cannot answer', async () => {
  const fetch = async (url) => {
    if (url.includes('missing.js')) return { ok: false, json: async () => ({}) };
    if (url.includes('empty.js')) return { ok: true, json: async () => [] };
    return { ok: true, json: async () => ghCommits };
  };
  const out = await approxAgeForFiles('acme', 'shop', ['missing.js', 'empty.js', 'src/a.js'], fetch);
  assert.equal(out['missing.js'], null);
  assert.equal(out['empty.js'], null);
  assert.ok(out['src/a.js']);
});

test('approxAgeForFiles caps at 100 files', async () => {
  let calls = 0;
  const fetch = async () => {
    calls += 1;
    return { ok: true, json: async () => ghCommits };
  };
  const files = Array.from({ length: MAX_FALLBACK_FILES + 5 }, (_, i) => `f${i}.js`);
  const out = await approxAgeForFiles('acme', 'shop', files, fetch);
  assert.equal(calls, MAX_FALLBACK_FILES);
  assert.equal(Object.keys(out).length, MAX_FALLBACK_FILES);
});

test('approxAgeForGitLabFiles reads the GitLab commits API', async () => {
  const seen = [];
  const fetch = async (url) => {
    seen.push(url);
    return { ok: true, json: async () => glCommits };
  };
  const out = await approxAgeForGitLabFiles('acme', 'shop', ['src/a.js'], fetch);
  assert.deepEqual(out['src/a.js'], { createdAt: '2025-01-10T10:00:00Z', lastChangedAt: '2025-06-15T10:00:00Z', approx: true });
  assert.ok(seen[0].includes('/repository/commits?path=src%2Fa.js'));
  const bad = await approxAgeForGitLabFiles('acme', 'shop', ['src/a.js'], async () => ({ ok: false, json: async () => ({}) }));
  assert.equal(bad['src/a.js'], null);
});
