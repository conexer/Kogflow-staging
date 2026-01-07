'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Sparkles, Check } from 'lucide-react';

const plans = [
    {
        name: 'Free',
        price: '$0',
        period: 'forever',
        features: ['2 generations per day', 'Basic staging modes'],
        tier: 'free',
    },
    {
        name: 'Starter',
        price: '$4.99',
        period: 'per month',
        features: ['100 generations', 'All features'],
        priceId: process.env.NEXT_PUBLIC_STRIPE_PRICE_ID_STARTER || '',
        tier: 'starter',
    },
    {
        name: 'Pro',
        price: '$14.99',
        period: 'per month',
        features: ['500 generations', 'Priority support'],
        priceId: process.env.NEXT_PUBLIC_STRIPE_PRICE_ID_PRO || '',
        tier: 'pro',
    },
];

export default function TestPricingPage() {
    const [loading, setLoading] = useState<string | null>(null);

    const handleClick = async (priceId: string) => {
        setLoading(priceId);
        alert(`Would checkout with: ${priceId}`);
        setLoading(null);
    };

    return (
        <div className="min-h-screen p-8">
            <h1 className="text-4xl font-bold mb-8">Pricing Test</h1>
            <div className="grid md:grid-cols-3 gap-6">
                {plans.map((plan) => (
                    <div key={plan.name} className="border rounded-lg p-6">
                        <h3 className="text-2xl font-bold">{plan.name}</h3>
                        <p className="text-3xl my-4">{plan.price}</p>
                        <button
                            onClick={() => plan.priceId && handleClick(plan.priceId)}
                            disabled={!plan.priceId || loading === plan.tier}
                            className="w-full py-2 px-4 bg-blue-600 text-white rounded disabled:opacity-50"
                        >
                            {loading === plan.tier ? 'Loading...' : `Select ${plan.name}`}
                        </button>
                    </div>
                ))}
            </div>
            <Link href="/" className="mt-8 inline-block text-blue-600">Back to Home</Link>
        </div>
    );
}
