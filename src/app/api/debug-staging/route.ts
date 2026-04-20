import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { submitStagingBatch, pollAndEmailStagedLeads } from '@/app/actions/outreach';

export const maxDuration = 60;

export async function GET() {
    const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Check what leads exist with empty_rooms
    const { data: emptyLeads } = await supabase
        .from('outreach_leads')
        .select('id, address, status, icp_score, empty_rooms, staging_task_id')
        .not('empty_rooms', 'eq', '[]')
        .limit(5);

    // Check staged leads
    const { data: stagedLeads } = await supabase
        .from('outreach_leads')
        .select('id, address, status, staging_task_id')
        .eq('status', 'staged')
        .limit(5);

    // Check env vars
    const kieKey = process.env.KIE_AI_API_KEY;
    const hasKieKey = !!kieKey && kieKey.length > 5;

    // Try submitting one batch
    const batchResult = await submitStagingBatch(1);

    return NextResponse.json({
        env: { hasKieKey, kieKeyPrefix: kieKey?.slice(0, 8) },
        emptyLeadsSample: (emptyLeads || []).map(l => ({
            id: l.id,
            address: l.address,
            status: l.status,
            icp_score: l.icp_score,
            emptyRoomsCount: Array.isArray(l.empty_rooms) ? l.empty_rooms.length : 0,
            emptyRooms: l.empty_rooms,
        })),
        stagedLeads: stagedLeads || [],
        batchResult,
    });
}
