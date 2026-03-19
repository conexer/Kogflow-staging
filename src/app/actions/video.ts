'use server';

import { createClient } from '@supabase/supabase-js';

// --- Constants ---
// App ID for WAN 2.2 Image to Video (free tier)
const WAN22_APP_ID = '1959889002553880577';
// runninghub.ai returns 401 with Bearer token; .cn OpenAPI accepts our key
const RUNNINGHUB_BASE = 'https://www.runninghub.cn';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const runningHubApiKey = process.env.RUNNINGHUB_API_KEY;

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

// Map aspect ratio string to WAN 2.2 node 260 select index
// Values per official API docs: 1=Auto, 2=1:1, 3=4:3, 4=3:4, 5=16:9, 6=9:16
function aspectRatioToIndex(ratio: '16:9' | '9:16' | undefined): string {
    switch (ratio) {
        case '16:9': return '5';
        case '9:16': return '6';
        default: return '1'; // Auto match
    }
}

export async function generateVideo(data: VideoGenerationRequest) {
    console.log('🚀 generateVideo() called with:', data);

    if (!runningHubApiKey) {
        console.error('❌ Missing RunningHub API key!');
        return { error: 'RunningHub API key not configured' };
    }

    // Set to true to use mock api, false for real api
    const MOCK_MODE = false;

    if (MOCK_MODE) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        const imageUrls = data.imageUrls || [];
        const taskIds = imageUrls.map((_, i) => `mock-video-${Date.now()}-${i}`);
        return {
            success: true,
            taskIds,
            results: imageUrls.map((url, i) => ({
                imageUrl: url,
                taskId: taskIds[i],
                error: null
            })),
            isMock: true
        };
    }

    try {
        console.log('🎬 Starting WAN 2.2 Image-to-Video batch on RunningHub.ai...');
        const taskIds: string[] = [];
        const errors: any[] = [];
        const results: { imageUrl: string; taskId: string | null; error: string | null }[] = [];

        const imageUrls = data.imageUrls || [];
        if (imageUrls.length === 0) return { error: 'No image URLs provided' };

        const ratioIndex = aspectRatioToIndex(data.aspectRatio);
        const prompt = 'Slow, continuous forward tracking shot at eye-level. Smooth gimbal-stabilized handheld motion gliding linearly deep into the room, slightly passing the midpoint. Constant forward momentum, no cuts, realistic walking perspective.';

        for (let i = 0; i < imageUrls.length; i++) {
            const imageUrl = imageUrls[i];
            console.log(`Processing image ${i + 1}/${imageUrls.length}: ${imageUrl}`);

            // Delay between requests to avoid rate limiting
            if (i > 0) {
                console.log('⏳ Waiting 2 seconds before next request...');
                await new Promise(resolve => setTimeout(resolve, 2000));
            }

            const payload = {
                nodeInfoList: [
                    {
                        nodeId: '135',
                        fieldName: 'image',
                        fieldValue: imageUrl,
                        description: 'Upload image'
                    },
                    {
                        nodeId: '260',
                        fieldName: 'select',
                        fieldValue: ratioIndex,
                        description: 'Aspect ratio'
                    },
                    {
                        nodeId: '139',
                        fieldName: 'index',
                        fieldValue: '1',
                        description: 'Prompt input method'
                    },
                    {
                        nodeId: '116',
                        fieldName: 'text',
                        fieldValue: prompt,
                        description: 'Creative description'
                    }
                ],
                instanceType: 'default',
                usePersonalQueue: 'false'
            };

            const response = await fetch(`${RUNNINGHUB_BASE}/openapi/v2/run/ai-app/${WAN22_APP_ID}`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${runningHubApiKey}`,
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

            console.log(`📦 WAN 2.2 response (image ${i + 1}):`, result);

            if (!response.ok) {
                const err = `HTTP ${response.status}: ${result?.message || result?.errorMessage || 'Unknown'}`;
                console.error(`❌ HTTP Error for image ${imageUrl}:`, err);
                results.push({ imageUrl, taskId: null, error: err });
                errors.push({ imageUrl, error: err });
                continue;
            }

            // Check for API-level error codes
            if (result.errorCode && result.errorCode !== '0') {
                const errorMsg = result.errorMessage || 'Unknown API error';
                console.error(`❌ API Error ${result.errorCode}:`, errorMsg);

                if (result.errorCode === '421' || result.errorCode === 421) {
                    throw new Error('RunningHub rate limit reached. Please wait a few minutes and try again.');
                }

                results.push({ imageUrl, taskId: result.taskId || null, error: errorMsg });
                errors.push({ imageUrl, error: errorMsg });
                continue;
            }

            if (result.taskId) {
                results.push({ imageUrl, taskId: result.taskId, error: null });
                taskIds.push(result.taskId);
            } else {
                results.push({ imageUrl, taskId: null, error: 'No taskId returned' });
                errors.push({ imageUrl, error: 'No taskId returned' });
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
    if (!runningHubApiKey) {
        return { error: 'API key not configured' };
    }

    // Mock status
    if (taskId.startsWith('mock-video-')) {
        await new Promise(resolve => setTimeout(resolve, 3000));
        return {
            status: 'success',
            videoUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
            message: 'Mock video ready'
        };
    }

    try {
        // WAN 2.2 polling: POST /openapi/v2/query on runninghub.ai
        const response = await fetch(`${RUNNINGHUB_BASE}/openapi/v2/query`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${runningHubApiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ taskId })
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
    const status = result.status;
    const errorCode = result.errorCode;

    if (status === 'SUCCESS' && result.results && result.results.length > 0) {
        const results = result.results;
        // WAN 2.2 returns results with fieldName='video_url' and the file at fileUrl
        const videoResult = results.find((r: any) => r.fieldName === 'video_url') || results[0];
        const videoUrl = videoResult?.fileUrl || videoResult?.url;

        return {
            status: 'success',
            videoUrl,
            message: 'Video generated'
        };
    }

    if (status === 'FAILED' || (errorCode && errorCode !== '0')) {
        return {
            status: 'failed',
            error: result.errorMessage || result.failedReason?.exception_message || 'Generation failed',
            errorCode: errorCode
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
        // 1. Check queue limit (max 5)
        const { count, error: countError } = await supabase
            .from('videos')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', data.userId)
            .in('status', ['queued', 'processing']);

        if (countError) throw countError;
        if ((count || 0) >= 5) {
            return { error: 'Maximum of 5 videos allowed in queue. Please wait for current tasks to finish.' };
        }

        // 2. Insert as queued
        const { data: video, error } = await supabase
            .from('videos')
            .insert({
                user_id: data.userId,
                project_id: data.projectId,
                video_url: '', // Empty until finished
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
