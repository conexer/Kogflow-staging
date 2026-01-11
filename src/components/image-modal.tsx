'use client';

import { useState, useRef, useEffect } from 'react';
import { X, Download, Share2, ZoomIn, Loader2, Wand2 } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { getUserProfile } from '@/app/actions/credits';
import { startEditGeneration, checkGenerationStatus } from '@/app/actions/generate';
import { useAuth } from '@/lib/auth-context';

/* 
 * ImageModal Component
 * 
 * Props:
 * - resultUrl: string (Required)
 * - originalUrl?: string (Optional)
 * - isOpen: boolean
 * - onClose: () => void
 * - userTier?: string (Optional, if known, else we fetch/guess)
 */

interface ImageModalProps {
    resultUrl: string;
    originalUrl?: string; // Optional for now if we just want to show result
    isOpen: boolean;
    onClose: () => void;
    user: any; // Context user object
}

export function ImageModalV2({ resultUrl, originalUrl, isOpen, onClose, user }: ImageModalProps) {
    const [activeImage, setActiveImage] = useState<'result' | 'original'>('result');
    const [isProcessing, setIsProcessing] = useState(false);
    const [userProfile, setUserProfile] = useState<any>(null);
    const [currentResultUrl, setCurrentResultUrl] = useState(resultUrl);

    // Edit Mode State
    const [isEditing, setIsEditing] = useState(false);
    const [editPrompt, setEditPrompt] = useState('');
    const [isGeneratingEdit, setIsGeneratingEdit] = useState(false);

    // Update currentResultUrl when prop changes
    useEffect(() => {
        setCurrentResultUrl(resultUrl);
        // Reset edit mode when opening a new image
        setIsEditing(false);
        setEditPrompt('');
    }, [resultUrl, isOpen]);

    // Fetch profile
    useEffect(() => {
        if (user && isOpen) {
            getUserProfile(user.id).then(setUserProfile);
        }
    }, [user, isOpen]);

    // Reset to result when opening new image
    useEffect(() => {
        if (isOpen) setActiveImage('result');
    }, [isOpen, originalUrl]);

    if (!isOpen) return null;

    // Strict check: explicitly check for paid tiers. Anything else (including null, undefined, 'free', '') is treated as free.
    const isPaidTier = userProfile?.subscription_tier === 'starter' ||
        userProfile?.subscription_tier === 'pro' ||
        userProfile?.subscription_tier === 'agency';

    // If not paid, it starts as free.
    const isFreeTier = !isPaidTier;

    // Process Image (Watermark or Proxy)
    const processImage = async (): Promise<Blob | null> => {
        try {
            // 1. Fetch image data (bypass CORS with proxy if needed or direct if allowed)
            // Use our proxy to get the blob safely for canvas
            // Use currentResultUrl if activeImage is result, else originalUrl (but usually we download result)
            // Logic: we download what is VIEWED? Or always result?
            // Existing logic downloaded resultUrl always. 
            // Let's stick to currentResultUrl (which might be the edited one).

            const urlToProcess = activeImage === 'result' ? currentResultUrl : (originalUrl || currentResultUrl);

            const response = await fetch(`/api/download?url=${encodeURIComponent(urlToProcess)}`);
            if (!response.ok) throw new Error('Fetch failed');
            const blob = await response.blob();

            // If Paid Tier, return raw blob (no watermark)
            if (!isFreeTier) {
                return blob;
            }

            // If Free Tier, Watermark it
            const bitmap = await createImageBitmap(blob);
            const canvas = document.createElement('canvas'); // Off-screen canvas
            canvas.width = bitmap.width;
            canvas.height = bitmap.height;
            const ctx = canvas.getContext('2d');

            if (!ctx) throw new Error('Canvas error');

            // Draw original image
            ctx.drawImage(bitmap, 0, 0);

            // Configure Watermark - HIGH VISIBILITY
            // 50% opacity
            ctx.globalAlpha = 0.5;

            // Font size relative to image width (e.g., 8% of width)
            const fontSize = Math.max(24, Math.floor(canvas.width * 0.08));
            ctx.font = `bold ${fontSize}px sans-serif`;
            ctx.fillStyle = 'white';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';

            // Strong Shadow for visibility on light backgrounds
            ctx.shadowColor = "rgba(0,0,0,0.9)";
            ctx.shadowBlur = 6;
            ctx.shadowOffsetX = 3;
            ctx.shadowOffsetY = 3;

            // Text
            const text = "KogFlow.com";

            // Position: Lower 1/3 centered
            const x = canvas.width / 2;
            const y = canvas.height * 0.85; // Lower down (85% height)

            // Draw Text
            ctx.fillText(text, x, y);

            // Reset shadow
            ctx.shadowColor = "transparent";

            return new Promise((resolve) => {
                canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.95);
            });

        } catch (error) {
            console.error(error);
            toast.error('Failed to process image');
            return null;
        }
    };

    const handleDownload = async () => {
        setIsProcessing(true);
        const toastId = toast.loading('Preparing download...');

        try {
            const blob = await processImage();
            if (!blob) throw new Error('Processing failed');

            // check if mobile device (simple check)
            const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

            // On mobile, "Download" usually means "Save to Photos", which requires the Share Sheet
            if (isMobile && navigator.share && navigator.canShare) {
                const file = new File([blob], 'kogflow-render.jpg', { type: 'image/jpeg' });
                if (navigator.canShare({ files: [file] })) {
                    await navigator.share({
                        files: [file],
                        // No text/title to keep it clean for "Saving"
                    });
                    toast.dismiss(toastId);
                    return;
                }
            }

            // Default Desktop / Fallback behavior
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `kogflow-render-${Date.now()}.jpg`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);

            toast.dismiss(toastId);
            toast.success(isFreeTier ? 'Downloaded (Free Tier Watermark)' : 'Downloaded HD');

        } catch (e: any) {
            toast.dismiss(toastId);
            if (e.name !== 'AbortError') { // Ignore user cancellation
                toast.error('Download failed');
            }
        } finally {
            setIsProcessing(false);
        }
    };

    const handleShare = async () => {
        if (!navigator.share) {
            toast.error('Sharing not supported on this device');
            return;
        }

        setIsProcessing(true);
        const toastId = toast.loading('Preparing to share...');

        try {
            const blob = await processImage();
            if (!blob) throw new Error('Processing failed');

            const file = new File([blob], 'kogflow-render.jpg', { type: 'image/jpeg' });

            if (navigator.canShare && navigator.canShare({ files: [file] })) {
                await navigator.share({
                    files: [file],
                    title: 'My Dream Room',
                    text: 'Check out this virtual staging from KogFlow!',
                });
                toast.dismiss(toastId);
                // toast.success('Shared!'); // Browsers often show their own success UI
            } else {
                throw new Error('Device refuses file sharing');
            }

        } catch (e: any) {
            toast.dismiss(toastId);
            if (e.name !== 'AbortError') { // Ignore user cancellation
                toast.error('Share failed');
            }
        } finally {
            setIsProcessing(false);
        }
    };

    const handleEdit = async () => {
        if (!editPrompt.trim()) {
            toast.error('Please enter a prompt to edit the image');
            return;
        }

        setIsGeneratingEdit(true);

        // Determine source image based on what the user is looking at
        const sourceUrl = activeImage === 'result' ? currentResultUrl : originalUrl;

        if (!sourceUrl) {
            toast.error('No image selected to edit');
            setIsGeneratingEdit(false);
            return;
        }

        try {
            const formData = new FormData();
            formData.append('imageUrl', sourceUrl);
            formData.append('prompt', editPrompt);
            if (user?.id) formData.append('userId', user.id);

            const result = await startEditGeneration(formData);

            if (result.error) {
                throw new Error(result.error);
            }

            if (result.success && result.taskId) {
                // Poll
                const pollInterval = setInterval(async () => {
                    const status = await checkGenerationStatus(result.taskId, {
                        userId: user.id || null,
                        originalUrl: sourceUrl,
                        mode: 'edit',
                        style: 'custom'
                    });

                    if (status.status === 'success' && status.url) {
                        clearInterval(pollInterval);
                        setCurrentResultUrl(status.url);
                        setActiveImage('result');
                        setIsGeneratingEdit(false);
                        setIsEditing(false);
                        setEditPrompt('');
                        toast.success('Edit complete!');
                    } else if (status.status === 'failed' || status.status === 'error') {
                        clearInterval(pollInterval);
                        setIsGeneratingEdit(false);
                        toast.error(status.error || 'Edit failed');
                    }
                }, 2000);
            }

        } catch (error: any) {
            console.error(error);
            toast.error(error.message || 'Failed to start edit');
            setIsGeneratingEdit(false);
        }
    };

    return (
        <div
            className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/90 backdrop-blur-sm animate-in fade-in duration-200"
            onClick={onClose}
        >
            <div
                className="relative max-w-5xl w-full bg-background rounded-2xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-border/40">
                    <h3 className="font-semibold text-lg">Image Details v2</h3>
                    <div className="flex items-center gap-2">
                        {originalUrl && (
                            <div className="flex bg-muted rounded-lg p-1 mr-4">
                                <button
                                    onClick={() => setActiveImage('original')}
                                    className={cn(
                                        "px-3 py-1.5 text-xs font-medium rounded-md transition-all",
                                        activeImage === 'original' ? "bg-background shadow text-foreground" : "text-muted-foreground hover:text-foreground"
                                    )}
                                >
                                    Original
                                </button>
                                <button
                                    onClick={() => setActiveImage('result')}
                                    className={cn(
                                        "px-3 py-1.5 text-xs font-medium rounded-md transition-all",
                                        activeImage === 'result' ? "bg-background shadow text-foreground" : "text-muted-foreground hover:text-foreground"
                                    )}
                                >
                                    Result
                                </button>
                            </div>
                        )}

                        <button
                            onClick={onClose}
                            className="p-2 hover:bg-muted rounded-full transition-colors"
                        >
                            <X className="w-5 h-5" />
                        </button>
                    </div>
                </div>

                {/* Content */}
                <div className="flex-1 bg-muted/30 relative overflow-hidden flex items-center justify-center p-4 min-h-[300px]">
                    <img
                        src={activeImage === 'result' ? currentResultUrl : originalUrl}
                        alt="View"
                        className="max-w-full max-h-full object-contain rounded-lg shadow-sm"
                    />

                    {/* Visual Watermark Overlay for Free Tier */}
                    {isFreeTier && activeImage === 'result' && (
                        <div className="absolute inset-0 pointer-events-none flex items-end justify-center pb-[10%] sm:pb-[5%]">
                            <span className="text-white/40 text-4xl sm:text-6xl font-bold drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)] select-none">
                                KogFlow.com
                            </span>
                        </div>
                    )}

                    {/* Edit Overlay */}
                    {isEditing && (
                        <div className="absolute inset-x-4 bottom-4 bg-background/95 backdrop-blur-md rounded-xl border border-border/50 shadow-2xl p-4 animate-in slide-in-from-bottom-2 fade-in duration-200">
                            <div className="flex flex-col gap-3">
                                <div className="flex items-center justify-between">
                                    <h4 className="font-semibold text-sm">Edit Image</h4>
                                    <button onClick={() => setIsEditing(false)} className="text-muted-foreground hover:text-foreground">
                                        <X className="w-4 h-4" />
                                    </button>
                                </div>
                                <div className="flex items-end gap-2">
                                    <textarea
                                        value={editPrompt}
                                        onChange={(e) => setEditPrompt(e.target.value)}
                                        placeholder="E.g. change sofa to grey, add a rug..."
                                        className="flex-1 min-h-[60px] bg-muted/50 rounded-lg p-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/50"
                                        autoFocus
                                    />
                                    <button
                                        onClick={handleEdit}
                                        disabled={isGeneratingEdit || !editPrompt.trim()}
                                        className="h-[60px] px-4 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed flex flex-col items-center justify-center min-w-[80px]"
                                    >
                                        {isGeneratingEdit ? (
                                            <Loader2 className="w-5 h-5 animate-spin" />
                                        ) : (
                                            <>
                                                <Wand2 className="w-4 h-4 mb-1" />
                                                <span className="text-xs">Generate</span>
                                            </>
                                        )}
                                    </button>
                                </div>
                                <p className="text-[10px] text-muted-foreground">
                                    Editing generates a new variation. 1 Credit per edit.
                                </p>
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer Actions */}
                <div className="p-4 border-t border-border/40 bg-card flex items-center justify-between gap-4">
                    <div className="text-sm text-muted-foreground hidden sm:block">
                        {isFreeTier && activeImage === 'result' && (
                            <span className="flex items-center gap-2 text-amber-500/80">
                                🔒 Watermarked (Free Tier)
                            </span>
                        )}
                    </div>

                    <div className="flex items-center gap-3 w-full sm:w-auto">
                        {!isEditing && (
                            <button
                                onClick={() => setIsEditing(true)}
                                disabled={isProcessing}
                                className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-6 py-2.5 bg-secondary text-secondary-foreground rounded-lg font-medium hover:bg-secondary/80 transition-colors disabled:opacity-50 border border-border/50"
                            >
                                <Wand2 className="w-4 h-4" />
                                Edit
                            </button>
                        )}

                        <button
                            onClick={handleShare}
                            disabled={isProcessing}
                            className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-6 py-2.5 bg-secondary text-secondary-foreground rounded-lg font-medium hover:bg-secondary/80 transition-colors disabled:opacity-50"
                        >
                            <Share2 className="w-4 h-4" />
                            Share
                        </button>

                        <button
                            onClick={handleDownload}
                            disabled={isProcessing}
                            className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-6 py-2.5 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 transition-colors shadow-lg disabled:opacity-50"
                        >
                            {isProcessing ? (
                                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                            ) : (
                                <Download className="w-4 h-4" />
                            )}
                            Download
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
