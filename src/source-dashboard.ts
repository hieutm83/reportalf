import type { Env, Metric, ProductRow, ReportPeriod, ReportSnapshot, SourceRow } from './types';

type Bundle = {
  revenue: any;
  ads: any;
  operations: any;
  finance: any;
  products: any;
};

function number(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const text = String(value ?? '').replace(/\./g, '').replace(',', '.').replace(/[^0-9.-]/g, '');
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : 0;
}

function nullable(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  return number(value);
}

function metric(value: unknown, previous: unknown): Metric {
  const current = nullable(value);
  const old = nullable(previous);
  return { value: current, previous: old, change: current !== null && old !== null && old !== 0 ? (current - old) / Math.abs(old) : null };
}

function productMetrics(product: any): any {
  return product?.total || {};
}

function sourceCookie(response: Response): string {
  const setCookie = response.headers.get('set-cookie') || '';
  const match = setCookie.match(/([^=;,]+=[^;,]+)/);
  if (!match) throw new Error('Dashboard nguồn không trả về phiên đăng nhập.');
  return match[1];
}

async function sourceLogin(env: Env): Promise<{ base: string; cookie: string }> {
  const base = String(env.SOURCE_DASHBOARD_URL || '').replace(/\/$/, '');
  if (!base || !env.SOURCE_DASHBOARD_PASSWORD) throw new Error('Thiếu cấu hình dashboard nguồn.');
  const response = await fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: env.SOURCE_DASHBOARD_PASSWORD })
  });
  if (!response.ok) throw new Error(`Đăng nhập dashboard nguồn thất bại (${response.status}).`);
  const body = await response.json<any>().catch(() => ({}));
  if (body.ok !== true) throw new Error(body.error || 'Đăng nhập dashboard nguồn thất bại.');
  return { base, cookie: sourceCookie(response) };
}

async function sourceRequest<T>(source: { base: string; cookie: string }, path: string, method: 'GET' | 'POST', body?: unknown): Promise<T> {
  const response = await fetch(`${source.base}${path}`, {
    method,
    headers: { Cookie: source.cookie, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const data = await response.json<any>().catch(() => ({}));
  if (!response.ok || data.ok !== true) throw new Error(data.error || `Nguồn dữ liệu trả về ${response.status}.`);
  return data.data as T;
}

function previousRange(period: ReportPeriod): { startDate: string; endDate: string } {
  const days = Math.floor((Date.parse(`${period.endDate}T00:00:00Z`) - Date.parse(`${period.startDate}T00:00:00Z`)) / 86400000) + 1;
  const endDate = new Date(`${period.startDate}T00:00:00Z`);
  endDate.setUTCDate(endDate.getUTCDate() - 1);
  const end = endDate.toISOString().slice(0, 10);
  const start = new Date(`${end}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - days + 1);
  return { startDate: start.toISOString().slice(0, 10), endDate: end };
}

async function bundle(source: { base: string; cookie: string }, state: any, startDate: string, endDate: string): Promise<Bundle> {
  const scope = { startDate, endDate, forceRefresh: true };
  const reportScope = { advertiserId: state.defaultAdvertiserId, storeId: state.defaultStoreCode, ...scope };
  const [revenue, ads, operations, finance, products] = await Promise.all([
    sourceRequest<any>(source, '/api/revenue-analysis', 'POST', scope),
    sourceRequest<any>(source, '/api/report', 'POST', reportScope),
    sourceRequest<any>(source, '/api/operations-analysis', 'POST', scope),
    sourceRequest<any>(source, '/api/finance-analysis', 'POST', scope),
    sourceRequest<any>(source, '/api/product-analysis', 'POST', scope)
  ]);
  return { revenue, ads, operations, finance, products };
}

function sourceRows(current: any, totalGmv: number): SourceRow[] {
  const channels = current?.channels || current?.current?.channels || {};
  const definitions = [
    ['affiliate', 'Liên kết / KOC'],
    ['sellerProductCard', 'Thẻ sản phẩm'],
    ['sellerVideo', 'Video người bán'],
    ['sellerLive', 'Livestream người bán']
  ] as const;
  return definitions.map(([key, label]) => {
    const value = channels[key] || {};
    const gmv = number(value.gmv);
    const impressions = number(value.impressions);
    const clicks = number(value.clicks);
    const orders = number(value.skuOrders || value.orders);
    return { key, label, gmv, contribution: totalGmv ? gmv / totalGmv : 0, impressions, clicks,
      ctr: impressions ? clicks / impressions : null, ctor: clicks ? orders / clicks : null };
  });
}

function productRows(current: any, previous: any): ProductRow[] {
  const previousMap = new Map<string, any>((previous?.current?.products || []).map((item: any) => [String(item.id), productMetrics(item)]));
  return (current?.current?.products || []).map((item: any) => {
    const value = productMetrics(item);
    const old = previousMap.get(String(item.id)) || {};
    const gmv = number(value.gmv), orders = number(value.skuOrders || value.orders), impressions = number(value.impressions), clicks = number(value.clicks);
    const ctr = nullable(value.ctr), ctor = nullable(value.ctor);
    return { id: String(item.id || ''), title: String(item.title || `Sản phẩm ${item.id || ''}`), imageUrl: String(item.imageUrl || ''),
      gmv, orders, impressions, clicks, ctr, ctor,
      change: {
        gmv: metric(gmv, old.gmv).change, orders: metric(orders, old.skuOrders || old.orders).change,
        impressions: metric(impressions, old.impressions).change, clicks: metric(clicks, old.clicks).change,
        ctr: metric(ctr, old.ctr).change, ctor: metric(ctor, old.ctor).change
      } };
  }).sort((left: ProductRow, right: ProductRow) => right.gmv - left.gmv).slice(0, 8);
}

function financeBlock(current: any): ReportSnapshot['finance'] {
  const summary = current?.summary || {};
  const combined = current?.combined || {};
  const feeTax = Math.abs(number(summary.feeTax ?? summary.feeTaxAmount));
  const affiliate = Math.abs(number(summary.affiliate));
  const refunds = Math.abs(number(summary.refunds));
  const ads = Math.abs(number(current?.ads?.cost));
  const grossProfit = number(summary.grossProfit);
  const gmv = number(summary.sellerSubtotal || current?.totalGmv);
  const totalCost = feeTax + affiliate + refunds + ads;
  return { feeTax, affiliate, ads, refunds, grossProfit, gmv,
    totalCostRate: gmv ? totalCost / gmv : null };
}

export async function loadSourceReport(env: Env, period: ReportPeriod): Promise<ReportSnapshot> {
  const source = await sourceLogin(env);
  const state = await sourceRequest<any>(source, '/api/state', 'GET');
  if (!state.defaultAdvertiserId || !state.defaultStoreCode) throw new Error('Dashboard nguồn chưa có advertiser/store mặc định.');
  const previous = previousRange(period);
  const [current, old] = await Promise.all([
    bundle(source, state, period.startDate, period.endDate),
    bundle(source, state, previous.startDate, previous.endDate)
  ]);
  const currentRevenue = current.revenue?.totals || {};
  const oldRevenue = old.revenue?.totals || {};
  const currentAds = current.ads?.totals || {};
  const oldAds = old.ads?.totals || {};
  const currentOps = current.operations?.totals || {};
  const oldOps = old.operations?.totals || {};
  const currentTotal = current.products?.current?.total || {};
  const oldTotal = old.products?.current?.total || {};
  const finance = financeBlock(current.finance);
  const warnings = [
    'Tỷ lệ gửi hàng nhanh và tỷ lệ phản hồi nhanh chưa có API trong dashboard nguồn.'
  ];
  return {
    period, generatedAt: new Date().toISOString(), dataAvailable: true, warnings,
    core: {
      gmv: metric(currentRevenue.grossRevenue, oldRevenue.grossRevenue),
      orders: metric(currentRevenue.orders, oldRevenue.orders),
      aov: metric(currentRevenue.aov, oldRevenue.aov),
      adsCostPerOrder: metric(currentAds.costPerOrder, oldAds.costPerOrder)
    },
    operations: {
      cancellationRate: metric(number(currentOps.cancellationRate) * 100, number(oldOps.cancellationRate) * 100),
      returnRate: metric(number(currentOps.returnRate) * 100, number(oldOps.returnRate) * 100),
      fastShippingRate: metric(null, null), quickResponseRate: metric(null, null)
    },
    funnel: {
      impressions: metric(currentTotal.impressions, oldTotal.impressions), clicks: metric(currentTotal.clicks, oldTotal.clicks),
      skuOrders: metric(currentTotal.skuOrders, oldTotal.skuOrders), ctr: metric(number(currentTotal.ctr) * 100, number(oldTotal.ctr) * 100),
      ctor: metric(number(currentTotal.ctor) * 100, number(oldTotal.ctor) * 100)
    },
    finance, sources: sourceRows(current.products, finance.gmv), products: productRows(current.products, old.products)
  };
}
