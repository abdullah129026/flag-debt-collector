// Pure helpers for the flag tables and report pages. No IO, so the tests
// pin them directly. Status values here are the lowercase database values.

export const STATUS_RANK = { deletable: 0, stale: 1, watch: 2, active: 3, ignored: 4, removed: 5 };
export const CONFIDENCE_RANK = { definite: 0, likely: 1, possible: 2, uncertain: 3 };
export const STATUS_LABELS = ['Deletable', 'Stale', 'Watch', 'Active', 'Ignored', 'Removed'];

export function titleStatus(status) {
  if (!status) return '';
  return status.charAt(0).toUpperCase() + status.slice(1);
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function ageDays(flag, now = new Date()) {
  if (!flag || !flag.created_at_git) return null;
  return Math.max(0, Math.floor((now.getTime() - new Date(flag.created_at_git).getTime()) / DAY_MS));
}

// Rollout as a number, or null when unknown. Unknown sorts after known
// values in every direction; the comparator below enforces that.
export function rolloutValue(flag) {
  if (!flag) return null;
  if (flag.kind === 'env' || flag.kind === 'config') return null;
  return typeof flag.rollout_pct === 'number' ? flag.rollout_pct : null;
}

export function rolloutText(flag) {
  if (!flag) return '';
  if (flag.kind === 'env' || flag.kind === 'config') return 'n/a';
  if (typeof flag.rollout_pct === 'number') return `${flag.rollout_pct}%`;
  return 'unknown (no token)';
}

// Reachability from the flag's references: production kinds are call and
// definition; test and config kinds alone mean tests only.
export function reachableText(flag) {
  const refs = (flag && flag.references) || [];
  if (refs.length === 0) return 'not referenced';
  if (refs.some((r) => r.kind === 'call' || r.kind === 'definition')) return 'reachable';
  return 'tests only';
}

export function locText(flag) {
  if (!flag) return '';
  const loc = (flag.deletable_loc || 0).toLocaleString();
  return flag.loc_up_to ? `up to ${loc}` : loc;
}

// Headline total: definite and likely flags with a known winning value only.
// Ignored and removed flags are excluded, and "up to N" lines never add in.
export function headlineTotals(flags) {
  const rows = flags || [];
  let deletableLoc = 0;
  let upToLoc = 0;
  let deletableFlags = 0;
  for (const f of rows) {
    if (f.status === 'deletable') deletableFlags += 1;
    if (f.loc_up_to) {
      upToLoc += f.deletable_loc || 0;
    } else if (
      (f.confidence === 'definite' || f.confidence === 'likely') &&
      f.status !== 'ignored' &&
      f.status !== 'removed'
    ) {
      deletableLoc += f.deletable_loc || 0;
    }
  }
  return { flags: rows.length, deletableFlags, deletableLoc, upToLoc };
}

// Default sort: status rank, then deletable LOC desc, then age desc
// (oldest first). Flags with no age go last.
export function defaultSortFlags(flags, now = new Date()) {
  return [...(flags || [])].sort((a, b) => {
    const rank = (STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9);
    if (rank !== 0) return rank;
    if ((b.deletable_loc || 0) !== (a.deletable_loc || 0)) return (b.deletable_loc || 0) - (a.deletable_loc || 0);
    const aAge = ageDays(a, now);
    const bAge = ageDays(b, now);
    if (aAge === null && bAge === null) return 0;
    if (aAge === null) return 1;
    if (bAge === null) return -1;
    return bAge - aAge;
  });
}

// Column sort from the table plugin. sort is [{sortKey, direction}].
// Numbers sort as numbers on the raw value; unknown rollout and unknown
// age always sort after known values.
export function sortFlags(flags, sort, now = new Date()) {
  if (!sort || sort.length === 0) return defaultSortFlags(flags, now);
  const { sortKey, direction } = sort[0];
  const dir = direction === 'ascending' ? 1 : -1;
  const value = (row) => {
    if (sortKey === 'status') return STATUS_RANK[row.status] ?? 9;
    if (sortKey === 'confidence') return CONFIDENCE_RANK[row.confidence] ?? 9;
    if (sortKey === 'age') return ageDays(row, now);
    if (sortKey === 'rollout' || sortKey === 'rolloutValue') return rolloutValue(row);
    if (sortKey === 'reachable') return reachableText(row);
    if (sortKey === 'loc') return row.deletable_loc || 0;
    return row[sortKey];
  };
  return [...(flags || [])].sort((a, b) => {
    const va = value(a);
    const vb = value(b);
    if (va === null && vb === null) return 0;
    if (va === null) return 1;
    if (vb === null) return -1;
    if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
    return String(va).localeCompare(String(vb)) * dir;
  });
}

function pad(n) {
  return String(n).padStart(2, '0');
}

// "2026-11-18, 09:12 PKT", always in Asia/Karachi.
export function formatDateTime(iso) {
  if (!iso) return '';
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Karachi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(iso));
  const get = (type) => parts.find((p) => p.type === type).value;
  return `${get('year')}-${get('month')}-${get('day')}, ${pad(Number(get('hour')) % 24)}:${get('minute')} PKT`;
}

export function formatDate(iso) {
  if (!iso) return '';
  return formatDateTime(iso).slice(0, 10);
}

export function elapsedText(startIso, nowMs = Date.now()) {
  if (!startIso) return '';
  const seconds = Math.max(0, Math.floor((nowMs - new Date(startIso).getTime()) / 1000));
  const minutes = Math.floor(seconds / 60);
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${pad(seconds % 60)}s`;
}

export const STEP_ORDER = ['queued', 'cloning', 'parsing', 'age', 'provider', 'done', 'failed'];
export const STEP_LABELS = {
  queued: 'Queued',
  cloning: 'Fetching',
  parsing: 'Parsing files',
  age: 'Reading flag age',
  provider: 'Fetching rollout',
  done: 'Done',
  failed: 'Failed',
};

const STEP_BASE = { queued: 0, cloning: 15, parsing: 40, age: 65, provider: 85, done: 100, failed: 100 };

// Progress percent from the scan progress jsonb. While parsing, the file
// fraction moves the bar between the parsing base and the age base.
export function progressPercent(progress) {
  const p = progress || {};
  const step = p.step || 'queued';
  if (step === 'done' || step === 'failed') return 100;
  const base = STEP_BASE[step] ?? 0;
  const next = STEP_BASE[STEP_ORDER[STEP_ORDER.indexOf(step) + 1]] ?? 100;
  if (step === 'parsing' && p.files_total > 0) {
    return Math.round(base + (next - base) * Math.min(1, (p.files_done || 0) / p.files_total));
  }
  return base;
}
