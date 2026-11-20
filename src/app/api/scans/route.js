import { NextResponse } from 'next/server';
import { err, badRequest, unconfigured, internal } from '@/lib/http';
import { service } from '@/lib/supabase';
import { sessionUserId, readClaims, claimCookieValue } from '@/lib/auth';
import { parseRepoUrl, checkRepoSize, FAILURE_MESSAGES } from '@/lib/scan/url';
import { checkQuotas, findOrCreateRepo, createScan, clientIp } from '@/lib/scan/queue';
import { log, logError } from '@/lib/log';

// POST /api/scans — enqueue a scan for a public repo URL. No signup.
// Body: {repo_url, configcat_key?}. The ConfigCat key is stored encrypted
// only for signed-in users; for anonymous scans it is dropped (rollout then
// comes from a key found in the repo code, or reads "unknown").
export async function POST(request) {
  const sb = service();
  if (!sb) return unconfigured();
  let body;
  try {
    body = await request.json();
  } catch {
    return badRequest('Send a JSON body with repo_url.');
  }
  const parsed = parseRepoUrl(body && body.repo_url);
  if (!parsed.ok) {
    return err(parsed.cause, parsed.message, 400);
  }
  const ownerId = await sessionUserId(request);
  const ip = clientIp(request);

  const size = await checkRepoSize(parsed, fetch, process.env.GITHUB_TOKEN);
  if (!size.ok) {
    return err(size.cause, FAILURE_MESSAGES[size.cause], 400);
  }

  let quota;
  try {
    quota = await checkQuotas(sb, { ownerId, ip });
  } catch (e) {
    logError('scans.quota_check_failed', e, {});
    return internal();
  }
  if (!quota.allowed) {
    return err(quota.cause, quota.message, 429);
  }

  let repo;
  let created;
  try {
    repo = await findOrCreateRepo(sb, { ownerId, host: parsed.host, fullName: parsed.fullName });
    created = await createScan(sb, { ownerId, ip, repoId: repo.id });
  } catch (e) {
    logError('scans.create_failed', e, {});
    return internal();
  }

  let configcatKeyKept = false;
  if (ownerId && body.configcat_key && typeof body.configcat_key === 'string' && body.configcat_key.trim()) {
    const { error: tokenError } = await sb.rpc('store_provider_token', {
      p_owner_id: ownerId,
      p_provider: 'configcat',
      p_token: body.configcat_key.trim(),
    });
    if (tokenError) {
      logError('scans.configcat_store_failed', tokenError, {});
    } else {
      configcatKeyKept = true;
    }
  }

  log('scan_started', { scan_id: created.scan.id, owner: Boolean(ownerId) });
  const claims = readClaims(request);
  claims[created.scan.id] = created.claimToken;
  const response = NextResponse.json(
    {
      scan_id: created.scan.id,
      repo: parsed.fullName,
      status: 'queued',
      report_url: `/scans/${created.scan.id}`,
      configcat_key_kept: configcatKeyKept,
    },
    { status: 201 },
  );
  response.cookies.set('fdc_claims', claimCookieValue(claims), {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  });
  return response;
}
