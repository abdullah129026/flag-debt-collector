'use client';

import { useCallback, useEffect, useState } from 'react';
import { Heading } from '@astryxdesign/core/Heading';
import { Text } from '@astryxdesign/core/Text';
import { Card } from '@astryxdesign/core/Card';
import { VStack } from '@astryxdesign/core/VStack';
import { HStack } from '@astryxdesign/core/HStack';
import { Button } from '@astryxdesign/core/Button';
import { Banner } from '@astryxdesign/core/Banner';
import { Skeleton } from '@astryxdesign/core/Skeleton';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { Icon } from '@astryxdesign/core/Icon';
import { SignedInShell, ToastHost, PageError } from '@/src/components/Chrome';
import { FlagTable } from '@/src/components/FlagTable';
import { IgnoreDialog } from '@/src/components/FlagActions';
import { formatDateTime, elapsedText } from '@/src/lib/flags-ui';
import { capture } from '@/src/lib/analytics';
import { browserClient } from '@/lib/supabase';

function CountCard({ number, label }) {
  return (
    <Card>
      <VStack gap={1} padding={4}>
        <Heading level={2}>{number}</Heading>
        <Text type="supporting">{label}</Text>
      </VStack>
    </Card>
  );
}

export default function DashboardPage() {
  const [repos, setRepos] = useState(null);
  const [repoId, setRepoId] = useState(null);
  const [summary, setSummary] = useState(null);
  const [flagsData, setFlagsData] = useState(null);
  const [fatal, setFatal] = useState(null);
  const [rescanError, setRescanError] = useState(null);
  const [rescanBusy, setRescanBusy] = useState(false);
  const [toast, setToast] = useState(null);
  const [ignoreTarget, setIgnoreTarget] = useState(null);

  const loadAll = useCallback(async () => {
    let res;
    try {
      res = await fetch('/api/repos');
    } catch {
      setFatal('The database did not answer. Try again in a few minutes.');
      return;
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setFatal((data.error && data.error.message) || 'The dashboard could not load. Try again in a few minutes.');
      return;
    }
    setRepos(data.repos || []);
    if ((data.repos || []).length === 0) return;
    const wanted = new URLSearchParams(window.location.search).get('repo');
    const picked = (data.repos || []).find((r) => r.id === wanted) || data.repos[0];
    setRepoId(picked.id);
    const sumRes = await fetch(`/api/repos/${picked.id}/summary`);
    const sumData = await sumRes.json().catch(() => ({}));
    if (sumRes.ok) setSummary(sumData);
    const doneId = sumData && sumData.latest_done_scan ? sumData.latest_done_scan.id : null;
    if (doneId) {
      const flagsRes = await fetch(`/api/scans/${doneId}/flags`);
      if (flagsRes.ok) {
        const flags = await flagsRes.json().catch(() => ({}));
        setFlagsData(flags);
      }
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // First sign-in (new account) is the signup_completed event. The magic-link
  // callback does not say whether the account is new, so the dashboard checks
  // the account creation date once per session.
  useEffect(() => {
    try {
      if (sessionStorage.getItem('fdc_signup_fired')) return;
      const sb = browserClient();
      if (!sb) return;
      sb.auth.getUser().then(({ data }) => {
        if (!data || !data.user) return;
        const created = new Date(data.user.created_at).getTime();
        if (Date.now() - created < 10 * 60 * 1000) {
          sessionStorage.setItem('fdc_signup_fired', '1');
          capture('signup_completed', {});
        }
      });
    } catch { /* analytics is best-effort */ }
  }, []);

  async function rescan() {
    if (!repoId) return;
    setRescanBusy(true);
    setRescanError(null);
    let res;
    try {
      res = await fetch(`/api/repos/${repoId}/rescan`, { method: 'POST' });
    } catch {
      setRescanBusy(false);
      setRescanError('Could not reach the service. Check your connection and try again.');
      return;
    }
    const data = await res.json().catch(() => ({}));
    setRescanBusy(false);
    if (!res.ok) {
      setRescanError((data.error && data.error.message) || 'Could not start the rescan. Try again.');
      return;
    }
    capture('scan_started', {});
    setToast('Rescan started. The table below keeps the old data until it finishes.');
    loadAll();
  }

  const crumbs = [{ label: 'Repos', href: '/repos' }];
  if (summary) crumbs.push({ label: summary.repo.full_name });

  const running = summary && summary.running_scan;
  const latestDone = summary && summary.latest_done_scan;
  const flags = (flagsData && flagsData.flags) || [];
  const noStale = flags.length > 0 && !flags.some((f) => f.status === 'stale' || f.status === 'deletable');
  const candidatesUncertain =
    noStale && ((flagsData && (flagsData.unresolved || []).length > 0) || flags.some((f) => f.confidence === 'uncertain'));

  return (
    <SignedInShell crumbs={crumbs} active="dashboard">
      {fatal && <PageError message={fatal} onRetry={() => { setFatal(null); loadAll(); }} />}
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
      {!fatal && repos !== null && repos.length === 0 && (
        <Card>
          <EmptyState
            title="No repos yet."
            description="Scan a public repo to see its flags here."
            icon={<Icon icon="search" size="lg" />}
            actions={<Button label="Scan a repo" variant="primary" onClick={() => { window.location.href = '/'; }} />}
          />
        </Card>
      )}
      {!fatal && repos !== null && repos.length > 0 && summary && (
        <VStack gap={6}>
          <VStack gap={2}>
            <Heading level={1}>{summary.repo.full_name}</Heading>
            <Text type="supporting">
              {latestDone ? `Last scan ${formatDateTime(latestDone.finished_at || latestDone.created_at)}.` : 'Never scanned.'}
            </Text>
          </VStack>

          <HStack gap={3} wrap="wrap">
            <CountCard number={summary.removed_flags} label="Flags removed" />
            <CountCard number={summary.removed_loc.toLocaleString()} label="Lines deleted" />
            <CountCard number={summary.deletable_loc_now.toLocaleString()} label="Deletable now" />
          </HStack>

          {running && (
            <Banner status="info" title="Rescanning" description={`Rescanning, updated ${elapsedText(running.created_at)} ago.`} />
          )}
          {rescanError && <Banner status="error" title="Rescan failed" description={rescanError} isDismissable />}

          <HStack gap={2} wrap="wrap">
            <Button
              label={running ? 'Rescan in progress' : 'Rescan repo'}
              variant="primary"
              onClick={rescan}
              isDisabled={Boolean(running) || rescanBusy}
              isLoading={rescanBusy}
            />
            <Button
              label="Export CSV"
              variant="secondary"
              isDisabled={!latestDone}
              onClick={() => {
                capture('export_clicked', {});
                window.location.href = `/api/scans/${latestDone.id}/csv`;
              }}
            />
          </HStack>

          {flags.length === 0 && (
            <Card>
              <EmptyState
                title="No flags found"
                description={`No flags found in ${summary.flags_total} files scanned.`}
                icon={<Icon icon="search" size="lg" />}
                actions={<Button label="Scan a repo" variant="primary" onClick={() => { window.location.href = '/'; }} />}
              />
            </Card>
          )}
          {flags.length > 0 && (
            <VStack gap={3}>
              {noStale && (
                <Text type="supporting">
                  {candidatesUncertain
                    ? `${flags.length} candidates need a human look.`
                    : `${flags.length} flags, all active.`}
                </Text>
              )}
              <Text type="supporting">Sorted by status, then deletable lines, then age.</Text>
              <FlagTable flags={flags} mode="dashboard" onIgnore={setIgnoreTarget} />
              <Text type="supporting">Ignored flags stay visible under the Ignored filter and are excluded from the deletable total.</Text>
            </VStack>
          )}
        </VStack>
      )}
      <IgnoreDialog
        flag={ignoreTarget || { id: '', key: '' }}
        open={Boolean(ignoreTarget)}
        onOpenChange={(open) => { if (!open) setIgnoreTarget(null); }}
        onDone={(message) => {
          setToast(message);
          setIgnoreTarget(null);
          loadAll();
        }}
      />
      <ToastHost toast={toast} onDismiss={() => setToast(null)} />
    </SignedInShell>
  );
}
