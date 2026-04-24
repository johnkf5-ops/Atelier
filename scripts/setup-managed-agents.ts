/**
 * One-time setup for Managed Agents. Idempotent — run it every time skill
 * files change, and it updates in place rather than duplicating.
 *
 *   pnpm setup:agents
 *
 * Output: prints ATELIER_ENV_ID, SCOUT_AGENT_ID, RUBRIC_AGENT_ID. Paste into
 * .env.local AND `vercel env add` for production + preview + development.
 */

import { config as dotenvConfig } from 'dotenv';
import Anthropic from '@anthropic-ai/sdk';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { OpportunityWithRecipientUrls } from '../lib/schemas/opportunity';
import { RubricMatchResult } from '../lib/schemas/match';
import { sanitizeJsonSchema } from '../lib/schemas/sanitize';

dotenvConfig({ path: '.env.local' });
dotenvConfig({ path: '.env' });

const ENV_NAME = 'atelier-default';
const SCOUT_NAME = 'Atelier Opportunity Scout';
const RUBRIC_NAME = 'Atelier Rubric Matcher';

const client = new Anthropic();

// Resources have `name` (agents/envs) but the exact type isn't exported; use a loose structural type.
type Named = { id: string; name: string };

async function findByName<T extends Named>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  list: AsyncIterable<any>,
  name: string,
): Promise<T | null> {
  for await (const item of list) {
    if ((item as Named).name === name) return item as T;
  }
  return null;
}

async function findOrCreateEnvironment() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const existing = await findByName<any>((client.beta as any).environments.list(), ENV_NAME);
  if (existing) {
    console.log(`env: reused ${existing.id} (${ENV_NAME})`);
    return existing;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fresh = await (client.beta as any).environments.create({
    name: ENV_NAME,
    config: { type: 'cloud', networking: { type: 'unrestricted' } },
  });
  console.log(`env: created ${fresh.id} (${ENV_NAME})`);
  return fresh;
}

interface AgentConfig {
  name: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tools: any[];
  system: string;
  model: string;
}

async function findOrCreateAgent(cfg: AgentConfig) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const existing = await findByName<any>((client.beta as any).agents.list(), cfg.name);
  if (existing) {
    // agents.update REQUIRES the current version for optimistic concurrency.
    // If skill content / tools haven't changed, the API no-ops the version bump.
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const updated = await (client.beta as any).agents.update(existing.id, {
        version: existing.version,
        name: cfg.name,
        model: cfg.model,
        system: cfg.system,
        tools: cfg.tools,
      });
      console.log(`agent: updated ${updated.id} (${cfg.name}) v${updated.version}`);
      return updated;
    } catch (err) {
      const msg = (err as Error).message;
      if (/immutable/i.test(msg)) {
        console.error(
          `agent update failed: ${msg}\n` +
            `Model or other immutable field changed. Archive ${existing.id} in the Anthropic console, then re-run.`,
        );
        throw err;
      }
      throw err;
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fresh = await (client.beta as any).agents.create(cfg);
  console.log(`agent: created ${fresh.id} (${cfg.name})`);
  return fresh;
}

async function readSkill(name: string): Promise<string> {
  return fs.readFile(path.join(process.cwd(), 'skills', name), 'utf-8');
}

async function main() {
  const env = await findOrCreateEnvironment();

  const scoutSystem = [await readSkill('opportunity-sources.md'), await readSkill('eligibility-patterns.md')].join(
    '\n\n---\n\n',
  );

  const scoutTools = [
    { type: 'agent_toolset_20260401' },
    {
      type: 'custom',
      name: 'persist_opportunity',
      description:
        'Persist a discovered Opportunity to the orchestrator database. Pass the full structured opportunity JSON including past_recipient_image_urls.',
      input_schema: sanitizeJsonSchema(zodToJsonSchema(OpportunityWithRecipientUrls, { target: 'openApi3' })),
    },
  ];

  const scout = await findOrCreateAgent({
    name: SCOUT_NAME,
    model: 'claude-opus-4-7',
    system: scoutSystem,
    tools: scoutTools,
  });

  const rubricSystem = [await readSkill('juror-reading.md'), await readSkill('aesthetic-vocabulary.md')].join(
    '\n\n---\n\n',
  );

  const rubricTools = [
    { type: 'agent_toolset_20260401' },
    {
      type: 'custom',
      name: 'persist_match',
      description: 'Persist a fit-score result for a single opportunity. Pass full RubricMatchResult JSON.',
      input_schema: sanitizeJsonSchema(zodToJsonSchema(RubricMatchResult, { target: 'openApi3' })),
    },
  ];

  const rubric = await findOrCreateAgent({
    name: RUBRIC_NAME,
    model: 'claude-opus-4-7',
    system: rubricSystem,
    tools: rubricTools,
  });

  console.log('\n--- env vars ---');
  console.log(`ATELIER_ENV_ID=${env.id}`);
  console.log(`SCOUT_AGENT_ID=${scout.id}`);
  console.log(`RUBRIC_AGENT_ID=${rubric.id}`);
  console.log('\nPaste into .env.local AND `vercel env add` for production + preview + development.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
