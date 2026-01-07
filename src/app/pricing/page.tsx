'use client';

import { useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Sparkles, Check } from 'lucide-react';
import { toast } from 'sonner';

const plans = [
    {
        name: 'Free',
        price: '$0',
        period: 'forever',
        description: 'Perfect for trying out Kogflow',
        features: [
            '2 generations per day',
            'Basic staging modes',
            'All interior styles',
            'HD downloads',
        ],
        cta: 'Current Plan',
        tier: 'free',
        popular: false,
    },
    {
        name: 'Starter',
        price: '$4.99',
        period: 'per month',
        description: 'For hobbyists exploring AI creativity',
        features: [
            '10 credits per month',
            '10 high-quality images',
            'All staging modes',
            'All interior styles',
            'HD downloads',
            'Priority processing',
        ],
        cta: 'Get Started',
        priceId: process.env.NEXT_PUBLIC_STRIPE_PRICE_ID_STARTER || '',
        tier: 'starter',
        popular: false,
    },
    {
        name: 'Pro',
        price: '$14.99',
        period: 'per month',
        description: 'For consistent creators who need speed',
        features: [
            '50 credits per month',
            'Priority rendering',
            'Lower cost per image',
            'All staging modes',
            'All interior styles',
            'HD downloads',
            'Email support',
        ],
        cta: 'Go Pro',
        priceId: process.env.NEXT_PUBLIC_STRIPE_PRICE_ID_PRO || '',
        tier: 'pro',
        popular: true,
    },
    {
        name: 'Business',
        price: '$49.99',
        period: 'per month',
        description: 'The ultimate powerhouse for brands',
        features: [
            '250 credits per month',
            'Commercial usage license',
            'API access',
            'Highest priority',
            'All staging modes',
            'All interior styles',
            'HD downloads',
            'Dedicated support',
        ],
        cta: 'Scale Up',
        priceId: process.env.NEXT_PUBLIC_STRIPE_PRICE_ID_BUSINESS || '',
        tier: 'business',
        popular: false,
    },
];

export default function PricingPage() {
    const { user } = useAuth();
    const router = useRouter();
    const [loading, setLoading] = useState<string | null>(null);

    const handleSubscribe = async (priceId: string, tier: string) => {
        if (!user) {
            toast.error('Please sign in to subscribe');
            router.push('/login');
            return;
        }

        if (!priceId) {
            toast.error('Price ID not configured. Please contact support.');
            return;
        }

        setLoading(tier);

        try {
            const response = await fetch('/api/checkout', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    priceId,
                    userId: user.id,
                    userEmail: user.email,
                }),
            });

            const data = await response.json();

            if (!response.ok) {
                toast.error(`Payment error: ${data.error}`);
                setLoading(null);
            } else if (data.url) {
                window.location.href = data.url;
            } else {
                toast.error('Failed to create checkout session. Please try again.');
                setLoading(null);
            }
        } catch (err: any) {
            console.error('Checkout error:', err);
            toast.error('Something went wrong. Please try again.');
            setLoading(null);
        }
    };

    return (
        <div className="min-h-screen flex flex-col font-sans">
            {/* Navbar */}
            <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/80 backdrop-blur-md">
                <div className="container flex h-16 items-center justify-between px-4">
                    <Link href="/" className="flex items-center gap-2 font-bold text-xl tracking-tighter">
                        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center">
                            <Sparkles className="w-5 h-5 text-white" />
                        </div>
                        <span>Kogflow</span>
                    </Link>

                    <nav className="flex items-center gap-4">
                        <Link href="/" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
                            Back to App
                        </Link>
                    </nav>
                </div>
            </header>

            <main className="flex-1 w-full max-w-7xl mx-auto px-4 py-16">
                {/* Header */}
                <div className="text-center space-y-4 mb-16">
                    <h1 className="text-4xl md:text-6xl font-extrabold tracking-tight">
                        Choose Your Plan
                    </h1>
                    <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
                        Start for free, upgrade when you need more. All plans include full access to our AI staging technology.
                    </p>
                </div>

                {/* Pricing Cards */}
                <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
                    {plans.map((plan) => (
                        <div
                            key={plan.name}
                            className={`relative rounded-2xl border ${plan.popular
                                ? 'border-primary shadow-lg shadow-primary/20'
                                : 'border-border'
                                } bg-card p-8 flex flex-col`}
                        >
                            {plan.popular && (
                                <div className="absolute -top-4 left-1/2 -translate-x-1/2 px-4 py-1 bg-primary text-primary-foreground text-sm font-bold rounded-full">
                                    Most Popular
                                </div>
                            )}

                            <div className="flex-1">
                                <h3 className="text-2xl font-bold mb-2">{plan.name}</h3>
                                <p className="text-sm text-muted-foreground mb-4">{plan.description}</p>

                                <div className="mb-6">
                                    <span className="text-4xl font-extrabold">{plan.price}</span>
                                    <span className="text-muted-foreground ml-2">{plan.period}</span>
                                </div>

                                <ul className="space-y-3 mb-8">
                                    {plan.features.map((feature) => (
                                        <li key={feature} className="flex items-start gap-2 text-sm">
                                            <Check className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
                                            <span>{feature}</span>
                                        </li>
                                    ))}
                                </ul>
                            </div>

                            <button
                                onClick={() => plan.priceId && handleSubscribe(plan.priceId, plan.tier)}
                                disabled={!plan.priceId || loading === plan.tier}
                                className={`w-full py-3 px-4 rounded-lg font-medium transition-colors ${plan.popular
                                    ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                                    : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
                                    } disabled:opacity-50 disabled:cursor-not-allowed`}
                            >
                                {loading === plan.tier ? 'Loading...' : plan.cta}
                            </button>
                        </div>
                    ))}
                </div>

                {/* FAQ or additional info */}
                <div className="mt-20 text-center">
                    <p className="text-sm text-muted-foreground">
                        All plans include a 7-day money-back guarantee. No questions asked.
                    </p>
                </div>
            </main>

            <footer className="py-8 border-t border-border/40 text-center text-sm text-muted-foreground">
                <p>© 2026 Kogflow. All rights reserved.</p>
            </footer>
        </div>
    );
}
