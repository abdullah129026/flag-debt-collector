import { json, err, unauthorized, unconfigured, internal } from '@/lib/http';
import { service } from '@/lib/supabase';
import { sessionUserId } from '@/lib/auth';
import { isIntInRange } from '@/lib/validate';
import { logError } from '@/lib/log';

// GET /api/settings — the signed-in user's scan settings, with defaults when
// nothing is saved yet. POST saves them. No weekly-rescan switch in v1:
// scheduled rescans are a design hook, rescans are on demand only.
export async function GET(request) {
  const sb = service();
  if (!sb) return unconfigured();
  const ownerId = await sessionUserId(request);
  if (!ownerId) return unauthorized();
  const { data, error } = await sb.from('settings').select('*').eq('owner_id', ownerId).maybeSingle();
  if (error) {
    logError('settings.get_failed', error, {});
    return internal();
  }
  return json({
    staleness_days: (data && data.staleness_days) || 90,
    include_test_sites: data ? data.include_test_sites : true,
    ignore_rules: (data && data.ignore_rules) || '',
    ld_project_key: (data && data.ld_project_key) || '',
    ld_env_key: (data && data.ld_env_key) || 'production',
  });
}

export async function POST(request) {
  const sb = service();
  if (!sb) return unconfigured();
  const ownerId = await sessionUserId(request);
  if (!ownerId) return unauthorized();
  let body;
  try {
    body = await request.json();
  } catch {
    return err('bad_request', 'Send a JSON body with the settings.', 400);
  }
  if (body.staleness_days !== undefined && !isIntInRange(body.staleness_days, 1, 365)) {
    return err('bad_request', 'Whole days only, between 1 and 365.', 400);
  }
  if (body.include_test_sites !== undefined && typeof body.include_test_sites !== 'boolean') {
    return err('bad_request', 'include_test_sites must be true or false.', 400);
  }
  const row = {
    owner_id: ownerId,
    staleness_days: body.staleness_days ?? 90,
    include_test_sites: body.include_test_sites ?? true,
    ignore_rules: typeof body.ignore_rules === 'string' ? body.ignore_rules : '',
    ld_project_key: typeof body.ld_project_key === 'string' ? body.ld_project_key.trim() : '',
    ld_env_key: typeof body.ld_env_key === 'string' && body.ld_env_key.trim() ? body.ld_env_key.trim() : 'production',
    updated_at: new Date().toISOString(),
  };
  const { error } = await sb.from('settings').upsert(row, { onConflict: 'owner_id' });
  if (error) {
    logError('settings.save_failed', error, {});
    return internal();
  }
  return json({ saved: true });
}
