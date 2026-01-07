import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function POST(req: NextRequest) {
    try {
        const { userId, creditsToAdd } = await req.json();

        if (!userId || !creditsToAdd) {
            return NextResponse.json(
                { error: 'Missing userId or creditsToAdd' },
                { status: 400 }
            );
        }

        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
        const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

        if (!supabaseUrl || !supabaseKey) {
            return NextResponse.json(
                { error: 'Database not configured' },
                { status: 500 }
            );
        }

        const supabase = createClient(supabaseUrl, supabaseKey);

        // Get current credits
        const { data: user, error: fetchError } = await supabase
            .from('users')
            .select('credits, email')
            .eq('id', userId)
            .single();

        if (fetchError || !user) {
            return NextResponse.json(
                { error: 'User not found' },
                { status: 404 }
            );
        }

        const newCredits = (user.credits || 0) + creditsToAdd;

        // Add credits
        const { error: updateError } = await supabase
            .from('users')
            .update({ credits: newCredits })
            .eq('id', userId);

        if (updateError) {
            return NextResponse.json(
                { error: 'Failed to add credits' },
                { status: 500 }
            );
        }

        console.log(`Added ${creditsToAdd} credits to user ${user.email}, new total: ${newCredits}`);

        return NextResponse.json({
            success: true,
            previousCredits: user.credits,
            addedCredits: creditsToAdd,
            newCredits: newCredits,
        });
    } catch (error: any) {
        console.error('Add credits error:', error);
        return NextResponse.json(
            { error: error.message || 'Failed to add credits' },
            { status: 500 }
        );
    }
}
