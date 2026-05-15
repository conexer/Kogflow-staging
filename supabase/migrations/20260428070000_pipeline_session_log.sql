-- Real-time session log for the Outreach dashboard Activity Log.
-- Manual and cron sessions stream progress here while they run.

CREATE TABLE IF NOT EXISTS public.pipeline_session_log (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id TEXT NOT NULL,
  logged_at TIMESTAMPTZ DEFAULT NOW(),
  message TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pipeline_session_log
  ON public.pipeline_session_log (session_id, logged_at);

ALTER TABLE public.pipeline_session_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access" ON public.pipeline_session_log;
CREATE POLICY "Service role full access" ON public.pipeline_session_log
  USING (TRUE) WITH CHECK (TRUE);
