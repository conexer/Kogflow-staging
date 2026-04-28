-- Add missing columns to pipeline_config that the app expects but were never created.
-- emails_per_day controls how many emails the cron sends per day (spread across 10 hourly slots).
-- cron_enabled pauses/resumes the automated pipeline schedule.
ALTER TABLE pipeline_config
  ADD COLUMN IF NOT EXISTS emails_per_day integer DEFAULT 10,
  ADD COLUMN IF NOT EXISTS cron_enabled boolean DEFAULT true;

-- Apply the user's intended setting of 50 emails/day.
UPDATE pipeline_config SET emails_per_day = 50, cron_enabled = true WHERE id = 1;
