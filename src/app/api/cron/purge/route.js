import { json, err, unconfigured, internal } from '@/lib/http';
import { service } from '@/lib/supabase';
import { log, logError } from '@/lib/log';
import { timingSafeEqual } from 'node:crypto';

// GET /api/cron/purge — retention purge. Anonymous scans older than 30 days
// are deleted, except the latest scan per repo. Bearer CRON_SECRET. Called
// daily by pg_cron.
export const dynamic = 'force-dynamic';

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
  const sb = service();
  if (!sb) return unconfigured();
  try {
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { data: old, error } = await sb
      .from('scans')
      .select('id, repo_id, created_at')
      .is('owner_id', null)
      .lt('created_at', cutoff)
      .order('created_at', { ascending: false });
    if (error) throw error;
    const keep = new Set();
    const toDelete = [];
    for (const scan of old || []) {
      if (!keep.has(scan.repo_id)) {
        keep.add(scan.repo_id);
      } else {
        toDelete.push(scan);
      }
    }
    const paths = [];
    for (const scan of toDelete) {
      paths.push(`scans/${scan.id}/repo.tar.gz`, `scans/${scan.id}/parse-state.json`, `scans/${scan.id}/age-state.json`, `scans/${scan.id}/provider-state.json`);
    }
    if (paths.length > 0) {
      await sb.storage.from('scan-artifacts').remove(paths).catch(() => {});
    }
    let deleted = 0;
    for (const scan of toDelete) {
      const { error: deleteError } = await sb.from('scans').delete().eq('id', scan.id);
      if (!deleteError) deleted += 1;
    }
    log('cron.purge', { deleted, kept: keep.size });
    return json({ deleted, kept: keep.size });
  } catch (e) {
    logError('cron.purge_failed', e, {});
    return internal();
  }
}
