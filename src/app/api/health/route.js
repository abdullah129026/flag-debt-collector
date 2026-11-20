import { json, unconfigured } from '@/lib/http';
import { service, configured } from '@/lib/supabase';
import { log } from '@/lib/log';

// Health check. Status ok only when the database answers; degraded when
// env is missing, so a monitor can tell "not configured" from "down".
export async function GET() {
  if (!configured()) {
    return json({ status: 'degraded', db: 'unconfigured' }, 503);
  }
  const sb = service();
  const started = Date.now();
  const { error } = await sb.from('meta').select('key').limit(1);
  if (error) {
    log('health.db_error', { error: error.message });
    return unconfigured('The database did not answer.');
  }
  return json({ status: 'ok', db: 'connected', ms: Date.now() - started });
}
