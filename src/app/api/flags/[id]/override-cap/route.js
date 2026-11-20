import { json, err, unauthorized, unconfigured, internal } from '@/lib/http';
import { service } from '@/lib/supabase';
import { sessionUserId } from '@/lib/auth';
import { isUuid } from '@/lib/validate';
import { flagAction } from '@/lib/flag-actions';
import { logError } from '@/lib/log';

// POST /api/flags/[id]/override-cap — signed-in owner only. Lifts the
// kill-switch cap for this flag; the override is recorded as an event.
export async function POST(request, { params }) {
  const sb = service();
  if (!sb) return unconfigured();
  const ownerId = await sessionUserId(request);
  if (!ownerId) return unauthorized();
  const { id } = await params;
  if (!isUuid(id)) return err('not_found', 'No flag at that id. Check the URL.', 404);
  try {
    const result = await flagAction(sb, id, ownerId, 'override_cap', {});
    if (!result.ok) return err('bad_request', result.error, result.status);
    return json({ flag: result.flag });
  } catch (e) {
    logError('flag.override_cap_failed', e, { flag_id: id });
    return internal();
  }
}
