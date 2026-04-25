import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type Anthropic from '@anthropic-ai/sdk';
import { getAnthropic, MODEL_OPUS } from '@/lib/anthropic';
import { withAnthropicRetry } from '@/lib/anthropic-retry';
import {
  StyleFingerprint,
  PartialStyleFingerprint,
  type StyleFingerprint as TStyleFingerprint,
  type PartialStyleFingerprint as TPartialStyleFingerprint,
} from '@/lib/schemas/style-fingerprint';
import { parseLooseJson, extractText } from './json-parse';

export type AnalyzableImage = { id: number; thumb_url: string };

const CHUNK_SIZE = 20;
const MAX_TOKENS = 8000;

const CHUNK_INSTRUCTIONS = `
You are a senior fine-art curator and critic; your expertise spans photography, painting, and sculpture.
The vocabulary in your system prompt is your only descriptive register — use those terms; do not invent new ones.

You are reading a chunk of an artist's portfolio (one batch of a larger body). Identify cross-image patterns visible across THIS batch:
- composition tendencies that recur
- palette through-lines (temperature, saturation, notable notes)
- subject categories
- light preferences
- formal lineage (specific named precedents — Adams, Sugimoto, Eggleston, Frank, Tillmans — not generic "modernist landscape")
- a 2–4 sentence career-positioning read of THIS batch, blunt, naming the next institutional tier this work suggests AND visible gaps
- museum acquisition signals
- weak signals — areas where the work shows hesitation, repetition, or unresolved range

Output STRICTLY as a JSON object matching the PartialStyleFingerprint shape (any subset of StyleFingerprint fields you can substantiate from THIS batch). No preamble, no markdown fence.
`.trim();

const SYNTH_INSTRUCTIONS = `
You are the same critic. You now have N partial StyleFingerprints from chunks of one artist's portfolio.

Produce ONE canonical StyleFingerprint that represents the body of work as a whole:
- Resolve disagreement by frequency. A pattern named in 4 of 5 partials is real; a pattern in 1 of 5 is noise — drop it.
- For formal_lineage: take the union (multiple lineages are allowed).
- For career_positioning_read: write a fresh 2–4 sentence narrative; do NOT concatenate.
- For palette: pick the single dominant_temperature + saturation_register the majority of partials report.

Output STRICTLY as a JSON object matching the full StyleFingerprint schema. No preamble, no markdown fence.
`.trim();

let _aestheticVocab: string | null = null;
async function loadAestheticVocab(): Promise<string> {
  if (_aestheticVocab === null) {
    _aestheticVocab = await readFile(
      path.join(process.cwd(), 'skills', 'aesthetic-vocabulary.md'),
      'utf-8',
    );
  }
  return _aestheticVocab;
}

function chunk<T>(xs: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size));
  return out;
}

export async function analyzePortfolio(images: AnalyzableImage[]): Promise<TStyleFingerprint> {
  if (images.length === 0) {
    throw new Error('analyzePortfolio called with no images');
  }
  const chunks = chunk(images, CHUNK_SIZE);
  // Promise.allSettled — one bad chunk (parse failure, transient API hiccup)
  // shouldn't kill the whole run. Synthesize from whatever survived.
  const settled = await Promise.allSettled(chunks.map((c) => analyzeChunk(c)));
  const partials = settled
    .filter((r): r is PromiseFulfilledResult<TPartialStyleFingerprint> => r.status === 'fulfilled')
    .map((r) => r.value);
  const failures = settled.filter((r) => r.status === 'rejected').length;
  if (partials.length === 0) {
    throw new Error(
      `All ${chunks.length} Style Analyst chunks failed — check Anthropic API status`,
    );
  }
  if (failures > 0) {
    console.warn(`[style-analyst] ${failures}/${chunks.length} chunks failed; synthesizing from ${partials.length}`);
  }
  return synthesizePartials(partials);
}

async function analyzeChunk(images: AnalyzableImage[]): Promise<TPartialStyleFingerprint> {
  const vocab = await loadAestheticVocab();
  const client = getAnthropic();

  const userBlocks: Anthropic.ContentBlockParam[] = [
    ...images.map(
      (img): Anthropic.ImageBlockParam => ({
        type: 'image',
        source: { type: 'url', url: img.thumb_url },
      }),
    ),
    {
      type: 'text',
      text: `Produce a partial StyleFingerprint for these ${images.length} images (image IDs in order: ${images
        .map((i) => i.id)
        .join(', ')}).`,
    },
  ];

  const result = await callWithSchema(
    client,
    {
      model: MODEL_OPUS,
      max_tokens: MAX_TOKENS,
      system: [
        {
          type: 'text',
          text: vocab,
          cache_control: { type: 'ephemeral' },
        },
        { type: 'text', text: CHUNK_INSTRUCTIONS },
      ],
      messages: [{ role: 'user', content: userBlocks }],
    },
    PartialStyleFingerprint,
  );
  return result;
}

async function synthesizePartials(
  partials: TPartialStyleFingerprint[],
): Promise<TStyleFingerprint> {
  const client = getAnthropic();
  return callWithSchema(
    client,
    {
      model: MODEL_OPUS,
      max_tokens: MAX_TOKENS,
      system: [{ type: 'text', text: SYNTH_INSTRUCTIONS }],
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `Here are ${partials.length} partial fingerprint(s) (JSON array). Synthesize one canonical StyleFingerprint.\n\n${JSON.stringify(partials, null, 2)}`,
            },
          ],
        },
      ],
    },
    StyleFingerprint,
  );
}

async function callWithSchema<S extends { safeParse: (x: unknown) => { success: boolean; data?: unknown; error?: { message: string } } }>(
  client: Anthropic,
  params: Anthropic.MessageCreateParamsNonStreaming,
  schema: S,
): Promise<S extends { safeParse: (x: unknown) => { success: boolean; data?: infer D } } ? D : never> {
  let lastErr: string | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const messages = lastErr
      ? [
          ...params.messages,
          {
            role: 'user' as const,
            content: [
              {
                type: 'text' as const,
                text: `your previous output failed schema validation: ${lastErr}\nReturn corrected JSON only, no preamble.`,
              },
            ],
          },
        ]
      : params.messages;
    const resp = await withAnthropicRetry(
      () => client.messages.create({ ...params, messages }),
      { label: 'style-analyst' },
    );
    const text = extractText(
      (resp.content as Array<{ type: string; text?: string }>).filter((b) => b.type === 'text'),
    );
    let parsed: unknown;
    try {
      parsed = parseLooseJson(text);
    } catch (err) {
      lastErr = `not valid JSON: ${(err as Error).message}\nraw response head: ${text.slice(0, 200)}`;
      continue;
    }
    const result = schema.safeParse(parsed);
    if (result.success) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return result.data as any;
    }
    lastErr = result.error?.message ?? 'unknown validation error';
  }
  throw new Error(`schema validation failed after retry: ${lastErr}`);
}
