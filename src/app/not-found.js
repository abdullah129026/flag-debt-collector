'use client';

import { Heading } from '@astryxdesign/core/Heading';
import { Text } from '@astryxdesign/core/Text';
import { Button } from '@astryxdesign/core/Button';
import { Layout } from '@astryxdesign/core/Layout';
import { VStack } from '@astryxdesign/core/VStack';
import { HStack } from '@astryxdesign/core/HStack';
import { MinimalTop, SiteFooter } from '@/src/components/Chrome';

export default function NotFound() {
  return (
    <VStack gap={6}>
      <MinimalTop rightLabel="Sign in" rightHref="/login" />
      <Layout height="auto" contentWidth={960} padding={4}>
        <VStack gap={3}>
          <Heading level={1}>This page does not exist.</Heading>
          <Text>Check the URL, or go back to the scan tool.</Text>
          <HStack gap={2} wrap="wrap">
            <Button label="Go to the scan tool" variant="primary" onClick={() => { window.location.href = '/'; }} />
            <Button label="See the docs" variant="secondary" onClick={() => { window.location.href = '/docs'; }} />
          </HStack>
        </VStack>
      </Layout>
      <SiteFooter />
    </VStack>
  );
}
