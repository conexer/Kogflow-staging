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

if (!supabaseUrl || !supabaseKey) {
    console.error('Missing Supabase credentials');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkBucket() {
    console.log('🔍 Checking Supabase storage bucket "videos"...');
    const { data: buckets, error } = await supabase.storage.listBuckets();

    if (error) {
        console.error('Error listing buckets:', error.message);
        return;
    }

    const bucketExists = buckets.find(b => b.name === 'videos');
    if (bucketExists) {
        console.log('✅ "videos" bucket exists!');
    } else {
        console.warn('❌ "videos" bucket NOT found.');
        console.log('Existing buckets:', buckets.map(b => b.name).join(', '));

        console.log('🚀 Attempting to create "videos" bucket...');
        const { data, error: createError } = await supabase.storage.createBucket('videos', {
            public: true
        });

        if (createError) {
            console.error('Failed to create bucket:', createError.message);
        } else {
            console.log('✅ Bucket created successfully!');
        }
    }
}

checkBucket();
