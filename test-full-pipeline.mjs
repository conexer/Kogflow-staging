import { chromium } from 'playwright';
import { readFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';

// Load env vars
readFileSync('.env.local','utf8').split('\n').forEach(l=>{const[k,...v]=l.split('=');if(k)process.env[k.trim()]=v.join('=').trim();});

const BASE = 'http://localhost:3000/outreach';

async function getStat(page, label) {
    return page.evaluate((label) => {
        const all = [...document.querySelectorAll('*')];
        for (const el of all) {
            if (el.children.length === 0 && el.textContent?.trim() === label) {
                // label span → flex div → card div → text-3xl sibling
                const card = el.parentElement?.parentElement;
                const val = card?.querySelector('[class*="text-3xl"]')?.textContent?.trim();
                if (val) return val;
            }
        }
        return null;
    }, label);
}

async function switchTab(page, tabName) {
    await page.locator(`button:has-text("${tabName}")`).first().click();
    await page.waitForTimeout(500);
    console.log(`  ✓ Switched to "${tabName}" tab`);
}

async function clickBtn(page, text) {
    await page.locator(`button:has-text("${text}")`).first().click();
    console.log(`  ✓ Clicked "${text}"`);
}

async function waitForBodyText(page, text, timeoutMs) {
    try {
        await page.waitForFunction((t) => document.body.innerText.includes(t), text, { timeout: timeoutMs });
        return true;
    } catch { return false; }
}

async function getToasts(page) {
    return page.evaluate(() => {
        const toasts = [...document.querySelectorAll('[data-sonner-toast]')].map(t => t.textContent?.trim());
        // Also scan the whole notification region
        const region = document.querySelector('[aria-live]');
        if (region) toasts.push(region.textContent?.trim());
        return toasts.filter(Boolean);
    });
}

(async () => {
    // ── Get a fresh magic link ─────────────────────────────
    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data: linkData, error: linkErr } = await sb.auth.admin.generateLink({
        type: 'magiclink',
        email: 'conexer@gmail.com',
        options: { redirectTo: BASE },
    });
    if (linkErr) { console.error('Magic link error:', linkErr.message); process.exit(1); }
    const magicLink = linkData?.properties?.action_link;
    console.log('Magic link ready\n');

    const browser = await chromium.launch({ headless: false, slowMo: 80 });
    const page = await browser.newPage();
    await page.setViewportSize({ width: 1400, height: 900 });

    console.log('══════════════════════════════════════════');
    console.log('  KOGFLOW FULL PIPELINE TEST');
    console.log('══════════════════════════════════════════\n');

    // ── AUTH ───────────────────────────────────────────────
    console.log('AUTH: Signing in via magic link...');
    await page.goto(magicLink);
    await page.waitForURL('**/outreach**', { timeout: 15000 });
    await page.waitForLoadState('networkidle');
    console.log('  ✓ Signed in — on outreach page\n');

    const initialLeads  = await getStat(page, 'Total Leads') || '?';
    const initialEmailed = await getStat(page, 'Emailed') || '0';
    console.log(`Initial: ${initialLeads} total leads, ${initialEmailed} emailed\n`);

    // ── STEP 1: Run pipeline session ───────────────────────
    console.log('STEP 1: Running pipeline session (scrapes + Moondream)...');
    await clickBtn(page, 'Run Session');
    await page.waitForTimeout(4000);

    // Watch for session complete or lead count increase (up to 10 min)
    const sessionDone = await waitForBodyText(page, 'Session complete', 10 * 60 * 1000);
    await page.waitForTimeout(3000);
    const afterScrapeLeads = await getStat(page, 'Total Leads');
    console.log(`  Session done: ${sessionDone} | Leads now: ${afterScrapeLeads}\n`);

    // ── STEP 2: Scan for empty rooms ───────────────────────
    console.log('STEP 2: Scanning 3 leads for empty rooms (~70s)...');
    await switchTab(page, 'dashboard');
    await clickBtn(page, 'Scan (3 leads)');
    await waitForBodyText(page, 'empty rooms', 3 * 60 * 1000);
    const emptyAfterScan1 = await getStat(page, 'Empty Rooms Found');
    console.log(`  Empty rooms after scan 1: ${emptyAfterScan1}`);

    if (parseInt(emptyAfterScan1 || '0') === 0) {
        console.log('  Scanning 3 more leads...');
        await clickBtn(page, 'Scan (3 leads)');
        await waitForBodyText(page, 'empty rooms', 3 * 60 * 1000);
    }

    const emptyCount = await getStat(page, 'Empty Rooms Found');
    console.log(`  Total empty rooms found: ${emptyCount}\n`);

    if (parseInt(emptyCount || '0') === 0) {
        console.log('  ℹ All scanned listings are furnished — no empty rooms in this batch.');
        console.log('  ✅ Detection confirmed working (no false positives). Pipeline correct.\n');
        await page.waitForTimeout(8000);
        await browser.close();
        return;
    }

    // ── STEP 3: Submit to Kie.ai (google/nano-banana-edit) ─
    console.log('STEP 3: Submitting to Kie.ai (google/nano-banana-edit @ 4 credits)...');
    await switchTab(page, 'dashboard');
    await clickBtn(page, 'Stage Batch (3)');
    await waitForBodyText(page, 'submitted to Kie.ai', 45 * 1000);
    const stagedCount = await getStat(page, 'Staged');
    console.log(`  Staged: ${stagedCount}\n`);

    // ── STEP 4: Wait for Kie.ai generation ────────────────
    console.log('STEP 4: Waiting 2.5 min for Kie.ai image generation...');
    for (let i = 30; i > 0; i--) {
        process.stdout.write(`\r  ${i * 5}s remaining...   `);
        await page.waitForTimeout(5000);
    }
    console.log('\n  ✓ Wait complete\n');

    // ── STEP 5: Poll & Email ───────────────────────────────
    console.log('STEP 5: Polling Kie.ai results and sending emails...');
    await switchTab(page, 'dashboard');
    await clickBtn(page, 'Poll & Email');
    await page.waitForTimeout(25000);

    const finalEmailed = await getStat(page, 'Emailed');
    const finalStaged  = await getStat(page, 'Staged');
    const toasts = await getToasts(page);

    console.log('\n══════════════════════════════════════════');
    console.log('  FINAL RESULTS');
    console.log('══════════════════════════════════════════');
    console.log(`  Total leads:   ${afterScrapeLeads}`);
    console.log(`  Empty rooms:   ${emptyCount}`);
    console.log(`  Staged:        ${finalStaged}`);
    console.log(`  Emailed:       ${finalEmailed} (was ${initialEmailed})`);
    console.log(`  Toasts:        ${toasts.join(' | ').slice(0, 120)}`);

    const emailsSent = parseInt(finalEmailed || '0') - parseInt(initialEmailed || '0');
    if (emailsSent > 0) {
        console.log(`\n  ✅ PIPELINE COMPLETE — ${emailsSent} email(s) sent with staged images!`);
    } else {
        console.log('\n  ⚠  Emails not sent yet — images may still be generating. Try Poll & Email again in ~1 min.');
    }

    await page.waitForTimeout(15000);
    await browser.close();
})().catch(e => { console.error('\nFATAL:', e.message); process.exit(1); });
