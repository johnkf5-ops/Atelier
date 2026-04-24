import { hasAnthropicKey } from '@/lib/auth/api-key';
import HealthPanel from './health-panel';

export const dynamic = 'force-dynamic';

export default function SettingsPage() {
  const checks = [
    { label: 'ANTHROPIC_API_KEY', ok: hasAnthropicKey() },
    { label: 'TURSO_DATABASE_URL', ok: !!process.env.TURSO_DATABASE_URL },
    { label: 'TURSO_AUTH_TOKEN', ok: !!process.env.TURSO_AUTH_TOKEN },
    { label: 'BLOB_READ_WRITE_TOKEN', ok: !!process.env.BLOB_READ_WRITE_TOKEN },
  ];
  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-serif text-3xl">Settings</h1>
        <p className="text-neutral-400 text-sm mt-1">
          Single-tenant v1. Model is hardcoded <code className="text-neutral-200">claude-opus-4-7</code>.
        </p>
      </div>

      <section className="space-y-3">
        <h2 className="text-sm uppercase tracking-wide text-neutral-500">Environment</h2>
        <ul className="border border-neutral-800 rounded divide-y divide-neutral-800">
          {checks.map((c) => (
            <li key={c.label} className="flex items-center justify-between px-4 py-2">
              <span className="font-mono text-sm">{c.label}</span>
              <span className={c.ok ? 'text-emerald-400 text-sm' : 'text-rose-400 text-sm'}>
                {c.ok ? 'set' : 'missing'}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <HealthPanel />
    </div>
  );
}
