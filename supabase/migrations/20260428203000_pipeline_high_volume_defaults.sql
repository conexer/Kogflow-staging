-- Raise the outreach schedule to the requested higher-volume defaults.
ALTER TABLE public.pipeline_config
  ALTER COLUMN sessions_per_day SET DEFAULT 20,
  ALTER COLUMN scrapes_per_session SET DEFAULT 100,
  ALTER COLUMN emails_per_day SET DEFAULT 300;

UPDATE public.pipeline_config
SET sessions_per_day = 20,
    scrapes_per_session = 100,
    emails_per_day = 300,
    cron_enabled = true,
    updated_at = NOW()
WHERE id = 1;
