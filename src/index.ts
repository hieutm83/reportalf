import type { Env, ReportKind, ReportSnapshot } from './types';
import { errorMessage, json, readJson } from './json';
import { latestMonthAnchor, latestWeekAnchor, parseDate, reportPeriod } from './periods';
import { getReport, getReportForPeriod, listReports, saveReport } from './supabase';
import { loadSourceReport } from './source-dashboard';

function isKind(value: unknown): value is ReportKind {
  return value === 'week' || value === 'month';
}

async function api(request: Request, env: Env, url: URL): Promise<Response> {
  if (request.method === 'GET' && url.pathname === '/api/health') {
    return json({ ok: true, service: 'report-alf', supabaseConfigured: Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY),
      supabaseUrlConfigured: Boolean(env.SUPABASE_URL), supabaseKeyConfigured: Boolean(env.SUPABASE_SERVICE_ROLE_KEY) });
  }
  if (request.method === 'GET' && url.pathname === '/api/default-periods') {
    const weekAnchor = latestWeekAnchor(env.TIMEZONE);
    const monthAnchor = latestMonthAnchor(env.TIMEZONE);
    return json({ ok: true, data: { week: reportPeriod('week', weekAnchor), month: reportPeriod('month', monthAnchor) } });
  }
  if (request.method === 'GET' && url.pathname === '/api/reports') {
    const kind = url.searchParams.get('kind');
    if (kind && !isKind(kind)) return json({ ok: false, error: 'Loại báo cáo không hợp lệ.' }, 400);
    return json({ ok: true, data: await listReports(env, kind || undefined) });
  }
  if (request.method === 'GET' && url.pathname.startsWith('/api/reports/')) {
    const id = decodeURIComponent(url.pathname.slice('/api/reports/'.length));
    const record = await getReport(env, id);
    return record ? json({ ok: true, data: record }) : json({ ok: false, error: 'Không tìm thấy báo cáo.' }, 404);
  }
  if (request.method === 'POST' && url.pathname === '/api/source-report') {
    const input = await readJson<{ kind?: string; anchorDate?: string; forceRefresh?: boolean }>(request);
    if (!isKind(input.kind)) return json({ ok: false, error: 'Loại báo cáo không hợp lệ.' }, 400);
    const period = reportPeriod(input.kind, parseDate(input.anchorDate));
    const cached = await getReportForPeriod(env, period.kind, period.startDate);
    if (cached && cached.dataAvailable && input.forceRefresh !== true) return json({ ok: true, data: cached });
    const snapshot = await loadSourceReport(env, period);
    const saved = await saveReport(env, snapshot, {
      review: cached?.review || [], evaluations: cached?.evaluations || [], workItems: cached?.workItems || []
    });
    return json({ ok: true, data: saved });
  }
  if (request.method === 'POST' && url.pathname === '/api/reports') {
    const input = await readJson<{ snapshot?: ReportSnapshot; review?: any[]; evaluations?: any[]; workItems?: any[] }>(request);
    if (!input.snapshot?.period || !isKind(input.snapshot.period.kind)) return json({ ok: false, error: 'Thiếu snapshot báo cáo.' }, 400);
    const record = await saveReport(env, input.snapshot, {
      review: Array.isArray(input.review) ? input.review : [],
      evaluations: Array.isArray(input.evaluations) ? input.evaluations : [],
      workItems: Array.isArray(input.workItems) ? input.workItems : []
    });
    return json({ ok: true, data: record });
  }
  return json({ ok: false, error: 'API route not found.' }, 404);
}

async function assets(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const response = await env.ASSETS.fetch(new Request(url.toString(), request));
  const headers = new Headers(response.headers);
  if (url.pathname === '/' || url.pathname.endsWith('.html')) {
    headers.set('Content-Type', 'text/html; charset=UTF-8');
    headers.set('Cache-Control', 'no-store');
  }
  if (url.pathname.endsWith('.js')) headers.set('Content-Type', 'application/javascript; charset=UTF-8');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      const url = new URL(request.url);
      if (url.pathname.startsWith('/api/')) return await api(request, env, url);
      return await assets(request, env);
    } catch (error) {
      console.error(errorMessage(error));
      return json({ ok: false, error: errorMessage(error) }, 500);
    }
  }
};
