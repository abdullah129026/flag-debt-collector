'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Heading } from '@astryxdesign/core/Heading';
import { Text } from '@astryxdesign/core/Text';
import { Code } from '@astryxdesign/core/Code';
import { Card } from '@astryxdesign/core/Card';
import { VStack } from '@astryxdesign/core/VStack';
import { HStack } from '@astryxdesign/core/HStack';
import { Button } from '@astryxdesign/core/Button';
import { Badge } from '@astryxdesign/core/Badge';
import { Skeleton } from '@astryxdesign/core/Skeleton';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { Icon } from '@astryxdesign/core/Icon';
import { AlertDialog } from '@astryxdesign/core/AlertDialog';
import {
  Table,
  useTableSortable,
  useTablePagination,
  proportional,
} from '@astryxdesign/core/Table';
import { SignedInShell, ToastHost, PageError } from '@/src/components/Chrome';
import { formatDateTime } from '@/src/lib/flags-ui';
import { capture } from '@/src/lib/analytics';

const PAGE_SIZE = 10;

function statusBadge(status) {
  if (status === 'done') return <Badge variant="success" label="Done" />;
  if (['queued', 'cloning', 'parsing', 'age', 'provider'].includes(status)) return <Badge variant="info" label="Running" />;
  if (status === 'failed') return <Badge variant="error" label="Failed" />;
  return <Badge variant="neutral" label={status || 'Never scanned'} />;
}

export default function ReposPage() {
  const [repos, setRepos] = useState(null);
  const [fatal, setFatal] = useState(null);
  const [toast, setToast] = useState(null);
  const [sort, setSort] = useState([]);
  const [page, setPage] = useState(1);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [rescanBusy, setRescanBusy] = useState(null);

  const load = useCallback(async () => {
    let res;
    try {
      res = await fetch('/api/repos');
    } catch {
      setFatal('The database did not answer. Try again in a few minutes.');
      return;
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setFatal((data.error && data.error.message) || 'The repos list could not load. Try again in a few minutes.');
      return;
    }
    setRepos(data.repos || []);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const rows = useMemo(() => {
    const list = (repos || []).map((r) => ({
      id: r.id,
      fullName: r.full_name,
      lastScan: r.latest_scan ? r.latest_scan.created_at : null,
      flags: r.counts ? r.counts.flags : null,
      deletableLoc: r.counts ? r.counts.deletable_loc : null,
      deletable: r.counts ? r.counts.deletable : null,
      status: r.latest_scan ? r.latest_scan.status : null,
      error: r.latest_scan ? r.latest_scan.error : null,
      running: r.latest_scan
        ? ['queued', 'cloning', 'parsing', 'age', 'provider'].includes(r.latest_scan.status)
        : false,
    }));
    if (sort.length === 0) return list;
    const { sortKey, direction } = sort[0];
    const dir = direction === 'ascending' ? 1 : -1;
    return [...list].sort((a, b) => {
      const va = a[sortKey];
      const vb = b[sortKey];
      if (va === null && vb === null) return 0;
      if (va === null) return 1;
      if (vb === null) return -1;
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
      return String(va).localeCompare(String(vb)) * dir;
    });
  }, [repos, sort]);

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const visible = rows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const sortPlugin = useTableSortable({ sort, onSortChange: (next) => { setSort(next); setPage(1); } });
  const paginationPlugin = useTablePagination({ page: safePage, onPageChange: setPage, totalItems: rows.length, pageSize: PAGE_SIZE });

  async function rescan(repo) {
    setRescanBusy(repo.id);
    let res;
    try {
      res = await fetch(`/api/repos/${repo.id}/rescan`, { method: 'POST' });
    } catch {
      setRescanBusy(null);
      setToast('Could not reach the service. Check your connection and try again.');
      return;
    }
    const data = await res.json().catch(() => ({}));
    setRescanBusy(null);
    if (!res.ok) {
      setToast((data.error && data.error.message) || 'Could not start the rescan. Try again.');
      return;
    }
    capture('scan_started', {});
    setToast(`Rescan started for ${repo.fullName}.`);
    load();
  }

  async function deleteRepo() {
    if (!deleteTarget) return;
    const res = await fetch(`/api/repos/${deleteTarget.id}`, { method: 'DELETE' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setToast((data.error && data.error.message) || 'Could not delete the repo. Try again.');
      return;
    }
    setDeleteTarget(null);
    setToast(`Repo ${deleteTarget.fullName} deleted.`);
    load();
  }

  const columns = [
    {
      key: 'repo',
      header: 'Repo',
      width: proportional(2),
      sortable: { sortKey: 'fullName' },
      renderCell: (item) => (
        <Link href={`/dashboard?repo=${item.id}`}>
          <Code>{item.fullName}</Code>
        </Link>
      ),
    },
    {
      key: 'lastScan',
      header: 'Last scan',
      sortable: true,
      renderCell: (item) => <Text>{item.lastScan ? formatDateTime(item.lastScan) : 'Never scanned'}</Text>,
    },
    {
      key: 'flags',
      header: 'Flags',
      sortable: false,
      align: 'end',
      renderCell: (item) => <Text hasTabularNumbers>{item.flags === null ? '—' : item.flags}</Text>,
    },
    {
      key: 'deletable',
      header: 'Deletable',
      sortable: { sortKey: 'deletableLoc' },
      align: 'end',
      renderCell: (item) => (
        <Text hasTabularNumbers>
          {item.deletable === null ? '—' : `${item.deletable} flags, ${(item.deletableLoc || 0).toLocaleString()} lines`}
        </Text>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      sortable: false,
      renderCell: (item) => (
        <VStack gap={1}>
          {statusBadge(item.status)}
          {item.status === 'failed' && item.error && <Text type="supporting">{item.error}</Text>}
          {item.running && <Text type="supporting">Scan running.</Text>}
        </VStack>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      renderCell: (item) => (
        <HStack gap={2}>
          <Button label="Rescan" variant="ghost" size="sm" isDisabled={item.running || rescanBusy === item.id} isLoading={rescanBusy === item.id} onClick={() => rescan(item)} />
          <Button label="Delete" variant="ghost" size="sm" onClick={() => setDeleteTarget(item)} />
        </HStack>
      ),
    },
  ];

  return (
    <SignedInShell crumbs={[{ label: 'Repos' }]} active="repos">
      {fatal && <PageError message={fatal} onRetry={() => { setFatal(null); load(); }} />}
      {!fatal && repos === null && (
        <Card>
          <VStack gap={2} padding={4}>
            <Skeleton width="60%" height={24} index={0} />
            <Skeleton width="100%" height={16} index={1} />
            <Skeleton width="80%" height={16} index={2} />
            <Skeleton width="90%" height={16} index={3} />
          </VStack>
        </Card>
      )}
      {!fatal && repos !== null && (
        <VStack gap={6}>
          <VStack gap={2}>
            <Heading level={1}>Repos</Heading>
            <Text type="supporting">{repos.length} repos saved.</Text>
          </VStack>
          <HStack gap={2}>
            <Button label="Scan a repo" variant="primary" onClick={() => { window.location.href = '/'; }} />
          </HStack>
          {repos.length === 0 ? (
            <Card>
              <EmptyState
                title="No repos yet."
                description="Scan a public repo to see its flags here."
                icon={<Icon icon="search" size="lg" />}
                actions={<Button label="Scan a repo" variant="primary" onClick={() => { window.location.href = '/'; }} />}
              />
            </Card>
          ) : (
            <VStack gap={3}>
              <div tabIndex={0} role="region" aria-label="Repos table" style={{ minInlineSize: '100%', overflowX: 'auto' }}>
                <Table data={visible} columns={columns} idKey="id" plugins={{ sort: sortPlugin, pagination: paginationPlugin }} />
              </div>
              <Text type="supporting">
                Showing {visible.length} of {rows.length} repos.
              </Text>
            </VStack>
          )}
        </VStack>
      )}
      <AlertDialog
        isOpen={Boolean(deleteTarget)}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        title="Delete this repo?"
        description={
          deleteTarget
            ? `${deleteTarget.fullName} will be deleted, along with its scans, flags, and provider settings. This cannot be undone.${deleteTarget.running ? ' The running scan will be cancelled first.' : ''}`
            : ''
        }
        actionLabel="Delete repo"
        cancelLabel="Keep repo"
        onAction={deleteRepo}
      />
      <ToastHost toast={toast} onDismiss={() => setToast(null)} />
    </SignedInShell>
  );
}
