-- Migration 001: Phase 3 additions + Phase 2 retrofit columns/indexes.
-- Idempotent: every statement uses IF NOT EXISTS or is guarded by _migrations
-- bookkeeping (see lib/db/migrations.ts). SQLite's ALTER TABLE ADD COLUMN
-- cannot be IF-NOT-EXISTS-guarded; the runner skips this whole file after
-- the first successful application by inserting into _migrations.

-- Phase 3: per-run phase tracking for event polling (scout → rubric transition)
ALTER TABLE run_event_cursors ADD COLUMN phase TEXT NOT NULL DEFAULT 'scout';

-- Phase 3: Anthropic event de-dup via UNIQUE on event_id. INSERT OR IGNORE
-- lets concurrent polls race without inserting duplicate rows.
ALTER TABLE run_events ADD COLUMN event_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_run_events_event_id_unique
  ON run_events(event_id) WHERE event_id IS NOT NULL;

-- Phase 3: past_recipients de-dup across Scout reruns.
CREATE UNIQUE INDEX IF NOT EXISTS idx_past_recipients_dedup
  ON past_recipients(opportunity_id, year, name);

-- Phase 3: run_matches de-dup (agent retry/rephrase shouldn't double-count).
CREATE UNIQUE INDEX IF NOT EXISTS idx_run_matches_dedup
  ON run_matches(run_id, opportunity_id);

-- Phase 2 retrofit: portfolio_images dedupe by (user_id, blob_pathname).
-- blob_pathname is the SHA-256 of original bytes, so this enforces the
-- idempotent-reupload behavior promised by §2.1.
CREATE UNIQUE INDEX IF NOT EXISTS idx_portfolio_dedup
  ON portfolio_images(user_id, blob_pathname);

-- Phase 2 retrofit: extractor_turns gets the akb_patch_json column so the
-- interview handler can persist the RFC 7396 merge patch per turn for
-- replay / debugging. Index for per-user turn scans.
ALTER TABLE extractor_turns ADD COLUMN akb_patch_json TEXT;
CREATE INDEX IF NOT EXISTS idx_extractor_turns_user
  ON extractor_turns(user_id, turn_index);
