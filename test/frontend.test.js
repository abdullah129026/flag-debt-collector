import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultSortFlags,
  sortFlags,
  headlineTotals,
  rolloutText,
  reachableText,
  locText,
  ageDays,
  formatDateTime,
  elapsedText,
  progressPercent,
} from '../src/lib/flags-ui.js';
import { capturePayload } from '../src/lib/analytics.js';
import { parseRepoUrl, FAILURE_MESSAGES } from '../lib/scan/url.js';

const NOW = new Date('2026-11-21T12:00:00Z');
const flag = (over) => ({
  id: over.id || over.key,
  key: over.key,
  provider: 'launchdarkly',
  kind: 'sdk',
  status: 'active',
  confidence: 'definite',
  created_at_git: '2025-09-30T00:00:00Z',
  rollout_pct: 100,
  deletable_loc: 100,
  loc_up_to: false,
  winning_value: true,
  references: [{ kind: 'call' }],
  ...over,
});

test('default sort is status rank, then LOC desc, then age desc', () => {
  const rows = [
    flag({ key: 'old-active', status: 'active', deletable_loc: 50, created_at_git: '2024-01-01T00:00:00Z' }),
    flag({ key: 'stale-big', status: 'stale', deletable_loc: 900 }),
    flag({ key: 'deletable-small', status: 'deletable', deletable_loc: 10 }),
    flag({ key: 'deletable-big', status: 'deletable', deletable_loc: 800 }),
    flag({ key: 'ignored', status: 'ignored', deletable_loc: 5000 }),
  ];
  const sorted = defaultSortFlags(rows, NOW).map((f) => f.key);
  assert.deepEqual(sorted, ['deletable-big', 'deletable-small', 'stale-big', 'old-active', 'ignored']);
});

test('default sort puts flags with no age last within their rank', () => {
  const rows = [
    flag({ key: 'no-age', status: 'stale', created_at_git: null }),
    flag({ key: 'aged', status: 'stale', created_at_git: '2024-01-01T00:00:00Z' }),
  ];
  assert.equal(defaultSortFlags(rows, NOW)[0].key, 'aged');
});

test('column sort uses raw numbers and puts unknown rollout last', () => {
  const rows = [
    flag({ key: 'a', rollout_pct: 25 }),
    flag({ key: 'b', rollout_pct: null }),
    flag({ key: 'c', rollout_pct: 100 }),
  ];
  const asc = sortFlags(rows, [{ sortKey: 'rolloutValue', direction: 'ascending' }], NOW).map((f) => f.key);
  assert.deepEqual(asc, ['a', 'c', 'b']);
  const desc = sortFlags(rows, [{ sortKey: 'rolloutValue', direction: 'descending' }], NOW).map((f) => f.key);
  assert.deepEqual(desc, ['c', 'a', 'b']);
});

test('headline total counts definite and likely with a known winning value only', () => {
  const rows = [
    flag({ key: 'a', status: 'deletable', confidence: 'definite', deletable_loc: 100 }),
    flag({ key: 'b', status: 'stale', confidence: 'likely', deletable_loc: 50 }),
    flag({ key: 'c', status: 'deletable', confidence: 'possible', deletable_loc: 70 }),
    flag({ key: 'd', status: 'deletable', confidence: 'definite', deletable_loc: 30, loc_up_to: true }),
    flag({ key: 'e', status: 'ignored', confidence: 'definite', deletable_loc: 40 }),
    flag({ key: 'f', status: 'removed', confidence: 'definite', deletable_loc: 60 }),
  ];
  const totals = headlineTotals(rows);
  assert.equal(totals.deletableLoc, 150);
  assert.equal(totals.upToLoc, 30);
  assert.equal(totals.deletableFlags, 3);
});

test('rollout reads n/a for env and config flags, unknown without a value', () => {
  assert.equal(rolloutText(flag({ kind: 'env', rollout_pct: null })), 'n/a');
  assert.equal(rolloutText(flag({ kind: 'config', rollout_pct: null })), 'n/a');
  assert.equal(rolloutText(flag({ rollout_pct: null })), 'unknown (no token)');
  assert.equal(rolloutText(flag({ rollout_pct: 25 })), '25%');
});

test('reachability follows production references, then tests only, then none', () => {
  assert.equal(reachableText(flag({})), 'reachable');
  assert.equal(reachableText(flag({ references: [{ kind: 'test' }] })), 'tests only');
  assert.equal(reachableText(flag({ references: [] })), 'not referenced');
});

test('LOC reads up to N when the winning value is unknown', () => {
  assert.equal(locText(flag({ deletable_loc: 1204 })), '1,204');
  assert.equal(locText(flag({ deletable_loc: 1204, loc_up_to: true })), 'up to 1,204');
});

test('age in days counts from the git creation date', () => {
  assert.equal(ageDays(flag({ created_at_git: '2026-11-20T12:00:00Z' }), NOW), 1);
  assert.equal(ageDays(flag({ created_at_git: null }), NOW), null);
});

test('dates render in PKT and elapsed time reads in minutes and seconds', () => {
  assert.equal(formatDateTime('2026-11-18T04:12:00Z'), '2026-11-18, 09:12 PKT');
  assert.equal(elapsedText('2026-11-21T11:58:48Z', NOW.getTime()), '1m 12s');
  assert.equal(elapsedText('2026-11-21T11:59:30Z', NOW.getTime()), '30s');
});

test('progress percent steps through the scan and uses the file fraction while parsing', () => {
  assert.equal(progressPercent({ step: 'queued' }), 0);
  assert.equal(progressPercent({ step: 'cloning' }), 15);
  assert.equal(progressPercent({ step: 'parsing', files_done: 0, files_total: 100 }), 40);
  assert.equal(progressPercent({ step: 'parsing', files_done: 50, files_total: 100 }), 53);
  assert.equal(progressPercent({ step: 'done' }), 100);
});

test('failure copy is fixed text, keyed by cause', () => {
  assert.equal(FAILURE_MESSAGES.private_repo, 'This repo is private. Public repos only in v1.');
  assert.equal(FAILURE_MESSAGES.quota_used, 'You have used 3 anonymous scans today. Quota resets at midnight UTC.');
  assert.equal(parseRepoUrl('https://github.com/acme/shop-web').ok, true);
  assert.equal(parseRepoUrl('').message, 'Paste a repo URL first.');
});

test('analytics payload carries the event and no repo data', () => {
  const { url, body } = capturePayload({
    key: 'phc_test',
    host: 'https://us.i.posthog.com/',
    event: 'scan_completed',
    distinctId: 'anon-1',
    props: { flags: 6, deletable_loc: 2066 },
  });
  assert.equal(url, 'https://us.i.posthog.com/capture/');
  assert.equal(body.event, 'scan_completed');
  assert.equal(body.properties.flags, 6);
  assert.equal(JSON.stringify(body).includes('github.com'), false);
});
