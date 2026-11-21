'use client';

import { Badge } from '@astryxdesign/core/Badge';
import { Icon } from '@astryxdesign/core/Icon';

// Status is never color alone: every Badge carries shape and text. Watch
// and Ignored are text-only: the 0.7.16 icon registry has no eye and no
// pause glyph (phase-2 finding, accepted at the gate).
const STATUS_BADGE = {
  Deletable: { variant: 'error', icon: 'close' },
  Stale: { variant: 'warning', icon: 'clock' },
  Watch: { variant: 'info', icon: null },
  Active: { variant: 'success', icon: 'check' },
  Ignored: { variant: 'neutral', icon: null },
  Removed: { variant: 'neutral', icon: 'check' },
};

export function StatusBadge({ status }) {
  const spec = STATUS_BADGE[status] || { variant: 'neutral', icon: null };
  return (
    <Badge
      variant={spec.variant}
      label={status}
      icon={spec.icon ? <Icon icon={spec.icon} size="sm" /> : undefined}
    />
  );
}

export function ConfidenceBadge({ confidence }) {
  return <Badge variant={confidence === 'uncertain' ? 'warning' : 'neutral'} label={confidence} />;
}
