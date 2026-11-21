// Minimal PostHog capture over fetch. No SDK, no cookies: the distinct id
// lives in localStorage, and events carry aggregates only, never repo URLs,
// file paths, or keystrokes. When no key is configured, capture is a no-op.
export function capturePayload({ key, host, event, distinctId, props }) {
  return {
    url: `${host.replace(/\/$/, '')}/capture/`,
    body: { api_key: key, event, distinct_id: distinctId, properties: props || {} },
  };
}

function distinctId() {
  try {
    let id = localStorage.getItem('fdc_anon_id');
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem('fdc_anon_id', id);
    }
    return id;
  } catch {
    return 'anonymous';
  }
}

export function capture(event, props) {
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!key || typeof fetch === 'undefined') return Promise.resolve(false);
  const host = process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com';
  const { url, body } = capturePayload({ key, host, event, distinctId: distinctId(), props });
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, timestamp: new Date().toISOString() }),
    keepalive: true,
  })
    .then(() => true)
    .catch(() => false);
}
