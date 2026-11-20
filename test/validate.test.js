import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isEmail, isUuid, isIntInRange, isNonEmptyString, sha256 } from '../lib/validate.js';

test('email validation', () => {
  assert.equal(isEmail('a@b.co'), true);
  assert.equal(isEmail('not-an-email'), false);
  assert.equal(isEmail('a@b'), false);
  assert.equal(isEmail(''), false);
});

test('uuid validation', () => {
  assert.equal(isUuid('16b7e3e5-eb7e-4253-b455-3af04ee0ed18'), true);
  assert.equal(isUuid('not-a-uuid'), false);
});

test('int range', () => {
  assert.equal(isIntInRange(90, 1, 365), true);
  assert.equal(isIntInRange(0, 1, 365), false);
  assert.equal(isIntInRange(90.5, 1, 365), false);
  assert.equal(isIntInRange('90', 1, 365), false);
});

test('non-empty string', () => {
  assert.equal(isNonEmptyString('kill switch'), true);
  assert.equal(isNonEmptyString('   '), false);
  assert.equal(isNonEmptyString(''), false);
});

test('sha256 is stable hex', () => {
  assert.equal(sha256('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.notEqual(sha256('abc'), sha256('abd'));
});
