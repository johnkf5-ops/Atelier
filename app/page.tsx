import Link from 'next/link';

export default function HomePage() {
  return (
    <div className="space-y-6">
      <h1 className="font-serif text-4xl tracking-tight">Atelier</h1>
      <p className="text-neutral-400 max-w-2xl">
        An AI art director that reads your portfolio and builds you a 90-day career plan with
        submission-ready application materials for the opportunities that actually fit.
      </p>
      <div className="flex gap-3">
        <Link
          href="/upload"
          className="inline-flex items-center rounded border border-neutral-700 bg-neutral-900 px-4 py-2 text-sm hover:bg-neutral-800"
        >
          Start onboarding →
        </Link>
        <Link
          href="/settings"
          className="inline-flex items-center rounded border border-neutral-800 px-4 py-2 text-sm text-neutral-400 hover:text-neutral-100"
        >
          Settings
        </Link>
      </div>
    </div>
  );
}
