import { createClient } from '@libsql/client';
import { readFileSync } from 'fs';
const env = readFileSync('.env.local', 'utf-8');
const parsed = Object.fromEntries(env.split('\n').filter(l => l.includes('=')).map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i+1).replace(/^"(.*)"$/, '$1')]; }));
const db = createClient({ url: parsed.TURSO_DATABASE_URL, authToken: parsed.TURSO_AUTH_TOKEN });
// Pair tool_use (read) with the immediately following tool_result, classify each
const events = (await db.execute({ sql: `SELECT id, kind, payload_json FROM run_events WHERE run_id = 2 AND (kind = 'tool_use' OR kind = 'tool_result') ORDER BY id`, args: [] })).rows;

const reads = []; // [{id, file_id, status}]
let pendingReads = []; // queue of recent file_path reads waiting for results

for (const ev of events) {
  const p = JSON.parse(ev.payload_json);
  if (ev.kind === 'tool_use' && p.name === 'read') {
    const fp = p.input?.file_path ?? '';
    pendingReads.push({ id: ev.id, file_path: fp });
  } else if (ev.kind === 'tool_result') {
    const out = JSON.stringify(p.output ?? p.content ?? p);
    let status;
    if (out.includes('"source":{"data"')) status = 'VISION_OK';
    else if (out.includes('Output could not be decoded')) status = 'TEXT_ONLY';
    else if (out.includes('not found')) status = 'NOT_FOUND';
    else status = 'OTHER';
    if (pendingReads.length > 0) {
      const r = pendingReads.shift();
      reads.push({ ...r, status });
    }
  }
}

// Group by file_id and report per-file pass/fail counts
const byFid = new Map();
for (const r of reads) {
  const m = r.file_path.match(/\/mnt\/session\/uploads\/(file_\w+)/);
  const fid = m ? m[1] : r.file_path;
  if (!byFid.has(fid)) byFid.set(fid, { ok: 0, fail: 0, other: 0 });
  const stats = byFid.get(fid);
  if (r.status === 'VISION_OK') stats.ok++;
  else if (r.status === 'TEXT_ONLY') stats.fail++;
  else stats.other++;
}

console.log(`Total reads: ${reads.length}`);
console.log(`Unique files read: ${byFid.size}`);
let alwaysOk = 0, alwaysFail = 0, mixed = 0;
for (const [fid, s] of byFid) {
  if (s.ok > 0 && s.fail === 0) alwaysOk++;
  else if (s.fail > 0 && s.ok === 0) alwaysFail++;
  else if (s.ok > 0 && s.fail > 0) mixed++;
}
console.log(`Files always vision-OK: ${alwaysOk}`);
console.log(`Files always text-only: ${alwaysFail}`);
console.log(`Files mixed (sometimes ok, sometimes fail): ${mixed}`);

console.log('\nFirst 10 always-OK files:');
for (const [fid, s] of [...byFid].filter(([_,s]) => s.ok > 0 && s.fail === 0).slice(0, 10)) {
  console.log(`  ${fid}: ${s.ok}× OK`);
}
console.log('\nFirst 10 always-FAIL files:');
for (const [fid, s] of [...byFid].filter(([_,s]) => s.fail > 0 && s.ok === 0).slice(0, 10)) {
  console.log(`  ${fid}: ${s.fail}× failed`);
}
