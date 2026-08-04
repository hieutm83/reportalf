import type { Env, ReportKind, ReportRecord, ReportSnapshot, WorkItem } from './types';
import { errorMessage, json, readJson } from './json';
import { latestMonthAnchor, latestWeekAnchor, parseDate, reportPeriod, shiftDate } from './periods';
import { getReport, getReportForPeriod, listReports, saveReport } from './supabase';
import { loadSourceOperations, loadSourceReport } from './source-dashboard';
import { handleAuth, hasSettingsAccess, hasSiteAccess, loginPage } from './auth';

function isKind(value: unknown): value is ReportKind {
  return value === 'week' || value === 'month';
}

function hasEncodingCorruption(value: unknown): boolean {
  if (typeof value === 'string') return /[�]|(?:Ã.|Â.|Ð.|Ñ.|Æ.|Ä.|á»)/u.test(value);
  if (Array.isArray(value)) return value.some(hasEncodingCorruption);
  if (value && typeof value === 'object') return Object.values(value as Record<string, unknown>).some(hasEncodingCorruption);
  return false;
}

function needsSourceComparisonRepair(snapshot: ReportSnapshot | null): boolean {
  const rows = snapshot?.sources || [];
  if (!rows.length) return false;
  return rows.some((row) => !row.change) || rows.every((row) => row.change?.gmv === null || row.change?.gmv === undefined);
}

function preserveManualOperationMetrics(snapshot: ReportSnapshot, cached: ReportRecord | null): ReportSnapshot {
  if (!cached) return snapshot;
  for (const key of ['fastShippingRate', 'quickResponseRate'] as const) {
    const value = cached.operations[key]?.value;
    if (value === null || value === undefined) continue;
    const previous = snapshot.operations[key]?.previous;
    snapshot.operations[key] = {
      ...snapshot.operations[key],
      value,
      change: previous !== null && previous !== undefined && previous !== 0 ? (value - previous) / Math.abs(previous) : null
    };
  }
  return snapshot;
}

function snapshotOnly(record: ReportRecord): ReportSnapshot {
  const { id: _id, review: _review, evaluations: _evaluations, workItems: _workItems, previousWorkItems: _previousWorkItems, createdAt: _createdAt, updatedAt: _updatedAt, ...snapshot } = record;
  return snapshot;
}

async function withPreviousWorkItems(env: Env, record: ReportRecord): Promise<ReportRecord> {
  if (record.period.kind !== 'week') return { ...record, previousWorkItems: [] };
  const previousStart = shiftDate(record.period.startDate, -7);
  const previous = await getReportForPeriod(env, 'week', previousStart);
  const operations = { ...record.operations };
  if (previous) {
    for (const key of ['fastShippingRate', 'quickResponseRate'] as const) {
      const value = record.operations[key]?.value;
      const previousValue = previous.operations[key]?.value;
      operations[key] = {
        ...record.operations[key], previous: previousValue,
        change: value !== null && value !== undefined && previousValue !== null && previousValue !== undefined && previousValue !== 0
          ? (value - previousValue) / Math.abs(previousValue) : null
      };
    }
  }
  return { ...record, operations, previousWorkItems: previous?.workItems || [] };
}

async function manualContext(env: Env, kind: ReportKind, periodStart: string): Promise<Record<string, unknown>> {
  const current = await getReportForPeriod(env, kind, periodStart);
  const previous = kind === 'week' ? await getReportForPeriod(env, 'week', shiftDate(periodStart, -7)) : null;
  return {
    weekStartDate: periodStart,
    shippingSpeedRate: current?.operations.fastShippingRate.value ?? null,
    responseRate: current?.operations.quickResponseRate.value ?? null,
    previousShippingSpeedRate: previous?.operations.fastShippingRate.value ?? null,
    previousResponseRate: previous?.operations.quickResponseRate.value ?? null,
    evaluations: current?.evaluations || [],
    workItems: current?.workItems || [],
    previousWorkItems: previous?.workItems || []
  };
}

async function updatePreviousWorkItem(env: Env, currentWeekStartDate: string, taskId: string, updates: Partial<WorkItem>): Promise<WorkItem> {
  const previousStart = shiftDate(parseDate(currentWeekStartDate), -7);
  const previous = await getReportForPeriod(env, 'week', previousStart);
  if (!previous) throw new Error('Không tìm thấy báo cáo tuần trước.');
  const index = previous.workItems.findIndex((item) => item.id === taskId);
  if (index < 0) throw new Error('Không tìm thấy công việc tuần trước.');
  const item = { ...previous.workItems[index], ...updates };
  const workItems = previous.workItems.map((row, rowIndex) => rowIndex === index ? item : row);
  const { id: _id, review, evaluations, workItems: _workItems, previousWorkItems: _previousWorkItems, createdAt: _createdAt, updatedAt: _updatedAt, ...snapshot } = previous;
  await saveReport(env, snapshot, { review, evaluations, workItems });
  return item;
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
    return json({ ok: true, data: (await listReports(env, kind || undefined)).filter((record) => record.finalized !== false) });
  }
  if (request.method === 'GET' && url.pathname.startsWith('/api/reports/')) {
    const id = decodeURIComponent(url.pathname.slice('/api/reports/'.length));
    const record = await getReport(env, id);
    return record ? json({ ok: true, data: await withPreviousWorkItems(env, record) }) : json({ ok: false, error: 'Không tìm thấy báo cáo.' }, 404);
  }
  if (request.method === 'GET' && url.pathname === '/api/manual-context') {
    const kind = url.searchParams.get('kind');
    if (!isKind(kind)) return json({ ok: false, error: 'Loại báo cáo không hợp lệ.' }, 400);
    const periodStart = parseDate(url.searchParams.get('periodStart'));
    return json({ ok: true, data: await manualContext(env, kind, periodStart) });
  }
  if (request.method === 'PATCH' && url.pathname === '/api/previous-work-item') {
    const input = await readJson<{ currentWeekStartDate?: string; taskId?: string; status?: string; result?: string }>(request);
    const currentWeekStartDate = parseDate(input.currentWeekStartDate);
    const taskId = String(input.taskId || '');
    if (!taskId) return json({ ok: false, error: 'Thiếu mã công việc.' }, 400);
    const allowed = ['', 'Đạt', 'Chưa đạt', 'Trễ hạn'];
    if (input.status !== undefined && !allowed.includes(String(input.status))) return json({ ok: false, error: 'Trạng thái không hợp lệ.' }, 400);
    const updates: Partial<WorkItem> = {};
    if (input.status !== undefined) updates.status = String(input.status) as WorkItem['status'];
    if (input.result !== undefined) updates.result = String(input.result);
    return json({ ok: true, data: await updatePreviousWorkItem(env, currentWeekStartDate, taskId, updates) });
  }
  if (request.method === 'POST' && url.pathname === '/api/source-report') {
    const input = await readJson<{ kind?: string; anchorDate?: string; forceRefresh?: boolean }>(request);
    if (!isKind(input.kind)) return json({ ok: false, error: 'Loại báo cáo không hợp lệ.' }, 400);
    const period = reportPeriod(input.kind, parseDate(input.anchorDate));
    const cached = await getReportForPeriod(env, period.kind, period.startDate);
    const cacheNeedsRepair = cached ? hasEncodingCorruption(cached) || needsSourceComparisonRepair(cached) : false;
    if (cached && cached.finalized !== false && cached.dataAvailable && input.forceRefresh !== true && !cacheNeedsRepair) return json({ ok: true, data: await withPreviousWorkItems(env, cached) });
    let refreshed: ReportSnapshot;
    try {
      refreshed = await loadSourceReport(env, period);
    } catch (error) {
      if (!cached) throw error;
      const operations = await loadSourceOperations(env, period);
      refreshed = {
        ...snapshotOnly(cached), period, generatedAt: new Date().toISOString(),
        warnings: [...(cached.warnings || []), 'Một phần dữ liệu tự động được giữ từ bản đã lưu do API sản phẩm TikTok tạm thời lỗi.'],
        operations
      };
    }
    const snapshot = preserveManualOperationMetrics({ ...refreshed, finalized: cached?.finalized === true }, cached);
    const transient: ReportRecord = {
      ...snapshot, id: cached?.id || '', review: cached?.review || [], evaluations: cached?.evaluations || [], workItems: cached?.workItems || [],
      createdAt: cached?.createdAt || snapshot.generatedAt, updatedAt: cached?.updatedAt || snapshot.generatedAt
    };
    return json({ ok: true, data: await withPreviousWorkItems(env, transient) });
  }
  if (request.method === 'POST' && url.pathname === '/api/reports') {
    const input = await readJson<{ snapshot?: ReportSnapshot; review?: any[]; evaluations?: any[]; workItems?: any[]; finalize?: boolean }>(request);
    if (!input.snapshot?.period || !isKind(input.snapshot.period.kind)) return json({ ok: false, error: 'Thiếu snapshot báo cáo.' }, 400);
    const existing = await getReportForPeriod(env, input.snapshot.period.kind, input.snapshot.period.startDate);
    const snapshot = { ...input.snapshot, finalized: input.finalize === true || (existing ? existing.finalized !== false : false) };
    const record = await saveReport(env, snapshot, {
      review: Array.isArray(input.review) ? input.review : [],
      evaluations: Array.isArray(input.evaluations) ? input.evaluations : [],
      workItems: Array.isArray(input.workItems) ? input.workItems : []
    });
    return json({ ok: true, data: await withPreviousWorkItems(env, record) });
  }
  return json({ ok: false, error: 'API route not found.' }, 404);
}

async function assets(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const isReportRoute = /^\/tuan-\d{1,2}-\d{4}\/?$/.test(url.pathname);
  const assetUrl = new URL(url);
  if (isReportRoute) assetUrl.pathname = '/';
  const response = await env.ASSETS.fetch(new Request(assetUrl.toString(), request));
  const headers = new Headers(response.headers);
  if (isReportRoute || url.pathname === '/' || url.pathname.endsWith('.html')) {
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
      if (url.pathname.startsWith('/auth/')) return await handleAuth(request, url);
      if (url.pathname !== '/api/health' && (url.pathname.startsWith('/api/') || !url.pathname.includes('.')) && !await hasSiteAccess(request)) {
        if (url.pathname.startsWith('/api/')) return json({ ok: false, error: 'Vui lòng đăng nhập.' }, 401);
        return loginPage(`${url.pathname}${url.search}`);
      }
      const settingsMutation = (request.method === 'POST' && url.pathname === '/api/reports') || (request.method === 'PATCH' && url.pathname === '/api/previous-work-item');
      if (settingsMutation && !await hasSettingsAccess(request)) return json({ ok: false, error: 'Cần mật khẩu quản trị để thay đổi dữ liệu.' }, 403);
      if (url.pathname.startsWith('/api/')) return await api(request, env, url);
      return await assets(request, env);
    } catch (error) {
      console.error(errorMessage(error));
      return json({ ok: false, error: errorMessage(error) }, 500);
    }
  }
};
