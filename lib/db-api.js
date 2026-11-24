// Shared ownership checks for the dashboard API. Every route that touches a
// flag, scan, or repo goes through one of these: the signed-in owner, or the
// claim-cookie holder for a scan. Nothing here trusts the client.

import { sha256 } from './validate.js';

// The scan's owner: session user, or the claim token for this scan.
export function scanIsOwner(scan, ownerId, claims) {
  if (ownerId && scan.owner_id === ownerId) return true;
  const token = claims && claims[scan.id];
  return Boolean(token && scan.claim_hash === sha256(token));
}

export async function getScanWithRepo(sb, scanId) {
  const { data: scan, error } = await sb
    .from('scans')
    .select('id, repo_id, owner_id, status, progress, caps, error, claim_hash, created_at, finished_at')
    .eq('id', scanId)
    .maybeSingle();
  if (error) throw error;
  if (!scan) return { scan: null, repo: null };
  const { data: repo } = await sb.from('repos').select('id, owner_id, host, full_name').eq('id', scan.repo_id).maybeSingle();
  return { scan, repo };
}

// Headline counts for a finished scan's flag rows. The headline total
// counts definite and likely flags with a known winning value only;
// ignored and removed flags are excluded, "up to N" never adds in.
export function headlineCounts(rows) {
  const list = rows || [];
  return {
    flags: list.length,
    deletable: list.filter((f) => f.status === 'deletable').length,
    deletable_loc: list
      .filter((f) => !f.loc_up_to && (f.confidence === 'definite' || f.confidence === 'likely') && f.status !== 'ignored' && f.status !== 'removed')
      .reduce((sum, f) => sum + (f.deletable_loc || 0), 0),
    up_to_loc: list
      .filter((f) => f.loc_up_to)
      .reduce((sum, f) => sum + (f.deletable_loc || 0), 0),
  };
}

// Latest done scan for a repo, or null.
export async function latestDoneScan(sb, repoId) {
  const { data, error } = await sb
    .from('scans')
    .select('id, status, finished_at, created_at')
    .eq('repo_id', repoId)
    .eq('status', 'done')
    .order('finished_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// Latest scan of any status for a repo (for the rescan banner).
export async function latestScan(sb, repoId) {
  const { data, error } = await sb
    .from('scans')
    .select('id, status, created_at, finished_at, error')
    .eq('repo_id', repoId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// Flag row plus its repo and repo_flag user state. Returns nulls when missing.
export async function getFlagContext(sb, flagId) {
  const { data: flag, error } = await sb.from('flags').select('*').eq('id', flagId).maybeSingle();
  if (error) throw error;
  if (!flag) return { flag: null, repo: null, userState: null, scan: null };
  const { data: repo } = await sb.from('repos').select('id, owner_id, host, full_name').eq('id', flag.repo_id).maybeSingle();
  const { data: userState } = await sb
    .from('repo_flags')
    .select('*')
    .eq('repo_id', flag.repo_id)
    .eq('key', flag.key)
    .eq('provider', flag.provider)
    .maybeSingle();
  const { data: scan } = await sb.from('scans').select('id, status, created_at, finished_at').eq('id', flag.scan_id).maybeSingle();
  return { flag, repo, userState, scan };
}

// The signed-in user owns this repo, or the claim covers its latest scan.
export function repoIsOwner(repo, ownerId) {
  return Boolean(ownerId && repo && repo.owner_id === ownerId);
}
