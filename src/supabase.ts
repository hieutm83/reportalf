import type { Env, ReportKind, ReportRecord, ReportSnapshot, WorkItem, ReviewItem } from './types';

function supabaseConfig(env: Env): { base: string; key: string } {
  const base = String(env.SUPABASE_URL || '').replace(/\/$/, '');
  const key = String(env.SUPABASE_SERVICE_ROLE_KEY || '');
  if (!base || !key || key.startsWith('replace-')) throw new Error('Supabase chưa được cấu hình.');
  return { base, key };
}

async function request<T>(env: Env, path: string, init: RequestInit = {}): Promise<T> {
  const { base, key } = supabaseConfig(env);
  const headers = new Headers(init.headers);
  headers.set('apikey', key);
  headers.set('Authorization', `Bearer ${key}`);
  headers.set('Content-Type', 'application/json');
  const response = await fetch(`${base}/rest/v1/${path}`, { ...init, headers });
  const body = await response.text();
  if (!response.ok) throw new Error(`Supabase ${response.status}: ${body.slice(0, 300)}`);
  return body ? JSON.parse(body) as T : (undefined as T);
}

type SupabaseReportRow = {
  id: string;
  kind: string;
  anchor_date: string;
  period_start: string;
  period_end: string;
  title: string;
  snapshot: ReportSnapshot;
  review: ReviewItem[];
  evaluations: ReportRecord['evaluations'];
  work_items: WorkItem[];
  created_at: string;
  updated_at: string;
};

function toRecord(row: SupabaseReportRow): ReportRecord {
  return {
    ...row.snapshot,
    id: row.id,
    period: row.snapshot.period,
    review: row.review || [],
    evaluations: row.evaluations || [],
    workItems: row.work_items || [],
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export async function listReports(env: Env, kind?: string): Promise<ReportRecord[]> {
  const filter = kind === 'week' || kind === 'month' ? `&kind=eq.${kind}` : '';
  const rows = await request<SupabaseReportRow[]>(env,
    `reports?select=*&order=period_start.desc,updated_at.desc&limit=100${filter}`);
  return (rows || []).map(toRecord);
}

export async function getReport(env: Env, id: string): Promise<ReportRecord | null> {
  const rows = await request<SupabaseReportRow[]>(env, `reports?select=*&id=eq.${encodeURIComponent(id)}&limit=1`);
  return rows?.[0] ? toRecord(rows[0]) : null;
}

export async function getReportForPeriod(env: Env, kind: ReportKind, periodStart: string): Promise<ReportRecord | null> {
  const rows = await request<SupabaseReportRow[]>(env,
    `reports?select=*&kind=eq.${kind}&period_start=eq.${encodeURIComponent(periodStart)}&limit=1`);
  return rows?.[0] ? toRecord(rows[0]) : null;
}

export async function saveReport(env: Env, snapshot: ReportSnapshot, input: {
  review?: ReviewItem[];
  evaluations?: ReportRecord['evaluations'];
  workItems?: WorkItem[];
}): Promise<ReportRecord> {
  const payload = {
    kind: snapshot.period.kind,
    anchor_date: snapshot.period.anchorDate,
    period_start: snapshot.period.startDate,
    period_end: snapshot.period.endDate,
    title: snapshot.period.title,
    snapshot,
    review: input.review || [],
    evaluations: input.evaluations || [],
    work_items: input.workItems || [],
    updated_at: new Date().toISOString()
  };
  const rows = await request<SupabaseReportRow[]>(env,
    'reports?on_conflict=kind,period_start', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify(payload)
    });
  const row = rows?.[0];
  if (!row) throw new Error('Supabase không trả về báo cáo đã lưu.');
  return toRecord(row);
}
