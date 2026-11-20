import { json, err, unauthorized, unconfigured, internal } from '@/lib/http';
import { service } from '@/lib/supabase';
import { sessionUserId } from '@/lib/auth';
import { logError } from '@/lib/log';

const PROVIDERS = ['launchdarkly', 'configcat'];

// GET /api/settings/tokens — which providers have a saved token (last4 only,
// never the token). POST saves one (encrypted via RPC). DELETE revokes one.
export async function GET(request) {
  const sb = service();
  if (!sb) return unconfigured();
  const ownerId = await sessionUserId(request);
  if (!ownerId) return unauthorized();
  const { data, error } = await sb.from('provider_tokens').select('provider, last4, created_at').eq('owner_id', ownerId);
  if (error) {
    logError('tokens.list_failed', error, {});
    return internal();
  }
  return json({ tokens: data || [] });
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
    return err('bad_request', 'Send a JSON body with provider and token.', 400);
  }
  if (!PROVIDERS.includes(body.provider)) {
    return err('bad_request', 'Only launchdarkly and configcat take a token in v1. Unleash and Flagsmith rollout fetching is a design hook.', 400);
  }
  if (typeof body.token !== 'string' || body.token.trim().length < 8) {
    return err('bad_request', 'Paste a token first.', 400);
  }
  const { error } = await sb.rpc('store_provider_token', {
    p_owner_id: ownerId,
    p_provider: body.provider,
    p_token: body.token.trim(),
  });
  if (error) {
    logError('tokens.save_failed', error, {});
    return internal();
  }
  return json({ saved: true, provider: body.provider, last4: body.token.trim().slice(-4) });
}

export async function DELETE(request) {
  const sb = service();
  if (!sb) return unconfigured();
  const ownerId = await sessionUserId(request);
  if (!ownerId) return unauthorized();
  const provider = new URL(request.url).searchParams.get('provider');
  if (!PROVIDERS.includes(provider)) {
    return err('bad_request', 'Name a provider to revoke.', 400);
  }
  const { error } = await sb.rpc('delete_provider_token', { p_owner_id: ownerId, p_provider: provider });
  if (error) {
    logError('tokens.revoke_failed', error, {});
    return internal();
  }
  return json({ revoked: true, provider });
}
