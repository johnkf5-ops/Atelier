-- Migration 002: Phase 4 schema prep (dossier scoring + logo cache).
-- Split from 001 because 001 already applied in some environments.

-- run_matches gets composite_score (fit × prestige × urgency × affordability,
-- per §4.2) and filtered_out_blurb (one-sentence "why not" for the dossier's
-- rejected-opportunities section).
ALTER TABLE run_matches ADD COLUMN composite_score REAL;
ALTER TABLE run_matches ADD COLUMN filtered_out_blurb TEXT;

-- opportunity_logos cache. Scraped via og:image / favicon; keyed per
-- opportunity so dossier renders don't re-fetch each time.
CREATE TABLE IF NOT EXISTS opportunity_logos (
  opportunity_id INTEGER PRIMARY KEY REFERENCES opportunities(id),
  logo_url TEXT,
  fetched_at INTEGER NOT NULL DEFAULT (unixepoch())
);
