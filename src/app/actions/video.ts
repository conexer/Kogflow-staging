'use server';

import { createClient } from '@supabase/supabase-js';

// --- Constants ---
const ATLASCLOUD_BASE = 'https://api.atlascloud.ai';
const ATLASCLOUD_MODEL = 'bytedance/seedance-v1-pro-fast/image-to-video';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const atlasApiKey = process.env.ATLASCLOUD_API_KEY;

// Defaults
const DEFAULT_RESOLUTION = '480p';
const DEFAULT_DURATION = 4;
const DEFAULT_ASPECT_RATIO = '16:9';

interface VideoGenerationRequest {
    title: string;
    realtorInfo: {
        name: string;
        phone: string;
        email: string;
    };
    userId?: string;
    projectId?: string;
    aspectRatio?: '16:9' | '9:16';
    status?: string;
    imageUrls?: string[];
}

const PROMPT = 'Create a realistic walkthrough video of this room. The camera moves at a normal walking pace with handheld, natural motion. Capture authentic, realistic camera movement with subtle micro-movements and slight variations. Show the room in full 3D with proper parallax and depth changes as the camera moves.';

async function uploadImageToAtlas(sourceUrl: string): Promise<string> {
    const imgRes = await fetch(sourceUrl);
    if (!imgRes.ok) throw new Error(`Failed to fetch source image: ${imgRes.status}`);
    const imgBuffer = await imgRes.arrayBuffer();
    const contentType = imgRes.headers.get('content-type') || 'image/jpeg';
    const ext = contentType.includes('png') ? 'png' : 'jpg';

    const form = new FormData();
    form.append('file', new Blob([imgBuffer], { type: contentType }), `image.${ext}`);

    const uploadRes = await fetch(`${ATLASCLOUD_BASE}/api/v1/model/uploadMedia`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${atlasApiKey}` },
        body: form
    });
    const uploadJson = await uploadRes.json();
    const atlasUrl = uploadJson?.data?.download_url;
    if (!atlasUrl) throw new Error(`AtlasCloud upload failed: ${JSON.stringify(uploadJson)}`);
    return atlasUrl;
}

export async function generateVideo(data: VideoGenerationRequest) {
    console.log('🚀 generateVideo() called with:', data);

    if (!atlasApiKey) {
        console.error('❌ Missing AtlasCloud API key!');
        return { error: 'AtlasCloud API key not configured' };
    }

    const imageUrls = data.imageUrls || [];
    if (imageUrls.length === 0) return { error: 'No image URLs provided' };

    try {
        console.log('🎬 Starting Seedance v1 Pro Fast batch on AtlasCloud...');
        const taskIds: string[] = [];
        const errors: any[] = [];
        const results: { imageUrl: string; taskId: string | null; error: string | null }[] = [];

        for (let i = 0; i < imageUrls.length; i++) {
            const imageUrl = imageUrls[i];
            console.log(`Processing image ${i + 1}/${imageUrls.length}: ${imageUrl}`);

            if (i > 0) {
                console.log('⏳ Waiting 2 seconds before next request...');
                await new Promise(resolve => setTimeout(resolve, 2000));
            }

            // Upload image to AtlasCloud storage first (required by their API)
            let atlasImageUrl: string;
            try {
                atlasImageUrl = await uploadImageToAtlas(imageUrl);
                console.log(`📤 Uploaded to AtlasCloud: ${atlasImageUrl}`);
            } catch (uploadErr: any) {
                console.error(`❌ Upload failed for ${imageUrl}:`, uploadErr.message);
                results.push({ imageUrl, taskId: null, error: `Upload failed: ${uploadErr.message}` });
                errors.push({ imageUrl, error: uploadErr.message });
                continue;
            }

            const payload = {
                model: ATLASCLOUD_MODEL,
                image: atlasImageUrl,
                prompt: PROMPT,
                duration: DEFAULT_DURATION,
                resolution: DEFAULT_RESOLUTION,
                aspect_ratio: data.aspectRatio || DEFAULT_ASPECT_RATIO
            };

            const response = await fetch(`${ATLASCLOUD_BASE}/api/v1/model/generateVideo`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${atlasApiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            });

            let result: any;
            try {
                result = await response.json();
            } catch {
                const text = await response.text();
                console.error(`❌ Non-JSON response for image ${imageUrl}:`, text);
                results.push({ imageUrl, taskId: null, error: `Parse error: ${text.slice(0, 200)}` });
                errors.push({ imageUrl, error: 'Non-JSON response' });
                continue;
            }

            console.log(`📦 AtlasCloud response (image ${i + 1}):`, result);

            if (!response.ok) {
                const err = `HTTP ${response.status}: ${result?.error || result?.message || 'Unknown'}`;
                console.error(`❌ HTTP Error for image ${imageUrl}:`, err);
                results.push({ imageUrl, taskId: null, error: err });
                errors.push({ imageUrl, error: err });
                continue;
            }

            const predictionId = result?.data?.id;
            if (predictionId) {
                results.push({ imageUrl, taskId: predictionId, error: null });
                taskIds.push(predictionId);
            } else {
                const errMsg = result?.error || result?.message || 'No prediction ID returned';
                results.push({ imageUrl, taskId: null, error: errMsg });
                errors.push({ imageUrl, error: errMsg });
            }
        }

        return {
            success: errors.length === 0,
            taskIds,
            results,
            errorCount: errors.length,
            message: errors.length > 0 ? `Completed with ${errors.length} errors.` : 'Batch started successfully'
        };

    } catch (error: any) {
        console.error('❌ Batch Generation Exception:', error);
        return { error: error.message || 'Failed to start generation batch' };
    }
}

export async function checkVideoStatus(taskId: string) {
    if (!atlasApiKey) {
        return { error: 'API key not configured' };
    }

    try {
        const response = await fetch(`${ATLASCLOUD_BASE}/api/v1/model/prediction/${taskId}`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${atlasApiKey}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error(`Status check failed: ${response.status}`);
        }

        const result = await response.json();
        console.log(`📡 Status check for ${taskId}:`, result);
        return parseStatusResult(result);

    } catch (error: any) {
        console.error('Check status error:', error);
        return { error: error.message };
    }
}

function parseStatusResult(result: any) {
    const data = result?.data || result;
    const status = data?.status;

    if (status === 'completed' || status === 'succeeded') {
        const outputs = data?.outputs;
        const videoUrl = Array.isArray(outputs) ? outputs[0] : outputs;
        return {
            status: 'success',
            videoUrl,
            message: 'Video generated'
        };
    }

    if (status === 'failed') {
        return {
            status: 'failed',
            error: data?.error || 'Generation failed'
        };
    }

    return {
        status: 'processing',
        message: 'Video still generating...'
    };
}

export async function saveVideoToProject(data: {
    userId: string;
    projectId: string;
    videoUrl: string;
    title: string;
    imageCount: number;
}) {
    if (!supabaseUrl || !supabaseKey) {
        return { error: 'Database not configured' };
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    try {
        const { data: video, error } = await supabase
            .from('videos')
            .insert({
                user_id: data.userId,
                project_id: data.projectId,
                video_url: data.videoUrl,
                title: data.title,
                image_count: data.imageCount
            })
            .select()
            .single();

        if (error) throw error;
        return { success: true, video };
    } catch (error: any) {
        console.error('Error saving video to project:', error);
        return { error: error.message };
    }
}

export async function deleteVideo(videoId: number, videoUrl: string) {
    const supabase = createClient(supabaseUrl, supabaseKey);
    try {
        const { error: dbError } = await supabase
            .from('videos')
            .delete()
            .eq('id', videoId);
        if (dbError) throw dbError;

        const path = videoUrl.split('/public/videos/')[1];
        if (path) {
            const { error: storageError } = await supabase.storage
                .from('videos')
                .remove([path]);
            if (storageError) console.error('Storage removal error:', storageError);
        }
        return { success: true };
    } catch (error: any) {
        console.error('Error deleting video:', error);
        return { error: error.message };
    }
}

// --- Queue Management Actions ---

export async function enqueueVideoAction(data: {
    userId: string;
    projectId: string;
    title: string;
    imageUrls: string[];
    realtorInfo: any;
    aspectRatio: '16:9' | '9:16';
}) {
    const supabase = createClient(supabaseUrl, supabaseKey);

    try {
        const { count, error: countError } = await supabase
            .from('videos')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', data.userId)
            .in('status', ['queued', 'processing']);

        if (countError) throw countError;
        if ((count || 0) >= 5) {
            return { error: 'Maximum of 5 videos allowed in queue. Please wait for current tasks to finish.' };
        }

        const { data: video, error } = await supabase
            .from('videos')
            .insert({
                user_id: data.userId,
                project_id: data.projectId,
                video_url: '',
                title: data.title,
                image_count: data.imageUrls.length,
                status: 'queued',
                image_urls: data.imageUrls,
                realtor_info: data.realtorInfo,
                aspect_ratio: data.aspectRatio,
                progress: 0
            })
            .select()
            .single();

        if (error) throw error;
        return { success: true, videoId: video.id };
    } catch (error: any) {
        console.error('Enqueue error:', error);
        return { error: error.message };
    }
}

export async function updateVideoQueueStatus(videoId: number, updates: {
    status?: 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled';
    progress?: number;
    video_url?: string;
    error?: string;
    task_ids?: string[];
}) {
    const supabase = createClient(supabaseUrl, supabaseKey);

    try {
        const { error } = await supabase
            .from('videos')
            .update(updates)
            .eq('id', videoId);

        if (error) throw error;
        return { success: true };
    } catch (error: any) {
        console.error('Update queue error:', error);
        return { error: error.message };
    }
}

export async function getQueuedVideos(userId: string) {
    const supabase = createClient(supabaseUrl, supabaseKey);

    try {
        const { data, error } = await supabase
            .from('videos')
            .select('*')
            .eq('user_id', userId)
            .in('status', ['queued', 'processing'])
            .order('created_at', { ascending: true });

        if (error) throw error;
        return { success: true, videos: data };
    } catch (error: any) {
        console.error('Get queued videos error:', error);
        return { error: error.message };
    }
}
