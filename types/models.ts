export type TradeClassification =
  | 'Valid setup'
  | 'Valid setup, poor execution'
  | 'FOMO trade'
  | 'Forced trade'
  | 'Experimental trade'
  | 'No valid setup';

export type TradeRow = {
  id: string;
  user_id: string;
  trade_date: string;
  ticker: string;
  family: string;
  model: string;
  classification: TradeClassification;
  pnl: number;
  r_multiple: number;
  minutes_in_trade: number;
  emotional_pressure: number | null;
  trading_emotions?: string[] | null;
  entry_emotion?: string | null;
  in_trade_emotion?: string | null;
  is_paper_trade?: boolean | null;
  mistake_tags: string[];
  notes: string | null;
};

export type NoTradeDayRow = {
  id: string;
  user_id: string;
  day_date: string;
  reason: string;
  trading_emotions?: string[] | null;
  no_trade_mindset?: string | null;
  notes: string | null;
};

export type WeeklyReviewRow = {
  id: string;
  user_id: string;
  week_key: string;
  q1: string;
  q2: string;
  q3: string;
  q_paper?: string;
};

export type SessionRow = {
  id: string;
  user_id: string;
  session_type: 'chart' | 'journal' | 'pre_session_plan' | 'chart_session' | 'post_session_review';
  session_date: string;
  start_time: string;
  end_time: string;
  duration_minutes: number;
  notes: string | null;
  created_at?: string;
  updated_at?: string;
};

export type SettingsRow = {
  user_id: string;
  daily_reminder: boolean;
  weekly_reminder: boolean;
  default_risk: number;
  chart_session_start_default: string;
  chart_session_end_default: string;
  journal_session_start_default: string;
  journal_session_end_default: string;
  display_name: string;
  instruments: string[];
  mistake_catalog: string[];
  mistake_catalog_hidden: string[];
};

export type AttachmentRow = {
  id: string;
  user_id: string;
  trade_id: string | null;
  no_trade_day_id: string | null;
  session_id: string | null;
  file_path: string;
  file_name: string;
  mime_type: string;
  byte_size: number;
};
