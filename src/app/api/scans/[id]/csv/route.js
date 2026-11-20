import { json, notFound, unconfigured, internal } from '@/lib/http';
import { service } from '@/lib/supabase';
import { sessionUserId, readClaims } from '@/lib/auth';
import { isUuid } from '@/lib/validate';
import { getScanWithRepo, scanIsOwner } from '@/lib/db-api';
import { toCsv } from '@/lib/csv';
import { log, logError } from '@/lib/log';

// GET /api/scans/[id]/csv — owner only. Flag names, ages, rollout, call-site
// counts, LOC. Never source code. Zero flags exports the headers plus a note
// row, never an empty file that looks broken.
export async function GET(request, { params }) {
  const sb = service();
  if (!sb) return unconfigured();
  const { id } = await params;
  if (!isUuid(id)) return notFound('No scan at this link. Check the URL.');

  let scan;
  try {
    ({ scan } = await getScanWithRepo(sb, id));
  } catch (e) {
    logError('scan_csv.get_failed', e, { scan_id: id });
    return internal();
  }
  if (!scan) return notFound('No scan at this link. Check the URL.');
  const ownerId = await sessionUserId(request);
  const claims = readClaims(request);
  if (!scanIsOwner(scan, ownerId, claims)) return notFound('No scan at this link. Check the URL.');

  const { data: flags } = await sb
    .from('flags')
    .select('key, provider, kind, status, confidence, created_at_git, last_changed_at, rollout_pct, rollout_source, references_count, deletable_loc, loc_up_to')
    .eq('scan_id', id)
    .order('key');
  const rows = (flags || []).map((f) => [
    f.key,
    f.provider,
    f.kind,
    f.status,
    f.confidence,
    f.created_at_git ? f.created_at_git.slice(0, 10) : '',
    f.last_changed_at ? f.last_changed_at.slice(0, 10) : '',
    f.rollout_pct === null || f.rollout_pct === undefined ? (f.kind === 'env' || f.kind === 'config' ? 'n/a' : 'unknown') : f.rollout_pct,
    f.rollout_source || '',
    f.references_count,
    f.loc_up_to ? `up to ${f.deletable_loc}` : f.deletable_loc,
  ]);
  if (rows.length === 0) {
    rows.push(['(no flags found in this scan)', '', '', '', '', '', '', '', '', '', '']);
  }
  const csv = toCsv(
    ['flag', 'provider', 'kind', 'status', 'confidence', 'created_at', 'last_changed_at', 'rollout_pct', 'rollout_source', 'call_sites', 'deletable_loc'],
    rows,
  );
  log('export_clicked', { scan_id: id, flags: (flags || []).length });
  return new Response(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="flags-${id.slice(0, 8)}.csv"`,
    },
  });
}
