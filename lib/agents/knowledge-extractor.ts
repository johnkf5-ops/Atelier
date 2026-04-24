import * as cheerio from 'cheerio';
import { z } from 'zod';
import { getAnthropic, MODEL_OPUS } from '@/lib/anthropic';
import {
  PartialArtistKnowledgeBase,
  type PartialArtistKnowledgeBase as TPartialAkb,
} from '@/lib/schemas/akb';
import { parseLooseJson, extractText } from './json-parse';

const FETCH_TIMEOUT_MS = 15000;
const MAX_BODY_CHARS = 18000; // ~4–5K tokens of cleaned HTML; well within Opus context

const INGEST_INSTRUCTIONS = `
You read a single web page about a visual artist (their portfolio site, gallery bio, press feature, etc.) and extract STRUCTURED facts that match the ArtistKnowledgeBase schema.

Rules:
- Extract ONLY what the page explicitly evidences. Do NOT invent, infer, or "fill in" likely values.
- Output a JSON object that is a SUBSET of ArtistKnowledgeBase fields. Omit any field for which the page provides no evidence.
- For arrays (exhibitions, publications, awards_and_honors, etc.) include only items the page mentions; do not pad.
- Do not include the source_provenance field — the orchestrator manages provenance separately.
- For nested objects (identity, practice, intent), include only the inner keys evidenced.

Output STRICTLY JSON, no markdown fence, no preamble. If the page has no extractable facts at all, output {}.
`.trim();

export type IngestionResult = {
  url: string;
  ok: boolean;
  partial?: TPartialAkb;
  error?: string;
};

export async function ingestUrl(url: string): Promise<IngestionResult> {
  let html: string;
  try {
    html = await fetchHtml(url);
  } catch (err) {
    return { url, ok: false, error: `fetch failed: ${(err as Error).message}` };
  }

  const cleaned = cleanHtml(html).slice(0, MAX_BODY_CHARS);
  if (cleaned.length < 50) {
    return { url, ok: false, error: 'page had no extractable text content' };
  }

  try {
    const partial = await extractFromText(url, cleaned);
    return { url, ok: true, partial };
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

async function extractFromText(url: string, body: string): Promise<TPartialAkb> {
  const client = getAnthropic();
  let lastErr: string | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const promptSuffix = lastErr
      ? `\n\nYour previous output failed validation: ${lastErr}\nReturn corrected JSON only.`
      : '';
    const resp = await client.messages.create({
      model: MODEL_OPUS,
      max_tokens: 4000,
      system: [{ type: 'text', text: INGEST_INSTRUCTIONS }],
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
    });
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
