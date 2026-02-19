'use client';

import { useState, ChangeEvent, DragEvent, useEffect } from 'react';
import { X, Upload, Camera, Trash2, Plus, Sparkles, Monitor, Smartphone, Play, Download } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { generateVideo, checkVideoStatus, saveVideoToProject } from '@/app/actions/video';
import { uploadAsset } from '@/app/actions/assets';

interface VideoCreationModalProps {
    isOpen: boolean;
    onClose: () => void;
    projectId: string;
    uploadedImages: string[];
    userTier?: string;
    onGenerate: (data: any) => void;
    userId: string;
}

interface ImageItem {
    id: string;
    url: string;
    order: number;
}

interface ClipStatus {
    imageUrl: string;
    taskId: string | null;
    status: 'idle' | 'generating' | 'success' | 'failed';
    videoUrl?: string;
    error?: string;
    retries: number;
}

export function VideoCreationModal({
    isOpen,
    onClose,
    projectId,
    uploadedImages: initialImages = [],
    userTier,
    onGenerate,
    userId
}: VideoCreationModalProps) {
    const [step, setStep] = useState(1);
    const [selectedImages, setSelectedImages] = useState<ImageItem[]>([]);
    const [title, setTitle] = useState('');
    const [realtorInfo, setRealtorInfo] = useState({
        name: '',
        phone: '',
        email: ''
    });
    const [aspectRatio, setAspectRatio] = useState<'16:9' | '9:16'>('16:9');
    const [isGenerating, setIsGenerating] = useState(false);
    const [progress, setProgress] = useState(0);
    const [statusMessage, setStatusMessage] = useState('');
    const [generationStep, setGenerationStep] = useState<'idle' | 'generating_clips' | 'stitching' | 'completed'>('idle');
    const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
    const [showAddConfirm, setShowAddConfirm] = useState<string | null>(null);
    const [isUploading, setIsUploading] = useState(false);

    // Track status of each clip
    const [clipStatuses, setClipStatuses] = useState<Map<string, ClipStatus>>(new Map());

    if (!isOpen) return null;

    const handleNext = () => setStep(prev => prev + 1);
    const handleBack = () => setStep(prev => prev - 1);

    const handleFileUpload = async (e: ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if (!files || files.length === 0) return;
        if (!projectId) return toast.error('No project identified');

        setIsUploading(true);
        const toastId = toast.loading('Uploading images to project...');

        try {
            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                // 1. Upload to Supabase immediately
                const res = await uploadAsset(userId, projectId, file);

                if (res.success && res.asset) {
                    setSelectedImages(prev => [
                        ...prev,
                        { id: res.asset.id || Math.random().toString(36).substr(2, 9), url: res.asset.url, order: prev.length }
                    ]);
                } else {
                    toast.error(`Failed to upload ${file.name}: ${res.error}`);
                }
            }
            toast.success('Images added to sequence');
        } catch (error: any) {
            toast.error('Upload failed');
        } finally {
            setIsUploading(false);
            toast.dismiss(toastId);
        }
    };

    const handleDelete = (id: string) => {
        setSelectedImages(prev => prev.filter(img => img.id !== id));
    };

    const addToSequence = (url: string) => {
        if (selectedImages.find(img => img.url === url)) {
            toast.error('Image already in sequence');
            setShowAddConfirm(null);
            return;
        }
        setSelectedImages(prev => [
            ...prev,
            { id: Math.random().toString(36).substr(2, 9), url, order: prev.length }
        ]);
        toast.success('Added to video');
        setShowAddConfirm(null);
    };

    const handleGenerate = async () => {
        if (selectedImages.length === 0) return toast.error('Please add at least one image');
        if (!title.trim()) return toast.error('Please enter a video title');

        setIsGenerating(true);
        setGenerationStep('generating_clips');
        setProgress(5);
        setStatusMessage('Initializing video generation...');

        try {
            const imageUrls = selectedImages.map(img => img.url);

            // Initial batch start
            const initResult = await generateVideo({
                imageUrls,
                title: title.trim(),
                realtorInfo,
                projectId,
                aspectRatio
            });

            if (initResult.error) throw new Error(initResult.error);

            // Initialize clip statuses
            const initialMap = new Map<string, ClipStatus>();
            imageUrls.forEach((url, i) => {
                const res = initResult.results?.find((r: any) => r.imageUrl === url);
                initialMap.set(url, {
                    imageUrl: url,
                    taskId: res?.taskId || null,
                    status: res?.taskId ? 'generating' : 'failed',
                    error: res?.error || undefined,
                    retries: 0
                });
            });
            setClipStatuses(initialMap);

            // Polling and Retry Logic
            await new Promise<void>((resolve, reject) => {
                const interval = setInterval(async () => {
                    const currentStatuses = Array.from(initialMap.values());
                    const pending = currentStatuses.filter(s => s.status === 'generating' || s.status === 'failed' && s.retries < 3);

                    if (pending.length === 0) {
                        clearInterval(interval);
                        const successes = Array.from(initialMap.values()).filter(s => s.status === 'success');
                        if (successes.length === 0) reject(new Error('All clips failed after retries.'));
                        else resolve();
                        return;
                    }

                    for (const clip of pending) {
                        if (clip.status === 'failed' && clip.retries < 3) {
                            // Automatically retry
                            setStatusMessage(`Retrying Clip ${imageUrls.indexOf(clip.imageUrl) + 1} (Attempt ${clip.retries + 1}/3)...`);
                            const retryRes = await generateVideo({
                                imageUrls: [clip.imageUrl],
                                title: title.trim(),
                                realtorInfo,
                                projectId,
                                aspectRatio
                            });

                            if (retryRes.success && retryRes.results?.[0].taskId) {
                                clip.taskId = retryRes.results[0].taskId;
                                clip.status = 'generating';
                                clip.retries++;
                                initialMap.set(clip.imageUrl, clip);
                            } else {
                                clip.retries++;
                                initialMap.set(clip.imageUrl, clip);
                            }
                        } else if (clip.status === 'generating' && clip.taskId) {
                            const statusRes = await checkVideoStatus(clip.taskId) as any;
                            if (statusRes.status === 'success' && statusRes.videoUrl) {
                                clip.status = 'success';
                                clip.videoUrl = statusRes.videoUrl;
                                initialMap.set(clip.imageUrl, clip);
                            } else if (statusRes.status === 'failed') {
                                clip.status = 'failed';
                                clip.error = statusRes.error;
                                initialMap.set(clip.imageUrl, clip);
                            }
                        }
                    }

                    // Update UI Progress
                    const total = imageUrls.length;
                    const doneCount = Array.from(initialMap.values()).filter(s => s.status === 'success').length;
                    setProgress(10 + Math.round((doneCount / total) * 70));
                    setStatusMessage(`Generated ${doneCount}/${total} clips...`);
                    setClipStatuses(new Map(initialMap));
                }, 5000);
            });

            // 3. Trigger Stitching
            setGenerationStep('stitching');
            setStatusMessage('Stitching clips together...');
            setProgress(85);

            const completedVideos = selectedImages
                .map(img => initialMap.get(img.url)?.videoUrl)
                .filter(Boolean) as string[];

            const stitchResponse = await fetch('/api/stitch', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    videoUrls: completedVideos,
                    title: title,
                    subtitle: `Contact: ${realtorInfo.name} ${realtorInfo.phone}`,
                    userId: userId,
                    projectId: projectId
                })
            });

            if (!stitchResponse.ok) {
                const err = await stitchResponse.json();
                throw new Error(err.error || 'Stitching failed');
            }

            const stitchResult = await stitchResponse.json();
            const finalUrl = stitchResult.videoUrl;

            if (finalUrl) {
                await saveVideoToProject({
                    userId,
                    projectId,
                    videoUrl: finalUrl,
                    title,
                    imageCount: selectedImages.length
                });
            }

            setProgress(100);
            setGenerationStep('completed');
            setStatusMessage('Video created successfully!');
            toast.success('Video created successfully!');

            setTimeout(() => {
                onGenerate(stitchResult);
                onClose();
            }, 1000);

        } catch (error: any) {
            console.error(error);
            toast.error(error.message || 'Failed to generate video');
            setIsGenerating(false);
            setGenerationStep('idle');
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 md:p-6 bg-background/80 backdrop-blur-md overflow-y-auto">
            <div className="relative w-full max-w-6xl bg-card border border-border rounded-3xl shadow-2xl overflow-hidden flex flex-col md:flex-row max-h-[90vh]">
                <button
                    onClick={onClose}
                    className="absolute top-6 right-6 p-2 rounded-full hover:bg-muted transition-colors z-10"
                >
                    <X className="w-6 h-6" />
                </button>

                {/* Left Side: Preview area or Progress */}
                <div className="md:w-1/2 bg-black flex items-center justify-center aspect-video md:aspect-auto">
                    {isGenerating ? (
                        <div className="text-center space-y-8 p-12 w-full max-w-md">
                            <div className="relative w-32 h-32 mx-auto">
                                <svg className="w-full h-full transform -rotate-90">
                                    <circle
                                        cx="64" cy="64" r="60"
                                        stroke="currentColor"
                                        strokeWidth="8"
                                        fill="transparent"
                                        className="text-muted-foreground/20"
                                    />
                                    <circle
                                        cx="64" cy="64" r="60"
                                        stroke="currentColor"
                                        strokeWidth="8"
                                        fill="transparent"
                                        strokeDasharray={377}
                                        strokeDashoffset={377 - (377 * progress) / 100}
                                        className="text-primary transition-all duration-500 ease-out"
                                        strokeLinecap="round"
                                    />
                                </svg>
                                <div className="absolute inset-0 flex items-center justify-center">
                                    <span className="text-3xl font-bold">{progress}%</span>
                                </div>
                            </div>
                            <div className="space-y-4">
                                <h3 className="text-2xl font-bold text-white tracking-tight">
                                    {generationStep === 'stitching' ? 'Processing Final Video' : 'Generating Clips'}
                                </h3>
                                <div className="space-y-2">
                                    <p className="text-muted-foreground animate-pulse text-lg">{statusMessage}</p>
                                    <p className="text-primary/80 font-medium italic">
                                        Please check back after having a coffee and your video should be done ☕
                                    </p>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="w-full h-full flex items-center justify-center p-8 text-center text-muted-foreground">
                            {selectedImages.length === 0 ? (
                                <div className="space-y-4">
                                    <Monitor className="w-16 h-16 mx-auto opacity-20" />
                                    <p className="text-xl">Your movie will appear here</p>
                                </div>
                            ) : (
                                <div className="relative w-full aspect-video rounded-xl overflow-hidden border border-border shadow-2xl group">
                                    <img
                                        src={selectedImages[0].url}
                                        alt="Preview"
                                        className="w-full h-full object-cover"
                                    />
                                    <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                                        <Play className="w-16 h-16 text-white fill-current opacity-80 group-hover:scale-110 transition-transform" />
                                    </div>
                                    <div className="absolute bottom-4 left-4 right-4 text-left">
                                        <p className="text-xs font-bold text-primary mb-1">PREVIEW</p>
                                        <p className="text-xl font-bold text-white uppercase">{title || 'Untitled Project'}</p>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* Right Side: Configuration Steps */}
                <div className="md:w-1/2 p-8 md:p-12 overflow-y-auto">
                    {step === 1 && (
                        <div className="space-y-8 h-full flex flex-col">
                            <div className="space-y-2">
                                <div className="flex items-center gap-3 mb-1">
                                    <span className="w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold text-sm">1</span>
                                    <h2 className="text-3xl font-bold">Plan Your Video</h2>
                                </div>
                                <p className="text-muted-foreground">Select and order the photos for your video presentation.</p>
                            </div>

                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 pb-4">
                                {selectedImages.map((img, index) => (
                                    <div key={img.id} className="group relative aspect-square bg-muted rounded-2xl border border-border hover:border-primary/50 transition-all overflow-hidden cursor-move">
                                        <img src={img.url} alt="" className="w-full h-full object-cover" />
                                        <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                            <button onClick={() => handleDelete(img.id)} className="p-1.5 bg-destructive text-destructive-foreground rounded-full shadow-lg"><Trash2 className="w-3.5 h-3.5" /></button>
                                        </div>
                                        <div className="absolute top-2 left-2 w-6 h-6 bg-black/60 backdrop-blur-md rounded-full flex items-center justify-center text-xs font-bold text-white">
                                            {index + 1}
                                        </div>
                                    </div>
                                ))}
                                <button
                                    onClick={() => document.getElementById('video-upload')?.click()}
                                    disabled={isUploading}
                                    className="aspect-square border-2 border-dashed border-border rounded-2xl flex flex-col items-center justify-center gap-2 hover:bg-muted/50 hover:border-primary/40 transition-all disabled:opacity-50"
                                >
                                    {isUploading ? (
                                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                                    ) : (
                                        <>
                                            <Plus className="w-8 h-8 text-muted-foreground" />
                                            <span className="text-sm font-medium">Add Photo</span>
                                        </>
                                    )}
                                </button>
                                <input type="file" id="video-upload" className="hidden" accept="image/*" multiple onChange={handleFileUpload} />
                            </div>

                            <div className="flex flex-col gap-6">
                                <div className="space-y-3">
                                    <h3 className="font-bold flex items-center gap-2">
                                        <Monitor className="w-4 h-4" /> RECENT ASSETS
                                    </h3>
                                    <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-hide">
                                        {initialImages.map((url, i) => (
                                            <button
                                                key={i}
                                                onClick={() => addToSequence(url)}
                                                className="shrink-0 w-20 h-20 rounded-xl overflow-hidden border border-border hover:border-primary transition-all relative group"
                                            >
                                                <img src={url} alt="" className="w-full h-full object-cover" />
                                                <div className="absolute inset-0 bg-primary/20 opacity-0 group-hover:opacity-100 flex items-center justify-center">
                                                    <Plus className="w-5 h-5 text-white" />
                                                </div>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                                <button
                                    onClick={handleNext}
                                    disabled={selectedImages.length === 0}
                                    className="w-full py-4 bg-primary text-primary-foreground rounded-2xl font-bold text-lg hover:bg-primary/90 transition-all shadow-xl hover:shadow-primary/20 disabled:opacity-50"
                                >
                                    Configure Video →
                                </button>
                            </div>
                        </div>
                    )}

                    {step === 2 && (
                        <div className="space-y-8 h-full flex flex-col">
                            <div className="space-y-2">
                                <div className="flex items-center gap-3 mb-1">
                                    <span className="w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold text-sm">2</span>
                                    <h2 className="text-3xl font-bold">Details & Style</h2>
                                </div>
                                <p className="text-muted-foreground">Add finishing touches to your video production.</p>
                            </div>

                            <div className="space-y-6 flex-1">
                                <div className="space-y-2">
                                    <label className="block text-sm font-bold ml-1">Project Video Title</label>
                                    <input
                                        type="text"
                                        placeholder="e.g. 123 Luxury Lane Presentation"
                                        value={title}
                                        onChange={(e) => setTitle(e.target.value)}
                                        className="w-full px-5 py-4 bg-muted border-none rounded-2xl outline-none focus:ring-2 ring-primary/50 transition-all font-medium text-lg"
                                    />
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <button
                                        onClick={() => setAspectRatio('16:9')}
                                        className={cn(
                                            "p-4 rounded-2xl border-2 transition-all flex flex-col items-center gap-3",
                                            aspectRatio === '16:9' ? "border-primary bg-primary/5" : "border-border hover:border-primary/30"
                                        )}
                                    >
                                        <Monitor className={cn("w-8 h-8", aspectRatio === '16:9' ? "text-primary" : "text-muted-foreground")} />
                                        <div className="text-center">
                                            <p className="font-bold">Horizontal</p>
                                            <p className="text-xs text-muted-foreground">16:9 Widescreen</p>
                                        </div>
                                    </button>
                                    <button
                                        onClick={() => setAspectRatio('9:16')}
                                        className={cn(
                                            "p-4 rounded-2xl border-2 transition-all flex flex-col items-center gap-3",
                                            aspectRatio === '9:16' ? "border-primary bg-primary/5" : "border-border hover:border-primary/30"
                                        )}
                                    >
                                        <Smartphone className={cn("w-8 h-8", aspectRatio === '9:16' ? "text-primary" : "text-muted-foreground")} />
                                        <div className="text-center">
                                            <p className="font-bold">Vertical</p>
                                            <p className="text-xs text-muted-foreground">9:16 Tiktok/Shorts</p>
                                        </div>
                                    </button>
                                </div>

                                <div className="p-6 bg-muted/30 rounded-2xl border border-border/50 space-y-4">
                                    <h3 className="font-bold flex items-center gap-2">Realtor Branding</h3>
                                    <div className="grid gap-4">
                                        <input
                                            type="text"
                                            placeholder="Your Full Name"
                                            value={realtorInfo.name}
                                            onChange={(e) => setRealtorInfo({ ...realtorInfo, name: e.target.value })}
                                            className="w-full px-4 py-3 bg-card border border-border rounded-xl outline-none focus:border-primary"
                                        />
                                        <input
                                            type="tel"
                                            placeholder="Phone Number"
                                            value={realtorInfo.phone}
                                            onChange={(e) => setRealtorInfo({ ...realtorInfo, phone: e.target.value })}
                                            className="w-full px-4 py-3 bg-card border border-border rounded-xl outline-none focus:border-primary"
                                        />
                                    </div>
                                </div>
                            </div>

                            <div className="flex gap-4 pt-4">
                                <button onClick={handleBack} className="shrink-0 w-14 h-14 bg-muted rounded-2xl flex items-center justify-center hover:bg-muted/80 transition-all font-bold">←</button>
                                <button
                                    onClick={handleGenerate}
                                    disabled={!title.trim() || isGenerating}
                                    className="flex-1 py-4 bg-primary text-primary-foreground rounded-2xl font-bold text-lg hover:bg-primary/90 transition-all shadow-xl hover:shadow-primary/20 flex items-center justify-center gap-2"
                                >
                                    <Sparkles className="w-5 h-5" />
                                    Generate Master Video
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
