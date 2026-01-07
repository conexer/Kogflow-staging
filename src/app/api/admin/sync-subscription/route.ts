import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

export async function POST(req: NextRequest) {
    try {
        const { userId } = await req.json();

        if (!userId) {
            return NextResponse.json({ error: 'Missing userId' }, { status: 400 });
        }

        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
        const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
        const stripeKey = process.env.STRIPE_SECRET_KEY;

        if (!supabaseUrl || !supabaseKey || !stripeKey) {
            return NextResponse.json({ error: 'Server not configured' }, { status: 500 });
        }

        const supabase = createClient(supabaseUrl, supabaseKey);
        const stripe = new Stripe(stripeKey, {
            apiVersion: '2025-01-27.acacia' as any,
            typescript: true,
        });

        // Get user's email and current data
        const { data: user, error: userError } = await supabase
            .from('users')
            .select('email, stripe_customer_id, credits')
            .eq('id', userId)
            .single();

        if (userError || !user) {
            return NextResponse.json({ error: 'User not found' }, { status: 404 });
        }

        let customerId = user.stripe_customer_id;

        // If no customer ID, search by email
        if (!customerId) {
            const customers = await stripe.customers.list({
                email: user.email,
                limit: 1,
            });

            if (customers.data.length > 0) {
                customerId = customers.data[0].id;
            } else {
                return NextResponse.json({
                    error: 'No Stripe customer found. Please subscribe to a plan first.'
                }, { status: 404 });
            }
        }

        // Get active subscriptions
        const subscriptions = await stripe.subscriptions.list({
            customer: customerId,
            status: 'active',
            limit: 1,
        });

        if (subscriptions.data.length === 0) {
            return NextResponse.json({
                error: 'No active subscription found'
            }, { status: 404 });
        }

        const subscription = subscriptions.data[0];
        const priceId = subscription.items.data[0]?.price.id;

        // Determine tier and credits
        let tier = 'free';
        let creditsToAdd = 0;

        if (priceId === process.env.NEXT_PUBLIC_STRIPE_PRICE_ID_STARTER) {
            tier = 'starter';
            creditsToAdd = 10;
        } else if (priceId === process.env.NEXT_PUBLIC_STRIPE_PRICE_ID_PRO) {
            tier = 'pro';
            creditsToAdd = 50;
        } else if (priceId === process.env.NEXT_PUBLIC_STRIPE_PRICE_ID_BUSINESS) {
            tier = 'business';
            creditsToAdd = 250;
        }

        const currentCredits = user.credits || 0;
        const newCredits = currentCredits + creditsToAdd;

        // Update user
        const { error: updateError } = await supabase
            .from('users')
            .update({
                subscription_tier: tier,
                stripe_customer_id: customerId,
                stripe_subscription_id: subscription.id,
                subscription_status: subscription.status,
                credits: newCredits,
            })
            .eq('id', userId);

        if (updateError) {
            return NextResponse.json({ error: 'Failed to update user' }, { status: 500 });
        }

        return NextResponse.json({
            success: true,
            tier,
            creditsAdded: creditsToAdd,
            newCredits,
            subscriptionId: subscription.id,
        });
    } catch (error: any) {
        console.error('Sync error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
