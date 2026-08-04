import type { Env, ReportPeriod } from './types';
import { sourceLogin, sourceRequest } from './source-dashboard';

type MetricFormat = 'money' | 'number' | 'percent';

const PRODUCT_CHANNELS = [
  ['affiliate', 'Liên kết'],
  ['sellerProductCard', 'Thẻ sản phẩm của người bán'],
  ['sellerVideo', 'Video của người bán'],
  ['sellerLive', 'Buổi LIVE của người bán']
] as const;

const PRODUCT_METRICS: Array<[string, string, MetricFormat]> = [
  ['gmv', 'GMV', 'money'], ['orders', 'Đơn hàng', 'number'], ['skuOrders', 'Đơn hàng SKU', 'number'],
  ['soldItems', 'Số món bán ra', 'number'], ['aov', 'AOV', 'money'],
  ['impressions', 'Lượt hiển thị sản phẩm', 'number'], ['clicks', 'Lượt nhấp vào sản phẩm', 'number'],
  ['ctr', 'CTR', 'percent'], ['addCartCount', 'Số lượt thêm vào giỏ', 'number'],
  ['addCartRate', 'Tỷ lệ thêm vào giỏ', 'percent'], ['ctor', 'CTOR', 'percent']
];

function numberValue(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const parsed = Number(String(value ?? '').replace(/\./g, '').replace(',', '.').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function nullable(value: unknown): number | null {
  return value === null || value === undefined || value === '' ? null : numberValue(value);
}

function vi(value: number, digits = 2): string {
  return new Intl.NumberFormat('vi-VN', { maximumFractionDigits: digits }).format(value);
}

function money(value: unknown): string {
  const amount = numberValue(value); const abs = Math.abs(amount);
  if (abs >= 1_000_000_000) return `${vi(amount / 1_000_000_000)}B đ`;
  if (abs >= 1_000_000) return `${vi(amount / 1_000_000)}M đ`;
  if (abs >= 1_000) return `${vi(amount / 1_000)}K đ`;
  return `${vi(amount, 0)} đ`;
}

function percent(value: unknown): string {
  const parsed = nullable(value);
  if (parsed === null) return '—';
  return `${vi(Math.abs(parsed) <= 1 ? parsed * 100 : parsed)}%`;
}

function format(value: unknown, kind: MetricFormat): string {
  if (value === null || value === undefined) return '—';
  if (kind === 'money') return money(value);
  if (kind === 'percent') return percent(value);
  return vi(numberValue(value), 0);
}

function change(current: unknown, previous: unknown): string {
  const value = nullable(current); const old = nullable(previous);
  if (value === null || old === null || old === 0) return 'không có dữ liệu kỳ trước';
  const delta = (value - old) / Math.abs(old);
  return `${delta >= 0 ? '↑' : '↓'} ${vi(Math.abs(delta) * 100)}%`;
}

function cell(current: unknown, previous: unknown, kind: MetricFormat): string {
  return `${format(current, kind)} (${change(current, previous)})`;
}

function productMetricValue(metrics: any, field: string): unknown {
  if (field === 'aov') {
    const orders = numberValue(metrics?.orders);
    return orders ? numberValue(metrics?.gmv) / orders : null;
  }
  return metrics?.[field];
}

function previousRange(period: ReportPeriod): { startDate: string; endDate: string } {
  const days = Math.floor((Date.parse(`${period.endDate}T00:00:00Z`) - Date.parse(`${period.startDate}T00:00:00Z`)) / 86400000) + 1;
  const end = new Date(`${period.startDate}T00:00:00Z`); end.setUTCDate(end.getUTCDate() - 1);
  const start = new Date(end); start.setUTCDate(start.getUTCDate() - days + 1);
  return { startDate: start.toISOString().slice(0, 10), endDate: end.toISOString().slice(0, 10) };
}

async function sourceWithRetry<T>(source: { base: string; cookie: string }, label: string, path: string, body: any,
  complete: (value: T) => boolean): Promise<T> {
  const first = await named(label, sourceRequest<T>(source, path, 'POST', body));
  if (complete(first)) return first;
  const refreshed = await named(`${label} (gọi lại API)`, sourceRequest<T>(source, path, 'POST', { ...body, forceRefresh: true }));
  return complete(refreshed) ? refreshed : first;
}

function safe(value: unknown): string {
  return String(value ?? '—').replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ').trim() || '—';
}

async function named<T>(label: string, operation: Promise<T>): Promise<T> {
  try { return await operation; }
  catch (error) { throw new Error(`${label}: ${error instanceof Error ? error.message : String(error)}`); }
}

function table(headers: string[], rows: Array<Array<unknown>>): string[] {
  return [
    `| ${headers.map(safe).join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.map(safe).join(' | ')} |`)
  ];
}

function productPerformance(productData: any): string[] {
  const current = productData?.current || {};
  const previous = productData?.previous || {};
  const previousProducts = new Map<string, any>((previous.products || []).map((item: any) => [String(item.id), item]));
  const lines = ['## 1. Phân tích hiệu suất', ''];
  for (const [key, label] of PRODUCT_CHANNELS) {
    const metrics = current.channels?.[key] || {};
    const oldMetrics = previous.channels?.[key] || {};
    lines.push(`### ${label}`, '');
    lines.push(...table(['Chỉ số', 'Giá trị và so sánh'], PRODUCT_METRICS.map(([field, title, kind]) =>
      [title, cell(productMetricValue(metrics, field), productMetricValue(oldMetrics, field), kind)])), '');
    const products = (current.products || []).map((item: any) => {
      const value = item.channels?.[key] || {};
      const old = previousProducts.get(String(item.id))?.channels?.[key] || {};
      return { item, value, old };
    }).filter(({ value }: any) => PRODUCT_METRICS.some(([field]) => numberValue(value[field]) !== 0));
    lines.push(`#### Sản phẩm — ${label}`, '');
    if (!products.length) lines.push('_Không có sản phẩm phát sinh số liệu trong kỳ._', '');
    else lines.push(...table(['Tên sản phẩm', ...PRODUCT_METRICS.map(([, title]) => title)], products.map(({ item, value, old }: any) => [
      item.title || `Sản phẩm ${item.id}`,
      ...PRODUCT_METRICS.map(([field, , kind]) => cell(productMetricValue(value, field), productMetricValue(old, field), kind))
    ])), '');
  }
  return lines;
}

function adsSourceRows(summary: any, previousSummary: any): Array<Array<unknown>> {
  const definitions = [['productCard', 'Thẻ sản phẩm'], ['seller', 'Người bán'], ['affiliate', 'Affiliate']] as const;
  return definitions.map(([key, label]) => {
    const item = summary?.costAttribution?.metrics?.[key] || {};
    const old = previousSummary?.costAttribution?.metrics?.[key] || {};
    const cost = numberValue(item.cost), revenue = numberValue(item.grossRevenue), impressions = numberValue(item.impressions);
    const clicks = numberValue(item.clicks), orders = numberValue(item.orders);
    const oldCost = numberValue(old.cost), oldRevenue = numberValue(old.grossRevenue), oldImpressions = numberValue(old.impressions);
    const oldClicks = numberValue(old.clicks), oldOrders = numberValue(old.orders);
    return [label, cell(cost, oldCost, 'money'), cell(revenue, oldRevenue, 'money'),
      cell(cost ? revenue / cost : 0, oldCost ? oldRevenue / oldCost : 0, 'number'),
      cell(impressions, oldImpressions, 'number'), cell(clicks, oldClicks, 'number'),
      cell(impressions ? clicks / impressions : 0, oldImpressions ? oldClicks / oldImpressions : 0, 'percent'),
      cell(orders, oldOrders, 'number'), cell(clicks ? orders / clicks : 0, oldClicks ? oldOrders / oldClicks : 0, 'percent')];
  });
}

function videoRow(video: any): Array<unknown> {
  const orders = numberValue(video.orders); const cost = numberValue(video.cost); const revenue = numberValue(video.grossRevenue);
  return [video.accountName || video.accountUserName || '—', video.status || '—', money(cost), vi(orders, 0),
    money(video.costPerOrder ?? (orders ? cost / orders : 0)), money(revenue), vi(video.roi ?? (cost ? revenue / cost : 0)),
    vi(numberValue(video.productImpressions), 0), vi(numberValue(video.productClicks), 0), percent(video.productClickRate),
    percent(video.adClickRate), percent(video.adConversionRate), percent(video.viewRate2s), percent(video.viewRate6s),
    percent(video.viewRate25), percent(video.viewRate50), percent(video.viewRate75), percent(video.viewRate100)];
}

function adsPerformance(ads: any, previousAds: any, summaries: any, previousSummaries: any, videosByProduct: Map<string, any[]>): string[] {
  const lines = ['## 2. Hiệu quả quảng cáo', '', '### Nguồn', ''];
  lines.push(...table(['Nguồn', 'COST (WoW)', 'Gross revenue (WoW)', 'ROI (WoW)', 'Impressions (WoW)', 'Click (WoW)', 'CTR (WoW)', 'ORDER (WoW)', 'CR (WoW)'], adsSourceRows(summaries, previousSummaries)), '');
  lines.push('### Sản phẩm', '');
  const products = ads?.products || [];
  const previousProducts = new Map<string, any>((previousAds?.products || []).map((product: any) => [`${product.campaignId}:${product.itemGroupId}`, product]));
  if (!products.length) lines.push('_Không có sản phẩm quảng cáo trong kỳ._', '');
  for (const product of products) {
    const metrics = product.metrics || {};
    const old = previousProducts.get(`${product.campaignId}:${product.itemGroupId}`)?.metrics || {};
    lines.push(`#### ${safe(product.productName || `Sản phẩm ${product.itemGroupId}`)}`, '');
    lines.push(...table(['Cost (WoW)', 'SKU orders (WoW)', 'Cost / order (WoW)', 'Gross revenue (WoW)', 'Click (WoW)', 'ROI (WoW)'], [[
      cell(metrics.cost, old.cost, 'money'), cell(metrics.orders, old.orders, 'number'), cell(metrics.costPerOrder, old.costPerOrder, 'money'),
      cell(metrics.grossRevenue, old.grossRevenue, 'money'), cell(metrics.traffic, old.traffic, 'number'), cell(metrics.roi, old.roi, 'number')
    ]]), '');
    const videos = (videosByProduct.get(`${product.campaignId}:${product.itemGroupId}`) || []).filter((video) => numberValue(video.orders) > 0)
      .sort((left, right) => numberValue(right.grossRevenue) - numberValue(left.grossRevenue));
    lines.push('##### Video có đơn', '');
    if (!videos.length) lines.push('_Không có video phát sinh đơn._', '');
    else lines.push(...table([
      'TikTok account', 'Status', 'Cost', 'SKU orders', 'Cost / order', 'Gross revenue', 'ROI',
      'Product ad impressions', 'Product ad clicks', 'Product ad click rate', 'Ad click rate', 'Ad conversion rate',
      '2s view rate', '6s view rate', '25% view rate', '50% view rate', '75% view rate', '100% view rate'
    ], videos.map(videoRow)), '');
  }
  return lines;
}

function cancellationBreakdown(operations: any): string[] {
  const rows = (items: any[]) => {
    const total = (items || []).reduce((sum, item) => sum + numberValue(item.count), 0);
    return (items || []).map((item) => [item.label || item.reason || 'Không xác định', vi(numberValue(item.count), 0), percent(total ? numberValue(item.count) / total : 0)]);
  };
  const lines = ['## 3. Đơn Hoàn Hủy & Logistics', '', '### Cơ cấu lý do hủy đơn', ''];
  const cancel = rows(operations?.cancelReasons);
  lines.push(cancel.length ? table(['Lý do', 'Số đơn', 'Tỷ trọng'], cancel).join('\n') : '_Không có đơn hủy trong kỳ._', '',
    '### Cơ cấu lý do hủy do hệ thống/logistics', '');
  const failed = rows(operations?.failedReasons);
  lines.push(failed.length ? table(['Lý do', 'Số đơn', 'Tỷ trọng'], failed).join('\n') : '_Không có đơn hủy do hệ thống/logistics trong kỳ._', '',
    '### Chỉ số tổng', '', ...table(['Chỉ số', 'Giá trị và so sánh'], [
      ['Tỷ lệ hủy đơn tổng', cell(operations?.totals?.cancellationRate, operations?.previous?.cancellationRate, 'percent')],
      ['Tỷ lệ trả hàng/hoàn tiền tổng', cell(operations?.totals?.returnRate, operations?.previous?.returnRate, 'percent')]
    ]), '');
  return lines;
}

function customerService(data: any): string[] {
  const current = data?.current || {}; const previous = data?.previous || {};
  return ['## 5. Vận hành CSKH', '', ...table(['Chỉ số', 'Giá trị và so sánh'], [
    ['Tỷ lệ phản hồi nhanh', cell(current.responseRate, previous.responseRate, 'percent')],
    ['Thời gian phản hồi trung bình', `${cell(current.averageResponseMinutes, previous.averageResponseMinutes, 'number')} phút`],
    ['Số tin nhắn chưa phản hồi trong 24h', format(current.unansweredWithin24Hours, 'number')]
  ]), ''];
}

function revenueAnalysis(revenue: any): string[] {
  const current = revenue?.totals || {}; const old = revenue?.previousTotals || {};
  const lines = ['## 4. Phân Tích Doanh Thu', ''];
  lines.push(...table(['Chỉ số', 'Giá trị và so sánh'], [
    ['Tổng GMV', cell(current.grossRevenue, old.grossRevenue, 'money')],
    ['Tổng đơn hàng', cell(current.orders, old.orders, 'number')],
    ['AOV', cell(current.aov, old.aov, 'money')],
    ['Tỉ lệ khách mua lại', cell(current.repurchaseRate, old.repurchaseRate, 'percent')]
  ]), '', '### Phân tích GMV nguồn', '');
  const attribution = revenue?.gmvAttribution || {}; const previous = revenue?.previousGmvAttribution || {};
  const rows: Array<Array<unknown>> = [];
  for (const [key, label] of [['affiliate', 'Liên kết'], ['seller', 'Người bán']] as const) {
    for (const [child, childLabel] of [['live', 'LIVE'], ['video', 'Video'], ['productCard', 'Thẻ sản phẩm']] as const) {
      rows.push([label, childLabel, cell(attribution?.[key]?.[child], previous?.[key]?.[child], 'money')]);
    }
  }
  lines.push(...table(['Nguồn', 'Hình thức', 'GMV và so sánh'], rows), '');
  return lines;
}

async function productVideos(source: { base: string; cookie: string }, ads: any, period: ReportPeriod): Promise<Map<string, any[]>> {
  const products = (ads?.products || []).filter((product: any) => numberValue(product?.metrics?.orders) > 0);
  const result = new Map<string, any[]>();
  for (let offset = 0; offset < products.length; offset += 4) {
    const batch = products.slice(offset, offset + 4);
    const responses = await Promise.all(batch.map(async (product: any) => {
      const request = (forceRefresh: boolean) => named(`Video sản phẩm ${product.itemGroupId}`, sourceRequest<any>(source, '/api/product-videos', 'POST', {
        advertiserId: ads.advertiserId, storeId: ads.store?.storeId, startDate: period.startDate, endDate: period.endDate,
        campaignId: product.campaignId, itemGroupId: product.itemGroupId, forceRefresh
      })).catch(() => ({ videos: [] }));
      let data = await request(false);
      if (!(data?.videos || []).some((video: any) => numberValue(video.orders) > 0)) data = await request(true);
      return { key: `${product.campaignId}:${product.itemGroupId}`, videos: data?.videos || [] };
    }));
    responses.forEach((item) => result.set(item.key, item.videos));
  }
  return result;
}

export async function createMarkdownExport(env: Env, period: ReportPeriod): Promise<{ filename: string; markdown: string }> {
  const source = await sourceLogin(env);
  const state = await named('Trạng thái dashboard', sourceRequest<any>(source, '/api/state', 'GET'));
  if (!state.defaultAdvertiserId || !state.defaultStoreCode) throw new Error('Dashboard nguồn chưa có advertiser/store mặc định.');
  const reportScope = { advertiserId: state.defaultAdvertiserId, storeId: state.defaultStoreCode, startDate: period.startDate, endDate: period.endDate };
  const sellerScope = { startDate: period.startDate, endDate: period.endDate };
  const previous = previousRange(period);
  const previousReportScope = { advertiserId: state.defaultAdvertiserId, storeId: state.defaultStoreCode, ...previous };
  const [products, ads, previousAds, operations, revenue, customerSupport] = await Promise.all([
    sourceWithRetry<any>(source, 'Phân tích hiệu suất', '/api/product-analysis', sellerScope, (value) => Boolean(value?.current?.products?.length)),
    sourceWithRetry<any>(source, 'Hiệu quả quảng cáo', '/api/report', reportScope, (value) => Boolean(value?.products?.length || numberValue(value?.totals?.cost))),
    sourceWithRetry<any>(source, 'Hiệu quả quảng cáo kỳ trước', '/api/report', previousReportScope, (value) => Boolean(value?.products?.length || numberValue(value?.totals?.cost))),
    sourceWithRetry<any>(source, 'Đơn Hoàn Hủy & Logistics', '/api/operations-analysis', sellerScope, (value) => Boolean(value?.totals)),
    sourceWithRetry<any>(source, 'Phân Tích Doanh Thu', '/api/revenue-analysis', sellerScope, (value) => Boolean(value?.totals)),
    sourceWithRetry<any>(source, 'Vận hành CSKH', '/api/customer-service-analysis', sellerScope, (value) => Boolean(value?.current)).catch((error) => ({ error: error instanceof Error ? error.message : String(error) }))
  ]);
  const [summaries, previousSummaries] = await Promise.all([
    sourceWithRetry<any>(source, 'Nguồn quảng cáo', '/api/creative-summaries', {
    ...reportScope, products: ads.products || [], allContexts: ads.creativeContexts || []
    }, (value) => Boolean(numberValue(value?.costAttribution?.total))),
    sourceWithRetry<any>(source, 'Nguồn quảng cáo kỳ trước', '/api/creative-summaries', {
      ...previousReportScope, products: previousAds.products || [], allContexts: previousAds.creativeContexts || []
    }, (value) => Boolean(numberValue(value?.costAttribution?.total)))
  ]);
  const videos = await productVideos(source, ads, period);
  const warnings: string[] = [];
  if (!numberValue(ads?.totals?.cost) && !(ads?.products || []).length) warnings.push('TikTok Ads MCP vẫn trả về 0 sau khi hệ thống đã gọi lại API; phần quảng cáo không có dữ liệu để xuất.');
  if (customerSupport?.error) warnings.push(`Không lấy được dữ liệu CSKH: ${customerSupport.error}`);
  const markdown = [
    `# Dữ liệu ${period.title}`,
    '', `- Kỳ báo cáo: ${period.startDate} → ${period.endDate}`,
    `- Xuất lúc: ${new Intl.DateTimeFormat('vi-VN', { timeZone: env.TIMEZONE || 'Asia/Bangkok', dateStyle: 'short', timeStyle: 'medium' }).format(new Date())}`,
    ...(warnings.length ? ['', '## Cảnh báo dữ liệu', '', ...warnings.map((warning) => `- ${warning}`)] : []),
    '', ...productPerformance(products), ...adsPerformance(ads, previousAds, summaries, previousSummaries, videos),
    ...cancellationBreakdown(operations), ...revenueAnalysis(revenue), ...customerService(customerSupport)
  ].join('\n');
  const slug = period.title.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return { filename: `${slug || 'bao-cao-du-lieu'}.md`, markdown };
}
