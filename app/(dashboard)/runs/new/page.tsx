import Link from 'next/link';
import { getDb } from '@/lib/db/client';
import { getCurrentUserId } from '@/lib/auth/user';
import NewRunClient from './new-run-client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function NewRunPage() {
  const userId = getCurrentUserId();
  const db = getDb();

  const fpRow = (
    await db.execute({
      sql: `SELECT version, created_at FROM style_fingerprints
            WHERE user_id = ? ORDER BY version DESC LIMIT 1`,
      args: [userId],
    })
  ).rows[0] as unknown as { version: number; created_at: number } | undefined;

  const akbRow = (
    await db.execute({
      sql: `SELECT version, created_at FROM akb_versions
            WHERE user_id = ? ORDER BY version DESC LIMIT 1`,
      args: [userId],
    })
  ).rows[0] as unknown as { version: number; created_at: number } | undefined;

  const portfolioCount = Number(
    (
      await db.execute({
        sql: `SELECT COUNT(*) as n FROM portfolio_images WHERE user_id = ?`,
        args: [userId],
      })
    ).rows[0] as unknown as { n: number },
  ) || 0;

  const ready = Boolean(fpRow) && Boolean(akbRow) && portfolioCount > 0;

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <Link href="/runs" className="text-sm text-neutral-500 hover:text-neutral-300">
          ← Runs
        </Link>
        <h1 className="font-serif text-3xl mt-2">Start a new run</h1>
      </div>

      <p className="text-neutral-300 leading-relaxed">
        Atelier surfaces opportunities as institutions open new cycles. Re-run every two to
        four weeks, or whenever you update your portfolio or Knowledge Base.
      </p>

      <div className="border border-neutral-800 rounded divide-y divide-neutral-800">
        <div className="px-4 py-3 flex justify-between text-sm">
          <span className="text-neutral-400">Portfolio</span>
          <span className={portfolioCount > 0 ? 'text-neutral-200' : 'text-rose-400'}>
            {portfolioCount} image{portfolioCount === 1 ? '' : 's'}
          </span>
        </div>
        <div className="px-4 py-3 flex justify-between text-sm">
          <span className="text-neutral-400">Style fingerprint</span>
          <span className={fpRow ? 'text-neutral-200' : 'text-rose-400'}>
            {fpRow ? `v${fpRow.version}` : 'not yet built'}
          </span>
        </div>
        <div className="px-4 py-3 flex justify-between text-sm">
          <span className="text-neutral-400">Knowledge Base</span>
          <span className={akbRow ? 'text-neutral-200' : 'text-rose-400'}>
            {akbRow ? `v${akbRow.version}` : 'not yet built'}
          </span>
        </div>
      </div>

      {ready ? (
        <NewRunClient />
      ) : (
        <div className="border border-amber-500/30 bg-amber-500/5 rounded p-4 text-sm text-amber-200">
          Finish{' '}
          {portfolioCount === 0 && <Link href="/upload" className="underline">upload</Link>}
          {portfolioCount === 0 && !fpRow && ', '}
          {!fpRow && <Link href="/upload" className="underline">style analysis</Link>}
          {!akbRow && (fpRow || portfolioCount > 0) && ', '}
          {!akbRow && <Link href="/interview" className="underline">Knowledge Base</Link>}
          {' '}before starting a run.
        </div>
      )}
    </div>
  );
}
