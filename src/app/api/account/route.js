import { json, err, unauthorized, unconfigured, internal } from '@/lib/http';
import { service } from '@/lib/supabase';
import { sessionUserId } from '@/lib/auth';
import { log, logError } from '@/lib/log';

// DELETE /api/account — typed DELETE, enforced server-side. Deletes the
// account, repos, scans, flags, and provider tokens, then the auth user.
// The client signs out and lands on the landing page.
export async function DELETE(request) {
  const sb = service();
  if (!sb) return unconfigured();
  const ownerId = await sessionUserId(request);
  if (!ownerId) return unauthorized();
  let body = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  if (body.confirm !== 'DELETE') {
    return err('bad_request', 'Type DELETE to confirm.', 400);
  }
  try {
    await sb.from('provider_tokens').delete().eq('owner_id', ownerId);
    await sb.from('settings').delete().eq('owner_id', ownerId);
    await sb.from('flag_events').delete().eq('actor_id', ownerId);
    await sb.from('repos').delete().eq('owner_id', ownerId);
    const { error: authError } = await sb.auth.admin.deleteUser(ownerId);
    if (authError) {
      logError('account.delete_auth_failed', authError, {});
      return internal();
    }
    log('account.deleted', {});
    return json({ deleted: true });
  } catch (e) {
    logError('account.delete_failed', e, {});
    return internal();
  }
}
