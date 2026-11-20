// Small validators for trust-boundary inputs. No dependency, no magic.

export function isEmail(value) {
  return typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function isUuid(value) {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export function isIntInRange(value, min, max) {
  return Number.isInteger(value) && value >= min && value <= max;
}

export function isNonEmptyString(value, maxLen = 500) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maxLen;
}

// SHA-256 hex of a claim token. The raw token lives only in the cookie.
import { createHash } from 'node:crypto';

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}
