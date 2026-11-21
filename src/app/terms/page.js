'use client';

import { Heading } from '@astryxdesign/core/Heading';
import { Text } from '@astryxdesign/core/Text';
import { Layout } from '@astryxdesign/core/Layout';
import { VStack } from '@astryxdesign/core/VStack';
import { MinimalTop, SiteFooter } from '@/src/components/Chrome';

export default function TermsPage() {
  return (
    <VStack gap={6}>
      <MinimalTop rightLabel="Sign in" rightHref="/login" />
      <Layout height="auto" contentWidth={960} padding={4}>
        <VStack gap={6}>
          <VStack gap={2}>
            <Heading level={1}>Terms</Heading>
            <Text type="supporting">Last updated 2026-11-21.</Text>
          </VStack>

          <VStack gap={3}>
            <Heading level={2}>Free to use</Heading>
            <Text>Flag Debt Collector is free to use. There are no paid tiers in v1.</Text>
          </VStack>

          <VStack gap={3}>
            <Heading level={2}>Scan caps</Heading>
            <Text>Scans cover public repos on github.com and gitlab.com, up to 100 MB and 10,000 files. Anonymous scans are limited to 3 per IP per UTC day; signed-in scans to 20 per day. The queue holds 10 scans; past that, new scans are refused until a slot opens.</Text>
          </VStack>

          <VStack gap={3}>
            <Heading level={2}>What the tool does</Heading>
            <Text>The tool reads a repo, lists flags with their evidence, and shows a deletion diff for each flag. It never deletes code itself, never writes to the repo, and never opens a pull request. Deleting code is always your decision, in your own repo.</Text>
          </VStack>

          <VStack gap={3}>
            <Heading level={2}>Accuracy</Heading>
            <Text>Flag status and deletable line counts come from static analysis plus provider APIs. They are evidence for a decision, not a guarantee. A flag marked Deletable still needs a human look before you delete it, and you should run your tests after any deletion.</Text>
          </VStack>

          <VStack gap={3}>
            <Heading level={2}>Acceptable use</Heading>
            <Text>Scan repos you have the right to read. Do not use the service to probe private repos, to evade quotas, or to abuse the scan queue.</Text>
          </VStack>
        </VStack>
      </Layout>
      <SiteFooter />
    </VStack>
  );
}
