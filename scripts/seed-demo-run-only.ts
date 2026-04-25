/**
 * Companion to `pnpm seed:demo` — assumes the demo state is already seeded
 * and just kicks off a fresh run via the local API. Saves the click on
 * /runs/new while iterating on the run/Rubric/Drafter/dossier loop.
 *
 *   pnpm seed:demo:run-only
 *
 * Honours BASE_URL env var (defaults to http://localhost:3001) so this
 * works against a live dev server.
 */

import { config as dotenvConfig } from 'dotenv';
dotenvConfig({ path: '.env.local' });
dotenvConfig({ path: '.env' });

async function main() {
  const baseUrl = process.env.BASE_URL ?? 'http://localhost:3001';
  console.log(`[seed:demo:run-only] POST ${baseUrl}/api/runs/start`);
  const res = await fetch(`${baseUrl}/api/runs/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  const text = await res.text();
  if (!res.ok) {
    console.error(`status=${res.status}`);
    console.error(text);
    process.exit(1);
  }
  const data = JSON.parse(text) as { run_id: number; session_id: string; phase: string };
  console.log(
    `[seed:demo:run-only] started run ${data.run_id} (${data.phase} session ${data.session_id})`,
  );
  console.log(`Watch progress at: ${baseUrl}/runs/${data.run_id}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
