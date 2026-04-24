/**
 * §3.0.b event-shape smoke test.
 *
 * Proves the doc-claimed event shapes the Scout + Rubric code will depend on:
 *  - agent.custom_tool_use event has { name, input, id }
 *  - session.status_idle with stop_reason.type === 'requires_action' carries
 *    stop_reason.event_ids[] pointing at the tool-use events
 *  - user.custom_tool_result accepts { custom_tool_use_id, content } and
 *    unblocks the session back to end_turn
 */

import { config } from 'dotenv';
import Anthropic from '@anthropic-ai/sdk';

config({ path: '.env.local' });

const AGENT_NAME = 'Atelier Event Shape Probe';
const ENV_NAME = 'atelier-probe';

async function main() {
  const client = new Anthropic();

  // Reuse env
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let env: any = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for await (const e of (client.beta as any).environments.list()) {
    if (e.name === ENV_NAME) {
      env = e;
      break;
    }
  }
  if (!env) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    env = await (client.beta as any).environments.create({
      name: ENV_NAME,
      config: { type: 'cloud', networking: { type: 'unrestricted' } },
    });
  }

  // Archive stale probe agent, then create fresh
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for await (const a of (client.beta as any).agents.list()) {
    if (a.name === AGENT_NAME) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (client.beta as any).agents.archive(a.id);
      } catch {
        /* ignore */
      }
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const agent = await (client.beta as any).agents.create({
    name: AGENT_NAME,
    model: 'claude-opus-4-7',
    system:
      'When you receive any user message, immediately call the persist_test custom tool with input { "echo": <the user message text> }. Then, after receiving the tool result, emit "<DONE>" and stop.',
    tools: [
      {
        type: 'custom',
        name: 'persist_test',
        description: 'Echoes the text back to the host for event-shape testing.',
        input_schema: {
          type: 'object',
          properties: { echo: { type: 'string' } },
          required: ['echo'],
        },
      },
    ],
  });
  console.log(`agent_id=${agent.id}`);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const session = await (client.beta as any).sessions.create({
    agent: agent.id,
    environment_id: env.id,
    title: 'Event-shape probe',
  });
  console.log(`session_id=${session.id}`);

  // Kick off
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (client.beta as any).sessions.events.send(session.id, {
    events: [{ type: 'user.message', content: [{ type: 'text', text: 'hello smoke' }] }],
  });

  // Poll for requires_action
  const { idleEventIds, toolUseEvents } = await pollForRequiresAction(client, session.id);
  console.log(`\nSTEP 1 CHECK: session.status_idle fired with stop_reason.type='requires_action'`);
  console.log(`  event_ids on stop_reason: ${JSON.stringify(idleEventIds)}`);
  console.log(`  agent.custom_tool_use events: ${toolUseEvents.length}`);

  if (toolUseEvents.length === 0) {
    throw new Error('FAIL: no agent.custom_tool_use events observed');
  }
  if (!idleEventIds || idleEventIds.length === 0) {
    throw new Error('FAIL: stop_reason.event_ids not present on session.status_idle');
  }

  // Assert: each event_id in stop_reason.event_ids maps to an agent.custom_tool_use
  for (const eid of idleEventIds) {
    const match = toolUseEvents.find((e) => e.id === eid);
    if (!match) {
      throw new Error(`FAIL: event_id ${eid} not found among custom_tool_use events`);
    }
    console.log(`  ${eid}: name=${match.name} input=${JSON.stringify(match.input)}`);
    if (match.name !== 'persist_test') {
      throw new Error(`FAIL: expected tool name 'persist_test', got '${match.name}'`);
    }
    if (match.input?.echo !== 'hello smoke') {
      throw new Error(`FAIL: expected input.echo='hello smoke', got '${match.input?.echo}'`);
    }
  }
  console.log(`  ✓ all event_ids matched, tool name + input correct`);

  // STEP 2: send user.custom_tool_result
  const toolUseId = idleEventIds[0];
  console.log(`\nSTEP 2: sending user.custom_tool_result for tool_use_id=${toolUseId}`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (client.beta as any).sessions.events.send(session.id, {
    events: [
      {
        type: 'user.custom_tool_result',
        custom_tool_use_id: toolUseId,
        content: [{ type: 'text', text: 'ok' }],
      },
    ],
  });

  // STEP 3: poll until end_turn idle
  const finalStopReason = await pollForEndTurn(client, session.id);
  console.log(`\nSTEP 3 CHECK: session.status_idle fired with stop_reason.type='${finalStopReason}'`);
  if (finalStopReason !== 'end_turn') {
    throw new Error(`FAIL: expected end_turn, got ${finalStopReason}`);
  }
  console.log('  ✓ session reached end_turn');

  // Cleanup
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (client.beta as any).sessions.delete(session.id);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (client.beta as any).agents.archive(agent.id);
    console.log('\ncleanup: session deleted, agent archived');
  } catch (err) {
    console.warn(`cleanup warning: ${(err as Error).message}`);
  }

  console.log('\n✓ §3.0.b EVENT-SHAPE SMOKE: PASS');
}

type ToolUseEvent = { id: string; name: string; input?: { echo?: string } };

async function pollForRequiresAction(
  client: Anthropic,
  sessionId: string,
): Promise<{ idleEventIds: string[]; toolUseEvents: ToolUseEvent[] }> {
  const t0 = Date.now();
  const seen = new Set<string>();
  const toolUseEvents: ToolUseEvent[] = [];
  let latestIdleWithEventIds: string[] | null = null;

  while (Date.now() - t0 < 180_000) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for await (const ev of (client.beta as any).sessions.events.list(sessionId, { limit: 200 })) {
      const e = ev as {
        id: string;
        type: string;
        name?: string;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        input?: any;
        stop_reason?: { type?: string; event_ids?: string[] };
      };
      if (seen.has(e.id)) continue;
      seen.add(e.id);
      if (e.type === 'agent.custom_tool_use') {
        toolUseEvents.push({ id: e.id, name: e.name ?? '', input: e.input });
      }
      if (e.type === 'session.status_idle' && e.stop_reason?.type === 'requires_action') {
        latestIdleWithEventIds = e.stop_reason.event_ids ?? [];
      }
    }
    if (latestIdleWithEventIds) {
      return { idleEventIds: latestIdleWithEventIds, toolUseEvents };
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error('timeout waiting for session.status_idle requires_action');
}

async function pollForEndTurn(client: Anthropic, sessionId: string): Promise<string | null> {
  const t0 = Date.now();
  const seen = new Set<string>();
  let newIdleStop: string | null = null;
  // Mark events seen up to this point as seen so we detect NEW idle events
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for await (const ev of (client.beta as any).sessions.events.list(sessionId, { limit: 500 })) {
    seen.add((ev as { id: string }).id);
  }

  while (Date.now() - t0 < 180_000) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for await (const ev of (client.beta as any).sessions.events.list(sessionId, { limit: 200 })) {
      const e = ev as { id: string; type: string; stop_reason?: { type?: string } };
      if (seen.has(e.id)) continue;
      seen.add(e.id);
      if (e.type === 'session.status_idle' && e.stop_reason?.type) {
        newIdleStop = e.stop_reason.type;
      }
    }
    if (newIdleStop && newIdleStop !== 'requires_action') return newIdleStop;
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error('timeout waiting for end_turn idle');
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
