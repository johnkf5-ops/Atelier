import { hasAnthropicKey } from '@/lib/auth/api-key';
import HealthPanel from './health-panel';
import ResetDbPanel from './reset-db-panel';
import { PageHeader, Card, Badge } from '@/app/_components/ui';

export const dynamic = 'force-dynamic';

export default function SettingsPage() {
  const checks = [
    { label: 'ANTHROPIC_API_KEY', ok: hasAnthropicKey() },
    { label: 'TURSO_DATABASE_URL', ok: !!process.env.TURSO_DATABASE_URL },
    { label: 'TURSO_AUTH_TOKEN', ok: !!process.env.TURSO_AUTH_TOKEN },
    { label: 'BLOB_READ_WRITE_TOKEN', ok: !!process.env.BLOB_READ_WRITE_TOKEN },
  ];
  return (
    <div className="max-w-3xl space-y-10">
      <PageHeader
        title="Settings"
        subtitle={`Single-tenant v1. Model is hardcoded claude-opus-4-7.`}
      />

      <section className="space-y-3">
        <h2 className="text-[11px] uppercase tracking-widest text-neutral-500">Environment</h2>
        <Card padded={false}>
          <ul className="divide-y divide-neutral-800">
            {checks.map((c) => (
              <li
                key={c.label}
                className="flex items-center justify-between px-5 py-3"
              >
                <span className="font-mono text-sm text-neutral-200">{c.label}</span>
                {c.ok ? <Badge variant="success">set</Badge> : <Badge variant="danger">missing</Badge>}
              </li>
            ))}
          </ul>
        </Card>
      </section>

      <HealthPanel />

      {process.env.ATELIER_IS_RESETTABLE_DB === 'true' && <ResetDbPanel />}
    </div>
  );
}
