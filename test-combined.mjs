import { chromium } from 'playwright';
import { readFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';

readFileSync('.env.local', 'utf8').split('\n').forEach(l => {
    const [k, ...v] = l.split('=');
    if (k) process.env[k.trim()] = v.join('=').trim();
});

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const KIE_API_KEY = process.env.KIE_AI_API_KEY;
const MOONDREAM_API_KEY = process.env.MOONDREAM_API_KEY;
const GMAIL_CLIENT_ID = process.env.GMAIL_CLIENT_ID;
const GMAIL_CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET;
const GMAIL_REFRESH_TOKEN = process.env.GMAIL_REFRESH_TOKEN;

// ── HAR photos ────────────────────────────────────────────────────────────────
async function getHarPhotos(url, max = 5) {
    try {
        const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Accept': 'text/html' } });
        if (!res.ok) return [];
        const html = await res.text();
        return [...new Set([...html.matchAll(/https:\/\/mediahar\.harstatic\.com\/[^"'\s]+\/lr\/[^"'\s]+\.jpeg/g)].map(m => m[0]))].slice(0, max);
    } catch { return []; }
}

// ── Moondream ─────────────────────────────────────────────────────────────────
async function detectRoom(imageUrl) {
    try {
        const imgRes = await fetch(imageUrl, { headers: { 'Referer': new URL(imageUrl).origin, 'User-Agent': 'Mozilla/5.0', 'Accept': 'image/*' } });
        if (!imgRes.ok) return { isEmpty: false, error: `img ${imgRes.status}` };
        const b64 = Buffer.from(await imgRes.arrayBuffer()).toString('base64');
        const ct = imgRes.headers.get('content-type') || 'image/jpeg';
        const res = await fetch('https://api.moondream.ai/v1/query', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${MOONDREAM_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ image: `data:${ct};base64,${b64}`, question: 'What furniture and objects do you see in this room? Be specific and list every item you can see.', stream: false }),
        });
        if (!res.ok) return { isEmpty: false, error: `moondream ${res.status}` };
        const data = await res.json();
        const answer = (data.answer || '').toLowerCase();
        const FURNITURE = ['sofa','couch','chair','table','bed','desk','dresser','cabinet','shelf','bookshelf','wardrobe','television','tv','lamp','rug','carpet','curtain','blinds','artwork','picture','mirror','stove','refrigerator','fridge','dishwasher','sink','toilet','bathtub','shower','vanity','counter','island','fireplace'];
        const EMPTY = ['empty room','no furniture','bare','unfurnished','vacant','nothing in','no objects','no items','does not contain any','there is nothing','no visible furniture','appears to be empty','room is empty'];
        const isEmpty = !FURNITURE.some(k => answer.includes(k)) && EMPTY.some(k => answer.includes(k));
        const roomType = answer.includes('bedroom') ? 'bedroom' : answer.includes('living') ? 'living room' : answer.includes('kitchen') ? 'kitchen' : answer.includes('dining') ? 'dining room' : answer.includes('bathroom') ? 'bathroom' : 'room';
        return { isEmpty, roomType, answer: answer.slice(0, 120) };
    } catch (e) { return { isEmpty: false, error: e.message }; }
}

// ── Kie.ai ────────────────────────────────────────────────────────────────────
async function stageRoom(imageUrl, roomType) {
    const prompt = `Add fully furnished ${roomType} decor in modern contemporary style. Keep all structural elements identical. High quality photorealistic real estate photography.`;
    const res = await fetch('https://api.kie.ai/api/v1/jobs/createTask', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${KIE_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'google/nano-banana-edit', input: { prompt, image_input: [imageUrl], aspect_ratio: 'auto' } }),
    });
    const data = await res.json();
    if (!res.ok || (data.code && data.code !== 200)) return { error: data.msg || `kie ${res.status}` };
    const taskId = data.data?.taskId;
    if (!taskId) return { error: `no taskId` };
    return { taskId };
}

async function pollKie(taskId) {
    const res = await fetch(`https://api.kie.ai/api/v1/jobs/recordInfo?taskId=${taskId}`, { headers: { 'Authorization': `Bearer ${KIE_API_KEY}` } });
    if (!res.ok) return { status: 'error' };
    const data = await res.json();
    const state = data.data?.state;
    if (state === 'success') return { status: 'success', url: JSON.parse(data.data.resultJson || '{}').resultUrls?.[0] };
    if (state === 'failed') return { status: 'failed', error: data.data?.failMsg };
    return { status: 'processing' };
}

// ── Gmail ─────────────────────────────────────────────────────────────────────
async function sendEmail(lead, stagedUrl, beforeUrl) {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: GMAIL_CLIENT_ID, client_secret: GMAIL_CLIENT_SECRET, refresh_token: GMAIL_REFRESH_TOKEN, grant_type: 'refresh_token' }),
    });
    const { access_token } = await tokenRes.json();
    if (!access_token) throw new Error('Token refresh failed');

    const subject = `Free virtual staging sample for your listing at ${lead.address}`;
    const imagesHtml = stagedUrl ? `
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0;">
      <tr><td align="center" style="padding:0 0 12px 0;">
        <p style="margin:0 0 6px 0;font-size:13px;color:#666;font-weight:600;text-transform:uppercase;letter-spacing:1px;">BEFORE</p>
        ${beforeUrl ? `<img src="${beforeUrl}" alt="Before" width="540" style="display:block;width:100%;max-width:540px;height:auto;border-radius:6px;border:1px solid #e5e7eb;" />` : ''}
      </td></tr>
      <tr><td align="center">
        <p style="margin:0 0 6px 0;font-size:13px;color:#7c3aed;font-weight:600;text-transform:uppercase;letter-spacing:1px;">VIRTUALLY STAGED BY KOGFLOW</p>
        <img src="${stagedUrl}" alt="Virtually staged" width="540" style="display:block;width:100%;max-width:540px;height:auto;border-radius:6px;border:2px solid #7c3aed;" />
      </td></tr>
    </table>` : '';

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:0;background:#f9fafb;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;padding:32px 16px;"><tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;max-width:600px;width:100%;overflow:hidden;">
      <tr><td style="background:#7c3aed;padding:20px 32px;"><p style="margin:0;color:#fff;font-size:20px;font-weight:700;">Kogflow</p><p style="margin:4px 0 0;color:#ede9fe;font-size:13px;">AI Virtual Staging</p></td></tr>
      <tr><td style="padding:32px;">
        <p style="margin:0 0 16px;font-size:16px;color:#111827;">Hi ${lead.agent_name || 'there'},</p>
        <p style="margin:0 0 16px;font-size:15px;color:#374151;line-height:1.6;">I noticed your listing at <strong>${lead.address}</strong> and took the liberty of virtually staging one of the empty rooms as a free preview.</p>
        ${imagesHtml}
        <p style="margin:16px 0;font-size:15px;color:#374151;line-height:1.6;">Virtual staging helps buyers visualize the space and typically leads to faster sales and stronger offers. We do it in seconds at <a href="https://kogflow.com" style="color:#7c3aed;">Kogflow.com</a>.</p>
        <p style="margin:0 0 16px;font-size:15px;color:#374151;line-height:1.6;">We can also turn these virtually staged rooms into <strong>virtual video walkthroughs</strong> -- giving buyers an immersive tour experience without stepping foot in the property.</p>
        <p style="margin:0 0 24px;font-size:15px;color:#374151;line-height:1.6;">Happy to send a few more free samples if you're interested.</p>
        <table cellpadding="0" cellspacing="0" style="margin:0 0 24px;"><tr><td style="background:#7c3aed;border-radius:8px;padding:12px 24px;">
          <a href="https://kogflow.com" style="color:#fff;font-size:15px;font-weight:600;text-decoration:none;">See More Examples</a>
        </td></tr></table>
        <p style="margin:0;font-size:15px;color:#374151;">Best,<br><strong>Minh</strong><br><a href="https://kogflow.com" style="color:#7c3aed;">Kogflow.com</a></p>
      </td></tr>
      <tr><td style="background:#f3f4f6;padding:16px 32px;"><p style="margin:0;font-size:12px;color:#9ca3af;">To unsubscribe reply with "unsubscribe".</p></td></tr>
    </table>
  </td></tr></table>
</body></html>`;

    const msg = [`From: Kogflow <kogflow.media@gmail.com>`, `To: ${lead.agent_email}`, `Subject: ${subject}`, `MIME-Version: 1.0`, `Content-Type: text/html; charset=utf-8`, ``, html].join('\r\n');
    const encoded = Buffer.from(msg).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const sendRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
        method: 'POST', headers: { 'Authorization': `Bearer ${access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ raw: encoded }),
    });
    if (!sendRes.ok) throw new Error(`Gmail ${sendRes.status}: ${(await sendRes.text()).slice(0, 200)}`);
    return true;
}

// ── Main ──────────────────────────────────────────────────────────────────────
(async () => {
    console.log('\n══════════════════════════════════════════');
    console.log('  KOGFLOW FULL PIPELINE TEST');
    console.log('══════════════════════════════════════════\n');

    // ── Step 1: Browser session to scrape new leads ──────────────────────────
    console.log('STEP 1: Running pipeline session via browser to scrape new leads...');
    const { data: linkData } = await sb.auth.admin.generateLink({ type: 'magiclink', email: 'conexer@gmail.com', options: { redirectTo: 'http://localhost:3000/outreach' } });
    const magicLink = linkData?.properties?.action_link;

    const browser = await chromium.launch({ headless: false, slowMo: 60 });
    const page = await browser.newPage();
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.goto(magicLink);
    await page.waitForURL('**/outreach**', { timeout: 15000 });
    await page.waitForLoadState('networkidle');
    console.log('  ✓ Signed in\n');

    // Count leads before
    const { count: beforeCount } = await sb.from('outreach_leads').select('*', { count: 'exact', head: true });
    console.log(`  Leads before session: ${beforeCount}`);

    // Click Run Session
    await page.locator('button:has-text("Run Session")').first().click();
    console.log('  ✓ Session started — waiting for "Session complete"...');

    // Wait up to 10 min for session complete toast
    await page.waitForFunction(
        () => document.body.innerText.includes('Session complete') || document.body.innerText.includes('already in DB') || document.body.innerText.includes('0 leads found'),
        null,
        { timeout: 10 * 60 * 1000 }
    );
    await page.waitForTimeout(2000);

    const { count: afterCount } = await sb.from('outreach_leads').select('*', { count: 'exact', head: true });
    const newLeads = (afterCount || 0) - (beforeCount || 0);
    console.log(`  ✓ Session done — ${newLeads} new leads added (total: ${afterCount})\n`);
    await browser.close();

    // ── Step 2: Scan ALL scraped HAR leads until empty room found ─────────────
    console.log('STEP 2: Scanning scraped leads for empty rooms (3 at a time, no limit)...\n');

    let batchNum = 0;
    let foundLead = null;
    let foundRoom = null;
    const scannedIds = new Set();

    while (!foundLead) {
        batchNum++;
        const { data: leads } = await sb
            .from('outreach_leads')
            .select('id,address,listing_url,agent_name,agent_email,icp_score,empty_rooms')
            .eq('status', 'scraped')
            .eq('empty_rooms', '[]')
            .like('listing_url', '%har.com%')
            .not('listing_url', 'is', null)
            .order('icp_score', { ascending: false })
            .range((batchNum - 1) * 3, batchNum * 3 - 1);

        if (!leads || leads.length === 0) {
            console.log(`\n  No more unscanned HAR leads after ${batchNum - 1} batches.`);
            break;
        }

        // Filter out any we already scanned (handles DB ordering edge cases)
        const fresh = leads.filter(l => !scannedIds.has(l.id));
        if (fresh.length === 0) break;
        fresh.forEach(l => scannedIds.add(l.id));

        console.log(`  Batch ${batchNum}: Scanning ${fresh.length} leads...`);
        for (const lead of fresh) {
            const photos = await getHarPhotos(lead.listing_url, 5);
            const interior = photos.slice(1, 4);
            if (interior.length === 0) { console.log(`    [${lead.address.slice(0,45)}] — no interior photos`); continue; }
            console.log(`    [${lead.address.slice(0,45)}] — ${interior.length} photos`);
            for (const photoUrl of interior) {
                const { isEmpty, roomType, answer, error } = await detectRoom(photoUrl);
                if (error) { console.log(`      ! ${error}`); continue; }
                const label = isEmpty ? '✅ EMPTY' : '❌ furnished';
                console.log(`      → ${label} (${roomType}) — "${answer?.slice(0, 80)}"`);
                if (isEmpty) {
                    foundLead = lead;
                    foundRoom = { roomType, imageUrl: photoUrl };
                    await sb.from('outreach_leads').update({ empty_rooms: [foundRoom] }).eq('id', lead.id);
                    console.log(`\n  ✅ FOUND EMPTY ROOM — ${lead.address} (${roomType})\n`);
                    break;
                }
            }
            if (foundLead) break;
        }
        if (!foundLead) console.log(`  Batch ${batchNum}: All furnished — continuing...\n`);
    }

    if (!foundLead) {
        console.log('\n⚠  Scanned all available leads — none had empty rooms.');
        console.log('   All current Houston metro listings appear to be furnished.');
        process.exit(0);
    }

    // ── Step 3: Stage with Kie.ai ─────────────────────────────────────────────
    console.log('STEP 3: Submitting to Kie.ai (google/nano-banana-edit @ 4 credits)...');
    const { taskId, error: stageErr } = await stageRoom(foundRoom.imageUrl, foundRoom.roomType);
    if (stageErr) { console.error(`  ✗ Staging failed: ${stageErr}`); process.exit(1); }
    await sb.from('outreach_leads').update({ status: 'staged', staging_task_id: taskId }).eq('id', foundLead.id);
    console.log(`  ✓ Submitted — taskId: ${taskId}\n`);

    // ── Step 4: Poll Kie.ai up to 8 minutes ──────────────────────────────────
    console.log('STEP 4: Waiting for Kie.ai to generate staged image...');
    let stagedUrl = null;
    for (let i = 0; i < 48; i++) {
        await new Promise(r => setTimeout(r, 10000));
        const { status, url, error: pollErr } = await pollKie(taskId);
        process.stdout.write(`\r  Polling... status: ${status} (${(48 - i) * 10}s left)   `);
        if (status === 'success' && url) { stagedUrl = url; break; }
        if (status === 'failed') { console.log(`\n  ✗ Generation failed: ${pollErr}`); process.exit(1); }
    }
    if (!stagedUrl) { console.log('\n  ✗ Timed out'); process.exit(1); }
    const updatedRooms = [{ ...foundRoom, stagedUrl }];
    await sb.from('outreach_leads').update({ empty_rooms: updatedRooms }).eq('id', foundLead.id);
    console.log(`\n  ✓ Image ready!\n`);

    // ── Step 5: Send email ────────────────────────────────────────────────────
    console.log('STEP 5: Sending outreach email...');
    if (!foundLead.agent_email) {
        console.log(`  ⚠  No agent email — marking form_filled`);
        await sb.from('outreach_leads').update({ status: 'form_filled' }).eq('id', foundLead.id);
    } else {
        await sendEmail(foundLead, stagedUrl, foundRoom.imageUrl);
        await sb.from('outreach_leads').update({ status: 'emailed', contacted_at: new Date().toISOString() }).eq('id', foundLead.id);
        console.log(`  ✓ Email sent to ${foundLead.agent_email}`);
    }

    // ── Report ────────────────────────────────────────────────────────────────
    const { count: totalEmailed } = await sb.from('outreach_leads').select('*', { count: 'exact', head: true }).eq('status', 'emailed');
    console.log('\n══════════════════════════════════════════');
    console.log('  PIPELINE COMPLETE ✅');
    console.log('══════════════════════════════════════════');
    console.log(`  Lead:        ${foundLead.address}`);
    console.log(`  Room:        ${foundRoom.roomType}`);
    console.log(`  Before img:  ${foundRoom.imageUrl.slice(0, 72)}...`);
    console.log(`  Staged img:  ${stagedUrl.slice(0, 72)}...`);
    console.log(`  Emailed to:  ${foundLead.agent_email || '(no email)'}`);
    console.log(`  Total emailed in DB: ${totalEmailed}`);
    console.log('');
})().catch(e => { console.error('\nFATAL:', e.message, e.stack?.split('\n')[1]); process.exit(1); });
