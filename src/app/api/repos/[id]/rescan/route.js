import { NextResponse } from 'next/server';
import { err, unauthorized, unconfigured, internal, notFound } from '@/lib/http';
import { service } from '@/lib/supabase';
import { sessionUserId } from '@/lib/auth';
import { checkQuotas, createScan, clientIp } from '@/lib/scan/queue';
import { log, logError } from '@/lib/log';

// POST /api/repos/[id]/rescan — signed-in owner only. Enqueues a new scan
// for the repo; the dashboard keeps the old data under a "Rescanning"
// banner until it finishes. Counts against the daily quota.
export async function POST(request, { params }) {
  const sb = service();
  if (!sb) return unconfigured();
  const ownerId = await sessionUserId(request);
  if (!ownerId) return unauthorized();
  const { id } = await params;

  const { data: repo, error } = await sb.from('repos').select('id, owner_id, host, full_name').eq('id', id).maybeSingle();
  if (error) {
    logError('rescan.repo_failed', error, { repo_id: id });
    return internal();
  }
  if (!repo || repo.owner_id !== ownerId) return notFound('That repo no longer exists.');

  const { data: running } = await sb
    .from('scans')
    .select('id')
    .eq('repo_id', id)
    .in('status', ['queued', 'cloning', 'parsing', 'age', 'provider'])
    .limit(1);
  if (running && running.length > 0) {
    return err('conflict', 'A rescan is already running for this repo.', 409);
  }

  let quota;
  try {
    quota = await checkQuotas(sb, { ownerId, ip: clientIp(request) });
  } catch (e) {
    logError('rescan.quota_failed', e, {});
    return internal();
  }
  if (!quota.allowed) return err(quota.cause, quota.message, 429);

  let created;
  try {
    created = await createScan(sb, { ownerId, ip: clientIp(request), repoId: id });
  } catch (e) {
    logError('rescan.create_failed', e, {});
    return internal();
  }
  log('scan_started', { scan_id: created.scan.id, owner: true, rescan: true });
  return NextResponse.json({ scan_id: created.scan.id, status: 'queued', report_url: `/scans/${created.scan.id}` }, { status: 201 });
}
