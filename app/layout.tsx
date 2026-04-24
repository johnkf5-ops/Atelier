import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: 'Atelier',
  description: 'AI art director for working visual artists.',
};

const NAV = [
  { href: '/upload', label: 'Upload' },
  { href: '/interview', label: 'Interview' },
  { href: '/review', label: 'Review' },
  { href: '/runs', label: 'Runs' },
  { href: '/settings', label: 'Settings' },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="border-b border-neutral-800 px-6 py-4 flex items-center justify-between">
          <Link href="/" className="font-serif text-xl tracking-tight">Atelier</Link>
          <nav className="flex gap-6 text-sm text-neutral-400">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} className="hover:text-neutral-100">{n.label}</Link>
            ))}
          </nav>
        </header>
        <main className="px-6 py-10 max-w-6xl mx-auto">{children}</main>
      </body>
    </html>
  );
}
