import { createClient } from '@libsql/client';
import { readFileSync } from 'fs';
const env = readFileSync('.env.local', 'utf-8');
const parsed = Object.fromEntries(env.split('\n').filter(l => l.includes('=')).map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i+1).replace(/^"(.*)"$/, '$1')]; }));
const db = createClient({ url: parsed.TURSO_DATABASE_URL, authToken: parsed.TURSO_AUTH_TOKEN });
const runId = 1;

console.log('=== ALL OPPS DISCOVERED ===');
const opps = (await db.execute({ sql: `SELECT o.id, o.name, o.url FROM opportunities o JOIN run_opportunities ro ON ro.opportunity_id = o.id WHERE ro.run_id = ? ORDER BY o.id`, args: [runId] })).rows;
for (const o of opps) console.log(`  ${o.id}: ${o.name}`);

console.log('\n=== ALL MATCHES (scored) ===');
const matches = (await db.execute({ sql: `SELECT rm.fit_score, rm.composite_score, rm.included, o.name FROM run_matches rm JOIN opportunities o ON o.id = rm.opportunity_id WHERE rm.run_id = ? ORDER BY rm.fit_score DESC`, args: [runId] })).rows;
for (const m of matches) console.log(`  fit=${m.fit_score} composite=${m.composite_score} included=${m.included}  ${m.name}`);

console.log('\n=== RUBRIC SESSION EVENTS (last 15 messages/idle) ===');
const events = (await db.execute({ sql: `SELECT agent, kind, payload_json, created_at FROM run_events WHERE run_id = ? AND (kind = 'message' OR kind = 'status_idle' OR kind = 'custom_tool_use') ORDER BY id DESC LIMIT 15`, args: [runId] })).rows;
for (const ev of events.reverse()) {
  const p = ev.payload_json ? JSON.parse(ev.payload_json) : {};
  let snippet = '';
  if (ev.kind === 'message' && p.content) snippet = JSON.stringify(p.content).slice(0, 220);
  else if (ev.kind === 'status_idle') snippet = `stop=${p.stop_reason?.type ?? '?'}`;
  else if (ev.kind === 'custom_tool_use') snippet = `tool=${p.name ?? '?'} input=${JSON.stringify(p.input ?? {}).slice(0, 150)}`;
  console.log(`  [${ev.agent}/${ev.kind}] ${snippet}`);
}
