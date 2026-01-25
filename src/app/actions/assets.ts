'use server';

import { createClient } from '@supabase/supabase-js';
import { revalidatePath } from 'next/cache';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export async function uploadAsset(userId: string, projectId: string, file: File) {
    if (!supabaseUrl || !supabaseKey) {
        return { error: 'Server configuration missing' };
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    try {
        // 1. Upload to Supabase Storage
        const buffer = await file.arrayBuffer();
        const fileExt = file.name.split('.').pop();
        const filename = `project-assets/${projectId}/${Date.now()}_${Math.random().toString(36).substring(7)}.${fileExt}`;

        const { error: uploadError } = await supabase.storage
            .from('uploads')
            .upload(filename, buffer, {
                contentType: file.type,
                upsert: false
            });

        if (uploadError) throw uploadError;

        const { data: { publicUrl } } = supabase.storage
            .from('uploads')
            .getPublicUrl(filename);

        // 2. Insert into Assets Table
        const { data: asset, error: dbError } = await supabase
            .from('assets')
            .insert({
                user_id: userId,
                project_id: projectId,
                url: publicUrl,
                type: file.type.startsWith('video') ? 'video' : 'image',
                filename: file.name
            })
            .select()
            .single();

        if (dbError) throw dbError;

        revalidatePath('/dashboard');
        return { success: true, asset };

    } catch (error: any) {
        console.error('Upload Asset Error:', error);
        return { error: error.message };
    }
}

export async function getProjectAssets(projectId: string) {
    if (!supabaseUrl || !supabaseKey) return { assets: [], generations: [] };
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Validate UUID format to prevent DB errors for guest projects
    // Guest projects have IDs like "guest-123" which are not valid UUIDs
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(projectId)) {
        return { assets: [], generations: [] };
    }

    try {
        // Fetch User Uploads
        const { data: assets, error: assetsError } = await supabase
            .from('assets')
            .select('*')
            .eq('project_id', projectId)
            .order('created_at', { ascending: false });

        if (assetsError) throw assetsError;

        // Fetch AI Generations
        const { data: generations, error: genError } = await supabase
            .from('generations')
            .select('*')
            .eq('project_id', projectId)
            .order('created_at', { ascending: false });

        if (genError) throw genError;

        return {
            assets: assets || [],
            generations: generations || []
        };

    } catch (error: any) {
        console.error('Fetch Assets Error:', error);
        return { assets: [], generations: [], error: error.message };
    }
}
