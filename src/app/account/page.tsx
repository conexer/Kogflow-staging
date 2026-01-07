'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Sparkles, CreditCard, History as HistoryIcon, LogOut, ExternalLink, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

export default function AccountPage() {
    const { user, signOut, loading: authLoading } = useAuth();
    const router = useRouter();
    const [profile, setProfile] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [portalLoading, setPortalLoading] = useState(false);

    useEffect(() => {
        // Wait for auth to finish loading
        if (authLoading) return;

        if (!user) {
            router.push('/login');
            return;
        }

        async function loadProfile() {
            try {
                if (!user) return;
                console.log('Loading profile for user:', user.id);

                const response = await fetch(`/api/profile?userId=${user.id}`);
                if (!response.ok) {
                    throw new Error('Failed to fetch profile');
                }

                const data = await response.json();
                console.log('Profile loaded:', data);
                setProfile(data);
                setLoading(false);
            } catch (error) {
                console.error('Failed to load profile:', error);
                toast.error('Failed to load account information');
                setLoading(false);
            }
        }

        loadProfile();
    }, [user, router, authLoading]);

    const handleManageSubscription = async () => {
        if (!profile?.stripe_customer_id) {
            toast.error('No subscription found');
            return;
        }

        setPortalLoading(true);

        try {
            const response = await fetch('/api/stripe/portal', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ customerId: profile.stripe_customer_id }),
            });

            const data = await response.json();

            if (response.ok && data.url) {
                window.location.href = data.url;
            } else {
                toast.error(data.error || 'Failed to open billing portal');
                setPortalLoading(false);
            }
        } catch (error) {
            toast.error('Something went wrong');
            setPortalLoading(false);
        }
    };

    const handleSignOut = async () => {
        await signOut();
        router.push('/');
    };

    if (authLoading || loading) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
        );
    }

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

            <main className="flex-1 w-full max-w-4xl mx-auto px-4 py-12">
                <div className="space-y-8">
                    {/* Header */}
                    <div>
                        <h1 className="text-3xl font-bold">Account Settings</h1>
                        <p className="text-muted-foreground mt-2">{user?.email}</p>
                    </div>

                    {/* Subscription Info */}
                    <div className="rounded-xl border border-border bg-card p-6 space-y-4">
                        <div className="flex items-center justify-between">
                            <h2 className="text-xl font-semibold flex items-center gap-2">
                                <CreditCard className="w-5 h-5 text-primary" />
                                Subscription
                            </h2>
                            {profile?.stripe_customer_id && (
                                <button
                                    onClick={handleManageSubscription}
                                    disabled={portalLoading}
                                    className="flex items-center gap-2 text-sm text-primary hover:underline disabled:opacity-50"
                                >
                                    {portalLoading ? 'Loading...' : 'Manage Subscription'}
                                    <ExternalLink className="w-4 h-4" />
                                </button>
                            )}
                        </div>

                        <div className="grid gap-4">
                            <div>
                                <p className="text-sm text-muted-foreground">Current Plan</p>
                                <p className="text-2xl font-bold capitalize">{profile?.subscription_tier || 'Free'}</p>
                            </div>

                            <div>
                                <p className="text-sm text-muted-foreground">Credits Remaining</p>
                                <p className="text-2xl font-bold">{profile?.credits || 0}</p>
                                {profile?.subscription_tier === 'free' && (
                                    <p className="text-xs text-muted-foreground mt-1">
                                        Resets daily at midnight
                                    </p>
                                )}
                            </div>

                            <Link
                                href="/pricing"
                                className="inline-flex items-center justify-center px-4 py-2 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 transition-colors"
                            >
                                {profile?.subscription_tier === 'free' ? 'Upgrade Plan' : 'Change Plan'}
                            </Link>
                        </div>
                    </div>

                    {/* Quick Links */}
                    <div className="rounded-xl border border-border bg-card p-6 space-y-4">
                        <h2 className="text-xl font-semibold">Quick Links</h2>

                        <div className="space-y-2">
                            <Link
                                href="/history"
                                className="flex items-center gap-3 p-3 rounded-lg hover:bg-muted transition-colors"
                            >
                                <HistoryIcon className="w-5 h-5 text-muted-foreground" />
                                <div>
                                    <p className="font-medium">Generation History</p>
                                    <p className="text-sm text-muted-foreground">View all your past stagings</p>
                                </div>
                            </Link>

                            <Link
                                href="/pricing"
                                className="flex items-center gap-3 p-3 rounded-lg hover:bg-muted transition-colors"
                            >
                                <CreditCard className="w-5 h-5 text-muted-foreground" />
                                <div>
                                    <p className="font-medium">Pricing Plans</p>
                                    <p className="text-sm text-muted-foreground">View and change your plan</p>
                                </div>
                            </Link>
                        </div>
                    </div>

                    {/* Danger Zone */}
                    <div className="rounded-xl border border-destructive/50 bg-destructive/5 p-6 space-y-4">
                        <h2 className="text-xl font-semibold text-destructive">Danger Zone</h2>

                        <button
                            onClick={handleSignOut}
                            className="flex items-center gap-2 px-4 py-2 bg-destructive text-destructive-foreground rounded-lg font-medium hover:bg-destructive/90 transition-colors"
                        >
                            <LogOut className="w-4 h-4" />
                            Sign Out
                        </button>
                    </div>
                </div>
            </main>

            <footer className="py-8 border-t border-border/40 text-center text-sm text-muted-foreground">
                <p>© 2026 Kogflow. All rights reserved.</p>
            </footer>
        </div>
    );
}
