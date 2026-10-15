export type Flag = { level: "ok" | "warn" | "bad"; text: string };

export type JobCard = {
  id: number;
  company: string;
  company_domain: string;
  title: string;
  department: string;
  location: string;
  workplace: "onsite" | "hybrid" | "remote";
  region: string;
  open_to_india: boolean;
  job_type: string;
  job_type_label: string;
  seniority: string;
  url: string;
  apply_url: string;
  source: string;
  source_label: string;
  source_url: string;
  posted_at: string | null;
  deadline: string | null;
  salary: string;
  tags: string[];
  trust_score: number;
  trust_flags: Flag[];
  active: boolean;
  summary: string;
  description?: string;
  user_job_id: number;
  status: string;
  match_score: number;
  match_reasons: string[];
  notes: string;
  my_deadline: string | null;
  updated_at: string;
  campaign?: Campaign | null;
};

export type Campaign = {
  id: number;
  status: "active" | "paused" | "stopped" | "replied" | "completed";
  to: string;
  steps_sent: number;
  max_followups: number;
  gaps: number[];
  next_due: string | null;
  paused_until: string | null;
  stop_reason: string;
};

export type Check = { ok: boolean; text: string; blocking: boolean };
export type Quality = { score: number; checks: Check[]; ready: boolean };

export type OutboxEmail = {
  id: number;
  campaign_id: number;
  step: number;
  to: string;
  subject: string;
  body: string;
  attachment: string;
  status: "pending" | "scheduled" | "sent" | "skipped" | "failed";
  queue_date: string;
  recommended_send_at: string | null;
  recipient_tz: string;
  scheduled_for: string | null;
  sent_at: string | null;
  error: string;
  quality: Quality;
  generated_by: string;
  company: string;
  job_title: string;
  job_id: number;
  user_job_id: number;
  max_followups: number;
};

export type Reply = {
  id: number;
  campaign_id: number;
  campaign_status: string;
  from_email: string;
  from_name: string;
  subject: string;
  snippet: string;
  body: string;
  received_at: string;
  label: string;
  confidence: number;
  label_source: string;
  label_reason: string;
  return_date: string | null;
  handled: boolean;
  reply_mode: string;
  suggested_reply: string;
  company: string;
  job_title: string;
  job_id: number;
  user_job_id: number;
  thread_url: string;
};

export type ConvMessage =
  | (Reply & { kind: "received"; key: string; at: string; new_thread: boolean })
  | { kind: "sent"; key: string; at: string; from_email: string; subject: string; body: string; step: number; attachment: string; via?: "kold" | "gmail" };

export type Conversation = {
  campaign_id: number;
  user_job_id: number;
  company: string;
  job_title: string;
  to: string;
  status: Campaign["status"];
  stop_reason: string;
  steps_sent: number;
  max_followups: number;
  next_due: string | null;
  paused_until: string | null;
  needs_you: number;
  replies: number;
  you_sent: number;
  latest_label: string;
  last_at: string;
  messages: ConvMessage[];
};

export type HomeData = {
  name: string;
  gmail_connected: boolean;
  replies: { id: number; campaign_id: number; company: string; job_title: string; from: string; snippet: string; label: string; at: string }[];
  replies_waiting: number;
  approvals: { id: number; company: string; to: string; step: number; status: string }[];
  approvals_waiting: number;
  scheduled: number;
  sent_today: number;
  daily_limit: number;
  deadlines: { id: number; title: string; due_at: string; user_job_id: number | null }[];
  matches_waiting: number;
  top_matches: { user_job_id: number; company: string; title: string; score: number }[];
  pipeline: Record<string, number>;
  last_scan: { at: string; new: number } | null;
  activity: { id: number; at: string; kind: string; message: string; url: string }[];
};

export type Contact = {
  id: number;
  email: string;
  role: string;
  source_url: string;
  confidence: string;
  mx_ok: boolean;
  found_at: string;
};

export type Experience = { title: string; company: string; location?: string; start?: string; end?: string; bullets: string[] };
export type Education = { degree: string; institution: string; start?: string; end?: string; score?: string };
export type Project = { name: string; description: string; tech?: string[]; link?: string };

export type Profile = {
  name: string;
  headline: string;
  email: string;
  phone: string;
  location: string;
  links: string[];
  summary: string;
  skills: string[];
  experience: Experience[];
  education: Education[];
  projects: Project[];
  certifications: string[];
  achievements: string[];
  experience_level: string;
  suggested_roles: string[];
};

export type Preferences = {
  job_types: string[];
  roles: string[];
  cities: string[];
  onsite_india: boolean;
  remote_india: boolean;
  remote_global: boolean;
  include_unclear_remote: boolean;
  experience_level: string;
  exclude_companies: string[];
  exclude_keywords: string[];
};

export type Me = {
  user: { id: number; name: string; email: string; timezone: string; onboarded: boolean } | null;
  profile?: Profile | null;
  preferences?: Preferences;
  resume?: { filename: string; uploaded_at: string } | null;
  gmail?: { configured: boolean; connected: boolean; email: string; scopes: { name: string; why: string }[]; google?: boolean; demo?: boolean; session_ok?: boolean };
  lite?: boolean;
  feed?: { generated_at: string; jobs: number; sources_ok: number; sources_total: number; companies: number } | null;
  engine?: { local_model: string; local_model_online: boolean; reply_model_trained: boolean };
  limits?: { max_emails_per_day: number; max_followups: number };
  sandbox?: boolean;
};

export type Activity = { id: number; at: string; kind: string; message: string; url: string; seen: boolean };

export type Stats = {
  to_review: number;
  saved: number;
  awaiting_approval: number;
  sent: number;
  replies: number;
  positive: number;
  needs_attention: number;
  interviews: number;
  unseen_activity: number;
};
