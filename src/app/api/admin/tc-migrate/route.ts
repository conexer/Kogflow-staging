import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const maxDuration = 60;

const STATEMENTS = [
    `CREATE TABLE IF NOT EXISTS public.tc_leads (id UUID DEFAULT gen_random_uuid() PRIMARY KEY, company_name TEXT, owner_name TEXT, contact_name TEXT, email TEXT, normalized_email TEXT, phone TEXT, website_url TEXT, source_url TEXT, city TEXT, state TEXT, address TEXT, description TEXT, services TEXT[] DEFAULT '{}', states_served TEXT[] DEFAULT '{}', years_in_business TEXT, team_size INTEGER, review_count INTEGER, rating NUMERIC, icp_score INTEGER DEFAULT 0, status TEXT DEFAULT 'new', email_sent_at TIMESTAMPTZ, gmail_message_id TEXT, gmail_thread_id TEXT, scraped_at TIMESTAMPTZ DEFAULT NOW(), created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE INDEX IF NOT EXISTS idx_tc_leads_score ON public.tc_leads (icp_score DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_tc_leads_status ON public.tc_leads (status)`,
    `CREATE INDEX IF NOT EXISTS idx_tc_leads_normalized_email ON public.tc_leads (normalized_email)`,
    `ALTER TABLE public.tc_leads ENABLE ROW LEVEL SECURITY`,
    `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='tc_leads' AND policyname='Service role full access') THEN CREATE POLICY "Service role full access" ON public.tc_leads USING (TRUE) WITH CHECK (TRUE); END IF; END $$`,
    `CREATE TABLE IF NOT EXISTS public.tc_email_queue (id UUID DEFAULT gen_random_uuid() PRIMARY KEY, lead_id UUID REFERENCES public.tc_leads(id) ON DELETE CASCADE, normalized_email TEXT NOT NULL, agent_email TEXT NOT NULL, status TEXT DEFAULT 'queued', attempts INTEGER DEFAULT 0, send_after TIMESTAMPTZ DEFAULT NOW(), locked_at TIMESTAMPTZ, sent_at TIMESTAMPTZ, last_error TEXT, source TEXT DEFAULT 'pipeline', ready_at TIMESTAMPTZ DEFAULT NOW(), created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE INDEX IF NOT EXISTS idx_tc_email_queue_status ON public.tc_email_queue (status, send_after)`,
    `ALTER TABLE public.tc_email_queue ENABLE ROW LEVEL SECURITY`,
    `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='tc_email_queue' AND policyname='Service role full access') THEN CREATE POLICY "Service role full access" ON public.tc_email_queue USING (TRUE) WITH CHECK (TRUE); END IF; END $$`,
    `CREATE TABLE IF NOT EXISTS public.tc_pipeline_runs (id UUID DEFAULT gen_random_uuid() PRIMARY KEY, ran_at TIMESTAMPTZ DEFAULT NOW(), processed INTEGER DEFAULT 0, emails_sent INTEGER DEFAULT 0, errors TEXT[] DEFAULT '{}', debug TEXT[] DEFAULT '{}', trigger TEXT DEFAULT 'cron')`,
    `ALTER TABLE public.tc_pipeline_runs ENABLE ROW LEVEL SECURITY`,
    `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='tc_pipeline_runs' AND policyname='Service role full access') THEN CREATE POLICY "Service role full access" ON public.tc_pipeline_runs USING (TRUE) WITH CHECK (TRUE); END IF; END $$`,
    `CREATE TABLE IF NOT EXISTS public.tc_pipeline_config (id INTEGER PRIMARY KEY DEFAULT 1, cities TEXT[] DEFAULT ARRAY['Houston, TX','Dallas, TX','Austin, TX','San Antonio, TX','Fort Worth, TX','Phoenix, AZ','Las Vegas, NV','Denver, CO','Atlanta, GA','Charlotte, NC','Nashville, TN','Tampa, FL','Orlando, FL','Raleigh, NC','Jacksonville, FL','Miami, FL','Seattle, WA','Portland, OR','Sacramento, CA','Kansas City, MO','Columbus, OH','Indianapolis, IN'], emails_per_day INTEGER DEFAULT 30, sessions_per_day INTEGER DEFAULT 4, scrapes_per_session INTEGER DEFAULT 6, cron_enabled BOOLEAN DEFAULT FALSE, updated_at TIMESTAMPTZ DEFAULT NOW())`,
    `ALTER TABLE public.tc_pipeline_config ENABLE ROW LEVEL SECURITY`,
    `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='tc_pipeline_config' AND policyname='Service role full access') THEN CREATE POLICY "Service role full access" ON public.tc_pipeline_config USING (TRUE) WITH CHECK (TRUE); END IF; END $$`,
    `INSERT INTO public.tc_pipeline_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING`,
    `CREATE TABLE IF NOT EXISTS public.tc_recipient_locks (normalized_email TEXT PRIMARY KEY, lead_id UUID REFERENCES public.tc_leads(id) ON DELETE SET NULL, sent_at TIMESTAMPTZ DEFAULT NOW())`,
    `ALTER TABLE public.tc_recipient_locks ENABLE ROW LEVEL SECURITY`,
    `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='tc_recipient_locks' AND policyname='Service role full access') THEN CREATE POLICY "Service role full access" ON public.tc_recipient_locks USING (TRUE) WITH CHECK (TRUE); END IF; END $$`,
    `CREATE TABLE IF NOT EXISTS public.tc_city_log (city TEXT PRIMARY KEY, last_scraped_at TIMESTAMPTZ DEFAULT NOW(), leads_found INTEGER DEFAULT 0)`,
    `ALTER TABLE public.tc_city_log ENABLE ROW LEVEL SECURITY`,
    `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='tc_city_log' AND policyname='Service role full access') THEN CREATE POLICY "Service role full access" ON public.tc_city_log USING (TRUE) WITH CHECK (TRUE); END IF; END $$`,
    `CREATE OR REPLACE FUNCTION claim_next_tc_email_queue_item() RETURNS SETOF tc_email_queue LANGUAGE plpgsql AS $func$ DECLARE v_row tc_email_queue; BEGIN SELECT * INTO v_row FROM tc_email_queue WHERE status = 'queued' AND send_after <= NOW() ORDER BY (SELECT icp_score FROM tc_leads WHERE id = lead_id) DESC NULLS LAST, ready_at ASC LIMIT 1 FOR UPDATE SKIP LOCKED; IF v_row.id IS NULL THEN RETURN; END IF; UPDATE tc_email_queue SET status = 'sending', locked_at = NOW(), attempts = attempts + 1, updated_at = NOW() WHERE id = v_row.id; RETURN QUERY SELECT * FROM tc_email_queue WHERE id = v_row.id; END $func$`,
];

export async function GET(req: Request) {
    const auth = req.headers.get('authorization');
    if (auth !== `Bearer ${process.env.CRON_SECRET}`) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const results: string[] = [];

    for (const sql of STATEMENTS) {
        const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/exec`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY!,
                'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY!}`,
            },
            body: JSON.stringify({ query: sql }),
        });
        results.push(sql.substring(0, 60) + '... => ' + (res.ok ? 'ok' : 'err ' + res.status));
    }

    const { data: tables } = await supabase.from('tc_leads').select('id').limit(1);
    const { data: config } = await supabase.from('tc_pipeline_config').select('id').limit(1);

    return NextResponse.json({ results, tc_leads_accessible: !!tables, config_accessible: !!config });
}
