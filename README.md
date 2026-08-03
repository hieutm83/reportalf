# Report ALF

Dashboard riêng cho báo cáo hiệu suất theo tuần và tháng của AnlanhFarm. Dự án này độc lập với `cloudflare-gmv-max`.

## Kỳ báo cáo

- Tuần: chọn thứ 7 làm mốc. Ví dụ chọn `01/08/2026` sẽ lấy số liệu từ `25/07/2026` đến hết `31/07/2026`.
- Tháng: chọn ngày 1. Ví dụ chọn `01/08/2026` sẽ lấy số liệu tháng `07/2026`.
- Nhấn phím `i` ở ngoài các ô nhập liệu để mở cài đặt kỳ báo cáo.

## Kết nối số liệu

Worker đăng nhập read-only vào dashboard nguồn bằng `SOURCE_DASHBOARD_PASSWORD`, sau đó gọi các API báo cáo hiện có:

- Doanh thu: `/api/revenue-analysis`
- Quảng cáo: `/api/report`
- Vận hành: `/api/operations-analysis`
- Tài chính: `/api/finance-analysis`
- Traffic và sản phẩm: `/api/product-analysis`

Mật khẩu nguồn chỉ được lưu bằng Cloudflare Secret. Không đặt mật khẩu trong `public/` hoặc GitHub.

## Supabase

Chạy nội dung `migrations/0002_supabase_schema.sql` trong SQL Editor của project `adtjorcpqpmqvhostkbg`. Bảng `reports` lưu snapshot chỉ số, review, đánh giá và kế hoạch hành động theo từng kỳ. Unique key là `(kind, period_start)` nên mở lại báo cáo cũ không làm mất công việc đã lưu.

## Chạy local

```powershell
npm install
Copy-Item .dev.vars.example .dev.vars
npm run dev
```

Điền `SOURCE_DASHBOARD_PASSWORD` và `SUPABASE_SERVICE_ROLE_KEY` trong `.dev.vars` trước khi gọi dữ liệu/lưu báo cáo.

## Deploy

```powershell
npm run typecheck
npm test
npx wrangler secret put SOURCE_DASHBOARD_PASSWORD
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
npm run deploy
```

Domain dự kiến: `https://anlanh-report.indevs.in`.
