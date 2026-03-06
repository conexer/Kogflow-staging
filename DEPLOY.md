# Deploy Kogflow to Vercel

## Preparation Complete ✓
- Build verified
- Git initialized
- Mock AI enabled

## Deploy Steps

### Option 1: Vercel Dashboard (Easiest)
1. Go to [vercel.com](https://vercel.com) → Sign in with GitHub
2. Click **"Add New Project"**
3. Click **"Import Git Repository"** → Select `kogflow` folder
4. **Environment Variables** (IMPORTANT):
   ```
   NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
   NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
   SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
   ```
5. Click **Deploy**
6. Wait ~2 minutes → Get your live URL!

### Option 2: Command Line
```bash
npx vercel
```
Follow prompts and paste environment variables when asked.

## Post-Deploy
- Update Supabase allowed domains (Settings → API → Site URL)
- Your live URL: `https://kogflow.vercel.app` (or similar)
