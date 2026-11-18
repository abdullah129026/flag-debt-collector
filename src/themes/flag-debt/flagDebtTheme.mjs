// Flag Debt Collector theme: Astryx neutral, dark-first, Inter.
// Extends the neutral theme with a typography scale override only.
// Variant B from DESIGN.md: raw token overrides fail on touch screens
// (the coarse-pointer adaptation re-declares the base tokens and brings
// Figtree back), the typography scale config holds everywhere.
import {defineTheme} from '@astryxdesign/core/theme';
import {neutralTheme} from '@astryxdesign/theme-neutral';

export const flagDebtTheme = defineTheme({
  name: 'flag-debt',
  extends: neutralTheme,
  typography: {
    body: {
      family: 'Inter',
      fallbacks: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
    },
    heading: {
      family: 'Inter',
      fallbacks: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
    },
  },
});
