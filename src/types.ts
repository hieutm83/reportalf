export interface Env {
  ASSETS: Fetcher;
  SOURCE_DASHBOARD_URL: string;
  SOURCE_DASHBOARD_PASSWORD: string;
  TIMEZONE: string;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
}

export type ReportKind = 'week' | 'month';

export interface ReportPeriod {
  kind: ReportKind;
  anchorDate: string;
  startDate: string;
  endDate: string;
  title: string;
}

export interface ReportSnapshot {
  period: ReportPeriod;
  generatedAt: string;
  dataAvailable: boolean;
  warnings: string[];
  core: {
    gmv: Metric;
    orders: Metric;
    aov: Metric;
    adsCostPerOrder: Metric;
  };
  operations: {
    cancellationRate: Metric;
    returnRate: Metric;
    fastShippingRate: Metric;
    quickResponseRate: Metric;
  };
  funnel: {
    impressions: Metric;
    clicks: Metric;
    skuOrders: Metric;
    ctr: Metric;
    ctor: Metric;
  };
  finance: {
    feeTax: number;
    affiliate: number;
    ads: number;
    refunds: number;
    grossProfit: number;
    gmv: number;
    totalCostRate: number | null;
  };
  sources: SourceRow[];
  products: ProductRow[];
}

export interface Metric {
  value: number | null;
  previous: number | null;
  change: number | null;
}

export interface SourceRow {
  key: string;
  label: string;
  gmv: number;
  contribution: number;
  impressions: number;
  clicks: number;
  ctr: number | null;
  ctor: number | null;
}

export interface ProductRow {
  id: string;
  title: string;
  imageUrl: string;
  gmv: number;
  orders: number;
  impressions: number;
  clicks: number;
  ctr: number | null;
  ctor: number | null;
  change: Record<string, number | null>;
}

export interface WorkItem {
  id: string;
  title: string;
  detail: string;
  kpi: string;
  owner: string;
  deadline: string;
}

export interface ReviewItem {
  id: string;
  previousWork: string;
  status: string;
  impact: string;
  lesson: string;
}

export interface ReportRecord extends ReportSnapshot {
  id: string;
  review: ReviewItem[];
  evaluations: Array<{ id: string; segment: string; situation: string; cause: string; action: string }>;
  workItems: WorkItem[];
  createdAt: string;
  updatedAt: string;
}
