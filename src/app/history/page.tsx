'use client';

import { useEffect, useState } from 'react';
import { Sparkles, History, ArrowLeft, Download } from 'lucide-react';
import Link from 'next/link';
import Image from 'next/image';
import { toast } from 'sonner';
import { getGenerationsAction } from '@/app/actions/history';

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

    useEffect(() => {
        async function loadHistory() {
            if (!user) {
                setIsLoading(false);
                return;
            }
            const { generations: data } = await getGenerationsAction(user.id);
            setGenerations(data);
            setIsLoading(false);
        }
        loadHistory();
    }, [user]);



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
                                    className="group relative rounded-xl border border-border overflow-hidden bg-card hover:shadow-lg transition-all cursor-pointer"
                                    onClick={() => setSelectedImage(gen)}
                                >
                                    <div className="aspect-[4/3] relative">
                                        <Image
                                            src={gen.result_url}
                                            alt="Generated staging"
                                            fill
                                            className="object-cover"
                                        />
                                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors" />
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
