import { NextRequest, NextResponse } from 'next/server';

// Receives the OAuth code from Google, exchanges it for tokens,
// and displays the new refresh token so you can paste it into Vercel.
export async function GET(req: NextRequest) {
    const code = req.nextUrl.searchParams.get('code');
    const state = req.nextUrl.searchParams.get('state');
    const error = req.nextUrl.searchParams.get('error');

    if (error) {
        return new NextResponse(`OAuth error: ${error}`, { status: 400 });
    }

    if (!state || state !== process.env.CRON_SECRET) {
        return new NextResponse('Invalid state — unauthorized', { status: 401 });
    }

    if (!code) {
        return new NextResponse('Missing code', { status: 400 });
    }

    const clientId = process.env.GMAIL_CLIENT_ID!;
    const clientSecret = process.env.GMAIL_CLIENT_SECRET!;
    const redirectUri = `${req.nextUrl.origin}/api/auth/gmail-callback`;

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            code,
            client_id: clientId,
            client_secret: clientSecret,
            redirect_uri: redirectUri,
            grant_type: 'authorization_code',
        }),
    });

    const tokens = await tokenRes.json();

    if (!tokenRes.ok || !tokens.refresh_token) {
        return new NextResponse(
            `Token exchange failed:\n${JSON.stringify(tokens, null, 2)}\n\n` +
            `Note: refresh_token only appears on first consent. ` +
            `If missing, re-start the flow with prompt=consent (already set).`,
            { status: 500, headers: { 'Content-Type': 'text/plain' } }
        );
    }

    const vercelToken = req.cookies.get('vercel-token')?.value;

    const html = `<!DOCTYPE html>
<html>
<head><title>Gmail OAuth Complete</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 700px; margin: 60px auto; padding: 0 20px; background: #0a0a0a; color: #e5e7eb; }
  h1 { color: #7c3aed; }
  .box { background: #1a1a1a; border: 1px solid #374151; border-radius: 12px; padding: 20px; margin: 20px 0; }
  code { display: block; word-break: break-all; font-size: 13px; color: #4ade80; padding: 12px; background: #0a0a0a; border-radius: 8px; margin: 8px 0; }
  .step { margin: 16px 0; }
  .step strong { color: #f9fafb; }
  .scope { color: #60a5fa; font-size: 13px; }
  button { background: #7c3aed; color: white; border: none; padding: 10px 20px; border-radius: 8px; cursor: pointer; font-size: 14px; }
  button:hover { background: #6d28d9; }
  .success { color: #4ade80; font-weight: bold; font-size: 18px; }
</style>
</head>
<body>
<h1>✓ Gmail OAuth Successful</h1>
<p class="success">New refresh token with gmail.modify scope received!</p>

<div class="box">
  <div class="step"><strong>Scopes granted:</strong></div>
  <div class="scope">${tokens.scope || 'see token'}</div>
</div>

<div class="box">
  <div class="step"><strong>Step 1: Copy this new refresh token</strong></div>
  <code id="rt">${tokens.refresh_token}</code>
  <button onclick="navigator.clipboard.writeText('${tokens.refresh_token}').then(()=>this.textContent='Copied!')">Copy Refresh Token</button>
</div>

<div class="box">
  <div class="step"><strong>Step 2: Update in Vercel</strong></div>
  <p>Go to <a href="https://vercel.com/conexers-projects/kogflow/settings/environment-variables" style="color:#7c3aed" target="_blank">Vercel → kogflow → Environment Variables</a></p>
  <p>Find <code style="display:inline;color:#fbbf24">GMAIL_REFRESH_TOKEN</code> → Edit → paste the new value → Save</p>
  <p>Then redeploy: <code style="display:inline;color:#60a5fa">npx vercel --prod --yes</code></p>
</div>

<div class="box">
  <div class="step"><strong>Access token (short-lived, not needed):</strong></div>
  <code>${tokens.access_token?.slice(0, 40)}...</code>
</div>
</body>
</html>`;

    return new NextResponse(html, {
        headers: { 'Content-Type': 'text/html' },
    });
}
