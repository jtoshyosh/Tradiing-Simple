'use client';

import { Fragment, useEffect, useMemo, useRef, useState, useTransition, type KeyboardEvent } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase-browser';
import type { AttachmentRow, NoTradeDayRow, SessionRow, SettingsRow, TradeRow, WeeklyReviewRow, TradeClassification } from '@/types/models';

const APP_VERSION = 'v1.0';
const tabs = ['dashboard', 'history', 'log', 'review'] as const;
type Tab = (typeof tabs)[number];
type LogMode = 'trade' | 'no_trade' | 'session';
type LogType = 'trade_log' | 'session';
type DashboardPeriod = 'weekly' | 'monthly' | 'quarterly' | 'annual' | 'ytd' | 'lifetime';
type TradeTypeFilter = 'all' | 'live' | 'paper';
type HistoryEntryTypeFilter = 'all' | 'trade_all' | 'session_all' | 'live_trade' | 'paper_trade' | 'no_trade_day' | 'pre_session_plan' | 'chart_session' | 'post_session_review';
type HistoryDateFilter = 'all_time' | 'this_month' | 'last_30_days' | 'custom';
type HelpKey = 'classification' | 'family' | 'model' | 'entry_emotion' | 'in_trade_emotion' | 'no_trade_mindset';
type HelpItem = readonly [string, string];

const classifications: TradeClassification[] = [
  'Valid setup',
  'Valid setup, poor execution',
  'FOMO trade',
  'Forced trade',
  'Experimental trade',
  'No valid setup'
];

const familyModels: Record<string, string[]> = {
  Bounce: ['5m FVG pullback', '2m inside 5m execution', 'VWAP continuation', 'HTF continuation pullback'],
  Reject: ['Liquidity sweep rejection', 'VWAP rejection', 'Failed breakout reject', 'External high/low sweep reversal'],
  Break: ['ORB break and retest', 'Session level break and retest', 'Displacement break continuation', 'Acceptance above/below key level'],
  'N/A / No valid setup': ['N/A / None']
};

const noTradeReasons = ['No A+ setup', 'No clear displacement', 'News risk', 'Choppy session'];
const SESSION_DEFAULT_TIMES = {
  chart: { start: '06:30', end: '09:00' },
  journal: { start: '20:00', end: '21:00' }
} as const;
const entryEmotionOptions = [
  { value: 'Calm', label: 'Calm (steady, neutral, disciplined)' },
  { value: 'Confident', label: 'Confident (strong conviction in the setup)' },
  { value: 'FOMO / Impatient', label: "FOMO / Impatient (rushed, didn't want to miss it)" },
  { value: 'Revengeful / Tilted', label: 'Revengeful / Tilted (emotionally compensating)' },
  { value: 'Greedy', label: 'Greedy (wanted more than plan justified)' }
] as const;
const inTradeEmotionOptions = [
  { value: 'Calm', label: 'Calm (stuck to plan during management)' },
  { value: 'Confident', label: 'Confident (trusted the trade plan)' },
  { value: 'Surprised', label: 'Surprised (market reacted differently than expected)' },
  { value: 'Greedy', label: 'Greedy (pushed for more than planned)' },
  { value: 'Panicked', label: 'Panicked (interfered impulsively with TP/SL)' }
] as const;
const noTradeMindsetOptions = [
  { value: 'Present but disappointed', label: 'Present but disappointed (I was engaged and waiting, but no valid setup came)' },
  { value: 'Not fully present', label: 'Not fully present (I wasn\'t really locked in or actively tracking the session)' },
  { value: 'Accepting / indifferent', label: 'Accepting / indifferent (if the setup came I\'d take it, if not I was okay with that)' }
] as const;
type EntryEmotion = (typeof entryEmotionOptions)[number]['value'];
type InTradeEmotion = (typeof inTradeEmotionOptions)[number]['value'];
type NoTradeMindset = (typeof noTradeMindsetOptions)[number]['value'];
const DEFAULT_MISTAKE_CATALOG = [
  'FOMO entry',
  'Early entry',
  'Late entry',
  'Chased move',
  'Moved stop',
  'Exited too early',
  'Held too long',
  'Revenge trade',
  'Overtrading',
  'Oversized position',
  'Ignored stop loss',
  'Misread bias',
  'Traded into news',
  'Traded in chop',
  'Ignored session timing',
  'Ignored higher timeframe context',
  'Poor risk-reward',
  'No displacement / weak setup',
  'Emotional interference'
] as const;
const INACTIVE_MISTAKE_TAGS = new Set([
  'huh?',
  'huh',
  'test',
  'unfortunate',
  'broke plan',
  'forced trade',
  'no a+ setup',
  'mistake',
  'tmp',
  'todo',
  'n/a'
]);
const SETTINGS_CACHE_PREFIX = 'jy-settings-cache:';
const emotionalPressureScale: Array<{ value: number; label: string }> = [
  { value: 1, label: '1 = Level-headed' },
  { value: 2, label: '2 = Slight tension' },
  { value: 3, label: '3 = Pressured / hesitant' },
  { value: 4, label: '4 = Emotional management / urge to interfere' },
  { value: 5, label: '5 = Revenge / panic / pressure to exit' }
];
const forcedInvalidClassifications: TradeClassification[] = ['FOMO trade', 'Forced trade', 'No valid setup'];
const NA_FAMILY = 'N/A / No valid setup';
const NA_MODEL = 'N/A / None';

const helpDefinitions: Record<HelpKey, readonly HelpItem[]> = {
  family: [
    ['Bounce', 'Price reclaims a key level, then confirms continuation after pullback.'],
    ['Reject', 'Price sweeps liquidity, fails to hold, then rotates back.'],
    ['Break', 'Market breaks structure, retests, and continues in trend direction.'],
    ['N/A / No valid setup', 'Use when there was no valid setup to classify.']
  ],
  model: [
    ['5m FVG pullback', 'Entry on retrace into a 5-minute fair value gap with confirmation.'],
    ['2m inside 5m execution', 'Use 2-minute entries aligned to 5-minute structure.'],
    ['Liquidity sweep rejection', 'Fade a sweep through prior highs/lows once rejection confirms.'],
    ['VWAP continuation', 'Join continuation after VWAP support/resistance confirms.'],
    ['VWAP rejection', 'Counter move when VWAP rejection is clear.'],
    ['ORB break and retest', 'Trade opening-range breakout after retest confirms acceptance.'],
    ['HTF continuation pullback', 'Enter pullback aligned with higher timeframe trend.'],
    ['N/A / None', 'Use when trade is intentionally marked with no valid setup.']
  ],
  entry_emotion: [
    ['Calm', 'Steady before entry, aligned with checklist and risk plan.'],
    ['Confident', 'You saw clear confluence and entered with measured conviction.'],
    ['FOMO / Impatient', 'You felt urgency and entered early to avoid missing the move.'],
    ['Revengeful / Tilted', 'Entry was emotionally driven by prior outcome, not clean signal.'],
    ['Greedy', 'You entered with outcome focus and stretched beyond planned edge.']
  ],
  in_trade_emotion: [
    ['Calm', 'Management stayed mechanical: follow planned stop/targets with discipline.'],
    ['Confident', 'You trusted the plan and avoided unnecessary interference.'],
    ['Surprised', 'Price behavior differed from expectation and increased decision pressure.'],
    ['Greedy', 'You pushed for extra beyond plan and delayed planned exits.'],
    ['Panicked', 'You reacted impulsively and interfered with TP/SL management.']
  ],
  no_trade_mindset: [
    ['Present but disappointed', 'You were engaged and selective, but accepted no valid setup occurred.'],
    ['Not fully present', 'Focus and session engagement were limited, reducing decision quality.'],
    ['Accepting / indifferent', 'You stayed process-oriented and neutral about whether a setup appeared.']
  ],
  classification: [
    ['Valid setup', 'Use this when the trade matched your actual rules and setup criteria.'],
    ['Valid setup, poor execution', 'Use this when setup was valid but execution quality was poor.'],
    ['FOMO trade', 'Use this when fear of missing out drove the trade.'],
    ['Forced trade', 'Use this when trade quality was not there but you took it anyway.'],
    ['Experimental trade', 'Use this for intentional tests outside your normal playbook.'],
    ['No valid setup', 'Use this when there was no real setup by your rules.']
  ]
};

const helpNote =
  'FOMO / Forced / No valid setup trades do not need to be forced into Bounce / Reject / Break. Use N/A / No valid setup + N/A / None when appropriate.';

type Props = { userId: string; email?: string; onSignOut: () => Promise<void> };
type DetailState = { kind: 'trade'; id: string } | { kind: 'no_trade'; id: string } | { kind: 'session'; id: string } | null;
type TradeDraft = {
  trade_date: string;
  ticker: string;
  classification: TradeClassification;
  family: string;
  model: string;
  pnl: string;
  r_multiple_whole: string;
  r_multiple_decimal: string;
  minutes_in_trade: string;
  emotional_pressure: string;
  entry_emotion: EntryEmotion;
  in_trade_emotion: InTradeEmotion;
  is_paper_trade: boolean;
  mistake_tags: string[];
  notes: string;
};
type OcrDebugState = {
  ocrStatus?: 'idle' | 'image_loaded' | 'running' | 'succeeded' | 'no_text' | 'failed' | 'no_images';
  ocrCharCount?: number;
  ocrError?: string;
  ocrSteps?: string[];
  parsedHeaderLine?: string;
  tickerRejectReason?: string;
  headerOcrText?: string;
  tickerSource?: 'header_ocr' | 'full_ocr' | 'metadata' | 'none';
  microResolutionRule?: string;
  minutesRejectReason?: string;
  timeframeRejected?: boolean;
};
type TradeExtractSuggestions = Partial<Pick<TradeDraft, 'trade_date' | 'ticker' | 'pnl' | 'minutes_in_trade'>> & { r_multiple?: string; hints?: string[]; detectedText?: string } & OcrDebugState;
type NoTradeExtractSuggestions = Partial<Pick<NoTradeDayRow, 'day_date' | 'reason'>> & { hints?: string[]; detectedText?: string } & OcrDebugState;

export default function JournalApp({ userId, email, onSignOut }: Props) {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [tab, setTab] = useState<Tab>('dashboard');
  const [trades, setTrades] = useState<TradeRow[]>([]);
  const [noTrades, setNoTrades] = useState<NoTradeDayRow[]>([]);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [reviews, setReviews] = useState<WeeklyReviewRow[]>([]);
  const [settings, setSettings] = useState<SettingsRow | null>(null);
  const [attachments, setAttachments] = useState<AttachmentRow[]>([]);
  const [error, setError] = useState('');
  const [weekInput, setWeekInput] = useState(currentWeekInput());
  const [reviewAnswers, setReviewAnswers] = useState({ q1: '', q2: '', q3: '', q_paper: '' });
  const [detail, setDetail] = useState<DetailState>(null);
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({});
  const [addTradeFamily, setAddTradeFamily] = useState<string>('Bounce');
  const [addTradeModel, setAddTradeModel] = useState<string>(familyModels.Bounce[0]);
  const [addTradeClassification, setAddTradeClassification] = useState<TradeClassification>('Valid setup');
  const [openHelp, setOpenHelp] = useState<HelpKey | null>(null);
  const [editingTradeId, setEditingTradeId] = useState<string | null>(null);
  const [editingNoTradeId, setEditingNoTradeId] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<{ url: string; name: string } | null>(null);
  const [tradeExtract, setTradeExtract] = useState<TradeExtractSuggestions | null>(null);
  const [noTradeExtract, setNoTradeExtract] = useState<NoTradeExtractSuggestions | null>(null);
  const [noTradeDraft, setNoTradeDraft] = useState<{ day_date: string; reason: string; no_trade_mindset: NoTradeMindset; notes: string }>({ day_date: new Date().toISOString().slice(0, 10), reason: noTradeReasons[0], no_trade_mindset: noTradeMindsetOptions[0].value, notes: '' });
  const [dashboardPeriod, setDashboardPeriod] = useState<DashboardPeriod>('monthly');
  const [dashboardAnchor, setDashboardAnchor] = useState<Date>(() => new Date());
  const [dashboardTradeFilter, setDashboardTradeFilter] = useState<TradeTypeFilter>('live');
  const [historyEntryTypeFilter, setHistoryEntryTypeFilter] = useState<HistoryEntryTypeFilter>('all');
  const [historyDateFilter, setHistoryDateFilter] = useState<HistoryDateFilter>('all_time');
  const [historyDateStart, setHistoryDateStart] = useState(() => toDateInput(addDaysKey(new Date().toISOString().slice(0, 10), -29)));
  const [historyDateEnd, setHistoryDateEnd] = useState(() => toDateInput(new Date().toISOString().slice(0, 10)));
  const [reviewTradeFilter, setReviewTradeFilter] = useState<TradeTypeFilter>('live');
  const [tradeDraft, setTradeDraft] = useState<TradeDraft>(() => ({
    trade_date: new Date().toISOString().slice(0, 10),
    ticker: 'MES',
    classification: 'Valid setup',
    family: 'Bounce',
    model: familyModels.Bounce[0],
    pnl: '',
    r_multiple_whole: '2',
    r_multiple_decimal: '00',
    minutes_in_trade: '',
    emotional_pressure: '1',
    entry_emotion: entryEmotionOptions[0].value,
    in_trade_emotion: inTradeEmotionOptions[0].value,
    is_paper_trade: false,
    mistake_tags: [],
    notes: ''
  }));
  const [newInstrument, setNewInstrument] = useState('');
  const [newMistakeTag, setNewMistakeTag] = useState('');
  const [newCatalogMistakeTag, setNewCatalogMistakeTag] = useState('');
  const [mistakePickerOpen, setMistakePickerOpen] = useState(false);
  const [logMode, setLogMode] = useState<LogMode>('trade');
  const [tradeLogSubtype, setTradeLogSubtype] = useState<'live_trade' | 'paper_trade' | 'no_trade'>('live_trade');
  const [accountOpen, setAccountOpen] = useState(false);
  const [showAccountSettings, setShowAccountSettings] = useState(false);
  const [accountFirstName, setAccountFirstName] = useState('');
  const [accountLastName, setAccountLastName] = useState('');
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [sessionDraft, setSessionDraft] = useState<{ session_type: 'chart' | 'journal'; session_date: string; start_time: string; end_time: string; notes: string }>({
    session_type: 'chart',
    session_date: new Date().toISOString().slice(0, 10),
    start_time: SESSION_DEFAULT_TIMES.chart.start,
    end_time: SESSION_DEFAULT_TIMES.chart.end,
    notes: ''
  });
  const [sessionSubtypeView, setSessionSubtypeView] = useState<'pre_session_plan' | 'chart_session' | 'post_session_review'>('chart_session');
  const [pending, startTransition] = useTransition();
  const detailAnchors = useRef<Record<string, HTMLElement | null>>({});
  const [calendarView, setCalendarView] = useState<'month' | 'weekly'>('month');
  const [calendarMetric, setCalendarMetric] = useState<'pnl' | 'r'>('pnl');
  const [chartView, setChartView] = useState<'daily' | 'cumulative'>('daily');
  const [overlayR, setOverlayR] = useState(false);
  const [overlayTradeCount, setOverlayTradeCount] = useState(true);
  const [overlayChartTime, setOverlayChartTime] = useState(false);
  const [overlayJournalTime, setOverlayJournalTime] = useState(false);
  const [overlaySessionTime, setOverlaySessionTime] = useState(false);
  const [chartRightAxisMode, setChartRightAxisMode] = useState<'r' | 'trade_count' | 'chart_time' | 'journal_time' | 'session_time'>('trade_count');
  const [reviewSignedUrls, setReviewSignedUrls] = useState<Record<string, string>>({});
  const [reviewEntriesOpen, setReviewEntriesOpen] = useState(false);
  const [resetActivityOpen, setResetActivityOpen] = useState(false);
  const [resetConfirmText, setResetConfirmText] = useState('');
  const [resetStorageNotice, setResetStorageNotice] = useState('');
  const [exportScope, setExportScope] = useState<'all_time' | 'selected_period'>('all_time');

  useEffect(() => {
    const [first, last] = splitDisplayName(settings?.display_name || '', email);
    setAccountFirstName(first);
    setAccountLastName(last);
  }, [settings?.display_name, email]);

  useEffect(() => {
    if (logMode === 'trade') {
      setTradeLogSubtype(tradeDraft.is_paper_trade ? 'paper_trade' : 'live_trade');
      return;
    }
    if (logMode === 'no_trade') setTradeLogSubtype('no_trade');
  }, [logMode, tradeDraft.is_paper_trade]);

  useEffect(() => {
    void loadAll();
    // migration note for teams moving from local-only index.html:
    // export old localStorage JSON blobs and transform into inserts for trades/no_trade_days/weekly_reviews/settings/attachments.
  }, []);

  async function loadAll() {
    const [t, n, sessionResult, r, s, a] = await Promise.all([
      supabase.from('trades').select('*').order('trade_date', { ascending: false }),
      supabase.from('no_trade_days').select('*').order('day_date', { ascending: false }),
      supabase.from('sessions').select('*').order('session_date', { ascending: false }).order('created_at', { ascending: false }),
      supabase.from('weekly_reviews').select('*').order('week_key', { ascending: false }),
      supabase.from('user_settings').select('*').maybeSingle(),
      supabase.from('attachments').select('*').order('created_at', { ascending: false })
    ]);
    const errors = [t.error, n.error, sessionResult.error, r.error, s.error, a.error].filter(Boolean);
    const blocking = errors.find((entry) => !isRecoverableSchemaError(entry?.message || ''));
    if (blocking) {
      setError(normalizeSupabaseError(blocking.message));
      return;
    }
    if (errors.length) {
      console.warn('Recoverable Supabase load issue', errors);
      setError(normalizeSupabaseError(errors[0]?.message || 'Some data is temporarily unavailable.'));
    }
    const normalizedTrades = ((((t.data || []) as TradeRow[]) || []).map((trade) => ({
      ...trade,
      entry_emotion: resolveEntryEmotion(trade as TradeRow),
      in_trade_emotion: resolveInTradeEmotion(trade as TradeRow),
      is_paper_trade: Boolean((trade as TradeRow & { is_paper_trade?: unknown }).is_paper_trade),
      mistake_tags: normalizeMistakeTags((trade as TradeRow & { mistake_tags?: unknown }).mistake_tags)
    })));
    setTrades(normalizedTrades);
    const normalizedNoTrades = (((n.data || []) as NoTradeDayRow[]) || []).map((entry) => ({
      ...entry,
      no_trade_mindset: resolveNoTradeMindset(entry as NoTradeDayRow)
    }));
    setNoTrades(normalizedNoTrades);
    setSessions(((sessionResult.data || []) as SessionRow[]) || []);
    setReviews(((r.data || []) as WeeklyReviewRow[]) || []);
    const baseSettings = ((s.data as SettingsRow | null) ?? {
      user_id: userId,
      daily_reminder: true,
      weekly_reminder: true,
      default_risk: 200,
      chart_session_start_default: SESSION_DEFAULT_TIMES.chart.start,
      chart_session_end_default: SESSION_DEFAULT_TIMES.chart.end,
      journal_session_start_default: SESSION_DEFAULT_TIMES.journal.start,
      journal_session_end_default: SESSION_DEFAULT_TIMES.journal.end,
      display_name: 'JY',
      instruments: ['MES'],
      mistake_catalog: [...DEFAULT_MISTAKE_CATALOG],
      mistake_catalog_hidden: []
    });
    const rawInstruments = (baseSettings as { instruments?: unknown }).instruments;
    const normalizedInstruments = Array.isArray(rawInstruments)
      ? rawInstruments.map((item) => String(item ?? ''))
      : String(rawInstruments || '').split(',');
    const resolvedCatalog = resolveMistakeCatalogState(
      baseSettings.mistake_catalog,
      (baseSettings as { mistake_catalog_hidden?: unknown }).mistake_catalog_hidden,
      normalizedTrades.flatMap((trade) => normalizeMistakeTags(trade.mistake_tags))
    );
    const cachedSettings = readSettingsCache(userId);
    const cachedCatalog = cachedSettings
      ? resolveMistakeCatalogState(
        cachedSettings.mistake_catalog,
        cachedSettings.mistake_catalog_hidden,
        normalizedTrades.flatMap((trade) => normalizeMistakeTags(trade.mistake_tags))
      )
      : null;
    setSettings({
      ...baseSettings,
      display_name: normalizeTag(cachedSettings?.display_name || baseSettings.display_name),
      default_risk: Number(cachedSettings?.default_risk ?? baseSettings.default_risk ?? 0),
      chart_session_start_default: normalizeTimeInput(cachedSettings?.chart_session_start_default || baseSettings.chart_session_start_default || SESSION_DEFAULT_TIMES.chart.start),
      chart_session_end_default: normalizeTimeInput(cachedSettings?.chart_session_end_default || baseSettings.chart_session_end_default || SESSION_DEFAULT_TIMES.chart.end),
      journal_session_start_default: normalizeTimeInput(cachedSettings?.journal_session_start_default || baseSettings.journal_session_start_default || SESSION_DEFAULT_TIMES.journal.start),
      journal_session_end_default: normalizeTimeInput(cachedSettings?.journal_session_end_default || baseSettings.journal_session_end_default || SESSION_DEFAULT_TIMES.journal.end),
      daily_reminder: cachedSettings?.daily_reminder ?? baseSettings.daily_reminder,
      weekly_reminder: cachedSettings?.weekly_reminder ?? baseSettings.weekly_reminder,
      instruments: normalizeUniqueInstruments([...(cachedSettings?.instruments || []), ...normalizedInstruments]),
      mistake_catalog: cachedCatalog?.active || resolvedCatalog.active,
      mistake_catalog_hidden: cachedCatalog?.hidden || resolvedCatalog.hidden
    });
    setAttachments(((a.data || []) as AttachmentRow[]) || []);
  }

  const periodRange = dashboardPeriod === 'lifetime'
    ? getLifetimeRange(trades, noTrades, sessions, reviews)
    : getPeriodRange(dashboardPeriod, dashboardAnchor);
  const dashboardTrades = filterTradesByType(trades, dashboardTradeFilter);
  const lifetimeTrades = dashboardTrades;
  const lifetimeNoTrades = noTrades;
  const periodTrades = dashboardTrades.filter((t) => inDateRange(t.trade_date, periodRange.start, periodRange.end));
  const periodNoTrades = noTrades.filter((n) => inDateRange(n.day_date, periodRange.start, periodRange.end));
  const periodSessions = sessions.filter((s) => inDateRange(s.session_date, periodRange.start, periodRange.end));
  const periodSessionDays = new Set(periodSessions.map((session) => session.session_date)).size;
  const periodChartSessions = periodSessions.filter((s) => s.session_type === 'chart');
  const periodJournalSessions = periodSessions.filter((s) => s.session_type === 'journal');
  const periodChartMinutes = periodChartSessions.reduce((sum, s) => sum + Number(s.duration_minutes || 0), 0);
  const periodJournalMinutes = periodJournalSessions.reduce((sum, s) => sum + Number(s.duration_minutes || 0), 0);
  const lifetimeWins = lifetimeTrades.filter((t) => Number(t.pnl || 0) > 0).length;
  const lifetimeNetPnl = lifetimeTrades.reduce((sum, t) => sum + Number(t.pnl || 0), 0);
  const lifetimeWinRate = lifetimeTrades.length ? (lifetimeWins / lifetimeTrades.length) * 100 : 0;
  const periodNetPnl = periodTrades.reduce((sum, t) => sum + Number(t.pnl || 0), 0);
  const periodNetR = periodTrades.reduce((sum, t) => sum + Number(t.r_multiple || 0), 0);
  const periodWins = periodTrades.filter((t) => Number(t.pnl || 0) > 0).length;
  const winningTrades = periodTrades.filter((t) => Number(t.pnl || 0) > 0);
  const losingTrades = periodTrades.filter((t) => Number(t.pnl || 0) < 0);
  const avgHoldWinners = winningTrades.length ? winningTrades.reduce((sum, t) => sum + Number(t.minutes_in_trade || 0), 0) / winningTrades.length : 0;
  const avgHoldLosers = losingTrades.length ? losingTrades.reduce((sum, t) => sum + Number(t.minutes_in_trade || 0), 0) / losingTrades.length : 0;
  const avgWinnerResult = winningTrades.length ? winningTrades.reduce((sum, t) => sum + Number(t.pnl || 0), 0) / winningTrades.length : 0;
  const avgLoserResult = losingTrades.length ? losingTrades.reduce((sum, t) => sum + Number(t.pnl || 0), 0) / losingTrades.length : 0;
  const periodWinRate = periodTrades.length ? (periodWins / periodTrades.length) * 100 : 0;
  const periodAvgR = periodTrades.length ? periodTrades.reduce((sum, t) => sum + Number(t.r_multiple || 0), 0) / periodTrades.length : 0;
  const periodAvgEmotion = periodTrades.length ? periodTrades.reduce((sum, t) => sum + Number(t.emotional_pressure || 0), 0) / periodTrades.length : 0;
  const pressureBuckets = [1, 2, 3, 4, 5].map((level) => ({
    level,
    count: periodTrades.filter((t) => Number(t.emotional_pressure || 0) === level).length
  }));
  const highPressureTrades = periodTrades.filter((t) => Number(t.emotional_pressure || 0) >= 4);
  const lowPressureTrades = periodTrades.filter((t) => Number(t.emotional_pressure || 0) <= 2);
  const highPressureAvgPnl = highPressureTrades.length ? highPressureTrades.reduce((s, t) => s + Number(t.pnl || 0), 0) / highPressureTrades.length : 0;
  const lowPressureAvgPnl = lowPressureTrades.length ? lowPressureTrades.reduce((s, t) => s + Number(t.pnl || 0), 0) / lowPressureTrades.length : 0;
  const mistakeTagCounts = countItems(periodTrades.flatMap((t) => normalizeMistakeTags(t.mistake_tags)));
  const topMistakes = Object.entries(mistakeTagCounts).sort((a, b) => b[1] - a[1]).slice(0, 4);
  const familyStats = computeGroupStats(periodTrades, (t) => t.family);
  const modelStats = computeGroupStats(periodTrades, (t) => t.model);
  const bestFamily = familyStats.length ? familyStats[0] : null;
  const worstFamily = familyStats.length ? familyStats[familyStats.length - 1] : null;
  const bestModel = modelStats.length ? modelStats[0] : null;
  const worstModel = modelStats.length ? modelStats[modelStats.length - 1] : null;
  const topWinFamilies = [...familyStats].sort((a, b) => b.winRate - a.winRate).slice(0, 3);
  const topWinModels = [...modelStats].sort((a, b) => b.winRate - a.winRate).slice(0, 3);
  const periodExpectancyPnl = periodTrades.length ? periodNetPnl / periodTrades.length : 0;
  const periodExpectancyR = periodTrades.length ? periodNetR / periodTrades.length : 0;
  const allTimeStreaks = computeStreaks(dashboardTrades);
  const periodStreaks = computeStreaks(periodTrades);
  const mistakeImpact = computeMistakeImpact(periodTrades);
  const familyBreakdown = computePerformanceBreakdown(periodTrades, (trade) => trade.family);
  const modelBreakdown = computePerformanceBreakdown(periodTrades, (trade) => trade.model);
  const emotionBreakdown = computePerformanceBreakdown(
    periodTrades.filter((trade) => Number(trade.emotional_pressure || 0) >= 1 && Number(trade.emotional_pressure || 0) <= 5),
    (trade) => `Level ${Math.min(5, Math.max(1, Number(trade.emotional_pressure || 1)))}`
  );
  const emotionalInsight = getEmotionalInsight(periodTrades);
  const topMistakeDrags = mistakeImpact
    .filter((row) => row.trades >= 2)
    .sort((a, b) => a.avgPnl - b.avgPnl || a.avgR - b.avgR || a.netPnl - b.netPnl)
    .slice(0, 3);
  const strongestFamilyCallout = pickStrongestSetupCallout(familyBreakdown, 3);
  const strongestModelCallout = pickStrongestSetupCallout(modelBreakdown, 3);
  const multiTradeDayInsight = getMultiTradeDayInsight(periodTrades);
  const emotionCoachingNotes = getEmotionCoachingNotes(periodTrades);
  const sessionCoachingNote = getSessionCoachingNote(periodTrades, periodSessions);
  const coachingHelping = strongestFamilyCallout
    ? `Best edge this period: ${strongestFamilyCallout.key} (${strongestFamilyCallout.trades} trade${strongestFamilyCallout.trades === 1 ? '' : 's'}, ${strongestFamilyCallout.winRate.toFixed(0)}% win rate, ${strongestFamilyCallout.avgR.toFixed(2)}R avg).${strongestFamilyCallout.limited ? ' Early signal (small sample).' : ''}`
    : emotionCoachingNotes[0] || 'Not enough data to identify a stable edge yet.';
  const coachingHurting = topMistakeDrags.length
    ? `Largest drag: ${topMistakeDrags[0].key} (${topMistakeDrags[0].trades} tagged trade${topMistakeDrags[0].trades === 1 ? '' : 's'}, ${topMistakeDrags[0].avgPnl.toFixed(2)} avg P&L, ${topMistakeDrags[0].avgR.toFixed(2)}R avg).`
    : (emotionCoachingNotes[1] || 'No repeat mistake drag signal yet.');
  const coachingFocus = topMistakeDrags.length
    ? `Focus next: reduce ${topMistakeDrags[0].key} first, then track whether avg R improves over the next 5 trades.`
    : strongestFamilyCallout
      ? `Focus next: prioritize ${strongestFamilyCallout.key} setups and avoid forcing low-quality variants.`
      : 'Focus next: keep logging quality data so coaching signals can stabilize.';
  const calendarMonth = new Date(Date.UTC(dashboardAnchor.getUTCFullYear(), dashboardAnchor.getUTCMonth(), 1));
  const calendarCells = buildCalendarCells(calendarMonth, periodTrades, periodNoTrades);
  const calendarWeekRows = chunkCalendarWeeks(calendarCells);
  const chartBuckets = buildChartBuckets(periodRange.start, periodRange.end, periodTrades, periodNoTrades, periodSessions, dashboardPeriod);
  const periodHasActivity = periodTrades.length > 0 || periodNoTrades.length > 0 || periodSessions.length > 0;
  const selectedPeriodTakeaway = !periodTrades.length
    ? 'No trades in this selection. Use Jump to or Trade type to load a period with activity.'
    : periodNetPnl >= 0
      ? `Strongest setup edge: ${bestFamily ? `${bestFamily.key} (${bestFamily.netPnl.toFixed(2)}$)` : 'N/A'}.`
      : `Biggest drag: ${worstFamily ? `${worstFamily.key} (${worstFamily.netPnl.toFixed(2)}$)` : 'N/A'}.`;
  const periodJumpOptions = buildPeriodJumpOptions(dashboardPeriod, dashboardAnchor);
  const resolvedMistakeCatalog = resolveMistakeCatalogState(
    settings?.mistake_catalog,
    settings?.mistake_catalog_hidden,
    trades.flatMap((trade) => normalizeMistakeTags(trade.mistake_tags))
  );
  const activeMistakeCatalog = resolvedMistakeCatalog.active;
  const hiddenMistakeCatalog = resolvedMistakeCatalog.hidden;
  const instrumentOptions = normalizeUniqueInstruments([
    'MES',
    tradeDraft.ticker,
    ...(settings?.instruments || []),
    ...trades.map((t) => String(t.ticker || '').toUpperCase()).filter(Boolean)
  ]);
  const mistakeTagOptions = normalizeUniqueTags([
    ...activeMistakeCatalog,
    ...normalizeMistakeTags(tradeDraft.mistake_tags)
  ]);
  const activityItems = [
    ...trades.map((trade) => ({ type: 'trade' as const, date: trade.trade_date, id: trade.id, trade })),
    ...noTrades.map((noTrade) => ({ type: 'no_trade' as const, date: noTrade.day_date, id: noTrade.id, noTrade })),
    ...sessions.map((session) => ({ type: 'session' as const, date: session.session_date, id: session.id, session }))
  ].sort((a, b) => {
    const byDate = b.date.localeCompare(a.date);
    if (byDate !== 0) return byDate;
    const createdA = getTimelineCreatedAt(a);
    const createdB = getTimelineCreatedAt(b);
    if (createdA !== createdB) return createdB.localeCompare(createdA);
    return a.id.localeCompare(b.id);
  });
  const todayKey = new Date().toISOString().slice(0, 10);
  const historyDateRange = getHistoryDateRange(historyDateFilter, todayKey, historyDateStart, historyDateEnd);
  const filteredActivityItems = activityItems.filter((item) => {
    if (!inDateRange(item.date, historyDateRange.start, historyDateRange.end)) return false;

    if (historyEntryTypeFilter === 'all') {
      return true;
    }

    if (historyEntryTypeFilter === 'trade_all') return item.type === 'trade' || item.type === 'no_trade';
    if (historyEntryTypeFilter === 'session_all') return item.type === 'session';
    if (historyEntryTypeFilter === 'live_trade') return item.type === 'trade' && !isPaperTrade(item.trade);
    if (historyEntryTypeFilter === 'paper_trade') return item.type === 'trade' && isPaperTrade(item.trade);
    if (historyEntryTypeFilter === 'no_trade_day') return item.type === 'no_trade';
    if (historyEntryTypeFilter === 'pre_session_plan') return item.type === 'session' && item.session.session_type === 'chart';
    if (historyEntryTypeFilter === 'chart_session') return item.type === 'session' && item.session.session_type === 'chart';
    if (historyEntryTypeFilter === 'post_session_review') return item.type === 'session' && item.session.session_type === 'journal';
    return false;
  });
  const historyDateScopeLabel = historyDateFilter === 'all_time'
    ? 'All time'
    : historyDateFilter === 'this_month'
      ? 'This month'
      : historyDateFilter === 'last_30_days'
        ? 'Last 30 days'
        : `Custom ${historyDateRange.start} → ${historyDateRange.end}`;

  const historyEntryFilterLabel = historyEntryTypeFilter === 'all'
    ? 'All entries'
    : historyEntryTypeFilter === 'trade_all'
      ? 'Trade (all)'
      : historyEntryTypeFilter === 'session_all'
        ? 'Session (all)'
        : historyEntryTypeFilter === 'live_trade'
          ? 'Live trade'
          : historyEntryTypeFilter === 'paper_trade'
            ? 'Paper trade'
            : historyEntryTypeFilter === 'no_trade_day'
              ? 'No-trade day'
              : historyEntryTypeFilter === 'pre_session_plan'
                ? 'Pre-session plan'
                : historyEntryTypeFilter === 'chart_session'
                  ? 'Chart session'
                  : 'Post-session review';

  const selectedWeekKey = weekKeyFromInput(weekInput);
  const weekTrades = trades.filter((t) => weekKeyFromDate(t.trade_date) === selectedWeekKey);
  const weekLiveTrades = weekTrades.filter((t) => !isPaperTrade(t));
  const weekPaperTrades = weekTrades.filter((t) => isPaperTrade(t));
  const weekTradesForReview = filterTradesByType(weekTrades, reviewTradeFilter);
  const selectedReviewEndKey = addDaysKey(selectedWeekKey, 6);
  const selectedReviewRangeLabel = `${formatDateShort(selectedWeekKey)} – ${formatDateShort(selectedReviewEndKey)}`;
  const weekNoTrades = noTrades.filter((n) => weekKeyFromDate(n.day_date) === selectedWeekKey);
  const weekSessions = sessions.filter((s) => weekKeyFromDate(s.session_date) === selectedWeekKey);
  const reviewRow = reviews.find((r) => r.week_key === selectedWeekKey);
  const latestChartSession = sessions.find((session) => session.session_type === 'chart');
  const latestJournalSession = sessions.find((session) => session.session_type === 'journal');

  useEffect(() => {
    setReviewAnswers({ q1: reviewRow?.q1 || '', q2: reviewRow?.q2 || '', q3: reviewRow?.q3 || '', q_paper: reviewRow?.q_paper || '' });
  }, [reviewRow?.id, selectedWeekKey]);

  useEffect(() => {
    if (tab !== 'review') return;
    const paths = attachments
      .filter((a) =>
        weekTradesForReview.some((t) => t.id === a.trade_id)
        || weekNoTrades.some((n) => n.id === a.no_trade_day_id)
        || weekSessions.some((s) => s.id === a.session_id))
      .map((a) => a.file_path);
    if (!paths.length) {
      setReviewSignedUrls({});
      return;
    }
    void supabase.storage.from('attachments').createSignedUrls(paths, 60 * 60).then(({ data, error: signError }) => {
      if (signError) {
        console.warn('Review attachment sign error', signError);
        setReviewSignedUrls({});
        return;
      }
      const next: Record<string, string> = {};
      (data || []).forEach((item, idx) => {
        if (item?.signedUrl) next[paths[idx]] = item.signedUrl;
      });
      setReviewSignedUrls(next);
    });
  }, [tab, selectedWeekKey, attachments, weekTradesForReview, weekNoTrades, weekSessions, supabase]);

  async function addTrade(formData: FormData) {
    setError('');
    const family = tradeDraft.family || 'Bounce';
    const classification = tradeDraft.classification;
    const isInvalid = forcedInvalidClassifications.includes(classification);
    const payload = {
      user_id: userId,
      trade_date: tradeDraft.trade_date || new Date().toISOString().slice(0, 10),
      ticker: String(tradeDraft.ticker || '').toUpperCase(),
      family: isInvalid ? NA_FAMILY : family,
      model: isInvalid ? NA_MODEL : String(tradeDraft.model || familyModels[family][0]),
      classification,
      pnl: Number(tradeDraft.pnl || 0),
      r_multiple: buildRMultipleValue(tradeDraft.r_multiple_whole, tradeDraft.r_multiple_decimal),
      minutes_in_trade: Number(tradeDraft.minutes_in_trade || 0),
      emotional_pressure: Math.min(5, Math.max(1, Number(tradeDraft.emotional_pressure || 1))),
      entry_emotion: normalizeEntryEmotion(tradeDraft.entry_emotion),
      in_trade_emotion: normalizeInTradeEmotion(tradeDraft.in_trade_emotion),
      is_paper_trade: Boolean(tradeDraft.is_paper_trade),
      mistake_tags: normalizeMistakeTags(tradeDraft.mistake_tags),
      notes: String(tradeDraft.notes || '')
    };

    const tradeResult = editingTradeId
      ? await supabase.from('trades').update(payload).eq('id', editingTradeId).select('*').single()
      : await supabase.from('trades').insert(payload).select('*').single();
    const { data, error: upsertError } = tradeResult;
    if (upsertError) {
      setError(normalizeSupabaseError(upsertError.message));
      return;
    }

    if (settings) {
      await saveSettings({
        ...settings,
        instruments: normalizeUniqueInstruments([...(settings.instruments || []), payload.ticker]),
        mistake_catalog: normalizeActiveMistakeCatalog([...(settings.mistake_catalog || []), ...payload.mistake_tags], settings.mistake_catalog_hidden),
        mistake_catalog_hidden: settings.mistake_catalog_hidden || []
      });
    }

    const files = formData.getAll('files') as File[];
    for (const file of files) {
      if (!file || file.size === 0) continue;
      const filePath = `${userId}/${data.id}/${crypto.randomUUID()}_${file.name}`;
      const { error: uploadError } = await supabase.storage.from('attachments').upload(filePath, file, { upsert: false });
      if (uploadError) {
        setError(normalizeSupabaseError(uploadError.message));
        continue;
      }
      await supabase.from('attachments').insert({
        user_id: userId,
        trade_id: data.id,
        no_trade_day_id: null,
        session_id: null,
        file_path: filePath,
        file_name: file.name,
        mime_type: file.type || 'application/octet-stream',
        byte_size: file.size
      });
    }

    await loadAll();
    resetTradeDraft();
    setTab('history');
  }

  async function addNoTrade(formData: FormData) {
    const payload = {
      user_id: userId,
      day_date: noTradeDraft.day_date || new Date().toISOString().slice(0, 10),
      reason: noTradeDraft.reason || 'No A+ setup',
      no_trade_mindset: normalizeNoTradeMindset(noTradeDraft.no_trade_mindset),
      notes: String(noTradeDraft.notes || '')
    };
    const upsert = editingNoTradeId
      ? await supabase.from('no_trade_days').update(payload).eq('id', editingNoTradeId).select('*').single()
      : await supabase.from('no_trade_days').insert(payload).select('*').single();
    const { data, error: insertError } = upsert;
    if (insertError) {
      setError(normalizeSupabaseError(insertError.message));
      return;
    }

    const files = formData.getAll('no_trade_files') as File[];
    for (const file of files) {
      if (!file || file.size === 0) continue;
      const filePath = `${userId}/no-trade/${data.id}/${crypto.randomUUID()}_${file.name}`;
      const { error: uploadError } = await supabase.storage.from('attachments').upload(filePath, file, { upsert: false });
      if (uploadError) {
        setError(normalizeSupabaseError(uploadError.message));
        continue;
      }
      await supabase.from('attachments').insert({
        user_id: userId,
        trade_id: null,
        no_trade_day_id: data.id,
        session_id: null,
        file_path: filePath,
        file_name: file.name,
        mime_type: file.type || 'application/octet-stream',
        byte_size: file.size
      });
    }

    await loadAll();
    setNoTradeDraft({ day_date: new Date().toISOString().slice(0, 10), reason: noTradeReasons[0], no_trade_mindset: noTradeMindsetOptions[0].value, notes: '' });
    setNoTradeExtract(null);
    setEditingNoTradeId(null);
    setTab('history');
  }

  function applySessionDefaults(type: 'chart' | 'journal') {
    const start = normalizeTimeInput(type === 'chart' ? settings?.chart_session_start_default : settings?.journal_session_start_default || '');
    const end = normalizeTimeInput(type === 'chart' ? settings?.chart_session_end_default : settings?.journal_session_end_default || '');
    setSessionDraft((prev) => ({
      ...prev,
      session_type: type,
      start_time: start || SESSION_DEFAULT_TIMES[type].start,
      end_time: end || SESSION_DEFAULT_TIMES[type].end
    }));
  }

  async function addSession(formData: FormData) {
    const duration = calculateDurationMinutes(sessionDraft.start_time, sessionDraft.end_time);
    const payload = {
      user_id: userId,
      session_type: sessionDraft.session_type,
      session_date: sessionDraft.session_date || new Date().toISOString().slice(0, 10),
      start_time: sessionDraft.start_time,
      end_time: sessionDraft.end_time,
      duration_minutes: duration,
      notes: sessionDraft.notes || ''
    };
    const response = editingSessionId
      ? await supabase.from('sessions').update(payload).eq('id', editingSessionId).select('*').single()
      : await supabase.from('sessions').insert(payload).select('*').single();
    if (response.error) {
      setError(normalizeSupabaseError(response.error.message));
      return;
    }

    const sessionRow = response.data as SessionRow;
    const files = formData.getAll('session_files') as File[];
    for (const file of files) {
      if (!file || file.size === 0) continue;
      const filePath = `${userId}/session/${sessionRow.id}/${crypto.randomUUID()}_${file.name}`;
      const { error: uploadError } = await supabase.storage.from('attachments').upload(filePath, file, { upsert: false });
      if (uploadError) {
        setError(normalizeSupabaseError(uploadError.message));
        continue;
      }
      await supabase.from('attachments').insert({
        user_id: userId,
        trade_id: null,
        no_trade_day_id: null,
        session_id: sessionRow.id,
        file_path: filePath,
        file_name: file.name,
        mime_type: file.type || 'application/octet-stream',
        byte_size: file.size
      });
    }
    setSessionDraft({
      session_type: 'chart',
      session_date: new Date().toISOString().slice(0, 10),
      start_time: normalizeTimeInput(settings?.chart_session_start_default || '') || SESSION_DEFAULT_TIMES.chart.start,
      end_time: normalizeTimeInput(settings?.chart_session_end_default || '') || SESSION_DEFAULT_TIMES.chart.end,
      notes: ''
    });
    setEditingSessionId(null);
    await loadAll();
    setTab('history');
  }

  async function saveReview() {
    const payload = { user_id: userId, week_key: selectedWeekKey, ...reviewAnswers };
    const { error: upsertError } = await supabase
      .from('weekly_reviews')
      .upsert(payload, { onConflict: 'user_id,week_key' });
    if (!upsertError) {
      await loadAll();
      return;
    }
    if (!isWeeklyReviewPaperSchemaMismatch(upsertError.message)) {
      setError(normalizeSupabaseError(upsertError.message));
      return;
    }
    const fallbackPayload = { user_id: userId, week_key: selectedWeekKey, q1: reviewAnswers.q1, q2: reviewAnswers.q2, q3: reviewAnswers.q3 };
    const { error: fallbackError } = await supabase
      .from('weekly_reviews')
      .upsert(fallbackPayload, { onConflict: 'user_id,week_key' });
    if (fallbackError) {
      setError(normalizeSupabaseError(fallbackError.message));
      return;
    }
    await loadAll();
  }

  async function saveSettings(next: SettingsRow) {
    const payload: SettingsRow = {
      ...next,
      chart_session_start_default: normalizeTimeInput(next.chart_session_start_default) || SESSION_DEFAULT_TIMES.chart.start,
      chart_session_end_default: normalizeTimeInput(next.chart_session_end_default) || SESSION_DEFAULT_TIMES.chart.end,
      journal_session_start_default: normalizeTimeInput(next.journal_session_start_default) || SESSION_DEFAULT_TIMES.journal.start,
      journal_session_end_default: normalizeTimeInput(next.journal_session_end_default) || SESSION_DEFAULT_TIMES.journal.end,
      instruments: normalizeUniqueInstruments(next.instruments || []),
      mistake_catalog: normalizeActiveMistakeCatalog(next.mistake_catalog, next.mistake_catalog_hidden),
      mistake_catalog_hidden: normalizeHiddenMistakeCatalog(next.mistake_catalog_hidden, next.mistake_catalog)
    };
    const { error: upsertError } = await supabase.from('user_settings').upsert(payload, { onConflict: 'user_id' });
    if (!upsertError) {
      setSettings(payload);
      writeSettingsCache(payload);
      return;
    }
    if (!isSettingsCatalogSchemaMismatch(upsertError.message)) {
      setError(normalizeSupabaseError(upsertError.message));
      return;
    }
    const fallbackPayload = {
      user_id: payload.user_id,
      daily_reminder: payload.daily_reminder,
      weekly_reminder: payload.weekly_reminder,
      default_risk: payload.default_risk,
      display_name: payload.display_name
    };
    const { error: fallbackError } = await supabase.from('user_settings').upsert(fallbackPayload, { onConflict: 'user_id' });
    if (fallbackError) {
      setError(normalizeSupabaseError(fallbackError.message));
      return;
    }
    setSettings(payload);
    writeSettingsCache(payload);
  }

  function resetTradeDraft() {
    setEditingTradeId(null);
    setAddTradeClassification('Valid setup');
    setAddTradeFamily('Bounce');
    setAddTradeModel(familyModels.Bounce[0]);
    setTradeDraft({
      trade_date: new Date().toISOString().slice(0, 10),
      ticker: 'MES',
      classification: 'Valid setup',
      family: 'Bounce',
      model: familyModels.Bounce[0],
      pnl: '',
      r_multiple_whole: '2',
      r_multiple_decimal: '00',
      minutes_in_trade: '',
      emotional_pressure: '1',
      entry_emotion: entryEmotionOptions[0].value,
    in_trade_emotion: inTradeEmotionOptions[0].value,
      is_paper_trade: false,
      mistake_tags: [],
      notes: ''
    });
    setTradeExtract(null);
    setMistakePickerOpen(false);
    setTradeLogSubtype('live_trade');
  }

  function startEditTrade(trade: TradeRow) {
    setEditingTradeId(trade.id);
    setEditingNoTradeId(null);
    setTab('log');
    setLogMode('trade');
    setAddTradeClassification(trade.classification);
    setAddTradeFamily(trade.family);
    setAddTradeModel(trade.model);
    setTradeDraft({
      trade_date: trade.trade_date,
      ticker: trade.ticker,
      classification: trade.classification,
      family: trade.family,
      model: trade.model,
      pnl: String(trade.pnl ?? ''),
      ...parseRMultipleToParts(trade.r_multiple),
      minutes_in_trade: String(trade.minutes_in_trade ?? ''),
      emotional_pressure: String(trade.emotional_pressure ?? 1),
      entry_emotion: resolveEntryEmotion(trade as TradeRow),
      in_trade_emotion: resolveInTradeEmotion(trade as TradeRow),
      is_paper_trade: Boolean(trade.is_paper_trade),
      mistake_tags: normalizeMistakeTags(trade.mistake_tags),
      notes: trade.notes || ''
    });
    setMistakePickerOpen(false);
    setTradeLogSubtype(Boolean(trade.is_paper_trade) ? 'paper_trade' : 'live_trade');
  }

  function startEditNoTrade(noTrade: NoTradeDayRow) {
    setEditingNoTradeId(noTrade.id);
    setNoTradeDraft({ day_date: noTrade.day_date, reason: noTrade.reason, no_trade_mindset: resolveNoTradeMindset(noTrade), notes: noTrade.notes || '' });
    setTradeLogSubtype('no_trade');
    setTab('log');
    setLogMode('no_trade');
  }

  async function deleteTrade(tradeId: string) {
    if (!window.confirm('Delete this trade? This cannot be undone.')) return;
    const linked = attachments.filter((a) => a.trade_id === tradeId);
    if (linked.length) {
      const paths = linked.map((a) => a.file_path);
      await supabase.storage.from('attachments').remove(paths);
    }
    const { error: deleteError } = await supabase.from('trades').delete().eq('id', tradeId);
    if (deleteError) {
      setError(normalizeSupabaseError(deleteError.message));
      return;
    }
    if (detail?.kind === 'trade' && detail.id === tradeId) setDetail(null);
    await loadAll();
  }

  async function deleteNoTrade(noTradeId: string) {
    if (!window.confirm('Delete this no-trade day? This cannot be undone.')) return;
    const linked = attachments.filter((a) => a.no_trade_day_id === noTradeId);
    if (linked.length) {
      await supabase.storage.from('attachments').remove(linked.map((a) => a.file_path));
    }
    const { error: deleteError } = await supabase.from('no_trade_days').delete().eq('id', noTradeId);
    if (deleteError) {
      setError(normalizeSupabaseError(deleteError.message));
      return;
    }
    if (detail?.kind === 'no_trade' && detail.id === noTradeId) setDetail(null);
    if (editingNoTradeId === noTradeId) {
      setEditingNoTradeId(null);
      setNoTradeDraft({ day_date: new Date().toISOString().slice(0, 10), reason: noTradeReasons[0], no_trade_mindset: noTradeMindsetOptions[0].value, notes: '' });
    }
    await loadAll();
  }

  async function deleteSession(sessionId: string) {
    if (!window.confirm('Delete this session?')) return;
    const linked = attachments.filter((a) => a.session_id === sessionId);
    if (linked.length) {
      await supabase.storage.from('attachments').remove(linked.map((a) => a.file_path));
    }
    const { error: deleteError } = await supabase.from('sessions').delete().eq('id', sessionId);
    if (deleteError) {
      setError(normalizeSupabaseError(deleteError.message));
      return;
    }
    if (detail?.kind === 'session' && detail.id === sessionId) setDetail(null);
    await loadAll();
  }

  async function removeSessionAttachment(attachmentId: string) {
    const target = attachments.find((a) => a.id === attachmentId);
    if (!target) return;
    const { error: deleteRowError } = await supabase.from('attachments').delete().eq('id', attachmentId);
    if (deleteRowError) {
      setError(normalizeSupabaseError(deleteRowError.message));
      return;
    }
    const { error: removeStorageError } = await supabase.storage.from('attachments').remove([target.file_path]);
    if (removeStorageError) {
      setError(`Attachment record was removed, but storage cleanup failed for ${target.file_name}. Remove ${target.file_path} manually from bucket "attachments".`);
    }
    await loadAll();
  }

  async function openEntryDetail(nextDetail: DetailState) {
    if (!nextDetail) return;
    setDetail(nextDetail);
    setError('');
    requestAnimationFrame(() => {
      const key = `${nextDetail.kind}:${nextDetail.id}`;
      detailAnchors.current[key]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });

    const linkedAttachments =
      nextDetail.kind === 'trade'
        ? attachments.filter((a) => a.trade_id === nextDetail.id)
        : nextDetail.kind === 'no_trade'
          ? attachments.filter((a) => a.no_trade_day_id === nextDetail.id)
          : attachments.filter((a) => a.session_id === nextDetail.id);

    if (!linkedAttachments.length) {
      setSignedUrls({});
      return;
    }

    const filePaths = linkedAttachments.map((a) => a.file_path);
    const { data, error: signError } = await supabase.storage.from('attachments').createSignedUrls(filePaths, 60 * 60);
    if (signError) {
      setError(normalizeSupabaseError(signError.message));
      setSignedUrls({});
      return;
    }

    const nextUrls: Record<string, string> = {};
    (data || []).forEach((item, idx) => {
      if (item?.signedUrl) nextUrls[filePaths[idx]] = item.signedUrl;
    });
    setSignedUrls(nextUrls);
  }

  function onChangeClassification(value: string) {
    const next = value as TradeClassification;
    setAddTradeClassification(next);
    setTradeDraft((prev) => ({ ...prev, classification: next }));
    if (forcedInvalidClassifications.includes(next)) {
      setAddTradeFamily(NA_FAMILY);
      setAddTradeModel(NA_MODEL);
      setTradeDraft((prev) => ({ ...prev, family: NA_FAMILY, model: NA_MODEL }));
    }
  }

  async function resetActivityData() {
    const requiredText = 'RESET';
    if (resetConfirmText.trim().toUpperCase() !== requiredText) {
      setError(`Type ${requiredText} to confirm activity reset.`);
      return;
    }
    const approved = window.confirm(
      `Reset activity data for current user only?\n\nUser: ${email || userId}\n\nThis will permanently delete trades, no-trade days, sessions, weekly reviews, and attachment records/files for this account.`
    );
    if (!approved) return;
    setError('');
    setResetStorageNotice('');
    const attachmentPaths = attachments
      .filter((file) => file.user_id === userId && file.file_path)
      .map((file) => file.file_path);
    const storageFailures: string[] = [];
    if (attachmentPaths.length) {
      for (let i = 0; i < attachmentPaths.length; i += 50) {
        const batch = attachmentPaths.slice(i, i + 50);
        const { error: removeError } = await supabase.storage.from('attachments').remove(batch);
        if (removeError) storageFailures.push(removeError.message);
      }
    }
    const { error: attachmentDeleteError } = await supabase.from('attachments').delete().eq('user_id', userId);
    if (attachmentDeleteError) {
      setError(normalizeSupabaseError(attachmentDeleteError.message));
      return;
    }
    const { error: tradeDeleteError } = await supabase.from('trades').delete().eq('user_id', userId);
    if (tradeDeleteError) {
      setError(normalizeSupabaseError(tradeDeleteError.message));
      return;
    }
    const { error: noTradeDeleteError } = await supabase.from('no_trade_days').delete().eq('user_id', userId);
    if (noTradeDeleteError) {
      setError(normalizeSupabaseError(noTradeDeleteError.message));
      return;
    }
    const { error: sessionsDeleteError } = await supabase.from('sessions').delete().eq('user_id', userId);
    if (sessionsDeleteError) {
      setError(normalizeSupabaseError(sessionsDeleteError.message));
      return;
    }
    const { error: reviewsDeleteError } = await supabase.from('weekly_reviews').delete().eq('user_id', userId);
    if (reviewsDeleteError) {
      setError(normalizeSupabaseError(reviewsDeleteError.message));
      return;
    }
    setTrades([]);
    setNoTrades([]);
    setSessions([]);
    setReviews([]);
    setAttachments([]);
    setDetail(null);
    setSignedUrls({});
    setReviewSignedUrls({});
    setReviewEntriesOpen(false);
    setEditingTradeId(null);
    setEditingNoTradeId(null);
    setEditingSessionId(null);
    setResetConfirmText('');
    setResetActivityOpen(false);
    if (storageFailures.length) {
      setResetStorageNotice(`Activity rows were cleared, but some storage files could not be deleted automatically. Check Supabase Storage bucket "attachments" under prefix ${userId}/ and remove leftovers manually.`);
    }
  }

  function getExportCollections(scope: 'all_time' | 'selected_period') {
    if (scope === 'all_time') {
      return {
        exportTrades: trades,
        exportNoTrades: noTrades,
        exportSessions: sessions,
        exportReviews: reviews,
        exportAttachments: attachments
      };
    }
    const rangeStart = periodRange.start;
    const rangeEnd = periodRange.end;
    const exportTrades = trades.filter((trade) => inDateRange(trade.trade_date, rangeStart, rangeEnd));
    const exportNoTrades = noTrades.filter((day) => inDateRange(day.day_date, rangeStart, rangeEnd));
    const exportSessions = sessions.filter((session) => inDateRange(session.session_date, rangeStart, rangeEnd));
    const exportReviews = reviews.filter((review) => inDateRange(review.week_key, rangeStart, rangeEnd));
    const tradeIds = new Set(exportTrades.map((trade) => trade.id));
    const noTradeIds = new Set(exportNoTrades.map((day) => day.id));
    const sessionIds = new Set(exportSessions.map((session) => session.id));
    const exportAttachments = attachments.filter((file) => (
      (file.trade_id && tradeIds.has(file.trade_id))
      || (file.no_trade_day_id && noTradeIds.has(file.no_trade_day_id))
      || (file.session_id && sessionIds.has(file.session_id))
    ));
    return { exportTrades, exportNoTrades, exportSessions, exportReviews, exportAttachments };
  }

  function downloadExportJson(scope: 'all_time' | 'selected_period') {
    const { exportTrades, exportNoTrades, exportSessions, exportReviews, exportAttachments } = getExportCollections(scope);
    const payload = {
      exported_at: new Date().toISOString(),
      user_id: userId,
      email: email || null,
      scope,
      selected_period: scope === 'selected_period' ? { start: periodRange.start, end: periodRange.end, period_type: dashboardPeriod } : null,
      includes: {
        trades: exportTrades.length,
        no_trade_days: exportNoTrades.length,
        sessions: exportSessions.length,
        weekly_reviews: exportReviews.length,
        attachments: exportAttachments.length
      },
      notes: [
        'Attachment binaries are not included in this export.',
        'Attachment metadata includes file_path and linked row IDs for manual backup/restore workflows.'
      ],
      trades: exportTrades,
      no_trade_days: exportNoTrades,
      sessions: exportSessions,
      weekly_reviews: exportReviews,
      attachments: exportAttachments
    };
    const stamp = new Date().toISOString().slice(0, 10);
    downloadTextFile(`journal_export_${scope}_${stamp}.json`, JSON.stringify(payload, null, 2), 'application/json');
  }

  function downloadExportCsv(scope: 'all_time' | 'selected_period') {
    const { exportTrades, exportNoTrades, exportSessions, exportReviews, exportAttachments } = getExportCollections(scope);
    const rows: Record<string, string | number | null | undefined>[] = [
      ...exportTrades.map((trade) => ({
        record_type: 'trade',
        date: trade.trade_date,
        ticker: trade.ticker,
        family: trade.family,
        model: trade.model,
        classification: trade.classification,
        result_usd: Number(trade.pnl || 0),
        r_multiple: Number(trade.r_multiple || 0),
        emotional_pressure: trade.emotional_pressure ?? '',
        entry_emotion: resolveEntryEmotion(trade),
        in_trade_emotion: resolveInTradeEmotion(trade),
        no_trade_mindset: '',
        mistake_tags: normalizeMistakeTags(trade.mistake_tags).join('|'),
        trade_mode: isPaperTrade(trade) ? 'paper' : 'live',
        no_trade_reason: '',
        session_type: '',
        session_duration_minutes: '',
        review_week_key: '',
        review_q1: '',
        review_q2: '',
        review_q3: '',
        review_q_paper: '',
        attachment_file_name: '',
        attachment_file_path: '',
        attachment_mime_type: '',
        attachment_byte_size: '',
        notes: trade.notes || ''
      })),
      ...exportNoTrades.map((entry) => ({
        record_type: 'no_trade_day',
        date: entry.day_date,
        ticker: '',
        family: '',
        model: '',
        classification: '',
        result_usd: '',
        r_multiple: '',
        emotional_pressure: '',
        no_trade_mindset: resolveNoTradeMindset(entry as NoTradeDayRow),
        mistake_tags: '',
        trade_mode: '',
        no_trade_reason: entry.reason,
        session_type: '',
        session_duration_minutes: '',
        review_week_key: '',
        review_q1: '',
        review_q2: '',
        review_q3: '',
        review_q_paper: '',
        attachment_file_name: '',
        attachment_file_path: '',
        attachment_mime_type: '',
        attachment_byte_size: '',
        notes: entry.notes || ''
      })),
      ...exportSessions.map((session) => ({
        record_type: 'session',
        date: session.session_date,
        ticker: '',
        family: '',
        model: '',
        classification: '',
        result_usd: '',
        r_multiple: '',
        emotional_pressure: '',
        entry_emotion: '',
        in_trade_emotion: '',
        no_trade_mindset: '',
        mistake_tags: '',
        trade_mode: '',
        no_trade_reason: '',
        session_type: session.session_type,
        session_duration_minutes: Number(session.duration_minutes || 0),
        review_week_key: '',
        review_q1: '',
        review_q2: '',
        review_q3: '',
        review_q_paper: '',
        attachment_file_name: '',
        attachment_file_path: '',
        attachment_mime_type: '',
        attachment_byte_size: '',
        notes: session.notes || ''
      })),
      ...exportReviews.map((review) => ({
        record_type: 'weekly_review',
        date: review.week_key,
        ticker: '',
        family: '',
        model: '',
        classification: '',
        result_usd: '',
        r_multiple: '',
        emotional_pressure: '',
        entry_emotion: '',
        in_trade_emotion: '',
        no_trade_mindset: '',
        mistake_tags: '',
        trade_mode: '',
        no_trade_reason: '',
        session_type: '',
        session_duration_minutes: '',
        review_week_key: review.week_key,
        review_q1: review.q1 || '',
        review_q2: review.q2 || '',
        review_q3: review.q3 || '',
        review_q_paper: review.q_paper || '',
        attachment_file_name: '',
        attachment_file_path: '',
        attachment_mime_type: '',
        attachment_byte_size: '',
        notes: ''
      })),
      ...exportAttachments.map((file) => ({
        record_type: 'attachment_metadata',
        date: '',
        ticker: '',
        family: '',
        model: '',
        classification: '',
        result_usd: '',
        r_multiple: '',
        emotional_pressure: '',
        entry_emotion: '',
        in_trade_emotion: '',
        no_trade_mindset: '',
        mistake_tags: '',
        trade_mode: '',
        no_trade_reason: '',
        session_type: '',
        session_duration_minutes: '',
        review_week_key: '',
        review_q1: '',
        review_q2: '',
        review_q3: '',
        review_q_paper: '',
        attachment_file_name: file.file_name,
        attachment_file_path: file.file_path,
        attachment_mime_type: file.mime_type,
        attachment_byte_size: Number(file.byte_size || 0),
        notes: `linked_trade_id:${file.trade_id || ''};linked_no_trade_day_id:${file.no_trade_day_id || ''};linked_session_id:${file.session_id || ''}`
      }))
    ];
    const csv = recordsToCsv(rows);
    const stamp = new Date().toISOString().slice(0, 10);
    downloadTextFile(`journal_export_${scope}_${stamp}.csv`, csv, 'text/csv;charset=utf-8');
  }

  function onChangeFamily(value: string) {
    setAddTradeFamily(value);
    const options = familyModels[value] || [NA_MODEL];
    const resolvedModel = options.includes(addTradeModel) ? addTradeModel : options[0];
    setAddTradeModel(resolvedModel);
    setTradeDraft((prev) => ({ ...prev, family: value, model: resolvedModel }));
  }

  async function runTradeExtraction(files: File[]) {
    setTradeExtract({ ocrStatus: 'idle', ocrSteps: ['Waiting for extraction request...'] });
    const next = await extractTradeSuggestions(files, (debug) => {
      setTradeExtract((prev) => ({ ...(prev || {}), ...debug }));
    });
    setTradeExtract(next || null);
  }

  async function runNoTradeExtraction(files: File[]) {
    setNoTradeExtract({ ocrStatus: 'idle', ocrSteps: ['Waiting for extraction request...'] });
    const next = await extractNoTradeSuggestions(files, (debug) => {
      setNoTradeExtract((prev) => ({ ...(prev || {}), ...debug }));
    });
    setNoTradeExtract(next || null);
  }

  function applyTradeSuggestion(key: keyof TradeExtractSuggestions, value: string) {
    if (key === 'ticker') {
      const normalizedTicker = normalizeInstrument(String(value || ''));
      setTradeDraft((prev) => ({ ...prev, ticker: normalizedTicker }));
      if (normalizedTicker && settings) {
        void saveSettings({ ...settings, instruments: normalizeUniqueInstruments([...(settings.instruments || []), normalizedTicker]) });
      }
    } else if (key === 'r_multiple') {
      const parts = parseRMultipleToParts(value);
      setTradeDraft((prev) => ({ ...prev, ...parts }));
    } else if (key === 'trade_date' || key === 'pnl' || key === 'minutes_in_trade') {
      setTradeDraft((prev) => ({ ...prev, [key]: value }));
    } else {
      return;
    }
    setTradeExtract((prev) => {
      if (!prev) return prev;
      const next = { ...prev };
      delete (next as Record<string, unknown>)[key];
      return next;
    });
  }

  function rejectTradeSuggestion(key: keyof TradeExtractSuggestions) {
    setTradeExtract((prev) => {
      if (!prev) return prev;
      const next = { ...prev };
      delete (next as Record<string, unknown>)[key];
      return next;
    });
  }

  function applyNoTradeSuggestion<K extends 'day_date' | 'reason'>(key: K, value: string) {
    setNoTradeDraft((prev) => ({ ...prev, [key]: value }));
    setNoTradeExtract((prev) => {
      if (!prev) return prev;
      const next = { ...prev };
      delete (next as Record<string, unknown>)[key];
      return next;
    });
  }

  function rejectNoTradeSuggestion(key: keyof NoTradeExtractSuggestions) {
    setNoTradeExtract((prev) => {
      if (!prev) return prev;
      const next = { ...prev };
      delete (next as Record<string, unknown>)[key];
      return next;
    });
  }

  const reviewStatus = `${selectedWeekKey === currentWeekKey() ? 'Current week' : 'Past week'} • ${reviewRow ? 'Saved review' : 'Unsaved draft for selected week'}`;
  const classificationLocksSetup = forcedInvalidClassifications.includes(addTradeClassification);
  const activeHelpItems: readonly HelpItem[] = openHelp ? helpDefinitions[openHelp] : [];
  const initials = buildInitials(accountFirstName, accountLastName, email);
  const logType: LogType = logMode === 'session' ? 'session' : 'trade_log';

  return (
    <main className="app">
      <header className="header">
        <div>
          <div className="sub">JY Trading Journal</div>
          <h1>Own your process.<br />Build consistency.</h1>
        </div>
        <div className="stack" style={{ alignItems: 'flex-end' }}>
          <button
            className="inline account-avatar"
            type="button"
            aria-expanded={accountOpen}
            onClick={() => setAccountOpen((open) => !open)}
          >
            {initials}
          </button>
        </div>
      </header>
      {accountOpen ? <button className="account-backdrop" aria-label="Close account menu" type="button" onClick={() => setAccountOpen(false)} /> : null}
      {accountOpen && (
        <section className="card stack account-flyout" style={{ marginTop: -6 }}>
          <div className="row">
            <strong>Account</strong>
            <span className="badge">{initials}</span>
          </div>
          <div className="small muted">Signed in as {email || '—'}</div>
          <div className="small muted">Profile name: {[accountFirstName, accountLastName].join(' ').trim() || 'Not set'}</div>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <button className="inline" type="button" onClick={() => { setShowAccountSettings(true); setAccountOpen(false); }}>Settings</button>
            <button className="inline" type="button" onClick={() => void onSignOut()}>Sign out</button>
          </div>
        </section>
      )}
      {showAccountSettings && settings && (
        <section className="card stack settings-root">
          <div className="row">
            <strong>Account settings</strong>
            <button className="inline" type="button" onClick={() => setShowAccountSettings(false)}>Close</button>
          </div>
          <article className="trade stack">
            <strong>Profile & account</strong>
            <div className="small muted">Used for avatar initials and profile display.</div>
            <label className="small muted" htmlFor="account-first-name">First name</label>
            <input id="account-first-name" placeholder="First name" value={accountFirstName} onChange={(e) => setAccountFirstName(e.target.value)} />
            <label className="small muted" htmlFor="account-last-name">Last name</label>
            <input id="account-last-name" placeholder="Last name" value={accountLastName} onChange={(e) => setAccountLastName(e.target.value)} />
            <label className="small muted" htmlFor="account-email">Email</label>
            <input id="account-email" value={email || ''} disabled />
          </article>
          <article className="trade stack">
            <strong>Session defaults</strong>
            <div className="small muted">Used to prefill session logging times. You can still override in Log.</div>
            <div className="grid settings-session-time-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
              <div className="stack">
                <label className="small muted" htmlFor="settings-chart-start">Chart session start</label>
                <input className="settings-session-time-control" id="settings-chart-start" type="time" value={normalizeTimeInput(settings.chart_session_start_default) || SESSION_DEFAULT_TIMES.chart.start} onChange={(e) => setSettings({ ...settings, chart_session_start_default: e.target.value })} />
              </div>
              <div className="stack">
                <label className="small muted" htmlFor="settings-chart-end">Chart session end</label>
                <input className="settings-session-time-control" id="settings-chart-end" type="time" value={normalizeTimeInput(settings.chart_session_end_default) || SESSION_DEFAULT_TIMES.chart.end} onChange={(e) => setSettings({ ...settings, chart_session_end_default: e.target.value })} />
              </div>
            </div>
            <div className="grid settings-session-time-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
              <div className="stack">
                <label className="small muted" htmlFor="settings-journal-start">Journal session start</label>
                <input className="settings-session-time-control" id="settings-journal-start" type="time" value={normalizeTimeInput(settings.journal_session_start_default) || SESSION_DEFAULT_TIMES.journal.start} onChange={(e) => setSettings({ ...settings, journal_session_start_default: e.target.value })} />
              </div>
              <div className="stack">
                <label className="small muted" htmlFor="settings-journal-end">Journal session end</label>
                <input className="settings-session-time-control" id="settings-journal-end" type="time" value={normalizeTimeInput(settings.journal_session_end_default) || SESSION_DEFAULT_TIMES.journal.end} onChange={(e) => setSettings({ ...settings, journal_session_end_default: e.target.value })} />
              </div>
            </div>
          </article>
          <article className="trade stack">
            <div className="row">
              <strong>Mistake catalog</strong>
              <span className="small muted">{activeMistakeCatalog.length} active</span>
            </div>
            <div className="small muted">Active mistakes are shown in Log → Trade selection. Hidden items stay out of pickers but remain on existing records.</div>
            <div className="stack">
              {activeMistakeCatalog.length ? activeMistakeCatalog.map((tag) => (
                <div key={`active-${tag}`} className="row" style={{ gap: 8 }}>
                  <span className="badge">{tag}</span>
                  <button
                    className="inline"
                    type="button"
                    onClick={() => {
                      const nextActive = activeMistakeCatalog.filter((item) => item !== tag);
                      const nextHidden = normalizeHiddenMistakeCatalog([...(settings.mistake_catalog_hidden || []), tag], nextActive);
                      void saveSettings({ ...settings, mistake_catalog: nextActive, mistake_catalog_hidden: nextHidden });
                    }}
                  >
                    Hide
                  </button>
                </div>
              )) : <div className="small muted">No active mistakes yet.</div>}
            </div>
            <div className="row">
              <input placeholder="Add mistake category" value={newCatalogMistakeTag} onChange={(e) => setNewCatalogMistakeTag(e.target.value)} />
              <button
                className="inline"
                type="button"
                onClick={() => {
                  const next = normalizeTag(newCatalogMistakeTag);
                  if (!next) return;
                  const nextActive = normalizeActiveMistakeCatalog([...(settings.mistake_catalog || []), next], settings.mistake_catalog_hidden);
                  const nextHidden = normalizeHiddenMistakeCatalog((settings.mistake_catalog_hidden || []).filter((item) => item !== next), nextActive);
                  void saveSettings({ ...settings, mistake_catalog: nextActive, mistake_catalog_hidden: nextHidden });
                  setNewCatalogMistakeTag('');
                }}
              >
                Add
              </button>
            </div>
            {hiddenMistakeCatalog.length ? (
              <details>
                <summary className="small muted">Hidden mistakes ({hiddenMistakeCatalog.length})</summary>
                <div className="stack" style={{ marginTop: 8 }}>
                  {hiddenMistakeCatalog.map((tag) => (
                    <div key={`hidden-${tag}`} className="row" style={{ gap: 8 }}>
                      <span className="badge">{tag}</span>
                      <button
                        className="inline"
                        type="button"
                        onClick={() => {
                          const nextActive = normalizeActiveMistakeCatalog([...(settings.mistake_catalog || []), tag], settings.mistake_catalog_hidden);
                          const nextHidden = normalizeHiddenMistakeCatalog((settings.mistake_catalog_hidden || []).filter((item) => item !== tag), nextActive);
                          void saveSettings({ ...settings, mistake_catalog: nextActive, mistake_catalog_hidden: nextHidden });
                        }}
                      >
                        Restore
                      </button>
                    </div>
                  ))}
                </div>
              </details>
            ) : null}
          </article>
          <article className="trade stack">
            <strong>About</strong>
            <div className="small muted">Version <span className="badge">{APP_VERSION}</span></div>
          </article>
          <article className="trade stack">
            <strong>Account actions</strong>
            <div className="small muted">Saving updates profile and settings above. Sign out ends the current session on this device.</div>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <button
                className="inline"
                type="button"
                onClick={() => {
                  const nextDisplay = [accountFirstName, accountLastName].join(' ').trim() || settings.display_name;
                  void saveSettings({ ...settings, display_name: nextDisplay });
                }}
              >
                Save settings
              </button>
              <button className="inline" type="button" onClick={() => void onSignOut()}>Sign out</button>
            </div>
          </article>
          <article className="trade stack danger-zone">
            <div className="row">
              <strong>Clean start (activity reset)</strong>
              <span className="badge">Current user only</span>
            </div>
            <div className="small muted">
              Use this when preparing a clean go-live account. This removes activity data only for <strong>{email || userId}</strong>.
            </div>
            <div className="small muted">
              Deletes: trades, no-trade days, sessions, weekly reviews, and attachment records + storage file cleanup attempts.
            </div>
            <div className="small muted">
              Preserves: auth identity, profile name, instrument catalog, and active/hidden mistake catalog.
            </div>
            <button className="inline danger-button" type="button" onClick={() => setResetActivityOpen((open) => !open)}>
              {resetActivityOpen ? 'Cancel reset' : 'Reset activity data'}
            </button>
            {resetActivityOpen ? (
              <div className="stack reset-panel">
                <label className="small muted" htmlFor="reset-confirm">
                  Type <strong>RESET</strong> to confirm permanent deletion for this signed-in user.
                </label>
                <input
                  id="reset-confirm"
                  placeholder="Type RESET"
                  value={resetConfirmText}
                  onChange={(e) => setResetConfirmText(e.target.value)}
                />
                <button className="danger-button" type="button" onClick={() => void resetActivityData()}>
                  Confirm clean start
                </button>
                <div className="small muted">If storage file deletion is partially blocked, you will see a manual cleanup message.</div>
              </div>
            ) : null}
            {resetStorageNotice ? <div className="small">{resetStorageNotice}</div> : null}
            <details>
              <summary className="small muted">Post-reset smoke test checklist</summary>
              <div className="stack small muted" style={{ marginTop: 8 }}>
                <div>1) Log one live trade and one paper trade in Log → Trade.</div>
                <div>2) Log one no-trade day and one session.</div>
                <div>3) Save one weekly review in Review tab.</div>
                <div>4) Upload one attachment on a trade/no-trade entry.</div>
                <div>5) Verify Dashboard/History/Review each show the new items correctly.</div>
              </div>
            </details>
          </article>
          <article className="trade stack">
            <div className="row">
              <strong>Backup & export</strong>
              <span className="badge">Current user only</span>
            </div>
            <div className="small muted">Export includes journal activity for <strong>{email || userId}</strong>. Choose scope, then download CSV (spreadsheet) or JSON (full-fidelity backup).</div>
            <div style={{ maxWidth: 280 }}>
              <label className="small muted" htmlFor="export-scope">Export scope</label>
              <select id="export-scope" value={exportScope} onChange={(e) => setExportScope(e.target.value as 'all_time' | 'selected_period')}>
                <option value="all_time">All time</option>
                <option value="selected_period">Selected dashboard period</option>
              </select>
            </div>
            {exportScope === 'selected_period' ? (
              <div className="small muted">Selected period: {formatPeriodLabel(dashboardPeriod, dashboardAnchor, periodRange.start, periodRange.end)}</div>
            ) : (
              <div className="small muted">All-time export includes all rows visible to this signed-in user.</div>
            )}
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <button className="inline" type="button" onClick={() => downloadExportCsv(exportScope)}>Export CSV</button>
              <button className="inline" type="button" onClick={() => downloadExportJson(exportScope)}>Export JSON</button>
            </div>
            <div className="small muted">
              Included data types: trades, no-trade days, sessions, weekly reviews, and attachment metadata.
            </div>
            <div className="small muted">
              Attachments: file binaries are not bundled in CSV/JSON. Export includes file metadata + storage paths only; private attachment access behavior is unchanged.
            </div>
          </article>
        </section>
      )}

      {tab === 'dashboard' && (
        <section className="stack">
          <section className="card stack dashboard-controls control-card">
            <div className="dashboard-controls-grid">
              <div className="dashboard-control-item">
                <label className="small muted" htmlFor="period-type">Period type</label>
                <select id="period-type" value={dashboardPeriod} onChange={(e) => setDashboardPeriod(e.target.value as DashboardPeriod)}>
                  <option value="weekly">Week</option>
                  <option value="monthly">Month</option>
                  <option value="quarterly">Quarter</option>
                  <option value="annual">Year</option>
                  <option value="ytd">YTD</option>
                  <option value="lifetime">All time (lifetime)</option>
                </select>
              </div>
              <div className="dashboard-control-item">
                <label className="small muted">Jump to</label>
                <select
                  value={periodJumpOptions.selected}
                  onChange={(e) => {
                    const next = periodJumpOptions.options.find((opt) => opt.value === e.target.value);
                    if (next) setDashboardAnchor(next.anchor);
                  }}
                >
                  {periodJumpOptions.options.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </div>
              <div className="dashboard-control-item">
                <label className="small muted" htmlFor="dashboard-trade-filter">Trade type</label>
                <select id="dashboard-trade-filter" value={dashboardTradeFilter} onChange={(e) => setDashboardTradeFilter(e.target.value as TradeTypeFilter)}>
                  <option value="all">All</option>
                  <option value="live">Live only</option>
                  <option value="paper">Paper only</option>
                </select>
              </div>
            </div>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <button className="inline" type="button" onClick={() => setDashboardAnchor(shiftPeriod(dashboardAnchor, dashboardPeriod, -1))}>Prev</button>
              <button className="inline" type="button" onClick={() => setDashboardAnchor(new Date())}>Today</button>
              <button className="inline" type="button" onClick={() => setDashboardAnchor(shiftPeriod(dashboardAnchor, dashboardPeriod, 1))}>Next</button>
            </div>
            {!periodHasActivity ? (
              <div className="small muted dashboard-empty-state">No trades, no-trade days, or sessions match this period/filter yet.</div>
            ) : null}
          </section>
          <div className="small muted" style={{ letterSpacing: '.08em', textTransform: 'uppercase' }}>Snapshot</div>
          <section className="card stack">
            <strong>Lifetime snapshot (by trade type)</strong>
            <div className="small muted">Scope: trade type filter only.</div>
            <div className="grid">
              <article className="trade"><div className="muted small">Trades</div><div>{lifetimeTrades.length}</div></article>
              <article className="trade"><div className="muted small">Net P&L</div><div style={{ color: lifetimeNetPnl >= 0 ? '#4ad66d' : '#ff6b6b' }}>{lifetimeNetPnl.toFixed(2)}</div></article>
              <article className="trade"><div className="muted small">Win rate</div><div style={{ color: lifetimeWinRate >= 50 ? '#4ad66d' : '#ff6b6b' }}>{lifetimeWinRate.toFixed(1)}%</div></article>
              <article className="trade"><div className="muted small">No-trade days</div><div>{lifetimeNoTrades.length}</div></article>
            </div>
          </section>

          <section className="card stack">
            <strong>Performance (by trade type & period)</strong>
            <div className="small muted">Scope: trade type filter + selected period.</div>
            <div className="grid">
              <article className="trade"><div className="muted small">Net P&L</div><div style={{ color: periodNetPnl >= 0 ? '#4ad66d' : '#ff6b6b' }}>{periodNetPnl.toFixed(2)}</div></article>
              <article className="trade"><div className="muted small">Net R</div><div style={{ color: periodNetR >= 0 ? '#4ad66d' : '#ff6b6b' }}>{periodNetR.toFixed(2)}R</div></article>
              <article className="trade"><div className="muted small">Win rate</div><div style={{ color: periodWinRate >= 50 ? '#4ad66d' : '#ff6b6b' }}>{periodWinRate.toFixed(1)}%</div></article>
              <article className="trade"><div className="muted small">Avg R / trade</div><div style={{ color: periodAvgR >= 0 ? '#4ad66d' : '#ff6b6b' }}>{periodAvgR.toFixed(2)}R</div></article>
              <article className="trade"><div className="muted small">Avg hold time (winners)</div><div>{winningTrades.length ? formatMinutesLabel(Math.round(avgHoldWinners)) : '—'}</div></article>
              <article className="trade"><div className="muted small">Avg hold time (losers)</div><div>{losingTrades.length ? formatMinutesLabel(Math.round(avgHoldLosers)) : '—'}</div></article>
              <article className="trade"><div className="muted small">Expectancy / trade ($)</div><div style={{ color: periodExpectancyPnl >= 0 ? '#4ad66d' : '#ff6b6b' }}>{periodExpectancyPnl.toFixed(2)}</div></article>
              <article className="trade"><div className="muted small">Expectancy / trade (R)</div><div style={{ color: periodExpectancyR >= 0 ? '#4ad66d' : '#ff6b6b' }}>{periodExpectancyR.toFixed(2)}R</div></article>
              <article className="trade"><div className="muted small">Average winner result</div><div style={{ color: '#4ad66d' }}>{avgWinnerResult.toFixed(2)}</div></article>
              <article className="trade"><div className="muted small">Average loser result</div><div style={{ color: '#ff6b6b' }}>{avgLoserResult.toFixed(2)}</div></article>
            </div>
          </section>

          <section className="card stack">
            <strong>Activity & process (by trade type & period)</strong>
            <div className="small muted">Scope: trade type filter + selected period.</div>
            <div className="grid">
              <article className="trade"><div className="muted small">Trades</div><div>{periodTrades.length}</div></article>
              <article className="trade"><div className="muted small">No-trade days</div><div>{periodNoTrades.length}</div></article>
              <article className="trade">
                <div className="muted small">Journal sessions</div>
                <div>{formatMinutesLabel(periodJournalMinutes)}</div>
                <div className="small muted">Avg {formatMinutesLabel(periodJournalSessions.length ? Math.round(periodJournalMinutes / periodJournalSessions.length) : 0)} / session</div>
                <div className="small muted">{periodJournalSessions.length} {periodJournalSessions.length === 1 ? 'session' : 'sessions'}</div>
              </article>
              <article className="trade">
                <div className="muted small">Chart sessions</div>
                <div>{formatMinutesLabel(periodChartMinutes)}</div>
                <div className="small muted">Avg {formatMinutesLabel(periodChartSessions.length ? Math.round(periodChartMinutes / periodChartSessions.length) : 0)} / session</div>
                <div className="small muted">{periodChartSessions.length} {periodChartSessions.length === 1 ? 'session' : 'sessions'}</div>
              </article>
              <article className="trade">
                <div className="muted small">Session days</div>
                <div>{periodSessionDays}</div>
                <div className="small muted">Unique dates with at least one session</div>
              </article>
              <article className="trade"><div className="muted small">Avg emotional pressure</div><div>{periodAvgEmotion.toFixed(2)} / 5</div></article>
            </div>
          </section>

          <section className="card stack control-card">
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <strong>Performance chart</strong>
              <select value={chartView} onChange={(e) => setChartView(e.target.value as 'daily' | 'cumulative')} style={{ width: 'auto', maxWidth: 140 }}>
                <option value="daily">Daily</option>
                <option value="cumulative">Cumulative</option>
              </select>
            </div>
            <div className="chart-overlay-controls">
              <span className="small muted">Overlays</span>
              <button className="inline" type="button" onClick={() => setOverlayR((v) => !v)} style={overlayR ? { background: '#1f7446', borderColor: '#32915a', color: '#eafbf0', width: 'auto' } : { width: 'auto' }}>
                {overlayR ? '✓ ' : ''}R line
              </button>
              <button className="inline" type="button" onClick={() => setOverlayTradeCount((v) => !v)} style={overlayTradeCount ? { background: '#1f7446', borderColor: '#32915a', color: '#eafbf0', width: 'auto' } : { width: 'auto' }}>
                {overlayTradeCount ? '✓ ' : ''}Trade count
              </button>
              <button className="inline" type="button" onClick={() => setOverlayChartTime((v) => !v)} style={overlayChartTime ? { background: '#1f7446', borderColor: '#32915a', color: '#eafbf0', width: 'auto' } : { width: 'auto' }}>
                {overlayChartTime ? '✓ ' : ''}Chart time
              </button>
              <button className="inline" type="button" onClick={() => setOverlayJournalTime((v) => !v)} style={overlayJournalTime ? { background: '#1f7446', borderColor: '#32915a', color: '#eafbf0', width: 'auto' } : { width: 'auto' }}>
                {overlayJournalTime ? '✓ ' : ''}Journal time
              </button>
              <button className="inline" type="button" onClick={() => setOverlaySessionTime((v) => !v)} style={overlaySessionTime ? { background: '#1f7446', borderColor: '#32915a', color: '#eafbf0', width: 'auto' } : { width: 'auto' }}>
                {overlaySessionTime ? '✓ ' : ''}Total session time
              </button>
            </div>
            {(overlayR || overlayTradeCount || overlayChartTime || overlayJournalTime || overlaySessionTime) ? (
              <div className="stack" style={{ gap: 6 }}>
                <div className="small muted">Right axis focus</div>
                <div className="row" style={{ gap: 6, flexWrap: 'wrap', justifyContent: 'flex-start' }}>
                  <button className="inline" type="button" style={chartRightAxisMode === 'r' ? { background: '#1f7446', borderColor: '#32915a', color: '#eafbf0' } : undefined} onClick={() => setChartRightAxisMode('r')}>R</button>
                  <button className="inline" type="button" style={chartRightAxisMode === 'trade_count' ? { background: '#1f7446', borderColor: '#32915a', color: '#eafbf0' } : undefined} onClick={() => setChartRightAxisMode('trade_count')}>Trade count</button>
                  <button className="inline" type="button" style={chartRightAxisMode === 'chart_time' ? { background: '#1f7446', borderColor: '#32915a', color: '#eafbf0' } : undefined} onClick={() => setChartRightAxisMode('chart_time')}>Chart time</button>
                  <button className="inline" type="button" style={chartRightAxisMode === 'journal_time' ? { background: '#1f7446', borderColor: '#32915a', color: '#eafbf0' } : undefined} onClick={() => setChartRightAxisMode('journal_time')}>Journal time</button>
                  <button className="inline" type="button" style={chartRightAxisMode === 'session_time' ? { background: '#1f7446', borderColor: '#32915a', color: '#eafbf0' } : undefined} onClick={() => setChartRightAxisMode('session_time')}>Total time</button>
                </div>
              </div>
            ) : null}
            {!periodTrades.length ? <div className="small muted">No trades for the selected period + trade type filter.</div> : null}
            <PerformanceChart
              points={chartBuckets}
              view={chartView}
              showROverlay={overlayR}
              showTradeCountOverlay={overlayTradeCount}
              showChartTimeOverlay={overlayChartTime}
              showJournalTimeOverlay={overlayJournalTime}
              showSessionTimeOverlay={overlaySessionTime}
              rightAxisMode={chartRightAxisMode}
            />
          </section>

          <section className="card stack control-card">
            <strong>{dashboardPeriod === 'monthly' ? 'Calendar month view' : 'Context calendar (anchor month)'}</strong>
            <div className="row calendar-toggle-row" style={{ justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
              <div className="stack" style={{ gap: 6, width: 'auto' }}>
                <div className="small muted">Range view</div>
                <div className="row" style={{ gap: 6, width: 'auto' }}>
                  <button className="inline" type="button" style={calendarView === 'month' ? { background: '#1f7446', borderColor: '#32915a', color: '#eafbf0' } : undefined} onClick={() => setCalendarView('month')}>{calendarView === 'month' ? '✓ ' : ''}Month</button>
                  <button className="inline" type="button" style={calendarView === 'weekly' ? { background: '#1f7446', borderColor: '#32915a', color: '#eafbf0' } : undefined} onClick={() => setCalendarView('weekly')}>{calendarView === 'weekly' ? '✓ ' : ''}Weekly</button>
                </div>
              </div>
              <div className="stack" style={{ gap: 6, width: 'auto' }}>
                <div className="small muted">Calendar metric</div>
                <div className="row" style={{ gap: 6, width: 'auto' }}>
                  <button className="inline" type="button" style={calendarMetric === 'pnl' ? { background: '#1f7446', borderColor: '#32915a', color: '#eafbf0' } : undefined} onClick={() => setCalendarMetric('pnl')}>{calendarMetric === 'pnl' ? '✓ ' : ''}$</button>
                  <button className="inline" type="button" style={calendarMetric === 'r' ? { background: '#1f7446', borderColor: '#32915a', color: '#eafbf0' } : undefined} onClick={() => setCalendarMetric('r')}>{calendarMetric === 'r' ? '✓ ' : ''}R</button>
                </div>
              </div>
            </div>
            <div className="small muted">Cell colors: green = positive, red = negative, gray = explicit no-trade, neutral = blank day.</div>
            <div className="small muted">
              {dashboardPeriod === 'monthly'
                ? calendarMonth.toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' })
                : `Showing ${calendarMonth.toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' })} only as context. Metrics above use ${periodTypeLabel(dashboardPeriod)}.`}
            </div>
            {calendarView === 'month' ? (
              <div className="calendar-grid">
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => <div key={d} className="small muted" style={{ textAlign: 'center' }}>{d}</div>)}
                {calendarCells.map((cell) => {
                  const metricValue = calendarMetric === 'pnl' ? cell.pnl : cell.rTotal;
                  const calendarCellTone = cell.isOutside
                    ? 'calendar-cell-outside'
                    : metricValue > 0
                      ? 'calendar-cell-positive'
                      : metricValue < 0
                        ? 'calendar-cell-negative'
                        : cell.noTrade
                          ? 'calendar-cell-no-trade'
                          : 'calendar-cell-blank';
                  return (
                    <article key={cell.date} className={`trade calendar-cell ${calendarCellTone}`}>
                      <div className="small muted calendar-day-label">{cell.day}</div>
                      {cell.tradeCount > 0 ? <div className="small calendar-main-metric">{calendarMetric === 'pnl' ? `$${cell.pnl.toFixed(0)}` : `${cell.rTotal.toFixed(1)}R`}</div> : null}
                      {cell.tradeCount > 0 ? <div className="small muted">T{cell.tradeCount}</div> : null}
                      {cell.noTrade ? <div className="small muted">NT</div> : null}
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="stack">
                {calendarWeekRows.map((week) => {
                  const start = week[0];
                  const end = week[week.length - 1];
                  const total = week.reduce((sum, day) => sum + (calendarMetric === 'pnl' ? day.pnl : day.rTotal), 0);
                  const tradeCount = week.reduce((sum, day) => sum + day.tradeCount, 0);
                  const noTradeCount = week.filter((day) => day.noTrade).length;
                  return (
                    <article key={start.date} className="trade">
                      <div className="row">
                        <strong>{formatShortDate(start.date)} – {formatShortDate(end.date)}</strong>
                        <span style={{ color: total >= 0 ? '#4ad66d' : '#ff6b6b' }}>{calendarMetric === 'pnl' ? `$${total.toFixed(2)}` : `${total.toFixed(2)}R`}</span>
                      </div>
                      <div className="small muted">{tradeCount} trade(s){noTradeCount ? ` · ${noTradeCount} no-trade day(s)` : ''}</div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>

          <div className="small muted" style={{ letterSpacing: '.08em', textTransform: 'uppercase' }}>Coaching</div>
          <section className="card stack">
            <strong>Coaching summary</strong>
            <article className="trade" style={{ borderColor: '#4f6ea6', background: 'rgba(44,78,140,0.14)' }}>
              <div className="small muted">Primary takeaway</div>
              <div className="small">{selectedPeriodTakeaway}</div>
            </article>
            <article className="trade">
              <div className="small muted">What is helping most?</div>
              <div className="small">{coachingHelping}</div>
            </article>
            <article className="trade">
              <div className="small muted">What is hurting most?</div>
              <div className="small">{coachingHurting}</div>
            </article>
            <article className="trade">
              <div className="small muted">What to focus on next?</div>
              <div className="small">{coachingFocus}</div>
            </article>
            {multiTradeDayInsight ? <div className="small muted">{multiTradeDayInsight}</div> : null}
          </section>

          <div className="small muted" style={{ letterSpacing: '.08em', textTransform: 'uppercase' }}>Detailed breakdowns & diagnostics</div>
          <details className="card stack">
            <summary className="small" style={{ cursor: 'pointer' }}><strong>Top 3 mistake drags</strong></summary>
            {topMistakeDrags.length ? (
              <div className="stack">
                {topMistakeDrags.map((row, idx) => (
                  <article key={`mistake-drag-${row.key}`} className="trade">
                    <div className="row">
                      <strong>#{idx + 1} {row.key}</strong>
                      <span className="small muted">{row.trades} tagged trade(s)</span>
                    </div>
                    <div className="small muted">Avg P&L: <span style={{ color: row.avgPnl >= 0 ? '#4ad66d' : '#ff6b6b' }}>{row.avgPnl.toFixed(2)}</span> · Avg R: <span style={{ color: row.avgR >= 0 ? '#4ad66d' : '#ff6b6b' }}>{row.avgR.toFixed(2)}R</span> · Win rate: {row.winRate.toFixed(1)}%</div>
                  </article>
                ))}
              </div>
            ) : <div className="small muted">Need at least two tagged trades per mistake to rank drag reliably (small sample right now).</div>}
          </details>

          <details className="card stack">
            <summary className="small" style={{ cursor: 'pointer' }}><strong>Best edge callouts</strong></summary>
            <article className="trade">
              <div className="small muted">Strongest setup family</div>
              <div>{strongestFamilyCallout ? `${strongestFamilyCallout.key} · ${strongestFamilyCallout.trades} trades · ${strongestFamilyCallout.winRate.toFixed(0)}% win rate · ${strongestFamilyCallout.avgR.toFixed(2)}R avg` : 'Not enough setup family samples yet.'}</div>
              {strongestFamilyCallout?.limited ? <div className="small muted">Early signal only (small sample).</div> : null}
            </article>
            <article className="trade">
              <div className="small muted">Strongest setup model</div>
              <div>{strongestModelCallout ? `${strongestModelCallout.key} · ${strongestModelCallout.trades} trades · ${strongestModelCallout.winRate.toFixed(0)}% win rate · ${strongestModelCallout.avgR.toFixed(2)}R avg` : 'Not enough setup model samples yet.'}</div>
              {strongestModelCallout?.limited ? <div className="small muted">Early signal only (small sample).</div> : null}
            </article>
          </details>

          <details className="card stack">
            <summary className="small" style={{ cursor: 'pointer' }}><strong>Emotional pressure coaching</strong></summary>
            {emotionCoachingNotes.length ? emotionCoachingNotes.map((line) => <div key={line} className="small muted">• {line}</div>) : <div className="small muted">Need a larger spread of pressure levels before drawing a coaching signal.</div>}
          </details>

          <details className="card stack">
            <summary className="small" style={{ cursor: 'pointer' }}><strong>Session habit coaching</strong></summary>
            <div className="small muted">{sessionCoachingNote || 'Log more sessions and trades in this period to unlock session-vs-outcome coaching.'}</div>
          </details>

          <details className="card stack">
            <summary className="small" style={{ cursor: 'pointer' }}><strong>Selected period insights</strong></summary>
            <div className="small muted"><strong>Mistakes:</strong> {topMistakes.length ? topMistakes.map(([tag, count]) => `${tag} (${count})`).join(', ') : 'None logged'}</div>
            <div className="small muted"><strong>Setup edge:</strong> Best family {bestFamily ? `${bestFamily.key} (${bestFamily.netPnl.toFixed(2)}$)` : 'N/A'} · Best model {bestModel ? `${bestModel.key} (${bestModel.netPnl.toFixed(2)}$)` : 'N/A'}</div>
            <div className="small muted"><strong>Setup drag:</strong> Worst family {worstFamily ? `${worstFamily.key} (${worstFamily.netPnl.toFixed(2)}$)` : 'N/A'} · Worst model {worstModel ? `${worstModel.key} (${worstModel.netPnl.toFixed(2)}$)` : 'N/A'}</div>
            <div className="small muted"><strong>Win-rate leaders:</strong> Families {topWinFamilies.length ? topWinFamilies.map((x) => `${x.key} (${x.winRate.toFixed(0)}%)`).join(', ') : 'N/A'} · Models {topWinModels.length ? topWinModels.map((x) => `${x.key} (${x.winRate.toFixed(0)}%)`).join(', ') : 'N/A'}</div>
            <div className="small muted"><strong>Pressure mix:</strong> {pressureBuckets.map((b) => `${b.level}:${b.count}`).join(' · ')}</div>
            <div className="small muted"><strong>Pressure impact:</strong> High (4-5) avg P&L <span style={{ color: highPressureAvgPnl >= 0 ? '#4ad66d' : '#ff6b6b' }}>{highPressureAvgPnl.toFixed(2)}</span> · Low (1-2) avg P&L <span style={{ color: lowPressureAvgPnl >= 0 ? '#4ad66d' : '#ff6b6b' }}>{lowPressureAvgPnl.toFixed(2)}</span></div>
          </details>

          <details className="card stack">
            <summary className="small" style={{ cursor: 'pointer' }}><strong>Intelligence insights</strong> <span className="muted">· diagnostics by selected period</span></summary>
            <div className="small muted">Based on {periodTrades.length} trade(s) in selected period</div>

            <details>
              <summary className="small" style={{ cursor: 'pointer' }}><strong>Mistake impact</strong> <span className="muted">· behavior cost profile</span></summary>
              {mistakeImpact.length ? (
                <div className="stack" style={{ marginTop: 8 }}>
                  {mistakeImpact.map((row) => (
                    <article key={row.key} className="trade">
                      <div className="row">
                        <strong>{row.key}</strong>
                        <span className="small muted">{row.trades} trade(s)</span>
                      </div>
                      {!activeMistakeCatalog.includes(row.key) ? <div className="small muted">Legacy tag (not in active catalog)</div> : null}
                      <div className="small muted">Avg P&L: <span style={{ color: row.avgPnl >= 0 ? '#4ad66d' : '#ff6b6b' }}>{row.avgPnl.toFixed(2)}</span> · Avg R: <span style={{ color: row.avgR >= 0 ? '#4ad66d' : '#ff6b6b' }}>{row.avgR.toFixed(2)}R</span> · Win rate: {row.winRate.toFixed(1)}%</div>
                    </article>
                  ))}
                </div>
              ) : <div className="small muted" style={{ marginTop: 8 }}>No mistake tags logged in this period.</div>}
            </details>

            <details>
              <summary className="small" style={{ cursor: 'pointer' }}><strong>Setup performance breakdown</strong> <span className="muted">· where edge is strongest</span></summary>
              <div className="stack" style={{ marginTop: 8 }}>
                <div className="small muted"><strong>By setup family</strong></div>
                {familyBreakdown.length ? familyBreakdown.map((row) => (
                  <article key={row.key} className="trade">
                    <div className="row">
                      <strong>{row.key}</strong>
                      <span className="small muted">{row.trades} trade(s)</span>
                    </div>
                    <div className="small muted">Win rate: {row.winRate.toFixed(1)}% · Avg R: <span style={{ color: row.avgR >= 0 ? '#4ad66d' : '#ff6b6b' }}>{row.avgR.toFixed(2)}R</span> · Total P&L: <span style={{ color: row.netPnl >= 0 ? '#4ad66d' : '#ff6b6b' }}>{row.netPnl.toFixed(2)}</span></div>
                  </article>
                )) : <div className="small muted">No setup families in this period.</div>}
                <div className="small muted"><strong>By setup model</strong></div>
                {modelBreakdown.length ? modelBreakdown.slice(0, 8).map((row) => (
                  <article key={row.key} className="trade">
                    <div className="row">
                      <strong>{row.key}</strong>
                      <span className="small muted">{row.trades} trade(s)</span>
                    </div>
                    <div className="small muted">Win rate: {row.winRate.toFixed(1)}% · Avg R: <span style={{ color: row.avgR >= 0 ? '#4ad66d' : '#ff6b6b' }}>{row.avgR.toFixed(2)}R</span> · Total P&L: <span style={{ color: row.netPnl >= 0 ? '#4ad66d' : '#ff6b6b' }}>{row.netPnl.toFixed(2)}</span></div>
                  </article>
                )) : <div className="small muted">No setup models in this period.</div>}
              </div>
            </details>

            <details>
              <summary className="small" style={{ cursor: 'pointer' }}><strong>Emotional pressure analysis</strong> <span className="muted">· state vs outcome</span></summary>
              <div className="stack" style={{ marginTop: 8 }}>
                {emotionBreakdown.length ? emotionBreakdown.map((row) => (
                  <article key={row.key} className="trade">
                    <div className="row">
                      <strong>{row.key}</strong>
                      <span className="small muted">{row.trades} trade(s)</span>
                    </div>
                    <div className="small muted">Avg P&L: <span style={{ color: row.avgPnl >= 0 ? '#4ad66d' : '#ff6b6b' }}>{row.avgPnl.toFixed(2)}</span> · Avg R: <span style={{ color: row.avgR >= 0 ? '#4ad66d' : '#ff6b6b' }}>{row.avgR.toFixed(2)}R</span></div>
                  </article>
                )) : <div className="small muted">No emotional pressure data logged in this period.</div>}
                {emotionalInsight ? <div className="small muted">{emotionalInsight}</div> : null}
              </div>
            </details>

            <details>
              <summary className="small" style={{ cursor: 'pointer' }}><strong>Streaks & expectancy</strong> <span className="muted">· momentum context</span></summary>
              <div className="grid" style={{ marginTop: 8 }}>
                <article className="trade" style={streakCardStyle(allTimeStreaks.currentWin, allTimeStreaks.currentLoss)}>
                  <div className="small muted">Current streak</div>
                  <div style={{ color: streakColor(allTimeStreaks.currentWin, allTimeStreaks.currentLoss) }}>{formatStreakLabel(allTimeStreaks.currentWin, allTimeStreaks.currentLoss)}</div>
                </article>
                <article className="trade" style={streakCardStyle(periodStreaks.currentWin, periodStreaks.currentLoss)}>
                  <div className="small muted">Period streak</div>
                  <div style={{ color: streakColor(periodStreaks.currentWin, periodStreaks.currentLoss) }}>{formatStreakLabel(periodStreaks.currentWin, periodStreaks.currentLoss)}</div>
                </article>
                <article className="trade" style={{ background: 'rgba(74,214,109,0.10)', borderColor: '#2f6f4a' }}>
                  <div className="small muted">Longest win streak</div>
                  <div style={{ color: '#4ad66d' }}>{allTimeStreaks.longestWin}</div>
                </article>
                <article className="trade" style={{ background: 'rgba(255,107,107,0.10)', borderColor: '#7a3f3f' }}>
                  <div className="small muted">Longest loss streak</div>
                  <div style={{ color: '#ff6b6b' }}>{allTimeStreaks.longestLoss}</div>
                </article>
                <article className="trade">
                  <div className="small muted">Expectancy / trade ($)</div>
                  <div style={{ color: periodExpectancyPnl >= 0 ? '#4ad66d' : '#ff6b6b' }}>{periodExpectancyPnl.toFixed(2)}</div>
                </article>
                <article className="trade">
                  <div className="small muted">Expectancy / trade (R)</div>
                  <div style={{ color: periodExpectancyR >= 0 ? '#4ad66d' : '#ff6b6b' }}>{periodExpectancyR.toFixed(2)}R</div>
                </article>
              </div>
            </details>
          </details>

        </section>
      )}

      {tab === 'history' && (
        <section className="card stack control-card">
          <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div style={{ minWidth: 148, flex: '1 1 160px' }}>
              <label className="small muted" htmlFor="history-entry-type-filter">Entry type</label>
              <select id="history-entry-type-filter" value={historyEntryTypeFilter} onChange={(e) => setHistoryEntryTypeFilter(e.target.value as HistoryEntryTypeFilter)}>
                <option value="all">All</option>
                <option value="trade_all">Trade (all)</option>
                <option value="session_all">Session (all)</option>
                <option value="live_trade">Live trade</option>
                <option value="paper_trade">Paper trade</option>
                <option value="no_trade_day">No-trade day</option>
                <option value="pre_session_plan">Pre-session plan</option>
                <option value="chart_session">Chart session</option>
                <option value="post_session_review">Post-session review</option>
              </select>
            </div>
            <div style={{ minWidth: 148, flex: '1 1 160px' }}>
              <label className="small muted" htmlFor="history-date-filter">Date range</label>
              <select id="history-date-filter" value={historyDateFilter} onChange={(e) => setHistoryDateFilter(e.target.value as HistoryDateFilter)}>
                <option value="all_time">All time</option>
                <option value="this_month">This month</option>
                <option value="last_30_days">Last 30 days</option>
                <option value="custom">Custom range</option>
              </select>
            </div>
          </div>
          {historyDateFilter === 'custom' ? (
            <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
              <div style={{ minWidth: 148, flex: '1 1 160px' }}>
                <label className="small muted" htmlFor="history-date-start">Start date</label>
                <input id="history-date-start" type="date" value={historyDateStart} onChange={(e) => setHistoryDateStart(e.target.value)} />
              </div>
              <div style={{ minWidth: 148, flex: '1 1 160px' }}>
                <label className="small muted" htmlFor="history-date-end">End date</label>
                <input id="history-date-end" type="date" value={historyDateEnd} onChange={(e) => setHistoryDateEnd(e.target.value)} />
              </div>
            </div>
          ) : null}
          <div className="small muted">
            Active filters: <strong>{historyEntryFilterLabel}</strong> · <strong>{historyDateScopeLabel}</strong>
          </div>
          {filteredActivityItems.map((item, index) => {
            const showDateDivider = index === 0 || filteredActivityItems[index - 1]?.date !== item.date;
            return (
              <Fragment key={`history-item-${item.type}-${item.id}`}>
                {showDateDivider ? <div className="small muted" style={{ fontWeight: 700, letterSpacing: '.02em', paddingTop: index === 0 ? 0 : 6 }}>{formatDateShort(item.date)}</div> : null}
                {item.type === 'trade' ? (
              <Fragment>
                <article className="trade" ref={(node) => { detailAnchors.current[`trade:${item.trade.id}`] = node; }}>
                  <div className="row"><strong>{item.trade.ticker}</strong><span>{item.trade.trade_date}</span></div>
                  <div className="small muted"><span className="badge">Trade</span> <span className="badge">{isPaperTrade(item.trade) ? 'Paper' : 'Live'}</span> {item.trade.family} · {item.trade.model}</div>
                  <div className="small">
                    {item.trade.classification} · <span style={{ color: pnlValueColor(item.trade.pnl) }}>${Number(item.trade.pnl || 0).toFixed(2)}</span> · <span style={{ color: rValueColor(item.trade.r_multiple) }}>{Number(item.trade.r_multiple || 0).toFixed(2)}R</span> · {item.trade.minutes_in_trade}m
                  </div>
                  <div className="small muted">Emotional pressure: <span style={{ color: emotionalPressureColor(item.trade.emotional_pressure) }}>{item.trade.emotional_pressure}/5</span></div>
                  <div className="small muted">Entry emotion: {resolveEntryEmotion(item.trade)} · In-trade emotion: {resolveInTradeEmotion(item.trade)}</div>
                  <div>{normalizeMistakeTags(item.trade.mistake_tags).map((m) => <span className="badge" key={m}>{m}</span>)}</div>
                  <div className="row">
                    <div className="small muted">Attachments: {attachments.filter((a) => a.trade_id === item.trade.id).length}</div>
                    <div className="row">
                      <button className="inline" type="button" onClick={() => void openEntryDetail({ kind: 'trade', id: item.trade.id })}>View</button>
                      <button className="inline" type="button" onClick={() => startEditTrade(item.trade)}>Edit</button>
                      <button className="inline" type="button" onClick={() => void deleteTrade(item.trade.id)}>Delete</button>
                    </div>
                  </div>
                </article>
                {detail?.kind === 'trade' && detail.id === item.trade.id && (
                  <article className="trade" style={{ marginTop: -4 }}>
                    <div className="row">
                      <strong>Trade detail</strong>
                      <button className="inline" type="button" onClick={() => setDetail(null)}>Close</button>
                    </div>
                    <div className="stack">
                      <div className="small muted">{item.trade.trade_date} · {item.trade.ticker}</div>
                      <div className="small"><span className="badge">{isPaperTrade(item.trade) ? 'Paper trade' : 'Live trade'}</span></div>
                      <div className="small">Family: {item.trade.family}</div>
                      <div className="small">Model: {item.trade.model}</div>
                      <div className="small">Classification: {item.trade.classification}</div>
                      <div className="small">Result: <span style={{ color: pnlValueColor(item.trade.pnl) }}>${Number(item.trade.pnl || 0).toFixed(2)}</span></div>
                      <div className="small">R multiple: <span style={{ color: rValueColor(item.trade.r_multiple) }}>{Number(item.trade.r_multiple || 0).toFixed(2)}R</span></div>
                      <div className="small">Minutes in trade: {item.trade.minutes_in_trade}</div>
                      <div className="small">Emotional pressure: <span style={{ color: emotionalPressureColor(item.trade.emotional_pressure) }}>{item.trade.emotional_pressure}/5</span></div>
                      <div className="small">Entry emotion: {resolveEntryEmotion(item.trade)} · In-trade emotion: {resolveInTradeEmotion(item.trade)}</div>
                      <div className="small">Mistake tags: {normalizeMistakeTags(item.trade.mistake_tags).length ? normalizeMistakeTags(item.trade.mistake_tags).join(', ') : 'None'}</div>
                      <div className="small">Notes:</div>
                      <RichTextContent value={item.trade.notes || ''} emptyLabel="—" />
                      <AttachmentPreviewList entries={attachments.filter((a) => a.trade_id === item.trade.id)} signedUrls={signedUrls} onOpenImage={(url, name) => setLightbox({ url, name })} />
                    </div>
                  </article>
                )}
              </Fragment>
            ) : item.type === 'no_trade' ? (
              <Fragment>
                <article className="trade no-trade" ref={(node) => { detailAnchors.current[`no_trade:${item.noTrade.id}`] = node; }}>
                  <div className="row"><strong>No-trade day</strong><span>{item.noTrade.day_date}</span></div>
                  <div className="small"><span className="badge">No-trade day</span> Reason: {item.noTrade.reason}</div>
                  <div className="small muted">No-trade mindset: {resolveNoTradeMindset(item.noTrade)}</div>
                  <div className="row">
                    <div className="small muted">Attachments: {attachments.filter((a) => a.no_trade_day_id === item.noTrade.id).length}</div>
                    <div className="row">
                      <button className="inline" type="button" onClick={() => void openEntryDetail({ kind: 'no_trade', id: item.noTrade.id })}>View</button>
                      <button className="inline" type="button" onClick={() => startEditNoTrade(item.noTrade)}>Edit</button>
                      <button className="inline" type="button" onClick={() => void deleteNoTrade(item.noTrade.id)}>Delete</button>
                    </div>
                  </div>
                </article>
                {detail?.kind === 'no_trade' && detail.id === item.noTrade.id && (
                  <article className="trade no-trade" style={{ marginTop: -4 }}>
                    <div className="row">
                      <strong>No-trade detail</strong>
                      <button className="inline" type="button" onClick={() => setDetail(null)}>Close</button>
                    </div>
                    <div className="stack">
                      <div className="small muted">{item.noTrade.day_date}</div>
                      <div className="small">Reason: {item.noTrade.reason}</div>
                      <div className="small">No-trade mindset: {resolveNoTradeMindset(item.noTrade)}</div>
                      <div className="small">Notes:</div>
                      <RichTextContent value={item.noTrade.notes || ''} emptyLabel="—" />
                      <AttachmentPreviewList entries={attachments.filter((a) => a.no_trade_day_id === item.noTrade.id)} signedUrls={signedUrls} onOpenImage={(url, name) => setLightbox({ url, name })} />
                    </div>
                  </article>
                )}
              </Fragment>
            ) : (
              <Fragment>
                <article className={`trade session-${item.session.session_type}`} ref={(node) => { detailAnchors.current[`session:${item.session.id}`] = node; }}>
                  <div className="row"><strong>{sessionSubtypeLabel(item.session.session_type)}</strong><span>{item.session.session_date}</span></div>
                  <div className="small muted">
                    <span className="badge">{isChartSessionType(item.session.session_type) ? 'Chart study' : 'Review work'}</span>{' '}
                    {item.session.start_time.slice(0, 5)}–{item.session.end_time.slice(0, 5)} · {formatMinutesLabel(item.session.duration_minutes)}
                  </div>
                  {item.session.notes ? <div className="small">Notes: {item.session.notes}</div> : null}
                  <div className="row">
                    <div className="small muted">{item.session.notes ? 'Includes notes' : 'No notes added'} · Attachments: {attachments.filter((a) => a.session_id === item.session.id).length}</div>
                    <div className="row">
                      <button className="inline" type="button" onClick={() => void openEntryDetail({ kind: 'session', id: item.session.id })}>View</button>
                      <button className="inline" type="button" onClick={() => {
                        setEditingSessionId(item.session.id);
                        setSessionDraft({
                          session_type: item.session.session_type,
                          session_date: item.session.session_date,
                          start_time: item.session.start_time.slice(0, 5),
                          end_time: item.session.end_time.slice(0, 5),
                          notes: item.session.notes || ''
                        });
                        setSessionSubtypeView(item.session.session_type === 'journal' ? 'post_session_review' : 'chart_session');
                        setTab('log');
                        setLogMode('session');
                      }}>Edit</button>
                      <button className="inline" type="button" onClick={() => void deleteSession(item.session.id)}>Delete</button>
                    </div>
                  </div>
                </article>
                {detail?.kind === 'session' && detail.id === item.session.id && (
                  <article className={`trade session-${item.session.session_type}`} style={{ marginTop: -4 }}>
                    <div className="row">
                      <strong>Session detail</strong>
                      <button className="inline" type="button" onClick={() => setDetail(null)}>Close</button>
                    </div>
                    <div className="stack">
                      <div className="small muted">{item.session.session_date} · {sessionSubtypeLabel(item.session.session_type)}</div>
                      <div className="small">Start: {item.session.start_time.slice(0, 5)}</div>
                      <div className="small">End: {item.session.end_time.slice(0, 5)}</div>
                      <div className="small">Duration: {formatMinutesLabel(item.session.duration_minutes)}</div>
                      <div className="small">Notes:</div>
                      <RichTextContent value={item.session.notes || ''} emptyLabel="—" />
                      <AttachmentPreviewList entries={attachments.filter((a) => a.session_id === item.session.id)} signedUrls={signedUrls} onOpenImage={(url, name) => setLightbox({ url, name })} />
                    </div>
                  </article>
                )}
              </Fragment>
            )}
              </Fragment>
            );
          })}
          {!filteredActivityItems.length ? <div className="small muted">No history entries match the selected filters yet.</div> : null}
        </section>
      )}

      {tab === 'log' && (
        <section className="stack">
          <div className="card stack control-card">
            <label className="small muted" htmlFor="log-mode-select">Log type</label>
            <select
              id="log-mode-select"
              value={logType}
              onChange={(e) => {
                const nextType = e.target.value as LogType;
                if (nextType === 'session') {
                  setLogMode('session');
                } else {
                  setLogMode(tradeLogSubtype === 'no_trade' ? 'no_trade' : 'trade');
                }
              }}
            >
              <option value="trade_log">Trade log</option>
              <option value="session">Session</option>
            </select>
            {logType === 'trade_log' ? (
              <>
                <div className="small muted">Subtype</div>
                <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                  <button
                    className="inline"
                    type="button"
                    style={tradeLogSubtype === 'live_trade' ? { background: '#1f7446', borderColor: '#32915a', color: '#eafbf0' } : undefined}
                    onClick={() => {
                      setTradeLogSubtype('live_trade');
                      setTradeDraft((p) => ({ ...p, is_paper_trade: false }));
                      setLogMode('trade');
                    }}
                  >
                    {tradeLogSubtype === 'live_trade' ? '✓ ' : ''}Live trade
                  </button>
                  <button
                    className="inline"
                    type="button"
                    style={tradeLogSubtype === 'paper_trade' ? { background: '#1f7446', borderColor: '#32915a', color: '#eafbf0' } : undefined}
                    onClick={() => {
                      setTradeLogSubtype('paper_trade');
                      setTradeDraft((p) => ({ ...p, is_paper_trade: true }));
                      setLogMode('trade');
                    }}
                  >
                    {tradeLogSubtype === 'paper_trade' ? '✓ ' : ''}Paper trade
                  </button>
                  <button
                    className="inline"
                    type="button"
                    style={tradeLogSubtype === 'no_trade' ? { background: '#1f7446', borderColor: '#32915a', color: '#eafbf0' } : undefined}
                    onClick={() => {
                      setTradeLogSubtype('no_trade');
                      setLogMode('no_trade');
                    }}
                  >
                    {tradeLogSubtype === 'no_trade' ? '✓ ' : ''}No-trade day
                  </button>
                </div>
                <div className="small muted">Selected subtype: <strong>{tradeLogSubtype === 'live_trade' ? 'Live trade' : tradeLogSubtype === 'paper_trade' ? 'Paper trade' : 'No-trade day'}</strong></div>
              </>
            ) : null}
          </div>
          {logMode === 'trade' && (
          <form className="card stack" action={(fd) => startTransition(() => void addTrade(fd))}>
            <div className="row">
              <strong>{editingTradeId ? 'Edit trade' : 'Add trade'}</strong>
              {editingTradeId && <button className="inline" type="button" onClick={resetTradeDraft}>Cancel edit</button>}
            </div>
            <label className="small muted">Date</label>
            <input className="log-date-control" name="trade_date" type="date" required value={tradeDraft.trade_date} onChange={(e) => setTradeDraft((p) => ({ ...p, trade_date: e.target.value }))} />
            <label className="small muted">Ticker</label>
            <select name="ticker" value={tradeDraft.ticker} onChange={(e) => setTradeDraft((p) => ({ ...p, ticker: e.target.value }))} required>
              <option value="" disabled>Select instrument</option>
              {instrumentOptions.map((symbol) => <option key={symbol} value={symbol}>{symbol}</option>)}
            </select>
            <div className="row">
              <input placeholder="Add new instrument (e.g. NQ)" value={newInstrument} onChange={(e) => setNewInstrument(e.target.value.toUpperCase())} />
              <button className="inline" type="button" onClick={() => {
                const next = normalizeInstrument(newInstrument);
                if (!next) return;
                const nextSettings = settings
                  ? { ...settings, instruments: normalizeUniqueInstruments([...(settings.instruments || []), next]) }
                  : null;
                if (nextSettings) void saveSettings(nextSettings);
                setTradeDraft((p) => ({ ...p, ticker: next }));
                setNewInstrument('');
              }}>Add</button>
            </div>
            <div className="row">
              <label className="small muted">Trade classification</label>
              <button className="info-btn" aria-label="Trade classification help" type="button" onClick={() => setOpenHelp('classification')}>i</button>
            </div>
            <select name="classification" value={addTradeClassification} onChange={(e) => onChangeClassification(e.target.value)}>
              {classifications.map((c) => <option key={c}>{c}</option>)}
            </select>
            <div className="row">
              <label className="small muted">Setup family</label>
              <button className="info-btn" aria-label="Setup family help" type="button" onClick={() => setOpenHelp('family')}>i</button>
            </div>
            <select name="family" value={addTradeFamily} onChange={(e) => onChangeFamily(e.target.value)} disabled={classificationLocksSetup}>
              {Object.keys(familyModels).map((f) => <option key={f}>{f}</option>)}
            </select>
            <div className="row">
              <label className="small muted">Setup model</label>
              <button className="info-btn" aria-label="Setup model help" type="button" onClick={() => setOpenHelp('model')}>i</button>
            </div>
            <select name="model" value={addTradeModel} onChange={(e) => { setAddTradeModel(e.target.value); setTradeDraft((p) => ({ ...p, model: e.target.value })); }} disabled={classificationLocksSetup}>
              {(familyModels[addTradeFamily] || [NA_MODEL]).map((m) => <option key={m}>{m}</option>)}
            </select>
            <input name="pnl" type="number" step="0.01" placeholder="Result ($)" value={tradeDraft.pnl} onChange={(e) => setTradeDraft((p) => ({ ...p, pnl: e.target.value }))} />
            <label className="small muted">R multiple</label>
            <div className="row">
              <select
                name="r_multiple_whole"
                value={tradeDraft.r_multiple_whole}
                onChange={(e) => setTradeDraft((p) => ({ ...p, r_multiple_whole: e.target.value }))}
              >
                {buildRWholeOptions().map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
              <span className="small muted">.</span>
              <select
                name="r_multiple_decimal"
                value={tradeDraft.r_multiple_decimal}
                onChange={(e) => setTradeDraft((p) => ({ ...p, r_multiple_decimal: e.target.value }))}
              >
                {Array.from({ length: 100 }, (_, i) => String(i).padStart(2, '0')).map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            </div>
            <label className="small muted">Minutes in trade</label>
            <select name="minutes_in_trade" value={tradeDraft.minutes_in_trade} onChange={(e) => setTradeDraft((p) => ({ ...p, minutes_in_trade: e.target.value }))}>
              {Array.from({ length: 481 }, (_, i) => String(i)).map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
            <label className="small muted">Emotional pressure (1-5)</label>
            <select name="emotional_pressure" value={tradeDraft.emotional_pressure} onChange={(e) => setTradeDraft((p) => ({ ...p, emotional_pressure: e.target.value }))}>
              {emotionalPressureScale.map((level) => (
                <option key={level.value} value={level.value}>{level.label}</option>
              ))}
            </select>
            <div className="small muted">Use this to log emotional pressure, urge to interfere, revenge impulses, or panic.</div>
            <div className="row">
              <label className="small muted">Entry emotion</label>
              <button className="info-btn" aria-label="Entry emotion help" type="button" onClick={() => setOpenHelp('entry_emotion')}>i</button>
            </div>
            <select name="entry_emotion" value={tradeDraft.entry_emotion} onChange={(e) => setTradeDraft((p) => ({ ...p, entry_emotion: normalizeEntryEmotion(e.target.value) }))}>
              {entryEmotionOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
            <div className="row">
              <label className="small muted">In-trade emotion</label>
              <button className="info-btn" aria-label="In-trade emotion help" type="button" onClick={() => setOpenHelp('in_trade_emotion')}>i</button>
            </div>
            <select name="in_trade_emotion" value={tradeDraft.in_trade_emotion} onChange={(e) => setTradeDraft((p) => ({ ...p, in_trade_emotion: normalizeInTradeEmotion(e.target.value) }))}>
              {inTradeEmotionOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
            <label className="small muted">Mistake tags</label>
            <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
              {normalizeMistakeTags(tradeDraft.mistake_tags).length ? normalizeMistakeTags(tradeDraft.mistake_tags).map((tag) => (
                <button
                  key={tag}
                  className="inline"
                  type="button"
                  onClick={() => setTradeDraft((p) => ({ ...p, mistake_tags: normalizeMistakeTags(normalizeMistakeTags(p.mistake_tags).filter((existing) => existing !== tag)) }))}
                >
                  {tag} ✕
                </button>
              )) : <span className="small muted">No mistakes selected.</span>}
            </div>
            <div className="stack">
              <button className="inline" type="button" onClick={() => setMistakePickerOpen((open) => !open)}>
                {mistakePickerOpen ? 'Done selecting mistakes' : 'Select saved mistake tags'}
              </button>
              {mistakePickerOpen ? (
                <div className="trade stack" style={{ maxHeight: 190, overflow: 'auto' }}>
                  {mistakeTagOptions.map((tag) => {
                    const selected = normalizeMistakeTags(tradeDraft.mistake_tags).some((existing) => existing.toLowerCase() === tag.toLowerCase());
                    return (
                      <button
                        key={tag}
                        className="inline"
                        type="button"
                        onClick={() => setTradeDraft((p) => ({ ...p, mistake_tags: normalizeMistakeTags([...normalizeMistakeTags(p.mistake_tags), tag]) }))}
                      >
                        {selected ? '✓ ' : ''}{tag}
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>
            <div className="row">
              <input placeholder="Add new mistake tag" value={newMistakeTag} onChange={(e) => setNewMistakeTag(e.target.value)} />
              <button className="inline" type="button" onClick={() => {
                const next = normalizeTag(newMistakeTag);
                if (!next) return;
                const currentTags = normalizeMistakeTags(tradeDraft.mistake_tags);
                if (!currentTags.some((existing) => existing.localeCompare(next, undefined, { sensitivity: 'accent' }) === 0)) {
                  setTradeDraft((p) => ({ ...p, mistake_tags: normalizeMistakeTags([...currentTags, next]) }));
                }
                const nextSettings = settings
                  ? {
                    ...settings,
                    mistake_catalog: normalizeActiveMistakeCatalog([...(settings.mistake_catalog || []), next], settings.mistake_catalog_hidden),
                    mistake_catalog_hidden: normalizeHiddenMistakeCatalog((settings.mistake_catalog_hidden || []).filter((item) => item !== next), [...(settings.mistake_catalog || []), next])
                  }
                  : null;
                if (nextSettings) void saveSettings(nextSettings);
                setNewMistakeTag('');
              }}>Add</button>
            </div>
            <RichTextEditor
              label="Trade notes"
              value={tradeDraft.notes}
              onChange={(next) => setTradeDraft((p) => ({ ...p, notes: next }))}
              placeholder="Capture execution thoughts, context, and lessons."
              minRows={5}
            />
            <input
              name="files"
              type="file"
              accept="image/*,.pdf,.txt,.csv"
              multiple
              onChange={(e) => void runTradeExtraction(Array.from(e.currentTarget.files || []))}
            />
            <div className="row">
              <span className="small muted">Upload-assisted autofill</span>
              <button className="inline" type="button" onClick={(e) => {
                const input = (e.currentTarget.closest('form')?.querySelector('input[name=\"files\"]') as HTMLInputElement | null);
                void runTradeExtraction(Array.from(input?.files || []));
              }}>
                Extract from upload
              </button>
            </div>
            {tradeExtract && (
              <div className="trade">
                <strong>Suggested from upload</strong>
                {tradeExtract.trade_date && (
                  <div className="row small">
                    <span>Date: {tradeExtract.trade_date}</span>
                    <div className="row">
                      <button className="inline" type="button" onClick={() => applyTradeSuggestion('trade_date', tradeExtract.trade_date!)}>Accept</button>
                      <button className="inline" type="button" onClick={() => rejectTradeSuggestion('trade_date')}>Reject</button>
                    </div>
                  </div>
                )}
                {tradeExtract.ticker && (
                  <div className="row small">
                    <span>Ticker: {tradeExtract.ticker}</span>
                    <div className="row">
                      <button className="inline" type="button" onClick={() => applyTradeSuggestion('ticker', tradeExtract.ticker!)}>Accept</button>
                      <button className="inline" type="button" onClick={() => rejectTradeSuggestion('ticker')}>Reject</button>
                    </div>
                  </div>
                )}
                {tradeExtract.pnl && (
                  <div className="row small">
                    <span>Result: {tradeExtract.pnl}</span>
                    <div className="row">
                      <button className="inline" type="button" onClick={() => applyTradeSuggestion('pnl', tradeExtract.pnl!)}>Accept</button>
                      <button className="inline" type="button" onClick={() => rejectTradeSuggestion('pnl')}>Reject</button>
                    </div>
                  </div>
                )}
                {tradeExtract.r_multiple && (
                  <div className="row small">
                    <span>R multiple: {tradeExtract.r_multiple}</span>
                    <div className="row">
                      <button className="inline" type="button" onClick={() => applyTradeSuggestion('r_multiple', tradeExtract.r_multiple!)}>Accept</button>
                      <button className="inline" type="button" onClick={() => rejectTradeSuggestion('r_multiple')}>Reject</button>
                    </div>
                  </div>
                )}
                {tradeExtract.minutes_in_trade && (
                  <div className="row small">
                    <span>Minutes: {tradeExtract.minutes_in_trade}</span>
                    <div className="row">
                      <button className="inline" type="button" onClick={() => applyTradeSuggestion('minutes_in_trade', tradeExtract.minutes_in_trade!)}>Accept</button>
                      <button className="inline" type="button" onClick={() => rejectTradeSuggestion('minutes_in_trade')}>Reject</button>
                    </div>
                  </div>
                )}
                {!tradeExtract.trade_date && !tradeExtract.ticker && !tradeExtract.pnl && !tradeExtract.r_multiple && !tradeExtract.minutes_in_trade && (
                  <div className="small muted">No useful trade fields detected yet (filename/metadata + beta OCR).</div>
                )}
                {tradeExtract.hints?.length ? <div className="small muted">Hints: {tradeExtract.hints.join(', ')}</div> : null}
                <div className="small muted">OCR status: {formatOcrStatus(tradeExtract.ocrStatus)}</div>
                <div className="small muted">OCR character count: {tradeExtract.ocrCharCount ?? 0}</div>
                {tradeExtract.ocrError ? <div className="small muted">OCR error: {tradeExtract.ocrError}</div> : null}
                {tradeExtract.parsedHeaderLine ? <div className="small muted">Parsed header line: {tradeExtract.parsedHeaderLine}</div> : null}
                <div className="small muted">Ticker source: {tradeExtract.tickerSource || 'none'}</div>
                {tradeExtract.microResolutionRule ? <div className="small muted">Micro/standard resolution: {tradeExtract.microResolutionRule}</div> : null}
                {tradeExtract.tickerRejectReason ? <div className="small muted">Ticker rejection: {tradeExtract.tickerRejectReason}</div> : null}
                {tradeExtract.minutesRejectReason ? <div className="small muted">Minutes decision: {tradeExtract.minutesRejectReason}</div> : null}
                {tradeExtract.timeframeRejected ? <div className="small muted">Minutes rejected as chart timeframe token.</div> : null}
                {tradeExtract.detectedText ? (
                  <details>
                    <summary className="small muted">Detected text (beta OCR)</summary>
                    {tradeExtract.ocrSteps?.length ? <div className="small muted" style={{ marginTop: 8 }}>OCR steps: {tradeExtract.ocrSteps.join(' → ')}</div> : null}
                    {tradeExtract.headerOcrText ? (
                      <>
                        <div className="small muted" style={{ marginTop: 8 }}>Cropped header OCR text</div>
                        <pre className="small muted" style={{ whiteSpace: 'pre-wrap', marginTop: 4 }}>{tradeExtract.headerOcrText}</pre>
                      </>
                    ) : null}
                    <div className="small muted" style={{ marginTop: 8 }}>Full-image OCR text</div>
                    <pre className="small muted" style={{ whiteSpace: 'pre-wrap', marginTop: 8 }}>{tradeExtract.detectedText}</pre>
                  </details>
                ) : null}
              </div>
            )}
            <div className="small muted">Uploads are stored attachments only. AI extraction is not implemented.</div>
            <button className="primary" disabled={pending}>{editingTradeId ? 'Update trade' : 'Save trade'}</button>
          </form>
          )}

          {logMode === 'no_trade' && (
          <form className="card stack" action={(fd) => startTransition(() => void addNoTrade(fd))}>
            <div className="row">
              <strong>{editingNoTradeId ? 'Edit no-trade day' : 'No-trade day'}</strong>
              {editingNoTradeId ? <button className="inline" type="button" onClick={() => { setEditingNoTradeId(null); setNoTradeDraft({ day_date: new Date().toISOString().slice(0, 10), reason: noTradeReasons[0], no_trade_mindset: noTradeMindsetOptions[0].value, notes: '' }); }}>Cancel edit</button> : null}
            </div>
            <input className="log-date-control" name="day_date" type="date" required value={noTradeDraft.day_date} onChange={(e) => setNoTradeDraft((p) => ({ ...p, day_date: e.target.value }))} />
            <select name="reason" value={noTradeDraft.reason} onChange={(e) => setNoTradeDraft((p) => ({ ...p, reason: e.target.value }))}>{noTradeReasons.map((r) => <option key={r}>{r}</option>)}</select>
            <div className="row">
              <label className="small muted">No-trade mindset</label>
              <button className="info-btn" aria-label="No-trade mindset help" type="button" onClick={() => setOpenHelp('no_trade_mindset')}>i</button>
            </div>
            <select name="no_trade_mindset" value={noTradeDraft.no_trade_mindset} onChange={(e) => setNoTradeDraft((p) => ({ ...p, no_trade_mindset: normalizeNoTradeMindset(e.target.value) }))}>
              {noTradeMindsetOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
            <RichTextEditor
              label="No-trade notes"
              value={noTradeDraft.notes}
              onChange={(next) => setNoTradeDraft((p) => ({ ...p, notes: next }))}
              placeholder="Describe why you stayed flat and what confirmed discipline."
              minRows={4}
            />
            <input
              name="no_trade_files"
              type="file"
              accept="image/*,.pdf,.txt,.csv"
              multiple
              onChange={(e) => void runNoTradeExtraction(Array.from(e.currentTarget.files || []))}
            />
            <div className="row">
              <span className="small muted">Upload-assisted autofill</span>
              <button className="inline" type="button" onClick={(e) => {
                const input = (e.currentTarget.closest('form')?.querySelector('input[name=\"no_trade_files\"]') as HTMLInputElement | null);
                void runNoTradeExtraction(Array.from(input?.files || []));
              }}>
                Extract from upload
              </button>
            </div>
            {noTradeExtract && (
              <div className="trade no-trade">
                <strong>Suggested from upload</strong>
                {noTradeExtract.day_date && (
                  <div className="row small">
                    <span>Date: {noTradeExtract.day_date}</span>
                    <div className="row">
                      <button className="inline" type="button" onClick={() => applyNoTradeSuggestion('day_date', noTradeExtract.day_date!)}>Accept</button>
                      <button className="inline" type="button" onClick={() => rejectNoTradeSuggestion('day_date')}>Reject</button>
                    </div>
                  </div>
                )}
                {noTradeExtract.reason && (
                  <div className="row small">
                    <span>Reason hint: {noTradeExtract.reason}</span>
                    <div className="row">
                      <button className="inline" type="button" onClick={() => applyNoTradeSuggestion('reason', noTradeExtract.reason!)}>Accept</button>
                      <button className="inline" type="button" onClick={() => rejectNoTradeSuggestion('reason')}>Reject</button>
                    </div>
                  </div>
                )}
                {!noTradeExtract.day_date && !noTradeExtract.reason && (
                  <div className="small muted">No no-trade date/reason hints detected yet (filename/metadata + beta OCR).</div>
                )}
                {noTradeExtract.hints?.length ? <div className="small muted">Hints: {noTradeExtract.hints.join(', ')}</div> : null}
                <div className="small muted">OCR status: {formatOcrStatus(noTradeExtract.ocrStatus)}</div>
                <div className="small muted">OCR character count: {noTradeExtract.ocrCharCount ?? 0}</div>
                {noTradeExtract.ocrError ? <div className="small muted">OCR error: {noTradeExtract.ocrError}</div> : null}
                {noTradeExtract.parsedHeaderLine ? <div className="small muted">Parsed header line: {noTradeExtract.parsedHeaderLine}</div> : null}
                {noTradeExtract.detectedText ? (
                  <details>
                    <summary className="small muted">Detected text (beta OCR)</summary>
                    {noTradeExtract.ocrSteps?.length ? <div className="small muted" style={{ marginTop: 8 }}>OCR steps: {noTradeExtract.ocrSteps.join(' → ')}</div> : null}
                    {noTradeExtract.headerOcrText ? (
                      <>
                        <div className="small muted" style={{ marginTop: 8 }}>Cropped header OCR text</div>
                        <pre className="small muted" style={{ whiteSpace: 'pre-wrap', marginTop: 4 }}>{noTradeExtract.headerOcrText}</pre>
                      </>
                    ) : null}
                    <div className="small muted" style={{ marginTop: 8 }}>Full-image OCR text</div>
                    <pre className="small muted" style={{ whiteSpace: 'pre-wrap', marginTop: 8 }}>{noTradeExtract.detectedText}</pre>
                  </details>
                ) : null}
              </div>
            )}
            <button disabled={pending}>{editingNoTradeId ? 'Update no-trade day' : 'Save no-trade day'}</button>
          </form>
          )}

          {logMode === 'session' && (
            <form className="card stack" action={(formData) => startTransition(() => void addSession(formData))}>
              <div className="row">
                <strong>{editingSessionId ? 'Edit session' : 'Log session'}</strong>
                {editingSessionId ? <button className="inline" type="button" onClick={() => {
                  setEditingSessionId(null);
                  setSessionSubtypeView('chart_session');
                  setSessionDraft({
                    session_type: 'chart',
                    session_date: new Date().toISOString().slice(0, 10),
                    start_time: normalizeTimeInput(settings?.chart_session_start_default || '') || SESSION_DEFAULT_TIMES.chart.start,
                    end_time: normalizeTimeInput(settings?.chart_session_end_default || '') || SESSION_DEFAULT_TIMES.chart.end,
                    notes: ''
                  });
                }}>Cancel edit</button> : null}
              </div>
              <div className="small muted">What kind of session did you run? (required)</div>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <button
                  className="inline"
                  type="button"
                  style={sessionSubtypeView === 'pre_session_plan' ? { background: '#1f7446', borderColor: '#32915a', color: '#eafbf0' } : undefined}
                  onClick={() => { setSessionSubtypeView('pre_session_plan'); applySessionDefaults('chart'); }}
                >
                  {sessionSubtypeView === 'pre_session_plan' ? '✓ ' : ''}Pre-session plan
                </button>
                <button
                  className="inline"
                  type="button"
                  style={sessionSubtypeView === 'chart_session' ? { background: '#1f7446', borderColor: '#32915a', color: '#eafbf0' } : undefined}
                  onClick={() => { setSessionSubtypeView('chart_session'); applySessionDefaults('chart'); }}
                >
                  {sessionSubtypeView === 'chart_session' ? '✓ ' : ''}Chart session
                </button>
                <button
                  className="inline"
                  type="button"
                  style={sessionSubtypeView === 'post_session_review' ? { background: '#1f7446', borderColor: '#32915a', color: '#eafbf0' } : undefined}
                  onClick={() => { setSessionSubtypeView('post_session_review'); applySessionDefaults('journal'); }}
                >
                  {sessionSubtypeView === 'post_session_review' ? '✓ ' : ''}Post-session review
                </button>
              </div>
              <div className="small muted">Selected subtype: <strong>{sessionSubtypeLabel(sessionSubtypeView)}</strong></div>
              <div className="small muted">Pre-session plan and Chart session use chart defaults. Post-session review uses review/journal defaults.</div>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <button className="inline" type="button" onClick={() => applySessionDefaults(sessionDraft.session_type)}>Use default times</button>
                <button
                  className="inline"
                  type="button"
                  disabled={!latestChartSession}
                  onClick={() => {
                    if (!latestChartSession) return;
                    setSessionSubtypeView('chart_session');
                    setSessionDraft((p) => ({
                      ...p,
                      session_type: 'chart',
                      start_time: latestChartSession.start_time.slice(0, 5),
                      end_time: latestChartSession.end_time.slice(0, 5),
                      notes: latestChartSession.notes || ''
                    }));
                  }}
                >
                  Duplicate last chart session
                </button>
                <button
                  className="inline"
                  type="button"
                  disabled={!latestJournalSession}
                  onClick={() => {
                    if (!latestJournalSession) return;
                    setSessionSubtypeView('post_session_review');
                    setSessionDraft((p) => ({
                      ...p,
                      session_type: 'journal',
                      start_time: latestJournalSession.start_time.slice(0, 5),
                      end_time: latestJournalSession.end_time.slice(0, 5),
                      notes: latestJournalSession.notes || ''
                    }));
                  }}
                >
                  Duplicate last journal session
                </button>
              </div>
              <label className="small muted">Date</label>
              <input className="log-date-control" type="date" value={sessionDraft.session_date} onChange={(e) => setSessionDraft((p) => ({ ...p, session_date: e.target.value }))} />
              <div className="grid log-session-time-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
                <div className="stack">
                  <label className="small muted">Start time (local)</label>
                  <input className="log-session-time-control" type="time" value={sessionDraft.start_time} onChange={(e) => setSessionDraft((p) => ({ ...p, start_time: e.target.value }))} />
                </div>
                <div className="stack">
                  <label className="small muted">End time (local)</label>
                  <input className="log-session-time-control" type="time" value={sessionDraft.end_time} onChange={(e) => setSessionDraft((p) => ({ ...p, end_time: e.target.value }))} />
                </div>
              </div>
              <div className="small muted">Duration: {formatMinutesLabel(calculateDurationMinutes(sessionDraft.start_time, sessionDraft.end_time))}</div>
              <label className="small muted" htmlFor="session-notes">Session notes (optional)</label>
              <textarea id="session-notes" placeholder="What did you work on? What improved or still needs reps?" value={sessionDraft.notes} onChange={(e) => setSessionDraft((p) => ({ ...p, notes: e.target.value }))} />
              <label className="small muted" htmlFor="session-files">Attach files (optional)</label>
              <input id="session-files" name="session_files" type="file" multiple />
              {editingSessionId ? (
                <div className="stack">
                  <div className="small muted">Existing attachments</div>
                  {attachments.filter((a) => a.session_id === editingSessionId).length ? attachments.filter((a) => a.session_id === editingSessionId).map((file) => (
                    <div className="row small" key={file.id}>
                      <span>{file.file_name}</span>
                      <button className="inline" type="button" onClick={() => void removeSessionAttachment(file.id)}>Remove</button>
                    </div>
                  )) : <div className="small muted">No attachments linked to this session.</div>}
                </div>
              ) : null}
              <button className="primary" disabled={pending}>{editingSessionId ? 'Update session' : 'Save session'}</button>
            </form>
          )}
        </section>
      )}

      {tab === 'review' && (
        <section className="card stack control-card">
          <strong>Weekly review</strong>
          {!trades.length && !noTrades.length && !sessions.length ? (
            <div className="small muted">No activity logged yet. Use Log tab to add a trade, no-trade day, or session, then return here for weekly review.</div>
          ) : null}
          <div className="grid review-week-selector-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <input className="review-week-control" type="week" value={weekInput} onChange={(e) => setWeekInput(e.target.value)} />
            <select className="review-week-control" value={weekInput} onChange={(e) => setWeekInput(e.target.value)}>
              {[currentWeekInput(), ...reviews.map((r) => weekInputFromKey(r.week_key))]
                .filter((v, i, a) => v && a.indexOf(v) === i)
                .sort((a, b) => b.localeCompare(a))
                .map((w) => {
                  const sunday = weekKeyFromInput(w);
                  const saturday = addDaysKey(sunday, 6);
                  return <option value={w} key={w}>{`${formatDateShort(sunday)} – ${formatDateShort(saturday)} (${w})`}</option>;
                })}
            </select>
          </div>
          <div className="chip">{reviewStatus}</div>
          <div style={{ maxWidth: 220 }}>
            <label className="small muted" htmlFor="review-trade-filter">Trade type</label>
            <select id="review-trade-filter" value={reviewTradeFilter} onChange={(e) => setReviewTradeFilter(e.target.value as TradeTypeFilter)}>
              <option value="all">All</option>
              <option value="live">Live only</option>
              <option value="paper">Paper only</option>
            </select>
          </div>
          <div className="trade small muted">Review week: {selectedReviewRangeLabel} (Sunday–Saturday). Stats: {weekTradesForReview.length} trade(s) in filter, {weekLiveTrades.length} live, {weekPaperTrades.length} paper, {weekNoTrades.length} no-trade day(s), {weekSessions.length} session(s), {weekTradesForReview.filter((t) => t.classification === 'FOMO trade').length} FOMO trade(s).</div>
          <RichTextEditor
            label="1) Reflection on mistakes"
            helperText="What patterns drove mistakes this week?"
            value={reviewAnswers.q1}
            onChange={(next) => setReviewAnswers((s) => ({ ...s, q1: next }))}
            placeholder=""
            minRows={5}
          />
          <RichTextEditor
            label="2) Reflection on no-trade choices"
            helperText="Which no-trade decisions protected your edge?"
            value={reviewAnswers.q2}
            onChange={(next) => setReviewAnswers((s) => ({ ...s, q2: next }))}
            placeholder=""
            minRows={5}
          />
          <RichTextEditor
            label="3) Rule for next week"
            helperText="Write one process rule you will enforce next week."
            value={reviewAnswers.q3}
            onChange={(next) => setReviewAnswers((s) => ({ ...s, q3: next }))}
            placeholder=""
            minRows={5}
          />
          {weekPaperTrades.length ? (
            <RichTextEditor
              label="Paper trades: What made me choose to paper trade, and what was I testing?"
              helperText="Concise reflection for this week only."
              value={reviewAnswers.q_paper}
              onChange={(next) => setReviewAnswers((s) => ({ ...s, q_paper: next }))}
              placeholder=""
              minRows={3}
            />
          ) : null}
          <section className="trade stack">
            <div className="row">
              <strong>This week's entries reference</strong>
              <button className="inline" type="button" onClick={() => setReviewEntriesOpen((open) => !open)}>
                {reviewEntriesOpen ? 'Hide' : 'Show'}
              </button>
            </div>
            <div className="small muted">Read-only journal context for this selected week.</div>
            {reviewEntriesOpen ? (
              <div className="stack" style={{ maxHeight: 340, overflow: 'auto', paddingRight: 4 }}>
                {weekTradesForReview.map((t) => (
                  <article key={t.id} className="trade">
                    <div className="small muted">{t.trade_date} · {t.ticker} · <span className="badge">{isPaperTrade(t) ? 'Paper' : 'Live'}</span></div>
                    <div className="small">{t.family} · {t.model} · {t.classification}</div>
                    <div className="small"><span style={{ color: pnlValueColor(t.pnl) }}>${Number(t.pnl || 0).toFixed(2)}</span> · <span style={{ color: rValueColor(t.r_multiple) }}>{Number(t.r_multiple || 0).toFixed(2)}R</span> · {t.minutes_in_trade}m · Emotion <span style={{ color: emotionalPressureColor(t.emotional_pressure) }}>{t.emotional_pressure}/5</span> · Entry {resolveEntryEmotion(t)} · In-trade {resolveInTradeEmotion(t)}</div>
                    <div>{normalizeMistakeTags(t.mistake_tags).map((m) => <span key={m} className="badge">{m}</span>)}</div>
                    <div className="small">Notes:</div>
                    <RichTextContent value={t.notes || ''} emptyLabel="—" />
                    <AttachmentPreviewList entries={attachments.filter((a) => a.trade_id === t.id)} signedUrls={reviewSignedUrls} onOpenImage={(url, name) => setLightbox({ url, name })} />
                  </article>
                ))}
                {weekNoTrades.map((n) => (
                  <article key={n.id} className="trade no-trade">
                    <div className="small muted">{n.day_date}</div>
                    <div className="small">Reason: {n.reason}</div>
                    <div className="small">No-trade mindset: {resolveNoTradeMindset(n)}</div>
                    <div className="small">Notes:</div>
                    <RichTextContent value={n.notes || ''} emptyLabel="—" />
                    <AttachmentPreviewList entries={attachments.filter((a) => a.no_trade_day_id === n.id)} signedUrls={reviewSignedUrls} onOpenImage={(url, name) => setLightbox({ url, name })} />
                  </article>
                ))}
                {weekSessions.map((s) => (
                  <article key={s.id} className="trade">
                    <div className="small muted">{s.session_date} · {sessionSubtypeLabel(s.session_type)}</div>
                    <div className="small">{s.start_time.slice(0, 5)}-{s.end_time.slice(0, 5)} · {s.duration_minutes}m</div>
                    <div className="small muted">Attachments: {attachments.filter((a) => a.session_id === s.id).length}</div>
                    <div className="small">Notes:</div>
                    <RichTextContent value={s.notes || ''} emptyLabel="—" />
                    <AttachmentPreviewList entries={attachments.filter((a) => a.session_id === s.id)} signedUrls={reviewSignedUrls} onOpenImage={(url, name) => setLightbox({ url, name })} />
                  </article>
                ))}
                {!weekTradesForReview.length && !weekNoTrades.length && !weekSessions.length && <div className="small muted">No entries for selected week and trade-type filter.</div>}
              </div>
            ) : null}
          </section>
          <button className="primary" onClick={() => startTransition(() => void saveReview())} disabled={pending}>Save review</button>
        </section>
      )}

      {openHelp && (
        <>
          <button className="help-backdrop" aria-label="Close help" type="button" onClick={() => setOpenHelp(null)} />
          <section className="card stack help-modal">
          <div className="row">
            <strong>
              {openHelp === 'classification'
                ? 'Trade classification definitions'
                : openHelp === 'family'
                  ? 'Setup family definitions'
                  : openHelp === 'entry_emotion'
                    ? 'Entry emotion definitions'
                    : openHelp === 'in_trade_emotion'
                      ? 'In-trade emotion definitions'
                      : openHelp === 'no_trade_mindset'
                        ? 'No-trade mindset definitions'
                        : 'Setup model definitions'}
            </strong>
            <button className="inline" type="button" onClick={() => setOpenHelp(null)}>Close</button>
          </div>
          {activeHelpItems.map(([title, text]) => (
            <article key={title} className="trade">
              <strong>{title}</strong>
              <div className="small muted" style={{ marginTop: 6 }}>{text}</div>
            </article>
          ))}
          {openHelp === 'classification' && (
            <article className="trade" style={{ borderColor: '#4f6ea6' }}>
              <strong>When to use N/A</strong>
              <div className="small muted" style={{ marginTop: 6 }}>{helpNote}</div>
            </article>
          )}
          </section>
        </>
      )}

      {lightbox && (
        <>
          <button className="help-backdrop" aria-label="Close image preview" type="button" onClick={() => setLightbox(null)} />
          <section className="card stack help-modal" style={{ maxWidth: 900 }}>
            <div className="row">
              <strong>{lightbox.name}</strong>
              <button className="inline" type="button" onClick={() => setLightbox(null)}>Close</button>
            </div>
            <img src={lightbox.url} alt={lightbox.name} style={{ width: '100%', maxHeight: '70vh', objectFit: 'contain', borderRadius: 12 }} />
            <div className="row">
              <a href={lightbox.url} target="_blank" rel="noreferrer">
                <span className="chip">Open full image</span>
              </a>
              <a href={lightbox.url} download={lightbox.name}>
                <span className="chip">Download</span>
              </a>
            </div>
          </section>
        </>
      )}

      {error ? <div className="error">{error}</div> : null}

      <nav className="bottom">
        <div className="nav">
          {tabs.map((t) => (
            <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>{titleCase(t)}</button>
          ))}
        </div>
      </nav>
    </main>
  );
}

function RichTextEditor({
  label,
  helperText,
  value,
  onChange,
  placeholder,
  minRows = 4
}: {
  label: string;
  helperText?: string;
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  minRows?: number;
}) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [textValue, setTextValue] = useState(() => toEditorText(value || ''));

  useEffect(() => {
    const next = toEditorText(value || '');
    setTextValue((prev) => (prev === next ? prev : next));
  }, [value]);

  function applyMutation(
    transform: (source: string, start: number, end: number) => { text: string; nextStart?: number; nextEnd?: number },
    options?: { collapseSelection?: boolean }
  ) {
    const node = textareaRef.current;
    if (!node) return;
    const start = node.selectionStart ?? 0;
    const end = node.selectionEnd ?? 0;
    const next = transform(textValue, start, end);
    setTextValue(next.text);
    onChange(next.text);
    requestAnimationFrame(() => {
      if (!textareaRef.current) return;
      const nextStart = next.nextStart ?? start;
      const nextEnd = options?.collapseSelection ? nextStart : (next.nextEnd ?? end);
      textareaRef.current.focus();
      textareaRef.current.setSelectionRange(nextStart, nextEnd);
    });
  }

  const controls: Array<{ key: string; icon: string; label: string; run: () => void }> = [
    { key: 'bold', icon: 'B', label: 'Bold', run: () => applyMutation((source, start, end) => wrapWithToken(source, start, end, '**')) },
    { key: 'underline', icon: 'U', label: 'Underline', run: () => applyMutation((source, start, end) => wrapWithToken(source, start, end, '__')) },
    { key: 'bullet', icon: '•', label: 'Bullet list', run: () => applyMutation((source, start, end) => applyListActivation(source, start, end, 'bullet'), { collapseSelection: true }) },
    { key: 'number', icon: '1.', label: 'Numbered list', run: () => applyMutation((source, start, end) => applyListActivation(source, start, end, 'numbered'), { collapseSelection: true }) },
    { key: 'indent', icon: '→', label: 'Indent', run: () => applyMutation((source, start, end) => indentLines(source, start, end, 2), { collapseSelection: true }) },
    { key: 'outdent', icon: '←', label: 'Outdent', run: () => applyMutation((source, start, end) => indentLines(source, start, end, -2), { collapseSelection: true }) }
  ];

  function handleEnterListContinuation(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== 'Enter' || event.shiftKey || event.altKey || event.metaKey || event.ctrlKey) return;
    const node = textareaRef.current;
    if (!node) return;
    const start = node.selectionStart ?? 0;
    const end = node.selectionEnd ?? 0;
    if (start !== end) return;
    const lineStart = textValue.lastIndexOf('\n', start - 1) + 1;
    const nextBreak = textValue.indexOf('\n', start);
    const lineEnd = nextBreak === -1 ? textValue.length : nextBreak;
    const line = textValue.slice(lineStart, lineEnd);

    const bulletMatch = line.match(/^(\s*)-\s+(.*)$/);
    if (bulletMatch) {
      event.preventDefault();
      const indent = bulletMatch[1] || '';
      const content = bulletMatch[2] || '';
      if (!content.trim()) {
        const nextText = `${textValue.slice(0, lineStart)}${indent}${textValue.slice(lineEnd)}`;
        setTextValue(nextText);
        onChange(nextText);
        requestAnimationFrame(() => {
          textareaRef.current?.setSelectionRange(lineStart + indent.length, lineStart + indent.length);
        });
        return;
      }
      const insertion = `\n${indent}- `;
      const nextText = `${textValue.slice(0, start)}${insertion}${textValue.slice(end)}`;
      const cursor = start + insertion.length;
      setTextValue(nextText);
      onChange(nextText);
      requestAnimationFrame(() => {
        textareaRef.current?.setSelectionRange(cursor, cursor);
      });
      return;
    }

    const numberedMatch = line.match(/^(\s*)(\d+)\.\s+(.*)$/);
    if (numberedMatch) {
      event.preventDefault();
      const indent = numberedMatch[1] || '';
      const currentNumber = Number(numberedMatch[2] || 1);
      const content = numberedMatch[3] || '';
      if (!content.trim()) {
        const nextText = `${textValue.slice(0, lineStart)}${indent}${textValue.slice(lineEnd)}`;
        setTextValue(nextText);
        onChange(nextText);
        requestAnimationFrame(() => {
          textareaRef.current?.setSelectionRange(lineStart + indent.length, lineStart + indent.length);
        });
        return;
      }
      const insertion = `\n${indent}${currentNumber + 1}. `;
      const nextText = `${textValue.slice(0, start)}${insertion}${textValue.slice(end)}`;
      const cursor = start + insertion.length;
      setTextValue(nextText);
      onChange(nextText);
      requestAnimationFrame(() => {
        textareaRef.current?.setSelectionRange(cursor, cursor);
      });
    }
  }

  return (
    <div className="stack editor-shell">
      <label className="small muted">{label}</label>
      {helperText ? <div className="small muted editor-helper">{helperText}</div> : null}
      <div className="editor-toolbar" role="toolbar" aria-label="Formatting controls">
        {controls.map((control) => (
          <button
            key={control.key}
            className="inline editor-tool-btn"
            type="button"
            title={control.label}
            aria-label={control.label}
            onMouseDown={(event) => event.preventDefault()}
            onClick={control.run}
          >
            {control.icon}
          </button>
        ))}
      </div>
      <textarea
        className="editor-textarea"
        ref={textareaRef}
        value={textValue}
        onChange={(event) => {
          setTextValue(event.target.value);
          onChange(event.target.value);
        }}
        onKeyDown={handleEnterListContinuation}
        placeholder={placeholder}
        rows={minRows}
        style={{ minHeight: `${Math.max(120, minRows * 26)}px` }}
      />
      <div className="small muted editor-footnote">Stable mobile editor mode: formatting actions apply to selected text/lines in this same writing area.</div>
    </div>
  );
}

function RichTextContent({ value, emptyLabel = '—' }: { value: string; emptyLabel?: string }) {
  const html = toDisplayHtml(value || '');
  if (!html.trim()) return <div className="small muted">{emptyLabel}</div>;
  return <div className="small rich-content" dangerouslySetInnerHTML={{ __html: html }} />;
}

function AttachmentPreviewList({ entries, signedUrls, onOpenImage }: { entries: AttachmentRow[]; signedUrls: Record<string, string>; onOpenImage: (url: string, name: string) => void }) {
  if (!entries.length) {
    return <div className="small muted">No attachments saved for this entry.</div>;
  }

  return (
    <div className="stack">
      <div className="small muted">Attachments</div>
      {entries.map((file) => {
        const url = signedUrls[file.file_path];
        const image = isImageFile(file);
        return (
          <article key={file.id} className="trade">
            <div className="small">{file.file_name}</div>
            <div className="small muted">{file.mime_type} · {formatFileSize(file.byte_size)}</div>
            {!url ? (
              <div className="small muted">Preparing secure link...</div>
            ) : image ? (
              <div className="stack" style={{ marginTop: 8 }}>
                <button type="button" style={{ padding: 0, border: 0, background: 'transparent' }} onClick={() => onOpenImage(url, file.file_name)}>
                  <img src={url} alt={file.file_name} style={{ width: '100%', borderRadius: 10 }} />
                </button>
                <div className="row">
                  <button className="inline" type="button" onClick={() => onOpenImage(url, file.file_name)}>View image</button>
                  <a href={url} download={file.file_name}>
                    <span className="chip">Download</span>
                  </a>
                </div>
              </div>
            ) : (
              <div className="row" style={{ marginTop: 8 }}>
                <a href={url} target="_blank" rel="noreferrer">
                  <span className="chip">Open attachment</span>
                </a>
                <a href={url} download={file.file_name}>
                  <span className="chip">Download</span>
                </a>
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}

type TimelinePoint = {
  key: string;
  label: string;
  start: string;
  end: string;
  dailyPnl: number;
  dailyR: number;
  tradeCount: number;
  chartMinutes: number;
  journalMinutes: number;
  totalSessionMinutes: number;
  explicitNoTrade: boolean;
  bucketType: 'day' | 'week';
};

function PerformanceChart({
  points,
  view,
  showROverlay,
  showTradeCountOverlay,
  showChartTimeOverlay,
  showJournalTimeOverlay,
  showSessionTimeOverlay,
  rightAxisMode
}: {
  points: TimelinePoint[];
  view: 'daily' | 'cumulative';
  showROverlay: boolean;
  showTradeCountOverlay: boolean;
  showChartTimeOverlay: boolean;
  showJournalTimeOverlay: boolean;
  showSessionTimeOverlay: boolean;
  rightAxisMode: 'r' | 'trade_count' | 'chart_time' | 'journal_time' | 'session_time';
}) {
  const [activeIndex, setActiveIndex] = useState<number | null>(points.length ? points.length - 1 : null);
  if (!points.length) return <div className="small muted">No data in selected period.</div>;
  const mainSeries = points.map((point, idx) => {
    const prefix = points.slice(0, idx + 1);
    return view === 'cumulative' ? prefix.reduce((sum, item) => sum + item.dailyPnl, 0) : point.dailyPnl;
  });
  const rSeries = points.map((point, idx) => {
    const prefix = points.slice(0, idx + 1);
    return view === 'cumulative' ? prefix.reduce((sum, item) => sum + item.dailyR, 0) : point.dailyR;
  });
  const values = mainSeries;
  const maxAbs = Math.max(1, ...values.map((v) => Math.abs(v)), 0.01);
  const yMax = Math.ceil(maxAbs * 1.2 * 10) / 10;
  const yMin = -yMax;
  const chartHeight = 170;
  const width = 340;
  const plotLeft = 42;
  const plotRight = width - 14;
  const plotTop = 12;
  const plotBottom = chartHeight - 32;
  const plotHeight = plotBottom - plotTop;
  const plotWidth = plotRight - plotLeft;
  const baseline = mapValueToY(0, yMin, yMax, plotTop, plotBottom);
  const maxTradeCount = Math.max(1, ...points.map((p) => p.tradeCount));
  const maxRAbs = Math.max(1, ...rSeries.map((v) => Math.abs(v)), 0.01);
  const chartMinutesSeries = points.map((point, idx) => {
    const prefix = points.slice(0, idx + 1);
    return view === 'cumulative' ? prefix.reduce((sum, item) => sum + item.chartMinutes, 0) : point.chartMinutes;
  });
  const journalMinutesSeries = points.map((point, idx) => {
    const prefix = points.slice(0, idx + 1);
    return view === 'cumulative' ? prefix.reduce((sum, item) => sum + item.journalMinutes, 0) : point.journalMinutes;
  });
  const sessionMinutesSeries = points.map((point, idx) => {
    const prefix = points.slice(0, idx + 1);
    return view === 'cumulative' ? prefix.reduce((sum, item) => sum + item.totalSessionMinutes, 0) : point.totalSessionMinutes;
  });
  const maxSessionMinutes = Math.max(1, ...sessionMinutesSeries, ...chartMinutesSeries, ...journalMinutesSeries);
  const xForIndex = (idx: number) => plotLeft + (idx / Math.max(1, points.length - 1)) * plotWidth;
  const yForValue = (value: number) => mapValueToY(value, yMin, yMax, plotTop, plotBottom);
  const polyline = points.map((point, idx) => {
    const x = xForIndex(idx);
    const y = yForValue(mainSeries[idx]);
    return `${x},${y}`;
  }).join(' ');
  const rPolyline = points.map((point, idx) => {
    const x = xForIndex(idx);
    const y = mapValueToY(rSeries[idx], -maxRAbs * 1.2, maxRAbs * 1.2, plotTop, plotBottom);
    return `${x},${y}`;
  }).join(' ');
  const xTickIndexes = buildAxisTickIndexes(points.length, 5);
  const yTicks = [yMax, yMax / 2, 0, yMin / 2, yMin];
  const tradeCountTicks = [maxTradeCount, Math.ceil(maxTradeCount / 2), 0];
  const enabledRightMetrics = [
    showROverlay ? 'r' : null,
    showTradeCountOverlay ? 'trade_count' : null,
    showChartTimeOverlay ? 'chart_time' : null,
    showJournalTimeOverlay ? 'journal_time' : null,
    showSessionTimeOverlay ? 'session_time' : null
  ].filter(Boolean) as Array<'r' | 'trade_count' | 'chart_time' | 'journal_time' | 'session_time'>;
  const rightAxisMetric = enabledRightMetrics.includes(rightAxisMode) ? rightAxisMode : (enabledRightMetrics[0] || null);
  const safeActiveIndex = activeIndex == null ? null : Math.max(0, Math.min(points.length - 1, activeIndex));
  const activePoint = safeActiveIndex != null ? points[safeActiveIndex] : null;
  const activeX = safeActiveIndex != null ? xForIndex(safeActiveIndex) : null;
  const activeY = safeActiveIndex != null ? yForValue(mainSeries[safeActiveIndex]) : null;

  return (
    <div style={{ width: '100%' }}>
      <svg viewBox={`0 0 ${width} ${chartHeight}`} style={{ width: '100%', height: 170, display: 'block' }}>
        {yTicks.map((tick) => {
          const y = yForValue(tick);
          return (
            <g key={`y-${tick}`}>
              <line x1={plotLeft} y1={y} x2={plotRight} y2={y} stroke="#1f2937" strokeWidth={1} />
              <text x={4} y={y + 4} fill="#93a3b8" fontSize={10}>{formatMetricValue(tick, 'pnl')}</text>
            </g>
          );
        })}
        <line x1={plotLeft} y1={baseline} x2={plotRight} y2={baseline} stroke="#2a3445" strokeWidth={1} />
        {view === 'daily' && points.map((point, idx) => {
          if (point.tradeCount === 0) return null;
          const x = xForIndex(idx) - 5;
          const value = mainSeries[idx];
          const barHeight = Math.max(2, Math.abs(value / (yMax || 1)) * (plotHeight / 2 - 2));
          const y = value >= 0 ? baseline - barHeight : baseline;
          return <rect key={`bar-${point.key}`} x={x} y={y} width={10} height={barHeight} fill={value >= 0 ? '#4ad66d' : '#ff6b6b'} rx={2} onMouseEnter={() => setActiveIndex(idx)} onClick={() => setActiveIndex(idx)} />;
        })}
        {view === 'cumulative' && <polyline fill="none" stroke="#70c8ff" strokeWidth={2} points={polyline} />}
        {view === 'cumulative' && points.map((point, idx) => (
          <circle key={`line-hit-${point.key}`} cx={xForIndex(idx)} cy={yForValue(mainSeries[idx])} r={6} fill="transparent" onMouseEnter={() => setActiveIndex(idx)} onClick={() => setActiveIndex(idx)} />
        ))}
        {showROverlay && (
          <>
            <polyline
              fill="none"
              stroke="#94a3b8"
              strokeWidth={rightAxisMetric === 'r' ? 1.7 : 1}
              points={rPolyline}
            />
            {points.map((point, idx) => {
              if (point.tradeCount === 0 && point.explicitNoTrade) return null;
              const x = xForIndex(idx);
              const y = mapValueToY(rSeries[idx], -maxRAbs * 1.2, maxRAbs * 1.2, plotTop, plotBottom);
              return <circle key={`r-${point.key}`} cx={x} cy={y} r={2} fill="#94a3b8" />;
            })}
          </>
        )}
        {showTradeCountOverlay && (
          <>
            <polyline
              fill="none"
              stroke="#a5b4fc"
              strokeWidth={rightAxisMetric === 'trade_count' ? 1.7 : 1}
              points={points.map((point, idx) => `${xForIndex(idx)},${mapValueToY(point.tradeCount, 0, maxTradeCount, plotTop, plotBottom)}`).join(' ')}
            />
            {points.map((point, idx) => {
              const x = xForIndex(idx);
              const y = mapValueToY(point.tradeCount, 0, maxTradeCount, plotTop, plotBottom);
              return point.tradeCount > 0 ? <circle key={`count-${point.key}`} cx={x} cy={y} r={2.5} fill="#c7d2fe" /> : null;
            })}
          </>
        )}
        {showChartTimeOverlay && (
          <>
            <polyline
              fill="none"
              stroke="#facc15"
              strokeWidth={rightAxisMetric === 'chart_time' ? 1.7 : 1}
              points={points.map((point, idx) => `${xForIndex(idx)},${mapValueToY(chartMinutesSeries[idx], 0, maxSessionMinutes, plotTop, plotBottom)}`).join(' ')}
            />
            {points.map((point, idx) => {
              const x = xForIndex(idx);
              const y = mapValueToY(chartMinutesSeries[idx], 0, maxSessionMinutes, plotTop, plotBottom);
              return chartMinutesSeries[idx] > 0 ? <circle key={`chart-time-${point.key}`} cx={x} cy={y} r={2.2} fill="#fde68a" /> : null;
            })}
          </>
        )}
        {showJournalTimeOverlay && (
          <>
            <polyline
              fill="none"
              stroke="#2dd4bf"
              strokeWidth={rightAxisMetric === 'journal_time' ? 1.7 : 1}
              points={points.map((point, idx) => `${xForIndex(idx)},${mapValueToY(journalMinutesSeries[idx], 0, maxSessionMinutes, plotTop, plotBottom)}`).join(' ')}
            />
            {points.map((point, idx) => {
              const x = xForIndex(idx);
              const y = mapValueToY(journalMinutesSeries[idx], 0, maxSessionMinutes, plotTop, plotBottom);
              return journalMinutesSeries[idx] > 0 ? <circle key={`journal-time-${point.key}`} cx={x} cy={y} r={2.2} fill="#99f6e4" /> : null;
            })}
          </>
        )}
        {showSessionTimeOverlay && (
          <>
            <polyline
              fill="none"
              stroke="#f59e0b"
              strokeWidth={rightAxisMetric === 'session_time' ? 1.8 : 1}
              points={points.map((point, idx) => `${xForIndex(idx)},${mapValueToY(sessionMinutesSeries[idx], 0, maxSessionMinutes, plotTop, plotBottom)}`).join(' ')}
            />
            {points.map((point, idx) => {
              const x = xForIndex(idx);
              const y = mapValueToY(sessionMinutesSeries[idx], 0, maxSessionMinutes, plotTop, plotBottom);
              return sessionMinutesSeries[idx] > 0 ? <circle key={`session-time-${point.key}`} cx={x} cy={y} r={2.5} fill="#fcd34d" /> : null;
            })}
          </>
        )}
        {rightAxisMetric === 'trade_count' && tradeCountTicks.map((tick) => {
          const y = mapValueToY(tick, 0, maxTradeCount, plotTop, plotBottom);
          return <text key={`right-y-count-${tick}`} x={plotRight + 4} y={y + 4} fill="#9aa7d1" fontSize={10}>{tick}</text>;
        })}
        {rightAxisMetric === 'r' && [maxRAbs, maxRAbs / 2, 0, -maxRAbs / 2, -maxRAbs].map((tick) => {
          const y = mapValueToY(tick, -maxRAbs * 1.2, maxRAbs * 1.2, plotTop, plotBottom);
          return <text key={`right-y-r-${tick}`} x={plotRight + 4} y={y + 4} fill="#9aa7d1" fontSize={10}>{formatMetricValue(tick, 'r')}</text>;
        })}
        {(rightAxisMetric === 'chart_time' || rightAxisMetric === 'journal_time' || rightAxisMetric === 'session_time') && [maxSessionMinutes, Math.ceil(maxSessionMinutes / 2), 0].map((tick) => {
          const y = mapValueToY(tick, 0, maxSessionMinutes, plotTop, plotBottom);
          return <text key={`right-y-time-${tick}`} x={plotRight + 4} y={y + 4} fill="#9aa7d1" fontSize={10}>{formatMinutesLabel(tick)}</text>;
        })}
        {points.map((point, idx) => {
          if (!point.explicitNoTrade) return null;
          const x = xForIndex(idx) - 3;
          return <line key={`nt-${point.key}`} x1={x} y1={plotBottom + 6} x2={x + 6} y2={plotBottom + 6} stroke="#9ca3af" strokeWidth={2} />;
        })}
        {xTickIndexes.map((idx) => {
          const point = points[idx];
          const x = xForIndex(idx);
          return (
            <g key={`x-${point.key}`}>
              <line x1={x} y1={plotBottom} x2={x} y2={plotBottom + 4} stroke="#475569" />
              <text x={x} y={chartHeight - 8} fill="#93a3b8" fontSize={10} textAnchor="middle">{point.label}</text>
            </g>
          );
        })}
        {activePoint && activeX != null && activeY != null && (
          <>
            <line x1={activeX} y1={plotTop} x2={activeX} y2={plotBottom} stroke="#64748b" strokeDasharray="3 3" />
            <circle cx={activeX} cy={activeY} r={3.5} fill="#e2e8f0" />
          </>
        )}
      </svg>
      {activePoint && (
        <div className="small muted" style={{ marginTop: 4 }}>
          <strong>{formatLongDate(activePoint.start)}{activePoint.bucketType === 'week' ? ` – ${formatLongDate(activePoint.end)}` : ''}</strong>
          {' · '}
          <span>P&L {formatMetricValue(view === 'cumulative' ? mainSeries[safeActiveIndex ?? 0] : activePoint.dailyPnl, 'pnl')}</span>
          {' · '}
          <span>R {(view === 'cumulative' ? rSeries[safeActiveIndex ?? 0] : activePoint.dailyR).toFixed(2)}R</span>
          {' · '}
          <span>Trades {activePoint.tradeCount}</span>
          {(showChartTimeOverlay || showSessionTimeOverlay || rightAxisMetric === 'chart_time') ? <><span>{' · '}</span><span>Chart {formatMinutesLabel(view === 'cumulative' ? chartMinutesSeries[safeActiveIndex ?? 0] : activePoint.chartMinutes)}</span></> : null}
          {(showJournalTimeOverlay || showSessionTimeOverlay || rightAxisMetric === 'journal_time') ? <><span>{' · '}</span><span>Journal {formatMinutesLabel(view === 'cumulative' ? journalMinutesSeries[safeActiveIndex ?? 0] : activePoint.journalMinutes)}</span></> : null}
          {(showSessionTimeOverlay || rightAxisMetric === 'session_time') ? <><span>{' · '}</span><span>Total session {formatMinutesLabel(view === 'cumulative' ? sessionMinutesSeries[safeActiveIndex ?? 0] : activePoint.totalSessionMinutes)}</span></> : null}
          {' · '}
          <span>{activePoint.tradeCount > 0 ? 'Trade day' : activePoint.explicitNoTrade ? 'Explicit no-trade day' : 'Blank day (no logged activity)'}</span>
        </div>
      )}
      <div className="small muted">Legend: green +$, red -$, gray tick explicit no-trade, empty = blank day{showROverlay ? ' · slate line = R' : ''}{showTradeCountOverlay ? ' · lavender = trade count' : ''}{showChartTimeOverlay ? ' · yellow = chart time' : ''}{showJournalTimeOverlay ? ' · teal = journal time' : ''}{showSessionTimeOverlay ? ' · amber = total session time' : ''}{rightAxisMetric === 'r' ? ' · right axis: R' : rightAxisMetric === 'trade_count' ? ' · right axis: trade count' : rightAxisMetric === 'chart_time' ? ' · right axis: chart time' : rightAxisMetric === 'journal_time' ? ' · right axis: journal time' : rightAxisMetric === 'session_time' ? ' · right axis: total session time' : ''}.</div>
    </div>
  );
}

function buildChartBuckets(start: string, end: string, periodTrades: TradeRow[], periodNoTrades: NoTradeDayRow[], periodSessions: SessionRow[], periodType: DashboardPeriod): TimelinePoint[] {
  const dates = enumerateDates(start, end);
  if (periodType === 'weekly' || periodType === 'monthly') {
    return dates.map((date) => {
      const dayTrades = periodTrades.filter((t) => t.trade_date === date);
      const daySessions = periodSessions.filter((s) => s.session_date === date);
      const chartMinutes = daySessions.filter((s) => s.session_type === 'chart').reduce((sum, s) => sum + Number(s.duration_minutes || 0), 0);
      const journalMinutes = daySessions.filter((s) => s.session_type === 'journal').reduce((sum, s) => sum + Number(s.duration_minutes || 0), 0);
      return {
        key: date,
        label: formatAxisDate(date),
        start: date,
        end: date,
        dailyPnl: dayTrades.reduce((sum, t) => sum + Number(t.pnl || 0), 0),
        dailyR: dayTrades.reduce((sum, t) => sum + Number(t.r_multiple || 0), 0),
        tradeCount: dayTrades.length,
        chartMinutes,
        journalMinutes,
        totalSessionMinutes: chartMinutes + journalMinutes,
        explicitNoTrade: periodNoTrades.some((n) => n.day_date === date),
        bucketType: 'day'
      };
    });
  }
  const weeks = new Map<string, { start: string; end: string; dates: string[] }>();
  dates.forEach((date) => {
    const key = sundayWeekStart(date);
    const existing = weeks.get(key);
    if (existing) {
      existing.end = date;
      existing.dates.push(date);
    } else {
      weeks.set(key, { start: date, end: date, dates: [date] });
    }
  });
  return Array.from(weeks.entries()).map(([key, value]) => {
    const bucketTrades = periodTrades.filter((t) => value.dates.includes(t.trade_date));
    const bucketSessions = periodSessions.filter((s) => value.dates.includes(s.session_date));
    const chartMinutes = bucketSessions.filter((s) => s.session_type === 'chart').reduce((sum, s) => sum + Number(s.duration_minutes || 0), 0);
    const journalMinutes = bucketSessions.filter((s) => s.session_type === 'journal').reduce((sum, s) => sum + Number(s.duration_minutes || 0), 0);
    const hasNoTrade = periodNoTrades.some((n) => value.dates.includes(n.day_date));
    return {
      key,
      label: formatAxisDate(value.start),
      start: value.start,
      end: value.end,
      dailyPnl: bucketTrades.reduce((sum, t) => sum + Number(t.pnl || 0), 0),
      dailyR: bucketTrades.reduce((sum, t) => sum + Number(t.r_multiple || 0), 0),
      tradeCount: bucketTrades.length,
      chartMinutes,
      journalMinutes,
      totalSessionMinutes: chartMinutes + journalMinutes,
      explicitNoTrade: hasNoTrade,
      bucketType: 'week'
    };
  });
}

function enumerateDates(start: string, end: string) {
  const out: string[] = [];
  const cursor = new Date(`${start}T00:00:00Z`);
  const last = new Date(`${end}T00:00:00Z`);
  while (cursor <= last) {
    out.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

function buildPeriodJumpOptions(period: DashboardPeriod, anchor: Date) {
  if (period === 'lifetime') {
    const selectedAnchor = new Date();
    return {
      selected: 'all_time',
      options: [{ value: 'all_time', label: 'All time (lifetime)', anchor: selectedAnchor }]
    };
  }
  const options: Array<{ value: string; label: string; anchor: Date }> = [];
  const selectedAnchor = normalizeAnchorForPeriod(period, anchor);
  const selected = jumpValueForAnchor(period, selectedAnchor);
  const now = new Date();
  const latestYear = now.getUTCFullYear() + 1;
  const earliestYear = now.getUTCFullYear() - 10;

  if (period === 'weekly') {
    const latestWeekStart = sundayWeekStart(`${latestYear}-12-31`);
    const earliestWeekStart = sundayWeekStart(`${earliestYear}-01-01`);
    let cursor = latestWeekStart;
    while (cursor >= earliestWeekStart) {
      const next = new Date(`${cursor}T00:00:00Z`);
      options.push({
        value: jumpValueForAnchor(period, next),
        label: formatPeriodLabel(period, next, getPeriodRange(period, next).start, getPeriodRange(period, next).end),
        anchor: normalizeAnchorForPeriod(period, next)
      });
      cursor = addDaysKey(cursor, -7);
    }
  } else if (period === 'monthly') {
    for (let y = latestYear; y >= earliestYear; y -= 1) {
      for (let m = 11; m >= 0; m -= 1) {
        const next = new Date(Date.UTC(y, m, 1));
        options.push({
          value: jumpValueForAnchor(period, next),
          label: formatPeriodLabel(period, next, getPeriodRange(period, next).start, getPeriodRange(period, next).end),
          anchor: next
        });
      }
    }
  } else if (period === 'quarterly') {
    for (let y = latestYear; y >= earliestYear; y -= 1) {
      for (let q = 3; q >= 0; q -= 1) {
        const next = new Date(Date.UTC(y, q * 3, 1));
        options.push({
          value: jumpValueForAnchor(period, next),
          label: formatPeriodLabel(period, next, getPeriodRange(period, next).start, getPeriodRange(period, next).end),
          anchor: next
        });
      }
    }
  } else {
    for (let y = latestYear; y >= earliestYear; y -= 1) {
      const next = period === 'annual' ? new Date(Date.UTC(y, 0, 1)) : anchorForYtdYear(y);
      options.push({
        value: jumpValueForAnchor(period, next),
        label: formatPeriodLabel(period, next, getPeriodRange(period, next).start, getPeriodRange(period, next).end),
        anchor: next
      });
    }
  }

  if (!options.some((opt) => opt.value === selected)) {
    options.unshift({
      value: selected,
      label: formatPeriodLabel(period, selectedAnchor, getPeriodRange(period, selectedAnchor).start, getPeriodRange(period, selectedAnchor).end),
      anchor: selectedAnchor
    });
  }
  return { selected, options };
}

function jumpValueForAnchor(period: DashboardPeriod, anchor: Date) {
  if (period === 'lifetime') return 'all_time';
  if (period === 'weekly') return weekKeyFromDate(anchor.toISOString().slice(0, 10));
  if (period === 'monthly') return `${anchor.getUTCFullYear()}-${String(anchor.getUTCMonth() + 1).padStart(2, '0')}`;
  if (period === 'quarterly') return `${anchor.getUTCFullYear()}-Q${Math.floor(anchor.getUTCMonth() / 3) + 1}`;
  return String(anchor.getUTCFullYear());
}

function normalizeAnchorForPeriod(period: DashboardPeriod, anchor: Date) {
  if (period === 'lifetime') return new Date();
  if (period === 'weekly') return new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), anchor.getUTCDate()));
  if (period === 'monthly') return new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1));
  if (period === 'quarterly') return new Date(Date.UTC(anchor.getUTCFullYear(), Math.floor(anchor.getUTCMonth() / 3) * 3, 1));
  if (period === 'annual') return new Date(Date.UTC(anchor.getUTCFullYear(), 0, 1));
  return anchorForYtdYear(anchor.getUTCFullYear());
}

function chunkCalendarWeeks<T>(cells: T[]) {
  const rows: T[][] = [];
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));
  return rows;
}

function formatShortDate(dateStr: string) {
  const date = new Date(`${dateStr}T00:00:00Z`);
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function formatAxisDate(dateStr: string) {
  const date = new Date(`${dateStr}T00:00:00Z`);
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function formatDateShort(dateStr: string) {
  const date = new Date(`${dateStr}T00:00:00Z`);
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

function isChartSessionType(sessionType: string) {
  return sessionType === 'chart' || sessionType === 'chart_session' || sessionType === 'pre_session_plan';
}

function sessionSubtypeLabel(sessionType: string) {
  if (sessionType === 'pre_session_plan') return 'Pre-session plan';
  if (sessionType === 'chart_session' || sessionType === 'chart') return 'Chart session';
  if (sessionType === 'post_session_review' || sessionType === 'journal') return 'Post-session review';
  return titleCase(String(sessionType || 'session').replace(/_/g, ' '));
}

function sundayWeekStart(dateStr: string) {
  const date = new Date(`${dateStr}T00:00:00Z`);
  const day = date.getUTCDay();
  date.setUTCDate(date.getUTCDate() - day);
  return date.toISOString().slice(0, 10);
}

function addDaysKey(dateStr: string, days: number) {
  const date = new Date(`${dateStr}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function formatLongDate(dateStr: string) {
  const date = new Date(`${dateStr}T00:00:00Z`);
  return date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

function formatMetricValue(value: number, metric: 'pnl' | 'r') {
  return metric === 'pnl' ? `${value >= 0 ? '+' : ''}$${value.toFixed(2)}` : `${value >= 0 ? '+' : ''}${value.toFixed(2)}R`;
}

function mapValueToY(value: number, min: number, max: number, top: number, bottom: number) {
  if (max === min) return (top + bottom) / 2;
  const ratio = (value - min) / (max - min);
  return bottom - ratio * (bottom - top);
}

function pnlValueColor(value: number) {
  if (Number(value || 0) > 0) return '#4ad66d';
  if (Number(value || 0) < 0) return '#ff6b6b';
  return '#93a3b8';
}

function rValueColor(value: number) {
  return pnlValueColor(value);
}

function emotionalPressureColor(value: number | null | undefined) {
  const level = Number(value || 0);
  if (level >= 3) return '#ff6b6b';
  if (level >= 1) return '#4ad66d';
  return '#93a3b8';
}

function buildAxisTickIndexes(length: number, targetTicks: number) {
  if (length <= 1) return [0];
  if (length <= targetTicks) return Array.from({ length }, (_, idx) => idx);
  const out = new Set<number>([0, length - 1]);
  const step = (length - 1) / (targetTicks - 1);
  for (let i = 1; i < targetTicks - 1; i += 1) {
    out.add(Math.round(i * step));
  }
  return Array.from(out).sort((a, b) => a - b);
}

function titleCase(v: string) {
  return v[0].toUpperCase() + v.slice(1);
}

function isImageFile(file: AttachmentRow) {
  return file.mime_type?.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(file.file_name);
}

function formatFileSize(bytes: number) {
  if (!bytes || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function extractTradeSuggestions(files: File[], onOcrDebug?: (debug: OcrDebugState) => void): Promise<TradeExtractSuggestions> {
  const out: TradeExtractSuggestions = {};
  const hints: string[] = [];
  const text = files.map((f) => `${f.name} ${f.type}`).join(' ');

  Object.assign(out, parseTradeText(text));
  if (out.ticker && !out.tickerSource) out.tickerSource = 'metadata';
  hints.push(...extractContextHints(text));

  if (/fomo/i.test(text)) hints.push('FOMO mention found');
  if (/forced/i.test(text)) hints.push('Forced-trade mention found');
  if (/news/i.test(text)) hints.push('News mention found');

  const ocrResult = await extractTextFromImages(files, onOcrDebug);
  out.ocrStatus = ocrResult.status;
  out.ocrCharCount = ocrResult.charCount;
  out.ocrError = ocrResult.error;
  out.ocrSteps = ocrResult.steps;
  out.headerOcrText = ocrResult.headerText;
  const ocrText = ocrResult.text;
  const combinedOcrText = [ocrResult.headerText, ocrText].filter(Boolean).join('\n');
  if (combinedOcrText) {
    const parsedFromImage = parseTradeText(combinedOcrText, ocrResult.headerText);
    out.trade_date = out.trade_date || parsedFromImage.trade_date;
    out.ticker = out.ticker || parsedFromImage.ticker;
    out.pnl = out.pnl || parsedFromImage.pnl;
    out.r_multiple = out.r_multiple || parsedFromImage.r_multiple;
    out.minutes_in_trade = out.minutes_in_trade || parsedFromImage.minutes_in_trade;
    out.parsedHeaderLine = out.parsedHeaderLine || parsedFromImage.parsedHeaderLine;
    out.tickerRejectReason = out.ticker ? undefined : (parsedFromImage.tickerRejectReason || out.tickerRejectReason);
    out.tickerSource = out.ticker ? (parsedFromImage.tickerSource || 'full_ocr') : 'none';
    out.detectedText = ocrText;
    hints.push(...extractContextHints(combinedOcrText));
    hints.push('OCR text extracted from image');
  } else if (files.some((f) => f.type.startsWith('image/'))) {
    hints.push('No OCR text found from image content (beta)');
  }

  if (hints.length) out.hints = hints;
  return out;
}

async function extractNoTradeSuggestions(files: File[], onOcrDebug?: (debug: OcrDebugState) => void): Promise<NoTradeExtractSuggestions> {
  const out: NoTradeExtractSuggestions = {};
  const hints: string[] = [];
  const text = files.map((f) => `${f.name} ${f.type}`).join(' ');

  const fromMeta = parseNoTradeText(text);
  out.day_date = fromMeta.day_date;
  out.reason = fromMeta.reason;
  out.parsedHeaderLine = fromMeta.parsedHeaderLine;

  const reasonMap: Array<{ test: RegExp; reason: string }> = [
    { test: /news/i, reason: 'News risk' },
    { test: /chop|choppy|range/i, reason: 'Choppy session' },
    { test: /no[-_ ]?setup|noa\+|no a\+/i, reason: 'No A+ setup' },
    { test: /fatigue|tired/i, reason: 'Not mentally ready' },
    { test: /no\s*trade|didn[’']?t\s*trade|flat\s*today/i, reason: 'No trade taken' },
    { test: /red\s*folder|news\s*event|fomc|cpi|nfp/i, reason: 'News risk' },
    { test: /session\s*over|too\s*late|late\s*entry/i, reason: 'Session over / too late' },
    { test: /not\s*clean|no\s*displacement/i, reason: 'No clear displacement' },
    { test: /didn[’']?t\s*force/i, reason: 'No force trade discipline' }
  ];
  for (const r of reasonMap) {
    if (r.test.test(text)) {
      out.reason = r.reason;
      hints.push(`Detected "${r.reason}" hint`);
      break;
    }
  }
  const ocrResult = await extractTextFromImages(files, onOcrDebug);
  out.ocrStatus = ocrResult.status;
  out.ocrCharCount = ocrResult.charCount;
  out.ocrError = ocrResult.error;
  out.ocrSteps = ocrResult.steps;
  out.headerOcrText = ocrResult.headerText;
  const ocrText = ocrResult.text;
  const combinedOcrText = [ocrResult.headerText, ocrText].filter(Boolean).join('\n');
  if (combinedOcrText) {
    const parsedFromImage = parseNoTradeText(combinedOcrText);
    out.day_date = out.day_date || parsedFromImage.day_date;
    out.reason = out.reason || parsedFromImage.reason;
    out.parsedHeaderLine = out.parsedHeaderLine || parsedFromImage.parsedHeaderLine;
    out.detectedText = ocrText;
    hints.push(...extractContextHints(combinedOcrText));
    hints.push('OCR text extracted from image');
  } else if (files.some((f) => f.type.startsWith('image/'))) {
    hints.push('No OCR text found from image content (beta)');
  }
  if (hints.length) out.hints = hints;
  return out;
}

function parseTradeText(text: string, headerOcrText?: string): TradeExtractSuggestions {
  const out: TradeExtractSuggestions = {};
  const normalized = text.replace(/\r/g, ' ');
  const tickerResult = extractTickerFromScreenshotText(normalized, headerOcrText);
  if (tickerResult.headerLine) out.parsedHeaderLine = tickerResult.headerLine;
  if (tickerResult.ticker) out.ticker = tickerResult.ticker;
  if (!tickerResult.ticker && tickerResult.rejectReason) out.tickerRejectReason = tickerResult.rejectReason;
  out.tickerSource = tickerResult.source || 'none';
  if (tickerResult.microResolutionRule) out.microResolutionRule = tickerResult.microResolutionRule;
  const dateResult = extractDateFromText(normalized, tickerResult.headerLine);
  if (dateResult.date) out.trade_date = dateResult.date;
  if (!out.parsedHeaderLine && dateResult.headerLine) out.parsedHeaderLine = dateResult.headerLine;
  const pnlMatch =
    normalized.match(/(?:pnl|profit|loss|result|net)\s*[:=]?\s*([+-]?\$?\s*\d[\d,]*(?:\.\d+)?)/i) ||
    normalized.match(/([+-]?\$?\s*\d[\d,]*(?:\.\d+)?)\s*(usd|dollars?|\$)\b/i);
  if (pnlMatch) out.pnl = sanitizeNumberToken(pnlMatch[1]);
  const rMatch = normalized.match(/([+-]?\d+(?:\.\d+)?)\s*R\b/i);
  if (rMatch) out.r_multiple = rMatch[1];
  const minutesResult = extractMinutesSuggestion(normalized);
  if (minutesResult.value) out.minutes_in_trade = minutesResult.value;
  if (minutesResult.reason) out.minutesRejectReason = minutesResult.reason;
  if (minutesResult.timeframeRejected) out.timeframeRejected = true;
  return out;
}

function parseNoTradeText(text: string): NoTradeExtractSuggestions {
  const out: NoTradeExtractSuggestions = {};
  const normalized = text.replace(/\r/g, ' ');
  const dateResult = extractDateFromText(normalized);
  if (dateResult.date) out.day_date = dateResult.date;
  if (dateResult.headerLine) out.parsedHeaderLine = dateResult.headerLine;
  const reasonMap: Array<{ test: RegExp; reason: string }> = [
    { test: /news/i, reason: 'News risk' },
    { test: /chop|choppy|range/i, reason: 'Choppy session' },
    { test: /no[-_ ]?setup|noa\+|no a\+/i, reason: 'No A+ setup' },
    { test: /fatigue|tired/i, reason: 'Not mentally ready' },
    { test: /no\s*trade|didn[’']?t\s*trade|flat\s*today/i, reason: 'No trade taken' },
    { test: /red\s*folder|news\s*event|fomc|cpi|nfp/i, reason: 'News risk' },
    { test: /session\s*over|too\s*late|late\s*entry/i, reason: 'Session over / too late' },
    { test: /not\s*clean|no\s*displacement/i, reason: 'No clear displacement' },
    { test: /didn[’']?t\s*force/i, reason: 'No force trade discipline' }
  ];
  for (const r of reasonMap) {
    if (r.test.test(normalized)) {
      out.reason = r.reason;
      break;
    }
  }
  return out;
}

function normalizeDate(value: string): string {
  if (/^20\d{2}[-_./]\d{1,2}[-_./]\d{1,2}$/.test(value)) {
    const [y, m, d] = value.split(/[-_./]/).map((v) => Number(v));
    return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  if (/^\d{1,2}[-/.]\d{1,2}[-/.]20\d{2}$/.test(value)) {
    const [m, d, y] = value.split(/[-/.]/).map((v) => Number(v));
    return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  return value.replace(/[_.]/g, '-').replace(/\//g, '-');
}

function sanitizeNumberToken(value: string): string {
  const cleaned = value.replace(/\s/g, '').replace(/\$/g, '').replace(/,/g, '');
  const match = cleaned.match(/[+-]?\d+(?:\.\d+)?/);
  return match?.[0] || '';
}

const EXCLUDED_TICKER_TOKENS = new Set([
  'CME',
  'CBOT',
  'NYMEX',
  'COMEX',
  'NASDAQ',
  'NYSE',
  'USD',
  'USDT'
]);

const REJECTED_SHORT_TICKERS = new Set(['EA', 'CE', 'ME', 'US', 'TO', 'ON', 'AT', 'IN', 'OF', 'AN', 'OR', 'ET']);

type TickerParseResult = {
  ticker?: string;
  headerLine?: string;
  rejectReason?: string;
  source?: 'header_ocr' | 'full_ocr' | 'metadata' | 'none';
  microResolutionRule?: string;
};

function extractTickerFromScreenshotText(text: string, headerOcrText?: string): TickerParseResult {
  const familyResolution = resolveFuturesFamily([headerOcrText || '', text].join('\n'));
  if (familyResolution.ticker) {
    return {
      ticker: familyResolution.ticker,
      source: headerOcrText?.trim() ? 'header_ocr' : 'full_ocr',
      headerLine: headerOcrText?.split('\n')[0]?.trim(),
      microResolutionRule: familyResolution.rule
    };
  }
  if (headerOcrText?.trim()) {
    const fromCrop = findTickerToken(headerOcrText, true);
    if (fromCrop.ticker) return { ...fromCrop, source: 'header_ocr', headerLine: headerOcrText.split('\n')[0]?.trim() || headerOcrText.trim() };
  }
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
  const tradingViewLine = lines.find((line) =>
    /[·•|]/.test(line) && /(?:\b\d+\b|\b\d+[mhdw]\b|\b(MES|ES|NQ|MNQ|CL|GC)\d*!?\b)/i.test(line)
  );

  if (tradingViewLine) {
    const fromHeader = findTickerToken(tradingViewLine, true);
    if (fromHeader.ticker) return { ...fromHeader, headerLine: tradingViewLine, source: 'full_ocr' };
    if (fromHeader.rejectReason) return { ...fromHeader, headerLine: tradingViewLine, source: 'none' };
  }

  const generic = findTickerToken(text, false);
  if (generic.ticker) return { ...generic, source: 'full_ocr' };
  return { ...generic, source: 'none' };
}

function findTickerToken(text: string, preferLeftmost: boolean): TickerParseResult {
  const futuresMatches = Array.from(text.matchAll(/\b([A-Z0-9!]{2,6})\b/gi));
  if (futuresMatches.length) {
    for (const m of futuresMatches) {
      const recovered = recoverFuturesTicker(m[1]);
      if (recovered) return { ticker: recovered };
    }
  }

  const symbolMatches = Array.from(text.matchAll(/\b[A-Z]{2,6}\d*!?\b/g));
  const ordered = preferLeftmost ? symbolMatches : [...symbolMatches];
  for (const match of ordered) {
    const candidate = normalizeTickerToken(match[0]);
    if (!candidate) continue;
    if (EXCLUDED_TICKER_TOKENS.has(candidate)) {
      return { rejectReason: `Rejected "${candidate}" because it is an exchange/source/currency token.` };
    }
    if (candidate.length < 2 || REJECTED_SHORT_TICKERS.has(candidate)) {
      return { rejectReason: `Rejected "${candidate}" because it looks like OCR junk/short token.` };
    }
    if (candidate.length === 2 && !SUPPORTED_SHORT_TICKERS.has(candidate)) {
      return { rejectReason: `Rejected "${candidate}" because short tickers require stronger confidence.` };
    }
    if (!/^[A-Z]{2,5}$/.test(candidate)) {
      return { rejectReason: `Rejected "${candidate}" because it failed symbol validation.` };
    }
    return { ticker: candidate };
  }
  return { rejectReason: 'No strong ticker candidate found.' };
}

function normalizeTickerToken(raw: string): string {
  const upper = raw.toUpperCase().replace(/[^A-Z0-9!]/g, '');
  if (!upper) return '';
  if (/^(MES|ES|NQ|MNQ|CL|GC)\d*!?$/.test(upper)) {
    return upper.match(/^(MES|ES|NQ|MNQ|CL|GC)/)?.[1] || '';
  }
  if (/^[A-Z]{2,6}\d*!?$/.test(upper)) {
    return upper.replace(/\d+!?$/, '');
  }
  return '';
}

const FUTURES_BASE_TICKERS = ['MES', 'ES', 'NQ', 'MNQ', 'CL', 'GC'] as const;
const SUPPORTED_SHORT_TICKERS = new Set(['ES', 'NQ', 'CL', 'GC']);

function recoverFuturesTicker(raw: string): string {
  const upper = raw.toUpperCase().replace(/[^A-Z0-9!]/g, '');
  if (!upper) return '';
  const cleaned = upper.replace(/[!|]/g, '').replace(/1$/, '').replace(/0/g, 'O').replace(/5/g, 'S').replace(/8/g, 'B');
  for (const ticker of FUTURES_BASE_TICKERS) {
    if (cleaned === ticker) return ticker;
    if (levenshteinDistance(cleaned, ticker) <= 1) return ticker;
    if (cleaned.endsWith(ticker)) return ticker;
  }
  return '';
}

function resolveFuturesFamily(text: string): { ticker?: string; rule?: string } {
  const tokens = Array.from(text.toUpperCase().matchAll(/\b([A-Z0-9!]{2,8})\b/g)).map((m) => m[1]);
  const recovered = new Set<string>();
  for (const token of tokens) {
    const next = recoverFuturesTicker(token);
    if (next) recovered.add(next);
  }
  if (recovered.has('MES')) return { ticker: 'MES', rule: 'Micro contract precedence: MES preferred over ES.' };
  if (recovered.has('MNQ')) return { ticker: 'MNQ', rule: 'Micro contract precedence: MNQ preferred over NQ.' };
  if (recovered.has('ES')) return { ticker: 'ES', rule: 'Standard contract selected (no micro evidence detected).' };
  if (recovered.has('NQ')) return { ticker: 'NQ', rule: 'Standard contract selected (no micro evidence detected).' };
  if (recovered.has('CL')) return { ticker: 'CL', rule: 'Futures normalization applied.' };
  if (recovered.has('GC')) return { ticker: 'GC', rule: 'Futures normalization applied.' };
  return {};
}

function levenshteinDistance(a: string, b: string): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i += 1) dp[i][0] = i;
  for (let j = 0; j <= b.length; j += 1) dp[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }
  return dp[a.length][b.length];
}

type DateParseResult = {
  date?: string;
  headerLine?: string;
};

function extractDateFromText(text: string, preferredHeaderLine?: string): DateParseResult {
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
  const headerLine = preferredHeaderLine || lines.find((line) =>
    /[·•|]/.test(line) && /(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}\/\d{1,2}\/\d{4})/i.test(line)
  );
  const combined = [headerLine || '', text].join('\n');
  const inferredYear = inferYearFromText(combined) || new Date().getFullYear();
  const dateToken = findDateToken(combined, inferredYear);
  return { date: dateToken, headerLine };
}

function inferYearFromText(text: string): number | null {
  const yearMatch = text.match(/\b(20\d{2})\b/);
  if (!yearMatch) return null;
  const y = Number(yearMatch[1]);
  return Number.isFinite(y) ? y : null;
}

function findDateToken(text: string, fallbackYear: number): string {
  const iso = text.match(/\b(20\d{2})[-/.](0?[1-9]|1[0-2])[-/.](0?[1-9]|[12]\d|3[01])\b/);
  if (iso) return normalizeDate(`${iso[1]}-${iso[2]}-${iso[3]}`);
  const slash = text.match(/\b(0?[1-9]|1[0-2])[\/-](0?[1-9]|[12]\d|3[01])[\/-](20\d{2})\b/);
  if (slash) return normalizeDate(`${slash[3]}-${slash[1]}-${slash[2]}`);

  const monthMap: Record<string, number> = {
    jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
    jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12
  };
  const named = text.match(/\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)?\s*(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{1,2})(?:,?\s*(20\d{2}))?\b/i);
  if (named) {
    const month = monthMap[named[1].slice(0, 3).toLowerCase()];
    const day = Number(named[2]);
    const year = Number(named[3] || fallbackYear);
    return normalizeDate(`${year}-${month}-${day}`);
  }
  return '';
}

function extractMinutesSuggestion(text: string): { value?: string; reason?: string; timeframeRejected?: boolean } {
  const strongPatterns = [
    /minutes?\s+in\s+trade\s*[:=]?\s*(\d{1,4})\b/i,
    /held\s+for\s+(\d{1,4})\s*(?:m|min|mins|minutes)\b/i,
    /duration\s*[:=]?\s*(\d{1,4})\s*(?:m|min|mins|minutes)\b/i,
    /time\s+in\s+trade\s*[:=]?\s*(\d{1,4})\s*(?:m|min|mins|minutes)\b/i
  ];
  for (const pattern of strongPatterns) {
    const match = text.match(pattern);
    if (match) {
      return { value: match[1], reason: `Accepted minutes from explicit duration phrase "${match[0]}".` };
    }
  }

  const anyMinuteToken = text.match(/\b(\d{1,3})\s*(m|min|mins|minutes)\b/i);
  if (!anyMinuteToken) return {};
  const timeframeLike = /\b(1|2|3|5|10|15|30|45|60|120|240)\s*(m|min|mins)\b/i.test(anyMinuteToken[0]);
  if (timeframeLike) {
    return { timeframeRejected: true, reason: `Rejected "${anyMinuteToken[0]}" because it matches a chart timeframe token.` };
  }
  return { reason: `Rejected "${anyMinuteToken[0]}" because no explicit duration wording was found.` };
}

function extractContextHints(text: string): string[] {
  const hintRules: Array<{ test: RegExp; hint: string }> = [
    { test: /no\s*trade|didn[’']?t\s*trade|flat\s*today/i, hint: 'No-trade note found' },
    { test: /no\s*a\+\s*setup|no\s*setup/i, hint: 'No A+ setup note found' },
    { test: /red\s*folder|news\s*event|fomc|cpi|nfp/i, hint: 'News event caution note found' },
    { test: /session\s*over|too\s*late|late\s*entry/i, hint: 'Session over / too late note found' },
    { test: /choppy|not\s*clean|no\s*displacement/i, hint: 'Choppy / no displacement note found' },
    { test: /didn[’']?t\s*force|no\s*force/i, hint: 'Discipline note: did not force trade' }
  ];
  return hintRules.filter((rule) => rule.test.test(text)).map((rule) => rule.hint);
}

type OcrResult = {
  status: OcrDebugState['ocrStatus'];
  text: string;
  headerText: string;
  charCount: number;
  error?: string;
  steps: string[];
};

async function extractTextFromImages(files: File[], onDebug?: (debug: OcrDebugState) => void): Promise<OcrResult> {
  const imageFiles = files.filter((f) => f.type.startsWith('image/'));
  const steps: string[] = [];
  if (!imageFiles.length) {
    const result: OcrResult = { status: 'no_images', text: '', headerText: '', charCount: 0, steps: ['No image files found'] };
    onDebug?.({ ocrStatus: result.status, ocrCharCount: 0, ocrSteps: result.steps });
    return result;
  }
  try {
    const tesseract = await loadTesseractRuntime();
    const chunks: string[] = [];
    const headerChunks: string[] = [];
    for (const file of imageFiles) {
      steps.push(`image loaded: ${file.name}`);
      onDebug?.({ ocrStatus: 'image_loaded', ocrSteps: [...steps] });
      const prepared = await preprocessImageForOcr(file);
      const preparedHeader = await preprocessHeaderCropForOcr(file);
      steps.push(`ocr running: ${file.name}`);
      onDebug?.({ ocrStatus: 'running', ocrSteps: [...steps] });
      const result = await tesseract.recognize(prepared, 'eng');
      const headerResult = await tesseract.recognize(preparedHeader, 'eng');
      const text = String(result?.data?.text || '').trim();
      const headerText = String(headerResult?.data?.text || '').trim();
      if (text) {
        chunks.push(text);
        steps.push(`ocr succeeded: ${file.name}`);
        onDebug?.({ ocrStatus: 'succeeded', ocrCharCount: chunks.join('\n').length, ocrSteps: [...steps] });
      } else {
        steps.push(`ocr returned no text: ${file.name}`);
        onDebug?.({ ocrStatus: 'no_text', ocrCharCount: chunks.join('\n').length, ocrSteps: [...steps] });
      }
      if (headerText) headerChunks.push(headerText);
    }
    const text = chunks.join('\n').trim();
    const headerText = headerChunks.join('\n').trim();
    const charCount = text.length;
    return { status: text || headerText ? 'succeeded' : 'no_text', text, headerText, charCount, steps };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    steps.push(`ocr failed: ${message}`);
    onDebug?.({ ocrStatus: 'failed', ocrError: message, ocrCharCount: 0, ocrSteps: [...steps] });
    return { status: 'failed', text: '', headerText: '', charCount: 0, error: message, steps };
  }
}

type TesseractLike = {
  recognize: (image: HTMLCanvasElement, language: string) => Promise<{ data?: { text?: string } }>;
};

async function loadTesseractRuntime(): Promise<TesseractLike> {
  const globalWithTesseract = globalThis as typeof globalThis & { Tesseract?: TesseractLike };
  if (globalWithTesseract.Tesseract?.recognize) return globalWithTesseract.Tesseract;
  await loadScriptOnce('https://cdn.jsdelivr.net/npm/tesseract.js@6/dist/tesseract.min.js');
  if (globalWithTesseract.Tesseract?.recognize) return globalWithTesseract.Tesseract;
  throw new Error('Tesseract runtime failed to load from CDN.');
}

function loadScriptOnce(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[data-ocr-runtime="${src}"]`) as HTMLScriptElement | null;
    if (existing?.dataset.loaded === 'true') {
      resolve();
      return;
    }
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error('OCR runtime script failed to load.')), { once: true });
      return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.dataset.ocrRuntime = src;
    script.addEventListener('load', () => {
      script.dataset.loaded = 'true';
      resolve();
    }, { once: true });
    script.addEventListener('error', () => reject(new Error('OCR runtime script failed to load.')), { once: true });
    document.head.appendChild(script);
  });
}

async function preprocessImageForOcr(file: File): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(file);
  const scale = 1.5;
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close();
    throw new Error('Failed to initialize canvas context for OCR preprocessing.');
  }
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const imageData = ctx.getImageData(0, 0, width, height);
  const { data } = imageData;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const gray = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
    const contrastBoost = gray > 140 ? 255 : 0;
    data[i] = contrastBoost;
    data[i + 1] = contrastBoost;
    data[i + 2] = contrastBoost;
  }
  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

async function preprocessHeaderCropForOcr(file: File): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(file);
  const cropWidth = Math.max(1, Math.round(bitmap.width * 0.6));
  const cropHeight = Math.max(1, Math.round(bitmap.height * 0.22));
  const canvas = document.createElement('canvas');
  canvas.width = cropWidth;
  canvas.height = cropHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close();
    throw new Error('Failed to initialize canvas context for header OCR preprocessing.');
  }
  ctx.drawImage(bitmap, 0, 0, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);
  bitmap.close();
  const imageData = ctx.getImageData(0, 0, cropWidth, cropHeight);
  const { data } = imageData;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const gray = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
    const contrastBoost = gray > 140 ? 255 : 0;
    data[i] = contrastBoost;
    data[i + 1] = contrastBoost;
    data[i + 2] = contrastBoost;
  }
  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

function formatOcrStatus(status: OcrDebugState['ocrStatus']) {
  if (!status) return 'Idle';
  if (status === 'image_loaded') return 'Image loaded';
  if (status === 'running') return 'OCR running';
  if (status === 'succeeded') return 'OCR succeeded';
  if (status === 'no_text') return 'OCR returned no text';
  if (status === 'failed') return 'OCR failed';
  if (status === 'no_images') return 'No image files found';
  return 'Idle';
}

function getPeriodRange(period: DashboardPeriod, anchor: Date): { start: string; end: string } {
  if (period === 'lifetime') {
    return { start: '2000-01-01', end: new Date().toISOString().slice(0, 10) };
  }
  const y = anchor.getUTCFullYear();
  const m = anchor.getUTCMonth();
  const d = anchor.getUTCDate();
  if (period === 'weekly') {
    const dt = new Date(Date.UTC(y, m, d));
    const day = dt.getUTCDay();
    dt.setUTCDate(dt.getUTCDate() - day);
    const end = new Date(dt);
    end.setUTCDate(dt.getUTCDate() + 6);
    return { start: dt.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
  }
  if (period === 'monthly') {
    const start = new Date(Date.UTC(y, m, 1));
    const end = new Date(Date.UTC(y, m + 1, 0));
    return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
  }
  if (period === 'quarterly') {
    const qStartMonth = Math.floor(m / 3) * 3;
    const start = new Date(Date.UTC(y, qStartMonth, 1));
    const end = new Date(Date.UTC(y, qStartMonth + 3, 0));
    return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
  }
  if (period === 'annual') {
    return { start: `${y}-01-01`, end: `${y}-12-31` };
  }
  return { start: `${y}-01-01`, end: new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10) };
}

function shiftPeriod(anchor: Date, period: DashboardPeriod, direction: number): Date {
  if (period === 'lifetime') return new Date(anchor);
  const next = new Date(anchor);
  if (period === 'weekly') next.setUTCDate(next.getUTCDate() + 7 * direction);
  else if (period === 'monthly') next.setUTCMonth(next.getUTCMonth() + direction);
  else if (period === 'quarterly') next.setUTCMonth(next.getUTCMonth() + 3 * direction);
  else next.setUTCFullYear(next.getUTCFullYear() + direction);
  return next;
}

function parseIsoDateInput(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return null;
  const [year, month, day] = value.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function parseMonthInput(value: string) {
  if (!/^\d{4}-\d{2}$/.test(String(value || ''))) return null;
  const [year, month] = value.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, 1));
}

function anchorForYtdYear(year: number) {
  const now = new Date();
  const month = now.getUTCMonth();
  const day = now.getUTCDate();
  const endOfTargetMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(day, endOfTargetMonth)));
}

function inDateRange(dateStr: string, start: string, end: string) {
  return dateStr >= start && dateStr <= end;
}

function toDateInput(value: string) {
  return value.slice(0, 10);
}

function normalizeTimeInput(value: unknown) {
  const raw = String(value || '').trim();
  const match = raw.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return '';
  const hh = Math.min(23, Math.max(0, Number(match[1] || 0)));
  const mm = Math.min(59, Math.max(0, Number(match[2] || 0)));
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function getHistoryDateRange(mode: HistoryDateFilter, todayKey: string, customStart: string, customEnd: string): { start: string; end: string } {
  if (mode === 'this_month') {
    const date = new Date(`${todayKey}T00:00:00Z`);
    const start = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-01`;
    return { start, end: todayKey };
  }
  if (mode === 'last_30_days') {
    return { start: addDaysKey(todayKey, -29), end: todayKey };
  }
  if (mode === 'custom') {
    const start = customStart || '0000-01-01';
    const end = customEnd || '9999-12-31';
    return start <= end ? { start, end } : { start: end, end: start };
  }
  return { start: '0000-01-01', end: '9999-12-31' };
}

function countItems(items: string[]) {
  return items.reduce<Record<string, number>>((acc, item) => {
    const key = String(item || '').trim();
    if (!key) return acc;
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

type PerformanceBreakdownRow = {
  key: string;
  trades: number;
  winRate: number;
  netPnl: number;
  avgPnl: number;
  avgR: number;
};

function computePerformanceBreakdown(rows: TradeRow[], getKey: (trade: TradeRow) => string): PerformanceBreakdownRow[] {
  const grouped = rows.reduce<Record<string, { trades: number; wins: number; pnl: number; r: number }>>((acc, trade) => {
    const key = String(getKey(trade) || 'Unknown').trim() || 'Unknown';
    if (!acc[key]) acc[key] = { trades: 0, wins: 0, pnl: 0, r: 0 };
    acc[key].trades += 1;
    if (Number(trade.pnl || 0) > 0) acc[key].wins += 1;
    acc[key].pnl += Number(trade.pnl || 0);
    acc[key].r += Number(trade.r_multiple || 0);
    return acc;
  }, {});
  return Object.entries(grouped)
    .map(([key, value]) => ({
      key,
      trades: value.trades,
      winRate: value.trades ? (value.wins / value.trades) * 100 : 0,
      netPnl: value.pnl,
      avgPnl: value.trades ? value.pnl / value.trades : 0,
      avgR: value.trades ? value.r / value.trades : 0
    }))
    .sort((a, b) => b.trades - a.trades || b.netPnl - a.netPnl);
}

function computeMistakeImpact(rows: TradeRow[]): PerformanceBreakdownRow[] {
  const expanded = rows.flatMap((trade) => {
    const tags = normalizeMistakeTags(trade.mistake_tags);
    return tags.map((tag) => ({
      tag,
      pnl: Number(trade.pnl || 0),
      rMultiple: Number(trade.r_multiple || 0),
      win: Number(trade.pnl || 0) > 0
    }));
  });
  const grouped = expanded.reduce<Record<string, { trades: number; wins: number; pnl: number; r: number }>>((acc, trade) => {
    const key = String(trade.tag || '').trim();
    if (!key) return acc;
    if (!acc[key]) acc[key] = { trades: 0, wins: 0, pnl: 0, r: 0 };
    acc[key].trades += 1;
    if (trade.win) acc[key].wins += 1;
    acc[key].pnl += trade.pnl;
    acc[key].r += trade.rMultiple;
    return acc;
  }, {});
  return Object.entries(grouped)
    .map(([key, value]) => ({
      key,
      trades: value.trades,
      winRate: value.trades ? (value.wins / value.trades) * 100 : 0,
      netPnl: value.pnl,
      avgPnl: value.trades ? value.pnl / value.trades : 0,
      avgR: value.trades ? value.r / value.trades : 0
    }))
    .sort((a, b) => b.trades - a.trades || a.avgPnl - b.avgPnl);
}

function computeGroupStats(rows: TradeRow[], getKey: (trade: TradeRow) => string) {
  const grouped = rows.reduce<Record<string, { trades: number; wins: number; pnl: number }>>((acc, trade) => {
    const key = getKey(trade) || 'Unknown';
    if (!acc[key]) acc[key] = { trades: 0, wins: 0, pnl: 0 };
    acc[key].trades += 1;
    if (Number(trade.pnl || 0) > 0) acc[key].wins += 1;
    acc[key].pnl += Number(trade.pnl || 0);
    return acc;
  }, {});
  return Object.entries(grouped).map(([key, v]) => ({
    key,
    trades: v.trades,
    winRate: v.trades ? (v.wins / v.trades) * 100 : 0,
    netPnl: v.pnl
  })).sort((a, b) => b.netPnl - a.netPnl);
}

function computeStreaks(rows: TradeRow[]) {
  // Streak rule: use P&L sign only.
  // Positive pnl => win streak, negative pnl => loss streak, zero pnl breaks streak.
  const sorted = [...rows].sort((a, b) => {
    const byDate = a.trade_date.localeCompare(b.trade_date);
    if (byDate !== 0) return byDate;
    const createdA = Date.parse(String((a as TradeRow & { created_at?: string }).created_at || ''));
    const createdB = Date.parse(String((b as TradeRow & { created_at?: string }).created_at || ''));
    if (!Number.isNaN(createdA) && !Number.isNaN(createdB) && createdA !== createdB) return createdA - createdB;
    return a.id.localeCompare(b.id);
  });
  let currentWin = 0;
  let currentLoss = 0;
  let longestWin = 0;
  let longestLoss = 0;
  let runningWin = 0;
  let runningLoss = 0;

  sorted.forEach((trade) => {
    const pnl = Number(trade.pnl || 0);
    if (pnl > 0) {
      runningWin += 1;
      runningLoss = 0;
    } else if (pnl < 0) {
      runningLoss += 1;
      runningWin = 0;
    } else {
      runningWin = 0;
      runningLoss = 0;
    }
    longestWin = Math.max(longestWin, runningWin);
    longestLoss = Math.max(longestLoss, runningLoss);
  });

  for (let idx = sorted.length - 1; idx >= 0; idx -= 1) {
    const pnl = Number(sorted[idx].pnl || 0);
    if (pnl > 0 && currentLoss === 0) currentWin += 1;
    else if (pnl < 0 && currentWin === 0) currentLoss += 1;
    else break;
  }

  return { currentWin, currentLoss, longestWin, longestLoss };
}

function getEmotionalInsight(rows: TradeRow[]) {
  const low = rows.filter((trade) => Number(trade.emotional_pressure || 0) <= 2);
  const high = rows.filter((trade) => Number(trade.emotional_pressure || 0) >= 4);
  if (low.length < 2 || high.length < 2) return '';
  const lowAvg = low.reduce((sum, trade) => sum + Number(trade.pnl || 0), 0) / low.length;
  const highAvg = high.reduce((sum, trade) => sum + Number(trade.pnl || 0), 0) / high.length;
  if (lowAvg - highAvg > 5) return 'Interpretation: lower emotional pressure (levels 1-2) is currently associated with stronger average outcomes than high-pressure trades.';
  if (highAvg - lowAvg > 5) return 'Interpretation: high-pressure trades are currently outperforming low-pressure trades; verify if this is sustained or sample noise.';
  return 'Interpretation: outcomes are currently similar across pressure ranges in this sample.';
}

function pickStrongestSetupCallout(rows: PerformanceBreakdownRow[], minSample: number) {
  if (!rows.length) return null;
  const eligible = rows.filter((row) => row.trades >= minSample);
  const source = eligible.length ? eligible : rows.slice(0, Math.min(5, rows.length));
  if (!source.length) return null;
  const ranked = [...source].sort((a, b) => {
    const scoreA = a.avgR * 100 + a.winRate * 1.2 + a.avgPnl * 0.5;
    const scoreB = b.avgR * 100 + b.winRate * 1.2 + b.avgPnl * 0.5;
    return scoreB - scoreA;
  });
  const top = ranked[0];
  return { ...top, limited: top.trades < minSample };
}

function getMultiTradeDayInsight(rows: TradeRow[]) {
  const byDate = rows.reduce<Record<string, { trades: number; pnl: number }>>((acc, trade) => {
    const key = trade.trade_date;
    if (!acc[key]) acc[key] = { trades: 0, pnl: 0 };
    acc[key].trades += 1;
    acc[key].pnl += Number(trade.pnl || 0);
    return acc;
  }, {});
  const days = Object.values(byDate);
  if (days.length < 4) return '';
  const heavy = days.filter((day) => day.trades >= 3);
  const light = days.filter((day) => day.trades < 3 && day.trades > 0);
  if (heavy.length < 2 || light.length < 2) return '';
  const heavyAvg = heavy.reduce((sum, day) => sum + day.pnl, 0) / heavy.length;
  const lightAvg = light.reduce((sum, day) => sum + day.pnl, 0) / light.length;
  if (heavyAvg + 5 < lightAvg) return 'Trade pacing signal: days with 3+ trades underperformed lighter days this period.';
  if (lightAvg + 5 < heavyAvg) return 'Trade pacing signal: 3+ trade days outperformed lighter days this period (worth validating over a larger sample).';
  return 'Trade pacing signal: no clear performance gap yet between lighter days and 3+ trade days.';
}

function getEmotionCoachingNotes(rows: TradeRow[]) {
  const notes: string[] = [];
  const low = rows.filter((trade) => Number(trade.emotional_pressure || 0) <= 2);
  const high = rows.filter((trade) => Number(trade.emotional_pressure || 0) >= 4);
  if (low.length >= 2 && high.length >= 2) {
    const lowAvgPnl = low.reduce((sum, trade) => sum + Number(trade.pnl || 0), 0) / low.length;
    const highAvgPnl = high.reduce((sum, trade) => sum + Number(trade.pnl || 0), 0) / high.length;
    if (lowAvgPnl - highAvgPnl > 5) notes.push(`Best average results came at pressure 1-2 (${lowAvgPnl.toFixed(2)} vs ${highAvgPnl.toFixed(2)} at pressure 4-5).`);
    else if (highAvgPnl - lowAvgPnl > 5) notes.push(`Higher pressure (4-5) outperformed low pressure in this sample (${highAvgPnl.toFixed(2)} vs ${lowAvgPnl.toFixed(2)}); treat as early signal.`);
    else notes.push('Pressure 1-2 vs 4-5 outcomes are currently similar (no strong edge yet).');
    const avgTags = (sample: TradeRow[]) => sample.reduce((sum, trade) => sum + normalizeMistakeTags(trade.mistake_tags).length, 0) / Math.max(1, sample.length);
    const lowMistakes = avgTags(low);
    const highMistakes = avgTags(high);
    if (highMistakes - lowMistakes > 0.5) notes.push(`Higher pressure also carried more mistake tags (${highMistakes.toFixed(1)} vs ${lowMistakes.toFixed(1)} per trade).`);
  }
  return notes;
}

function getSessionCoachingNote(trades: TradeRow[], sessions: SessionRow[]) {
  if (trades.length < 4 || sessions.length < 2) return '';
  const weeksWithJournal = new Set(
    sessions
      .filter((session) => session.session_type === 'journal')
      .map((session) => weekKeyFromDate(session.session_date))
      .filter(Boolean)
  );
  if (!weeksWithJournal.size) return 'No journal sessions were logged in this period.';
  const withJournal = trades.filter((trade) => weeksWithJournal.has(weekKeyFromDate(trade.trade_date)));
  const withoutJournal = trades.filter((trade) => !weeksWithJournal.has(weekKeyFromDate(trade.trade_date)));
  if (withJournal.length < 2 || withoutJournal.length < 2) return 'Session signal is limited (small sample of journal vs non-journal weeks).';
  const avg = (rows: TradeRow[]) => rows.reduce((sum, trade) => sum + Number(trade.pnl || 0), 0) / rows.length;
  const withAvg = avg(withJournal);
  const withoutAvg = avg(withoutJournal);
  if (withAvg - withoutAvg > 5) return `Journal-session weeks outperformed non-journal weeks (${withAvg.toFixed(2)} vs ${withoutAvg.toFixed(2)} avg P&L per trade).`;
  if (withoutAvg - withAvg > 5) return `Non-journal weeks outperformed journal-session weeks in this window (${withoutAvg.toFixed(2)} vs ${withAvg.toFixed(2)}); monitor before drawing conclusions.`;
  return 'Journal-session vs non-journal weeks are currently similar in outcome.';
}

function buildCalendarCells(monthStart: Date, trades: TradeRow[], noTrades: NoTradeDayRow[]) {
  const start = new Date(monthStart);
  const offset = start.getUTCDay();
  start.setUTCDate(start.getUTCDate() - offset);
  const monthEnd = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 0));
  const end = new Date(monthEnd);
  end.setUTCDate(monthEnd.getUTCDate() + (6 - monthEnd.getUTCDay()));
  const days = Math.floor((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)) + 1;
  return Array.from({ length: days }, (_, idx) => {
    const dt = new Date(start);
    dt.setUTCDate(start.getUTCDate() + idx);
    const date = dt.toISOString().slice(0, 10);
    const dayTrades = trades.filter((t) => t.trade_date === date);
    const pnl = dayTrades.reduce((sum, t) => sum + Number(t.pnl || 0), 0);
    const rTotal = dayTrades.reduce((sum, t) => sum + Number(t.r_multiple || 0), 0);
    const noTrade = noTrades.some((n) => n.day_date === date);
    return {
      date,
      day: dt.getUTCDate(),
      pnl,
      rTotal,
      tradeCount: dayTrades.length,
      noTrade,
      isOutside: dt.getUTCMonth() !== monthStart.getUTCMonth()
    };
  });
}

function periodTypeLabel(period: DashboardPeriod) {
  if (period === 'weekly') return 'Week';
  if (period === 'monthly') return 'Month';
  if (period === 'quarterly') return 'Quarter';
  if (period === 'annual') return 'Year';
  if (period === 'lifetime') return 'Lifetime';
  return 'YTD';
}

function formatPeriodLabel(period: DashboardPeriod, anchor: Date, start: string, end: string) {
  if (period === 'lifetime') {
    return `All time · ${formatDateShort(start)} to ${formatDateShort(end)}`;
  }
  if (period === 'weekly') {
    const startDate = new Date(`${start}T00:00:00Z`);
    const endDate = new Date(`${end}T00:00:00Z`);
    return `${startDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' })}–${endDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}`;
  }
  if (period === 'monthly') return anchor.toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });
  if (period === 'quarterly') return `Q${Math.floor(anchor.getUTCMonth() / 3) + 1} ${anchor.getUTCFullYear()}`;
  if (period === 'annual') return String(anchor.getUTCFullYear());
  return `Year to date · ${anchor.getUTCFullYear()}`;
}

function getLifetimeRange(
  trades: TradeRow[],
  noTrades: NoTradeDayRow[],
  sessions: SessionRow[],
  reviews: WeeklyReviewRow[]
) {
  const allDates = [
    ...trades.map((t) => t.trade_date),
    ...noTrades.map((n) => n.day_date),
    ...sessions.map((s) => s.session_date),
    ...reviews.map((r) => r.week_key)
  ].filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))).sort();
  const today = new Date().toISOString().slice(0, 10);
  if (!allDates.length) return { start: today, end: today };
  return { start: allDates[0], end: allDates[allDates.length - 1] };
}

function buildRWholeOptions() {
  const values = Array.from({ length: 36 }, (_, i) => String(i - 10));
  return [...values.slice(0, 11), '-0', ...values.slice(11)];
}

function parseRMultipleToParts(rawValue: unknown): { r_multiple_whole: string; r_multiple_decimal: string } {
  const numeric = Number(rawValue ?? 2);
  if (!Number.isFinite(numeric)) {
    return { r_multiple_whole: '2', r_multiple_decimal: '00' };
  }
  const rounded = Math.round(numeric * 100) / 100;
  const negative = rounded < 0;
  const abs = Math.abs(rounded);
  const wholeAbs = Math.trunc(abs);
  const decimal = Math.round((abs - wholeAbs) * 100);
  const wholeSigned = negative ? (wholeAbs === 0 ? '-0' : String(-wholeAbs)) : String(wholeAbs);
  return {
    r_multiple_whole: clampRWholeOption(wholeSigned),
    r_multiple_decimal: String(Math.min(99, Math.max(0, decimal))).padStart(2, '0')
  };
}

function clampRWholeOption(value: string) {
  if (value === '-0') return value;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '2';
  return String(Math.min(25, Math.max(-10, Math.trunc(numeric))));
}

function buildRMultipleValue(wholeRaw: string, decimalRaw: string) {
  const wholePart = wholeRaw === '-0' ? 0 : Number(wholeRaw || 0);
  const decimal = Math.min(99, Math.max(0, Number(decimalRaw || 0)));
  const magnitude = Math.abs(wholePart) + decimal / 100;
  const negative = wholeRaw === '-0' || wholePart < 0;
  const signed = negative ? -magnitude : magnitude;
  return Number(signed.toFixed(2));
}

function toEditorText(value: string) {
  const normalized = String(value || '');
  if (!normalized.trim()) return '';
  if (/<\/?[a-z][\s\S]*>/i.test(normalized)) return htmlToEditorText(normalized);
  return normalized;
}

function toDisplayHtml(value: string) {
  const normalized = String(value || '');
  if (!normalized.trim()) return '';
  if (/<\/?[a-z][\s\S]*>/i.test(normalized)) return normalizeStoredRichText(normalized);
  return normalizeStoredRichText(markdownishToHtml(normalized));
}

function normalizeStoredRichText(html: string) {
  const text = String(html || '')
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, '')
    .replace(/\son[a-z]+\s*=\s*(['"]).*?\1/gi, '')
    .replace(/javascript:/gi, '');
  const trimmed = text.trim();
  if (!trimmed || /^<(br|div|p)>\s*<\/\1>$/i.test(trimmed)) return '';
  return trimmed;
}

function htmlToEditorText(rawHtml: string) {
  const sanitized = normalizeStoredRichText(rawHtml)
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, '');
  let text = sanitized
    .replace(/<\/?(strong|b)>/gi, '**')
    .replace(/<\/?u>/gi, '__')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<div>/gi, '')
    .replace(/<\/p>/gi, '\n')
    .replace(/<p>/gi, '')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<\/li>/gi, '\n')
    .replace(/<\/?(ul|ol)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '');
  text = decodeHtmlEntities(text).replace(/\n{3,}/g, '\n\n').trim();
  return text;
}

function markdownishToHtml(rawValue: string) {
  const lines = String(rawValue || '').replace(/\r/g, '').split('\n');
  const blocks: string[] = [];
  let listType: 'ul' | 'ol' | null = null;
  let listItems: string[] = [];

  const flushList = () => {
    if (!listType || !listItems.length) return;
    blocks.push(`<${listType}>${listItems.join('')}</${listType}>`);
    listType = null;
    listItems = [];
  };

  lines.forEach((line) => {
    const bullet = line.match(/^(\s*)[-*]\s+(.*)$/);
    const numbered = line.match(/^(\s*)\d+\.\s+(.*)$/);
    if (bullet) {
      if (listType !== 'ul') flushList();
      listType = 'ul';
      const indent = Math.floor((bullet[1] || '').length / 2);
      listItems.push(`<li style="margin-left:${indent * 10}px">${applyInlineMarkup(bullet[2])}</li>`);
      return;
    }
    if (numbered) {
      if (listType !== 'ol') flushList();
      listType = 'ol';
      const indent = Math.floor((numbered[1] || '').length / 2);
      listItems.push(`<li style="margin-left:${indent * 10}px">${applyInlineMarkup(numbered[2])}</li>`);
      return;
    }
    flushList();
    if (!line.trim()) {
      blocks.push('<div><br></div>');
      return;
    }
    blocks.push(`<div>${applyInlineMarkup(line)}</div>`);
  });
  flushList();
  return blocks.join('');
}

function applyInlineMarkup(rawLine: string) {
  const escaped = escapeHtml(rawLine);
  return escaped
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_]+)__/g, '<u>$1</u>');
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function wrapWithToken(source: string, start: number, end: number, token: string) {
  const from = Math.max(0, Math.min(start, end));
  const to = Math.max(from, Math.max(start, end));
  const selected = source.slice(from, to) || 'text';
  const wrapped = `${token}${selected}${token}`;
  const text = `${source.slice(0, from)}${wrapped}${source.slice(to)}`;
  return { text, nextStart: from + token.length, nextEnd: from + token.length + selected.length };
}

function applyListActivation(source: string, start: number, end: number, type: 'bullet' | 'numbered') {
  if (start === end) {
    const lineStart = source.lastIndexOf('\n', start - 1) + 1;
    const nextBreak = source.indexOf('\n', start);
    const lineEnd = nextBreak === -1 ? source.length : nextBreak;
    const line = source.slice(lineStart, lineEnd);
    const indent = (line.match(/^\s*/) || [''])[0];
    const cleaned = stripListPrefix(line.trimStart());
    const marker = type === 'bullet' ? '- ' : '1. ';
    const nextLine = `${indent}${marker}${cleaned}`;
    const text = `${source.slice(0, lineStart)}${nextLine}${source.slice(lineEnd)}`;
    const caretOffset = cleaned.length === 0
      ? lineStart + indent.length + marker.length
      : Math.min(lineStart + nextLine.length, lineStart + indent.length + marker.length + (start - lineStart));
    return { text, nextStart: caretOffset, nextEnd: caretOffset };
  }

  if (type === 'bullet') {
    return mutateLines(source, start, end, (line) => {
      if (!line.trim()) return line;
      const indent = (line.match(/^\s*/) || [''])[0];
      const cleaned = stripListPrefix(line.trimStart());
      return `${indent}- ${cleaned}`;
    });
  }

  let count = 1;
  return mutateLines(source, start, end, (line) => {
    if (!line.trim()) return line;
    const indent = (line.match(/^\s*/) || [''])[0];
    const cleaned = stripListPrefix(line.trimStart());
    const next = `${indent}${count}. ${cleaned}`;
    count += 1;
    return next;
  });
}

function stripListPrefix(line: string) {
  return line.replace(/^(-|\*|\d+\.)\s+/, '');
}

function indentLines(source: string, start: number, end: number, delta: number) {
  return mutateLines(source, start, end, (line) => {
    if (!line.trim()) return line;
    const leading = line.match(/^\s*/)?.[0] || '';
    const updated = Math.max(0, leading.length + delta);
    return `${' '.repeat(updated)}${line.trimStart()}`;
  });
}

function mutateLines(source: string, start: number, end: number, transform: (line: string) => string) {
  const from = Math.max(0, Math.min(start, end));
  const to = Math.max(from, Math.max(start, end));
  const lineStart = source.lastIndexOf('\n', from - 1) + 1;
  const nextBreak = source.indexOf('\n', to);
  const lineEnd = nextBreak === -1 ? source.length : nextBreak;
  const segment = source.slice(lineStart, lineEnd);
  const lines = segment.split('\n');
  const updated = lines.map(transform).join('\n');
  return { text: `${source.slice(0, lineStart)}${updated}${source.slice(lineEnd)}`, nextStart: lineStart, nextEnd: lineStart + updated.length };
}

function isPaperTrade(trade: TradeRow) {
  return Boolean((trade as TradeRow & { is_paper_trade?: unknown }).is_paper_trade);
}

function matchesTradeTypeFilter(trade: TradeRow, filter: TradeTypeFilter) {
  if (filter === 'all') return true;
  return filter === 'paper' ? isPaperTrade(trade) : !isPaperTrade(trade);
}

function filterTradesByType(trades: TradeRow[], filter: TradeTypeFilter) {
  return trades.filter((trade) => matchesTradeTypeFilter(trade, filter));
}

function formatStreakLabel(currentWin: number, currentLoss: number) {
  if (currentWin > 0) return `Win ${currentWin}`;
  if (currentLoss > 0) return `Loss ${currentLoss}`;
  return 'Neutral 0';
}

function streakColor(currentWin: number, currentLoss: number) {
  if (currentWin > 0) return '#4ad66d';
  if (currentLoss > 0) return '#ff6b6b';
  return '#9eaac4';
}

function streakCardStyle(currentWin: number, currentLoss: number) {
  if (currentWin > 0) return { background: 'rgba(74,214,109,0.10)', borderColor: '#2f6f4a' };
  if (currentLoss > 0) return { background: 'rgba(255,107,107,0.10)', borderColor: '#7a3f3f' };
  return undefined;
}

function getTimelineCreatedAt(item: { type: 'trade'; trade: TradeRow } | { type: 'no_trade'; noTrade: NoTradeDayRow } | { type: 'session'; session: SessionRow }) {
  const raw = item.type === 'trade'
    ? (item.trade as TradeRow & { created_at?: string }).created_at
    : item.type === 'no_trade'
      ? (item.noTrade as NoTradeDayRow & { created_at?: string }).created_at
      : (item.session as SessionRow & { created_at?: string }).created_at;
  if (!raw) return '0000-00-00T00:00:00.000Z';
  const timestamp = Date.parse(raw);
  return Number.isNaN(timestamp) ? '0000-00-00T00:00:00.000Z' : new Date(timestamp).toISOString();
}

function normalizeInstrument(value: string) {
  return String(value || '').trim().toUpperCase();
}

function normalizeTag(value: string) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function normalizeMistakeTags(value: unknown): string[] {
  const sanitize = (values: string[]) => normalizeUniqueTags(values).filter((tag) => !isInactiveMistakeTag(tag));
  if (Array.isArray(value)) {
    return sanitize(value.map((item) => normalizeTag(String(item ?? ''))));
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return [];
    const tokens = trimmed.includes(',') ? trimmed.split(',') : [trimmed];
    return sanitize(tokens.map((token) => normalizeTag(token)));
  }
  if (value == null) return [];
  if (typeof value === 'object') return [];
  return sanitize([normalizeTag(String(value))]);
}

function normalizeEntryEmotion(value: unknown): EntryEmotion {
  const normalized = normalizeTag(String(value || ''));
  const match = entryEmotionOptions.find((option) => option.value.toLowerCase() === normalized.toLowerCase());
  return (match?.value || entryEmotionOptions[0].value) as EntryEmotion;
}

function normalizeInTradeEmotion(value: unknown): InTradeEmotion {
  const normalized = normalizeTag(String(value || ''));
  const match = inTradeEmotionOptions.find((option) => option.value.toLowerCase() === normalized.toLowerCase());
  return (match?.value || inTradeEmotionOptions[0].value) as InTradeEmotion;
}

function normalizeNoTradeMindset(value: unknown): NoTradeMindset {
  const normalized = normalizeTag(String(value || ''));
  const match = noTradeMindsetOptions.find((option) => option.value.toLowerCase() === normalized.toLowerCase());
  return (match?.value || noTradeMindsetOptions[0].value) as NoTradeMindset;
}

function legacyEmotions(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => normalizeTag(String(item || ''))).filter(Boolean);
  if (typeof value === 'string') {
    const token = normalizeTag(value);
    return token ? [token] : [];
  }
  return [];
}

function resolveEntryEmotion(trade: TradeRow): EntryEmotion {
  const explicit = normalizeTag(String((trade as TradeRow & { entry_emotion?: unknown }).entry_emotion || ''));
  if (explicit) return normalizeEntryEmotion(explicit);
  const firstLegacy = legacyEmotions((trade as TradeRow & { trading_emotions?: unknown; trading_emotion?: unknown }).trading_emotions ?? (trade as TradeRow & { trading_emotion?: unknown }).trading_emotion)[0] || '';
  const key = firstLegacy.toLowerCase();
  if (key.includes('panic')) return 'Revengeful / Tilted';
  if (key.includes('fear') || key.includes('anxiety')) return 'FOMO / Impatient';
  if (key.includes('euphoria') || key.includes('thrill')) return 'Greedy';
  if (key.includes('confidence') || key.includes('optimism') || key.includes('hope') || key.includes('relief')) return 'Confident';
  return normalizeEntryEmotion(firstLegacy || 'Calm');
}

function resolveInTradeEmotion(trade: TradeRow): InTradeEmotion {
  const explicit = normalizeTag(String((trade as TradeRow & { in_trade_emotion?: unknown }).in_trade_emotion || ''));
  if (explicit) return normalizeInTradeEmotion(explicit);
  const legacy = legacyEmotions((trade as TradeRow & { trading_emotions?: unknown; trading_emotion?: unknown }).trading_emotions ?? (trade as TradeRow & { trading_emotion?: unknown }).trading_emotion);
  const source = legacy[1] || legacy[0] || '';
  const key = source.toLowerCase();
  if (key.includes('panic') || key.includes('fear')) return 'Panicked';
  if (key.includes('surprise')) return 'Surprised';
  if (key.includes('greed') || key.includes('euphoria') || key.includes('thrill')) return 'Greedy';
  if (key.includes('confidence') || key.includes('optimism') || key.includes('relief')) return 'Confident';
  return normalizeInTradeEmotion(source || 'Calm');
}

function resolveNoTradeMindset(noTrade: NoTradeDayRow): NoTradeMindset {
  const explicit = normalizeTag(String((noTrade as NoTradeDayRow & { no_trade_mindset?: unknown }).no_trade_mindset || ''));
  if (explicit) return normalizeNoTradeMindset(explicit);
  const firstLegacy = legacyEmotions((noTrade as NoTradeDayRow & { trading_emotions?: unknown; trading_emotion?: unknown }).trading_emotions ?? (noTrade as NoTradeDayRow & { trading_emotion?: unknown }).trading_emotion)[0] || '';
  const key = firstLegacy.toLowerCase();
  if (key.includes('disappoint')) return 'Present but disappointed';
  if (key.includes('not') || key.includes('absent')) return 'Not fully present';
  if (key.includes('accept') || key.includes('indifferent') || key.includes('relief')) return 'Accepting / indifferent';
  return normalizeNoTradeMindset(firstLegacy || 'Present but disappointed');
}

function normalizeUniqueInstruments(values: string[]) {
  const seen = new Set<string>();
  const next: string[] = [];
  values.forEach((raw) => {
    const normalized = normalizeInstrument(raw);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    next.push(normalized);
  });
  return next.sort();
}

function normalizeUniqueTags(values: string[]) {
  const seen = new Set<string>();
  const next: string[] = [];
  values.forEach((raw) => {
    const normalized = normalizeTag(raw);
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key)) return;
    seen.add(key);
    next.push(normalized);
  });
  return next.sort((a, b) => a.localeCompare(b));
}

function isInactiveMistakeTag(tag: string) {
  return INACTIVE_MISTAKE_TAGS.has(String(tag || '').trim().toLowerCase());
}

function resolveMistakeCatalogState(activeCatalog: unknown, hiddenCatalog: unknown, historicalTags: unknown = []): { active: string[]; hidden: string[] } {
  const hiddenSeed = normalizeMistakeTags(hiddenCatalog);
  const hiddenSet = new Set(hiddenSeed.map((item) => item.toLowerCase()));
  const sourceActive = normalizeMistakeTags(activeCatalog);
  const historical = normalizeMistakeTags(historicalTags);
  const defaultSet = new Set(DEFAULT_MISTAKE_CATALOG.map((item) => item.toLowerCase()));

  const cleanedActive = normalizeUniqueTags(
    sourceActive.filter((tag) => !isInactiveMistakeTag(tag) && !hiddenSet.has(tag.toLowerCase()))
  );
  const hasReasonableDefaultCoverage = cleanedActive.filter((tag) => defaultSet.has(tag.toLowerCase())).length >= 2;
  const looksStaleOnly = cleanedActive.length <= 1 && !hasReasonableDefaultCoverage;
  const fallbackActive = normalizeUniqueTags([
    ...DEFAULT_MISTAKE_CATALOG.filter((tag) => !hiddenSet.has(tag.toLowerCase())),
    ...cleanedActive
  ]);
  const active = normalizeUniqueTags(
    (looksStaleOnly ? fallbackActive : (cleanedActive.length ? cleanedActive : fallbackActive))
      .filter((tag) => !hiddenSet.has(tag.toLowerCase()))
  );
  const activeSet = new Set(active.map((tag) => tag.toLowerCase()));

  const hidden = normalizeUniqueTags([
    ...hiddenSeed,
    ...historical.filter((tag) => !defaultSet.has(tag.toLowerCase())),
    ...(looksStaleOnly ? sourceActive : [])
  ]).filter((tag) => !activeSet.has(tag.toLowerCase()));
  return { active, hidden };
}

function normalizeActiveMistakeCatalog(activeCatalog: unknown, hiddenCatalog: unknown): string[] {
  return resolveMistakeCatalogState(activeCatalog, hiddenCatalog).active;
}

function normalizeHiddenMistakeCatalog(hiddenCatalog: unknown, activeCatalog: unknown): string[] {
  return resolveMistakeCatalogState(activeCatalog, hiddenCatalog).hidden;
}

function settingsCacheKey(userId: string) {
  return `${SETTINGS_CACHE_PREFIX}${userId}`;
}

function readSettingsCache(userId: string): SettingsRow | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(settingsCacheKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SettingsRow> | null;
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      user_id: userId,
      daily_reminder: Boolean(parsed.daily_reminder),
      weekly_reminder: Boolean(parsed.weekly_reminder),
      default_risk: Number(parsed.default_risk ?? 0),
      chart_session_start_default: normalizeTimeInput(parsed.chart_session_start_default ?? SESSION_DEFAULT_TIMES.chart.start),
      chart_session_end_default: normalizeTimeInput(parsed.chart_session_end_default ?? SESSION_DEFAULT_TIMES.chart.end),
      journal_session_start_default: normalizeTimeInput(parsed.journal_session_start_default ?? SESSION_DEFAULT_TIMES.journal.start),
      journal_session_end_default: normalizeTimeInput(parsed.journal_session_end_default ?? SESSION_DEFAULT_TIMES.journal.end),
      display_name: normalizeTag(String(parsed.display_name || '')),
      instruments: normalizeUniqueInstruments(Array.isArray(parsed.instruments) ? parsed.instruments.map((item) => String(item ?? '')) : []),
      mistake_catalog: normalizeMistakeTags(parsed.mistake_catalog),
      mistake_catalog_hidden: normalizeMistakeTags(parsed.mistake_catalog_hidden)
    };
  } catch {
    return null;
  }
}

function writeSettingsCache(settings: SettingsRow) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(settingsCacheKey(settings.user_id), JSON.stringify({
      user_id: settings.user_id,
      daily_reminder: settings.daily_reminder,
      weekly_reminder: settings.weekly_reminder,
      default_risk: settings.default_risk,
      chart_session_start_default: normalizeTimeInput(settings.chart_session_start_default),
      chart_session_end_default: normalizeTimeInput(settings.chart_session_end_default),
      journal_session_start_default: normalizeTimeInput(settings.journal_session_start_default),
      journal_session_end_default: normalizeTimeInput(settings.journal_session_end_default),
      display_name: settings.display_name,
      instruments: settings.instruments,
      mistake_catalog: settings.mistake_catalog,
      mistake_catalog_hidden: settings.mistake_catalog_hidden
    }));
  } catch {
    // ignore local storage write failures
  }
}

function downloadTextFile(filename: string, content: string, mimeType: string) {
  if (typeof window === 'undefined') return;
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

function recordsToCsv(records: Record<string, string | number | null | undefined>[]) {
  if (!records.length) return 'record_type\n';
  const headers = Array.from(records.reduce((set, row) => {
    Object.keys(row).forEach((key) => set.add(key));
    return set;
  }, new Set<string>()));
  const escapeCsv = (value: string | number | null | undefined) => {
    const normalized = value == null ? '' : String(value);
    if (/[",\n]/.test(normalized)) return `"${normalized.replace(/"/g, '""')}"`;
    return normalized;
  };
  const lines = [
    headers.join(','),
    ...records.map((row) => headers.map((header) => escapeCsv(row[header])).join(','))
  ];
  return lines.join('\n');
}

function normalizeSupabaseError(message: string) {
  const text = String(message || '');
  if (isRecoverableSchemaError(text)) {
    return 'Some data is temporarily unavailable while database schema metadata refreshes. Please retry in a moment.';
  }
  return text;
}

function isSettingsCatalogSchemaMismatch(message: string) {
  const text = String(message || '');
  return /could not find .*?(instruments|mistake_catalog|mistake_catalog_hidden|chart_session_start_default|chart_session_end_default|journal_session_start_default|journal_session_end_default).*?schema cache/i.test(text)
    || /column .*?(instruments|mistake_catalog|mistake_catalog_hidden|chart_session_start_default|chart_session_end_default|journal_session_start_default|journal_session_end_default).*? does not exist/i.test(text);
}

function isWeeklyReviewPaperSchemaMismatch(message: string) {
  const text = String(message || '');
  return /could not find .*?(q_paper).*?schema cache/i.test(text)
    || /column .*?(q_paper).*? does not exist/i.test(text);
}

function isRecoverableSchemaError(message: string) {
  const text = String(message || '');
  return isSettingsCatalogSchemaMismatch(text)
    || isWeeklyReviewPaperSchemaMismatch(text)
    || /schema cache/i.test(text)
    || /column .* does not exist/i.test(text)
    || /relation .* does not exist/i.test(text)
    || /Could not find the table/i.test(text);
}

function currentWeekKey() {
  return sundayWeekStart(new Date().toISOString().slice(0, 10));
}

function weekKeyFromDate(dateStr: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateStr || ''))) return '';
  return sundayWeekStart(dateStr);
}

function weekInputFromKey(weekKey: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(weekKey || ''))) return '';
  const sundayDate = new Date(`${weekKey}T00:00:00Z`);
  sundayDate.setUTCDate(sundayDate.getUTCDate() + 1);
  const dt = new Date(Date.UTC(sundayDate.getUTCFullYear(), sundayDate.getUTCMonth(), sundayDate.getUTCDate()));
  const jan4 = new Date(Date.UTC(dt.getUTCFullYear(), 0, 4));
  const jan4Day = jan4.getUTCDay() || 7;
  const week1 = new Date(jan4);
  week1.setUTCDate(jan4.getUTCDate() - jan4Day + 1);
  const weekNo = Math.floor((dt.getTime() - week1.getTime()) / (7 * 24 * 60 * 60 * 1000)) + 1;
  return `${dt.getUTCFullYear()}-W${String(Math.max(1, weekNo)).padStart(2, '0')}`;
}

function weekKeyFromInput(weekInput: string) {
  const m = String(weekInput || '').match(/^(\d{4})-W(\d{2})$/);
  if (!m) return currentWeekKey();
  const year = Number(m[1]);
  const week = Number(m[2]);
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Day = jan4.getUTCDay() || 7;
  const week1 = new Date(jan4);
  week1.setUTCDate(jan4.getUTCDate() - jan4Day + 1);
  const monday = new Date(week1);
  monday.setUTCDate(week1.getUTCDate() + (week - 1) * 7);
  monday.setUTCDate(monday.getUTCDate() - 1);
  return monday.toISOString().slice(0, 10);
}

function currentWeekInput() {
  return weekInputFromKey(currentWeekKey());
}

function splitDisplayName(displayName: string, email?: string) {
  const cleaned = String(displayName || '').trim();
  if (cleaned) {
    const tokens = cleaned.split(/\s+/).filter(Boolean);
    return [tokens[0] || '', tokens.slice(1).join(' ')] as const;
  }
  const fromEmail = String(email || '').split('@')[0] || '';
  const emailParts = fromEmail.split(/[._-]+/).filter(Boolean);
  return [emailParts[0] || '', emailParts.slice(1).join(' ')] as const;
}

function buildInitials(firstName: string, lastName: string, email?: string) {
  const f = (firstName || '').trim()[0] || '';
  const l = (lastName || '').trim()[0] || '';
  if (f || l) return `${f}${l}`.toUpperCase();
  const fallback = String(email || '').trim()[0] || 'U';
  return fallback.toUpperCase();
}

function calculateDurationMinutes(startTime: string, endTime: string) {
  const parse = (value: string) => {
    const [h, m] = String(value || '').split(':').map(Number);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return 0;
    return h * 60 + m;
  };
  const start = parse(startTime);
  const end = parse(endTime);
  const diff = end - start;
  return diff >= 0 ? diff : 24 * 60 + diff;
}

function formatMinutesLabel(totalMinutes: number) {
  const safe = Math.max(0, Number(totalMinutes || 0));
  const hours = Math.floor(safe / 60);
  const minutes = safe % 60;
  if (!hours) return `${minutes}m`;
  if (!minutes) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}
