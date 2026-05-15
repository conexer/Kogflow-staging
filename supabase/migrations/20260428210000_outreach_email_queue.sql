-- Durable queue for outreach emails that are fully ready to send.
-- The sender claims one queued row at a time, sends it, and exits.

CREATE TABLE IF NOT EXISTS public.outreach_email_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES public.outreach_leads(id) ON DELETE CASCADE,
  normalized_email TEXT NOT NULL CHECK (normalized_email = lower(btrim(normalized_email)) AND normalized_email <> ''),
  agent_email TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sending', 'sent', 'failed', 'skipped')),
  source TEXT NOT NULL DEFAULT 'pipeline',
  ready_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  send_after TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_outreach_email_queue_lead_id
  ON public.outreach_email_queue (lead_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_outreach_email_queue_active_recipient
  ON public.outreach_email_queue (normalized_email)
  WHERE status IN ('queued', 'sending', 'sent');

CREATE INDEX IF NOT EXISTS idx_outreach_email_queue_ready
  ON public.outreach_email_queue (send_after, ready_at)
  WHERE status = 'queued';

CREATE INDEX IF NOT EXISTS idx_outreach_email_queue_sent_at
  ON public.outreach_email_queue (sent_at DESC)
  WHERE status = 'sent';

ALTER TABLE public.outreach_email_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access" ON public.outreach_email_queue;
CREATE POLICY "Service role full access" ON public.outreach_email_queue
  USING (TRUE) WITH CHECK (TRUE);

CREATE OR REPLACE FUNCTION public.claim_next_outreach_email_queue_item()
RETURNS SETOF public.outreach_email_queue
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH next_item AS (
    SELECT id
    FROM public.outreach_email_queue
    WHERE status = 'queued'
      AND send_after <= NOW()
    ORDER BY send_after ASC, ready_at ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.outreach_email_queue queue
  SET status = 'sending',
      locked_at = NOW(),
      attempts = queue.attempts + 1,
      updated_at = NOW()
  FROM next_item
  WHERE queue.id = next_item.id
  RETURNING queue.*;
END;
$$;
