// Strip optional ```json fences and trim, then JSON.parse.
export function parseLooseJson(raw: string): unknown {
  let s = raw.trim();
  const fence = s.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fence) s = fence[1].trim();
  return JSON.parse(s);
}

export function extractText(content: Array<{ type: string; text?: string }>): string {
  return content
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text!)
    .join('\n');
}
