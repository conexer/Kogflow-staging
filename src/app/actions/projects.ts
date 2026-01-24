'use server';

import { createClient } from '@supabase/supabase-js';
import { revalidatePath } from 'next/cache';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export async function createProject(userId: string, name: string) {
    if (!supabaseUrl || !supabaseKey) {
        return { error: 'Database configuration missing' };
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    try {
        const { data, error } = await supabase
            .from('projects')
            .insert({
                user_id: userId,
                name: name,
            })
            .select()
            .single();

        if (error) throw error;
        revalidatePath('/dashboard');
        return { success: true, project: data };
    } catch (error: any) {
        console.error('Create project error:', error);
        return { error: error.message };
    }
}

export async function getProjects(userId: string) {
    if (!supabaseUrl || !supabaseKey) {
        return { projects: [] };
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    try {
        const { data, error } = await supabase
            .from('projects')
            .select('*')
            .eq('user_id', userId)
            .order('created_at', { ascending: false });

        if (error) throw error;
        return { projects: data || [] };
    } catch (error: any) {
        console.error('Get projects error:', error);
        return { projects: [] };
    }
}

export async function renameProject(projectId: string, newName: string) {
    if (!supabaseUrl || !supabaseKey) return { error: 'Config missing' };
    const supabase = createClient(supabaseUrl, supabaseKey);

    try {
        const { error } = await supabase
            .from('projects')
            .update({ name: newName })
            .eq('id', projectId);

        if (error) throw error;
        revalidatePath('/dashboard');
        return { success: true };
    } catch (error: any) {
        return { error: error.message };
    }
}

export async function deleteProject(projectId: string) {
    if (!supabaseUrl || !supabaseKey) return { error: 'Config missing' };
    const supabase = createClient(supabaseUrl, supabaseKey);

    try {
        const { error } = await supabase
            .from('projects')
            .delete()
            .eq('id', projectId);

        if (error) throw error;
        revalidatePath('/dashboard');
        return { success: true };
    } catch (error: any) {
        return { error: error.message };
    }
}
