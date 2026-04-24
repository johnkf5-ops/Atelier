import { load } from 'cheerio';
import { getDb } from '@/lib/db/client';

const CACHE_TTL_SECONDS = 90 * 86400;

/**
 * Fetch + cache a logo URL for an opportunity. Priority:
 *   og:image → twitter:image → apple-touch-icon → favicon
 * Relative URLs resolved against the opportunity URL.
 * null is a valid cached result — don't re-fetch when a prior attempt
 * found nothing. Cache TTL 90 days.
 */
export async function getLogoUrl(opportunityId: number, opportunityUrl: string): Promise<string | null> {
  const db = getDb();

  const cached = (
    await db.execute({
      sql: `SELECT logo_url FROM opportunity_logos
            WHERE opportunity_id = ? AND fetched_at > unixepoch() - ?`,
      args: [opportunityId, CACHE_TTL_SECONDS],
    })
  ).rows[0] as unknown as { logo_url: string | null } | undefined;
  if (cached) return cached.logo_url;

  let logoUrl: string | null = null;
  try {
    const res = await fetch(opportunityUrl, {
      signal: AbortSignal.timeout(8000),
      headers: { 'User-Agent': 'Mozilla/5.0 Atelier/0.1' },
    });
    if (res.ok) {
      const $ = load(await res.text());
      const candidates = [
        $('meta[property="og:image"]').attr('content'),
        $('meta[name="twitter:image"]').attr('content'),
        $('link[rel="apple-touch-icon"]').attr('href'),
        $('link[rel="icon"]').attr('href'),
      ].filter((u): u is string => !!u);
      const first = candidates[0];
      if (first) {
        logoUrl = new URL(first, opportunityUrl).toString();
      }
    }
  } catch {
    /* silent fail; null cached below */
  }

  await db.execute({
    sql: `INSERT INTO opportunity_logos (opportunity_id, logo_url) VALUES (?, ?)
          ON CONFLICT(opportunity_id) DO UPDATE SET logo_url = excluded.logo_url, fetched_at = unixepoch()`,
    args: [opportunityId, logoUrl],
  });
  return logoUrl;
}
