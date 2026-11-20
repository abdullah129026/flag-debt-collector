import { json, err, unauthorized, unconfigured, internal } from '@/lib/http';
import { service } from '@/lib/supabase';
import { sessionUserId } from '@/lib/auth';
import { isUuid } from '@/lib/validate';
import { flagAction } from '@/lib/flag-actions';
import { logError } from '@/lib/log';

// POST /api/flags/[id]/unignore — signed-in owner only. Body: {reason, note?}.
// The reason for un-ignoring is stored the same way as the ignore reason.
export async function POST(request, { params }) {
  const sb = service();
  if (!sb) return unconfigured();
  const ownerId = await sessionUserId(request);
  if (!ownerId) return unauthorized();
  const { id } = await params;
  if (!isUuid(id)) return err('not_found', 'No flag at that id. Check the URL.', 404);
  let body = {};
  try {
    body = await request.json();
  } catch {
    return err('bad_request', 'Send a JSON body with a reason.', 400);
  }
  try {
    const result = await flagAction(sb, id, ownerId, 'unignore', body);
    if (!result.ok) return err('bad_request', result.error, result.status);
    return json({ flag: result.flag });
  } catch (e) {
    logError('flag.unignore_failed', e, { flag_id: id });
    return internal();
  }
}
