-- Migration 003: drafted_packages UNIQUE on run_match_id.
-- Required for the Drafter's ON CONFLICT(run_match_id) DO UPDATE pattern —
-- re-drafting the same match (e.g. after a skill-file or fingerprint fix)
-- should overwrite the prior row, not append duplicates.
CREATE UNIQUE INDEX IF NOT EXISTS idx_drafted_packages_match_unique
  ON drafted_packages(run_match_id);
