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

