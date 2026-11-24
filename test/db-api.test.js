import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getScanWithRepo, scanIsOwner } from '../lib/db-api.js';

// getScanWithRepo must select visibility: the flags and CSV routes check
// scan.visibility to decide whether a public scan may be read. When the
// column was missing from the select, the field came back undefined,
// undefined !== 'public', and every public scan 404d (the first live demo
// scan proved it: /api/scans/[id] worked, /api/scans/[id]/flags 404d).
test('getScanWithRepo selects visibility so public scans stay readable', async () => {
  let selected = '';
  const row = {
    id: 'scan-1', repo_id: 'repo-1', owner_id: null, status: 'done',
    progress: {}, caps: {}, error: null, claim_hash: 'x',
    created_at: '2026-11-24T00:00:00Z', finished_at: '2026-11-24T00:01:00Z',
    visibility: 'public',
  };
  const sb = {
    from(table) {
      return {
        select(cols) {
          if (table === 'scans') selected = cols;
          return this;
        },
        eq() { return this; },
        async maybeSingle() {
          if (table === 'scans') return { data: row, error: null };
          return { data: { id: 'repo-1', owner_id: null, host: 'github.com', full_name: 'acme/shop' }, error: null };
        },
      };
    },
  };
  const { scan } = await getScanWithRepo(sb, 'scan-1');
  assert.ok(selected.split(',').map((s) => s.trim()).includes('visibility'));
  assert.equal(scan.visibility, 'public');
  assert.equal(scanIsOwner(scan, null, {}), false);
});
