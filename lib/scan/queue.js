import { sha256 } from '../validate.js';

export const ANON_DAILY_QUOTA = 3;
export const SIGNED_IN_DAILY_QUOTA = 20;
export const MAX_QUEUE_DEPTH = 10;

export function utcDayStart(date = new Date()) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())).toISOString();
}

// First entry of x-forwarded-for, as set by the Vercel edge. Spoofing is
// accepted for a free anonymous quota (worst case is quota evasion).
export function clientIp(request) {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return request.headers.get('x-real-ip') || null;
}

// Quota + queue-depth check. Returns {allowed: true} or
// {allowed: false, cause, message}.
export async function checkQuotas(sb, { ownerId, ip }) {
  const since = utcDayStart();
  let query = sb.from('scans').select('id', { count: 'exact', head: true }).gte('created_at', since);
  if (ownerId) {
    query = query.eq('owner_id', ownerId);
  } else {
    query = query.is('owner_id', null).eq('created_by_ip', ip);
  }
  const { count, error } = await query;
  if (error) throw error;
  const limit = ownerId ? SIGNED_IN_DAILY_QUOTA : ANON_DAILY_QUOTA;
  if ((count || 0) >= limit) {
    return {
      allowed: false,
      cause: ownerId ? 'signed_in_quota' : 'quota_used',
      message: ownerId
        ? 'You have used 20 scans today. Quota resets at midnight UTC.'
        : 'You have used 3 anonymous scans today. Quota resets at midnight UTC.',
    };
  }

  const { count: queued, error: queueError } = await sb
    .from('scans')
    .select('id', { count: 'exact', head: true })
    .in('status', ['queued', 'cloning', 'parsing', 'age', 'provider']);
  if (queueError) throw queueError;
  if ((queued || 0) >= MAX_QUEUE_DEPTH) {
    return {
      allowed: false,
      cause: 'queue_full',
      message: 'Scan queue full. 10 scans are queued. Try again in a few minutes.',
    };
  }
  return { allowed: true };
}

// Find the repo row for (host, fullName), or create it. Anonymous repos
// are keyed by (host, fullName) with a null owner; a signed-in user's
// repos are keyed by (owner, host, fullName).
export async function findOrCreateRepo(sb, { ownerId, host, fullName }) {
  let query = sb.from('repos').select('id').eq('host', host).eq('full_name', fullName);
  query = ownerId ? query.eq('owner_id', ownerId) : query.is('owner_id', null);
  const { data } = await query.maybeSingle();
  if (data) return data;
  const { data: created, error } = await sb
    .from('repos')
    .insert({ owner_id: ownerId || null, host, full_name: fullName, access_kind: 'public_url' })
    .select('id')
    .single();
  if (error) throw error;
  return created;
}

// Create the scan row and return it with its claim token. The raw token is
// returned once, for the cookie; only its hash is stored.
export async function createScan(sb, { ownerId, ip, repoId }) {
  const { randomBytes } = await import('node:crypto');
  const claimToken = randomBytes(32).toString('hex');
  const { data, error } = await sb
    .from('scans')
    .insert({
      repo_id: repoId,
      owner_id: ownerId || null,
      created_by_ip: ip,
      status: 'queued',
      claim_hash: sha256(claimToken),
      progress: { step: 'queued', queue_position: null },
    })
    .select('id, repo_id, status, created_at')
    .single();
  if (error) throw error;
  return { scan: data, claimToken };
}
