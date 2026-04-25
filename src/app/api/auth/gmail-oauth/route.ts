import { NextRequest, NextResponse } from 'next/server';

// Admin-only: starts the Gmail OAuth flow with gmail.modify scope.
// Visit /api/auth/gmail-oauth?secret=CRON_SECRET to begin re-auth.
export async function GET(req: NextRequest) {
    const secret = req.nextUrl.searchParams.get('secret');
    if (!secret || secret !== process.env.CRON_SECRET) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const clientId = process.env.GMAIL_CLIENT_ID;
    if (!clientId) {
        return NextResponse.json({ error: 'GMAIL_CLIENT_ID not set in Vercel env' }, { status: 500 });
    }

    const redirectUri = `${req.nextUrl.origin}/api/auth/gmail-callback`;
    const scope = [
        'https://www.googleapis.com/auth/gmail.send',
        'https://www.googleapis.com/auth/gmail.modify',
    ].join(' ');

    const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    authUrl.searchParams.set('client_id', clientId);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', scope);
    authUrl.searchParams.set('access_type', 'offline');
    authUrl.searchParams.set('prompt', 'consent');
    authUrl.searchParams.set('state', secret);

    return NextResponse.redirect(authUrl.toString());
}
