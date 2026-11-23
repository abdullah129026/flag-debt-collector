import {Inter} from 'next/font/google';
import './globals.css';
import {Providers} from './providers';

const inter = Inter({subsets: ['latin'], display: 'swap'});

export const metadata = {
  metadataBase: new URL('https://flag-debt-collector.vercel.app'),
  title: 'Flag Debt Collector',
  description: 'Find the flags your codebase forgot, and count what deleting them saves. Paste a public repo URL, get every flag with its age, rollout, call sites, deletable lines, and the diff.',
  openGraph: {
    title: 'Flag Debt Collector',
    description: 'Find the flags your codebase forgot, and count what deleting them saves.',
    url: 'https://flag-debt-collector.vercel.app',
    siteName: 'Flag Debt Collector',
    images: [{ url: '/og.png', width: 1200, height: 630, alt: 'Flag Debt Collector: find the flags your codebase forgot.' }],
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Flag Debt Collector',
    description: 'Find the flags your codebase forgot, and count what deleting them saves.',
    images: ['/og.png'],
  },
};

export default function RootLayout({children}) {
  return (
    <html lang="en" className={inter.className}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
