'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { UploadZone } from '@/components/upload-zone';
import { StagingControls, type StagingMode, type StagingStyle } from '@/components/staging-controls';
import { ComparisonSlider } from '@/components/comparison-slider';
import { toast } from 'sonner';
import { History, ChevronRight, UploadCloud } from 'lucide-react';
import Link from 'next/link';
import { startGeneration, checkGenerationStatus } from '@/app/actions/generate';
import { useAuth } from '@/lib/auth-context';
import { getUserProfile } from '@/app/actions/credits';
import { Navbar } from '@/components/navbar';
import { EditImageModal as ImageModal } from '@/components/edit-image-modal';
import { downloadImage } from '@/lib/client-download';
import { Sparkles, Download } from 'lucide-react';

export default function GeneratePage() {
    const { user, signOut } = useAuth();
    console.log('GeneratePage v2 rendered'); // Force rebuild check
    const router = useRouter();
    const [image, setImage] = useState<File | null>(null);
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const [mode, setMode] = useState<StagingMode>('add_furniture');
    const [style, setStyle] = useState<StagingStyle>('scandinavian');
    const [roomType, setRoomType] = useState<any>('living_room');
    const [customRoomType, setCustomRoomType] = useState('');
    const [customStyle, setCustomStyle] = useState('');
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

                // Calculate aspect ratio
                const gcd = (a: number, b: number): number => b === 0 ? a : gcd(b, a % b);
                const divisor = gcd(width, height);
                const ratio = `${width / divisor}:${height / divisor}`;
                console.log(`Detected aspect ratio: ${ratio} (${width}x${height})`);
                setAspectRatio(ratio);

                // Resize logic
                const MAX_DIM = 2048;
                if (width > MAX_DIM || height > MAX_DIM) {
                    const canvas = document.createElement('canvas');
                    let newWidth = width;
                    let newHeight = height;

                    if (width > height) {
                        newWidth = MAX_DIM;
                        newHeight = (height / width) * MAX_DIM;
                    } else {
                        newHeight = MAX_DIM;
                        newWidth = (width / height) * MAX_DIM;
                    }

                    canvas.width = newWidth;
                    canvas.height = newHeight;
                    const ctx = canvas.getContext('2d');
                    ctx?.drawImage(img, 0, 0, newWidth, newHeight);

                    canvas.toBlob((blob) => {
                        if (blob) {
                            const resizedFile = new File([blob], file.name.replace(/\.[^/.]+$/, "") + ".jpg", {
                                type: "image/jpeg",
                                lastModified: Date.now(),
                            });
                            console.log(`Resized image from ${file.size} to ${resizedFile.size}`);
                            setImage(resizedFile);
                            const resizedUrl = URL.createObjectURL(resizedFile);
                            setPreviewUrl(resizedUrl);
                        }
                    }, 'image/jpeg', 0.9);
                } else {
                    // No resize needed
                }
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

            // Add Room Type and Custom inputs to FormData
            if (roomType === 'custom' && customRoomType) {
                formData.append('roomType', customRoomType);
            } else {
                formData.append('roomType', roomType.replace('_', ' '));
            }

            if (user) {
                formData.append('userId', user.id);
            }
            if (aspectRatio) {
                formData.append('aspectRatio', aspectRatio);
            }
            if (mode === 'add_furniture') {
                // If custom style is present, prefer it or combine? The request implies adding a custom style.
                // I will send both, or assume custom overrides if sending just one.
                // Let's send the effective style.
                if (customStyle) {
                    formData.append('style', customStyle);
                } else {
                    formData.append('style', style);
                }
            }

            // Start the generation task
            const result = await startGeneration(formData);

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
                return;
            }

            if (result.isMock && result.url) {
                // Mock result (no polling)
                setResultImage(result.url);
                toast.success('Staging complete! (Mock)');
                return;
            }

            if (!result.taskId) {
                throw new Error('No task ID returned');
            }

            toast.success('Generation started! This usually takes ~15 seconds.');

            // Start Polling
            const toastId = toast.loading('Designing your room...');

            const poll = async () => {
                // Safety timeout (e.g. 2 minutes)
                const startTime = Date.now();

                while (true) {
                    if (Date.now() - startTime > 120000) {
                        toast.dismiss(toastId);
                        throw new Error('Timed out waiting for server.');
                    }

                    const statusResult = await checkGenerationStatus(result.taskId, {
                        userId: user?.id,
                        originalUrl: result.originalUrl,
                        mode: result.mode,
                        style: customStyle || result.style // Use the style we actually sent
                    });

                    if (statusResult.status === 'success' && statusResult.url) {
                        toast.dismiss(toastId);
                        setResultImage(statusResult.url);

                        // Refresh credits if logged in
                        if (user) {
                            const profile = await getUserProfile(user.id);
                            setUserProfile(profile);
                        }
                        toast.success('Staging complete!');
                        return;
                    } else if (statusResult.status === 'failed' || statusResult.status === 'error') {
                        toast.dismiss(toastId);
                        throw new Error(statusResult.error || 'Generation failed');
                    }

                    // Wait 2 seconds before next poll
                    await new Promise(r => setTimeout(r, 2000));
                }
            };

            await poll();

        } catch (error: any) {
            console.error(error);
            toast.error(error.message || 'Something went wrong. Please try again.');
        } finally {
            setIsGenerating(false);
        }
    };

    const [modalData, setModalData] = useState<{ resultUrl: string; originalUrl?: string } | null>(null);

    return (
        <div className="min-h-screen flex flex-col font-sans selection:bg-primary/20">
            <Navbar />

            <main className="flex-1 flex flex-col w-full max-w-[1600px] mx-auto px-4 py-8 gap-12">
                {/* Hero Section */}
                <section className="text-center space-y-6 pt-8 pb-4">
                    <h1 className="text-4xl md:text-6xl font-extrabold tracking-tight leading-tight">
                        Virtual Staging in Seconds
                    </h1>
                    <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
                        Transform empty listings into sold homes. Upload a photo, choose a style, and let AI handle the rest.
                    </p>

                    {/* Upload Zone (Visible if no image) */}
                    {!previewUrl && (
                        <div className="max-w-xl mx-auto mt-8 p-12 bg-background/50 rounded-xl border-2 border-dashed border-muted-foreground/30 hover:border-primary/50 transition-colors animate-in fade-in zoom-in-95 duration-500">
                            <input
                                type="file"
                                id="imageUpload"
                                accept="image/png, image/jpeg, image/webp"
                                onChange={(e) => {
                                    const file = e.target.files?.[0];
                                    if (file) {
                                        handleImageSelect(file);
                                    }
                                }}
                                className="hidden"
                            />
                            <label htmlFor="imageUpload" className="cursor-pointer flex flex-col items-center gap-4">
                                <div className="p-4 bg-primary/10 rounded-full">
                                    <UploadCloud className="w-10 h-10 text-primary" />
                                </div>
                                <div className="text-center space-y-2">
                                    <h3 className="text-xl font-bold">Upload a photo</h3>
                                    <p className="text-sm text-muted-foreground">
                                        JPG, PNG, WEBP up to 20MB
                                    </p>
                                </div>
                                <div className="flex flex-col sm:flex-row gap-3 w-full">
                                    <button
                                        type="button"
                                        onClick={() => document.getElementById('imageUpload')?.click()}
                                        className="flex-1 px-8 py-3 bg-primary text-primary-foreground rounded-lg font-semibold hover:bg-primary/90 transition-all shadow-lg hover:shadow-xl"
                                    >
                                        Select Image
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => document.getElementById('cameraUpload')?.click()}
                                        className="flex-1 px-8 py-3 bg-secondary text-secondary-foreground rounded-lg font-semibold hover:bg-secondary/80 transition-all shadow-lg hover:shadow-xl"
                                    >
                                        Take Photo
                                    </button>
                                </div>
                            </label>
                            <input
                                type="file"
                                id="cameraUpload"
                                accept="image/*"
                                capture="environment"
                                onChange={(e) => {
                                    const file = e.target.files?.[0];
                                    if (file) {
                                        handleImageSelect(file);
                                    }
                                }}
                                className="hidden"
                            />
                        </div>
                    )}
                </section>

                <div className="flex flex-col lg:flex-row gap-8 items-start justify-center">
                    {/* Controls Sidebar */}
                    <div className="w-full lg:w-[400px] lg:sticky lg:top-24 space-y-6">
                        <StagingControls
                            mode={mode}
                            setMode={setMode}
                            style={style}
                            setStyle={setStyle}
                            roomType={roomType}
                            setRoomType={setRoomType}
                            customRoomType={customRoomType}
                            setCustomRoomType={setCustomRoomType}
                            customStyle={customStyle}
                            setCustomStyle={setCustomStyle}
                            isGenerating={isGenerating}
                            onGenerate={handleGenerate}
                            disabled={!image}
                        />
                    </div>

                    {/* Right: Viewport (Visible only if image exists) */}
                    {previewUrl && (
                        <div className="flex-1 w-full space-y-6 animate-in fade-in slide-in-from-bottom-8 duration-700">
                            <div className="space-y-4">
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
                                    <div className="relative w-full aspect-video rounded-xl overflow-hidden bg-muted/50 border border-border shadow-xl">
                                        <img
                                            src={resultImage}
                                            alt="Result"
                                            className="w-full h-full object-contain"
                                            onClick={() => setModalData({ resultUrl: resultImage!, originalUrl: previewUrl || undefined })}
                                            style={{ cursor: 'pointer' }}
                                        />
                                    </div>
                                ) : (
                                    <div className="relative w-full aspect-video rounded-xl overflow-hidden bg-muted/50 border border-border">
                                        <img
                                            src={previewUrl}
                                            alt="Preview"
                                            className="w-full h-full object-contain"
                                        />
                                    </div>
                                )}

                                {/* Main Viewport Watermark Overlay (Immediate Feedback) */}
                                {resultImage && (!userProfile || (userProfile.subscription_tier !== 'starter' && userProfile.subscription_tier !== 'pro' && userProfile.subscription_tier !== 'agency')) && (
                                    <div className="absolute inset-0 pointer-events-none flex items-end justify-center pb-[5%] z-10">
                                        <span className="text-white/40 text-4xl sm:text-6xl font-bold drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)] select-none">
                                            KogFlow.com
                                        </span>
                                    </div>
                                )}

                                {resultImage && (
                                    <div className="flex justify-end gap-2">
                                        <p className="text-xs text-muted-foreground mr-auto self-center">
                                            Click image to zoom/share
                                        </p>
                                        <button
                                            onClick={() => setModalData({ resultUrl: resultImage!, originalUrl: previewUrl || undefined })}
                                            className="px-4 py-2 bg-secondary hover:bg-secondary/80 rounded-md font-medium text-sm transition-colors"
                                        >
                                            View & Download
                                        </button>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>

                {/* History Section (Moved to Bottom) */}
                <div className="w-full pt-12 border-t border-border/40">
                    <div className="max-w-6xl mx-auto space-y-6">
                        <div className="flex items-center justify-between">
                            <h3 className="text-2xl font-bold flex items-center gap-3">
                                <History className="w-6 h-6 text-muted-foreground" />
                                Recent Generations
                            </h3>
                            <Link href="/history" className="text-sm font-medium text-primary hover:underline flex items-center gap-1">
                                View Full History <ChevronRight className="w-4 h-4" />
                            </Link>
                        </div>

                        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
                            {/* Real History Preview */}
                            {userProfile?.recentGenerations?.length > 0 ? (
                                userProfile.recentGenerations.slice(0, 6).map((gen: any) => (
                                    <div
                                        key={gen.id}
                                        className="aspect-square rounded-lg bg-muted overflow-hidden relative cursor-pointer group shadow-sm hover:shadow-md border border-border"
                                        onClick={() => {
                                            setModalData({
                                                resultUrl: gen.result_url,
                                                originalUrl: gen.original_url
                                            });
                                        }}
                                    >
                                        <img
                                            src={gen.result_url}
                                            alt="Result"
                                            className="w-full h-full object-cover transition-transform duration-500"
                                        />

                                        {/* Overlay */}
                                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    // Trigger edit modal via parent state or special handling?
                                                    // For now, open modal is easiest entry to edit
                                                    setModalData({
                                                        resultUrl: gen.result_url,
                                                        originalUrl: gen.original_url
                                                    });
                                                }}
                                                className="p-2 bg-background/90 hover:bg-background text-foreground rounded-full shadow-sm backdrop-blur-sm transition-colors"
                                                title="Edit"
                                            >
                                                <Sparkles className="w-4 h-4 text-primary" />
                                            </button>

                                            <button
                                                onClick={async (e) => {
                                                    e.stopPropagation();
                                                    const isPaidTier = userProfile?.subscription_tier === 'starter' ||
                                                        userProfile?.subscription_tier === 'pro' ||
                                                        userProfile?.subscription_tier === 'agency';

                                                    await downloadImage({
                                                        url: gen.result_url,
                                                        isPremium: isPaidTier,
                                                        filename: `kogflow-recent-${gen.id}.jpg`
                                                    });
                                                }}
                                                className="p-2 bg-background/90 hover:bg-background text-foreground rounded-full shadow-sm backdrop-blur-sm transition-colors"
                                                title="Download"
                                            >
                                                <Download className="w-4 h-4" />
                                            </button>
                                        </div>
                                    </div>
                                ))
                            ) : (
                                <p className="col-span-full text-center text-muted-foreground py-12 bg-muted/20 rounded-xl border border-dashed border-border">
                                    No generations yet. Upload a photo to get started!
                                </p>
                            )}
                        </div>
                    </div>
                </div>

            </main>

            <footer className="py-8 border-t border-border/40 text-center text-sm text-muted-foreground">
                <p>© 2026 Kogflow. All rights reserved. (v1.2 - Async Polling)</p>
            </footer>

            {/* Modal */}
            {modalData && (
                <ImageModal
                    isOpen={!!modalData}
                    onClose={() => setModalData(null)}
                    resultUrl={modalData.resultUrl}
                    originalUrl={modalData.originalUrl}
                    user={user}
                />
            )}
        </div >
    );
}
