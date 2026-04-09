-- Update credit system: $5 = 100 credits, 10 credits per image ($0.50)
-- No daily reset — free accounts get 100 credits on signup only.

-- New users get 100 credits ($5 value) on signup
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.users (id, email, credits, subscription_tier)
  VALUES (NEW.id, NEW.email, 100, 'free');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Remove daily reset function (no longer used)
DROP FUNCTION IF EXISTS reset_daily_credits();
