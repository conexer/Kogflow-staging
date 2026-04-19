import { NextResponse } from 'next/server';
import { loadPipelineConfig, runPipelineSession, logPipelineRun } from '@/app/actions/outreach';

// One session per cron trigger. vercel.json schedules this 3x daily (9am, 1pm, 5pm UTC)
// to match the default sessions_per_day=3 setting. Each session runs independently
// so there are no timeout issues — Vercel kills functions after 60s on Pro / 10s on Hobby.
export async function GET(request: Request) {
    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { config } = await loadPipelineConfig();
    if (!config) return NextResponse.json({ skipped: true, reason: 'No config found' });

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
