import Anthropic from '@anthropic-ai/sdk';
import { getAnthropicKey } from '@/lib/auth/api-key';
import { getDb } from '@/lib/db/client';
import { withAnthropicRetry } from '@/lib/anthropic-retry';
import { OpportunityWithRecipientUrls } from '@/lib/schemas/opportunity';
import type { ArtistKnowledgeBase } from '@/lib/schemas/akb';
import type { StyleFingerprint } from '@/lib/schemas/style-fingerprint';
import type { RunConfig } from '@/lib/schemas/run';

export async function startScoutSession(
  runId: number,
  akb: ArtistKnowledgeBase,
  fingerprint: StyleFingerprint,
  config: RunConfig,
): Promise<string> {
  const client = new Anthropic({ apiKey: getAnthropicKey() });

  const session = (await withAnthropicRetry(
    () =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (client.beta as any).sessions.create({
        agent: process.env.SCOUT_AGENT_ID!,
        environment_id: process.env.ATELIER_ENV_ID!,
        title: `Scout run ${runId}`,
      }),
    { label: `scout.sessions.create(run=${runId})` },
  )) as { id: string };

  const db = getDb();
  await db.execute({
    sql: `INSERT INTO run_event_cursors (run_id, managed_session_id, phase, last_event_id)
          VALUES (?, ?, 'scout', NULL)
          ON CONFLICT(run_id) DO UPDATE SET
            managed_session_id = excluded.managed_session_id,
            phase = 'scout',
            last_event_id = NULL,
            updated_at = unixepoch()`,
    args: [runId, session.id],
  });
  await db.execute({ sql: `UPDATE runs SET status = 'scout_running' WHERE id = ?`, args: [runId] });

  await withAnthropicRetry(
    () =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (client.beta as any).sessions.events.send(session.id, {
        events: [
          {
            type: 'user.message',
            content: [{ type: 'text', text: buildScoutPrompt(akb, fingerprint, config) }],
          },
        ],
      }),
    { label: `scout.events.send(run=${runId})` },
  );

  return session.id;
}

export function buildScoutPrompt(
  akb: ArtistKnowledgeBase,
  fingerprint: StyleFingerprint,
  config: RunConfig,
): string {
  // WALKTHROUGH Note 35 — opportunity-type filter. Build a per-type
  // descriptor block the agent uses to decide what's in scope. If the
  // user opted some types out, the prompt explicitly forbids emitting
  // those.
  const allTypes = [
    'competitions',
    'grants',
    'residencies',
    'photo_books',
    'portfolio_reviews',
    'museum_acquisition',
    'commissions',
  ];
  const selected = config.opportunity_types ?? allTypes;
  const excluded = allTypes.filter((t) => !selected.includes(t as never));
  const typeRules = `
USER-SELECTED OPPORTUNITY TYPES — strictly enforced:
The user has opted IN to these opportunity types for THIS run: [${selected.join(', ')}].
${excluded.length > 0 ? `The user has opted OUT of these types — DO NOT EMIT them, even if they fit the photographer's lane otherwise: [${excluded.join(', ')}].` : 'All opportunity types are in scope for this run.'}

Type definitions (what counts as each):
- competitions: photo prizes / "Photographer of the Year" style awards (IPA, ILPOTY, FAPA, NLPA, ND Awards, Epson Pano, NANPA, etc.) — judged submissions with cash or publication awards
- grants: foundation + state arts council money for unrestricted practice support (Aaron Siskind Foundation, En Foco, Pollock-Krasner, state arts fellowships in the photographer's home state) — application essay + budget, not a competition
- residencies: photography residencies offering funded studio time + room & board (Light Work, Penumbra Foundation, Visual Studies Workshop, Center for Photography at Woodstock) — NOT general multi-discipline residencies unless their recent cohorts are predominantly photographers
- photo_books: photo monograph publisher open submissions and photo-book prizes (Aperture Portfolio Prize book, MACK First Book, Lucie Photo Book Prize, Kehrer / Schilt / Daylight publisher submissions)
- portfolio_reviews: get-in-front-of-curators face-to-face events (FotoFest Biennial, Photolucida Critical Mass, Filter Photo, Medium Festival) — paid review tickets, not a competition
- museum_acquisition: competitions feeding into museum collections (Critical Mass final cut, Hariban Award, BJP awards with collection placement) — distinct from competitions in that the prize IS the museum acquisition
- commissions: public-art RFQs that explicitly accept photography (civic art programs, hospitality install commissions, university public art) — NOT general public-art calls where photography is a long-shot category
`;

  return `Find institutional PHOTOGRAPHY opportunities for this photographer whose deadlines fall in the configured window.

ARTIST_AKB (career stage, geography, eligibility):
${JSON.stringify(akb, null, 2)}

STYLE_FINGERPRINT (what this photographer's work actually looks like and where it belongs):
${JSON.stringify(fingerprint, null, 2)}

RUN_CONFIG:
- window: ${config.window_start} to ${config.window_end}
- budget_usd: ${config.budget_usd} (0 = no fee cap)
- max_travel_miles: ${config.max_travel_miles ?? 'unlimited'}
- target_opportunity_count: ${config.target_opportunity_count} (the slate you're aiming for)
${typeRules}

LANE DISCIPLINE — READ THIS FIRST:
This system finds opportunities for a working FINE-ART PHOTOGRAPHER. Every opportunity on the final slate MUST be photography-specific. The "diversify across many media" instinct is wrong here — diversification happens INSIDE photography, across photo-competition / photo-prize / photo-residency / photo-book / photo-grant axes, not across photography vs. painting vs. film vs. multidisciplinary grants.

HARD INCLUSION RULE: only emit an opportunity if at least one of these is true:
- The opportunity's name explicitly contains "photography" / "photo" / "photographer" / "photographic" or a photography-specific abbreviation (POTY, ILPOTY, NLPA, FAPA, IPA, NDA, NANPA, ND Awards, etc.)
- The opportunity is a PHOTO-SPECIFIC category inside a larger umbrella (e.g., a state arts fellowship explicitly accepting photography in the current cycle counts ONLY if photography is one of the funded disciplines this cycle)
- Past recipients in the last 3 cycles are predominantly (>=70%) photographers

HARD EXCLUSION RULES — DROP these from the slate, do not include them even if otherwise interesting:
- Book grants that are NOT photo-book-specific (general literary book grants, multi-genre book prizes — only include "photo book prize" / "photobook award" / publisher photo-monograph open submissions)
- Residencies that are not photo-residencies AND whose recent cohorts are dominantly painting / sculpture / writing / film (Yaddo, MacDowell mixed-medium cohorts unless photography is well-represented; Banff Mountain Film & Book Festival is FILM and BOOKS, not photography)
- Multi-discipline grants where photography is one of 5+ accepted media and the recent cohort shows <30% photographers
- Public-art commissions that don't accept photography as the primary medium
- Conservation / journalism / editorial grants that are about reporting first, photography second (Nat Geo Society Storytelling, Pulitzer Center, etc.) UNLESS the photographer's AKB shows editorial-photojournalism positioning specifically (check fingerprint.career_positioning_read)
- Mountain / outdoor / adventure festival open calls that are film-and-book centric (Banff Centre Mountain Film & Book Festival is the canonical example — drop it)

STEP 0 — ARCHETYPE INFERENCE (do this BEFORE any web_search):
Synthesize 5–8 PHOTOGRAPHY archetypes that fit this specific photographer. Examples of valid photography archetypes (use the patterns, not the labels):
- "international landscape-photography prize" (e.g., ILPOTY, NLPA, Epson Pano)
- "saturated-color-tolerant photography competition" (e.g., FAPA, IPA, ND Awards)
- "nature / outdoor photography competition" (e.g., NANPA, Wildlife POTY, BigPicture)
- "photo-book grant or publisher open submission" (e.g., Aperture Portfolio Prize book, Lucie Photo Book Prize, MACK First Book)
- "photography-specific state arts fellowship" (only when the home-state cycle accepts photography)
- "photography-specific foundation grant" (Aaron Siskind, Pollock-Krasner photography track, Howard, En Foco)
- "photography-specific residency" (Light Work, Visual Studies Workshop, Center for Photography at Woodstock, Penumbra Foundation)
- "photography-prize museum acquisition track" (Critical Mass, BJP, Hariban Award)
- "regional photography festival open call" (FotoFest portfolio review, Photolucida, Filter Photo)

Reason from:
- primary_medium and materials_and_methods (this is a photographer; opportunities must be photography)
- aesthetic register (fingerprint.palette, composition_tendencies, formal_lineage, museum_acquisition_signals — saturated-commercial-gallery vs. fine-art-museum vs. editorial-photojournalism vs. conservation-advocacy vs. process-forward; route to opportunities that recognize THIS register)
- career_positioning_read (where can this photographer credibly apply, given the StyleFingerprint's honest read?)
- home_base (state and regional photography opportunities, photo-festival cities)
- career_stage and awards_and_honors (don't send early-career to flagship-only; don't send established to first-book-only)

Honesty matters: if the fingerprint reads as "saturated commercial-gallery landscape," the candidate set is destination-photography prizes (Epson Pano, ILPOTY, Hamdan, IPOTY) plus saturated-tolerant competitions (FAPA, IPA, ND Awards) plus regional state-arts photo cycles — NOT process-forward residencies (Light Work) and NOT museum-acquisition tracks (Critical Mass) where the cohort is conceptual / wet-plate / lens-based-as-material. Include one "aspirational ceiling, likely wrong room" archetype ONLY if the fingerprint credibly supports it (museum_acquisition_signals are present).

State your inferred archetype list in an agent.message (short, 1-2 sentences per archetype explaining WHY it fits THIS photographer) BEFORE doing any web searches. Each archetype name MUST contain a photography keyword (photo / photographic / photography / specific-photo-prize-name).

STEP 1 — DISCOVERY
For each inferred archetype, use web_search to find 2–4 candidate institutions/programs. Do NOT restrict yourself to the opportunity-sources.md skill file — use it as a prior, but web_search for state/regional/medium-specific sources that aren't in it. Home-state and regional councils are almost never in the seed list; find them via search.

STEP 2 — FETCH + STRUCTURE
For each candidate: web_fetch the listings page. Find open calls whose deadlines fall in the run_config window. For each open call: web_fetch the detail page, extract structured fields (name, deadline, award type/amount/prestige_tier, eligibility, entry_fee_usd).

STEP 3 — ELIGIBILITY FILTER
Apply hard eligibility filters from the AKB (citizenship, medium, career_stage). Drop opportunities the artist is plainly ineligible for. Note what you filtered and why.

STEP 4 — PAST RECIPIENTS
For each surviving opportunity: locate past recipients (last 3 years). For each recipient, find their portfolio page (personal site, gallery rep page, or institutional archive) and extract up to 5 representative portfolio image URLs per recipient (max 3 recipients per opportunity).

CRITICAL — image_urls MUST be DIRECT IMAGE FILE URLs, not homepages or gallery pages:
- ✅ GOOD: \`https://photographer.com/portfolio/photo-001.jpg\`
- ✅ GOOD: \`https://cdn.gallery.com/works/2024/abc123.webp\`
- ✅ GOOD: \`https://institutionalarchive.org/images/recipient/work-3.png\`
- ❌ BAD: \`https://photographer.com/\` (homepage — has no image)
- ❌ BAD: \`https://photographer.com/portfolio\` (HTML page, not an image)
- ❌ BAD: \`https://gallery.com/artists/jane-doe\` (artist landing page, HTML)

To find direct image URLs: web_fetch the portfolio/gallery PAGE first, then extract <img src="..."> URLs from the HTML, OR look for "Open image in new tab" / right-click-image-address style URLs that end in .jpg / .png / .webp / .avif. If a personal site is a JS-rendered SPA where you can't see image URLs, use Google image search ("[recipient name] photographer") and extract direct image URLs from the search results page instead.

If you genuinely cannot find ANY direct image URLs for a recipient after honest effort, OMIT that recipient entirely — do NOT submit them with image_urls=[] or with a homepage URL as a placeholder. A recipient with zero usable images is worse than no recipient at all (it pollutes the cohort the Rubric Matcher scores against).

STEP 5 — EMIT
Emit one persist_opportunity custom tool call per opportunity. Pass the full structured Opportunity object PLUS a 'past_recipient_image_urls' array of objects: { recipient_name, year, image_urls: string[] }. Each image_urls entry must end in .jpg/.jpeg/.png/.webp/.avif/.gif (or be a known image-hosting CDN URL with no extension that demonstrably returns image bytes).

STEP 6 — COMPLETE
After all archetypes have been worked, emit a final agent.message with text: "<DONE>".

CALIBRATION of prestige_tier — use HONESTLY across the slate:
- flagship = Guggenheim, MacDowell, NEA, Creative Capital, Critical Mass final cut
- mid-tier = established regional/state programs with ≥10-year track record
- emerging = smaller competitions, first-book awards, local grants
- regional = home-state and nearby-state councils, city arts commissions
- open-call = unknown / TBD when uncertain

DO NOT download recipient images yourself — only collect URLs. The orchestrator handles downloading.

DO NOT use the write tool for binary content. If you need to briefly inspect an image during disambiguation, use bash + curl with a proper Referer header:
\`\`\`
curl -fsSL -e "https://example.com/" -A "Mozilla/5.0" -o /tmp/x.jpg "https://example.com/image.jpg"
\`\`\`
Then \`read /tmp/x.jpg\`.

If web_fetch fails on a source (404, anti-scraping, paywall), skip it and continue.

HARD CAPS for this run:
- ${Math.max(5, config.target_opportunity_count - 5)}–${config.target_opportunity_count + 5} distinct opportunities total (target: ${config.target_opportunity_count})
- 100% of opportunities MUST be photography-specific per the LANE DISCIPLINE rules above. Drop anything that fails the inclusion check.
- At least 3 distinct PHOTOGRAPHY archetypes represented in the final slate (e.g., not 12 landscape competitions and nothing else; mix in at least one photo-grant or photo-residency or photo-book channel where eligibility supports it)
- Stop adding new sources once you reach ${config.target_opportunity_count + 5} opportunities`;
}

export async function persistOpportunityFromAgent(runId: number, rawInput: unknown): Promise<string> {
  const parsed = OpportunityWithRecipientUrls.safeParse(rawInput);
  if (!parsed.success) {
    return `validation failed: ${parsed.error.message}`;
  }
  const data = parsed.data;
  const db = getDb();

  const awardSummary = [
    data.award.type,
    data.award.amount_usd ? `$${data.award.amount_usd}` : data.award.in_kind ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  const oppRes = await db.execute({
    sql: `INSERT INTO opportunities (source, source_id, name, url, deadline, award_summary, eligibility_json, raw_json)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(source, source_id) DO UPDATE SET
            name = excluded.name,
            url = excluded.url,
            deadline = excluded.deadline,
            award_summary = excluded.award_summary,
            eligibility_json = excluded.eligibility_json,
            raw_json = excluded.raw_json,
            fetched_at = unixepoch()
          RETURNING id`,
    args: [
      data.source,
      data.source_id,
      data.name,
      data.url,
      data.deadline ?? null,
      awardSummary,
      JSON.stringify(data.eligibility),
      JSON.stringify(data),
    ],
  });
  const opportunityId = Number((oppRes.rows[0] as unknown as { id: number }).id);

  await db.execute({
    sql: `INSERT OR IGNORE INTO run_opportunities (run_id, opportunity_id) VALUES (?, ?)`,
    args: [runId, opportunityId],
  });

  // Filter LLM-incomplete recipient entries: only keep ones with a name + ≥1
  // url. ALSO filter URLs that are obviously not direct images (homepages,
  // gallery landing pages) — Scout has a documented tendency to slip these
  // through despite the prompt requiring direct image URLs. The download
  // pipeline rejects non-image content-types, so persisting homepage URLs
  // produces empty file_ids which leaves the Rubric blind on that opportunity.
  const IMAGE_EXT_RE = /\.(jpe?g|png|webp|avif|gif|tiff?|bmp)(\?|#|$)/i;
  const isLikelyImageUrl = (u: string): boolean => {
    if (IMAGE_EXT_RE.test(u)) return true;
    // CDN paths with /image|/media|/uploads|/cdn segments are typically OK
    // even without an extension.
    if (/\/(image|media|upload|cdn|asset|file)s?\//i.test(u)) return true;
    return false;
  };
  const validRecipients = data.past_recipient_image_urls
    .map((rec) => ({
      ...rec,
      image_urls: (rec.image_urls ?? []).filter(isLikelyImageUrl),
    }))
    .filter(
      (rec) => rec.recipient_name && rec.recipient_name.length > 0 && rec.image_urls.length > 0,
    );

  const droppedByUrlFilter =
    data.past_recipient_image_urls.length - validRecipients.length;
  if (droppedByUrlFilter > 0) {
    console.warn(
      `[scout] persist_opportunity opp="${data.name}": dropped ${droppedByUrlFilter} recipients due to non-image-url filter`,
    );
  }

  for (const rec of validRecipients) {
    // ON CONFLICT: if existing row has Blob URLs (from a prior run), preserve them;
    // otherwise refresh with the latest raw URL list from Scout.
    await db.execute({
      sql: `INSERT INTO past_recipients (opportunity_id, year, name, portfolio_urls)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(opportunity_id, year, name) DO UPDATE SET
              portfolio_urls = CASE
                WHEN portfolio_urls LIKE '%blob.vercel-storage%' THEN portfolio_urls
                ELSE excluded.portfolio_urls
              END,
              fetched_at = unixepoch()`,
      args: [opportunityId, rec.year ?? null, rec.recipient_name, JSON.stringify(rec.image_urls)],
    });
  }

  return `persisted opportunity_id=${opportunityId} recipients=${validRecipients.length}`;
}
