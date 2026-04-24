/**
 * Isolate which part of the Scout agent config triggers retries_exhausted.
 * Test variants:
 *  1. Vanilla agent_toolset_20260401, tiny system prompt, no custom tool → baseline
 *  2. Vanilla toolset + full Scout system prompt (skill files) → is system prompt the issue?
 *  3. Full Scout config (toolset + custom tool + full system) → reproduce failure
 */

import { config } from 'dotenv';
import Anthropic from '@anthropic-ai/sdk';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { OpportunityWithRecipientUrls } from '../lib/schemas/opportunity';
import { sanitizeJsonSchema } from '../lib/schemas/sanitize';

config({ path: '.env.local' });

const client = new Anthropic();
const ENV_ID = process.env.ATELIER_ENV_ID!;

async function readSkill(name: string): Promise<string> {
  return fs.readFile(path.join(process.cwd(), 'skills', name), 'utf-8');
}

async function runVariant(label: string, systemText: string, extraTools: unknown[]) {
  console.log(`\n=== ${label} ===`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const agent: any = await (client.beta as any).agents.create({
    name: `Atelier Scout Probe ${Date.now()}`,
    model: 'claude-opus-4-7',
    system: systemText,
    tools: [{ type: 'agent_toolset_20260401' }, ...extraTools],
  });
  console.log(`agent=${agent.id}`);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const session: any = await (client.beta as any).sessions.create({
    agent: agent.id,
    environment_id: ENV_ID,
    title: `probe-scout-config ${label}`,
  });
  console.log(`session=${session.id}`);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (client.beta as any).sessions.events.send(session.id, {
    events: [
      {
        type: 'user.message',
        content: [{ type: 'text', text: 'Say hello and stop — a connectivity smoke test.' }],
      },
    ],
  });

  const t0 = Date.now();
  const seen = new Set<string>();
  let stopReason: string | null = null;
  let errorMsg: string | null = null;
  const agentText: string[] = [];

  while (Date.now() - t0 < 60_000) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for await (const ev of (client.beta as any).sessions.events.list(session.id)) {
      const e = ev as {
        id: string;
        type: string;
        content?: Array<{ type: string; text?: string }>;
        stop_reason?: { type?: string };
        error?: { message?: string };
      };
      if (seen.has(e.id)) continue;
      seen.add(e.id);
      if (e.type === 'agent.message') {
        const txts = (e.content ?? []).filter((b) => b.type === 'text').map((b) => b.text ?? '');
        agentText.push(...txts);
      }
      if (e.type === 'session.status_idle') stopReason = e.stop_reason?.type ?? null;
      if (e.type === 'session.error') errorMsg = e.error?.message ?? 'unknown';
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sess = await (client.beta as any).sessions.retrieve(session.id);
    if (sess.status === 'terminated') break;
    if (sess.status === 'idle' && stopReason !== null) break;
    await new Promise((r) => setTimeout(r, 2000));
  }

  console.log(`stop_reason=${stopReason} error=${errorMsg ?? '(none)'} text=${agentText.join(' ').slice(0, 100)}`);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  try { await (client.beta as any).sessions.delete(session.id); } catch { /* ignore */ }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  try { await (client.beta as any).agents.archive(agent.id); } catch { /* ignore */ }
}

async function main() {
  const which = process.argv[2] ?? 'all';

  if (which === 'v1' || which === 'all') {
    await runVariant('v1: minimal system + toolset only', 'You are a tool capability checker. Say hello and stop.', []);
  }
  if (which === 'v2' || which === 'all') {
    const full = [await readSkill('opportunity-sources.md'), await readSkill('eligibility-patterns.md')].join(
      '\n\n---\n\n',
    );
    await runVariant('v2: full system + toolset only', full, []);
  }
  if (which === 'v3' || which === 'all') {
    const full = [await readSkill('opportunity-sources.md'), await readSkill('eligibility-patterns.md')].join(
      '\n\n---\n\n',
    );
    const customTool = {
      type: 'custom',
      name: 'persist_opportunity',
      description: 'Persist a discovered opportunity.',
      input_schema: sanitizeJsonSchema(
        zodToJsonSchema(OpportunityWithRecipientUrls, { target: 'openApi3' }),
      ),
    };
    await runVariant('v3: full system + toolset + persist_opportunity custom', full, [customTool]);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
