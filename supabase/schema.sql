-- Updated schema for full auth and payment system

-- Update users table with all Stripe fields
ALTER TABLE public.users 
ADD COLUMN IF NOT EXISTS subscription_status text DEFAULT 'active',
ADD COLUMN IF NOT EXISTS stripe_subscription_id text,
ADD COLUMN IF NOT EXISTS subscription_period_end timestamp with time zone,
ADD COLUMN IF NOT EXISTS last_credit_reset timestamp with time zone DEFAULT now();

-- Create usage logs table for tracking generation history
CREATE TABLE IF NOT EXISTS public.usage_logs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES public.users NOT NULL,
  generation_id uuid REFERENCES public.generations,
  credits_used integer DEFAULT 1,
  created_at timestamp with time zone DEFAULT now()
);

-- Enable RLS on usage logs
ALTER TABLE public.usage_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own usage" ON public.usage_logs
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "System can insert usage logs" ON public.usage_logs
  FOR INSERT WITH CHECK (true);

-- Update generations table to use correct column names
ALTER TABLE public.generations 
RENAME COLUMN original_image_path TO original_url;

ALTER TABLE public.generations 
RENAME COLUMN generated_image_path TO result_url;

-- Function to reset daily credits for free users
CREATE OR REPLACE FUNCTION reset_daily_credits()
RETURNS void AS $$
BEGIN
  UPDATE public.users
  SET credits = 2,
      last_credit_reset = NOW()
  WHERE subscription_tier = 'free'
    AND last_credit_reset < (NOW() - INTERVAL '24 hours');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to be called on new user signup
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.users (id, email, credits, subscription_tier)
  VALUES (NEW.id, NEW.email, 2, 'free');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to create user profile on signup
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();
