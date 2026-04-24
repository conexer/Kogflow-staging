'use server';

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const ZYTE_API_KEY = process.env.ZYTE_API_KEY!;
const MOONDREAM_API_KEY = (process.env.MOONDREAM_API_KEY || '').trim();
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

    // No dom filter — scrape ALL active listings so we don't exhaust the pool
    const baseUrl = `https://www.har.com/search/dosearch?type=residential&minprice=100000&maxprice=700000&status=A&city=${encodeURIComponent(city)}`;

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
    isStageable: boolean;
    isInterior: boolean;
    confidence: number;
    roomType: string;
    isExterior: boolean;
    error?: string;
}> {
    const REJECT = { isEmpty: false, isStageable: false, isInterior: false, confidence: 0, roomType: 'unknown', isExterior: true };
    if (!MOONDREAM_API_KEY) return { ...REJECT, error: 'MOONDREAM_API_KEY not configured' };

    try {
        // Moondream requires base64 — fetch with browser-like headers to bypass hotlink protection
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
        if (!imgRes.ok) return { ...REJECT, error: `Image fetch failed: ${imgRes.status}` };

        const contentType = imgRes.headers.get('content-type') || 'image/jpeg';
        const arrayBuffer = await imgRes.arrayBuffer();
        const base64 = Buffer.from(arrayBuffer).toString('base64');
        const imageData = `data:${contentType};base64,${base64}`;

        const moonHeaders = {
            'X-Moondream-Auth': MOONDREAM_API_KEY,
            'Content-Type': 'application/json',
        };

        // ── Q1: Interior check (positive gate) ───────────────────────────────────
        // Ask positively "is this interior?" — more reliable than asking "is this NOT exterior?"
        // Exterior photos (yard, facade, driveway) should answer "no" to this.
        const interiorRes = await fetch('https://api.moondream.ai/v1/query', {
            method: 'POST',
            headers: moonHeaders,
            body: JSON.stringify({
                image_url: imageData,
                question: 'Is this photo taken inside a building, showing an indoor room with walls, floor, and ceiling visible? Answer only "yes" or "no".',
                stream: false,
            }),
        });
        if (!interiorRes.ok) {
            const err = await interiorRes.text();
            return { ...REJECT, error: `Moondream interior check error ${interiorRes.status}: ${err}` };
        }
        const interiorData = await interiorRes.json();
        const interiorAnswer: string = (interiorData.answer || interiorData.result || '').toLowerCase().trim();
        if (!interiorAnswer.startsWith('yes')) return { ...REJECT, isExterior: true }; // exterior — reject immediately

        // ── Q1b: Explicit Exterior Negative Check ──────────────────────────────
        // Ask negatively to catch yards, pools, facades that pass the interior check
        await new Promise(r => setTimeout(r, 400));
        const exteriorRes = await fetch('https://api.moondream.ai/v1/query', {
            method: 'POST',
            headers: moonHeaders,
            body: JSON.stringify({
                image_url: imageData,
                question: 'Does this photo show a backyard, swimming pool, front yard, garden, driveway, or the outside of a house? Answer only "yes" or "no".',
                stream: false,
            }),
        });
        if (exteriorRes.ok) {
            const exteriorData = await exteriorRes.json();
            const exteriorAnswer: string = (exteriorData.answer || exteriorData.result || '').toLowerCase().trim();
            if (exteriorAnswer.startsWith('yes')) return { ...REJECT, isExterior: true };
        }

        // ── Q2: Empty room check ───────────────────────────────────────────────
        // Now that we know it's interior, check if it's empty/unfurnished
        await new Promise(r => setTimeout(r, 400));
        const emptyRes = await fetch('https://api.moondream.ai/v1/query', {
            method: 'POST',
            headers: moonHeaders,
            body: JSON.stringify({
                image_url: imageData,
                question: 'Are there any objects, furniture, appliances, personal items, decorations, or belongings visible in this room? Answer only "yes" or "no".',
                stream: false,
            }),
        });
        if (!emptyRes.ok) {
            const err = await emptyRes.text();
            return { ...REJECT, error: `Moondream empty check error ${emptyRes.status}: ${err}` };
        }
        const emptyData = await emptyRes.json();
        const emptyAnswer: string = (emptyData.answer || emptyData.result || '').toLowerCase().trim();
        // Question asks "is there furniture?" — "yes" = furnished (not empty), "no" = empty
        const hasFurniture = emptyAnswer.startsWith('yes');
        const isEmpty = !hasFurniture;

        // Has furniture → not stageable (but is interior, so not a hard reject)
        if (!isEmpty) return { ...REJECT, isEmpty: false, isExterior: false, isInterior: true };

        // ── Q3: Floor plan rejection ───────────────────────────────────────────
        // Floor plans have no furniture so they pass Q2. Explicitly reject them.
        await new Promise(r => setTimeout(r, 400));
        const planRes = await fetch('https://api.moondream.ai/v1/query', {
            method: 'POST',
            headers: moonHeaders,
            body: JSON.stringify({
                image_url: imageData,
                question: 'Does this image show a 2D floor plan, architectural blueprint, or room diagram with labels or dimension lines? Answer only "yes" or "no".',
                stream: false,
            }),
        });
        if (planRes.ok) {
            const planData = await planRes.json();
            const planAnswer: string = (planData.answer || planData.result || '').toLowerCase().trim();
            if (planAnswer.startsWith('yes')) return { ...REJECT }; // floor plan — reject
        }

        // ── Q4: Foyer/stairway/hallway rejection ───────────────────────────────
        // Entryways and staircases are not stageable rooms even when empty.
        await new Promise(r => setTimeout(r, 400));
        const foyerRes = await fetch('https://api.moondream.ai/v1/query', {
            method: 'POST',
            headers: moonHeaders,
            body: JSON.stringify({
                image_url: imageData,
                question: 'Does this image show a staircase, hallway, entryway, foyer, or corridor? Answer only "yes" or "no".',
                stream: false,
            }),
        });
        if (foyerRes.ok) {
            const foyerData = await foyerRes.json();
            const foyerAnswer: string = (foyerData.answer || foyerData.result || '').toLowerCase().trim();
            if (foyerAnswer.startsWith('yes')) return { ...REJECT }; // not a stageable room — reject
        }

        // ── Q5: Room type (only for confirmed interior, empty rooms) ─────────
        await new Promise(r => setTimeout(r, 400));
        const typeRes = await fetch('https://api.moondream.ai/v1/query', {
            method: 'POST',
            headers: moonHeaders,
            body: JSON.stringify({
                image_url: imageData,
                question: 'What type of room is this? Answer with one of: bedroom, living room, kitchen, dining room, or bathroom.',
                stream: false,
            }),
        });
        let roomType = 'room';
        if (typeRes.ok) {
            const typeData = await typeRes.json();
            const typeAnswer: string = (typeData.answer || typeData.result || '').toLowerCase().trim();
            roomType = typeAnswer.includes('bedroom') ? 'bedroom'
                : typeAnswer.includes('living') ? 'living room'
                : typeAnswer.includes('kitchen') ? 'kitchen'
                : typeAnswer.includes('dining') ? 'dining room'
                : typeAnswer.includes('bathroom') || typeAnswer.includes('bath') ? 'bathroom'
                : 'room';
        }

        // Final Check: Must have identified a SPECIFIC room type to be stageable.
        // Ambiguous "room" or "unknown" is not high-enough quality for automated outreach.
        const VALID_ROOM_TYPES = ['bedroom', 'living room', 'kitchen', 'dining room', 'bathroom'];
        const isKnownRoom = VALID_ROOM_TYPES.includes(roomType);

        return {
            isEmpty: isEmpty,
            isStageable: isKnownRoom, // Stricter gate
            isInterior: true,
            confidence: 90,
            roomType,
            isExterior: false
        };

    } catch (error: any) {
        return { ...REJECT, error: error.message };
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

    if (existing) {
        const duplicateUpdates: {
            city: string;
            price: number;
            days_on_market: number;
            price_reduced: boolean;
            photo_count: number;
            agent_name: string;
            agent_phone?: string;
            agent_email?: string;
            listing_url: string;
            keywords: string[];
            icp_score: number;
            empty_rooms?: { roomType: string; imageUrl: string; stagedUrl?: string }[];
        } = {
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
        };

        if (listing.emptyRooms && listing.emptyRooms.length > 0) {
            duplicateUpdates.empty_rooms = listing.emptyRooms;
        }

        const { error: updateError } = await supabase
            .from('outreach_leads')
            .update(duplicateUpdates)
            .eq('id', existing.id);

        if (updateError) return { error: updateError.message };
        return { skipped: true, reason: 'Already in database', lead: existing };
    }

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

export async function getLeads(status?: string, limit = 500) {
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

// Submit a batch to Kie.ai — only leads with Moondream-confirmed empty rooms
// Re-scans existing score>=35 leads that were scraped without a room photo (empty_rooms=[]).
// Fetches their HAR photos, runs Moondream on each, stages the first stageable room found.
// These leads were scraped before the furnished-redesign logic existed and have no staging_task_id.
export async function scanAndStageHighScoreBacklog(limit = 10): Promise<{ staged: number; skipped: number; failed: number; total: number; errors: string[] }> {
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data, error } = await supabase
        .from('outreach_leads')
        .select('id, address, listing_url, icp_score, agent_email')
        .in('status', ['scraped', 'scored'])
        .gte('icp_score', 25)
        .eq('empty_rooms', '[]')
        .not('listing_url', 'is', null)
        .order('icp_score', { ascending: false })
        .limit(limit);

    if (error) return { staged: 0, skipped: 0, failed: 0, total: 0, errors: [error.message] };

    const leads = data || [];
    let staged = 0, skipped = 0, failed = 0;
    const errors: string[] = [];

    for (const lead of leads) {
        const photos = await getHarListingPhotos(lead.listing_url, 8);
        if (photos.length < 2) { skipped++; continue; } // no interior photos

        let stagedThisLead = false;
        for (const photo of photos.slice(1, 7)) {
            const { isStageable, isEmpty, roomType, error: roomErr } = await detectRoom(photo);
            if (roomErr || !isStageable) continue;

            // Stage it — empty rooms get furniture added, furnished rooms get redesigned
            const { taskId, error: stageErr } = await stageEmptyRoom(photo, roomType, !isEmpty);
            if (!taskId) { errors.push(`${lead.address}: ${stageErr}`); failed++; break; }

            await supabase.from('outreach_leads')
                .update({ empty_rooms: [{ roomType, imageUrl: photo }] })
                .eq('id', lead.id);
            await updateLeadStatus(lead.id, 'staged', { staging_task_id: taskId });
            staged++;
            stagedThisLead = true;
            break;
        }
        if (!stagedThisLead && !errors.find(e => e.startsWith(lead.address))) skipped++;
    }

    return { staged, skipped, failed, total: leads.length, errors };
}

export async function submitStagingBatch(limit?: number): Promise<{ submitted: number; failed: number; errors: string[] }> {
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Stage leads that have a Moondream-confirmed room (already verified during pipeline scan).
    let query = supabase
        .from('outreach_leads')
        .select('id, address, empty_rooms, listing_url, icp_score')
        .in('status', ['scraped', 'scored'])
        .not('empty_rooms', 'eq', '[]');

    if (typeof limit === 'number') query = query.limit(limit);

    const { data: emptyData } = await query;

    const allPending = (emptyData || []).filter((l: any) => Array.isArray(l.empty_rooms) && l.empty_rooms.length > 0);

    let submitted = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const lead of allPending) {
        const imageUrl: string = lead.empty_rooms[0].imageUrl;
        const roomType: string = lead.empty_rooms[0].roomType || 'room';

        const { taskId, error: stageErr } = await stageEmptyRoom(imageUrl, roomType, false);
        if (taskId) {
            await updateLeadStatus(lead.id, 'staged', { staging_task_id: taskId });
            submitted++;
        } else {
            failed++;
            errors.push(`${lead.address}: ${stageErr}`);
        }

        if (allPending.indexOf(lead) < allPending.length - 1) {
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
export async function pollAndEmailStagedLeads(limit?: number): Promise<{ emailed: number; stillProcessing: number; failed: number; errors: string[]; debug: string[] }> {
    const supabase = createClient(supabaseUrl, supabaseKey);

    let query = supabase
        .from('outreach_leads')
        .select('id, address, listing_url, agent_name, agent_email, empty_rooms, staging_task_id, city, price, days_on_market, price_reduced, photo_count, keywords')
        .eq('status', 'staged')
        .not('staging_task_id', 'is', null);

    if (typeof limit === 'number') query = query.limit(limit);

    const { data, error } = await query;

    if (error) return { emailed: 0, stillProcessing: 0, failed: 0, errors: [error.message], debug: [] };

    let emailed = 0;
    let stillProcessing = 0;
    let failed = 0;
    const errors: string[] = [];
    const debug: string[] = [];

    const leads = data || [];
    debug.push(`Poll & email: checking ${leads.length} staged lead(s)`);

    for (const lead of leads) {
        const result = await checkStagingResult(lead.staging_task_id);

        if (result.status === 'processing') {
            stillProcessing++;
            debug.push(`⏳ Still generating: ${lead.address}`);
            continue;
        }

        if (result.status === 'error') {
            // Transient error (network/API) — leave as staged, retry next poll
            debug.push(`⚠ Kie.ai error (will retry): ${lead.address} — ${result.error}`);
            continue;
        }

        if (result.status === 'failed') {
            // Definitive generation failure — reset so it can be re-staged
            await updateLeadStatus(lead.id, 'scored', { staging_task_id: null });
            failed++;
            errors.push(`Generation failed ${lead.address}: ${result.error}`);
            debug.push(`✗ Generation failed ${lead.address}: ${result.error}`);
            continue;
        }

        // status === 'success'
        const storedBeforeUrl = lead.empty_rooms?.[0]?.imageUrl;
        const permanentUrl = result.url ? await uploadStagedImage(result.url, lead.id) : undefined;

        if (permanentUrl) {
            const updatedRooms = [...(lead.empty_rooms || [])];
            if (updatedRooms[0]) updatedRooms[0].stagedUrl = permanentUrl;
            await supabase.from('outreach_leads').update({ empty_rooms: updatedRooms }).eq('id', lead.id);
        } else {
            debug.push(`⚠ No staged URL returned for ${lead.address} — sending email without image`);
        }

        if (lead.agent_email) {
            const emailResult = await sendOutreachEmail({
                agentName: lead.agent_name,
                agentEmail: lead.agent_email,
                address: lead.address,
                stagedImageUrl: permanentUrl,
                beforeImageUrl: storedBeforeUrl,
                city: lead.city,
                price: lead.price,
                daysOnMarket: lead.days_on_market,
                priceReduced: lead.price_reduced,
                photoCount: lead.photo_count,
                keywords: lead.keywords,
                roomType: lead.empty_rooms?.[0]?.roomType,
            });
            if (emailResult.success) {
                await updateLeadStatus(lead.id, 'emailed', { email_sent_at: new Date().toISOString() });
                emailed++;
                debug.push(`✉ Email sent → ${lead.agent_email} (${lead.address})`);
            } else {
                errors.push(`Email failed ${lead.address}: ${emailResult.error}`);
                debug.push(`✗ Email failed ${lead.address}: ${emailResult.error}`);
                failed++;
            }
        } else {
            await updateLeadStatus(lead.id, 'form_filled');
            debug.push(`No email address for ${lead.address} — staged image saved`);
        }
    }

    debug.push(`Poll complete: ${emailed} emailed, ${stillProcessing} still generating, ${failed} failed`);
    return { emailed, stillProcessing, failed, errors, debug };
}

// Finds all staged leads that were never emailed and sends slowly with a delay between each.
// Handles both: Kie.ai task still pending (polls first) and task already completed.
export async function drainEmailBacklog(delayMs = 8000): Promise<{ emailed: number; skipped: number; stillProcessing: number; failed: number; total: number; errors: string[] }> {
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data, error } = await supabase
        .from('outreach_leads')
        .select('id, address, agent_name, agent_email, empty_rooms, staging_task_id, city, price, days_on_market, price_reduced, photo_count, keywords')
        .eq('status', 'staged')
        .not('staging_task_id', 'is', null)
        .order('created_at', { ascending: true });

    if (error) return { emailed: 0, skipped: 0, stillProcessing: 0, failed: 0, total: 0, errors: [error.message] };

    const leads = data || [];
    let emailed = 0, skipped = 0, stillProcessing = 0, failed = 0;
    const errors: string[] = [];

    for (const lead of leads) {
        if (!lead.agent_email) { skipped++; continue; }

        const result = await checkStagingResult(lead.staging_task_id);

        if (result.status === 'processing') { stillProcessing++; continue; }
        if (result.status === 'error') { continue; } // transient — retry next time

        if (result.status === 'failed') {
            await updateLeadStatus(lead.id, 'scored', { staging_task_id: null });
            failed++;
            errors.push(`Generation failed ${lead.address}: ${result.error}`);
            continue;
        }

        // success
        const storedBeforeUrl = lead.empty_rooms?.[0]?.imageUrl;
        const permanentUrl = result.url ? await uploadStagedImage(result.url, lead.id) : undefined;
        if (permanentUrl) {
            const updatedRooms = [...(lead.empty_rooms || [])];
            if (updatedRooms[0]) updatedRooms[0].stagedUrl = permanentUrl;
            await supabase.from('outreach_leads').update({ empty_rooms: updatedRooms }).eq('id', lead.id);
        }

        const emailResult = await sendOutreachEmail({
            agentName: lead.agent_name,
            agentEmail: lead.agent_email,
            address: lead.address,
            stagedImageUrl: permanentUrl,
            beforeImageUrl: storedBeforeUrl,
            city: lead.city,
            price: lead.price,
            daysOnMarket: lead.days_on_market,
            priceReduced: lead.price_reduced,
            photoCount: lead.photo_count,
            keywords: lead.keywords,
            roomType: lead.empty_rooms?.[0]?.roomType,
        });

        if (emailResult.success) {
            await updateLeadStatus(lead.id, 'emailed', { email_sent_at: new Date().toISOString() });
            emailed++;
        } else {
            failed++;
            errors.push(`Email failed ${lead.address}: ${emailResult.error}`);
        }

        // Delay between sends to avoid triggering spam filters
        if (emailed + failed < leads.length) await new Promise(r => setTimeout(r, delayMs));
    }

    return { emailed, skipped, stillProcessing, failed, total: leads.length, errors };
}

export async function getLeadStats(since?: string) {
    const supabase = createClient(supabaseUrl, supabaseKey);
    const pageSize = 1000;
    const leads: {
        status: string;
        icp_score: number | null;
        photo_count: number | null;
        empty_rooms: { roomType?: string; imageUrl?: string; stagedUrl?: string }[] | null;
        staging_task_id: string | null;
        email_sent_at: string | null;
    }[] = [];

    for (let from = 0; ; from += pageSize) {
        let query = supabase
            .from('outreach_leads')
            .select('status, icp_score, photo_count, empty_rooms, staging_task_id, email_sent_at')
            .range(from, from + pageSize - 1);

        if (since) query = query.gte('created_at', since);

        const { data, error } = await query;
        if (error) return { error: error.message };

        const batch = data || [];
        leads.push(...batch);
        if (batch.length < pageSize) break;
    }

    const currentStaged = leads.filter(l => l.status === 'staged').length;
    const stagedEver = leads.filter(l =>
        !!l.staging_task_id ||
        (Array.isArray(l.empty_rooms) && l.empty_rooms.some(room => room?.stagedUrl))
    ).length;
    const stagedQueue = leads.filter(l =>
        ['scraped', 'scored'].includes(l.status) &&
        !l.staging_task_id &&
        Array.isArray(l.empty_rooms) &&
        l.empty_rooms.length > 0
    ).length;

    const stats = {
        total: leads.length,
        scraped: leads.filter(l => l.status === 'scraped').length,
        scored: leads.filter(l => l.status === 'scored').length,
        staged: currentStaged,
        stagedEver,
        form_filled: leads.filter(l => l.status === 'form_filled').length,
        emailed: leads.filter(l => l.status === 'emailed' || !!l.email_sent_at).length,
        avgScore: leads.length ? Math.round(leads.reduce((s, l) => s + (l.icp_score || 0), 0) / leads.length) : 0,
        totalPhotos: leads.reduce((s, l) => s + (l.photo_count || 0), 0),
        leadsWithPhotos: leads.filter(l => (l.photo_count || 0) > 0).length,
        emptyRoomsFound: stagedQueue,
    };

    return { stats };
}

// ─────────────────────────────────────────────
// 6. KIE.AI — Stage empty room
// ─────────────────────────────────────────────

export async function stageEmptyRoom(imageUrl: string, roomType: string, redesign = false): Promise<{ taskId?: string; error?: string }> {
    if (!KIE_API_KEY) return { error: 'KIE_AI_API_KEY not configured' };

    try {
        const prompt = redesign
            ? `Professionally restage this ${roomType} with premium contemporary furniture and luxury real estate staging. Replace current furnishings with high-end modern pieces. Keep all structural elements (walls, windows, floor, ceiling, fixtures) completely identical. Magazine-quality, photorealistic real estate photography.`
            : `Add fully furnished ${roomType} decor in modern contemporary style. Keep all structural elements (walls, windows, floor, ceiling) identical. High quality, photorealistic real estate photography.`;

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
                    image_urls: [imageUrl],
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
            // Try multiple known Kie.ai response shapes
            let url: string | undefined;
            try { url = JSON.parse(data.data.resultJson || '{}').resultUrls?.[0]; } catch {}
            if (!url) url = data.data?.outputUrl || data.data?.result_url || data.data?.url;
            if (!url && Array.isArray(data.data?.resultUrls)) url = data.data.resultUrls[0];
            return { status: 'success', url };
        } else if (state === 'fail' || state === 'failed') {
            return { status: 'failed', error: data.data?.failMsg || data.data?.message || 'Generation failed' };
        } else if (state === 'error') {
            return { status: 'error', error: data.data?.failMsg || data.data?.message || 'Kie.ai error' };
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
    city?: string;
    price?: number;
    daysOnMarket?: number;
    priceReduced?: boolean;
    photoCount?: number;
    keywords?: string[];
    roomType?: string;
}): Promise<{ success?: boolean; error?: string }> {
    if (!GMAIL_CLIENT_ID || !GMAIL_CLIENT_SECRET || !GMAIL_REFRESH_TOKEN) {
        return { error: 'Gmail OAuth credentials not configured' };
    }
    if (!lead.agentEmail) return { error: 'No agent email' };

    try {
        const accessToken = await getGmailAccessToken();

        // Randomized subject lines — varied phrasing to avoid spam pattern detection
        const firstName = lead.agentName?.split(' ')[0] ?? 'there';
        const prop = lead.address;
        const subjectTemplates = [
            // --- "regarding your property at" core pattern ---
            `${firstName}, regarding your property at ${prop}, I put together something for you`,
            `${firstName}, regarding your property at ${prop}, I mocked up a new look`,
            `${firstName}, regarding your property at ${prop}, I made this after seeing the listing`,
            `${firstName}, regarding your property at ${prop}, I created something you may want to see`,
            `${firstName}, regarding your property at ${prop}, I wanted your take on this version`,
            `${firstName}, regarding your property at ${prop}, I put together a visual idea`,
            `${firstName}, regarding your property at ${prop}, I drafted a cleaner presentation`,
            `${firstName}, regarding your property at ${prop}, I had an idea for the photos`,
            `${firstName}, regarding your property at ${prop}, I made a quick preview`,
            `${firstName}, regarding your property at ${prop}, I created a staged version`,
            `${firstName}, regarding your property at ${prop}, I tried a different look`,
            `${firstName}, regarding your property at ${prop}, I reworked one of the rooms`,
            `${firstName}, regarding your property at ${prop}, I built a quick staging concept`,
            `${firstName}, regarding your property at ${prop}, I pulled together a simple preview`,
            `${firstName}, regarding your property at ${prop}, I put together a fresh angle`,
            `${firstName}, regarding your property at ${prop}, I prepared a staged sample`,
            `${firstName}, regarding your property at ${prop}, I made a visual update`,
            `${firstName}, regarding your property at ${prop}, I tested a new presentation`,
            `${firstName}, regarding your property at ${prop}, I put together a room concept`,
            `${firstName}, regarding your property at ${prop}, I gave the listing a fresh treatment`,
            `${firstName}, regarding your property at ${prop}, I created a first-pass staging idea`,
            `${firstName}, regarding your property at ${prop}, I wanted to share this concept`,
            `${firstName}, regarding your property at ${prop}, I made a sample image set`,
            `${firstName}, regarding your property at ${prop}, I sketched out a presentation idea`,
            `${firstName}, regarding your property at ${prop}, I made a quick before-and-after concept`,
            `${firstName}, regarding your property at ${prop}, I created a photo concept for you`,
            `${firstName}, regarding your property at ${prop}, I worked up a quick visual`,
            `${firstName}, regarding your property at ${prop}, I created a mockup you might like`,
            `${firstName}, regarding your property at ${prop}, I put a room idea together`,
            `${firstName}, regarding your property at ${prop}, I staged one of the photos for you`,
            `${firstName}, regarding your property at ${prop}, I redesigned one of the rooms`,
            `${firstName}, regarding your property at ${prop}, I made something worth a look`,
            `${firstName}, regarding your property at ${prop}, I created a version with furniture`,
            `${firstName}, regarding your property at ${prop}, I put together a quick visual concept`,
            `${firstName}, regarding your property at ${prop}, I updated the look on one room`,
            `${firstName}, regarding your property at ${prop}, I put furniture in the space`,
            `${firstName}, regarding your property at ${prop}, I gave one room a new look`,
            `${firstName}, regarding your property at ${prop}, I created an interior concept for it`,
            `${firstName}, regarding your property at ${prop}, I put together a listing presentation idea`,
            `${firstName}, regarding your property at ${prop}, I made a furnished version for you`,
            `${firstName}, regarding your property at ${prop}, I created a staged photo for the listing`,
            `${firstName}, regarding your property at ${prop}, I made something for the photos`,
            `${firstName}, regarding your property at ${prop}, I staged the space digitally`,
            `${firstName}, regarding your property at ${prop}, I created a concept worth sharing`,
            `${firstName}, regarding your property at ${prop}, I put a staged photo together for you`,
            `${firstName}, regarding your property at ${prop}, I came up with a visual concept`,
            `${firstName}, regarding your property at ${prop}, I staged a room photo for you`,
            `${firstName}, regarding your property at ${prop}, I applied a new look to one of the photos`,
            `${firstName}, regarding your property at ${prop}, I made a before-and-after for you`,
            `${firstName}, regarding your property at ${prop}, I created a styled version of the space`,
            // --- "I saw your listing" variants ---
            `${firstName}, I saw your listing at ${prop} and put something together`,
            `${firstName}, I saw your listing at ${prop} and created this for you`,
            `${firstName}, I saw your listing at ${prop} and staged it for you`,
            `${firstName}, I saw your listing at ${prop} and wanted to share an idea`,
            `${firstName}, I saw your listing at ${prop} and made a quick concept`,
            `${firstName}, I saw your listing at ${prop} and built a staged version`,
            `${firstName}, I saw your listing at ${prop} and created a photo idea`,
            `${firstName}, I saw your listing at ${prop} and drafted a new look`,
            `${firstName}, I saw your listing at ${prop} and made a visual for it`,
            `${firstName}, I saw your listing at ${prop} and put together a room concept`,
            `${firstName}, I saw your listing at ${prop} and came up with a staged idea`,
            `${firstName}, I saw your listing at ${prop} and tried a different angle`,
            `${firstName}, I saw your listing at ${prop} and created something for you`,
            `${firstName}, I saw your listing at ${prop} and wanted your take on this`,
            // --- "I noticed your property" variants ---
            `${firstName}, I noticed your property at ${prop} and made a quick concept`,
            `${firstName}, I noticed your property at ${prop} and staged a room for you`,
            `${firstName}, I noticed your property at ${prop} and put together a visual idea`,
            `${firstName}, I noticed your property at ${prop} and created something you may like`,
            `${firstName}, I noticed your property at ${prop} and worked up a staged photo`,
            `${firstName}, I noticed your property at ${prop} and made a before-and-after`,
            `${firstName}, I noticed your property at ${prop} and drafted a presentation idea`,
            `${firstName}, I noticed your property at ${prop} and created a new look for it`,
            `${firstName}, I noticed your property at ${prop} and wanted to show you something`,
            `${firstName}, I noticed your property at ${prop} and put together a quick mockup`,
            // --- short address-only subject lines ---
            `${firstName}, a staging idea for ${prop}`,
            `${firstName}, a fresh look for ${prop}`,
            `${firstName}, a staged version of ${prop}`,
            `${firstName}, one idea for ${prop}`,
            `${firstName}, a new look for ${prop}`,
            `${firstName}, a sharper first impression for ${prop}`,
            `${firstName}, a presentation concept for ${prop}`,
            `${firstName}, a room concept for ${prop}`,
            `${firstName}, a visual idea for ${prop}`,
            `${firstName}, a quick mockup for ${prop}`,
            `${firstName}, a furnished version of ${prop}`,
            `${firstName}, a styled photo for ${prop}`,
            `${firstName}, a before-and-after for ${prop}`,
            `${firstName}, a listing photo idea for ${prop}`,
            `${firstName}, a cleaner presentation for ${prop}`,
            `${firstName}, an interior concept for ${prop}`,
            `${firstName}, a staged photo for ${prop}`,
            `${firstName}, a quick visual for ${prop}`,
            // --- curiosity / soft hook variants ---
            `${firstName}, thought you might want to see this for ${prop}`,
            `${firstName}, had an idea for ${prop}`,
            `${firstName}, made something for ${prop}`,
            `${firstName}, created something for ${prop}`,
            `${firstName}, wanted to show you something about ${prop}`,
            `${firstName}, wanted to share an idea for ${prop}`,
            `${firstName}, put something together for ${prop}`,
            `${firstName}, worked up a concept for ${prop}`,
            `${firstName}, came across ${prop} and made this`,
            `${firstName}, came across your listing at ${prop} and created something for you`,
            `${firstName}, saw ${prop} and put a concept together`,
            `${firstName}, saw ${prop} and made a quick visual`,
            `${firstName}, saw ${prop} and created a staged version`,
            `${firstName}, saw ${prop} and wanted to show you this`,
        ];
        const subject = subjectTemplates[Math.floor(Math.random() * subjectTemplates.length)];

        const imagesHtml = lead.stagedImageUrl ? `
        <table width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0;">
          <tr>
            <td align="center" style="padding:0 0 12px 0;">
              <p style="margin:0 0 6px 0;font-size:13px;color:#666;font-weight:600;text-transform:uppercase;letter-spacing:1px;">BEFORE</p>
              ${lead.beforeImageUrl ? `<a href="${lead.beforeImageUrl}" target="_blank" style="display:block;"><img src="${lead.beforeImageUrl}" alt="Before" width="540" style="display:block;width:100%;max-width:540px;height:auto;border-radius:6px;border:1px solid #e5e7eb;" /></a>` : ''}
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:0;">
              <p style="margin:0 0 6px 0;font-size:13px;color:#7c3aed;font-weight:600;text-transform:uppercase;letter-spacing:1px;">VIRTUALLY STAGED BY KOGFLOW</p>
              <a href="${lead.stagedImageUrl}" target="_blank" style="display:block;"><img src="${lead.stagedImageUrl}" alt="Virtually staged room" width="540" style="display:block;width:100%;max-width:540px;height:auto;border-radius:6px;border:2px solid #7c3aed;" /></a>
            </td>
          </tr>
        </table>` : '';

        // Build context-aware personalized body copy
        const room = lead.roomType || 'room';
        const dom = lead.daysOnMarket ?? 0;
        const cityLabel = lead.city ? lead.city : '';
        const neighborhood = lead.keywords?.find(k => k && k.length > 2 && !/^\d/.test(k)) ?? '';

        // Opening line — varies by how long listing has been active
        const openingLine = (() => {
            if (lead.priceReduced) {
                return `I saw your listing at <strong>${lead.address}</strong> went through a price adjustment recently — so I staged the ${room} to give the photos a fresh angle that might re-spark some buyer interest.`;
            }
            if (dom >= 45) {
                return `I came across your ${cityLabel ? `${cityLabel} ` : ''}listing at <strong>${lead.address}</strong> and noticed it's been on the market for a little while, so I staged the ${room} to see if a furnished version helps it stand out more.`;
            }
            if (dom <= 7) {
                return `Saw your new listing at <strong>${lead.address}</strong>${neighborhood ? ` in ${neighborhood}` : ''} — nice property. I staged the ${room} to show buyers what it could look like furnished.`;
            }
            return `I came across your listing at <strong>${lead.address}</strong>${neighborhood ? ` in the ${neighborhood} area` : ''} and took the liberty of staging the ${room} — thought it might be worth a look.`;
        })();

        // Value line — varies by DOM context
        const valueLine = (() => {
            if (lead.priceReduced) {
                return `A fresh set of staged photos right after a price adjustment can re-engage buyers who skipped past it the first time. I put this together in seconds — happy to stage a couple more rooms at no cost.`;
            }
            if (dom >= 45) {
                return `Listings with staged photos tend to get more saves and scheduled showings. Sometimes one good image is all it takes to get a buyer to book a tour. Happy to stage a few more rooms for free if it's useful.`;
            }
            if (dom <= 7) {
                return `Now's a great time to make the photos pop while the listing is getting fresh traffic. Happy to send a couple more staged versions at no charge.`;
            }
            return `Staged photos help buyers picture themselves in the space — and they tend to lead to more saves and showings. Happy to do a few more rooms for free if you'd like.`;
        })();

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
            <p style="margin:0 0 16px;font-size:15px;color:#374151;line-height:1.6;">
              ${openingLine}
            </p>
            ${imagesHtml}
            <p style="margin:16px 0 16px;font-size:15px;color:#374151;line-height:1.6;">
              ${valueLine}
            </p>
            <p style="margin:0 0 16px;font-size:15px;color:#374151;line-height:1.6;">
              We can also turn any staged room into a <strong>virtual video walkthrough</strong> — gives buyers an immersive tour without setting foot in the property.
            </p>
            <p style="margin:0 0 24px;font-size:15px;color:#374151;line-height:1.6;">
              Either way, no strings attached — just let me know if you want more.
            </p>
            <table cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
              <tr>
                <td style="background:#7c3aed;border-radius:8px;padding:12px 24px;">
                  <a href="https://kogflow.com" style="color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;">See More Examples</a>
                </td>
              </tr>
            </table>
            <p style="margin:0;font-size:15px;color:#374151;">– Minh<br><a href="https://kogflow.com" style="color:#7c3aed;">Kogflow.com</a></p>
          </td>
        </tr>
        <tr>
          <td style="background:#f3f4f6;padding:16px 32px;">
            <p style="margin:0;font-size:12px;color:#9ca3af;">You received this because your listing at ${lead.address} is publicly listed. Reply "unsubscribe" to opt out.</p>
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

// Sends a test email to the given address and returns the raw result.
// Use this to confirm Gmail OAuth is wired up correctly before relying on the pipeline.
export async function sendTestEmail(toEmail: string): Promise<{ success?: boolean; error?: string; detail?: string }> {
    if (!GMAIL_CLIENT_ID || !GMAIL_CLIENT_SECRET || !GMAIL_REFRESH_TOKEN) {
        return {
            error: 'Gmail credentials missing',
            detail: `CLIENT_ID=${GMAIL_CLIENT_ID ? 'set' : 'EMPTY'} SECRET=${GMAIL_CLIENT_SECRET ? 'set' : 'EMPTY'} REFRESH_TOKEN=${GMAIL_REFRESH_TOKEN ? 'set' : 'EMPTY'}`,
        };
    }
    try {
        const accessToken = await getGmailAccessToken();
        const message = [
            `From: Kogflow <kogflow.media@gmail.com>`,
            `To: ${toEmail}`,
            `Subject: Kogflow email test`,
            `MIME-Version: 1.0`,
            `Content-Type: text/html; charset=utf-8`,
            ``,
            `<p>This is a test email from the Kogflow outreach pipeline. If you see this, Gmail OAuth is working correctly.</p>`,
        ].join('\r\n');
        const encoded = Buffer.from(message).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        const sendRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ raw: encoded }),
        });
        if (!sendRes.ok) {
            const err = await sendRes.text();
            return { error: `Gmail API ${sendRes.status}`, detail: err };
        }
        return { success: true };
    } catch (e: any) {
        return { error: e.message };
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
        // Must use Zyte — HAR.com blocks Vercel datacenter IPs for direct fetch
        const { html, error } = await zyteGet(fullUrl);
        if (error || !html) {
            console.warn(`[getHarListingPhotos] Zyte error for ${fullUrl}: ${error}`);
            return [];
        }

        const urls = [
            ...new Set(
                [...html.matchAll(/https:\/\/mediahar\.harstatic\.com\/[^"'\s]+\/lr\/[^"'\s]+\.jpeg/g)]
                    .map(m => m[0])
            ),
        ];
        return urls.slice(0, maxPhotos);
    } catch (err: any) {
        console.warn(`[getHarListingPhotos] error for ${fullUrl}: ${err.message}`);
        return [];
    }
}

// Scans photos from a HAR detail page and returns the first confirmed interior photo.
// Uses Moondream to reject exterior shots (front of house, yard, aerial, etc.).
// HAR photo order is typically [0]=exterior, then mixed — this guarantees interior.
async function findInteriorPhoto(listingUrl: string): Promise<string | null> {
    const photos = await getHarListingPhotos(listingUrl, 10);
    // Skip photo[0] — HAR always puts the exterior facade shot first
    for (const photo of photos.slice(1, 8)) {
        const { isStageable, error } = await detectRoom(photo);
        if (!error && isStageable) return photo;
    }
    return null; // no stageable room found — do not fall back to exterior/other
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
        const photos = await getHarListingPhotos(lead.listing_url, 5);
        const interiorPhotos = photos.slice(1, 5); // Skip photo[0] — always exterior facade on HAR
        const emptyRooms: { roomType: string; imageUrl: string }[] = [];

        for (const photoUrl of interiorPhotos) {
            const { isStageable, isEmpty, roomType, error: roomErr } = await detectRoom(photoUrl);
            if (roomErr) { errors.push(`${lead.address}: ${roomErr}`); continue; }
            // Must be a confirmed stageable room (bedroom/living/kitchen/dining/bath) AND empty
            if (isStageable && isEmpty) {
                emptyRooms.push({ roomType, imageUrl: photoUrl });
                break;
            }
        }

        if (emptyRooms.length > 0) {
            await supabase.from('outreach_leads').update({ empty_rooms: emptyRooms }).eq('id', lead.id);
            found++;
        } else if ((lead.icp_score ?? 0) >= 40 && interiorPhotos[0]) {
            // High ICP score (stricter 40+ threshold) but no empty room found.
            // Check the first interior photo for REDESIGN staging.
            const { isStageable: s2, roomType: rt2, isExterior: ex2 } = await detectRoom(interiorPhotos[0]);
            // ONLY proceed if it's confirmed stageable AND NOT exterior.
            if (s2 && !ex2) {
                const roomEntry = { roomType: rt2, imageUrl: interiorPhotos[0], redesign: true };
                await supabase.from('outreach_leads').update({ empty_rooms: [roomEntry] }).eq('id', lead.id);
                found++;
            }
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

export async function getActiveSession(): Promise<{ sessionId?: string; isRunning: boolean }> {
    const supabase = createClient(supabaseUrl, supabaseKey);
    const since = new Date(Date.now() - 20 * 60 * 1000).toISOString();

    // Try pipeline_session_log first (table may not exist)
    const { data, error } = await supabase
        .from('pipeline_session_log')
        .select('session_id, message, logged_at')
        .gte('logged_at', since)
        .order('logged_at', { ascending: false })
        .limit(200);

    if (!error && data && data.length > 0) {
        const startEntry = data.find(r => r.message === '__SESSION_START__');
        if (!startEntry) return { isRunning: false };
        const sid = startEntry.session_id;
        const isDone = data.some(r => r.session_id === sid && (r.message === '__SESSION_COMPLETE__' || r.message === '__STOP_REQUESTED__'));
        if (isDone) return { isRunning: false };
        return { sessionId: sid, isRunning: true };
    }

    // Fallback: check pipeline_runs for in-progress marker (processed = -1)
    const since30 = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const { data: pending } = await supabase
        .from('pipeline_runs')
        .select('id, errors')
        .eq('processed', -1)
        .gte('ran_at', since30)
        .order('ran_at', { ascending: false })
        .limit(1);

    if (pending && pending.length > 0) {
        const logEntry = (pending[0].errors || []).find((e: string) => e.startsWith('LOG:Session '));
        const sessionId = logEntry?.match(/Session (.+) starting\.\.\./)?.[1] || pending[0].id;
        return { sessionId, isRunning: true };
    }

    return { isRunning: false };
}

export async function requestSessionStop(sessionId: string): Promise<void> {
    const supabase = createClient(supabaseUrl, supabaseKey);
    const { error } = await supabase.from('pipeline_session_log').insert({ session_id: sessionId, message: '__STOP_REQUESTED__' });
    if (!error) return;

    const { data: pending } = await supabase
        .from('pipeline_runs')
        .select('id, errors')
        .eq('processed', -1)
        .order('ran_at', { ascending: false })
        .limit(20);

    const matchingRun = (pending || []).find((run: { id: string; errors?: string[] }) =>
        (run.errors || []).some((entry: string) => entry === `LOG:Session ${sessionId} starting...`)
    );

    if (!matchingRun) return;

    const nextErrors = [...(matchingRun.errors || [])];
    if (!nextErrors.includes('LOG:__STOP_REQUESTED__')) {
        nextErrors.push('LOG:__STOP_REQUESTED__');
        await supabase.from('pipeline_runs').update({ errors: nextErrors }).eq('id', matchingRun.id);
    }
}

export async function getRecentActivityLog(limit = 300): Promise<{ entries?: { logged_at: string; session_id: string; message: string }[]; error?: string }> {
    const supabase = createClient(supabaseUrl, supabaseKey);
    const { data, error } = await supabase
        .from('pipeline_session_log')
        .select('logged_at, session_id, message')
        .order('logged_at', { ascending: false })
        .limit(limit);
    // Only use session_log if it has actual entries; otherwise fall through to pipeline_runs
    if (!error && data && data.length > 0) return { entries: data.reverse() };

    // Table missing OR empty — fall back to pipeline_runs (debug lines stored with LOG: prefix)
    const { data: runs, error: runsErr } = await supabase
        .from('pipeline_runs')
        .select('id, ran_at, processed, errors')
        .order('ran_at', { ascending: false })
        .limit(20);
    if (runsErr) return { error: runsErr.message };

    const entries: { logged_at: string; session_id: string; message: string }[] = [];
    for (const run of (runs || []).reverse()) {
        const logLines = (run.errors || [])
            .filter((e: string) => e.startsWith('LOG:'))
            .map((e: string) => e.slice(4));
        if (logLines.length > 0) {
            entries.push({ logged_at: run.ran_at, session_id: run.id, message: `--- Session ${new Date(run.ran_at).toLocaleTimeString()} ---` });
            for (const line of logLines) {
                entries.push({ logged_at: run.ran_at, session_id: run.id, message: line });
            }
        } else {
            entries.push({ logged_at: run.ran_at, session_id: run.id, message: `Session complete: ${run.processed} leads processed` });
        }
    }
    return { entries: entries.slice(-limit) };
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
    // Scrape enough inventory to fill the session target without overfetching every city.
    // Large sessions used to scrape 4x the session target PER city, which could exceed
    // Vercel's 5-minute function limit. We now distribute the fetch budget across cities.
    const cityCount = Math.max(config.cities.length, 1);
    const bufferMultiplier = cityCount <= 2 ? 4 : cityCount <= 5 ? 3 : 2;
    const batchSize = Math.max(20, Math.ceil((config.scrapesPerSession * bufferMultiplier) / cityCount));
    const harPages = Math.min(2, Math.max(1, Math.ceil(batchSize / 50)));

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

    // Write sentinel so UI can detect active session on page reload (table may not exist — non-fatal)
    await supabase.from('pipeline_session_log').insert({ session_id: sessionId, message: '__SESSION_START__' }).then(null, () => {});

    await log(`Session ${sessionId} started`);
    await log(`Scraping ${config.cities.length} cities in parallel (${batchSize} listings each, ${harPages} HAR pages)...`);

    // ── Step 1: Scrape all cities via HAR (+ homes.com fallback) in parallel ──
    // City lambdas push into local arrays then we log after all resolve
    const cityResults = await Promise.all(
        config.cities.map(async (city) => {
            const lines: string[] = [];
            const harResult = await scrapeHarCity(city, batchSize, harPages);
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

    // Respect exactly what the user configured
    const maxPerSession = Math.min(newListings.length, config.scrapesPerSession);
    const toProcess = newListings.slice(0, maxPerSession);
    await log(`Processing ${toProcess.length} new leads (target: ${config.scrapesPerSession})...`);

    // ── Step 4: Moondream — check listings that have keywords suggesting vacancy ──
    // HAR search results only return 1 photo (PHOTOPRIMARY), so we filter by keywords first:
    // "vacant", "unfurnished", "empty", "needs staging" → high likelihood of empty rooms
    // Fallback: check any listing with DOM >= 60 (motivated seller, may be vacant)
    // Limit: 20 Moondream calls max to stay within time budget (~2 min)
    let emptyRoomsFound = 0;
    let moondreamChecked = 0;
    let highScoreStaged = 0;
    const MAX_MOONDREAM = 20;
    const MAX_HIGH_SCORE_STAGE = 10; // max redesigns per session to control Kie.ai credits

    // Sort toProcess so vacant/unfurnished keyword listings come first
    const vacancyKeywords = ['vacant', 'unfurnished', 'empty', 'needs staging', 'unoccupied', 'immediate occupancy', 'no furnit'];
    toProcess.sort((a, b) => {
        const aKw = a.keywords.join(' ').toLowerCase();
        const bKw = b.keywords.join(' ').toLowerCase();
        const aVacant = vacancyKeywords.some(k => aKw.includes(k)) ? 1 : 0;
        const bVacant = vacancyKeywords.some(k => bKw.includes(k)) ? 1 : 0;
        return bVacant - aVacant || (b.daysOnMarket ?? 0) - (a.daysOnMarket ?? 0);
    });

    await log(`Target: ${minEmptyRooms} empty rooms (checking up to ${MAX_MOONDREAM} leads with Moondream)`);

    for (const listing of toProcess) {
        // Check for stop request every 3rd lead to keep DB calls low
        if (processed > 0 && processed % 3 === 0) {
            let stopRequested = false;

            const { data: stopData, error: stopError } = await supabase
                .from('pipeline_session_log')
                .select('id')
                .eq('session_id', sessionId)
                .eq('message', '__STOP_REQUESTED__')
                .limit(1);

            if (!stopError) {
                stopRequested = (stopData?.length ?? 0) > 0;
            } else {
                const { data: pendingRuns } = await supabase
                    .from('pipeline_runs')
                    .select('id, errors')
                    .eq('processed', -1)
                    .order('ran_at', { ascending: false })
                    .limit(20);

                stopRequested = (pendingRuns || []).some((run: { errors?: string[] }) =>
                    (run.errors || []).includes(`LOG:Session ${sessionId} starting...`) &&
                    (run.errors || []).includes('LOG:__STOP_REQUESTED__')
                );
            }

            if (stopRequested) {
                await log(`Session stopped by user after ${processed} leads`);
                await flushLog();
                await supabase.from('pipeline_session_log').insert({ session_id: sessionId, message: '__SESSION_COMPLETE__' }).then(null, () => {});
                return { processed, errors, debug, sessionId };
            }
        }

        listing.score = await scoreICP(listing);
        const emptyRooms: { roomType: string; imageUrl: string }[] = [];
        let furnishedRoom: { roomType: string; imageUrl: string } | null = null;

        // Run Moondream when:
        //   (a) still looking for empty rooms, OR
        //   (b) listing scores 25+ — qualifies for furnished redesign even if empty target is met
        const shouldRunMoondream = moondreamChecked < MAX_MOONDREAM &&
            (emptyRoomsFound < minEmptyRooms || listing.score >= 25);

        if (shouldRunMoondream) {
            moondreamChecked++;
            const detailPhotos = await getHarListingPhotos(listing.listingUrl, 8);
            await log(`  [${listing.address}] ${detailPhotos.length} photos (url: ${listing.listingUrl})`);
            let foundStageable = false;
            for (const photo of detailPhotos.slice(1, 7)) { // Skip photo[0] — always exterior facade on HAR
                const { isStageable, isEmpty, roomType, error: roomErr } = await detectRoom(photo);
                if (roomErr) { await log(`  [${listing.address}] Moondream error: ${roomErr}`); continue; }
                await log(`  [${listing.address}] stageable=${isStageable} empty=${isEmpty} type=${roomType}`);
                if (!isStageable) continue; // floor plan / entryway / stairway / exterior — skip
                foundStageable = true;
                if (isEmpty) {
                    emptyRooms.push({ roomType, imageUrl: photo });
                    emptyRoomsFound++;
                    await log(`  → Empty ${roomType}! Total: ${emptyRoomsFound}/${minEmptyRooms}`);
                    break; // Found confirmed empty stageable room — stop scanning this listing
                }
                // Furnished stageable room — record first one found, keep scanning for empty
                if (!furnishedRoom) furnishedRoom = { roomType, imageUrl: photo };
            }
            if (!foundStageable) await log(`  [${listing.address}] No stageable room found (all floor plans / entryways / exterior)`);
        } else if (moondreamChecked >= MAX_MOONDREAM) {
            await log(`  [${listing.address}] Skipping Moondream (${MAX_MOONDREAM} limit reached)`);
        } else {
            await log(`  [${listing.address}] Skipping Moondream (empty target met, score ${listing.score} < 25)`);
        }

        const saveResult = await saveLead({ ...listing, emptyRooms });
        if (saveResult.error) {
            await log(`[${listing.city}] ${listing.address} — save error: ${saveResult.error}`);
            errors.push(`Save error: ${saveResult.error}`);
            continue;
        }

        const leadId = saveResult.lead?.id;
        if (!leadId) continue;

        // Mark as scored (ICP score was computed — separate from 'scraped' baseline)
        await updateLeadStatus(leadId, 'scored');

        if (emptyRooms.length > 0) {
            // Empty room — add furniture
            const { taskId, error: stageErr } = await stageEmptyRoom(emptyRooms[0].imageUrl, emptyRooms[0].roomType, false);
            if (taskId) {
                await updateLeadStatus(leadId, 'staged', { staging_task_id: taskId });
                await log(`  → Staged (empty room, add furniture) taskId=${taskId}`);
            } else {
                await log(`  → Stage FAILED: ${stageErr}`);
            }
        } else if (furnishedRoom && listing.score >= 25 && highScoreStaged < MAX_HIGH_SCORE_STAGE) {
            // Furnished room + score 25+ — redesign existing staging
            highScoreStaged++;
            const { taskId, error: stageErr } = await stageEmptyRoom(furnishedRoom.imageUrl, furnishedRoom.roomType, true);
            if (taskId) {
                // Store furnished room as before-photo reference so poll/email step can use it
                await supabase.from('outreach_leads')
                    .update({ empty_rooms: [{ roomType: furnishedRoom.roomType, imageUrl: furnishedRoom.imageUrl }] })
                    .eq('id', leadId);
                await updateLeadStatus(leadId, 'staged', { staging_task_id: taskId });
                await log(`  → Staged (score ${listing.score} furnished redesign) taskId=${taskId}`);
            } else {
                await log(`  → Redesign FAILED: ${stageErr}`);
            }
        }

        processed++;
        await log(`[${listing.city}] ✓ Saved: ${listing.address} (score ${listing.score}, emptyRooms=${emptyRooms.length}, furnishedRoom=${furnishedRoom?.roomType ?? 'none'})`);
    }

    if (allListings.length === 0) {
        await log('No listings found — check city list and Zyte API key');
    }
    await log(`Session complete: ${processed} saved, ${emptyRoomsFound}/${minEmptyRooms} empty rooms found`);
    await flushLog();
    await supabase.from('pipeline_session_log').insert({ session_id: sessionId, message: '__SESSION_COMPLETE__' }).then(null, () => {});
    return { processed, errors, debug, sessionId };
}

// One-time backfill: promote 'scraped' leads that have icp_score > 0 to 'scored'
export async function backfillScoredStatus(): Promise<{ updated: number; error?: string }> {
    const supabase = createClient(supabaseUrl, supabaseKey);
    const { data, error } = await supabase
        .from('outreach_leads')
        .update({ status: 'scored' })
        .eq('status', 'scraped')
        .gt('icp_score', 0)
        .select('id');
    if (error) return { updated: 0, error: error.message };
    return { updated: data?.length || 0 };
}

// ─────────────────────────────────────────────
// 9. PIPELINE CONFIG — Persist & load settings
// ─────────────────────────────────────────────

export interface PipelineConfig {
    sessions_per_day: number;
    scrapes_per_session: number;
    cities: string[];
    cron_enabled: boolean;
}

export async function savePipelineConfig(config: PipelineConfig): Promise<{ success?: boolean; error?: string }> {
    const supabase = createClient(supabaseUrl, supabaseKey);
    // cron_enabled column may not exist yet — upsert without it if insert fails
    const row = { id: 1, ...config, updated_at: new Date().toISOString() };
    const { error } = await supabase.from('pipeline_config').upsert(row, { onConflict: 'id' });
    if (error?.message?.includes('cron_enabled')) {
        const { cron_enabled: _ce, ...rowWithout } = row;
        await supabase.from('pipeline_config').upsert(rowWithout, { onConflict: 'id' });
    } else if (error) return { error: error.message };
    return { success: true };
}

export async function loadPipelineConfig(): Promise<{ config?: PipelineConfig; error?: string }> {
    const supabase = createClient(supabaseUrl, supabaseKey);
    const { data, error } = await supabase.from('pipeline_config').select('*').eq('id', 1).single();
    const defaults: PipelineConfig = { sessions_per_day: 3, scrapes_per_session: 10, cron_enabled: true, cities: ['Houston', 'Katy', 'Sugar Land', 'Spring', 'Pearland', 'The Woodlands', 'Cypress', 'Pasadena', 'Humble', 'Friendswood'] };
    if (error || !data) return { config: defaults };
    return { config: { sessions_per_day: data.sessions_per_day, scrapes_per_session: data.scrapes_per_session, cities: data.cities, cron_enabled: data.cron_enabled ?? true } };
}

// ─────────────────────────────────────────────
// 10. PIPELINE RUNS — Log cron executions
// ─────────────────────────────────────────────

// trigger: 'cron' for scheduled runs, 'manual' for UI-triggered runs.
// Only cron runs count toward sessions_per_day so manual runs don't consume the budget.
export async function logPipelineRun(result: { processed: number; errors: string[]; debug?: string[]; trigger?: 'cron' | 'manual' }): Promise<void> {
    const supabase = createClient(supabaseUrl, supabaseKey);
    const row: any = {
        ran_at: new Date().toISOString(),
        processed: result.processed,
        errors: [...(result.errors || []), ...(result.debug || []).map(d => `LOG:${d}`)],
        trigger: result.trigger ?? 'cron',
    };
    const { error } = await supabase.from('pipeline_runs').insert(row);
    if (error?.message?.includes('trigger')) {
        // trigger column not yet added — insert without it
        const { trigger: _t, ...rowWithout } = row;
        await supabase.from('pipeline_runs').insert(rowWithout);
    }
}

// Count cron-only runs today (manual UI runs don't count toward the daily limit).
export async function countTodayCronRuns(): Promise<number> {
    const supabase = createClient(supabaseUrl, supabaseKey);
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    // Try to filter by trigger='cron'; fall back to all runs if column missing
    const { count, error } = await supabase
        .from('pipeline_runs')
        .select('*', { count: 'exact', head: true })
        .gte('ran_at', today.toISOString())
        .neq('processed', -1)
        .eq('trigger', 'cron');
    if (error?.message?.includes('trigger')) {
        // Column doesn't exist yet — count all completed runs
        const { count: all } = await supabase
            .from('pipeline_runs')
            .select('*', { count: 'exact', head: true })
            .gte('ran_at', today.toISOString())
            .neq('processed', -1);
        return all ?? 0;
    }
    return count ?? 0;
}

// Returns cron schedule health info for the dashboard.
// Cron fires hourly 13–22 UTC (8am–5pm CDT). Slots expected so far today = hours elapsed in that window.
export async function getCronStatus(): Promise<{
    cron_enabled: boolean;
    sessions_per_day: number;
    today_cron_runs: number;
    last_cron_run: string | null;
    next_scheduled_utc: string;
    expected_so_far: number;
    schedule: string;
}> {
    const supabase = createClient(supabaseUrl, supabaseKey);
    const { config } = await loadPipelineConfig();

    const now = new Date();
    const utcHour = now.getUTCHours();
    // Cron schedule: 13–22 UTC inclusive (10 slots/day)
    const CRON_HOURS = [13, 14, 15, 16, 17, 18, 19, 20, 21, 22];
    const passedHours = CRON_HOURS.filter(h => h <= utcHour);
    const expected_so_far = passedHours.length;

    // Next scheduled UTC time
    const nextHour = CRON_HOURS.find(h => h > utcHour);
    let next_scheduled_utc: string;
    if (nextHour !== undefined) {
        const next = new Date(now);
        next.setUTCHours(nextHour, 0, 0, 0);
        next_scheduled_utc = next.toISOString();
    } else {
        // Tomorrow at 13 UTC
        const next = new Date(now);
        next.setUTCDate(next.getUTCDate() + 1);
        next.setUTCHours(13, 0, 0, 0);
        next_scheduled_utc = next.toISOString();
    }

    // Last cron run — try to filter by trigger='cron', fall back to any run
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const { data: cronRuns, error } = await supabase
        .from('pipeline_runs')
        .select('ran_at, processed')
        .gte('ran_at', today.toISOString())
        .neq('processed', -1)
        .eq('trigger', 'cron')
        .order('ran_at', { ascending: false })
        .limit(20);

    let today_cron_runs = 0;
    let last_cron_run: string | null = null;

    if (error?.message?.includes('trigger')) {
        // Column missing — show all runs (will overcount manual runs, but gives signal)
        const { data: allRuns } = await supabase
            .from('pipeline_runs')
            .select('ran_at')
            .gte('ran_at', today.toISOString())
            .neq('processed', -1)
            .order('ran_at', { ascending: false })
            .limit(1);
        last_cron_run = allRuns?.[0]?.ran_at ?? null;
        today_cron_runs = 0;
    } else {
        today_cron_runs = cronRuns?.length ?? 0;
        last_cron_run = cronRuns?.[0]?.ran_at ?? null;
    }

    return {
        cron_enabled: config?.cron_enabled ?? true,
        sessions_per_day: config?.sessions_per_day ?? 3,
        today_cron_runs,
        last_cron_run,
        next_scheduled_utc,
        expected_so_far,
        schedule: 'Hourly 8am–5pm CDT (13–22 UTC)',
    };
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
