'use client';

import {useMemo, useState} from 'react';
import {Heading} from '@astryxdesign/core/Heading';
import {Text} from '@astryxdesign/core/Text';
import {Link} from '@astryxdesign/core/Link';
import {Code} from '@astryxdesign/core/Code';
import {CodeBlock} from '@astryxdesign/core/CodeBlock';
import {Button} from '@astryxdesign/core/Button';
import {ButtonGroup} from '@astryxdesign/core/ButtonGroup';
import {Badge} from '@astryxdesign/core/Badge';
import {StatusDot} from '@astryxdesign/core/StatusDot';
import {Icon} from '@astryxdesign/core/Icon';
import {
  Table,
  useTableSortable,
  useTableSelection,
  useTablePagination,
  useTableStickyColumns,
  proportional,
} from '@astryxdesign/core/Table';
import {SegmentedControl, SegmentedControlItem} from '@astryxdesign/core/SegmentedControl';
import {TabList, Tab} from '@astryxdesign/core/TabList';
import {TextInput} from '@astryxdesign/core/TextInput';
import {TextArea} from '@astryxdesign/core/TextArea';
import {Selector} from '@astryxdesign/core/Selector';
import {CheckboxInput} from '@astryxdesign/core/CheckboxInput';
import {Switch} from '@astryxdesign/core/Switch';
import {FormLayout} from '@astryxdesign/core/FormLayout';
import {NumberInput} from '@astryxdesign/core/NumberInput';
import {Banner} from '@astryxdesign/core/Banner';
import {ProgressBar} from '@astryxdesign/core/ProgressBar';
import {Spinner} from '@astryxdesign/core/Spinner';
import {Skeleton} from '@astryxdesign/core/Skeleton';
import {EmptyState} from '@astryxdesign/core/EmptyState';
import {Dialog, DialogHeader} from '@astryxdesign/core/Dialog';
import {AlertDialog} from '@astryxdesign/core/AlertDialog';
import {Toast} from '@astryxdesign/core/Toast';
import {AppShell} from '@astryxdesign/core/AppShell';
import {TopNav, TopNavItem} from '@astryxdesign/core/TopNav';
import {SideNav, SideNavSection, SideNavItem} from '@astryxdesign/core/SideNav';
import {Breadcrumbs, BreadcrumbItem} from '@astryxdesign/core/Breadcrumbs';
import {Card} from '@astryxdesign/core/Card';
import {Layout} from '@astryxdesign/core/Layout';
import {VStack} from '@astryxdesign/core/VStack';
import {HStack} from '@astryxdesign/core/HStack';

// One flags array drives the table, the chips, and the diff.
const FLAGS = [
  {key: 'new_checkout_enabled', status: 'Deletable', confidence: 'definite', age: 412, rollout: '100%', rolloutValue: 100, reachable: 'reachable', loc: 1204},
  {key: 'legacy_billing_flow', status: 'Deletable', confidence: 'likely', age: 388, rollout: '100%', rolloutValue: 100, reachable: 'reachable', loc: 862},
  {key: 'dark_mode_v2', status: 'Stale', confidence: 'possible', age: 97, rollout: '25%', rolloutValue: 25, reachable: 'reachable', loc: 341},
  {key: 'holiday_promo_banner', status: 'Watch', confidence: 'uncertain', age: 41, rollout: '10%', rolloutValue: 10, reachable: 'tests only', loc: 96},
  {key: 'kill_switch_payments', status: 'Active', confidence: 'definite', age: 12, rollout: '100%', rolloutValue: 100, reachable: 'reachable', loc: 0},
  {key: 'old_search_ranking', status: 'Ignored', confidence: 'likely', age: 203, rollout: 'n/a', rolloutValue: -1, reachable: 'not referenced', loc: 214},
];

// DESIGN.md section 4: shape and text carry the status, color only helps.
// Watch and Ignored have no matching glyph in the 0.7.16 icon registry
// (no eye, no pause), so they render text only.
const STATUS_BADGE = {
  Deletable: {variant: 'error', icon: 'close', shape: 'circle with an x'},
  Stale: {variant: 'warning', icon: 'clock', shape: 'clock'},
  Watch: {variant: 'info', icon: null, shape: 'eye (no glyph in the registry)'},
  Active: {variant: 'success', icon: 'check', shape: 'check'},
  Ignored: {variant: 'neutral', icon: null, shape: 'pause (no glyph in the registry)'},
  Removed: {variant: 'neutral', icon: 'check', shape: 'check, flag key struck through'},
};

const STATUS_RANK = {Deletable: 0, Stale: 1, Watch: 2, Active: 3, Ignored: 4, Removed: 5};

function StatusBadge({status}) {
  const spec = STATUS_BADGE[status];
  return (
    <Badge
      variant={spec.variant}
      label={status}
      icon={spec.icon ? <Icon icon={spec.icon} size="sm" /> : undefined}
    />
  );
}

function ConfidenceBadge({confidence}) {
  return <Badge variant={confidence === 'uncertain' ? 'warning' : 'neutral'} label={confidence} />;
}

const DIFF = `--- a/src/checkout/flags.js
+++ b/src/checkout/flags.js
@@ -4,9 +4,6 @@
 export const FLAGS = {
-  newCheckoutEnabled: true,
   darkModeV2: true,
-  legacyBillingFlow: false,
   holidayPromoBanner: false,
 };
 
 export function checkoutVersion() {
-  return FLAGS.newCheckoutEnabled ? 'v2' : 'v1';
+  return 'v2';
 }`;

function sortFlags(rows, sort) {
  if (!sort.length) return rows;
  const {sortKey, direction} = sort[0];
  const value = (row) => {
    if (sortKey === 'status') return STATUS_RANK[row.status];
    if (sortKey === 'rolloutValue') return row.rolloutValue;
    return row[sortKey];
  };
  const dir = direction === 'ascending' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const va = value(a);
    const vb = value(b);
    if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
    return String(va).localeCompare(String(vb)) * dir;
  });
}

export default function DesignSystemPage() {
  const [density, setDensity] = useState('balanced');
  const [sort, setSort] = useState([{sortKey: 'age', direction: 'descending'}]);
  const [selected, setSelected] = useState(new Set());
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState(['Status: Deletable', 'Age: over 90 days', 'Repo: acme/shop-web']);
  const [tab, setTab] = useState('call-sites');
  const [ignoreOpen, setIgnoreOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [toast, setToast] = useState(null);
  const [repoUrl, setRepoUrl] = useState('https://github.com/acme/shop-web');
  const [ignoreNote, setIgnoreNote] = useState('');
  const [ignoreReason, setIgnoreReason] = useState('kill switch');
  const [includeTests, setIncludeTests] = useState(true);
  const [weeklyRescan, setWeeklyRescan] = useState(false);
  const [threshold, setThreshold] = useState(90);
  const [entryError, setEntryError] = useState(null);

  const sortedFlags = useMemo(() => sortFlags(FLAGS, sort), [sort]);
  const pageSize = 3;
  const visibleFlags = sortedFlags.slice((page - 1) * pageSize, page * pageSize);

  const sortPlugin = useTableSortable({sort, onSortChange: setSort});
  const selectionPlugin = useTableSelection({
    getIsItemSelected: (item) => selected.has(item.key),
    onSelectItem: ({item, isSelected}) => {
      setSelected((prev) => {
        const next = new Set(prev);
        if (isSelected) next.add(item.key);
        else next.delete(item.key);
        return next;
      });
    },
    onSelectAll: ({isAllSelected}) =>
      setSelected(isAllSelected ? new Set(FLAGS.map((f) => f.key)) : new Set()),
    getIsAllSelected: () => FLAGS.length > 0 && selected.size === FLAGS.length,
    getIsIndeterminate: () => selected.size > 0 && selected.size < FLAGS.length,
    getRowLabel: (item) => item.key,
  });
  const paginationPlugin = useTablePagination({
    page,
    onPageChange: setPage,
    totalItems: FLAGS.length,
    pageSize,
  });
  // Same floors as the shared FlagTable: the 60px omitted-width floor cut
  // status badges to an icon at 375px, and the flag key broke mid-word.
  const stickyPlugin = useTableStickyColumns({startKeys: ['flag']});

  const columns = [
    {key: 'flag', header: 'Flag', width: proportional(2, {minWidth: 200}), sortable: true, renderCell: (item) => <span style={{whiteSpace: 'nowrap'}}><Code>{item.key}</Code></span>},
    {key: 'status', header: 'Status', width: proportional(1, {minWidth: 132}), sortable: true, renderCell: (item) => <StatusBadge status={item.status} />},
    {key: 'age', header: 'Age', sortable: true, align: 'end', renderCell: (item) => <Text hasTabularNumbers>{item.age}d</Text>},
    {key: 'rollout', header: 'Rollout', sortable: {sortKey: 'rolloutValue'}, align: 'end', renderCell: (item) => <Text hasTabularNumbers>{item.rollout}</Text>},
    {key: 'reachable', header: 'Reachable', width: proportional(1, {minWidth: 120}), sortable: true, renderCell: (item) => <Text>{item.reachable}</Text>},
    {key: 'loc', header: 'Deletable LOC', sortable: true, align: 'end', renderCell: (item) => <Text hasTabularNumbers>{item.loc.toLocaleString()}</Text>},
  ];

  return (
    <Layout height="auto" contentWidth={960} padding={4}>
      <VStack gap={6}>
        <VStack gap={2}>
          <Heading level={1}>Design system</Heading>
          <Text color="secondary">
            Every component in the flag-debt theme, against real flag data from acme/shop-web.
            Monochrome chrome; color only on flag status and confidence.
          </Text>
        </VStack>

        <VStack gap={3}>
          <Heading level={2}>Type and text</Heading>
          <Heading level={1}>Heading 1</Heading>
          <Heading level={2}>Heading 2</Heading>
          <Heading level={3}>Heading 3</Heading>
          <Heading level={4}>Heading 4</Heading>
          <Heading level={5}>Heading 5</Heading>
          <Heading level={6}>Heading 6</Heading>
          <Text type="large">Large text: 6 flags found, 2 deletable.</Text>
          <Text>Body text: the scan read 10,000 files in acme/shop-web and kept 41 call sites as proof.</Text>
          <Text type="label">Label text: scan id</Text>
          <Text type="supporting">Supporting text: last scan 2026-11-18, 09:12 PKT.</Text>
          <Text>
            Inline code reads like <Code>new_checkout_enabled</Code> inside a sentence, and the
            docs live at <Link href="https://github.com/acme/shop-web" isExternalLink isStandalone>acme/shop-web on GitHub</Link>.
          </Text>
        </VStack>

        <VStack gap={3}>
          <Heading level={2}>Buttons</Heading>
          {['primary', 'secondary', 'ghost', 'destructive'].map((variant) => (
            <HStack key={variant} gap={2} wrap="wrap" vAlign="center">
              <Button label={`${variant} action`} variant={variant} />
              <Button label={`${variant} disabled`} variant={variant} isDisabled />
              <Button label={`${variant} loading`} variant={variant} isLoading />
            </HStack>
          ))}
          <ButtonGroup label="Flag actions">
            <Button label="Rescan" />
            <Button label="Export CSV" />
            <Button label="Ignore" />
          </ButtonGroup>
        </VStack>

        <VStack gap={3}>
          <Heading level={2}>Status language</Heading>
          {Object.keys(STATUS_BADGE).map((status) => (
            <HStack key={status} gap={2} wrap="wrap" vAlign="center">
              <StatusBadge status={status} />
              <ConfidenceBadge confidence={status === 'Watch' ? 'uncertain' : 'definite'} />
              <Text type="supporting">Shape: {STATUS_BADGE[status].shape}.</Text>
            </HStack>
          ))}
          <HStack gap={3} wrap="wrap" vAlign="center">
            <HStack gap={1} vAlign="center"><StatusDot variant="error" label="Deletable" /><Text>Deletable</Text></HStack>
            <HStack gap={1} vAlign="center"><StatusDot variant="warning" label="Stale" /><Text>Stale</Text></HStack>
            <HStack gap={1} vAlign="center"><StatusDot variant="accent" label="Watch" /><Text>Watch</Text></HStack>
            <HStack gap={1} vAlign="center"><StatusDot variant="success" label="Active" /><Text>Active</Text></HStack>
            <HStack gap={1} vAlign="center"><StatusDot variant="neutral" label="Ignored" /><Text>Ignored</Text></HStack>
          </HStack>
          <Text type="supporting">Row tints are backgrounds, never borders. Each row below uses the tint for its status.</Text>
          <Card variant="red"><HStack gap={2} vAlign="center"><Code>new_checkout_enabled</Code><Text>Deletable row tint (red).</Text></HStack></Card>
          <Card variant="yellow"><HStack gap={2} vAlign="center"><Code>dark_mode_v2</Code><Text>Stale row tint (yellow).</Text></HStack></Card>
          <Card variant="blue"><HStack gap={2} vAlign="center"><Code>holiday_promo_banner</Code><Text>Watch row tint (blue).</Text></HStack></Card>
          <Card variant="green"><HStack gap={2} vAlign="center"><Code>kill_switch_payments</Code><Text>Active row tint (green).</Text></HStack></Card>
        </VStack>

        <VStack gap={3}>
          <Heading level={2}>Flag table</Heading>
          <HStack gap={2} vAlign="center">
            <Text type="label">Density</Text>
            <SegmentedControl label="Table density" value={density} onChange={setDensity}>
              <SegmentedControlItem value="compact" label="Compact" />
              <SegmentedControlItem value="balanced" label="Balanced" />
              <SegmentedControlItem value="spacious" label="Spacious" />
            </SegmentedControl>
          </HStack>
          <Table
            data={visibleFlags}
            columns={columns}
            idKey="key"
            density={density}
            plugins={{sort: sortPlugin, selection: selectionPlugin, pagination: paginationPlugin, stickyColumns: stickyPlugin}}
          />
          <Text type="supporting">
            Showing {visibleFlags.length} of {FLAGS.length} flags
            {selected.size > 0 ? `, ${selected.size} selected` : ''}.
          </Text>
        </VStack>

        <VStack gap={3}>
          <Heading level={2}>Filter chips</Heading>
          <HStack gap={2} wrap="wrap" vAlign="center">
            {filters.map((filter) => (
              <HStack key={filter} gap={1} vAlign="center">
                <Badge variant="neutral" label={filter} />
                <Button
                  label={`Remove filter ${filter}`}
                  variant="ghost"
                  size="sm"
                  isIconOnly
                  icon={<Icon icon="close" size="sm" />}
                  onClick={() => setFilters(filters.filter((f) => f !== filter))}
                />
              </HStack>
            ))}
            {filters.length > 0 && (
              <Button label="Clear all" variant="ghost" size="sm" onClick={() => setFilters([])} />
            )}
            {filters.length === 0 && <Text type="supporting">No filters applied.</Text>}
          </HStack>
        </VStack>

        <VStack gap={3}>
          <Heading level={2}>Diff viewer</Heading>
          <Text type="supporting">Removing new_checkout_enabled and legacy_billing_flow from acme/shop-web. Added lines read green, removed lines red, context lines plain.</Text>
          <CodeBlock
            title="src/checkout/flags.js"
            language="plaintext"
            isDiff
            hasLineNumbers
            width="100%"
            code={DIFF}
          />
        </VStack>

        <VStack gap={3}>
          <Heading level={2}>Flag detail</Heading>
          <TabList value={tab} onChange={setTab} role="tablist" hasDivider>
            <Tab value="call-sites" label="Call sites" panelId="panel-call-sites" />
            <Tab value="history" label="History" panelId="panel-history" />
            <Tab value="signals" label="Signals" panelId="panel-signals" />
          </TabList>
          <div id="panel-call-sites" role="tabpanel" hidden={tab !== 'call-sites'}>
            <VStack gap={2}>
              <Text><Code>src/checkout/flags.js</Code> — 2 production call sites.</Text>
              <Text><Code>src/checkout/page.js</Code> — 1 production call site.</Text>
              <Text><Code>tests/checkout/flags.test.js</Code> — 1 test call site.</Text>
            </VStack>
          </div>
          <div id="panel-history" role="tabpanel" hidden={tab !== 'history'}>
            <VStack gap={2}>
              <Text>2025-09-30 — added in commit a1b2c3d, checkout v2 launch.</Text>
              <Text>2026-02-14 — rollout reached 100% in production.</Text>
              <Text>2026-11-18 — flagged deletable by scan 2026-11-18-a1b2.</Text>
            </VStack>
          </div>
          <div id="panel-signals" role="tabpanel" hidden={tab !== 'signals'}>
            <VStack gap={2}>
              <Text>Last commit touching the key: 412 days ago.</Text>
              <Text>Referenced in production: yes, 3 call sites.</Text>
              <Text>Unresolved references: none. Confidence: definite.</Text>
            </VStack>
          </div>
        </VStack>

        <VStack gap={3}>
          <Heading level={2}>Forms</Heading>
          <FormLayout>
            <TextInput label="Repo URL" value={repoUrl} onChange={setRepoUrl} placeholder="https://github.com/acme/shop-web" description="Public repos only in v1." />
            <TextInput label="Provider token" value="" onChange={() => {}} placeholder="Paste a LaunchDarkly token" status={{type: 'error', message: 'Token invalid. Check the token and test the connection again.'}} />
            <TextInput label="Scan id" value="2026-11-18-a1b2" onChange={() => {}} isDisabled disabledMessage="Scan ids are set by the scanner, not by hand." />
            <TextArea label="Ignore reason note" value={ignoreNote} onChange={setIgnoreNote} rows={3} placeholder="Why this flag stays for now." />
            <Selector label="Ignore reason" value={ignoreReason} onChange={setIgnoreReason} options={['kill switch', 'seasonal', 'permanent', 'other']} />
            <NumberInput
              label="Staleness threshold (days)"
              value={threshold}
              onChange={setThreshold}
              isIntegerOnly
              min={1}
              max={365}
              description="Flags untouched longer than this count as stale."
              onEntryErrorChange={setEntryError}
              status={entryError ? {type: 'error', message: entryErrorMessage(entryError)} : undefined}
            />
            <Text type="supporting">Entry error (0.7.16): type 1.5 and press Enter. The field keeps your text and reports the rejection instead of silently clamping it.</Text>
            <CheckboxInput label="Include test call sites" description="Count references from test files as reachable." value={includeTests} onChange={setIncludeTests} />
            <Switch label="Rescan weekly" description="Re-scan acme/shop-web every Monday at 09:00 PKT." value={weeklyRescan} onChange={setWeeklyRescan} />
          </FormLayout>
        </VStack>

        <VStack gap={3}>
          <Heading level={2}>Feedback</Heading>
          <Banner status="info" title="Rescan in progress" description="Scan 2026-11-18-a1b2 is cloning acme/shop-web. The dashboard keeps the old data until it finishes." isDismissable />
          <Banner status="error" title="LaunchDarkly token invalid" description="Rollout reads unknown (token invalid). Paste a new token in Settings, then test the connection." />
          <Banner status="warning" title="Scan queue full" description="10 scans are queued. Try again in a few minutes, or wait for a slot to open." />
          <ProgressBar label="Cloning acme/shop-web" value={62} hasValueLabel />
          <Spinner label="Parsing files" />
          <VStack gap={2}>
            <Skeleton width="100%" height={16} index={0} />
            <Skeleton width="80%" height={16} index={1} />
            <Skeleton width="60%" height={16} index={2} />
          </VStack>
        </VStack>

        <VStack gap={3}>
          <Heading level={2}>Empty states</Heading>
          <Card>
            <EmptyState
              title="No flags yet"
              description="Scan a public repo to see its flags here."
              icon={<Icon icon="search" size="lg" />}
              actions={<Button label="Scan a repo" variant="primary" />}
            />
          </Card>
          <Card>
            <EmptyState
              title="Nothing stale"
              description="Every flag in acme/shop-web was touched in the last 90 days."
              icon={<Icon icon="check" size="lg" />}
              isCompact
              actions={<Button label="Rescan repo" variant="secondary" />}
            />
          </Card>
          <Card>
            <EmptyState
              title="3 candidates need a human look"
              description="These flags have unresolved references, so confidence is capped at possible. Open each one to decide."
              icon={<Icon icon="warning" size="lg" />}
              actions={<Button label="Review candidates" variant="primary" />}
            />
          </Card>
        </VStack>

        <VStack gap={3}>
          <Heading level={2}>Overlays</Heading>
          <HStack gap={2} wrap="wrap">
            <Button label="Ignore a flag" variant="secondary" onClick={() => setIgnoreOpen(true)} />
            <Button label="Delete this scan" variant="destructive" onClick={() => setDeleteOpen(true)} />
            <Button label="Show toast" variant="secondary" onClick={() => setToast('Flag ignored. new_checkout_enabled left the deletable total.')} />
          </HStack>
          <Text type="supporting">The delete-scan dialog names the typed-DELETE pattern: account deletion is the flow that asks you to type DELETE. AlertDialog has no text input slot, so the scan delete confirms with one click.</Text>
          {toast && <Toast body={toast} onDismiss={() => setToast(null)} onHide={() => setToast(null)} />}
          <Dialog isOpen={ignoreOpen} onOpenChange={setIgnoreOpen} purpose="form">
            <DialogHeader
              title="Ignore new_checkout_enabled"
              subtitle="The flag leaves the deletable total. The reason is stored with the flag."
              onOpenChange={setIgnoreOpen}
            />
            <VStack gap={3} padding={4}>
              <Selector label="Ignore reason" value={ignoreReason} onChange={setIgnoreReason} options={['kill switch', 'seasonal', 'permanent', 'other']} />
              <TextArea label="Note" value={ignoreNote} onChange={setIgnoreNote} rows={3} placeholder="Why this flag stays for now." />
              <HStack gap={2} hAlign="end">
                <Button label="Cancel" variant="ghost" onClick={() => setIgnoreOpen(false)} />
                <Button label="Ignore flag" variant="primary" onClick={() => { setIgnoreOpen(false); setToast('Flag ignored. new_checkout_enabled left the deletable total.'); }} />
              </HStack>
            </VStack>
          </Dialog>
          <AlertDialog
            isOpen={deleteOpen}
            onOpenChange={setDeleteOpen}
            title="Delete this scan?"
            description="Scan 2026-11-18-a1b2 for acme/shop-web will be deleted, along with its 6 flags and 41 call sites. This cannot be undone."
            actionLabel="Delete scan"
            onAction={() => { setDeleteOpen(false); setToast('Scan 2026-11-18-a1b2 deleted.'); }}
          />
        </VStack>

        <VStack gap={3}>
          <Heading level={2}>Shell</Heading>
          <Text type="supporting">A contained example of the signed-in shell. The gallery page itself is not inside an AppShell.</Text>
          <Card>
            <AppShell
              height="auto"
              variant="surface"
              contentPadding={4}
              topNav={(
                <TopNav heading={<Text weight="semibold">Flag Debt Collector</Text>}>
                  <TopNavItem label="Dashboard" href="#" isSelected />
                  <TopNavItem label="Repos" href="#" />
                  <TopNavItem label="Settings" href="#" />
                </TopNav>
              )}
              sideNav={(
                <SideNav>
                  <SideNavSection title="Flags">
                    <SideNavItem label="Dashboard" href="#" isSelected icon="search" />
                    <SideNavItem label="Repos" href="#" icon="viewColumns" />
                  </SideNavSection>
                  <SideNavSection title="Account">
                    <SideNavItem label="Settings" href="#" icon="wrench" />
                  </SideNavSection>
                </SideNav>
              )}
            >
              <VStack gap={3}>
                <Breadcrumbs>
                  <BreadcrumbItem href="#">Repos</BreadcrumbItem>
                  <BreadcrumbItem href="#">acme/shop-web</BreadcrumbItem>
                  <BreadcrumbItem isCurrent>Scan 2026-11-18-a1b2</BreadcrumbItem>
                </Breadcrumbs>
                <Heading level={2}>Scan 2026-11-18-a1b2</Heading>
                <Text color="secondary">6 flags found in acme/shop-web. 2 deletable, 2,066 lines up for removal.</Text>
              </VStack>
            </AppShell>
          </Card>
        </VStack>
      </VStack>
    </Layout>
  );
}

function entryErrorMessage(error) {
  if (error.kind === 'fractional') return `Whole days only. "${error.text}" is not a whole number.`;
  if (error.kind === 'unreadable') return `"${error.text}" is not a number.`;
  return `"${error.text}" is out of range.`;
}
