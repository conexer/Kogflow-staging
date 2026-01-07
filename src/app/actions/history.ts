'use server';

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export async function saveGenerationAction(data: {
    userId: string;
    originalUrl: string;
    resultUrl: string;
    mode: string;
    style?: string;
}) {
    if (!supabaseUrl || !supabaseKey) {
        console.warn('Supabase credentials missing');
        return { error: 'Database not configured' };
    }

    try {
        const supabase = createClient(supabaseUrl, supabaseKey);

        const { data: generation, error } = await supabase
            .from('generations')
            .insert({
                user_id: data.userId,
                original_url: data.originalUrl,
                result_url: data.resultUrl,
                mode: data.mode,
                style: data.style,
            })
            .select()
            .single();

        if (error) throw error;

        return { success: true, generation };
    } catch (error: any) {
        console.error('Save generation error:', error);
        return { error: error.message };
    }
}

export async function getGenerationsAction(userId: string) {
    if (!supabaseUrl || !supabaseKey) {
        return { generations: [] };
    }

    try {
        const supabase = createClient(supabaseUrl, supabaseKey);

        const { data, error } = await supabase
            .from('generations')
            .select('*')
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .limit(50);

        if (error) throw error;

        return { generations: data || [] };
    } catch (error: any) {
        console.error('Get generations error:', error);
        return { generations: [] };
    }
}
