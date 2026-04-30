-- Add missing columns to pipeline_config that the app expects but were never created.
-- emails_per_day controls how many emails the cron sends per day (spread across 10 hourly slots).
-- cron_enabled pauses/resumes the automated pipeline schedule.
ALTER TABLE pipeline_config
  ADD COLUMN IF NOT EXISTS emails_per_day integer DEFAULT 300,
  ADD COLUMN IF NOT EXISTS cron_enabled boolean DEFAULT true;

-- Apply the intended high-volume schedule defaults.
UPDATE pipeline_config
SET sessions_per_day = 20,
    scrapes_per_session = 100,
    emails_per_day = 300,
    cron_enabled = true
WHERE id = 1;
