export interface Addr {
  name?: string;
  email: string;
}

export interface FolderRef {
  id: number;
  name: string;
  path: string;
}

export interface TagRef {
  id: number;
  name: string;
  color: string;
}

export interface MessageItem {
  id: number;
  thread_id: number | null;
  thread_count: number;
  subject: string;
  from_name: string;
  from_email: string;
  to: Addr[];
  date: string | null;
  snippet: string;
  highlight: { subject?: string | null; from_name?: string | null; body?: string | null };
  has_attachments: boolean;
  attachments: { id: number; filename: string; file_kind: string }[];
  doc_kinds: string[];
  folders: FolderRef[];
  is_read: boolean;
  is_important: boolean;
  is_from_me: boolean;
  is_automated: boolean;
  snoozed_until: string | null;
  tags: TagRef[];
  has_note: boolean;
  answered: boolean;
  size?: number | null;
}

export interface Attachment {
  id: number;
  filename: string;
  content_type: string;
  size: number | null;
  file_kind: string;
  is_inline: boolean;
  extraction_status: string;
}

export interface NoteT {
  id: number;
  body: string;
  created_at: string;
  updated_at: string;
}

export interface MessageDetail extends Omit<MessageItem, "attachments"> {
  cc: Addr[];
  reply_to: Addr[];
  body_text: string;
  has_html: boolean;
  body_truncated: boolean;
  size: number | null;
  message_id_header: string | null;
  attachments: Attachment[];
  notes: NoteT[];
  injection_suspected: boolean;
  server_flags: string[];
  deleted_on_server: boolean;
}

export interface ThreadT {
  id: number;
  subject: string;
  participants: string[];
  message_count: number;
  first_date: string | null;
  last_date: string | null;
  messages: MessageDetail[];
}

export interface SearchResult {
  engine: "meilisearch" | "postgres";
  degraded: boolean;
  notice?: string;
  total: number;
  page: number;
  per_page: number;
  processing_ms?: number;
  items: MessageItem[];
  facets?: Facets;
}

export interface Facets {
  years: Record<string, number>;
  file_kinds: Record<string, number>;
  doc_kinds: Record<string, number>;
}

export interface Folder {
  id: number;
  name: string;
  display_name: string;
  parent: string | null;
  role: string | null;
  origin: string;
  sync_enabled: boolean;
  status: string;
  last_error: string | null;
  count: number;
  unread: number;
  server_count: number | null;
  last_synced_at: string | null;
}

export interface Tag {
  id: number;
  name: string;
  color: string;
  count: number;
}

export interface SavedSearch {
  id: number;
  name: string;
  query: string;
  filters: Record<string, string | number | boolean>;
  position: number;
}

export interface FollowupItem {
  thread_id: number;
  subject: string;
  participants: string[];
  message_count: number;
  last_date: string | null;
  days_waiting: number | null;
  known_contact?: boolean;
  team?: boolean;
  last_message: MessageItem;
}

export interface Draft {
  id: number;
  thread_id: number | null;
  reply_to_message_id: number | null;
  to: string[];
  subject: string;
  body: string;
  source: "user" | "ai";
  reviewed: boolean;
  ai_run_id: number | null;
  created_at: string;
  updated_at: string;
  can_send: false;
}

export interface AiRef {
  label: string;
  message_id: number;
  thread_id: number | null;
  subject: string;
  from: string;
  date: string | null;
  snippet?: string;
}

export interface AiResult {
  summary?: string;
  suggestion?: string;
  key_points?: { text: string; sources: string[] }[];
  actions?: { task: string; owner?: string | null; due?: string | null; sources: string[] }[];
  subject?: string;
  body?: string;
  sources?: string[];
  warnings: string[];
  references: AiRef[];
  cited: string[];
  draft_id?: number;
  to?: string[];
  meta?: {
    provider?: string;
    model?: string;
    chars_sent?: number;
    messages_sent?: number;
    prompt_tokens?: number;
    completion_tokens?: number;
    cost_usd?: number;
    latency_ms?: number;
    cached?: boolean;
    pii_redacted?: boolean;
    tier?: "light" | "heavy";
    escalated?: boolean;
    heavy_available?: boolean;
  };
}

export interface AiStatus {
  configured: boolean;
  enabled: boolean;
  provider: string;
  model: string;
  model_heavy?: string | null;
  heavy_kinds?: string[];
  endpoint_host: string | null;
  usage_today: { calls: number; cost_usd: number };
  limits: { daily_budget_usd: number; max_calls_per_day: number; max_messages: number; max_total_chars: number };
  privacy: { pii_redaction: boolean; attachments_sent: boolean; quoted_history_trimmed: boolean; background_calls: boolean };
}

export interface SyncRun {
  id: number;
  folder: string | null;
  started_at: string;
  finished_at: string | null;
  status: string;
  fetched: number;
  created: number;
  duplicates: number;
  removed: number;
  error: string | null;
}

export interface SyncStatus {
  source: string;
  sync_enabled: boolean;
  sync_since: string;
  interval_seconds: number;
  worker: { age_seconds: number | null; healthy: boolean; at?: string; last_error?: string; state?: string; search?: string };
  meilisearch: boolean;
  messages_total: number;
  index_pending: number;
  runs: SyncRun[];
}

export interface Meta {
  version: string;
  doc_kinds: Record<string, string>;
  file_kinds: Record<string, string>;
  account: string;
  source: string;
  send_enabled: boolean;
}

export interface VolumePoint {
  bucket: string;
  received: number;
  sent: number;
}

export interface Volume {
  unit: "day" | "month";
  series: VolumePoint[];
}

export interface RankRow {
  email?: string;
  domain?: string;
  name: string;
  count: number;
  filter: Record<string, string>;
}

export interface Insights {
  period: string;
  label: string;
  from: string | null;
  to: string | null;
  counts: {
    received: number;
    sent: number;
    unread: number;
    with_attachments: number;
    doc_kinds: Record<string, number>;
    file_kinds: Record<string, number>;
    awaiting: number;
    needs_reply: number;
  };
  top_senders: RankRow[];
  top_domains: RankRow[];
  top_recipients: RankRow[];
  volume: Volume;
  periods: Record<string, string>;
}

export interface StatRow {
  label: string;
  sublabel: string;
  count: number;
  filter: Record<string, string>;
}

export interface AskResult {
  question: string;
  engine: "rules" | "ai";
  mode: "search" | "stats" | "followups";
  understood: string[];
  params: Record<string, string | number | boolean | null>;
  period_label: string;
  stat?: string;
  stats?: {
    title: string;
    note: string;
    rows?: StatRow[];
    volume?: Volume;
    total?: number;
    received?: number;
    sent?: number;
  };
  search?: SearchResult;
  followup_kind?: "needs_reply" | "awaiting";
  followups?: FollowupItem[];
}

export interface Task {
  id: number;
  text: string;
  due: string | null;
  done: boolean;
  source: "user" | "ai";
  message_id: number | null;
  thread_id: number | null;
  created_at: string;
  done_at: string | null;
}
