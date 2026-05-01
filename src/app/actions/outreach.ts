'use server';

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const ZYTE_API_KEY = process.env.ZYTE_API_KEY!;
const MOONDREAM_API_KEY = (process.env.MOONDREAM_API_KEY || '').trim();
const GEMINI_API_KEY = (process.env.GEMINI_API_KEY || '').trim();
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

interface TargetMarket {
    label: string;
    city: string;
    state: string;
    homesSlug: string;
    sourcePriority: ('har' | 'homes')[];
}

// ─────────────────────────────────────────────
// 1. ICP SCORING
// ─────────────────────────────────────────────

export async function scoreICP(listing: Partial<ScrapedListing>): Promise<number> {
    let score = 0;
    const kw = listing.keywords?.join(' ').toLowerCase() || '';
    const agentText = `${listing.agentName || ''} ${listing.agentEmail || ''}`.toLowerCase();

    const hasAny = (terms: string[]) => terms.some(term => kw.includes(term));

    if (kw.includes('vacant') || kw.includes('unfurnished') || kw.includes('immediate occupancy')) score += 40;
    if (hasAny(['empty', 'unoccupied', 'no furniture', 'not furnished', 'blank canvas'])) score += 30;
    if (hasAny(['needs tlc', 'needs work', 'fixer', 'fixer upper', 'handyman', 'rehab', 'renovation opportunity', 'investor special'])) score += 30;
    if (hasAny(['investor opportunity', 'value-add', 'value add', 'rental opportunity', 'flip opportunity'])) score += 25;
    if (hasAny(['priced below market', 'new price', 'price improvement', 'recent price drop', 'motivated seller', 'bring all offers'])) score += 20;
    if (hasAny(['bring your vision', 'make it your own', 'tons of potential', 'great potential', 'cosmetic updates', 'as-is', 'as is', 'estate sale'])) score += 15;
    if (listing.priceReduced) score += 25;
    if ((listing.daysOnMarket || 0) >= 60) score += 20;
    else if ((listing.daysOnMarket || 0) >= 30) score += 5;
    if ((listing.photoCount || 99) < 15) score += 10;
    if ((listing.photoCount || 99) < 8) score += 5;
    if (normalizeAgentEmail(listing.agentEmail)) score += 10;
    if (agentText.includes('builder') || agentText.includes('new home') || agentText.includes('sales office')) score -= 20;
    if ((listing.price || 0) >= 200000 && (listing.price || 0) <= 650000) score += 5;

    return Math.max(0, score);
}

// ─────────────────────────────────────────────
// 2. ZYTE SCRAPER — homes.com + HAR.com
// ─────────────────────────────────────────────

// City → homes.com URL slug lookup
const TARGET_MARKETS: TargetMarket[] = [
    { label: 'Phoenix, AZ', city: 'Phoenix', state: 'AZ', homesSlug: 'phoenix-az', sourcePriority: ['homes'] },
    { label: 'Scottsdale, AZ', city: 'Scottsdale', state: 'AZ', homesSlug: 'scottsdale-az', sourcePriority: ['homes'] },
    { label: 'Mesa, AZ', city: 'Mesa', state: 'AZ', homesSlug: 'mesa-az', sourcePriority: ['homes'] },
    { label: 'Las Vegas, NV', city: 'Las Vegas', state: 'NV', homesSlug: 'las-vegas-nv', sourcePriority: ['homes'] },
    { label: 'Henderson, NV', city: 'Henderson', state: 'NV', homesSlug: 'henderson-nv', sourcePriority: ['homes'] },
    { label: 'Denver, CO', city: 'Denver', state: 'CO', homesSlug: 'denver-co', sourcePriority: ['homes'] },
    { label: 'Aurora, CO', city: 'Aurora', state: 'CO', homesSlug: 'aurora-co', sourcePriority: ['homes'] },
    { label: 'Atlanta, GA', city: 'Atlanta', state: 'GA', homesSlug: 'atlanta-ga', sourcePriority: ['homes'] },
    { label: 'Charlotte, NC', city: 'Charlotte', state: 'NC', homesSlug: 'charlotte-nc', sourcePriority: ['homes'] },
    { label: 'Raleigh, NC', city: 'Raleigh', state: 'NC', homesSlug: 'raleigh-nc', sourcePriority: ['homes'] },
    { label: 'Nashville, TN', city: 'Nashville', state: 'TN', homesSlug: 'nashville-tn', sourcePriority: ['homes'] },
    { label: 'Tampa, FL', city: 'Tampa', state: 'FL', homesSlug: 'tampa-fl', sourcePriority: ['homes'] },
    { label: 'Orlando, FL', city: 'Orlando', state: 'FL', homesSlug: 'orlando-fl', sourcePriority: ['homes'] },
    { label: 'Jacksonville, FL', city: 'Jacksonville', state: 'FL', homesSlug: 'jacksonville-fl', sourcePriority: ['homes'] },
    { label: 'Miami, FL', city: 'Miami', state: 'FL', homesSlug: 'miami-fl', sourcePriority: ['homes'] },
    { label: 'Sacramento, CA', city: 'Sacramento', state: 'CA', homesSlug: 'sacramento-ca', sourcePriority: ['homes'] },
    { label: 'Fresno, CA', city: 'Fresno', state: 'CA', homesSlug: 'fresno-ca', sourcePriority: ['homes'] },
    { label: 'Portland, OR', city: 'Portland', state: 'OR', homesSlug: 'portland-or', sourcePriority: ['homes'] },
    { label: 'Seattle, WA', city: 'Seattle', state: 'WA', homesSlug: 'seattle-wa', sourcePriority: ['homes'] },
    { label: 'Austin, TX', city: 'Austin', state: 'TX', homesSlug: 'austin-tx', sourcePriority: ['har', 'homes'] },
    { label: 'Dallas, TX', city: 'Dallas', state: 'TX', homesSlug: 'dallas-tx', sourcePriority: ['har', 'homes'] },
    { label: 'Fort Worth, TX', city: 'Fort Worth', state: 'TX', homesSlug: 'fort-worth-tx', sourcePriority: ['har', 'homes'] },
    { label: 'San Antonio, TX', city: 'San Antonio', state: 'TX', homesSlug: 'san-antonio-tx', sourcePriority: ['har', 'homes'] },
    { label: 'Houston, TX', city: 'Houston', state: 'TX', homesSlug: 'houston-tx', sourcePriority: ['har', 'homes'] },
    { label: 'Katy, TX', city: 'Katy', state: 'TX', homesSlug: 'katy-tx', sourcePriority: ['har', 'homes'] },
    { label: 'Sugar Land, TX', city: 'Sugar Land', state: 'TX', homesSlug: 'sugar-land-tx', sourcePriority: ['har', 'homes'] },
    { label: 'Spring, TX', city: 'Spring', state: 'TX', homesSlug: 'spring-tx', sourcePriority: ['har', 'homes'] },
    { label: 'Pearland, TX', city: 'Pearland', state: 'TX', homesSlug: 'pearland-tx', sourcePriority: ['har', 'homes'] },
    { label: 'The Woodlands, TX', city: 'The Woodlands', state: 'TX', homesSlug: 'the-woodlands-tx', sourcePriority: ['har', 'homes'] },
    { label: 'Cypress, TX', city: 'Cypress', state: 'TX', homesSlug: 'cypress-tx', sourcePriority: ['har', 'homes'] },
    { label: 'Pasadena, TX', city: 'Pasadena', state: 'TX', homesSlug: 'pasadena-tx', sourcePriority: ['har', 'homes'] },
    { label: 'Humble, TX', city: 'Humble', state: 'TX', homesSlug: 'humble-tx', sourcePriority: ['har', 'homes'] },
    { label: 'Friendswood, TX', city: 'Friendswood', state: 'TX', homesSlug: 'friendswood-tx', sourcePriority: ['har', 'homes'] },
    // --- Added markets ---
    { label: 'Boise, ID', city: 'Boise', state: 'ID', homesSlug: 'boise-id', sourcePriority: ['homes'] },
    { label: 'Salt Lake City, UT', city: 'Salt Lake City', state: 'UT', homesSlug: 'salt-lake-city-ut', sourcePriority: ['homes'] },
    { label: 'Colorado Springs, CO', city: 'Colorado Springs', state: 'CO', homesSlug: 'colorado-springs-co', sourcePriority: ['homes'] },
    { label: 'Albuquerque, NM', city: 'Albuquerque', state: 'NM', homesSlug: 'albuquerque-nm', sourcePriority: ['homes'] },
    { label: 'Tucson, AZ', city: 'Tucson', state: 'AZ', homesSlug: 'tucson-az', sourcePriority: ['homes'] },
    { label: 'Kansas City, MO', city: 'Kansas City', state: 'MO', homesSlug: 'kansas-city-mo', sourcePriority: ['homes'] },
    { label: 'Indianapolis, IN', city: 'Indianapolis', state: 'IN', homesSlug: 'indianapolis-in', sourcePriority: ['homes'] },
    { label: 'Columbus, OH', city: 'Columbus', state: 'OH', homesSlug: 'columbus-oh', sourcePriority: ['homes'] },
    { label: 'Cincinnati, OH', city: 'Cincinnati', state: 'OH', homesSlug: 'cincinnati-oh', sourcePriority: ['homes'] },
    { label: 'Louisville, KY', city: 'Louisville', state: 'KY', homesSlug: 'louisville-ky', sourcePriority: ['homes'] },
    { label: 'Memphis, TN', city: 'Memphis', state: 'TN', homesSlug: 'memphis-tn', sourcePriority: ['homes'] },
    { label: 'Birmingham, AL', city: 'Birmingham', state: 'AL', homesSlug: 'birmingham-al', sourcePriority: ['homes'] },
    { label: 'New Orleans, LA', city: 'New Orleans', state: 'LA', homesSlug: 'new-orleans-la', sourcePriority: ['homes'] },
    { label: 'Oklahoma City, OK', city: 'Oklahoma City', state: 'OK', homesSlug: 'oklahoma-city-ok', sourcePriority: ['homes'] },
    { label: 'Richmond, VA', city: 'Richmond', state: 'VA', homesSlug: 'richmond-va', sourcePriority: ['homes'] },
    { label: 'Virginia Beach, VA', city: 'Virginia Beach', state: 'VA', homesSlug: 'virginia-beach-va', sourcePriority: ['homes'] },
    { label: 'Charleston, SC', city: 'Charleston', state: 'SC', homesSlug: 'charleston-sc', sourcePriority: ['homes'] },
    { label: 'Durham, NC', city: 'Durham', state: 'NC', homesSlug: 'durham-nc', sourcePriority: ['homes'] },
    { label: 'Greensboro, NC', city: 'Greensboro', state: 'NC', homesSlug: 'greensboro-nc', sourcePriority: ['homes'] },
    { label: 'St. Louis, MO', city: 'St. Louis', state: 'MO', homesSlug: 'st-louis-mo', sourcePriority: ['homes'] },
];

const TARGET_MARKET_LOOKUP = new Map<string, TargetMarket>(
    TARGET_MARKETS.flatMap((market) => [
        [market.label.toLowerCase(), market],
        [market.city.toLowerCase(), market],
    ])
);

function getDefaultTargetCities(): string[] {
    return TARGET_MARKETS.map((market) => market.label);
}

function resolveTargetMarket(input: string): TargetMarket {
    const trimmed = input.trim();
    const known = TARGET_MARKET_LOOKUP.get(trimmed.toLowerCase());
    if (known) return known;

    const [rawCity, rawState] = trimmed.split(',').map((part) => part.trim());
    const city = rawCity || trimmed;
    const state = (rawState || '').toUpperCase();
    const homesSlug = `${city.toLowerCase().replace(/\s+/g, '-')}${state ? `-${state.toLowerCase()}` : ''}`;

    return {
        label: state ? `${city}, ${state}` : city,
        city,
        state,
        homesSlug,
        sourcePriority: state === 'TX' ? ['har', 'homes'] : ['homes'],
    };
}

function hashString(value: string): number {
    let hash = 0;
    for (let i = 0; i < value.length; i++) {
        hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0;
    }
    return Math.abs(hash);
}

// Group-based rotation: cities are divided into non-overlapping groups of maxCities.
// sessionIndex advances one group per session, guaranteeing zero city overlap between
// consecutive sessions regardless of how many cron runs fire per day.
function selectRotatingCities(candidateCities: string[], maxCities: number, sessionIndex: number = 0): string[] {
    const unique = [...new Set(candidateCities.map((city) => resolveTargetMarket(city).label))].sort();
    if (unique.length <= maxCities) return unique;

    const numGroups = Math.ceil(unique.length / maxCities);
    const groupIndex = sessionIndex % numGroups;
    const start = groupIndex * maxCities;
    const group = unique.slice(start, start + maxCities);
    // Last group may be short — pad from the front of the NEXT group to keep count stable
    if (group.length < maxCities) {
        group.push(...unique.slice(0, maxCities - group.length));
    }
    return group;
}


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
    const market = resolveTargetMarket(city);
    const slug = market.homesSlug;
    // Extract expected 2-letter state from slug (e.g. "phoenix-az" → "AZ")
    const expectedState = slug.split('-').pop()?.toUpperCase() || '';
    const url = `https://www.homes.com/${slug}/`;

    try {
        const { html, error } = await zyteGet(url, market.city);
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
                city: addr.addressLocality || market.city,
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
    const market = resolveTargetMarket(city);
    if (market.state !== 'TX') return { listings: [], error: `HAR unavailable for ${market.label}` };

    // No dom filter — scrape ALL active listings so we don't exhaust the pool
    const baseUrl = `https://www.har.com/search/dosearch?type=residential&minprice=100000&maxprice=700000&status=A&city=${encodeURIComponent(market.city)}`;

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
        const pageResults = await Promise.all(pageUrls.map(url => zyteGet(url, market.city)));

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
                city: item.CITY || market.city,
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
    moondreamQueries: number;
    error?: string;
}> {
    const REJECT = { isEmpty: false, isStageable: false, isInterior: false, confidence: 0, roomType: 'unknown', isExterior: true, moondreamQueries: 0 };
    if (!GEMINI_API_KEY) return { ...REJECT, error: 'GEMINI_API_KEY not configured' };

    try {
        // Fetch the image as base64 — Gemini requires inline data for arbitrary CDN URLs.
        // Falls back to Zyte if the direct fetch is blocked (e.g. hotlink-protected).
        const fetched = await fetchRemoteImageBuffer(imageUrl);
        if (!fetched.buffer) {
            // Zyte fallback for hotlink-blocked images
            if (ZYTE_API_KEY) {
                const zyteRes = await fetch('https://api.zyte.com/v1/extract', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Basic ${Buffer.from(`${ZYTE_API_KEY}:`).toString('base64')}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ url: imageUrl, httpResponseBody: true, httpResponseHeaders: true, geolocation: 'US' }),
                });
                if (!zyteRes.ok) return { ...REJECT, error: `Image fetch failed and Zyte fallback failed` };
                const zyteData = await zyteRes.json();
                if (!zyteData.httpResponseBody) return { ...REJECT, error: `Zyte returned no image body` };
                const contentTypeHeader = (zyteData.httpResponseHeaders || []).find((h: { name?: string }) => h?.name?.toLowerCase() === 'content-type');
                const mimeType = contentTypeHeader?.value?.split(';')[0]?.trim() || 'image/jpeg';
                fetched.buffer = Buffer.from(zyteData.httpResponseBody, 'base64');
                fetched.contentType = mimeType;
            } else {
                return { ...REJECT, error: `Image fetch failed: ${fetched.error}` };
            }
        }

        const mimeType = fetched.contentType?.split(';')[0]?.trim() || 'image/jpeg';
        const base64Image = fetched.buffer.toString('base64');

        // Single Gemini call covering all 5 qualification questions at once.
        // Use an example-driven prompt — Gemini responds more reliably to examples than to <placeholder> templates.
        const prompt = `Look at this real estate listing photo and return a JSON object. Return ONLY the JSON, no other text.

Example output format:
{"isInterior": true, "isExterior": false, "isFloorPlan": false, "isHallway": false, "hasFurniture": false, "roomType": "living room"}

Rules:
- isInterior: true if photo is taken inside a building with walls/floor/ceiling visible
- isExterior: true if photo shows yard, pool, driveway, garden, or outside of building
- isFloorPlan: true if image is a 2D floor plan, blueprint, or diagram
- isHallway: true if photo shows a staircase, hallway, foyer, entryway, or corridor
- hasFurniture: true if any furniture, appliances, personal items, or belongings are visible
- roomType: must be exactly one of: "bedroom", "living room", "kitchen", "dining room", "other"

Now analyze the photo and return the JSON:`;

        const geminiBody = JSON.stringify({
            contents: [{ parts: [
                { inlineData: { mimeType, data: base64Image } },
                { text: prompt },
            ]}],
            generationConfig: { temperature: 0, maxOutputTokens: 1024, thinkingConfig: { thinkingBudget: 0 } },
        });

        // Retry up to 3 times on 503 (temporary overload) with exponential backoff.
        let geminiRes: Response | null = null;
        for (let attempt = 0; attempt < 3; attempt++) {
            if (attempt > 0) await new Promise(r => setTimeout(r, 1500 * attempt));
            geminiRes = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
                { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: geminiBody }
            );
            if (geminiRes.status !== 503) break;
        }

        if (!geminiRes!.ok) {
            const err = await geminiRes!.text();
            return { ...REJECT, error: `Gemini API error ${geminiRes!.status}: ${err}` };
        }

        const geminiData = await geminiRes!.json();
        const rawText: string = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text || '';

        // Extract JSON: pull the first {...} block to handle markdown fences and extra text
        const jsonMatch = rawText.match(/\{[\s\S]*\}/);
        const jsonText = jsonMatch ? jsonMatch[0] : rawText.trim();
        let parsed: {
            isInterior?: boolean;
            isExterior?: boolean;
            isFloorPlan?: boolean;
            isHallway?: boolean;
            hasFurniture?: boolean;
            roomType?: string;
        };
        try {
            parsed = JSON.parse(jsonText);
        } catch {
            return { ...REJECT, error: `Gemini returned unparseable JSON: ${rawText.slice(0, 200)}` };
        }

        // Apply the same qualification gates as before, now from a single call
        if (!parsed.isInterior) return { ...REJECT, isExterior: true };
        if (parsed.isExterior) return { ...REJECT, isExterior: true };
        if (parsed.isFloorPlan) return { ...REJECT };
        if (parsed.isHallway) return { ...REJECT };

        const isEmpty = !parsed.hasFurniture;
        const VALID_ROOM_TYPES = ['bedroom', 'living room', 'kitchen', 'dining room'];
        // Normalize underscore variants (e.g. "living_room" -> "living room") Gemini sometimes returns
        const normalizedRoomType = (parsed.roomType || '').toLowerCase().replace(/_/g, ' ').trim();
        const roomType = VALID_ROOM_TYPES.includes(normalizedRoomType) ? normalizedRoomType : 'room';
        const isKnownRoom = VALID_ROOM_TYPES.includes(roomType);

        return {
            isEmpty,
            isStageable: isKnownRoom,
            isInterior: true,
            confidence: 90,
            roomType,
            isExterior: false,
            moondreamQueries: 0, // kept for API compatibility
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

    // Check if address already exists — select status so we know how far along it is.
    const { data: existing } = await supabase
        .from('outreach_leads')
        .select('id, status')
        .eq('address', listing.address)
        .single();

    if (existing) {
        // Leads that are already in or past the staging pipeline must not have their
        // pipeline fields overwritten — especially empty_rooms, which stores the staged
        // image URL after Kie.ai completes. Overwriting it would re-trigger staging on
        // the next cron run and cause duplicate emails to the same agent.
        const isPipelined = ['staged', 'queued', 'sending', 'emailed', 'form_filled'].includes(existing.status);

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

        // Only update empty_rooms for pre-pipeline leads (scraped/scored).
        // Never overwrite on staged/emailed/form_filled — the stagedUrl would be lost.
        if (!isPipelined && listing.emptyRooms && listing.emptyRooms.length > 0) {
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

function normalizeAgentEmail(email?: string | null): string {
    return (email || '').trim().toLowerCase();
}

async function hasRecipientLock(normalizedEmail: string): Promise<{ locked: boolean; error?: string }> {
    if (!normalizedEmail) return { locked: false };
    const supabase = createClient(supabaseUrl, supabaseKey);
    const { data, error } = await supabase
        .from('outreach_email_locks')
        .select('normalized_email')
        .eq('normalized_email', normalizedEmail)
        .maybeSingle();

    if (error) return { locked: false, error: error.message };
    return { locked: !!data };
}

async function claimRecipientForEmail(input: {
    agentEmail: string;
    leadId?: string;
    address?: string;
    source?: string;
}): Promise<{ claimed: boolean; normalizedEmail: string; error?: string }> {
    const normalizedEmail = normalizeAgentEmail(input.agentEmail);
    if (!normalizedEmail) return { claimed: false, normalizedEmail, error: 'No agent email' };

    const supabase = createClient(supabaseUrl, supabaseKey);
    const { error } = await supabase
        .from('outreach_email_locks')
        .insert({
            normalized_email: normalizedEmail,
            agent_email: input.agentEmail.trim(),
            first_lead_id: input.leadId ?? null,
            first_address: input.address ?? null,
            source: input.source ?? 'outreach',
            status: 'claimed',
            claimed_at: new Date().toISOString(),
        });

    if (!error) return { claimed: true, normalizedEmail };
    if (error.code === '23505') return { claimed: false, normalizedEmail };
    return { claimed: false, normalizedEmail, error: error.message };
}

async function markRecipientLockSent(input: {
    normalizedEmail: string;
    gmailMessageId?: string | null;
    gmailThreadId?: string | null;
}): Promise<void> {
    if (!input.normalizedEmail) return;
    const supabase = createClient(supabaseUrl, supabaseKey);
    await supabase
        .from('outreach_email_locks')
        .update({
            status: 'sent',
            sent_at: new Date().toISOString(),
            gmail_message_id: input.gmailMessageId ?? null,
            gmail_thread_id: input.gmailThreadId ?? null,
            updated_at: new Date().toISOString(),
        })
        .eq('normalized_email', input.normalizedEmail)
        .then(null, () => {});
}

async function markRecipientLockFailed(normalizedEmail: string, reason: string): Promise<void> {
    if (!normalizedEmail) return;
    const supabase = createClient(supabaseUrl, supabaseKey);
    await supabase
        .from('outreach_email_locks')
        .update({ status: 'failed', failure_reason: reason.slice(0, 1000), updated_at: new Date().toISOString() })
        .eq('normalized_email', normalizedEmail)
        .then(null, () => {});
}

async function releaseFailedRecipientLock(normalizedEmail: string): Promise<void> {
    if (!normalizedEmail) return;
    const supabase = createClient(supabaseUrl, supabaseKey);
    await supabase
        .from('outreach_email_locks')
        .delete()
        .eq('normalized_email', normalizedEmail)
        .eq('status', 'failed')
        .then(null, () => {});
}

// Submit a batch to Kie.ai — leads with a confirmed room photo, including 10+ redesign candidates.
// Re-scans existing score>=10 leads that were scraped without a room photo (empty_rooms=[]).
// Fetches their HAR photos, runs Moondream on each, stages the first stageable room found.
// These leads were scraped before the furnished-redesign logic existed and have no staging_task_id.
export async function scanAndStageHighScoreBacklog(limit = 10): Promise<{ staged: number; skipped: number; failed: number; total: number; errors: string[] }> {
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data, error } = await supabase
        .from('outreach_leads')
        .select('id, address, listing_url, icp_score, agent_email')
        .in('status', ['scraped', 'scored'])
        .gte('icp_score', 15)
        .eq('empty_rooms', '[]')
        .not('listing_url', 'is', null)
        .order('icp_score', { ascending: false })
        .limit(limit);

    if (error) return { staged: 0, skipped: 0, failed: 0, total: 0, errors: [error.message] };

    const leads = data || [];
    let staged = 0, skipped = 0, failed = 0;
    const errors: string[] = [];

    for (const lead of leads) {
        const agentKey = normalizeAgentEmail(lead.agent_email);
        const lockCheck = await hasRecipientLock(agentKey);
        if (lockCheck.error) {
            failed++;
            errors.push(`${lead.address}: email lock check failed (${lockCheck.error})`);
            continue;
        }
        if (!agentKey || lockCheck.locked) {
            await updateLeadStatus(lead.id, 'form_filled');
            skipped++;
            continue;
        }

        const photos = await getListingPhotos(lead.listing_url, 8);
        if (photos.length < 2) { skipped++; continue; } // no interior photos

        let stagedThisLead = false;
        for (const photo of photos.slice(1, 7)) {
            const { isStageable, isEmpty, roomType, error: roomErr } = await detectRoom(photo);
            if (roomErr || !isStageable) continue;

            // Stage it — empty rooms get furniture added, furnished rooms get redesigned
            const { taskId, error: stageErr } = await stageEmptyRoom(photo, roomType, !isEmpty);
            if (!taskId) { errors.push(`${lead.address}: ${stageErr}`); failed++; break; }

            const permanentBeforeUrl = await uploadBeforeImage(photo, lead.id);
            await supabase.from('outreach_leads')
                .update({ empty_rooms: [{ roomType, imageUrl: permanentBeforeUrl, redesign: !isEmpty }] })
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

    // Build two sets of agent emails to distinguish permanent vs temporary blocks.
    // Permanent (emailed/form_filled): secondary listings for this agent will never be emailed; close them out.
    // Temporary (staged/sending): primary lead is still in flight; leave secondary as scored so it can take over if the primary fails.
    const { data: permanentAgents } = await supabase
        .from('outreach_leads')
        .select('agent_email')
        .in('status', ['emailed', 'form_filled'])
        .not('agent_email', 'is', null);
    const permanentlyBlockedEmails = new Set<string>((permanentAgents || []).map((r: any) => normalizeAgentEmail(r.agent_email)));

    const { data: activeAgents } = await supabase
        .from('outreach_leads')
        .select('agent_email')
        .in('status', ['staged', 'sending'])
        .not('agent_email', 'is', null);
    const blockedEmails = new Set<string>([
        ...permanentlyBlockedEmails,
        ...(activeAgents || []).map((r: any) => normalizeAgentEmail(r.agent_email)),
    ]);

    let query = supabase
        .from('outreach_leads')
        .select('id, address, agent_email, empty_rooms, listing_url, icp_score')
        .in('status', ['scraped', 'scored'])
        .not('empty_rooms', 'eq', '[]')
        .not('agent_email', 'is', null); // never waste Kie.ai credits on leads we can't email

    if (typeof limit === 'number') query = query.limit(limit);

    const { data: emptyData } = await query;

    const allPending = (emptyData || []).filter((l: any) => Array.isArray(l.empty_rooms) && l.empty_rooms.length > 0);

    let submitted = 0;
    let failed = 0;
    const errors: string[] = [];
    // Track agent emails queued in this batch so we only stage one property per realtor.
    const batchEmails = new Set<string>();

    for (const lead of allPending) {
        const agentKey = normalizeAgentEmail(lead.agent_email);

        // Skip if this realtor already has an in-flight or completed lead.
        // Permanently blocked (already emailed/form_filled): close this lead out so it exits the queue.
        // Temporarily blocked (staged/sending): leave as scored in case the primary lead fails.
        const lockCheck = await hasRecipientLock(agentKey);
        if (lockCheck.error) {
            failed++;
            errors.push(`${lead.address}: email lock check failed (${lockCheck.error})`);
            continue;
        }
        if (lockCheck.locked || (agentKey && permanentlyBlockedEmails.has(agentKey))) {
            await updateLeadStatus(lead.id, 'form_filled');
            continue;
        }
        if (agentKey && (blockedEmails.has(agentKey) || batchEmails.has(agentKey))) {
            continue;
        }

        const room = lead.empty_rooms[0];
        const imageUrl: string = room.imageUrl;
        const roomType: string = room.roomType || 'room';
        const isRedesign = room.redesign === true;

        const { taskId, error: stageErr } = await stageEmptyRoom(imageUrl, roomType, isRedesign);
        if (taskId) {
            await updateLeadStatus(lead.id, 'staged', { staging_task_id: taskId });
            if (agentKey) batchEmails.add(agentKey);
            submitted++;
        } else {
            failed++;
            errors.push(`${lead.address}: ${stageErr}`);
        }

        if (submitted + failed < allPending.length) {
            await new Promise(r => setTimeout(r, 5000));
        }
    }

    return { submitted, failed, errors };
}

// Upload a remote image URL to Supabase storage and return the permanent public URL.
// Uploads the raw listing photo to Supabase so email clients can display it (external CDNs hotlink-block).
async function uploadBeforeImage(imageUrl: string, leadId: string): Promise<string> {
    const supabase = createClient(supabaseUrl, supabaseKey);
    try {
        const fetched = await fetchRemoteImageBuffer(imageUrl);
        if (!fetched.buffer) return imageUrl;
        const ext = fetched.contentType?.includes('webp') ? 'webp' : 'jpg';
        const path = `outreach/before/${leadId}.${ext}`;
        const { error } = await supabase.storage.from('uploads').upload(path, fetched.buffer, {
            contentType: fetched.contentType || 'image/jpeg',
            upsert: true,
        });
        if (error) return imageUrl;
        const { data } = supabase.storage.from('uploads').getPublicUrl(path);
        return data.publicUrl || imageUrl;
    } catch {
        return imageUrl;
    }
}

// Kie.ai returns tempfile.aiquickdraw.com URLs that expire — this makes them permanent.
// Capped at 25s total so a slow Kie.ai CDN response never blocks the email pipeline.
async function uploadStagedImage(tempUrl: string, leadId: string): Promise<string> {
    const deadline = new Promise<string>(resolve => setTimeout(() => resolve(tempUrl), 25_000));
    return Promise.race([_doUploadStagedImage(tempUrl, leadId), deadline]);
}

async function _doUploadStagedImage(tempUrl: string, leadId: string): Promise<string> {
    const supabase = createClient(supabaseUrl, supabaseKey);
    try {
        const res = await fetch(tempUrl, { signal: AbortSignal.timeout(20_000) });
        if (!res.ok) return tempUrl;
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

async function fetchRemoteImageBuffer(url: string): Promise<{ buffer?: Buffer; contentType?: string; error?: string }> {
    try {
        const imageOrigin = new URL(url).origin;
        const directRes = await fetch(url, {
            headers: {
                'Referer': imageOrigin,
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
            },
        });
        if (directRes.ok) {
            return {
                buffer: Buffer.from(await directRes.arrayBuffer()),
                contentType: directRes.headers.get('content-type') || 'image/jpeg',
            };
        }

        if (url.includes('images.homes.com') && ZYTE_API_KEY) {
            const zyteRes = await fetch('https://api.zyte.com/v1/extract', {
                method: 'POST',
                headers: {
                    'Authorization': `Basic ${Buffer.from(`${ZYTE_API_KEY}:`).toString('base64')}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ url, httpResponseBody: true, httpResponseHeaders: true, geolocation: 'US' }),
            });
            if (!zyteRes.ok) return { error: `Image fetch failed: ${directRes.status}` };
            const zyteData = await zyteRes.json();
            const contentTypeHeader = (zyteData.httpResponseHeaders || []).find((header: { name?: string; value?: string }) =>
                header?.name?.toLowerCase() === 'content-type'
            );
            if (!zyteData.httpResponseBody) return { error: `Image fetch failed: ${directRes.status}` };
            return {
                buffer: Buffer.from(zyteData.httpResponseBody, 'base64'),
                contentType: contentTypeHeader?.value || 'image/jpeg',
            };
        }

        return { error: `Image fetch failed: ${directRes.status}` };
    } catch (err: any) {
        return { error: err.message };
    }
}

async function uploadSourceImageForStaging(imageUrl: string): Promise<string> {
    if (!imageUrl.includes('images.homes.com')) return imageUrl;
    // 25s cap — if Supabase upload is slow, fall back to original URL so staging isn't blocked.
    const deadline = new Promise<string>(resolve => setTimeout(() => resolve(imageUrl), 25_000));
    return Promise.race([_doUploadSourceImage(imageUrl), deadline]);
}

async function _doUploadSourceImage(imageUrl: string): Promise<string> {
    const supabase = createClient(supabaseUrl, supabaseKey);
    const fetched = await fetchRemoteImageBuffer(imageUrl);
    if (!fetched.buffer) return imageUrl;

    const ext = fetched.contentType?.includes('webp') ? 'webp' : 'jpg';
    const path = `outreach/source/${hashString(imageUrl)}.${ext}`;
    const { error } = await supabase.storage.from('uploads').upload(path, fetched.buffer, {
        contentType: fetched.contentType || 'image/jpeg',
        upsert: true,
    });
    if (error) return imageUrl;
    const { data } = supabase.storage.from('uploads').getPublicUrl(path);
    return data.publicUrl || imageUrl;
}

// Poll all staged leads, save the generated image URL, then send outreach email
export async function pollAndEmailStagedLeads(limit?: number): Promise<{ emailed: number; stillProcessing: number; failed: number; errors: string[]; debug: string[] }> {
    const supabase = createClient(supabaseUrl, supabaseKey);

    let query = supabase
        .from('outreach_leads')
        .select('id, address, listing_url, agent_name, agent_email, empty_rooms, staging_task_id, city, price, days_on_market, price_reduced, photo_count, keywords')
        .eq('status', 'staged')
        .not('staging_task_id', 'is', null)
        .order('icp_score', { ascending: false })
        .order('created_at', { ascending: true });

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
    // In-batch dedup — if the DB update hasn't flushed yet for an earlier lead in this same run.
    const batchEmailedAgents = new Set<string>();

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
            const agentKey = normalizeAgentEmail(lead.agent_email);

            // Never send cold outreach twice to the same realtor — check in-batch Set first, then DB.
            if (batchEmailedAgents.has(agentKey)) {
                await updateLeadStatus(lead.id, 'emailed', { email_sent_at: new Date().toISOString() });
                debug.push(`⏭ Skipped duplicate agent ${lead.agent_email} (${lead.address}) — already contacted this run`);
                continue;
            }
            // Check DB including 'sending' (in-flight by a concurrent run) to prevent race duplicates.
            const { data: alreadyContacted } = await supabase
                .from('outreach_leads')
                .select('id')
                .eq('agent_email', lead.agent_email)
                .in('status', ['sending', 'emailed', 'form_filled'])
                .limit(1)
                .single();
            if (alreadyContacted) {
                await updateLeadStatus(lead.id, 'emailed', { email_sent_at: new Date().toISOString() });
                debug.push(`⏭ Skipped duplicate agent ${lead.agent_email} (${lead.address}) — already contacted`);
                continue;
            }

            // Atomically claim this lead (compare-and-swap: staged → sending).
            // If two concurrent runs both fetched this lead, only one will win this update.
            const { data: claimed } = await supabase
                .from('outreach_leads')
                .update({ status: 'sending' })
                .eq('id', lead.id)
                .eq('status', 'staged')
                .select('id')
                .single();
            if (!claimed) {
                debug.push(`⏭ Lead ${lead.address} already claimed by another run — skipping`);
                continue;
            }

            const emailResult = await sendOutreachEmail({
                leadId: lead.id,
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
                listingUrl: lead.listing_url,
                source: 'pipeline',
            });
            if (emailResult.success) {
                await updateLeadStatus(lead.id, 'emailed', { email_sent_at: new Date().toISOString() });
                batchEmailedAgents.add(agentKey);
                emailed++;
                debug.push(`✉ Email sent → ${lead.agent_email} (${lead.address})`);
                // 8s gap avoids Gmail burst detection while keeping throughput usable.
                if (emailed < leads.length) await new Promise(r => setTimeout(r, 8_000));
            } else if (emailResult.duplicate) {
                await updateLeadStatus(lead.id, 'form_filled');
                debug.push(`Duplicate blocked by recipient lock: ${lead.agent_email} (${lead.address})`);
            } else {
                // Revert claim so the lead can be retried next run.
                await updateLeadStatus(lead.id, 'staged');
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

async function getNextQueueSendAfter(supabase: any): Promise<string> {
    const now = Date.now();
    let nextMs = now;

    const { data: pending } = await supabase
        .from('outreach_email_queue')
        .select('send_after')
        .in('status', ['queued', 'sending'])
        .order('send_after', { ascending: false })
        .limit(1)
        .maybeSingle();

    const pendingRow = pending as { send_after?: string } | null;
    const pendingMs = pendingRow?.send_after ? new Date(pendingRow.send_after).getTime() : 0;
    if (pendingMs > now) nextMs = pendingMs + 60_000;

    const { data: lastSent } = await supabase
        .from('outreach_email_queue')
        .select('sent_at')
        .eq('status', 'sent')
        .not('sent_at', 'is', null)
        .order('sent_at', { ascending: false })
        .limit(1)
        .maybeSingle();

    const lastSentRow = lastSent as { sent_at?: string } | null;
    const lastSentMs = lastSentRow?.sent_at ? new Date(lastSentRow.sent_at).getTime() + 60_000 : 0;
    nextMs = Math.max(nextMs, lastSentMs);

    return new Date(nextMs).toISOString();
}

async function enqueueReadyOutreachEmail(lead: {
    id: string;
    address: string;
    agent_email?: string | null;
}): Promise<{ queued: boolean; skipped?: boolean; duplicate?: boolean; sendAfter?: string; error?: string }> {
    const supabase = createClient(supabaseUrl, supabaseKey);
    const normalizedEmail = normalizeAgentEmail(lead.agent_email);
    if (!normalizedEmail || !lead.agent_email) {
        await updateLeadStatus(lead.id, 'form_filled');
        return { queued: false, skipped: true, error: 'No agent email' };
    }

    const lockCheck = await hasRecipientLock(normalizedEmail);
    if (lockCheck.error) return { queued: false, error: lockCheck.error };
    if (lockCheck.locked) {
        await updateLeadStatus(lead.id, 'form_filled');
        return { queued: false, skipped: true, duplicate: true, error: `Recipient already contacted: ${normalizedEmail}` };
    }

    const { data: existingQueue } = await supabase
        .from('outreach_email_queue')
        .select('id, lead_id, status, send_after')
        .eq('normalized_email', normalizedEmail)
        .in('status', ['queued', 'sending', 'sent'])
        .limit(1)
        .maybeSingle();

    if (existingQueue) {
        if (existingQueue.lead_id === lead.id && existingQueue.status !== 'sent') {
            await updateLeadStatus(lead.id, 'queued');
            return { queued: true, sendAfter: existingQueue.send_after };
        }
        await updateLeadStatus(lead.id, 'form_filled');
        return { queued: false, skipped: true, duplicate: true, error: `Recipient already queued: ${normalizedEmail}` };
    }

    const sendAfter = await getNextQueueSendAfter(supabase);
    const { error } = await supabase.from('outreach_email_queue').insert({
        lead_id: lead.id,
        normalized_email: normalizedEmail,
        agent_email: lead.agent_email.trim(),
        status: 'queued',
        source: 'pipeline',
        ready_at: new Date().toISOString(),
        send_after: sendAfter,
    });

    if (error) {
        if (error.code === '23505') {
            await updateLeadStatus(lead.id, 'queued');
            return { queued: true, sendAfter };
        }
        return { queued: false, error: error.message };
    }

    await updateLeadStatus(lead.id, 'queued');
    return { queued: true, sendAfter };
}

// Poll staged leads, save the generated image URL, then queue fully ready emails.
// The actual Gmail sender runs separately and sends one queued email per invocation.
export async function pollAndQueueStagedLeads(limit?: number): Promise<{ queued: number; stillProcessing: number; failed: number; errors: string[]; debug: string[] }> {
    const supabase = createClient(supabaseUrl, supabaseKey);

    let query = supabase
        .from('outreach_leads')
        .select('id, address, listing_url, agent_name, agent_email, empty_rooms, staging_task_id, city, price, days_on_market, price_reduced, photo_count, keywords')
        .eq('status', 'staged')
        .not('staging_task_id', 'is', null)
        .order('icp_score', { ascending: false })
        .order('created_at', { ascending: true });

    if (typeof limit === 'number') query = query.limit(limit);

    const { data, error } = await query;

    if (error) return { queued: 0, stillProcessing: 0, failed: 0, errors: [error.message], debug: [] };

    let queued = 0;
    let stillProcessing = 0;
    let failed = 0;
    const errors: string[] = [];
    const debug: string[] = [];

    const leads = data || [];
    debug.push(`Poll & queue: checking ${leads.length} staged lead(s)`);

    for (const lead of leads) {
        const result = await checkStagingResult(lead.staging_task_id);

        if (result.status === 'processing') {
            stillProcessing++;
            debug.push(`Still generating: ${lead.address}`);
            continue;
        }

        if (result.status === 'error') {
            debug.push(`Kie.ai error (will retry): ${lead.address} - ${result.error}`);
            continue;
        }

        if (result.status === 'failed') {
            await updateLeadStatus(lead.id, 'scored', { staging_task_id: null });
            failed++;
            errors.push(`Generation failed ${lead.address}: ${result.error}`);
            debug.push(`Generation failed ${lead.address}: ${result.error}`);
            continue;
        }

        const permanentUrl = result.url ? await uploadStagedImage(result.url, lead.id) : undefined;

        if (permanentUrl) {
            const updatedRooms = [...(lead.empty_rooms || [])];
            if (updatedRooms[0]) updatedRooms[0].stagedUrl = permanentUrl;
            await supabase.from('outreach_leads').update({ empty_rooms: updatedRooms }).eq('id', lead.id);
        } else {
            debug.push(`No staged URL returned for ${lead.address} - queueing email without image`);
        }

        const queueResult = await enqueueReadyOutreachEmail(lead);
        if (queueResult.queued) {
            queued++;
            debug.push(`Queued email -> ${lead.agent_email} (${lead.address}) send_after=${queueResult.sendAfter}`);
        } else if (queueResult.duplicate) {
            debug.push(`Duplicate skipped before queue: ${lead.agent_email} (${lead.address})`);
        } else if (queueResult.skipped) {
            debug.push(`Skipped queue: ${lead.address} - ${queueResult.error}`);
        } else {
            failed++;
            errors.push(`Queue failed ${lead.address}: ${queueResult.error}`);
            debug.push(`Queue failed ${lead.address}: ${queueResult.error}`);
        }
    }

    debug.push(`Poll complete: ${queued} queued, ${stillProcessing} still generating, ${failed} failed`);
    return { queued, stillProcessing, failed, errors, debug };
}

// Finds all staged leads that were never emailed and sends slowly with a delay between each.
// Handles both: Kie.ai task still pending (polls first) and task already completed.
export async function drainEmailBacklog(delayMs = 8000): Promise<{ emailed: number; skipped: number; stillProcessing: number; failed: number; total: number; errors: string[] }> {
    void delayMs;
    const result = await pollAndQueueStagedLeads(100);
    return {
        emailed: result.queued,
        skipped: 0,
        stillProcessing: result.stillProcessing,
        failed: result.failed,
        total: result.queued + result.stillProcessing + result.failed,
        errors: result.errors,
    };

    /*
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data, error } = await supabase
        .from('outreach_leads')
        .select('id, address, listing_url, agent_name, agent_email, empty_rooms, staging_task_id, city, price, days_on_market, price_reduced, photo_count, keywords')
        .eq('status', 'staged')
        .not('staging_task_id', 'is', null)
        .order('created_at', { ascending: true });

    if (error) return { emailed: 0, skipped: 0, stillProcessing: 0, failed: 0, total: 0, errors: [error.message] };

    const leads = data || [];
    let emailed = 0, skipped = 0, stillProcessing = 0, failed = 0;
    const errors: string[] = [];
    const batchEmailedAgents = new Set<string>();

    for (const lead of leads) {
        if (!lead.agent_email) {
            // Consistent with pollAndEmailStagedLeads: close out no-email leads so they
            // don't permanently occupy the staged queue and waste poll slots on every drain.
            await updateLeadStatus(lead.id, 'form_filled');
            skipped++;
            continue;
        }

        const agentKey = normalizeAgentEmail(lead.agent_email);

        // Never send cold outreach twice to the same realtor — in-batch Set first, then DB.
        if (batchEmailedAgents.has(agentKey)) {
            await updateLeadStatus(lead.id, 'emailed', { email_sent_at: new Date().toISOString() });
            skipped++;
            continue;
        }
        const { data: alreadyContacted } = await supabase
            .from('outreach_leads')
            .select('id')
            .eq('agent_email', lead.agent_email)
            .in('status', ['sending', 'emailed', 'form_filled'])
            .limit(1)
            .single();
        if (alreadyContacted) {
            await updateLeadStatus(lead.id, 'emailed', { email_sent_at: new Date().toISOString() });
            skipped++;
            continue;
        }

        // Atomically claim: staged → sending.
        const { data: claimed } = await supabase
            .from('outreach_leads')
            .update({ status: 'sending' })
            .eq('id', lead.id)
            .eq('status', 'staged')
            .select('id')
            .single();
        if (!claimed) { skipped++; continue; }

        const result = await checkStagingResult(lead.staging_task_id);

        if (result.status === 'processing') {
            // Revert claim so the lead stays retryable.
            await updateLeadStatus(lead.id, 'staged');
            stillProcessing++;
            continue;
        }
        if (result.status === 'error') {
            await updateLeadStatus(lead.id, 'staged');
            continue;
        }

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
            leadId: lead.id,
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
            listingUrl: lead.listing_url,
            source: 'backlog',
        });

        if (emailResult.success) {
            await updateLeadStatus(lead.id, 'emailed', { email_sent_at: new Date().toISOString() });
            batchEmailedAgents.add(agentKey);
            emailed++;
        } else if (emailResult.duplicate) {
            await updateLeadStatus(lead.id, 'form_filled');
            skipped++;
        } else {
            // Revert claim so the lead can be retried.
            await updateLeadStatus(lead.id, 'staged');
            failed++;
            errors.push(`Email failed ${lead.address}: ${emailResult.error}`);
        }

        // Delay between sends to avoid triggering spam filters
        if (emailed + failed < leads.length) await new Promise(r => setTimeout(r, delayMs));
    }

    return { emailed, skipped, stillProcessing, failed, total: leads.length, errors };
    */
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
        queued: leads.filter(l => l.status === 'queued').length,
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
        const sourceImageUrl = await uploadSourceImageForStaging(imageUrl);
        const prompt = redesign
            ? `Restyle this ${roomType} for a real estate listing with tasteful modern furniture and decor. Preserve the room layout, walls, windows, floors, ceiling, and camera angle. Photorealistic MLS listing photo.`
            : `Virtually stage this empty ${roomType} for a real estate listing with tasteful modern furniture and decor. Preserve the room layout, walls, windows, floors, ceiling, and camera angle. Photorealistic MLS listing photo.`;

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
                    image_urls: [sourceImageUrl],
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
    leadId?: string;
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
    listingUrl?: string;
    source?: string;
}): Promise<{ success?: boolean; skipped?: boolean; duplicate?: boolean; normalizedEmail?: string; error?: string }> {
    if (!GMAIL_CLIENT_ID || !GMAIL_CLIENT_SECRET || !GMAIL_REFRESH_TOKEN) {
        return { error: 'Gmail OAuth credentials not configured' };
    }
    const normalizedEmail = normalizeAgentEmail(lead.agentEmail);
    if (!normalizedEmail) return { error: 'No agent email' };

    try {
        const accessToken = await getGmailAccessToken();
        const claim = await claimRecipientForEmail({
            agentEmail: lead.agentEmail,
            leadId: lead.leadId,
            address: lead.address,
            source: lead.source ?? 'outreach',
        });
        if (claim.error) return { error: `Email duplicate lock failed: ${claim.error}`, normalizedEmail };
        if (!claim.claimed) {
            return {
                skipped: true,
                duplicate: true,
                normalizedEmail,
                error: `Duplicate recipient blocked: ${normalizedEmail}`,
            };
        }

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
        const cityLabel = lead.city ?? '';
        const neighborhood = lead.keywords?.find(k => k && k.length > 2 && !/^\d/.test(k)) ?? '';
        const addr = `<strong>${lead.address}</strong>`;
        const cityStr = cityLabel ? `${cityLabel} ` : '';
        const nbhStr = neighborhood ? ` in ${neighborhood}` : '';
        const nbhAreaStr = neighborhood ? ` in the ${neighborhood} area` : '';
        const pick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

        // Derive a human-readable source label from listing_url
        const sourceLabel = (() => {
            const url = lead.listingUrl ?? '';
            if (url.includes('har.com')) return 'HAR.com';
            if (url.includes('homes.com')) return 'homes.com';
            return null;
        })();
        // Randomized source phrases — only injected when sourceLabel is known
        const sourcePhrases = sourceLabel ? pick([
            `I found your listing on ${sourceLabel}`,
            `I came across your listing on ${sourceLabel}`,
            `I saw your listing on ${sourceLabel}`,
            `I spotted your listing on ${sourceLabel}`,
            `I noticed your listing on ${sourceLabel}`,
            `I was browsing ${sourceLabel} and found your listing`,
            `I came across your property on ${sourceLabel}`,
            `I found your property on ${sourceLabel}`,
        ]) : null;

        // ── Opening lines (25+ per bucket, source-aware variants mixed in) ──
        const openingLine = pick(lead.priceReduced ? [
            // source-aware variants (only non-null when sourceLabel is known)
            ...(sourcePhrases ? [
                `${sourcePhrases} at ${addr} — noticed the price adjustment, so I staged the ${room} to give it a fresh angle that might re-spark buyer interest.`,
                `${sourcePhrases} — saw the recent price change on ${addr} and staged the ${room} for you. Fresh photos after a reduction tend to pull buyers back in.`,
                `${sourcePhrases} and noticed ${addr} had a price update, so I took the liberty of staging the ${room}.`,
                `${sourcePhrases} — ${addr} had a recent price adjustment so I staged the ${room} to give buyers something new to look at.`,
                `${sourcePhrases} at ${addr}. Noticed the price change and staged the ${room} — a new photo right after a reduction can make a real difference.`,
                `${sourcePhrases} — caught the price update on ${addr} and staged the ${room} so the listing has a fresh visual to go with the new price.`,
                `${sourcePhrases} and saw ${addr} went through a price adjustment. Staged the ${room} in case a new photo helps bring buyers back.`,
                `${sourcePhrases} — noticed the price drop on ${addr} and staged the ${room} for you. Buyers who passed on it before often come back when they see something new.`,
            ] : []),
            `I noticed your listing at ${addr} went through a price adjustment recently, so I staged the ${room} to give the photos a fresh angle that might re-spark buyer interest.`,
            `Saw that ${addr} had a price update — I took the liberty of staging the ${room} to see if a new look helps it get more attention.`,
            `I came across ${addr} after the price change and staged the ${room} for you — sometimes a fresh photo set is all it takes to get buyers clicking again.`,
            `I saw the recent price adjustment on ${addr} and wanted to help — staged the ${room} so the listing has something new to show buyers.`,
            `Noticed ${addr} went through a price reduction, so I staged the ${room}. A fresh photo after a price drop can re-engage buyers who passed on it before.`,
            `I spotted the price change on ${addr} and thought this might be useful — staged the ${room} to give the listing a new visual angle.`,
            `Saw that ${addr} had a recent price update and put together a staged version of the ${room} — might help get some renewed interest from buyers.`,
            `I came across your ${cityStr}listing at ${addr} after the price adjustment and staged the ${room}. Fresh photos after a price drop tend to pull buyers back in.`,
            `Noticed the price change on ${addr} — I staged the ${room} so you have something new to lead with in the photos.`,
            `I saw ${addr} had a price adjustment and took the liberty of staging the ${room} for you. A new look can make a real difference after a reduction.`,
            `Caught the price update on ${addr} and wanted to do something useful with it — staged the ${room} so the photos feel fresh again.`,
            `I noticed ${addr} had a recent price change. I staged the ${room} — buyers who scrolled past it might stop when they see a furnished version.`,
            `Saw the reduction on ${addr} and thought a staged ${room} photo could help give it a second life in buyers' searches.`,
            `I came across the price change on ${addr} and staged the ${room} — worth showing buyers a new side of the property at the new price point.`,
            `Noticed the recent price update on ${addr} so I staged the ${room} for you. Sometimes a visual refresh is what moves a listing forward.`,
            `I spotted ${addr} after the price adjustment and staged the ${room}. A new photo angle right after a reduction can re-activate buyer interest.`,
            `Saw the price drop on ${addr} and put together a staged ${room} photo — might help it stand out to buyers browsing at that price range now.`,
            `I came across ${addr} after the recent price change and took the liberty of virtually staging the ${room}. Happy to share it in case it's useful.`,
            `Noticed the price adjustment on ${addr} — staged the ${room} so the listing has something new to offer buyers who are browsing fresh.`,
            `I saw the price update on ${addr} and created a staged version of the ${room}. A fresh photo set can do a lot right after a reduction.`,
            `Caught the price change on ${addr} and wanted to put something together for you — staged the ${room} in case it helps attract a new round of buyers.`,
            `I noticed ${addr} had a recent price reduction. I staged the ${room} — a furnished photo can completely change how buyers perceive the value.`,
            `Saw the listing at ${addr} go through a price adjustment and staged the ${room} for you. Buyers often re-engage when they see something new.`,
            `I came across the price update on ${addr} and staged the ${room} to help it show better at the new price point.`,
            `Noticed the recent price change on ${addr} and staged the ${room}. Sometimes a new photo is all it takes to move a listing that has plateaued.`,
        ] : dom >= 45 ? [
            // source-aware variants
            ...(sourcePhrases ? [
                `${sourcePhrases} at ${addr} and noticed it has been on the market for a little while — staged the ${room} to see if a furnished version helps it get more traction.`,
                `${sourcePhrases} — ${addr} has been active for a bit, so I staged the ${room} to give it a fresh angle.`,
                `${sourcePhrases} and came across ${addr}${nbhAreaStr}. It has been listed for a while so I staged the ${room} — a new photo can bring in a fresh wave of buyers.`,
                `${sourcePhrases} at ${addr}. Noticed the listing has been active for some time, so I staged the ${room} for you.`,
                `${sourcePhrases} — saw ${addr} has been on the market and staged the ${room}. Sometimes one new photo is all it takes to start getting calls again.`,
                `${sourcePhrases} and noticed ${addr}${nbhAreaStr} has been sitting for a while. Staged the ${room} in case a visual refresh helps move it forward.`,
                `${sourcePhrases} — ${addr} has been active for a bit. Staged the ${room} so you have something new to share with buyers.`,
                `${sourcePhrases} at ${addr} and staged the ${room} — listings that get a visual refresh after some market time often see renewed interest.`,
            ] : []),
            `I came across your ${cityStr}listing at ${addr} and noticed it has been on the market for a while, so I staged the ${room} to see if a furnished version helps it stand out.`,
            `I was browsing ${cityStr}listings and found ${addr} — it has been active for a bit, so I staged the ${room} to give it a fresh angle.`,
            `I came across ${addr}${nbhAreaStr} and noticed the days on market. I staged the ${room} — a furnished photo can bring in a new wave of buyers.`,
            `Saw your listing at ${addr} and thought a staged ${room} photo might help it get more traction. Sometimes a new visual is all a listing needs.`,
            `I noticed ${addr} has been sitting for a while and wanted to help — staged the ${room} so you have something new to share with buyers.`,
            `I came across ${addr}${nbhAreaStr} and took the liberty of staging the ${room}. Listings that get a visual refresh often see renewed interest.`,
            `I found ${addr} while browsing${nbhAreaStr} and staged the ${room} for you — thought a furnished version might help it get more saves and showings.`,
            `I noticed ${addr} has been on the market and staged the ${room}. A furnished photo at this stage can re-engage buyers who saw it before.`,
            `I came across your ${cityStr}listing at ${addr} — it has been active for a while so I staged the ${room} to give buyers something new to look at.`,
            `I found ${addr} and noticed the listing age. I staged the ${room} — a new photo can be exactly what brings a dormant listing back to life.`,
            `I was looking at ${cityStr}listings and came across ${addr}. Staged the ${room} in case a fresh photo helps it get more attention.`,
            `I came across ${addr}${nbhAreaStr} and staged the ${room} for you. At this point in the listing cycle, a visual refresh can make a real impact.`,
            `I noticed your listing at ${addr} has been active for some time — staged the ${room} so you have a new angle to show buyers.`,
            `I found ${addr} while browsing and took the liberty of staging the ${room}. A furnished photo can bring buyers back who already dismissed it once.`,
            `I came across ${addr} and noticed it has been on the market. Staged the ${room} — sometimes one new image is all it takes to start getting calls again.`,
            `I was browsing active listings${nbhAreaStr} and came across ${addr}. Staged the ${room} for you — a new look can change how buyers perceive the whole property.`,
            `I noticed ${addr} has been listed for a while and wanted to do something useful. Staged the ${room} in case a fresh photo set helps move it forward.`,
            `I came across your listing at ${addr} — has been active for a bit. Staged the ${room} to give buyers a better sense of what the space could look like.`,
            `I found ${addr}${nbhAreaStr} and staged the ${room} for you. Listings that have been sitting often just need one strong photo to turn things around.`,
            `I noticed ${addr} has been on the market and staged the ${room}. Buyers scrolling past an empty room will often stop at a furnished version.`,
            `I came across ${addr} while looking at ${cityStr}listings. It has been active for a while so I staged the ${room} — thought it might help.`,
            `I saw ${addr} and noticed it has been listed for some time. Took the liberty of staging the ${room} so there is something new to share with buyers.`,
            `I found your listing at ${addr} and staged the ${room} — a fresh photo can re-activate buyer interest even after a listing has been sitting.`,
            `I came across ${addr}${nbhAreaStr} and noticed the listing has been active for a while. Staged the ${room} to give buyers a new reason to look.`,
            `I noticed your ${cityStr}listing at ${addr} has some market time on it. Staged the ${room} in case a new visual helps it get more traction.`,
        ] : dom <= 7 ? [
            // source-aware variants
            ...(sourcePhrases ? [
                `${sourcePhrases} — saw ${addr}${nbhStr} just went live and staged the ${room} to show buyers what it could look like furnished.`,
                `${sourcePhrases} and noticed ${addr} just hit the market. Staged the ${room} — great timing to get a strong photo in front of buyers right away.`,
                `${sourcePhrases} — ${addr}${nbhStr} just came on the market so I staged the ${room} to help it make a strong first impression.`,
                `${sourcePhrases} at ${addr} right after it went live. Staged the ${room} — the first week is when photos matter most.`,
                `${sourcePhrases} — saw your new ${cityStr}listing at ${addr} and staged the ${room}. Now is the best window to get buyers excited about the space.`,
                `${sourcePhrases} and caught ${addr}${nbhStr} just as it went live. Staged the ${room} so buyers browsing fresh listings see it at its best.`,
                `${sourcePhrases} — ${addr} just listed${nbhStr}. Staged the ${room} so you have a polished photo to lead with from day one.`,
                `${sourcePhrases} at ${addr} right after launch. Staged the ${room} — buyers making fast decisions on new listings respond well to furnished photos.`,
            ] : []),
            `Saw your new listing at ${addr}${nbhStr} — staged the ${room} to show buyers what it could look like furnished.`,
            `I came across your new listing at ${addr} and staged the ${room}. Now is a great time to make the photos pop while buyers are seeing it fresh.`,
            `Noticed ${addr} just went live${nbhStr} — I staged the ${room} to help it make a strong first impression.`,
            `I saw ${addr} just hit the market and took the liberty of staging the ${room} for you.`,
            `I came across your new listing at ${addr}${nbhStr} and staged the ${room} — great timing to get staged photos in front of buyers right away.`,
            `Saw the new listing at ${addr} and staged the ${room}. Listings that launch with furnished photos tend to get more attention in the first week.`,
            `I noticed ${addr} just came on the market${nbhStr} — staged the ${room} so you have a polished photo to lead with.`,
            `I came across ${addr} right after it went live and staged the ${room}. The first few days on market are when photos matter most.`,
            `Saw ${addr} just listed${nbhStr} — staged the ${room} so buyers browsing fresh listings see the space at its best.`,
            `I noticed your new ${cityStr}listing at ${addr} and staged the ${room}. A furnished photo in the first week can set the tone for the whole campaign.`,
            `I came across ${addr}${nbhStr} just as it went live — staged the ${room} to help it stand out while it's getting fresh buyer traffic.`,
            `Saw the new listing at ${addr} and staged the ${room} for you. Now is the best window to get buyers excited about the space.`,
            `I noticed ${addr} just came on the market and staged the ${room} — thought a furnished photo could help it make a great first impression.`,
            `I came across your listing at ${addr} right after launch${nbhStr} and staged the ${room}. Happy to share it in case it helps.`,
            `Saw ${addr} go live${nbhStr} — staged the ${room} to show buyers the potential of the space while the listing is still brand new.`,
            `I noticed ${addr} just hit the market and took the liberty of staging the ${room}. The first week is prime time for buyer interest.`,
            `I came across your new listing at ${addr}${nbhStr} and staged the ${room} so you have a polished photo to work with right from the start.`,
            `Saw ${addr} just listed and staged the ${room} for you — buyers browsing new listings will get a much better sense of the space with a furnished version.`,
            `I noticed ${addr} just came on the market${nbhStr}. Staged the ${room} — a great first photo impression can drive more showings in the opening days.`,
            `I came across ${addr} right after it launched and staged the ${room}. Now is the ideal time to put a strong visual in front of buyers.`,
            `Saw your new ${cityStr}listing at ${addr} and staged the ${room}. Buyers making quick decisions early in a listing's life respond well to furnished photos.`,
            `I noticed ${addr}${nbhStr} just went live — staged the ${room} for you so the listing has a strong visual from day one.`,
            `I came across your listing at ${addr} right after launch. Staged the ${room} — this is exactly the right moment to have great photos working for you.`,
            `Saw ${addr} just hit the market and staged the ${room}. A furnished photo can be the difference between a scroll-past and a showing request.`,
            `I noticed ${addr} just came on the market${nbhStr} and staged the ${room}. Great timing to put a polished version in front of buyers early.`,
        ] : [
            // source-aware variants
            ...(sourcePhrases ? [
                `${sourcePhrases} at ${addr} and took the liberty of staging the ${room} — thought it might be worth a look.`,
                `${sourcePhrases} — found ${addr}${nbhAreaStr} and staged the ${room} for you.`,
                `${sourcePhrases} and came across ${addr}${nbhAreaStr}. Staged the ${room} and thought you might want to see it.`,
                `${sourcePhrases} at ${addr}${nbhAreaStr} and staged the ${room}. Wanted to share it in case it helps.`,
                `${sourcePhrases} — noticed ${addr}${nbhAreaStr} and took the liberty of staging the ${room} for you.`,
                `${sourcePhrases} and found ${addr}${nbhAreaStr}. Staged the ${room} — thought a furnished version might help buyers connect with the space.`,
                `${sourcePhrases} at ${addr} and staged the ${room}. Wanted to pass it along in case it gives the listing a boost.`,
                `${sourcePhrases} — came across ${addr}${nbhAreaStr} and staged the ${room}. Sometimes one good photo changes how buyers feel about a property.`,
            ] : []),
            `I came across your listing at ${addr}${nbhAreaStr} and took the liberty of staging the ${room} — thought it might be worth a look.`,
            `I found ${addr}${nbhAreaStr} and staged the ${room} for you. Wanted to share it in case it's helpful.`,
            `I was browsing ${cityStr}listings and came across ${addr} — staged the ${room} and thought you might want to see it.`,
            `I noticed your listing at ${addr}${nbhAreaStr} and staged the ${room}. A furnished photo can make a real difference in how buyers perceive the space.`,
            `I came across ${addr} and staged the ${room} for you — thought a furnished version might help buyers connect with the space.`,
            `I found your ${cityStr}listing at ${addr} and took the liberty of staging the ${room}. Wanted to share it in case it's useful.`,
            `I came across ${addr}${nbhAreaStr} and staged the ${room}. Buyers often need help visualizing a space — this gives them that.`,
            `I noticed ${addr} and staged the ${room} for you — a furnished photo can get buyers to spend more time looking at a listing.`,
            `I was browsing listings${nbhAreaStr} and came across ${addr}. Staged the ${room} and wanted to pass it along.`,
            `I found ${addr} and staged the ${room} — thought it could help buyers see the full potential of the space.`,
            `I came across your listing at ${addr}${nbhAreaStr} and took the liberty of staging the ${room} for you.`,
            `I noticed ${addr}${nbhAreaStr} and staged the ${room}. Wanted to share in case a furnished photo helps the listing get more traction.`,
            `I came across ${addr} and staged the ${room} — buyers who see an empty room often have a harder time picturing themselves in it.`,
            `I found ${addr}${nbhAreaStr} and staged the ${room} for you. Staged listings tend to generate more saves and showing requests.`,
            `I was looking at ${cityStr}listings and came across ${addr} — staged the ${room} and thought it was worth sharing.`,
            `I noticed your ${cityStr}listing at ${addr} and staged the ${room}. A furnished photo can make a strong impression on buyers comparing multiple listings.`,
            `I came across ${addr}${nbhAreaStr} and created a staged version of the ${room} for you — thought it might be useful.`,
            `I found ${addr} and staged the ${room}. Buyers browsing listings stop longer on photos that show a furnished space.`,
            `I came across your listing at ${addr} and staged the ${room}${nbhAreaStr} — wanted to share it in case it helps.`,
            `I noticed ${addr} and took the liberty of staging the ${room} for you. Happy to pass it along in case it's useful.`,
            `I came across ${addr}${nbhAreaStr} while browsing listings and staged the ${room} — thought a furnished version could help it stand out.`,
            `I found your listing at ${addr} and staged the ${room}. Sometimes one good photo changes how buyers feel about an entire property.`,
            `I noticed ${addr}${nbhAreaStr} and staged the ${room} for you — buyers often make snap decisions based on the first few photos.`,
            `I came across ${addr} and took the liberty of staging the ${room}. Wanted to share it in case it gives the listing a boost.`,
            `I found ${addr}${nbhAreaStr} and staged the ${room} — a furnished version of the space can help buyers picture living there.`,
        ]);

        // ── Value lines (15+ per bucket) ────────────────────────────────────
        const valueLine = pick(lead.priceReduced ? [
            `A fresh set of staged photos right after a price adjustment can re-engage buyers who scrolled past it the first time. I put this together using <a href="https://kogflow.com" style="color:#7c3aed;">Kogflow</a> — takes a few clicks and it's free to try if you want to do more rooms yourself.`,
            `Buyers who dismissed the listing at the old price often come back when they see new photos. I used <a href="https://kogflow.com" style="color:#7c3aed;">Kogflow</a> to create this in about 30 seconds — it's free to try and very easy to use.`,
            `A new photo after a price drop can completely change how a listing performs. I did this on <a href="https://kogflow.com" style="color:#7c3aed;">Kogflow.com</a> — a few clicks per room, free to try, and works on any listing photo.`,
            `Staged photos after a price reduction tend to bring in a fresh wave of interest. This took about a minute on <a href="https://kogflow.com" style="color:#7c3aed;">Kogflow</a> — happy to do more rooms for free, or you can try it yourself at no cost.`,
            `A visual refresh pairs really well with a price adjustment. I built this using <a href="https://kogflow.com" style="color:#7c3aed;">Kogflow</a> — it's a simple web app, free to try, and you can stage a whole listing in a few minutes.`,
            `Price drops get noticed more when they come with new photos. I created this on <a href="https://kogflow.com" style="color:#7c3aed;">Kogflow.com</a> — takes a few clicks, super easy to use, and free to start.`,
            `Buyers who saw the listing before are more likely to act when there's something new to look at. I used <a href="https://kogflow.com" style="color:#7c3aed;">Kogflow</a> for this — free to try and takes no time at all.`,
            `A new staged photo after a price change can re-activate buyers who had the listing saved but never moved on it. <a href="https://kogflow.com" style="color:#7c3aed;">Kogflow</a> made this in seconds — free to try if you want to stage more rooms yourself.`,
            `Staged photos at a new price point often get buyers back on the phone. I put this together on <a href="https://kogflow.com" style="color:#7c3aed;">Kogflow</a> — it's affordable, free to start, and honestly very simple to use.`,
            `A visual update after a price drop can make a real difference in buyer perception. This was done on <a href="https://kogflow.com" style="color:#7c3aed;">Kogflow.com</a> — a few clicks per photo, free to try, no technical skill needed.`,
            `Buyers browsing at the new price point respond better to a furnished photo. I created this using <a href="https://kogflow.com" style="color:#7c3aed;">Kogflow</a> — easy to use, free to try, and works on any room photo.`,
            `A fresh photo set can be the nudge buyers who are on the fence need. <a href="https://kogflow.com" style="color:#7c3aed;">Kogflow</a> did this in a few clicks — free to start if you want to try it on a few more rooms.`,
            `Staged photos help buyers see value — especially after a price change. I put this together on <a href="https://kogflow.com" style="color:#7c3aed;">Kogflow.com</a> — it's extremely easy to use and free to try.`,
            `Buyers often reconsider a listing when the price drops and new photos appear. This was created on <a href="https://kogflow.com" style="color:#7c3aed;">Kogflow</a> — a simple web app that takes a few clicks and is free to start.`,
            `A new visual at a new price point can completely shift buyer perception. I did this on <a href="https://kogflow.com" style="color:#7c3aed;">Kogflow</a> — free to try and takes about 30 seconds per room.`,
        ] : dom >= 45 ? [
            `Listings with staged photos tend to get more saves and scheduled showings. I put this together on <a href="https://kogflow.com" style="color:#7c3aed;">Kogflow</a> — a few clicks per room, free to try, and very easy to use.`,
            `Buyers often scroll past an empty room but stop at a furnished version. I created this using <a href="https://kogflow.com" style="color:#7c3aed;">Kogflow.com</a> — it's free to try and takes about 30 seconds per photo.`,
            `A visual refresh at this point in the listing cycle can bring in a new wave of buyer interest. This was done on <a href="https://kogflow.com" style="color:#7c3aed;">Kogflow</a> — super simple to use, affordable, and free to start.`,
            `Staged photos give buyers something to react to — and listings with furnished photos get more inquiries. I used <a href="https://kogflow.com" style="color:#7c3aed;">Kogflow</a> for this — a few clicks, free to try, no experience needed.`,
            `Buyers who saw the listing before might reconsider when they see new photos. I built this on <a href="https://kogflow.com" style="color:#7c3aed;">Kogflow.com</a> — it's free to start and honestly takes no time at all.`,
            `Sometimes a listing just needs one strong photo to start getting traction again. I put this together using <a href="https://kogflow.com" style="color:#7c3aed;">Kogflow</a> — easy web app, a few clicks, free to try.`,
            `A furnished room photo can completely change how buyers feel about a space. I created this on <a href="https://kogflow.com" style="color:#7c3aed;">Kogflow</a> — free to try and takes about a minute for a whole room.`,
            `Listings that get a visual refresh after some market time often see renewed showing activity. This was built on <a href="https://kogflow.com" style="color:#7c3aed;">Kogflow.com</a> — simple, affordable, and free to start.`,
            `Buyers spend more time on listings with staged photos. I did this on <a href="https://kogflow.com" style="color:#7c3aed;">Kogflow</a> in a few clicks — free to try if you want to stage more rooms yourself.`,
            `At this point in the listing, something new in the photos can re-ignite buyer interest. <a href="https://kogflow.com" style="color:#7c3aed;">Kogflow</a> made this in seconds — free to try and extremely easy to use.`,
            `Staged photos help buyers picture themselves in the space. I created this using <a href="https://kogflow.com" style="color:#7c3aed;">Kogflow.com</a> — a simple web app that takes a few clicks and is free to start.`,
            `A fresh visual can be exactly what moves a listing that has been sitting. I put this together on <a href="https://kogflow.com" style="color:#7c3aed;">Kogflow</a> — very easy to use, affordable, and free to try now.`,
            `Buyers who passed on the listing before often come back when they see new photos. This was created on <a href="https://kogflow.com" style="color:#7c3aed;">Kogflow</a> — a few clicks per room and free to start.`,
            `A furnished photo at this stage can re-engage buyers who had the listing saved but never acted. I used <a href="https://kogflow.com" style="color:#7c3aed;">Kogflow</a> for this — free to try and takes no time.`,
            `Listings that show furnished rooms tend to get more second looks. I built this on <a href="https://kogflow.com" style="color:#7c3aed;">Kogflow.com</a> — easy to use, affordable, and free to try.`,
        ] : dom <= 7 ? [
            `Now is a great time to make the photos pop while the listing is getting fresh traffic. I created this on <a href="https://kogflow.com" style="color:#7c3aed;">Kogflow</a> — a few clicks, free to try, and takes about 30 seconds per room.`,
            `The first week on market is when listings get the most attention — a strong photo set now sets the tone for the whole campaign. I built this on <a href="https://kogflow.com" style="color:#7c3aed;">Kogflow.com</a> — free to try and super easy to use.`,
            `Buyers make fast decisions on new listings. A furnished photo right now can be the difference between a scroll-past and a showing request. I used <a href="https://kogflow.com" style="color:#7c3aed;">Kogflow</a> for this — free to start, a few clicks per room.`,
            `Great timing to have staged photos working while the listing is fresh. I put this together on <a href="https://kogflow.com" style="color:#7c3aed;">Kogflow</a> — it's free to try and honestly takes no time at all.`,
            `New listings get the most views in the first few days — a furnished photo right now can really move the needle. This was created on <a href="https://kogflow.com" style="color:#7c3aed;">Kogflow.com</a> — easy to use and free to start.`,
            `Buyers browsing new listings respond well to furnished photos — it helps them make faster decisions. I did this on <a href="https://kogflow.com" style="color:#7c3aed;">Kogflow</a> in a few clicks — free to try if you want to stage more rooms yourself.`,
            `The opening days of a listing are prime time for buyer interest. I built this using <a href="https://kogflow.com" style="color:#7c3aed;">Kogflow</a> — a simple web app, affordable, and free to start.`,
            `Buyers comparing multiple new listings spend more time on the one with furnished photos. I created this on <a href="https://kogflow.com" style="color:#7c3aed;">Kogflow.com</a> — a few clicks per room and free to try.`,
            `A strong first impression in the first week can set the pace for the whole listing. I put this together on <a href="https://kogflow.com" style="color:#7c3aed;">Kogflow</a> — very easy to use and free to start.`,
            `New listings get the most organic traffic — a furnished photo while it's fresh can drive real showing activity. This was made on <a href="https://kogflow.com" style="color:#7c3aed;">Kogflow</a> — free to try, takes about 30 seconds.`,
            `Buyers making quick decisions on new listings stop longer on furnished photos. I created this using <a href="https://kogflow.com" style="color:#7c3aed;">Kogflow.com</a> — simple, affordable, and free to start.`,
            `The first few days on market are when photos matter most. I built this on <a href="https://kogflow.com" style="color:#7c3aed;">Kogflow</a> — a few clicks per room, extremely easy to use, and free to try.`,
            `Staged photos help new listings make a strong first impression and get more saves. I did this on <a href="https://kogflow.com" style="color:#7c3aed;">Kogflow.com</a> — free to try and takes no time at all.`,
            `Now is exactly the right time to have great photos working for you. I created this using <a href="https://kogflow.com" style="color:#7c3aed;">Kogflow</a> — a few clicks, free to start, works on any listing photo.`,
            `A furnished photo right at launch can significantly improve how many buyers save the listing. I put this together on <a href="https://kogflow.com" style="color:#7c3aed;">Kogflow</a> — very easy to use and free to try now.`,
        ] : [
            `Staged photos help buyers picture themselves in the space and tend to lead to more saves and showings. I created this on <a href="https://kogflow.com" style="color:#7c3aed;">Kogflow</a> — a few clicks per room, free to try, and very easy to use.`,
            `Buyers often scroll past empty rooms but stop at furnished ones. I put this together using <a href="https://kogflow.com" style="color:#7c3aed;">Kogflow.com</a> — it's free to start and takes about 30 seconds per photo.`,
            `A furnished photo can make buyers feel more connected to the space right away. I created this on <a href="https://kogflow.com" style="color:#7c3aed;">Kogflow</a> — simple web app, a few clicks, and free to try now.`,
            `Staged listings tend to get more saves, more clicks, and more showing requests. I built this on <a href="https://kogflow.com" style="color:#7c3aed;">Kogflow.com</a> — extremely easy to use, affordable, and free to start.`,
            `Buyers spend more time on listings with furnished photos — and more time usually means more interest. I used <a href="https://kogflow.com" style="color:#7c3aed;">Kogflow</a> for this — free to try and takes no time at all.`,
            `A furnished version of a room gives buyers something to respond to emotionally. I put this together on <a href="https://kogflow.com" style="color:#7c3aed;">Kogflow</a> — a few clicks, very easy to use, free to start.`,
            `Staged photos tend to lead to faster offers and stronger interest. This was created on <a href="https://kogflow.com" style="color:#7c3aed;">Kogflow.com</a> — simple to use, affordable, and free to try now.`,
            `Buyers who can picture themselves in a space are more likely to schedule a showing. I built this using <a href="https://kogflow.com" style="color:#7c3aed;">Kogflow</a> — a few clicks per room and completely free to try.`,
            `A good staged photo can be the thing that makes a buyer pick up the phone. I created this on <a href="https://kogflow.com" style="color:#7c3aed;">Kogflow</a> — it's an easy web app, free to start, and works on any listing photo.`,
            `Listings with furnished photos tend to generate more inquiries. I put this together on <a href="https://kogflow.com" style="color:#7c3aed;">Kogflow.com</a> — takes a few clicks and is free to try.`,
            `Buyers make faster decisions when they can visualize a furnished space. I did this on <a href="https://kogflow.com" style="color:#7c3aed;">Kogflow</a> in about 30 seconds — free to try if you want to do more rooms yourself.`,
            `A staged photo helps buyers see past an empty room and focus on the space itself. I created this using <a href="https://kogflow.com" style="color:#7c3aed;">Kogflow</a> — very easy to use, affordable, and free to start.`,
            `Staged listings get more saves and showings on average. I built this on <a href="https://kogflow.com" style="color:#7c3aed;">Kogflow.com</a> — a simple web app that takes a few clicks and is free to try now.`,
            `Buyers browsing multiple listings stop longer on furnished photos. I put this together on <a href="https://kogflow.com" style="color:#7c3aed;">Kogflow</a> — free to try, extremely easy to use, and works on any room.`,
            `A furnished photo gives buyers a reason to imagine living there. I created this using <a href="https://kogflow.com" style="color:#7c3aed;">Kogflow.com</a> — a few clicks, free to start, no technical skill needed.`,
        ]);

        // ── Video walkthrough lines (12 variations) ─────────────────────────
        const videoLine = pick([
            `The same app also generates <strong>virtual video walkthroughs</strong> — buyers can take an immersive tour of the property from their phone before ever visiting.`,
            `<a href="https://kogflow.com" style="color:#7c3aed;">Kogflow</a> also does <strong>virtual video walkthroughs</strong> in a few clicks — buyers get a full tour experience without setting foot in the property.`,
            `Beyond photos, the same web app can turn any staged room into a <strong>virtual video walkthrough</strong> — great for out-of-town buyers who want to explore before committing to a showing.`,
            `It also generates <strong>virtual video walkthroughs</strong> from any staged photo — same app, same few clicks, and buyers get an immersive tour from their phone.`,
            `<a href="https://kogflow.com" style="color:#7c3aed;">Kogflow</a> can also create a <strong>virtual video walkthrough</strong> from the staged image — a useful tool for buyers doing research before scheduling a visit.`,
            `The app also does <strong>virtual video walkthroughs</strong> — buyers can move through the space remotely, which tends to drive higher-quality showing requests.`,
            `You can also generate a <strong>virtual video walkthrough</strong> right from the same app — buyers get a full property tour from wherever they are before deciding to visit.`,
            `<a href="https://kogflow.com" style="color:#7c3aed;">Kogflow</a> also produces <strong>virtual video walkthroughs</strong> from staged photos — an immersive experience that helps out-of-town buyers make faster decisions.`,
            `Same app also builds <strong>virtual video walkthroughs</strong> in a few clicks — buyers can explore the staged property remotely before committing to a showing.`,
            `Beyond the staged photo, <a href="https://kogflow.com" style="color:#7c3aed;">Kogflow</a> can generate a <strong>virtual video walkthrough</strong> — gives buyers who haven't visited yet a real feel for the space.`,
            `It also creates <strong>virtual video walkthroughs</strong> — same simple process, a few more clicks, and buyers get a full tour experience from their phone.`,
            `The same tool also does <strong>virtual video walkthroughs</strong> from any staged room — useful for listings that attract a lot of remote or out-of-state buyer interest.`,
        ]);

        // ── Closing lines (12 variations) ────────────────────────────────────
        const closingLine = pick([
            `It's free to try at <a href="https://kogflow.com" style="color:#7c3aed;">kogflow.com</a> — no credit card needed. Or just let me know if you want me to do a few more rooms first.`,
            `You can try it free at <a href="https://kogflow.com" style="color:#7c3aed;">Kogflow.com</a> — takes a few minutes to stage a whole listing. Happy to do more rooms for you at no charge in the meantime.`,
            `Free to start at <a href="https://kogflow.com" style="color:#7c3aed;">kogflow.com</a> if you want to explore it — or just reply and I'll put together more rooms for you.`,
            `Happy to stage more rooms for free — or feel free to try it yourself at <a href="https://kogflow.com" style="color:#7c3aed;">Kogflow.com</a>. No credit card, no commitment.`,
            `No strings attached — if you want more rooms done, just let me know. And if you want to try it yourself, it's free to start at <a href="https://kogflow.com" style="color:#7c3aed;">kogflow.com</a>.`,
            `I can do more rooms for free — or if you want to try it yourself, <a href="https://kogflow.com" style="color:#7c3aed;">Kogflow.com</a> is free to start and takes a few clicks.`,
            `Either way, happy to help — just reply if you want more rooms done. You can also try it free at <a href="https://kogflow.com" style="color:#7c3aed;">Kogflow.com</a> anytime.`,
            `Free to try at <a href="https://kogflow.com" style="color:#7c3aed;">kogflow.com</a> — no commitment needed. Happy to do more rooms for you first if you'd like to see a few more before you try it.`,
            `Just let me know if you want more rooms — happy to do them for free. The app itself is also free to try at <a href="https://kogflow.com" style="color:#7c3aed;">Kogflow.com</a> if you want to take it for a spin.`,
            `No obligation — happy to stage more rooms for you at no charge. You can also start free at <a href="https://kogflow.com" style="color:#7c3aed;">kogflow.com</a> whenever you're ready.`,
            `I'm happy to do more rooms for free — no pitch, no pressure. If you ever want to try it yourself, <a href="https://kogflow.com" style="color:#7c3aed;">Kogflow.com</a> is free to start.`,
            `Happy to keep going with more rooms at no cost — just reply. And when you're ready to try it yourself, it's free to start at <a href="https://kogflow.com" style="color:#7c3aed;">Kogflow.com</a>.`,
        ]);

        // ── Sign-offs (8 variations) ─────────────────────────────────────────
        const signoff = pick([
            `– Minh<br><a href="https://kogflow.com" style="color:#7c3aed;">Kogflow.com</a>`,
            `Best,<br>Minh<br><a href="https://kogflow.com" style="color:#7c3aed;">Kogflow.com</a>`,
            `Thanks,<br>Minh @ Kogflow<br><a href="https://kogflow.com" style="color:#7c3aed;">kogflow.com</a>`,
            `– Minh at Kogflow<br><a href="https://kogflow.com" style="color:#7c3aed;">kogflow.com</a>`,
            `Talk soon,<br>Minh<br><a href="https://kogflow.com" style="color:#7c3aed;">Kogflow.com</a>`,
            `Cheers,<br>Minh<br><a href="https://kogflow.com" style="color:#7c3aed;">Kogflow.com</a>`,
            `– Minh<br>Kogflow — AI Virtual Staging<br><a href="https://kogflow.com" style="color:#7c3aed;">kogflow.com</a>`,
            `Best regards,<br>Minh<br><a href="https://kogflow.com" style="color:#7c3aed;">Kogflow.com</a>`,
        ]);

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
              ${videoLine}
            </p>
            <p style="margin:0 0 24px;font-size:15px;color:#374151;line-height:1.6;">
              ${closingLine}
            </p>
            <table cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
              <tr>
                <td style="background:#7c3aed;border-radius:8px;padding:12px 24px;">
                  <a href="https://kogflow.com" style="color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;">See More Examples</a>
                </td>
              </tr>
            </table>
            <p style="margin:0;font-size:15px;color:#374151;">${signoff}</p>
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
            const message = `Gmail send error ${sendRes.status}: ${err}`;
            await markRecipientLockFailed(normalizedEmail, message);
            await releaseFailedRecipientLock(normalizedEmail);
            return { error: message, normalizedEmail };
        }

        const sentMsg = await sendRes.json();
        const gmailMessageId: string = sentMsg.id ?? null;
        const gmailThreadId: string = sentMsg.threadId ?? null;
        await markRecipientLockSent({ normalizedEmail, gmailMessageId, gmailThreadId });

        // Save thread/message IDs to the lead row so we can track replies
        if ((gmailThreadId || gmailMessageId) && lead.agentEmail) {
            const supabase = createClient(supabaseUrl, supabaseKey);
            await supabase.from('outreach_leads')
                .update({ gmail_thread_id: gmailThreadId, gmail_message_id: gmailMessageId })
                .eq('agent_email', lead.agentEmail)
                .eq('address', lead.address);
        }

        // Apply "Kogflow Outreach" Gmail label to the sent message (best-effort)
        if (gmailMessageId) {
            try {
                const labelId = await getOrCreateGmailLabel(accessToken, 'Kogflow Outreach');
                if (labelId) {
                    await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${gmailMessageId}/modify`, {
                        method: 'POST',
                        headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
                        body: JSON.stringify({ addLabelIds: [labelId] }),
                    });
                }
            } catch { /* label is best-effort */ }
        }

        return { success: true, normalizedEmail };

    } catch (error: any) {
        await markRecipientLockFailed(normalizedEmail, error.message || 'Unknown send error');
        await releaseFailedRecipientLock(normalizedEmail);
        return { error: error.message, normalizedEmail };
    }
}

export async function sendNextQueuedOutreachEmail(): Promise<{ sent: number; skipped: number; failed: number; reason?: string; errors: string[]; debug: string[] }> {
    const supabase = createClient(supabaseUrl, supabaseKey);
    const debug: string[] = [];
    const errors: string[] = [];

    const { config } = await loadPipelineConfig();
    const dailyLimit = config?.emails_per_day ?? 300;
    const windowStart = getPipelineCronWindowStart(new Date());
    const { count: sentToday, error: countError } = await supabase
        .from('outreach_leads')
        .select('*', { count: 'exact', head: true })
        .gte('email_sent_at', windowStart.toISOString());

    if (countError) {
        errors.push(`Daily email count failed: ${countError.message}`);
        return { sent: 0, skipped: 0, failed: 1, errors, debug };
    }

    if ((sentToday ?? 0) >= dailyLimit) {
        const reason = `Daily email cap reached (${sentToday}/${dailyLimit})`;
        debug.push(reason);
        return { sent: 0, skipped: 1, failed: 0, reason, errors, debug };
    }

    await supabase
        .from('outreach_email_queue')
        .update({ status: 'queued', locked_at: null, updated_at: new Date().toISOString() })
        .eq('status', 'sending')
        .lt('locked_at', new Date(Date.now() - 10 * 60_000).toISOString())
        .then(null, () => {});

    const { data: claimedRows, error: claimError } = await supabase.rpc('claim_next_outreach_email_queue_item');
    if (claimError) {
        errors.push(`Queue claim failed: ${claimError.message}`);
        return { sent: 0, skipped: 0, failed: 1, errors, debug };
    }

    const queueItem = Array.isArray(claimedRows) ? claimedRows[0] : claimedRows;
    if (!queueItem) {
        debug.push('No queued email ready to send');
        return { sent: 0, skipped: 0, failed: 0, reason: 'No queued email ready', errors, debug };
    }

    const { data: lead, error: leadError } = await supabase
        .from('outreach_leads')
        .select('id, status, address, listing_url, agent_name, agent_email, empty_rooms, city, price, days_on_market, price_reduced, photo_count, keywords')
        .eq('id', queueItem.lead_id)
        .maybeSingle();

    if (leadError || !lead) {
        const message = leadError?.message || 'Lead not found';
        await supabase
            .from('outreach_email_queue')
            .update({ status: 'failed', last_error: message, locked_at: null, updated_at: new Date().toISOString() })
            .eq('id', queueItem.id);
        errors.push(`Queued lead lookup failed: ${message}`);
        return { sent: 0, skipped: 0, failed: 1, errors, debug };
    }

    if (!lead.agent_email) {
        await supabase
            .from('outreach_email_queue')
            .update({ status: 'skipped', last_error: 'No agent email', locked_at: null, updated_at: new Date().toISOString() })
            .eq('id', queueItem.id);
        await updateLeadStatus(lead.id, 'form_filled');
        debug.push(`Skipped queued email for ${lead.address}: no agent email`);
        return { sent: 0, skipped: 1, failed: 0, errors, debug };
    }

    if (['emailed', 'form_filled'].includes(lead.status)) {
        await supabase
            .from('outreach_email_queue')
            .update({ status: 'skipped', last_error: `Lead already ${lead.status}`, locked_at: null, updated_at: new Date().toISOString() })
            .eq('id', queueItem.id);
        debug.push(`Skipped queued email for ${lead.address}: lead already ${lead.status}`);
        return { sent: 0, skipped: 1, failed: 0, errors, debug };
    }

    let storedBeforeUrl = lead.empty_rooms?.[0]?.imageUrl;
    // Re-upload if still an external URL (e.g. old leads stored raw Movoto URLs before this fix)
    if (storedBeforeUrl && !storedBeforeUrl.includes('supabase.co')) {
        storedBeforeUrl = await uploadBeforeImage(storedBeforeUrl, lead.id);
        const updatedRooms = [...(lead.empty_rooms || [])];
        if (updatedRooms[0]) updatedRooms[0] = { ...updatedRooms[0], imageUrl: storedBeforeUrl };
        await supabase.from('outreach_leads').update({ empty_rooms: updatedRooms }).eq('id', lead.id);
    }
    const stagedUrl = lead.empty_rooms?.[0]?.stagedUrl;
    const emailResult = await sendOutreachEmail({
        leadId: lead.id,
        agentName: lead.agent_name,
        agentEmail: lead.agent_email,
        address: lead.address,
        stagedImageUrl: stagedUrl,
        beforeImageUrl: storedBeforeUrl,
        city: lead.city,
        price: lead.price,
        daysOnMarket: lead.days_on_market,
        priceReduced: lead.price_reduced,
        photoCount: lead.photo_count,
        keywords: lead.keywords,
        roomType: lead.empty_rooms?.[0]?.roomType,
        listingUrl: lead.listing_url,
        source: 'queue',
    });

    if (emailResult.success) {
        const sentAt = new Date().toISOString();
        await supabase
            .from('outreach_email_queue')
            .update({ status: 'sent', sent_at: sentAt, locked_at: null, last_error: null, updated_at: sentAt })
            .eq('id', queueItem.id);
        await updateLeadStatus(lead.id, 'emailed', { email_sent_at: sentAt });
        debug.push(`Email sent from queue -> ${lead.agent_email} (${lead.address})`);
        return { sent: 1, skipped: 0, failed: 0, errors, debug };
    }

    if (emailResult.duplicate) {
        await supabase
            .from('outreach_email_queue')
            .update({ status: 'skipped', last_error: emailResult.error || 'Duplicate recipient', locked_at: null, updated_at: new Date().toISOString() })
            .eq('id', queueItem.id);
        await updateLeadStatus(lead.id, 'form_filled');
        debug.push(`Duplicate blocked from queue: ${lead.agent_email} (${lead.address})`);
        return { sent: 0, skipped: 1, failed: 0, errors, debug };
    }

    const attempts = Number(queueItem.attempts ?? 1);
    const finalFailure = attempts >= 3;
    await supabase
        .from('outreach_email_queue')
        .update({
            status: finalFailure ? 'failed' : 'queued',
            send_after: finalFailure ? queueItem.send_after : new Date(Date.now() + 15 * 60_000).toISOString(),
            locked_at: null,
            last_error: emailResult.error || 'Email failed',
            updated_at: new Date().toISOString(),
        })
        .eq('id', queueItem.id);
    await updateLeadStatus(lead.id, 'queued');

    errors.push(`Queued email failed ${lead.address}: ${emailResult.error}`);
    debug.push(`Queued email failed ${lead.address}: ${emailResult.error}`);
    return { sent: 0, skipped: 0, failed: 1, errors, debug };
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
        // Use Zyte browser rendering with scroll actions to trigger lazy-loaded photo gallery.
        // HAR.com uses intersection-observer lazy loading — without scrolling, only above-fold
        // content is captured and photo src attributes are empty or missing.
        const res = await fetch('https://api.zyte.com/v1/extract', {
            method: 'POST',
            headers: {
                'Authorization': `Basic ${Buffer.from(`${ZYTE_API_KEY}:`).toString('base64')}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                url: fullUrl,
                browserHtml: true,
                geolocation: 'US',
                actions: [
                    { action: 'waitForTimeout', timeout: 1500 },
                    { action: 'scrollBottom' },
                    { action: 'waitForTimeout', timeout: 1000 },
                ],
            }),
        });
        if (!res.ok) {
            console.warn(`[getHarListingPhotos] Zyte error for ${fullUrl}: ${res.status}`);
            return [];
        }
        const data = await res.json();
        const html: string = data.browserHtml || '';
        if (!html) return [];

        // Primary: extract from __NEXT_DATA__ JSON blob (most reliable — full untruncated list)
        const nextDataMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
        if (nextDataMatch) {
            try {
                const nextData = JSON.parse(nextDataMatch[1]);
                const json = JSON.stringify(nextData);
                const fromJson = [
                    ...new Set(
                        [...json.matchAll(/https:\\?\/\\?\/(?:photos|mediahar)\.harstatic\.com\\?\/[^"\\]+\.jpe?g/gi)]
                            .map(m => m[0].replace(/\\u002F/g, '/').replace(/\\\//g, '/'))
                    ),
                ];
                if (fromJson.length > 0) return fromJson.slice(0, maxPhotos);
            } catch { /* fall through to regex scan */ }
        }

        // Fallback: regex over full rendered HTML
        const urls = [
            ...new Set(
                [...html.matchAll(/https:\/\/(?:photos|mediahar)\.harstatic\.com\/[^"'\s\\]+\.jpe?g/gi)]
                    .map(m => m[0])
            ),
        ];
        return urls.slice(0, maxPhotos);
    } catch (err: any) {
        console.warn(`[getHarListingPhotos] error for ${fullUrl}: ${err.message}`);
        return [];
    }
}

function getStageabilitySignals(listing: Partial<ScrapedListing>): {
    vacancyHits: number;
    negativeHits: number;
    likelihoodScore: number;
} {
    const text = `${listing.keywords?.join(' ') || ''} ${listing.address || ''}`.toLowerCase();
    const vacancyKeywords = [
        'vacant', 'unfurnished', 'empty', 'unoccupied', 'immediate occupancy', 'no furnit',
        'investor', 'fixer', 'estate sale', 'estate-owned', 'estate owned', 'cash only',
        'needs work', 'needs tlc', 'handyman', 'rehab', 'remodel', 'renovation',
        'price reduced', 'motivated seller', 'as-is', 'as is', 'tenant moved'
    ];
    const negativeKeywords = [
        'fully furnished', 'turnkey', 'stunning updated', 'beautifully renovated',
        'luxury', 'designer', 'move-in ready', 'move in ready', 'resort-style',
        'virtual staged', 'virtually staged', 'photo(s) has been virtually staged'
    ];
    const vacancyHits = vacancyKeywords.filter((keyword) => text.includes(keyword)).length;
    const negativeHits = negativeKeywords.filter((keyword) => text.includes(keyword)).length;
    const likelihoodScore =
        vacancyHits * 4 +
        Math.min((listing.daysOnMarket || 0) / 15, 4) +
        ((listing.priceReduced ? 2 : 0)) +
        (((listing.photoCount || 99) <= 12) ? 2 : 0) -
        negativeHits * 3;

    return { vacancyHits, negativeHits, likelihoodScore };
}

async function getHomesListingPhotos(propertyUrl: string, maxPhotos = 10): Promise<string[]> {
    if (!propertyUrl) return [];

    try {
        const { html, error } = await zyteGet(propertyUrl);
        if (error || !html) {
            console.warn(`[getHomesListingPhotos] Zyte error for ${propertyUrl}: ${error}`);
            return [];
        }

        const listingSlug = propertyUrl.match(/\/property\/([^/]+)\//i)?.[1]?.toLowerCase() || '';
        const urls = [...new Set(
            [...html.matchAll(/https:\/\/images\.homes\.com\/[^"'\s)]+/g)]
                .map(m => m[0])
                .filter((imageUrl) => {
                    const lower = imageUrl.toLowerCase();
                    if (!lower.match(/\.(jpg|jpeg|webp)(\?|$)/)) return false;
                    if (lower.includes('/brands/')) return false;
                    return !listingSlug || lower.includes(listingSlug);
                })
        )];

        return urls.slice(0, maxPhotos);
    } catch (err: any) {
        console.warn(`[getHomesListingPhotos] error for ${propertyUrl}: ${err.message}`);
        return [];
    }
}

async function getHomesListingContext(propertyUrl: string, maxPhotos = 10): Promise<{
    photos: string[];
    agentEmail?: string;
    agentPhone?: string;
    agentName?: string;
}> {
    if (!propertyUrl) return { photos: [] };

    try {
        const { html, error } = await zyteGet(propertyUrl);
        if (error || !html) {
            console.warn(`[getHomesListingContext] Zyte error for ${propertyUrl}: ${error}`);
            return { photos: [] };
        }

        const listingSlug = propertyUrl.match(/\/property\/([^/]+)\//i)?.[1]?.toLowerCase() || '';
        const photos = [...new Set(
            [...html.matchAll(/https:\/\/images\.homes\.com\/[^"'\s)]+/g)]
                .map(m => m[0])
                .filter((imageUrl) => {
                    const lower = imageUrl.toLowerCase();
                    if (!lower.match(/\.(jpg|jpeg|webp)(\?|$)/)) return false;
                    if (lower.includes('/brands/')) return false;
                    return !listingSlug || lower.includes(listingSlug);
                })
        )].slice(0, maxPhotos);

        const emailMatches = [...html.matchAll(/"email"\s*:\s*"([^"]+)"/gi)]
            .map(match => match[1].trim().toLowerCase())
            .filter(email => email && !email.endsWith('@homes.com'));
        const phoneMatches = [...html.matchAll(/"telephone"\s*:\s*"([^"]+)"/gi)]
            .map(match => match[1].trim())
            .filter(Boolean);
        const nameMatches = [...html.matchAll(/"name"\s*:\s*"([^"]+)"/gi)]
            .map(match => match[1].trim())
            .filter(name => name && !/^homes\.com$/i.test(name));

        return {
            photos,
            agentEmail: emailMatches[0],
            agentPhone: phoneMatches[0],
            agentName: nameMatches.find(name => !/unit\s+\d+/i.test(name)),
        };
    } catch (err: any) {
        console.warn(`[getHomesListingContext] error for ${propertyUrl}: ${err.message}`);
        return { photos: [] };
    }
}

async function getListingPhotos(propertyUrl: string, maxPhotos = 10): Promise<string[]> {
    if (propertyUrl.includes('homes.com/')) {
        return getHomesListingPhotos(propertyUrl, maxPhotos);
    }
    return getHarListingPhotos(propertyUrl, maxPhotos);
}

// Scans photos from a HAR detail page and returns the first confirmed interior photo.
// Uses Moondream to reject exterior shots (front of house, yard, aerial, etc.).
// HAR photo order is typically [0]=exterior, then mixed — this guarantees interior.
async function findInteriorPhoto(listingUrl: string): Promise<string | null> {
    const photos = await getListingPhotos(listingUrl, 10);
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
        const photos = await getListingPhotos(lead.listing_url, 5);
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
        } else if ((lead.icp_score ?? 0) >= 15 && interiorPhotos[0]) {
            // Score 15+ but no empty room found.
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
    deadlineMs?: number;
}): Promise<{ processed: number; errors: string[]; debug: string[]; sessionId: string }> {
    const supabase = createClient(supabaseUrl, supabaseKey);
    const sessionId = config.sessionId || crypto.randomUUID();
    const errors: string[] = [];
    const debug: string[] = [];
    let processed = 0;
    // Scrape enough inventory to fill the session target without overfetching every city.
    // Large sessions used to scrape 4x the session target PER city, which could exceed
    // Vercel's 5-minute function limit. We now distribute the fetch budget across cities.
    const candidateCities = config.cities.length > 0 ? config.cities : getDefaultTargetCities();
    const rotatingCityCount = Math.max(3, Math.min(6, Math.ceil(config.scrapesPerSession / 8)));
    // Use total pipeline run count as rotation index so each session picks the next city group
    const { count: runCount } = await supabase.from('pipeline_runs').select('*', { count: 'exact', head: true });
    const activeCities = selectRotatingCities(candidateCities, rotatingCityCount, runCount ?? 0);
    const cityCount = Math.max(activeCities.length, 1);
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
    await log(`City pool: ${candidateCities.length} configured markets`);
    await log(`Rotating into ${activeCities.length} active markets this session: ${activeCities.join(', ')}`);
    await log(`Scraping ${activeCities.length} cities in parallel (${batchSize} listings each, ${harPages} HAR pages)...`);

    // ── Step 1: Scrape all cities via HAR (+ homes.com fallback) in parallel ──
    // City lambdas push into local arrays then we log after all resolve
    const cityResults = await Promise.all(
        activeCities.map(async (city) => {
            const lines: string[] = [];
            const market = resolveTargetMarket(city);
            const harResult = market.sourcePriority.includes('har')
                ? await scrapeHarCity(city, batchSize, harPages)
                : { listings: [] as ScrapedListing[] };
            if (harResult.listings && harResult.listings.length > 0) {
                lines.push(`[${market.label}] HAR: ${harResult.listings.length} listings`);
                return { city: market.label, listings: harResult.listings, lines };
            }
            if ((harResult as { error?: string }).error) {
                lines.push(`[${market.label}] HAR error: ${(harResult as { error?: string }).error}`);
            } else if (market.sourcePriority.includes('har')) {
                lines.push(`[${market.label}] HAR: 0 listings - trying homes.com...`);
            } else {
                lines.push(`[${market.label}] Using homes.com as primary source`);
            }

            const homesResult = await scrapeHomesCity(city, batchSize);
            if (homesResult.listings && homesResult.listings.length > 0) {
                lines.push(`[${market.label}] homes.com: ${homesResult.listings.length} listings`);
                return { city: market.label, listings: homesResult.listings, lines };
            }
            if (homesResult.error) {
                errors.push(`${market.label}: ${homesResult.error}`);
                lines.push(`[${market.label}] homes.com error: ${homesResult.error}`);
            } else {
                lines.push(`[${market.label}] homes.com: 0 listings`);
            }
            return { city: market.label, listings: [] as ScrapedListing[], lines };
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
        await supabase.from('pipeline_session_log').insert({ session_id: sessionId, message: '__SESSION_COMPLETE__' }).then(null, () => {});
        return { processed: 0, errors, debug, sessionId };
    }

    // ── Step 3: Sort new listings by priority (ICP score → DOM → photo count) ──
    newListings.sort(
        (a, b) =>
            (b.score ?? 0) - (a.score ?? 0) ||
            (b.daysOnMarket ?? 0) - (a.daysOnMarket ?? 0) ||
            (b.photoCount ?? 0) - (a.photoCount ?? 0)
    );

    // Email + photo enrichment is now deferred to the Moondream batch loop (only for leads that
    // will actually be vision-checked), eliminating ~15-20 upfront Zyte browserHtml calls per session.
    const rankedListings = newListings;
    rankedListings.sort((a, b) => {
        const aSignals = getStageabilitySignals(a);
        const bSignals = getStageabilitySignals(b);
        return (
            Number(!!normalizeAgentEmail(b.agentEmail)) - Number(!!normalizeAgentEmail(a.agentEmail)) ||
            bSignals.likelihoodScore - aSignals.likelihoodScore ||
            bSignals.vacancyHits - aSignals.vacancyHits ||
            (b.score ?? 0) - (a.score ?? 0) ||
            (b.daysOnMarket ?? 0) - (a.daysOnMarket ?? 0) ||
            (aSignals.negativeHits - bSignals.negativeHits) ||
            (b.photoCount ?? 0) - (a.photoCount ?? 0)
        );
    });
    await log(`Prioritized ${rankedListings.filter((listing) => !!normalizeAgentEmail(listing.agentEmail)).length}/${rankedListings.length} new leads with agent email`);

    // Respect exactly what the user configured
    const maxPerSession = Math.min(rankedListings.length, config.scrapesPerSession);
    const toProcess = rankedListings.slice(0, maxPerSession);
    await log(`Processing ${toProcess.length} new leads (target: ${config.scrapesPerSession})...`);

    // ── Step 4: Moondream — check listings that have keywords suggesting vacancy ──
    // HAR search results only return 1 photo (PHOTOPRIMARY), so we filter by keywords first:
    // "vacant", "unfurnished", "empty", "needs staging" → high likelihood of empty rooms
    // Fallback: check any listing with DOM >= 60 (motivated seller, may be vacant)
    // Limit: 8 Moondream checks max (~8 × 30s = 240s, fits within 300s Vercel limit)
    let emptyRoomsFound = 0;
    let moondreamChecked = 0;
    let highScoreStaged = 0;
    const MAX_MOONDREAM = 32;
    const MIN_REDESIGN_SCORE = 15;
    const MAX_HIGH_SCORE_STAGE = 20; // max redesigns per session to control Kie.ai credits
    const MIN_TIME_FOR_NEXT_VISION_BATCH_MS = 40_000;

    // Sort toProcess so vacant/unfurnished keyword listings come first
    toProcess.sort((a, b) => {
        const aSignals = getStageabilitySignals(a);
        const bSignals = getStageabilitySignals(b);
        return (
            bSignals.likelihoodScore - aSignals.likelihoodScore ||
            bSignals.vacancyHits - aSignals.vacancyHits ||
            (b.daysOnMarket ?? 0) - (a.daysOnMarket ?? 0) ||
            (aSignals.negativeHits - bSignals.negativeHits)
        );
    });

    await log(`Checking up to ${MAX_MOONDREAM} leads with Moondream (no empty-room cap)`);

    // Process listings in parallel batches of 4 — cuts Moondream wall-clock time by ~4×
    // compared to the previous sequential loop (16 listings × ~15s → ~60s instead of ~240s).
    const MOONDREAM_CONCURRENCY = 4;

    for (let batchStart = 0; batchStart < toProcess.length; batchStart += MOONDREAM_CONCURRENCY) {
        // Deadline guard — write SESSION_COMPLETE before Vercel's 300s hard kill.
        if (config.deadlineMs && Date.now() + MIN_TIME_FOR_NEXT_VISION_BATCH_MS > config.deadlineMs) {
            await log(`Time budget reached: stopping early (${processed} leads saved so far)`);
            await flushLog();
            await supabase.from('pipeline_session_log').insert({ session_id: sessionId, message: '__SESSION_COMPLETE__' }).then(null, () => {});
            return { processed, errors, debug, sessionId };
        }

        // Stop-request check before each batch (replaces the every-3rd-lead check in the old loop).
        const { data: stopData, error: stopError } = await supabase
            .from('pipeline_session_log')
            .select('id')
            .eq('session_id', sessionId)
            .eq('message', '__STOP_REQUESTED__')
            .limit(1);

        let stopRequested = false;
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

        const batch = toProcess.slice(batchStart, batchStart + MOONDREAM_CONCURRENCY);
        const slotsAvailable = MAX_MOONDREAM - moondreamChecked;

        // Fan out — all per-listing async work (score, lock check, photos, Moondream) runs in parallel.
        const batchResults = await Promise.all(batch.map(async (listing, batchIdx) => {
            const logs: string[] = [];
            const errs: string[] = [];
            const emptyRooms: { roomType: string; imageUrl: string }[] = [];
            let furnishedRoom: { roomType: string; imageUrl: string } | null = null;
            let visionScoreBoost = 0;

            listing.score = await scoreICP(listing);

            const useMoondream = batchIdx < slotsAvailable;

            // Fetch email + photos together for Moondream-bound homes.com leads (one Zyte call).
            // Non-Moondream leads skip all Zyte fetching — saves ~15-20 browserHtml calls/session.
            let detailPhotos: string[] = [];
            if (useMoondream) {
                if (listing.listingUrl.includes('homes.com/')) {
                    const ctx = await getHomesListingContext(listing.listingUrl, 8);
                    detailPhotos = ctx.photos;
                    listing.agentEmail = listing.agentEmail || ctx.agentEmail || '';
                    listing.agentPhone = listing.agentPhone || ctx.agentPhone || '';
                    listing.agentName = listing.agentName || ctx.agentName || '';
                } else {
                    detailPhotos = await getHarListingPhotos(listing.listingUrl, 8);
                }
                logs.push(`  [${listing.address}] ${detailPhotos.length} photos (url: ${listing.listingUrl})`);
            }

            const recipientKey = normalizeAgentEmail(listing.agentEmail);
            const lockCheck = await hasRecipientLock(recipientKey);
            if (lockCheck.error) {
                logs.push(`[${listing.city}] ${listing.address} - email lock check failed: ${lockCheck.error}`);
                errs.push(`Email lock check failed: ${lockCheck.error}`);
                return { listing, emptyRooms: [] as { roomType: string; imageUrl: string }[], furnishedRoom: null, skipToFormFilled: true, usedMoondream: false, logs, errs };
            }
            if (!recipientKey || lockCheck.locked) {
                logs.push(`[${listing.city}] ${listing.address} - skipped before Moondream (${recipientKey ? 'recipient already contacted' : 'no email'})`);
                return { listing, emptyRooms: [] as { roomType: string; imageUrl: string }[], furnishedRoom: null, skipToFormFilled: true, usedMoondream: false, logs, errs };
            }

            if (useMoondream) {
                let foundStageable = false;
                for (const photo of detailPhotos.slice(1, 4)) {
                    const { isStageable, isEmpty, isInterior, roomType, error: roomErr } = await detectRoom(photo);
                    if (roomErr) { logs.push(`  [${listing.address}] Moondream error: ${roomErr}`); continue; }
                    logs.push(`  [${listing.address}] stageable=${isStageable} empty=${isEmpty} type=${roomType}`);
                    if (!isInterior) continue; // skip exterior, floor plans, foyers
                    if (isStageable && isEmpty) {
                        emptyRooms.push({ roomType, imageUrl: photo });
                        logs.push(`  → Empty ${roomType}!`);
                        visionScoreBoost = Math.max(visionScoreBoost, 25);
                        foundStageable = true;
                        break;
                    }
                    if (!furnishedRoom && !isEmpty && roomType !== 'room') {
                        furnishedRoom = { roomType, imageUrl: photo };
                        logs.push(`  → Furnished ${roomType} (redesign candidate)`);
                        visionScoreBoost = Math.max(visionScoreBoost, 15);
                        if (((listing.score ?? 0) + visionScoreBoost) >= MIN_REDESIGN_SCORE) {
                            foundStageable = true;
                            break;
                        }
                    }
                }
                if (visionScoreBoost > 0) {
                    listing.score = Math.max(0, (listing.score ?? 0) + visionScoreBoost);
                    logs.push(`  → ICP score boosted +${visionScoreBoost} from Gemini room fit (score ${listing.score})`);
                }
                if (!foundStageable && !furnishedRoom) logs.push(`  [${listing.address}] No stageable room found (all floor plans / entryways / exterior)`);
            } else {
                logs.push(`  [${listing.address}] Skipping Moondream (${MAX_MOONDREAM} per-session limit reached)`);
            }

            // Kick off Kie.ai staging right here in the parallel fan-out — this is the
            // expensive call (image upload + API). Running it concurrently across listings
            // prevents it from blocking the sequential DB-write phase that follows.
            let stagingTaskId: string | undefined;
            let isRedesign = false;
            if (emptyRooms.length > 0) {
                const { taskId, error: stageErr } = await stageEmptyRoom(emptyRooms[0].imageUrl, emptyRooms[0].roomType, false);
                if (taskId) {
                    stagingTaskId = taskId;
                    logs.push(`  → Kie.ai task queued (empty room) taskId=${taskId}`);
                } else {
                    logs.push(`  → Stage FAILED: ${stageErr}`);
                }
            } else if (furnishedRoom && (listing.score ?? 0) >= MIN_REDESIGN_SCORE && batchIdx < (MAX_HIGH_SCORE_STAGE - highScoreStaged)) {
                // Redesign budget is checked per-batch using the pre-batch highScoreStaged snapshot
                const { taskId, error: stageErr } = await stageEmptyRoom(furnishedRoom.imageUrl, furnishedRoom.roomType, true);
                if (taskId) {
                    stagingTaskId = taskId;
                    isRedesign = true;
                    logs.push(`  → Kie.ai task queued (redesign score ${listing.score}, threshold ${MIN_REDESIGN_SCORE}) taskId=${taskId}`);
                } else {
                    logs.push(`  → Redesign FAILED: ${stageErr}`);
                }
            }

            return { listing, emptyRooms, furnishedRoom, stagingTaskId, isRedesign, skipToFormFilled: false, usedMoondream: useMoondream, logs, errs };
        }));

        // Merge results sequentially — only fast DB writes remain here (no Kie.ai calls).
        for (const r of batchResults) {
            for (const l of r.logs) await log(l);
            for (const e of r.errs) errors.push(e);
            if (r.usedMoondream) moondreamChecked++;
            if (r.emptyRooms.length > 0) emptyRoomsFound++;
            if (r.isRedesign && r.stagingTaskId) highScoreStaged++;

            const saveResult = await saveLead({ ...r.listing, emptyRooms: r.emptyRooms });
            if (saveResult.error) {
                await log(`[${r.listing.city}] ${r.listing.address} — save error: ${saveResult.error}`);
                errors.push(`Save error: ${saveResult.error}`);
                continue;
            }

            // Lead already exists in DB — do NOT touch its status or re-stage it.
            if (saveResult.skipped) {
                await log(`[${r.listing.city}] ${r.listing.address} — already in DB (status: ${(saveResult.lead as any)?.status ?? 'unknown'}), skipping`);
                continue;
            }

            const leadId = saveResult.lead?.id;
            if (!leadId) continue;

            if (r.skipToFormFilled) {
                await updateLeadStatus(leadId, 'form_filled');
                continue;
            }

            await updateLeadStatus(leadId, 'scored');

            if (r.stagingTaskId) {
                if (r.isRedesign) {
                    await supabase.from('outreach_leads')
                        .update({ empty_rooms: [{ roomType: r.furnishedRoom!.roomType, imageUrl: r.furnishedRoom!.imageUrl, redesign: true }] })
                        .eq('id', leadId);
                }
                await updateLeadStatus(leadId, 'staged', { staging_task_id: r.stagingTaskId });
                await log(`  → Staged ${r.isRedesign ? '(redesign)' : '(empty room)'} taskId=${r.stagingTaskId}`);
            }

            processed++;
            await log(`[${r.listing.city}] ✓ Saved: ${r.listing.address} (score ${r.listing.score}, emptyRooms=${r.emptyRooms.length}, furnishedRoom=${r.furnishedRoom?.roomType ?? 'none'})`);
        }
    }

    if (allListings.length === 0) {
        await log('No listings found — check city list and Zyte API key');
    }
    await log(`Session complete: ${processed} saved, ${emptyRoomsFound} empty rooms found across ${moondreamChecked} Moondream checks`);
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
    emails_per_day: number;
    cities: string[];
    cron_enabled: boolean;
}


export async function savePipelineConfig(config: PipelineConfig): Promise<{ success?: boolean; error?: string; warning?: string }> {
    const supabase = createClient(supabaseUrl, supabaseKey);
    // Gracefully handle columns that may not exist yet in older deployments.
    const row = { id: 1, ...config, updated_at: new Date().toISOString() };
    const { error } = await supabase.from('pipeline_config').upsert(row, { onConflict: 'id' });
    if (error?.message?.includes('cron_enabled') || error?.message?.includes('emails_per_day')) {
        const { cron_enabled: _ce, emails_per_day: _epd, ...rowCore } = row;
        const { error: e2 } = await supabase.from('pipeline_config').upsert(rowCore, { onConflict: 'id' });
        if (e2) return { error: e2.message };
        return {
            success: true,
            warning: 'Live database is missing pipeline_config.cron_enabled and/or pipeline_config.emails_per_day. Schedule settings are partially saved; run the pending Supabase migrations to make cron limits and daily email volume work correctly.',
        };
    } else if (error) return { error: error.message };
    return { success: true };
}

export async function loadPipelineConfig(): Promise<{ config?: PipelineConfig; error?: string; warning?: string }> {
    const supabase = createClient(supabaseUrl, supabaseKey);
    const { data, error } = await supabase.from('pipeline_config').select('*').eq('id', 1).single();
    const defaults: PipelineConfig = {
        sessions_per_day: 20, scrapes_per_session: 100, emails_per_day: 300, cron_enabled: true,
        cities: getDefaultTargetCities(),
    };
    if (error || !data) return { config: defaults };
    const missingModernColumns =
        !Object.prototype.hasOwnProperty.call(data, 'emails_per_day') ||
        !Object.prototype.hasOwnProperty.call(data, 'cron_enabled');
    return {
        config: {
            sessions_per_day: data.sessions_per_day,
            scrapes_per_session: data.scrapes_per_session,
            emails_per_day: data.emails_per_day ?? 300,
            cities: data.cities,
            cron_enabled: data.cron_enabled ?? true,
        },
        warning: missingModernColumns
            ? 'Live database is missing pipeline_config.cron_enabled and/or pipeline_config.emails_per_day. Cron is falling back to defaults, so 300 emails/day is not active in production yet.'
            : undefined,
    };
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
    const windowStart = getPipelineCronWindowStart(new Date());
    // Try to filter by trigger='cron'; fall back to all runs if column missing
    const { count, error } = await supabase
        .from('pipeline_runs')
        .select('*', { count: 'exact', head: true })
        .gte('ran_at', windowStart.toISOString())
        .neq('processed', -1)
        .eq('trigger', 'cron');
    if (error?.message?.includes('trigger')) {
        // trigger column not yet added — can't distinguish cron from manual runs,
        // so return 0 to prevent manual UI runs from blocking the cron schedule.
        return 0;
    }
    return count ?? 0;
}

function getPipelineCronWindowStart(now: Date): Date {
    const start = new Date(now);
    start.setUTCMinutes(0, 0, 0);
    start.setUTCHours(15);
    if (now.getUTCHours() < 15) start.setUTCDate(start.getUTCDate() - 1);
    return start;
}

// Returns cron schedule health info for the dashboard.
// Cron fires every 30 minutes from 15:00–00:30 UTC (8am–5:30pm Pacific during DST).
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
    const CRON_SLOTS = [
        ...[15, 16, 17, 18, 19, 20, 21, 22, 23].flatMap(hour => [{ hour, minute: 0 }, { hour, minute: 30 }]),
        { hour: 0, minute: 0 },
        { hour: 0, minute: 30 },
    ];
    const cronTimes = CRON_SLOTS.map(({ hour, minute }) => {
        const candidate = new Date(now);
        candidate.setUTCMinutes(minute, 0, 0);
        candidate.setUTCHours(hour);
        if (hour === 0 && now.getUTCHours() !== 0) candidate.setUTCDate(candidate.getUTCDate() + 1);
        return candidate;
    }).sort((a, b) => a.getTime() - b.getTime());

    const expected_so_far = cronTimes.filter(time => time.getTime() <= now.getTime()).length;

    const nextCronTime = cronTimes.find(time => time.getTime() > now.getTime()) ?? (() => {
        const next = new Date(cronTimes[0]);
        next.setUTCDate(next.getUTCDate() + 1);
        return next;
    })();
    const next_scheduled_utc = nextCronTime.toISOString();

    // Last cron run — try to filter by trigger='cron', fall back to any run
    const today = getPipelineCronWindowStart(now);
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
        sessions_per_day: config?.sessions_per_day ?? 20,
        today_cron_runs,
        last_cron_run,
        next_scheduled_utc,
        expected_so_far,
        schedule: 'Every 30 minutes 8am–5:30pm Pacific during DST (15:00–00:30 UTC)',
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

// City-aware URL builders for site testing
const SITE_URL_BUILDERS: Record<string, (city: string) => string | null> = {
    'har.com': (city) => {
        const market = resolveTargetMarket(city);
        return market.state === 'TX'
            ? `https://www.har.com/search/dosearch?type=residential&minprice=150000&maxprice=700000&status=A&city=${encodeURIComponent(market.city)}`
            : null;
    },
    'homes.com': (city) => {
        const market = resolveTargetMarket(city);
        return `https://www.homes.com/${market.homesSlug}/`;
    },
    'homefinder.com': (city) => {
        const market = resolveTargetMarket(city);
        return `https://homefinder.com/homes-for-sale/${market.city.toLowerCase().replace(/\s+/g, '-')}-${market.state.toLowerCase()}`;
    },
    'estately.com': (city) => {
        const market = resolveTargetMarket(city);
        return `https://www.estately.com/${market.state}/${market.city.replace(/\s+/g, '_')}`;
    },
    'century21.com': (city) => {
        const market = resolveTargetMarket(city);
        const slug = `${market.city.toLowerCase().replace(/\s+/g, '-')}-${market.state.toLowerCase()}`;
        const code = `${market.state}${market.city}`.toUpperCase().replace(/\s+/g, '');
        return `https://www.century21.com/real-estate/${slug}/LC${code}/`;
    },
    'coldwellbanker.com': (city) => {
        const market = resolveTargetMarket(city);
        return `https://www.coldwellbanker.com/for-sale/${market.city.replace(/\s+/g, '-')}-${market.state}`;
    },
    'homepath.fanniemae.com': (city) => {
        const market = resolveTargetMarket(city);
        return `https://homepath.fanniemae.com/listings?location=${encodeURIComponent(`${market.city}, ${market.state}`)}`;
    },
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

// ---------------------------------------------------------------------------
// Gmail label helper
// ---------------------------------------------------------------------------

let _labelIdCache: string | null = null;

async function getOrCreateGmailLabel(accessToken: string, labelName: string): Promise<string | null> {
    if (_labelIdCache) return _labelIdCache;
    const listRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/labels', {
        headers: { 'Authorization': `Bearer ${accessToken}` },
    });
    if (!listRes.ok) return null;
    const { labels } = await listRes.json();
    const existing = labels?.find((l: any) => l.name === labelName);
    if (existing) { _labelIdCache = existing.id; return existing.id; }
    const createRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/labels', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: labelName, labelListVisibility: 'labelShow', messageListVisibility: 'show' }),
    });
    if (!createRes.ok) return null;
    const created = await createRes.json();
    _labelIdCache = created.id;
    return created.id;
}

// ---------------------------------------------------------------------------
// Kogflow knowledge base for AI replies
// ---------------------------------------------------------------------------

let _kbCache: string | null = null;
let _kbFetchedAt = 0;

async function getKogflowKnowledgeBase(): Promise<string> {
    if (_kbCache && Date.now() - _kbFetchedAt < 86_400_000) return _kbCache;

    const staticKb = `
KOGFLOW — AI Virtual Staging Platform (kogflow.com)

WHAT IT DOES:
Kogflow uses AI to virtually stage empty or poorly furnished rooms in real estate photos.
Upload a photo, AI adds furniture, download the staged image in seconds.
It also generates virtual video walkthroughs from staged images.

HOW TO STAGE AN IMAGE (step by step):
1. Go to https://kogflow.com and create a free account (no credit card needed)
2. Click "New Project" or drag and drop a room photo onto the dashboard
3. Select a staging style (Modern, Scandinavian, Coastal, etc.)
4. Choose the room type (Living Room, Bedroom, Kitchen, etc.)
5. Click "Stage" — AI generates the staged version in under a minute
6. Download the HD result or share the link directly

HOW TO GENERATE A VIDEO WALKTHROUGH:
1. Stage your room images first (see above)
2. On the project page, click "Generate Video"
3. Select images to include in the tour
4. Download or share the video

PRICING:
- Free: $0/month — 100 free credits on signup (~5 free staged images), all staging modes, no credit card
- Starter: $4.99/month — 100 credits/month, ~50c per image
- Pro: $14.99/month — 500 credits/month, priority rendering, ~30c per image
- Business: $49.99/month — 2500 credits/month, commercial license, API access, ~20c per image
- All plans: 7-day money-back guarantee

KEY LINKS:
- Sign up free: https://kogflow.com
- Pricing: https://kogflow.com/pricing

COMMON QUESTIONS:
Q: How long does staging take? A: Usually 30-60 seconds per image.
Q: What file types? A: JPG and PNG, up to 10MB.
Q: Can I stage furnished rooms? A: Yes, Kogflow redesigns furnished rooms too.
Q: How many free images? A: ~5 free staged images on signup (100 credits).
Q: Is there a contract? A: No, month-to-month, cancel anytime.
Q: Commercial use? A: Business plan. Free/Starter/Pro are for personal/single-agent use.
Q: Bulk discounts? A: Business plan is best value at 20c/image.
`;

    try {
        const r = await fetch('https://kogflow.com/pricing', { signal: AbortSignal.timeout(5000) });
        if (r.ok) {
            const html = await r.text();
            const text = html.replace(/<script[\s\S]*?<\/script>/gi, '')
                .replace(/<style[\s\S]*?<\/style>/gi, '')
                .replace(/<[^>]+>/g, ' ')
                .replace(/\s+/g, ' ')
                .slice(0, 2000);
            _kbCache = staticKb + '\n\nLIVE PRICING PAGE:\n' + text;
        } else {
            _kbCache = staticKb;
        }
    } catch {
        _kbCache = staticKb;
    }
    _kbFetchedAt = Date.now();
    return _kbCache;
}

// ---------------------------------------------------------------------------
// AI reply generator using Claude Haiku
// ---------------------------------------------------------------------------

async function generateAiReply(params: {
    senderName: string;
    incomingBody: string;
    originalAddress: string;
    kb: string;
}): Promise<string | null> {
    const apiKey = process.env.INFERMATIC_API_KEY;
    if (!apiKey) return null;

    const baseUrl = process.env.INFERMATIC_BASE_URL || 'https://api.totalgpt.ai';
    const model = process.env.INFERMATIC_MODEL || 'Meta-Llama-3.3-70B-Instruct';

    const system = `You are a helpful assistant responding on behalf of Kogflow AI Virtual Staging (kogflow.com).
A real estate agent received a cold outreach email from Kogflow showing a free AI-staged version of their listing and has replied.
Respond helpfully, warmly, and concisely.

RULES:
- Be brief (under 150 words total)
- If they want to try it: guide them to kogflow.com with clear next steps
- If they ask how to do something: give numbered steps AND a direct link
- If they ask about pricing: quote exact figures, link to kogflow.com/pricing
- If they say unsubscribe / remove me / stop / not interested: confirm removal politely
- Never invent features or pricing not in the knowledge base
- End every reply with exactly: — Minh\nKogflow — kogflow.com
- Plain text only, no markdown

KNOWLEDGE BASE:
${params.kb}`;

    const userMsg = `Agent name: ${params.senderName || 'the agent'}
Original listing: ${params.originalAddress}
Their reply: "${params.incomingBody.slice(0, 1500)}"

Write the reply email body only.`;

    try {
        const res = await fetch(`${baseUrl}/v1/chat/completions`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model,
                max_tokens: 400,
                messages: [
                    { role: 'system', content: system },
                    { role: 'user', content: userMsg },
                ],
            }),
        });
        if (!res.ok) return null;
        const data = await res.json();
        return data.choices?.[0]?.message?.content ?? null;
    } catch {
        return null;
    }
}

// ---------------------------------------------------------------------------
// Decode Gmail base64url message body to plain text
// ---------------------------------------------------------------------------

function decodeGmailBody(payload: any): string {
    const getBody = (p: any): string => {
        if (p.body?.data) return Buffer.from(p.body.data, 'base64').toString('utf8');
        if (p.parts) {
            const plain = p.parts.find((x: any) => x.mimeType === 'text/plain');
            if (plain) return getBody(plain);
            const html = p.parts.find((x: any) => x.mimeType === 'text/html');
            if (html) return getBody(html).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
            for (const part of p.parts) { const b = getBody(part); if (b) return b; }
        }
        return '';
    };
    return getBody(payload).trim();
}

// ---------------------------------------------------------------------------
// Check Gmail for replies to outreach emails and auto-respond with AI
// ---------------------------------------------------------------------------

export async function checkAndReplyToOutreach(): Promise<{ checked: number; replied: number; debug: string[] }> {
    const debug: string[] = [];
    let checked = 0;
    let replied = 0;

    if (!GMAIL_CLIENT_ID || !GMAIL_CLIENT_SECRET || !GMAIL_REFRESH_TOKEN) {
        return { checked: 0, replied: 0, debug: ['Gmail credentials not configured'] };
    }

    try {
        const accessToken = await getGmailAccessToken();
        const supabase = createClient(supabaseUrl, supabaseKey);
        const kb = await getKogflowKnowledgeBase();
        let messageIds: string[] = [];

        // Strategy 1: Gmail label search
        const labelSearch = await fetch(
            `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent('in:inbox is:unread label:"Kogflow Outreach"')}&maxResults=20`,
            { headers: { 'Authorization': `Bearer ${accessToken}` } }
        );
        if (labelSearch.ok) {
            const data = await labelSearch.json();
            messageIds = (data.messages || []).map((m: any) => m.id);
            debug.push(`Label search: ${messageIds.length} unread replies`);
        }

        // Strategy 2: fallback — scan known thread IDs from DB
        if (messageIds.length === 0) {
            const { data: leads } = await supabase
                .from('outreach_leads')
                .select('id, gmail_thread_id, address')
                .eq('status', 'emailed')
                .not('gmail_thread_id', 'is', null)
                .limit(100);

            for (const lead of (leads || [])) {
                const tRes = await fetch(
                    `https://gmail.googleapis.com/gmail/v1/users/me/threads/${lead.gmail_thread_id}?format=metadata&metadataHeaders=From`,
                    { headers: { 'Authorization': `Bearer ${accessToken}` } }
                );
                if (!tRes.ok) continue;
                const thread = await tRes.json();
                for (const msg of (thread.messages || []).slice(1)) {
                    const from = msg.payload?.headers?.find((h: any) => h.name === 'From')?.value || '';
                    if (!from.toLowerCase().includes('kogflow.media')) messageIds.push(msg.id);
                }
            }
            if (messageIds.length > 0) debug.push(`Thread scan: ${messageIds.length} potential replies`);
        }

        if (messageIds.length === 0) {
            debug.push('No new replies found');
            return { checked: 0, replied: 0, debug };
        }

        for (const msgId of messageIds) {
            const { data: existing } = await supabase
                .from('outreach_replies').select('id').eq('message_id', msgId).single();
            if (existing) continue;

            const msgRes = await fetch(
                `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msgId}?format=full`,
                { headers: { 'Authorization': `Bearer ${accessToken}` } }
            );
            if (!msgRes.ok) continue;
            const msg = await msgRes.json();

            const hdrs: any[] = msg.payload?.headers || [];
            const fromHeader = hdrs.find((h: any) => h.name === 'From')?.value || '';
            const subjectHeader = hdrs.find((h: any) => h.name === 'Subject')?.value || '';
            const threadId = msg.threadId;

            if (fromHeader.toLowerCase().includes('kogflow.media')) continue;

            const m = fromHeader.match(/^(.+?)\s*<(.+?)>$/) || [null, fromHeader, fromHeader];
            const senderName = (m[1] || '').replace(/"/g, '').trim();
            const senderEmail = (m[2] || fromHeader).trim();
            const incomingBody = decodeGmailBody(msg.payload);
            if (!incomingBody || incomingBody.length < 3) continue;

            checked++;

            const isUnsub = /\bunsubscribe\b|\bremove me\b|\bnot interested\b|\bopt.?out\b|\bstop emailing\b/i.test(incomingBody);

            const { data: lead } = await supabase
                .from('outreach_leads').select('id, address').eq('gmail_thread_id', threadId).single();

            const aiDraft = isUnsub
                ? `Hi ${senderName || 'there'},\n\nAbsolutely — I've removed you from our list. You won't hear from us again. Sorry for any inconvenience and best of luck with your listings!\n\n— Minh\nKogflow — kogflow.com`
                : await generateAiReply({ senderName, incomingBody, originalAddress: lead?.address || 'your listing', kb });

            await supabase.from('outreach_replies').insert({
                lead_id: lead?.id ?? null,
                thread_id: threadId,
                message_id: msgId,
                sender_email: senderEmail,
                sender_name: senderName,
                incoming_subject: subjectHeader,
                incoming_body: incomingBody.slice(0, 5000),
                ai_draft: aiDraft,
                unsubscribe: isUnsub,
            });

            if (aiDraft) {
                const replyRaw = [
                    `From: Kogflow <kogflow.media@gmail.com>`,
                    `To: ${senderEmail}`,
                    `Subject: Re: ${subjectHeader.replace(/^Re:\s*/i, '')}`,
                    `In-Reply-To: ${msgId}`,
                    `References: ${msgId}`,
                    `MIME-Version: 1.0`,
                    `Content-Type: text/plain; charset=utf-8`,
                    ``,
                    aiDraft,
                ].join('\r\n');

                const encoded = Buffer.from(replyRaw).toString('base64')
                    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

                const replyRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ raw: encoded, threadId }),
                });

                if (replyRes.ok) {
                    await supabase.from('outreach_replies')
                        .update({ ai_sent: true, sent_at: new Date().toISOString() })
                        .eq('message_id', msgId);
                    replied++;
                    debug.push(`AI replied to ${senderEmail} (${isUnsub ? 'unsubscribe' : 'question'})`);
                } else {
                    debug.push(`Reply send failed for ${senderEmail}: ${replyRes.status}`);
                }
            }

            await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${msgId}/modify`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ removeLabelIds: ['UNREAD'] }),
            }).catch(() => {});
        }

        return { checked, replied, debug };
    } catch (err: any) {
        return { checked, replied, debug: [...debug, `checkAndReply error: ${err.message}`] };
    }
}

// ---------------------------------------------------------------------------
// Fetch outreach replies for admin review
// ---------------------------------------------------------------------------

export async function getOutreachReplies(opts: { limit?: number; unreviewedOnly?: boolean } = {}): Promise<{
    replies: Array<{
        id: string; sender_email: string; sender_name: string; incoming_subject: string;
        incoming_body: string; ai_draft: string | null; ai_sent: boolean; sent_at: string | null;
        reviewed: boolean; unsubscribe: boolean; created_at: string; address: string | null;
    }>;
}> {
    const supabase = createClient(supabaseUrl, supabaseKey);
    let query = supabase
        .from('outreach_replies')
        .select('id, sender_email, sender_name, incoming_subject, incoming_body, ai_draft, ai_sent, sent_at, reviewed, unsubscribe, created_at, outreach_leads(address)')
        .order('created_at', { ascending: false })
        .limit(opts.limit ?? 100);
    if (opts.unreviewedOnly) query = query.eq('reviewed', false);
    const { data } = await query;
    return {
        replies: (data || []).map((r: any) => ({ ...r, address: r.outreach_leads?.address ?? null })),
    };
}

export async function markReplyReviewed(replyId: string): Promise<void> {
    const supabase = createClient(supabaseUrl, supabaseKey);
    await supabase.from('outreach_replies').update({ reviewed: true }).eq('id', replyId);
}
