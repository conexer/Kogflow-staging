'use server';

import Stripe from 'stripe';

// Lazy initialize Stripe only when needed
function getStripe() {
    const apiKey = process.env.STRIPE_SECRET_KEY;
    if (!apiKey) {
        throw new Error('STRIPE_SECRET_KEY is not configured');
    }
    return new Stripe(apiKey, {
        apiVersion: '2025-01-27.acacia' as any,
        typescript: true,
    });
}

interface CreateCheckoutParams {
    priceId: string;
    userId: string;
    userEmail: string;
}

export async function createCheckoutSession({
    priceId,
    userId,
    userEmail,
}: CreateCheckoutParams) {
    try {
        if (!priceId) {
            console.error('No price ID provided');
            return { error: 'Price ID is missing. Please contact support.' };
        }

        if (!process.env.STRIPE_SECRET_KEY) {
            console.error('STRIPE_SECRET_KEY is not set');
            return { error: 'Payment system is not configured. Please contact support.' };
        }

        console.log('Creating checkout session for price:', priceId);

        const stripe = getStripe();

        const session = await stripe.checkout.sessions.create({
            mode: 'subscription',
            payment_method_types: ['card'],
            line_items: [
                {
                    price: priceId,
                    quantity: 1,
                },
            ],
            success_url: `${process.env.NEXT_PUBLIC_APP_URL || 'https://kogflow.vercel.app'}/account?success=true`,
            cancel_url: `${process.env.NEXT_PUBLIC_APP_URL || 'https://kogflow.vercel.app'}/pricing?canceled=true`,
            customer_email: userEmail,
            client_reference_id: userId,
            metadata: {
                userId,
            },
        });

        console.log('Checkout session created:', session.id);
        return { url: session.url };
    } catch (error: any) {
        console.error('Stripe checkout error:', error);
        return { error: error.message || 'Failed to create checkout session' };
    }
}

export async function createPortalSession(customerId: string) {
    try {
        const stripe = getStripe();
        const session = await stripe.billingPortal.sessions.create({
            customer: customerId,
            return_url: `${process.env.NEXT_PUBLIC_APP_URL || 'https://kogflow.vercel.app'}/account`,
        });

        return { url: session.url };
    } catch (error: any) {
        console.error('Stripe portal error:', error);
        return { error: error.message };
    }
}

// Price IDs will be set in env vars after creating products in Stripe Dashboard
export const PRICE_IDS = {
    starter: process.env.NEXT_PUBLIC_STRIPE_PRICE_ID_STARTER || '',
    pro: process.env.NEXT_PUBLIC_STRIPE_PRICE_ID_PRO || '',
    business: process.env.NEXT_PUBLIC_STRIPE_PRICE_ID_BUSINESS || '',
};

// Log if price IDs are missing (for debugging)
if (typeof window === 'undefined') {
    console.log('Stripe Price IDs loaded:', {
        starter: PRICE_IDS.starter ? 'SET' : 'MISSING',
        pro: PRICE_IDS.pro ? 'SET' : 'MISSING',
        business: PRICE_IDS.business ? 'SET' : 'MISSING',
    });
}
