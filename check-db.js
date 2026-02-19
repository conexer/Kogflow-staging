const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

function getEnv(key) {
    try {
        const envPath = path.resolve(process.cwd(), '.env.local');
        if (fs.existsSync(envPath)) {
            const content = fs.readFileSync(envPath, 'utf8');
            const lines = content.split('\n');
            for (const line of lines) {
                if (line.startsWith(key + '=')) {
                    return line.substring(key.length + 1).replace(/"/g, '').trim();
                }
            }
        }
    } catch (e) { }
    return process.env[key];
}

const supabaseUrl = getEnv('NEXT_PUBLIC_SUPABASE_URL');
const supabaseKey = getEnv('SUPABASE_SERVICE_ROLE_KEY');

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkRecentVideos() {
    console.log('🔍 Fetching recent videos from "videos" table...');
    const { data, error } = await supabase
        .from('videos')
        .select('*')
        .order('id', { ascending: false })
        .limit(5);

    if (error) {
        console.error('Error:', error.message);
        // Check if table exists by trying to list columns or just error out
        if (error.message.includes('does not exist')) {
            console.log('⚠️ Table "videos" does not exist yet.');
        }
        return;
    }

    if (data.length === 0) {
        console.log('No videos found in table.');
    } else {
        data.forEach(v => {
            console.log(`[${v.id}] ${v.title} - ${v.video_url}`);
        });
    }
}

checkRecentVideos();
