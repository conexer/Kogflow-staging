import { NextResponse } from 'next/server';

export async function GET() {
    return NextResponse.json({
        starter: process.env.NEXT_PUBLIC_STRIPE_PRICE_ID_STARTER || '',
        pro: process.env.NEXT_PUBLIC_STRIPE_PRICE_ID_PRO || '',
        business: process.env.NEXT_PUBLIC_STRIPE_PRICE_ID_BUSINESS || '',
    });
}
