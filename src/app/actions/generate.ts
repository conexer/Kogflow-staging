'use server';

import { createClient } from '@supabase/supabase-js';
import { checkCredits, deductCredit } from './credits';
import { cookies } from 'next/headers';

// Initialize Supabase Admin Client for server-side operations
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export async function startGeneration(formData: FormData) {
    const file = formData.get('image') as File;
    const mode = formData.get('mode') as string;
    const style = formData.get('style') as string;
    const userId = formData.get('userId') as string;
    const aspectRatio = formData.get('aspectRatio') as string;

    if (file) {
        console.log(`[Generate] Processing file: ${file.name}, Type: ${file.type}, Size: ${file.size}`);
    }

    if (!file) {
        return { error: 'No image provided' };
    }

    // Check if user has credits
    let isGuest = false;
    if (!userId) {
        isGuest = true;
        const cookieStore = await cookies();
        const guestCookie = cookieStore.get('guest_credits');
        let guestData = { remaining: 2, resetAt: Date.now() + 24 * 60 * 60 * 1000 };

        if (guestCookie) {
            try {
                const parsed = JSON.parse(guestCookie.value);
                if (Date.now() < parsed.resetAt) {
                    guestData = parsed;
                }
            } catch (e) {
                // Invalid cookie, reset
            }
        }

        if (guestData.remaining <= 0) {
            return { error: 'Daily guest limit reached (2/24h). Log in for more.', needsUpgrade: true };
        }

        // Decrement guest credits (optimistic/pre-check, actual decrement happens on completion or we accept the risk of "started but failed" consuming a slot?
        // To be safe and consistent with previous logic, we'll verify here but decrement later? 
        // actually original code decremented guest IMMEDIATELY (line 46 in original).
        // Let's keep that behavior for guests.
        guestData.remaining -= 1;
        cookieStore.set('guest_credits', JSON.stringify(guestData), {
            expires: new Date(guestData.resetAt),
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax'
        });

    } else {
        const { canGenerate } = await checkCredits(userId);
        if (!canGenerate) {
            return { error: 'Insufficient credits', needsUpgrade: true };
        }
    }

    try {
        // 1. Upload Original to Supabase
        let imageUrl = '';
        if (supabaseUrl && supabaseKey) {
            const supabase = createClient(supabaseUrl, supabaseKey);
            const buffer = await file.arrayBuffer();
            const filename = `${Date.now()}_${file.name.replace(/\s/g, '_')}`;
            const { data, error } = await supabase.storage
                .from('uploads')
                .upload(filename, buffer, { contentType: file.type });

            if (error) throw error;

            const { data: { publicUrl } } = supabase.storage
                .from('uploads')
                .getPublicUrl(filename);

            imageUrl = publicUrl;
        } else {
            console.warn('Supabase credentials missing, skipping upload.');
            // Fail if we can't upload? Or mock?
            if (process.env.NODE_ENV === 'production') throw new Error('Failed to upload image');
        }

        // 2. Call Kie.ai API
        const apiKey = process.env.KIE_AI_API_KEY;
        if (apiKey && imageUrl) {
            const MANDATORY_INSTRUCTION = "Use the provided image as the absolute, immutable reference for all spatial and architectural data. It is mandatory to maintain the exact camera angle, lens focal length, camera height, and viewpoint from the original photo. Do not shift, pan, tilt, or reposition the virtual camera under any circumstances, preventing the model from defaulting to a standard eye-level perspective. The original vanishing points, horizon line, and structural geometry of the walls, windows, floor, and ceiling must remain identical to the source image. All added elements must sit flawlessly on the existing floor plane, conforming strictly to the established perspective and lighting without altering the layout. The final output must perfectly overlay the original architectural structure without any distortion, warping, or cropping. ";

            const prompt = mode === 'remove_furniture'
                ? `${MANDATORY_INSTRUCTION}Completely remove only the furnishings & decor. Must be able to see the complete floors & walls.`
                : `${MANDATORY_INSTRUCTION}Add only fully furnishings & decor in ${style} style. Do not add anything else. Do not modify anything in the original image especially structural elements. Anything added must be placed on top or overlayed over the original image.`;

            const createResponse = await fetch('https://api.kie.ai/api/v1/jobs/createTask', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    model: 'nano-banana-pro',
                    input: {
                        prompt: prompt,
                        image_input: [imageUrl],
                        aspect_ratio: aspectRatio || 'auto'
                    }
                }),
            });

            if (!createResponse.ok) {
                const errBody = await createResponse.text();
                throw new Error(`Kie.ai Create Error: ${createResponse.status} - ${errBody}`);
            }

            const createResult = await createResponse.json();
            console.log('[Kie.ai] Create Response:', JSON.stringify(createResult, null, 2));

            const taskId = createResult.data?.taskId || createResult.taskId || createResult.data?.id;

            if (!taskId) {
                console.error('[Kie.ai] Missing taskId. Full response:', JSON.stringify(createResult, null, 2));
                const msg = createResult.message || createResult.error || JSON.stringify(createResult);
                throw new Error(`Kie.ai Error: ${msg}`);
            }

            console.log(`[Kie.ai] Task created: ${taskId}`);

            // Return necessary info for client to poll
            return {
                success: true,
                taskId,
                originalUrl: imageUrl,
                mode,
                style,
                userId
            };
        }

        // Mock Fallback
        await new Promise(resolve => setTimeout(resolve, 1000));
        return {
            success: true,
            url: 'https://images.unsplash.com/photo-1618221195710-dd6b41faaea6?q=80&w=2000&auto=format&fit=crop',
            isMock: true
        };

    } catch (error: any) {
        console.error('Generation Error:', error);
        return { error: error.message || 'Failed to generate image' };
    }
}

export async function checkGenerationStatus(taskId: string, metadata: any) {
    const apiKey = process.env.KIE_AI_API_KEY;
    if (!apiKey) return { error: 'Server config error' };

    try {
        const queryResponse = await fetch(
            `https://api.kie.ai/api/v1/jobs/recordInfo?taskId=${taskId}`,
            {
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                },
                cache: 'no-store'
            }
        );

        if (!queryResponse.ok) {
            console.log(`[Kie.ai] Query failed: ${queryResponse.status}`);
            return { status: 'error', error: `Query failed: ${queryResponse.status}` };
        }

        const queryResult = await queryResponse.json();
        const state = queryResult.data?.state;

        console.log(`[Kie.ai] Check ${taskId}: State = ${state}`);

        if (state === 'success') {
            const resultJson = JSON.parse(queryResult.data.resultJson);
            const resultUrl = resultJson.resultUrls?.[0];

            if (resultUrl) {
                // SUCCESS!
                // Deduct credits & Save to DB if not already done

                const { userId, originalUrl, mode, style } = metadata;

                if (userId && supabaseUrl && supabaseKey) {
                    const supabase = createClient(supabaseUrl, supabaseKey);

                    // Check for duplicate to avoid double-charging on re-poll
                    const { data: existing } = await supabase
                        .from('generations')
                        .select('id')
                        .eq('result_url', resultUrl)
                        .single();

                    if (!existing) {
                        // Deduct credit
                        await deductCredit(userId);

                        // Save to DB
                        await supabase.from('generations').insert({
                            user_id: userId,
                            original_url: originalUrl,
                            result_url: resultUrl,
                            mode: mode,
                            style: mode === 'add_furniture' ? style : null,
                        });
                    }
                }

                return { status: 'success', url: resultUrl };
            }
        } else if (state === 'failed') {
            return { status: 'failed', error: 'Generation failed on provider side.' };
        }

        return { status: 'processing', state };

    } catch (error: any) {
        console.error('Check Status Error:', error);
        return { status: 'error', error: error.message };
    }
}
