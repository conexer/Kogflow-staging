import { NextResponse } from 'next/server';
import { sendNextQueuedTCEmail, queueHighScoreTCLeads } from '@/app/actions/outreach-tc';

export const maxDuration = 60;

export async function GET(request: Request) {
    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const url = new URL(request.url);
    const batchSize = Math.min(10, Math.max(1, parseInt(url.searchParams.get('batch') ?? '3', 10)));

    // Top up queue with any new high-score leads before sending
    const queueResult = await queueHighScoreTCLeads(30);

    let totalSent = 0, totalSkipped = 0, totalFailed = 0;
    const errors: string[] = [];
    const debug: string[] = [...queueResult.debug, `Queued ${queueResult.queued} new leads`];

    for (let i = 0; i < batchSize; i++) {
        const result = await sendNextQueuedTCEmail();
        totalSent += result.sent;
        totalSkipped += result.skipped;
        totalFailed += result.failed;
        errors.push(...result.errors);
        debug.push(...result.debug);
        if (result.sent === 0 && result.skipped === 0) break;
    }

    return NextResponse.json({ sent: totalSent, skipped: totalSkipped, failed: totalFailed, errors, debug });
}
