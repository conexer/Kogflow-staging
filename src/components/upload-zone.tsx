'use client';

import { useCallback, useState } from 'react';
import { useDropzone, FileRejection } from 'react-dropzone';
import { UploadCloud, Image as ImageIcon, X } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import Image from 'next/image';

interface UploadZoneProps {
    onImageSelected: (file: File | null) => void;
    className?: string;
}

export function UploadZone({ onImageSelected, className }: UploadZoneProps) {
    const [preview, setPreview] = useState<string | null>(null);

    const onDrop = useCallback((acceptedFiles: File[], rejectedFiles: FileRejection[]) => {
        if (rejectedFiles.length > 0) {
            toast.error('Only image files are allowed!');
            return;
        }

        const file = acceptedFiles[0];
        if (file) {
            const objectUrl = URL.createObjectURL(file);
            setPreview(objectUrl);
            onImageSelected(file);
        }
    }, [onImageSelected]);

    const removeImage = (e: React.MouseEvent) => {
        e.stopPropagation();
        setPreview(null);
        onImageSelected(null);
    };

    const { getRootProps, getInputProps, isDragActive } = useDropzone({
        onDrop,
        accept: {
            'image/*': ['.jpeg', '.jpg', '.png', '.webp']
        },
        maxFiles: 1
    });

    return (
        <div
            {...getRootProps()}
            className={cn(
                "relative flex flex-col items-center justify-center w-full min-h-[400px] border-2 border-dashed rounded-xl transition-all duration-300 cursor-pointer overflow-hidden group",
                isDragActive
                    ? "border-primary bg-primary/10 scale-[1.01]"
                    : "border-muted-foreground/30 hover:border-primary/50 hover:bg-muted/30",
                preview ? "border-none" : "",
                className
            )}
        >
            <input {...getInputProps()} />

            {preview ? (
                <div className="relative w-full h-full min-h-[400px]">
                    <Image
                        src={preview}
                        alt="Uploaded preview"
                        fill
                        className="object-contain p-4"
                    />
                    <div className="absolute top-4 right-4 z-10">
                        <button
                            onClick={removeImage}
                            className="p-2 bg-black/50 hover:bg-destructive text-white rounded-full backdrop-blur-sm transition-colors"
                        >
                            <X className="w-5 h-5" />
                        </button>
                    </div>
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors pointer-events-none" />
                </div>
            ) : (
                <div className="flex flex-col items-center justify-center p-8 text-center space-y-4">
                    <div className={cn(
                        "p-4 rounded-full bg-muted transition-transform duration-300 group-hover:scale-110",
                        isDragActive ? "bg-primary/20 text-primary" : "text-muted-foreground"
                    )}>
                        <UploadCloud className="w-10 h-10" />
                    </div>
                    <div className="space-y-1">
                        <h3 className="text-xl font-semibold tracking-tight">
                            {isDragActive ? "Drop image here" : "Upload your listing"}
                        </h3>
                        <p className="text-sm text-muted-foreground max-w-xs mx-auto">
                            Drag & drop or click to browse. Supports JPG, PNG, WEBP.
                        </p>
                    </div>
                    <div className="pt-4 flex gap-4 text-xs text-muted-foreground/60 uppercase tracking-widest">
                        <span className="flex items-center gap-1"><ImageIcon className="w-3 h-3" /> High Res</span>
                        <span className="flex items-center gap-1"><ImageIcon className="w-3 h-3" /> Auto-Enhance</span>
                    </div>
                </div>
            )}
        </div>
    );
}
