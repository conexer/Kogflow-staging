import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { loadPipelineConfig, runPipelineSession, logPipelineRun, pollAndEmailStagedLeads } from '@/app/actions/outreach';

export const maxDuration = 300; // Vercel Pro max

// 10 cron entries fire hourly 13–22 UTC (8am–5pm CDT Houston).
// Each trigger: (1) emails leads staged in prior session, (2) scrapes + stages new leads.
export async function GET(request: Request) {
    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { config } = await loadPipelineConfig();
    if (!config) return NextResponse.json({ skipped: true, reason: 'No config found' });

    const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Step 1: Poll Kie.ai + send emails for leads staged in the previous session.
    // This always runs regardless of sessions_per_day limit.
    const emailResult = await pollAndEmailStagedLeads(10);

    // Step 2: Check if we've already hit today's scrape session limit.
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const { count } = await supabase
        .from('pipeline_runs')
        .select('*', { count: 'exact', head: true })
        .gte('ran_at', today.toISOString())
        .neq('processed', -1); // exclude in-progress runs

    if ((count ?? 0) >= config.sessions_per_day) {
        return NextResponse.json({
            skipped: true,
            reason: `Already ran ${count} sessions today (limit: ${config.sessions_per_day})`,
            emailed: emailResult.emailed,
        });
    }

    // Step 3: Scrape + stage new leads.
    const result = await runPipelineSession({
        cities: config.cities,
        scrapesPerSession: config.scrapes_per_session,
    });

    // Merge email debug lines into the run log so they appear in the activity log.
    await logPipelineRun({
        ...result,
        debug: [...emailResult.debug, ...result.debug],
    });

    return NextResponse.json({
        success: true,
        processed: result.processed,
        emailed: emailResult.emailed,
        stillProcessing: emailResult.stillProcessing,
        errors: result.errors,
    });
}
