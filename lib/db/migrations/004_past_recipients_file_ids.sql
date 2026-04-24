-- Migration 004: past_recipients.file_ids — JSON array of Anthropic Files API
-- IDs aligned position-wise with portfolio_urls. Populated by finalize-scout
-- alongside the Vercel Blob mirror. Used by start-rubric to build a
-- resources[] array for sessions.create — pre-mounting the images as files
-- the Rubric Matcher can read via mount_path, avoiding the bash+curl+/tmp
-- pattern that trips Anthropic's malware-analysis safety layer.
ALTER TABLE past_recipients ADD COLUMN file_ids TEXT;
