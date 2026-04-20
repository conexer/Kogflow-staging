import { NextResponse } from 'next/server';
import { after } from 'next/server';
import { runPipelineSession } from '@/app/actions/outreach';
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
    const { data: pendingRun } = await supabase
        .from('pipeline_runs')
        .insert({
            ran_at: new Date().toISOString(),
            processed: -1,
            errors: [`LOG:Session ${sessionId} starting...`],
        })
        .select()
        .single();

    const runId = pendingRun?.id;

    // after() runs AFTER the response is sent — survives page refresh/close
    after(async () => {
        try {
            const result = await runPipelineSession({ cities, scrapesPerSession, sessionId });

            if (runId) {
                await supabase
                    .from('pipeline_runs')
                    .update({
                        processed: result.processed,
                        errors: [
                            ...(result.errors || []),
                            ...(result.debug || []).map((d: string) => `LOG:${d}`),
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
