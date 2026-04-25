import type { Metadata } from 'next';
import Link from 'next/link';
import { Inter, Crimson_Pro } from 'next/font/google';
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});
const crimson = Crimson_Pro({
  subsets: ['latin'],
  variable: '--font-crimson',
  display: 'swap',
  weight: ['400', '500', '600', '700'],
});

export const metadata: Metadata = {
  title: 'Atelier',
  description: 'AI art director for working visual artists.',
};

const NAV: Array<{ href: string; label: string }> = [
  { href: '/upload', label: 'Portfolio' },
  { href: '/interview', label: 'Knowledge Base' },
  { href: '/review', label: 'Review' },
  { href: '/runs', label: 'Runs' },
  { href: '/settings', label: 'Settings' },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${crimson.variable}`}>
      <body>
        <header className="border-b border-neutral-800/80 backdrop-blur sticky top-0 z-30 bg-[#0a0a0a]/85 no-print">
          <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
            <Link
              href="/"
              className="font-serif text-2xl tracking-tight text-neutral-100 hover:text-white"
            >
              Atelier
            </Link>
            <nav className="flex gap-1 text-sm">
              {NAV.map((n) => (
                <Link
                  key={n.href}
                  href={n.href}
                  className="px-3 py-1.5 rounded text-neutral-400 hover:text-neutral-100 hover:bg-neutral-900 transition"
                >
                  {n.label}
                </Link>
              ))}
            </nav>
          </div>
        </header>
        <main className="px-6 py-10 max-w-6xl mx-auto">{children}</main>
      </body>
    </html>
  );
}
