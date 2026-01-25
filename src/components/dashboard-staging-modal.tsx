'use client';

import { useState, useEffect } from 'react';
import { X, Sparkles, Check, Download, Trash2, Info, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { StagingStyle, RoomType } from './staging-controls'; // Reuse types if exported, or redefine

// Redefine if not easily importable or if we want to isolate
type StagingMode = 'photo_edit' | 'virtual_staging';

interface DashboardStagingModalProps {
    isOpen: boolean;
    onClose: () => void;
    imageUrl: string;
    onGenerate: (data: any) => void;
    isGenerating: boolean;
    generatedImageUrl?: string | null;
    onUseResult?: (url: string) => void;
    onDiscard?: () => void;
    initialMode?: StagingMode;
}

const STYLES = [
    { id: 'modern', label: 'Modern furniture', desc: 'Sleek & contemporary', image: 'https://images.unsplash.com/photo-1586023492125-27b2c045efd7?w=100&h=60&fit=crop' },
    { id: 'scandinavian', label: 'Scandinavian furniture', desc: 'Clean & minimalist', image: 'https://images.unsplash.com/photo-1595526114035-0d45ed16cfbf?w=100&h=60&fit=crop' },
    { id: 'farmhouse', label: 'Farmhouse furniture', desc: 'Cozy rustic charm', image: 'https://images.unsplash.com/photo-1484154218962-a1c002085d2f?w=100&h=60&fit=crop' },
    { id: 'midcentury', label: 'Mid-century modern', desc: 'Retro & organic', image: 'https://images.unsplash.com/photo-1567016432779-094069958ea5?w=100&h=60&fit=crop' },
];

export function DashboardStagingModal({ isOpen, onClose, imageUrl, onGenerate, isGenerating, generatedImageUrl, onUseResult, onDiscard, initialMode = 'virtual_staging' }: DashboardStagingModalProps) {
    const [mode, setMode] = useState<StagingMode>(initialMode); // Default to Virtual Staging
    const [roomType, setRoomType] = useState<string>('Living Room');
    const [selectedStyle, setSelectedStyle] = useState<string>('modern');
    const [customPrompt, setCustomPrompt] = useState('');
    const [resolution, setResolution] = useState('Standard');

    // Fix missing state variables
    const [customRoomType, setCustomRoomType] = useState('');
    const [customFurnitureStyle, setCustomFurnitureStyle] = useState('');

    const [isFurnitureExpanded, setIsFurnitureExpanded] = useState(true);

    const [editOption, setEditOption] = useState<'remove_furniture' | 'declutter' | 'custom' | null>(null);

    // Preview Management
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);

    // Sync preview with new generation
    useEffect(() => {
        if (generatedImageUrl) {
            setPreviewUrl(generatedImageUrl);
        } else {
            setPreviewUrl(null);
        }
    }, [generatedImageUrl]);



    const PHOTO_EDIT_OPTIONS = [
        {
            id: 'remove_furniture',
            label: 'Remove furniture',
            desc: 'Remove all furniture in the scene',
            image: 'https://images.unsplash.com/photo-1595526114035-0d45ed16cfbf?w=100&h=60&fit=crop' // Placeholder for empty room
        },
        {
            id: 'declutter',
            label: 'Declutter',
            desc: 'Declutter and clean up the scene',
            image: 'https://images.unsplash.com/photo-1567016432779-094069958ea5?w=100&h=60&fit=crop' // Placeholder for clean room
        }
    ];

    if (!isOpen) return null;

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 bg-background md:bg-black/60 backdrop-blur-sm animate-in fade-in duration-200 md:flex md:items-center md:justify-center md:p-4">
            {/* Close Button - Fixed for Mobile, Absolute for Desktop */}
            <button
                onClick={onClose}
                className="fixed top-4 right-4 z-[60] p-2 bg-background/50 hover:bg-muted rounded-full transition-colors md:absolute md:top-6 md:right-6 md:bg-transparent"
            >
                <X className="w-6 h-6 text-foreground" />
            </button>

            <div className="bg-background w-full h-full md:max-w-6xl md:h-[90vh] md:rounded-2xl md:shadow-2xl flex flex-col md:flex-row-reverse overflow-y-auto md:overflow-hidden border-none md:border md:border-border">

                {/* Right Area - Image Preview (First in DOM, Top on Mobile, Right on Desktop) */}
                <div className="w-full md:flex-1 bg-muted/10 md:bg-muted/30 relative p-0 md:p-8 flex flex-col items-center justify-center shrink-0 min-h-[40vh]">

                    <div className="flex flex-col gap-4 w-full md:max-w-4xl p-4 md:p-0">
                        {/* Render Result if exists, else Original */}
                        {/* Render Result if exists, else Original */}
                        {generatedImageUrl ? (
                            <div className="space-y-4">
                                <div className="relative w-full rounded-2xl overflow-hidden shadow-sm border border-border bg-background group">
                                    <img
                                        src={previewUrl || generatedImageUrl}
                                        alt="Current Preview"
                                        className="w-full h-auto object-contain max-h-[60vh] md:max-h-[70vh] bg-checkerboard"
                                    />
                                    {/* Overlay Actions - Only show if viewing the Result */}
                                    {previewUrl === generatedImageUrl && (
                                        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2">
                                            <button
                                                onClick={() => onDiscard && onDiscard()} // "Delete" / Reset
                                                className="px-4 py-2 bg-white/90 text-destructive text-sm font-bold rounded-lg shadow-lg flex items-center gap-2 hover:bg-white"
                                            >
                                                <Trash2 className="w-4 h-4" />
                                                Delete
                                            </button>
                                            <button
                                                onClick={async () => {
                                                    const response = await fetch(generatedImageUrl);
                                                    const blob = await response.blob();
                                                    const url = window.URL.createObjectURL(blob);
                                                    const link = document.createElement('a');
                                                    link.href = url;
                                                    link.download = `kogflow-edit-${Date.now()}.jpg`;
                                                    document.body.appendChild(link);
                                                    link.click();
                                                    document.body.removeChild(link);
                                                }}
                                                className="px-4 py-2 bg-white/90 text-foreground text-sm font-bold rounded-lg shadow-lg flex items-center gap-2 hover:bg-white"
                                            >
                                                <Download className="w-4 h-4" />
                                                Download
                                            </button>
                                        </div>
                                    )}
                                </div>

                                {/* Thumbnails (Original + Result) */}
                                <div className="flex justify-center gap-2">
                                    <button
                                        onClick={() => setPreviewUrl(imageUrl)}
                                        className={cn(
                                            "w-16 h-12 rounded-lg overflow-hidden border-2 transition-all",
                                            previewUrl === imageUrl ? "border-primary opacity-100" : "border-transparent opacity-50 hover:opacity-100"
                                        )}
                                    >
                                        <img src={imageUrl} className="w-full h-full object-cover" />
                                    </button>
                                    <button
                                        onClick={() => setPreviewUrl(generatedImageUrl)}
                                        className={cn(
                                            "w-16 h-12 rounded-lg overflow-hidden border-2 transition-all shadow-sm",
                                            previewUrl === generatedImageUrl ? "border-primary opacity-100" : "border-transparent opacity-50 hover:opacity-100"
                                        )}
                                    >
                                        <img src={generatedImageUrl} className="w-full h-full object-cover" />
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <div className="relative w-full rounded-2xl overflow-hidden shadow-sm border border-border bg-background group">
                                <img
                                    src={imageUrl}
                                    alt="Original"
                                    className="w-full h-auto object-contain max-h-[60vh] md:max-h-[60vh]"
                                />
                            </div>
                        )}
                    </div>
                </div>

                {/* Left Sidebar - Controls (Second in DOM, Bottom on Mobile, Left on Desktop) */}
                <div className="w-full md:w-[400px] flex flex-col border-t md:border-t-0 md:border-r border-border bg-background md:bg-card/50 h-auto md:h-full shrink-0">
                    <div className="p-4 md:p-6 space-y-6 flex-1 overflow-y-auto md:overflow-y-auto">

                        {/* Segmented Control Tabs */}
                        <div className="p-1 bg-muted rounded-xl flex items-center w-full">
                            <button
                                onClick={() => setMode('photo_edit')}
                                className={cn(
                                    "flex-1 py-2 px-3 rounded-lg text-sm font-bold transition-all flex items-center justify-center gap-2",
                                    mode === 'photo_edit' ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                                )}
                            >
                                <Sparkles className="w-4 h-4" /> Photo Edit
                            </button>
                            <button
                                onClick={() => setMode('virtual_staging')}
                                className={cn(
                                    "flex-1 py-2 px-3 rounded-lg text-sm font-bold transition-all flex items-center justify-center gap-2",
                                    mode === 'virtual_staging' ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                                )}
                            >
                                <Sparkles className="w-4 h-4" />
                                <span className="flex items-center gap-2">
                                    Virtual Staging
                                    <span className="bg-teal-500 text-white text-[9px] px-1.5 rounded-full">Beta</span>
                                </span>
                            </button>
                        </div>

                        {/* Description */}
                        <div className="space-y-1">
                            <p className="text-sm text-muted-foreground">
                                We've identified key features and tailored edit options for your image. <span className="text-primary underline cursor-pointer">Learn more</span>
                            </p>
                        </div>

                        {/* Room Selector */}
                        <div className="space-y-3 p-4 border border-border rounded-xl">
                            <div className="flex items-center gap-2 font-bold text-sm">
                                <Sparkles className="w-4 h-4" />
                                Room
                            </div>
                            <div className="relative">
                                <select
                                    className="w-full px-4 py-3 bg-background border border-border rounded-xl appearance-none focus:ring-2 focus:ring-primary/20 outline-none font-medium"
                                    value={roomType}
                                    onChange={(e) => setRoomType(e.target.value)}
                                >
                                    <option>Living Room</option>
                                    <option>Bedroom</option>
                                    <option>Kitchen</option>
                                    <option>Dining Room</option>
                                    <option>Bathroom</option>
                                    <option>Other (Custom)</option>
                                </select>
                                <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                            </div>
                            {roomType === 'Other (Custom)' && (
                                <input
                                    type="text"
                                    placeholder="Enter custom room type..."
                                    className="w-full px-4 py-2 bg-background border border-border rounded-xl text-sm focus:ring-2 focus:ring-primary/20 outline-none animate-in fade-in"
                                    value={customRoomType}
                                    onChange={(e) => setCustomRoomType(e.target.value)}
                                />
                            )}
                        </div>

                        {/* Expandable Furniture / Edit Options */}
                        <div className="border border-border rounded-xl overflow-hidden">
                            <button
                                onClick={() => setIsFurnitureExpanded(!isFurnitureExpanded)}
                                className="w-full flex items-center justify-between p-4 font-bold text-sm bg-card hover:bg-muted/50 transition-colors"
                            >
                                <div className="flex items-center gap-2">
                                    <Sparkles className="w-4 h-4" />
                                    {mode === 'photo_edit' ? 'Edit Options' : 'Replace furniture'}
                                </div>
                                <ChevronDown className={cn("w-4 h-4 transition-transform duration-200", isFurnitureExpanded && "rotate-180")} />
                            </button>

                            {isFurnitureExpanded && (
                                <div className="p-4 pt-0 space-y-2 border-t border-border/50 bg-background">
                                    <div className="pt-4 space-y-2">
                                        {/* PHOTO EDIT OPTIONS */}
                                        {mode === 'photo_edit' && (
                                            <>
                                                {PHOTO_EDIT_OPTIONS.map((opt) => (
                                                    <div
                                                        key={opt.id}
                                                        onClick={() => setEditOption(opt.id as any)}
                                                        className={cn(
                                                            "group flex items-center gap-4 p-2 rounded-xl border cursor-pointer transition-all",
                                                            editOption === opt.id
                                                                ? "border-primary bg-primary/5 ring-1 ring-primary/20"
                                                                : "border-border hover:border-primary/50 hover:bg-muted/50"
                                                        )}
                                                    >
                                                        <div className="w-12 h-12 rounded-lg overflow-hidden bg-muted flex-shrink-0">
                                                            <img src={opt.image} alt={opt.label} className="w-full h-full object-cover" />
                                                        </div>
                                                        <div className="flex-1 min-w-0">
                                                            <h4 className="font-semibold text-sm truncate">{opt.label}</h4>
                                                        </div>
                                                        {editOption === opt.id && <Check className="w-4 h-4 text-primary" />}
                                                    </div>
                                                ))}
                                            </>
                                        )}

                                        {/* VIRTUAL STAGING OPTIONS */}
                                        {mode === 'virtual_staging' && (
                                            <>
                                                {STYLES.map((style) => (
                                                    <div
                                                        key={style.id}
                                                        onClick={() => setSelectedStyle(style.id)}
                                                        className={cn(
                                                            "group flex items-center gap-4 p-2 rounded-xl border cursor-pointer transition-all",
                                                            selectedStyle === style.id
                                                                ? "border-primary bg-primary/5 ring-1 ring-primary/20"
                                                                : "border-border hover:border-primary/50 hover:bg-muted/50"
                                                        )}
                                                    >
                                                        <div className="w-12 h-12 rounded-lg overflow-hidden bg-muted flex-shrink-0">
                                                            <img src={style.image} alt={style.label} className="w-full h-full object-cover" />
                                                        </div>
                                                        <div className="flex-1 min-w-0">
                                                            <h4 className="font-semibold text-sm truncate">{style.label}</h4>
                                                        </div>
                                                        {selectedStyle === style.id && <Check className="w-4 h-4 text-primary" />}
                                                    </div>
                                                ))}
                                                {/* Custom Style */}
                                                <div
                                                    onClick={() => setSelectedStyle('custom')}
                                                    className={cn(
                                                        "group p-3 rounded-xl border cursor-pointer transition-all",
                                                        selectedStyle === 'custom'
                                                            ? "border-primary bg-primary/5 ring-1 ring-primary/20"
                                                            : "border-border hover:border-primary/50 hover:bg-muted/50"
                                                    )}
                                                >
                                                    <div className="flex items-center gap-4 mb-2">
                                                        <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-violet-500/20 to-fuchsia-500/20 flex items-center justify-center flex-shrink-0">
                                                            <Sparkles className="w-5 h-5 text-primary" />
                                                        </div>
                                                        <h4 className="font-semibold text-sm">Custom Style</h4>
                                                        {selectedStyle === 'custom' && <Check className="w-4 h-4 text-primary ml-auto" />}
                                                    </div>
                                                    {selectedStyle === 'custom' && (
                                                        <input
                                                            type="text"
                                                            placeholder="e.g. Victorian Steampunk..."
                                                            className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:ring-1 focus:ring-primary outline-none"
                                                            value={customFurnitureStyle}
                                                            onChange={(e) => setCustomFurnitureStyle(e.target.value)}
                                                            onClick={(e) => e.stopPropagation()}
                                                        />
                                                    )}
                                                </div>
                                            </>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Resolution & Disclaimer */}
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <label className="text-sm font-bold flex items-center gap-2">
                                    <Sparkles className="w-4 h-4" /> Resolution
                                </label>
                                <div className="relative">
                                    <select
                                        className="w-full px-3 py-2 bg-background border border-border rounded-xl text-sm appearance-none focus:ring-1 focus:ring-primary outline-none font-medium"
                                        value={resolution}
                                        onChange={(e) => setResolution(e.target.value)}
                                    >
                                        <option>Standard</option>
                                        <option>High</option>
                                        <option>Ultra</option>
                                    </select>
                                    <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground pointer-events-none" />
                                </div>
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-bold flex items-center gap-2">
                                    <Info className="w-4 h-4" /> AI disclaimer
                                </label>
                                <div className="relative">
                                    <select className="w-full px-3 py-2 bg-background border border-border rounded-xl text-sm appearance-none focus:ring-1 focus:ring-primary outline-none font-medium">
                                        <option>None</option>
                                        <option>Watermarked</option>
                                    </select>
                                    <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground pointer-events-none" />
                                </div>
                            </div>
                        </div>

                        {/* Custom Edit */}
                        <div className="space-y-2">
                            <label className="text-sm font-bold flex items-center gap-2">
                                <Sparkles className="w-4 h-4" /> Custom edit
                            </label>
                            <textarea
                                className="w-full p-3 bg-background border border-border rounded-xl text-sm min-h-[100px] resize-none focus:ring-2 focus:ring-primary/20 outline-none placeholder:text-muted-foreground/50"
                                placeholder="Describe what edits you want to make..."
                                value={customPrompt}
                                onChange={(e) => setCustomPrompt(e.target.value)}
                            />
                        </div>

                        {/* Spacer for scroll */}
                        <div className="h-24 md:h-0"></div>

                    </div>

                    {/* Footer - Main Button */}
                    <div className="p-4 md:p-6 border-t border-border bg-background sticky bottom-0 md:relative z-10">
                        <button
                            onClick={() => onGenerate({ mode, roomType, style: selectedStyle, customPrompt, resolution, editOption })}
                            disabled={isGenerating}
                            className="w-full py-3.5 bg-teal-500 hover:bg-teal-600 text-white font-bold rounded-xl shadow-lg hover:shadow-xl transition-all flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed"
                        >
                            {isGenerating ? (
                                <>
                                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                    Processing...
                                </>
                            ) : (
                                <>
                                    <Sparkles className="w-4 h-4" />
                                    {generatedImageUrl ? 'Generate New Version' : 'Edit image'}
                                </>
                            )}
                        </button>
                    </div>
                </div>

            </div>
        </div>
    );
}
