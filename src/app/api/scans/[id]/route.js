import { json, notFound, unconfigured, internal } from '@/lib/http';
import { service } from '@/lib/supabase';
import { sessionUserId, readClaims } from '@/lib/auth';
import { isUuid, sha256 } from '@/lib/validate';
import { logError } from '@/lib/log';

// GET /api/scans/[id] — scan status + progress + headline counts. Public
// when the scan is public; the owner (session or claim cookie) also gets
// is_owner so the page can show the owner actions.
export async function GET(request, { params }) {
  const sb = service();
  if (!sb) return unconfigured();
  const { id } = await params;
  if (!isUuid(id)) return notFound('No scan at this link. Check the URL.');

  const { data: scan, error } = await sb
    .from('scans')
    .select('id, repo_id, owner_id, status, progress, caps, error, started_at, finished_at, created_at, visibility')
    .eq('id', id)
    .maybeSingle();
  if (error) {
    logError('scans.get_failed', error, { scan_id: id });
    return internal();
  }
  if (!scan) return notFound('No scan at this link. Check the URL.');

  const ownerId = await sessionUserId(request);
  const claims = readClaims(request);
  const isOwner =
    (ownerId && scan.owner_id === ownerId) ||
    (claims[id] && scan.claim_hash === sha256(claims[id]));
  if (scan.visibility !== 'public' && !isOwner) return notFound('No scan at this link. Check the URL.');

  const { data: repo } = await sb
    .from('repos')
    .select('host, full_name, default_branch')
    .eq('id', scan.repo_id)
    .maybeSingle();

  let counts = null;
  if (scan.status === 'done') {
    const { data: flags } = await sb
      .from('flags')
      .select('status, confidence, deletable_loc, loc_up_to')
      .eq('scan_id', id);
    const rows = flags || [];
    counts = {
      flags: rows.length,
      deletable: rows.filter((f) => f.status === 'deletable').length,
      // Headline total: definite and likely flags with a known winning value
      // only; ignored and removed flags are excluded, "up to N" never adds in.
      deletable_loc: rows
        .filter((f) => !f.loc_up_to && (f.confidence === 'definite' || f.confidence === 'likely') && f.status !== 'ignored' && f.status !== 'removed')
        .reduce((sum, f) => sum + (f.deletable_loc || 0), 0),
      up_to_loc: rows
        .filter((f) => f.loc_up_to)
        .reduce((sum, f) => sum + (f.deletable_loc || 0), 0),
    };
  }

  return json({
    scan: {
      id: scan.id,
      status: scan.status,
      progress: scan.progress,
      error: scan.error,
      started_at: scan.started_at,
      finished_at: scan.finished_at,
      created_at: scan.created_at,
    },
    repo: repo ? { host: repo.host, full_name: repo.full_name, default_branch: repo.default_branch } : null,
    counts,
    is_owner: Boolean(isOwner),
  });
}
