// Single-tenant for v1 — every Anthropic client gets its key from this seam,
// never from process.env directly. Path B (multi-tenant) replaces this body
// to look up a per-user encrypted key.

export function getAnthropicKey(): string {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY is not set');
  return key;
}

export function hasAnthropicKey(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}
