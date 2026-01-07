'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { UploadZone } from '@/components/upload-zone';
import { StagingControls, type StagingMode, type StagingStyle } from '@/components/staging-controls';
import { ComparisonSlider } from '@/components/comparison-slider';
import { toast } from 'sonner';
import { History, ChevronRight, UploadCloud } from 'lucide-react';
import Link from 'next/link';
import { generateImageAction } from '@/app/actions/generate';
import { useAuth } from '@/lib/auth-context';
import { getUserProfile } from '@/app/actions/credits';
import { Navbar } from '@/components/navbar';

export default function GeneratePage() {
    const { user, signOut } = useAuth();
    const router = useRouter();
    const [image, setImage] = useState<File | null>(null);
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const [mode, setMode] = useState<StagingMode>('add_furniture');
    const [style, setStyle] = useState<StagingStyle>('scandinavian');
    const [isGenerating, setIsGenerating] = useState(false);
    const [resultImage, setResultImage] = useState<string | null>(null);
    const [userProfile, setUserProfile] = useState<any>(null);
    const [aspectRatio, setAspectRatio] = useState<string | null>(null);

    useEffect(() => {
        async function loadProfile() {
            if (user) {
                const profile = await getUserProfile(user.id);
                setUserProfile(profile);
            }
        }

        loadProfile();
    }, [user]);

    const handleImageSelect = (file: File | null) => {
        setImage(file);
        if (file) {
            const url = URL.createObjectURL(file);
            setPreviewUrl(url);
            setResultImage(null); // Reset result on new upload

            // Calculate aspect ratio
            const img = new window.Image();
            img.onload = () => {
                const width = img.naturalWidth;
                const height = img.naturalHeight;

                const gcd = (a: number, b: number): number => b === 0 ? a : gcd(b, a % b);
                const divisor = gcd(width, height);
                // Simplify but keep it reasonable. If it's effectively 16:9, it should simplify to that.
                // For odd dimensions, it might be weird (e.g. 1921:1080). 
                // Ideally we pass "width:height" if the API accepts it for exact match.
                // Let's pass the exact simplified ratio.
                const ratio = `${width / divisor}:${height / divisor}`;
                console.log(`Detected aspect ratio: ${ratio} (${width}x${height})`);
                setAspectRatio(ratio);
            };
            img.src = url;
        } else {
            setPreviewUrl(null);
            setResultImage(null);
            setAspectRatio(null);
        }
    };

    const handleGenerate = async () => {
        if (!image) return;

        // If user is logged in, check credits locally first to save a call, but validation happens on server
        if (user && (!userProfile || userProfile.credits <= 0)) {
            toast.error('Out of credits!', {
                action: {
                    label: 'Upgrade',
                    onClick: () => router.push('/pricing'),
                },
            });
            return;
        }

        setIsGenerating(true);

        try {
            const formData = new FormData();
            formData.append('image', image);
            formData.append('mode', mode);
            if (user) {
                formData.append('userId', user.id);
            }
            if (aspectRatio) {
                formData.append('aspectRatio', aspectRatio);
            }
            if (mode === 'add_furniture') {
                formData.append('style', style);
            }

            const result = await generateImageAction(formData);

            if (result.error) {
                if (result.needsUpgrade) {
                    toast.error(result.error, {
                        action: {
                            label: 'Upgrade',
                            onClick: () => router.push('/pricing'),
                        },
                    });
                } else {
                    toast.error(result.error);
                }
            } else if (result.success && result.url) {
                setResultImage(result.url);
                // Refresh credits if logged in
                if (user) {
                    const profile = await getUserProfile(user.id);
                    setUserProfile(profile);
                }
                toast.success('Staging complete!');
            }
        } catch (error) {
            toast.error('Something went wrong. Please try again.');
            console.error(error);
        } finally {
            setIsGenerating(false);
        }
    };

    return (
        <div className="min-h-screen flex flex-col font-sans selection:bg-primary/20">
            <Navbar />

            <main className="flex-1 flex flex-col w-full max-w-[1600px] mx-auto px-4 py-8 gap-12">
                {/* Hero Section */}
                <section className="text-center space-y-6 pt-8 pb-4">
                    <h1 className="text-4xl md:text-6xl font-extrabold tracking-tight leading-tight">
                        Virtual Staging with a Click.
                    </h1>
                    <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
                        Upload your listing, choose a style, and let our AI transform empty rooms into sold homes.
                    </p>
                </section>

                {/* Interface Grid */}
                <div className="grid lg:grid-cols-[1fr_400px] gap-8 items-start">
                    {/* Left: Viewport */}
                    <div className="w-full space-y-6">
                        {previewUrl ? (
                            <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-700">
                                <div className="flex items-center justify-between">
                                    <h2 className="text-xl font-bold">{resultImage ? 'Result' : 'Preview'}</h2>
                                    <button
                                        onClick={() => {
                                            setImage(null);
                                            setPreviewUrl(null);
                                            setResultImage(null);
                                            setAspectRatio(null);
                                        }}
                                        className="text-sm text-primary hover:underline"
                                    >
                                        {resultImage ? 'Start Over' : 'Remove Image'}
                                    </button>
                                </div>

                                {resultImage ? (
                                    <ComparisonSlider
                                        beforeImage={previewUrl}
                                        afterImage={resultImage}
                                    />
                                ) : (
                                    <div className="relative w-full aspect-video rounded-xl overflow-hidden bg-muted/50 border border-border">
                                        <img
                                            src={previewUrl}
                                            alt="Preview"
                                            className="w-full h-full object-contain"
                                        />
                                    </div>
                                )}

                                {resultImage && (
                                    <div className="flex justify-end gap-2">
                                        <button
                                            onClick={async () => {
                                                if (resultImage) {
                                                    const response = await fetch(resultImage);
                                                    const blob = await response.blob();
                                                    const url = window.URL.createObjectURL(blob);
                                                    const a = document.createElement('a');
                                                    a.href = url;
                                                    a.download = `kogflow-${Date.now()}.jpg`;
                                                    document.body.appendChild(a);
                                                    a.click();
                                                    document.body.removeChild(a);
                                                    window.URL.revokeObjectURL(url);
                                                    toast.success('Image downloaded!');
                                                }
                                            }}
                                            className="px-4 py-2 bg-secondary hover:bg-secondary/80 rounded-md font-medium text-sm transition-colors"
                                        >
                                            Download HD
                                        </button>
                                    </div>
                                )}
                            </div>
                        ) : (
                            <div className="flex flex-col items-center justify-center h-[600px] bg-background/50 rounded-xl border-2 border-dashed border-muted-foreground/30">
                                <input
                                    type="file"
                                    id="imageUpload"
                                    accept="image/*"
                                    onChange={(e) => {
                                        const file = e.target.files?.[0];
                                        if (file) {
                                            handleImageSelect(file);
                                        }
                                    }}
                                    className="hidden"
                                />
                                <label htmlFor="imageUpload">
                                    <button
                                        type="button"
                                        onClick={() => document.getElementById('imageUpload')?.click()}
                                        className="px-8 py-4 bg-primary text-primary-foreground rounded-lg font-semibold text-lg hover:bg-primary/90 transition-colors flex items-center gap-3 shadow-lg hover:shadow-xl"
                                    >
                                        <UploadCloud className="w-6 h-6" />
                                        Upload Image for Free
                                    </button>
                                </label>
                                <p className="mt-4 text-sm text-muted-foreground">
                                    Supports JPG, PNG, WEBP
                                </p>
                            </div>
                        )}
                    </div>

                    {/* Right: Controls */}
                    <div className="lg:sticky lg:top-24 space-y-8">
                        <StagingControls
                            mode={mode}
                            setMode={setMode}
                            style={style}
                            setStyle={setStyle}
                            isGenerating={isGenerating}
                            onGenerate={handleGenerate}
                            disabled={!image}
                        />

                        {/* History Section (Mini) */}
                        <div className="rounded-xl border border-border bg-card/50 p-6 space-y-4">
                            <div className="flex items-center justify-between">
                                <h3 className="font-semibold flex items-center gap-2">
                                    <History className="w-4 h-4 text-muted-foreground" />
                                    History
                                </h3>
                                <Link href="/history" className="text-xs text-primary hover:underline flex items-center">
                                    View All <ChevronRight className="w-3 h-3" />
                                </Link>
                            </div>

                            <div className="grid grid-cols-3 gap-2">
                                {/* Placeholder history items */}
                                {[1, 2, 3].map((i) => (
                                    <div key={i} className="aspect-square rounded-md bg-muted animate-pulse" />
                                ))}
                            </div>
                            <p className="text-xs text-muted-foreground text-center pt-2">
                                Your past generations will appear here.
                            </p>
                        </div>
                    </div>
                </div>
            </main>

            <footer className="py-8 border-t border-border/40 text-center text-sm text-muted-foreground">
                <p>© 2026 Kogflow. All rights reserved.</p>
            </footer>
        </div>
    );
}
