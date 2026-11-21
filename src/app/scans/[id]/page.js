'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Heading } from '@astryxdesign/core/Heading';
import { Text } from '@astryxdesign/core/Text';
import { Code } from '@astryxdesign/core/Code';
import { Link } from '@astryxdesign/core/Link';
import { Card } from '@astryxdesign/core/Card';
import { Layout } from '@astryxdesign/core/Layout';
import { VStack } from '@astryxdesign/core/VStack';
import { HStack } from '@astryxdesign/core/HStack';
import { Button } from '@astryxdesign/core/Button';
import { Banner } from '@astryxdesign/core/Banner';
import { ProgressBar } from '@astryxdesign/core/ProgressBar';
import { Skeleton } from '@astryxdesign/core/Skeleton';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { Icon } from '@astryxdesign/core/Icon';
import { AlertDialog } from '@astryxdesign/core/AlertDialog';
import { MinimalTop, SiteFooter, ToastHost } from '@/src/components/Chrome';
import { ScanForm } from '@/src/components/ScanForm';
import { FlagTable } from '@/src/components/FlagTable';
import { headlineTotals, formatDateTime, elapsedText, progressPercent, STEP_LABELS } from '@/src/lib/flags-ui';
import { capture } from '@/src/lib/analytics';

const RUNNING = ['queued', 'cloning', 'parsing', 'age', 'provider'];

function ErrorScreen({ message, onRetry }) {
  return (
    <VStack gap={6}>
      <MinimalTop rightLabel="Sign in" rightHref="/login" />
      <Layout height="auto" contentWidth={960} padding={4}>
        <VStack gap={3}>
          <Heading level={1}>Something went wrong.</Heading>
          <Text>{message}</Text>
          <HStack gap={2} wrap="wrap">
            <Button label="Try again" variant="primary" onClick={onRetry} />
            <Button label="Go to the scan tool" variant="secondary" onClick={() => { window.location.href = '/'; }} />
          </HStack>
        </VStack>
      </Layout>
      <SiteFooter />
    </VStack>
  );
}

export default function ScanPage() {
  const { id } = useParams();
  const router = useRouter();
  const [scan, setScan] = useState(null);
  const [repo, setRepo] = useState(null);
  const [isOwner, setIsOwner] = useState(false);
  const [flagsData, setFlagsData] = useState(null);
  const [fatal, setFatal] = useState(null);
  const [toast, setToast] = useState(null);
  const [showSuccess, setShowSuccess] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [nowMs, setNowMs] = useState(Date.now());
  const watchedRunning = useRef(false);
  const completedFired = useRef(false);
  const viewedFired = useRef(false);

  const loadScan = useCallback(async () => {
    let res;
    try {
      res = await fetch(`/api/scans/${id}`);
    } catch {
      setFatal('The database did not answer. Try again in a few minutes.');
      return null;
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setFatal((data.error && data.error.message) || 'No scan at this link. Check the URL.');
      return null;
    }
    setScan(data.scan);
    setRepo(data.repo);
    setIsOwner(Boolean(data.is_owner));
    return data;
  }, [id]);

  const loadFlags = useCallback(async () => {
    const res = await fetch(`/api/scans/${id}/flags`);
    const data = await res.json().catch(() => ({}));
    if (res.ok) setFlagsData(data);
    return data;
  }, [id]);

  // Poll while the scan runs; stop once it lands.
  useEffect(() => {
    let timer = null;
    let stopped = false;
    async function tick() {
      const data = await loadScan();
      if (stopped || !data) return;
      if (RUNNING.includes(data.scan.status)) {
        watchedRunning.current = true;
        timer = setTimeout(tick, 5000);
        return;
      }
      if (data.scan.status === 'done') {
        const flags = await loadFlags();
        if (flags && flags.flags && !completedFired.current) {
          completedFired.current = true;
          const totals = headlineTotals(flags.flags);
          capture('scan_completed', {
            flags: totals.flags,
            deletable: totals.deletableFlags,
            deletable_loc: totals.deletableLoc,
          });
        }
        if (watchedRunning.current) setShowSuccess(true);
        if (!viewedFired.current) {
          viewedFired.current = true;
          capture('report_viewed', {});
        }
      }
    }
    tick();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [loadScan, loadFlags]);

  // Elapsed clock, one tick a second while running.
  useEffect(() => {
    if (!scan || !RUNNING.includes(scan.status)) return undefined;
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [scan]);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setToast('Report link copied.');
    } catch {
      setToast('Could not copy the link. Copy the URL from the address bar.');
    }
  }

  async function deleteScan() {
    const res = await fetch(`/api/scans/${id}`, { method: 'DELETE' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setToast((data.error && data.error.message) || 'Could not delete the scan. Try again.');
      return;
    }
    setDeleteOpen(false);
    router.push('/');
  }

  if (fatal) {
    return (
      <ErrorScreen
        message={fatal}
        onRetry={() => {
          setFatal(null);
          loadScan();
        }}
      />
    );
  }
  if (!scan) {
    return (
      <VStack gap={6}>
        <MinimalTop rightLabel="Sign in" rightHref="/login" />
        <Layout height="auto" contentWidth={960} padding={4}>
          <Card>
            <VStack gap={2} padding={4}>
              <Skeleton width="60%" height={24} index={0} />
              <Skeleton width="100%" height={16} index={1} />
              <Skeleton width="80%" height={16} index={2} />
              <Skeleton width="90%" height={16} index={3} />
            </VStack>
          </Card>
        </Layout>
        <SiteFooter />
      </VStack>
    );
  }

  const progress = scan.progress || {};
  const step = progress.step || scan.status;
  const flags = (flagsData && flagsData.flags) || [];
  const unresolved = (flagsData && flagsData.unresolved) || [];
  const totals = headlineTotals(flags);
  const filesScanned = progress.files_scanned ?? progress.files_total ?? 0;
  const callSites = flags.reduce((n, f) => n + (f.references_count || (f.references || []).length), 0);
  const appliedIgnore = progress.applied_ignore || [];
  const ignoredPaths = progress.ignored_paths || 0;

  let emptyState = null;
  if (scan.status === 'done' && flags.length === 0) {
    emptyState = { title: 'No flags found', description: `No flags found in ${filesScanned} files scanned.`, action: 'Scan a repo' };
  } else if (scan.status === 'done' && totals.deletableFlags === 0 && !flags.some((f) => f.status === 'stale')) {
    if (unresolved.length > 0 || flags.some((f) => f.confidence === 'uncertain')) {
      emptyState = { title: `${flags.length} candidates need a human look`, description: 'These flags have unresolved references, so confidence is capped at possible. Open each one to decide.', action: 'Review candidates' };
    } else {
      emptyState = { title: 'No flags stale', description: `${flags.length} flags, all active.`, action: 'Rescan repo' };
    }
  }

  const progressLine = [
    STEP_LABELS[step] || step,
    step === 'queued' && progress.queue_position ? `Queue position ${progress.queue_position}.` : null,
    `Elapsed ${elapsedText(scan.started_at || scan.created_at, nowMs)}.`,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <VStack gap={6}>
      <MinimalTop rightLabel={isOwner ? 'Dashboard' : 'Sign in'} rightHref={isOwner ? '/dashboard' : '/login'} />
      <Layout height="auto" contentWidth={960} padding={4}>
        <VStack gap={6}>
          <VStack gap={2}>
            <HStack gap={2} vAlign="center" wrap="wrap">
              <Heading level={1}>
                <Code>{repo ? repo.full_name : 'Scan'}</Code>
              </Heading>
              {isOwner && scan.status === 'done' && (
                <>
                  <Button label="Export CSV" variant="secondary" onClick={() => { capture('export_clicked', {}); window.location.href = `/api/scans/${id}/csv`; }} />
                  <Button label="Delete this scan" variant="destructive" onClick={() => setDeleteOpen(true)} />
                </>
              )}
            </HStack>
            <Text type="supporting">Scan {id}</Text>
          </VStack>

          {showSuccess && (
            <Banner
              status="success"
              title="Scan complete"
              description={`Scan complete. ${totals.flags} flags found, ${totals.deletableFlags} deletable.`}
              isDismissable
            />
          )}

          {RUNNING.includes(scan.status) && (
            <VStack gap={3}>
              <ProgressBar label={STEP_LABELS[step] || step} value={progressPercent(progress)} hasValueLabel />
              <Text>{progressLine}</Text>
              <Card>
                <VStack gap={2} padding={4}>
                  <Text type="label">Report URL</Text>
                  <Text>
                    <Code>{typeof window !== 'undefined' ? window.location.href : `/scans/${id}`}</Code>
                  </Text>
                  <Button label="Copy link" variant="secondary" onClick={copyLink} />
                </VStack>
              </Card>
              <Text type="supporting">When the scan finishes, this page shows the report. Anonymous scans purge after 30 days.</Text>
            </VStack>
          )}

          {scan.status === 'failed' && (
            <VStack gap={3}>
              <Banner status="error" title="Scan failed" description={scan.error || 'The scan failed. Try again.'} />
              <Text type="supporting">Failed scan {id} stays here for reference.</Text>
              <ScanForm buttonLabel="Scan again" />
            </VStack>
          )}

          {scan.status === 'done' && (
            <VStack gap={6}>
              <VStack gap={2}>
                <Text type="supporting">
                  Scanned {formatDateTime(scan.finished_at || scan.created_at)}. {filesScanned} files, {callSites} call sites.
                </Text>
                <Heading level={2}>
                  {totals.deletableFlags} flags deletable, {totals.deletableLoc.toLocaleString()} lines.
                </Heading>
                <Text type="supporting">
                  Counts definite and likely flags with a known winning value only.
                  {totals.upToLoc > 0 ? ` ${totals.upToLoc.toLocaleString()} more lines are up to N (winning value unknown).` : ''}
                </Text>
                <Text type="supporting">Sorted by status, then deletable lines, then age.</Text>
              </VStack>

              {emptyState ? (
                <Card>
                  <EmptyState
                    title={emptyState.title}
                    description={emptyState.description}
                    icon={<Icon icon={emptyState.action === 'Scan a repo' ? 'search' : 'check'} size="lg" />}
                    actions={<Button label={emptyState.action} variant="primary" onClick={() => { window.location.href = '/'; }} />}
                  />
                </Card>
              ) : (
                <FlagTable flags={flags} mode="report" />
              )}

              {unresolved.length > 0 && (
                <VStack gap={3}>
                  <Heading level={2}>Unresolved references ({unresolved.length})</Heading>
                  <Text type="supporting">
                    These references could not be resolved to a flag key. Any flag they touch is capped at
                    possible confidence and excluded from the deletable total.
                  </Text>
                  {unresolved.map((u, i) => (
                    <Text key={`${u.file_path}:${u.line}:${i}`}>
                      <Code>{u.file_path}</Code> — line {u.line} ({u.reason})
                    </Text>
                  ))}
                </VStack>
              )}

              {appliedIgnore.length > 0 && (
                <VStack gap={3}>
                  <Heading level={2}>Applied ignore rules</Heading>
                  <Text type="supporting">
                    {ignoredPaths > 0 ? `Ignored ${ignoredPaths} paths by glob.` : 'These rules applied to this scan.'}
                  </Text>
                  {appliedIgnore.map((rule) => (
                    <Text key={rule}>
                      <Code>{rule}</Code>
                    </Text>
                  ))}
                  <Link href="/settings" isStandalone>Sign in to add your own rules.</Link>
                </VStack>
              )}

              <Text type="supporting">
                Anonymous scans purge after 30 days. The deletion diff is stored for your flags; source files are never stored.
              </Text>
            </VStack>
          )}
        </VStack>
      </Layout>
      <SiteFooter />
      <AlertDialog
        isOpen={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete this scan?"
        description={`Scan ${id} for ${repo ? repo.full_name : 'this repo'} will be deleted, along with its ${totals.flags} flags and ${callSites} call sites. This cannot be undone.${RUNNING.includes(scan.status) ? ' The running scan will be cancelled first.' : ''}`}
        actionLabel="Delete scan"
        cancelLabel="Keep scan"
        onAction={deleteScan}
      />
      <ToastHost toast={toast} onDismiss={() => setToast(null)} />
    </VStack>
  );
}
