'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';
import { cn } from '@/lib/utils';

const SLIDES = [
    '/images/slideshow/slide-1.jpg',
    '/images/slideshow/slide-2.jpg',
    '/images/slideshow/slide-3.jpg',
    '/images/slideshow/slide-4.jpg',
    '/images/slideshow/slide-5.jpg',
];

export function HeroSlideshow() {
    const [currentIndex, setCurrentIndex] = useState(0);

    useEffect(() => {
        const interval = setInterval(() => {
            setCurrentIndex((prev) => (prev + 1) % SLIDES.length);
        }, 3000); // Change slide every 3 seconds (1s transition included in css)

        return () => clearInterval(interval);
    }, []);

    return (
        <div className="relative w-full h-full">
            {SLIDES.map((slide, index) => (
                <div
                    key={slide}
                    className={cn(
                        "absolute inset-0 transition-opacity duration-1000 ease-in-out",
                        index === currentIndex ? "opacity-100 z-10" : "opacity-0 z-0"
                    )}
                >
                    <Image
                        src={slide}
                        alt={`Slide ${index + 1}`}
                        fill
                        className="object-cover"
                        priority={index === 0}
                    />
                </div>
            ))}
        </div>
    );
}
