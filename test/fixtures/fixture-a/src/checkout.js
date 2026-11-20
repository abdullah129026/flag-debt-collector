import { initialize } from 'launchdarkly-js-client-sdk';
import { useFlags } from 'launchdarkly-react-client-sdk';

const client = initialize('client-side-id', { key: 'user-1' });

export async function showCheckout() {
  const enabled = await client.variation('new_checkout_enabled', false);
  if (enabled) {
    renderNewCheckout();
  } else {
    renderOldCheckout();
  }
  const staticFlag = await client.variation(`static_flag`, false);
  const suffix = 'x';
  const dynamicKey = 'new_' + suffix;
  const dynamic = await client.variation(dynamicKey, false);
  const ignored = await client.variation('ignored_flag', false);
  return enabled && staticFlag && dynamic && ignored;
}

export function CheckoutPage() {
  const flags = useFlags();
  const label = flags.beta_search ? 'new search' : 'old search';
  if (flags.new_checkout_enabled) {
    return <NewCheckout />;
  }
  return flags.promo_banner && <Promo />;
}

export function CheckoutPageDestructured() {
  const { old_banner } = useFlags();
  if (old_banner) {
    return <Banner />;
  }
  return null;
}

export function guarded() {
  const flags = useFlags();
  if (!flags.maintenance_mode) return;
  return renderMaintenance();
}

export function combined() {
  const flags = useFlags();
  if (flags.beta_search && isAdmin) {
    return <AdminSearch />;
  }
  return <Search />;
}

export function envFlags() {
  if (process.env.ENABLE_LEGACY_BILLING) {
    return renderLegacyBilling();
  }
  return renderBilling();
}
