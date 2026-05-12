import { after } from 'next/server';
import { NextResponse } from 'next/server';
import { loadTCPipelineConfig, runTCPipelineSession, logTCRun, queueHighScoreTCLeads, countTodayTCCronRuns } from '@/app/actions/outreach-tc';
import { createClient } from '@supabase/supabase-js';

export const maxDuration = 300;

export async function GET(request: Request) {
    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
        await supabase.from('tc_pipeline_runs').insert({
            ran_at: new Date().toISOString(),
            processed: 0,
            errors: [`CRON_AUTH_FAIL: header="${(authHeader ?? 'none').slice(0, 40)}"`],
            trigger: 'cron',
        }).then(null, () => {});
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { config } = await loadTCPipelineConfig();
    if (!config) return NextResponse.json({ skipped: true, reason: 'No config found' });
    if (!config.cron_enabled) return NextResponse.json({ skipped: true, reason: 'Schedule paused' });

    after(async () => {
        const functionStart = Date.now();
        const debug: string[] = [];

        // Check session limit BEFORE logging — don't count limit-exceeded checks as real sessions
        const todayCronRuns = await countTodayTCCronRuns();
        if (todayCronRuns >= config.sessions_per_day) return;

        const sessionBudget = Math.max(60_000, 270_000 - (Date.now() - functionStart) - 10_000);
        const result = await runTCPipelineSession({
            cities: config.cities,
            scrapes: config.scrapes_per_session,
            deadlineMs: Date.now() + sessionBudget,
        });

        debug.push(...result.debug);

        // Queue any newly discovered high-score leads
        const queueResult = await queueHighScoreTCLeads(30);
        debug.push(...queueResult.debug);
        debug.push(`Queued ${queueResult.queued} high-score leads`);

        await logTCRun({
            ...result,
            debug,
            trigger: 'cron',
        });
    });

    return NextResponse.json({ accepted: true }, { status: 202 });
}
