'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Text } from '@astryxdesign/core/Text';
import { Code } from '@astryxdesign/core/Code';
import { CodeBlock } from '@astryxdesign/core/CodeBlock';
import { Button } from '@astryxdesign/core/Button';
import { Badge } from '@astryxdesign/core/Badge';
import { Icon } from '@astryxdesign/core/Icon';
import { Card } from '@astryxdesign/core/Card';
import { VStack } from '@astryxdesign/core/VStack';
import { HStack } from '@astryxdesign/core/HStack';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { Selector } from '@astryxdesign/core/Selector';
import { TextInput } from '@astryxdesign/core/TextInput';
import {
  Table,
  useTableSortable,
  useTablePagination,
  useTableRowExpansion,
  useTableStickyColumns,
  proportional,
} from '@astryxdesign/core/Table';
import { isKillSwitchKey } from '@/lib/scan/signals';
import {
  STATUS_LABELS,
  titleStatus,
  ageDays,
  rolloutText,
  rolloutValue,
  reachableText,
  locText,
  sortFlags,
  defaultSortFlags,
} from '@/src/lib/flags-ui';
import { StatusBadge, ConfidenceBadge } from './FlagBadges';

const PAGE_SIZE = 25;
const SORT_LABELS = {
  key: 'flag key',
  status: 'status',
  confidence: 'confidence',
  age: 'age',
  rollout: 'rollout',
  rolloutValue: 'rollout',
  reachable: 'reachability',
  loc: 'deletable lines',
};

function readDensity() {
  try {
    const saved = localStorage.getItem('fdc_density');
    if (saved === 'compact' || saved === 'balanced' || saved === 'spacious') return saved;
  } catch { /* storage unavailable: fall through to the default */ }
  return 'balanced';
}

function groupCallSites(references) {
  const byFile = new Map();
  for (const r of references || []) {
    if (!byFile.has(r.file_path)) byFile.set(r.file_path, { file: r.file_path, production: [], tests: [], config: [] });
    const group = byFile.get(r.file_path);
    if (r.kind === 'test') group.tests.push(r.line);
    else if (r.kind === 'config') group.config.push(r.line);
    else group.production.push(r.line);
  }
  return [...byFile.values()];
}

// The expanded panel for a public visitor: call sites grouped by file,
// then the diff, or the reason there is none.
function ExpandedFlag({ flag }) {
  const groups = groupCallSites(flag.references);
  const production = groups.filter((g) => g.production.length > 0);
  const tests = groups.filter((g) => g.tests.length > 0);
  return (
    <VStack gap={3}>
      <Text type="label">Call sites</Text>
      {groups.length === 0 && <Text type="supporting">No call sites recorded for this flag.</Text>}
      {production.length > 0 && (
        <VStack gap={2}>
          <Text type="supporting">Production ({production.reduce((n, g) => n + g.production.length, 0)})</Text>
          {production.map((g) => (
            <Text key={g.file}>
              <Code>{g.file}</Code> — lines {g.production.join(', ')}
            </Text>
          ))}
        </VStack>
      )}
      {tests.length > 0 && (
        <VStack gap={2}>
          <Text type="supporting">Tests ({tests.reduce((n, g) => n + g.tests.length, 0)})</Text>
          {tests.map((g) => (
            <Text key={g.file}>
              <Code>{g.file}</Code> — lines {g.tests.join(', ')}
            </Text>
          ))}
        </VStack>
      )}
      <Text type="label">Diff</Text>
      {flag.diff ? (
        <CodeBlock title={groups[0] ? groups[0].file : flag.key} language="plaintext" isDiff hasLineNumbers width="100%" code={flag.diff} />
      ) : (
        <Text type="supporting">
          {flag.winning_value === null || flag.winning_value === undefined
            ? `No diff for this flag. The winning value is unknown, so no diff is shown. Up to ${(
                flag.deletable_loc || 0
              ).toLocaleString()} lines if the winning value is picked on the flag detail page.`
            : 'No diff for this flag. The call sites are listed under Call sites.'}
        </Text>
      )}
    </VStack>
  );
}

function isCappedKillSwitch(flag) {
  if (flag.status !== 'stale') return false;
  if (isKillSwitchKey(flag.key)) return true;
  return Boolean(flag.rollout_by_env && flag.rollout_by_env.temporary === false);
}

// Shared flag table for the public report and the dashboard. Density is
// persisted in localStorage; sorting reorders the existing rows, so focus
// and row selection survive a sort. The wrapper follows the
// responsive-table guide: keyboard-scrollable region, named by label,
// with a min-inline-size so columns never collapse.
export function FlagTable({ flags, mode, onIgnore }) {
  const [density, setDensity] = useState(readDensity);
  const [sort, setSort] = useState([]);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('All');
  const [confidenceFilter, setConfidenceFilter] = useState('All');
  const [keyQuery, setKeyQuery] = useState('');
  const [expandedKeys, setExpandedKeys] = useState(new Set());

  const filtered = useMemo(() => {
    return (flags || []).filter((f) => {
      if (statusFilter !== 'All' && titleStatus(f.status) !== statusFilter) return false;
      if (confidenceFilter !== 'All' && f.confidence !== confidenceFilter) return false;
      if (keyQuery && !f.key.toLowerCase().includes(keyQuery.toLowerCase())) return false;
      return true;
    });
  }, [flags, statusFilter, confidenceFilter, keyQuery]);

  const sorted = useMemo(() => sortFlags(filtered, sort), [filtered, sort]);
  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const visible = sorted.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const chips = [];
  if (statusFilter !== 'All') chips.push({ id: 'status', label: `Status: ${statusFilter}` });
  if (confidenceFilter !== 'All') chips.push({ id: 'confidence', label: `Confidence: ${confidenceFilter}` });
  if (keyQuery) chips.push({ id: 'key', label: `Key: ${keyQuery}` });

  function clearFilter(id) {
    if (id === 'status') setStatusFilter('All');
    if (id === 'confidence') setConfidenceFilter('All');
    if (id === 'key') setKeyQuery('');
    setPage(1);
  }

  function changeDensity(value) {
    setDensity(value);
    try {
      localStorage.setItem('fdc_density', value);
    } catch { /* storage unavailable: density still applies for this visit */ }
  }

  const sortPlugin = useTableSortable({
    sort,
    onSortChange: (next) => {
      setSort(next);
      setPage(1);
    },
  });
  const paginationPlugin = useTablePagination({
    page: safePage,
    onPageChange: setPage,
    totalItems: sorted.length,
    pageSize: PAGE_SIZE,
  });
  const expansionPlugin = useTableRowExpansion({
    expandedKeys,
    onToggle: (key) => {
      setExpandedKeys((prev) => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      });
    },
    getRowKey: (item) => item.id,
    getRowLabel: (item) => item.key,
    renderExpanded: (item) => <ExpandedFlag flag={item} />,
  });
  // The flag column stays pinned while the table scrolls sideways. The
  // floors below are the widths a badge or a key needs to read whole: the
  // 60px omitted-width floor cut status badges to an icon at 375px.
  const stickyPlugin = useTableStickyColumns({ startKeys: ['flag'] });

  const columns = [
    {
      key: 'flag',
      header: 'Flag',
      width: proportional(2, { minWidth: 200 }),
      sortable: { sortKey: 'key' },
      renderCell: (item) => (
        <span
          style={{
            whiteSpace: 'nowrap',
            ...(item.status === 'removed' ? { textDecoration: 'line-through' } : {}),
          }}
        >
          <Code>{item.key}</Code>
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      width: proportional(1, { minWidth: 132 }),
      sortable: true,
      renderCell: (item) => (
        <VStack gap={1}>
          <StatusBadge status={titleStatus(item.status)} />
          {isCappedKillSwitch(item) && <Text type="supporting">Capped at Stale: kill switch.</Text>}
        </VStack>
      ),
    },
    {
      key: 'confidence',
      header: 'Confidence',
      width: proportional(1, { minWidth: 112 }),
      sortable: true,
      renderCell: (item) => <ConfidenceBadge confidence={item.confidence} />,
    },
    {
      key: 'age',
      header: 'Age',
      sortable: true,
      align: 'end',
      renderCell: (item) => {
        const age = ageDays(item);
        return <Text hasTabularNumbers>{age === null ? 'unknown' : `${age}d`}</Text>;
      },
    },
    {
      key: 'rollout',
      header: 'Rollout',
      sortable: { sortKey: 'rolloutValue' },
      align: 'end',
      renderCell: (item) => <Text hasTabularNumbers>{rolloutText(item)}</Text>,
    },
    {
      key: 'reachable',
      header: 'Reachable',
      width: proportional(1, { minWidth: 120 }),
      sortable: true,
      renderCell: (item) => <Text>{reachableText(item)}</Text>,
    },
    {
      key: 'loc',
      header: 'Deletable LOC',
      sortable: true,
      align: 'end',
      renderCell: (item) => <Text hasTabularNumbers>{locText(item)}</Text>,
    },
  ];

  if (mode === 'dashboard') {
    columns.push({
      key: 'actions',
      header: 'Actions',
      width: proportional(1, { minWidth: 140 }),
      renderCell: (item) => (
        <HStack gap={2} vAlign="center">
          {item.status !== 'ignored' && (
            <Button label="Ignore" variant="ghost" size="sm" onClick={() => onIgnore && onIgnore(item)} />
          )}
          <Link href={`/dashboard/flags/${item.id}`}>Open</Link>
        </HStack>
      ),
    });
  }

  const sortAnnouncement =
    sort.length === 0
      ? 'Sorted by status, then deletable lines, then age.'
      : `Sorted by ${SORT_LABELS[sort[0].sortKey] || sort[0].sortKey}, ${sort[0].direction}, ${sorted.length} rows.`;

  return (
    <VStack gap={3}>
      <HStack gap={2} vAlign="center" wrap="wrap">
        <Text type="label">Density</Text>
        <SegmentedControl label="Table density" value={density} onChange={changeDensity}>
          <SegmentedControlItem value="compact" label="Compact" />
          <SegmentedControlItem value="balanced" label="Balanced" />
          <SegmentedControlItem value="spacious" label="Spacious" />
        </SegmentedControl>
      </HStack>
      <HStack gap={2} wrap="wrap" vAlign="center">
        <Selector
          label="Status filter"
          value={statusFilter}
          onChange={(v) => {
            setStatusFilter(v);
            setPage(1);
          }}
          options={['All', ...STATUS_LABELS]}
        />
        <Selector
          label="Confidence filter"
          value={confidenceFilter}
          onChange={(v) => {
            setConfidenceFilter(v);
            setPage(1);
          }}
          options={['All', 'definite', 'likely', 'possible', 'uncertain']}
        />
        <TextInput
          label="Filter by flag key"
          value={keyQuery}
          onChange={(v) => {
            setKeyQuery(v);
            setPage(1);
          }}
          placeholder="new_checkout_enabled"
        />
      </HStack>
      <HStack gap={2} wrap="wrap" vAlign="center">
        {chips.map((chip) => (
          <HStack key={chip.id} gap={1} vAlign="center">
            <Badge variant="neutral" label={chip.label} />
            <Button
              label={`Remove filter ${chip.label}`}
              variant="ghost"
              size="sm"
              isIconOnly
              icon={<Icon icon="close" size="sm" />}
              onClick={() => clearFilter(chip.id)}
            />
          </HStack>
        ))}
        {chips.length > 0 && (
          <Button
            label="Clear all"
            variant="ghost"
            size="sm"
            onClick={() => {
              setStatusFilter('All');
              setConfidenceFilter('All');
              setKeyQuery('');
              setPage(1);
            }}
          />
        )}
        {chips.length === 0 && <Text type="supporting">No filters applied.</Text>}
      </HStack>
      <div role="status">
        <Text type="supporting">{sortAnnouncement}</Text>
      </div>
      {sorted.length === 0 ? (
        <Card>
          <VStack gap={2} padding={4}>
            <Text>No flags match these filters.</Text>
            <Button
              label="Clear filters"
              variant="secondary"
              onClick={() => {
                setStatusFilter('All');
                setConfidenceFilter('All');
                setKeyQuery('');
                setPage(1);
              }}
            />
          </VStack>
        </Card>
      ) : (
        <div tabIndex={0} role="region" aria-label="Flag table" style={{ minInlineSize: '100%', overflowX: 'auto' }}>
          <Table
            data={visible}
            columns={columns}
            idKey="id"
            density={density}
            plugins={
              mode === 'report'
                ? { sort: sortPlugin, pagination: paginationPlugin, expansion: expansionPlugin, stickyColumns: stickyPlugin }
                : { sort: sortPlugin, pagination: paginationPlugin, stickyColumns: stickyPlugin }
            }
          />
        </div>
      )}
      <Text type="supporting">
        Showing {visible.length} of {sorted.length} flags
        {sorted.length !== (flags || []).length ? ` (${(flags || []).length} total)` : ''}.
      </Text>
    </VStack>
  );
}

// Re-exported for the tests and the pages that need the same ordering.
export { defaultSortFlags, rolloutValue };
