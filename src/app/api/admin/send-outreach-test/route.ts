import { NextRequest, NextResponse } from 'next/server';
import { sendOutreachEmail } from '@/app/actions/outreach';

const CRON_SECRET = process.env.CRON_SECRET;

export async function POST(req: NextRequest) {
    // Require CRON_SECRET for auth
    const secret = req.headers.get('x-cron-secret');
    if (!CRON_SECRET || secret !== CRON_SECRET) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const body = await req.json();
        const { agentName, agentEmail, address, beforeImageUrl, stagedImageUrl } = body;

        if (!agentEmail || !address || !stagedImageUrl) {
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
        }

        const result = await sendOutreachEmail({
            agentName: agentName || 'Agent',
            agentEmail,
            address,
            beforeImageUrl,
            stagedImageUrl,
            source: 'admin-test',
        });

        if (result.duplicate) {
            return NextResponse.json({ error: result.error, duplicate: true }, { status: 409 });
        }

        if (result.error) {
            return NextResponse.json({ error: result.error }, { status: 500 });
        }

        return NextResponse.json({ success: true, sentTo: agentEmail });
    } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
