import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';

export async function POST(req: NextRequest) {
    try {
        const { customerId } = await req.json();

        if (!customerId) {
            return NextResponse.json(
                { error: 'Customer ID required' },
                { status: 400 }
            );
        }

        const apiKey = process.env.STRIPE_SECRET_KEY;
        if (!apiKey) {
            return NextResponse.json(
                { error: 'Stripe not configured' },
                { status: 500 }
            );
        }

        const stripe = new Stripe(apiKey, {
            apiVersion: '2025-01-27.acacia' as any,
            typescript: true,
        });

        const session = await stripe.billingPortal.sessions.create({
            customer: customerId,
            return_url: `${process.env.NEXT_PUBLIC_APP_URL || 'https://kogflow.vercel.app'}/account`,
        });

        return NextResponse.json({ url: session.url });
    } catch (error: any) {
        console.error('Portal session error:', error);
        return NextResponse.json(
            { error: error.message || 'Failed to create portal session' },
            { status: 500 }
        );
    }
}
