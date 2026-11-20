import { json, notFound, unconfigured, internal } from '@/lib/http';
import { service } from '@/lib/supabase';
import { sessionUserId } from '@/lib/auth';
import { isUuid } from '@/lib/validate';
import { getFlagContext, repoIsOwner } from '@/lib/db-api';
import { logError } from '@/lib/log';

// GET /api/flags/[id] — flag detail: the flag row, call sites grouped by file,
// the flag_events timeline, and the repo_flag user state. Signed-in owner only.
export async function GET(request, { params }) {
  const sb = service();
  if (!sb) return unconfigured();
  const ownerId = await sessionUserId(request);
  if (!ownerId) return notFound('No flag at that id. Check the URL.');
  const { id } = await params;
  if (!isUuid(id)) return notFound('No flag at that id. Check the URL.');

  let ctx;
  try {
    ctx = await getFlagContext(sb, id);
  } catch (e) {
    logError('flag.get_failed', e, { flag_id: id });
    return internal();
  }
  const { flag, repo, userState, scan } = ctx;
  if (!flag || !repoIsOwner(repo, ownerId)) return notFound('No flag at that id. Check the URL.');

  const { data: refs } = await sb
    .from('references')
    .select('file_path, line, column, kind')
    .eq('flag_id', id)
    .order('file_path')
    .order('line');
  const byFile = new Map();
  for (const r of refs || []) {
    if (!byFile.has(r.file_path)) byFile.set(r.file_path, { file: r.file_path, sites: [] });
    byFile.get(r.file_path).sites.push({ line: r.line, column: r.column, kind: r.kind });
  }
  const { data: events } = await sb
    .from('flag_events')
    .select('action, reason, created_at')
    .eq('repo_flag_id', userState ? userState.id : '')
    .order('created_at', { ascending: false });
  const { data: unresolved } = await sb
    .from('unresolved_references')
    .select('file_path, line, reason')
    .eq('scan_id', flag.scan_id);

  return json({
    flag,
    repo: { host: repo.host, full_name: repo.full_name },
    scan: scan ? { id: scan.id, created_at: scan.created_at, finished_at: scan.finished_at } : null,
    user_state: userState ? { user_status: userState.user_status, reason: userState.reason, cap_override: userState.cap_override } : null,
    call_sites: [...byFile.values()],
    events: events || [],
    unresolved: (unresolved || []).filter((u) =>
      (refs || []).some((r) => r.file_path === u.file_path),
    ),
  });
}
