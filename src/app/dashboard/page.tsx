'use client';

import { useState, useEffect, Suspense, useRef } from 'react';
import {
    Film,
    Image as ImageIcon,
    FileText,
    Plus,
    Crown,
    Play,
    Volume2,
    Maximize,
    MoreVertical,
    MessageCircle,
    Trash2,
    Sparkles,
    X,
    UploadCloud
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/auth-context';
import { DashboardStagingModal } from '@/components/dashboard-staging-modal';
import { CreateProjectModal } from '@/components/create-project-modal';
import { VideoCreationModal } from '@/components/video-creation-modal';
import { getProjects } from '@/app/actions/projects';
import { startEditGeneration, checkGenerationStatus } from '@/app/actions/generate';
import { uploadAsset, getProjectAssets } from '@/app/actions/assets';
import { generateVideo, checkVideoStatus, deleteVideo, updateVideoQueueStatus, getQueuedVideos } from '@/app/actions/video';
import { useSearchParams, useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { downloadImage } from '@/lib/client-download';
import { getUserProfile } from '@/app/actions/credits';

// -----------------------------------------------------------------------------
// MAIN DASHBOARD COMPONENT (Wrapped in Suspense)
// -----------------------------------------------------------------------------

function DashboardContent() {
    const { user, loading: authLoading } = useAuth();
    const router = useRouter();
    const searchParams = useSearchParams();
    const projectId = searchParams.get('project');

    // Redirect unauthenticated users to signup
    useEffect(() => {
        if (!authLoading && !user) {
            router.replace('/signup');
        }
    }, [user, authLoading, router]);

    const tabParam = searchParams.get('tab') as 'videos' | 'images' | 'captions' | null;
    const [activeTab, setActiveTab] = useState<'videos' | 'images' | 'captions'>(tabParam || 'images');

    useEffect(() => {
        if (tabParam) setActiveTab(tabParam);
    }, [tabParam]);
    const [uploadedImages, setUploadedImages] = useState<string[]>([]); // URLs only for display
    const [assets, setAssets] = useState<any[]>([]); // Full asset objects
    const [videos, setVideos] = useState<any[]>([]); // Stitched videos
    const [fileMap, setFileMap] = useState<Map<string, File>>(new Map()); // Local file map for immediate preview if needed
    const [userProfile, setUserProfile] = useState<any>(null);
    const [projectName, setProjectName] = useState('Dashboard');

    // Load Profile
    useEffect(() => {
        if (user) {
            getUserProfile(user.id).then(setUserProfile);
        }
    }, [user]);

    // Update Project Name
    useEffect(() => {
        if (user && projectId) {
            getProjects(user.id).then(res => {
                const p = res.projects?.find((p: any) => p.id === projectId);
                if (p) setProjectName(p.name);
            });
        } else {
            setProjectName('Dashboard');
        }
    }, [user, projectId]);

    // Load Project Assets
    const loadAssets = async (id: string) => {
        const { assets, generations, videos, error } = await getProjectAssets(id);
        if (error) {
            console.error("Failed to load assets:", error);
            if (error.includes("does not exist")) {
                toast.error("Database setup incomplete. Please run migrations.");
            }
            return;
        }

        // Combine assets + generations, deduplicate by URL
        const seen = new Set<string>();
        const allImages: string[] = [];
        for (const a of assets.filter((a: any) => a.type === 'image')) {
            if (!seen.has(a.url)) { seen.add(a.url); allImages.push(a.url); }
        }
        for (const g of generations) {
            if (g.result_url && !seen.has(g.result_url)) { seen.add(g.result_url); allImages.push(g.result_url); }
        }
        setUploadedImages(allImages);
        setAssets(assets);
        setVideos(videos || []);
    };

    useEffect(() => {
        if (projectId) {
            loadAssets(projectId);
        } else {
            setUploadedImages([]);
        }
    }, [projectId]);

    const handleDeleteVideo = async (videoId: number, videoUrl: string) => {
        if (!confirm('Are you sure you want to delete this video?')) return;

        try {
            const res = await deleteVideo(videoId, videoUrl);
            if (res.error) throw new Error(res.error);
            toast.success('Video deleted successfully');
            if (projectId) loadAssets(projectId);
        } catch (error: any) {
            toast.error(error.message || 'Failed to delete video');
        }
    };

    const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if (!files || files.length === 0) return;
        if (!projectId) {
            toast.error("Please create or select a project first.");
            return;
        }

        const toastId = toast.loading('Processing...');
        let lastUploadedUrl: string | null = null;

        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            const url = URL.createObjectURL(file);
            lastUploadedUrl = url;
            setUploadedImages(prev => [url, ...prev]);
            setFileMap(prev => new Map(prev).set(url, file));

            if (user) {
                const res = await uploadAsset(user.id, projectId, file);
                if (res.success) {
                    await loadAssets(projectId);
                }
            }
        }

        if (lastUploadedUrl) {
            setSelectedImage(lastUploadedUrl);
            setIsStagingModalOpen(true);
        }
        toast.dismiss(toastId);
        toast.success('Upload complete');
    };

    const [selectedImage, setSelectedImage] = useState<string | null>(null);
    const [isStagingModalOpen, setIsStagingModalOpen] = useState(false);
    const [isGenerating, setIsGenerating] = useState(false);
    const [generatedImage, setGeneratedImage] = useState<string | null>(null);
    const [pendingDeleteIndex, setPendingDeleteIndex] = useState<number | null>(null);

    // Video Modal State
    const [isVideoModalOpen, setIsVideoModalOpen] = useState(false);

    // (Removed handleVideoGenerate as it is handled within VideoCreationModal)

    const [processingVideosState, setProcessingVideosState] = useState<Set<number>>(new Set());
    const processingRef = useRef<Set<number>>(new Set());
    const [showCreateProjectModal, setShowCreateProjectModal] = useState(false);
    const [hasCheckedProjects, setHasCheckedProjects] = useState(false);
    const [previewVideoUrl, setPreviewVideoUrl] = useState<string | null>(null);

    // Initial project check
    useEffect(() => {
        async function checkProjects() {
            if (hasCheckedProjects) return;
            if (user) {
                const { projects } = await getProjects(user.id);
                if (projects && projects.length === 0) setShowCreateProjectModal(true);
            }
            setHasCheckedProjects(true);
        }
        checkProjects();
    }, [user, hasCheckedProjects]);

    const handleDashboardGenerate = async (data: any) => {
        setIsGenerating(true);
        setGeneratedImage(null);
        try {
            const formData = new FormData();
            formData.append('imageUrl', selectedImage || '');
            if (selectedImage && fileMap.has(selectedImage)) {
                formData.append('imageFile', fileMap.get(selectedImage)!);
            }
            const effectiveStyle = (data.style === 'custom' && data.customStyle)
                ? data.customStyle
                : data.style;

            let finalPrompt = data.mode === 'photo_edit' ?
                (data.editOption === 'remove_furniture' ? "Empty room, structural integrity preserved" : "Tidy up, photorealistic") :
                `Transform to ${effectiveStyle} style ${data.roomType}`;

            formData.append('prompt', finalPrompt);
            if (user) formData.append('userId', user.id);
            if (projectId) formData.append('projectId', projectId);

            const result = await startEditGeneration(formData);
            if (result.taskId) {
                let done = false;
                const poll = async () => {
                    if (done) return;
                    const status = await checkGenerationStatus(result.taskId, {
                        userId: user?.id,
                        originalUrl: selectedImage,
                        mode: 'edit',
                        style: effectiveStyle,
                        projectId: projectId
                    });
                    if (done) return; // guard against race if poll fired twice
                    if (status.status === 'success' && status.url) {
                        done = true;
                        setGeneratedImage(status.url);
                        setIsGenerating(false);
                        toast.success('Image staged successfully!');
                        if (projectId) loadAssets(projectId);
                    } else if (status.status === 'failed' || status.status === 'error') {
                        done = true;
                        setIsGenerating(false);
                        toast.error('Staging failed. Please try again.');
                    } else {
                        setTimeout(poll, 5000);
                    }
                };
                setTimeout(poll, 5000);
            }
        } catch (e: any) {
            setIsGenerating(false);
        }
    };

    // Background Queue Manager
    useEffect(() => {
        if (!user) return;

        const interval = setInterval(async () => {
            const { success, videos: queued } = await getQueuedVideos(user.id);
            if (!success || !queued) return;

            // Update local video list with processing info
            setVideos(prev => {
                const map = new Map(prev.map(v => [v.id, v]));
                queued.forEach(v => map.set(v.id, v));
                return Array.from(map.values()).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
            });

            for (const video of queued) {
                if (processingRef.current.has(video.id)) continue;

                // Start processing if queued
                if (video.status === 'queued' || video.status === 'processing') {
                    processingRef.current.add(video.id);
                    setProcessingVideosState(new Set(processingRef.current));
                    processVideo(video);
                }
            }
        }, 5000);

        return () => clearInterval(interval);
    }, [user]);

    const processVideo = async (video: any) => {
        console.log(`🎬 Processing video queue item: ${video.id}`);
        try {
            await updateVideoQueueStatus(video.id, { status: 'processing', progress: 5 });

            // 1. Generate Clips or Resume
            let taskIds = video.task_ids || [];
            if (taskIds.length === 0) {
                const res = await generateVideo({
                    imageUrls: video.image_urls,
                    title: video.title,
                    realtorInfo: video.realtor_info,
                    aspectRatio: video.aspect_ratio,
                    projectId: video.project_id,
                    userId: user?.id
                });
                if (res.error) throw new Error(res.error);
                taskIds = res.taskIds || [];
                await updateVideoQueueStatus(video.id, { task_ids: taskIds, progress: 10 });
            }

            // 2. Poll for clips
            const completedClips = new Map<string, string>();
            const imageUrls = video.image_urls;

            await new Promise<void>((resolve, reject) => {
                const pollInterval = setInterval(async () => {
                    // Check if cancelled
                    const { videos: current } = await getQueuedVideos(user?.id || '');
                    const currentVideo = current?.find(v => v.id === video.id);
                    if (!currentVideo || currentVideo.status === 'cancelled') {
                        clearInterval(pollInterval);
                        reject(new Error('Cancelled'));
                        return;
                    }

                    for (const taskId of taskIds) {
                        if (Array.from(completedClips.values()).includes(taskId)) continue;
                        const status = await checkVideoStatus(taskId) as any;
                        if (status.status === 'success') {
                            completedClips.set(taskId, status.videoUrl);
                        } else if (status.status === 'failed') {
                            clearInterval(pollInterval);
                            reject(new Error(status.error || 'Clip failed'));
                            return;
                        }
                    }

                    const prog = 10 + Math.round((completedClips.size / taskIds.length) * 70);
                    await updateVideoQueueStatus(video.id, { progress: prog });

                    if (completedClips.size === taskIds.length) {
                        clearInterval(pollInterval);
                        resolve();
                    }
                }, 5000);
            });

            // 3. Stitch
            await updateVideoQueueStatus(video.id, { progress: 85 });
            const orderedClips = taskIds.map((tid: string) => completedClips.get(tid));

            const stitchRes = await fetch('/api/stitch', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    videoUrls: orderedClips,
                    title: video.title,
                    subtitle: `Contact: ${video.realtor_info.name} ${video.realtor_info.phone}`,
                    userId: user?.id,
                    projectId: video.project_id
                })
            });

            if (!stitchRes.ok) throw new Error('Stitching failed');
            const { videoUrl: finalUrl } = await stitchRes.json();

            // 4. Complete
            await updateVideoQueueStatus(video.id, {
                status: 'completed',
                progress: 100,
                video_url: finalUrl
            });
            toast.success(`Video "${video.title}" is ready!`);
            if (projectId) loadAssets(projectId);

        } catch (error: any) {
            console.error(`Error processing video ${video.id}:`, error);
            if (error.message !== 'Cancelled') {
                await updateVideoQueueStatus(video.id, { status: 'failed', error: error.message });
                toast.error(`Video "${video.title}" failed: ${error.message}`);
            }
        } finally {
            processingRef.current.delete(video.id);
            setProcessingVideosState(new Set(processingRef.current));
        }
    };

    const handleCancelVideo = async (videoId: number) => {
        if (!confirm('Cancel this video generation?')) return;
        await updateVideoQueueStatus(videoId, { status: 'cancelled' });
        toast.info('Video generation cancelled');
    };

    return (
        <div className="p-4 md:p-8 max-w-7xl mx-auto space-y-8">
            <div className="space-y-4">
                <h1 className="text-3xl font-bold tracking-tight">{projectName}</h1>
                <div className="flex items-center gap-6 border-b border-border/40">
                    <button onClick={() => setActiveTab('images')} className={cn("flex items-center gap-2 pb-3 text-sm font-medium transition-all border-b-2", activeTab === 'images' ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground")}>
                        <ImageIcon className="w-4 h-4" /> Images
                    </button>
                    <button onClick={() => setActiveTab('videos')} className={cn("flex items-center gap-2 pb-3 text-sm font-medium transition-all border-b-2", activeTab === 'videos' ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground")}>
                        <Film className="w-4 h-4" /> Videos
                    </button>
                    <button onClick={() => setActiveTab('captions')} className={cn("flex items-center gap-2 pb-3 text-sm font-medium transition-all border-b-2", activeTab === 'captions' ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground")}>
                        <FileText className="w-4 h-4" /> Captions
                    </button>
                </div>
            </div>

            {activeTab === 'videos' && (
                <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
                    <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center">
                        <button
                            onClick={() => {
                                if (!projectId) {
                                    setShowCreateProjectModal(true);
                                    toast.info("Create or select a project first to make videos");
                                    return;
                                }
                                setIsVideoModalOpen(true);
                            }}
                            className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg font-medium shadow-sm transition-colors cursor-pointer"
                        >
                            <Plus className="w-4 h-4" /> Create new video
                        </button>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {videos.length === 0 ? (
                            <div className="col-span-full py-12 text-center bg-muted/30 rounded-xl border border-dashed border-border">
                                <Film className="w-12 h-12 mx-auto text-muted-foreground/50 mb-4" />
                                <h3 className="text-lg font-medium">No videos yet</h3>
                                <p className="text-muted-foreground">Generated videos will appear here.</p>
                            </div>
                        ) : (
                            videos.map((vid) => (
                                <div key={vid.id} className="bg-black/40 rounded-xl overflow-hidden border border-border/50 shadow-2xl group relative">
                                    {vid.status === 'completed' || !vid.status ? (
                                        <>
                                            <div className="aspect-video relative overflow-hidden">
                                                <video src={vid.video_url} className="absolute inset-0 w-full h-full object-cover opacity-60 group-hover:opacity-100 transition-opacity" muted onMouseOver={(e: any) => e.target.play()} onMouseOut={(e: any) => { e.target.pause(); e.target.currentTime = 0; }} loop />
                                                <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/40 gap-4">
                                                    <button
                                                        onClick={() => setPreviewVideoUrl(vid.video_url)}
                                                        className="w-10 h-10 flex items-center justify-center bg-white text-black rounded-full hover:scale-110 transition-transform"
                                                    >
                                                        <Play className="w-5 h-5 fill-current ml-0.5" />
                                                    </button>
                                                    <button
                                                        onClick={() => {
                                                            const { downloadVideo } = require('@/lib/client-download');
                                                            downloadVideo({ url: vid.video_url, filename: `${vid.title || 'video'}.mp4` });
                                                        }}
                                                        className="w-10 h-10 flex items-center justify-center bg-primary text-primary-foreground rounded-full hover:scale-110 transition-transform"
                                                    >
                                                        <UploadCloud className="w-5 h-5 rotate-180" />
                                                    </button>
                                                    <button onClick={() => handleDeleteVideo(vid.id, vid.video_url)} className="w-10 h-10 flex items-center justify-center bg-destructive text-destructive-foreground rounded-full hover:scale-110 transition-transform"><Trash2 className="w-4 h-4" /></button>
                                                </div>
                                            </div>
                                            <div className="p-4 bg-muted/20 border-t border-border/50">
                                                <h3 className="text-sm font-bold text-white truncate">{vid.title || 'Untitled Video'}</h3>
                                                <div className="flex items-center justify-between mt-1">
                                                    <p className="text-[10px] text-muted-foreground">{new Date(vid.created_at).toLocaleDateString()}</p>
                                                    <span className="text-[10px] bg-green-500/10 text-green-500 px-1.5 py-0.5 rounded font-bold uppercase">Ready</span>
                                                </div>
                                            </div>
                                        </>
                                    ) : (
                                        <div className="aspect-video bg-muted/20 flex flex-col items-center justify-center p-6 text-center space-y-4">
                                            {vid.status === 'failed' ? (
                                                <>
                                                    <X className="w-8 h-8 text-destructive" />
                                                    <div className="space-y-1">
                                                        <h4 className="text-sm font-bold text-white">Generation Failed</h4>
                                                        <p className="text-[10px] text-muted-foreground max-w-[180px] line-clamp-2">{vid.error || 'Unknown error occurred'}</p>
                                                    </div>
                                                    <button onClick={() => handleDeleteVideo(vid.id, vid.video_url)} className="text-[10px] text-destructive hover:underline font-bold">Dismiss</button>
                                                </>
                                            ) : vid.status === 'cancelled' ? (
                                                <>
                                                    <X className="w-8 h-8 text-muted-foreground" />
                                                    <h4 className="text-sm font-bold text-white">Cancelled</h4>
                                                    <button onClick={() => handleDeleteVideo(vid.id, vid.video_url)} className="text-[10px] text-muted-foreground hover:underline font-bold">Remove</button>
                                                </>
                                            ) : (
                                                <>
                                                    <div className="relative w-16 h-16">
                                                        <svg className="w-full h-full transform -rotate-90">
                                                            <circle cx="32" cy="32" r="28" stroke="currentColor" strokeWidth="4" fill="transparent" className="text-white/5" />
                                                            <circle cx="32" cy="32" r="28" stroke="currentColor" strokeWidth="4" fill="transparent" strokeDasharray={176} strokeDashoffset={176 - (176 * (vid.progress || 0)) / 100} className="text-primary transition-all duration-500" strokeLinecap="round" />
                                                        </svg>
                                                        <div className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-white">{vid.progress || 0}%</div>
                                                    </div>
                                                    <div className="space-y-1">
                                                        <h4 className="text-sm font-bold text-white animate-pulse">
                                                            {vid.status === 'queued' ? 'In Queue' : 'Generating...'}
                                                        </h4>
                                                        <p className="text-[10px] text-muted-foreground">{vid.title}</p>
                                                    </div>
                                                    <button onClick={() => handleCancelVideo(vid.id)} className="text-[xs] px-3 py-1 bg-white/5 hover:bg-white/10 rounded-full text-white/60 hover:text-white transition-colors text-[10px] font-bold">Cancel</button>
                                                </>
                                            )}
                                        </div>
                                    )}
                                </div>
                            ))
                        )}
                    </div>
                </div>
            )}

            {activeTab === 'images' && (
                <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
                    <div className="border-2 border-dashed border-border/50 rounded-xl bg-muted/20 hover:bg-muted/30 transition-colors p-8 flex flex-col items-center justify-center gap-6 text-center">
                        <input type="file" id="dashboard-image-upload" className="hidden" accept="image/*" multiple onChange={handleImageUpload} />
                        <div className="space-y-2">
                            <UploadCloud className="w-8 h-8 text-primary mx-auto mb-2" />
                            <h3 className="text-xl font-bold">Upload photos to Project</h3>
                            <p className="text-sm text-muted-foreground">JPG, PNG, WEBP up to 20MB</p>
                        </div>
                        <button onClick={() => document.getElementById('dashboard-image-upload')?.click()} className="px-6 py-3 bg-primary text-primary-foreground rounded-lg font-semibold hover:bg-primary/90 flex items-center gap-2">
                            <UploadCloud className="w-5 h-5" /> Upload Image
                        </button>
                    </div>

                    {uploadedImages.length > 0 && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
                            {uploadedImages.map((src, i) => (
                                <div key={i} className="group relative aspect-[4/3] bg-muted/50 rounded-xl overflow-hidden border border-border/50 hover:border-primary/50 transition-all shadow-sm">
                                    <img src={src} alt="" className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105" />
                                    <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                                    <div className="absolute top-3 left-3 opacity-0 group-hover:opacity-100 transition-opacity flex gap-2">
                                        <button onClick={() => { setSelectedImage(src); setIsStagingModalOpen(true); }} className="bg-background/90 text-xs font-bold px-3 py-1.5 rounded-full flex items-center gap-1.5 backdrop-blur-sm"><Sparkles className="w-3 h-3 text-primary" /> AI Edit</button>
                                        <button onClick={() => downloadImage({ url: src, isPremium: true, filename: `kogflow-${i}.jpg` })} className="bg-background/90 text-xs font-bold px-3 py-1.5 rounded-full flex items-center gap-1.5 backdrop-blur-sm"><UploadCloud className="w-3 h-3 rotate-180" /> Download</button>
                                    </div>
                                    <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <button onClick={() => setUploadedImages(prev => prev.filter((_, idx) => idx !== i))} className="p-1.5 bg-background/90 hover:bg-destructive hover:text-white text-muted-foreground rounded-full transition-all"><Trash2 className="w-4 h-4" /></button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            <DashboardStagingModal
                isOpen={isStagingModalOpen}
                onClose={() => { setIsStagingModalOpen(false); setSelectedImage(null); }}
                imageUrl={selectedImage || ''}
                onGenerate={handleDashboardGenerate}
                isGenerating={isGenerating}
                generatedImageUrl={generatedImage || undefined}
                onDiscard={() => { setSelectedImage(null); setGeneratedImage(null); }}
            />
            <CreateProjectModal isOpen={showCreateProjectModal} onClose={() => setShowCreateProjectModal(false)} userId={user?.id || ''} onProjectCreated={(id) => { setShowCreateProjectModal(false); window.location.href = `/dashboard?project=${id}`; }} />
            <VideoCreationModal
                isOpen={isVideoModalOpen}
                onClose={() => setIsVideoModalOpen(false)}
                projectId={projectId || ''}
                uploadedImages={uploadedImages}
                userTier={userProfile?.subscription_tier}
                userId={user?.id || ''}
                onGenerate={() => projectId && loadAssets(projectId)}
            />

            {/* Video Preview Modal */}
            {previewVideoUrl && (
                <div className="fixed inset-0 z-[100] bg-black/95 backdrop-blur-2xl flex items-center justify-center p-4">
                    <button
                        onClick={() => setPreviewVideoUrl(null)}
                        className="absolute top-6 right-6 p-3 bg-white/10 hover:bg-white/20 text-white rounded-full transition-colors z-[110]"
                    >
                        <X className="w-8 h-8" />
                    </button>
                    <div className="relative w-full max-w-5xl aspect-video rounded-2xl overflow-hidden shadow-2xl border border-white/10">
                        <video
                            src={previewVideoUrl}
                            className="w-full h-full"
                            controls
                            autoPlay
                        />
                    </div>
                </div>
            )}
        </div>
    );
}

export default function DashboardPage() {
    return (
        <Suspense fallback={<div className="flex h-screen items-center justify-center">Loading...</div>}>
            <DashboardContent />
        </Suspense>
    );
}
