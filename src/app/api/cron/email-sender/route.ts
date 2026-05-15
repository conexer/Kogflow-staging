import { NextResponse } from 'next/server';
import { pollAndQueueStagedLeads, sendNextQueuedOutreachEmail } from '@/app/actions/outreach';

export const maxDuration = 60;

export async function GET(request: Request) {
    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const url = new URL(request.url);
    const batchSize = Math.min(20, Math.max(1, parseInt(url.searchParams.get('batch') ?? '5', 10)));

    const queueResult = await pollAndQueueStagedLeads(50);

    let totalSent = 0, totalSkipped = 0, totalFailed = 0;
    const errors: string[] = [];
    const debug: string[] = [];

    for (let i = 0; i < batchSize; i++) {
        const result = await sendNextQueuedOutreachEmail();
        totalSent += result.sent;
        totalSkipped += result.skipped;
        totalFailed += result.failed;
        errors.push(...result.errors);
        debug.push(...result.debug);
        // Stop if daily cap hit or a hard failure — but not just because send_after
        // is in the near future (reason 'No queued email ready' is expected between ticks).
        const cappedOrFailed = result.reason?.includes('cap') || result.failed > 0;
        if (cappedOrFailed) break;
        if (result.sent === 0 && result.skipped === 0 && i > 0) break;
    }

    return NextResponse.json({
        sent: totalSent,
        skipped: totalSkipped,
        failed: totalFailed,
        errors,
        debug,
        queued: queueResult.queued,
        stillProcessing: queueResult.stillProcessing,
        queueDebug: queueResult.debug,
    });
}
