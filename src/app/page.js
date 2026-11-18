import Link from 'next/link';

// Placeholder home until phase-4 builds the landing page.
// Phase-2 owns the design system; its gallery lives at /design-system.
export default function Home() {
  return (
    <main>
      <h1>Flag Debt Collector</h1>
      <p>
        <Link href="/design-system">Design system gallery</Link>
      </p>
    </main>
  );
}
