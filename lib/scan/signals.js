// Staleness signals, status, and confidence. Pure: no IO, no dates from the
// outside except `now`, so tests pin the clock.
// Rules (PLAN 0.1, as corrected by the design-copy gate): a flag needs 2
// signals to be Stale and 3 to be Deletable. Env and config flags can never
// earn the rollout signal and cap at Stale. A kill-switch flag (provider
// non-temporary, or a key on the name list) caps at Stale unless the user
// overrides the cap. An unresolved reference caps confidence at possible.

export const KILL_SWITCH_NAMES = ['kill', 'killswitch', 'emergency', 'maintenance', 'circuit-breaker'];
export const DEFAULT_STALENESS_DAYS = 90;

const DAY_MS = 24 * 60 * 60 * 1000;

export function isKillSwitchKey(key) {
  const lower = (key || '').toLowerCase();
  return KILL_SWITCH_NAMES.some((name) => lower.includes(name));
}

function daysAgo(date, now) {
  return (now - new Date(date).getTime()) / DAY_MS;
}

// rollout: {pct, launched, stale, temporary} or null. launched/stale are the
// provider's own staleness markers; temporary === false means the provider
// marks the flag non-temporary (a kill switch by definition).
export function computeSignals({ kind, references, age, rollout, stalenessDays = DEFAULT_STALENESS_DAYS, now = new Date() }) {
  const signals = { settled_rollout: false, old_untouched: false, narrow_quiet: false };
  const isEnvOrConfig = kind === 'env' || kind === 'config';

  if (!isEnvOrConfig && rollout) {
    if (rollout.pct === 100 || rollout.launched || rollout.stale) signals.settled_rollout = true;
  }
  if (age && age.createdAt) {
    const createdDays = daysAgo(age.createdAt, now);
    // No call sites at all means nothing changed recently. With call sites,
    // a missing blame date is missing data, not proof of untouched.
    const refs = references || [];
    const changedDays = age.lastChangedAt ? daysAgo(age.lastChangedAt, now) : null;
    const untouched = refs.length === 0 || (changedDays !== null && changedDays > stalenessDays);
    if (createdDays > stalenessDays && untouched) {
      signals.old_untouched = true;
    }
  }
  const productionRefs = (references || []).filter((r) => r.refKind === 'call' || r.refKind === 'definition');
  const totalRefs = (references || []).length;
  if ((rollout && (rollout.launched || rollout.stale)) || totalRefs === 0 || (totalRefs > 0 && productionRefs.length === 0) || totalRefs === 1) {
    signals.narrow_quiet = true;
  }
  return signals;
}

export function signalCount(signals) {
  return Object.values(signals).filter(Boolean).length;
}

// status + confidence + winning value for one flag. userState is the
// repo_flags row ({user_status, cap_override}) or null.
export function evaluateFlag({ key, kind, references, unresolvedTouch, age, rollout, winningValue, stalenessDays, userState, now }) {
  const signals = computeSignals({ kind, references, age, rollout, stalenessDays, now });
  const count = signalCount(signals);
  const killSwitch = (rollout && rollout.temporary === false) || isKillSwitchKey(key);
  const cappedByKillSwitch = killSwitch && !(userState && userState.cap_override);
  const cappedByKind = kind === 'env' || kind === 'config';

  let status = count >= 3 ? 'deletable' : count === 2 ? 'stale' : count === 1 ? 'watch' : 'active';
  // The cap only matters when it changes the outcome; a flag that is Stale
  // on signals alone is not "capped", it is Stale.
  let capReason = null;
  if (status === 'deletable' && cappedByKillSwitch) {
    status = 'stale';
    capReason = 'kill_switch';
  } else if (status === 'deletable' && cappedByKind) {
    status = 'stale';
    capReason = 'env_config';
  }

  // Confidence: 3 signals is definite, 2 is likely, unless an unresolved
  // reference touches the flag or the key came from config (then possible).
  // One signal or none, or a winning value that is unknown with thin
  // evidence, is uncertain.
  let confidence;
  if (unresolvedTouch || kind === 'config') {
    confidence = count >= 2 ? 'possible' : 'uncertain';
  } else if (count >= 3) {
    confidence = 'definite';
  } else if (count === 2) {
    confidence = 'likely';
  } else if (count === 1) {
    confidence = winningValue === null ? 'uncertain' : 'possible';
  } else {
    confidence = 'uncertain';
  }

  return { signals, status, confidence, capReason, killSwitch };
}
