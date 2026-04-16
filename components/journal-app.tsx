'use client';

import { Fragment, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase-browser';
import type { AttachmentRow, NoTradeDayRow, SessionRow, SettingsRow, TradeRow, WeeklyReviewRow, TradeClassification } from '@/types/models';

const APP_VERSION = 'v1.0';
const tabs = ['dashboard', 'history', 'log', 'review'] as const;
type Tab = (typeof tabs)[number];
type LogMode = 'trade' | 'no_trade' | 'session';
type DashboardPeriod = 'weekly' | 'monthly' | 'quarterly' | 'annual' | 'ytd';
type HelpKey = 'classification' | 'family' | 'model';
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
  const [reviewAnswers, setReviewAnswers] = useState({ q1: '', q2: '', q3: '' });
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
  const [noTradeDraft, setNoTradeDraft] = useState<{ day_date: string; reason: string; notes: string }>({ day_date: new Date().toISOString().slice(0, 10), reason: noTradeReasons[0], notes: '' });
  const [dashboardPeriod, setDashboardPeriod] = useState<DashboardPeriod>('monthly');
  const [dashboardAnchor, setDashboardAnchor] = useState<Date>(() => new Date());
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
    mistake_tags: [],
    notes: ''
  }));
  const [newInstrument, setNewInstrument] = useState('');
  const [newMistakeTag, setNewMistakeTag] = useState('');
  const [mistakePickerValue, setMistakePickerValue] = useState('');
  const [logMode, setLogMode] = useState<LogMode>('trade');
  const [accountOpen, setAccountOpen] = useState(false);
  const [showAccountSettings, setShowAccountSettings] = useState(false);
  const [accountFirstName, setAccountFirstName] = useState('');
  const [accountLastName, setAccountLastName] = useState('');
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [sessionDraft, setSessionDraft] = useState<{ session_type: 'chart' | 'journal'; session_date: string; start_time: string; end_time: string; notes: string }>({
    session_type: 'chart',
    session_date: new Date().toISOString().slice(0, 10),
    start_time: '09:00',
    end_time: '10:00',
    notes: ''
  });
  const [pending, startTransition] = useTransition();
  const detailAnchors = useRef<Record<string, HTMLElement | null>>({});
  const [calendarView, setCalendarView] = useState<'month' | 'weekly'>('month');
  const [calendarMetric, setCalendarMetric] = useState<'pnl' | 'r'>('pnl');
  const [chartMetric, setChartMetric] = useState<'pnl' | 'r'>('pnl');
  const [chartView, setChartView] = useState<'daily' | 'cumulative'>('daily');
  const [chartOverlay, setChartOverlay] = useState<'none' | 'count'>('none');
  const [reviewSignedUrls, setReviewSignedUrls] = useState<Record<string, string>>({});

  useEffect(() => {
    const [first, last] = splitDisplayName(settings?.display_name || '', email);
    setAccountFirstName(first);
    setAccountLastName(last);
  }, [settings?.display_name, email]);

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
    setTrades((((t.data || []) as TradeRow[]) || []).map((trade) => ({
      ...trade,
      mistake_tags: normalizeMistakeTags((trade as TradeRow & { mistake_tags?: unknown }).mistake_tags)
    })));
    setNoTrades(((n.data || []) as NoTradeDayRow[]) || []);
    setSessions(((sessionResult.data || []) as SessionRow[]) || []);
    setReviews(((r.data || []) as WeeklyReviewRow[]) || []);
    const baseSettings = ((s.data as SettingsRow | null) ?? {
      user_id: userId,
      daily_reminder: true,
      weekly_reminder: true,
      default_risk: 200,
      display_name: 'JY',
      instruments: ['MES'],
      mistake_catalog: []
    });
    const rawInstruments = (baseSettings as { instruments?: unknown }).instruments;
    const normalizedInstruments = Array.isArray(rawInstruments)
      ? rawInstruments.map((item) => String(item ?? ''))
      : String(rawInstruments || '').split(',');
    setSettings({
      ...baseSettings,
      instruments: normalizeUniqueInstruments(normalizedInstruments),
      mistake_catalog: normalizeMistakeTags(baseSettings.mistake_catalog)
    });
    setAttachments(((a.data || []) as AttachmentRow[]) || []);
  }

  const netPnl = trades.reduce((s, t) => s + Number(t.pnl || 0), 0);
  const wins = trades.filter((t) => t.pnl > 0).length;
  const avgEmotionalPressure = trades.length ? (trades.reduce((sum, t) => sum + Number(t.emotional_pressure || 0), 0) / trades.length) : 0;
  const periodRange = getPeriodRange(dashboardPeriod, dashboardAnchor);
  const periodTrades = trades.filter((t) => inDateRange(t.trade_date, periodRange.start, periodRange.end));
  const periodNoTrades = noTrades.filter((n) => inDateRange(n.day_date, periodRange.start, periodRange.end));
  const periodNetPnl = periodTrades.reduce((sum, t) => sum + Number(t.pnl || 0), 0);
  const periodNetR = periodTrades.reduce((sum, t) => sum + Number(t.r_multiple || 0), 0);
  const periodWins = periodTrades.filter((t) => Number(t.pnl || 0) > 0).length;
  const winningTrades = periodTrades.filter((t) => Number(t.pnl || 0) > 0);
  const losingTrades = periodTrades.filter((t) => Number(t.pnl || 0) < 0);
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
  const calendarMonth = new Date(Date.UTC(dashboardAnchor.getUTCFullYear(), dashboardAnchor.getUTCMonth(), 1));
  const calendarCells = buildCalendarCells(calendarMonth, trades, noTrades);
  const calendarWeekRows = chunkCalendarWeeks(calendarCells);
  const periodTimeline = buildPeriodTimeline(periodRange.start, periodRange.end, periodTrades, periodNoTrades, chartMetric, chartView);
  const periodJumpOptions = buildPeriodJumpOptions(dashboardPeriod, dashboardAnchor);
  const instrumentOptions = normalizeUniqueInstruments([
    'MES',
    tradeDraft.ticker,
    ...(settings?.instruments || []),
    ...trades.map((t) => String(t.ticker || '').toUpperCase()).filter(Boolean)
  ]);
  const mistakeTagOptions = normalizeUniqueTags([
    ...normalizeMistakeTags(settings?.mistake_catalog),
    ...trades.flatMap((t) => normalizeMistakeTags(t.mistake_tags))
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

  const selectedWeekKey = weekKeyFromInput(weekInput);
  const weekTrades = trades.filter((t) => weekKeyFromDate(t.trade_date) === selectedWeekKey);
  const weekNoTrades = noTrades.filter((n) => weekKeyFromDate(n.day_date) === selectedWeekKey);
  const weekSessions = sessions.filter((s) => weekKeyFromDate(s.session_date) === selectedWeekKey);
  const reviewRow = reviews.find((r) => r.week_key === selectedWeekKey);

  useEffect(() => {
    setReviewAnswers({ q1: reviewRow?.q1 || '', q2: reviewRow?.q2 || '', q3: reviewRow?.q3 || '' });
  }, [reviewRow?.id, selectedWeekKey]);

  useEffect(() => {
    if (tab !== 'review') return;
    const paths = attachments
      .filter((a) => weekTrades.some((t) => t.id === a.trade_id) || weekNoTrades.some((n) => n.id === a.no_trade_day_id))
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
  }, [tab, selectedWeekKey, attachments, weekTrades, weekNoTrades, supabase]);

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
        mistake_catalog: normalizeUniqueTags([...(settings.mistake_catalog || []), ...payload.mistake_tags])
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
        file_path: filePath,
        file_name: file.name,
        mime_type: file.type || 'application/octet-stream',
        byte_size: file.size
      });
    }

    await loadAll();
    setNoTradeDraft({ day_date: new Date().toISOString().slice(0, 10), reason: noTradeReasons[0], notes: '' });
    setNoTradeExtract(null);
    setEditingNoTradeId(null);
    setTab('history');
  }

  async function addSession() {
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
      ? await supabase.from('sessions').update(payload).eq('id', editingSessionId)
      : await supabase.from('sessions').insert(payload);
    if (response.error) {
      setError(normalizeSupabaseError(response.error.message));
      return;
    }
    setSessionDraft({
      session_type: 'chart',
      session_date: new Date().toISOString().slice(0, 10),
      start_time: '09:00',
      end_time: '10:00',
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
    if (upsertError) setError(normalizeSupabaseError(upsertError.message));
    else await loadAll();
  }

  async function saveSettings(next: SettingsRow) {
    const payload: SettingsRow = {
      ...next,
      instruments: normalizeUniqueInstruments(next.instruments || []),
      mistake_catalog: normalizeMistakeTags(next.mistake_catalog)
    };
    const { error: upsertError } = await supabase.from('user_settings').upsert(payload, { onConflict: 'user_id' });
    if (!upsertError) {
      setSettings(payload);
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
      mistake_tags: [],
      notes: ''
    });
    setTradeExtract(null);
    setMistakePickerValue('');
  }

  function startEditTrade(trade: TradeRow) {
    setEditingTradeId(trade.id);
    setEditingNoTradeId(null);
    setTab('log');
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
      mistake_tags: normalizeMistakeTags(trade.mistake_tags),
      notes: trade.notes || ''
    });
    setMistakePickerValue('');
  }

  function startEditNoTrade(noTrade: NoTradeDayRow) {
    setEditingNoTradeId(noTrade.id);
    setNoTradeDraft({ day_date: noTrade.day_date, reason: noTrade.reason, notes: noTrade.notes || '' });
    setTab('log');
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
      setNoTradeDraft({ day_date: new Date().toISOString().slice(0, 10), reason: noTradeReasons[0], notes: '' });
    }
    await loadAll();
  }

  async function deleteSession(sessionId: string) {
    if (!window.confirm('Delete this session?')) return;
    const { error: deleteError } = await supabase.from('sessions').delete().eq('id', sessionId);
    if (deleteError) {
      setError(normalizeSupabaseError(deleteError.message));
      return;
    }
    if (detail?.kind === 'session' && detail.id === sessionId) setDetail(null);
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
          : [];

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

  return (
    <main className="app">
      <header className="header">
        <div>
          <div className="sub">JY Trading Journal</div>
          <h1>Own your process.<br />Build consistency.</h1>
          <div className="muted small">Connected app (Next.js + Supabase)</div>
        </div>
        <div className="stack" style={{ alignItems: 'flex-end' }}>
          <span className="chip">Connected</span>
          <span className="chip version">{APP_VERSION}</span>
          <button
            className="inline"
            type="button"
            style={{ width: 42, height: 42, borderRadius: '999px', padding: 0 }}
            onClick={() => setAccountOpen((open) => !open)}
          >
            {initials}
          </button>
        </div>
      </header>
      {accountOpen && (
        <section className="card stack" style={{ marginTop: -6 }}>
          <div className="small muted">First name: {accountFirstName || '—'}</div>
          <div className="small muted">Last name: {accountLastName || '—'}</div>
          <div className="small muted">Email: {email || '—'}</div>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <button className="inline" type="button" onClick={() => { setShowAccountSettings(true); setAccountOpen(false); }}>Settings</button>
            <button className="inline" type="button" onClick={() => void onSignOut()}>Sign out</button>
          </div>
        </section>
      )}
      {showAccountSettings && settings && (
        <section className="card stack">
          <div className="row">
            <strong>Account settings</strong>
            <button className="inline" type="button" onClick={() => setShowAccountSettings(false)}>Close</button>
          </div>
          <input placeholder="First name" value={accountFirstName} onChange={(e) => setAccountFirstName(e.target.value)} />
          <input placeholder="Last name" value={accountLastName} onChange={(e) => setAccountLastName(e.target.value)} />
          <input value={email || ''} disabled />
          <label className="row"><span>Daily reminder</span><input type="checkbox" checked={settings.daily_reminder} onChange={(e) => setSettings({ ...settings, daily_reminder: e.target.checked })} /></label>
          <label className="row"><span>Weekly reminder</span><input type="checkbox" checked={settings.weekly_reminder} onChange={(e) => setSettings({ ...settings, weekly_reminder: e.target.checked })} /></label>
          <input value={settings.default_risk} onChange={(e) => setSettings({ ...settings, default_risk: Number(e.target.value || 0) })} type="number" placeholder="Default risk" />
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
        </section>
      )}

      {tab === 'dashboard' && (
        <section className="stack">
          <section className="card stack">
            <div className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>
              <div style={{ flex: 1 }}>
                <label className="small muted" htmlFor="period-type">Period type</label>
                <select id="period-type" value={dashboardPeriod} onChange={(e) => setDashboardPeriod(e.target.value as DashboardPeriod)}>
                  <option value="weekly">Week</option>
                  <option value="monthly">Month</option>
                  <option value="quarterly">Quarter</option>
                  <option value="annual">Year</option>
                  <option value="ytd">YTD</option>
                </select>
              </div>
              <div style={{ flex: 1 }}>
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
            </div>
            <div className="small muted">{formatPeriodLabel(dashboardPeriod, dashboardAnchor, periodRange.start, periodRange.end)}</div>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <button className="inline" type="button" onClick={() => setDashboardAnchor(shiftPeriod(dashboardAnchor, dashboardPeriod, -1))}>Prev</button>
              <button className="inline" type="button" onClick={() => setDashboardAnchor(new Date())}>Today</button>
              <button className="inline" type="button" onClick={() => setDashboardAnchor(shiftPeriod(dashboardAnchor, dashboardPeriod, 1))}>Next</button>
            </div>
          </section>
          <div className="grid">
            <article className="card"><div className="muted small">Total trades</div><div>{trades.length}</div></article>
            <article className="card"><div className="muted small">Net P&L</div><div style={{ color: netPnl >= 0 ? '#4ad66d' : '#ff6b6b' }}>{netPnl.toFixed(2)}</div></article>
            <article className="card"><div className="muted small">Win rate</div><div style={{ color: (trades.length ? (wins / trades.length) * 100 : 0) >= 50 ? '#4ad66d' : '#ff6b6b' }}>{trades.length ? Math.round((wins / trades.length) * 100) : 0}%</div></article>
            <article className="card"><div className="muted small">No-trade days</div><div>{noTrades.length}</div></article>
            <article className="card"><div className="muted small">Avg emotional pressure</div><div>{avgEmotionalPressure.toFixed(2)} / 5</div></article>
          </div>
          <section className="grid">
            <article className="card"><div className="muted small">Period Net P&L</div><div style={{ color: periodNetPnl >= 0 ? '#4ad66d' : '#ff6b6b' }}>{periodNetPnl.toFixed(2)}</div></article>
            <article className="card"><div className="muted small">Period Net R</div><div style={{ color: periodNetR >= 0 ? '#4ad66d' : '#ff6b6b' }}>{periodNetR.toFixed(2)}R</div></article>
            <article className="card"><div className="muted small">Period trades</div><div>{periodTrades.length}</div></article>
            <article className="card"><div className="muted small">Period win rate</div><div style={{ color: periodWinRate >= 50 ? '#4ad66d' : '#ff6b6b' }}>{periodWinRate.toFixed(1)}%</div></article>
            <article className="card"><div className="muted small">Period no-trade days</div><div>{periodNoTrades.length}</div></article>
            <article className="card"><div className="muted small">Avg R</div><div style={{ color: periodAvgR >= 0 ? '#4ad66d' : '#ff6b6b' }}>{periodAvgR.toFixed(2)}R</div></article>
            <article className="card"><div className="muted small">Avg emotional pressure</div><div>{periodAvgEmotion.toFixed(2)} / 5</div></article>
            <article className="card"><div className="muted small">Average winner result</div><div style={{ color: '#4ad66d' }}>{avgWinnerResult.toFixed(2)}</div></article>
            <article className="card"><div className="muted small">Average loser result</div><div style={{ color: '#ff6b6b' }}>{avgLoserResult.toFixed(2)}</div></article>
          </section>

          <section className="card stack">
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <strong>Performance chart</strong>
              <select value={chartMetric} onChange={(e) => setChartMetric(e.target.value as 'pnl' | 'r')} style={{ width: 'auto' }}>
                <option value="pnl">$</option>
                <option value="r">R</option>
              </select>
              <select value={chartView} onChange={(e) => setChartView(e.target.value as 'daily' | 'cumulative')} style={{ width: 'auto' }}>
                <option value="daily">Daily</option>
                <option value="cumulative">Cumulative</option>
              </select>
              <select value={chartOverlay} onChange={(e) => setChartOverlay(e.target.value as 'none' | 'count')} style={{ width: 'auto' }}>
                <option value="none">Overlay: None</option>
                <option value="count">Overlay: Trade count</option>
              </select>
            </div>
            <PerformanceChart points={periodTimeline} metric={chartMetric} view={chartView} overlay={chartOverlay} />
          </section>

          <section className="card stack">
            <strong>{dashboardPeriod === 'monthly' ? 'Calendar month view' : 'Context calendar (anchor month)'}</strong>
            <div className="row" style={{ justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
              <div className="row" style={{ gap: 6, width: 'auto' }}>
                <button className="inline" type="button" onClick={() => setCalendarView('month')}>{calendarView === 'month' ? '✓ ' : ''}Month view</button>
                <button className="inline" type="button" onClick={() => setCalendarView('weekly')}>{calendarView === 'weekly' ? '✓ ' : ''}Weekly view</button>
              </div>
              <div className="row" style={{ gap: 6, width: 'auto' }}>
                <button className="inline" type="button" onClick={() => setCalendarMetric('pnl')}>{calendarMetric === 'pnl' ? '✓ ' : ''}$</button>
                <button className="inline" type="button" onClick={() => setCalendarMetric('r')}>{calendarMetric === 'r' ? '✓ ' : ''}R</button>
              </div>
            </div>
            <div className="small muted">
              {dashboardPeriod === 'monthly'
                ? calendarMonth.toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' })
                : `Showing ${calendarMonth.toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' })} only as context. Metrics above use ${periodTypeLabel(dashboardPeriod)}.`}
            </div>
            {calendarView === 'month' ? (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0,1fr))', gap: 4 }}>
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => <div key={d} className="small muted" style={{ textAlign: 'center' }}>{d}</div>)}
                {calendarCells.map((cell) => {
                  const metricValue = calendarMetric === 'pnl' ? cell.pnl : cell.rTotal;
                  return (
                    <article key={cell.date} className="trade" style={{ padding: 6, minHeight: 56, background: cell.isOutside ? '#0f1724' : metricValue > 0 ? 'rgba(74,214,109,0.17)' : metricValue < 0 ? 'rgba(255,107,107,0.18)' : cell.noTrade ? 'rgba(148,163,184,0.2)' : '#0f1622', borderColor: cell.tradeCount || cell.noTrade ? undefined : '#223045' }}>
                      <div className="small muted">{cell.day}</div>
                      {cell.tradeCount > 0 ? <div className="small">{calendarMetric === 'pnl' ? `$${cell.pnl.toFixed(0)}` : `${cell.rTotal.toFixed(1)}R`}</div> : null}
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

          <section className="card stack">
            <strong>Selected period insights</strong>
            <div className="small muted">Most common mistakes: {topMistakes.length ? topMistakes.map(([tag, count]) => `${tag} (${count})`).join(', ') : 'None'}</div>
            <div className="small muted">Best setup family: {bestFamily ? `${bestFamily.key} (${bestFamily.netPnl.toFixed(2)}$)` : 'N/A'}</div>
            <div className="small muted">Best setup model: {bestModel ? `${bestModel.key} (${bestModel.netPnl.toFixed(2)}$)` : 'N/A'}</div>
            <div className="small muted">Worst setup family: {worstFamily ? `${worstFamily.key} (${worstFamily.netPnl.toFixed(2)}$)` : 'N/A'}</div>
            <div className="small muted">Worst setup model: {worstModel ? `${worstModel.key} (${worstModel.netPnl.toFixed(2)}$)` : 'N/A'}</div>
            <div className="small muted">Highest win-rate families: {topWinFamilies.length ? topWinFamilies.map((x) => `${x.key} (${x.winRate.toFixed(0)}%)`).join(', ') : 'N/A'}</div>
            <div className="small muted">Highest win-rate models: {topWinModels.length ? topWinModels.map((x) => `${x.key} (${x.winRate.toFixed(0)}%)`).join(', ') : 'N/A'}</div>
            <div className="small muted">Emotional pressure distribution: {pressureBuckets.map((b) => `${b.level}:${b.count}`).join(' · ')}</div>
            <div className="small muted">High pressure (4-5) avg P&L: <span style={{ color: highPressureAvgPnl >= 0 ? '#4ad66d' : '#ff6b6b' }}>{highPressureAvgPnl.toFixed(2)}</span></div>
            <div className="small muted">Low pressure (1-2) avg P&L: <span style={{ color: lowPressureAvgPnl >= 0 ? '#4ad66d' : '#ff6b6b' }}>{lowPressureAvgPnl.toFixed(2)}</span></div>
          </section>

          <div className="card small muted">Passkeys are not implemented yet. Auth structure is now Supabase-based so passkey support can be added next via WebAuthn flows.</div>
        </section>
      )}

      {tab === 'history' && (
        <section className="card stack">
          {activityItems.map((item) => (
            item.type === 'trade' ? (
              <Fragment key={`trade-row-${item.id}`}>
                <article className="trade" ref={(node) => { detailAnchors.current[`trade:${item.trade.id}`] = node; }}>
                  <div className="row"><strong>{item.trade.ticker}</strong><span>{item.trade.trade_date}</span></div>
                  <div className="small muted"><span className="badge">Trade</span> {item.trade.family} · {item.trade.model}</div>
                  <div className="small">{item.trade.classification} · ${item.trade.pnl} · {item.trade.r_multiple}R · {item.trade.minutes_in_trade}m</div>
                  <div className="small muted">Emotional pressure: {item.trade.emotional_pressure}/5</div>
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
                      <div className="small">Family: {item.trade.family}</div>
                      <div className="small">Model: {item.trade.model}</div>
                      <div className="small">Classification: {item.trade.classification}</div>
                      <div className="small">Result: ${item.trade.pnl}</div>
                      <div className="small">R multiple: {item.trade.r_multiple}</div>
                      <div className="small">Minutes in trade: {item.trade.minutes_in_trade}</div>
                      <div className="small">Emotional pressure: {item.trade.emotional_pressure}/5</div>
                      <div className="small">Mistake tags: {normalizeMistakeTags(item.trade.mistake_tags).length ? normalizeMistakeTags(item.trade.mistake_tags).join(', ') : 'None'}</div>
                      <div className="small" style={{ whiteSpace: 'pre-wrap' }}>Notes: {item.trade.notes || '—'}</div>
                      <AttachmentPreviewList entries={attachments.filter((a) => a.trade_id === item.trade.id)} signedUrls={signedUrls} onOpenImage={(url, name) => setLightbox({ url, name })} />
                    </div>
                  </article>
                )}
              </Fragment>
            ) : item.type === 'no_trade' ? (
              <Fragment key={`no-trade-row-${item.id}`}>
                <article className="trade no-trade" ref={(node) => { detailAnchors.current[`no_trade:${item.noTrade.id}`] = node; }}>
                  <div className="row"><strong>No-trade day</strong><span>{item.noTrade.day_date}</span></div>
                  <div className="small"><span className="badge">No-trade day</span> Reason: {item.noTrade.reason}</div>
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
                      <div className="small" style={{ whiteSpace: 'pre-wrap' }}>Notes: {item.noTrade.notes || '—'}</div>
                      <AttachmentPreviewList entries={attachments.filter((a) => a.no_trade_day_id === item.noTrade.id)} signedUrls={signedUrls} onOpenImage={(url, name) => setLightbox({ url, name })} />
                    </div>
                  </article>
                )}
              </Fragment>
            ) : (
              <Fragment key={`session-row-${item.id}`}>
                <article className="trade" ref={(node) => { detailAnchors.current[`session:${item.session.id}`] = node; }}>
                  <div className="row"><strong>{titleCase(item.session.session_type)} session</strong><span>{item.session.session_date}</span></div>
                  <div className="small muted">{item.session.start_time.slice(0, 5)}–{item.session.end_time.slice(0, 5)} · {item.session.duration_minutes}m</div>
                  <div className="row">
                    <div className="small muted">Notes: {item.session.notes ? 'Yes' : 'No'}</div>
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
                        setTab('log');
                        setLogMode('session');
                      }}>Edit</button>
                      <button className="inline" type="button" onClick={() => void deleteSession(item.session.id)}>Delete</button>
                    </div>
                  </div>
                </article>
                {detail?.kind === 'session' && detail.id === item.session.id && (
                  <article className="trade" style={{ marginTop: -4 }}>
                    <div className="row">
                      <strong>Session detail</strong>
                      <button className="inline" type="button" onClick={() => setDetail(null)}>Close</button>
                    </div>
                    <div className="stack">
                      <div className="small muted">{item.session.session_date} · {titleCase(item.session.session_type)} session</div>
                      <div className="small">Start: {item.session.start_time.slice(0, 5)}</div>
                      <div className="small">End: {item.session.end_time.slice(0, 5)}</div>
                      <div className="small">Duration: {item.session.duration_minutes} minutes</div>
                      <div className="small" style={{ whiteSpace: 'pre-wrap' }}>Notes: {item.session.notes || '—'}</div>
                    </div>
                  </article>
                )}
              </Fragment>
            )
          ))}
        </section>
      )}

      {tab === 'log' && (
        <section className="stack">
          <div className="card row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <div className="small muted" style={{ width: '100%' }}>Choose what you want to log:</div>
            <button className="inline" type="button" onClick={() => setLogMode('trade')}>Trade</button>
            <button className="inline" type="button" onClick={() => setLogMode('no_trade')}>No-trade day</button>
            <button className="inline" type="button" onClick={() => setLogMode('session')}>Session (Chart / Journal)</button>
          </div>
          {logMode === 'trade' && (
          <form className="card stack" action={(fd) => startTransition(() => void addTrade(fd))}>
            <div className="row">
              <strong>{editingTradeId ? 'Edit trade' : 'Add trade'}</strong>
              {editingTradeId && <button className="inline" type="button" onClick={resetTradeDraft}>Cancel edit</button>}
            </div>
            <label className="small muted">Date</label>
            <input name="trade_date" type="date" required value={tradeDraft.trade_date} onChange={(e) => setTradeDraft((p) => ({ ...p, trade_date: e.target.value }))} />
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
            <select
              value={mistakePickerValue}
              onChange={(e) => {
                const next = normalizeTag(e.target.value);
                setMistakePickerValue('');
                if (!next) return;
                setTradeDraft((p) => ({ ...p, mistake_tags: normalizeMistakeTags([...normalizeMistakeTags(p.mistake_tags), next]) }));
              }}
            >
              <option value="">Select saved mistake tag</option>
              {mistakeTagOptions.map((tag) => <option key={tag} value={tag}>{tag}</option>)}
            </select>
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
                  ? { ...settings, mistake_catalog: normalizeMistakeTags([...(settings.mistake_catalog || []), next]) }
                  : null;
                if (nextSettings) void saveSettings(nextSettings);
                setNewMistakeTag('');
              }}>Add</button>
            </div>
            <textarea name="notes" placeholder="Notes" value={tradeDraft.notes} onChange={(e) => setTradeDraft((p) => ({ ...p, notes: e.target.value }))} />
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
              {editingNoTradeId ? <button className="inline" type="button" onClick={() => { setEditingNoTradeId(null); setNoTradeDraft({ day_date: new Date().toISOString().slice(0, 10), reason: noTradeReasons[0], notes: '' }); }}>Cancel edit</button> : null}
            </div>
            <input name="day_date" type="date" required value={noTradeDraft.day_date} onChange={(e) => setNoTradeDraft((p) => ({ ...p, day_date: e.target.value }))} />
            <select name="reason" value={noTradeDraft.reason} onChange={(e) => setNoTradeDraft((p) => ({ ...p, reason: e.target.value }))}>{noTradeReasons.map((r) => <option key={r}>{r}</option>)}</select>
            <textarea name="no_trade_notes" placeholder="No-trade notes" value={noTradeDraft.notes} onChange={(e) => setNoTradeDraft((p) => ({ ...p, notes: e.target.value }))} />
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
            <form className="card stack" action={() => startTransition(() => void addSession())}>
              <div className="row">
                <strong>{editingSessionId ? 'Edit session' : 'Log session'}</strong>
                {editingSessionId ? <button className="inline" type="button" onClick={() => {
                  setEditingSessionId(null);
                  setSessionDraft({
                    session_type: 'chart',
                    session_date: new Date().toISOString().slice(0, 10),
                    start_time: '09:00',
                    end_time: '10:00',
                    notes: ''
                  });
                }}>Cancel edit</button> : null}
              </div>
              <div className="small muted">Session type (required)</div>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <button className="inline" type="button" onClick={() => setSessionDraft((p) => ({ ...p, session_type: 'chart' }))}>
                  {sessionDraft.session_type === 'chart' ? '✓ ' : ''}Chart session
                </button>
                <button className="inline" type="button" onClick={() => setSessionDraft((p) => ({ ...p, session_type: 'journal' }))}>
                  {sessionDraft.session_type === 'journal' ? '✓ ' : ''}Journal session
                </button>
              </div>
              <div className="small muted">Use Chart session for chart study/backtesting. Use Journal session for writing/reviewing journal notes.</div>
              <label className="small muted">Date</label>
              <input type="date" value={sessionDraft.session_date} onChange={(e) => setSessionDraft((p) => ({ ...p, session_date: e.target.value }))} />
              <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
                <div className="stack">
                  <label className="small muted">Start time</label>
                  <input type="time" value={sessionDraft.start_time} onChange={(e) => setSessionDraft((p) => ({ ...p, start_time: e.target.value }))} />
                </div>
                <div className="stack">
                  <label className="small muted">End time</label>
                  <input type="time" value={sessionDraft.end_time} onChange={(e) => setSessionDraft((p) => ({ ...p, end_time: e.target.value }))} />
                </div>
              </div>
              <div className="small muted">Duration: {calculateDurationMinutes(sessionDraft.start_time, sessionDraft.end_time)} minutes</div>
              <textarea placeholder="Session notes (optional)" value={sessionDraft.notes} onChange={(e) => setSessionDraft((p) => ({ ...p, notes: e.target.value }))} />
              <button className="primary" disabled={pending}>{editingSessionId ? 'Update session' : 'Save session'}</button>
            </form>
          )}
        </section>
      )}

      {tab === 'review' && (
        <section className="card stack">
          <strong>Weekly review</strong>
          <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <input type="week" value={weekInput} onChange={(e) => setWeekInput(e.target.value)} />
            <select value={weekInput} onChange={(e) => setWeekInput(e.target.value)}>
              {[currentWeekInput(), ...reviews.map((r) => weekInputFromKey(r.week_key))]
                .filter((v, i, a) => v && a.indexOf(v) === i)
                .sort((a, b) => b.localeCompare(a))
                .map((w) => <option value={w} key={w}>{w}</option>)}
            </select>
          </div>
          <div className="chip">{reviewStatus}</div>
          <div className="trade small muted">Selected week: {selectedWeekKey}. Stats: {weekTrades.length} trade(s), {weekNoTrades.length} no-trade day(s), {weekSessions.length} session(s), {weekTrades.filter((t) => t.classification === 'FOMO trade').length} FOMO trade(s).</div>
          <div className="trade stack">
            <strong>This week's entries</strong>
            {weekTrades.map((t) => (
              <article key={t.id} className="trade">
                <div className="small muted">{t.trade_date} · {t.ticker}</div>
                <div className="small">{t.family} · {t.model} · {t.classification}</div>
                <div className="small">${t.pnl} · {t.r_multiple}R · {t.minutes_in_trade}m · Emotion {t.emotional_pressure}/5</div>
                <div>{normalizeMistakeTags(t.mistake_tags).map((m) => <span key={m} className="badge">{m}</span>)}</div>
                <div className="small" style={{ whiteSpace: 'pre-wrap' }}>Notes: {t.notes || '—'}</div>
                <AttachmentPreviewList entries={attachments.filter((a) => a.trade_id === t.id)} signedUrls={reviewSignedUrls} onOpenImage={(url, name) => setLightbox({ url, name })} />
              </article>
            ))}
            {weekNoTrades.map((n) => (
              <article key={n.id} className="trade no-trade">
                <div className="small muted">{n.day_date}</div>
                <div className="small">Reason: {n.reason}</div>
                <div className="small" style={{ whiteSpace: 'pre-wrap' }}>Notes: {n.notes || '—'}</div>
                <AttachmentPreviewList entries={attachments.filter((a) => a.no_trade_day_id === n.id)} signedUrls={reviewSignedUrls} onOpenImage={(url, name) => setLightbox({ url, name })} />
              </article>
            ))}
            {weekSessions.map((s) => (
              <article key={s.id} className="trade">
                <div className="small muted">{s.session_date} · {titleCase(s.session_type)} session</div>
                <div className="small">{s.start_time.slice(0, 5)}-{s.end_time.slice(0, 5)} · {s.duration_minutes}m</div>
              </article>
            ))}
            {!weekTrades.length && !weekNoTrades.length && !weekSessions.length && <div className="small muted">No entries for selected week.</div>}
          </div>
          <label className="small muted">1) Reflection on mistakes</label>
          <textarea value={reviewAnswers.q1} onChange={(e) => setReviewAnswers((s) => ({ ...s, q1: e.target.value }))} />
          <label className="small muted">2) Reflection on no-trade choices</label>
          <textarea value={reviewAnswers.q2} onChange={(e) => setReviewAnswers((s) => ({ ...s, q2: e.target.value }))} />
          <label className="small muted">3) Rule for next week</label>
          <textarea value={reviewAnswers.q3} onChange={(e) => setReviewAnswers((s) => ({ ...s, q3: e.target.value }))} />
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

type TimelinePoint = { date: string; value: number; tradeCount: number; noTrade: boolean };

function PerformanceChart({ points, metric, view, overlay }: { points: TimelinePoint[]; metric: 'pnl' | 'r'; view: 'daily' | 'cumulative'; overlay: 'none' | 'count' }) {
  if (!points.length) return <div className="small muted">No data in selected period.</div>;
  const values = points.map((p) => p.value);
  const maxAbs = Math.max(1, ...values.map((v) => Math.abs(v)));
  const baseline = 70;
  const chartHeight = 140;
  const width = Math.max(320, points.length * 18);
  const maxTradeCount = Math.max(1, ...points.map((p) => p.tradeCount));
  const polyline = points.map((point, idx) => {
    const x = (idx / Math.max(1, points.length - 1)) * (width - 24) + 12;
    const y = baseline - (point.value / maxAbs) * 56;
    return `${x},${Math.max(10, Math.min(chartHeight - 10, y))}`;
  }).join(' ');

  return (
    <div style={{ overflowX: 'auto' }}>
      <svg viewBox={`0 0 ${width} ${chartHeight}`} style={{ width: '100%', minWidth: width, height: 170 }}>
        <line x1={0} y1={baseline} x2={width} y2={baseline} stroke="#2a3445" strokeWidth={1} />
        {view === 'daily' && points.map((point, idx) => {
          const x = idx * 18 + 10;
          const barHeight = Math.max(2, Math.abs(point.value / maxAbs) * 52);
          const y = point.value >= 0 ? baseline - barHeight : baseline;
          return <rect key={`bar-${point.date}`} x={x} y={y} width={10} height={barHeight} fill={point.value >= 0 ? '#4ad66d' : '#ff6b6b'} rx={2} />;
        })}
        {view === 'cumulative' && <polyline fill="none" stroke="#70c8ff" strokeWidth={2} points={polyline} />}
        {overlay === 'count' && points.map((point, idx) => {
          const x = view === 'daily' ? idx * 18 + 15 : (idx / Math.max(1, points.length - 1)) * (width - 24) + 12;
          const y = chartHeight - 12 - (point.tradeCount / maxTradeCount) * 24;
          return point.tradeCount > 0 ? <circle key={`count-${point.date}`} cx={x} cy={y} r={2.5} fill="#c7d2fe" /> : null;
        })}
        {points.map((point, idx) => {
          if (!point.noTrade) return null;
          const x = view === 'daily' ? idx * 18 + 10 : (idx / Math.max(1, points.length - 1)) * (width - 24) + 8;
          return <line key={`nt-${point.date}`} x1={x} y1={chartHeight - 6} x2={x + 6} y2={chartHeight - 6} stroke="#9ca3af" strokeWidth={2} />;
        })}
      </svg>
      <div className="small muted">Showing {view} {metric === 'pnl' ? '$' : 'R'}{overlay === 'count' ? ' with trade-count overlay' : ''}.</div>
    </div>
  );
}

function buildPeriodTimeline(start: string, end: string, periodTrades: TradeRow[], periodNoTrades: NoTradeDayRow[], metric: 'pnl' | 'r', view: 'daily' | 'cumulative'): TimelinePoint[] {
  const dates = enumerateDates(start, end);
  let running = 0;
  return dates.map((date) => {
    const dayTrades = periodTrades.filter((t) => t.trade_date === date);
    const dayValue = dayTrades.reduce((sum, trade) => sum + Number(metric === 'pnl' ? trade.pnl : trade.r_multiple), 0);
    running += dayValue;
    return {
      date,
      value: view === 'cumulative' ? running : dayValue,
      tradeCount: dayTrades.length,
      noTrade: periodNoTrades.some((n) => n.day_date === date)
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
  const options: Array<{ value: string; label: string; anchor: Date }> = [];
  const selected = jumpValueForAnchor(period, anchor);
  const base = new Date(anchor);
  const count = period === 'weekly' ? 24 : period === 'monthly' ? 24 : period === 'quarterly' ? 16 : 12;
  for (let i = 0; i < count; i += 1) {
    const next = shiftPeriod(base, period, -i);
    options.push({
      value: jumpValueForAnchor(period, next),
      label: formatPeriodLabel(period, next, getPeriodRange(period, next).start, getPeriodRange(period, next).end),
      anchor: normalizeAnchorForPeriod(period, next)
    });
  }
  if (!options.some((opt) => opt.value === selected)) {
    options.unshift({
      value: selected,
      label: formatPeriodLabel(period, anchor, getPeriodRange(period, anchor).start, getPeriodRange(period, anchor).end),
      anchor: normalizeAnchorForPeriod(period, anchor)
    });
  }
  return { selected, options };
}

function jumpValueForAnchor(period: DashboardPeriod, anchor: Date) {
  if (period === 'weekly') return weekKeyFromDate(anchor.toISOString().slice(0, 10));
  if (period === 'monthly') return `${anchor.getUTCFullYear()}-${String(anchor.getUTCMonth() + 1).padStart(2, '0')}`;
  if (period === 'quarterly') return `${anchor.getUTCFullYear()}-Q${Math.floor(anchor.getUTCMonth() / 3) + 1}`;
  return String(anchor.getUTCFullYear());
}

function normalizeAnchorForPeriod(period: DashboardPeriod, anchor: Date) {
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

function countItems(items: string[]) {
  return items.reduce<Record<string, number>>((acc, item) => {
    const key = String(item || '').trim();
    if (!key) return acc;
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
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
  return 'YTD';
}

function formatPeriodLabel(period: DashboardPeriod, anchor: Date, start: string, end: string) {
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
  if (Array.isArray(value)) {
    return normalizeUniqueTags(value.map((item) => normalizeTag(String(item ?? ''))));
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return [];
    const tokens = trimmed.includes(',') ? trimmed.split(',') : [trimmed];
    return normalizeUniqueTags(tokens.map((token) => normalizeTag(token)));
  }
  if (value == null) return [];
  if (typeof value === 'object') return [];
  return normalizeUniqueTags([normalizeTag(String(value))]);
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

function normalizeSupabaseError(message: string) {
  const text = String(message || '');
  if (isRecoverableSchemaError(text)) {
    return 'Some data is temporarily unavailable while database schema metadata refreshes. Please retry in a moment.';
  }
  return text;
}

function isSettingsCatalogSchemaMismatch(message: string) {
  const text = String(message || '');
  return /could not find .*?(instruments|mistake_catalog).*?schema cache/i.test(text)
    || /column .*?(instruments|mistake_catalog).*? does not exist/i.test(text);
}

function isRecoverableSchemaError(message: string) {
  const text = String(message || '');
  return isSettingsCatalogSchemaMismatch(text)
    || /schema cache/i.test(text)
    || /column .* does not exist/i.test(text)
    || /relation .* does not exist/i.test(text)
    || /Could not find the table/i.test(text);
}

function currentWeekKey() {
  const now = new Date();
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const d = monday.getUTCDay() || 7;
  monday.setUTCDate(monday.getUTCDate() - d + 1);
  return monday.toISOString().slice(0, 10);
}

function weekKeyFromDate(dateStr: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateStr || ''))) return '';
  const [y, m, d] = String(dateStr).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const w = dt.getUTCDay() || 7;
  dt.setUTCDate(dt.getUTCDate() - w + 1);
  return dt.toISOString().slice(0, 10);
}

function weekInputFromKey(weekKey: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(weekKey || ''))) return '';
  const [y, m, d] = weekKey.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
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
