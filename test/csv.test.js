import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toCsv } from '../lib/csv.js';

test('csv quotes commas, quotes, and newlines', () => {
  const out = toCsv(['flag', 'note'], [
    ['new_checkout', 'plain'],
    ['weird,flag', 'has "quotes" and\nnewline'],
    ['x', null],
  ]);
  assert.equal(
    out,
    'flag,note\r\nnew_checkout,plain\r\n"weird,flag","has ""quotes"" and\nnewline"\r\nx,\r\n',
  );
});
