import type Anthropic from '@anthropic-ai/sdk';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { getAnthropic, MODEL_OPUS } from '@/lib/anthropic';
import {
  DiscoveryResult,
  type AutoDiscoverInput,
  type DiscoveryResult as TDiscoveryResult,
} from '@/lib/schemas/discovery';

export type DiscoveryEvent =
  | { type: 'started' }
  | { type: 'query_running'; query: string }
  | { type: 'results_received'; query: string; count: number }
  | { type: 'continuing_after_pause'; attempt: number }
  | { type: 'parsing' }
  | { type: 'complete'; result: TDiscoveryResult; usage: DiscoveryUsage }
  | { type: 'error'; message: string };

export type DiscoveryUsage = {
  input_tokens: number;
  output_tokens: number;
  web_search_requests: number;
};

const SYSTEM_PROMPT = `You are a research agent gathering public web evidence about a working artist for the purpose of building their Artist Knowledge Base.

You will be given the artist's name, primary medium, location, and notable affiliations.

Your job:
1. Generate 6-10 targeted web searches. Vary across: name + "artist", name + medium, name + each affiliation, name + "interview" / "feature" / "profile" / "exhibition", name + location.
2. Execute searches via the web_search tool.
3. From the results, identify URLs of pages CLEARLY about THIS artist (not someone with the same name). Use medium, location, and affiliations to disambiguate.
4. Skip: social-media listicles, paywalled previews, generic agency thumbnail pages, and pages where the artist is only briefly mentioned.
5. If you find evidence of multiple same-name people, note this explicitly at the end.

When done, return ONLY a final text response in this exact format (one entry per discovered URL):

URL: https://example.com/page
PAGE_TYPE: gallery_bio
TITLE: Page title here
CONFIDENCE: 0.95
WHY: One-sentence justification.

(blank line between entries)

Valid PAGE_TYPE values: personal_site, gallery_bio, press_feature, interview, museum_collection, exhibition_listing, publication, award_announcement, social_profile, other.

If you found multiple same-name people, end with:
DISAMBIGUATION_NOTES: text describing what you found.`;

export function buildAutoDiscoverPrompt(input: AutoDiscoverInput): string {
  const affs = input.affiliations.length ? input.affiliations.join(', ') : 'none provided';
  return `Find public web evidence about this artist:
- Name: ${input.name}
- Medium: ${input.medium}
- Location: ${input.location}
- Notable affiliations: ${affs}

Run searches and return the discovery list per the format in your instructions.`;
}

const MAX_PAUSE_RETRIES = 3;

const BLOCKED_DOMAINS = [
  'pinterest.com',
  'instagram.com',
  'facebook.com',
  'tiktok.com',
  'twitter.com',
  'x.com',
  'reddit.com',
  'gettyimages.com',
  'shutterstock.com',
  'alamy.com',
  'youtube.com',
  'linkedin.com',
];

export async function discoverArtist(
  input: AutoDiscoverInput,
  onEvent: (e: DiscoveryEvent) => void,
): Promise<{ rawText: string; queries: string[]; usage: DiscoveryUsage }> {
  const client = getAnthropic();
  let messages: Anthropic.MessageParam[] = [
    { role: 'user', content: buildAutoDiscoverPrompt(input) },
  ];

  const queries: string[] = [];
  const usage: DiscoveryUsage = { input_tokens: 0, output_tokens: 0, web_search_requests: 0 };
  let pauseCount = 0;

  while (true) {
    const stream = client.messages.stream({
      model: MODEL_OPUS,
      max_tokens: 8000,
      thinking: { type: 'adaptive' },
      tools: [
        // web_search_20260209 (the dynamic-filtering version in the plan) calls
        // code_execution_20260120 server-side to orchestrate multi-query searches
        // — not optional, and that tool is unavailable on this org
        // (error_code=unavailable). Downgrade to web_search_20250305, which does
        // direct sequential searches with no server-side code_execution. Same
        // result shape; loses only the dynamic-filter optimization.
        {
          type: 'web_search_20250305',
          name: 'web_search',
          max_uses: 10,
          blocked_domains: BLOCKED_DOMAINS,
          user_location: { type: 'approximate', country: 'US' },
        },
      ] as unknown as Anthropic.MessageCreateParams['tools'],
      system: SYSTEM_PROMPT,
      messages,
    });

    // Track partial input_json for server_tool_use blocks so we can emit the query when it completes.
    const partialInputs = new Map<number, string>();

    for await (const ev of stream) {
      if (ev.type === 'content_block_start') {
        const block = ev.content_block as unknown as {
          type: string;
          name?: string;
          content?: unknown;
          input?: { query?: string };
        };
        if (block.type === 'server_tool_use' && block.name === 'web_search') {
          // The SDK delivers web_search input fully-formed in start (no deltas).
          // Emit query_running immediately if input.query is present; otherwise
          // fall through to the delta accumulator path.
          const directQuery = block.input?.query;
          if (typeof directQuery === 'string' && directQuery.length > 0) {
            queries.push(directQuery);
            onEvent({ type: 'query_running', query: directQuery });
          } else {
            partialInputs.set(ev.index, '');
          }
        } else if (block.type === 'web_search_tool_result') {
          const content = block.content;
          const count = Array.isArray(content) ? content.length : 0;
          onEvent({ type: 'results_received', query: '', count });
        }
      } else if (ev.type === 'content_block_delta') {
        const delta = ev.delta as unknown as { type?: string; partial_json?: string };
        if (delta.type === 'input_json_delta') {
          const prev = partialInputs.get(ev.index) ?? '';
          partialInputs.set(ev.index, prev + (delta.partial_json ?? ''));
        }
      } else if (ev.type === 'content_block_stop') {
        const partial = partialInputs.get(ev.index);
        if (partial !== undefined) {
          try {
            const parsed = JSON.parse(partial);
            if (parsed.query) {
              queries.push(parsed.query);
              onEvent({ type: 'query_running', query: parsed.query });
            }
          } catch {
            /* incomplete JSON, skip */
          }
          partialInputs.delete(ev.index);
        }
      }
    }

    const final = await stream.finalMessage();
    usage.input_tokens += final.usage.input_tokens;
    usage.output_tokens += final.usage.output_tokens;
    const finalUsage = final.usage as unknown as { server_tool_use?: { web_search_requests?: number } };
    usage.web_search_requests += finalUsage.server_tool_use?.web_search_requests ?? 0;

    if (final.stop_reason === 'pause_turn') {
      if (++pauseCount > MAX_PAUSE_RETRIES) {
        throw new Error(`Hit pause_turn ${MAX_PAUSE_RETRIES} times — search loop not terminating.`);
      }
      // Echo assistant content back, continue the server-side loop
      messages = [...messages, { role: 'assistant', content: final.content }];
      onEvent({ type: 'continuing_after_pause', attempt: pauseCount });
      continue;
    }

    // Done — extract final text
    const textBlock = final.content.find(
      (b): b is Anthropic.TextBlock => b.type === 'text',
    );
    return {
      rawText: textBlock?.text ?? '',
      queries,
      usage,
    };
  }
}

/**
 * Anthropic's structured-output `output_config.format.schema` rejects
 * `minimum`/`maximum` on number types. zod-to-json-schema emits both for
 * `.min().max()` constraints, so we strip them before sending. Zod still
 * validates the constraints after parse — the schema we send to Anthropic
 * is purely for shape/type guidance.
 */
function stripUnsupportedJsonSchemaKeys(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(stripUnsupportedJsonSchemaKeys);
  if (node && typeof node === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node)) {
      if (k === 'minimum' || k === 'maximum' || k === 'exclusiveMinimum' || k === 'exclusiveMaximum') continue;
      out[k] = stripUnsupportedJsonSchemaKeys(v);
    }
    return out;
  }
  return node;
}

export async function parseDiscovery(
  rawText: string,
  queries: string[],
): Promise<TDiscoveryResult> {
  const client = getAnthropic();

  const rawSchema = zodToJsonSchema(DiscoveryResult, { target: 'openApi3' });
  const cleanSchema = stripUnsupportedJsonSchemaKeys(rawSchema);

  const params = {
    model: MODEL_OPUS,
    max_tokens: 4000,
    system:
      'Parse the input text into the DiscoveryResult schema. Preserve every URL, page_type, confidence, title, and rationale exactly. Dedupe URLs (if the same URL appears twice, keep the higher-confidence entry). Set queries_executed from the provided list. If the input contains "DISAMBIGUATION_NOTES:", populate disambiguation_notes; otherwise set to null.',
    output_config: {
      format: {
        type: 'json_schema',
        schema: cleanSchema,
      },
    },
    messages: [
      {
        role: 'user',
        content: `QUERIES_EXECUTED:\n${queries.join('\n')}\n\n---\n\nDISCOVERY_TEXT:\n\n${rawText}`,
      },
    ],
  } as unknown as Anthropic.MessageCreateParamsNonStreaming;
  const r = await client.messages.create(params);

  const text =
    r.content.find((b): b is Anthropic.TextBlock => b.type === 'text')?.text ?? '';
  const parsed = JSON.parse(text);
  return DiscoveryResult.parse(parsed);
}
