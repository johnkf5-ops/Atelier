/**
 * Production-scale probe: mimic the live Rubric session shape exactly to
 * determine whether image content blocks in user.message engage vision at
 * scale. Builds a Rubric setup message + per-opp message identical to what
 * lib/agents/rubric-matcher.ts now produces, but adds an explicit
 * "describe what you see in the cohort images BEFORE you score" instruction
 * so we can read the agent's response and verify vision engaged.
 */
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@libsql/client';
import { readFileSync } from 'fs';

const env = readFileSync('.env.local', 'utf-8');
const parsed = Object.fromEntries(env.split('\n').filter(l => l.includes('=')).map(l => {
  const i = l.indexOf('='); return [l.slice(0, i), l.slice(i+1).replace(/^"(.*)"$/, '$1')];
}));
const client = new Anthropic({ apiKey: parsed.ANTHROPIC_API_KEY });
const db = createClient({ url: parsed.TURSO_DATABASE_URL, authToken: parsed.TURSO_AUTH_TOKEN });

async function pollIdle(sessionId, timeoutMs = 180000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await new Promise(r => setTimeout(r, 4000));
    const status = await client.beta.sessions.retrieve(sessionId);
    if (status.status === 'idle') return status;
  }
  return null;
}

async function getAllAgentMessages(sessionId) {
  const events = [];
  for await (const ev of client.beta.sessions.events.list(sessionId)) events.push(ev);
  return events.filter(e => e.type === 'agent.message').map(e => e.content?.[0]?.text ?? '');
}

async function main() {
  // Pull 12 portfolio file_ids that we know exist (from a recent start-rubric upload)
  // Use the most recent run's portfolio uploads. These were uploaded with Note-28 Sharp normalize.
  const PORTFOLIO_FIDS = [
    'file_011CaR2HNi9UtDKoyNmpCmru',
    'file_011CaR2HNmNiEsUSdvi918Ba',
    'file_011CaQzjPoNQjKRSTjgsihNu',
    'file_011CaQzjPn8e7mHyCjoMP5rf',
    'file_011CaQzjPm9142RDUbbTdA9h',
    'file_011CaQzjPoNZFCFGz9Xb6yY6',
    'file_011CaQzjPqqrfPTWC9H7AMrt',
    'file_011CaQjCT4xJWW3AjMqvJL9b',
  ];
  // 5 recipient file_ids (Sharp-normalized from finalize-scout)
  const RECIPIENT_FIDS = [
    'file_011CaQvZrgePq2tTNwxr6K7Q',
    'file_011CaQvZxBntw4iytuyhLZEe',
    'file_011CaQva3gRtPG3CioshRTzN',
    'file_011CaQvZnGUseXfrdPyjf9DT',
    'file_011CaQvZrn6gtgviHE8VmgW8',
  ];

  console.log(`Creating session with NO resources mounted (Note 29 pattern)...`);
  const session = await client.beta.sessions.create({
    agent: parsed.RUBRIC_AGENT_ID,
    environment_id: parsed.ATELIER_ENV_ID,
    title: 'probe-prod-scale',
  });
  console.log(`session=${session.id}`);

  // Setup message: portfolio images + heavy text context (mimic production scale)
  const heavyContext = 'You are scoring an artist against landscape photography opportunities. The artist works in saturated commercial-gallery landscape register (Peter Lik / Galen Rowell lineage). The portfolio shown here is the ARTIST\'S WORK. You will be sent a per-opportunity message next with cohort recipient images + scoring task. Acknowledge that you can see the portfolio images, then wait for the per-opp message.';

  const setupContent = [
    ...PORTFOLIO_FIDS.map(fid => ({ type: 'image', source: { type: 'file', file_id: fid } })),
    { type: 'text', text: heavyContext },
  ];

  console.log(`\nSending setup message with ${PORTFOLIO_FIDS.length} portfolio image blocks...`);
  await client.beta.sessions.events.send(session.id, {
    events: [{ type: 'user.message', content: setupContent }],
  });
  await pollIdle(session.id);

  let msgs = await getAllAgentMessages(session.id);
  console.log(`Setup reply (truncated):\n${msgs[msgs.length - 1]?.slice(0, 400)}\n`);

  // Per-opp message: recipient images + explicit "describe what you see" instruction
  const oppContent = [
    ...RECIPIENT_FIDS.map(fid => ({ type: 'image', source: { type: 'file', file_id: fid } })),
    {
      type: 'text',
      text: `Above are 5 past-recipient images from "International Landscape Photographer of the Year 2026" (ILPOTY).

BEFORE scoring fit, describe in 2-3 sentences what you see in the cohort images: dominant palette, compositional grammar, subject categories. Then describe in 2-3 sentences what you see in the portfolio images sent earlier: same dimensions.

Then write a 200-word scoring rationale comparing the two. Open with "VISION ENGAGED:" if you can see the images. Open with "VISION FAILED — fell back to text reasoning" if you cannot.`,
    },
  ];

  console.log(`Sending per-opp message with ${RECIPIENT_FIDS.length} recipient image blocks + describe instruction...`);
  await client.beta.sessions.events.send(session.id, {
    events: [{ type: 'user.message', content: oppContent }],
  });
  await pollIdle(session.id);

  msgs = await getAllAgentMessages(session.id);
  const lastMsg = msgs[msgs.length - 1] ?? '';
  console.log(`\n=== AGENT REPLY (per-opp scoring) ===`);
  console.log(lastMsg.slice(0, 1500));

  // Diagnostic
  const visionEngaged = lastMsg.includes('VISION ENGAGED');
  const visionFailed = lastMsg.includes('VISION FAILED');
  console.log(`\n--- VERDICT ---`);
  console.log(`vision engaged: ${visionEngaged}`);
  console.log(`vision failed (acknowledged): ${visionFailed}`);

  try { await client.beta.sessions.delete(session.id); } catch {}
}

main().catch(e => { console.error(e); process.exit(1); });
