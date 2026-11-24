'use client';

import { Heading } from '@astryxdesign/core/Heading';
import { Text } from '@astryxdesign/core/Text';
import { Layout } from '@astryxdesign/core/Layout';
import { VStack } from '@astryxdesign/core/VStack';
import { MinimalTop, SiteFooter } from '@/src/components/Chrome';

export default function PrivacyPage() {
  return (
    <VStack gap={6}>
      <MinimalTop rightLabel="Sign in" rightHref="/login" />
      <Layout height="auto" contentWidth={960} padding={4}>
        <VStack gap={6}>
          <VStack gap={2}>
            <Heading level={1}>Privacy</Heading>
            <Text type="supporting">Last updated 2026-11-21.</Text>
          </VStack>

          <VStack gap={3}>
            <Heading level={2}>What is stored</Heading>
            <Text>Flag names, file paths, line numbers, LOC counts, and deletion diffs. For signed-in accounts: your email, your saved repos, your scan settings, and your provider tokens (encrypted; only the last 4 characters are ever shown).</Text>
            <Text>Analytics events carry aggregates only (flag counts, deletable lines). They never carry repo names, repo URLs, file contents, or keystrokes. There are no tracking cookies and session replay is off.</Text>
          </VStack>

          <VStack gap={3}>
            <Heading level={2}>What is never stored</Heading>
            <Text>Source files are never stored: the full repo tarball is downloaded, scanned, then deleted. Secret values found in scanned code are never stored or logged; if a scan finds something that looks like a secret, rotate it.</Text>
          </VStack>

          <VStack gap={3}>
            <Heading level={2}>Anonymous scans</Heading>
            <Text>Anonymous scans purge after 30 days. A claim cookie in your browser ties a scan to you for delete and attach; on another device the report link still opens, only the claim does not transfer.</Text>
          </VStack>

          <VStack gap={3}>
            <Heading level={2}>Deletion</Heading>
            <Text>You can delete a scan, a repo, or your whole account from the product. Deleting a scan removes it and its flags at once. Deleting a repo removes its scans, flags, and provider settings. Deleting your account removes your account, repos, scans, flags, and provider tokens at once, and signs you out.</Text>
          </VStack>
        </VStack>
      </Layout>
      <SiteFooter />
    </VStack>
  );
}
