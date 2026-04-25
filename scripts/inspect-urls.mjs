import { createClient } from '@libsql/client';
import { readFileSync } from 'fs';
const env = readFileSync('.env.local', 'utf-8');
const parsed = Object.fromEntries(env.split('\n').filter(l => l.includes('=')).map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i+1).replace(/^"(.*)"$/, '$1')]; }));
const db = createClient({ url: parsed.TURSO_DATABASE_URL, authToken: parsed.TURSO_AUTH_TOKEN });
const r = (await db.execute({ sql: `SELECT pr.id, pr.opportunity_id, pr.name, pr.portfolio_urls, pr.file_ids, o.name as opp_name FROM past_recipients pr JOIN opportunities o ON o.id = pr.opportunity_id ORDER BY pr.opportunity_id, pr.id`, args: [] })).rows;
let okCount = 0, failCount = 0;
const failedUrls = [];
const okUrls = [];
for (const row of r) {
  const urls = JSON.parse(row.portfolio_urls || '[]');
  const fids = JSON.parse(row.file_ids || '[]');
  const ok = fids.length > 0;
  if (ok) okCount++; else failCount++;
  for (const u of urls) {
    (ok ? okUrls : failedUrls).push({ url: u, name: row.name, opp: row.opp_name });
  }
}
console.log(`Recipients with file_ids: ${okCount} / failed: ${failCount}`);
console.log(`URLs successfully uploaded: ${okUrls.length}`);
console.log(`URLs that failed: ${failedUrls.length}`);
console.log('\n=== SAMPLE FAILED URLs (first 15) ===');
for (const f of failedUrls.slice(0, 15)) console.log(`  ${f.opp.slice(0, 30)} / ${f.name.slice(0, 25)}`);
for (const f of failedUrls.slice(0, 15)) console.log(`  ${f.url}`);
console.log('\n=== HOST DISTRIBUTION (failed) ===');
const hostCounts = {};
for (const f of failedUrls) {
  try { const h = new URL(f.url).host; hostCounts[h] = (hostCounts[h] || 0) + 1; } catch {}
}
const sorted = Object.entries(hostCounts).sort((a, b) => b[1] - a[1]).slice(0, 15);
for (const [h, n] of sorted) console.log(`  ${n}× ${h}`);
