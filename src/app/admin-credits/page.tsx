'use client';

import { useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { toast } from 'sonner';

export default function AddCreditsButton() {
    const { user } = useAuth();
    const [loading, setLoading] = useState(false);

    const handleAddCredits = async () => {
        if (!user) {
            toast.error('Please sign in first');
            return;
        }

        setLoading(true);

        try {
            const response = await fetch('/api/admin/add-credits', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    userId: user.id,
                    creditsToAdd: 50, // Pro plan credits
                }),
            });

            const data = await response.json();

            if (response.ok) {
                toast.success(`Added 50 credits! New total: ${data.newCredits}`);
                // Reload page to show updated credits
                window.location.reload();
            } else {
                toast.error(data.error || 'Failed to add credits');
            }
        } catch (error) {
            toast.error('Something went wrong');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="p-8 max-w-md mx-auto mt-20">
            <h2 className="text-2xl font-bold mb-4">Manually Add Starter Plan Credits</h2>
            <p className="text-sm text-gray-600 mb-6">
                Click below to manually add 10 credits for your Starter plan subscription
            </p>
            <button
                onClick={handleAddCredits}
                disabled={loading}
                className="w-full py-3 px-4 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50"
            >
                {loading ? 'Adding Credits...' : 'Add 10 Credits Now'}
            </button>
        </div>
    );
}
