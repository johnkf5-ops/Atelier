import * as cheerio from 'cheerio';

const FETCH_TIMEOUT_MS = 20000;
const IMAGE_EXT = /\.(jpe?g|png|webp|heic|heif)(\?.*)?(#.*)?$/i;
const SQUARESPACE_HOST = 'images.squarespace-cdn.com';
const USER_AGENT =
  'Mozilla/5.0 (compatible; AtelierPortfolioScraper/1.0; +https://github.com/johnkf5-ops/Atelier)';

export type ExtractedImage = {
  src: string;
  context_url: string; // the page URL it was found on
};

export async function fetchHtml(url: string): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'user-agent': USER_AGENT, accept: 'text/html,application/xhtml+xml' },
      redirect: 'follow',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} on ${url}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchImageBytes(url: string): Promise<Buffer> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'user-agent': USER_AGENT, accept: 'image/*' },
      redirect: 'follow',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const ab = await res.arrayBuffer();
    return Buffer.from(ab);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Extract candidate image URLs from a single HTML page.
 * Looks at <img src/data-src/srcset>, <picture><source srcset>, and
 * <a href> ending in image extensions. Picks the largest variant from any srcset.
 * Returns absolute URLs, deduped within this call.
 */
export function extractImages(html: string, baseUrl: string): ExtractedImage[] {
  const $ = cheerio.load(html);
  const found = new Set<string>();
  const out: ExtractedImage[] = [];

  function consider(raw: string | undefined) {
    if (!raw) return;
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith('data:')) return;
    let abs: string;
    try {
      abs = new URL(trimmed, baseUrl).toString();
    } catch {
      return;
    }
    abs = applySquarespaceVariant(abs);
    if (!found.has(abs)) {
      found.add(abs);
      out.push({ src: abs, context_url: baseUrl });
    }
  }

  // <img src> / <img data-src> (lazy loaders)
  $('img').each((_, el) => {
    consider($(el).attr('src'));
    consider($(el).attr('data-src'));
    consider($(el).attr('data-image'));
    const srcset = $(el).attr('srcset');
    if (srcset) consider(largestFromSrcset(srcset));
  });

  // <picture><source srcset>
  $('source[srcset]').each((_, el) => {
    consider(largestFromSrcset($(el).attr('srcset')!));
  });

  // <a href="...jpg|png|webp"> direct links to images
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (href && IMAGE_EXT.test(href)) consider(href);
  });

  // Open Graph / Twitter Card hero images (often the highest-res featured image)
  $('meta[property="og:image"], meta[name="twitter:image"]').each((_, el) => {
    consider($(el).attr('content'));
  });

  return out;
}

/**
 * Parse an srcset value and return the URL of the largest variant.
 * Handles both density (`url 2x`) and width (`url 1200w`) descriptors.
 */
export function largestFromSrcset(srcset: string): string | undefined {
  const candidates = srcset.split(',').map((part) => part.trim()).filter(Boolean);
  let best: { url: string; weight: number } | null = null;
  for (const c of candidates) {
    // "url 1200w" or "url 2x" — split on whitespace; descriptor is optional
    const match = c.match(/^(\S+)(?:\s+(\d+(?:\.\d+)?)([wx]))?$/);
    if (!match) continue;
    const url = match[1];
    const num = match[2] ? Number(match[2]) : 1;
    const unit = match[3] ?? 'x';
    // width descriptors generally pick larger numbers; for density same.
    const weight = unit === 'w' ? num : num * 1000;
    if (!best || weight > best.weight) best = { url, weight };
  }
  return best?.url;
}

/**
 * Squarespace CDN serves thumbnails by default; appending ?format=2500w
 * (or any format= param) requests a full-resolution variant. We only
 * touch URLs that don't already have a format query.
 */
export function applySquarespaceVariant(url: string): string {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return url;
  }
  if (u.host !== SQUARESPACE_HOST) return url;
  if (!u.pathname.startsWith('/content/v1/')) return url;
  if (u.searchParams.has('format')) return url;
  u.searchParams.set('format', '2500w');
  return u.toString();
}
