import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

// Lazy initialize Stripe only when needed
function getStripe() {
    const apiKey = process.env.STRIPE_SECRET_KEY;
    if (!apiKey) {
        throw new Error('STRIPE_SECRET_KEY is not set');
    }
    return new Stripe(apiKey, {
        apiVersion: '2025-01-27.acacia' as any,
        typescript: true,
    });
}

export async function POST(req: NextRequest) {
    const stripe = getStripe();
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET!;
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

    const body = await req.text();
    const signature = req.headers.get('stripe-signature')!;

    let event: Stripe.Event;

    try {
        event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
    } catch (err: any) {
        console.error(`Webhook signature verification failed: ${err.message}`);
        return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    try {
        switch (event.type) {
            case 'checkout.session.completed': {
                const session = event.data.object as Stripe.Checkout.Session;
                const userId = session.metadata?.userId || session.client_reference_id;

                if (userId && session.customer) {
                    await supabase
                        .from('users')
                        .update({
                            stripe_customer_id: session.customer as string,
                            stripe_subscription_id: session.subscription as string,
                        })
                        .eq('id', userId);
                }
                break;
            }

            case 'customer.subscription.created':
            case 'customer.subscription.updated': {
                const subscription = event.data.object as any;
                const customerId = subscription.customer as string;

                const priceId = subscription.items.data[0]?.price.id;
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

                // Get current credits
                const { data: currentUser } = await supabase
                    .from('users')
                    .select('credits')
                    .eq('stripe_customer_id', customerId)
                    .single();

                const currentCredits = currentUser?.credits || 0;

                await supabase
                    .from('users')
                    .update({
                        subscription_tier: tier,
                        subscription_status: subscription.status,
                        subscription_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
                        credits: currentCredits + creditsToAdd,
                    })
                    .eq('stripe_customer_id', customerId);

                console.log(`Subscription ${event.type}: Added ${creditsToAdd} credits to user with customer ${customerId}`);
                break;
            }

            case 'customer.subscription.deleted': {
                const subscription = event.data.object as any;
                const customerId = subscription.customer as string;

                await supabase
                    .from('users')
                    .update({
                        subscription_tier: 'free',
                        subscription_status: 'canceled',
                        credits: 2,
                    })
                    .eq('stripe_customer_id', customerId);
                break;
            }

            case 'invoice.payment_succeeded': {
                const invoice = event.data.object as any;
                const customerId = invoice.customer as string;

                // Get user's subscription to determine tier
                const { data: user } = await supabase
                    .from('users')
                    .select('subscription_tier, credits')
                    .eq('stripe_customer_id', customerId)
                    .single();

                let creditsToAdd = 0;
                if (user?.subscription_tier === 'starter') creditsToAdd = 10;
                else if (user?.subscription_tier === 'pro') creditsToAdd = 50;
                else if (user?.subscription_tier === 'business') creditsToAdd = 250;

                if (creditsToAdd > 0) {
                    const currentCredits = user?.credits || 0;
                    await supabase
                        .from('users')
                        .update({
                            credits: currentCredits + creditsToAdd,
                        })
                        .eq('stripe_customer_id', customerId);

                    console.log(`Payment succeeded: Added ${creditsToAdd} credits to user with customer ${customerId}`);
                }
                break;
            }

            default:
                console.log(`Unhandled event type: ${event.type}`);
        }

        return NextResponse.json({ received: true });
    } catch (error: any) {
        console.error('Webhook handler error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
