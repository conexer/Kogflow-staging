'use server';

export async function getPriceIds() {
    return {
        starter: process.env.NEXT_PUBLIC_STRIPE_PRICE_ID_STARTER || '',
        pro: process.env.NEXT_PUBLIC_STRIPE_PRICE_ID_PRO || '',
        business: process.env.NEXT_PUBLIC_STRIPE_PRICE_ID_BUSINESS || '',
    };
}
