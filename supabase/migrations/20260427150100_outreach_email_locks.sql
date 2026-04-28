-- Permanent recipient-level dedupe for outreach.
-- One normalized recipient email can be claimed once, so cron/manual/debug paths
-- cannot send multiple cold emails to the same realtor even if runs overlap.

CREATE TABLE IF NOT EXISTS public.outreach_email_locks (
  normalized_email TEXT PRIMARY KEY CHECK (normalized_email = lower(btrim(normalized_email)) AND normalized_email <> ''),
  agent_email TEXT NOT NULL,
  first_lead_id UUID REFERENCES public.outreach_leads(id) ON DELETE SET NULL,
  first_address TEXT,
  source TEXT NOT NULL DEFAULT 'outreach',
  status TEXT NOT NULL DEFAULT 'claimed',
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ,
  gmail_thread_id TEXT,
  gmail_message_id TEXT,
  failure_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_outreach_email_locks_status ON public.outreach_email_locks (status);
CREATE INDEX IF NOT EXISTS idx_outreach_email_locks_sent_at ON public.outreach_email_locks (sent_at DESC);

ALTER TABLE public.outreach_email_locks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access" ON public.outreach_email_locks;
CREATE POLICY "Service role full access" ON public.outreach_email_locks
  USING (TRUE) WITH CHECK (TRUE);

-- Backfill every recipient that has already been contacted or reserved by the
-- old pipeline. This makes the new guard aware of historical sends immediately.
INSERT INTO public.outreach_email_locks (
  normalized_email,
  agent_email,
  first_lead_id,
  first_address,
  source,
  status,
  claimed_at,
  sent_at,
  gmail_thread_id,
  gmail_message_id
)
SELECT DISTINCT ON (lower(btrim(agent_email)))
  lower(btrim(agent_email)) AS normalized_email,
  btrim(agent_email) AS agent_email,
  id AS first_lead_id,
  address AS first_address,
  'migration-backfill' AS source,
  CASE WHEN status = 'emailed' OR email_sent_at IS NOT NULL THEN 'sent' ELSE 'claimed' END AS status,
  COALESCE(contacted_at, email_sent_at, created_at, NOW()) AS claimed_at,
  CASE WHEN status = 'emailed' OR email_sent_at IS NOT NULL THEN COALESCE(email_sent_at, contacted_at, created_at, NOW()) ELSE NULL END AS sent_at,
  gmail_thread_id,
  gmail_message_id
FROM public.outreach_leads
WHERE agent_email IS NOT NULL
  AND btrim(agent_email) <> ''
  AND (
    status IN ('sending', 'emailed', 'form_filled')
    OR email_sent_at IS NOT NULL
    OR contacted_at IS NOT NULL
  )
ORDER BY
  lower(btrim(agent_email)),
  (status = 'emailed' OR email_sent_at IS NOT NULL) DESC,
  COALESCE(email_sent_at, contacted_at, created_at, NOW()) ASC
ON CONFLICT (normalized_email) DO NOTHING;

-- Move queued duplicates out of the send/stage pipeline now that their
-- recipient is locked. Existing emailed rows stay untouched for reporting.
UPDATE public.outreach_leads AS lead
SET status = 'form_filled'
FROM public.outreach_email_locks AS lock
WHERE lead.agent_email IS NOT NULL
  AND lower(btrim(lead.agent_email)) = lock.normalized_email
  AND lead.status IN ('scraped', 'scored', 'staged', 'sending')
  AND lead.id IS DISTINCT FROM lock.first_lead_id;
