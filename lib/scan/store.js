// Store interface for the scan pipeline. The tick talks to this interface,
// never to supabase-js directly, so the whole pipeline runs in tests
// against an in-memory store. The Supabase implementation is the only one
// that touches the network.

import { service } from '../supabase.js';

const BUCKET = 'scan-artifacts';

export function createSupabaseStore() {
  const sb = service();
  if (!sb) return null;
  return {
    async claimScan() {
      const { data, error } = await sb.rpc('claim_scan');
      if (error) throw error;
      return (data && data[0]) || null;
    },
    async getScan(id) {
      const { data, error } = await sb.from('scans').select('*').eq('id', id).maybeSingle();
      if (error) throw error;
      return data;
    },
    async getRepo(id) {
      const { data, error } = await sb.from('repos').select('*').eq('id', id).maybeSingle();
      if (error) throw error;
      return data;
    },
    async updateScan(id, patch) {
      const { error } = await sb.from('scans').update(patch).eq('id', id);
      if (error) throw error;
    },
    async getLatestDoneScan(repoId, excludeScanId) {
      const { data, error } = await sb
        .from('scans')
        .select('id')
        .eq('repo_id', repoId)
        .eq('status', 'done')
        .neq('id', excludeScanId)
        .order('finished_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    async getScanFlags(scanId) {
      const { data, error } = await sb.from('flags').select('key, provider, kind, status, confidence').eq('scan_id', scanId);
      if (error) throw error;
      return data || [];
    },
    async getUserStates(repoId) {
      const { data, error } = await sb.from('repo_flags').select('*').eq('repo_id', repoId);
      if (error) throw error;
      return data || [];
    },
    async upsertRepoFlag(row) {
      const { error } = await sb.from('repo_flags').upsert(row, { onConflict: 'repo_id,key,provider' });
      if (error) throw error;
    },
    async clearRepoFlagUserStatus(repoFlagId) {
      const { error } = await sb.from('repo_flags').update({ user_status: null, reason: null }).eq('id', repoFlagId);
      if (error) throw error;
    },
    async insertFlagEvent(row) {
      const { error } = await sb.from('flag_events').insert(row);
      if (error) throw error;
    },
    async insertFlags(rows) {
      if (rows.length === 0) return [];
      const { data, error } = await sb.from('flags').insert(rows).select('id, key, provider');
      if (error) throw error;
      return data || [];
    },
    async insertReferences(rows) {
      if (rows.length === 0) return;
      const { error } = await sb.from('references').insert(rows);
      if (error) throw error;
    },
    async insertUnresolved(rows) {
      if (rows.length === 0) return;
      const { error } = await sb.from('unresolved_references').insert(rows);
      if (error) throw error;
    },
    async getSettings(ownerId) {
      if (!ownerId) return null;
      const { data, error } = await sb.from('settings').select('*').eq('owner_id', ownerId).maybeSingle();
      if (error) throw error;
      return data;
    },
    async getProviderToken(ownerId, provider) {
      const { data, error } = await sb.rpc('read_provider_token', { p_owner_id: ownerId, p_provider: provider });
      if (error) throw error;
      return data || null;
    },
    async storagePut(path, buffer) {
      const { error } = await sb.storage.from(BUCKET).upload(path, buffer, { upsert: true, contentType: 'application/octet-stream' });
      if (error) throw error;
    },
    async storageGet(path) {
      const { data, error } = await sb.storage.from(BUCKET).download(path);
      if (error) throw error;
      return Buffer.from(await data.arrayBuffer());
    },
    async storageRemove(paths) {
      if (paths.length === 0) return;
      const { error } = await sb.storage.from(BUCKET).remove(paths);
      if (error) throw error;
    },
    async heartbeat() {
      const { error } = await sb.from('meta').update({ value: { last_scan_tick_at: new Date().toISOString() } }).eq('key', 'heartbeat');
      if (error) throw error;
    },
  };
}
