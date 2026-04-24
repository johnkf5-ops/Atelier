-- Atelier — single source of truth for the entire schema.
-- Every CREATE is IF NOT EXISTS and every statement in this file is idempotent,
-- so running the whole file on a healthy DB is a no-op and running it on an
-- empty DB (post db:reset) rebuilds every table + index from scratch.
--
-- ONE file, ONE runner (lib/db/migrations.ts). No separate migrations/ dir —
-- we folded every prior migration into the canonical CREATE TABLE statements
-- below (see lib/db/CHANGELOG.md for the history).

-- Users (single-user v1, but keep the table for future multi-tenant)
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Portfolio images
CREATE TABLE IF NOT EXISTS portfolio_images (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  filename TEXT NOT NULL,            -- original filename uploaded by user
  blob_pathname TEXT NOT NULL,       -- Vercel Blob pathname for original (stable key)
  thumb_pathname TEXT NOT NULL,      -- Vercel Blob pathname for 1024px thumb
  blob_url TEXT NOT NULL,            -- public URL (cached at upload time)
  thumb_url TEXT NOT NULL,
  width INTEGER, height INTEGER,
  exif_json TEXT,                    -- camera/lens/EXIF metadata as JSON
  ordinal INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
-- blob_pathname = SHA-256 of bytes; enforces idempotent re-upload per §2.1
CREATE UNIQUE INDEX IF NOT EXISTS idx_portfolio_dedup
  ON portfolio_images(user_id, blob_pathname);

-- Style fingerprint (output of Style Analyst)
CREATE TABLE IF NOT EXISTS style_fingerprints (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  version INTEGER NOT NULL,
  json TEXT NOT NULL,                -- StyleFingerprint zod-validated
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Artist Knowledge Base (versioned)
CREATE TABLE IF NOT EXISTS akb_versions (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  version INTEGER NOT NULL,
  json TEXT NOT NULL,                -- ArtistKnowledgeBase zod-validated
  source TEXT NOT NULL,              -- 'ingest' | 'interview' | 'merge'
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Knowledge Extractor interview transcript
CREATE TABLE IF NOT EXISTS extractor_turns (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  turn_index INTEGER NOT NULL,
  role TEXT NOT NULL,                -- 'agent' | 'user'
  content TEXT NOT NULL,
  akb_field_targeted TEXT,
  akb_patch_json TEXT,               -- RFC 7396 merge patch applied this turn
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_extractor_turns_user
  ON extractor_turns(user_id, turn_index);

-- Opportunity cache (shared across runs)
CREATE TABLE IF NOT EXISTS opportunities (
  id INTEGER PRIMARY KEY,
  source TEXT NOT NULL,
  source_id TEXT NOT NULL,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  deadline TEXT,                     -- ISO date
  award_summary TEXT,
  eligibility_json TEXT,
  raw_json TEXT NOT NULL,
  fetched_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(source, source_id)
);

-- Opportunity logo cache (scraped via og:image / favicon per opp)
CREATE TABLE IF NOT EXISTS opportunity_logos (
  opportunity_id INTEGER PRIMARY KEY REFERENCES opportunities(id),
  logo_url TEXT,
  fetched_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Past recipients (for Rubric Matcher)
CREATE TABLE IF NOT EXISTS past_recipients (
  id INTEGER PRIMARY KEY,
  opportunity_id INTEGER NOT NULL REFERENCES opportunities(id),
  year INTEGER,
  name TEXT NOT NULL,
  bio_url TEXT,
  portfolio_urls TEXT,               -- JSON array of Vercel Blob URLs
  file_ids TEXT,                     -- JSON array of Anthropic Files API IDs (position-aligned with portfolio_urls)
  notes TEXT,
  fetched_at INTEGER NOT NULL DEFAULT (unixepoch())
);
-- Dedup recipients across Scout re-runs on the same opp
CREATE UNIQUE INDEX IF NOT EXISTS idx_past_recipients_dedup
  ON past_recipients(opportunity_id, year, name);

-- Runs
CREATE TABLE IF NOT EXISTS runs (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  akb_version_id INTEGER NOT NULL REFERENCES akb_versions(id),
  style_fingerprint_id INTEGER NOT NULL REFERENCES style_fingerprints(id),
  status TEXT NOT NULL,              -- 'queued' | 'running' | 'complete' | 'error'
  config_json TEXT NOT NULL,         -- window, budget, constraints
  started_at INTEGER NOT NULL DEFAULT (unixepoch()),
  finished_at INTEGER,
  error TEXT
);

-- Per-run agent events (for stream UI + debugging).
-- run_id is nullable: orphan events (e.g. auto-discover, pre-Run telemetry)
-- log here too without a surrounding Run row.
CREATE TABLE IF NOT EXISTS run_events (
  id INTEGER PRIMARY KEY,
  run_id INTEGER REFERENCES runs(id),
  agent TEXT NOT NULL,
  kind TEXT NOT NULL,                -- 'start' | 'progress' | 'output' | 'error'
  event_id TEXT,                     -- Anthropic sevt_... id; unique when non-null
  payload_json TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
-- INSERT OR IGNORE dedupe on Anthropic event_id
CREATE UNIQUE INDEX IF NOT EXISTS idx_run_events_event_id_unique
  ON run_events(event_id) WHERE event_id IS NOT NULL;

-- Per-run match results
CREATE TABLE IF NOT EXISTS run_matches (
  id INTEGER PRIMARY KEY,
  run_id INTEGER NOT NULL REFERENCES runs(id),
  opportunity_id INTEGER NOT NULL REFERENCES opportunities(id),
  fit_score REAL NOT NULL,
  composite_score REAL,              -- fit × prestige × urgency × affordability (§4.2)
  reasoning TEXT NOT NULL,
  supporting_image_ids TEXT,         -- JSON array of portfolio_images.id
  hurting_image_ids TEXT,
  filtered_out_blurb TEXT,           -- 1-sentence "why not" for dossier filtered section
  included INTEGER NOT NULL,         -- 0 = filtered out (kept with reasoning), 1 = included
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
-- Dedup across agent retries / rephrases
CREATE UNIQUE INDEX IF NOT EXISTS idx_run_matches_dedup
  ON run_matches(run_id, opportunity_id);

-- Per-run cursor for Anthropic event polling (one row per run)
CREATE TABLE IF NOT EXISTS run_event_cursors (
  run_id INTEGER PRIMARY KEY REFERENCES runs(id),
  managed_session_id TEXT NOT NULL,  -- the Anthropic sesn_... ID
  last_event_id TEXT,                -- latest sevt_... we've ingested; NULL on first poll
  phase TEXT NOT NULL DEFAULT 'scout', -- which phase's session this cursor points at
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Drafted materials per match
CREATE TABLE IF NOT EXISTS drafted_packages (
  id INTEGER PRIMARY KEY,
  run_match_id INTEGER NOT NULL REFERENCES run_matches(id),
  artist_statement TEXT,
  project_proposal TEXT,
  cv_formatted TEXT,
  cover_letter TEXT,
  work_sample_selection_json TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
-- Required for Drafter's ON CONFLICT(run_match_id) DO UPDATE re-draft pattern
CREATE UNIQUE INDEX IF NOT EXISTS idx_drafted_packages_match_unique
  ON drafted_packages(run_match_id);

-- Final dossier (one per run)
CREATE TABLE IF NOT EXISTS dossiers (
  id INTEGER PRIMARY KEY,
  run_id INTEGER NOT NULL UNIQUE REFERENCES runs(id),
  cover_narrative TEXT NOT NULL,
  ranking_narrative TEXT NOT NULL,
  pdf_path TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Join table: which opportunities did Scout discover for which run?
-- Populated by persist_opportunity. Opportunities are cross-run in the
-- `opportunities` cache; this scopes them to a specific run.
CREATE TABLE IF NOT EXISTS run_opportunities (
  run_id INTEGER NOT NULL REFERENCES runs(id),
  opportunity_id INTEGER NOT NULL REFERENCES opportunities(id),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (run_id, opportunity_id)
);
CREATE INDEX IF NOT EXISTS idx_run_opportunities_run_id ON run_opportunities(run_id);

-- Migration bookkeeping (kept for historical compat; no files tracked anymore).
CREATE TABLE IF NOT EXISTS _migrations (
  name TEXT PRIMARY KEY,
  applied_at INTEGER NOT NULL DEFAULT (unixepoch())
);
