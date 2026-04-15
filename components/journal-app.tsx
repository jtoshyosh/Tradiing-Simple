'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase-browser';
import type { AttachmentRow, NoTradeDayRow, SettingsRow, TradeRow, WeeklyReviewRow, TradeClassification } from '@/types/models';

const tabs = ['dashboard', 'trades', 'add', 'review', 'settings'] as const;
type Tab = (typeof tabs)[number];

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

type Props = { userId: string; email?: string };

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
    const family = String(formData.get('family') || 'Bounce');
    const classification = String(formData.get('classification') || 'Valid setup') as TradeClassification;
    const isInvalid = ['FOMO trade', 'Forced trade', 'No valid setup'].includes(classification);
    const payload = {
      user_id: userId,
      trade_date: String(formData.get('trade_date') || new Date().toISOString().slice(0, 10)),
      ticker: String(formData.get('ticker') || '').toUpperCase(),
      family: isInvalid ? 'N/A / No valid setup' : family,
      model: isInvalid ? 'N/A / None' : String(formData.get('model') || familyModels[family][0]),
      classification,
      pnl: Number(formData.get('pnl') || 0),
      r_multiple: Number(formData.get('r_multiple') || 0),
      minutes_in_trade: Number(formData.get('minutes_in_trade') || 0),
      mistake_tags: String(formData.get('mistake_tags') || '').split(',').map((x) => x.trim()).filter(Boolean),
      notes: String(formData.get('notes') || '')
    };
    const { data, error: insertError } = await supabase.from('trades').insert(payload).select('*').single();
    if (insertError) {
      setError(insertError.message);
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
    setTab('trades');
  }

  async function addNoTrade(formData: FormData) {
    const { data, error: insertError } = await supabase
      .from('no_trade_days')
      .insert({
        user_id: userId,
        day_date: String(formData.get('day_date') || new Date().toISOString().slice(0, 10)),
        reason: String(formData.get('reason') || 'No A+ setup')
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

  const reviewStatus = `${selectedWeekKey === currentWeekKey() ? 'Current week' : 'Past week'} • ${reviewRow ? 'Saved review' : 'Unsaved draft for selected week'}`;

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
              <div className="small muted">Attachments: {attachments.filter((a) => a.trade_id === t.id).length}</div>
            </article>
          ))}
          {noTrades.map((n) => (
            <article key={n.id} className="trade no-trade">
              <div className="row"><strong>No-trade day</strong><span>{n.day_date}</span></div>
              <div className="small">Reason: {n.reason}</div>
              <div className="small muted">Attachments: {attachments.filter((a) => a.no_trade_day_id === n.id).length}</div>
            </article>
          ))}
        </section>
      )}

      {tab === 'add' && (
        <section className="stack">
          <form className="card stack" action={(fd) => startTransition(() => void addTrade(fd))}>
            <strong>Add trade</strong>
            <input name="trade_date" type="date" required />
            <input name="ticker" placeholder="Ticker" required />
            <select name="classification" defaultValue="Valid setup">{classifications.map((c) => <option key={c}>{c}</option>)}</select>
            <select name="family" defaultValue="Bounce">{Object.keys(familyModels).map((f) => <option key={f}>{f}</option>)}</select>
            <input name="model" placeholder="Setup model" />
            <input name="pnl" type="number" step="0.01" placeholder="Result ($)" />
            <input name="r_multiple" type="number" step="0.1" placeholder="R multiple" />
            <input name="minutes_in_trade" type="number" placeholder="Minutes in trade" />
            <input name="mistake_tags" placeholder="Mistake tags (comma-separated)" />
            <textarea name="notes" placeholder="Notes" />
            <input name="files" type="file" accept="image/*" multiple />
            <div className="small muted">Uploads are stored attachments only. AI extraction is not implemented.</div>
            <button className="primary" disabled={pending}>Save trade</button>
          </form>

          <form className="card stack" action={(fd) => startTransition(() => void addNoTrade(fd))}>
            <strong>No-trade day</strong>
            <input name="day_date" type="date" required />
            <select name="reason" defaultValue={noTradeReasons[0]}>{noTradeReasons.map((r) => <option key={r}>{r}</option>)}</select>
            <input name="no_trade_files" type="file" accept="image/*" multiple />
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

function titleCase(v: string) {
  return v[0].toUpperCase() + v.slice(1);
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
