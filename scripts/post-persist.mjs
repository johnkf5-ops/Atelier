import { createClient } from '@libsql/client';
import { readFileSync } from 'fs';
const env = readFileSync('.env.local', 'utf-8');
const parsed = Object.fromEntries(env.split('\n').filter(l => l.includes('=')).map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i+1).replace(/^"(.*)"$/, '$1')]; }));
const db = createClient({ url: parsed.TURSO_DATABASE_URL, authToken: parsed.TURSO_AUTH_TOKEN });

const last = (await db.execute({ sql: `SELECT id, agent, kind, payload_json, created_at FROM run_events WHERE run_id = 1 ORDER BY id DESC LIMIT 25`, args: [] })).rows;
console.log('Last 25 events (most recent first):');
for (const ev of last) {
  let snippet = '';
  if (ev.payload_json) {
    const p = JSON.parse(ev.payload_json);
    if (ev.kind === 'message') snippet = (p.content?.[0]?.text ?? '').slice(0, 120);
    else if (ev.kind === 'custom_tool_use') snippet = `name=${p.name}`;
    else if (ev.kind === 'tool_use') snippet = `tool=${p.name ?? '?'}`;
    else if (ev.kind === 'status_idle') snippet = `stop=${p.stop_reason?.type ?? '?'}`;
    else if (ev.kind === 'thinking') snippet = (p.thinking ?? '').slice(0, 120);
  }
  console.log(`  id=${ev.id} ${new Date(Number(ev.created_at) * 1000).toISOString()} [${ev.agent}/${ev.kind}] ${snippet}`);
}
