import { json, err, unconfigured, internal } from '@/lib/http';
import { createSupabaseStore } from '@/lib/scan/store';
import { tick } from '@/lib/scan/tick';
import { log, logError } from '@/lib/log';
import { timingSafeEqual } from 'node:crypto';

// GET /api/cron/scan-tick — advances one queued (or stale-claimed) scan.
// Bearer CRON_SECRET. Called every minute by pg_cron (or an external pinger).
// Dynamic: must run on Node, not Edge, because the scan downloads and
// extracts tarballs with node:zlib and node:fs.
export const dynamic = 'force-dynamic';
export const maxDuration = 10;

function bearerOk(request) {
  const secret = process.env.CRON_SECRET;
  const header = request.headers.get('authorization') || '';
  if (!secret || !header.startsWith('Bearer ')) return false;
  const given = Buffer.from(header.slice('Bearer '.length));
  const expected = Buffer.from(secret);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export async function GET(request) {
  if (!bearerOk(request)) {
    return err('unauthorized', 'A valid CRON_SECRET bearer token is required.', 401);
  }
  const store = createSupabaseStore();
  if (!store) return unconfigured();
  try {
    const result = await tick(store);
    log('cron.scan_tick', result);
    return json(result);
  } catch (e) {
    logError('cron.scan_tick_failed', e, {});
    return internal();
  }
}
