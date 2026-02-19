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

async function setupDatabase() {
    console.log('🛠️ Setting up Supabase Database...');

    // We can't run raw SQL directly through the client easily without a stored function,
    // but we can try to "ping" the table or create it via a RPC if available, 
    // or just let the user know we've prepared the logic.
    // However, I will attempt to verify if the table exists by doing a small select.

    const { error } = await supabase.from('videos').select('id').limit(1);

    if (error && error.message.includes('does not exist')) {
        console.log('❌ Table "videos" does not exist.');
        console.log('👉 Please run the following SQL in your Supabase Dashboard:');
        console.log(`
create table public.videos (
  id bigint primary key generated always as identity,
  user_id uuid references auth.users not null,
  project_id uuid references projects(id) on delete cascade,
  video_url text not null,
  title text,
  image_count integer,
  created_at timestamp with time zone default now()
);

alter table public.videos enable row level security;

create policy "Users can view their own videos"
  on public.videos for select
  using (auth.uid() = user_id);

create policy "Users can insert their own videos"
  on public.videos for insert
  with check (auth.uid() = user_id);
        `);
    } else if (error) {
        console.error('Error checking table:', error.message);
    } else {
        console.log('✅ Table "videos" already exists!');
    }
}

setupDatabase();
