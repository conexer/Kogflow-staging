import { NextResponse } from 'next/server';
import { loadPipelineConfig, CRON_RUNS_PER_DAY, runPipelineSession, logPipelineRun, pollAndEmailStagedLeads, submitStagingBatch, countTodayCronRuns } from '@/app/actions/outreach';

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

    if (!config.cron_enabled) {
        return NextResponse.json({ skipped: true, reason: 'Schedule paused' });
    }

    // Step 1: Submit any leads with detected empty rooms to Kie.ai for staging.
    // Runs before poll so staged leads appear in step 2 on the NEXT cron call.
    await submitStagingBatch();

    // Step 2: Poll Kie.ai + send emails for leads staged in a previous session.
    // Per-run limit = emails_per_day ÷ 10 cron slots, capped at 6 (6 × 45s = 270s < 300s Vercel limit).
    const perRun = Math.min(6, Math.max(1, Math.round(config.emails_per_day / CRON_RUNS_PER_DAY)));
    const emailResult = await pollAndEmailStagedLeads(perRun);

    // Step 3: Check if we've already hit today's cron session limit (manual runs don't count).
    const todayCronRuns = await countTodayCronRuns();
    if (todayCronRuns >= config.sessions_per_day) {
        return NextResponse.json({
            skipped: true,
            reason: `Already ran ${todayCronRuns} cron sessions today (limit: ${config.sessions_per_day})`,
            emailed: emailResult.emailed,
        });
    }

    // Step 4: Scrape + stage new leads.
    const result = await runPipelineSession({
        cities: config.cities,
        scrapesPerSession: config.scrapes_per_session,
    });

    // Merge email debug lines into the run log so they appear in the activity log.
    await logPipelineRun({
        ...result,
        debug: [...emailResult.debug, ...result.debug],
        trigger: 'cron',
    });

    return NextResponse.json({
        success: true,
        processed: result.processed,
        emailed: emailResult.emailed,
        stillProcessing: emailResult.stillProcessing,
        errors: result.errors,
    });
}
