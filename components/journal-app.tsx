'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase-browser';
import type { AttachmentRow, NoTradeDayRow, SettingsRow, TradeRow, WeeklyReviewRow, TradeClassification } from '@/types/models';

const tabs = ['dashboard', 'trades', 'add', 'review', 'settings'] as const;
type Tab = (typeof tabs)[number];
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
  mistake_tags: string;
  notes: string;
};
type TradeExtractSuggestions = Partial<Pick<TradeDraft, 'trade_date' | 'ticker' | 'pnl' | 'r_multiple' | 'minutes_in_trade'>> & { hints?: string[] };
type NoTradeExtractSuggestions = Partial<Pick<NoTradeDayRow, 'day_date' | 'reason'>> & { hints?: string[] };

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
  const [tradeDraft, setTradeDraft] = useState<TradeDraft>(() => ({
    trade_date: new Date().toISOString().slice(0, 10),
    ticker: '',
    classification: 'Valid setup',
    family: 'Bounce',
    model: familyModels.Bounce[0],
    pnl: '',
    r_multiple: '',
    minutes_in_trade: '',
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

  function runTradeExtraction(files: File[]) {
    const next = extractTradeSuggestions(files);
    setTradeExtract(next);
  }

  function runNoTradeExtraction(files: File[]) {
    const next = extractNoTradeSuggestions(files);
    setNoTradeExtract(next);
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
          <div className="grid">
            <article className="card"><div className="muted small">Total trades</div><div>{trades.length}</div></article>
            <article className="card"><div className="muted small">Net P&L</div><div>{netPnl.toFixed(2)}</div></article>
            <article className="card"><div className="muted small">Win rate</div><div>{trades.length ? Math.round((wins / trades.length) * 100) : 0}%</div></article>
            <article className="card"><div className="muted small">No-trade days</div><div>{noTrades.length}</div></article>
          </div>
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
            <input name="mistake_tags" placeholder="Mistake tags (comma-separated)" value={tradeDraft.mistake_tags} onChange={(e) => setTradeDraft((p) => ({ ...p, mistake_tags: e.target.value }))} />
            <textarea name="notes" placeholder="Notes" value={tradeDraft.notes} onChange={(e) => setTradeDraft((p) => ({ ...p, notes: e.target.value }))} />
            <input
              name="files"
              type="file"
              accept="image/*,.pdf,.txt,.csv"
              multiple
              onChange={(e) => runTradeExtraction(Array.from(e.currentTarget.files || []))}
            />
            <div className="row">
              <span className="small muted">Upload-assisted autofill</span>
              <button className="inline" type="button" onClick={(e) => {
                const input = (e.currentTarget.closest('form')?.querySelector('input[name=\"files\"]') as HTMLInputElement | null);
                runTradeExtraction(Array.from(input?.files || []));
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
                  <div className="small muted">No useful trade fields detected from uploaded file names/metadata yet.</div>
                )}
                {tradeExtract.hints?.length ? <div className="small muted">Hints: {tradeExtract.hints.join(', ')}</div> : null}
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
              onChange={(e) => runNoTradeExtraction(Array.from(e.currentTarget.files || []))}
            />
            <div className="row">
              <span className="small muted">Upload-assisted autofill</span>
              <button className="inline" type="button" onClick={(e) => {
                const input = (e.currentTarget.closest('form')?.querySelector('input[name=\"no_trade_files\"]') as HTMLInputElement | null);
                runNoTradeExtraction(Array.from(input?.files || []));
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
                  <div className="small muted">No no-trade date/reason hints detected from uploaded file names/metadata yet.</div>
                )}
                {noTradeExtract.hints?.length ? <div className="small muted">Hints: {noTradeExtract.hints.join(', ')}</div> : null}
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
                <div className="small">${t.pnl} · {t.r_multiple}R · {t.minutes_in_trade}m</div>
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

function extractTradeSuggestions(files: File[]): TradeExtractSuggestions {
  const out: TradeExtractSuggestions = {};
  const hints: string[] = [];
  const text = files.map((f) => `${f.name} ${f.type}`).join(' ');

  const dateMatch = text.match(/\b(20\d{2}[-_./](0[1-9]|1[0-2])[-_./](0[1-9]|[12]\d|3[01]))\b/);
  if (dateMatch) out.trade_date = dateMatch[1].replace(/[_.]/g, '-').replace(/\//g, '-');

  const tickerMatch = text.match(/\b([A-Z]{2,5})\b/);
  if (tickerMatch) out.ticker = tickerMatch[1];

  const pnlMatch = text.match(/([+-]?\d+(?:\.\d+)?)\s*(usd|\$|dollars?)/i);
  if (pnlMatch) out.pnl = pnlMatch[1];

  const rMatch = text.match(/([+-]?\d+(?:\.\d+)?)\s*R\b/i);
  if (rMatch) out.r_multiple = rMatch[1];

  const minMatch = text.match(/(\d{1,4})\s*(m|min|mins|minutes)\b/i);
  if (minMatch) out.minutes_in_trade = minMatch[1];

  if (/fomo/i.test(text)) hints.push('FOMO mention found');
  if (/forced/i.test(text)) hints.push('Forced-trade mention found');
  if (/news/i.test(text)) hints.push('News mention found');
  if (hints.length) out.hints = hints;
  return out;
}

function extractNoTradeSuggestions(files: File[]): NoTradeExtractSuggestions {
  const out: NoTradeExtractSuggestions = {};
  const hints: string[] = [];
  const text = files.map((f) => `${f.name} ${f.type}`).join(' ');

  const dateMatch = text.match(/\b(20\d{2}[-_./](0[1-9]|1[0-2])[-_./](0[1-9]|[12]\d|3[01]))\b/);
  if (dateMatch) out.day_date = dateMatch[1].replace(/[_.]/g, '-').replace(/\//g, '-');

  const reasonMap: Array<{ test: RegExp; reason: string }> = [
    { test: /news/i, reason: 'News risk' },
    { test: /chop|choppy|range/i, reason: 'Choppy session' },
    { test: /no[-_ ]?setup|noa\+|no a\+/i, reason: 'No A+ setup' },
    { test: /fatigue|tired/i, reason: 'Not mentally ready' }
  ];
  for (const r of reasonMap) {
    if (r.test.test(text)) {
      out.reason = r.reason;
      hints.push(`Detected "${r.reason}" hint`);
      break;
    }
  }
  if (hints.length) out.hints = hints;
  return out;
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
