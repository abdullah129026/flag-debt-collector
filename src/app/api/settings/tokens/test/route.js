import { json, err, unauthorized, unconfigured, internal } from '@/lib/http';
import { service } from '@/lib/supabase';
import { sessionUserId } from '@/lib/auth';
import { logError } from '@/lib/log';

// POST /api/settings/tokens/test — test a provider connection with the token
// the user just pasted (not the stored one). LaunchDarkly only in v1:
// one flag-statuses call against the project key in Settings. ConfigCat
// needs no token; Unleash and Flagsmith rollout fetching is a design hook.
export async function POST(request) {
  const sb = service();
  if (!sb) return unconfigured();
  const ownerId = await sessionUserId(request);
  if (!ownerId) return unauthorized();
  let body;
  try {
    body = await request.json();
  } catch {
    return err('bad_request', 'Send a JSON body with provider and token.', 400);
  }
  if (body.provider !== 'launchdarkly') {
    return err('bad_request', body.provider === 'configcat'
      ? 'ConfigCat needs no token. Rollout is fetched from the public config.json when a ConfigCat config is found in the repo.'
      : 'Rollout fetching is not in v1 for this provider.', 400);
  }
  if (typeof body.token !== 'string' || !body.token.trim()) {
    return err('bad_request', 'Paste a token first.', 400);
  }
  const { data: settings } = await sb.from('settings').select('ld_project_key, ld_env_key').eq('owner_id', ownerId).maybeSingle();
  const projectKey = settings && settings.ld_project_key;
  if (!projectKey) {
    return err('bad_request', 'Add the LaunchDarkly project key in Settings first.', 400);
  }
  const envKey = (settings && settings.ld_env_key) || 'production';
  let res;
  try {
    res = await fetch(`https://app.launchdarkly.com/api/v2/flag-statuses/${encodeURIComponent(projectKey)}/${encodeURIComponent(envKey)}`, {
      headers: { Authorization: body.token.trim() },
    });
  } catch (e) {
    logError('tokens.test_failed', e, {});
    return err('bad_request', 'Provider is down. Check your connection and try again.', 400);
  }
  if (res.status === 401 || res.status === 403) {
    return err('bad_request', 'Wrong token. Check the token and try again.', 400);
  }
  if (res.status === 404) {
    return err('bad_request', 'No access to this project. Check the project key and the token permissions.', 400);
  }
  if (!res.ok) {
    return err('bad_request', 'Provider is down. Check your connection and try again.', 400);
  }
  return json({ ok: true, provider: 'launchdarkly' });
}
