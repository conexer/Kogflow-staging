import { NextResponse } from 'next/server';
import { pollAndQueueStagedLeads } from '@/app/actions/outreach';

export const maxDuration = 120;

export async function GET(request: Request) {
    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const result = await pollAndQueueStagedLeads(20);
    return NextResponse.json(result);
}
