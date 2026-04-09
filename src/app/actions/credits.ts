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
            if (Date.now() > parsed.resetAt) return 5;
            return parsed.remaining;
        } catch {
            return 5;
        }
    }
    return 5;
}

// Credit costs — $5 = 100 credits, 1 credit = $0.05
export const CREDIT_COST_IMAGE = 10;       // $0.50 per image
export const CREDIT_COST_VIDEO_IMAGE = 10; // $0.50 per image in video

export async function checkCredits(userId: string, required = CREDIT_COST_IMAGE) {
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: user, error } = await supabase
        .from('users')
        .select('credits, subscription_tier, last_credit_reset')
        .eq('id', userId)
        .single();

    if (error) return { credits: 0, canGenerate: false };

    return {
        credits: user.credits,
        canGenerate: user.credits >= required,
        tier: user.subscription_tier,
    };
}

export async function deductCredit(userId: string, amount = CREDIT_COST_IMAGE) {
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: user } = await supabase
        .from('users')
        .select('credits')
        .eq('id', userId)
        .single();

    if (!user || user.credits < amount) {
        return { success: false, error: 'Insufficient credits' };
    }

    const { error } = await supabase
        .from('users')
        .update({ credits: user.credits - amount })
        .eq('id', userId);

    if (error) return { success: false, error: error.message };

    return { success: true, remaining: user.credits - amount };
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
