'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Heading } from '@astryxdesign/core/Heading';
import { Text } from '@astryxdesign/core/Text';
import { Card } from '@astryxdesign/core/Card';
import { VStack } from '@astryxdesign/core/VStack';
import { HStack } from '@astryxdesign/core/HStack';
import { Button } from '@astryxdesign/core/Button';
import { Banner } from '@astryxdesign/core/Banner';
import { Skeleton } from '@astryxdesign/core/Skeleton';
import { FormLayout } from '@astryxdesign/core/FormLayout';
import { TextInput } from '@astryxdesign/core/TextInput';
import { TextArea } from '@astryxdesign/core/TextArea';
import { CheckboxInput } from '@astryxdesign/core/CheckboxInput';
import { NumberInput } from '@astryxdesign/core/NumberInput';
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import { AlertDialog } from '@astryxdesign/core/AlertDialog';
import { SignedInShell, ToastHost, PageError } from '@/src/components/Chrome';
import { browserClient } from '@/lib/supabase';

function entryErrorMessage(error) {
  if (error.kind === 'fractional') return `Whole days only. "${error.text}" is not a whole number.`;
  if (error.kind === 'unreadable') return `"${error.text}" is not a number.`;
  return `"${error.text}" is out of range.`;
}

// One provider card. LaunchDarkly is the only provider with token-based
// rollout fetching in v1; ConfigCat needs no token; Unleash and Flagsmith
// are detection only, with disabled fields.
function ProviderCard({ name, note, tokenDisabled, tokenDisabledMessage, token, onTokenChange, tokenStatus, onTest, onSave, onRevoke, savedLast4, testBusy, saveBusy }) {
  return (
    <Card>
      <VStack gap={3} padding={4}>
        <Heading level={3}>{name}</Heading>
        {note && <Text type="supporting">{note}</Text>}
        {savedLast4 && <Text type="supporting">Saved, ending in ....{savedLast4}</Text>}
        <TextInput
          label={`${name} token`}
          type="password"
          value={token}
          onChange={onTokenChange}
          placeholder={`Paste a ${name} token`}
          isDisabled={tokenDisabled}
          disabledMessage={tokenDisabledMessage}
          status={tokenStatus}
        />
        <HStack gap={2} wrap="wrap">
          {!tokenDisabled && (
            <>
              <Button label="Test connection" variant="secondary" onClick={onTest} isLoading={testBusy} isDisabled={testBusy || saveBusy} />
              <Button label="Save token" variant="secondary" onClick={onSave} isLoading={saveBusy} isDisabled={saveBusy || testBusy} />
            </>
          )}
          {savedLast4 && (
            <Button label="Revoke" variant="ghost" onClick={onRevoke} />
          )}
        </HStack>
      </VStack>
    </Card>
  );
}

export default function SettingsPage() {
  const router = useRouter();
  const [settings, setSettings] = useState(null);
  const [tokens, setTokens] = useState([]);
  const [email, setEmail] = useState('');
  const [repoCount, setRepoCount] = useState(0);
  const [fatal, setFatal] = useState(null);
  const [toast, setToast] = useState(null);
  const [tokenBanner, setTokenBanner] = useState(false);
  const [ldToken, setLdToken] = useState('');
  const [ldTokenError, setLdTokenError] = useState(null);
  const [testBusy, setTestBusy] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [revokeOpen, setRevokeOpen] = useState(false);
  const [staleness, setStaleness] = useState(90);
  const [entryError, setEntryError] = useState(null);
  const [includeTests, setIncludeTests] = useState(true);
  const [ignoreRules, setIgnoreRules] = useState('');
  const [ldProjectKey, setLdProjectKey] = useState('');
  const [ldEnvKey, setLdEnvKey] = useState('production');
  const [saveError, setSaveError] = useState(null);
  const [saveSettingsBusy, setSaveSettingsBusy] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteStep, setDeleteStep] = useState(1);
  const [deleteTyped, setDeleteTyped] = useState('');
  const [deleteGuard, setDeleteGuard] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState(null);

  const load = useCallback(async () => {
    let res;
    try {
      res = await fetch('/api/settings');
    } catch {
      setFatal('The database did not answer. Try again in a few minutes.');
      return;
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setFatal((data.error && data.error.message) || 'Settings could not load. Try again in a few minutes.');
      return;
    }
    setSettings(data);
    setStaleness(data.staleness_days ?? 90);
    setIncludeTests(data.include_test_sites ?? true);
    setIgnoreRules(data.ignore_rules || '');
    setLdProjectKey(data.ld_project_key || '');
    setLdEnvKey(data.ld_env_key || 'production');
    const tokRes = await fetch('/api/settings/tokens');
    if (tokRes.ok) {
      const tokData = await tokRes.json().catch(() => ({}));
      setTokens(tokData.tokens || []);
    }
    const sb = browserClient();
    if (sb) {
      const { data: userData } = await sb.auth.getUser();
      if (userData && userData.user) setEmail(userData.user.email || '');
    }
    const reposRes = await fetch('/api/repos');
    if (reposRes.ok) {
      const reposData = await reposRes.json().catch(() => ({}));
      setRepoCount((reposData.repos || []).length);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const ldSaved = tokens.find((t) => t.provider === 'launchdarkly');

  async function testToken() {
    if (!ldToken.trim()) {
      setLdTokenError('Paste a token first.');
      return;
    }
    setLdTokenError(null);
    setTestBusy(true);
    let res;
    try {
      res = await fetch('/api/settings/tokens/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'launchdarkly', token: ldToken }),
      });
    } catch {
      setTestBusy(false);
      setLdTokenError('Provider is down. Check your connection and try again.');
      return;
    }
    const data = await res.json().catch(() => ({}));
    setTestBusy(false);
    if (!res.ok) {
      const message = (data.error && data.error.message) || 'Could not test the token. Try again.';
      setLdTokenError(message);
      if (message.startsWith('Wrong token') || message.startsWith('No access')) setTokenBanner(true);
      return;
    }
    setToast('LaunchDarkly connected.');
  }

  async function saveToken() {
    if (!ldToken.trim() || ldToken.trim().length < 8) {
      setLdTokenError('Paste a token first.');
      return;
    }
    setLdTokenError(null);
    setSaveBusy(true);
    let res;
    try {
      res = await fetch('/api/settings/tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'launchdarkly', token: ldToken }),
      });
    } catch {
      setSaveBusy(false);
      setLdTokenError('Could not reach the service. Check your connection and try again.');
      return;
    }
    const data = await res.json().catch(() => ({}));
    setSaveBusy(false);
    if (!res.ok) {
      setLdTokenError((data.error && data.error.message) || 'Could not save the token. Try again.');
      return;
    }
    setTokens((prev) => [...prev.filter((t) => t.provider !== 'launchdarkly'), { provider: 'launchdarkly', last4: data.last4 }]);
    setLdToken('');
    setToast('LaunchDarkly token saved.');
  }

  async function revokeToken() {
    const res = await fetch('/api/settings/tokens?provider=launchdarkly', { method: 'DELETE' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setToast((data.error && data.error.message) || 'Could not revoke the token. Try again.');
      return;
    }
    setTokens((prev) => prev.filter((t) => t.provider !== 'launchdarkly'));
    setRevokeOpen(false);
    setToast('LaunchDarkly token revoked.');
  }

  async function saveSettings() {
    if (entryError) {
      setSaveError('Fix the staleness threshold first.');
      return;
    }
    setSaveError(null);
    setSaveSettingsBusy(true);
    let res;
    try {
      res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          staleness_days: staleness,
          include_test_sites: includeTests,
          ignore_rules: ignoreRules,
          ld_project_key: ldProjectKey,
          ld_env_key: ldEnvKey,
        }),
      });
    } catch {
      setSaveSettingsBusy(false);
      setSaveError('Could not save. Check your connection and try again.');
      return;
    }
    const data = await res.json().catch(() => ({}));
    setSaveSettingsBusy(false);
    if (!res.ok) {
      setSaveError((data.error && data.error.message) || 'Could not save. Check your connection and try again.');
      return;
    }
    setToast('Settings saved.');
  }

  async function signOut() {
    const sb = browserClient();
    if (sb) await sb.auth.signOut();
    router.push('/');
  }

  async function deleteAccount() {
    setDeleteBusy(true);
    setDeleteError(null);
    let res;
    try {
      res = await fetch('/api/account', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: 'DELETE' }),
      });
    } catch {
      setDeleteBusy(false);
      setDeleteError('Could not reach the service. Check your connection and try again.');
      return;
    }
    const data = await res.json().catch(() => ({}));
    setDeleteBusy(false);
    if (!res.ok) {
      setDeleteError((data.error && data.error.message) || 'Could not delete the account. Try again.');
      return;
    }
    const sb = browserClient();
    if (sb) await sb.auth.signOut();
    try {
      sessionStorage.setItem('fdc_toast', 'Your account was deleted.');
    } catch { /* the landing page just shows no toast */ }
    router.push('/');
  }

  // The typed-DELETE dirty-form guard: Esc while text is typed keeps the
  // dialog open and shows the guard message; Esc with an empty field closes.
  function handleDeleteOpenChange(open) {
    if (!open && deleteStep === 2 && deleteTyped) {
      setDeleteGuard(true);
      return;
    }
    setDeleteOpen(open);
    if (!open) {
      setDeleteStep(1);
      setDeleteTyped('');
      setDeleteGuard(false);
      setDeleteError(null);
    }
  }

  return (
    <SignedInShell crumbs={[{ label: 'Settings' }]} active="settings">
      {fatal && <PageError message={fatal} onRetry={() => { setFatal(null); load(); }} />}
      {!fatal && settings === null && (
        <Card>
          <VStack gap={2} padding={4}>
            <Skeleton width="60%" height={24} index={0} />
            <Skeleton width="100%" height={16} index={1} />
            <Skeleton width="80%" height={16} index={2} />
          </VStack>
        </Card>
      )}
      {!fatal && settings !== null && (
        <VStack gap={6}>
          <Heading level={1}>Settings</Heading>
          {tokenBanner && (
            <Banner
              status="error"
              title="LaunchDarkly token invalid"
              description="Rollout reads unknown (token invalid). Paste a new token in Settings, then test the connection."
              isDismissable
            />
          )}

          <VStack gap={3}>
            <Heading level={2}>Provider tokens</Heading>
            <ProviderCard
              name="LaunchDarkly"
              token={ldToken}
              onTokenChange={setLdToken}
              tokenStatus={ldTokenError ? { type: 'error', message: ldTokenError } : undefined}
              onTest={testToken}
              onSave={saveToken}
              onRevoke={() => setRevokeOpen(true)}
              savedLast4={ldSaved ? ldSaved.last4 : null}
              testBusy={testBusy}
              saveBusy={saveBusy}
            />
            <TextInput
              label="LaunchDarkly project key"
              value={ldProjectKey}
              onChange={setLdProjectKey}
              placeholder="Project key for the token test"
              description="Needed to test the token. Saved with your scan defaults below."
            />
            <TextInput
              label="LaunchDarkly environment key"
              value={ldEnvKey}
              onChange={setLdEnvKey}
              placeholder="production"
            />
            <ProviderCard
              name="ConfigCat"
              note="No token needed. When a ConfigCat config is found in the repo, rollout is fetched from the public config.json."
              tokenDisabled
              tokenDisabledMessage="ConfigCat needs no token."
              token=""
              onTokenChange={() => {}}
            />
            <ProviderCard
              name="Unleash"
              note="Detection only in v1. Rollout fetching is a design hook."
              tokenDisabled
              tokenDisabledMessage="Rollout fetching is not in v1."
              token=""
              onTokenChange={() => {}}
            />
            <ProviderCard
              name="Flagsmith"
              note="Detection only in v1. Rollout fetching is a design hook."
              tokenDisabled
              tokenDisabledMessage="Rollout fetching is not in v1."
              token=""
              onTokenChange={() => {}}
            />
          </VStack>

          <VStack gap={3}>
            <Heading level={2}>Scan defaults</Heading>
            <FormLayout>
              <NumberInput
                label="Staleness threshold (days)"
                value={staleness}
                onChange={setStaleness}
                isIntegerOnly
                min={1}
                max={365}
                description="Flags untouched longer than this count as stale."
                onEntryErrorChange={setEntryError}
                status={entryError ? { type: 'error', message: entryErrorMessage(entryError) } : undefined}
              />
              <CheckboxInput
                label="Include test call sites"
                description="Count references from test files as reachable."
                value={includeTests}
                onChange={setIncludeTests}
              />
              <TextArea
                label="Ignore rules"
                value={ignoreRules}
                onChange={setIgnoreRules}
                rows={4}
                placeholder={'flag: old_checkout\nsrc/legacy/**'}
                description="One rule per line. A path glob, or flag: <key> to ignore one flag key. Applies on the next rescan."
              />
            </FormLayout>
            {ignoreRules.trim() && (
              <Text type="supporting">Rules in force: {ignoreRules.split('\n').filter((r) => r.trim() && !r.trim().startsWith('#')).length} rules. Changes apply on the next rescan.</Text>
            )}
            {saveError && <Text>{saveError}</Text>}
            <Button label="Save settings" variant="primary" onClick={saveSettings} isLoading={saveSettingsBusy} isDisabled={saveSettingsBusy} />
          </VStack>

          <VStack gap={3}>
            <Heading level={2}>Account</Heading>
            <Card>
              <VStack gap={3} padding={4}>
                {email && <Text>{email}</Text>}
                <Button label="Sign out" variant="secondary" onClick={signOut} />
                <Heading level={3}>Delete account</Heading>
                <Text type="supporting">Deletes your account, repos, scans, flags, and provider tokens. This cannot be undone.</Text>
                <Button
                  label="Delete account"
                  variant="destructive"
                  onClick={() => {
                    setDeleteStep(1);
                    setDeleteOpen(true);
                  }}
                />
              </VStack>
            </Card>
          </VStack>
        </VStack>
      )}

      <AlertDialog
        isOpen={revokeOpen}
        onOpenChange={setRevokeOpen}
        title="Revoke the LaunchDarkly token?"
        description="Rollout will read unknown (no token) until a new token is saved. Saved scans keep their rollout values."
        actionLabel="Revoke token"
        cancelLabel="Keep token"
        onAction={revokeToken}
      />

      <Dialog isOpen={deleteOpen} onOpenChange={handleDeleteOpenChange} purpose="form">
        {deleteStep === 1 ? (
          <>
            <DialogHeader
              title="Delete your account?"
              subtitle={`Deletes your account, ${repoCount} repos, their scans, and your provider tokens. This cannot be undone.`}
              onOpenChange={handleDeleteOpenChange}
            />
            <VStack gap={3} padding={4}>
              <HStack gap={2} hAlign="end">
                <Button label="Cancel" variant="ghost" onClick={() => handleDeleteOpenChange(false)} />
                <Button label="Continue" variant="destructive" onClick={() => setDeleteStep(2)} />
              </HStack>
            </VStack>
          </>
        ) : (
          <>
            <DialogHeader
              title="Delete your account?"
              subtitle="Type DELETE to confirm."
              onOpenChange={handleDeleteOpenChange}
            />
            <VStack gap={3} padding={4}>
              <TextInput
                label="Type DELETE"
                value={deleteTyped}
                onChange={(v) => {
                  setDeleteTyped(v);
                  if (v === '') setDeleteGuard(false);
                }}
                placeholder="DELETE"
              />
              {deleteGuard && <Text>Your typed confirmation will be lost. Choose Keep my account to cancel.</Text>}
              {deleteError && <Text>{deleteError}</Text>}
              <HStack gap={2} hAlign="end">
                <Button label="Keep my account" variant="ghost" onClick={() => handleDeleteOpenChange(false)} />
                <Button
                  label="Delete my account"
                  variant="destructive"
                  isDisabled={deleteTyped !== 'DELETE' || deleteBusy}
                  isLoading={deleteBusy}
                  onClick={deleteAccount}
                />
              </HStack>
            </VStack>
          </>
        )}
      </Dialog>
      <ToastHost toast={toast} onDismiss={() => setToast(null)} />
    </SignedInShell>
  );
}
