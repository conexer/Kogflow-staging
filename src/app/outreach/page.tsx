'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useAuth } from '@/lib/auth-context';
import { useRouter } from 'next/navigation';
import {
    Search, MapPin, Star, Clock, TrendingDown, Image, Mail, Users,
    Play, Settings, RefreshCw, CheckCircle, AlertCircle,
    Zap, Database, Send, BarChart2, Copy, Terminal,
    ChevronRight, ExternalLink
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { getLeadStats, getLeads, runPipelineSession, logPipelineRun, detectRoom, sendOutreachEmail, updateLeadStatus, savePipelineConfig, loadPipelineConfig, getRecentRuns, testAllSites, getSiteStats, getSessionLog, submitStagingBatch, pollAndQueueStagedLeads, drainEmailBacklog, sendTestEmail, scanAndStageHighScoreBacklog, scanForEmptyRooms, getRecentActivityLog, getActiveSession, requestSessionStop, getCronStatus, backfillScoredStatus, checkAndReplyToOutreach, getOutreachReplies, markReplyReviewed, type SiteTestResult } from '@/app/actions/outreach';
import { toast } from 'sonner';

const ALLOWED_EMAILS = ['conexer@gmail.com', 'rocsolid01@gmail.com'];

type LeadStatus = 'scraped' | 'scored' | 'staged' | 'queued' | 'form_filled' | 'emailed';

const STATUS_COLORS: Record<string, string> = {
    scraped: 'bg-slate-500/20 text-slate-400',
    scored: 'bg-blue-500/20 text-blue-400',
    staged: 'bg-violet-500/20 text-violet-400',
    queued: 'bg-cyan-500/20 text-cyan-400',
    form_filled: 'bg-amber-500/20 text-amber-400',
    emailed: 'bg-green-500/20 text-green-400',
};

const STATUS_LABELS: Record<string, string> = {
    scraped: 'Scraped',
    scored: 'Scored',
    staged: 'Staged',
    queued: 'Queued',
    form_filled: 'Form Filled',
    emailed: 'Emailed',
};

// National target market pool for rotating outreach sessions
const CITIES = [
    { region: 'Southwest Growth', cities: ['Phoenix, AZ', 'Scottsdale, AZ', 'Mesa, AZ', 'Tucson, AZ', 'Las Vegas, NV', 'Henderson, NV', 'Denver, CO', 'Aurora, CO', 'Colorado Springs, CO', 'Albuquerque, NM'] },
    { region: 'Inland West', cities: ['Boise, ID', 'Salt Lake City, UT'] },
    { region: 'Southeast Demand', cities: ['Atlanta, GA', 'Charlotte, NC', 'Raleigh, NC', 'Durham, NC', 'Greensboro, NC', 'Charleston, SC', 'Nashville, TN', 'Memphis, TN', 'Tampa, FL', 'Orlando, FL', 'Jacksonville, FL', 'Miami, FL', 'Birmingham, AL', 'New Orleans, LA'] },
    { region: 'Mid-Atlantic', cities: ['Richmond, VA', 'Virginia Beach, VA'] },
    { region: 'Midwest Expansion', cities: ['Kansas City, MO', 'St. Louis, MO', 'Indianapolis, IN', 'Columbus, OH', 'Cincinnati, OH', 'Louisville, KY', 'Oklahoma City, OK'] },
    { region: 'West Coast Reach', cities: ['Sacramento, CA', 'Fresno, CA', 'Portland, OR', 'Seattle, WA'] },
    { region: 'Texas Coverage', cities: ['Austin, TX', 'Dallas, TX', 'Fort Worth, TX', 'San Antonio, TX', 'Houston, TX', 'Katy, TX', 'Sugar Land, TX', 'Spring, TX', 'Pearland, TX', 'The Woodlands, TX', 'Cypress, TX', 'Pasadena, TX', 'Humble, TX', 'Friendswood, TX'] },
];

const SETUP_SQL = `-- Run this in Supabase SQL Editor

-- Leads table
CREATE TABLE IF NOT EXISTS public.outreach_leads (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  address TEXT NOT NULL,
  city TEXT,
  price INTEGER,
  days_on_market INTEGER DEFAULT 0,
  price_reduced BOOLEAN DEFAULT FALSE,
  photo_count INTEGER DEFAULT 0,
  agent_name TEXT,
  agent_phone TEXT,
  agent_email TEXT,
  listing_url TEXT,
  keywords TEXT[],
  icp_score INTEGER DEFAULT 0,
  empty_rooms JSONB DEFAULT '[]',
  staging_task_id TEXT,
  staged_image_url TEXT,
  status TEXT DEFAULT 'scraped',
  contacted_at TIMESTAMPTZ,
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_outreach_leads_score ON public.outreach_leads (icp_score DESC);
CREATE INDEX IF NOT EXISTS idx_outreach_leads_status ON public.outreach_leads (status);

ALTER TABLE public.outreach_leads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON public.outreach_leads
  USING (TRUE) WITH CHECK (TRUE);

-- Permanent outreach recipient locks (one cold email per normalized recipient)
CREATE TABLE IF NOT EXISTS public.outreach_email_locks (
  normalized_email TEXT PRIMARY KEY CHECK (normalized_email = lower(btrim(normalized_email)) AND normalized_email <> ''),
  agent_email TEXT NOT NULL,
  first_lead_id UUID REFERENCES public.outreach_leads(id) ON DELETE SET NULL,
  first_address TEXT,
  source TEXT NOT NULL DEFAULT 'outreach',
  status TEXT NOT NULL DEFAULT 'claimed',
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ,
  gmail_thread_id TEXT,
  gmail_message_id TEXT,
  failure_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_outreach_email_locks_status ON public.outreach_email_locks (status);
CREATE INDEX IF NOT EXISTS idx_outreach_email_locks_sent_at ON public.outreach_email_locks (sent_at DESC);

ALTER TABLE public.outreach_email_locks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON public.outreach_email_locks
  USING (TRUE) WITH CHECK (TRUE);

-- Pipeline config (single row, id = 1)
CREATE TABLE IF NOT EXISTS public.pipeline_config (
  id INTEGER PRIMARY KEY DEFAULT 1,
  sessions_per_day INTEGER NOT NULL DEFAULT 20,
  scrapes_per_session INTEGER NOT NULL DEFAULT 100,
  cities TEXT[] NOT NULL DEFAULT ARRAY['Phoenix, AZ','Scottsdale, AZ','Las Vegas, NV','Denver, CO','Atlanta, GA','Charlotte, NC','Nashville, TN','Tampa, FL','Orlando, FL','Sacramento, CA','Dallas, TX','Houston, TX'],
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.pipeline_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON public.pipeline_config
  USING (TRUE) WITH CHECK (TRUE);

-- Pipeline run log (one row per cron execution)
CREATE TABLE IF NOT EXISTS public.pipeline_runs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  ran_at TIMESTAMPTZ DEFAULT NOW(),
  processed INTEGER NOT NULL DEFAULT 0,
  errors TEXT[] NOT NULL DEFAULT '{}',
  trigger TEXT DEFAULT 'cron'
);

ALTER TABLE public.pipeline_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON public.pipeline_runs
  USING (TRUE) WITH CHECK (TRUE);

-- Add trigger column to existing pipeline_runs (idempotent)
ALTER TABLE public.pipeline_runs ADD COLUMN IF NOT EXISTS trigger TEXT DEFAULT 'cron';

-- Add cron_enabled to pipeline_config (idempotent)
ALTER TABLE public.pipeline_config ADD COLUMN IF NOT EXISTS cron_enabled BOOLEAN DEFAULT TRUE;
ALTER TABLE public.pipeline_config ADD COLUMN IF NOT EXISTS emails_per_day INTEGER DEFAULT 300;

-- Site scrape log (one row per site per pipeline run)
CREATE TABLE IF NOT EXISTS public.site_scrape_log (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  ran_at TIMESTAMPTZ DEFAULT NOW(),
  site TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'error',
  listings_found INTEGER NOT NULL DEFAULT 0,
  addresses_found INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_site_scrape_log_site ON public.site_scrape_log (site);
CREATE INDEX IF NOT EXISTS idx_site_scrape_log_ran_at ON public.site_scrape_log (ran_at DESC);

ALTER TABLE public.site_scrape_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON public.site_scrape_log
  USING (TRUE) WITH CHECK (TRUE);

-- Real-time session log (written during pipeline run, polled by UI)
CREATE TABLE IF NOT EXISTS public.pipeline_session_log (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id TEXT NOT NULL,
  logged_at TIMESTAMPTZ DEFAULT NOW(),
  message TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pipeline_session_log ON public.pipeline_session_log (session_id, logged_at);

ALTER TABLE public.pipeline_session_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON public.pipeline_session_log
  USING (TRUE) WITH CHECK (TRUE);`;

export default function OutreachPage() {
    const { user, loading } = useAuth();
    const router = useRouter();
    const [authorized, setAuthorized] = useState(false);
    const [dbReady, setDbReady] = useState<boolean | null>(null);

    // Stats
    const [stats, setStats] = useState({ total: 0, scraped: 0, scored: 0, staged: 0, queued: 0, stagedEver: 0, form_filled: 0, emailed: 0, avgScore: 0, totalPhotos: 0, leadsWithPhotos: 0, emptyRoomsFound: 0 });
    const [leads, setLeads] = useState<any[]>([]);
    const [loadingData, setLoadingData] = useState(false);

    // Stats reset (stored in localStorage — no DB migration needed)
    const [statsResetAt, setStatsResetAt] = useState<string | undefined>(() =>
        typeof window !== 'undefined' ? (localStorage.getItem('stats_reset_at') ?? undefined) : undefined
    );
    const [resettingStats, setResettingStats] = useState(false);

    // Pipeline config
    const [sessionsPerDay, setSessionsPerDay] = useState(20);
    const [scrapesPerSession, setScrapesPerSession] = useState(100);
    const [emailsPerDay, setEmailsPerDay] = useState(300);
    const [selectedCities, setSelectedCities] = useState<string[]>(CITIES.flatMap(region => region.cities));
    const [pipelineRunning, setPipelineRunning] = useState(false);
    const [runningSession, setRunningSession] = useState(false);
    const [activeTab, setActiveTab] = useState<'dashboard' | 'leads' | 'config' | 'email' | 'setup' | 'replies'>('dashboard');
    const [replies, setReplies] = useState<any[]>([]);
    const [repliesLoading, setRepliesLoading] = useState(false);
    const [checkingReplies, setCheckingReplies] = useState(false);
    const [repliesFilter, setRepliesFilter] = useState<'all' | 'unreviewed'>('unreviewed');

    // Cron schedule status
    const [cronStatus, setCronStatus] = useState<{
        cron_enabled: boolean; sessions_per_day: number; today_cron_runs: number;
        last_cron_run: string | null; next_scheduled_utc: string; expected_so_far: number; schedule: string;
    } | null>(null);
    const [togglingCron, setTogglingCron] = useState(false);

    // Config save state
    const [savingConfig, setSavingConfig] = useState(false);
    const [recentRuns, setRecentRuns] = useState<any[]>([]);
    const [lastDebug, setLastDebug] = useState<string[]>([]);

    // Activity log (persistent, all sessions)
    const [activityLog, setActivityLog] = useState<{ logged_at: string; session_id: string; message: string }[]>([]);
    const activityLogRef = useRef<HTMLDivElement>(null);

    // Live session log
    const [liveLog, setLiveLog] = useState<string[]>([]);
    const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
    const liveLogRef = useRef<HTMLDivElement>(null);
    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

    // Site tester
    const [siteResults, setSiteResults] = useState<SiteTestResult[]>([]);
    const [testingsSites, setTestingSites] = useState(false);
    const [siteStats, setSiteStats] = useState<any[]>([]);

    // Test tools
    const [testImageUrl, setTestImageUrl] = useState('');
    const [testResult, setTestResult] = useState<any>(null);
    const [testLoading, setTestLoading] = useState(false);

    useEffect(() => {
        if (!loading) {
            if (!user) { router.replace('/login'); return; }
            if (!ALLOWED_EMAILS.includes(user.email || '')) { router.replace('/dashboard'); return; }
            setAuthorized(true);
        }
    }, [user, loading, router]);

    const loadData = useCallback(async () => {
        setLoadingData(true);
        try {
            const resetAt = typeof window !== 'undefined' ? (localStorage.getItem('stats_reset_at') ?? undefined) : undefined;
            const [statsRes, leadsRes, configRes, runsRes, siteStatsRes, activityRes, activeSessionRes, cronStatusRes] = await Promise.all([
                getLeadStats(resetAt), getLeads(), loadPipelineConfig(), getRecentRuns(), getSiteStats(), getRecentActivityLog(), getActiveSession(), getCronStatus(),
            ]);
            setCronStatus(cronStatusRes);
            if ('error' in statsRes && statsRes.error?.includes('outreach_leads')) {
                setDbReady(false);
                setActiveTab('setup');
            } else {
                setDbReady(true);
                if (statsRes.stats) setStats(statsRes.stats);
                if (leadsRes.leads) setLeads(leadsRes.leads);
                if (configRes.config) {
                    setSessionsPerDay(configRes.config.sessions_per_day);
                    setScrapesPerSession(configRes.config.scrapes_per_session);
                    setEmailsPerDay(configRes.config.emails_per_day ?? 10);
                    setSelectedCities(configRes.config.cities);
                    if (configRes.warning) toast.warning(configRes.warning, { id: 'pipeline-config-warning' });
                }
                if (runsRes.runs) setRecentRuns(runsRes.runs);
                if (siteStatsRes.stats) setSiteStats(siteStatsRes.stats);
                if (activityRes.entries) {
                    setActivityLog(activityRes.entries);
                    setTimeout(() => {
                        if (activityLogRef.current) activityLogRef.current.scrollTop = activityLogRef.current.scrollHeight;
                    }, 50);
                }
                // Resume running state if a session is still active (survives page reload)
                if (activeSessionRes.isRunning && activeSessionRes.sessionId && !runningSession) {
                    setRunningSession(true);
                    setActiveSessionId(activeSessionRes.sessionId);
                    // Start polling the activity log
                    if (!pollRef.current) {
                        pollRef.current = setInterval(async () => {
                            const [{ entries }, { isRunning }] = await Promise.all([
                                getRecentActivityLog(),
                                getActiveSession(),
                            ]);
                            if (entries) {
                                setActivityLog(entries);
                                if (activityLogRef.current) activityLogRef.current.scrollTop = activityLogRef.current.scrollHeight;
                            }
                            if (!isRunning) {
                                clearInterval(pollRef.current!);
                                pollRef.current = null;
                                setRunningSession(false);
                                setActiveSessionId(null);
                                await loadData();
                            }
                        }, 2000);
                    }
                }
            }

        } catch {
            setDbReady(false);
        }
        setLoadingData(false);
    }, []);

    useEffect(() => {
        if (authorized) loadData();
    }, [authorized, loadData]);

    const startSessionAndEnableCron = async (sessionId: string) => {
        const startPolling = () => {
            if (pollRef.current) clearInterval(pollRef.current);
            pollRef.current = setInterval(async () => {
                const [activityRes, activeRes] = await Promise.all([
                    getRecentActivityLog(),
                    getActiveSession(),
                ]);
                if (activityRes.entries) {
                    setActivityLog(activityRes.entries);
                    if (activityLogRef.current) activityLogRef.current.scrollTop = activityLogRef.current.scrollHeight;
                }
                if (!activeRes.isRunning) {
                    clearInterval(pollRef.current!);
                    pollRef.current = null;
                    setRunningSession(false);
                    setActiveSessionId(null);
                    toast.success('Session complete');
                    await loadData();
                }
            }, 2000);
        };

        startPolling();

        const res = await fetch('/api/trigger-session', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cities: selectedCities, scrapesPerSession, sessionId }),
        });
        const text = await res.text();
        let data: any;
        try { data = JSON.parse(text); } catch { throw new Error(`Server error (${res.status}): ${text.slice(0, 120)}`); }
        if (!res.ok || !data.started) throw new Error(data.error || 'Failed to start session');

        // Enable cron schedule — persists across refreshes
        await savePipelineConfig({
            sessions_per_day: sessionsPerDay,
            scrapes_per_session: scrapesPerSession,
            emails_per_day: emailsPerDay,
            cities: selectedCities,
            cron_enabled: true,
        });
        setCronStatus(prev => prev ? { ...prev, cron_enabled: true } : prev);
    };

    const handleRunSession = async () => {
        if (selectedCities.length === 0) { toast.error('Select at least one city'); return; }
        const sessionId = crypto.randomUUID();
        setActiveSessionId(sessionId);
        setLiveLog([]);
        setLastDebug([]);
        setRunningSession(true);
        toast.loading('Starting pipeline session...', { id: 'pipeline' });
        try {
            await startSessionAndEnableCron(sessionId);
            toast.dismiss('pipeline');
            toast.success('Pipeline running — schedule active until you stop it');
        } catch (e: any) {
            toast.dismiss('pipeline');
            toast.error(e.message || 'Session failed to start');
            if (pollRef.current) {
                clearInterval(pollRef.current);
                pollRef.current = null;
            }
            setActiveSessionId(null);
            setRunningSession(false);
        }
    };

    const handleSaveConfig = async () => {
        setSavingConfig(true);
        const result = await savePipelineConfig({
            sessions_per_day: sessionsPerDay,
            scrapes_per_session: scrapesPerSession,
            emails_per_day: emailsPerDay,
            cities: selectedCities,
            cron_enabled: cronStatus?.cron_enabled ?? true,
        });
        setSavingConfig(false);
        if (result.error) toast.error(`Save failed: ${result.error}`);
        else if (result.warning) toast.warning(result.warning);
        else toast.success('Config saved — cron will use these settings');
    };

    const handleTestSites = async () => {
        setTestingSites(true);
        setSiteResults([]);
        toast.loading('Testing all 8 sites with Zyte...', { id: 'sitetest' });
        try {
            const results = await testAllSites(selectedCities[0]);
            setSiteResults(results);
            toast.dismiss('sitetest');
            const okCount = results.filter(r => r.status === 'ok').length;
            if (okCount > 0) toast.success(`${okCount}/8 sites returned full HTML`);
            else toast.error('All sites blocked or empty');
        } catch (e: any) {
            toast.dismiss('sitetest');
            toast.error(e.message || 'Test failed');
        }
        setTestingSites(false);
    };

    const handleScanEmptyRooms = async () => {
        toast.loading('Scanning 3 leads for empty rooms (~2 min)...', { id: 'scanempty' });
        try {
            const result = await scanForEmptyRooms(3);
            toast.dismiss('scanempty');
            if (result.found > 0) {
                toast.success(`Found ${result.found} empty rooms in ${result.scanned} leads scanned!`);
                loadData();
            } else {
                toast.info(`Scanned ${result.scanned} leads — no empty rooms found`);
            }
        } catch (e: any) {
            toast.dismiss('scanempty');
            toast.error(e.message || 'Scan failed');
        }
    };

    const handleSubmitBatch = async () => {
        toast.loading('Submitting 3 leads to Kie.ai...', { id: 'stagebatch' });
        try {
            const result = await submitStagingBatch(3);
            toast.dismiss('stagebatch');
            if (result.submitted > 0) {
                toast.success(`${result.submitted} leads submitted to Kie.ai - wait ~2 min then queue ready emails`);
                loadData();
            } else if (result.errors[0]?.toLowerCase().includes('credit')) {
                toast.error('Kie.ai credits insufficient — top up at kie.ai');
            } else {
                toast.error(`0 submitted. ${result.errors[0] || 'Unknown error'}`);
            }
        } catch (e: any) {
            toast.dismiss('stagebatch');
            toast.error(e.message || 'Submit failed');
        }
    };

    const handlePollAndEmail = async () => {
        toast.loading('Polling Kie.ai and queueing ready emails...', { id: 'pollemail' });
        try {
            const result = await pollAndQueueStagedLeads();
            toast.dismiss('pollemail');
            if (result.queued > 0) {
                toast.success(`${result.queued} emails queued for spaced sending`);
                loadData();
            } else if (result.stillProcessing > 0) {
                toast.info(`${result.stillProcessing} still generating — try again in a minute`);
            } else if (result.failed > 0) {
                toast.error(`${result.failed} failed (reset to scraped). ${result.errors[0] || ''}`);
                loadData();
            } else {
                toast.info('No staged leads to poll');
            }
        } catch (e: any) {
            toast.dismiss('pollemail');
            toast.error(e.message || 'Poll failed');
        }
    };

    const [testingEmail, setTestingEmail] = useState(false);
    const [testEmailResult, setTestEmailResult] = useState<{ success?: boolean; error?: string; detail?: string } | null>(null);
    const handleSendTestEmail = async () => {
        setTestingEmail(true);
        setTestEmailResult(null);
        toast.loading('Sending test email to conexer@gmail.com...', { id: 'testemail' });
        const result = await sendTestEmail('conexer@gmail.com');
        toast.dismiss('testemail');
        setTestEmailResult(result);
        if (result.success) toast.success('Test email sent — check conexer@gmail.com inbox');
        else toast.error(`Email failed: ${result.error}`);
        setTestingEmail(false);
    };

    const [stagingHighScore, setStagingHighScore] = useState(false);
    const handleStageHighScore = async () => {
        setStagingHighScore(true);
        toast.loading('Scanning score 35+ leads for rooms & staging...', { id: 'highscore' });
        try {
            const result = await scanAndStageHighScoreBacklog(20);
            toast.dismiss('highscore');
            const parts = [];
            if (result.staged > 0) parts.push(`${result.staged} staged`);
            if (result.skipped > 0) parts.push(`${result.skipped} skipped (no room found)`);
            if (result.failed > 0) parts.push(`${result.failed} failed`);
            if (result.total === 0) toast.info('No score 35+ leads without rooms found');
            else if (result.staged > 0) toast.success(`${parts.join(' · ')} - queue ready emails once Kie.ai finishes (~2 min)`);
            else toast.info(parts.join(' · ') || 'No rooms found in any of these leads');
            if (result.staged > 0) loadData();
        } catch (e: any) {
            toast.dismiss('highscore');
            toast.error(e.message || 'Scan failed');
        }
        setStagingHighScore(false);
    };

    const [drainingBacklog, setDrainingBacklog] = useState(false);
    const handleDrainBacklog = async () => {
        setDrainingBacklog(true);
        toast.loading('Queueing ready backlog emails...', { id: 'drain' });
        try {
            const result = await drainEmailBacklog(8000);
            toast.dismiss('drain');
            const parts = [];
            if (result.emailed > 0) parts.push(`${result.emailed} queued`);
            if (result.stillProcessing > 0) parts.push(`${result.stillProcessing} still generating`);
            if (result.skipped > 0) parts.push(`${result.skipped} skipped (no email)`);
            if (result.failed > 0) parts.push(`${result.failed} failed`);
            if (result.total === 0) toast.info('No staged leads in backlog');
            else if (result.emailed > 0) toast.success(parts.join(' · '));
            else toast.info(parts.join(' · ') || 'Nothing to send');
            if (result.emailed > 0 || result.failed > 0) loadData();
        } catch (e: any) {
            toast.dismiss('drain');
            toast.error(e.message || 'Backlog drain failed');
        }
        setDrainingBacklog(false);
    };

    const handleSendEmail = async (lead: any) => {
        if (!lead.agent_email) { toast.error('No email on file for this lead'); return; }
        toast.loading(`Sending to ${lead.agent_email}...`, { id: `send-${lead.id}` });
        try {
            const result = await sendOutreachEmail({
                leadId: lead.id,
                agentName: lead.agent_name || '',
                agentEmail: lead.agent_email,
                address: lead.address,
                stagedImageUrl: lead.staged_image_url || undefined,
                beforeImageUrl: lead.empty_rooms?.[0]?.imageUrl || undefined,
                source: 'manual-dashboard',
            });
            toast.dismiss(`send-${lead.id}`);
            if (result.duplicate) {
                await updateLeadStatus(lead.id, 'form_filled');
                toast.info(`Duplicate blocked: ${lead.agent_email} was already contacted`);
                await loadData();
            } else if (result.error) {
                toast.error(`Send failed: ${result.error}`);
            } else {
                toast.success(`Email sent to ${lead.agent_email}`);
                await updateLeadStatus(lead.id, 'emailed', { contacted_at: new Date().toISOString() });
                await loadData();
            }
        } catch (e: any) {
            toast.dismiss(`send-${lead.id}`);
            toast.error(e.message || 'Send failed');
        }
    };

    const handleStopSession = async () => {
        if (!activeSessionId) return;
        await requestSessionStop(activeSessionId);
        toast.info('Stop requested — pipeline will halt after current lead');
    };

    const handleResetStats = async () => {
        setResettingStats(true);
        const now = new Date().toISOString();
        localStorage.setItem('stats_reset_at', now);
        setStatsResetAt(now);
        toast.success('Stats reset — counting from now forward');
        await loadData();
        setResettingStats(false);
    };

    const handleStartScheduledSession = async () => {
        if (selectedCities.length === 0) { toast.error('Select at least one city'); return; }
        setTogglingCron(true);
        const result = await savePipelineConfig({
            sessions_per_day: sessionsPerDay,
            scrapes_per_session: scrapesPerSession,
            emails_per_day: emailsPerDay,
            cities: selectedCities,
            cron_enabled: true,
        });
        setTogglingCron(false);
        if (result.error) { toast.error(`Failed: ${result.error}`); return; }
        setCronStatus(prev => prev ? { ...prev, cron_enabled: true } : prev);
        toast.success('Schedule started — cron will run on its configured intervals');
    };

    const handleStopSchedule = async () => {
        setTogglingCron(true);
        const result = await savePipelineConfig({
            sessions_per_day: sessionsPerDay,
            scrapes_per_session: scrapesPerSession,
            emails_per_day: emailsPerDay,
            cities: selectedCities,
            cron_enabled: false,
        });
        setTogglingCron(false);
        if (result.error) { toast.error(`Failed: ${result.error}`); return; }
        setCronStatus(prev => prev ? { ...prev, cron_enabled: false } : prev);
        // Also stop any in-progress session
        if (activeSessionId) {
            await requestSessionStop(activeSessionId);
        }
        toast.success('Schedule stopped');
    };

    const handleTestMoondream = async () => {
        if (!testImageUrl) { toast.error('Enter an image URL'); return; }
        setTestLoading(true);
        setTestResult(null);
        const result = await detectRoom(testImageUrl);
        setTestResult(result);
        setTestLoading(false);
    };

    if (!authorized) {
        return <div className="min-h-screen flex items-center justify-center"><div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>;
    }

    const toggleCity = (city: string) => {
        setSelectedCities(prev => prev.includes(city) ? prev.filter(c => c !== city) : [...prev, city]);
    };

    return (
        <div className="min-h-screen bg-background text-foreground">
            {/* Header */}
            <div className="border-b border-border/40 bg-background/80 backdrop-blur sticky top-0 z-10">
                <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
                    <div>
                        <h1 className="text-2xl font-bold flex items-center gap-2">
                            <Zap className="w-6 h-6 text-primary" />
                            Outreach Pipeline
                            <span className="text-xs bg-destructive/10 text-destructive px-2 py-0.5 rounded-full font-medium">Internal Only</span>
                        </h1>
                        <p className="text-sm text-muted-foreground">Autonomous Kogflow Beta Outreach — HAR.com & homes.com → Moondream → Kie.ai → Gmail</p>
                    </div>
                    <div className="flex items-center gap-3">
                        <a
                            href="/outreach-tc"
                            className="flex items-center gap-2 px-3 py-1.5 bg-violet-500/10 text-violet-400 border border-violet-500/30 rounded-lg text-sm font-medium hover:bg-violet-500/20 transition-colors"
                        >
                            <Users className="w-4 h-4" /> TC Outreach
                        </a>
                        {dbReady === false && (
                            <button onClick={() => setActiveTab('setup')} className="flex items-center gap-2 px-3 py-1.5 bg-amber-500/10 text-amber-500 rounded-full text-sm font-medium hover:bg-amber-500/20">
                                <AlertCircle className="w-4 h-4" /> DB Setup Required
                            </button>
                        )}
                        {dbReady && cronStatus && !cronStatus.cron_enabled && (
                            <button
                                onClick={handleStartScheduledSession}
                                disabled={togglingCron}
                                className="flex items-center gap-2 px-4 py-2 rounded-lg font-medium text-sm bg-violet-500/10 text-violet-400 border border-violet-500/30 hover:bg-violet-500/20 transition-colors disabled:opacity-50"
                            >
                                {togglingCron ? (
                                    <div className="w-4 h-4 border-2 border-current/30 border-t-current rounded-full animate-spin" />
                                ) : (
                                    <Clock className="w-4 h-4" />
                                )}
                                Start Scheduled Session
                            </button>
                        )}
                        {dbReady && cronStatus && cronStatus.cron_enabled && (
                            <div className="flex items-center gap-2">
                                <div className="flex items-center gap-2 px-4 py-2 rounded-lg font-medium text-sm bg-green-500/10 text-green-400 border border-green-500/30">
                                    <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                                    Schedule Active
                                </div>
                                <button
                                    onClick={handleStopSchedule}
                                    disabled={togglingCron}
                                    className="flex items-center gap-2 px-3 py-2 rounded-lg font-medium text-sm bg-destructive/10 text-destructive hover:bg-destructive/20 border border-destructive/30 transition-colors disabled:opacity-50"
                                >
                                    {togglingCron ? <div className="w-3.5 h-3.5 border-2 border-current/30 border-t-current rounded-full animate-spin" /> : null}
                                    Stop
                                </button>
                            </div>
                        )}
                        {dbReady && !runningSession && (
                            <button
                                onClick={handleRunSession}
                                className="flex items-center gap-2 px-4 py-2 rounded-lg font-medium text-sm bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                            >
                                <Play className="w-4 h-4" /> Run Session
                            </button>
                        )}
                        {dbReady && runningSession && (
                            <div className="flex items-center gap-2">
                                <div className="flex items-center gap-2 px-4 py-2 rounded-lg font-medium text-sm bg-muted text-muted-foreground">
                                    <div className="w-4 h-4 border-2 border-current/30 border-t-green-400 rounded-full animate-spin" />
                                    Running...
                                </div>
                                <button
                                    onClick={handleStopSession}
                                    className="flex items-center gap-2 px-4 py-2 rounded-lg font-medium text-sm bg-destructive/10 text-destructive hover:bg-destructive/20 border border-destructive/30 transition-colors"
                                >
                                    Stop
                                </button>
                            </div>
                        )}

                        <button onClick={loadData} className="p-2 hover:bg-muted rounded-lg transition-colors">
                            <RefreshCw className={cn("w-4 h-4", loadingData && "animate-spin")} />
                        </button>
                    </div>
                </div>

                {/* Tabs */}
                <div className="max-w-7xl mx-auto px-6 flex gap-1">
                    {(['dashboard', 'leads', 'config', 'email', 'replies', 'setup'] as const).map(tab => (
                        <button key={tab} onClick={() => {
                            setActiveTab(tab);
                            if (tab === 'replies') {
                                setRepliesLoading(true);
                                getOutreachReplies({ unreviewedOnly: repliesFilter === 'unreviewed' })
                                    .then(r => setReplies(r.replies))
                                    .finally(() => setRepliesLoading(false));
                            }
                        }}
                            className={cn("px-4 py-2.5 text-sm font-medium capitalize border-b-2 transition-colors",
                                activeTab === tab ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
                            )}>
                            {tab === 'setup' ? '⚙ Setup' : tab}
                        </button>
                    ))}
                </div>
            </div>

            <div className="max-w-7xl mx-auto px-6 py-8 space-y-8">

                {/* ── DASHBOARD TAB ── */}
                {activeTab === 'dashboard' && (
                    <div className="space-y-8">
                        <div className="flex items-center justify-between">
                            <h2 className="font-semibold text-sm text-muted-foreground">
                                {statsResetAt ? `Stats since ${new Date(statsResetAt).toLocaleDateString()}` : 'All-time stats'}
                            </h2>
                            <button
                                onClick={handleResetStats}
                                disabled={resettingStats}
                                className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground border border-border rounded-lg hover:bg-muted transition-colors disabled:opacity-50"
                            >
                                <RefreshCw className={cn("w-3 h-3", resettingStats && "animate-spin")} />
                                Reset Stats
                            </button>
                        </div>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                            {[
                                { label: 'Total Leads', value: stats.total, icon: Database, color: 'text-blue-400' },
                                { label: 'Staged', value: stats.stagedEver, icon: Image, color: 'text-violet-400' },
                                { label: 'Emailed', value: stats.emailed, icon: Mail, color: 'text-green-400' },
                                { label: 'Avg ICP Score', value: stats.avgScore, icon: Star, color: 'text-amber-400' },
                            ].map(stat => (
                                <div key={stat.label} className="bg-card border border-border rounded-xl p-5 space-y-2">
                                    <div className="flex items-center justify-between">
                                        <span className="text-sm text-muted-foreground">{stat.label}</span>
                                        <stat.icon className={cn("w-4 h-4", stat.color)} />
                                    </div>
                                    <div className="text-3xl font-bold">{stat.value}</div>
                                </div>
                            ))}
                        </div>

                        {/* Photo / Scrape Stats */}
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <div className="bg-card border border-border rounded-xl p-5 space-y-2">
                                <div className="flex items-center justify-between">
                                    <span className="text-sm text-muted-foreground">Total Photos Scraped</span>
                                    <Image className="w-4 h-4 text-blue-400" />
                                </div>
                                <div className="text-3xl font-bold">{(stats.totalPhotos ?? 0).toLocaleString()}</div>
                                <div className="text-xs text-muted-foreground">across {stats.total} listings</div>
                            </div>
                            <div className="bg-card border border-border rounded-xl p-5 space-y-2">
                                <div className="flex items-center justify-between">
                                    <span className="text-sm text-muted-foreground">Listings with Photos</span>
                                    <CheckCircle className="w-4 h-4 text-green-400" />
                                </div>
                                <div className="text-3xl font-bold">{stats.leadsWithPhotos ?? 0}</div>
                                <div className="text-xs text-muted-foreground">
                                    {stats.total > 0 ? Math.round(((stats.leadsWithPhotos ?? 0) / stats.total) * 100) : 0}% success rate
                                </div>
                            </div>
                            <div className="bg-card border border-border rounded-xl p-5 space-y-2">
                                <div className="flex items-center justify-between">
                                    <span className="text-sm text-muted-foreground">Staged Queue</span>
                                    <Zap className="w-4 h-4 text-violet-400" />
                                </div>
                                <div className="text-3xl font-bold">{stats.emptyRoomsFound ?? 0}</div>
                                <div className="text-xs text-muted-foreground mb-1">detected rooms waiting to be submitted to staging</div>
                                <div className="flex gap-2 flex-wrap">
                                    <button
                                        onClick={handleScanEmptyRooms}
                                        className="flex-1 text-xs px-2 py-1 rounded bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 transition-colors"
                                    >
                                        Scan &amp; Prep
                                    </button>
                                    <button
                                        onClick={handleSubmitBatch}
                                        className="flex-1 text-xs px-2 py-1 rounded bg-violet-500/20 text-violet-400 hover:bg-violet-500/30 transition-colors"
                                    >
                                        Stage Batch
                                    </button>
                                    <button
                                        onClick={handlePollAndEmail}
                                        className="flex-1 text-xs px-2 py-1 rounded bg-green-500/20 text-green-400 hover:bg-green-500/30 transition-colors"
                                    >
                                        Poll &amp; Queue
                                    </button>
                                    <button
                                        onClick={handleStageHighScore}
                                        disabled={stagingHighScore}
                                        className="w-full text-xs px-2 py-1.5 rounded bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
                                    >
                                        {stagingHighScore ? <><div className="w-3 h-3 border border-current/30 border-t-current rounded-full animate-spin" /> Scanning...</> : <><Zap className="w-3 h-3" /> Stage Score 35+ Backlog</>}
                                    </button>
                                    <button
                                        onClick={handleDrainBacklog}
                                        disabled={drainingBacklog}
                                        className="w-full text-xs px-2 py-1.5 rounded bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
                                    >
                                        {drainingBacklog ? <><div className="w-3 h-3 border border-current/30 border-t-current rounded-full animate-spin" /> Queueing...</> : <><Mail className="w-3 h-3" /> Queue Backlog Emails</>}
                                    </button>
                                </div>
                            </div>
                        </div>

                        {/* Pipeline Flow */}
                        <div className="bg-card border border-border rounded-xl p-6 space-y-4">
                            <div className="flex items-center justify-between">
                                <h2 className="font-bold text-lg flex items-center gap-2"><BarChart2 className="w-5 h-5 text-primary" /> Pipeline Stages</h2>
                                {stats.scraped > 0 && stats.scored === 0 && (
                                    <button
                                        onClick={async () => {
                                            toast.loading('Backfilling scored status...', { id: 'backfill' });
                                            const r = await backfillScoredStatus();
                                            toast.dismiss('backfill');
                                            if (r.error) toast.error(r.error);
                                            else { toast.success(`${r.updated} leads promoted to Scored`); loadData(); }
                                        }}
                                        className="text-xs px-3 py-1.5 rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/30 hover:bg-amber-500/20 transition-colors"
                                    >
                                        Fix Stats (backfill scored)
                                    </button>
                                )}
                            </div>
                            <div className="flex items-center gap-2 flex-wrap">
                                {(['scraped', 'scored', 'staged', 'queued', 'form_filled', 'emailed'] as const).map((stage, i, arr) => (
                                    <div key={stage} className="flex items-center gap-2">
                                        <div className={cn("px-4 py-2 rounded-lg text-sm font-medium", STATUS_COLORS[stage])}>
                                            <span className="font-bold">{stats[stage] ?? 0}</span> {STATUS_LABELS[stage]}
                                        </div>
                                        {i < arr.length - 1 && <ChevronRight className="w-4 h-4 text-muted-foreground" />}
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* ICP Scoring */}
                        <div className="bg-card border border-border rounded-xl p-6 space-y-4">
                            <h2 className="font-bold text-lg flex items-center gap-2"><Star className="w-5 h-5 text-amber-400" /> ICP Scoring System</h2>
                            <p className="text-sm text-muted-foreground">Leads scoring <span className="text-violet-400 font-semibold">15+</span> are automatically staged and emailed — empty rooms get virtual furniture added, furnished rooms get a professional redesign.</p>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                {[
                                    { factor: 'Vacant / Unfurnished', points: '+40', reason: 'High visual need — adds furniture to empty rooms' },
                                    { factor: 'Price Reduced', points: '+25', reason: 'Signals marketing failure' },
                                    { factor: 'Days on Market 60+', points: '+20', reason: 'High owner pressure' },
                                    { factor: 'Low Photo Count (<15)', points: '+10', reason: 'Tech-lagging indicator' },
                                    { factor: 'Days on Market 30–59', points: '+5', reason: 'Moderate frustration' },
                                ].map(row => (
                                    <div key={row.factor} className="flex items-start gap-3 p-3 bg-muted/30 rounded-lg">
                                        <span className="font-bold text-green-400 text-sm w-10 shrink-0">{row.points}</span>
                                        <div>
                                            <div className="text-sm font-medium">{row.factor}</div>
                                            <div className="text-xs text-muted-foreground">{row.reason}</div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Schedule Status */}
                        {cronStatus && (
                            <div className="bg-card border border-border rounded-xl p-6 space-y-4">
                                <h2 className="font-bold text-lg flex items-center gap-2">
                                    <Clock className="w-5 h-5 text-primary" />
                                    Schedule & Throttling
                                    <span className={cn("text-xs px-2 py-0.5 rounded-full font-medium", cronStatus.cron_enabled ? 'bg-green-500/10 text-green-400' : 'bg-slate-500/10 text-slate-400')}>
                                        {cronStatus.cron_enabled ? 'Running' : 'Stopped'}
                                    </span>
                                </h2>
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                                    <div className="bg-muted/30 rounded-lg p-3 space-y-1">
                                        <div className="text-xs text-muted-foreground">Schedule</div>
                                        <div className="font-medium text-xs">{cronStatus.schedule}</div>
                                    </div>
                                    <div className="bg-muted/30 rounded-lg p-3 space-y-1">
                                        <div className="text-xs text-muted-foreground">Today's Cron Runs</div>
                                        <div className="font-bold">{cronStatus.today_cron_runs} <span className="text-muted-foreground font-normal text-xs">/ {cronStatus.sessions_per_day} limit</span></div>
                                    </div>
                                    <div className="bg-muted/30 rounded-lg p-3 space-y-1">
                                        <div className="text-xs text-muted-foreground">Last Cron Run</div>
                                        <div className="font-medium text-xs">{cronStatus.last_cron_run ? new Date(cronStatus.last_cron_run).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Never'}</div>
                                    </div>
                                    <div className="bg-muted/30 rounded-lg p-3 space-y-1">
                                        <div className="text-xs text-muted-foreground">Next Scheduled</div>
                                        <div className="font-medium text-xs">{new Date(cronStatus.next_scheduled_utc).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                                    </div>
                                </div>
                                {cronStatus.today_cron_runs < cronStatus.expected_so_far && (
                                    <div className="flex items-center gap-2 text-xs text-amber-400 bg-amber-500/5 border border-amber-500/20 rounded-lg px-3 py-2">
                                        <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                                        Expected {cronStatus.expected_so_far} cron run{cronStatus.expected_so_far !== 1 ? 's' : ''} by now, got {cronStatus.today_cron_runs}. Manual sessions don't count toward this limit.
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Activity Log — always visible, shows all pipeline activity */}
                        <div className="bg-card border border-border rounded-xl p-6 space-y-3">
                            <div className="flex items-center justify-between">
                                <h2 className="font-bold text-lg flex items-center gap-2">
                                    <Terminal className="w-5 h-5 text-primary" />
                                    Activity Log
                                    {runningSession && <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />}
                                </h2>
                                <span className="text-xs text-muted-foreground">
                                    {runningSession ? 'Live' : activityLog.length > 0 ? `${activityLog.length} entries` : 'No activity yet'}
                                </span>
                            </div>
                            <div ref={activityLogRef} className="bg-black/60 rounded-lg p-4 font-mono text-xs space-y-0.5 h-80 overflow-y-auto">
                                {activityLog.length === 0 && !runningSession && (
                                    <div className="text-muted-foreground/50 text-center py-8">
                                        No pipeline activity yet. Run a session or wait for the scheduled cron.
                                    </div>
                                )}
                                {activityLog.length === 0 && runningSession && (
                                    <div className="text-muted-foreground animate-pulse">Starting pipeline session...</div>
                                )}
                                {activityLog.map((entry, i) => {
                                    const time = new Date(entry.logged_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
                                    const msg = entry.message;
                                    const color = msg.includes('✓') ? 'text-green-400' :
                                        msg.includes('→ Empty room') ? 'text-violet-400 font-bold' :
                                        msg.includes('error') || msg.includes('Error') ? 'text-red-400' :
                                        msg.includes('already in DB') ? 'text-yellow-600' :
                                        msg.includes('Session') || msg.includes('Total') || msg.includes('Target') || msg.includes('Complete') ? 'text-blue-400' :
                                        msg.includes('Staged') || msg.includes('Email') ? 'text-violet-300' :
                                        'text-muted-foreground';
                                    return (
                                        <div key={i} className={`flex gap-2 ${color}`}>
                                            <span className="text-muted-foreground/40 shrink-0 tabular-nums">{time}</span>
                                            <span>{msg}</span>
                                        </div>
                                    );
                                })}
                                {runningSession && <div className="text-green-400 animate-pulse">▌</div>}
                            </div>
                        </div>

                        {/* Site Reliability Stats */}
                        {siteStats.length > 0 && (
                            <div className="bg-card border border-border rounded-xl p-6 space-y-4">
                                <h2 className="font-bold text-lg flex items-center gap-2"><BarChart2 className="w-5 h-5 text-primary" /> Site Reliability Tracker</h2>
                                <p className="text-sm text-muted-foreground">Aggregated across all pipeline runs — sorted by success rate.</p>
                                <div className="overflow-x-auto rounded-lg border border-border">
                                    <table className="w-full text-sm">
                                        <thead>
                                            <tr className="border-b border-border bg-muted/40 text-xs text-muted-foreground uppercase tracking-wide">
                                                <th className="text-left px-3 py-2 font-medium">Site</th>
                                                <th className="text-center px-3 py-2 font-medium">Runs</th>
                                                <th className="text-center px-3 py-2 font-medium">Success Rate</th>
                                                <th className="text-center px-3 py-2 font-medium">Avg Addresses</th>
                                                <th className="text-center px-3 py-2 font-medium">Avg Listings</th>
                                                <th className="text-left px-3 py-2 font-medium">Last Run</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-border">
                                            {siteStats.map((s) => (
                                                <tr key={s.site} className="hover:bg-muted/20 transition-colors">
                                                    <td className="px-3 py-2 font-medium text-sm">{s.site}</td>
                                                    <td className="px-3 py-2 text-center text-muted-foreground">{s.runs}</td>
                                                    <td className="px-3 py-2 text-center">
                                                        <span className={cn("font-bold", s.successRate >= 70 ? 'text-green-400' : s.successRate >= 40 ? 'text-amber-400' : 'text-destructive')}>
                                                            {s.successRate}%
                                                        </span>
                                                    </td>
                                                    <td className="px-3 py-2 text-center text-muted-foreground">{s.avgAddresses}</td>
                                                    <td className="px-3 py-2 text-center text-muted-foreground">{s.avgListings}</td>
                                                    <td className="px-3 py-2 text-xs text-muted-foreground">{new Date(s.lastRun).toLocaleDateString()}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        )}

                        {/* Site Tester */}
                        <div className="bg-card border border-border rounded-xl p-6 space-y-4">
                            <div className="flex items-center justify-between">
                                <h2 className="font-bold text-lg flex items-center gap-2"><Zap className="w-5 h-5 text-primary" /> Site Scrape Tester</h2>
                                <button
                                    onClick={handleTestSites}
                                    disabled={testingsSites}
                                    className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
                                >
                                    {testingsSites ? <><div className="w-3.5 h-3.5 border-2 border-current/30 border-t-current rounded-full animate-spin" /> Testing...</> : <><Play className="w-3.5 h-3.5" /> Test All 8 Sites</>}
                                </button>
                            </div>
                            <p className="text-sm text-muted-foreground">Tests all 8 sites (homes.com, HomePath, HAR.com, HomeFinder, Estately, RE/MAX, Century21, Coldwell Banker) via Zyte. Compare address counts to find the most scrapable.</p>

                            {siteResults.length > 0 && (
                                <div className="space-y-3">
                                    {siteResults.map((r) => (
                                        <div key={r.site} className={cn("rounded-xl border p-4 space-y-3", r.status === 'ok' ? 'border-green-500/30 bg-green-500/5' : r.status === 'blocked' ? 'border-red-500/30 bg-red-500/5' : 'border-border bg-muted/20')}>
                                            <div className="flex items-center justify-between">
                                                <div className="flex items-center gap-2">
                                                    <span className={cn("w-2 h-2 rounded-full", r.status === 'ok' ? 'bg-green-500' : r.status === 'blocked' ? 'bg-red-500' : 'bg-amber-500')} />
                                                    <span className="font-semibold text-sm">{r.site}</span>
                                                    <span className={cn("text-xs px-2 py-0.5 rounded-full font-medium", r.status === 'ok' ? 'bg-green-500/20 text-green-400' : r.status === 'blocked' ? 'bg-red-500/20 text-red-400' : 'bg-amber-500/20 text-amber-400')}>
                                                        {r.status === 'ok' ? '✓ Full HTML' : r.status === 'blocked' ? '✗ Blocked/Empty' : '✗ Error'}
                                                    </span>
                                                </div>
                                                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                                                    <span>{(r.htmlLength / 1024).toFixed(0)}KB</span>
                                                    {r.nextDataFound && <span className="text-blue-400">__NEXT_DATA__ ✓</span>}
                                                    {r.jsonLdFound && <span className="text-violet-400">JSON-LD ✓</span>}
                                                    <span>{r.addressesFound} addresses</span>
                                                    <span>{r.photosFound} photos</span>
                                                </div>
                                            </div>
                                            {r.sampleAddresses.length > 0 && (
                                                <div className="text-xs text-green-400 font-mono space-y-0.5">
                                                    {r.sampleAddresses.map((a, i) => <div key={i}>• {a}</div>)}
                                                </div>
                                            )}
                                            {r.error && <div className="text-xs text-destructive font-mono">{r.error}</div>}
                                            <details className="text-xs">
                                                <summary className="text-muted-foreground cursor-pointer hover:text-foreground">View HTML snippet</summary>
                                                <pre className="mt-2 bg-muted/50 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap text-muted-foreground max-h-48 overflow-y-auto">{r.snippet}</pre>
                                            </details>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Moondream Test Tool */}
                        <div className="bg-card border border-border rounded-xl p-6 space-y-4">
                            <h2 className="font-bold text-lg flex items-center gap-2"><Search className="w-5 h-5 text-primary" /> Test Moondream Vision</h2>
                            <p className="text-sm text-muted-foreground">Paste any real estate photo URL to test room detection</p>
                            <div className="flex gap-2">
                                <input
                                    type="url"
                                    value={testImageUrl}
                                    onChange={e => setTestImageUrl(e.target.value)}
                                    placeholder="https://photos.harstatic.com/..."
                                    className="flex-1 px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                                />
                                <button onClick={handleTestMoondream} disabled={testLoading}
                                    className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50">
                                    {testLoading ? 'Testing...' : 'Test'}
                                </button>
                            </div>
                            {testResult && (
                                <div className={cn("p-4 rounded-lg text-sm space-y-1 font-mono", testResult.isEmpty ? "bg-green-500/10 border border-green-500/20" : "bg-muted border border-border")}>
                                    <div><span className="text-muted-foreground">Empty room:</span> <span className="font-bold">{testResult.isEmpty ? '✅ Yes' : '❌ No'}</span></div>
                                    <div><span className="text-muted-foreground">Confidence:</span> <span className="font-bold">{testResult.confidence}%</span></div>
                                    <div><span className="text-muted-foreground">Room type:</span> <span className="font-bold capitalize">{testResult.roomType}</span></div>
                                    {testResult.error && <div className="text-destructive">{testResult.error}</div>}
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* ── LEADS TAB ── */}
                {activeTab === 'leads' && (
                    <div className="space-y-4">
                        <div className="flex items-center justify-between">
                            <h2 className="font-bold text-lg">Lead Queue <span className="text-muted-foreground font-normal text-sm">({leads.length} shown, ordered by ICP score)</span></h2>
                            <button onClick={loadData} disabled={loadingData} className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground border border-border rounded-lg hover:bg-muted transition-colors disabled:opacity-50">
                                <RefreshCw className={`w-3.5 h-3.5 ${loadingData ? 'animate-spin' : ''}`} />
                                Refresh
                            </button>
                        </div>
                        {leads.length === 0 ? (
                            <div className="bg-card border border-dashed border-border rounded-xl p-16 text-center space-y-3">
                                <Search className="w-10 h-10 text-muted-foreground/50 mx-auto" />
                                <h3 className="font-medium text-muted-foreground">No leads yet</h3>
                                <p className="text-sm text-muted-foreground">Go to Dashboard → click "Run Session" to start scraping listings</p>
                            </div>
                        ) : (
                            <div className="overflow-x-auto rounded-xl border border-border">
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="border-b border-border bg-muted/40 text-xs text-muted-foreground uppercase tracking-wide">
                                            <th className="text-left px-3 py-2.5 font-medium">Score</th>
                                            <th className="text-left px-3 py-2.5 font-medium">Status</th>
                                            <th className="text-left px-3 py-2.5 font-medium">Empty Rooms</th>
                                            <th className="text-left px-3 py-2.5 font-medium">Agent Email</th>
                                            <th className="text-left px-3 py-2.5 font-medium">Agent Name</th>
                                            <th className="text-left px-3 py-2.5 font-medium">Agent Phone</th>
                                            <th className="text-left px-3 py-2.5 font-medium">Address</th>
                                            <th className="text-left px-3 py-2.5 font-medium">City</th>
                                            <th className="text-right px-3 py-2.5 font-medium">Price</th>
                                            <th className="text-center px-3 py-2.5 font-medium">DOM</th>
                                            <th className="text-center px-3 py-2.5 font-medium">↓Price</th>
                                            <th className="text-center px-3 py-2.5 font-medium">Photos</th>
                                            <th className="text-left px-3 py-2.5 font-medium">Scraped</th>
                                            <th className="text-center px-3 py-2.5 font-medium">Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-border">
                                        {leads.map((lead) => (
                                            <tr key={lead.id} className="hover:bg-muted/20 transition-colors">
                                                {/* ICP Score */}
                                                <td className="px-3 py-2.5 shrink-0">
                                                    <span className={cn("font-bold text-base tabular-nums", lead.icp_score >= 40 ? 'text-green-400' : lead.icp_score >= 20 ? 'text-amber-400' : 'text-muted-foreground')}>
                                                        {lead.icp_score}
                                                    </span>
                                                </td>
                                                {/* Status */}
                                                <td className="px-3 py-2.5">
                                                    <span className={cn("px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap", STATUS_COLORS[lead.status] || STATUS_COLORS.scraped)}>
                                                        {STATUS_LABELS[lead.status] || lead.status}
                                                    </span>
                                                </td>
                                                {/* Empty Rooms */}
                                                <td className="px-3 py-2.5">
                                                    {lead.empty_rooms?.length > 0 ? (
                                                        <div className="flex flex-col gap-0.5">
                                                            {lead.empty_rooms.map((r: any, i: number) => (
                                                                <span key={i} className="flex items-center gap-1 text-violet-400 text-xs whitespace-nowrap">
                                                                    <Image className="w-3 h-3 shrink-0" />
                                                                    {r.roomType}
                                                                </span>
                                                            ))}
                                                        </div>
                                                    ) : (
                                                        <span className="text-muted-foreground/40 text-xs">—</span>
                                                    )}
                                                </td>
                                                {/* Agent Email */}
                                                <td className="px-3 py-2.5">
                                                    {lead.agent_email ? (
                                                        <a href={`mailto:${lead.agent_email}`} className="text-primary hover:underline text-xs font-mono truncate block max-w-[180px]" title={lead.agent_email}>
                                                            {lead.agent_email}
                                                        </a>
                                                    ) : <span className="text-muted-foreground/40 text-xs">—</span>}
                                                </td>
                                                {/* Agent Name */}
                                                <td className="px-3 py-2.5">
                                                    <span className="text-xs whitespace-nowrap">{lead.agent_name || <span className="text-muted-foreground/40">—</span>}</span>
                                                </td>
                                                {/* Agent Phone */}
                                                <td className="px-3 py-2.5">
                                                    {lead.agent_phone ? (
                                                        <a href={`tel:${lead.agent_phone}`} className="text-xs text-muted-foreground hover:text-foreground whitespace-nowrap font-mono">
                                                            {lead.agent_phone}
                                                        </a>
                                                    ) : <span className="text-muted-foreground/40 text-xs">—</span>}
                                                </td>
                                                {/* Address */}
                                                <td className="px-3 py-2.5 max-w-[200px]">
                                                    <span className="text-xs truncate block" title={lead.address}>{lead.address}</span>
                                                </td>
                                                {/* City */}
                                                <td className="px-3 py-2.5">
                                                    <span className="text-xs text-muted-foreground whitespace-nowrap">{lead.city}</span>
                                                </td>
                                                {/* Price */}
                                                <td className="px-3 py-2.5 text-right">
                                                    <span className="text-xs font-medium tabular-nums whitespace-nowrap">${lead.price?.toLocaleString()}</span>
                                                </td>
                                                {/* DOM */}
                                                <td className="px-3 py-2.5 text-center">
                                                    <span className={cn("text-xs tabular-nums", lead.days_on_market >= 60 ? 'text-red-400 font-semibold' : lead.days_on_market >= 30 ? 'text-amber-400' : 'text-muted-foreground')}>
                                                        {lead.days_on_market}d
                                                    </span>
                                                </td>
                                                {/* Price Reduced */}
                                                <td className="px-3 py-2.5 text-center">
                                                    {lead.price_reduced
                                                        ? <TrendingDown className="w-3.5 h-3.5 text-red-400 mx-auto" />
                                                        : <span className="text-muted-foreground/40 text-xs">—</span>}
                                                </td>
                                                {/* Photo Count */}
                                                <td className="px-3 py-2.5 text-center">
                                                    <span className="text-xs text-muted-foreground tabular-nums">{lead.photo_count}</span>
                                                </td>
                                                {/* Scraped At */}
                                                <td className="px-3 py-2.5">
                                                    <span className="text-xs text-muted-foreground tabular-nums whitespace-nowrap">
                                                        {lead.created_at ? (() => {
                                                            const d = new Date(lead.created_at);
                                                            const date = d.toLocaleDateString('en-CA'); // YYYY-MM-DD
                                                            const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
                                                            return `${date} / ${time}`;
                                                        })() : '—'}
                                                    </span>
                                                </td>
                                                {/* Actions */}
                                                <td className="px-3 py-2.5">
                                                    <div className="flex items-center gap-1 justify-center">
                                                        {lead.agent_email && lead.status !== 'emailed' && (
                                                            <button
                                                                onClick={() => handleSendEmail(lead)}
                                                                className="p-1.5 hover:bg-green-500/10 text-muted-foreground hover:text-green-400 rounded transition-colors"
                                                                title={`Send to ${lead.agent_email}`}
                                                            >
                                                                <Send className="w-3.5 h-3.5" />
                                                            </button>
                                                        )}
                                                        <a href={lead.listing_url} target="_blank" rel="noopener noreferrer" className="p-1.5 hover:bg-muted rounded transition-colors" title="View listing">
                                                            <ExternalLink className="w-3.5 h-3.5 text-muted-foreground" />
                                                        </a>
                                                    </div>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                )}

                {/* ── CONFIG TAB ── */}
                {activeTab === 'config' && (
                    <div className="space-y-6 max-w-2xl">
                        <div className="flex items-center justify-between">
                            <h2 className="font-bold text-lg flex items-center gap-2"><Settings className="w-5 h-5" /> Pipeline Configuration</h2>
                            <button
                                onClick={handleSaveConfig}
                                disabled={savingConfig}
                                className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
                            >
                                {savingConfig ? <><div className="w-3.5 h-3.5 border-2 border-current/30 border-t-current rounded-full animate-spin" /> Saving...</> : <><CheckCircle className="w-3.5 h-3.5" /> Save Config</>}
                            </button>
                        </div>

                        <div className="bg-card border border-border rounded-xl p-6 space-y-5">
                            <div className="flex items-start justify-between">
                                <h3 className="font-semibold flex items-center gap-2"><Clock className="w-4 h-4 text-primary" /> Schedule & Throttling</h3>
                                <div className="text-xs text-muted-foreground bg-muted/50 px-2 py-1 rounded-lg">
                                    Cron fires daily at 9 AM · runs all sessions in sequence
                                </div>
                            </div>
                            <div className="space-y-4">
                                <div className="space-y-2">
                                    <label className="text-sm font-medium flex items-center justify-between">
                                        Sessions per day
                                        <span className="text-primary font-bold">{sessionsPerDay} <span className="text-muted-foreground font-normal text-xs">≈ every {Math.round(24 / sessionsPerDay)}h</span></span>
                                    </label>
                                    <input type="range" min={1} max={20} value={sessionsPerDay} onChange={e => setSessionsPerDay(Number(e.target.value))} className="w-full accent-primary" />
                                    <div className="flex justify-between text-xs text-muted-foreground"><span>1/day</span><span>20/day (max)</span></div>
                                </div>
                                <div className="space-y-2">
                                    <label className="text-sm font-medium flex items-center justify-between">
                                        Scrapes per session
                                        <span className="text-primary font-bold">{scrapesPerSession} listings</span>
                                    </label>
                                    <input type="range" min={5} max={100} step={5} value={scrapesPerSession} onChange={e => setScrapesPerSession(Number(e.target.value))} className="w-full accent-primary" />
                                    <p className="text-xs text-muted-foreground">Zyte handles proxy/anti-bot — spacing between scrapes doesn't affect ban risk. This controls cost per session.</p>
                                </div>
                                <div className="space-y-2">
                                    <label className="text-sm font-medium flex items-center justify-between">
                                        Emails per day
                                        <span className="text-primary font-bold">
                                            {emailsPerDay} <span className="text-muted-foreground font-normal text-xs">≈ {Math.max(1, Math.round(emailsPerDay / sessionsPerDay))} per cron run</span>
                                        </span>
                                    </label>
                                    <input type="range" min={5} max={300} step={5} value={emailsPerDay} onChange={e => setEmailsPerDay(Number(e.target.value))} className="w-full accent-primary" />
                                    <div className="flex justify-between text-xs text-muted-foreground"><span>5/day</span><span>300/day (max)</span></div>
                                    <p className="text-xs text-muted-foreground">Spread evenly across daily cron slots. Keep low while warming Gmail sender reputation.</p>
                                </div>
                            </div>
                        </div>

                        <div className="bg-card border border-border rounded-xl p-6 space-y-4">
                            <h3 className="font-semibold flex items-center gap-2"><MapPin className="w-4 h-4 text-primary" /> Market Pool ({selectedCities.length} selected)</h3>
                            {CITIES.map(region => (
                                <div key={region.region} className="space-y-2">
                                    <div className="text-xs font-bold text-muted-foreground uppercase tracking-wider">{region.region}</div>
                                    <div className="flex flex-wrap gap-2">
                                        {region.cities.map(city => (
                                            <button key={city} onClick={() => toggleCity(city)}
                                                className={cn("px-3 py-1.5 rounded-full text-sm font-medium border transition-colors",
                                                    selectedCities.includes(city)
                                                        ? "bg-primary/10 border-primary text-primary"
                                                        : "bg-background border-border text-muted-foreground hover:border-primary/50"
                                                )}>
                                                {city}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>

                        <div className="bg-card border border-border rounded-xl p-6 space-y-4">
                            <h3 className="font-semibold">ICP Filters (Active)</h3>
                            <div className="grid grid-cols-2 gap-3 text-sm">
                                <div className="p-3 bg-muted/30 rounded-lg"><span className="text-muted-foreground">Price range:</span> <span className="font-medium">$150k – $700k</span></div>
                                <div className="p-3 bg-muted/30 rounded-lg"><span className="text-muted-foreground">Min DOM:</span> <span className="font-medium">30 days</span></div>
                                <div className="p-3 bg-muted/30 rounded-lg"><span className="text-muted-foreground">Min empty rooms:</span> <span className="font-medium">scored regardless</span></div>
                                <div className="p-3 bg-muted/30 rounded-lg"><span className="text-muted-foreground">Sort:</span> <span className="font-medium">Oldest first</span></div>
                            </div>
                            <div className="flex flex-wrap gap-2">
                                {['Vacant', 'Unfurnished', 'Immediate Occupancy', 'Single Family', 'Condo'].map(tag => (
                                    <span key={tag} className="px-2 py-1 bg-primary/10 text-primary border border-primary/20 rounded-full text-xs font-medium">{tag}</span>
                                ))}
                            </div>
                        </div>

                        {/* Recent Cron Runs */}
                        <div className="bg-card border border-border rounded-xl p-6 space-y-4">
                            <h3 className="font-semibold flex items-center gap-2"><BarChart2 className="w-4 h-4 text-primary" /> Recent Cron Runs</h3>
                            {recentRuns.length === 0 ? (
                                <p className="text-sm text-muted-foreground">No runs yet. Save config and wait for the cron, or click "Run Session" manually.</p>
                            ) : (
                                <div className="space-y-2">
                                    {recentRuns.map((run, i) => (
                                        <div key={i} className="flex items-center justify-between p-3 bg-muted/30 rounded-lg text-sm">
                                            <span className="text-muted-foreground font-mono text-xs">{new Date(run.ran_at).toLocaleString()}</span>
                                            <div className="flex items-center gap-3">
                                                <span className="text-green-400 font-medium">{run.processed} processed</span>
                                                {run.errors?.length > 0 && <span className="text-destructive text-xs">{run.errors.length} errors</span>}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* ── EMAIL TAB ── */}
                {activeTab === 'email' && (
                    <div className="space-y-6 max-w-2xl">
                        <h2 className="font-bold text-lg flex items-center gap-2"><Send className="w-5 h-5" /> Email Outreach</h2>
                        <div className="bg-card border border-border rounded-xl p-6 space-y-4">
                            <div className="flex items-center justify-between">
                                <h3 className="font-semibold">Sender — kogflow.media@gmail.com</h3>
                                <button
                                    onClick={handleSendTestEmail}
                                    disabled={testingEmail}
                                    className="flex items-center gap-2 px-3 py-1.5 text-xs bg-primary/10 text-primary hover:bg-primary/20 rounded-lg font-medium transition-colors disabled:opacity-50"
                                >
                                    {testingEmail ? <><div className="w-3 h-3 border border-current/30 border-t-current rounded-full animate-spin" /> Sending...</> : <><Send className="w-3 h-3" /> Send Test Email</>}
                                </button>
                            </div>
                            {testEmailResult ? (
                                <div className={cn('p-3 rounded-lg text-sm font-mono space-y-1', testEmailResult.success ? 'bg-green-500/10 border border-green-500/20 text-green-400' : 'bg-destructive/10 border border-destructive/20 text-destructive')}>
                                    {testEmailResult.success ? (
                                        <div className="flex items-center gap-2"><CheckCircle className="w-4 h-4 shrink-0" /> Sent to conexer@gmail.com — check your inbox now</div>
                                    ) : (
                                        <>
                                            <div className="flex items-center gap-2"><AlertCircle className="w-4 h-4 shrink-0" /> {testEmailResult.error}</div>
                                            {testEmailResult.detail && <div className="text-xs opacity-70 break-all">{testEmailResult.detail}</div>}
                                        </>
                                    )}
                                </div>
                            ) : (
                                <div className="p-3 bg-muted/30 border border-border rounded-lg text-sm text-muted-foreground flex items-start gap-2">
                                    <AlertCircle className="w-4 h-4 mt-0.5 shrink-0 text-amber-400" />
                                    Click "Send Test Email" to confirm Gmail OAuth is working before relying on the pipeline.
                                </div>
                            )}
                        </div>
                        <div className="bg-card border border-border rounded-xl p-6 space-y-4">
                            <h3 className="font-semibold">Outreach Template</h3>
                            <div className="text-xs text-muted-foreground p-4 bg-muted/20 rounded-lg font-mono space-y-2 leading-relaxed">
                                <p>Hi <span className="text-amber-400">[Realtor Name]</span>,</p>
                                <br />
                                <p>I saw your listing at <span className="text-amber-400">[Exact Property Address]</span>. I noticed it's been active for <span className="text-amber-400">[X] days</span>—it's a great space, but the empty <span className="text-amber-400">[Room Type]</span> might be making it hard for buyers to commit after the recent price adjustment.</p>
                                <br />
                                <p>I made a free preview for you to help "refresh" the listing without another price drop:</p>
                                <p>Before: <span className="text-blue-400">[before link]</span> | Staged with Kogflow: <span className="text-blue-400">[staged link]</span></p>
                                <br />
                                <p>Would this help move <span className="text-amber-400">[Exact Property Address]</span> faster?</p>
                                <br />
                                <p>Best, Minh</p>
                            </div>
                        </div>
                        <div className="bg-card border border-border rounded-xl p-6 space-y-3">
                            <h3 className="font-semibold flex items-center justify-between">Email Queue
                                <span className="text-sm text-muted-foreground">{leads.filter(l => l.status === 'staged').length} ready to send</span>
                            </h3>
                            {leads.filter(l => l.status === 'staged').length === 0
                                ? <p className="text-sm text-muted-foreground text-center py-6">No staged leads ready. Run the pipeline first.</p>
                                : leads.filter(l => l.status === 'staged').map(lead => (
                                    <div key={lead.id} className="flex items-center gap-3 p-3 bg-muted/30 rounded-lg">
                                        <div className="flex-1 min-w-0">
                                            <div className="text-sm font-medium truncate">{lead.address}</div>
                                            <div className="text-xs text-muted-foreground">{lead.agent_name || 'Agent unknown'} · Score {lead.icp_score}</div>
                                            {lead.agent_email && <div className="text-xs text-muted-foreground font-mono mt-0.5">{lead.agent_email}</div>}
                                        </div>
                                        <button
                                            onClick={() => handleSendEmail(lead)}
                                            disabled={!lead.agent_email}
                                            className="px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
                                        >
                                            <Send className="w-3 h-3" /> Send
                                        </button>
                                    </div>
                                ))
                            }
                        </div>
                    </div>
                )}

                {/* ── SETUP TAB ── */}
                {activeTab === 'setup' && (
                    <div className="space-y-6 max-w-3xl">
                        <h2 className="font-bold text-lg flex items-center gap-2"><Terminal className="w-5 h-5" /> Database Setup</h2>

                        <div className={cn("p-4 rounded-xl border flex items-start gap-3", dbReady ? "bg-green-500/10 border-green-500/20" : "bg-amber-500/10 border-amber-500/20")}>
                            {dbReady
                                ? <CheckCircle className="w-5 h-5 text-green-500 shrink-0 mt-0.5" />
                                : <AlertCircle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />}
                            <div>
                                <div className="font-medium text-sm">{dbReady ? 'Database ready' : 'outreach_leads table not found'}</div>
                                <div className="text-xs text-muted-foreground mt-0.5">{dbReady ? 'All tables exist and are accessible.' : 'Run the SQL below in your Supabase SQL Editor to create the required table.'}</div>
                            </div>
                        </div>

                        {!dbReady && (
                            <>
                                <div className="space-y-2">
                                    <div className="flex items-center justify-between">
                                        <p className="text-sm font-medium">1. Go to <a href="https://supabase.com/dashboard/project/vmuvjfflszhifuyvmjwh/sql/new" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline inline-flex items-center gap-1">Supabase SQL Editor <ExternalLink className="w-3 h-3" /></a></p>
                                        <button onClick={() => { navigator.clipboard.writeText(SETUP_SQL); toast.success('SQL copied!'); }}
                                            className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-muted hover:bg-muted/80 rounded-lg font-medium transition-colors">
                                            <Copy className="w-3 h-3" /> Copy SQL
                                        </button>
                                    </div>
                                    <pre className="bg-muted/50 border border-border rounded-xl p-4 text-xs font-mono overflow-x-auto whitespace-pre-wrap text-muted-foreground">{SETUP_SQL}</pre>
                                </div>
                                <p className="text-sm text-muted-foreground">2. Paste and run, then click Refresh below.</p>
                                <button onClick={loadData} className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg font-medium text-sm hover:bg-primary/90">
                                    <RefreshCw className="w-4 h-4" /> Check Again
                                </button>
                            </>
                        )}

                        {/* API Key Status */}
                        <div className="bg-card border border-border rounded-xl p-6 space-y-4">
                            <h3 className="font-semibold">API Keys Status</h3>
                            <div className="space-y-2">
                                {[
                                    { name: 'Zyte (Scraper)', env: 'ZYTE_API_KEY', status: true },
                                    { name: 'Moondream (Vision)', env: 'MOONDREAM_API_KEY', status: true },
                                    { name: 'CapMonster (CAPTCHA)', env: 'CAPMONSTER_API_KEY', status: true },
                                    { name: 'Kie.ai (Staging)', env: 'KIE_AI_API_KEY', status: true },
                                    { name: 'Gmail API', env: 'GMAIL_CLIENT_ID', status: true },
                                    { name: 'Infermatic AI (Reply Bot)', env: 'INFERMATIC_API_KEY', status: true },
                                ].map(key => (
                                    <div key={key.name} className="flex items-center justify-between p-3 bg-muted/30 rounded-lg">
                                        <div>
                                            <div className="text-sm font-medium">{key.name}</div>
                                            <div className="text-xs text-muted-foreground font-mono">{key.env}</div>
                                        </div>
                                        <span className={cn("text-xs px-2 py-1 rounded-full font-medium", key.status ? "bg-green-500/10 text-green-500" : "bg-muted text-muted-foreground")}>
                                            {key.status ? '✓ Configured' : 'Not set'}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                )}

                {/* ── REPLIES TAB ── */}
                {activeTab === 'replies' && (
                    <div className="space-y-6">
                        <div className="flex items-center justify-between">
                            <div>
                                <h2 className="font-semibold text-lg">Reply Inbox</h2>
                                <p className="text-sm text-muted-foreground mt-1">AI reads every reply and responds automatically. Review Q&amp;A pairs here.</p>
                            </div>
                            <div className="flex items-center gap-2">
                                <select
                                    value={repliesFilter}
                                    onChange={e => {
                                        const v = e.target.value as 'all' | 'unreviewed';
                                        setRepliesFilter(v);
                                        setRepliesLoading(true);
                                        getOutreachReplies({ unreviewedOnly: v === 'unreviewed' })
                                            .then(r => setReplies(r.replies))
                                            .finally(() => setRepliesLoading(false));
                                    }}
                                    className="text-sm bg-muted border border-border rounded-lg px-3 py-1.5"
                                >
                                    <option value="unreviewed">Unreviewed only</option>
                                    <option value="all">All replies</option>
                                </select>
                                <button
                                    onClick={async () => {
                                        setCheckingReplies(true);
                                        try {
                                            const result = await checkAndReplyToOutreach();
                                            toast.success(`Checked inbox: ${result.checked} new, ${result.replied} replied`);
                                            const r = await getOutreachReplies({ unreviewedOnly: repliesFilter === 'unreviewed' });
                                            setReplies(r.replies);
                                        } catch (e: any) {
                                            toast.error(e.message);
                                        } finally {
                                            setCheckingReplies(false);
                                        }
                                    }}
                                    disabled={checkingReplies}
                                    className="flex items-center gap-2 px-3 py-1.5 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
                                >
                                    <Mail className="w-4 h-4" />
                                    {checkingReplies ? 'Checking...' : 'Check & Reply Now'}
                                </button>
                            </div>
                        </div>

                        {repliesLoading ? (
                            <div className="text-center py-12 text-muted-foreground text-sm">Loading replies...</div>
                        ) : replies.length === 0 ? (
                            <div className="text-center py-12 text-muted-foreground text-sm">
                                No {repliesFilter === 'unreviewed' ? 'unreviewed ' : ''}replies yet. The AI checks every 30 minutes automatically.
                            </div>
                        ) : (
                            <div className="space-y-4">
                                {replies.map(reply => (
                                    <div key={reply.id} className={cn("rounded-xl border p-5 space-y-4", reply.reviewed ? "border-border opacity-60" : "border-primary/30 bg-primary/5")}>
                                        <div className="flex items-start justify-between gap-4">
                                            <div className="space-y-1 min-w-0">
                                                <div className="flex items-center gap-2 flex-wrap">
                                                    <span className="font-semibold text-sm">{reply.sender_name || reply.sender_email}</span>
                                                    <span className="text-xs text-muted-foreground font-mono">{reply.sender_email}</span>
                                                    {reply.unsubscribe && <span className="text-xs px-2 py-0.5 rounded-full bg-red-500/10 text-red-400 font-medium">Unsubscribe</span>}
                                                    {reply.ai_sent && <span className="text-xs px-2 py-0.5 rounded-full bg-green-500/10 text-green-400 font-medium">AI Replied</span>}
                                                    {!reply.ai_sent && <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 font-medium">Not sent</span>}
                                                </div>
                                                {reply.address && <div className="text-xs text-muted-foreground">Re: {reply.address}</div>}
                                                <div className="text-xs text-muted-foreground">{new Date(reply.created_at).toLocaleString()}</div>
                                            </div>
                                            {!reply.reviewed && (
                                                <button
                                                    onClick={async () => {
                                                        await markReplyReviewed(reply.id);
                                                        setReplies(prev => prev.map(r => r.id === reply.id ? { ...r, reviewed: true } : r));
                                                    }}
                                                    className="shrink-0 text-xs px-3 py-1.5 rounded-lg border border-border hover:bg-muted transition-colors"
                                                >
                                                    Mark Reviewed
                                                </button>
                                            )}
                                        </div>

                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                            <div className="space-y-1.5">
                                                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Their Reply</div>
                                                <div className="text-sm bg-muted/40 rounded-lg p-3 whitespace-pre-wrap max-h-48 overflow-y-auto leading-relaxed">
                                                    {reply.incoming_body}
                                                </div>
                                            </div>
                                            <div className="space-y-1.5">
                                                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                                                    AI Response {reply.sent_at && <span className="normal-case font-normal">· sent {new Date(reply.sent_at).toLocaleTimeString()}</span>}
                                                </div>
                                                <div className={cn("text-sm rounded-lg p-3 whitespace-pre-wrap max-h-48 overflow-y-auto leading-relaxed", reply.ai_draft ? "bg-green-500/5 border border-green-500/20" : "bg-muted/40 text-muted-foreground italic")}>
                                                    {reply.ai_draft || 'No AI draft generated (INFERMATIC_API_KEY missing?)'}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
