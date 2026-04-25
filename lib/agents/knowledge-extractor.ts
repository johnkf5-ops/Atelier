import * as cheerio from 'cheerio';
import { z } from 'zod';
import { getAnthropic, MODEL_OPUS } from '@/lib/anthropic';
import { withAnthropicRetry } from '@/lib/anthropic-retry';
import {
  PartialArtistKnowledgeBase,
  type PartialArtistKnowledgeBase as TPartialAkb,
} from '@/lib/schemas/akb';
import type { IdentityAnchor } from '@/lib/schemas/discovery';
import { parseLooseJson, extractText } from './json-parse';

const FETCH_TIMEOUT_MS = 15000;
const MAX_BODY_CHARS = 18000; // ~4–5K tokens of cleaned HTML; well within Opus context

const BASE_INSTRUCTIONS = `
You read a single web page about a visual artist (their portfolio site, gallery bio, press feature, etc.) and extract STRUCTURED facts that match the ArtistKnowledgeBase schema.

Rules:
- Extract ONLY what the page explicitly evidences. Do NOT invent, infer, or "fill in" likely values.
- Output a JSON object that is a SUBSET of ArtistKnowledgeBase fields. Omit any field for which the page provides no evidence.
- For arrays (exhibitions, publications, awards_and_honors, etc.) include only items the page mentions; do not pad.
- Do not include the source_provenance field — the orchestrator manages provenance separately.
- For nested objects (identity, practice, intent), include only the inner keys evidenced.

Output STRICTLY JSON, no markdown fence, no preamble. If the page has no extractable facts at all, output {}.
`.trim();

/**
 * WALKTHROUGH Note 3 fix #3: identity-anchor enforcement.
 * When the caller supplies an identity anchor, the model is told to refuse
 * extraction from any source that describes a different person matching the
 * same name. This makes "wrong John Knopf" facts structurally impossible to
 * ingest — the model returns {} instead of a polluted partial AKB.
 */
function buildInstructions(anchor: IdentityAnchor | null): string {
  if (!anchor) return BASE_INSTRUCTIONS;
  const affs = anchor.affiliations.length > 0 ? anchor.affiliations.join(', ') : 'none provided';
  return `${BASE_INSTRUCTIONS}

IDENTITY ANCHOR — extract facts ONLY about this specific person:
  Name:         ${anchor.name}
  Location:     ${anchor.location}
  Primary medium: ${anchor.medium}
  Affiliations: ${affs}

If this page describes a DIFFERENT person with the same or similar name (different city, different medium, different affiliations, no overlap with the anchor's distinguishing details), return {} for this source. Do NOT extract any facts from a same-name page about another person — those facts would pollute this artist's Knowledge Base. When in doubt, return {}.`;
}

export type IngestionResult = {
  url: string;
  ok: boolean;
  partial?: TPartialAkb;
  /** True if the page text resolved to identity anchor mismatch — model returned {}. */
  identity_skipped?: boolean;
  /** True if extraction used a search-snippet fallback instead of a page fetch. */
  used_snippet_fallback?: boolean;
  error?: string;
};

export interface IngestUrlOptions {
  /** Identity anchor — restricts extraction to facts unambiguously about this person. */
  anchor?: IdentityAnchor | null;
  /**
   * Fallback content for the URL (typically a search-engine snippet) used
   * when the page fetch returns 404/403/empty. Lets us salvage facts from
   * JS-rendered SPAs and bot-blocked sites whose pages we can't crawl.
   */
  snippet?: string;
}

export async function ingestUrl(
  url: string,
  options: IngestUrlOptions = {},
): Promise<IngestionResult> {
  let html: string;
  let usedSnippet = false;
  try {
    html = await fetchHtml(url);
  } catch (err) {
    // Page fetch failed (404, 403, JS-SPA timeout, etc.) — fall back to the
    // search snippet if we have one. Snippets are JS-rendered as Google sees
    // them; often sufficient for fact extraction. WALKTHROUGH Note 3 fix #2.
    if (options.snippet && options.snippet.length >= 50) {
      html = options.snippet;
      usedSnippet = true;
    } else {
      return { url, ok: false, error: `fetch failed: ${(err as Error).message}` };
    }
  }

  const cleaned = usedSnippet ? html : cleanHtml(html).slice(0, MAX_BODY_CHARS);
  if (cleaned.length < 50) {
    // Page fetch succeeded but had no extractable text (JS-rendered SPA).
    // Try the snippet fallback before giving up.
    if (options.snippet && options.snippet.length >= 50 && !usedSnippet) {
      return ingestFromSnippet(url, options.snippet, options.anchor ?? null);
    }
    return { url, ok: false, error: 'page had no extractable text content' };
  }

  try {
    const partial = await extractFromText(url, cleaned, options.anchor ?? null);
    const isEmpty = !partial || Object.keys(partial).length === 0;
    return {
      url,
      ok: true,
      partial,
      identity_skipped: isEmpty && options.anchor != null,
      used_snippet_fallback: usedSnippet,
    };
  } catch (err) {
    return { url, ok: false, error: (err as Error).message };
  }
}

async function ingestFromSnippet(
  url: string,
  snippet: string,
  anchor: IdentityAnchor | null,
): Promise<IngestionResult> {
  try {
    const partial = await extractFromText(url, snippet, anchor);
    const isEmpty = !partial || Object.keys(partial).length === 0;
    return {
      url,
      ok: true,
      partial,
      identity_skipped: isEmpty && anchor != null,
      used_snippet_fallback: true,
    };
  } catch (err) {
    return { url, ok: false, error: (err as Error).message };
  }
}

async function fetchHtml(url: string): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        'user-agent':
          'Mozilla/5.0 (compatible; AtelierKnowledgeExtractor/1.0; +https://github.com/johnkf5-ops/Atelier)',
        accept: 'text/html,application/xhtml+xml',
      },
      redirect: 'follow',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

function cleanHtml(html: string): string {
  const $ = cheerio.load(html);
  $('script, style, nav, footer, header, noscript, iframe, svg, form').remove();
  // Preserve heading + paragraph structure as plain text.
  const lines: string[] = [];
  $('h1, h2, h3, h4, p, li').each((_i, el) => {
    const t = $(el).text().replace(/\s+/g, ' ').trim();
    if (t) lines.push(t);
  });
  if (lines.length === 0) {
    return $('body').text().replace(/\s+/g, ' ').trim();
  }
  return lines.join('\n');
}

async function extractFromText(
  url: string,
  body: string,
  anchor: IdentityAnchor | null,
): Promise<TPartialAkb> {
  const client = getAnthropic();
  const instructions = buildInstructions(anchor);
  let lastErr: string | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const promptSuffix = lastErr
      ? `\n\nYour previous output failed validation: ${lastErr}\nReturn corrected JSON only.`
      : '';
    const resp = await withAnthropicRetry(
      () =>
        client.messages.create({
          model: MODEL_OPUS,
          max_tokens: 4000,
          system: [{ type: 'text', text: instructions }],
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: `SOURCE URL: ${url}\n\nPAGE TEXT:\n${body}${promptSuffix}`,
                },
              ],
            },
          ],
        }),
      { label: `knowledge-extractor.ingest(${url})` },
    );
    const text = extractText(resp.content as Array<{ type: string; text?: string }>);
    let parsed: unknown;
    try {
      parsed = parseLooseJson(text);
    } catch (err) {
      lastErr = `not JSON: ${(err as Error).message}`;
      continue;
    }
    const result = PartialArtistKnowledgeBase.safeParse(parsed);
    if (result.success) return result.data;
    lastErr = result.error.message;
  }
  throw new Error(`extraction failed after retry: ${lastErr}`);
}

export const IngestRequest = z.object({
  urls: z.array(z.string().url()).min(1).max(20),
});
export type IngestRequest = z.infer<typeof IngestRequest>;
