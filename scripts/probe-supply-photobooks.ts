/**
 * PROBE A — supply check for the photo_books opportunity type.
 *
 * Asks Opus 4.7 (no web search) to enumerate every legitimate photo-book
 * grant + monograph publisher open submission it can name from training,
 * marking each as currently_active / historical / uncertain. Tells us
 * the actual ceiling of the universe before we worry about Scout's
 * behavior at high target counts.
 *
 * Cost: ~$0.20. Time: ~10 seconds.
 */
import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'fs';

async function main() {
  const env = readFileSync('.env.local', 'utf-8');
  const e = Object.fromEntries(
    env.split('\n').filter((l) => l.includes('=')).map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i), l.slice(i + 1).replace(/^"(.*)"$/, '$1')];
    }),
  );
  const client = new Anthropic({ apiKey: e.ANTHROPIC_API_KEY });

  const prompt = `You are a photography-domain expert helping me audit the supply of legitimate photo-book opportunities for working US fine-art photographers.

Enumerate EVERY photo-book opportunity you can name. By "photo-book opportunity" I mean:
- Photo monograph publisher open submissions (e.g., MACK First Book Award, Aperture portfolio→book, Kehrer open call, Schilt Publishing submissions)
- Photo-book prizes (e.g., Lucie Photo Book Prize, Photo-Eye Best Books, Aperture First Photo Book Award, Author Book Award at Rencontres d'Arles)
- Photography monograph grants (foundation money earmarked for book production)
- University press photo-book lines accepting unsolicited (UNM Press, Trinity, U Texas, Steidl-equivalent academic)
- Self-publish photo-book competitions (Blurb Photography Book Now legacy, Indie Photobook Library, MOPLA, etc.)

For each opportunity, output a single line in this format:
NAME | type | currently_active | open_window_when_known
where:
- type is one of: monograph-publisher-submission | photo-book-prize | photo-book-grant | university-press | self-publish-contest
- currently_active is one of: yes (you are confident it ran in the last 12 months) | uncertain (might still run, you're not sure) | historical (definitely defunct or merged)
- open_window_when_known is the rough month/cycle when it accepts entries (or "rolling" or "unknown")

Do NOT pad the list. Do NOT invent names. If you have ~25 you're confident about, list 25 and stop. If you have 50, list 50.

After the list, write three lines:
TOTAL: <number>
ACTIVE: <number marked yes>
HONEST CEILING: <your best estimate of how many legit, currently-active US-accepting photo-book opportunities exist in any given year>`;

  const resp = await client.messages.create({
    model: 'claude-opus-4-7',
    max_tokens: 8000,
    thinking: { type: 'adaptive' },
    messages: [{ role: 'user', content: prompt }],
  });

  const text = (resp.content.find((b) => b.type === 'text') as { text?: string })?.text ?? '';
  console.log(text);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
