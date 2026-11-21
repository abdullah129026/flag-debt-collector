'use client';

import { Heading } from '@astryxdesign/core/Heading';
import { Text } from '@astryxdesign/core/Text';
import { Button } from '@astryxdesign/core/Button';
import { Layout } from '@astryxdesign/core/Layout';
import { VStack } from '@astryxdesign/core/VStack';
import { HStack } from '@astryxdesign/core/HStack';
import { MinimalTop, SiteFooter } from '@/src/components/Chrome';

// Route-level error screen (DESIGN-COPY 15.2). Next passes the thrown
// error and a reset function; the digest is shown so a log line can be
// found from the page. No stack trace is shown.
export default function Error({ error, reset }) {
  return (
    <VStack gap={6}>
      <MinimalTop rightLabel="Sign in" rightHref="/login" />
      <Layout height="auto" contentWidth={960} padding={4}>
        <VStack gap={3}>
          <Heading level={1}>Something went wrong.</Heading>
          <Text>The page could not load. Try again in a few minutes.</Text>
          {error && error.digest && <Text type="supporting">Reference: {error.digest}</Text>}
          <HStack gap={2} wrap="wrap">
            <Button label="Try again" variant="primary" onClick={() => reset()} />
            <Button label="Go to the scan tool" variant="secondary" onClick={() => { window.location.href = '/'; }} />
          </HStack>
        </VStack>
      </Layout>
      <SiteFooter />
    </VStack>
  );
}
