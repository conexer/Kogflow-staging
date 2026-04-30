import { NextResponse } from 'next/server';
import { runPipelineSession, pollAndQueueStagedLeads, submitStagingBatch, loadPipelineConfig } from '@/app/actions/outreach';
import { createClient } from '@supabase/supabase-js';

// Vercel Pro max serverless duration — pipeline must complete within 5 min
export const maxDuration = 300;

export async function POST(request: Request) {
    const functionStart = Date.now();
    const { cities, scrapesPerSession, sessionId, skipPrep } = await request.json();

    if (!cities?.length) {
        return NextResponse.json({ error: 'No cities provided' }, { status: 400 });
    }

    const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    let pendingRun: any = null;
    const baseRow = { ran_at: new Date().toISOString(), processed: -1, errors: [`LOG:Session ${sessionId} starting...`] };
    const { data: d1, error: e1 } = await supabase.from('pipeline_runs').insert({ ...baseRow, trigger: 'manual' }).select().single();
    if (e1?.message?.includes('trigger')) {
        const { data: d2 } = await supabase.from('pipeline_runs').insert(baseRow).select().single();
        pendingRun = d2;
    } else {
        pendingRun = d1;
    }

    const runId = pendingRun?.id;

    // Writes messages to pipeline_session_log so they appear in the UI activity log
    const logToSession = async (messages: string[]) => {
        if (!messages.length) return;
        await supabase.from('pipeline_session_log').insert(
            messages.map(message => ({ session_id: sessionId, message }))
        ).then(null, () => {});
    };

    try {
        const { config: cfg } = await loadPipelineConfig();
        let queueResult = { queued: 0, stillProcessing: 0, failed: 0, errors: [] as string[], debug: [] as string[] };

        if (!skipPrep) {
            // Step 1: Retry leads that are ready for staging but never reached Kie.ai.
            const stagingResult = await submitStagingBatch(Math.max(1, Math.min(20, cfg?.emails_per_day ?? 300)));
            await logToSession([
                `Submit staging batch: ${stagingResult.submitted} submitted, ${stagingResult.failed} failed`,
                ...stagingResult.errors.map((e) => `Staging batch error: ${e}`),
            ]);

            // Step 2: Poll Kie.ai for leads staged in previous sessions and queue the ready ones.
            queueResult = await pollAndQueueStagedLeads(20);
            await logToSession(queueResult.debug);
        } else {
            await logToSession(['Skipped prep: staging backlog and poll/email disabled for this manual run']);
        }

        // Step 3: Scrape + score + stage new leads (deadline: 260s from function start, leaving margin for prep + final writes)
        const result = await runPipelineSession({ cities, scrapesPerSession, sessionId, deadlineMs: functionStart + 230_000 });

        if (runId) {
            await supabase
                .from('pipeline_runs')
                .update({
                    processed: result.processed,
                    errors: [
                        ...(result.errors || []),
                        ...queueResult.debug.map((d: string) => `LOG:${d}`),
                        ...result.debug.map((d: string) => `LOG:${d}`),
                    ],
                })
                .eq('id', runId);
        }

        return NextResponse.json({
            started: true,
            completed: true,
            sessionId,
            runId,
            processed: result.processed,
            queued: queueResult.queued,
            stillProcessing: queueResult.stillProcessing,
            errors: result.errors,
        });
    } catch (err: any) {
        await supabase.from('pipeline_session_log').insert({ session_id: sessionId, message: '__SESSION_COMPLETE__' }).then(null, () => {});
        if (runId) {
            await supabase
                .from('pipeline_runs')
                .update({ processed: 0, errors: [`Pipeline error: ${err.message}`] })
                .eq('id', runId);
        }
        return NextResponse.json({ error: err.message || 'Pipeline failed', sessionId, runId }, { status: 500 });
    }
}
