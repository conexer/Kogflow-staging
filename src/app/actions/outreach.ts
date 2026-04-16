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

// City → GPS coordinates for Zyte geolocation spoofing
// Makes sites serve city-specific content instead of national/generic pages
const CITY_COORDS: Record<string, { latitude: number; longitude: number }> = {
    'Houston': { latitude: 29.7604, longitude: -95.3698 },
    'Katy': { latitude: 29.7858, longitude: -95.8245 },
    'Sugar Land': { latitude: 29.6197, longitude: -95.6349 },
    'Spring': { latitude: 30.0799, longitude: -95.4172 },
    'Pearland': { latitude: 29.5635, longitude: -95.2860 },
    'The Woodlands': { latitude: 30.1658, longitude: -95.4613 },
    'Cypress': { latitude: 29.9691, longitude: -95.6972 },
    'Pasadena': { latitude: 29.6911, longitude: -95.2091 },
    'Humble': { latitude: 29.9988, longitude: -95.2627 },
    'Friendswood': { latitude: 29.5294, longitude: -95.2010 },
    'League City': { latitude: 29.5075, longitude: -95.0949 },
    'Baytown': { latitude: 29.7355, longitude: -94.9774 },
    'Conroe': { latitude: 30.3119, longitude: -95.4561 },
    'Tomball': { latitude: 30.0974, longitude: -95.6163 },
    'Richmond': { latitude: 29.5819, longitude: -95.7608 },
    'Rosenberg': { latitude: 29.5572, longitude: -95.8086 },
    'Austin': { latitude: 30.2672, longitude: -97.7431 },
    'San Antonio': { latitude: 29.4241, longitude: -98.4936 },
    'Dallas': { latitude: 32.7767, longitude: -96.7970 },
    'Fort Worth': { latitude: 32.7555, longitude: -97.3308 },
    'Phoenix': { latitude: 33.4484, longitude: -112.0740 },
    'Atlanta': { latitude: 33.7490, longitude: -84.3880 },
    'Las Vegas': { latitude: 36.1699, longitude: -115.1398 },
    'Denver': { latitude: 39.7392, longitude: -104.9903 },
    'Nashville': { latitude: 36.1627, longitude: -86.7816 },
    'Charlotte': { latitude: 35.2271, longitude: -80.8431 },
    'Tampa': { latitude: 27.9506, longitude: -82.4572 },
    'Orlando': { latitude: 28.5383, longitude: -81.3792 },
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
                question: 'Is this room empty and unfurnished with no furniture? Reply in this exact format with no brackets: YES or NO, then a number 0 to 100 for your confidence, then the room type. Example: YES, 85, bedroom',
                stream: false,
            }),
        });

        if (!res.ok) {
            const err = await res.text();
            return { isEmpty: false, confidence: 0, roomType: 'unknown', error: `Moondream error ${res.status}: ${err}` };
        }

        const data = await res.json();
        const answer: string = data.answer || data.result || '';

        // Strip brackets, normalize — Moondream often ignores format instructions
        const clean = answer.replace(/[\[\]]/g, '').trim();
        // Check for YES/NO anywhere in the answer (handles "YES 0", "Yes,85,bedroom", "[Yes]" etc.)
        const isEmpty = /\byes\b/i.test(clean);
        // Extract first number found — handles "85", "0-10" (take upper), "YES 0"
        const numMatch = clean.match(/(\d+)(?:\s*-\s*(\d+))?/);
        const rawConf = numMatch
            ? numMatch[2] ? parseInt(numMatch[2]) : parseInt(numMatch[1])
            : 0;
        // If Moondream says YES but gives very low/zero confidence, default to 50 (trust the YES)
        const confidence = isEmpty && rawConf <= 15 ? 50 : rawConf;
        // Extract room type — last word-group after removing YES/NO and numbers
        const roomTypeMatch = clean.replace(/\byes\b|\bno\b|\d+(-\d+)?/gi, '').replace(/[,\s]+/g, ' ').trim();
        const roomType = roomTypeMatch.toLowerCase() || 'unknown';

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

export async function getLeadStats() {
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data, error } = await supabase
        .from('outreach_leads')
        .select('status, icp_score');

    if (error) return { error: error.message };

    const stats = {
        total: data?.length || 0,
        scraped: data?.filter(l => l.status === 'scraped').length || 0,
        scored: data?.filter(l => l.status === 'scored').length || 0,
        staged: data?.filter(l => l.status === 'staged').length || 0,
        form_filled: data?.filter(l => l.status === 'form_filled').length || 0,
        emailed: data?.filter(l => l.status === 'emailed').length || 0,
        avgScore: data?.length ? Math.round(data.reduce((s, l) => s + (l.icp_score || 0), 0) / data.length) : 0,
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
                model: 'nano-banana-pro',
                input: {
                    prompt,
                    image_input: [imageUrl],
                    aspect_ratio: 'auto',
                },
            }),
        });

        if (!res.ok) return { error: `Kie.ai error: ${res.status}` };
        const data = await res.json();
        const taskId = data.data?.taskId;
        if (!taskId) return { error: 'No taskId returned' };
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
}): Promise<{ success?: boolean; error?: string }> {
    if (!GMAIL_CLIENT_ID || !GMAIL_CLIENT_SECRET || !GMAIL_REFRESH_TOKEN) {
        return { error: 'Gmail OAuth credentials not configured' };
    }
    if (!lead.agentEmail) return { error: 'No agent email' };

    try {
        const accessToken = await getGmailAccessToken();

        const subject = `Your listing at ${lead.address} — free virtual staging sample inside`;
        const body = `Hi ${lead.agentName || 'there'},

I noticed your listing at ${lead.address} and wanted to reach out.

${lead.stagedImageUrl ? `I took the liberty of virtually staging one of your empty rooms — you can see it here:\n${lead.stagedImageUrl}\n\n` : ''}Virtual staging typically helps homes sell faster and for more. We do it in about 15 seconds at Kogflow.com — no design skills needed.

Would love to show you what it could do for this listing. Happy to send a few free samples if you're curious.

Best,
Kogflow
https://kogflow.com`;

        // Encode as RFC 2822 message
        const message = [
            `From: Kogflow <kogflow.media@gmail.com>`,
            `To: ${lead.agentEmail}`,
            `Subject: ${subject}`,
            `Content-Type: text/plain; charset=utf-8`,
            ``,
            body,
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
        const { html, error } = await zyteGet(fullUrl);
        if (error || !html) return [];

        // Extract unique low-res photo URLs (lr = low-res, good enough for Moondream)
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

// ─────────────────────────────────────────────
// 8. PIPELINE RUNNER — Orchestrates everything
// ─────────────────────────────────────────────

export async function runPipelineSession(config: {
    cities: string[];
    scrapesPerSession: number;
    minLeads?: number;
}): Promise<{ processed: number; errors: string[]; debug: string[] }> {
    const errors: string[] = [];
    const debug: string[] = [];
    let processed = 0;
    const minLeads = config.minLeads ?? 1;
    const batchSize = Math.max(20, Math.ceil(config.scrapesPerSession / Math.max(config.cities.length, 1)));

    // ── Step 1: Scrape all cities in PARALLEL (huge speed boost) ──────────────
    debug.push(`Scraping ${config.cities.length} cities in parallel (${batchSize} listings each, 2 HAR pages)...`);

    const cityResults = await Promise.all(
        config.cities.map(async (city) => {
            // HAR.com primary (2 pages = up to 240 listings per city), homes.com fallback
            const harResult = await scrapeHarCity(city, batchSize, 2);
            if (harResult.listings && harResult.listings.length > 0) {
                debug.push(`[${city}] HAR: ${harResult.listings.length} listings`);
                return { city, listings: harResult.listings };
            }
            if (harResult.error) debug.push(`[${city}] HAR error: ${harResult.error}`);
            else debug.push(`[${city}] HAR: 0 listings — trying homes.com...`);

            // Fallback: homes.com with geolocation
            const homesResult = await scrapeHomesCity(city, batchSize);
            if (homesResult.listings && homesResult.listings.length > 0) {
                debug.push(`[${city}] homes.com: ${homesResult.listings.length} listings`);
                return { city, listings: homesResult.listings };
            }
            if (homesResult.error) {
                errors.push(`${city}: ${homesResult.error}`);
                debug.push(`[${city}] homes.com error: ${homesResult.error}`);
            } else {
                debug.push(`[${city}] homes.com: 0 listings`);
            }
            return { city, listings: [] as ScrapedListing[] };
        })
    );

    // Flatten all listings, deduplicate by address
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
    debug.push(`Total unique listings across all cities: ${allListings.length}`);

    // ── Step 2: Process & save each listing ───────────────────────────────────
    for (const listing of allListings) {
        listing.score = await scoreICP(listing);

        // Get all listing photos — fetch detail page if it's a HAR listing (1 → up to 10 photos)
        let photoUrls = listing.photos; // primary photo from search results
        if (listing.listingUrl?.includes('har.com/homedetail')) {
            const detailPhotos = await getHarListingPhotos(listing.listingUrl, 10);
            if (detailPhotos.length > 0) {
                photoUrls = detailPhotos;
                debug.push(`[${listing.city}] ${listing.address} — fetched ${detailPhotos.length} photos from listing page`);
            }
        }

        // Analyze each photo with Moondream to detect empty rooms
        const emptyRooms: { roomType: string; imageUrl: string; stagedUrl?: string }[] = [];
        for (const photoUrl of photoUrls.slice(0, 10)) {
            const { isEmpty, confidence, roomType, error: roomErr } = await detectRoom(photoUrl);
            if (roomErr) { debug.push(`  Moondream error: ${roomErr}`); continue; }
            debug.push(`  Photo: isEmpty=${isEmpty} conf=${confidence} type=${roomType}`);
            if (isEmpty && confidence >= 20) {
                emptyRooms.push({ roomType, imageUrl: photoUrl });
            }
        }

        // Save lead
        const saveResult = await saveLead({ ...listing, emptyRooms });
        if (saveResult.skipped) {
            debug.push(`[${listing.city}] ${listing.address} — already in DB`);
            continue;
        }
        if (saveResult.error) {
            debug.push(`[${listing.city}] ${listing.address} — save error: ${saveResult.error}`);
            errors.push(`Save error: ${saveResult.error}`);
            continue;
        }

        const leadId = saveResult.lead?.id;
        if (!leadId) continue;

        // Stage the first empty room if available
        if (emptyRooms.length > 0) {
            const firstRoom = emptyRooms[0];
            const { taskId } = await stageEmptyRoom(firstRoom.imageUrl, firstRoom.roomType);
            if (taskId) {
                await updateLeadStatus(leadId, 'staged', { staging_task_id: taskId });
            }
        }

        processed++;
        debug.push(`[${listing.city}] ✓ Saved: ${listing.address} (score ${listing.score})`);
    }

    if (allListings.length === 0) {
        debug.push('No listings found across any city — check city list and Zyte API key');
    } else if (processed === 0) {
        debug.push('Listings were found but all skipped (already in DB or save errors)');
    }

    return { processed, errors, debug };
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

export async function testAllSites(): Promise<SiteTestResult[]> {
    return Promise.all(SITE_TEST_URLS.map(s => testSiteWithZyte(s.site)));
}
