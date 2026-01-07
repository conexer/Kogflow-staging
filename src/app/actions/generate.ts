'use server';

import { createClient } from '@supabase/supabase-js';
import { checkCredits, deductCredit } from './credits';
import { cookies } from 'next/headers';

// Initialize Supabase Admin Client for server-side operations
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export async function generateImageAction(formData: FormData) {
    const file = formData.get('image') as File;
    const mode = formData.get('mode') as string;
    const style = formData.get('style') as string;
    const userId = formData.get('userId') as string;
    const aspectRatio = formData.get('aspectRatio') as string;

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
            return { error: 'Daily guest limit reached (2/24h). Log in for more.', needsUpgrade: true }; // needsUpgrade triggers redirect to pricing/signup potentially
        }

        // Decrement for guest (will save after success)
        guestData.remaining -= 1;

        // We set the cookie immediately or after success? 
        // Setting it here is safer to prevent authorized concurrency abuse, 
        // but if generation fails they lose a credit. 
        // Let's set it here for simplicity and safety.
        cookieStore.set('guest_credits', JSON.stringify(guestData), {
            expires: new Date(guestData.resetAt),
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax'
        });

    } else {
        const { canGenerate, credits } = await checkCredits(userId);
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
        }

        // 2. Call Kie.ai API (Correct Structure)
        const apiKey = process.env.KIE_AI_API_KEY;
        if (apiKey && imageUrl) {
            const MANDATORY_INSTRUCTION = "Use the provided image as the absolute, immutable reference for all spatial and architectural data. It is mandatory to maintain the exact camera angle, lens focal length, camera height, and viewpoint from the original photo. Do not shift, pan, tilt, or reposition the virtual camera under any circumstances, preventing the model from defaulting to a standard eye-level perspective. The original vanishing points, horizon line, and structural geometry of the walls, windows, floor, and ceiling must remain identical to the source image. All added elements must sit flawlessly on the existing floor plane, conforming strictly to the established perspective and lighting without altering the layout. The final output must perfectly overlay the original architectural structure without any distortion, warping, or cropping. ";

            const prompt = mode === 'remove_furniture'
                ? `${MANDATORY_INSTRUCTION}Completely remove only the furnishings & decor. Must be able to see the complete floors & walls.`
                : `${MANDATORY_INSTRUCTION}Add only fully furnishings & decor in ${style} style. Do not add anything else. Do not modify anything in the original image especially structural elements. Anything added must be placed on top or overlayed over the original image.`;

            // Step 1: Create Task
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
                console.error('[Kie.ai] Full response:', createResult);
                throw new Error('No taskId returned from Kie.ai');
            }

            // Step 2: Poll for result (with timeout)
            let attempts = 0;
            const maxAttempts = 120; // 120 seconds max (2 minutes)

            console.log(`[Kie.ai] Task created: ${taskId}`);

            while (attempts < maxAttempts) {
                await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second

                const queryResponse = await fetch(
                    `https://api.kie.ai/api/v1/jobs/recordInfo?taskId=${taskId}`,
                    {
                        headers: {
                            'Authorization': `Bearer ${apiKey}`,
                        },
                    }
                );

                if (!queryResponse.ok) {
                    console.log(`[Kie.ai] Query failed: ${queryResponse.status}`);
                    continue;
                }

                const queryResult = await queryResponse.json();
                const state = queryResult.data?.state;

                console.log(`[Kie.ai] Attempt ${attempts}: State = ${state}`);

                if (state === 'success') {
                    const resultJson = JSON.parse(queryResult.data.resultJson);
                    const resultUrl = resultJson.resultUrls?.[0];

                    if (resultUrl) {
                        console.log(`[Kie.ai] Success! URL: ${resultUrl}`);

                        if (!isGuest && userId) {
                            // Deduct credit only for logged-in users
                            await deductCredit(userId);

                            // Save to database only for logged in users (or if we want to track guests anonymously we'd need a different table/schema)
                            if (supabaseUrl && supabaseKey) {
                                const supabase = createClient(supabaseUrl, supabaseKey);
                                await supabase.from('generations').insert({
                                    user_id: userId,
                                    original_url: imageUrl,
                                    result_url: resultUrl,
                                    mode: mode,
                                    style: mode === 'add_furniture' ? style : null,
                                });
                            }
                        }

                        return { success: true, url: resultUrl };
                    }
                } else if (state === 'failed') {
                    console.error('[Kie.ai] Task failed');
                    throw new Error('Kie.ai generation failed');
                }

                attempts++;
            }

            throw new Error('Kie.ai generation timeout');
        }

        // 3. Mock Fallback (if no API key)
        await new Promise(resolve => setTimeout(resolve, 2000));
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
