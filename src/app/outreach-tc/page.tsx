'use client';

import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/lib/auth-context';
import { useRouter } from 'next/navigation';
import { BarChart2, Users, Settings, Mail, Terminal, Play, RefreshCw, MessageSquare, CheckCircle, AlertCircle, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
    getTCLeadStats,
    getTCLeads,
    getTCRecentRuns,
    loadTCPipelineConfig,
    saveTCPipelineConfig,
    getTCReplies,
} from '@/app/actions/outreach-tc';
import { toast } from 'sonner';

const ALLOWED_EMAILS = ['conexer@gmail.com', 'rocsolid01@gmail.com'];

type Tab = 'dashboard' | 'leads' | 'config' | 'email' | 'replies' | 'setup';

const STATUS_COLORS: Record<string, string> = {
    new: 'bg-slate-500/20 text-slate-400',
    queued: 'bg-cyan-500/20 text-cyan-400',
    emailed: 'bg-green-500/20 text-green-400',
    skipped: 'bg-amber-500/20 text-amber-400',
    failed: 'bg-red-500/20 text-red-400',
};

const DEFAULT_CITIES = [
    'Houston, TX', 'Dallas, TX', 'Austin, TX', 'San Antonio, TX', 'Fort Worth, TX',
    'Phoenix, AZ', 'Las Vegas, NV', 'Denver, CO', 'Atlanta, GA', 'Charlotte, NC',
    'Nashville, TN', 'Tampa, FL', 'Orlando, FL', 'Raleigh, NC', 'Jacksonville, FL',
    'Miami, FL', 'Seattle, WA', 'Portland, OR', 'Sacramento, CA', 'Kansas City, MO',
    'Columbus, OH', 'Indianapolis, IN', 'Richmond, VA', 'St. Louis, MO', 'Memphis, TN',
    'Louisville, KY', 'Oklahoma City, OK', 'Scottsdale, AZ', 'Henderson, NV', 'Boise, ID',
];

const SETUP_SQL = `-- Run in Supabase SQL Editor (or call /api/admin/tc-migrate with CRON_SECRET Bearer header)

CREATE TABLE IF NOT EXISTS public.tc_leads (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  company_name TEXT, owner_name TEXT, contact_name TEXT,
  email TEXT, normalized_email TEXT, phone TEXT,
  website_url TEXT, source_url TEXT, city TEXT, state TEXT,
  address TEXT, description TEXT,
  services TEXT[] DEFAULT '{}',
  states_served TEXT[] DEFAULT '{}',
  years_in_business TEXT, team_size INTEGER,
  review_count INTEGER, rating NUMERIC,
  icp_score INTEGER DEFAULT 0,
  status TEXT DEFAULT 'new',
  email_sent_at TIMESTAMPTZ, gmail_message_id TEXT, gmail_thread_id TEXT,
  scraped_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.tc_email_queue (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_id UUID REFERENCES public.tc_leads(id) ON DELETE CASCADE,
  normalized_email TEXT NOT NULL, agent_email TEXT NOT NULL,
  status TEXT DEFAULT 'queued', attempts INTEGER DEFAULT 0,
  send_after TIMESTAMPTZ DEFAULT NOW(), locked_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ, last_error TEXT,
  source TEXT DEFAULT 'pipeline', ready_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.tc_pipeline_runs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  ran_at TIMESTAMPTZ DEFAULT NOW(),
  processed INTEGER DEFAULT 0, emails_sent INTEGER DEFAULT 0,
  errors TEXT[] DEFAULT '{}', debug TEXT[] DEFAULT '{}',
  trigger TEXT DEFAULT 'cron'
);

CREATE TABLE IF NOT EXISTS public.tc_pipeline_config (
  id INTEGER PRIMARY KEY DEFAULT 1,
  cities TEXT[] DEFAULT ARRAY['Houston, TX','Dallas, TX','Austin, TX'],
  emails_per_day INTEGER DEFAULT 30,
  sessions_per_day INTEGER DEFAULT 4,
  scrapes_per_session INTEGER DEFAULT 6,
  cron_enabled BOOLEAN DEFAULT FALSE,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO public.tc_pipeline_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.tc_recipient_locks (
  normalized_email TEXT PRIMARY KEY,
  lead_id UUID REFERENCES public.tc_leads(id) ON DELETE SET NULL,
  sent_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.tc_city_log (
  city TEXT PRIMARY KEY,
  last_scraped_at TIMESTAMPTZ DEFAULT NOW(),
  leads_found INTEGER DEFAULT 0
);

-- Claim function for atomic queue
CREATE OR REPLACE FUNCTION claim_next_tc_email_queue_item()
RETURNS SETOF tc_email_queue LANGUAGE plpgsql AS $$
DECLARE v_row tc_email_queue; BEGIN
  SELECT * INTO v_row FROM tc_email_queue
  WHERE status = 'queued' AND send_after <= NOW()
  ORDER BY (SELECT icp_score FROM tc_leads WHERE id = lead_id) DESC NULLS LAST, ready_at ASC
  LIMIT 1 FOR UPDATE SKIP LOCKED;
  IF v_row.id IS NULL THEN RETURN; END IF;
  UPDATE tc_email_queue SET status = 'sending', locked_at = NOW(), attempts = attempts + 1, updated_at = NOW() WHERE id = v_row.id;
  RETURN QUERY SELECT * FROM tc_email_queue WHERE id = v_row.id;
END $$;

-- Enable RLS on all tables
ALTER TABLE public.tc_leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tc_email_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tc_pipeline_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tc_pipeline_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tc_recipient_locks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tc_city_log ENABLE ROW LEVEL SECURITY;`;

export default function OutreachTCPage() {
    const { user, loading } = useAuth();
    const router = useRouter();
    const [authorized, setAuthorized] = useState(false);
    const [activeTab, setActiveTab] = useState<Tab>('dashboard');

    // Stats
    const [stats, setStats] = useState({ total: 0, new: 0, queued: 0, emailed: 0, skipped: 0, sentToday: 0, queueDepth: 0, avgScore: 0 });
    const [leads, setLeads] = useState<any[]>([]);
    const [runs, setRuns] = useState<any[]>([]);
    const [replies, setReplies] = useState<any[]>([]);
    const [loadingData, setLoadingData] = useState(false);

    // Config
    const [config, setConfig] = useState<any>(null);
    const [cities, setCities] = useState<string[]>(DEFAULT_CITIES);
    const [emailsPerDay, setEmailsPerDay] = useState(30);
    const [sessionsPerDay, setSessionsPerDay] = useState(4);
    const [scrapesPerSession, setScrapesPerSession] = useState(6);
    const [cronEnabled, setCronEnabled] = useState(false);
    const [savingConfig, setSavingConfig] = useState(false);

    // Pipeline control
    const [running, setRunning] = useState(false);
    const [runLog, setRunLog] = useState<string[]>([]);

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
            const [statsRes, leadsRes, runsRes, configRes] = await Promise.all([
                getTCLeadStats(), getTCLeads(200), getTCRecentRuns(10), loadTCPipelineConfig(),
            ]);
            setStats(statsRes);
            setLeads(leadsRes);
            setRuns(runsRes);
            if (configRes.config) {
                setConfig(configRes.config);
                setCities(configRes.config.cities ?? DEFAULT_CITIES);
                setEmailsPerDay(configRes.config.emails_per_day ?? 30);
                setSessionsPerDay(configRes.config.sessions_per_day ?? 4);
                setScrapesPerSession(configRes.config.scrapes_per_session ?? 6);
                setCronEnabled(configRes.config.cron_enabled ?? false);
            }
        } catch (e: any) {
            toast.error('Load failed: ' + e.message);
        } finally {
            setLoadingData(false);
        }
    }, []);

    const loadReplies = useCallback(async () => {
        const data = await getTCReplies();
        setReplies(data);
    }, []);

    useEffect(() => {
        if (authorized) {
            loadData();
        }
    }, [authorized, loadData]);

    useEffect(() => {
        if (activeTab === 'replies') loadReplies();
    }, [activeTab, loadReplies]);

    const handleSaveConfig = async () => {
        setSavingConfig(true);
        try {
            const { error } = await saveTCPipelineConfig({
                cities,
                emails_per_day: emailsPerDay,
                sessions_per_day: sessionsPerDay,
                scrapes_per_session: scrapesPerSession,
                cron_enabled: cronEnabled,
            });
            if (error) throw new Error(error);
            toast.success('Config saved');
            await loadData();
        } catch (e: any) {
            toast.error('Save failed: ' + e.message);
        } finally {
            setSavingConfig(false);
        }
    };

    const handleManualRun = async (mode: 'scrape' | 'email' | 'both') => {
        setRunning(true);
        setRunLog([`Starting manual run (mode=${mode})...`]);
        try {
            const res = await fetch('/api/admin/run-tc-pipeline', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${process.env.NEXT_PUBLIC_CRON_SECRET ?? ''}`,
                },
                body: JSON.stringify({ mode }),
            });
            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.error || `HTTP ${res.status}`);
            }
            setRunLog(prev => [...prev, 'Pipeline started in background — refresh in ~60s to see results']);
            toast.success('Pipeline started');
            setTimeout(() => { loadData(); setRunning(false); }, 5000);
        } catch (e: any) {
            setRunLog(prev => [...prev, `Error: ${e.message}`]);
            toast.error(e.message);
            setRunning(false);
        }
    };

    const handleRunMigration = async () => {
        setRunLog(['Running DB migration...']);
        try {
            const secret = prompt('Enter CRON_SECRET to run migration:');
            if (!secret) return;
            const res = await fetch('/api/admin/tc-migrate', {
                headers: { 'Authorization': `Bearer ${secret}` },
            });
            const data = await res.json();
            setRunLog(data.results || ['Done']);
            toast.success(`Migration done. tc_leads accessible: ${data.tc_leads_accessible}`);
            await loadData();
        } catch (e: any) {
            toast.error(e.message);
        }
    };

    if (loading || !authorized) {
        return <div className="flex items-center justify-center min-h-screen bg-black text-white">Loading...</div>;
    }

    const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
        { id: 'dashboard', label: 'Dashboard', icon: <BarChart2 className="w-4 h-4" /> },
        { id: 'leads', label: 'Leads', icon: <Users className="w-4 h-4" /> },
        { id: 'config', label: 'Config', icon: <Settings className="w-4 h-4" /> },
        { id: 'email', label: 'Email', icon: <Mail className="w-4 h-4" /> },
        { id: 'replies', label: 'Replies', icon: <MessageSquare className="w-4 h-4" /> },
        { id: 'setup', label: 'Setup', icon: <Terminal className="w-4 h-4" /> },
    ];

    return (
        <div className="min-h-screen bg-black text-white">
            <div className="max-w-7xl mx-auto px-4 py-6">
                {/* Header */}
                <div className="flex items-center justify-between mb-6">
                    <div>
                        <h1 className="text-2xl font-bold">TC Outreach</h1>
                        <p className="text-sm text-zinc-400 mt-0.5">Transactional coordinator discovery + email pipeline</p>
                    </div>
                    <button
                        onClick={loadData}
                        disabled={loadingData}
                        className="flex items-center gap-2 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-sm transition-colors"
                    >
                        <RefreshCw className={cn('w-4 h-4', loadingData && 'animate-spin')} />
                        Refresh
                    </button>
                </div>

                {/* Tabs */}
                <div className="flex gap-1 mb-6 border-b border-zinc-800 pb-0">
                    {tabs.map(tab => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            className={cn(
                                'flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-t-lg transition-colors border-b-2 -mb-px',
                                activeTab === tab.id
                                    ? 'border-violet-500 text-violet-400 bg-violet-500/5'
                                    : 'border-transparent text-zinc-400 hover:text-white'
                            )}
                        >
                            {tab.icon}
                            {tab.label}
                        </button>
                    ))}
                </div>

                {/* DASHBOARD TAB */}
                {activeTab === 'dashboard' && (
                    <div className="space-y-6">
                        {/* Stat cards */}
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                            {[
                                { label: 'Total Leads', value: stats.total, color: 'text-white' },
                                { label: 'Emailed', value: stats.emailed, color: 'text-green-400' },
                                { label: 'Queue Depth', value: stats.queueDepth, color: 'text-cyan-400' },
                                { label: 'Sent Today', value: stats.sentToday, color: 'text-violet-400' },
                                { label: 'Avg ICP Score', value: stats.avgScore, color: 'text-amber-400' },
                                { label: 'New (unqueued)', value: stats.new, color: 'text-zinc-300' },
                                { label: 'Skipped', value: stats.skipped, color: 'text-zinc-500' },
                                { label: 'In Queue', value: stats.queued, color: 'text-blue-400' },
                            ].map(s => (
                                <div key={s.label} className="bg-zinc-900 rounded-xl p-4 border border-zinc-800">
                                    <div className="text-xs text-zinc-500 mb-1">{s.label}</div>
                                    <div className={cn('text-2xl font-bold', s.color)}>{s.value}</div>
                                </div>
                            ))}
                        </div>

                        {/* Cron status */}
                        <div className="bg-zinc-900 rounded-xl p-4 border border-zinc-800">
                            <div className="flex items-center justify-between mb-3">
                                <h2 className="font-semibold">Schedule</h2>
                                <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium', cronEnabled ? 'bg-green-500/20 text-green-400' : 'bg-zinc-700 text-zinc-400')}>
                                    {cronEnabled ? 'Active' : 'Paused'}
                                </span>
                            </div>
                            <div className="text-sm text-zinc-400 space-y-1">
                                <div>Pipeline cron: <code className="text-zinc-300">every 2h, 8am–6pm PT</code></div>
                                <div>Email sender: <code className="text-zinc-300">every 30min, 8am–6pm PT</code></div>
                                <div>Sessions per day limit: <span className="text-zinc-300">{config?.sessions_per_day ?? '—'}</span></div>
                                <div>Emails per day limit: <span className="text-zinc-300">{config?.emails_per_day ?? '—'}</span></div>
                            </div>
                        </div>

                        {/* Manual controls */}
                        <div className="bg-zinc-900 rounded-xl p-4 border border-zinc-800">
                            <h2 className="font-semibold mb-3">Manual Controls</h2>
                            <div className="flex flex-wrap gap-2">
                                <button
                                    onClick={() => handleManualRun('scrape')}
                                    disabled={running}
                                    className="flex items-center gap-2 px-4 py-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 rounded-lg text-sm font-medium transition-colors"
                                >
                                    <Play className="w-4 h-4" />
                                    Run Scrape Session
                                </button>
                                <button
                                    onClick={() => handleManualRun('email')}
                                    disabled={running}
                                    className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-lg text-sm font-medium transition-colors"
                                >
                                    <Mail className="w-4 h-4" />
                                    Send Queued Emails
                                </button>
                                <button
                                    onClick={() => handleManualRun('both')}
                                    disabled={running}
                                    className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 rounded-lg text-sm font-medium transition-colors"
                                >
                                    <Zap className="w-4 h-4" />
                                    Run Full Pipeline
                                </button>
                            </div>
                            {runLog.length > 0 && (
                                <div className="mt-3 bg-black rounded-lg p-3 font-mono text-xs text-zinc-300 space-y-1 max-h-40 overflow-y-auto">
                                    {runLog.map((line, i) => <div key={i}>{line}</div>)}
                                </div>
                            )}
                        </div>

                        {/* Recent runs */}
                        <div className="bg-zinc-900 rounded-xl p-4 border border-zinc-800">
                            <h2 className="font-semibold mb-3">Recent Runs</h2>
                            {runs.length === 0 ? (
                                <p className="text-zinc-500 text-sm">No runs yet</p>
                            ) : (
                                <div className="space-y-2">
                                    {runs.map(run => (
                                        <div key={run.id} className="flex items-start gap-3 py-2 border-b border-zinc-800 last:border-0">
                                            <div className={cn('mt-0.5 w-2 h-2 rounded-full flex-shrink-0', run.errors?.length > 0 ? 'bg-red-400' : 'bg-green-400')} />
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-2 text-sm">
                                                    <span className="font-medium">{run.processed ?? 0} leads</span>
                                                    {run.emails_sent > 0 && <span className="text-green-400">{run.emails_sent} sent</span>}
                                                    <span className="text-zinc-600 text-xs ml-auto flex-shrink-0">{new Date(run.ran_at).toLocaleString()}</span>
                                                    <span className="text-zinc-600 text-xs capitalize">{run.trigger}</span>
                                                </div>
                                                {run.errors?.length > 0 && (
                                                    <div className="text-xs text-red-400 mt-1 truncate">{run.errors[0]}</div>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* LEADS TAB */}
                {activeTab === 'leads' && (
                    <div className="space-y-4">
                        <div className="flex items-center justify-between">
                            <h2 className="font-semibold">{leads.length} TC Leads</h2>
                            <div className="text-xs text-zinc-500">Sorted by ICP score</div>
                        </div>
                        {leads.length === 0 ? (
                            <div className="text-center py-20 text-zinc-500">
                                <Users className="w-10 h-10 mx-auto mb-3 opacity-30" />
                                <p>No TC leads yet. Run a scrape session to discover companies.</p>
                            </div>
                        ) : (
                            <div className="space-y-2">
                                {leads.map(lead => (
                                    <div key={lead.id} className="bg-zinc-900 rounded-xl p-4 border border-zinc-800 hover:border-zinc-700 transition-colors">
                                        <div className="flex items-start justify-between gap-3">
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-2 flex-wrap">
                                                    <span className="font-medium truncate">{lead.company_name}</span>
                                                    {lead.website_url && (
                                                        <a href={lead.website_url} target="_blank" rel="noopener noreferrer" className="text-zinc-500 hover:text-zinc-300">
                                                            <ExternalLink className="w-3 h-3" />
                                                        </a>
                                                    )}
                                                    <span className={cn('px-2 py-0.5 rounded-full text-xs', STATUS_COLORS[lead.status] ?? 'bg-zinc-700 text-zinc-400')}>
                                                        {lead.status}
                                                    </span>
                                                </div>
                                                <div className="text-sm text-zinc-400 mt-1 flex items-center gap-3 flex-wrap">
                                                    {lead.email && <span>{lead.email}</span>}
                                                    {lead.city && <span>{lead.city}{lead.state ? `, ${lead.state}` : ''}</span>}
                                                    {lead.team_size && <span>{lead.team_size} person{lead.team_size > 1 ? 's' : ''}</span>}
                                                    {lead.owner_name && <span>Owner: {lead.owner_name}</span>}
                                                </div>
                                                {lead.services?.length > 0 && (
                                                    <div className="flex gap-1 mt-2 flex-wrap">
                                                        {lead.services.map((s: string) => (
                                                            <span key={s} className="px-2 py-0.5 bg-zinc-800 rounded text-xs text-zinc-400">{s}</span>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                            <div className="flex-shrink-0 text-right">
                                                <div className={cn('text-lg font-bold',
                                                    (lead.icp_score ?? 0) >= 60 ? 'text-green-400' :
                                                    (lead.icp_score ?? 0) >= 40 ? 'text-amber-400' : 'text-zinc-400'
                                                )}>
                                                    {lead.icp_score ?? 0}
                                                </div>
                                                <div className="text-xs text-zinc-600">score</div>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {/* CONFIG TAB */}
                {activeTab === 'config' && (
                    <div className="max-w-2xl space-y-6">
                        <div className="bg-zinc-900 rounded-xl p-5 border border-zinc-800 space-y-4">
                            <h2 className="font-semibold">Pipeline Settings</h2>

                            <div className="grid grid-cols-3 gap-4">
                                <label className="block">
                                    <span className="text-xs text-zinc-400 block mb-1">Emails/day</span>
                                    <input
                                        type="number" min={1} max={100} value={emailsPerDay}
                                        onChange={e => setEmailsPerDay(Number(e.target.value))}
                                        className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
                                    />
                                </label>
                                <label className="block">
                                    <span className="text-xs text-zinc-400 block mb-1">Sessions/day</span>
                                    <input
                                        type="number" min={1} max={24} value={sessionsPerDay}
                                        onChange={e => setSessionsPerDay(Number(e.target.value))}
                                        className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
                                    />
                                </label>
                                <label className="block">
                                    <span className="text-xs text-zinc-400 block mb-1">Scrapes/session</span>
                                    <input
                                        type="number" min={1} max={20} value={scrapesPerSession}
                                        onChange={e => setScrapesPerSession(Number(e.target.value))}
                                        className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
                                    />
                                </label>
                            </div>

                            <div className="flex items-center justify-between py-3 border-t border-zinc-800">
                                <div>
                                    <div className="text-sm font-medium">Cron Schedule</div>
                                    <div className="text-xs text-zinc-500">Enable automated pipeline runs</div>
                                </div>
                                <button
                                    onClick={() => setCronEnabled(!cronEnabled)}
                                    className={cn(
                                        'relative w-11 h-6 rounded-full transition-colors',
                                        cronEnabled ? 'bg-violet-600' : 'bg-zinc-700'
                                    )}
                                >
                                    <span className={cn('absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform', cronEnabled && 'translate-x-5')} />
                                </button>
                            </div>
                        </div>

                        <div className="bg-zinc-900 rounded-xl p-5 border border-zinc-800 space-y-3">
                            <div className="flex items-center justify-between">
                                <h2 className="font-semibold">Target Cities ({cities.length})</h2>
                                <div className="flex gap-2">
                                    <button onClick={() => setCities(DEFAULT_CITIES)} className="text-xs text-zinc-400 hover:text-white">Reset</button>
                                    <button onClick={() => setCities([])} className="text-xs text-zinc-400 hover:text-white">Clear</button>
                                </div>
                            </div>
                            <textarea
                                value={cities.join('\n')}
                                onChange={e => setCities(e.target.value.split('\n').map(c => c.trim()).filter(Boolean))}
                                rows={12}
                                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm font-mono resize-none"
                                placeholder="One city per line: Houston, TX"
                            />
                            <div className="text-xs text-zinc-500">One city per line in "City, ST" format.</div>
                        </div>

                        <button
                            onClick={handleSaveConfig}
                            disabled={savingConfig}
                            className="flex items-center gap-2 px-6 py-2.5 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 rounded-lg text-sm font-medium transition-colors"
                        >
                            {savingConfig ? <RefreshCw className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                            Save Config
                        </button>
                    </div>
                )}

                {/* EMAIL TAB */}
                {activeTab === 'email' && (
                    <div className="space-y-6 max-w-2xl">
                        <div className="bg-zinc-900 rounded-xl p-5 border border-zinc-800">
                            <h2 className="font-semibold mb-3">Email Pipeline Status</h2>
                            <div className="space-y-2 text-sm">
                                <div className="flex justify-between">
                                    <span className="text-zinc-400">Sender account</span>
                                    <span className="font-mono text-zinc-200">kogflow.media@gmail.com</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-zinc-400">Queue depth</span>
                                    <span className="text-cyan-400 font-medium">{stats.queueDepth} ready to send</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-zinc-400">Sent today</span>
                                    <span className="text-green-400 font-medium">{stats.sentToday} / {config?.emails_per_day ?? 30}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-zinc-400">Total emailed (all time)</span>
                                    <span>{stats.emailed}</span>
                                </div>
                            </div>
                        </div>

                        <div className="bg-zinc-900 rounded-xl p-5 border border-zinc-800">
                            <h2 className="font-semibold mb-3">Email Template Info</h2>
                            <div className="text-sm text-zinc-400 space-y-2">
                                <p>Emails are personalized per-lead using scraped data:</p>
                                <ul className="space-y-1 list-disc list-inside text-zinc-500">
                                    <li>Opener references company name + city or notable detail</li>
                                    <li>Hook picks from investor/volume/listing-coord/multi-state angles</li>
                                    <li>Before/after staged images attached from existing emailed realtor leads</li>
                                    <li>Signed as Minh / Kogflow / kogflow.media@gmail.com</li>
                                </ul>
                                <p className="text-xs text-zinc-600 mt-2">Dedup: tc_recipient_locks table — once an email is sent, that address is permanently locked.</p>
                            </div>
                        </div>

                        <div className="bg-zinc-900 rounded-xl p-5 border border-zinc-800">
                            <h2 className="font-semibold mb-3">Quick Actions</h2>
                            <div className="flex flex-wrap gap-2">
                                <button
                                    onClick={() => handleManualRun('email')}
                                    disabled={running}
                                    className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-lg text-sm font-medium transition-colors"
                                >
                                    <Mail className="w-4 h-4" />
                                    Send Next Batch
                                </button>
                            </div>
                            {runLog.length > 0 && (
                                <div className="mt-3 bg-black rounded-lg p-3 font-mono text-xs text-zinc-300 space-y-1 max-h-40 overflow-y-auto">
                                    {runLog.map((line, i) => <div key={i}>{line}</div>)}
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* REPLIES TAB */}
                {activeTab === 'replies' && (
                    <div className="space-y-4">
                        <div className="flex items-center justify-between">
                            <h2 className="font-semibold">Emailed TCs ({replies.length})</h2>
                            <button onClick={loadReplies} className="text-xs text-zinc-400 hover:text-white flex items-center gap-1">
                                <RefreshCw className="w-3 h-3" /> Refresh
                            </button>
                        </div>
                        <p className="text-sm text-zinc-500">
                            These are TCs we've emailed. To view replies, open Gmail and search the thread ID. Automated reply detection is not yet implemented for TC outreach.
                        </p>
                        {replies.length === 0 ? (
                            <div className="text-center py-20 text-zinc-500">
                                <MessageSquare className="w-10 h-10 mx-auto mb-3 opacity-30" />
                                <p>No emailed leads yet.</p>
                            </div>
                        ) : (
                            <div className="space-y-2">
                                {replies.map(r => (
                                    <div key={r.id} className="bg-zinc-900 rounded-xl p-4 border border-zinc-800 flex items-center gap-4">
                                        <div className="flex-1 min-w-0">
                                            <div className="font-medium text-sm">{r.company_name}</div>
                                            <div className="text-xs text-zinc-400 mt-0.5">{r.email} · {r.city}</div>
                                        </div>
                                        <div className="text-xs text-zinc-500 flex-shrink-0">
                                            {r.email_sent_at ? new Date(r.email_sent_at).toLocaleDateString() : '—'}
                                        </div>
                                        {r.gmail_thread_id && (
                                            <a
                                                href={`https://mail.google.com/mail/u/0/#inbox/${r.gmail_thread_id}`}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="flex-shrink-0 text-zinc-400 hover:text-white"
                                            >
                                                <ExternalLink className="w-4 h-4" />
                                            </a>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {/* SETUP TAB */}
                {activeTab === 'setup' && (
                    <div className="max-w-3xl space-y-6">
                        <div className="bg-zinc-900 rounded-xl p-5 border border-zinc-800">
                            <h2 className="font-semibold mb-3">DB Migration</h2>
                            <p className="text-sm text-zinc-400 mb-3">
                                Run the migration route to create all TC tables in Supabase. You&apos;ll need the CRON_SECRET.
                            </p>
                            <div className="flex gap-2 flex-wrap">
                                <button
                                    onClick={handleRunMigration}
                                    className="flex items-center gap-2 px-4 py-2 bg-amber-600 hover:bg-amber-500 rounded-lg text-sm font-medium transition-colors"
                                >
                                    <AlertCircle className="w-4 h-4" />
                                    Run Migration
                                </button>
                            </div>
                            {runLog.length > 0 && (
                                <div className="mt-3 bg-black rounded-lg p-3 font-mono text-xs text-zinc-300 space-y-1 max-h-60 overflow-y-auto">
                                    {runLog.map((line, i) => <div key={i}>{line}</div>)}
                                </div>
                            )}
                        </div>

                        <div className="bg-zinc-900 rounded-xl p-5 border border-zinc-800">
                            <div className="flex items-center justify-between mb-3">
                                <h2 className="font-semibold">SQL Reference</h2>
                                <button
                                    onClick={() => { navigator.clipboard.writeText(SETUP_SQL); toast.success('Copied'); }}
                                    className="text-xs text-zinc-400 hover:text-white"
                                >
                                    Copy SQL
                                </button>
                            </div>
                            <pre className="text-xs text-zinc-400 overflow-x-auto bg-black rounded-lg p-4 max-h-96 overflow-y-auto whitespace-pre-wrap">
                                {SETUP_SQL}
                            </pre>
                        </div>

                        <div className="bg-zinc-900 rounded-xl p-5 border border-zinc-800">
                            <h2 className="font-semibold mb-3">Cron Endpoints</h2>
                            <div className="space-y-2 text-sm font-mono">
                                {[
                                    { path: '/api/cron/tc-pipeline', note: 'Scrape + stage new TC leads (2h interval)' },
                                    { path: '/api/cron/tc-email-sender', note: 'Send queued TC emails (30min interval)' },
                                    { path: '/api/admin/run-tc-pipeline', note: 'Manual trigger (POST)' },
                                    { path: '/api/admin/tc-migrate', note: 'DB migration (GET with Bearer)' },
                                ].map(ep => (
                                    <div key={ep.path} className="flex gap-3">
                                        <code className="text-violet-400 text-xs">{ep.path}</code>
                                        <span className="text-zinc-500 text-xs">— {ep.note}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

// Inline Zap icon since it might not be in the current lucide version
function Zap({ className }: { className?: string }) {
    return (
        <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
        </svg>
    );
}
