'use client';

import { Check, Sofa, Armchair, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';

export type StagingMode = 'add_furniture' | 'remove_furniture';
export type StagingStyle = 'scandinavian' | 'minimalist' | 'modern' | 'industrial' | 'coast' | 'boho';

interface StagingControlsProps {
    mode: StagingMode;
    setMode: (mode: StagingMode) => void;
    style: StagingStyle;
    setStyle: (style: StagingStyle) => void;
    isGenerating: boolean;
    onGenerate: () => void;
    disabled?: boolean;
}

const STYLES: { id: StagingStyle; label: string; color: string }[] = [
    { id: 'scandinavian', label: 'Scandinavian', color: 'bg-emerald-500' },
    { id: 'minimalist', label: 'Minimalist', color: 'bg-slate-500' },
    { id: 'modern', label: 'Modern', color: 'bg-blue-500' },
    { id: 'industrial', label: 'Industrial', color: 'bg-orange-500' },
    { id: 'coast', label: 'Coastal', color: 'bg-cyan-500' },
    { id: 'boho', label: 'Bohemian', color: 'bg-rose-500' },
];

export function StagingControls({
    mode,
    setMode,
    style,
    setStyle,
    isGenerating,
    onGenerate,
    disabled
}: StagingControlsProps) {
    return (
        <div className="space-y-6 w-full max-w-md bg-card border border-border/50 rounded-xl p-6 shadow-xl backdrop-blur-xl">
            {/* Mode Selection */}
            <div className="space-y-3">
                <label className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Transformation Type</label>
                <div className="grid grid-cols-2 gap-2 p-1 bg-muted/50 rounded-lg">
                    <button
                        onClick={() => setMode('add_furniture')}
                        className={cn(
                            "flex items-center justify-center gap-2 py-2.5 text-sm font-medium rounded-md transition-all",
                            mode === 'add_furniture'
                                ? "bg-background text-foreground shadow-sm"
                                : "text-muted-foreground hover:bg-background/50 hover:text-foreground"
                        )}
                        disabled={disabled}
                    >
                        <Sofa className="w-4 h-4" />
                        Stage Room
                    </button>
                    <button
                        onClick={() => setMode('remove_furniture')}
                        className={cn(
                            "flex items-center justify-center gap-2 py-2.5 text-sm font-medium rounded-md transition-all",
                            mode === 'remove_furniture'
                                ? "bg-background text-foreground shadow-sm"
                                : "text-muted-foreground hover:bg-background/50 hover:text-foreground"
                        )}
                        disabled={disabled}
                    >
                        <Armchair className="w-4 h-4" />
                        Clear Room
                    </button>
                </div>
            </div>

            {/* Style Selection (Only if adding furniture) */}
            <div className={cn(
                "space-y-3 transition-opacity duration-300",
                mode === 'remove_furniture' ? "opacity-50 pointer-events-none" : "opacity-100"
            )}>
                <label className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Interior Style</label>
                <div className="grid grid-cols-2 gap-3">
                    {STYLES.map((s) => (
                        <button
                            key={s.id}
                            onClick={() => setStyle(s.id)}
                            disabled={disabled || mode === 'remove_furniture'}
                            className={cn(
                                "group relative flex items-center justify-between px-3 py-3 border rounded-lg text-left transition-all overflow-hidden",
                                style === s.id
                                    ? "border-primary bg-primary/5 shadow-[0_0_15px_-3px_var(--color-primary)]"
                                    : "border-border hover:border-primary/50 hover:bg-accent/50"
                            )}
                        >
                            <span className="z-10 text-sm font-medium">{s.label}</span>
                            {style === s.id && <Check className="w-4 h-4 text-primary" />}
                            <div className={cn(
                                "absolute inset-0 opacity-0 group-hover:opacity-5 transition-opacity",
                                s.color
                            )} />
                        </button>
                    ))}
                </div>
            </div>

            {/* Generate Button */}
            <button
                onClick={onGenerate}
                disabled={disabled || isGenerating}
                className={cn(
                    "w-full relative overflow-hidden py-4 rounded-lg font-bold text-white shadow-lg transition-all transform active:scale-95 disabled:opacity-70 disabled:cursor-not-allowed",
                    "bg-gradient-to-r from-violet-600 via-purple-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500"
                )}
            >
                <span className="relative z-10 flex items-center justify-center gap-2">
                    {isGenerating ? (
                        <>
                            <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                            Processing...
                        </>
                    ) : (
                        <>
                            <Sparkles className="w-5 h-5" />
                            Generate Renders
                        </>
                    )}
                </span>
                {/* Shine effect */}
                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-x-full hover:animate-[shimmer_1s_infinite]" />
            </button>
        </div>
    );
}
