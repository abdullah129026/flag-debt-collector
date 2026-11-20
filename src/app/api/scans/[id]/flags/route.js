import { json, notFound, unconfigured, internal } from '@/lib/http';
import { service } from '@/lib/supabase';
import { sessionUserId, readClaims } from '@/lib/auth';
import { isUuid } from '@/lib/validate';
import { getScanWithRepo, scanIsOwner } from '@/lib/db-api';
import { logError } from '@/lib/log';

const STATUS_RANK = { deletable: 0, stale: 1, watch: 2, active: 3, ignored: 4, removed: 5 };

// GET /api/scans/[id]/flags — the flag table for a scan (report + dashboard).
// Public when the scan is public. Default sort: status rank, then deletable
// LOC desc, then age desc (oldest first). Bounded at 500 rows in v1.
export async function GET(request, { params }) {
  const sb = service();
  if (!sb) return unconfigured();
  const { id } = await params;
  if (!isUuid(id)) return notFound('No scan at this link. Check the URL.');

  let scan;
  let repo;
  try {
    ({ scan, repo } = await getScanWithRepo(sb, id));
  } catch (e) {
    logError('scan_flags.get_failed', e, { scan_id: id });
    return internal();
  }
  if (!scan) return notFound('No scan at this link. Check the URL.');
  const ownerId = await sessionUserId(request);
  const claims = readClaims(request);
  const isOwner = scanIsOwner(scan, ownerId, claims);
  if (scan.visibility !== 'public' && !isOwner) return notFound('No scan at this link. Check the URL.');
  if (scan.status !== 'done') {
    return json({ scan: { id: scan.id, status: scan.status, progress: scan.progress }, flags: [], is_owner: isOwner });
  }

  const { data: flagRows, error: flagError } = await sb.from('flags').select('*').eq('scan_id', id).limit(500);
  if (flagError) {
    logError('scan_flags.list_failed', flagError, { scan_id: id });
    return internal();
  }
  const flagIds = (flagRows || []).map((f) => f.id);
  const { data: refRows } = flagIds.length > 0
    ? await sb.from('references').select('flag_id, file_path, line, column, kind').in('flag_id', flagIds)
    : { data: [] };
  const { data: unresolved } = await sb.from('unresolved_references').select('file_path, line, reason').eq('scan_id', id);

  const refsByFlag = new Map();
  for (const r of refRows || []) {
    if (!refsByFlag.has(r.flag_id)) refsByFlag.set(r.flag_id, []);
    refsByFlag.get(r.flag_id).push(r);
  }
  const flags = (flagRows || [])
    .map((f) => ({ ...f, references: refsByFlag.get(f.id) || [] }))
    .sort((a, b) => {
      const rank = (STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9);
      if (rank !== 0) return rank;
      if ((b.deletable_loc || 0) !== (a.deletable_loc || 0)) return (b.deletable_loc || 0) - (a.deletable_loc || 0);
      const aAge = a.created_at_git ? new Date(a.created_at_git).getTime() : Number.POSITIVE_INFINITY;
      const bAge = b.created_at_git ? new Date(b.created_at_git).getTime() : Number.POSITIVE_INFINITY;
      return aAge - bAge;
    });

  return json({
    scan: { id: scan.id, status: scan.status, progress: scan.progress, created_at: scan.created_at, finished_at: scan.finished_at },
    repo: repo ? { host: repo.host, full_name: repo.full_name } : null,
    flags,
    unresolved: unresolved || [],
    is_owner: isOwner,
  });
}
