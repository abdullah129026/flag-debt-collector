import { json, unauthorized, unconfigured, internal, notFound } from '@/lib/http';
import { service } from '@/lib/supabase';
import { sessionUserId } from '@/lib/auth';
import { logError } from '@/lib/log';

// GET /api/repos/[id]/summary — the dashboard counts row in one call.
// The flags endpoint serves one scan only, so the cumulative counts (flags
// removed, lines deleted over time) need this route: a confirmed-removed
// flag keeps a row in the latest scan with deletable_loc 0, and its deleted
// lines live on the same flag in the previous done scan.
export async function GET(request, { params }) {
  const sb = service();
  if (!sb) return unconfigured();
  const ownerId = await sessionUserId(request);
  if (!ownerId) return unauthorized();
  const { id } = await params;

  const { data: repo, error } = await sb
    .from('repos')
    .select('id, owner_id, host, full_name')
    .eq('id', id)
    .maybeSingle();
  if (error) {
    logError('repo.summary_failed', error, { repo_id: id });
    return internal();
  }
  if (!repo || repo.owner_id !== ownerId) return notFound('That repo no longer exists.');

  const { data: scans } = await sb
    .from('scans')
    .select('id, status, created_at, finished_at')
    .eq('repo_id', id)
    .order('created_at', { ascending: false });
  const done = (scans || []).filter((s) => s.status === 'done');
  const latest = done[0] || null;
  const previous = done[1] || null;
  const running = (scans || []).find((s) => ['queued', 'cloning', 'parsing', 'age', 'provider'].includes(s.status)) || null;

  let removedFlags = 0;
  let removedLoc = 0;
  let deletableNow = 0;
  let deletableLocNow = 0;
  let flagsTotal = 0;
  if (latest) {
    const { data: latestFlags } = await sb
      .from('flags')
      .select('key, provider, status, confidence, deletable_loc, loc_up_to')
      .eq('scan_id', latest.id);
    const rows = latestFlags || [];
    flagsTotal = rows.length;
    const removed = rows.filter((f) => f.status === 'removed');
    removedFlags = removed.length;
    deletableNow = rows.filter((f) => f.status === 'deletable').length;
    deletableLocNow = rows
      .filter((f) => !f.loc_up_to && (f.confidence === 'definite' || f.confidence === 'likely') && f.status !== 'ignored' && f.status !== 'removed')
      .reduce((sum, f) => sum + (f.deletable_loc || 0), 0);
    if (removed.length > 0 && previous) {
      const { data: prevFlags } = await sb
        .from('flags')
        .select('key, provider, deletable_loc')
        .eq('scan_id', previous.id);
      const prevByKey = new Map((prevFlags || []).map((f) => [`${f.provider}:${f.key}`, f.deletable_loc || 0]));
      removedLoc = removed.reduce((sum, f) => sum + (prevByKey.get(`${f.provider}:${f.key}`) || 0), 0);
    }
  }

  return json({
    repo: { id: repo.id, host: repo.host, full_name: repo.full_name },
    latest_done_scan: latest ? { id: latest.id, created_at: latest.created_at, finished_at: latest.finished_at } : null,
    running_scan: running ? { id: running.id, status: running.status, created_at: running.created_at } : null,
    removed_flags: removedFlags,
    removed_loc: removedLoc,
    deletable_now: deletableNow,
    deletable_loc_now: deletableLocNow,
    flags_total: flagsTotal,
  });
}
