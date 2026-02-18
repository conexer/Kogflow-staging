'use server';

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const runningHubApiKey = process.env.RUNNINGHUB_API_KEY;
const runningHubWorkflowId = process.env.RUNNINGHUB_WORKFLOW_ID;

interface VideoGenerationRequest {
    imageUrls: string[];
    title: string;
    realtorInfo: {
        name: string;
        phone: string;
        email: string;
    };
    userId?: string;
    projectId?: string;
    aspectRatio?: '16:9' | '9:16';
}

export async function generateVideo(data: VideoGenerationRequest) {
    console.log('🚀 generateVideo() called with:', data);

    if (!runningHubApiKey || !runningHubWorkflowId) {
        console.error('❌ Missing API credentials!');
        return { error: 'RunningHub API credentials not configured' };
    }

    // Set to true to use mock api, false for real api
    const MOCK_MODE = false;

    if (MOCK_MODE) {
        console.log('🎬 Mock Video Generation:', {
            images: data.imageUrls.length,
            title: data.title,
            realtorInfo: data.realtorInfo
        });

        // Simulate API delay
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Return a mock task ID for each image
        const taskIds = data.imageUrls.map((_, i) => `mock-video-${Date.now()}-${i}`);

        return {
            success: true,
            taskIds, // Legacy support
            results: data.imageUrls.map((url, i) => ({
                imageUrl: url,
                taskId: taskIds[i],
                error: null
            })),
            isMock: true
        };
    }

    try {
        console.log('🎬 Starting RunningHub.ai video generation batch...');
        const taskIds: string[] = [];
        const errors: any[] = [];
        const results: { imageUrl: string; taskId: string | null; error: string | null }[] = [];

        // Loop through each image and trigger generation SEQUENTIALLY with delays
        for (let i = 0; i < data.imageUrls.length; i++) {
            const imageUrl = data.imageUrls[i];
            console.log(`Processing image ${i + 1}/${data.imageUrls.length}: ${imageUrl}`);

            // Add 2-second delay between requests to avoid rate limiting
            if (i > 0) {
                console.log('⏳ Waiting 2 seconds before next request...');
                await new Promise(resolve => setTimeout(resolve, 2000));
            }

            const payload = {
                nodeInfoList: [
                    {
                        nodeId: "39",
                        fieldName: "image",
                        fieldValue: imageUrl,
                        description: "Image"
                    },
                    {
                        nodeId: "44",
                        fieldName: "string",
                        fieldValue: "the camera very slowly glides into the scene in a linear path, 480p low quality 30fps steady motion",
                        description: "Prompt words"
                    },
                    {
                        nodeId: "45",
                        fieldName: "string",
                        fieldValue: "5", // Default to 5s per clip
                        description: "Video duration"
                    },
                    {
                        nodeId: "91",
                        fieldName: "string",
                        fieldValue: `constant 30 fps, 480p, low quality, smooth motion, aspect ratio: ${data.aspectRatio || '16:9'}`,
                        description: "Special requirements"
                    }
                ],
                instanceType: "default",
                usePersonalQueue: false
            };

            const appId = runningHubWorkflowId || '1961996521397010434';
            const response = await fetch(`https://www.runninghub.cn/openapi/v2/run/ai-app/${appId}`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${runningHubApiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                const text = await response.text();
                console.error(`❌ HTTP Error for image ${imageUrl}:`, text);
                const err = `HTTP ${response.status}: ${text}`;
                results.push({ imageUrl, taskId: null, error: err });
                errors.push({ imageUrl, error: err });
                continue;
            }

            const result = await response.json();
            console.log('📦 RunningHub response:', result);

            // ✅ Check for errorCode in response (even if HTTP 200)
            if (result.errorCode) {
                const errorMsg = result.errorMessage || 'Unknown error';
                console.error(`❌ API Error Code ${result.errorCode}:`, errorMsg);

                // Check if rate limited
                if (result.errorCode === '421' || result.errorCode === 421) {
                    throw new Error(`RunningHub rate limit reached. Please wait a few minutes and try again.`);
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
            taskIds, // Legacy support
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

    // Checking Mock Status
    if (taskId.startsWith('mock-video-')) {
        await new Promise(resolve => setTimeout(resolve, 3000));
        return {
            status: 'success',
            videoUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
            message: 'Mock video ready'
        };
    }

    try {
        const response = await fetch(`https://www.runninghub.cn/openapi/v2/query`, {
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
        const highRes = results.find((r: any) => r.url && (r.url.includes('高清') || r.url.includes('P.mp4')));
        const videoUrl = highRes ? highRes.url : results[0].url;

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
