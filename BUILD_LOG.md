# BUILD_LOG — Atelier

Narrative log of shipped work per §5.1.a polish batch. Each entry: commit SHA + the bug/gap → fix narrative a reviewer needs to understand the change.

## §5.1.a — Pre-demo polish batch

### Group A — Entry & Runs management

**Commits:** `2ecc110` (Group A), `42742be` (prior: Scout archetype fix), `e36c780` (prior: Files API).

**A1 `/runs` was a stub.** Rendered "List of past + in-progress runs." placeholder. Judge landing there post-run saw nothing to do. Now `app/(dashboard)/runs/page.tsx` renders the list newest-first from `listRunsForUser()` in `lib/db/queries/runs.ts`. Each row: `#id`, status badge (complete/errored/cancelled/running), relative time, and `N discovered · M scored · K included` counts. Empty state has a CTA to start the first run. Completed rows link to `/dossier/id`; in-flight rows link to `/runs/id`.

**A2 No visible path to start another run.** After first dossier the product looked finished forever. New `app/(dashboard)/runs/new/page.tsx` reads current portfolio count, latest fingerprint version, latest KB version, renders re-run cadence guidance ("Re-run every 2–4 weeks, or whenever you update your portfolio or Knowledge Base"), and a `NewRunClient` button that POSTs `/api/runs/start` and redirects to `/runs/[id]`. Blocks the button with an amber panel if portfolio/fingerprint/KB prerequisites are missing, with inline links to the gap.

**A3 Favicon 404.** `app/icon.svg` — monochrome "A" glyph on black rounded square, served by Next 15's automatic icon convention.

### Group B — Upload → Style Analyst flow

**Commit:** `84c864f`.

**B1 Style Analyst looked frozen for 30–90s.** Button showed "Analyzing…" with no other feedback. Now `app/(onboarding)/upload/upload-client.tsx` fires a staged timer that cycles through three honest stages every 12s while the API call runs: *Reading N images…* → *Identifying aesthetic lineage…* → *Writing fingerprint…*. Rendered as a pulsing emerald status panel. Real streaming progress from Style Analyst would be better but is out of scope here — the staged timer is visibly honest and prevents the "is it broken?" reaction.

**B2 Fingerprint was a JSON dump.** `app/(onboarding)/upload/style-fingerprint-card.tsx` renders the fingerprint as labelled prose sections: formal lineage, career read, palette (temperature · saturation register · notable notes), subject, composition, light, museum-tier signals. Weak signals get their own amber anti-reference block. Raw JSON is gated behind a `<details>` disclosure at the bottom so auditing is still one click away.

**B3 No next-step after analysis.** Card's footer now has the line "Next, we'll research your public record — shows, publications, residencies — so Atelier can match you to the right opportunities." and a primary-colour "Next: Build your Knowledge Base →" button linking to `/interview`.

Plus: `/upload` now fetches any existing fingerprint on mount so returning users see their card without re-analyzing.

### Group C — Auto-discover + Knowledge Extractor flow

**Commit:** `aff07ab`.

**C1 Auto-discover ingest silently "succeeded" with no AKB write.** Root cause in `app/(onboarding)/interview/auto-discover-panel.tsx`: `confirmAndIngest` did `void j` on the `/api/extractor/ingest` response, then always rendered a green "Ingested. The interview below will pick up from the new AKB." panel — regardless of whether `saved` was null or `changed_fields` was empty. If every URL failed fetch/extract (or if every field already had manual provenance and merge was a no-op), the user got the success UI and no new `akb_versions` row, exactly matching the reported symptom.

Fix: `IngestSummaryPanel` reads the actual response. When `saved` is non-null it shows the new KB version ID + changed-field count on green. When `saved` is null with `changed_fields.length === 0` it shows "No new facts extracted from the selected pages. Try adding URLs with richer bio / press content." on amber. Failed sources surface behind a collapsible disclosure with per-URL reason strings. The ingest route itself (`lib/extractor/ingest-urls.ts`) is already structurally correct — it returns per-source `ok/error/changed` fields and writes a new akb_version iff `allChanged.size > 0`. Making the UI honest eliminates the "silent zero-write" failure mode.

**C2 Scraper review UI dominated by log dump.** Thumbnails already rendered in the main portfolio grid with `inReview` emerald-outline, but the verbose `<pre>` scrape log competed for visual weight. Now the log collapses behind a `<details>` summary ("Scrape log (N lines)"), and a new emerald primary line ("N images pending review in the grid below — uncheck any false positives, then Confirm") anchors the review action.

### Group D — Interview flow

**Commit:** `800bea7`.

**D1 No visible interview state.** User had no way to tell if the interview was idle, running, or done. New `StateBanner` at the top of `app/(onboarding)/interview/interview-client.tsx` derives one of four states from the turn log + last agent's `next_field_target`:

- **empty** — no KB yet, prompts auto-discover
- **ready** — KB has N facts, hints "Start the interview to fill remaining gaps"
- **in_progress** — amber banner, live fact count
- **complete** — emerald banner with "Review & start your first run →" CTA (sets up Group F's handoff)

The completeness signal (`next_field_target === null`) is already returned by the existing turn API; this is a consumer of data the server already emits, no backend change needed.

**D2 Dot-path schema leak + wrong-target mismatch.** Every turn in the chat rendered `agent → identity.citizenship` underneath the message. Two bugs in one: (a) dot-paths are internal; a judge shouldn't see "AKB schema plumbing" in the transcript, (b) `next_field_target` per its own schema is the *next* question's target, not the one just asked — so the label was semantically misaligned with the text. Fix removes the `→ {path}` line entirely. Turn labels now render just "Atelier" / "You". `next_field_target` keeps flowing through for the `StateBanner` completeness check but never surfaces as a field label.

Plus: sidebar "AKB (live)" → "Knowledge Base (live)", page title "Knowledge Extractor" → "Build your Knowledge Base".

