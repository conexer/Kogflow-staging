/**
 * Scan scraped leads in batches of 3 until empty rooms are found,
 * then stage with Kie.ai and send outreach emails.
 * Runs entirely server-side — no browser needed.
 */
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

const log = (msg) => console.log(msg);

// ── HAR detail photo fetch ────────────────────────────────────────────────────
async function getHarPhotos(url, max = 5) {
    try {
        const res = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml',
            },
        });
        if (!res.ok) return [];
        const html = await res.text();
        const urls = [...new Set(
            [...html.matchAll(/https:\/\/mediahar\.harstatic\.com\/[^"'\s]+\/lr\/[^"'\s]+\.jpeg/g)].map(m => m[0])
        )];
        return urls.slice(0, max);
    } catch { return []; }
}

// ── Moondream room detection ──────────────────────────────────────────────────
async function detectRoom(imageUrl) {
    try {
        const imgRes = await fetch(imageUrl, {
            headers: {
                'Referer': new URL(imageUrl).origin,
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'image/*,*/*;q=0.8',
            },
        });
        if (!imgRes.ok) return { isEmpty: false, error: `img fetch ${imgRes.status}` };
        const ct = imgRes.headers.get('content-type') || 'image/jpeg';
        const b64 = Buffer.from(await imgRes.arrayBuffer()).toString('base64');

        const res = await fetch('https://api.moondream.ai/v1/query', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${MOONDREAM_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                image: `data:${ct};base64,${b64}`,
                question: 'What furniture and objects do you see in this room? Be specific and list every item you can see.',
                stream: false,
            }),
        });
        if (!res.ok) return { isEmpty: false, error: `moondream ${res.status}` };
        const data = await res.json();
        const answer = (data.answer || '').toLowerCase();

        const FURNITURE = ['sofa','couch','chair','table','bed','desk','dresser','cabinet',
            'shelf','bookshelf','bookcase','wardrobe','television','tv','lamp','rug','carpet',
            'curtain','blinds','artwork','picture','mirror','stove','refrigerator','fridge',
            'dishwasher','sink','toilet','bathtub','shower','vanity','counter','island','fireplace'];
        const EMPTY = ['empty room','no furniture','bare','unfurnished','vacant','nothing in',
            'no objects','no items','does not contain any','there is nothing','no visible furniture',
            'appears to be empty','room is empty','i don\'t see any furniture','i do not see any furniture'];

        const hasFurniture = FURNITURE.some(k => answer.includes(k));
        const confirmsEmpty = EMPTY.some(k => answer.includes(k));
        const isEmpty = !hasFurniture && confirmsEmpty;
        const roomType = answer.includes('bedroom') ? 'bedroom'
            : answer.includes('living') ? 'living room'
            : answer.includes('kitchen') ? 'kitchen'
            : answer.includes('dining') ? 'dining room'
            : answer.includes('bathroom') || answer.includes('bath') ? 'bathroom'
            : 'room';
        return { isEmpty, roomType, answer: answer.slice(0, 120) };
    } catch (e) { return { isEmpty: false, error: e.message }; }
}

// ── Kie.ai staging ────────────────────────────────────────────────────────────
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
    if (!taskId) return { error: `no taskId: ${JSON.stringify(data).slice(0,80)}` };
    return { taskId };
}

async function pollKie(taskId) {
    const res = await fetch(`https://api.kie.ai/api/v1/jobs/recordInfo?taskId=${taskId}`, {
        headers: { 'Authorization': `Bearer ${KIE_API_KEY}` }, cache: 'no-store',
    });
    if (!res.ok) return { status: 'error' };
    const data = await res.json();
    const state = data.data?.state;
    if (state === 'success') {
        const url = JSON.parse(data.data.resultJson || '{}').resultUrls?.[0];
        return { status: 'success', url };
    }
    if (state === 'failed') return { status: 'failed', error: data.data?.failMsg };
    return { status: 'processing' };
}

// ── Gmail send ────────────────────────────────────────────────────────────────
async function getAccessToken() {
    const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: GMAIL_CLIENT_ID, client_secret: GMAIL_CLIENT_SECRET, refresh_token: GMAIL_REFRESH_TOKEN, grant_type: 'refresh_token' }),
    });
    const d = await res.json();
    if (!d.access_token) throw new Error(`Token refresh failed: ${JSON.stringify(d)}`);
    return d.access_token;
}

async function sendEmail(lead, stagedUrl, beforeUrl) {
    const token = await getAccessToken();
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

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;padding:32px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;max-width:600px;width:100%;overflow:hidden;">
        <tr><td style="background:#7c3aed;padding:20px 32px;">
          <p style="margin:0;color:#fff;font-size:20px;font-weight:700;">Kogflow</p>
          <p style="margin:4px 0 0;color:#ede9fe;font-size:13px;">AI Virtual Staging</p>
        </td></tr>
        <tr><td style="padding:32px;">
          <p style="margin:0 0 16px;font-size:16px;color:#111827;">Hi ${lead.agent_name || 'there'},</p>
          <p style="margin:0 0 16px;font-size:15px;color:#374151;line-height:1.6;">I noticed your listing at <strong>${lead.address}</strong> and took the liberty of virtually staging one of the empty rooms as a free preview.</p>
          ${imagesHtml}
          <p style="margin:16px 0;font-size:15px;color:#374151;line-height:1.6;">Virtual staging helps buyers visualize the space and typically leads to faster sales and stronger offers. We generate results like this in seconds at <a href="https://kogflow.com" style="color:#7c3aed;">Kogflow.com</a>.</p>
          <p style="margin:0 0 16px;font-size:15px;color:#374151;line-height:1.6;">We can also turn these virtually staged rooms into <strong>virtual video walkthroughs</strong> -- giving buyers an immersive tour experience without ever stepping foot in the property.</p>
          <p style="margin:0 0 24px;font-size:15px;color:#374151;line-height:1.6;">Happy to send a few more free samples for this listing if you're interested.</p>
          <table cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
            <tr><td style="background:#7c3aed;border-radius:8px;padding:12px 24px;">
              <a href="https://kogflow.com" style="color:#fff;font-size:15px;font-weight:600;text-decoration:none;">See More Examples</a>
            </td></tr>
          </table>
          <p style="margin:0;font-size:15px;color:#374151;">Best,<br><strong>Minh</strong><br><a href="https://kogflow.com" style="color:#7c3aed;">Kogflow.com</a></p>
        </td></tr>
        <tr><td style="background:#f3f4f6;padding:16px 32px;">
          <p style="margin:0;font-size:12px;color:#9ca3af;">You received this because your listing at ${lead.address} is publicly listed. To unsubscribe reply with "unsubscribe".</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

    const msg = [`From: Kogflow <kogflow.media@gmail.com>`,`To: ${lead.agent_email}`,`Subject: ${subject}`,`MIME-Version: 1.0`,`Content-Type: text/html; charset=utf-8`,``,html].join('\r\n');
    const encoded = Buffer.from(msg).toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');

    const sendRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ raw: encoded }),
    });
    if (!sendRes.ok) { const e = await sendRes.text(); throw new Error(`Gmail ${sendRes.status}: ${e.slice(0,200)}`); }
    return true;
}

// ── Main ──────────────────────────────────────────────────────────────────────
(async () => {
    log('\n══════════════════════════════════════════');
    log('  KOGFLOW SCAN-UNTIL-EMPTY-ROOM TEST');
    log('══════════════════════════════════════════\n');

    // ── Step 1: Run pipeline session to get fresh leads ──
    log('STEP 1: Importing server actions (running via local Next.js)...');
    log('  Fetching fresh leads from pipeline session...');

    const sessionRes = await fetch('http://localhost:3000/api/cron/pipeline', {
        headers: { 'Authorization': `Bearer ${process.env.CRON_SECRET || 'dev-secret'}` },
    }).catch(() => null);
    // Pipeline session via server action — use direct DB approach instead
    log('  (Using direct Supabase scan — no need for full pipeline session)\n');

    // ── Step 2: Scan leads in batches until we find an empty room ──────────────
    log('STEP 2: Scanning scraped leads for empty rooms (3 at a time)...\n');

    let batchNum = 0;
    let foundLead = null;
    let foundRoom = null;
    const MAX_BATCHES = 20; // scan up to 60 leads

    while (batchNum < MAX_BATCHES && !foundLead) {
        batchNum++;

        // Fetch 3 unseen scraped HAR leads (skip ones we already checked this run)
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
            log(`  Batch ${batchNum}: No more unscanned leads.`);
            break;
        }

        log(`  Batch ${batchNum}: Scanning ${leads.length} leads...`);

        for (const lead of leads) {
            const photos = await getHarPhotos(lead.listing_url, 5);
            const interior = photos.slice(1, 4); // skip exterior (index 0)
            log(`    [${lead.address.slice(0, 45)}] — ${interior.length} interior photos`);

            for (const photoUrl of interior) {
                const { isEmpty, roomType, answer, error } = await detectRoom(photoUrl);
                if (error) { log(`      ! Moondream error: ${error}`); continue; }
                log(`      → ${isEmpty ? '✅ EMPTY' : '❌ furnished'} (${roomType}) — "${answer?.slice(0,80)}"`);
                if (isEmpty) {
                    foundLead = lead;
                    foundRoom = { roomType, imageUrl: photoUrl };
                    await sb.from('outreach_leads').update({ empty_rooms: [foundRoom] }).eq('id', lead.id);
                    log(`\n  ✅ Found empty room! Lead: ${lead.address}`);
                    break;
                }
            }
            if (foundLead) break;
        }

        if (!foundLead) log(`  Batch ${batchNum}: No empty rooms in this batch — continuing...\n`);
    }

    if (!foundLead) {
        log('\n⚠  No empty rooms found after scanning all available leads.');
        log('   All current leads appear to be furnished. Try running a pipeline session first.');
        process.exit(0);
    }

    // ── Step 3: Stage with Kie.ai ─────────────────────────────────────────────
    log('\nSTEP 3: Submitting to Kie.ai (google/nano-banana-edit @ 4 credits)...');
    const { taskId, error: stageErr } = await stageRoom(foundRoom.imageUrl, foundRoom.roomType);
    if (stageErr) { log(`  ✗ Staging failed: ${stageErr}`); process.exit(1); }
    await sb.from('outreach_leads').update({ status: 'staged', staging_task_id: taskId }).eq('id', foundLead.id);
    log(`  ✓ Task submitted: ${taskId}\n`);

    // ── Step 4: Poll until Kie.ai finishes (up to 8 minutes) ─────────────────
    log('STEP 4: Waiting for Kie.ai image generation...');
    let stagedUrl = null;
    for (let i = 0; i < 48; i++) {
        await new Promise(r => setTimeout(r, 10000)); // 10s intervals
        const { status, url, error: pollErr } = await pollKie(taskId);
        process.stdout.write(`\r  ${(48 - i) * 10}s remaining | status: ${status}   `);
        if (status === 'success' && url) { stagedUrl = url; break; }
        if (status === 'failed') { log(`\n  ✗ Generation failed: ${pollErr}`); process.exit(1); }
    }
    if (!stagedUrl) { log('\n  ✗ Timed out waiting for Kie.ai'); process.exit(1); }
    log(`\n  ✓ Staged image ready: ${stagedUrl.slice(0, 80)}...\n`);

    // Save staged URL back to DB
    const updatedRooms = [{ ...foundRoom, stagedUrl }];
    await sb.from('outreach_leads').update({ empty_rooms: updatedRooms }).eq('id', foundLead.id);

    // ── Step 5: Send email ────────────────────────────────────────────────────
    log('STEP 5: Sending outreach email...');
    if (!foundLead.agent_email) {
        log(`  ⚠  No agent email for this lead — marking form_filled instead`);
        await sb.from('outreach_leads').update({ status: 'form_filled' }).eq('id', foundLead.id);
    } else {
        await sendEmail(foundLead, stagedUrl, foundRoom.imageUrl);
        await sb.from('outreach_leads').update({ status: 'emailed', contacted_at: new Date().toISOString() }).eq('id', foundLead.id);
        log(`  ✓ Email sent to ${foundLead.agent_email}`);
    }

    // ── Final report ──────────────────────────────────────────────────────────
    log('\n══════════════════════════════════════════');
    log('  PIPELINE COMPLETE');
    log('══════════════════════════════════════════');
    log(`  Lead:        ${foundLead.address}`);
    log(`  Room:        ${foundRoom.roomType}`);
    log(`  Before:      ${foundRoom.imageUrl.slice(0, 70)}...`);
    log(`  Staged:      ${stagedUrl.slice(0, 70)}...`);
    log(`  Emailed to:  ${foundLead.agent_email || '(no email — form_filled)'}`);
    log('');
})().catch(e => { console.error('\nFATAL:', e.message); process.exit(1); });
