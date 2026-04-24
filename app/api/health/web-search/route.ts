import Anthropic from '@anthropic-ai/sdk';
import { getAnthropicKey } from '@/lib/auth/api-key';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function GET() {
  const client = new Anthropic({ apiKey: getAnthropicKey() });
  try {
    const r = await client.messages.create({
      model: 'claude-opus-4-7',
      max_tokens: 256,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tools: [{ type: 'web_search_20260209' as any, name: 'web_search', max_uses: 1 } as any],
      messages: [
        { role: 'user', content: 'Search the web for "anthropic claude" and return one result.' },
      ],
    });
    return Response.json({
      enabled: true,
      response_id: r.id,
      stop_reason: r.stop_reason,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      web_search_requests: (r.usage as any).server_tool_use?.web_search_requests ?? 0,
    });
  } catch (e) {
    const err = e as { message?: string };
    return Response.json(
      {
        enabled: false,
        error_message: err?.message ?? String(e),
        hint: 'If error mentions permission/tool not enabled, enable web_search in Claude Console → settings → privacy.',
      },
      { status: 503 },
    );
  }
}
