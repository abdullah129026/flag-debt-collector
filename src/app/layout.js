import {Inter} from 'next/font/google';
import './globals.css';
import {Providers} from './providers';

const inter = Inter({subsets: ['latin'], display: 'swap'});

export const metadata = {
  title: 'Flag Debt Collector',
  description: 'Find stale feature flags, prove they are dead, delete them.',
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
