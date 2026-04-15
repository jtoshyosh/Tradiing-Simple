'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase-browser';
import type { AttachmentRow, NoTradeDayRow, SettingsRow, TradeRow, WeeklyReviewRow, TradeClassification } from '@/types/models';

const tabs = ['dashboard', 'trades', 'add', 'review', 'settings'] as const;
type Tab = (typeof tabs)[number];
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

type Props = { userId: string; email?: string };
type DetailState = { kind: 'trade'; id: string } | { kind: 'no_trade'; id: string } | null;
type TradeDraft = {
  trade_date: string;
  ticker: string;
  classification: TradeClassification;
  family: string;
  model: string;
  pnl: string;
  r_multiple: string;
  minutes_in_trade: string;
  emotional_pressure: string;
  mistake_tags: string;
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
type TradeExtractSuggestions = Partial<Pick<TradeDraft, 'trade_date' | 'ticker' | 'pnl' | 'r_multiple' | 'minutes_in_trade'>> & { hints?: string[]; detectedText?: string } & OcrDebugState;
type NoTradeExtractSuggestions = Partial<Pick<NoTradeDayRow, 'day_date' | 'reason'>> & { hints?: string[]; detectedText?: string } & OcrDebugState;

export default function JournalApp({ userId, email }: Props) {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [tab, setTab] = useState<Tab>('dashboard');
  const [trades, setTrades] = useState<TradeRow[]>([]);
  const [noTrades, setNoTrades] = useState<NoTradeDayRow[]>([]);
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
  const [lightbox, setLightbox] = useState<{ url: string; name: string } | null>(null);
  const [tradeExtract, setTradeExtract] = useState<TradeExtractSuggestions | null>(null);
  const [noTradeExtract, setNoTradeExtract] = useState<NoTradeExtractSuggestions | null>(null);
  const [noTradeDraft, setNoTradeDraft] = useState<{ day_date: string; reason: string }>({ day_date: new Date().toISOString().slice(0, 10), reason: noTradeReasons[0] });
  const [dashboardPeriod, setDashboardPeriod] = useState<DashboardPeriod>('monthly');
  const [dashboardAnchor, setDashboardAnchor] = useState<Date>(() => new Date());
  const [tradeDraft, setTradeDraft] = useState<TradeDraft>(() => ({
    trade_date: new Date().toISOString().slice(0, 10),
    ticker: '',
    classification: 'Valid setup',
    family: 'Bounce',
    model: familyModels.Bounce[0],
    pnl: '',
    r_multiple: '',
    minutes_in_trade: '',
    emotional_pressure: '1',
    mistake_tags: '',
    notes: ''
  }));
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    void loadAll();
    // migration note for teams moving from local-only index.html:
    // export old localStorage JSON blobs and transform into inserts for trades/no_trade_days/weekly_reviews/settings/attachments.
  }, []);

  async function loadAll() {
    const [t, n, r, s, a] = await Promise.all([
      supabase.from('trades').select('*').order('trade_date', { ascending: false }),
      supabase.from('no_trade_days').select('*').order('day_date', { ascending: false }),
      supabase.from('weekly_reviews').select('*').order('week_key', { ascending: false }),
      supabase.from('user_settings').select('*').maybeSingle(),
      supabase.from('attachments').select('*').order('created_at', { ascending: false })
    ]);
    if (t.error || n.error || r.error || s.error || a.error) {
      setError(t.error?.message || n.error?.message || r.error?.message || s.error?.message || a.error?.message || 'Load failed');
      return;
    }
    setTrades((t.data || []) as TradeRow[]);
    setNoTrades((n.data || []) as NoTradeDayRow[]);
    setReviews((r.data || []) as WeeklyReviewRow[]);
    setSettings((s.data as SettingsRow | null) ?? { user_id: userId, daily_reminder: true, weekly_reminder: true, default_risk: 200, display_name: 'JY' });
    setAttachments((a.data || []) as AttachmentRow[]);
  }

  const netPnl = trades.reduce((s, t) => s + Number(t.pnl || 0), 0);
  const wins = trades.filter((t) => t.pnl > 0).length;
  const avgEmotionalPressure = trades.length ? (trades.reduce((sum, t) => sum + Number(t.emotional_pressure || 0), 0) / trades.length) : 0;
  const periodRange = getPeriodRange(dashboardPeriod, dashboardAnchor);
  const periodTrades = trades.filter((t) => inDateRange(t.trade_date, periodRange.start, periodRange.end));
  const periodNoTrades = noTrades.filter((n) => inDateRange(n.day_date, periodRange.start, periodRange.end));
  const periodNetPnl = periodTrades.reduce((sum, t) => sum + Number(t.pnl || 0), 0);
  const periodWins = periodTrades.filter((t) => Number(t.pnl || 0) > 0).length;
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
  const mistakeTagCounts = countItems(periodTrades.flatMap((t) => t.mistake_tags || []));
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

  const selectedWeekKey = weekKeyFromInput(weekInput);
  const weekTrades = trades.filter((t) => weekKeyFromDate(t.trade_date) === selectedWeekKey);
  const weekNoTrades = noTrades.filter((n) => weekKeyFromDate(n.day_date) === selectedWeekKey);
  const reviewRow = reviews.find((r) => r.week_key === selectedWeekKey);

  useEffect(() => {
    setReviewAnswers({ q1: reviewRow?.q1 || '', q2: reviewRow?.q2 || '', q3: reviewRow?.q3 || '' });
  }, [reviewRow?.id, selectedWeekKey]);

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
      r_multiple: Number(tradeDraft.r_multiple || 0),
      minutes_in_trade: Number(tradeDraft.minutes_in_trade || 0),
      emotional_pressure: Math.min(5, Math.max(1, Number(tradeDraft.emotional_pressure || 1))),
      mistake_tags: String(tradeDraft.mistake_tags || '').split(',').map((x) => x.trim()).filter(Boolean),
      notes: String(tradeDraft.notes || '')
    };

    const tradeResult = editingTradeId
      ? await supabase.from('trades').update(payload).eq('id', editingTradeId).select('*').single()
      : await supabase.from('trades').insert(payload).select('*').single();
    const { data, error: upsertError } = tradeResult;
    if (upsertError) {
      setError(upsertError.message);
      return;
    }

    const files = formData.getAll('files') as File[];
    for (const file of files) {
      if (!file || file.size === 0) continue;
      const filePath = `${userId}/${data.id}/${crypto.randomUUID()}_${file.name}`;
      const { error: uploadError } = await supabase.storage.from('attachments').upload(filePath, file, { upsert: false });
      if (uploadError) {
        setError(uploadError.message);
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
    setTab('trades');
  }

  async function addNoTrade(formData: FormData) {
    const { data, error: insertError } = await supabase
      .from('no_trade_days')
      .insert({
        user_id: userId,
        day_date: noTradeDraft.day_date || new Date().toISOString().slice(0, 10),
        reason: noTradeDraft.reason || 'No A+ setup'
      })
      .select('*')
      .single();
    if (insertError) {
      setError(insertError.message);
      return;
    }

    const files = formData.getAll('no_trade_files') as File[];
    for (const file of files) {
      if (!file || file.size === 0) continue;
      const filePath = `${userId}/no-trade/${data.id}/${crypto.randomUUID()}_${file.name}`;
      const { error: uploadError } = await supabase.storage.from('attachments').upload(filePath, file, { upsert: false });
      if (uploadError) {
        setError(uploadError.message);
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
    setNoTradeDraft({ day_date: new Date().toISOString().slice(0, 10), reason: noTradeReasons[0] });
    setNoTradeExtract(null);
    setTab('trades');
  }

  async function saveReview() {
    const payload = { user_id: userId, week_key: selectedWeekKey, ...reviewAnswers };
    const { error: upsertError } = await supabase
      .from('weekly_reviews')
      .upsert(payload, { onConflict: 'user_id,week_key' });
    if (upsertError) setError(upsertError.message);
    else await loadAll();
  }

  async function saveSettings(next: SettingsRow) {
    const { error: upsertError } = await supabase.from('user_settings').upsert(next, { onConflict: 'user_id' });
    if (upsertError) setError(upsertError.message);
    else setSettings(next);
  }

  function resetTradeDraft() {
    setEditingTradeId(null);
    setAddTradeClassification('Valid setup');
    setAddTradeFamily('Bounce');
    setAddTradeModel(familyModels.Bounce[0]);
    setTradeDraft({
      trade_date: new Date().toISOString().slice(0, 10),
      ticker: '',
      classification: 'Valid setup',
      family: 'Bounce',
      model: familyModels.Bounce[0],
      pnl: '',
      r_multiple: '',
      minutes_in_trade: '',
      emotional_pressure: '1',
      mistake_tags: '',
      notes: ''
    });
    setTradeExtract(null);
  }

  function startEditTrade(trade: TradeRow) {
    setEditingTradeId(trade.id);
    setTab('add');
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
      r_multiple: String(trade.r_multiple ?? ''),
      minutes_in_trade: String(trade.minutes_in_trade ?? ''),
      emotional_pressure: String(trade.emotional_pressure ?? 1),
      mistake_tags: (trade.mistake_tags || []).join(', '),
      notes: trade.notes || ''
    });
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
      setError(deleteError.message);
      return;
    }
    if (detail?.kind === 'trade' && detail.id === tradeId) setDetail(null);
    await loadAll();
  }

  async function openEntryDetail(nextDetail: DetailState) {
    if (!nextDetail) return;
    setDetail(nextDetail);
    setError('');

    const linkedAttachments =
      nextDetail.kind === 'trade'
        ? attachments.filter((a) => a.trade_id === nextDetail.id)
        : attachments.filter((a) => a.no_trade_day_id === nextDetail.id);

    if (!linkedAttachments.length) {
      setSignedUrls({});
      return;
    }

    const filePaths = linkedAttachments.map((a) => a.file_path);
    const { data, error: signError } = await supabase.storage.from('attachments').createSignedUrls(filePaths, 60 * 60);
    if (signError) {
      setError(signError.message);
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

  function applyTradeSuggestion<K extends keyof TradeDraft>(key: K, value: TradeDraft[K]) {
    setTradeDraft((prev) => ({ ...prev, [key]: value }));
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

  return (
    <main className="app">
      <header className="header">
        <div>
          <div className="sub">JY Trading Journal</div>
          <h1>Own your process.<br />Build consistency.</h1>
          <div className="muted small">Connected app (Next.js + Supabase) • {email}</div>
        </div>
        <div className="stack" style={{ alignItems: 'flex-end' }}>
          <span className="chip">Connected</span>
          <span className="chip version">v0.9</span>
        </div>
      </header>

      {tab === 'dashboard' && (
        <section className="stack">
          <section className="card stack">
            <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
              <strong>Analytics period</strong>
              <span className="chip">{formatRangeLabel(periodRange.start, periodRange.end)}</span>
            </div>
            <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
              {(['weekly', 'monthly', 'quarterly', 'annual', 'ytd'] as DashboardPeriod[]).map((p) => (
                <button key={p} className={dashboardPeriod === p ? 'chip' : 'inline'} type="button" onClick={() => setDashboardPeriod(p)}>
                  {titleCase(p)}
                </button>
              ))}
            </div>
            <div className="row">
              <button className="inline" type="button" onClick={() => setDashboardAnchor(shiftPeriod(dashboardAnchor, dashboardPeriod, -1))}>← Previous</button>
              <button className="inline" type="button" onClick={() => setDashboardAnchor(new Date())}>Today</button>
              <button className="inline" type="button" onClick={() => setDashboardAnchor(shiftPeriod(dashboardAnchor, dashboardPeriod, 1))}>Next →</button>
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
            <article className="card"><div className="muted small">Period trades</div><div>{periodTrades.length}</div></article>
            <article className="card"><div className="muted small">Period win rate</div><div style={{ color: periodWinRate >= 50 ? '#4ad66d' : '#ff6b6b' }}>{periodWinRate.toFixed(1)}%</div></article>
            <article className="card"><div className="muted small">Period no-trade days</div><div>{periodNoTrades.length}</div></article>
            <article className="card"><div className="muted small">Avg R</div><div style={{ color: periodAvgR >= 0 ? '#4ad66d' : '#ff6b6b' }}>{periodAvgR.toFixed(2)}R</div></article>
            <article className="card"><div className="muted small">Avg emotional pressure</div><div>{periodAvgEmotion.toFixed(2)} / 5</div></article>
          </section>

          <section className="card stack">
            <strong>Calendar month view</strong>
            <div className="small muted">{calendarMonth.toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' })}</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0,1fr))', gap: 6 }}>
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => <div key={d} className="small muted" style={{ textAlign: 'center' }}>{d}</div>)}
              {calendarCells.map((cell) => (
                <article key={cell.date} className="trade" style={{ padding: 8, minHeight: 64, background: cell.isOutside ? '#0f1724' : cell.pnl > 0 ? 'rgba(74,214,109,0.17)' : cell.pnl < 0 ? 'rgba(255,107,107,0.18)' : cell.noTrade ? 'rgba(148,163,184,0.2)' : '#101827' }}>
                  <div className="small muted">{cell.day}</div>
                  <div className="small" style={{ color: cell.pnl > 0 ? '#4ad66d' : cell.pnl < 0 ? '#ff7b7b' : '#d7e2f5' }}>${cell.pnl.toFixed(0)}</div>
                  <div className="small muted">{cell.tradeCount} trade(s)</div>
                </article>
              ))}
            </div>
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

      {tab === 'trades' && (
        <section className="card stack">
          {trades.map((t) => (
            <article key={t.id} className="trade">
              <div className="row"><strong>{t.ticker}</strong><span>{t.trade_date}</span></div>
              <div className="small muted">{t.family} · {t.model}</div>
              <div className="small">{t.classification} · ${t.pnl} · {t.r_multiple}R · {t.minutes_in_trade}m</div>
              <div className="small muted">Emotional pressure: {t.emotional_pressure}/5</div>
              <div>{t.mistake_tags?.map((m) => <span className="badge" key={m}>{m}</span>)}</div>
              <div className="row">
                <div className="small muted">Attachments: {attachments.filter((a) => a.trade_id === t.id).length}</div>
                <div className="row">
                  <button className="inline" type="button" onClick={() => void openEntryDetail({ kind: 'trade', id: t.id })}>View</button>
                  <button className="inline" type="button" onClick={() => startEditTrade(t)}>Edit</button>
                  <button className="inline" type="button" onClick={() => void deleteTrade(t.id)}>Delete</button>
                </div>
              </div>
            </article>
          ))}
          {noTrades.map((n) => (
            <article key={n.id} className="trade no-trade">
              <div className="row"><strong>No-trade day</strong><span>{n.day_date}</span></div>
              <div className="small">Reason: {n.reason}</div>
              <div className="row">
                <div className="small muted">Attachments: {attachments.filter((a) => a.no_trade_day_id === n.id).length}</div>
                <button className="inline" type="button" onClick={() => void openEntryDetail({ kind: 'no_trade', id: n.id })}>View details</button>
              </div>
            </article>
          ))}
          {detail && (
            <article className={`trade ${detail.kind === 'no_trade' ? 'no-trade' : ''}`}>
              <div className="row">
                <strong>{detail.kind === 'trade' ? 'Trade detail' : 'No-trade detail'}</strong>
                <button className="inline" type="button" onClick={() => setDetail(null)}>Close</button>
              </div>
              {detail.kind === 'trade' ? (
                (() => {
                  const trade = trades.find((t) => t.id === detail.id);
                  const linked = attachments.filter((a) => a.trade_id === detail.id);
                  if (!trade) return <div className="small muted">Trade not found.</div>;
                  return (
                    <div className="stack">
                      <div className="small muted">{trade.trade_date} · {trade.ticker}</div>
                      <div className="small">Family: {trade.family}</div>
                      <div className="small">Model: {trade.model}</div>
                      <div className="small">Classification: {trade.classification}</div>
                      <div className="small">Result: ${trade.pnl}</div>
                      <div className="small">R multiple: {trade.r_multiple}</div>
                      <div className="small">Minutes in trade: {trade.minutes_in_trade}</div>
                      <div className="small">Emotional pressure: {trade.emotional_pressure}/5</div>
                      <div className="small">Mistake tags: {trade.mistake_tags?.length ? trade.mistake_tags.join(', ') : 'None'}</div>
                      <div className="small">Notes: {trade.notes || '—'}</div>
                      <AttachmentPreviewList entries={linked} signedUrls={signedUrls} onOpenImage={(url, name) => setLightbox({ url, name })} />
                    </div>
                  );
                })()
              ) : (
                (() => {
                  const noTrade = noTrades.find((n) => n.id === detail.id);
                  const linked = attachments.filter((a) => a.no_trade_day_id === detail.id);
                  if (!noTrade) return <div className="small muted">No-trade entry not found.</div>;
                  return (
                    <div className="stack">
                      <div className="small muted">{noTrade.day_date}</div>
                      <div className="small">Reason: {noTrade.reason}</div>
                      <AttachmentPreviewList entries={linked} signedUrls={signedUrls} onOpenImage={(url, name) => setLightbox({ url, name })} />
                    </div>
                  );
                })()
              )}
            </article>
          )}
        </section>
      )}

      {tab === 'add' && (
        <section className="stack">
          <form className="card stack" action={(fd) => startTransition(() => void addTrade(fd))}>
            <div className="row">
              <strong>{editingTradeId ? 'Edit trade' : 'Add trade'}</strong>
              {editingTradeId && <button className="inline" type="button" onClick={resetTradeDraft}>Cancel edit</button>}
            </div>
            <label className="small muted">Date</label>
            <input name="trade_date" type="date" required value={tradeDraft.trade_date} onChange={(e) => setTradeDraft((p) => ({ ...p, trade_date: e.target.value }))} />
            <label className="small muted">Ticker</label>
            <input name="ticker" placeholder="Ticker" required value={tradeDraft.ticker} onChange={(e) => setTradeDraft((p) => ({ ...p, ticker: e.target.value.toUpperCase() }))} />
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
            <input name="r_multiple" type="number" step="0.1" placeholder="R multiple" value={tradeDraft.r_multiple} onChange={(e) => setTradeDraft((p) => ({ ...p, r_multiple: e.target.value }))} />
            <input name="minutes_in_trade" type="number" placeholder="Minutes in trade" value={tradeDraft.minutes_in_trade} onChange={(e) => setTradeDraft((p) => ({ ...p, minutes_in_trade: e.target.value }))} />
            <label className="small muted">Emotional pressure (1-5)</label>
            <select name="emotional_pressure" value={tradeDraft.emotional_pressure} onChange={(e) => setTradeDraft((p) => ({ ...p, emotional_pressure: e.target.value }))}>
              {emotionalPressureScale.map((level) => (
                <option key={level.value} value={level.value}>{level.label}</option>
              ))}
            </select>
            <div className="small muted">Use this to log emotional pressure, urge to interfere, revenge impulses, or panic.</div>
            <input name="mistake_tags" placeholder="Mistake tags (comma-separated)" value={tradeDraft.mistake_tags} onChange={(e) => setTradeDraft((p) => ({ ...p, mistake_tags: e.target.value }))} />
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

          <form className="card stack" action={(fd) => startTransition(() => void addNoTrade(fd))}>
            <strong>No-trade day</strong>
            <input name="day_date" type="date" required value={noTradeDraft.day_date} onChange={(e) => setNoTradeDraft((p) => ({ ...p, day_date: e.target.value }))} />
            <select name="reason" value={noTradeDraft.reason} onChange={(e) => setNoTradeDraft((p) => ({ ...p, reason: e.target.value }))}>{noTradeReasons.map((r) => <option key={r}>{r}</option>)}</select>
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
            <button disabled={pending}>Save no-trade day</button>
          </form>
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
          <div className="trade small muted">Selected week: {selectedWeekKey}. Stats: {weekTrades.length} trade(s), {weekNoTrades.length} no-trade day(s), {weekTrades.filter((t) => t.classification === 'FOMO trade').length} FOMO trade(s).</div>
          <div className="trade stack">
            <strong>This week's entries</strong>
            {weekTrades.map((t) => (
              <article key={t.id} className="trade">
                <div className="small muted">{t.trade_date} · {t.ticker}</div>
                <div className="small">{t.family} · {t.model} · {t.classification}</div>
                <div className="small">${t.pnl} · {t.r_multiple}R · {t.minutes_in_trade}m · Emotion {t.emotional_pressure}/5</div>
                <div>{t.mistake_tags?.map((m) => <span key={m} className="badge">{m}</span>)}</div>
              </article>
            ))}
            {weekNoTrades.map((n) => (
              <article key={n.id} className="trade no-trade">
                <div className="small muted">{n.day_date}</div>
                <div className="small">Reason: {n.reason}</div>
                <div className="small muted">Attachments: {attachments.filter((a) => a.no_trade_day_id === n.id).length}</div>
              </article>
            ))}
            {!weekTrades.length && !weekNoTrades.length && <div className="small muted">No entries for selected week.</div>}
          </div>
          <textarea value={reviewAnswers.q1} onChange={(e) => setReviewAnswers((s) => ({ ...s, q1: e.target.value }))} placeholder="1) Reflection on mistakes" />
          <textarea value={reviewAnswers.q2} onChange={(e) => setReviewAnswers((s) => ({ ...s, q2: e.target.value }))} placeholder="2) Reflection on no-trade choices" />
          <textarea value={reviewAnswers.q3} onChange={(e) => setReviewAnswers((s) => ({ ...s, q3: e.target.value }))} placeholder="3) Rule for next week" />
          <button className="primary" onClick={() => startTransition(() => void saveReview())} disabled={pending}>Save review</button>
        </section>
      )}

      {tab === 'settings' && settings && (
        <section className="card stack">
          <label className="row"><span>Daily reminder</span><input type="checkbox" checked={settings.daily_reminder} onChange={(e) => saveSettings({ ...settings, daily_reminder: e.target.checked })} /></label>
          <label className="row"><span>Weekly reminder</span><input type="checkbox" checked={settings.weekly_reminder} onChange={(e) => saveSettings({ ...settings, weekly_reminder: e.target.checked })} /></label>
          <input value={settings.default_risk} onChange={(e) => setSettings({ ...settings, default_risk: Number(e.target.value || 0) })} type="number" placeholder="Default risk" />
          <input value={settings.display_name} onChange={(e) => setSettings({ ...settings, display_name: e.target.value })} placeholder="Display name" />
          <button onClick={() => settings && saveSettings(settings)}>Save settings</button>
          <div className="small muted">Passkeys: prepared next. Use Supabase auth; add WebAuthn/passkey provider in next milestone.</div>
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
  return Array.from({ length: 42 }, (_, idx) => {
    const dt = new Date(start);
    dt.setUTCDate(start.getUTCDate() + idx);
    const date = dt.toISOString().slice(0, 10);
    const dayTrades = trades.filter((t) => t.trade_date === date);
    const pnl = dayTrades.reduce((sum, t) => sum + Number(t.pnl || 0), 0);
    const noTrade = noTrades.some((n) => n.day_date === date);
    return {
      date,
      day: dt.getUTCDate(),
      pnl,
      tradeCount: dayTrades.length,
      noTrade,
      isOutside: dt.getUTCMonth() !== monthStart.getUTCMonth()
    };
  });
}

function formatRangeLabel(start: string, end: string) {
  return `${start} → ${end}`;
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
