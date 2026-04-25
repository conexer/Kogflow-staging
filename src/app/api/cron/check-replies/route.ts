import { NextResponse } from 'next/server';
import { checkAndReplyToOutreach } from '@/app/actions/outreach';

export const maxDuration = 60;

// Fires every 30 min to check for replies to outreach emails and respond with AI.
export async function GET(request: Request) {
    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const result = await checkAndReplyToOutreach();

    return NextResponse.json({
        checked: result.checked,
        replied: result.replied,
        debug: result.debug,
    });
}
