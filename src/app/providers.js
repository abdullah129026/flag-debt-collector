'use client';

import Link from 'next/link';
import {Theme} from '@astryxdesign/core/theme';
import {LinkProvider} from '@astryxdesign/core/Link';
import {themes, defaultThemeSlug} from '../astryx-themes';

// Dark only in v1 (DESIGN.md decision 1). No light toggle.
export function Providers({children}) {
  return (
    <Theme theme={themes[defaultThemeSlug]} mode="dark">
      <LinkProvider component={Link}>{children}</LinkProvider>
    </Theme>
  );
}
