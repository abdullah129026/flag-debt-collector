'use client';

import { useEffect, useState } from 'react';
import { Heading } from '@astryxdesign/core/Heading';
import { Text } from '@astryxdesign/core/Text';
import { Card } from '@astryxdesign/core/Card';
import { Layout } from '@astryxdesign/core/Layout';
import { VStack } from '@astryxdesign/core/VStack';
import { Button } from '@astryxdesign/core/Button';
import { Banner } from '@astryxdesign/core/Banner';
import { FormLayout } from '@astryxdesign/core/FormLayout';
import { TextInput } from '@astryxdesign/core/TextInput';
import { MinimalTop, SiteFooter } from '@/src/components/Chrome';
import { browserClient } from '@/lib/supabase';

function isEmail(value) {
  return /^\S+@\S+\.\S+$/.test(value);
}

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const [sendFailed, setSendFailed] = useState(false);
  const [expired, setExpired] = useState(false);
  const [next, setNext] = useState('/dashboard');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('error') === 'expired') setExpired(true);
    const dest = params.get('next');
    if (dest && dest.startsWith('/')) setNext(dest);
    try {
      const last = localStorage.getItem('fdc_last_email');
      if (last) setEmail(last);
    } catch { /* prefill is best-effort */ }
  }, []);

  async function send() {
    if (!isEmail(email.trim())) {
      setError('That does not look like an email address.');
      return;
    }
    setError(null);
    setSendFailed(false);
    setSending(true);
    const sb = browserClient();
    if (!sb) {
      setSending(false);
      setSendFailed(true);
      setError('Sign-in is not set up yet. The magic-link service is not configured.');
      return;
    }
    const { error: otpError } = await sb.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}` },
    });
    setSending(false);
    if (otpError) {
      setSendFailed(true);
      return;
    }
    try {
      localStorage.setItem('fdc_last_email', email.trim());
    } catch { /* prefill is best-effort */ }
    setSent(true);
  }

  return (
    <VStack gap={6}>
      <MinimalTop rightLabel="Back to the scan tool" rightHref="/" />
      <Layout height="auto" contentWidth={480} padding={4}>
        <Card>
          <VStack gap={3} padding={4}>
            <Heading level={1}>Sign in</Heading>
            <Text type="supporting">We email you a sign-in link. No password.</Text>
            {expired && <Text>That link expired. Request a fresh one.</Text>}
            {sendFailed && (
              <Banner
                status="error"
                title="Could not send the link"
                description={error || 'Check your connection and try again.'}
              />
            )}
            {sent ? (
              <VStack gap={3}>
                <Text>Check your email. We sent a sign-in link to {email}.</Text>
                <Button label="Send a new link" variant="secondary" onClick={() => { setSent(false); }} />
                <Text type="supporting">Links expire after 1 hour. Request a fresh one if it expired.</Text>
              </VStack>
            ) : (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  send();
                }}
              >
                <VStack gap={3}>
                  <FormLayout>
                    <TextInput
                      label="Email"
                      type="email"
                      value={email}
                      onChange={setEmail}
                      placeholder="you@example.com"
                      isDisabled={sending}
                      status={error && !sendFailed ? { type: 'error', message: error } : undefined}
                    />
                  </FormLayout>
                  <Button label="Email me a sign-in link" variant="primary" type="submit" isLoading={sending} isDisabled={sending} />
                </VStack>
              </form>
            )}
          </VStack>
        </Card>
        <Text type="supporting">
          Signing in attaches your anonymous scans to your account. A scan opened on another device
          still opens; only the claim does not transfer.
        </Text>
      </Layout>
      <SiteFooter />
    </VStack>
  );
}
