'use client';

import { useState } from 'react';
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

export default function DashboardPage() {
    const { user } = useAuth();
    const [activeTab, setActiveTab] = useState<'videos' | 'images' | 'captions'>('images');
    const [uploadedImages, setUploadedImages] = useState<string[]>([]);

    const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if (files && files.length > 0) {
            const newImages = Array.from(files).map(file => URL.createObjectURL(file));
            setUploadedImages(prev => [...prev, ...newImages]);
        }
    };

    const [selectedImage, setSelectedImage] = useState<string | null>(null);
    const [isStagingModalOpen, setIsStagingModalOpen] = useState(false);
    const [isGenerating, setIsGenerating] = useState(false);
    const [pendingDeleteIndex, setPendingDeleteIndex] = useState<number | null>(null);

    const handleDashboardGenerate = async (data: any) => {
        setIsGenerating(true);
        console.log("Generating with data:", data);

        // Mock delay to simulate generation
        await new Promise(resolve => setTimeout(resolve, 3000));

        // Mock Result: A staged room
        const mockResult = "https://images.unsplash.com/photo-1618221195710-dd6b41faaea6?auto=format&fit=crop&q=80&w=1000";

        // Add to the grid (newest first)
        setUploadedImages(prev => [mockResult, ...prev]);

        setIsGenerating(false);
        setIsStagingModalOpen(false);
        setSelectedImage(null);
    };

    return (
        <div className="p-4 md:p-8 max-w-7xl mx-auto space-y-8">
            {/* ... (Existing JSX) ... */}

            {/* Header, Tabs, Videos Content (Unchanged) */}

            {/* Header */}
            <div className="space-y-4">
                <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>

                {/* Tabs */}
                <div className="flex items-center gap-6 border-b border-border/40">
                    <button
                        onClick={() => setActiveTab('images')}
                        className={cn(
                            "flex items-center gap-2 pb-3 text-sm font-medium transition-all border-b-2",
                            activeTab === 'images'
                                ? "border-primary text-primary"
                                : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
                        )}
                    >
                        <ImageIcon className="w-4 h-4" />
                        Images
                    </button>
                    <button
                        onClick={() => setActiveTab('videos')}
                        className={cn(
                            "flex items-center gap-2 pb-3 text-sm font-medium transition-all border-b-2",
                            activeTab === 'videos'
                                ? "border-primary text-primary"
                                : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
                        )}
                    >
                        <Film className="w-4 h-4" />
                        Videos
                    </button>
                    <button
                        onClick={() => setActiveTab('captions')}
                        className={cn(
                            "flex items-center gap-2 pb-3 text-sm font-medium transition-all border-b-2",
                            activeTab === 'captions'
                                ? "border-primary text-primary"
                                : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
                        )}
                    >
                        <FileText className="w-4 h-4" />
                        Captions
                    </button>
                </div>
            </div>

            {/* Content Area */}
            {activeTab === 'videos' && (
                <div className="space-y-8">
                    {/* Action Bar */}
                    <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center">
                        <button className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg font-medium shadow-sm transition-colors">
                            <Plus className="w-4 h-4" />
                            Create new video
                        </button>
                    </div>

                    {/* Sub-Actions */}
                    <div className="flex items-center gap-3">
                        <button className="px-4 py-1.5 bg-background border border-primary text-primary rounded-md text-sm font-medium">
                            Video V1
                        </button>
                        <button className="flex items-center gap-2 px-4 py-1.5 hover:bg-muted text-muted-foreground rounded-md text-sm font-medium border border-transparent hover:border-border transition-colors">
                            <Crown className="w-4 h-4 text-amber-500" />
                            Remove watermark
                        </button>
                    </div>

                    {/* Video Player Card */}
                    <div className="max-w-xl">
                        <div className="bg-black/40 rounded-xl overflow-hidden border border-border/50 shadow-2xl relative group">
                            {/* Placeholder Video Area */}
                            <div className="aspect-video bg-gradient-to-b from-black/20 via-black/40 to-black/80 relative flex flex-col justify-end p-6">
                                {/* Title Overlay */}
                                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-center opacity-80">
                                    <h3 className="text-xl font-bold text-white drop-shadow-md">{user?.email?.split('@')[0] || 'User Name'}</h3>
                                </div>

                                {/* Controls Overlay */}
                                <div className="space-y-2 z-10">
                                    {/* Progress Bar */}
                                    <div className="w-full h-1 bg-white/20 rounded-full overflow-hidden">
                                        <div className="w-1/3 h-full bg-white rounded-full"></div>
                                    </div>

                                    {/* Controls Row */}
                                    <div className="flex items-center justify-between text-white">
                                        <div className="flex items-center gap-4">
                                            <button className="hover:text-primary transition-colors"><Play className="w-5 h-5 fill-current" /></button>
                                            <span className="text-xs font-mono">0:12 / 0:12</span>
                                        </div>
                                        {/* Added Delete for Video Demo */}
                                        <div className="flex items-center gap-4">
                                            <button className="hover:text-destructive transition-colors"><Trash2 className="w-4 h-4" /></button>
                                            <button><Volume2 className="w-4 h-4" /></button>
                                            <button><Maximize className="w-4 h-4" /></button>
                                            <button><MoreVertical className="w-4 h-4" /></button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Metadata & Actions */}
                        <div className="flex items-center justify-between mt-3 px-1">
                            <span className="text-xs text-muted-foreground">7 minutes ago</span>
                            <div className="flex items-center gap-2">
                                <button className="px-3 py-1.5 bg-card border border-border hover:bg-muted text-sm rounded-md transition-colors">
                                    Edit
                                </button>
                                <button className="px-3 py-1.5 bg-card border border-border hover:bg-muted text-sm rounded-md transition-colors">
                                    Share
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {activeTab === 'images' && (
                <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
                    {/* Upload Area */}
                    <div className="border-2 border-dashed border-border/50 rounded-xl bg-muted/20 hover:bg-muted/30 transition-colors p-8 flex flex-col items-center justify-center gap-6 text-center">
                        <input
                            type="file"
                            id="dashboard-image-upload"
                            className="hidden"
                            accept="image/*"
                            multiple
                            onChange={handleImageUpload}
                        />
                        <input
                            type="file"
                            id="dashboard-camera-upload"
                            className="hidden"
                            accept="image/*"
                            capture="environment"
                            onChange={handleImageUpload}
                        />

                        <div className="space-y-2">
                            <div className="p-4 bg-primary/10 rounded-full mx-auto w-fit mb-2">
                                <UploadCloud className="w-8 h-8 text-primary" />
                            </div>
                            <h3 className="text-xl font-bold">Upload photos to Project</h3>
                            <p className="text-sm text-muted-foreground max-w-sm mx-auto">
                                JPG, PNG, WEBP up to 20MB
                            </p>
                        </div>

                        <div className="flex flex-col sm:flex-row gap-3 w-full max-w-md">
                            <button
                                type="button"
                                onClick={() => document.getElementById('dashboard-image-upload')?.click()}
                                className="flex-1 px-6 py-3 bg-primary text-primary-foreground rounded-lg font-semibold hover:bg-primary/90 transition-all shadow-lg hover:shadow-xl flex items-center justify-center gap-2"
                            >
                                <UploadCloud className="w-5 h-5" />
                                Upload Image
                            </button>
                            <button
                                type="button"
                                onClick={() => document.getElementById('dashboard-camera-upload')?.click()}
                                className="flex-1 px-6 py-3 bg-secondary text-secondary-foreground rounded-lg font-semibold hover:bg-secondary/80 transition-all shadow-lg hover:shadow-xl flex items-center justify-center gap-2"
                            >
                                <ImageIcon className="w-5 h-5" />
                                Take Photo
                            </button>
                        </div>
                    </div>

                    {/* Image Grid - Only show if images exist */}
                    {uploadedImages.length > 0 && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
                            {uploadedImages.map((src, i) => (
                                <div key={i} className="group relative aspect-[4/3] bg-muted/50 rounded-xl overflow-hidden border border-border/50 hover:border-primary/50 transition-all shadow-sm hover:shadow-lg">
                                    {/* Image Placeholder */}
                                    <img
                                        src={src}
                                        alt={`Uploaded ${i}`}
                                        className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
                                    />

                                    {/* Overlay Gradient */}
                                    <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />

                                    {/* Top Actions */}
                                    <div className="absolute top-3 left-3 opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-center gap-2">
                                        <button
                                            onClick={() => {
                                                setSelectedImage(src);
                                                setIsStagingModalOpen(true);
                                            }}
                                            className="bg-background/90 hover:bg-background text-foreground text-xs font-bold px-3 py-1.5 rounded-full flex items-center gap-1.5 shadow-sm backdrop-blur-sm transition-colors"
                                        >
                                            <Sparkles className="w-3 h-3 text-primary" />
                                            AI Edit
                                        </button>
                                    </div>

                                    {/* Top Right: Delete Confirmation */}
                                    <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                                        <button
                                            className={cn(
                                                "p-1.5 rounded-full shadow-sm backdrop-blur-sm transition-all flex items-center gap-1",
                                                pendingDeleteIndex === i
                                                    ? "bg-destructive text-destructive-foreground px-2"
                                                    : "bg-background/90 hover:bg-destructive hover:text-white text-muted-foreground"
                                            )}
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                if (pendingDeleteIndex === i) {
                                                    // Confirm Delete
                                                    setUploadedImages(prev => prev.filter((_, idx) => idx !== i));
                                                    setPendingDeleteIndex(null);
                                                } else {
                                                    // Start Delete Flow
                                                    setPendingDeleteIndex(i);
                                                    // Auto reset after 3s
                                                    setTimeout(() => setPendingDeleteIndex(null), 3000);
                                                }
                                            }}
                                        >
                                            <Trash2 className="w-4 h-4" />
                                            {pendingDeleteIndex === i && <span className="text-xs font-bold">Confirm</span>}
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* Chat Bubble (Fixed) */}
            <div className="fixed bottom-6 right-6">
                <button className="w-14 h-14 bg-primary hover:bg-primary/90 text-primary-foreground rounded-full shadow-xl flex items-center justify-center transition-transform hover:scale-105">
                    <MessageCircle className="w-7 h-7" />
                </button>
            </div>

            {/* Edit Modal */}
            {isStagingModalOpen && selectedImage && (
                <DashboardStagingModal
                    isOpen={isStagingModalOpen}
                    onClose={() => setIsStagingModalOpen(false)}
                    imageUrl={selectedImage}
                    onGenerate={handleDashboardGenerate}
                    isGenerating={isGenerating}
                />
            )}
        </div>
    );
}
