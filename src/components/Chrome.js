'use client';

import Link from 'next/link';
import { AppShell } from '@astryxdesign/core/AppShell';
import { TopNav, TopNavItem } from '@astryxdesign/core/TopNav';
import { SideNav, SideNavSection, SideNavItem } from '@astryxdesign/core/SideNav';
import { Breadcrumbs, BreadcrumbItem } from '@astryxdesign/core/Breadcrumbs';
import { Layout } from '@astryxdesign/core/Layout';
import { VStack } from '@astryxdesign/core/VStack';
import { HStack } from '@astryxdesign/core/HStack';
import { Heading } from '@astryxdesign/core/Heading';
import { Button } from '@astryxdesign/core/Button';
import { Text } from '@astryxdesign/core/Text';
import { Link as AstryxLink } from '@astryxdesign/core/Link';
import { Toast } from '@astryxdesign/core/Toast';

const REPO_URL = 'https://github.com/abdullah129026/flag-debt-collector';

// Signed-in shell: AppShell with TopNav and SideNav, the contained example
// from the phase-2 gallery built out. crumbs is [{label, href?}]; the last
// crumb is the current page.
export function SignedInShell({ children, crumbs, active }) {
  return (
    <AppShell
      height="auto"
      variant="surface"
      contentPadding={4}
      topNav={(
        <TopNav heading={<Text weight="semibold">Flag Debt Collector</Text>}>
          <TopNavItem label="Dashboard" href="/dashboard" isSelected={active === 'dashboard'} />
          <TopNavItem label="Repos" href="/repos" isSelected={active === 'repos'} />
          <TopNavItem label="Settings" href="/settings" isSelected={active === 'settings'} />
        </TopNav>
      )}
      sideNav={(
        <SideNav>
          <SideNavSection title="Flags">
            <SideNavItem label="Dashboard" href="/dashboard" isSelected={active === 'dashboard'} icon="search" />
            <SideNavItem label="Repos" href="/repos" isSelected={active === 'repos'} icon="viewColumns" />
          </SideNavSection>
          <SideNavSection title="Account">
            <SideNavItem label="Settings" href="/settings" isSelected={active === 'settings'} icon="wrench" />
          </SideNavSection>
        </SideNav>
      )}
    >
      <Layout height="auto" contentWidth={960} padding={4}>
        <VStack gap={6}>
          {crumbs && crumbs.length > 0 && (
            <Breadcrumbs>
              {crumbs.map((c) => (
                <BreadcrumbItem key={c.label} href={c.href} isCurrent={!c.href}>
                  {c.label}
                </BreadcrumbItem>
              ))}
            </Breadcrumbs>
          )}
          {children}
        </VStack>
      </Layout>
    </AppShell>
  );
}

// Slim bar for public pages: wordmark left, one link right.
export function MinimalTop({ rightLabel, rightHref }) {
  return (
    <Layout height="auto" contentWidth={960} padding={4}>
      <HStack gap={2} vAlign="center" hAlign="space-between">
        <Link href="/" style={{ textDecoration: 'none' }}>
          <Text weight="semibold">Flag Debt Collector</Text>
        </Link>
        <AstryxLink href={rightHref} isStandalone>
          {rightLabel}
        </AstryxLink>
      </HStack>
    </Layout>
  );
}

export function SiteFooter() {
  return (
    <Layout height="auto" contentWidth={960} padding={4}>
      <HStack gap={4} wrap="wrap">
        <AstryxLink href="/docs" isStandalone>Docs</AstryxLink>
        <AstryxLink href="/privacy" isStandalone>Privacy</AstryxLink>
        <AstryxLink href="/terms" isStandalone>Terms</AstryxLink>
        <AstryxLink href={REPO_URL} isExternalLink isStandalone>GitHub</AstryxLink>
      </HStack>
    </Layout>
  );
}

// Page-level error screen (DESIGN-COPY 15.2). Used by any page that cannot
// load its data. The button reloads the page; no stack trace is shown.
export function PageError({ message, onRetry }) {
  return (
    <VStack gap={3}>
      <Heading level={1}>Something went wrong.</Heading>
      <Text>{message}</Text>
      <HStack gap={2} wrap="wrap">
        <Button label="Try again" variant="primary" onClick={onRetry} />
        <Button label="Go to the scan tool" variant="secondary" onClick={() => { window.location.href = '/'; }} />
      </HStack>
    </VStack>
  );
}

// One Toast, bottom of the viewport. A new Toast replaces the old one;
// toasts never stack.
export function ToastHost({ toast, onDismiss }) {
  if (!toast) return null;
  return <Toast body={toast} onDismiss={onDismiss} onHide={onDismiss} />;
}
