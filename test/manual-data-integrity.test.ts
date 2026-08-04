import { afterEach, describe, expect, it, vi } from 'vitest';
import { saveReport } from '../src/supabase';
import type { Env, ReportSnapshot } from '../src/types';

const env = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key'
} as Env;

function snapshot(startDate: string, endDate: string, anchorDate: string): ReportSnapshot {
  return {
    period: { kind: 'week', startDate, endDate, anchorDate, title: `Week ${startDate}` },
    generatedAt: '2026-08-04T00:00:00.000Z',
    dataAvailable: true,
    warnings: [],
    core: {} as ReportSnapshot['core'], operations: {} as ReportSnapshot['operations'],
    funnel: {} as ReportSnapshot['funnel'], finance: {} as ReportSnapshot['finance'],
    sources: [], products: []
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('manual data is isolated by report period', () => {
  it('upserts week 30 and week 31 with different composite keys', async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body || '{}'));
      calls.push({ url: String(input), body });
      return new Response(JSON.stringify([{ id: `${body.kind}-${body.period_start}`, ...body, created_at: body.updated_at }]), { status: 200 });
    }));

    await saveReport(env, snapshot('2026-07-18', '2026-07-24', '2026-07-25'), {
      evaluations: [{ id: 'e30', segment: 'week 30', situation: '', cause: '', action: '' }],
      workItems: [{ id: 'w30', title: 'week 30', detail: '', kpi: '', owner: '', deadline: '' }]
    });
    await saveReport(env, snapshot('2026-07-25', '2026-07-31', '2026-08-01'), {
      evaluations: [{ id: 'e31', segment: 'week 31', situation: '', cause: '', action: '' }],
      workItems: [{ id: 'w31', title: 'week 31', detail: '', kpi: '', owner: '', deadline: '' }]
    });

    expect(calls).toHaveLength(2);
    expect(calls.every((call) => call.url.includes('on_conflict=kind,period_start'))).toBe(true);
    expect(calls.map((call) => call.body.period_start)).toEqual(['2026-07-18', '2026-07-25']);
    expect((calls[0].body.work_items as Array<{ id: string }>)[0].id).toBe('w30');
    expect((calls[1].body.work_items as Array<{ id: string }>)[0].id).toBe('w31');
  });
});
