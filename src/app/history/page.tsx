'use client';

import { useEffect, useState } from 'react';
import { Sparkles, History, ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import Image from 'next/image';
import { toast } from 'sonner';
import { getGenerationsAction, deleteGenerationAction } from '@/app/actions/history';
import { Trash2, Pencil, Check, X, Download } from 'lucide-react';
import { downloadImage } from '@/lib/client-download';
import { getUserProfile } from '@/app/actions/credits';

import { EditImageModal as ImageModal } from '@/components/edit-image-modal';

interface Generation {
    id: string;
    original_url: string;
    result_url: string;
    mode: string;
    style?: string;
    created_at: string;
}

import { useAuth } from '@/lib/auth-context';

export default function HistoryPage() {
    const { user } = useAuth();
    const [generations, setGenerations] = useState<Generation[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [selectedImage, setSelectedImage] = useState<Generation | null>(null);
    const [activeCardId, setActiveCardId] = useState<string | null>(null);
    const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
    const [isDeleting, setIsDeleting] = useState(false);
    const [userProfile, setUserProfile] = useState<any>(null); // For checking tier

    useEffect(() => {
        async function loadData() {
            if (!user) {
                setIsLoading(false);
                return;
            }

            // Load history and profile in parallel
            const [historyRes, profileRes] = await Promise.all([
                getGenerationsAction(user.id),
                getUserProfile(user.id)
            ]);

            setGenerations(historyRes.generations);
            setUserProfile(profileRes);
            setIsLoading(false);
        }
        loadData();
    }, [user]);

    // Handle clicks outside to close overlay
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (activeCardId && !(e.target as Element).closest('.generation-card')) {
                setActiveCardId(null);
                setConfirmDeleteId(null);
            }
        };
        document.addEventListener('click', handleClickOutside);
        return () => document.removeEventListener('click', handleClickOutside);
    }, [activeCardId]);

    const handleDelete = async (e: React.MouseEvent, genId: string) => {
        e.stopPropagation();

        if (confirmDeleteId !== genId) {
            setConfirmDeleteId(genId);
            return;
        }

        if (!user) return;

        setIsDeleting(true);
        const result = await deleteGenerationAction(genId, user.id);

        if (result.success) {
            setGenerations(prev => prev.filter(g => g.id !== genId));
            toast.success('Image deleted');
        } else {
            toast.error('Failed to delete image');
        }

        setIsDeleting(false);
        setConfirmDeleteId(null);
        setActiveCardId(null);
    };

    const handleEditClick = (e: React.MouseEvent, gen: Generation) => {
        e.stopPropagation();
        setSelectedImage(gen);
        setActiveCardId(null);
    };

    const handleDownloadClick = async (e: React.MouseEvent, gen: Generation) => {
        e.stopPropagation();

        const isPaidTier = userProfile?.subscription_tier === 'starter' ||
            userProfile?.subscription_tier === 'pro' ||
            userProfile?.subscription_tier === 'agency';

        await downloadImage({
            url: gen.result_url,
            isPremium: isPaidTier,
            filename: `kogflow-render-${gen.id}.jpg`
        });

        setActiveCardId(null);
    };

    const toggleOverlay = (e: React.MouseEvent, genId: string) => {
        e.stopPropagation();
        if (activeCardId === genId) {
            setActiveCardId(null);
            setConfirmDeleteId(null);
        } else {
            setActiveCardId(genId);
            setConfirmDeleteId(null);
        }
    };



    return (
        <div className="min-h-screen flex flex-col font-sans selection:bg-primary/20">
            {/* Navbar */}
            <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/80 backdrop-blur-md">
                <div className="container flex h-16 items-center justify-between px-4">
                    <Link href="/" className="flex items-center gap-2 font-bold text-xl tracking-tighter">
                        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center">
                            <Sparkles className="w-5 h-5 text-white" />
                        </div>
                        <span>Kogflow</span>
                    </Link>

                    <nav className="flex items-center gap-6">
                        <Link
                            href="/"
                            className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
                        >
                            <ArrowLeft className="w-4 h-4" />
                            Back to Upload
                        </Link>
                    </nav>
                </div>
            </header>

            <main className="flex-1 w-full max-w-[1400px] mx-auto px-4 py-8">
                <div className="space-y-6">
                    <div className="flex items-center gap-3">
                        <History className="w-8 h-8 text-primary" />
                        <h1 className="text-3xl font-bold">Generation History</h1>
                    </div>

                    {isLoading ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                            {[1, 2, 3, 4, 5, 6].map((i) => (
                                <div key={i} className="aspect-[4/3] rounded-xl bg-muted animate-pulse" />
                            ))}
                        </div>
                    ) : generations.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-20 text-center">
                            <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
                                <History className="w-8 h-8 text-muted-foreground" />
                            </div>
                            <h2 className="text-xl font-semibold mb-2">No generations yet</h2>
                            <p className="text-muted-foreground mb-6 max-w-md">
                                Your generated images will appear here. Start by uploading a room image and creating your first staging.
                            </p>
                            <Link
                                href="/"
                                className="px-6 py-3 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 transition-colors"
                            >
                                Create Your First Staging
                            </Link>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                            {generations.map((gen) => (
                                <div
                                    key={gen.id}
                                    className={`generation-card group relative rounded-xl border border-border overflow-hidden bg-card transition-all cursor-pointer ${activeCardId === gen.id ? 'ring-2 ring-primary' : 'hover:shadow-lg'}`}
                                    onClick={(e) => toggleOverlay(e, gen.id)}
                                >
                                    <div className="aspect-[4/3] relative">
                                        <Image
                                            src={gen.result_url}
                                            alt="Generated staging"
                                            fill
                                            className="object-cover"
                                        />

                                        {/* Overlay - Active State */}
                                        <div className={`absolute inset-0 bg-black/60 backdrop-blur-[2px] transition-opacity flex flex-col items-center justify-center gap-4 ${activeCardId === gen.id ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
                                            <button
                                                onClick={(e) => handleEditClick(e, gen)}
                                                className="flex items-center gap-2 px-6 py-2.5 bg-primary text-primary-foreground rounded-full font-medium hover:bg-primary/90 transition-transform hover:scale-105"
                                            >
                                                <Pencil className="w-4 h-4" />
                                                AI Edit
                                            </button>

                                            <button
                                                onClick={(e) => handleDownloadClick(e, gen)}
                                                className="flex items-center gap-2 px-6 py-2.5 bg-secondary text-secondary-foreground rounded-full font-medium hover:bg-secondary/80 transition-transform hover:scale-105"
                                            >
                                                <Download className="w-4 h-4" />
                                                Download
                                            </button>

                                            <button
                                                onClick={(e) => handleDelete(e, gen.id)}
                                                disabled={isDeleting}
                                                className={`flex items-center gap-2 px-6 py-2.5 rounded-full font-medium transition-all hover:scale-105 ${confirmDeleteId === gen.id
                                                    ? 'bg-red-500 text-white'
                                                    : 'bg-white/10 text-white hover:bg-white/20'
                                                    }`}
                                            >
                                                {isDeleting ? (
                                                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                                ) : confirmDeleteId === gen.id ? (
                                                    <>
                                                        <Check className="w-4 h-4" />
                                                        Confirm
                                                    </>
                                                ) : (
                                                    <>
                                                        <Trash2 className="w-4 h-4" />
                                                        Delete
                                                    </>
                                                )}
                                            </button>

                                            {/* Cancel confirmation if active */}
                                            {confirmDeleteId === gen.id && (
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        setConfirmDeleteId(null);
                                                    }}
                                                    className="text-white/50 text-xs mt-1 hover:text-white"
                                                >
                                                    Cancel
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                    <div className="p-4 space-y-2">
                                        <div className="flex items-center justify-between">
                                            <span className="text-xs text-muted-foreground">
                                                {new Date(gen.created_at).toLocaleDateString()}
                                            </span>
                                        </div>
                                        <div className="text-sm">
                                            <span className="font-medium capitalize">{gen.mode.replace('_', ' ')}</span>
                                            {gen.style && <span className="text-muted-foreground"> • {gen.style}</span>}
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </main>

            {/* Image Detail Modal - Reusing Shared Component */}
            {selectedImage && (
                <ImageModal
                    isOpen={!!selectedImage}
                    onClose={() => setSelectedImage(null)}
                    resultUrl={selectedImage.result_url}
                    originalUrl={selectedImage.original_url}
                    user={user}
                />
            )}

            <footer className="py-8 border-t border-border/40 text-center text-sm text-muted-foreground">
                <p>© 2026 Kogflow. All rights reserved.</p>
            </footer>
        </div>
    );
}
