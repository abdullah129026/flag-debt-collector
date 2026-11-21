'use client';

import { Heading } from '@astryxdesign/core/Heading';
import { Text } from '@astryxdesign/core/Text';
import { Code } from '@astryxdesign/core/Code';
import { Layout } from '@astryxdesign/core/Layout';
import { VStack } from '@astryxdesign/core/VStack';
import { MinimalTop, SiteFooter } from '@/src/components/Chrome';

export default function DocsPage() {
  return (
    <VStack gap={6}>
      <MinimalTop rightLabel="Sign in" rightHref="/login" />
      <Layout height="auto" contentWidth={960} padding={4}>
        <VStack gap={6}>
          <VStack gap={2}>
            <Heading level={1}>How it works</Heading>
            <Text>Paste a public repo URL, the scan runs, and the report shows every flag with its evidence.</Text>
          </VStack>

          <VStack gap={3}>
            <Heading level={2}>Paste a public repo URL.</Heading>
            <Text>Public repos on github.com and gitlab.com only, in v1. Repos up to 100 MB and 10,000 files.</Text>
            <Text>Anonymous scans: 3 per IP per UTC day. Signed-in scans: 20 per day.</Text>
            <Text>The scan runs in the background. The progress page shows the step, the queue position, and the elapsed time, and the report URL works from the start.</Text>
          </VStack>

          <VStack gap={3}>
            <Heading level={2}>What the scan reads.</Heading>
            <Text>Flag definitions and references via read-only access. Detection is AST-first: SDK calls count only when the matching SDK import is present in the file. LaunchDarkly, Unleash, Flagsmith, and ConfigCat call shapes are recognised, plus env-var flags and config-file flags.</Text>
            <Text>Flag age comes from git history. Rollout comes from the provider API where a token is connected; env and config flags have no rollout.</Text>
          </VStack>

          <VStack gap={3}>
            <Heading level={2}>What the scan stores.</Heading>
            <Text>Flag name, age, rollout %, file paths, line numbers, LOC counts, and the deletion diff. Never source files, never secret values.</Text>
            <Text>The full clone is downloaded, scanned, then deleted. Anonymous scans purge after 30 days.</Text>
          </VStack>

          <VStack gap={3}>
            <Heading level={2}>What the numbers mean.</Heading>
            <Text>Three staleness signals: settled rollout (the provider reports 100% one variation right now, or marks the flag launched), old and untouched (created more than 90 days ago, no call-site change in the last 90 days), narrow or quiet (provider-marked stale, or references only in tests, or exactly one call site).</Text>
            <Text>Status: Active (0 signals), Watch (1), Stale (2), Deletable (3), Ignored (you decided it stays), Removed (confirmed gone by a rescan).</Text>
            <Text>Confidence: definite (3 signals, import-verified, literal keys), likely (2 signals, import-verified), possible (2 signals but one reference is dynamic or the key came from config), uncertain (the winning value is unknown or the evidence is too thin to call).</Text>
            <Text>Deletable LOC = lines in the losing branch + the guard lines + the flag definition line, from AST node spans. The headline total sums definite and likely flags with a known winning value only. Lines marked up to N are shown separately and never added to the total.</Text>
            <Text>Default sort: status rank (Deletable, Stale, Watch, Active, Ignored, Removed), then deletable LOC descending, then age descending.</Text>
            <Text>Supported code shapes: if/else (losing branch + guard lines), ternary (losing arm), flag and expression (guarded expression lines), early-return guard (guard lines, when the flag is the whole condition), combined condition (only the lines guarded solely by the flag; when the flag is one operand of a wider condition the LOC reads up to N).</Text>
          </VStack>

          <VStack gap={3}>
            <Heading level={2}>What it never does.</Heading>
            <Text>Never writes to the repo, never auto-deletes, never opens a PR, never stores secret values.</Text>
          </VStack>

          <VStack gap={3}>
            <Heading level={2}>Private repos.</Heading>
            <Text>Public-URL-only in v1. The upgrade path is a GitHub App with Contents Read and Metadata Read on selected repos only. Private repos are coming; the scan never asks for broad repo scope.</Text>
          </VStack>

          <VStack gap={3}>
            <Heading level={2}>.flagdebtignore.</Heading>
            <Text>One rule per line in a file named .flagdebtignore at the repo root. A line is a path glob, or flag: &lt;key&gt; to ignore one flag key. Lines starting with # are comments. Example:</Text>
            <Text><Code>flag: old_checkout</Code></Text>
            <Text><Code>src/legacy/**</Code></Text>
            <Text>Rules apply on the next rescan. The report lists every rule that applied.</Text>
          </VStack>
        </VStack>
      </Layout>
      <SiteFooter />
    </VStack>
  );
}
