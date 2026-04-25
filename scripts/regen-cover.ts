import { orchestrateDossier } from '@/lib/agents/orchestrator';

async function main() {
  const runId = Number(process.argv[2]);
  if (!runId) {
    console.error('usage: pnpm tsx scripts/regen-cover.ts <runId>');
    process.exit(1);
  }
  console.log(`Regenerating dossier narratives for run ${runId}...`);
  await orchestrateDossier(runId);
  console.log('Done. Verify with scripts/check-dossier.mjs');
}

main().catch((e) => { console.error(e); process.exit(1); });
