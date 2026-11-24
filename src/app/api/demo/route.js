// GET /api/demo — the landing page's demo scan: the latest done scan of
// the demo repo (api-contract-firewall), with headline counts. Public;
// the scan itself is public too. Returns {scan_id: null} until a demo
// scan has finished.
import { json, unconfigured, internal } from '@/lib/http';
import { service } from '@/lib/supabase';
import { latestDoneScan, headlineCounts } from '@/lib/db-api';
import { logError } from '@/lib/log';

export const dynamic = 'force-dynamic';

const DEMO_HOST = 'github.com';
const DEMO_FULL_NAME = 'abdullah129026/api-contract-firewall';

export async function GET() {
  const sb = service();
  if (!sb) return unconfigured();
  try {
    const { data: repos, error } = await sb
      .from('repos')
      .select('id')
      .eq('host', DEMO_HOST)
      .eq('full_name', DEMO_FULL_NAME)
      .order('created_at', { ascending: true });
    if (error) throw error;
    for (const repo of repos || []) {
      const scan = await latestDoneScan(sb, repo.id);
      if (!scan) continue;
      const { data: flags, error: flagError } = await sb
        .from('flags')
        .select('status, confidence, deletable_loc, loc_up_to')
        .eq('scan_id', scan.id);
      if (flagError) throw flagError;
      return json({ scan_id: scan.id, repo: DEMO_FULL_NAME, finished_at: scan.finished_at, ...headlineCounts(flags) });
    }
    return json({ scan_id: null });
  } catch (e) {
    logError('demo.get_failed', e, {});
    return internal();
  }
}
