import { initialize } from 'launchdarkly-js-client-sdk';

const client = initialize('client-side-id', { key: 'user-1' });

export async function old() {
  return client.variation('ignored_flag', false);
}
