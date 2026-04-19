'use server';

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const ZYTE_API_KEY = process.env.ZYTE_API_KEY!;
const MOONDREAM_API_KEY = process.env.MOONDREAM_API_KEY!;
const CAPMONSTER_API_KEY = process.env.CAPMONSTER_API_KEY!;
const KIE_API_KEY = process.env.KIE_AI_API_KEY!;

const GMAIL_CLIENT_ID = process.env.GMAIL_CLIENT_ID!;
const GMAIL_CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET!;
const GMAIL_REFRESH_TOKEN = process.env.GMAIL_REFRESH_TOKEN!;

// ─────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────

export interface ScrapedListing {
    address: string;
    city: string;
    price: number;
    daysOnMarket: number;
    priceReduced: boolean;
    photoCount: number;
    photos: string[];
    agentName: string;
    agentPhone?: string;
    agentEmail?: string;
    listingUrl: string;
    movotoMessageUrl?: string;
    keywords: string[];
    score?: number;
}

// ─────────────────────────────────────────────
// 1. ICP SCORING
// ─────────────────────────────────────────────

export async function scoreICP(listing: Partial<ScrapedListing>): Promise<number> {
    let score = 0;
    const kw = listing.keywords?.join(' ').toLowerCase() || '';

    if (kw.includes('vacant') || kw.includes('unfurnished') || kw.includes('immediate occupancy')) score += 40;
    if (listing.priceReduced) score += 25;
    if ((listing.daysOnMarket || 0) >= 60) score += 20;
    else if ((listing.daysOnMarket || 0) >= 30) score += 5;
    if ((listing.photoCount || 99) < 15) score += 10;

    return score;
}

// ─────────────────────────────────────────────
// 2. ZYTE SCRAPER — homes.com + HAR.com
// ─────────────────────────────────────────────

// City → homes.com URL slug lookup
const CITY_SLUGS: Record<string, string> = {
    'Phoenix': 'phoenix-az', 'Dallas': 'dallas-tx', 'Atlanta': 'atlanta-ga',
    'Charlotte': 'charlotte-nc', 'Nashville': 'nashville-tn', 'Tampa': 'tampa-fl',
    'Las Vegas': 'las-vegas-nv', 'Houston': 'houston-tx', 'Denver': 'denver-co',
    'Orlando': 'orlando-fl', 'Austin': 'austin-tx', 'Miami': 'miami-fl',
    'San Antonio': 'san-antonio-tx', 'Scottsdale': 'scottsdale-az',
    'Jacksonville': 'jacksonville-fl', 'Sacramento': 'sacramento-ca',
    'Portland': 'portland-or', 'Raleigh': 'raleigh-nc',
};


async function zyteGet(url: string, _city?: string): Promise<{ html?: string; error?: string }> {
    const payload: Record<string, any> = {
        url,
        browserHtml: true,
        // Route Zyte proxy through US (country code — not lat/lng)
        geolocation: 'US',
    };

    const res = await fetch('https://api.zyte.com/v1/extract', {
        method: 'POST',
        headers: {
            'Authorization': `Basic ${Buffer.from(`${ZYTE_API_KEY}:`).toString('base64')}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
    });
    if (!res.ok) return { error: `Zyte ${res.status}: ${await res.text()}` };
    const data = await res.json();
    return { html: data.browserHtml || '' };
}

// homes.com scraper — uses JSON-LD RealEstateListing schema
export async function scrapeHomesCity(city: string, maxListings: number = 20): Promise<{ listings?: ScrapedListing[]; rawHtmlSnippet?: string; error?: string }> {
    if (!ZYTE_API_KEY) return { error: 'ZYTE_API_KEY not configured' };

    const slug = CITY_SLUGS[city] || city.toLowerCase().replace(/\s+/g, '-');
    // Extract expected 2-letter state from slug (e.g. "phoenix-az" → "AZ")
    const expectedState = slug.split('-').pop()?.toUpperCase() || '';
    const url = `https://www.homes.com/homes-for-sale/${slug}/`;

    try {
        const { html, error } = await zyteGet(url, city);
        if (error || !html) return { error: error || 'No HTML' };

        const rawHtmlSnippet = html.slice(0, 2000);
        const listings: ScrapedListing[] = [];

        // Parse JSON-LD @graph — find the block with itemListElement
        const allJsonLd = [...html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)];
        let items: any[] = [];
        for (const match of allJsonLd) {
            try {
                const parsed = JSON.parse(match[1]);
                const candidates = parsed?.['@graph']?.[0]?.mainEntity?.itemListElement
                    || parsed?.mainEntity?.itemListElement
                    || [];
                if (candidates.length > items.length) items = candidates;
            } catch { continue; }
        }
        if (items.length === 0) return { listings: [], rawHtmlSnippet, error: 'No JSON-LD itemListElement found' };

        for (const item of items.slice(0, maxListings)) {
            const addr = item?.mainEntity?.address;
            if (!addr?.streetAddress) continue;

            // Filter by state to ensure we got city-specific listings, not national featured
            if (expectedState && addr.addressRegion && addr.addressRegion.toUpperCase() !== expectedState) continue;

            // Filter by price range
            const price = item?.offers?.price || 0;
            if (price < 150000 || price > 700000) continue;

            const agent = item?.offers?.offeredBy;
            const photo = item?.image || item?.mainEntity?.image || '';

            const listing: ScrapedListing = {
                address: addr.streetAddress,
                city: addr.addressLocality || city,
                price,
                daysOnMarket: 0,
                priceReduced: false,
                photoCount: photo ? 1 : 0,
                photos: photo ? [photo] : [],
                agentName: agent?.name || '',
                agentPhone: agent?.telephone || '',
                listingUrl: item?.url || item?.mainEntity?.url || url,
                keywords: [item?.description || ''].filter(Boolean),
            };
            listing.score = await scoreICP(listing);
            listings.push(listing);
        }

        return { listings, rawHtmlSnippet };
    } catch (error: any) {
        return { error: error.message };
    }
}

// HAR.com scraper — uses embedded JSON array (Texas MLS data)
// Supports multi-page fetch to maximise listing yield per city
export async function scrapeHarCity(city: string, maxListings: number = 40, pages: number = 2): Promise<{ listings?: ScrapedListing[]; rawHtmlSnippet?: string; error?: string }> {
    if (!ZYTE_API_KEY) return { error: 'ZYTE_API_KEY not configured' };

    const baseUrl = `https://www.har.com/search/dosearch?type=residential&minprice=150000&maxprice=700000&status=A&city=${encodeURIComponent(city)}`;

    // Helper: parse a single HAR page HTML into listing rows
    function parseHarHtml(html: string): any[] {
        const idx = html.indexOf('"FULLSTREETADDRESS"');
        if (idx === -1) return [];
        const start = html.lastIndexOf('[{', idx);
        if (start === -1) return [];
        let depth = 0, end = start;
        for (let i = start; i < Math.min(start + 2000000, html.length); i++) {
            const ch = html[i];
            if (ch === '[' || ch === '{') depth++;
            else if (ch === ']' || ch === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
        }
        if (end <= start) return [];
        try { return JSON.parse(html.slice(start, end)); } catch { return []; }
    }

    try {
        // Fetch pages in parallel (page 1 + extra pages simultaneously)
        const pageUrls = Array.from({ length: pages }, (_, i) =>
            i === 0 ? baseUrl : `${baseUrl}&p=${i + 1}`
        );
        const pageResults = await Promise.all(pageUrls.map(url => zyteGet(url, city)));

        const rawHtmlSnippet = pageResults[0]?.html?.slice(0, 2000) || '';
        if (pageResults[0]?.error) return { error: pageResults[0].error };

        // Merge all rows, deduplicate by FULLSTREETADDRESS
        const seen = new Set<string>();
        const allRows: any[] = [];
        for (const { html } of pageResults) {
            if (!html) continue;
            for (const row of parseHarHtml(html)) {
                if (row.FULLSTREETADDRESS && !seen.has(row.FULLSTREETADDRESS)) {
                    seen.add(row.FULLSTREETADDRESS);
                    allRows.push(row);
                }
            }
        }

        if (allRows.length === 0) return { listings: [], rawHtmlSnippet, error: 'No listing data in HAR HTML' };

        const arr = allRows;
        const listings: ScrapedListing[] = [];

        for (const item of arr.slice(0, maxListings)) {
            if (!item.FULLSTREETADDRESS) continue;
            const price = item.LISTPRICE || 0;
            if (price < 150000 || price > 700000) continue;

            const photo = item.PHOTOPRIMARY || '';
            const priceReduced = item.LASTREDUCED && item.LISTPRICE < item.LISTPRICEORI;

            const listing: ScrapedListing = {
                address: `${item.FULLSTREETADDRESS}, ${item.CITY}, ${item.STATE} ${item.ZIP}`,
                city: item.CITY || city,
                price,
                daysOnMarket: item.DOM || item.DAYSONMARKET || 0,
                priceReduced: !!priceReduced,
                photoCount: item.PHOTOCOUNT || 0,
                photos: photo ? [photo] : [],
                agentName: item.AGENTLISTNAME || '',
                agentPhone: item.OFFICELISTPHONE || '',
                agentEmail: item.OFFICEEMAIL || '',
                listingUrl: item.PROPERTY_URL ? `https://www.har.com${item.PROPERTY_URL}` : baseUrl,
                keywords: [item.SUBDIVISION || '', item.ARCHITECTURESTYLE || ''].filter(Boolean),
            };
            listing.score = await scoreICP(listing);
            listings.push(listing);
        }

        return { listings, rawHtmlSnippet };
    } catch (error: any) {
        return { error: error.message };
    }
}

// Legacy — kept for reference but no longer called
export async function scrapeMovotoCity(city: string, maxListings: number = 10): Promise<{ listings?: ScrapedListing[]; rawHtmlSnippet?: string; error?: string }> {
    if (!ZYTE_API_KEY) return { error: 'ZYTE_API_KEY not configured' };

    try {
        const searchUrl = `https://www.movoto.com/search/?city=${encodeURIComponent(city)}&sort=listed_asc&priceLow=200000&priceHigh=600000&propertyTypes=single-family,condo`;

        const zyteRes = await fetch('https://api.zyte.com/v1/extract', {
            method: 'POST',
            headers: {
                'Authorization': `Basic ${Buffer.from(`${ZYTE_API_KEY}:`).toString('base64')}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                url: searchUrl,
                browserHtml: true,
                httpResponseBody: false,
            }),
        });

        if (!zyteRes.ok) {
            const err = await zyteRes.text();
            return { error: `Zyte error ${zyteRes.status}: ${err}` };
        }

        const zyteData = await zyteRes.json();
        const html: string = zyteData.browserHtml || '';
        const rawHtmlSnippet = html.slice(0, 3000);

        const listings: ScrapedListing[] = [];

        // Strategy 1: Next.js __NEXT_DATA__ JSON blob (most reliable for Next.js apps)
        const nextDataMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
        if (nextDataMatch) {
            try {
                const nextData = JSON.parse(nextDataMatch[1]);
                // Walk common pageProps paths Movoto might use
                const candidates = [
                    nextData?.props?.pageProps?.listings,
                    nextData?.props?.pageProps?.searchResults,
                    nextData?.props?.pageProps?.properties,
                    nextData?.props?.pageProps?.data?.listings,
                    nextData?.props?.pageProps?.initialData?.listings,
                ].find(v => Array.isArray(v) && v.length > 0);

                if (candidates) {
                    for (const item of candidates.slice(0, maxListings)) {
                        const address = item?.address || item?.streetAddress || item?.location?.address || '';
                        const price = parseInt(item?.price || item?.listPrice || item?.listing?.price || 0);
                        const photos: string[] = item?.photos?.map((p: any) => p?.url || p?.src || p) ||
                                                  item?.images?.map((p: any) => p?.url || p?.src || p) || [];
                        if (!address) continue;
                        const listing: ScrapedListing = {
                            address,
                            city,
                            price,
                            daysOnMarket: item?.daysOnMarket || item?.dom || 0,
                            priceReduced: !!(item?.priceReduced || item?.priceChange),
                            photoCount: photos.length,
                            photos: photos.filter((p: any) => typeof p === 'string' && p.startsWith('http')),
                            agentName: item?.agent?.name || item?.listingAgent?.name || '',
                            agentPhone: item?.agent?.phone || item?.listingAgent?.phone,
                            agentEmail: item?.agent?.email || item?.listingAgent?.email,
                            listingUrl: item?.url ? `https://www.movoto.com${item.url}` : searchUrl,
                            keywords: [item?.description || ''].filter(Boolean),
                        };
                        listing.score = await scoreICP(listing);
                        listings.push(listing);
                    }
                }
            } catch { /* fall through to regex */ }
        }

        // Strategy 2: JSON-LD schema.org blocks
        if (listings.length === 0) {
            const jsonLdMatches = [...html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)];
            for (const match of jsonLdMatches) {
                try {
                    const data = JSON.parse(match[1]);
                    const items = data['@graph'] || (Array.isArray(data) ? data : [data]);
                    for (const item of items) {
                        if (!item?.address?.streetAddress && !item?.streetAddress) continue;
                        const address = item?.address?.streetAddress || item?.streetAddress || '';
                        const photos: string[] = (item?.photo || item?.image || [])
                            .map((p: any) => typeof p === 'string' ? p : p?.url || p?.contentUrl)
                            .filter((p: any) => typeof p === 'string' && p.startsWith('http'));
                        const listing: ScrapedListing = {
                            address,
                            city,
                            price: parseInt(item?.offers?.price || item?.price || 0),
                            daysOnMarket: 0,
                            priceReduced: false,
                            photoCount: photos.length,
                            photos,
                            agentName: item?.agent?.name || '',
                            listingUrl: item?.url || searchUrl,
                            keywords: [item?.description || ''].filter(Boolean),
                        };
                        listing.score = await scoreICP(listing);
                        listings.push(listing);
                        if (listings.length >= maxListings) break;
                    }
                } catch { continue; }
                if (listings.length >= maxListings) break;
            }
        }

        // Strategy 3: Regex fallback
        if (listings.length === 0) {
            const addressMatches = [...html.matchAll(/"streetAddress"\s*:\s*"([^"]+)"/g)];
            const priceMatches = [...html.matchAll(/"(?:price|listPrice)"\s*:\s*"?\$?([\d,]+)"?/g)];
            const photoMatches = [...html.matchAll(/"(?:photoUrl|imageUrl|src)"\s*:\s*"(https:[^"]+\.(?:jpg|jpeg|png|webp)[^"]*)"/g)];

            const addresses = addressMatches.map(m => m[1]);
            const prices = priceMatches.map(m => parseInt(m[1].replace(/,/g, '')));
            const allPhotos = photoMatches.map(m => m[1]);

            const priceReduced = html.toLowerCase().includes('price reduced') || html.toLowerCase().includes('price cut');

            for (let i = 0; i < Math.min(addresses.length, maxListings); i++) {
                const photos = allPhotos.slice(i * 5, i * 5 + 5);
                const listing: ScrapedListing = {
                    address: addresses[i],
                    city,
                    price: prices[i] || 0,
                    daysOnMarket: 0,
                    priceReduced,
                    photoCount: photos.length,
                    photos,
                    agentName: '',
                    listingUrl: searchUrl,
                    keywords: [],
                };
                listing.score = await scoreICP(listing);
                listings.push(listing);
            }
        }

        return { listings, rawHtmlSnippet };

    } catch (error: any) {
        return { error: error.message };
    }
}

// ─────────────────────────────────────────────
// 2b. ZYTE AUTO-EXTRACT — Richer structured data
// ─────────────────────────────────────────────

export async function extractListingDetails(listingUrl: string): Promise<{ data?: any; error?: string }> {
    if (!ZYTE_API_KEY) return { error: 'ZYTE_API_KEY not configured' };

    try {
        const res = await fetch('https://api.zyte.com/v1/extract', {
            method: 'POST',
            headers: {
                'Authorization': `Basic ${Buffer.from(`${ZYTE_API_KEY}:`).toString('base64')}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                url: listingUrl,
                browserHtml: true,
                realEstate: true, // Zyte AutoExtract for real estate
            }),
        });

        if (!res.ok) return { error: `Zyte extract error: ${res.status}` };
        const data = await res.json();
        return { data };

    } catch (error: any) {
        return { error: error.message };
    }
}

// ─────────────────────────────────────────────
// 3. MOONDREAM — Room detection
// ─────────────────────────────────────────────

export async function detectRoom(imageUrl: string): Promise<{
    isEmpty: boolean;
    confidence: number;
    roomType: string;
    error?: string;
}> {
    if (!MOONDREAM_API_KEY) return { isEmpty: false, confidence: 0, roomType: 'unknown', error: 'MOONDREAM_API_KEY not configured' };

    try {
        // Moondream requires base64 — fetch the image with browser-like headers to bypass hotlink protection
        const imageOrigin = new URL(imageUrl).origin;
        const imgRes = await fetch(imageUrl, {
            headers: {
                'Referer': imageOrigin,
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
                'Cache-Control': 'no-cache',
            },
        });
        if (!imgRes.ok) return { isEmpty: false, confidence: 0, roomType: 'unknown', error: `Image fetch failed: ${imgRes.status}` };

        const contentType = imgRes.headers.get('content-type') || 'image/jpeg';
        const arrayBuffer = await imgRes.arrayBuffer();
        const base64 = Buffer.from(arrayBuffer).toString('base64');
        const imageData = `data:${contentType};base64,${base64}`;

        const res = await fetch('https://api.moondream.ai/v1/query', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${MOONDREAM_API_KEY}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                image: imageData,
                question: 'What furniture and objects do you see in this room? Be specific and list every item you can see.',
                stream: false,
            }),
        });

        if (!res.ok) {
            const err = await res.text();
            return { isEmpty: false, confidence: 0, roomType: 'unknown', error: `Moondream error ${res.status}: ${err}` };
        }

        const data = await res.json();
        const answer: string = (data.answer || data.result || '').toLowerCase();

        // Keywords that indicate furniture/furnishings — if any match, room is NOT empty
        const FURNITURE_KEYWORDS = [
            'sofa', 'couch', 'chair', 'table', 'bed', 'desk', 'dresser', 'cabinet',
            'shelf', 'bookshelf', 'bookcase', 'wardrobe', 'television', 'tv', 'lamp',
            'rug', 'carpet', 'curtain', 'blinds', 'artwork', 'picture', 'mirror',
            'stove', 'refrigerator', 'fridge', 'dishwasher', 'sink', 'toilet', 'bathtub',
            'shower', 'vanity', 'counter', 'island', 'appliance', 'fireplace', 'ceiling fan',
        ];

        // Phrases that confirm the room is empty
        const EMPTY_KEYWORDS = [
            'empty room', 'no furniture', 'bare', 'unfurnished', 'vacant',
            'nothing in', 'no objects', 'no items', 'does not contain any',
            'there is nothing', 'i don\'t see any furniture', 'i do not see any furniture',
            'no visible furniture', 'appears to be empty', 'room is empty',
        ];

        const hasFurniture = FURNITURE_KEYWORDS.some(kw => answer.includes(kw));
        const confirmsEmpty = EMPTY_KEYWORDS.some(kw => answer.includes(kw));

        // Room must have NO furniture keywords AND at least one empty-confirming phrase
        const isEmpty = !hasFurniture && confirmsEmpty;
        const confidence = isEmpty ? 90 : hasFurniture ? 0 : 0;

        // Guess room type from description
        const roomType = answer.includes('bedroom') || answer.includes('bed') ? 'bedroom'
            : answer.includes('living') ? 'living room'
            : answer.includes('kitchen') ? 'kitchen'
            : answer.includes('dining') ? 'dining room'
            : answer.includes('bathroom') || answer.includes('bath') ? 'bathroom'
            : 'room';

        return { isEmpty, confidence, roomType };

    } catch (error: any) {
        return { isEmpty: false, confidence: 0, roomType: 'unknown', error: error.message };
    }
}

// ─────────────────────────────────────────────
// 4. CAPMONSTER — CAPTCHA solving
// ─────────────────────────────────────────────

export async function solveRecaptcha(websiteUrl: string, websiteKey: string): Promise<{ token?: string; error?: string }> {
    if (!CAPMONSTER_API_KEY) return { error: 'CAPMONSTER_API_KEY not configured' };

    try {
        // Create task
        const createRes = await fetch('https://api.capmonster.cloud/createTask', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                clientKey: CAPMONSTER_API_KEY,
                task: {
                    type: 'RecaptchaV2TaskProxyless',
                    websiteURL: websiteUrl,
                    websiteKey: websiteKey,
                },
            }),
        });

        const createData = await createRes.json();
        if (createData.errorId !== 0) return { error: `CapMonster create error: ${createData.errorDescription}` };

        const taskId = createData.taskId;

        // Poll for result (up to 60 seconds)
        for (let i = 0; i < 12; i++) {
            await new Promise(r => setTimeout(r, 5000));

            const resultRes = await fetch('https://api.capmonster.cloud/getTaskResult', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ clientKey: CAPMONSTER_API_KEY, taskId }),
            });

            const resultData = await resultRes.json();
            if (resultData.status === 'ready') {
                return { token: resultData.solution?.gRecaptchaResponse };
            }
        }

        return { error: 'CAPTCHA solving timed out' };

    } catch (error: any) {
        return { error: error.message };
    }
}

// ─────────────────────────────────────────────
// 5. SUPABASE — Save & retrieve leads
// ─────────────────────────────────────────────

export async function saveLead(listing: ScrapedListing & { emptyRooms?: { roomType: string; imageUrl: string; stagedUrl?: string }[] }) {
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Check Do Not Contact list
    const { data: existing } = await supabase
        .from('outreach_leads')
        .select('id')
        .eq('address', listing.address)
        .single();

    if (existing) return { skipped: true, reason: 'Already in database' };

    const { data, error } = await supabase
        .from('outreach_leads')
        .insert({
            address: listing.address,
            city: listing.city,
            price: listing.price,
            days_on_market: listing.daysOnMarket,
            price_reduced: listing.priceReduced,
            photo_count: listing.photoCount,
            agent_name: listing.agentName,
            agent_phone: listing.agentPhone,
            agent_email: listing.agentEmail,
            listing_url: listing.listingUrl,
            keywords: listing.keywords,
            icp_score: listing.score || 0,
            empty_rooms: listing.emptyRooms || [],
            status: 'scraped',
        })
        .select()
        .single();

    if (error) return { error: error.message };
    return { success: true, lead: data };
}

export async function getLeads(status?: string, limit = 50) {
    const supabase = createClient(supabaseUrl, supabaseKey);

    let query = supabase
        .from('outreach_leads')
        .select('*')
        .order('icp_score', { ascending: false })
        .limit(limit);

    if (status) query = query.eq('status', status);

    const { data, error } = await query;
    if (error) return { error: error.message };
    return { leads: data || [] };
}

export async function updateLeadStatus(id: string, status: string, updates?: any) {
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { error } = await supabase
        .from('outreach_leads')
        .update({ status, ...updates })
        .eq('id', id);

    if (error) return { error: error.message };
    return { success: true };
}

// Submit a small batch of leads to Kie.ai (2-3 at a time to avoid timeouts)
export async function submitStagingBatch(limit = 3): Promise<{ submitted: number; failed: number; errors: string[] }> {
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data, error } = await supabase
        .from('outreach_leads')
        .select('id, address, empty_rooms')
        .eq('status', 'scraped')
        .not('empty_rooms', 'eq', '[]')
        .limit(limit);

    if (error) return { submitted: 0, failed: 0, errors: [error.message] };

    const pending = (data || []).filter((l: any) => Array.isArray(l.empty_rooms) && l.empty_rooms.length > 0);
    let submitted = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const lead of pending) {
        const room = lead.empty_rooms[0];
        const { taskId, error: stageErr } = await stageEmptyRoom(room.imageUrl, room.roomType || 'room');
        if (taskId) {
            await updateLeadStatus(lead.id, 'staged', { staging_task_id: taskId });
            submitted++;
        } else {
            failed++;
            errors.push(`${lead.address}: ${stageErr}`);
        }
        // Small delay between submissions to avoid Kie.ai rate limiting
        if (pending.indexOf(lead) < pending.length - 1) {
            await new Promise(r => setTimeout(r, 5000));
        }
    }

    return { submitted, failed, errors };
}

// Upload a remote image URL to Supabase storage and return the permanent public URL.
// Kie.ai returns tempfile.aiquickdraw.com URLs that expire — this makes them permanent.
async function uploadStagedImage(tempUrl: string, leadId: string): Promise<string> {
    const supabase = createClient(supabaseUrl, supabaseKey);
    try {
        const res = await fetch(tempUrl);
        if (!res.ok) return tempUrl; // fall back to temp URL if fetch fails
        const buffer = Buffer.from(await res.arrayBuffer());
        const path = `outreach/staged/${leadId}.jpg`;
        const { error } = await supabase.storage.from('uploads').upload(path, buffer, {
            contentType: 'image/jpeg',
            upsert: true,
        });
        if (error) return tempUrl;
        const { data } = supabase.storage.from('uploads').getPublicUrl(path);
        return data.publicUrl;
    } catch {
        return tempUrl;
    }
}

// Poll all staged leads, save the generated image URL, then send outreach email
export async function pollAndEmailStagedLeads(): Promise<{ emailed: number; stillProcessing: number; failed: number; errors: string[] }> {
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data, error } = await supabase
        .from('outreach_leads')
        .select('id, address, agent_name, agent_email, empty_rooms, staging_task_id')
        .eq('status', 'staged')
        .not('staging_task_id', 'is', null);

    if (error) return { emailed: 0, stillProcessing: 0, failed: 0, errors: [error.message] };

    let emailed = 0;
    let stillProcessing = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const lead of (data || [])) {
        const result = await checkStagingResult(lead.staging_task_id);

        if (result.status === 'success' && result.url) {
            // Upload staged image to permanent Supabase storage (Kie.ai URLs expire)
            const permanentUrl = await uploadStagedImage(result.url, lead.id);

            // Save permanent URL into empty_rooms[0].stagedUrl
            const updatedRooms = [...(lead.empty_rooms || [])];
            if (updatedRooms[0]) updatedRooms[0].stagedUrl = permanentUrl;
            await supabase.from('outreach_leads').update({ empty_rooms: updatedRooms }).eq('id', lead.id);

            // Send outreach email if agent has an email
            if (lead.agent_email) {
                const emailResult = await sendOutreachEmail({
                    agentName: lead.agent_name,
                    agentEmail: lead.agent_email,
                    address: lead.address,
                    stagedImageUrl: permanentUrl,
                    beforeImageUrl: lead.empty_rooms?.[0]?.imageUrl,
                });
                if (emailResult.success) {
                    await updateLeadStatus(lead.id, 'emailed', { email_sent_at: new Date().toISOString() });
                    emailed++;
                } else {
                    errors.push(`Email failed ${lead.address}: ${emailResult.error}`);
                    failed++;
                }
            } else {
                // No email — still mark progress
                await updateLeadStatus(lead.id, 'form_filled');
                errors.push(`No email for ${lead.address} — staged image saved`);
            }
        } else if (result.status === 'processing') {
            stillProcessing++;
        } else {
            // failed or error — reset to scraped so it can be retried
            await updateLeadStatus(lead.id, 'scraped', { staging_task_id: null });
            failed++;
            errors.push(`Generation failed ${lead.address}: ${result.error}`);
        }
    }

    return { emailed, stillProcessing, failed, errors };
}

export async function getLeadStats() {
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data, error } = await supabase
        .from('outreach_leads')
        .select('status, icp_score, photo_count, empty_rooms');

    if (error) return { error: error.message };

    const stats = {
        total: data?.length || 0,
        scraped: data?.filter(l => l.status === 'scraped').length || 0,
        scored: data?.filter(l => l.status === 'scored').length || 0,
        staged: data?.filter(l => l.status === 'staged').length || 0,
        form_filled: data?.filter(l => l.status === 'form_filled').length || 0,
        emailed: data?.filter(l => l.status === 'emailed').length || 0,
        avgScore: data?.length ? Math.round(data.reduce((s, l) => s + (l.icp_score || 0), 0) / data.length) : 0,
        totalPhotos: data?.reduce((s, l) => s + (l.photo_count || 0), 0) || 0,
        leadsWithPhotos: data?.filter(l => (l.photo_count || 0) > 0).length || 0,
        emptyRoomsFound: data?.filter(l => Array.isArray(l.empty_rooms) && l.empty_rooms.length > 0).length || 0,
    };

    return { stats };
}

// ─────────────────────────────────────────────
// 6. KIE.AI — Stage empty room
// ─────────────────────────────────────────────

export async function stageEmptyRoom(imageUrl: string, roomType: string): Promise<{ taskId?: string; error?: string }> {
    if (!KIE_API_KEY) return { error: 'KIE_AI_API_KEY not configured' };

    try {
        const prompt = `Add fully furnished ${roomType} decor in modern contemporary style. Keep all structural elements (walls, windows, floor, ceiling) identical. High quality, photorealistic real estate photography.`;

        const res = await fetch('https://api.kie.ai/api/v1/jobs/createTask', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${KIE_API_KEY}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: 'google/nano-banana-edit',
                input: {
                    prompt,
                    image_input: [imageUrl],
                    aspect_ratio: 'auto',
                },
            }),
        });

        const data = await res.json();
        if (!res.ok || (data.code && data.code !== 200)) {
            return { error: data.msg || `Kie.ai error: ${res.status}` };
        }
        const taskId = data.data?.taskId;
        if (!taskId) return { error: `No taskId returned (response: ${JSON.stringify(data).slice(0, 100)})` };
        return { taskId };

    } catch (error: any) {
        return { error: error.message };
    }
}

export async function checkStagingResult(taskId: string): Promise<{ status: string; url?: string; error?: string }> {
    if (!KIE_API_KEY) return { status: 'error', error: 'KIE_AI_API_KEY not configured' };

    try {
        const res = await fetch(`https://api.kie.ai/api/v1/jobs/recordInfo?taskId=${taskId}`, {
            headers: { 'Authorization': `Bearer ${KIE_API_KEY}` },
            cache: 'no-store',
        });

        if (!res.ok) return { status: 'error', error: `Kie.ai error: ${res.status}` };

        const data = await res.json();
        const state = data.data?.state;

        if (state === 'success') {
            const resultJson = JSON.parse(data.data.resultJson || '{}');
            const url = resultJson.resultUrls?.[0];
            return { status: 'success', url };
        } else if (state === 'failed') {
            return { status: 'failed', error: data.data?.failMsg || 'Generation failed' };
        }

        return { status: 'processing' };

    } catch (error: any) {
        return { status: 'error', error: error.message };
    }
}

// ─────────────────────────────────────────────
// 7. GMAIL — Send outreach email
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

export async function sendOutreachEmail(lead: {
    agentName: string;
    agentEmail: string;
    address: string;
    stagedImageUrl?: string;
    beforeImageUrl?: string;
}): Promise<{ success?: boolean; error?: string }> {
    if (!GMAIL_CLIENT_ID || !GMAIL_CLIENT_SECRET || !GMAIL_REFRESH_TOKEN) {
        return { error: 'Gmail OAuth credentials not configured' };
    }
    if (!lead.agentEmail) return { error: 'No agent email' };

    try {
        const accessToken = await getGmailAccessToken();

        // ASCII-only subject — avoid non-ASCII chars (em dashes etc.) that cause garbled encoding in some clients
        const subject = `Free virtual staging sample for your listing at ${lead.address}`;

        const imagesHtml = lead.stagedImageUrl ? `
        <table width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0;">
          <tr>
            <td align="center" style="padding:0 0 12px 0;">
              <p style="margin:0 0 6px 0;font-size:13px;color:#666;font-weight:600;text-transform:uppercase;letter-spacing:1px;">BEFORE</p>
              ${lead.beforeImageUrl ? `<a href="${lead.beforeImageUrl}" target="_blank" style="display:block;"><img src="${lead.beforeImageUrl}" alt="Before - empty room" width="540" style="display:block;width:100%;max-width:540px;height:auto;border-radius:6px;border:1px solid #e5e7eb;" /></a>` : ''}
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:0;">
              <p style="margin:0 0 6px 0;font-size:13px;color:#7c3aed;font-weight:600;text-transform:uppercase;letter-spacing:1px;">VIRTUALLY STAGED BY KOGFLOW</p>
              <a href="${lead.stagedImageUrl}" target="_blank" style="display:block;"><img src="${lead.stagedImageUrl}" alt="Virtually staged room" width="540" style="display:block;width:100%;max-width:540px;height:auto;border-radius:6px;border:2px solid #7c3aed;" /></a>
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
            <p style="margin:0 0 16px;font-size:16px;color:#111827;">Hi ${lead.agentName || 'there'},</p>
            <p style="margin:0 0 16px;font-size:15px;color:#374151;line-height:1.6;">
              I noticed your listing at <strong>${lead.address}</strong> and took the liberty of virtually staging one of the empty rooms as a free preview.
            </p>
            ${imagesHtml}
            <p style="margin:16px 0;font-size:15px;color:#374151;line-height:1.6;">
              Virtual staging helps buyers visualize the space and typically leads to faster sales and stronger offers. We generate results like this in seconds at <a href="https://kogflow.com" style="color:#7c3aed;">Kogflow.com</a>.
            </p>
            <p style="margin:0 0 16px;font-size:15px;color:#374151;line-height:1.6;">
              We can also turn these virtually staged rooms into <strong>virtual video walkthroughs</strong> -- giving buyers an immersive tour experience without ever stepping foot in the property.
            </p>
            <p style="margin:0 0 24px;font-size:15px;color:#374151;line-height:1.6;">
              Happy to send a few more free samples for this listing if you're interested.
            </p>
            <table cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
              <tr>
                <td style="background:#7c3aed;border-radius:8px;padding:12px 24px;">
                  <a href="https://kogflow.com" style="color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;">See More Examples</a>
                </td>
              </tr>
            </table>
            <p style="margin:0;font-size:15px;color:#374151;">Best,<br><strong>Minh</strong><br><a href="https://kogflow.com" style="color:#7c3aed;">Kogflow.com</a></p>
          </td>
        </tr>
        <tr>
          <td style="background:#f3f4f6;padding:16px 32px;">
            <p style="margin:0;font-size:12px;color:#9ca3af;">You received this because your listing at ${lead.address} is publicly listed. To unsubscribe reply with "unsubscribe".</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

        // RFC 2822 with HTML content type
        const message = [
            `From: Kogflow <kogflow.media@gmail.com>`,
            `To: ${lead.agentEmail}`,
            `Subject: ${subject}`,
            `MIME-Version: 1.0`,
            `Content-Type: text/html; charset=utf-8`,
            ``,
            html,
        ].join('\r\n');

        const encoded = Buffer.from(message).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

        const sendRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ raw: encoded }),
        });

        if (!sendRes.ok) {
            const err = await sendRes.text();
            return { error: `Gmail send error ${sendRes.status}: ${err}` };
        }

        return { success: true };

    } catch (error: any) {
        return { error: error.message };
    }
}

// ─────────────────────────────────────────────
// 7b. LISTING PHOTO FETCHER — Get all room photos from HAR detail page
// ─────────────────────────────────────────────

// Fetches the HAR.com listing detail page and extracts all photo URLs.
// HAR search results only include the primary photo; the detail page
// renders up to ~15–20 photos in the initial HTML.
async function getHarListingPhotos(propertyUrl: string, maxPhotos = 10): Promise<string[]> {
    if (!propertyUrl) return [];
    const fullUrl = propertyUrl.startsWith('http') ? propertyUrl : `https://www.har.com${propertyUrl}`;

    try {
        // Direct fetch — HAR.com allows it and returns in ~700ms vs Zyte's 10-15s
        const res = await fetch(fullUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml',
                'Accept-Language': 'en-US,en;q=0.9',
            },
        });
        if (!res.ok) return [];
        const html = await res.text();

        const urls = [
            ...new Set(
                [...html.matchAll(/https:\/\/mediahar\.harstatic\.com\/[^"'\s]+\/lr\/[^"'\s]+\.jpeg/g)]
                    .map(m => m[0])
            ),
        ];
        return urls.slice(0, maxPhotos);
    } catch {
        return [];
    }
}

// Scan top leads for empty rooms by fetching HAR detail pages (separate from main pipeline)
// Checks up to `limit` leads at a time; each requires 1 Zyte call + Moondream on interior photos
// Scan top leads for empty rooms — 3 leads at a time, 3 interior photos each
// Each lead: ~15s Zyte + 3×6s Moondream = ~33s → 3 leads ≈ 100s total
export async function scanForEmptyRooms(limit = 3): Promise<{ scanned: number; found: number; errors: string[] }> {
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data, error } = await supabase
        .from('outreach_leads')
        .select('id, address, listing_url, icp_score')
        .eq('status', 'scraped')
        .eq('empty_rooms', '[]')
        .not('listing_url', 'is', null)
        .like('listing_url', '%har.com%')
        .order('icp_score', { ascending: false })
        .limit(limit);

    if (error) return { scanned: 0, found: 0, errors: [error.message] };

    let scanned = 0;
    let found = 0;
    const errors: string[] = [];

    for (const lead of (data || [])) {
        scanned++;
        // Fetch up to 4 photos total, skip first (exterior), check photos[1..3] (interior)
        const photos = await getHarListingPhotos(lead.listing_url, 4);
        const interiorPhotos = photos.slice(1, 4);
        const emptyRooms: { roomType: string; imageUrl: string }[] = [];

        for (const photoUrl of interiorPhotos) {
            const { isEmpty, confidence, roomType, error: roomErr } = await detectRoom(photoUrl);
            if (roomErr) { errors.push(`${lead.address}: ${roomErr}`); continue; }
            if (isEmpty && confidence >= 80) {
                emptyRooms.push({ roomType, imageUrl: photoUrl });
                break;
            }
        }

        if (emptyRooms.length > 0) {
            await supabase.from('outreach_leads').update({ empty_rooms: emptyRooms }).eq('id', lead.id);
            found++;
        }
    }

    return { scanned, found, errors };
}

// ─────────────────────────────────────────────
// 8. PIPELINE RUNNER — Orchestrates everything
// ─────────────────────────────────────────────

export async function getSessionLog(sessionId: string): Promise<{ logs?: string[]; error?: string }> {
    const supabase = createClient(supabaseUrl, supabaseKey);
    const { data, error } = await supabase
        .from('pipeline_session_log')
        .select('message')
        .eq('session_id', sessionId)
        .order('logged_at', { ascending: true });
    if (error) return { error: error.message };
    return { logs: data?.map(r => r.message) || [] };
}

export async function runPipelineSession(config: {
    cities: string[];
    scrapesPerSession: number;
    sessionId?: string;
    minLeads?: number;
    minEmptyRooms?: number;
}): Promise<{ processed: number; errors: string[]; debug: string[]; sessionId: string }> {
    const supabase = createClient(supabaseUrl, supabaseKey);
    const sessionId = config.sessionId || crypto.randomUUID();
    const errors: string[] = [];
    const debug: string[] = [];
    let processed = 0;
    const minEmptyRooms = config.minEmptyRooms ?? 5;
    // Each city gets at least 50 listings so we don't re-fetch the same ~20 every run
    const batchSize = Math.max(50, Math.ceil(config.scrapesPerSession / Math.max(config.cities.length, 1)));

    // Buffer log writes — flush to DB every 5 lines to keep Supabase calls low
    let logBuffer: string[] = [];
    async function log(msg: string) {
        debug.push(msg);
        logBuffer.push(msg);
        if (logBuffer.length >= 5) {
            const batch = logBuffer.splice(0);
            await supabase.from('pipeline_session_log').insert(
                batch.map(message => ({ session_id: sessionId, message }))
            ).then(() => {});
        }
    }
    async function flushLog() {
        if (logBuffer.length > 0) {
            const batch = logBuffer.splice(0);
            await supabase.from('pipeline_session_log').insert(
                batch.map(message => ({ session_id: sessionId, message }))
            );
        }
    }

    await log(`Session ${sessionId} started`);
    await log(`Scraping ${config.cities.length} cities in parallel (${batchSize} listings each, 2 HAR pages)...`);

    // ── Step 1: Scrape all cities via HAR (+ homes.com fallback) in parallel ──
    // City lambdas push into local arrays then we log after all resolve
    const cityResults = await Promise.all(
        config.cities.map(async (city) => {
            const lines: string[] = [];
            const harResult = await scrapeHarCity(city, batchSize, 2);
            if (harResult.listings && harResult.listings.length > 0) {
                lines.push(`[${city}] HAR: ${harResult.listings.length} listings`);
                return { city, listings: harResult.listings, lines };
            }
            if (harResult.error) lines.push(`[${city}] HAR error: ${harResult.error}`);
            else lines.push(`[${city}] HAR: 0 listings — trying homes.com...`);

            const homesResult = await scrapeHomesCity(city, batchSize);
            if (homesResult.listings && homesResult.listings.length > 0) {
                lines.push(`[${city}] homes.com: ${homesResult.listings.length} listings`);
                return { city, listings: homesResult.listings, lines };
            }
            if (homesResult.error) {
                errors.push(`${city}: ${homesResult.error}`);
                lines.push(`[${city}] homes.com error: ${homesResult.error}`);
            } else {
                lines.push(`[${city}] homes.com: 0 listings`);
            }
            return { city, listings: [] as ScrapedListing[], lines };
        })
    );

    // Flush city logs to DB in one batch
    for (const { lines } of cityResults) {
        for (const line of lines) await log(line);
    }

    // Deduplicate by address
    const seenAddresses = new Set<string>();
    const allListings: ScrapedListing[] = [];
    for (const { listings } of cityResults) {
        for (const l of listings) {
            if (!seenAddresses.has(l.address)) {
                seenAddresses.add(l.address);
                allListings.push(l);
            }
        }
    }
    await log(`Total unique scraped: ${allListings.length}`);

    // ── Step 2: Pre-filter already-in-DB (one batch query, not N individual checks) ──
    const { data: existingData } = await supabase
        .from('outreach_leads')
        .select('address');
    const existingAddresses = new Set((existingData || []).map((r: any) => r.address));
    const newListings = allListings.filter(l => !existingAddresses.has(l.address));
    await log(`Already in DB: ${allListings.length - newListings.length} | New: ${newListings.length}`);

    if (newListings.length === 0) {
        await log('All scraped listings already in DB — no new leads this session');
        await flushLog();
        return { processed: 0, errors, debug, sessionId };
    }

    // ── Step 3: Sort new listings by priority (ICP score → DOM → photo count) ──
    newListings.sort(
        (a, b) =>
            (b.score ?? 0) - (a.score ?? 0) ||
            (b.daysOnMarket ?? 0) - (a.daysOnMarket ?? 0) ||
            (b.photoCount ?? 0) - (a.photoCount ?? 0)
    );

    // Cap per session to stay within timeout budget (~50s for 10 cities scraping)
    // Each new lead takes ~50ms (Supabase insert) + Moondream on first few
    const maxPerSession = Math.min(newListings.length, Math.max(config.scrapesPerSession, 50));
    const toProcess = newListings.slice(0, maxPerSession);
    await log(`Processing ${toProcess.length} new leads (capped at ${maxPerSession})...`);

    // ── Step 4: Moondream — check listings that have keywords suggesting vacancy ──
    // HAR search results only return 1 photo (PHOTOPRIMARY), so we filter by keywords first:
    // "vacant", "unfurnished", "empty", "needs staging" → high likelihood of empty rooms
    // Fallback: check any listing with DOM >= 60 (motivated seller, may be vacant)
    // Limit: 15 Moondream calls max to stay within time budget (~2 min)
    let emptyRoomsFound = 0;
    let moondreamChecked = 0;
    const MAX_MOONDREAM = 15;

    // Sort toProcess so vacant/unfurnished keyword listings come first
    const vacancyKeywords = ['vacant', 'unfurnished', 'empty', 'needs staging', 'unoccupied', 'immediate occupancy', 'no furnit'];
    toProcess.sort((a, b) => {
        const aKw = a.keywords.join(' ').toLowerCase();
        const bKw = b.keywords.join(' ').toLowerCase();
        const aVacant = vacancyKeywords.some(k => aKw.includes(k)) ? 1 : 0;
        const bVacant = vacancyKeywords.some(k => bKw.includes(k)) ? 1 : 0;
        return bVacant - aVacant || (b.daysOnMarket ?? 0) - (a.daysOnMarket ?? 0);
    });

    await log(`Target: ${minEmptyRooms} empty rooms (checking up to ${MAX_MOONDREAM} vacant/long-DOM leads)`);

    for (const listing of toProcess) {
        listing.score = await scoreICP(listing);
        const emptyRooms: { roomType: string; imageUrl: string }[] = [];

        const kw = listing.keywords.join(' ').toLowerCase();
        const looksVacant = vacancyKeywords.some(k => kw.includes(k)) || (listing.daysOnMarket ?? 0) >= 60;

        if (emptyRoomsFound < minEmptyRooms && moondreamChecked < MAX_MOONDREAM && looksVacant) {
            const primaryPhoto = listing.photos[0];
            if (primaryPhoto) {
                moondreamChecked++;
                const { isEmpty, confidence, roomType, error: roomErr } = await detectRoom(primaryPhoto);
                if (roomErr) {
                    await log(`  [${listing.address}] Moondream error: ${roomErr}`);
                } else {
                    await log(`  [${listing.address}] isEmpty=${isEmpty} conf=${confidence} type=${roomType}`);
                    if (isEmpty && confidence >= 80) {
                        emptyRooms.push({ roomType, imageUrl: primaryPhoto });
                        emptyRoomsFound++;
                        await log(`  → Empty room! Total: ${emptyRoomsFound}/${minEmptyRooms}`);
                    }
                }
            }
        } else if (!looksVacant) {
            // skip silently — furnished listing
        } else if (moondreamChecked >= MAX_MOONDREAM) {
            await log(`  [${listing.address}] Skipping Moondream (${MAX_MOONDREAM} limit reached)`);
        } else {
            await log(`  [${listing.address}] Skipping Moondream (target reached)`);
        }

        const saveResult = await saveLead({ ...listing, emptyRooms });
        if (saveResult.error) {
            await log(`[${listing.city}] ${listing.address} — save error: ${saveResult.error}`);
            errors.push(`Save error: ${saveResult.error}`);
            continue;
        }

        const leadId = saveResult.lead?.id;
        if (!leadId) continue;

        if (emptyRooms.length > 0) {
            const { taskId, error: stageErr } = await stageEmptyRoom(emptyRooms[0].imageUrl, emptyRooms[0].roomType);
            if (taskId) {
                await updateLeadStatus(leadId, 'staged', { staging_task_id: taskId });
                await log(`  → Staged! taskId=${taskId}`);
            } else {
                await log(`  → Stage FAILED: ${stageErr} (imageUrl=${emptyRooms[0].imageUrl.slice(0, 80)})`);
            }
        }

        processed++;
        await log(`[${listing.city}] ✓ Saved: ${listing.address} (score ${listing.score}, emptyRooms=${emptyRooms.length})`);
    }

    if (allListings.length === 0) {
        await log('No listings found — check city list and Zyte API key');
    }
    await log(`Session complete: ${processed} saved, ${emptyRoomsFound}/${minEmptyRooms} empty rooms found`);
    await flushLog();
    return { processed, errors, debug, sessionId };
}

// ─────────────────────────────────────────────
// 9. PIPELINE CONFIG — Persist & load settings
// ─────────────────────────────────────────────

export interface PipelineConfig {
    sessions_per_day: number;
    scrapes_per_session: number;
    cities: string[];
}

export async function savePipelineConfig(config: PipelineConfig): Promise<{ success?: boolean; error?: string }> {
    const supabase = createClient(supabaseUrl, supabaseKey);
    const { error } = await supabase
        .from('pipeline_config')
        .upsert({ id: 1, ...config, updated_at: new Date().toISOString() }, { onConflict: 'id' });
    if (error) return { error: error.message };
    return { success: true };
}

export async function loadPipelineConfig(): Promise<{ config?: PipelineConfig; error?: string }> {
    const supabase = createClient(supabaseUrl, supabaseKey);
    const { data, error } = await supabase
        .from('pipeline_config')
        .select('*')
        .eq('id', 1)
        .single();
    // HAR.com covers Houston metro area + Texas cities — defaults target these reliably
    if (error || !data) return { config: { sessions_per_day: 3, scrapes_per_session: 10, cities: ['Houston', 'Katy', 'Sugar Land', 'Spring', 'Pearland', 'The Woodlands', 'Cypress', 'Pasadena', 'Humble', 'Friendswood'] } };
    return { config: { sessions_per_day: data.sessions_per_day, scrapes_per_session: data.scrapes_per_session, cities: data.cities } };
}

// ─────────────────────────────────────────────
// 10. PIPELINE RUNS — Log cron executions
// ─────────────────────────────────────────────

export async function logPipelineRun(result: { processed: number; errors: string[] }): Promise<void> {
    const supabase = createClient(supabaseUrl, supabaseKey);
    await supabase.from('pipeline_runs').insert({
        ran_at: new Date().toISOString(),
        processed: result.processed,
        errors: result.errors,
    });
}

export async function countTodayRuns(): Promise<number> {
    const supabase = createClient(supabaseUrl, supabaseKey);
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const { count } = await supabase
        .from('pipeline_runs')
        .select('*', { count: 'exact', head: true })
        .gte('ran_at', todayStart.toISOString());
    return count ?? 0;
}

export async function getRecentRuns(limit = 20): Promise<{ runs?: any[]; error?: string }> {
    const supabase = createClient(supabaseUrl, supabaseKey);
    const { data, error } = await supabase
        .from('pipeline_runs')
        .select('*')
        .order('ran_at', { ascending: false })
        .limit(limit);
    if (error) return { error: error.message };
    return { runs: data || [] };
}

// ─────────────────────────────────────────────
// 11. SITE TESTER — Test Zyte against a URL
// ─────────────────────────────────────────────

export interface SiteTestResult {
    site: string;
    url: string;
    status: 'ok' | 'blocked' | 'error';
    htmlLength: number;
    hasBody: boolean;
    snippet: string;
    nextDataFound: boolean;
    jsonLdFound: boolean;
    addressesFound: number;
    photosFound: number;
    sampleAddresses: string[];
    error?: string;
}

// City-aware URL builders for each site (TX cities)
const SITE_URL_BUILDERS: Record<string, (city: string) => string | null> = {
    'har.com': (city) =>
        `https://www.har.com/search/dosearch?type=residential&minprice=150000&maxprice=700000&status=A&city=${encodeURIComponent(city)}`,
    'homes.com': (city) => {
        const slug = CITY_SLUGS[city] || `${city.toLowerCase().replace(/\s+/g, '-')}-tx`;
        return `https://www.homes.com/homes-for-sale/${slug}/`;
    },
    'homefinder.com': (city) =>
        `https://homefinder.com/homes-for-sale/${city.toLowerCase().replace(/\s+/g, '-')}-tx`,
    'estately.com': (city) =>
        `https://www.estately.com/TX/${city.replace(/\s+/g, '_')}`,
    'century21.com': (city) => {
        const slug = city.toLowerCase().replace(/\s+/g, '-');
        const code = city.toUpperCase().replace(/\s+/g, '');
        return `https://www.century21.com/real-estate/${slug}-tx/LCTX${code}/`;
    },
    'coldwellbanker.com': (city) =>
        `https://www.coldwellbanker.com/for-sale/${city.replace(/\s+/g, '-')}-TX`,
    'homepath.fanniemae.com': (city) =>
        `https://homepath.fanniemae.com/listings?location=${encodeURIComponent(`${city}, TX`)}`,
    'remax.com': (_city) => null, // needs numeric city ID — use fixed test URL
};

const SITE_TEST_URLS: { site: string; url: string; name: string }[] = [
    {
        site: 'homes.com',
        name: 'homes.com',
        url: 'https://www.homes.com/homes-for-sale/phoenix-az/',
    },
    {
        site: 'homepath.fanniemae.com',
        name: 'HomePath (Fannie Mae)',
        url: 'https://homepath.fanniemae.com/listings',
    },
    {
        site: 'har.com',
        name: 'HAR.com',
        url: 'https://www.har.com/search/dosearch?type=residential&minprice=200000&maxprice=600000&status=A&city=Houston',
    },
    {
        site: 'homefinder.com',
        name: 'HomeFinder.com',
        url: 'https://homefinder.com/homes-for-sale/phoenix-az',
    },
    {
        site: 'estately.com',
        name: 'Estately.com',
        url: 'https://www.estately.com/AZ/Phoenix',
    },
    {
        site: 'remax.com',
        name: 'RE/MAX.com',
        url: 'https://www.remax.com/homes-for-sale/az/phoenix/city/3200705',
    },
    {
        site: 'century21.com',
        name: 'Century21.com',
        url: 'https://www.century21.com/real-estate/phoenix-az/LCAZPHOENIX/',
    },
    {
        site: 'coldwellbanker.com',
        name: 'Coldwell Banker',
        url: 'https://www.coldwellbanker.com/for-sale/Phoenix-AZ',
    },
];

export async function testSiteWithZyte(siteKey: string): Promise<SiteTestResult> {
    const target = SITE_TEST_URLS.find(s => s.site === siteKey);
    if (!target) return { site: siteKey, url: '', status: 'error', htmlLength: 0, hasBody: false, snippet: '', nextDataFound: false, jsonLdFound: false, addressesFound: 0, photosFound: 0, sampleAddresses: [], error: 'Unknown site' };

    if (!ZYTE_API_KEY) return { ...target, status: 'error', htmlLength: 0, hasBody: false, snippet: '', nextDataFound: false, jsonLdFound: false, addressesFound: 0, photosFound: 0, sampleAddresses: [], error: 'ZYTE_API_KEY not set' };

    try {
        const zyteRes = await fetch('https://api.zyte.com/v1/extract', {
            method: 'POST',
            headers: {
                'Authorization': `Basic ${Buffer.from(`${ZYTE_API_KEY}:`).toString('base64')}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ url: target.url, browserHtml: true }),
        });

        if (!zyteRes.ok) {
            const err = await zyteRes.text();
            return { ...target, status: 'error', htmlLength: 0, hasBody: false, snippet: err.slice(0, 500), nextDataFound: false, jsonLdFound: false, addressesFound: 0, photosFound: 0, sampleAddresses: [], error: `Zyte ${zyteRes.status}` };
        }

        const data = await zyteRes.json();
        const html: string = data.browserHtml || '';

        const hasBody = html.includes('<body') && html.length > 5000;
        const nextDataFound = html.includes('__NEXT_DATA__');
        const jsonLdFound = html.includes('application/ld+json');

        // Count addresses via multiple patterns (different sites use different schemas)
        const streetAddrMatches = [...html.matchAll(/"streetAddress"\s*:\s*"([^"]+)"/g)].map(m => m[1]);
        const fullStreetMatches = [...html.matchAll(/"FULLSTREETADDRESS"\s*:\s*"([^"]+)"/g)].map(m => m[1]);
        const listingAddrMatches = [...html.matchAll(/"(?:address|listingAddress|propertyAddress)"\s*:\s*"([^"]+\d+[^"]+)"/g)].map(m => m[1]);
        const allAddresses = [...new Set([...streetAddrMatches, ...fullStreetMatches, ...listingAddrMatches])];

        const photoMatches = [...html.matchAll(/https:\/\/[^"'\s]+\.(?:jpg|jpeg|png|webp)(?:\?[^"'\s]*)?/g)];
        const sampleAddresses = allAddresses.slice(0, 3);

        // Check page title for bot-detection redirects (e.g. served wrong city or CAPTCHA page)
        const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/);
        const pageTitle = titleMatch?.[1]?.trim() || '';
        const isBotDetected = html.includes('robot') || html.includes('captcha') || html.includes('Cloudflare') || html.includes('Just a moment') || (html.length < 10000 && !hasBody);

        // Find a meaningful snippet — look for first body content
        const bodyStart = html.indexOf('<body');
        const snippet = bodyStart > -1
            ? html.slice(bodyStart, bodyStart + 1500)
            : html.slice(0, 1500);

        return {
            site: target.site,
            url: target.url,
            status: isBotDetected ? 'blocked' : hasBody ? 'ok' : 'blocked',
            htmlLength: html.length,
            hasBody,
            snippet: `[Title: ${pageTitle}]\n\n${snippet}`,
            nextDataFound,
            jsonLdFound,
            addressesFound: allAddresses.length,
            photosFound: photoMatches.length,
            sampleAddresses,
        };

    } catch (error: any) {
        return { ...target, status: 'error', htmlLength: 0, hasBody: false, snippet: '', nextDataFound: false, jsonLdFound: false, addressesFound: 0, photosFound: 0, sampleAddresses: [], error: error.message };
    }
}

// Run all 8 site tests, log results to DB for reliability tracking.
// Accepts an optional city to use city-specific URLs (TX) instead of fixed test URLs.
export async function testAllSites(city?: string): Promise<SiteTestResult[]> {
    const results = await Promise.all(
        SITE_TEST_URLS.map(async ({ site }) => {
            // Use city-specific URL when provided, fall back to fixed test URL
            const cityUrl = city ? (SITE_URL_BUILDERS[site]?.(city) ?? null) : null;

            let result: SiteTestResult;
            if (cityUrl) {
                // Run generic scrape for richer listing count data
                const generic = await scrapeGenericSite(cityUrl, city!);
                const base = await testSiteWithZyte(site);
                result = {
                    ...base,
                    // Prefer generic listing count when we have a city-specific URL
                    addressesFound: Math.max(base.addressesFound, generic.addressesFound),
                };
            } else {
                result = await testSiteWithZyte(site);
            }
            return result;
        })
    );

    // Log to DB (fire-and-forget — don't fail the test if table missing)
    logSiteScrapeResult(results.map((r) => ({
        site: r.site,
        status: r.status,
        listingsFound: 0,
        addressesFound: r.addressesFound,
    }))).catch(() => {});

    return results;
}

// Generic listing extractor — tries JSON-LD → __NEXT_DATA__ → address count
async function scrapeGenericSite(url: string, city: string): Promise<{
    listings: ScrapedListing[];
    addressesFound: number;
    status: 'ok' | 'blocked' | 'error';
    error?: string;
}> {
    const { html, error } = await zyteGet(url, city);
    if (error || !html) return { listings: [], addressesFound: 0, status: 'error', error: error || 'No HTML' };

    const isBotDetected = html.includes('robot') || html.includes('captcha') ||
        html.includes('Cloudflare') || html.includes('Just a moment') || html.length < 5000;
    if (isBotDetected) return { listings: [], addressesFound: 0, status: 'blocked' };

    const listings: ScrapedListing[] = [];

    // Strategy 1: JSON-LD itemListElement
    const allJsonLd = [...html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)];
    for (const match of allJsonLd) {
        try {
            const parsed = JSON.parse(match[1]);
            const candidates =
                parsed?.['@graph']?.[0]?.mainEntity?.itemListElement ||
                parsed?.mainEntity?.itemListElement ||
                (Array.isArray(parsed) ? parsed : []);
            for (const item of candidates) {
                const addr = item?.mainEntity?.address || item?.address;
                if (!addr?.streetAddress) continue;
                const price = parseInt(item?.offers?.price || item?.price || 0);
                if (price < 150000 || price > 700000) continue;
                const photo = item?.image || item?.mainEntity?.image || '';
                const listing: ScrapedListing = {
                    address: addr.streetAddress,
                    city: addr.addressLocality || city,
                    price,
                    daysOnMarket: 0,
                    priceReduced: false,
                    photoCount: photo ? 1 : 0,
                    photos: photo ? [photo] : [],
                    agentName: item?.offers?.offeredBy?.name || '',
                    agentPhone: item?.offers?.offeredBy?.telephone || '',
                    listingUrl: item?.url || item?.mainEntity?.url || url,
                    keywords: [],
                };
                listing.score = await scoreICP(listing);
                listings.push(listing);
            }
        } catch { continue; }
    }

    // Strategy 2: __NEXT_DATA__
    if (listings.length === 0) {
        const nextMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
        if (nextMatch) {
            try {
                const next = JSON.parse(nextMatch[1]);
                const candidates = [
                    next?.props?.pageProps?.listings,
                    next?.props?.pageProps?.searchResults,
                    next?.props?.pageProps?.properties,
                    next?.props?.pageProps?.data?.listings,
                    next?.props?.pageProps?.initialData?.listings,
                ].find((v) => Array.isArray(v) && v.length > 0);
                if (candidates) {
                    const origin = new URL(url).origin;
                    for (const item of candidates.slice(0, 40)) {
                        const address = item?.address || item?.streetAddress || item?.location?.address || '';
                        const price = parseInt(item?.price || item?.listPrice || 0);
                        if (!address || price < 150000 || price > 700000) continue;
                        const photos: string[] = (item?.photos || item?.images || [])
                            .map((p: any) => (typeof p === 'string' ? p : p?.url))
                            .filter((p: any) => typeof p === 'string' && p.startsWith('http'));
                        const listing: ScrapedListing = {
                            address,
                            city: item?.city || city,
                            price,
                            daysOnMarket: item?.daysOnMarket || item?.dom || 0,
                            priceReduced: !!(item?.priceReduced || item?.priceChange),
                            photoCount: photos.length,
                            photos,
                            agentName: item?.agent?.name || item?.listingAgent?.name || '',
                            agentPhone: item?.agent?.phone || item?.listingAgent?.phone || '',
                            agentEmail: item?.agent?.email || item?.listingAgent?.email || '',
                            listingUrl: item?.url
                                ? (item.url.startsWith('http') ? item.url : `${origin}${item.url}`)
                                : url,
                            keywords: [],
                        };
                        listing.score = await scoreICP(listing);
                        listings.push(listing);
                    }
                }
            } catch { }
        }
    }

    const addressesFound = Math.max(
        listings.length,
        [...html.matchAll(/"streetAddress"\s*:\s*"([^"]+)"/g)].length +
        [...html.matchAll(/"FULLSTREETADDRESS"\s*:\s*"([^"]+)"/g)].length,
    );

    return { listings, addressesFound, status: 'ok' };
}

export async function logSiteScrapeResult(
    results: { site: string; status: string; listingsFound: number; addressesFound: number }[]
): Promise<void> {
    const supabase = createClient(supabaseUrl, supabaseKey);
    await supabase.from('site_scrape_log').insert(
        results.map((r) => ({
            site: r.site,
            ran_at: new Date().toISOString(),
            status: r.status,
            listings_found: r.listingsFound,
            addresses_found: r.addressesFound,
        }))
    );
}

export async function getSiteStats(): Promise<{ stats?: any[]; error?: string }> {
    const supabase = createClient(supabaseUrl, supabaseKey);
    const { data, error } = await supabase
        .from('site_scrape_log')
        .select('site, status, listings_found, addresses_found, ran_at')
        .order('ran_at', { ascending: false })
        .limit(500);
    if (error) return { error: error.message };

    const siteMap: Record<string, { runs: number; successes: number; totalListings: number; totalAddresses: number; lastRun: string }> = {};
    for (const row of (data || [])) {
        if (!siteMap[row.site]) siteMap[row.site] = { runs: 0, successes: 0, totalListings: 0, totalAddresses: 0, lastRun: row.ran_at };
        siteMap[row.site].runs++;
        if (row.status === 'ok') siteMap[row.site].successes++;
        siteMap[row.site].totalListings += row.listings_found || 0;
        siteMap[row.site].totalAddresses += row.addresses_found || 0;
        if (row.ran_at > siteMap[row.site].lastRun) siteMap[row.site].lastRun = row.ran_at;
    }

    const stats = Object.entries(siteMap)
        .map(([site, s]) => ({
            site,
            runs: s.runs,
            successRate: s.runs > 0 ? Math.round((s.successes / s.runs) * 100) : 0,
            avgListings: s.runs > 0 ? Math.round(s.totalListings / s.runs) : 0,
            avgAddresses: s.runs > 0 ? Math.round(s.totalAddresses / s.runs) : 0,
            lastRun: s.lastRun,
        }))
        .sort((a, b) => b.successRate - a.successRate || b.avgAddresses - a.avgAddresses);

    return { stats };
}
