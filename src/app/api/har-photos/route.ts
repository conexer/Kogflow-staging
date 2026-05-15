import { NextResponse } from 'next/server';
import { detectRoom } from '@/app/actions/outreach';

const ZYTE_API_KEY = process.env.ZYTE_API_KEY!;

async function getHarPhotos(propertyUrl: string, max = 10): Promise<string[]> {
    const res = await fetch('https://api.zyte.com/v1/extract', {
        method: 'POST',
        headers: {
            'Authorization': `Basic ${Buffer.from(`${ZYTE_API_KEY}:`).toString('base64')}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ url: propertyUrl, browserHtml: true, geolocation: 'US' }),
    });
    if (!res.ok) return [];
    const data = await res.json();
    const html: string = data.browserHtml || '';
    const urls = [...new Set(
        [...html.matchAll(/https:\/\/mediahar\.harstatic\.com\/[^"'\s]+\/lr\/[^"'\s]+\.jpeg/g)]
            .map(m => m[0])
    )];
    return urls.slice(0, max);
}

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const listingUrl = searchParams.get('url');
    const testMode = searchParams.get('test') === '1'; // if test=1, run moondream on each photo
    if (!listingUrl) return NextResponse.json({ error: 'Provide ?url=' }, { status: 400 });

    const photos = await getHarPhotos(listingUrl, 10);

    if (!testMode) {
        return NextResponse.json({ count: photos.length, photos });
    }

    // Run detectRoom on each photo (skipping index 0 like the pipeline does)
    const results = [];
    for (let i = 0; i < photos.length; i++) {
        const photo = photos[i];
        if (i === 0) {
            results.push({ index: i, url: photo, skipped: true, reason: 'index 0 always exterior' });
            continue;
        }
        const r = await detectRoom(photo);
        results.push({
            index: i,
            url: photo,
            isStageable: r.isStageable,
            isEmpty: r.isEmpty,
            isExterior: r.isExterior,
            isInterior: r.isInterior,
            roomType: r.roomType,
            error: r.error,
        });
    }

    return NextResponse.json({ listingUrl, count: photos.length, results });
}
