import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';

export async function POST(req: NextRequest) {
    try {
        const { priceId, userId, userEmail } = await req.json();

        if (!priceId || !userId || !userEmail) {
            return NextResponse.json(
                { error: 'Missing required fields' },
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

        return NextResponse.json({ url: session.url });
    } catch (error: any) {
        console.error('Stripe checkout error:', error);
        return NextResponse.json(
            { error: error.message || 'Failed to create checkout session' },
            { status: 500 }
        );
    }
}
