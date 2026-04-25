import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'fs';
const env = readFileSync('.env.local', 'utf-8');
const parsed = Object.fromEntries(env.split('\n').filter(l => l.includes('=')).map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i+1).replace(/^"(.*)"$/, '$1')]; }));
const client = new Anthropic({ apiKey: parsed.ANTHROPIC_API_KEY });

// Newest portfolio file_id from this run (uploaded by Note-28-fixed start-rubric)
const FID = 'file_011CaQzjPoNQjKRSTjgsihNu';

const session = await client.beta.sessions.create({
  agent: parsed.RUBRIC_AGENT_ID,
  environment_id: parsed.ATELIER_ENV_ID,
  title: 'probe-new-portfolio',
  resources: [{ type: 'file', file_id: FID }],
});
await client.beta.sessions.events.send(session.id, {
  events: [{ type: 'user.message', content: [{ type: 'text', text: `Read /mnt/session/uploads/${FID} and describe the image.` }] }],
});
const start = Date.now();
while (Date.now() - start < 90000) {
  await new Promise(r => setTimeout(r, 3000));
  const status = await client.beta.sessions.retrieve(session.id);
  if (status.status === 'idle') break;
}
const events = [];
for await (const ev of client.beta.sessions.events.list(session.id)) events.push(ev);
const tr = events.reverse().find(e => e.type === 'agent.tool_result' || e.type === 'tool_result');
const msg = events.find(e => e.type === 'agent.message');
console.log(`tool_result: ${JSON.stringify(tr?.content ?? tr?.output ?? '(none)').slice(0, 200)}`);
console.log(`agent: ${(msg?.content?.[0]?.text ?? '(none)').slice(0, 250)}`);
try { await client.beta.sessions.delete(session.id); } catch {}
