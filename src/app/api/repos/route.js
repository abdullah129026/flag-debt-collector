import { json, unauthorized, unconfigured, internal } from '@/lib/http';
import { service } from '@/lib/supabase';
import { sessionUserId } from '@/lib/auth';
import { logError } from '@/lib/log';

// GET /api/repos — the signed-in user's saved repos with their latest scan.
// Three queries, no per-row queries: repos, latest scans, flag counts.
export async function GET(request) {
  const sb = service();
  if (!sb) return unconfigured();
  const ownerId = await sessionUserId(request);
  if (!ownerId) return unauthorized();

  const { data: repos, error } = await sb
    .from('repos')
    .select('id, host, full_name, default_branch, created_at')
    .eq('owner_id', ownerId)
    .order('created_at', { ascending: false });
  if (error) {
    logError('repos.list_failed', error, {});
    return internal();
  }
  if (!repos || repos.length === 0) return json({ repos: [] });

  const repoIds = repos.map((r) => r.id);
  const { data: scans } = await sb
    .from('scans')
    .select('id, repo_id, status, error, created_at, finished_at')
    .in('repo_id', repoIds)
    .order('created_at', { ascending: false });
  const latestByRepo = new Map();
  for (const s of scans || []) {
    if (!latestByRepo.has(s.repo_id)) latestByRepo.set(s.repo_id, s);
  }
  const doneIds = [...latestByRepo.values()].filter((s) => s.status === 'done').map((s) => s.id);
  const countsByScan = new Map();
  if (doneIds.length > 0) {
    const { data: flags } = await sb
      .from('flags')
      .select('scan_id, status, confidence, deletable_loc, loc_up_to')
      .in('scan_id', doneIds);
    for (const f of flags || []) {
      if (!countsByScan.has(f.scan_id)) countsByScan.set(f.scan_id, { flags: 0, deletable: 0, deletable_loc: 0 });
      const c = countsByScan.get(f.scan_id);
      c.flags += 1;
      if (f.status === 'deletable') c.deletable += 1;
      if (!f.loc_up_to && (f.confidence === 'definite' || f.confidence === 'likely') && f.status !== 'ignored' && f.status !== 'removed') {
        c.deletable_loc += f.deletable_loc || 0;
      }
    }
  }

  return json({
    repos: repos.map((r) => {
      const latest = latestByRepo.get(r.id) || null;
      return {
        ...r,
        latest_scan: latest
          ? { id: latest.id, status: latest.status, error: latest.error, created_at: latest.created_at, finished_at: latest.finished_at }
          : null,
        counts: latest && latest.status === 'done' ? countsByScan.get(latest.id) || { flags: 0, deletable: 0, deletable_loc: 0 } : null,
      };
    }),
  });
}
