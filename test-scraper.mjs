// Run with: node test-scraper.mjs
import { readFileSync } from 'fs';

// Load env
const env = readFileSync('.env.local', 'utf8');
const ZYTE_API_KEY = env.match(/ZYTE_API_KEY=(.+)/)?.[1]?.trim();

const SITES = [
    {
        name: 'homes.com',
        url: 'https://www.homes.com/homes-for-sale/phoenix-az/price-200000-600000/',
    },
    {
        name: 'homepath.fanniemae.com',
        url: 'https://homepath.fanniemae.com/listings',
    },
    {
        name: 'har.com',
        url: 'https://www.har.com/search/dosearch?type=residential&minprice=200000&maxprice=600000&status=A&city=Houston',
    },
];

async function testSite(site) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Testing: ${site.name}`);
    console.log(`URL: ${site.url}`);
    console.log('='.repeat(60));

    const res = await fetch('https://api.zyte.com/v1/extract', {
        method: 'POST',
        headers: {
            'Authorization': `Basic ${Buffer.from(`${ZYTE_API_KEY}:`).toString('base64')}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ url: site.url, browserHtml: true }),
    });

    if (!res.ok) {
        console.log(`ZYTE ERROR ${res.status}: ${await res.text()}`);
        return;
    }

    const data = await res.json();
    const html = data.browserHtml || '';

    console.log(`HTML length: ${html.length} chars (${(html.length/1024).toFixed(1)}KB)`);
    console.log(`Has <body>: ${html.includes('<body')}`);
    console.log(`Body content size: ${html.length > 5000 ? 'LARGE (likely rendered)' : 'SMALL (likely blocked)'}`);
    console.log(`Has __NEXT_DATA__: ${html.includes('__NEXT_DATA__')}`);
    console.log(`Has JSON-LD: ${html.includes('application/ld+json')}`);
    console.log(`Has __NUXT__: ${html.includes('__NUXT__')}`);
    console.log(`Has window.__data: ${html.includes('window.__data')}`);

    // Count patterns
    const streetAddresses = [...html.matchAll(/"streetAddress"\s*:\s*"([^"]+)"/g)].map(m => m[1]);
    const prices = [...html.matchAll(/"(?:price|listPrice|listingPrice)"\s*:\s*(\d+)/g)].map(m => m[1]);
    const photos = [...html.matchAll(/https:\/\/[^"'\s]+\.(?:jpg|jpeg|png|webp)(?:\?[^"'\s]*)?/g)].map(m => m[0]);
    const emails = [...html.matchAll(/[\w.-]+@[\w.-]+\.\w+/g)].map(m => m[0]);
    const phones = [...html.matchAll(/\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g)].map(m => m[0]);

    console.log(`\nData found:`);
    console.log(`  streetAddress matches: ${streetAddresses.length}`);
    console.log(`  price matches: ${prices.length}`);
    console.log(`  photo URLs: ${photos.length}`);
    console.log(`  emails: ${emails.length}`);
    console.log(`  phones: ${phones.length}`);

    if (streetAddresses.length > 0) {
        console.log(`\nSample addresses:`);
        streetAddresses.slice(0, 5).forEach(a => console.log(`  - ${a}`));
    }
    if (emails.length > 0) {
        console.log(`\nSample emails:`);
        emails.slice(0, 5).forEach(e => console.log(`  - ${e}`));
    }
    if (photos.length > 0) {
        console.log(`\nSample photos:`);
        photos.slice(0, 3).forEach(p => console.log(`  - ${p}`));
    }

    // Show body snippet
    const bodyStart = html.indexOf('<body');
    const snippet = bodyStart > -1 ? html.slice(bodyStart, bodyStart + 2000) : html.slice(0, 2000);
    console.log(`\n--- HTML BODY SNIPPET ---`);
    console.log(snippet);

    // If Next.js, show __NEXT_DATA__ structure
    if (html.includes('__NEXT_DATA__')) {
        const match = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
        if (match) {
            try {
                const nextData = JSON.parse(match[1]);
                console.log(`\n--- __NEXT_DATA__ top-level keys ---`);
                console.log(JSON.stringify(Object.keys(nextData), null, 2));
                if (nextData?.props?.pageProps) {
                    console.log(`\n--- pageProps keys ---`);
                    console.log(JSON.stringify(Object.keys(nextData.props.pageProps), null, 2));
                }
            } catch(e) {
                console.log('Could not parse __NEXT_DATA__');
            }
        }
    }

    // Save full HTML to file for inspection
    const { writeFileSync } = await import('fs');
    writeFileSync(`test-html-${site.name.replace(/\./g, '-')}.html`, html);
    console.log(`\nFull HTML saved to: test-html-${site.name.replace(/\./g, '-')}.html`);
}

console.log('Zyte API Key found:', ZYTE_API_KEY ? `${ZYTE_API_KEY.slice(0,8)}...` : 'MISSING');

for (const site of SITES) {
    await testSite(site);
}
console.log('\n\nDone!');
