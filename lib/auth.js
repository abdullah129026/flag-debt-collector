import { serverClient } from './supabase.js';

// Returns the signed-in user's id, or null. Never throws on a missing or
// expired session; routes turn null into 401.
export async function sessionUserId(request) {
  const sb = serverClient(request);
  if (!sb) return null;
  try {
    const { data, error } = await sb.auth.getUser();
    if (error || !data || !data.user) return null;
    return data.user.id;
  } catch {
    return null;
  }
}

// Claim-cookie helpers. One cookie, `fdc_claims`, holds a JSON map of
// scan id to claim token, so an anonymous visitor can own several scans.
// Only the SHA-256 hash is stored in the database.
export function readClaims(request) {
  try {
    const raw = request.cookies.get('fdc_claims');
    if (!raw) return {};
    const parsed = JSON.parse(raw.value);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function claimCookieValue(claims) {
  return JSON.stringify(claims);
}

// A fresh claim token for a new scan: 32 random bytes, hex.
import { randomBytes } from 'node:crypto';

export function newClaimToken() {
  return randomBytes(32).toString('hex');
}
