import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { loadPipelineConfig, runPipelineSession, logPipelineRun } from '@/app/actions/outreach';

export const maxDuration = 300; // Vercel Pro max

// 10 cron entries fire hourly 13–22 UTC (8am–5pm CDT Houston).
// Each trigger runs one session, but skips if today's run count already reached sessions_per_day.
export async function GET(request: Request) {
    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { config } = await loadPipelineConfig();
    if (!config) return NextResponse.json({ skipped: true, reason: 'No config found' });

    // Count how many sessions have already run today (UTC midnight to now)
    const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const { count } = await supabase
        .from('pipeline_runs')
        .select('*', { count: 'exact', head: true })
        .gte('ran_at', today.toISOString())
        .neq('processed', -1); // exclude in-progress runs

    if ((count ?? 0) >= config.sessions_per_day) {
        return NextResponse.json({ skipped: true, reason: `Already ran ${count} sessions today (limit: ${config.sessions_per_day})` });
    }

    const result = await runPipelineSession({
        cities: config.cities,
        scrapesPerSession: config.scrapes_per_session,
    });

    await logPipelineRun(result);

    return NextResponse.json({
        success: true,
        processed: result.processed,
        errors: result.errors,
    });
}
