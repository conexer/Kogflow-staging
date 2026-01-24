'use client';

import { useState } from 'react';
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
}

const STYLES = [
    { id: 'modern', label: 'Modern furniture', desc: 'Sleek & contemporary', image: 'https://images.unsplash.com/photo-1586023492125-27b2c045efd7?w=100&h=60&fit=crop' },
    { id: 'scandinavian', label: 'Scandinavian furniture', desc: 'Clean & minimalist', image: 'https://images.unsplash.com/photo-1595526114035-0d45ed16cfbf?w=100&h=60&fit=crop' },
    { id: 'farmhouse', label: 'Farmhouse furniture', desc: 'Cozy rustic charm', image: 'https://images.unsplash.com/photo-1556910103-1c02745a30bf?w=100&h=60&fit=crop' },
    { id: 'midcentury', label: 'Mid-century modern', desc: 'Retro & organic', image: 'https://images.unsplash.com/photo-1567016432779-094069958ea5?w=100&h=60&fit=crop' },
];

export function DashboardStagingModal({ isOpen, onClose, imageUrl, onGenerate, isGenerating }: DashboardStagingModalProps) {
    const [mode, setMode] = useState<StagingMode>('virtual_staging');
    const [roomType, setRoomType] = useState<string>('Living Room');
    const [selectedStyle, setSelectedStyle] = useState<string>('modern');
    const [customPrompt, setCustomPrompt] = useState('');
    const [resolution, setResolution] = useState('Standard');

    const [isFurnitureExpanded, setIsFurnitureExpanded] = useState(true);

    const [customRoomType, setCustomRoomType] = useState('');
    const [customFurnitureStyle, setCustomFurnitureStyle] = useState('');

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-background w-full max-w-6xl h-[90vh] rounded-2xl shadow-2xl flex overflow-hidden border border-border">

                {/* Left Sidebar - Controls */}
                <div className="w-[400px] flex flex-col border-r border-border bg-card/50">
                    <div className="p-6 space-y-6 flex-1 overflow-y-auto">

                        {/* Header Tabs */}
                        <div className="flex items-center gap-2 p-1 bg-muted rounded-lg w-fit">
                            <button
                                onClick={() => setMode('photo_edit')}
                                className={cn(
                                    "px-4 py-2 rounded-md text-sm font-medium transition-all flex items-center gap-2",
                                    mode === 'photo_edit' ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
                                )}
                            >
                                <Sparkles className="w-4 h-4" /> Photo Edit
                            </button>
                            <button
                                onClick={() => setMode('virtual_staging')}
                                className={cn(
                                    "px-4 py-2 rounded-md text-sm font-medium transition-all flex items-center gap-2",
                                    mode === 'virtual_staging' ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
                                )}
                            >
                                <Sparkles className="w-4 h-4" /> Virtual Staging
                            </button>
                        </div>

                        {/* Description */}
                        <div className="space-y-1">
                            <div className="flex items-center justify-between">
                                <p className="text-sm text-muted-foreground">
                                    We've identified key features and tailored edit options for your image. <span className="text-primary underline cursor-pointer">Learn more</span>
                                </p>
                                <span className="px-2 py-0.5 rounded-full bg-teal-500/10 text-teal-600 text-[10px] font-bold uppercase tracking-wider">Beta</span>
                            </div>
                        </div>

                        <hr className="border-border/50" />

                        {/* Room Selector */}
                        <div className="space-y-2">
                            <div className="flex items-center gap-2 font-medium text-sm">
                                <span className="p-1.5 bg-muted rounded-md"><Sparkles className="w-4 h-4" /></span>
                                Room
                            </div>
                            <div className="space-y-2">
                                <div className="relative">
                                    <select
                                        className="w-full px-4 py-3 bg-background border border-border rounded-xl appearance-none focus:ring-2 focus:ring-primary/20 outline-none"
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
                                        className="w-full px-4 py-2 bg-background border border-border rounded-xl text-sm focus:ring-2 focus:ring-primary/20 outline-none animate-in fade-in slide-in-from-top-1"
                                        value={customRoomType}
                                        onChange={(e) => setCustomRoomType(e.target.value)}
                                    />
                                )}
                            </div>
                        </div>

                        <hr className="border-border/50" />

                        {/* Replace Furniture (Styles) */}
                        <div className="space-y-3">
                            <button
                                onClick={() => setIsFurnitureExpanded(!isFurnitureExpanded)}
                                className="w-full flex items-center justify-between font-medium text-sm cursor-pointer hover:text-primary transition-colors group"
                            >
                                <div className="flex items-center gap-2">
                                    <span className="p-1.5 bg-muted rounded-md group-hover:bg-primary/10 transition-colors"><Sparkles className="w-4 h-4" /></span>
                                    Replace furniture
                                </div>
                                <ChevronDown className={cn("w-4 h-4 transition-transform duration-200", isFurnitureExpanded && "rotate-180")} />
                            </button>

                            {isFurnitureExpanded && (
                                <div className="space-y-2 animate-in slide-in-from-top-2 duration-200">
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
                                            <div className="w-16 h-12 rounded-lg overflow-hidden bg-muted flex-shrink-0">
                                                <img src={style.image} alt={style.label} className="w-full h-full object-cover" />
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <h4 className="font-semibold text-sm truncate">{style.label}</h4>
                                                <p className="text-xs text-muted-foreground truncate">{style.desc}</p>
                                            </div>
                                            {selectedStyle === style.id && <Check className="w-4 h-4 text-primary" />}
                                        </div>
                                    ))}
                                    {/* Custom Style Option */}
                                    <div
                                        onClick={() => setSelectedStyle('custom')}
                                        className={cn(
                                            "group flex flex-col gap-2 p-2 rounded-xl border cursor-pointer transition-all",
                                            selectedStyle === 'custom'
                                                ? "border-primary bg-primary/5 ring-1 ring-primary/20"
                                                : "border-border hover:border-primary/50 hover:bg-muted/50"
                                        )}
                                    >
                                        <div className="flex items-center gap-4">
                                            <div className="w-16 h-12 rounded-lg bg-gradient-to-br from-violet-500/20 to-fuchsia-500/20 flex items-center justify-center flex-shrink-0">
                                                <Sparkles className="w-5 h-5 text-primary" />
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <h4 className="font-semibold text-sm">Custom Style</h4>
                                                <p className="text-xs text-muted-foreground">Define your own style</p>
                                            </div>
                                            {selectedStyle === 'custom' && <Check className="w-4 h-4 text-primary" />}
                                        </div>

                                        {selectedStyle === 'custom' && (
                                            <div className="mt-2 pl-2 pr-2 pb-2">
                                                <input
                                                    type="text"
                                                    placeholder="e.g. Victorian Steampunk..."
                                                    className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:ring-1 focus:ring-primary outline-none"
                                                    value={customFurnitureStyle}
                                                    onChange={(e) => setCustomFurnitureStyle(e.target.value)}
                                                    onClick={(e) => e.stopPropagation()}
                                                />
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>

                        <hr className="border-border/50" />

                        {/* Resolution & Disclaimer */}
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <label className="text-sm font-medium flex items-center gap-2">
                                    <Sparkles className="w-4 h-4" /> Resolution
                                </label>
                                <div className="relative">
                                    <select
                                        className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm appearance-none focus:ring-1 focus:ring-primary outline-none"
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
                                <label className="text-sm font-medium flex items-center gap-2">
                                    <Info className="w-4 h-4" /> AI disclaimer
                                </label>
                                <div className="relative">
                                    <select className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm appearance-none focus:ring-1 focus:ring-primary outline-none">
                                        <option>None</option>
                                        <option>Watermarked</option>
                                    </select>
                                    <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground pointer-events-none" />
                                </div>
                            </div>
                        </div>

                        <hr className="border-border/50" />

                        {/* Custom Edit */}
                        <div className="space-y-2">
                            <label className="text-sm font-medium flex items-center gap-2">
                                <Sparkles className="w-4 h-4" /> Custom edit
                            </label>
                            <textarea
                                className="w-full p-3 bg-background border border-border rounded-xl text-sm min-h-[100px] resize-none focus:ring-2 focus:ring-primary/20 outline-none placeholder:text-muted-foreground/50"
                                placeholder="Describe what edits you want to make..."
                                value={customPrompt}
                                onChange={(e) => setCustomPrompt(e.target.value)}
                            />
                        </div>

                    </div>

                    {/* Footer - Main Button */}
                    <div className="p-6 border-t border-border bg-background">
                        <button
                            onClick={() => onGenerate({ mode, roomType, style: selectedStyle, customPrompt, resolution })}
                            disabled={isGenerating}
                            className="w-full py-3.5 bg-gradient-to-r from-teal-400 to-emerald-400 hover:from-teal-500 hover:to-emerald-500 text-white font-bold rounded-xl shadow-lg hover:shadow-xl transition-all flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed"
                        >
                            {isGenerating ? (
                                <>
                                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                    Processing...
                                </>
                            ) : (
                                <>
                                    <Sparkles className="w-4 h-4" /> Edit image
                                </>
                            )}
                        </button>
                    </div>
                </div>

                {/* Right Area - Image Preview */}
                <div className="flex-1 bg-muted/30 relative p-8 flex items-center justify-center">
                    <button
                        onClick={onClose}
                        className="absolute top-4 right-4 p-2 hover:bg-muted rounded-full transition-colors z-10"
                    >
                        <X className="w-5 h-5 text-muted-foreground" />
                    </button>

                    <div className="relative w-full max-w-4xl max-h-full rounded-2xl overflow-hidden shadow-2xl border border-border bg-background group">
                        <img
                            src={imageUrl}
                            alt="Editing"
                            className="w-full h-full object-contain max-h-[80vh]"
                        />

                        {/* Overlay Controls */}
                        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-3">
                            <button className="px-4 py-2 bg-white/90 hover:bg-white text-destructive font-medium text-sm rounded-lg shadow-sm backdrop-blur-sm flex items-center gap-2 transition-colors">
                                <Trash2 className="w-4 h-4" /> Delete
                            </button>
                            <button className="px-4 py-2 bg-white/90 hover:bg-white text-foreground font-medium text-sm rounded-lg shadow-sm backdrop-blur-sm flex items-center gap-2 transition-colors">
                                <Download className="w-4 h-4" /> Download
                            </button>
                        </div>

                        {/* Footer Watermark */}
                        <div className="absolute bottom-0 left-0 right-0 p-2 bg-gradient-to-t from-black/80 to-transparent text-white/60 text-[10px] uppercase font-medium text-center">
                            Image representative of plan only and may vary as built
                        </div>
                    </div>
                </div>

            </div>
        </div>
    );
}
