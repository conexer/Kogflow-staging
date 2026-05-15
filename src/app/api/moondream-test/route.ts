import { NextResponse } from 'next/server';

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const imageUrl = searchParams.get('url');
    if (!imageUrl) return NextResponse.json({ error: 'Provide ?url=' }, { status: 400 });

    const MOONDREAM_API_KEY = (process.env.MOONDREAM_API_KEY || '').trim();
    const moonHeaders = { 'X-Moondream-Auth': MOONDREAM_API_KEY, 'Content-Type': 'application/json' };

    const imageOrigin = new URL(imageUrl).origin;
    const imgRes = await fetch(imageUrl, {
        headers: {
            'Referer': imageOrigin,
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36',
            'Accept': 'image/*,*/*;q=0.8',
        },
    });
    if (!imgRes.ok) return NextResponse.json({ error: `Image fetch ${imgRes.status}` }, { status: 500 });

    const contentType = imgRes.headers.get('content-type') || 'image/jpeg';
    const buf = Buffer.from(await imgRes.arrayBuffer());
    const imageData = `data:${contentType};base64,${buf.toString('base64')}`;
    const imageDiag = { contentType, sizeKB: Math.round(buf.length / 1024), firstBytes: buf.slice(0, 4).toString('hex') };

    async function ask(question: string): Promise<{ answer: string; tokens: number }> {
        await new Promise(r => setTimeout(r, 500));
        const res = await fetch('https://api.moondream.ai/v1/query', {
            method: 'POST', headers: moonHeaders,
            body: JSON.stringify({ image_url: imageData, question, stream: false }),
        });
        const raw = await res.json();
        return {
            answer: (raw.answer || raw.result || '').toLowerCase().trim(),
            tokens: raw?.metrics?.input_tokens ?? 0,
        };
    }

    // Q1: Interior gate (positive presence — reliable for Moondream)
    const q1 = await ask('Is this photo taken inside a building, showing an indoor room with walls, floor, and ceiling visible? Answer only "yes" or "no".');
    // Q2: Furniture presence (presence-detection is reliable — "yes" = furnished = not empty)
    const q2 = await ask('Are there any objects, furniture, appliances, personal items, decorations, or belongings visible in this room? Answer only "yes" or "no".');
    // Q3: Floor plan rejection
    const q3 = await ask('Does this image show a 2D floor plan, architectural blueprint, or room diagram with labels or dimension lines? Answer only "yes" or "no".');
    // Q4: Foyer/stairway rejection
    const q4 = await ask('Does this image show a staircase, hallway, entryway, foyer, or corridor? Answer only "yes" or "no".');
    // Q5: Room type
    const q5 = await ask('What type of room is this? Answer with one of: bedroom, living room, kitchen, dining room, or bathroom.');

    const isInterior = q1.answer.startsWith('yes');
    const hasFurniture = q2.answer.startsWith('yes'); // yes = furnished (not empty)
    const isEmpty = !hasFurniture;
    const isFloorplan = q3.answer.startsWith('yes');
    const isFoyer = q4.answer.startsWith('yes');

    let verdict = 'REJECTED ✗';
    let rejectReason = '';
    if (!isInterior) rejectReason = 'exterior photo';
    else if (!isEmpty) rejectReason = 'furnished room';
    else if (isFloorplan) rejectReason = 'floor plan';
    else if (isFoyer) rejectReason = 'foyer/stairway';
    else verdict = 'STAGEABLE ✓';

    return NextResponse.json({
        imageUrl, imageDiag,
        Q1_interior: { answer: q1.answer, tokens: q1.tokens },
        Q2_furniture: { answer: q2.answer, tokens: q2.tokens, isEmpty },
        Q3_floorplan: { answer: q3.answer, tokens: q3.tokens },
        Q4_foyer: { answer: q4.answer, tokens: q4.tokens },
        Q5_type: { answer: q5.answer, tokens: q5.tokens },
        verdict,
        rejectReason: rejectReason || null,
    });
}
