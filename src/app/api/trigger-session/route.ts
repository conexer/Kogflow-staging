import { NextResponse } from 'next/server';
import { runPipelineSession, pollAndEmailStagedLeads, submitStagingBatch } from '@/app/actions/outreach';
import { createClient } from '@supabase/supabase-js';

// Vercel Pro max serverless duration — pipeline must complete within 5 min
export const maxDuration = 300;

export async function POST(request: Request) {
    const { cities, scrapesPerSession, sessionId } = await request.json();

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
        // Step 1: Retry any leads that have empty_rooms saved but weren't submitted to Kie.ai
        await submitStagingBatch();

        // Step 2: Poll Kie.ai for leads staged in previous sessions and email the ready ones
        // Limit 50 so no backlog accumulates across sessions
        const emailResult = await pollAndEmailStagedLeads();
        await logToSession(emailResult.debug);

        // Step 3: Scrape + score + stage new leads
        const result = await runPipelineSession({ cities, scrapesPerSession, sessionId });

        if (runId) {
            await supabase
                .from('pipeline_runs')
                .update({
                    processed: result.processed,
                    errors: [
                        ...(result.errors || []),
                        ...emailResult.debug.map((d: string) => `LOG:${d}`),
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
            emailed: emailResult.emailed,
            stillProcessing: emailResult.stillProcessing,
            errors: result.errors,
        });
    } catch (err: any) {
        if (runId) {
            await supabase
                .from('pipeline_runs')
                .update({ processed: 0, errors: [`Pipeline error: ${err.message}`] })
                .eq('id', runId);
        }
        return NextResponse.json({ error: err.message || 'Pipeline failed', sessionId, runId }, { status: 500 });
    }
}
