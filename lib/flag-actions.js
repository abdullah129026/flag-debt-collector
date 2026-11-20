// Shared flag-action handler: ignore, un-ignore, mark removed, reopen,
// override cap. One function so the ownership check and the event write
// cannot drift between routes.

import { getFlagContext, repoIsOwner, latestDoneScan } from './db-api.js';
import { isKillSwitchKey } from './scan/signals.js';

export const IGNORE_REASONS = ['kill switch', 'seasonal', 'permanent', 'other'];

// Scanner status from the stored signals, with the kind and kill-switch caps
// applied. Used when an ignore is lifted: the row must return to the status
// the scanner computed, not to a guess.
function scannerStatus(flag, userState) {
  const count = Object.values(flag.signals || {}).filter(Boolean).length;
  let status = count >= 3 ? 'deletable' : count === 2 ? 'stale' : count === 1 ? 'watch' : 'active';
  const killSwitch = isKillSwitchKey(flag.key) || (flag.rollout_by_env && flag.rollout_by_env.temporary === false);
  const capped = killSwitch && !(userState && userState.cap_override);
  if (status === 'deletable' && (capped || flag.kind === 'env' || flag.kind === 'config')) status = 'stale';
  return status;
}

// Runs an action on a flag. action is one of 'ignore' | 'unignore' |
// 'mark_removed' | 'reopen' | 'override_cap'. body carries the reason.
// Returns {ok, status, flag, error} where error is a plain message.
export async function flagAction(sb, flagId, ownerId, action, body = {}) {
  const { flag, repo, userState } = await getFlagContext(sb, flagId);
  if (!flag || !repoIsOwner(repo, ownerId)) {
    return { ok: false, status: 404, error: 'No flag at that id. Check the URL.' };
  }
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  const note = typeof body.note === 'string' ? body.note.trim() : '';
  const fullReason = reason && note ? `${reason}: ${note}` : reason || note;

  // State guards: an action that makes no sense for the current status is a
  // 409, not a silent no-op.
  if (action === 'ignore' && flag.status === 'ignored') {
    return { ok: false, status: 409, error: 'This flag is already ignored.' };
  }
  if (action === 'unignore' && flag.status !== 'ignored') {
    return { ok: false, status: 409, error: 'This flag is not ignored.' };
  }
  if (action === 'mark_removed' && flag.status === 'removed') {
    return { ok: false, status: 409, error: 'This flag is already marked removed.' };
  }
  if (action === 'reopen' && flag.status !== 'removed') {
    return { ok: false, status: 409, error: 'Only a removed flag can be reopened.' };
  }

  if (action === 'ignore' || action === 'unignore') {
    if (!IGNORE_REASONS.includes(reason)) {
      return { ok: false, status: 400, error: 'Pick a reason first.' };
    }
    if (reason === 'other' && !note) {
      return { ok: false, status: 400, error: 'Say why this flag stays.' };
    }
  }

  const repoFlag = {
    repo_id: flag.repo_id,
    key: flag.key,
    provider: flag.provider,
    updated_at: new Date().toISOString(),
  };
  let eventAction = action === 'unignore' ? 'unignored' : action === 'mark_removed' ? 'marked_removed' : action === 'reopen' ? 'reopened' : action === 'override_cap' ? 'cap_override' : 'ignored';
  let newStatus = null;

  if (action === 'ignore') {
    repoFlag.user_status = 'ignored';
    repoFlag.reason = fullReason;
    newStatus = 'ignored';
  } else if (action === 'unignore') {
    repoFlag.user_status = null;
    repoFlag.reason = fullReason;
    newStatus = scannerStatus(flag, userState);
  } else if (action === 'mark_removed') {
    repoFlag.user_status = 'marked_removed';
    repoFlag.reason = fullReason;
  } else if (action === 'reopen') {
    repoFlag.user_status = null;
    repoFlag.reason = fullReason;
  } else if (action === 'override_cap') {
    repoFlag.cap_override = true;
    const count = Object.values(flag.signals || {}).filter(Boolean).length;
    if (count >= 3 && flag.kind !== 'env' && flag.kind !== 'config') newStatus = 'deletable';
  }

  const { data: saved, error: upsertError } = await sb
    .from('repo_flags')
    .upsert(repoFlag, { onConflict: 'repo_id,key,provider' })
    .select('id')
    .single();
  if (upsertError) throw upsertError;

  const { error: eventError } = await sb.from('flag_events').insert({
    repo_flag_id: saved.id,
    flag_id: flag.id,
    actor_id: ownerId,
    action: eventAction,
    reason: fullReason || null,
  });
  if (eventError) throw eventError;

  if (newStatus) {
    const latest = await latestDoneScan(sb, flag.repo_id);
    const targetScanId = latest ? latest.id : flag.scan_id;
    await sb.from('flags').update({ status: newStatus }).eq('scan_id', targetScanId).eq('key', flag.key).eq('provider', flag.provider);
  }
  return { ok: true, status: 200, flag: { ...flag, status: newStatus || flag.status } };
}
