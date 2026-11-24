'use client';

import { useEffect, useState } from 'react';
import { Heading } from '@astryxdesign/core/Heading';
import { Text } from '@astryxdesign/core/Text';
import { Link } from '@astryxdesign/core/Link';
import { Card } from '@astryxdesign/core/Card';
import { Layout } from '@astryxdesign/core/Layout';
import { VStack } from '@astryxdesign/core/VStack';
import { Button } from '@astryxdesign/core/Button';
import { MinimalTop, SiteFooter, ToastHost } from '@/src/components/Chrome';
import { ScanForm } from '@/src/components/ScanForm';
import { capture } from '@/src/lib/analytics';

export default function Home() {
  const [toast, setToast] = useState(null);
  const [demo, setDemo] = useState(null);
  useEffect(() => {
    capture('landing_pageview', { referrer: document.referrer || 'direct' });
    // A toast left by a page that navigated here (account deletion).
    try {
      const saved = sessionStorage.getItem('fdc_toast');
      if (saved) {
        sessionStorage.removeItem('fdc_toast');
        setToast(saved);
      }
    } catch { /* no toast without storage */ }
    // The demo scan, when one has finished. Until then the placeholder stays.
    let alive = true;
    fetch('/api/demo')
      .then((r) => r.json())
      .then((d) => { if (alive) setDemo(d); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  return (
    <VStack gap={6}>
      <MinimalTop rightLabel="Sign in" rightHref="/login" />
      <Layout height="auto" contentWidth={960} padding={4}>
        <VStack gap={6}>
          <VStack gap={2}>
            <Heading level={1}>Find the flags your codebase forgot, and count what deleting them saves.</Heading>
            <Text>
              Paste a public repo URL. The scan reads flag definitions and references, then shows every
              flag with its age, rollout, call sites, deletable lines, and the diff. It never touches your code.
            </Text>
          </VStack>

          <div id="scan">
            <ScanForm buttonLabel="Scan this repo" />
          </div>

          <VStack gap={3}>
            <Heading level={2}>A real scan, before you paste anything.</Heading>
            <Card>
              <VStack gap={2} padding={4}>
                {demo && demo.scan_id ? (
                  <>
                    <Text weight="semibold">The demo scan found {demo.flags} flags, {demo.deletable} of them deletable.</Text>
                    <Text type="supporting">
                      {demo.deletable_loc} lines can go for certain
                      {demo.up_to_loc > 0 ? `, and up to ${demo.up_to_loc} more once the winning values are known.` : '.'}
                    </Text>
                    <Link href={`/scans/${demo.scan_id}`} isStandalone>See the full report</Link>
                  </>
                ) : (
                  <>
                    <Text weight="semibold">The demo scan has not run yet.</Text>
                    <Text type="supporting">
                      When it runs, this page shows its real flag count and deletable lines, with a link to
                      the full report. No number is shown here until the scan produces one.
                    </Text>
                    <Text type="supporting">
                      A report lists every flag with its age, rollout, call sites, deletable lines, and the
                      deletion diff, so the value is visible before any input.
                    </Text>
                    <Link href="/docs" isStandalone>How the numbers are computed</Link>
                  </>
                )}
              </VStack>
            </Card>
          </VStack>

          <VStack gap={3}>
            <Heading level={2}>How it works</Heading>
            <Text>1. Paste a public repo URL.</Text>
            <Text>2. The scan runs: download, parse, age, provider.</Text>
            <Text>3. The report shows every flag with age, rollout, call sites, deletable lines, and the diff.</Text>
          </VStack>

          <VStack gap={3}>
            <Heading level={2}>What it never does</Heading>
            <Text>Never stores source files.</Text>
            <Text>Never writes to the repo.</Text>
            <Text>Never auto-deletes code.</Text>
            <Text>Anonymous scans purge after 30 days.</Text>
          </VStack>

          <VStack gap={3}>
            <Heading level={2}>The number, honestly</Heading>
            {demo && demo.scan_id ? (
              <>
                <Text>
                  The demo scan found {demo.flags} flags in the demo repo, {demo.deletable} deletable, {demo.deletable_loc} lines gone for certain.
                </Text>
                <Link href={`/scans/${demo.scan_id}`} isStandalone>See the full report</Link>
              </>
            ) : (
              <Text>
                The demo scan has not run yet, so there is no number to show. When it runs, this page
                shows its real flag count and deletable lines, with a link to the full report.
              </Text>
            )}
          </VStack>

          <VStack gap={3}>
            <Text>Free to use. No signup for the first scan.</Text>
            <Button label="Scan a repo" variant="primary" onClick={() => document.getElementById('scan').scrollIntoView()} />
          </VStack>
        </VStack>
      </Layout>
      <SiteFooter />
      <ToastHost toast={toast} onDismiss={() => setToast(null)} />
    </VStack>
  );
}
