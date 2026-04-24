import Anthropic from '@anthropic-ai/sdk';
import { getAnthropicKey } from '@/lib/auth/api-key';

let _client: Anthropic | null = null;

export function getAnthropic(): Anthropic {
  if (!_client) {
    _client = new Anthropic({ apiKey: getAnthropicKey() });
  }
  return _client;
}

export const MODEL_OPUS = 'claude-opus-4-7';
