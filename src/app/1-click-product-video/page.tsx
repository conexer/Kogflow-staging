'use client';

import { useState } from 'react';
import { Navbar } from '@/components/navbar';
import { submitEmail } from '@/app/actions/collect-email';
import { Zap, Video, CheckCircle, Smartphone, Globe, Clapperboard, Sparkles } from 'lucide-react';
import { toast } from 'sonner';

export default function ProductVideoPage() {
    const [email, setEmail] = useState('');
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);

        const formData = new FormData();
        formData.append('email', email);

        const result = await submitEmail(formData);
        setLoading(false);

        if (result.success) {
            toast.success(result.message);
            setEmail('');
        } else {
            toast.error(result.message);
        }
    };

    return (
        <div className="min-h-screen flex flex-col font-sans selection:bg-primary/20 bg-background text-foreground">
            <Navbar />

            <main className="flex-1 flex flex-col w-full">
                {/* Hero Section */}
                <section className="container mx-auto px-4 pt-10 pb-20 text-center space-y-8 max-w-5xl">
                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-violet-500/10 text-violet-500 font-medium text-sm mb-4 border border-violet-500/20">
                        <Sparkles className="w-4 h-4" /> Coming Soon
                    </div>
                    <div className="space-y-6">
                        <h1 className="text-5xl md:text-7xl font-bold tracking-tight leading-tight">
                            1-Click Product Videos
                            <br />
                            <span className="text-transparent bg-clip-text bg-gradient-to-r from-violet-500 to-fuchsia-500">
                                That Sell
                            </span>
                        </h1>
                        <p className="text-xl md:text-2xl text-muted-foreground max-w-3xl mx-auto">
                            Turn static product images into high-converting viral videos for TikTok, Reels, and ads instantly.
                        </p>
                    </div>

                    <div className="max-w-md mx-auto w-full pt-8">
                        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                            <div className="flex gap-2 p-1 bg-muted/50 rounded-xl border border-border/50 backdrop-blur-sm">
                                <input
                                    type="email"
                                    placeholder="Enter your email for early access"
                                    className="flex-1 bg-transparent border-none px-4 text-base focus:ring-0 placeholder:text-muted-foreground/50 outline-none"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    required
                                />
                                <button
                                    type="submit"
                                    disabled={loading}
                                    className="px-6 py-3 bg-primary text-primary-foreground rounded-lg font-bold hover:bg-primary/90 transition-all shadow-lg disabled:opacity-70 whitespace-nowrap"
                                >
                                    {loading ? 'Joining...' : 'Join Waitlist'}
                                </button>
                            </div>
                            <p className="text-xs text-muted-foreground">
                                Join 2,000+ others waiting for this feature.
                            </p>
                        </form>
                    </div>
                </section>

                {/* Features/Demo Section */}
                <section className="bg-muted/30 py-24 border-y border-border/50">
                    <div className="container mx-auto px-4">
                        <div className="text-center mb-16 space-y-4">
                            <h2 className="text-3xl md:text-5xl font-bold">Why Video?</h2>
                            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
                                Stop losing sales with boring static images. Video is the new standard.
                            </p>
                        </div>

                        <div className="grid md:grid-cols-3 gap-8 max-w-6xl mx-auto">
                            {/* Feature 1 */}
                            <div className="p-8 rounded-3xl bg-card border border-border shadow-sm flex flex-col items-center text-center space-y-4">
                                <div className="w-16 h-16 rounded-2xl bg-blue-500/10 flex items-center justify-center text-blue-500 mb-2">
                                    <Smartphone className="w-8 h-8" />
                                </div>
                                <h3 className="text-2xl font-bold">Vertical First</h3>
                                <p className="text-muted-foreground">
                                    Optimized for mobile viewing. Perfect for TikTok, Instagram Reels, and YouTube Shorts.
                                </p>
                            </div>

                            {/* Feature 2 */}
                            <div className="p-8 rounded-3xl bg-card border border-border shadow-sm flex flex-col items-center text-center space-y-4 relative overflow-hidden">
                                <div className="absolute inset-0 bg-gradient-to-br from-violet-500/5 to-fuchsia-500/5" />
                                <div className="w-16 h-16 rounded-2xl bg-violet-500/10 flex items-center justify-center text-violet-500 mb-2">
                                    <Zap className="w-8 h-8" />
                                </div>
                                <h3 className="text-2xl font-bold">AI Generated</h3>
                                <p className="text-muted-foreground">
                                    No editing skills required. Our AI analyzes your product and creates the perfect script and motion.
                                </p>
                            </div>

                            {/* Feature 3 */}
                            <div className="p-8 rounded-3xl bg-card border border-border shadow-sm flex flex-col items-center text-center space-y-4">
                                <div className="w-16 h-16 rounded-2xl bg-green-500/10 flex items-center justify-center text-green-500 mb-2">
                                    <Globe className="w-8 h-8" />
                                </div>
                                <h3 className="text-2xl font-bold">Global Reach</h3>
                                <p className="text-muted-foreground">
                                    Automatically translate your videos into multiple languages to reach international markets.
                                </p>
                            </div>
                        </div>
                    </div>
                </section>

                {/* Example Mockup */}
                <section className="py-24 container mx-auto px-4">
                    <div className="max-w-6xl mx-auto grid lg:grid-cols-2 gap-12 items-center">
                        <div className="relative aspect-[9/16] max-w-xs mx-auto lg:mx-0 rounded-3xl overflow-hidden shadow-2xl border-4 border-slate-900 bg-black">
                            {/* Placeholder for video UI */}
                            <div className="absolute inset-0 flex items-center justify-center text-white/20">
                                <Clapperboard className="w-20 h-20" />
                            </div>
                            <div className="absolute bottom-0 inset-x-0 p-6 bg-gradient-to-t from-black/80 to-transparent text-white space-y-2">
                                <div className="h-2 w-1/3 bg-white/20 rounded-full" />
                                <div className="h-2 w-2/3 bg-white/20 rounded-full" />
                            </div>
                        </div>
                        <div className="space-y-8">
                            <h2 className="text-4xl md:text-5xl font-bold leading-tight">
                                From JPG to MP4 <br />in Seconds
                            </h2>
                            <div className="space-y-4">
                                <div className="flex items-start gap-4">
                                    <CheckCircle className="w-6 h-6 text-primary mt-1 shrink-0" />
                                    <div>
                                        <h4 className="font-bold text-lg">Upload Product Photos</h4>
                                        <p className="text-muted-foreground">Use your existing professional shots or even phone photos.</p>
                                    </div>
                                </div>
                                <div className="flex items-start gap-4">
                                    <CheckCircle className="w-6 h-6 text-primary mt-1 shrink-0" />
                                    <div>
                                        <h4 className="font-bold text-lg">Select a Vibe</h4>
                                        <p className="text-muted-foreground">Choose from "Energetic", "Luxury", "Minimalist" and more.</p>
                                    </div>
                                </div>
                                <div className="flex items-start gap-4">
                                    <CheckCircle className="w-6 h-6 text-primary mt-1 shrink-0" />
                                    <div>
                                        <h4 className="font-bold text-lg">Download & Post</h4>
                                        <p className="text-muted-foreground">Get a fully rendered video with music, transitions, and captions.</p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </section>
            </main>

            <footer className="py-12 border-t border-border/40 bg-muted/20 text-sm text-center">
                <div className="container mx-auto px-4">
                    <p className="text-muted-foreground">
                        © 2026 Kogflow. All rights reserved.
                    </p>
                </div>
            </footer>
        </div>
    );
}
