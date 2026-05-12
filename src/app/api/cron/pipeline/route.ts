import { after } from 'next/server';
import { NextResponse } from 'next/server';
import { loadPipelineConfig, runPipelineSession, logPipelineRun, pollAndQueueStagedLeads, scanAndStageHighScoreBacklog, submitStagingBatch, countTodayCronRuns } from '@/app/actions/outreach';
import { sendNextQueuedTCEmail, queueHighScoreTCLeads } from '@/app/actions/outreach-tc';
import { createClient } from '@supabase/supabase-js';

export const maxDuration = 300; // Vercel Pro max

// Cron fires every 30 minutes from 15:00–00:30 UTC (8am–5:30pm Pacific during DST).
// Returns 202 immediately so cron-job.org (30s timeout) doesn't mark it as failed;
// actual pipeline work runs via after() which continues after the response is sent.
export async function GET(request: Request) {
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

    // Always drain TC email queue on every cron tick, regardless of realtor pipeline state.
    after(async () => {
        await queueHighScoreTCLeads(30);
        await sendNextQueuedTCEmail();
    });

    const { config } = await loadPipelineConfig();
    if (!config) return NextResponse.json({ skipped: true, reason: 'No config found' });
    if (!config.cron_enabled) return NextResponse.json({ skipped: true, reason: 'Schedule paused' });

    // Schedule the long-running work to run after the 202 response is sent.
    // functionStart is captured here so the 270s deadline counts from when actual work begins.
    after(async () => {
        const functionStart = Date.now();
        const debug: string[] = [];

        // Step 1: Submit any leads with detected empty rooms to Kie.ai for staging.
        const stagingBatch = await submitStagingBatch(Math.max(1, Math.min(20, config.emails_per_day)));
        debug.push(`Submit staging batch: ${stagingBatch.submitted} submitted, ${stagingBatch.failed} failed`);
        debug.push(...stagingBatch.errors.map((e) => `Staging batch error: ${e}`));

        // Step 1b: Feed high-score backlog back into Kie.ai so the email queue doesn't dry up.
        // 5 leads × ~15s Zyte = ~75s, leaving ~195s for runPipelineSession.
        const backlog = await scanAndStageHighScoreBacklog(5);
        debug.push(`Backlog staging: ${backlog.staged} staged, ${backlog.skipped} skipped, ${backlog.failed} failed`);
        debug.push(...backlog.errors.map((e) => `Backlog staging error: ${e}`));

        // Step 2: Poll Kie.ai and move ready leads into the durable email queue.
        const queueResult = await pollAndQueueStagedLeads(20);

        // Step 3: Check if we've already hit today's cron session limit (don't log — logging counts as a session).
        const todayCronRuns = await countTodayCronRuns();
        if (todayCronRuns >= config.sessions_per_day) return;

        // Step 4: Scrape + stage new leads.
        // Subtract time already spent on steps 1-3 so the session deadline stays accurate.
        const sessionBudget = Math.max(60_000, 270_000 - (Date.now() - functionStart) - 10_000);
        const result = await runPipelineSession({
            cities: config.cities,
            scrapesPerSession: config.scrapes_per_session,
            deadlineMs: Date.now() + sessionBudget,
        });

        await logPipelineRun({
            ...result,
            debug: [...debug, ...queueResult.debug, ...result.debug],
            trigger: 'cron',
        });
    });

    return NextResponse.json({ accepted: true }, { status: 202 });
}
