import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { checkStagingResult, detectRoom, pollAndQueueStagedLeads } from '@/app/actions/outreach';

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const runId = searchParams.get('runId');
    const action = searchParams.get('action');

    const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // action=verify-emailed: Moondream-verify the before image for every emailed lead
    if (action === 'verify-emailed') {
        const { data, error } = await supabase
            .from('outreach_leads')
            .select('id, address, agent_email, empty_rooms, staging_task_id')
            .eq('status', 'emailed')
            .order('created_at', { ascending: false })
            .limit(10);
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });

        const results = [];
        for (const lead of (data || [])) {
            const beforeUrl: string = lead.empty_rooms?.[0]?.imageUrl || null;
            const stagedUrl: string = lead.empty_rooms?.[0]?.stagedUrl || null;
            let moondream = null;
            if (beforeUrl) {
                const r = await detectRoom(beforeUrl);
                moondream = {
                    isEmpty: r.isEmpty,
                    isInterior: r.isInterior,
                    isExterior: r.isExterior,
                    roomType: r.roomType,
                    verdict: (r.isEmpty || r.isInterior) ? 'INTERIOR ✓' : 'EXTERIOR ✗',
                };
            }
            results.push({
                address: lead.address,
                agentEmail: lead.agent_email,
                beforeImageUrl: beforeUrl,
                stagedImageUrl: stagedUrl,
                moondream,
            });
        }
        return NextResponse.json({ count: results.length, results });
    }

    // action=staged-report: check all staged leads, verify before images
    if (action === 'staged-report') {
        const { data, error } = await supabase
            .from('outreach_leads')
            .select('id, address, staging_task_id, empty_rooms, agent_email, agent_name')
            .eq('status', 'staged')
            .not('staging_task_id', 'is', null)
            .limit(10);
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });

        const report = [];
        for (const lead of (data || [])) {
            const beforeUrl: string = lead.empty_rooms?.[0]?.imageUrl || null;
            const stagingResult = await checkStagingResult(lead.staging_task_id);
            let beforeCheck = null;
            if (beforeUrl) {
                const r = await detectRoom(beforeUrl);
                beforeCheck = { isEmpty: r.isEmpty, isInterior: r.isInterior, isExterior: r.isExterior, roomType: r.roomType, verdict: (r.isEmpty || r.isInterior) ? 'INTERIOR ✓' : 'EXTERIOR ✗' };
            }
            report.push({ address: lead.address, agentEmail: lead.agent_email, stagingStatus: stagingResult.status, stagedImageUrl: stagingResult.url || null, beforeImageUrl: beforeUrl, beforeCheck });
        }
        return NextResponse.json({ leads: report, count: report.length });
    }

    // action=poll-email: poll Kie.ai and queue ready emails
    if (action === 'poll-email') {
        const result = await pollAndQueueStagedLeads(10);
        return NextResponse.json(result);
    }

    // action=all-leads: show all leads and their statuses
    if (action === 'all-leads') {
        const { data, error } = await supabase
            .from('outreach_leads')
            .select('id, address, status, staging_task_id, empty_rooms, agent_email')
            .order('created_at', { ascending: false })
            .limit(20);
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        return NextResponse.json({ leads: data, count: data?.length });
    }

    if (runId) {
        const { data, error } = await supabase
            .from('pipeline_runs')
            .select('processed, errors, ran_at')
            .eq('id', runId)
            .single();
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        const logs = (data?.errors || []).filter((e: string) => e.startsWith('LOG:')).map((e: string) => e.slice(4));
        const errors = (data?.errors || []).filter((e: string) => !e.startsWith('LOG:'));
        return NextResponse.json({ processed: data?.processed, logs, errors, ran_at: data?.ran_at });
    }

    return NextResponse.json({ error: 'Provide action= or runId' }, { status: 400 });
}
