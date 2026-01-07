'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { Divide, MoveHorizontal } from 'lucide-react';
import Image from 'next/image';
import { cn } from '@/lib/utils';

interface ComparisonSliderProps {
    beforeImage: string;
    afterImage: string;
    className?: string;
}

export function ComparisonSlider({ beforeImage, afterImage, className }: ComparisonSliderProps) {
    const [sliderPosition, setSliderPosition] = useState(50);
    const [isResizing, setIsResizing] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    const handleMove = useCallback((clientX: number) => {
        if (!containerRef.current) return;
        const rect = containerRef.current.getBoundingClientRect();
        const x = Math.max(0, Math.min(clientX - rect.left, rect.width));
        const percent = (x / rect.width) * 100;
        setSliderPosition(percent);
    }, []);

    const handleMouseDown = () => setIsResizing(true);
    const handleMouseUp = () => setIsResizing(false);

    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (!isResizing) return;
            handleMove(e.clientX);
        };

        const handleTouchMove = (e: TouchEvent) => {
            if (!isResizing) return;
            handleMove(e.touches[0].clientX);
        };

        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);
        window.addEventListener('touchmove', handleTouchMove);
        window.addEventListener('touchend', handleMouseUp);

        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
            window.removeEventListener('touchmove', handleTouchMove);
            window.removeEventListener('touchend', handleMouseUp);
        };
    }, [isResizing, handleMove]);

    return (
        <div
            className={cn("relative w-full h-[500px] select-none overflow-hidden rounded-xl border border-border bg-muted", className)}
            ref={containerRef}
        >
            <div className="absolute inset-0 w-full h-full">
                <Image
                    src={afterImage}
                    alt="After"
                    fill
                    className="object-cover object-center"
                    priority
                />
                <div className="absolute top-4 right-4 bg-black/50 text-white px-2 py-1 text-xs rounded uppercase font-bold tracking-wider backdrop-blur-md">
                    After
                </div>
            </div>

            <div
                className="absolute inset-0 w-full h-full overflow-hidden"
                style={{ clipPath: `inset(0 ${100 - sliderPosition}% 0 0)` }}
            >
                <Image
                    src={beforeImage}
                    alt="Before"
                    fill
                    className="object-cover object-center"
                    priority
                />
                <div className="absolute top-4 left-4 bg-black/50 text-white px-2 py-1 text-xs rounded uppercase font-bold tracking-wider backdrop-blur-md">
                    Before
                </div>
            </div>

            {/* Slider Handle */}
            <div
                className="absolute top-0 bottom-0 w-1 bg-white cursor-ew-resize z-20 shadow-[0_0_20px_rgba(0,0,0,0.5)]"
                style={{ left: `${sliderPosition}%` }}
                onMouseDown={handleMouseDown}
                onTouchStart={handleMouseDown}
            >
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-10 h-10 bg-white rounded-full flex items-center justify-center shadow-lg text-black">
                    <MoveHorizontal className="w-5 h-5" />
                </div>
            </div>
        </div>
    );
}
