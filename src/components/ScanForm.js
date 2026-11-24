'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FormLayout } from '@astryxdesign/core/FormLayout';
import { TextInput } from '@astryxdesign/core/TextInput';
import { Text } from '@astryxdesign/core/Text';
import { Button } from '@astryxdesign/core/Button';
import { VStack } from '@astryxdesign/core/VStack';
import { parseRepoUrl } from '@/lib/scan/url';
import { capture } from '@/src/lib/analytics';

// The paste box from the landing page, reused on the scan page for retries.
// Validation runs on submit, so no error shows before the visitor acts.
// The field keeps the typed text on every error.
export function ScanForm({ buttonLabel }) {
  const router = useRouter();
  const [url, setUrl] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const fieldRef = useRef(null);

  async function submit(event) {
    event.preventDefault();
    const parsed = parseRepoUrl(url);
    if (!parsed.ok) {
      setError(parsed.message);
      if (fieldRef.current) fieldRef.current.focus();
      return;
    }
    setError(null);
    setBusy(true);
    let res;
    try {
      res = await fetch('/api/scans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repo_url: parsed.url }),
      });
    } catch {
      setBusy(false);
      setError('Could not reach the service. Check your connection and try again.');
      return;
    }
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      // The API already sends the fixed failure copy; show it as-is.
      setError((data.error && data.error.message) || 'Could not start the scan. Try again.');
      return;
    }
    capture('scan_started', {});
    router.push(data.report_url);
  }

  return (
    <form onSubmit={submit}>
      <VStack gap={3}>
        <FormLayout>
          <TextInput
            ref={fieldRef}
            label="Repo URL"
            value={url}
            onChange={setUrl}
            placeholder="https://github.com/acme/shop-web"
            description="Public repos only in v1."
            status={error ? { type: 'error', message: error } : undefined}
          />
        </FormLayout>
        <Text type="supporting">Reads flag definitions and references via read-only access.</Text>
        <Text type="supporting">
          Stores flag name, age, rollout %, file paths, line numbers, LOC counts, and the deletion
          diff for your flags. Never stores source files, never writes to the repo.
        </Text>
        <Text type="supporting">
          Repos up to 100 MB and 10,000 files. The full repo tarball is downloaded, scanned, then deleted.
        </Text>
        <Button label={buttonLabel || 'Scan this repo'} variant="primary" type="submit" isLoading={busy} isDisabled={busy} />
      </VStack>
    </form>
  );
}
