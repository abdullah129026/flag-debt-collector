'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Heading } from '@astryxdesign/core/Heading';
import { Text } from '@astryxdesign/core/Text';
import { Code } from '@astryxdesign/core/Code';
import { CodeBlock } from '@astryxdesign/core/CodeBlock';
import { Card } from '@astryxdesign/core/Card';
import { VStack } from '@astryxdesign/core/VStack';
import { HStack } from '@astryxdesign/core/HStack';
import { Button } from '@astryxdesign/core/Button';
import { Banner } from '@astryxdesign/core/Banner';
import { Skeleton } from '@astryxdesign/core/Skeleton';
import { Selector } from '@astryxdesign/core/Selector';
import { TabList, Tab } from '@astryxdesign/core/TabList';
import { SignedInShell, ToastHost, PageError } from '@/src/components/Chrome';
import { StatusBadge, ConfidenceBadge } from '@/src/components/FlagBadges';
import { IgnoreDialog, ActionConfirmDialog } from '@/src/components/FlagActions';
import { isKillSwitchKey } from '@/lib/scan/signals';
import { titleStatus, ageDays, formatDate, formatDateTime, elapsedText } from '@/src/lib/flags-ui';

function SignalLine({ met, children }) {
  return (
    <Text>
      {met ? 'Met: ' : 'Not met: '}
      {children}
    </Text>
  );
}

export default function FlagDetailPage() {
  const { flagId } = useParams();
  const [data, setData] = useState(null);
  const [running, setRunning] = useState(null);
  const [fatal, setFatal] = useState(null);
  const [toast, setToast] = useState(null);
  const [tab, setTab] = useState('call-sites');
  const [ignoreOpen, setIgnoreOpen] = useState(false);
  const [ignoreMode, setIgnoreMode] = useState('ignore');
  const [markOpen, setMarkOpen] = useState(false);
  const [reopenOpen, setReopenOpen] = useState(false);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [winningPick, setWinningPick] = useState('');
  const [pickedValue, setPickedValue] = useState(null);

  const load = useCallback(async () => {
    let res;
    try {
      res = await fetch(`/api/flags/${flagId}`);
    } catch {
      setFatal('The database did not answer. Try again in a few minutes.');
      return;
    }
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setFatal((body.error && body.error.message) || 'No flag at that id. Check the URL.');
      return;
    }
    setData(body);
    const sumRes = await fetch(`/api/repos/${body.repo.id}/summary`);
    if (sumRes.ok) {
      const sum = await sumRes.json().catch(() => ({}));
      setRunning(sum.running_scan || null);
    }
  }, [flagId]);

  useEffect(() => {
    load();
  }, [load]);

  async function postAction(action, body) {
    let res;
    try {
      res = await fetch(`/api/flags/${flagId}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body || {}),
      });
    } catch {
      return 'Could not reach the service. Check your connection and try again.';
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return (data.error && data.error.message) || 'Could not save. Try again.';
    load();
    return null;
  }

  if (fatal) {
    return (
      <SignedInShell crumbs={[{ label: 'Repos', href: '/repos' }]} active="dashboard">
        <PageError message={fatal} onRetry={() => { setFatal(null); load(); }} />
      </SignedInShell>
    );
  }
  if (!data) {
    return (
      <SignedInShell crumbs={[{ label: 'Repos', href: '/repos' }]} active="dashboard">
        <Card>
          <VStack gap={2} padding={4}>
            <Skeleton width="60%" height={24} index={0} />
            <Skeleton width="40%" height={16} index={1} />
            <Skeleton width="100%" height={16} index={2} />
            <Skeleton width="80%" height={16} index={3} />
            <Skeleton width="90%" height={16} index={4} />
          </VStack>
        </Card>
      </SignedInShell>
    );
  }

  const { flag, repo, scan, user_state, call_sites, events, unresolved } = data;
  const signals = flag.signals || {};
  const signalCount = Object.values(signals).filter(Boolean).length;
  const isEnvOrConfig = flag.kind === 'env' || flag.kind === 'config';
  const killSwitch = isKillSwitchKey(flag.key) || (flag.rollout_by_env && flag.rollout_by_env.temporary === false);
  const capOverridden = user_state && user_state.cap_override;
  const productionSites = (call_sites || []).flatMap((g) => g.sites.filter((s) => s.kind === 'call' || s.kind === 'definition'));
  const testSites = (call_sites || []).flatMap((g) => g.sites.filter((s) => s.kind === 'test'));
  const age = ageDays(flag);
  const changedAge = flag.last_changed_at ? ageDays({ created_at_git: flag.last_changed_at }) : null;
  const winningUnknown = flag.winning_value === null || flag.winning_value === undefined;
  const markedRemoved = user_state && user_state.user_status === 'marked_removed';

  const confidenceReason =
    `${titleStatus(flag.confidence)}: ${signalCount} of 3 staleness signals met.` +
    (unresolved.length > 0 ? ' Capped at possible confidence: unresolved references.' : '');

  const crumbs = [
    { label: 'Repos', href: '/repos' },
    { label: repo.full_name, href: `/dashboard?repo=${repo.id}` },
    { label: `Scan ${scan ? scan.id.slice(0, 8) : ''}`, href: scan ? `/scans/${scan.id}` : undefined },
    { label: flag.key },
  ];

  const signalBlock = (
    <VStack gap={2}>
      {isEnvOrConfig ? (
        <Text>Rollout signal does not apply: env flags are on or off. Capped at Stale.</Text>
      ) : (
        <SignalLine met={signals.settled_rollout}>
          {signals.settled_rollout
            ? `Settled rollout: ${flag.rollout_pct}% now in production${flag.rollout_source ? ` (${flag.rollout_source})` : ''}.`
            : `Settled rollout: not met. Rollout is ${typeof flag.rollout_pct === 'number' ? `${flag.rollout_pct}%` : 'unknown'}.`}
        </SignalLine>
      )}
      <SignalLine met={signals.old_untouched}>
        {signals.old_untouched
          ? `Old and untouched: created ${age} days ago, no call-site change in ${changedAge} days.`
          : `Old and untouched: not met. Created ${age === null ? 'an unknown time' : `${age} days`} ago.`}
      </SignalLine>
      <SignalLine met={signals.narrow_quiet}>
        {productionSites.length === 0
          ? 'Narrow or quiet: references only in tests.'
          : `Narrow or quiet: ${productionSites.length} production call sites.`}
      </SignalLine>
      {killSwitch && (
        <Text>
          Capped at Stale: kill switch (provider-marked non-temporary, or key matches the kill-switch
          name list: kill, killswitch, emergency, maintenance, circuit-breaker).
        </Text>
      )}
    </VStack>
  );

  return (
    <SignedInShell crumbs={crumbs} active="dashboard">
      {running && (
        <Banner status="info" title="Rescanning" description={`Rescanning, updated ${elapsedText(running.created_at)} ago.`} />
      )}

      <VStack gap={2}>
        <HStack gap={2} vAlign="center" wrap="wrap">
          <Heading level={1}>
            {flag.status === 'removed' ? <s><Code>{flag.key}</Code></s> : <Code>{flag.key}</Code>}
          </Heading>
          <StatusBadge status={titleStatus(flag.status)} />
          <ConfidenceBadge confidence={flag.confidence} />
        </HStack>
        <Text type="supporting">{confidenceReason}</Text>
      </VStack>

      <Card>
        <VStack gap={2} padding={4}>
          <Heading level={2}>Signals</Heading>
          {signalBlock}
          {killSwitch && !capOverridden && flag.status !== 'removed' && (
            <Button label="Override cap" variant="secondary" onClick={() => setOverrideOpen(true)} />
          )}
        </VStack>
      </Card>

      <Card>
        <VStack gap={2} padding={4} id="loc-card">
          <Heading level={2}>Deletable lines</Heading>
          <Text>
            {flag.loc_formula ||
              'Deletable LOC = lines in the losing branch + the guard lines + the flag definition line, from AST node spans.'}
          </Text>
          {winningUnknown ? (
            <VStack gap={3}>
              <Text>
                Up to {(flag.deletable_loc || 0).toLocaleString()} lines. The winning value is unknown, so no diff
                is shown. Pick the winning value below to compute the diff.
              </Text>
              <Selector
                label="Winning value"
                value={winningPick}
                onChange={setWinningPick}
                options={['', 'true', 'false']}
              />
              <Button
                label="Compute diff"
                variant="primary"
                isDisabled={!winningPick}
                onClick={() => setPickedValue(winningPick)}
              />
              {pickedValue !== null && (
                <Text>
                  If {pickedValue} wins: {(flag.deletable_loc || 0).toLocaleString()} lines. No diff is stored
                  for this flag yet: the scanner stores a diff only when the winning value is known at scan
                  time, so the Diff tab states the assumption instead of showing a computed diff.
                </Text>
              )}
            </VStack>
          ) : (
            <Text>
              Known winning value: {String(flag.winning_value)}. {(flag.deletable_loc || 0).toLocaleString()} lines.
            </Text>
          )}
        </VStack>
      </Card>

      <VStack gap={3}>
        <TabList value={tab} onChange={setTab} role="tablist" hasDivider>
          <Tab value="call-sites" label="Call sites" panelId="panel-call-sites" />
          <Tab value="history" label="History" panelId="panel-history" />
          <Tab value="signals" label="Signals" panelId="panel-signals" />
          <Tab value="diff" label="Diff" panelId="panel-diff" />
        </TabList>
        <div id="panel-call-sites" role="tabpanel" hidden={tab !== 'call-sites'}>
          <VStack gap={3}>
            {(call_sites || []).length === 0 && <Text type="supporting">No call sites recorded for this flag.</Text>}
            {productionSites.length > 0 && (
              <VStack gap={2}>
                <Text type="supporting">Production ({productionSites.length})</Text>
                {(call_sites || [])
                  .filter((g) => g.sites.some((s) => s.kind === 'call' || s.kind === 'definition'))
                  .map((g) => (
                    <Text key={g.file}>
                      <Code>{g.file}</Code> — {g.sites.filter((s) => s.kind === 'call' || s.kind === 'definition').length} production call sites, lines{' '}
                      {g.sites.filter((s) => s.kind === 'call' || s.kind === 'definition').map((s) => s.line).join(', ')}
                    </Text>
                  ))}
              </VStack>
            )}
            {testSites.length > 0 && (
              <VStack gap={2}>
                <Text type="supporting">Tests ({testSites.length})</Text>
                {(call_sites || [])
                  .filter((g) => g.sites.some((s) => s.kind === 'test'))
                  .map((g) => (
                    <Text key={g.file}>
                      <Code>{g.file}</Code> — {g.sites.filter((s) => s.kind === 'test').length} test call sites, lines{' '}
                      {g.sites.filter((s) => s.kind === 'test').map((s) => s.line).join(', ')}
                    </Text>
                  ))}
              </VStack>
            )}
            {(call_sites || []).some((g) => g.sites.every((s) => s.kind === 'test')) && (
              <Text type="supporting">A file with no production call site reads tests only.</Text>
            )}
          </VStack>
        </div>
        <div id="panel-history" role="tabpanel" hidden={tab !== 'history'}>
          <VStack gap={2}>
            {(events || []).length === 0 && <Text type="supporting">No recorded actions yet.</Text>}
            {(events || []).map((e, i) => (
              <Text key={`${e.created_at}:${e.action}:${i}`}>
                {formatDate(e.created_at)} — {e.action}
                {e.reason ? `: ${e.reason}` : ''}
              </Text>
            ))}
            {flag.created_at_git && <Text>First seen in git on {formatDate(flag.created_at_git)}.</Text>}
            {scan && <Text>Flagged {flag.status} by scan {scan.id.slice(0, 8)}, {formatDateTime(scan.created_at)}.</Text>}
          </VStack>
        </div>
        <div id="panel-signals" role="tabpanel" hidden={tab !== 'signals'}>
          {signalBlock}
        </div>
        <div id="panel-diff" role="tabpanel" hidden={tab !== 'diff'}>
          {flag.diff ? (
            <CodeBlock
              title={(call_sites && call_sites[0] && call_sites[0].file) || flag.key}
              language="plaintext"
              isDiff
              hasLineNumbers
              width="100%"
              code={flag.diff}
            />
          ) : (
            <Text type="supporting">
              {winningUnknown
                ? 'No diff for this flag. The winning value is unknown, so the scanner stored no diff. Pick the winning value in the deletable-lines card above; the tab then states the assumption.'
                : 'No diff for this flag. The call sites are listed under Call sites.'}
            </Text>
          )}
        </div>
      </VStack>

      {unresolved.length > 0 && (
        <VStack gap={3}>
          <Heading level={2}>Unresolved references ({unresolved.length})</Heading>
          <Text type="supporting">
            This flag is capped at possible confidence and excluded from the deletable total because of these references.
          </Text>
          {unresolved.map((u, i) => (
            <Text key={`${u.file_path}:${u.line}:${i}`}>
              <Code>{u.file_path}</Code> — line {u.line} ({u.reason})
            </Text>
          ))}
        </VStack>
      )}

      <HStack gap={2} wrap="wrap">
        {flag.status === 'removed' ? (
          <>
            <Text>Removed and confirmed by scan {scan ? scan.id.slice(0, 8) : ''}.</Text>
            <Button
              label="Reopen flag"
              variant="secondary"
              onClick={() => setReopenOpen(true)}
            />
          </>
        ) : (
          <>
            {flag.status === 'ignored' ? (
              <Button
                label="Un-ignore flag"
                variant="secondary"
                onClick={() => {
                  setIgnoreMode('unignore');
                  setIgnoreOpen(true);
                }}
              />
            ) : (
              <Button
                label="Ignore flag"
                variant="secondary"
                onClick={() => {
                  setIgnoreMode('ignore');
                  setIgnoreOpen(true);
                }}
              />
            )}
            <Button
              label={markedRemoved ? 'Removal pending next rescan' : 'Mark removed'}
              variant="secondary"
              isDisabled={Boolean(markedRemoved)}
              onClick={() => setMarkOpen(true)}
            />
          </>
        )}
      </HStack>

      <IgnoreDialog
        flag={flag}
        open={ignoreOpen}
        mode={ignoreMode}
        onOpenChange={setIgnoreOpen}
        onDone={(message) => {
          setToast(message);
          load();
        }}
      />
      <ActionConfirmDialog
        open={markOpen}
        onOpenChange={setMarkOpen}
        title={`Mark ${flag.key} removed?`}
        description="The next rescan confirms it. If the flag is still there, it returns to Active and the event is recorded."
        actionLabel="Mark removed"
        onConfirm={async () => {
          const message = await postAction('mark-removed', {});
          if (!message) setToast('Flag marked removed. The next rescan confirms it.');
          return message;
        }}
      />
      <ActionConfirmDialog
        open={reopenOpen}
        onOpenChange={setReopenOpen}
        title={`Reopen ${flag.key}?`}
        description="The flag returns to Active on the next scan if it reappears, and a reappeared event is recorded if it is found again."
        actionLabel="Reopen flag"
        onConfirm={async () => {
          const message = await postAction('reopen', {});
          if (!message) setToast(`Flag reopened. ${flag.key} returns to Active on the next scan.`);
          return message;
        }}
      />
      <ActionConfirmDialog
        open={overrideOpen}
        onOpenChange={setOverrideOpen}
        title="Override the kill-switch cap?"
        description="This flag will be treated as deletable. The override is recorded as an event."
        actionLabel="Override cap"
        onConfirm={async () => {
          const message = await postAction('override-cap', {});
          if (!message) setToast('Kill-switch cap overridden. The flag is treated as deletable.');
          return message;
        }}
      />
      <ToastHost toast={toast} onDismiss={() => setToast(null)} />
    </SignedInShell>
  );
}
