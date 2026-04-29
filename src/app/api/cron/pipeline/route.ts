import { NextResponse } from 'next/server';
import { loadPipelineConfig, runPipelineSession, logPipelineRun, pollAndEmailStagedLeads, scanAndStageHighScoreBacklog, submitStagingBatch, countTodayCronRuns } from '@/app/actions/outreach';
import { createClient } from '@supabase/supabase-js';

export const maxDuration = 300; // Vercel Pro max

// 10 cron entries fire hourly 15–23 UTC plus 00 UTC (8am–5pm Pacific during DST).
// Each trigger: (1) emails leads staged in prior session, (2) scrapes + stages new leads.
export async function GET(request: Request) {
    const functionStart = Date.now();
    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        // Log unauthorized calls to DB so the dashboard can show whether the cron IS firing
        // but failing auth (vs. never being called at all).
        const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
        await supabase.from('pipeline_runs').insert({
            ran_at: new Date().toISOString(),
            processed: 0,
            errors: [`CRON_AUTH_FAIL: header="${(authHeader ?? 'none').slice(0, 40)}" CRON_SECRET_SET=${!!process.env.CRON_SECRET}`],
            trigger: 'cron',
        }).then(null, () => {});
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { config } = await loadPipelineConfig();
    if (!config) {
        await logPipelineRun({ processed: 0, errors: ['No config found'], debug: ['Cron skipped: no pipeline config'], trigger: 'cron' });
        return NextResponse.json({ skipped: true, reason: 'No config found' });
    }

    if (!config.cron_enabled) {
        await logPipelineRun({ processed: 0, errors: [], debug: ['Cron skipped: schedule paused'], trigger: 'cron' });
        return NextResponse.json({ skipped: true, reason: 'Schedule paused' });
    }

    const debug: string[] = [];

    // Step 1: Submit any leads with detected empty rooms to Kie.ai for staging.
    // Runs before poll so staged leads appear in step 2 on the NEXT cron call.
    const stagingBatch = await submitStagingBatch(Math.max(1, Math.min(10, config.emails_per_day)));
    debug.push(`Submit staging batch: ${stagingBatch.submitted} submitted, ${stagingBatch.failed} failed`);
    debug.push(...stagingBatch.errors.map((e) => `Staging batch error: ${e}`));

    // Step 1b: The scraper can save viable high-score leads as scored when staging
    // was missed or deferred. Keep feeding those back into Kie.ai so the email
    // queue does not dry up at "scored".
    const backlog = await scanAndStageHighScoreBacklog(2);
    debug.push(`Backlog staging: ${backlog.staged} staged, ${backlog.skipped} skipped, ${backlog.failed} failed`);
    debug.push(...backlog.errors.map((e) => `Backlog staging error: ${e}`));

    // Step 2: Poll Kie.ai + send emails for leads staged in a previous session.
    // Cap at emails_per_day / sessions_per_day (≈ per-run share), max 20 to stay within 300s budget.
    // With 8s inter-send delay, 20 emails costs at most 160s.
    const emailsPerRun = Math.min(20, Math.max(1, Math.ceil((config.emails_per_day ?? 20) / (config.sessions_per_day ?? 10))));
    const emailResult = await pollAndEmailStagedLeads(emailsPerRun);

    // Step 3: Check if we've already hit today's cron session limit (manual runs don't count).
    const todayCronRuns = await countTodayCronRuns();
    if (todayCronRuns >= config.sessions_per_day) {
        await logPipelineRun({
            processed: 0,
            errors: [],
            debug: [
                ...debug,
                ...emailResult.debug,
                `Cron skipped: already ran ${todayCronRuns} cron sessions today (limit: ${config.sessions_per_day})`,
            ],
            trigger: 'cron',
        });
        return NextResponse.json({
            skipped: true,
            reason: `Already ran ${todayCronRuns} cron sessions today (limit: ${config.sessions_per_day})`,
            emailed: emailResult.emailed,
        });
    }

    // Step 4: Scrape + stage new leads (deadline: 260s from function start, leaving margin for prep + final writes).
    const result = await runPipelineSession({
        cities: config.cities,
        scrapesPerSession: config.scrapes_per_session,
        deadlineMs: functionStart + 260_000,
    });

    // Merge email debug lines into the run log so they appear in the activity log.
    await logPipelineRun({
        ...result,
        debug: [...debug, ...emailResult.debug, ...result.debug],
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
