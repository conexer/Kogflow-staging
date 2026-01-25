-- Add project_id to generations table
ALTER TABLE public.generations 
ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE;

-- Create assets table for persistent uploads
CREATE TABLE IF NOT EXISTS public.assets (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id uuid REFERENCES public.users(id) NOT NULL,
    project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE,
    url text NOT NULL,
    type text DEFAULT 'image', -- 'image' or 'video'
    filename text,
    created_at timestamp with time zone DEFAULT now()
);

-- RLS Policies (Optional but recommended)
ALTER TABLE public.assets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own assets" ON public.assets
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own assets" ON public.assets
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own assets" ON public.assets
    FOR DELETE USING (auth.uid() = user_id);
