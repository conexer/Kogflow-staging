import { toast } from 'sonner';

interface DownloadOptions {
    url: string;
    filename?: string;
    isPremium: boolean;
    onSuccess?: () => void;
    onError?: (error: any) => void;
}

/**
 * Downloads an image, applying a watermark if the user is not premium.
 */
export async function downloadImage({
    url,
    filename = `kogflow-render-${Date.now()}.jpg`,
    isPremium,
    onSuccess,
    onError
}: DownloadOptions) {
    const toastId = toast.loading('Preparing download...');

    try {
        // 1. Fetch image data
        // Use proxy to avoid CORS issues if needed, or fallback to direct fetch
        const response = await fetch(`/api/download?url=${encodeURIComponent(url)}`);
        if (!response.ok) throw new Error('Fetch failed');
        const originalBlob = await response.blob();

        let finalBlob = originalBlob;

        // 2. Apply Watermark if NOT premium
        if (!isPremium) {
            const bitmap = await createImageBitmap(originalBlob);
            const canvas = document.createElement('canvas');
            canvas.width = bitmap.width;
            canvas.height = bitmap.height;
            const ctx = canvas.getContext('2d');

            if (!ctx) throw new Error('Canvas error');

            // Draw original
            ctx.drawImage(bitmap, 0, 0);

            // Configure Watermark (Same logic as EditImageModal)
            ctx.globalAlpha = 0.5;
            const fontSize = Math.max(24, Math.floor(canvas.width * 0.08));
            ctx.font = `bold ${fontSize}px sans-serif`;
            ctx.fillStyle = 'white';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.shadowColor = "rgba(0,0,0,0.9)";
            ctx.shadowBlur = 6;
            ctx.shadowOffsetX = 3;
            ctx.shadowOffsetY = 3;

            const text = "KogFlow.com";
            const x = canvas.width / 2;
            const y = canvas.height * 0.85;

            ctx.fillText(text, x, y);

            // Reset
            ctx.shadowColor = "transparent";

            finalBlob = await new Promise<Blob>((resolve, reject) => {
                canvas.toBlob((b) => {
                    if (b) resolve(b);
                    else reject(new Error('Watermarking failed'));
                }, 'image/jpeg', 0.95);
            });
        }

        // 3. Handle Download / Share
        const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

        if (isMobile && navigator.share && navigator.canShare) {
            const file = new File([finalBlob], 'kogflow-render.jpg', { type: 'image/jpeg' });
            if (navigator.canShare({ files: [file] })) {
                await navigator.share({
                    files: [file],
                });
                toast.dismiss(toastId);
                onSuccess?.();
                return;
            }
        }

        // Desktop/Fallback
        const objectUrl = window.URL.createObjectURL(finalBlob);
        const a = document.createElement('a');
        a.href = objectUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(objectUrl);

        toast.dismiss(toastId);
        toast.success(isPremium ? 'Downloaded HD' : 'Downloaded (Free Tier Watermark)');
        onSuccess?.();

    } catch (error) {
        console.error(error);
        toast.dismiss(toastId);
        if ((error as any).name !== 'AbortError') {
            toast.error('Download failed');
            onError?.(error);
        }
    }
}
