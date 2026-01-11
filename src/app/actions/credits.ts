'use server';

import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export async function getGuestCredits() {
    const cookieStore = await cookies();
    const guestCookie = cookieStore.get('guest_credits');
    if (guestCookie) {
        try {
            const parsed = JSON.parse(guestCookie.value);
            // If expired, effectively they have full credits again (logic in generate.ts handles reset)
            if (Date.now() > parsed.resetAt) return 2;
            return parsed.remaining;
        } catch {
            return 2;
        }
    }
    return 2;
}

export async function checkCredits(userId: string) {
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: user, error } = await supabase
        .from('users')
        .select('credits, subscription_tier, last_credit_reset')
        .eq('id', userId)
        .single();

    if (error) return { credits: 0, canGenerate: false };

    // Check if free user needs daily reset
    if (user.subscription_tier === 'free') {
        const lastReset = new Date(user.last_credit_reset);
        const now = new Date();
        const hoursSinceReset = (now.getTime() - lastReset.getTime()) / (1000 * 60 * 60);

        if (hoursSinceReset >= 24) {
            // Reset credits
            await supabase
                .from('users')
                .update({ credits: 2, last_credit_reset: now.toISOString() })
                .eq('id', userId);

            return { credits: 2, canGenerate: true, tier: user.subscription_tier };
        }
    }

    return {
        credits: user.credits,
        canGenerate: user.credits > 0,
        tier: user.subscription_tier,
    };
}

export async function deductCredit(userId: string) {
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: user } = await supabase
        .from('users')
        .select('credits')
        .eq('id', userId)
        .single();

    if (!user || user.credits <= 0) {
        return { success: false, error: 'Insufficient credits' };
    }

    const { error } = await supabase
        .from('users')
        .update({ credits: user.credits - 1 })
        .eq('id', userId);

    if (error) return { success: false, error: error.message };

    return { success: true, remaining: user.credits - 1 };
}

export async function getUserProfile(userId: string) {
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('id', userId)
        .single();

    if (error) return null;

    // Fetch recent generations
    const { data: recentGenerations } = await supabase
        .from('generations')
        .select('id, original_url, result_url, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(6);

    return {
        ...data,
        credits: data?.credits || 0,
        has_subscription: !!data?.subscription_status && data?.subscription_status === 'active',
        recentGenerations: recentGenerations || []
    };
}

export async function addCredits(userId: string, amount: number) {
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: user } = await supabase
        .from('users')
        .select('credits')
        .eq('id', userId)
        .single();

    if (!user) return { success: false };

    const { error } = await supabase
        .from('users')
        .update({ credits: user.credits + amount })
        .eq('id', userId);

    return { success: !error };
}
