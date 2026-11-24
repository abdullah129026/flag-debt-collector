import { test } from 'node:test';
import assert from 'node:assert/strict';
import { headlineCounts } from '../lib/db-api.js';

const flag = (over) => ({ status: 'active', confidence: 'possible', deletable_loc: 0, loc_up_to: false, ...over });

test('headlineCounts counts the headline total only from definite and likely flags', () => {
  const rows = [
    flag({ status: 'deletable', confidence: 'definite', deletable_loc: 50 }),
    flag({ status: 'deletable', confidence: 'likely', deletable_loc: 30 }),
    flag({ status: 'stale', confidence: 'possible', deletable_loc: 20, loc_up_to: true }),
    flag({ status: 'deletable', confidence: 'definite', deletable_loc: 99, loc_up_to: true }),
    flag({ status: 'ignored', confidence: 'definite', deletable_loc: 40 }),
    flag({ status: 'deletable', confidence: 'uncertain', deletable_loc: 10 }),
  ];
  assert.deepEqual(headlineCounts(rows), { flags: 6, deletable: 4, deletable_loc: 80, up_to_loc: 119 });
});

test('headlineCounts is empty-safe', () => {
  assert.deepEqual(headlineCounts([]), { flags: 0, deletable: 0, deletable_loc: 0, up_to_loc: 0 });
  assert.deepEqual(headlineCounts(null), { flags: 0, deletable: 0, deletable_loc: 0, up_to_loc: 0 });
});
