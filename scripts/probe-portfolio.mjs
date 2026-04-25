import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'fs';
const env = readFileSync('.env.local', 'utf-8');
const parsed = Object.fromEntries(env.split('\n').filter(l => l.includes('=')).map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i+1).replace(/^"(.*)"$/, '$1')]; }));
const client = new Anthropic({ apiKey: parsed.ANTHROPIC_API_KEY });

// PORTFOLIO file_id from live run (from start-rubric upload)
const PORTFOLIO_FID = 'file_011CaQxJq4USYKMW3NyChwcz';
// RECIPIENT file_id from finalize-scout (proved working)
const RECIPIENT_FID = 'file_011CaQvZrgePq2tTNwxr6K7Q';

async function pollIdle(sessionId) {
  const start = Date.now();
  while (Date.now() - start < 90000) {
    await new Promise(r => setTimeout(r, 3000));
    const status = await client.beta.sessions.retrieve(sessionId);
    if (status.status === 'idle') return;
  }
}
async function lastAgent(sessionId) {
  const events = [];
  for await (const ev of client.beta.sessions.events.list(sessionId)) events.push(ev);
  return events.reverse().find(e => e.type === 'agent.message')?.content?.[0]?.text ?? '(no msg)';
}
async function lastTool(sessionId) {
  const events = [];
  for await (const ev of client.beta.sessions.events.list(sessionId)) events.push(ev);
  const tr = events.reverse().find(e => e.type === 'agent.tool_result' || e.type === 'tool_result');
  return tr ? JSON.stringify(tr.content ?? tr.output ?? tr).slice(0, 200) : '(none)';
}

async function test(fid, label) {
  console.log(`\n--- ${label} (${fid}) ---`);
  const session = await client.beta.sessions.create({
    agent: parsed.RUBRIC_AGENT_ID,
    environment_id: parsed.ATELIER_ENV_ID,
    title: `probe ${label}`,
    resources: [{ type: 'file', file_id: fid }],
  });
  await client.beta.sessions.events.send(session.id, {
    events: [{ type: 'user.message', content: [{ type: 'text', text: `Read /mnt/session/uploads/${fid} and describe the image. If you cannot see it as image, say "VISION FAILED".` }] }],
  });
  await pollIdle(session.id);
  console.log(`agent: ${(await lastAgent(session.id)).slice(0, 200)}`);
  console.log(`tool_result: ${await lastTool(session.id)}`);
  try { await client.beta.sessions.delete(session.id); } catch {}
}

await test(PORTFOLIO_FID, 'PORTFOLIO file (live run)');
await test(RECIPIENT_FID, 'RECIPIENT file (proven working)');
