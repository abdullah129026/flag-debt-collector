'use client';

import { useState } from 'react';
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import { Button } from '@astryxdesign/core/Button';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import { HStack } from '@astryxdesign/core/HStack';
import { Selector } from '@astryxdesign/core/Selector';
import { TextArea } from '@astryxdesign/core/TextArea';
import { IGNORE_REASONS } from '@/lib/flag-actions';

// Ignore dialog (DESIGN-COPY 14.2). The reason is required; "other" also
// needs a note. The reason is stored with the flag.
export function IgnoreDialog({ flag, open, onOpenChange, onDone }) {
  const [reason, setReason] = useState('kill switch');
  const [note, setNote] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function confirm() {
    if (!reason) {
      setError('Pick a reason first.');
      return;
    }
    if (reason === 'other' && !note.trim()) {
      setError('Say why this flag stays.');
      return;
    }
    setError(null);
    setBusy(true);
    let res;
    try {
      res = await fetch(`/api/flags/${flag.id}/ignore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason, note }),
      });
    } catch {
      setBusy(false);
      setError('Could not reach the service. Check your connection and try again.');
      return;
    }
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError((data.error && data.error.message) || 'Could not ignore the flag. Try again.');
      return;
    }
    onOpenChange(false);
    onDone(`Flag ignored. ${flag.key} left the deletable total.`);
  }

  return (
    <Dialog isOpen={open} onOpenChange={onOpenChange} purpose="form">
      <DialogHeader
        title={`Ignore ${flag.key}`}
        subtitle="The flag leaves the deletable total. The reason is stored with the flag."
        onOpenChange={onOpenChange}
      />
      <VStack gap={3} padding={4}>
        <Selector label="Ignore reason" value={reason} onChange={setReason} options={IGNORE_REASONS} />
        <TextArea label="Note" value={note} onChange={setNote} rows={3} placeholder="Why this flag stays for now." />
        {error && <Text>{error}</Text>}
        <HStack gap={2} hAlign="end">
          <Button label="Cancel" variant="ghost" onClick={() => onOpenChange(false)} />
          <Button label="Ignore flag" variant="primary" onClick={confirm} isLoading={busy} isDisabled={busy} />
        </HStack>
      </VStack>
    </Dialog>
  );
}

// One-click confirmation Dialog for mark-removed, reopen, and the
// kill-switch cap override. These record an intent, not a deletion, so
// they use Dialog rather than AlertDialog (DESIGN-COPY 14.2).
export function ActionConfirmDialog({ open, onOpenChange, title, description, actionLabel, onConfirm }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function confirm() {
    setBusy(true);
    setError(null);
    const message = await onConfirm();
    setBusy(false);
    if (message) {
      setError(message);
      return;
    }
    onOpenChange(false);
  }

  return (
    <Dialog isOpen={open} onOpenChange={onOpenChange} purpose="form">
      <DialogHeader title={title} subtitle={description} onOpenChange={onOpenChange} />
      <VStack gap={3} padding={4}>
        {error && <Text>{error}</Text>}
        <HStack gap={2} hAlign="end">
          <Button label="Cancel" variant="ghost" onClick={() => onOpenChange(false)} />
          <Button label={actionLabel} variant="primary" onClick={confirm} isLoading={busy} isDisabled={busy} />
        </HStack>
      </VStack>
    </Dialog>
  );
}
