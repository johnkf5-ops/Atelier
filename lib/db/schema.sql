-- Atelier — full DDL. Standard SQLite dialect; Turso/LibSQL accepts as-is.
-- Idempotent: safe to run on every boot via lib/db/migrations.ts.

-- Users (single-user v1, but keep the table for future)
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
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

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

-- Past recipients (for Rubric Matcher)
CREATE TABLE IF NOT EXISTS past_recipients (
  id INTEGER PRIMARY KEY,
  opportunity_id INTEGER NOT NULL REFERENCES opportunities(id),
  year INTEGER,
  name TEXT NOT NULL,
  bio_url TEXT,
  portfolio_urls TEXT,               -- JSON array
  notes TEXT,
  fetched_at INTEGER NOT NULL DEFAULT (unixepoch())
);

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
  payload_json TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Per-run match results
CREATE TABLE IF NOT EXISTS run_matches (
  id INTEGER PRIMARY KEY,
  run_id INTEGER NOT NULL REFERENCES runs(id),
  opportunity_id INTEGER NOT NULL REFERENCES opportunities(id),
  fit_score REAL NOT NULL,
  reasoning TEXT NOT NULL,
  supporting_image_ids TEXT,         -- JSON array of portfolio_images.id
  hurting_image_ids TEXT,
  included INTEGER NOT NULL,         -- 0 = filtered out (kept with reasoning), 1 = included
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Per-run cursor for Anthropic event polling (one row per run)
CREATE TABLE IF NOT EXISTS run_event_cursors (
  run_id INTEGER PRIMARY KEY REFERENCES runs(id),
  managed_session_id TEXT NOT NULL,  -- the Anthropic sesn_... ID
  last_event_id TEXT,                -- latest sevt_... we've ingested; NULL on first poll
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

-- Migration tracking — one row per applied migration file, prevents
-- re-running ALTER TABLE statements.
CREATE TABLE IF NOT EXISTS _migrations (
  name TEXT PRIMARY KEY,
  applied_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Seed the singleton user row (single-user v1)
INSERT OR IGNORE INTO users (id, name) VALUES (1, 'John Knopf');
