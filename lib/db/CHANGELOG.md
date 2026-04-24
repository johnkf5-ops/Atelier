# Schema changelog

`lib/db/schema.sql` is the single source of truth. Every change made to the
schema after the initial v1 is folded back into the canonical CREATE TABLE /
CREATE INDEX statements in that file. This log records what changed and why
so git history isn't the only narrative.

If you're adding a column or table, add it to `schema.sql` directly — the
runner applies the file idempotently via CREATE TABLE IF NOT EXISTS, so new
deploys pick it up without any file-based migration dance.

## v1.4 — `past_recipients.file_ids` (Apr 24)
JSON array of Anthropic Files API IDs aligned position-wise with
portfolio_urls. Used by start-rubric to pre-mount images as session resources
so the Rubric reads via mount_path and avoids the bash+curl+/tmp pattern that
triggers the malware-analysis safety reminder.

## v1.3 — `drafted_packages` UNIQUE(run_match_id) (Apr 24)
Enables the Drafter's `ON CONFLICT(run_match_id) DO UPDATE` re-draft pattern
so re-running Drafter on the same match overwrites the prior row instead of
appending duplicates.

## v1.2 — composite_score + filtered_out_blurb on run_matches, opportunity_logos table (Apr 24)
Phase 4 dossier prep: composite score math (fit × prestige × urgency ×
affordability) and "why not" blurb for filtered opps. Logo cache keyed per
opportunity so dossier render is cheap.

## v1.1 — Phase 3 additions (Apr 23)
- run_event_cursors.phase (tracks scout → rubric session handoff)
- run_events.event_id + UNIQUE index (Anthropic sevt_... de-dup via INSERT OR IGNORE)
- past_recipients UNIQUE(opportunity_id, year, name) for Scout re-run dedup
- run_matches UNIQUE(run_id, opportunity_id) for retry dedup
- portfolio_images UNIQUE(user_id, blob_pathname) for idempotent re-upload
- extractor_turns.akb_patch_json for interview replay
- idx_extractor_turns_user for per-user turn scans

## v1 — initial (Apr 23)
users, portfolio_images, style_fingerprints, akb_versions, extractor_turns,
opportunities, past_recipients, runs, run_events, run_matches,
run_event_cursors, drafted_packages, dossiers, run_opportunities, _migrations.
