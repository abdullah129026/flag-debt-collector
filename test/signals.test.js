import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeSignals, evaluateFlag, isKillSwitchKey } from '../lib/scan/signals.js';

const NOW = new Date('2026-11-20T00:00:00Z');
const OLD = '2025-01-10T10:00:00Z';
const OLD_UNTOUCHED = '2025-02-01T10:00:00Z';
const RECENT = '2026-11-01T10:00:00Z';

const refs = (n, kinds = ['call']) =>
  Array.from({ length: n }, (_, i) => ({ file: 'a.js', line: i + 1, refKind: kinds[i % kinds.length] }));

test('three signals is deletable and definite', () => {
  const out = evaluateFlag({
    key: 'new_checkout', kind: 'sdk', references: refs(1),
    unresolvedTouch: false,
    age: { createdAt: OLD, lastChangedAt: OLD_UNTOUCHED },
    rollout: { pct: 100 }, winningValue: true, now: NOW,
  });
  assert.deepEqual(out.signals, { settled_rollout: true, old_untouched: true, narrow_quiet: true });
  assert.equal(out.status, 'deletable');
  assert.equal(out.confidence, 'definite');
});

test('two signals is stale and likely', () => {
  const out = evaluateFlag({
    key: 'new_checkout', kind: 'sdk', references: refs(1),
    unresolvedTouch: false,
    age: { createdAt: OLD, lastChangedAt: OLD_UNTOUCHED },
    rollout: { pct: 25 }, winningValue: null, now: NOW,
  });
  assert.equal(out.status, 'stale');
  assert.equal(out.confidence, 'likely');
});

test('one recently touched call site resets the old-and-untouched clock', () => {
  const out = evaluateFlag({
    key: 'new_checkout', kind: 'sdk', references: refs(3),
    unresolvedTouch: false,
    age: { createdAt: OLD, lastChangedAt: RECENT },
    rollout: { pct: 100 }, winningValue: true, now: NOW,
  });
  assert.equal(out.signals.old_untouched, false);
  assert.equal(out.status, 'watch');
});

test('env flags never earn the rollout signal and cap at stale', () => {
  const out = evaluateFlag({
    key: 'ENABLE_X', kind: 'env', references: refs(1),
    unresolvedTouch: false,
    age: { createdAt: OLD, lastChangedAt: OLD_UNTOUCHED },
    rollout: { pct: 100 }, winningValue: true, now: NOW,
  });
  assert.equal(out.signals.settled_rollout, false);
  // Env flags top out at two signals, so the status is Stale on signals
  // alone; the cap is recorded as a reason only when it changes the outcome.
  assert.equal(out.status, 'stale');
  assert.equal(out.capReason, null);
});

test('kill-switch name caps at stale unless overridden', () => {
  assert.equal(isKillSwitchKey('killswitch_payments'), true);
  assert.equal(isKillSwitchKey('new_checkout'), false);
  const capped = evaluateFlag({
    key: 'maintenance_mode', kind: 'sdk', references: refs(1),
    unresolvedTouch: false,
    age: { createdAt: OLD, lastChangedAt: OLD_UNTOUCHED },
    rollout: { pct: 100, temporary: false }, winningValue: true, now: NOW,
  });
  assert.equal(capped.status, 'stale');
  assert.equal(capped.capReason, 'kill_switch');
  const overridden = evaluateFlag({
    key: 'maintenance_mode', kind: 'sdk', references: refs(1),
    unresolvedTouch: false,
    age: { createdAt: OLD, lastChangedAt: OLD_UNTOUCHED },
    rollout: { pct: 100, temporary: false }, winningValue: true, now: NOW,
    userState: { cap_override: true },
  });
  assert.equal(overridden.status, 'deletable');
});

test('unresolved reference caps confidence at possible', () => {
  const out = evaluateFlag({
    key: 'new_checkout', kind: 'sdk', references: refs(1),
    unresolvedTouch: true,
    age: { createdAt: OLD, lastChangedAt: OLD_UNTOUCHED },
    rollout: { pct: 100 }, winningValue: true, now: NOW,
  });
  assert.equal(out.status, 'deletable');
  assert.equal(out.confidence, 'possible');
});

test('tests-only references earn the narrow signal', () => {
  const signals = computeSignals({
    kind: 'sdk', references: refs(2, ['test']), age: { createdAt: RECENT, lastChangedAt: RECENT },
    rollout: { pct: 10 }, now: NOW,
  });
  assert.equal(signals.narrow_quiet, true);
  assert.equal(signals.settled_rollout, false);
  assert.equal(signals.old_untouched, false);
});

test('no evidence is uncertain, never deletable', () => {
  const out = evaluateFlag({
    key: 'fresh_flag', kind: 'sdk', references: refs(3),
    unresolvedTouch: false,
    age: { createdAt: RECENT, lastChangedAt: RECENT },
    rollout: { pct: 10 }, winningValue: null, now: NOW,
  });
  assert.equal(out.status, 'active');
  assert.equal(out.confidence, 'uncertain');
});
