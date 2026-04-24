/**
 * Sanitize a JSON Schema for Anthropic's validator. The validator rejects
 * several standard JSON Schema constraints:
 *   - minimum / maximum / exclusiveMinimum / exclusiveMaximum / multipleOf (numbers)
 *   - minLength / maxLength (strings)
 *   - minItems / maxItems (arrays)
 *   - format (string format constraints like "uri", "email", "uuid")
 *   - pattern (regex)
 *
 * zod-to-json-schema emits all of these for common zod methods. Zod still
 * validates the parsed response post-hoc — correctness is preserved.
 * Used for:
 *   - custom tool input_schema in setup-managed-agents.ts
 *   - output_config.format.schema in any messages.create call
 */

const STRIP_KEYS = new Set([
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'minLength',
  'maxLength',
  'minItems',
  'maxItems',
  'format',
  'pattern',
  // Discovered in Phase 3 §3.2 setup-managed-agents run (2026-04-24):
  // Anthropic rejects `additionalProperties` on custom tool input_schema
  // with "Extra inputs are not permitted". zod-to-json-schema emits it as
  // `false` for strict objects.
  'additionalProperties',
]);

export function sanitizeJsonSchema<T = unknown>(schema: T): T {
  if (Array.isArray(schema)) {
    return schema.map(sanitizeJsonSchema) as unknown as T;
  }
  if (schema && typeof schema === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(schema)) {
      if (STRIP_KEYS.has(k)) continue;
      out[k] = sanitizeJsonSchema(v);
    }
    return out as unknown as T;
  }
  return schema;
}
