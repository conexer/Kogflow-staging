import { after } from 'next/server';
import { NextResponse } from 'next/server';
import { loadTCPipelineConfig, runTCPipelineSession, logTCRun, queueHighScoreTCLeads, sendNextQueuedTCEmail } from '@/app/actions/outreach-tc';

export const maxDuration = 300;

export async function POST(request: Request) {
    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const mode = body.mode ?? 'scrape'; // 'scrape' | 'email' | 'both'

    const { config } = await loadTCPipelineConfig();
    if (!config) return NextResponse.json({ error: 'No config found' }, { status: 400 });

    after(async () => {
        const functionStart = Date.now();
        const debug: string[] = [`Manual run (mode=${mode})`];
        let processed = 0;
        const errors: string[] = [];

        if (mode === 'scrape' || mode === 'both') {
            const sessionBudget = Math.max(60_000, 250_000 - (Date.now() - functionStart));
            const result = await runTCPipelineSession({
                cities: config.cities,
                scrapes: config.scrapes_per_session,
                deadlineMs: Date.now() + sessionBudget,
            });
            processed = result.processed;
            errors.push(...result.errors);
            debug.push(...result.debug);

            const queueResult = await queueHighScoreTCLeads(30);
            debug.push(...queueResult.debug);
            debug.push(`Queued ${queueResult.queued} high-score leads`);
        }

        if (mode === 'email' || mode === 'both') {
            let emailsSent = 0;
            for (let i = 0; i < 5; i++) {
                const result = await sendNextQueuedTCEmail();
                emailsSent += result.sent;
                errors.push(...result.errors);
                debug.push(...result.debug);
                if (result.sent === 0 && result.skipped === 0) break;
            }
            debug.push(`Emails sent: ${emailsSent}`);
        }

        await logTCRun({ processed, errors, debug, trigger: 'manual' });
    });

    return NextResponse.json({ accepted: true, mode }, { status: 202 });
}
