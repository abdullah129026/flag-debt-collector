import { json, unauthorized, unconfigured, internal, notFound } from '@/lib/http';
import { service } from '@/lib/supabase';
import { sessionUserId } from '@/lib/auth';
import { log, logError } from '@/lib/log';

// DELETE /api/repos/[id] — signed-in owner only. A running scan is marked
// failed first, then the repo row goes; scans, flags, and references follow
// by cascade. This cannot be undone.
export async function DELETE(request, { params }) {
  const sb = service();
  if (!sb) return unconfigured();
  const ownerId = await sessionUserId(request);
  if (!ownerId) return unauthorized();
  const { id } = await params;

  const { data: repo, error } = await sb.from('repos').select('id, owner_id, full_name').eq('id', id).maybeSingle();
  if (error) {
    logError('repos.delete_failed', error, { repo_id: id });
    return internal();
  }
  if (!repo || repo.owner_id !== ownerId) return notFound('That repo no longer exists.');

  await sb.from('scans').update({ status: 'failed', error: 'Scan cancelled: the repo was deleted.', finished_at: new Date().toISOString() })
    .eq('repo_id', id)
    .in('status', ['queued', 'cloning', 'parsing', 'age', 'provider']);
  const { error: deleteError } = await sb.from('repos').delete().eq('id', id);
  if (deleteError) {
    logError('repos.delete_failed', deleteError, { repo_id: id });
    return internal();
  }
  log('repo.deleted', { repo_id: id });
  return json({ deleted: true, repo: repo.full_name });
}
