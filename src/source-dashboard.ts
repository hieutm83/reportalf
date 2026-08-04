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

function scaled(value: unknown, factor: number): number | null {
  const parsed = nullable(value);
  return parsed === null ? null : parsed * factor;
}

function percentValue(...values: unknown[]): number | null {
  const parsed = values.map(nullable).find((value): value is number => value !== null);
  if (parsed === undefined) return null;
  return Math.abs(parsed) <= 1 ? parsed * 100 : parsed;
}

export function returnRateValue(totals: any): number | null {
  const returns = nullable(totals?.returns);
  const eligible = nullable(totals?.returnEligibleOrders);
  const totalOrders = nullable(totals?.totalOrders);
  if (returns === null) return percentValue(totals?.returnRate);
  // Historical TikTok data can return an incomplete eligible population (for
  // example 1 eligible order out of hundreds), producing a misleading 100%.
  if (eligible !== null && eligible > 0 && (totalOrders === null || eligible >= totalOrders * 0.1)) return returns / eligible * 100;
  if (totalOrders !== null && totalOrders > 0) return returns / totalOrders * 100;
  return percentValue(totals?.returnRate);
}

function metric(value: unknown, previous: unknown): Metric {
  const current = nullable(value);
  const old = nullable(previous);
  return { value: current, previous: old, change: current !== null && old !== null && old !== 0 ? (current - old) / Math.abs(old) : null };
}

function productMetrics(product: any): any {
  return product?.total || {};
}

function payload(value: any): any {
  return value?.data ?? value ?? {};
}

function sourceCookie(response: Response): string {
  const setCookie = response.headers.get('set-cookie') || '';
  const match = setCookie.match(/([^=;,]+=[^;,]+)/);
  if (!match) throw new Error('Dashboard nguồn không trả về phiên đăng nhập.');
  return match[1];
}

export async function sourceLogin(env: Env): Promise<{ base: string; cookie: string }> {
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

export async function sourceRequest<T>(source: { base: string; cookie: string }, path: string, method: 'GET' | 'POST', body?: unknown): Promise<T> {
  const response = await fetch(`${source.base}${path}`, {
    method,
    headers: { Cookie: source.cookie, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const raw = await response.arrayBuffer();
  const text = new TextDecoder('utf-8').decode(raw);
  const data = (() => { try { return JSON.parse(text || '{}'); } catch { return {}; } })();
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
  const stableFinanceScope = { startDate, endDate };
  const reportScope = { advertiserId: state.defaultAdvertiserId, storeId: state.defaultStoreCode, ...scope };
  const [revenue, ads, operations, finance, products] = await Promise.all([
    sourceRequest<any>(source, '/api/revenue-analysis', 'POST', scope),
    sourceRequest<any>(source, '/api/report', 'POST', reportScope),
    sourceRequest<any>(source, '/api/operations-analysis', 'POST', scope),
    // Finance refresh can exceed the source Worker's subrequest limit and return
    // a partial summary. Its cache is period-keyed and contains the complete block.
    sourceRequest<any>(source, '/api/finance-analysis', 'POST', stableFinanceScope),
    sourceRequest<any>(source, '/api/product-analysis', 'POST', scope)
  ]);
  return { revenue, ads, operations, finance, products };
}

function sourceRows(current: any, totalGmv: number, previous: any = null, previousTotalGmv = 0): SourceRow[] {
  const channels = current?.channels || current?.current?.channels || current?.previous?.channels || {};
  const previousChannels = previous?.channels || previous?.current?.channels || previous?.previous?.channels || {};
  const resolvedPreviousTotalGmv = previousTotalGmv || number(previous?.total?.gmv || previous?.current?.total?.gmv || previous?.previous?.total?.gmv);
  const change = (value: number | null, oldValue: number | null): number | null => value !== null && oldValue !== null && oldValue !== 0 ? (value - oldValue) / Math.abs(oldValue) : null;
  const definitions = [
    ['affiliate', 'Liên kết / KOC'],
    ['sellerProductCard', 'Thẻ sản phẩm'],
    ['sellerVideo', 'Video người bán'],
    ['sellerLive', 'Livestream người bán']
  ] as const;
  const channelTotalGmv = definitions.reduce((sum, [key]) => sum + number(channels[key]?.gmv), 0);
  const previousChannelTotalGmv = definitions.reduce((sum, [key]) => sum + number(previousChannels[key]?.gmv), 0);
  const resolvedTotalGmv = channelTotalGmv || totalGmv;
  const resolvedPreviousGmv = previousChannelTotalGmv || resolvedPreviousTotalGmv;
  return definitions.map(([key, label]) => {
    const value = channels[key] || {};
    const gmv = number(value.gmv);
    const impressions = number(value.impressions);
    const clicks = number(value.clicks);
    const orders = number(value.skuOrders || value.orders);
    const oldValue = previousChannels[key] || {};
    const oldGmv = number(oldValue.gmv);
    const oldImpressions = number(oldValue.impressions);
    const oldClicks = number(oldValue.clicks);
    const oldOrders = number(oldValue.skuOrders || oldValue.orders);
    const oldCtr = oldImpressions ? oldClicks / oldImpressions : null;
    const oldCtor = oldClicks ? oldOrders / oldClicks : null;
    const oldContribution = resolvedPreviousGmv ? oldGmv / resolvedPreviousGmv : null;
    return { key, label, gmv, contribution: resolvedTotalGmv ? gmv / resolvedTotalGmv : 0, impressions, clicks,
      ctr: impressions ? clicks / impressions : null, ctor: clicks ? orders / clicks : null,
      change: {
        gmv: change(gmv, oldGmv), contribution: change(resolvedTotalGmv ? gmv / resolvedTotalGmv : 0, oldContribution),
        impressions: change(impressions, oldImpressions), clicks: change(clicks, oldClicks),
        ctr: change(impressions ? clicks / impressions : null, oldCtr), ctor: change(clicks ? orders / clicks : null, oldCtor)
      } };
  });
}

function productRows(current: any, previous: any, catalog: Map<string, string> = new Map()): ProductRow[] {
  const currentPayload = payload(current);
  const previousPayload = payload(previous);
  const previousProducts = previousPayload?.current?.products || previousPayload?.products || [];
  const previousMap = new Map<string, any>(previousProducts.map((item: any) => [String(item.id), productMetrics(item)]));
  const previousImages = new Map<string, string>(previousProducts.map((item: any) => [String(item.id), String(item.imageUrl || item.productImageUrl || '')]));
  return (currentPayload?.current?.products || currentPayload?.products || []).map((item: any) => {
    const value = productMetrics(item);
    const old = previousMap.get(String(item.id)) || {};
    const gmv = number(value.gmv), orders = number(value.skuOrders || value.orders), impressions = number(value.impressions), clicks = number(value.clicks);
    const ctr = nullable(value.ctr), ctor = nullable(value.ctor);
    const id = String(item.id || '');
    const imageUrl = String(item.imageUrl || item.productImageUrl || item.product_image_url || item.image_url || catalog.get(id) || previousImages.get(id) || '');
    return { id, title: String(item.title || item.productName || `Sản phẩm ${id}`), imageUrl,
      gmv, orders, impressions, clicks, ctr, ctor,
      change: {
        gmv: metric(gmv, old.gmv).change, orders: metric(orders, old.skuOrders || old.orders).change,
        impressions: metric(impressions, old.impressions).change, clicks: metric(clicks, old.clicks).change,
        ctr: metric(ctr, old.ctr).change, ctor: metric(ctor, old.ctor).change
      } };
  }).sort((left: ProductRow, right: ProductRow) => right.gmv - left.gmv).slice(0, 8);
}

function financeBlock(current: any): ReportSnapshot['finance'] {
  const source = payload(current);
  const summary = source?.summary || source?.current?.summary || {};
  const feeTax = Math.abs(number(summary.feeTax ?? summary.feeTaxAmount));
  const affiliate = Math.abs(number(summary.affiliate));
  const refunds = Math.abs(number(summary.refunds));
  const ads = Math.abs(number(summary.adsCost ?? source?.ads?.cost));
  const grossProfit = number(summary.grossProfit);
  const gmv = number(summary.sellerSubtotal || source?.totalGmv);
  const totalCost = feeTax + affiliate + refunds + ads;
  return { feeTax, affiliate, ads, refunds, grossProfit, gmv,
    totalCostRate: gmv ? totalCost / gmv : null };
}

function operationsBlock(current: any, old: any): ReportSnapshot['operations'] {
  const currentOps = payload(current)?.totals || {};
  const oldOps = payload(old)?.totals || {};
  const currentOtdr = percentValue(currentOps.otdr, currentOps.OTDR, currentOps.deliveryOnTimeRate, currentOps.onTimeDeliveryRate);
  const previousOtdr = percentValue(oldOps.otdr, oldOps.OTDR, oldOps.deliveryOnTimeRate, oldOps.onTimeDeliveryRate);
  const currentResponse24h = percentValue(currentOps.responseWithin24Hours, currentOps.response24hRate, currentOps.customerServiceResponseRate, currentOps.responseRate);
  const previousResponse24h = percentValue(oldOps.responseWithin24Hours, oldOps.response24hRate, oldOps.customerServiceResponseRate, oldOps.responseRate);
  return {
    cancellationRate: metric(scaled(currentOps.cancellationRate, 100), scaled(oldOps.cancellationRate, 100)),
    returnRate: metric(returnRateValue(currentOps), returnRateValue(oldOps)),
    fastShippingRate: metric(currentOtdr, previousOtdr), quickResponseRate: metric(currentResponse24h, previousResponse24h)
  };
}

export async function loadSourceOperations(env: Env, period: ReportPeriod): Promise<ReportSnapshot['operations']> {
  const source = await sourceLogin(env);
  const previous = previousRange(period);
  const scope = (startDate: string, endDate: string) => ({ startDate, endDate, forceRefresh: true });
  const [current, old] = await Promise.all([
    sourceRequest<any>(source, '/api/operations-analysis', 'POST', scope(period.startDate, period.endDate)),
    sourceRequest<any>(source, '/api/operations-analysis', 'POST', scope(previous.startDate, previous.endDate))
  ]);
  return operationsBlock(current, old);
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
  const currentRevenue = payload(current.revenue)?.totals || {};
  const oldRevenue = payload(old.revenue)?.totals || {};
  const currentAds = payload(current.ads)?.totals || {};
  const oldAds = payload(old.ads)?.totals || {};
  const currentProductPayload = payload(current.products);
  const oldProductPayload = payload(old.products);
  const currentTotal = currentProductPayload?.current?.total || currentProductPayload?.total || {};
  const oldTotal = oldProductPayload?.current?.total || oldProductPayload?.total || {};
  const finance = financeBlock(current.finance);
  const previousFinance = financeBlock(old.finance);
  const currentFinanceAds = payload(current.finance)?.current?.ads || payload(current.finance)?.ads || {};
  const previousFinanceAds = payload(old.finance)?.current?.ads || payload(old.finance)?.ads || {};
  const reportedAdsCost = nullable(currentAds.cost);
  const financeReportedAdsCost = nullable(currentFinanceAds.cost);
  const adsCost = reportedAdsCost && reportedAdsCost > 0 ? reportedAdsCost :
    (financeReportedAdsCost && financeReportedAdsCost > 0 ? financeReportedAdsCost : (finance.ads > 0 ? finance.ads : null));
  const reportedPreviousAdsCost = nullable(oldAds.cost);
  const financeReportedPreviousAdsCost = nullable(previousFinanceAds.cost);
  const previousAdsCost = reportedPreviousAdsCost && reportedPreviousAdsCost > 0 ? reportedPreviousAdsCost :
    (financeReportedPreviousAdsCost && financeReportedPreviousAdsCost > 0 ? financeReportedPreviousAdsCost : (previousFinance.ads > 0 ? previousFinance.ads : null));
  const adsCostPerOrder = nullable(currentAds.costPerOrder) ?? nullable(currentFinanceAds.costPerOrder);
  const previousAdsCostPerOrder = nullable(oldAds.costPerOrder) ?? nullable(previousFinanceAds.costPerOrder);
  const operations = operationsBlock(current.operations, old.operations);
  const warnings: string[] = [];
  if (operations.fastShippingRate.value === null) warnings.push('Tỷ lệ gửi hàng nhanh chưa được trả về từ API nguồn (dimension Hoàn thiện đơn hàng và kho vận, evaluate_duration_days=30).');
  if (operations.quickResponseRate.value === null) warnings.push('Tỷ lệ phản hồi trong 24 giờ chưa được trả về từ API customer service performance.');
  const imageCatalog = new Map<string, string>();
  for (const item of payload(current.ads)?.products || []) {
    const id = String(item.itemGroupId || item.productId || item.id || '');
    const imageUrl = String(item.productImageUrl || item.imageUrl || item.product_image_url || item.image_url || '');
    if (id && imageUrl) imageCatalog.set(id, imageUrl);
  }
  return {
    period, generatedAt: new Date().toISOString(), dataAvailable: true, warnings,
    core: {
      gmv: metric(currentRevenue.grossRevenue, oldRevenue.grossRevenue),
      orders: metric(currentRevenue.orders, oldRevenue.orders),
      aov: metric(currentRevenue.aov, oldRevenue.aov),
      adsCostPerOrder: metric(
        adsCostPerOrder && adsCostPerOrder > 0 ? adsCostPerOrder : (adsCost !== null && nullable(currentRevenue.orders) ? adsCost / Math.max(1, number(currentRevenue.orders)) : null),
        previousAdsCostPerOrder && previousAdsCostPerOrder > 0 ? previousAdsCostPerOrder : (previousAdsCost !== null && nullable(oldRevenue.orders) ? previousAdsCost / Math.max(1, number(oldRevenue.orders)) : null)
      )
    },
    operations,
    funnel: {
      impressions: metric(currentTotal.impressions, oldTotal.impressions), clicks: metric(currentTotal.clicks, oldTotal.clicks),
      skuOrders: metric(currentTotal.skuOrders, oldTotal.skuOrders), ctr: metric(scaled(currentTotal.ctr, 100), scaled(oldTotal.ctr, 100)),
      ctor: metric(scaled(currentTotal.ctor, 100), scaled(oldTotal.ctor, 100))
    },
    finance, sources: sourceRows(current.products, finance.gmv, old.products, previousFinance.gmv), products: productRows(current.products, old.products, imageCatalog)
  };
}
