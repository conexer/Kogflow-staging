'use client';

import { useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

export default function SyncSubscriptionPage() {
    const { user } = useAuth();
    const router = useRouter();
    const [loading, setLoading] = useState(false);

    const handleSync = async () => {
        if (!user) {
            toast.error('Please sign in first');
            return;
        }

        setLoading(true);

        try {
            const response = await fetch('/api/admin/sync-subscription', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId: user.id }),
            });

            const data = await response.json();

            if (response.ok) {
                toast.success(`Synced! Plan: ${data.tier}, Added ${data.creditsAdded} credits. Total: ${data.newCredits}`);
                setTimeout(() => router.push('/account'), 2000);
            } else {
                toast.error(data.error || 'Failed to sync subscription');
            }
        } catch (error) {
            toast.error('Something went wrong');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50">
            <div className="p-8 max-w-md bg-white rounded-lg shadow-lg">
                <h2 className="text-2xl font-bold mb-4">Sync Your Subscription</h2>
                <p className="text-sm text-gray-600 mb-6">
                    This will fetch your active Stripe subscription and update your account with the correct plan tier and credits.
                </p>
                <button
                    onClick={handleSync}
                    disabled={loading}
                    className="w-full py-3 px-4 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50"
                >
                    {loading ? 'Syncing...' : 'Sync Subscription Now'}
                </button>
            </div>
        </div>
    );
}
