import { NextResponse } from 'next/server';
import { after } from 'next/server';
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

    // Insert an in-progress marker (processed = -1) so getActiveSession can detect running state
    // Try with trigger column first; fall back without it if the column doesn't exist yet
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

    // after() runs AFTER the response is sent — survives page refresh/close
    after(async () => {
        try {
            // Step 1: Submit any queued leads (empty rooms found) to Kie.ai
            await submitStagingBatch(5);

            // Step 2: Email leads whose Kie.ai images are ready from prior sessions
            const emailResult = await pollAndEmailStagedLeads(10);

            // Step 2: Scrape + stage new leads
            const result = await runPipelineSession({ cities, scrapesPerSession, sessionId });

            const allDebug = [...emailResult.debug, ...result.debug];

            if (runId) {
                await supabase
                    .from('pipeline_runs')
                    .update({
                        processed: result.processed,
                        errors: [
                            ...(result.errors || []),
                            ...allDebug.map((d: string) => `LOG:${d}`),
                        ],
                    })
                    .eq('id', runId);
            }
        } catch (err: any) {
            if (runId) {
                await supabase
                    .from('pipeline_runs')
                    .update({ processed: 0, errors: [`Pipeline error: ${err.message}`] })
                    .eq('id', runId);
            }
        }
    });

    return NextResponse.json({ started: true, sessionId, runId });
}
