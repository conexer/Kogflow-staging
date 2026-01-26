'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import { getUserProfile } from '@/app/actions/credits';
import { Sparkles, History, CreditCard, User, Menu, X, LogOut, ChevronDown, Video, LayoutTemplate } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useRouter } from 'next/navigation';

export function Navbar() {
    const { user, signOut } = useAuth();
    const router = useRouter();
    const [userProfile, setUserProfile] = useState<any>(null);
    const [isMenuOpen, setIsMenuOpen] = useState(false);
    const [isProductsOpen, setIsProductsOpen] = useState(false);

    useEffect(() => {
        async function loadCredits() {
            if (user) {
                const profile = await getUserProfile(user.id);
                setUserProfile(profile);
            } else {
                // Fetch guest credits
                // Dynamic import to avoid server-action issues if needed, or just call direct
                const { getGuestCredits } = await import('@/app/actions/credits');
                const credits = await getGuestCredits();
                setUserProfile({ credits, subscription_tier: 'Guest' });
            }
        }
        loadCredits();
    }, [user]);

    const toggleMenu = () => setIsMenuOpen(!isMenuOpen);

    return (
        <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/80 backdrop-blur-md">
            <div className="container flex h-16 items-center justify-between px-4">
                {/* Logo */}
                <Link href="/" className="flex items-center gap-2 font-bold text-xl tracking-tighter">
                    <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center">
                        <Sparkles className="w-5 h-5 text-white" />
                    </div>
                    <span>Kogflow</span>
                </Link>

                {/* Desktop Navigation */}
                <nav className="hidden md:flex items-center gap-6">
                    {/* Products Dropdown */}
                    <div className="relative group">
                        <button className="flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors py-2">
                            <span>Products</span>
                            <ChevronDown className="w-4 h-4 transition-transform group-hover:rotate-180" />
                        </button>
                        <div className="absolute left-0 top-full mt-1 w-64 rounded-xl border border-border bg-card shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50 overflow-hidden">
                            <div className="p-2 space-y-1">
                                <Link href="/1-click-product-video" className="flex items-start gap-3 p-3 hover:bg-muted rounded-lg transition-colors group/item">
                                    <div className="mt-1 w-8 h-8 rounded-lg bg-violet-500/10 flex items-center justify-center text-violet-500 group-hover/item:bg-violet-500 group-hover/item:text-white transition-colors">
                                        <Video className="w-4 h-4" />
                                    </div>
                                    <div>
                                        <div className="font-semibold text-sm">1-Click Product Video</div>
                                        <div className="text-xs text-muted-foreground">Turn photos into viral videos</div>
                                    </div>
                                </Link>
                                <Link href="/" className="flex items-start gap-3 p-3 hover:bg-muted rounded-lg transition-colors group/item">
                                    <div className="mt-1 w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center text-blue-500 group-hover/item:bg-blue-500 group-hover/item:text-white transition-colors">
                                        <LayoutTemplate className="w-4 h-4" />
                                    </div>
                                    <div>
                                        <div className="font-semibold text-sm">Virtual Staging</div>
                                        <div className="text-xs text-muted-foreground">AIC-powered interior design</div>
                                    </div>
                                </Link>
                            </div>
                        </div>
                    </div>

                    <Link href="/history" className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
                        <History className="w-4 h-4" />
                        <span>History</span>
                    </Link>

                    <Link href="/pricing" className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
                        <CreditCard className="w-4 h-4" />
                        <span>Pricing</span>
                    </Link>

                    {user ? (
                        <div className="flex items-center gap-4 pl-6 border-l border-border/40">
                            <div className="flex flex-col items-end leading-none">
                                <span className="text-xs text-muted-foreground capitalize">{userProfile?.subscription_tier || 'Free'} Plan</span>
                                <span className="text-sm font-bold text-primary">{userProfile?.credits || 0} Credits</span>
                            </div>
                            <div className="relative group">
                                <button className="p-2 hover:bg-muted rounded-full transition-colors">
                                    <div className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center text-xs">
                                        <User className="w-4 h-4" />
                                    </div>
                                </button>
                                <div className="absolute right-0 top-full mt-2 w-48 rounded-lg border border-border bg-card shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50">
                                    <div className="p-2 space-y-1">
                                        <Link href="/account" className="block px-3 py-2 text-sm hover:bg-muted rounded transition-colors">Account</Link>
                                        <Link href="/pricing" className="block px-3 py-2 text-sm hover:bg-muted rounded transition-colors">Pricing</Link>
                                        <button onClick={() => signOut()} className="w-full text-left px-3 py-2 text-sm hover:bg-muted rounded transition-colors text-destructive">Sign Out</button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="flex items-center gap-3 pl-6 border-l border-border/40">
                            <div className="flex flex-col items-end leading-none mr-2">
                                <span className="text-xs text-muted-foreground">Guest</span>
                                <span className="text-sm font-bold text-primary">{userProfile?.credits !== undefined ? userProfile.credits : 2} Free Credits</span>
                            </div>
                            <Link href="/login" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
                                Log in
                            </Link>
                            <Link href="/signup" className="px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90 transition-colors">
                                Sign up
                            </Link>
                        </div>
                    )}
                </nav>

                {/* Mobile Menu Button */}
                <button
                    className="md:hidden p-2 text-muted-foreground hover:text-foreground"
                    onClick={toggleMenu}
                    aria-label="Toggle menu"
                >
                    {isMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
                </button>
            </div>

            {/* Mobile Navigation Dropdown */}
            {isMenuOpen && (
                <div className="md:hidden bg-background border-b border-border/40 animate-in slide-in-from-top-2">
                    <div className="container py-4 flex flex-col gap-4 px-4 overflow-y-auto max-h-[80vh]">
                        {/* Mobile Products Menu */}
                        <div className="space-y-2">
                            <button
                                onClick={() => setIsProductsOpen(!isProductsOpen)}
                                className="flex items-center justify-between w-full text-sm font-medium py-2 px-2 hover:bg-muted/50 rounded-md"
                            >
                                <span>Products</span>
                                <ChevronDown className={cn("w-4 h-4 transition-transform", isProductsOpen && "rotate-180")} />
                            </button>

                            {isProductsOpen && (
                                <div className="pl-4 space-y-1">
                                    <Link
                                        href="/1-click-product-video"
                                        onClick={() => setIsMenuOpen(false)}
                                        className="flex items-center gap-3 p-2 text-sm hover:bg-muted/50 rounded-md text-muted-foreground"
                                    >
                                        <Video className="w-4 h-4" />
                                        1-Click Product Video
                                    </Link>
                                    <Link
                                        href="/"
                                        onClick={() => setIsMenuOpen(false)}
                                        className="flex items-center gap-3 p-2 text-sm hover:bg-muted/50 rounded-md text-muted-foreground"
                                    >
                                        <LayoutTemplate className="w-4 h-4" />
                                        Virtual Staging
                                    </Link>
                                </div>
                            )}
                        </div>
                        <Link
                            href="/history"
                            className="flex items-center gap-2 text-sm font-medium py-2 hover:bg-muted/50 rounded-md px-2"
                            onClick={() => setIsMenuOpen(false)}
                        >
                            <History className="w-4 h-4" />
                            <span>History</span>
                        </Link>
                        <Link
                            href="/pricing"
                            className="flex items-center gap-2 text-sm font-medium py-2 hover:bg-muted/50 rounded-md px-2"
                            onClick={() => setIsMenuOpen(false)}
                        >
                            <CreditCard className="w-4 h-4" />
                            <span>Pricing</span>
                        </Link>

                        <div className="h-px bg-border/40 my-1" />

                        {user ? (
                            <>
                                <div className="flex items-center justify-between py-2 px-2">
                                    <div className="flex flex-col leading-none">
                                        <span className="text-sm font-medium">My Account</span>
                                        <span className="text-xs text-muted-foreground capitalize">{userProfile?.subscription_tier || 'Free'} Plan</span>
                                    </div>
                                    <span className="text-sm font-bold text-primary">{userProfile?.credits || 0} Credits</span>
                                </div>
                                <Link
                                    href="/account"
                                    className="flex items-center gap-2 text-sm font-medium py-2 hover:bg-muted/50 rounded-md px-2"
                                    onClick={() => setIsMenuOpen(false)}
                                >
                                    <User className="w-4 h-4" />
                                    Account Settings
                                </Link>
                                <button
                                    onClick={() => {
                                        signOut();
                                        setIsMenuOpen(false);
                                    }}
                                    className="flex items-center gap-2 text-sm font-medium py-2 text-destructive hover:bg-destructive/10 rounded-md px-2 w-full text-left"
                                >
                                    <LogOut className="w-4 h-4" />
                                    Sign Out
                                </button>
                            </>
                        ) : (
                            <div className="flex flex-col gap-3 py-2">
                                <Link
                                    href="/login"
                                    className="w-full text-center py-2 text-sm font-medium hover:bg-muted rounded-md"
                                    onClick={() => setIsMenuOpen(false)}
                                >
                                    Log in
                                </Link>
                                <Link
                                    href="/signup"
                                    className="w-full text-center py-2 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90"
                                    onClick={() => setIsMenuOpen(false)}
                                >
                                    Sign up
                                </Link>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </header>
    );
}
