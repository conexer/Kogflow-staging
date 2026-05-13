'use server';

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ZYTE_API_KEY = process.env.ZYTE_API_KEY!;
const GMAIL_CLIENT_ID = process.env.GMAIL_CLIENT_ID!;
const GMAIL_CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET!;
const GMAIL_REFRESH_TOKEN = process.env.GMAIL_REFRESH_TOKEN!;

// ─────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────

export interface TCLead {
    id?: string;
    company_name: string;
    owner_name?: string;
    contact_name?: string;
    email?: string;
    normalized_email?: string;
    phone?: string;
    website_url?: string;
    source_url?: string;
    city?: string;
    state?: string;
    address?: string;
    description?: string;
    services?: string[];
    states_served?: string[];
    years_in_business?: string;
    team_size?: number;
    review_count?: number;
    rating?: number;
    icp_score?: number;
    status?: string;
}

// ─────────────────────────────────────────────
// ICP SCORING
// ─────────────────────────────────────────────

export async function scoreTCLead(lead: Partial<TCLead>): Promise<number> {
    let score = 0;
    const desc = (lead.description || '').toLowerCase();
    const services = (lead.services || []).join(' ').toLowerCase();
    const combined = desc + ' ' + services;

    if (lead.email && lead.normalized_email) score += 25;
    if ((lead.team_size || 0) >= 5) score += 20;
    else if ((lead.team_size || 0) >= 2) score += 5;
    if ((lead.states_served || []).length > 1) score += 15;
    if (lead.owner_name) score += 15;
    if (services.includes('listing coordination') || services.includes('listing agreement')) score += 10;
    if (services.includes('commercial')) score += 10;
    const founded = parseInt(lead.years_in_business || '9999');
    if (!isNaN(founded) && founded <= 2015) score += 10;
    if ((lead.review_count || 0) >= 20) score += 10;
    if ((lead.rating || 0) >= 4.5) score += 10;
    if (combined.includes('investor') || combined.includes('flip')) score += 20;
    if (combined.includes('volume') || combined.includes('high volume') || combined.includes('100+')) score += 15;
    if (combined.includes('luxury')) score += 5;
    if (combined.includes('dotloop') || combined.includes('skyslope') || combined.includes('docusign')) score += 10;
    if (combined.includes('vacant') || combined.includes('staging') || combined.includes('empty')) score += 10;
    if (combined.includes('about') || combined.includes('team bio') || combined.includes('our story')) score += 5;
    if (combined.includes('title company') || combined.includes('law firm') || combined.includes('attorney')) score -= 15;
    if (!lead.email) score -= 20;

    return Math.max(0, Math.min(100, score));
}

// ─────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────

export async function loadTCPipelineConfig() {
    const supabase = createClient(supabaseUrl, supabaseKey);
    const { data } = await supabase.from('tc_pipeline_config').select('*').eq('id', 1).maybeSingle();
    return { config: data };
}

export async function saveTCPipelineConfig(updates: {
    cities?: string[];
    emails_per_day?: number;
    sessions_per_day?: number;
    scrapes_per_session?: number;
    cron_enabled?: boolean;
}) {
    const supabase = createClient(supabaseUrl, supabaseKey);
    const { error } = await supabase.from('tc_pipeline_config')
        .upsert({ id: 1, ...updates, updated_at: new Date().toISOString() });
    return { error: error?.message };
}

// ─────────────────────────────────────────────
// ZYTE FETCH HELPER
// ─────────────────────────────────────────────

async function zyteGet(url: string): Promise<string> {
    const res = await fetch('https://api.zyte.com/v1/extract', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Basic ' + Buffer.from(`${ZYTE_API_KEY}:`).toString('base64'),
        },
        body: JSON.stringify({ url, browserHtml: true }),
    });
    if (!res.ok) throw new Error(`Zyte ${res.status} for ${url}`);
    const data = await res.json();
    return data.browserHtml || '';
}

function stripHtml(html: string): string {
    return html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function extractEmails(text: string): string[] {
    const matches = [...text.matchAll(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g)];
    return [...new Set(matches.map(m => m[0]).filter(e =>
        !e.includes('example') && !e.includes('.png') && !e.includes('.jpg') &&
        !e.includes('sentry') && !e.includes('wix') && !e.includes('godaddy') &&
        !e.match(/^\d/) && e.length < 80
    ))];
}

function extractPhones(text: string): string[] {
    const matches = [...text.matchAll(/\(?\d{3}\)?[\s\-\.]\d{3}[\s\-\.]\d{4}/g)];
    return [...new Set(matches.map(m => m[0]))];
}

function normalizeEmail(email: string): string {
    return email.toLowerCase().trim();
}

function extractOwnerName(text: string): string | undefined {
    const patterns = [
        /(?:Owner|Founder|CEO|President|Principal|Director|Operator)[,:\s]+([A-Z][a-z]+ [A-Z][a-z]+)/,
        /([A-Z][a-z]+ [A-Z][a-z]+)[,\s-]+(?:Owner|Founder|CEO|President|Principal)/,
        /(?:Founded by|Started by|Run by)[:\s]+([A-Z][a-z]+ [A-Z][a-z]+)/,
    ];
    for (const p of patterns) {
        const m = text.match(p);
        if (m) return m[1];
    }
    return undefined;
}

function extractTeamSize(text: string, emails: string[]): number {
    const teamEmailCount = emails.length;
    const m = text.match(/(?:team of|over|more than|than)\s+(\d+)\s+(?:coordinators?|TCs?|agents?|staff|members?|professionals?)/i);
    if (m) return parseInt(m[1]);
    if (text.match(/\b(nationwide|national|across the country)\b/i)) return 10;
    return Math.max(1, teamEmailCount);
}

function extractServices(text: string): string[] {
    const services: string[] = [];
    if (/listing\s*coordination/i.test(text)) services.push('listing coordination');
    if (/buyer\s*coordination|purchase\s*coordination/i.test(text)) services.push('buyer coordination');
    if (/contract[\s-]to[\s-]close/i.test(text)) services.push('contract to close');
    if (/commercial/i.test(text)) services.push('commercial');
    if (/residential/i.test(text)) services.push('residential');
    if (/investor/i.test(text)) services.push('investor transactions');
    if (/luxury/i.test(text)) services.push('luxury');
    if (/dotloop|skyslope|docusign/i.test(text)) services.push('tech-forward');
    return services;
}

function extractStatesServed(text: string): string[] {
    const states = ['Texas', 'California', 'Florida', 'Georgia', 'North Carolina', 'Tennessee',
        'Arizona', 'Nevada', 'Colorado', 'Oregon', 'Washington', 'Missouri', 'Ohio',
        'Indiana', 'Virginia', 'South Carolina', 'Alabama', 'Louisiana'];
    return states.filter(s => text.includes(s) || text.includes(s.substring(0, 2).toUpperCase()));
}

// ─────────────────────────────────────────────
// SCRAPE: DISCOVER TC COMPANIES
// ─────────────────────────────────────────────

async function discoverTCsInCity(city: string): Promise<{ companyName: string; websiteUrl: string; sourceUrl: string }[]> {
    const query = `transactional coordinator company ${city}`;
    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&num=10`;

    const html = await zyteGet(searchUrl);

    // Extract non-Google URLs from search results
    const urls = [...new Set(
        [...html.matchAll(/href="(https?:\/\/(?!google|gstatic|googleapis|youtube|facebook|linkedin|yelp|indeed|ziprecruiter|glassdoor|twitter|instagram|angi|thumbtack|bark\.com)[^"]+)"/g)]
            .map(m => m[1])
            .filter(u => u.length < 120 && !u.includes('webcache') && !u.includes('amp;'))
            .map(u => {
                try { return new URL(u).origin; } catch { return null; }
            })
            .filter(Boolean) as string[]
    )].slice(0, 8);

    // Extract company names from search snippet text
    const text = stripHtml(html);
    const results: { companyName: string; websiteUrl: string; sourceUrl: string }[] = [];

    for (const url of urls) {
        // Try to find a company name near the URL in the text
        const domain = new URL(url).hostname.replace('www.', '');
        const companyGuess = domain.split('.')[0].replace(/[-_]/g, ' ')
            .split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
        results.push({ companyName: companyGuess, websiteUrl: url, sourceUrl: searchUrl });
    }

    return results;
}

// ─────────────────────────────────────────────
// SCRAPE: DEEP SCRAPE A TC WEBSITE
// ─────────────────────────────────────────────

async function deepScrapeTCWebsite(websiteUrl: string, city: string): Promise<Partial<TCLead> | null> {
    try {
        const homepageHtml = await zyteGet(websiteUrl);
        const homepageText = stripHtml(homepageHtml);

        // Look for internal about/team/contact pages
        const internalPaths = [...new Set(
            [...homepageHtml.matchAll(/href="(\/[^"]*(?:about|team|contact|our-story|staff|who-we-are)[^"]*)"/gi)]
                .map(m => m[1])
        )].slice(0, 3);

        let allText = homepageText;
        let allEmails: string[] = [];

        // Scrape about/team pages too
        for (const path of internalPaths) {
            try {
                const pageUrl = websiteUrl + path;
                const pageHtml = await zyteGet(pageUrl);
                const pageText = stripHtml(pageHtml);
                allText += ' ' + pageText;
                allEmails.push(...extractEmails(pageText));
            } catch { /* skip failed sub-pages */ }
        }

        allEmails.push(...extractEmails(homepageText));
        allEmails = [...new Set(allEmails)];

        const phones = extractPhones(allText);
        const ownerName = extractOwnerName(allText);
        const services = extractServices(allText);
        const statesServed = extractStatesServed(allText);
        const teamSize = extractTeamSize(allText, allEmails);

        // Extract founding year
        const yearMatch = allText.match(/(?:founded|established|since|started)\s+(?:in\s+)?(\d{4})/i);
        const yearsInBusiness = yearMatch ? yearMatch[1] : undefined;

        // Extract company name from title tag
        const titleMatch = homepageHtml.match(/<title[^>]*>([^<]+)<\/title>/i);
        const companyName = titleMatch
            ? titleMatch[1].split(/[|\-–]/)[0].trim().substring(0, 80)
            : new URL(websiteUrl).hostname.replace('www.', '').split('.')[0];

        // Description: first 400 chars of meaningful text
        const description = allText.replace(/\s+/g, ' ').substring(0, 500);

        if (allEmails.length === 0) return null;

        const primaryEmail = allEmails[0];
        const normalized = normalizeEmail(primaryEmail);

        const lead: Partial<TCLead> = {
            company_name: companyName,
            owner_name: ownerName,
            email: primaryEmail,
            normalized_email: normalized,
            phone: phones[0],
            website_url: websiteUrl,
            city,
            services,
            states_served: statesServed,
            years_in_business: yearsInBusiness,
            team_size: teamSize,
            description,
        };

        lead.icp_score = await scoreTCLead(lead);
        return lead;
    } catch {
        return null;
    }
}

// ─────────────────────────────────────────────
// PIPELINE SESSION
// ─────────────────────────────────────────────

export async function runTCPipelineSession({
    cities,
    scrapes,
    deadlineMs,
}: {
    cities: string[];
    scrapes: number;
    deadlineMs: number;
}): Promise<{ processed: number; errors: string[]; debug: string[] }> {
    const supabase = createClient(supabaseUrl, supabaseKey);
    const debug: string[] = [];
    const errors: string[] = [];
    let processed = 0;

    // Pick cities not recently scraped (last 48h)
    const { data: cityLog } = await supabase.from('tc_city_log').select('city, last_scraped_at');
    const recentlyScrapped = new Set(
        (cityLog || [])
            .filter(c => Date.now() - new Date(c.last_scraped_at).getTime() < 48 * 3600 * 1000)
            .map(c => c.city)
    );

    const eligibleCities = cities.filter(c => !recentlyScrapped.has(c));
    const citiesToScrape = (eligibleCities.length > 0 ? eligibleCities : cities)
        .sort(() => Math.random() - 0.5)
        .slice(0, scrapes);

    debug.push(`Scraping ${citiesToScrape.length} cities: ${citiesToScrape.join(', ')}`);

    for (const city of citiesToScrape) {
        if (Date.now() > deadlineMs - 20_000) { debug.push('Deadline approaching, stopping'); break; }

        try {
            const discovered = await discoverTCsInCity(city);
            debug.push(`[${city}] Discovered ${discovered.length} TC sites`);

            let cityNewLeads = 0;
            for (const { websiteUrl, sourceUrl } of discovered) {
                if (Date.now() > deadlineMs - 10_000) break;

                // Skip if already in DB
                const { data: existing } = await supabase
                    .from('tc_leads').select('id').eq('website_url', websiteUrl).maybeSingle();
                if (existing) { debug.push(`  Skip (exists): ${websiteUrl}`); continue; }

                const lead = await deepScrapeTCWebsite(websiteUrl, city);
                if (!lead || !lead.email) { debug.push(`  No email: ${websiteUrl}`); continue; }

                // Skip if normalized email already locked
                const { data: locked } = await supabase
                    .from('tc_recipient_locks').select('normalized_email').eq('normalized_email', lead.normalized_email!).maybeSingle();
                if (locked) { debug.push(`  Locked: ${lead.email}`); continue; }

                // Parse city/state
                const [cityPart, statePart] = city.split(', ');
                lead.city = cityPart;
                lead.state = statePart;
                lead.source_url = sourceUrl;

                const { error } = await supabase.from('tc_leads').insert(lead);
                if (error) { errors.push(`Insert failed: ${error.message}`); continue; }

                processed++;
                cityNewLeads++;
                debug.push(`  Saved: ${lead.company_name} <${lead.email}> score=${lead.icp_score}`);
            }

            // Update city log
            await supabase.from('tc_city_log').upsert({
                city,
                last_scraped_at: new Date().toISOString(),
                leads_found: cityNewLeads,
            });
        } catch (e: any) {
            errors.push(`[${city}] ${e.message}`);
        }
    }

    return { processed, errors, debug };
}

// ─────────────────────────────────────────────
// EMAIL SEND SPACING (mirrors outreach pipeline: 60s minimum between sends)
// ─────────────────────────────────────────────

async function getNextTCSendAfter(supabase: any, offsetIndex = 0): Promise<string> {
    const now = Date.now();
    const SPACING_MS = 60_000; // 1 minute between emails, same cadence as realtor outreach pipeline

    const { data: pending } = await supabase
        .from('tc_email_queue')
        .select('send_after')
        .in('status', ['queued', 'sending'])
        .order('send_after', { ascending: false })
        .limit(1)
        .maybeSingle() as { data: { send_after?: string } | null };

    const pendingMs = pending?.send_after ? new Date(pending.send_after).getTime() : 0;

    const { data: lastSent } = await supabase
        .from('tc_email_queue')
        .select('sent_at')
        .eq('status', 'sent')
        .order('sent_at', { ascending: false })
        .limit(1)
        .maybeSingle() as { data: { sent_at?: string } | null };

    const lastSentMs = lastSent?.sent_at ? new Date(lastSent.sent_at).getTime() + SPACING_MS : 0;

    const base = Math.max(now, pendingMs + SPACING_MS, lastSentMs);
    return new Date(base + offsetIndex * SPACING_MS).toISOString();
}

// ─────────────────────────────────────────────
// QUEUE HIGH-SCORE LEADS
// ─────────────────────────────────────────────

export async function queueHighScoreTCLeads(minScore = 30): Promise<{ queued: number; debug: string[] }> {
    const supabase = createClient(supabaseUrl, supabaseKey);
    const debug: string[] = [];

    const { data: leads } = await supabase
        .from('tc_leads')
        .select('id, email, normalized_email, icp_score')
        .eq('status', 'new')
        .gte('icp_score', minScore)
        .not('normalized_email', 'is', null)
        .order('icp_score', { ascending: false })
        .limit(50);

    let queued = 0;
    for (const lead of (leads || [])) {
        const { data: locked } = await supabase
            .from('tc_recipient_locks').select('normalized_email').eq('normalized_email', lead.normalized_email).maybeSingle();
        if (locked) {
            debug.push(`Skip locked: ${lead.email}`);
            continue;
        }
        const { data: inQueue } = await supabase
            .from('tc_email_queue').select('id').eq('lead_id', lead.id).maybeSingle();
        if (inQueue) continue;

        // Space sends 60s apart — same cadence as the realtor outreach pipeline
        const sendAfter = await getNextTCSendAfter(supabase as any);

        await supabase.from('tc_email_queue').insert({
            lead_id: lead.id,
            normalized_email: lead.normalized_email,
            agent_email: lead.email,
            send_after: sendAfter,
            ready_at: sendAfter,
        });
        await supabase.from('tc_leads').update({ status: 'queued' }).eq('id', lead.id);
        queued++;
        debug.push(`Queued: ${lead.email} (score ${lead.icp_score}) send_after=${sendAfter}`);
    }

    return { queued, debug };
}

// ─────────────────────────────────────────────
// GMAIL TOKEN
// ─────────────────────────────────────────────

async function getGmailAccessToken(): Promise<string> {
    const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            client_id: GMAIL_CLIENT_ID,
            client_secret: GMAIL_CLIENT_SECRET,
            refresh_token: GMAIL_REFRESH_TOKEN,
            grant_type: 'refresh_token',
        }),
    });
    const data = await res.json();
    if (!data.access_token) throw new Error(`Token refresh failed: ${JSON.stringify(data)}`);
    return data.access_token;
}

// ─────────────────────────────────────────────
// GMAIL LABEL HELPER
// ─────────────────────────────────────────────

// Module-level cache so we only look up / create the label once per cold start
let cachedTCLabelId: string | null = null;

async function getOrCreateTCLabel(accessToken: string): Promise<string | null> {
    if (cachedTCLabelId) return cachedTCLabelId;

    try {
        const listRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/labels', {
            headers: { 'Authorization': `Bearer ${accessToken}` },
        });
        if (!listRes.ok) return null;
        const { labels } = await listRes.json();
        const existing = (labels as { id: string; name: string }[]).find(l => l.name === 'Outreach TC');
        if (existing) {
            cachedTCLabelId = existing.id;
            return existing.id;
        }

        // Create it
        const createRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/labels', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: 'Outreach TC', labelListVisibility: 'labelShow', messageListVisibility: 'show' }),
        });
        if (!createRes.ok) return null;
        const created = await createRes.json();
        cachedTCLabelId = created.id;
        return created.id;
    } catch {
        return null;
    }
}

// ─────────────────────────────────────────────
// GET BEFORE/AFTER IMAGE PAIR
// ─────────────────────────────────────────────

async function getBestStagedImagePair(): Promise<{ beforeUrl: string; afterUrl: string; address: string; roomType: string } | null> {
    const supabase = createClient(supabaseUrl, supabaseKey);
    const { data: leads } = await supabase
        .from('outreach_leads')
        .select('address, empty_rooms')
        .eq('status', 'emailed')
        .not('empty_rooms', 'is', null)
        .order('icp_score', { ascending: false })
        .limit(50);

    // Collect every valid before/after pair across all rooms of all leads
    const pairs: { beforeUrl: string; afterUrl: string; address: string; roomType: string }[] = [];
    for (const lead of (leads || [])) {
        for (const room of (lead.empty_rooms || [])) {
            if (room?.imageUrl && room?.stagedUrl && room.stagedUrl.includes('supabase')) {
                pairs.push({
                    beforeUrl: room.imageUrl,
                    afterUrl: room.stagedUrl,
                    address: lead.address,
                    roomType: room.roomType || 'living room',
                });
            }
        }
    }

    if (pairs.length === 0) return null;

    // Pick randomly from the pool so every email gets a different before/after
    return pairs[Math.floor(Math.random() * pairs.length)];
}

// ─────────────────────────────────────────────
// BUILD EMAIL BODY
// ─────────────────────────────────────────────

function buildTCEmailBody(
    lead: TCLead,
    images: { beforeUrl: string; afterUrl: string; address: string; roomType: string } | null,
): { subject: string; html: string } {
    const firstName = lead.owner_name?.split(' ')[0] || lead.contact_name?.split(' ')[0] || 'there';
    const company = lead.company_name;
    const services = (lead.services || []);
    const statesServed = (lead.states_served || []);
    const description = lead.description || '';
    const pick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

    // ── Subject lines ────────────────────────────────────────────────────────
    const subject = pick([
        `${firstName}, a quick idea for ${company} that could help your agent clients`,
        `${firstName}, this might help the agents at ${company} close faster`,
        `${firstName}, something I put together that's relevant to ${company}`,
        `${firstName}, I think this would resonate with the agents you coordinate for`,
        `${company} + AI virtual staging — worth a quick look, ${firstName}`,
        `${firstName}, a before/after example your agent clients would appreciate`,
        `${firstName}, thought this could be useful for ${company}`,
    ]);

    // ── Personalized opener ──────────────────────────────────────────────────
    let opener = `I came across ${company} while looking into TC services`;
    if (lead.city) opener += ` in ${lead.city}`;
    if (lead.years_in_business && parseInt(lead.years_in_business) <= 2015) {
        opener += ` — impressive that you've been running this since ${lead.years_in_business}`;
    } else if ((lead.team_size || 0) >= 5) {
        opener += ` — a ${lead.team_size}-person team is serious scale for a TC operation`;
    } else if (description.toLowerCase().includes('raving fan')) {
        opener += ` — I love the "Raving Fans" approach`;
    } else if (statesServed.length > 1) {
        opener += ` — coordinating transactions across ${statesServed.slice(0, 2).join(' and ')} is no small thing`;
    }
    opener += '.';

    // ── Value lines (pick 1 of 10 based on TC profile) ───────────────────────
    const valueLine = pick(
        services.includes('investor transactions') || description.toLowerCase().includes('investor') ? [
            `Investors hate paying $2,000–$5,000 for traditional staging. <a href="https://bit.ly/kogflow" style="color:#7c3aed;">Kogflow</a> is a web app that stages any room in one click — upload a photo, click once, and get a professionally furnished result in seconds. Extremely affordable, and free to try. Agent clients can do it themselves instantly.`,
            `Investor clients are always looking to cut costs without cutting presentation quality. <a href="https://bit.ly/kogflow" style="color:#7c3aed;">Kogflow</a> is a one-click website for virtual staging — upload any listing photo and get a professionally staged room in seconds. Extremely affordable and free to try.`,
        ] : services.includes('commercial') || (lead.team_size || 0) >= 5 ? [
            `When you're coordinating a high volume of transactions, anything that helps agents sell faster is a win. <a href="https://bit.ly/kogflow" style="color:#7c3aed;">Kogflow</a> is a web app that stages any room in one click — upload a photo, get a furnished result in seconds. Extremely affordable and free to try.`,
            `At the volume you're working at, vacant listings that sit create extra work for everyone. <a href="https://bit.ly/kogflow" style="color:#7c3aed;">Kogflow</a> is a website where agents can stage any room in one click — upload a photo, click once, done. Extremely affordable and very easy to pass along.`,
        ] : statesServed.length > 1 ? [
            `With clients across multiple states, vacant listings that sit longer than expected are a common problem. <a href="https://bit.ly/kogflow" style="color:#7c3aed;">Kogflow</a> is a web app that stages any room in one click — upload a listing photo and get a professionally furnished version in seconds. Extremely affordable and free to try.`,
            `Coordinating across multiple markets means you see a lot of vacant listings. <a href="https://bit.ly/kogflow" style="color:#7c3aed;">Kogflow</a> is a one-click website for virtual staging — any agent can upload a photo and get a staged result in seconds. Extremely affordable and easy to share.`,
        ] : services.includes('listing coordination') ? [
            `Vacant properties are the trickiest part of listing coordination — empty rooms photograph badly and buyers scroll past. <a href="https://bit.ly/kogflow" style="color:#7c3aed;">Kogflow</a> is a web app that fixes that in one click — upload a photo, get a professionally staged room in seconds. Extremely affordable and free to try.`,
            `Listing coordination and vacant properties go hand in hand. <a href="https://bit.ly/kogflow" style="color:#7c3aed;">Kogflow</a> is a website where agents can stage any room in one click — extremely affordable and much faster than traditional staging. Easy to pass along to any agent with a vacant listing.`,
        ] : [
            `A lot of agents you coordinate for probably have vacant listings sitting longer than expected. <a href="https://bit.ly/kogflow" style="color:#7c3aed;">Kogflow</a> is a web app that stages any room in one click — upload a listing photo and get a professionally furnished result in seconds. Extremely affordable and free to try.`,
            `Vacant listings are one of the trickiest things to photograph well. <a href="https://bit.ly/kogflow" style="color:#7c3aed;">Kogflow</a> is a one-click website for virtual staging — any agent can upload a photo and get a staged room in seconds. Extremely affordable and easy to share.`,
            `Empty rooms photograph badly and buyers scroll past them fast. <a href="https://bit.ly/kogflow" style="color:#7c3aed;">Kogflow</a> is a web app that fixes this in one click — upload any listing photo and get a professionally staged room in seconds. Extremely affordable and free to try.`,
            `Staged listings get more saves, more clicks, and more showing requests. <a href="https://bit.ly/kogflow" style="color:#7c3aed;">Kogflow</a> is a website where agents can stage any room in one click — extremely affordable, free to start. Something easy to pass along to anyone with a vacant listing.`,
        ]
    );

    // ── Video walkthrough lines ───────────────────────────────────────────────
    const videoLine = pick([
        `Same web app also builds <strong>virtual video walkthroughs</strong> in one click — buyers can explore the staged property remotely before committing to a showing.`,
        `<a href="https://bit.ly/kogflow" style="color:#7c3aed;">Kogflow</a> also generates <strong>virtual video walkthroughs</strong> from any staged photo in one click — great for listings with out-of-town buyers.`,
        `Beyond photos, the same website turns staged rooms into <strong>virtual video walkthroughs</strong> in one click — buyers get an immersive tour from their phone before ever visiting.`,
        `It also creates <strong>virtual video walkthroughs</strong> from the staged image in one click — useful for any agent whose clients are making decisions remotely.`,
    ]);

    // ── Closing lines ─────────────────────────────────────────────────────────
    const closingLine = pick([
        `Either way, happy to help — just reply if you want more rooms done. Or try it in one click at <a href="https://bit.ly/kogflow" style="color:#7c3aed;">bit.ly/kogflow</a> anytime, free to start.`,
        `If you ever have an agent client sitting on a vacant listing — I'm happy to do a free staged sample for them. Or they can do it themselves in one click at <a href="https://bit.ly/kogflow" style="color:#7c3aed;">bit.ly/kogflow</a>. Worth sharing?`,
        `Happy to do a free sample for any agent you're currently coordinating for — no pitch, no pressure. Or they can stage any room in one click at <a href="https://bit.ly/kogflow" style="color:#7c3aed;">bit.ly/kogflow</a> themselves. Extremely affordable.`,
        `No obligation — if you want a free sample done for one of your agent clients, just reply with a listing photo and I'll take care of it. Or they can try it in one click at <a href="https://bit.ly/kogflow" style="color:#7c3aed;">bit.ly/kogflow</a>.`,
        `Worth passing along to any agent with a vacant listing? One click at <a href="https://bit.ly/kogflow" style="color:#7c3aed;">bit.ly/kogflow</a> is all it takes — free to start, extremely affordable.`,
    ]);

    // ── Sign-offs ─────────────────────────────────────────────────────────────
    const signoff = pick([
        `Best,<br>Minh<br><a href="https://bit.ly/kogflow" style="color:#7c3aed;">bit.ly/kogflow</a>`,
        `– Minh<br><a href="https://bit.ly/kogflow" style="color:#7c3aed;">bit.ly/kogflow</a>`,
        `Thanks,<br>Minh @ Kogflow<br><a href="https://bit.ly/kogflow" style="color:#7c3aed;">bit.ly/kogflow</a>`,
        `– Minh at Kogflow<br><a href="https://bit.ly/kogflow" style="color:#7c3aed;">bit.ly/kogflow</a>`,
        `Talk soon,<br>Minh<br><a href="https://bit.ly/kogflow" style="color:#7c3aed;">bit.ly/kogflow</a>`,
        `– Minh<br>Kogflow — AI Virtual Staging<br><a href="https://bit.ly/kogflow" style="color:#7c3aed;">bit.ly/kogflow</a>`,
    ]);

    // ── Before/after image block (inline URLs, same as original outreach) ─────
    const imagesHtml = images ? `
        <table width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0;">
          <tr>
            <td align="center" style="padding:0 0 12px 0;">
              <p style="margin:0 0 6px 0;font-size:13px;color:#666;font-weight:600;text-transform:uppercase;letter-spacing:1px;">BEFORE</p>
              <a href="${images.beforeUrl}" target="_blank" style="display:block;"><img src="${images.beforeUrl}" alt="Before" width="540" style="display:block;width:100%;max-width:540px;height:auto;border-radius:6px;border:1px solid #e5e7eb;" /></a>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:0;">
              <p style="margin:0 0 6px 0;font-size:13px;color:#7c3aed;font-weight:600;text-transform:uppercase;letter-spacing:1px;">VIRTUALLY STAGED BY KOGFLOW</p>
              <a href="${images.afterUrl}" target="_blank" style="display:block;"><img src="${images.afterUrl}" alt="Virtually staged room" width="540" style="display:block;width:100%;max-width:540px;height:auto;border-radius:6px;border:2px solid #7c3aed;" /></a>
            </td>
          </tr>
        </table>` : '';

    const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;padding:32px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;max-width:600px;width:100%;">
        <tr>
          <td style="background:#7c3aed;padding:20px 32px;">
            <p style="margin:0;color:#ffffff;font-size:20px;font-weight:700;letter-spacing:-0.5px;">Kogflow</p>
            <p style="margin:4px 0 0;color:#ede9fe;font-size:13px;">AI Virtual Staging</p>
          </td>
        </tr>
        <tr>
          <td style="padding:32px;">
            <p style="margin:0 0 16px;font-size:16px;color:#111827;">Hi ${firstName},</p>
            <p style="margin:0 0 16px;font-size:15px;color:#374151;line-height:1.6;">${opener}</p>
            ${imagesHtml}
            <p style="margin:16px 0 16px;font-size:15px;color:#374151;line-height:1.6;">${valueLine}</p>
            <p style="margin:0 0 16px;font-size:15px;color:#374151;line-height:1.6;">${videoLine}</p>
            <p style="margin:0 0 24px;font-size:15px;color:#374151;line-height:1.6;">${closingLine}</p>
            <table cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
              <tr>
                <td style="background:#7c3aed;border-radius:8px;padding:12px 24px;">
                  <a href="https://bit.ly/kogflow" style="color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;">See More Examples</a>
                </td>
              </tr>
            </table>
            <p style="margin:0;font-size:15px;color:#374151;">${signoff}</p>
          </td>
        </tr>
        <tr>
          <td style="background:#f3f4f6;padding:16px 32px;">
            <p style="margin:0;font-size:12px;color:#9ca3af;">You received this because ${company} is publicly listed as a transaction coordination service. Reply "unsubscribe" to opt out.</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

    return { subject, html };
}

// ─────────────────────────────────────────────
// SEND EMAIL
// ─────────────────────────────────────────────

export async function sendTCOutreachEmail(lead: TCLead): Promise<{ success?: boolean; error?: string; duplicate?: boolean }> {
    if (!GMAIL_CLIENT_ID || !GMAIL_CLIENT_SECRET || !GMAIL_REFRESH_TOKEN) {
        return { error: 'Gmail OAuth not configured' };
    }
    if (!lead.email || !lead.normalized_email) return { error: 'No email' };

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Check recipient lock
    const { data: locked } = await supabase
        .from('tc_recipient_locks').select('normalized_email').eq('normalized_email', lead.normalized_email).maybeSingle();
    if (locked) return { duplicate: true, error: `Already sent to ${lead.normalized_email}` };

    try {
        const accessToken = await getGmailAccessToken();
        const images = await getBestStagedImagePair();
        const { subject, html } = buildTCEmailBody(lead, images);

        const rawEmail = [
            `From: Kogflow <kogflow.media@gmail.com>`,
            `To: ${lead.email}`,
            `Subject: ${subject}`,
            `MIME-Version: 1.0`,
            `Content-Type: text/html; charset=utf-8`,
            '',
            html,
        ].join('\r\n');

        const encoded = Buffer.from(rawEmail).toString('base64url');

        const sendRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ raw: encoded }),
        });

        if (!sendRes.ok) {
            const err = await sendRes.json();
            return { error: `Gmail send failed: ${JSON.stringify(err)}` };
        }

        const sentMsg = await sendRes.json();

        // Apply "Outreach TC" Gmail label (best-effort, don't fail the send if it errors)
        const labelId = await getOrCreateTCLabel(accessToken);
        if (labelId && sentMsg.id) {
            await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${sentMsg.id}/modify`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ addLabelIds: [labelId] }),
            }).catch(() => {});
        }

        // Lock recipient
        await supabase.from('tc_recipient_locks').upsert({
            normalized_email: lead.normalized_email,
            lead_id: lead.id,
            sent_at: new Date().toISOString(),
        });

        // Update lead
        if (lead.id) {
            await supabase.from('tc_leads').update({
                status: 'emailed',
                email_sent_at: new Date().toISOString(),
                gmail_message_id: sentMsg.id,
                gmail_thread_id: sentMsg.threadId,
            }).eq('id', lead.id);
        }

        return { success: true };
    } catch (e: any) {
        return { error: e.message };
    }
}

// ─────────────────────────────────────────────
// SEND NEXT QUEUED EMAIL
// ─────────────────────────────────────────────

export async function sendNextQueuedTCEmail(): Promise<{ sent: number; skipped: number; failed: number; errors: string[]; debug: string[] }> {
    const supabase = createClient(supabaseUrl, supabaseKey);
    const debug: string[] = [];
    const errors: string[] = [];

    const { config } = await loadTCPipelineConfig();
    const dailyLimit = config?.emails_per_day ?? 30;

    const windowStart = new Date();
    windowStart.setHours(0, 0, 0, 0);
    const { count: sentToday } = await supabase
        .from('tc_leads')
        .select('*', { count: 'exact', head: true })
        .gte('email_sent_at', windowStart.toISOString());

    if ((sentToday ?? 0) >= dailyLimit) {
        debug.push(`Daily cap reached (${sentToday}/${dailyLimit})`);
        return { sent: 0, skipped: 1, failed: 0, errors, debug };
    }

    // Reset stale sending locks
    await supabase.from('tc_email_queue')
        .update({ status: 'queued', locked_at: null, updated_at: new Date().toISOString() })
        .eq('status', 'sending')
        .lt('locked_at', new Date(Date.now() - 10 * 60_000).toISOString())
        .then(null, () => {});

    const { data: claimedRows, error: claimError } = await supabase.rpc('claim_next_tc_email_queue_item');
    if (claimError) {
        errors.push(`Queue claim failed: ${claimError.message}`);
        return { sent: 0, skipped: 0, failed: 1, errors, debug };
    }

    const queueItem = Array.isArray(claimedRows) ? claimedRows[0] : claimedRows;
    if (!queueItem) {
        debug.push('No queued TC email ready');
        return { sent: 0, skipped: 0, failed: 0, errors, debug };
    }

    const { data: lead } = await supabase
        .from('tc_leads')
        .select('*')
        .eq('id', queueItem.lead_id)
        .maybeSingle();

    if (!lead) {
        await supabase.from('tc_email_queue').update({ status: 'failed', last_error: 'Lead not found' }).eq('id', queueItem.id);
        return { sent: 0, skipped: 0, failed: 1, errors: ['Lead not found'], debug };
    }

    if (lead.status === 'emailed') {
        await supabase.from('tc_email_queue').update({ status: 'skipped', last_error: 'Already emailed', locked_at: null }).eq('id', queueItem.id);
        return { sent: 0, skipped: 1, failed: 0, errors, debug };
    }

    const result = await sendTCOutreachEmail(lead);

    if (result.success) {
        const sentAt = new Date().toISOString();
        await supabase.from('tc_email_queue').update({ status: 'sent', sent_at: sentAt, locked_at: null, last_error: null, updated_at: sentAt }).eq('id', queueItem.id);
        debug.push(`Email sent -> ${lead.email} (${lead.company_name})`);
        return { sent: 1, skipped: 0, failed: 0, errors, debug };
    }

    if (result.duplicate) {
        await supabase.from('tc_email_queue').update({ status: 'skipped', last_error: result.error, locked_at: null }).eq('id', queueItem.id);
        await supabase.from('tc_leads').update({ status: 'skipped' }).eq('id', lead.id);
        debug.push(`Duplicate: ${lead.email}`);
        return { sent: 0, skipped: 1, failed: 0, errors, debug };
    }

    const attempts = Number(queueItem.attempts ?? 1);
    const finalFailure = attempts >= 3;
    await supabase.from('tc_email_queue').update({
        status: finalFailure ? 'failed' : 'queued',
        send_after: finalFailure ? queueItem.send_after : new Date(Date.now() + 15 * 60_000).toISOString(),
        locked_at: null,
        last_error: result.error,
        updated_at: new Date().toISOString(),
    }).eq('id', queueItem.id);

    errors.push(`Email failed (${lead.company_name}): ${result.error}`);
    return { sent: 0, skipped: 0, failed: 1, errors, debug };
}

// ─────────────────────────────────────────────
// STATS & RUNS
// ─────────────────────────────────────────────

export async function getTCLeadStats() {
    const supabase = createClient(supabaseUrl, supabaseKey);
    const { data } = await supabase.from('tc_leads').select('status, icp_score');
    const leads = data || [];
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const { count: sentToday } = await supabase
        .from('tc_leads').select('*', { count: 'exact', head: true })
        .gte('email_sent_at', today.toISOString());
    const { count: queued } = await supabase
        .from('tc_email_queue').select('*', { count: 'exact', head: true }).eq('status', 'queued');

    return {
        total: leads.length,
        new: leads.filter(l => l.status === 'new').length,
        queued: leads.filter(l => l.status === 'queued').length,
        emailed: leads.filter(l => l.status === 'emailed').length,
        skipped: leads.filter(l => l.status === 'skipped').length,
        sentToday: sentToday ?? 0,
        queueDepth: queued ?? 0,
        avgScore: leads.length ? Math.round(leads.reduce((s, l) => s + (l.icp_score || 0), 0) / leads.length) : 0,
    };
}

export async function getTCLeads(limit = 100, offset = 0) {
    const supabase = createClient(supabaseUrl, supabaseKey);
    const { data } = await supabase.from('tc_leads')
        .select('*').order('icp_score', { ascending: false }).range(offset, offset + limit - 1);
    return data || [];
}

export async function getTCRecentRuns(limit = 10) {
    const supabase = createClient(supabaseUrl, supabaseKey);
    const { data } = await supabase.from('tc_pipeline_runs')
        .select('*').order('ran_at', { ascending: false }).limit(limit);
    return data || [];
}

export async function logTCRun(run: { processed: number; emails_sent?: number; errors: string[]; debug: string[]; trigger: string }) {
    const supabase = createClient(supabaseUrl, supabaseKey);
    await supabase.from('tc_pipeline_runs').insert({
        processed: run.processed,
        emails_sent: run.emails_sent ?? 0,
        errors: run.errors,
        debug: run.debug,
        trigger: run.trigger,
        ran_at: new Date().toISOString(),
    });
}

export async function countTodayTCCronRuns(): Promise<number> {
    const supabase = createClient(supabaseUrl, supabaseKey);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const { count } = await supabase.from('tc_pipeline_runs')
        .select('*', { count: 'exact', head: true })
        .eq('trigger', 'cron')
        .gte('ran_at', today.toISOString());
    return count ?? 0;
}

export async function getTCReplies() {
    const supabase = createClient(supabaseUrl, supabaseKey);
    const { data } = await supabase.from('tc_leads')
        .select('id, company_name, email, city, gmail_thread_id, email_sent_at')
        .eq('status', 'emailed')
        .not('gmail_thread_id', 'is', null)
        .order('email_sent_at', { ascending: false })
        .limit(50);
    return data || [];
}
