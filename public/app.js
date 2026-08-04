(() => {
  const $ = (selector) => document.querySelector(selector);
  const state = { kind: 'week', anchorDate: '', period: null, snapshot: null, id: '', review: [], evaluations: [], workItems: [], historyKind: 'week', settingsDraft: null };
  const colors = ['#2563eb', '#7c3aed', '#f59e0b', '#ec4899', '#22c55e'];

  const emptyMetric = () => ({ value: null, previous: null, change: null });
  const newId = () => crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const emptySnapshot = (period) => ({ period, generatedAt: '', dataAvailable: false, warnings: [],
    core: { gmv: emptyMetric(), orders: emptyMetric(), aov: emptyMetric(), adsCostPerOrder: emptyMetric() },
    operations: { cancellationRate: emptyMetric(), returnRate: emptyMetric(), fastShippingRate: emptyMetric(), quickResponseRate: emptyMetric() },
    funnel: { impressions: emptyMetric(), clicks: emptyMetric(), skuOrders: emptyMetric(), ctr: emptyMetric(), ctor: emptyMetric() },
    finance: { feeTax: 0, affiliate: 0, ads: 0, refunds: 0, grossProfit: 0, gmv: 0, totalCostRate: null }, sources: [], products: [] });

  function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char])); }
  function repairText(value) {
    const text = String(value ?? '');
    if (!/[ÃÂÐÄÆÅ]/.test(text)) return text;
    try { return new TextDecoder('utf-8').decode(Uint8Array.from([...text].map((char) => char.charCodeAt(0)))); } catch { return text; }
  }
  function formatNumber(value, digits = 0) { if (value === null || value === undefined || Number.isNaN(Number(value))) return 'Chưa có'; return new Intl.NumberFormat('vi-VN', { maximumFractionDigits: digits }).format(Number(value)); }
  function formatMoney(value) {
    if (value === null || value === undefined || Number.isNaN(Number(value))) return 'Chưa có';
    const amount = Number(value);
    const abs = Math.abs(amount);
    if (abs >= 1_000_000_000) return `${formatNumber(amount / 1_000_000_000, 2)}B`;
    if (abs >= 1_000_000) return `${formatNumber(amount / 1_000_000, 2)}M`;
    if (abs >= 1_000) return `${formatNumber(amount / 1_000, 2)}K`;
    return `${formatNumber(amount)}đ`;
  }
  function formatMoneyFull(value) {
    if (value === null || value === undefined || Number.isNaN(Number(value))) return 'Chưa có';
    return `${new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(Number(value))}đ`;
  }
  function formatPercent(value) { return value === null || value === undefined ? 'Chưa có' : `${formatNumber(value, 2)}%`; }
  function formatDate(value) { if (!value) return ''; const [year, month, day] = value.split('-'); return `${day}/${month}/${year}`; }
  function formatChange(value) { return value === null || value === undefined ? 'Không có dữ liệu kỳ trước' : `${value >= 0 ? '▲' : '▼'} ${formatNumber(Math.abs(value) * 100, 2)}%`; }
  function trendClass(value) { return value === null || value === undefined ? 'trend-flat' : value >= 0 ? 'trend-up' : 'trend-down'; }
  function valueForMetric(metric, kind) { const value = metric?.value; if (kind === 'money') return formatMoney(value); if (kind === 'percent') return formatPercent(value); return formatNumber(value); }
  function periodLabel(period) { return period ? period.title : 'Đang tải kỳ báo cáo...'; }
  function isoWeekInfo(dateString) {
    const date = new Date(`${dateString}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
    const year = date.getUTCFullYear();
    const yearStart = new Date(Date.UTC(year, 0, 1));
    return { week: Math.ceil((((date - yearStart) / 86400000) + 1) / 7), year };
  }
  function weekAnchorFromRoute(week, year) {
    const januaryFourth = new Date(Date.UTC(year, 0, 4));
    const weekOneMonday = new Date(januaryFourth);
    weekOneMonday.setUTCDate(januaryFourth.getUTCDate() - ((januaryFourth.getUTCDay() + 6) % 7));
    const friday = new Date(weekOneMonday);
    friday.setUTCDate(weekOneMonday.getUTCDate() + ((week - 1) * 7) + 4);
    const info = isoWeekInfo(friday.toISOString().slice(0, 10));
    if (info.week !== week || info.year !== year) return null;
    const anchor = new Date(friday); anchor.setUTCDate(friday.getUTCDate() + 1);
    return anchor.toISOString().slice(0, 10);
  }
  function periodFromPath() {
    const match = window.location.pathname.match(/^\/tuan-(\d{1,2})-(\d{4})\/?$/);
    if (!match) return null;
    const week = Number(match[1]); const year = Number(match[2]);
    const anchorDate = week >= 1 && week <= 53 ? weekAnchorFromRoute(week, year) : null;
    return anchorDate ? { kind: 'week', anchorDate } : null;
  }
  function syncPeriodPath(period, replace = false) {
    const info = period?.kind === 'week' ? isoWeekInfo(period.endDate) : null;
    const path = info ? `/tuan-${info.week}-${info.year}` : '/';
    if (window.location.pathname === path) return;
    window.history[replace ? 'replaceState' : 'pushState']({}, '', path);
  }
  function makePeriod(kind, anchorDate) {
    const [year, month, day] = String(anchorDate).split('-').map(Number);
    const anchor = new Date(Date.UTC(year, month - 1, day));
    if (kind === 'week') {
      const start = new Date(anchor); start.setUTCDate(start.getUTCDate() - 7);
      const end = new Date(anchor); end.setUTCDate(end.getUTCDate() - 1);
      const iso = (date) => date.toISOString().slice(0, 10);
      const endDate = iso(end); const { week } = isoWeekInfo(endDate);
      return { kind, anchorDate, startDate: iso(start), endDate, title: `Tuần ${week} ∙ ${formatDate(iso(start))} - ${formatDate(endDate)}` };
    }
    const end = new Date(Date.UTC(year, month - 1, 0));
    const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1));
    const iso = (date) => date.toISOString().slice(0, 10);
    return { kind, anchorDate: `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-01`, startDate: iso(start), endDate: iso(end), title: `Tháng ${String(start.getUTCMonth() + 1).padStart(2, '0')}/${start.getUTCFullYear()}` };
  }
  function periodAnchors(kind) {
    const base = window.__periods?.[kind]?.anchorDate || state.anchorDate;
    if (!base) return [];
    const values = [];
    if (kind === 'week') {
      const date = new Date(`${base}T00:00:00Z`);
      for (let index = 0; index < 53; index += 1) { const current = new Date(date); current.setUTCDate(date.getUTCDate() - index * 7); values.push(current.toISOString().slice(0, 10)); }
    } else {
      const date = new Date(`${base.slice(0, 7)}-01T00:00:00Z`);
      for (let index = 0; index < 18; index += 1) { const current = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - index, 1)); values.push(current.toISOString().slice(0, 10)); }
    }
    return values;
  }

  async function api(path, options = {}) {
    const response = await fetch(path, { headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }, ...options });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body.ok !== true) throw new Error(body.error || (response.ok ? 'Máy chủ trả dữ liệu không hợp lệ.' : `Yêu cầu thất bại (${response.status}).`));
    return body.data;
  }

  function setNotice(message, success = false) { const node = $('#notice'); node.textContent = message || ''; node.hidden = !message; node.classList.toggle('is-success', success); }
  function setSync(text, mode = '') { const node = $('#syncState'); node.lastChild.textContent = ` ${text}`; node.classList.remove('is-ready', 'is-loading'); if (mode) node.classList.add(`is-${mode}`); }
  function setBusy(busy) { document.body.classList.toggle('is-loading', busy); $('#refreshButton').disabled = busy; $('#saveButton').disabled = busy; const apply = $('#applySettingsButton'); if (apply) apply.disabled = busy; }

  function renderMetricCard(label, metric, kind, operation = false) {
    return `<article class="metric-card${operation ? ' operation' : ''}"><span class="metric-label">${escapeHtml(label)}</span><strong class="metric-value">${valueForMetric(metric, kind)}</strong><span class="metric-trend ${trendClass(metric?.change)}">${escapeHtml(formatChange(metric?.change))}</span></article>`;
  }

  function renderMetrics() {
    const snapshot = state.snapshot || emptySnapshot(state.period);
    $('#coreMetrics').innerHTML = [
      renderMetricCard('Tổng GMV', snapshot.core.gmv, 'money'), renderMetricCard('Tổng đơn hàng', snapshot.core.orders),
      renderMetricCard('AOV (giá trị / đơn)', snapshot.core.aov, 'money'), renderMetricCard('Chi phí Ads / đơn', snapshot.core.adsCostPerOrder, 'money')
    ].join('');
    $('#operationMetrics').innerHTML = [
      renderMetricCard('Tỷ lệ hủy đơn', snapshot.operations.cancellationRate, 'percent', true), renderMetricCard('Tỷ lệ trả hàng / hoàn tiền', snapshot.operations.returnRate, 'percent', true),
      renderMetricCard('Tỷ lệ gửi hàng nhanh', snapshot.operations.fastShippingRate, 'percent', true), renderMetricCard('Tỷ lệ phản hồi', snapshot.operations.quickResponseRate, 'percent', true)
    ].join('');
  }

  function renderFunnel() {
    const funnel = state.snapshot?.funnel || emptySnapshot(state.period).funnel;
    const rows = [
      { rate: '', label: 'Lượt hiển thị sản phẩm', metric: funnel.impressions },
      { rate: 'CTR', rateMetric: funnel.ctr, label: 'Lượt nhấp vào sản phẩm', metric: funnel.clicks },
      { rate: 'CTOR', rateMetric: funnel.ctor, label: 'Đơn hàng SKU', metric: funnel.skuOrders }
    ];
    $('#funnel').innerHTML = rows.map((item, index) => {
      const rate = item.rate ? `<span>${item.rate}</span><strong>${formatPercent(item.rateMetric?.value)}</strong><small class="${trendClass(item.rateMetric?.change)}">${escapeHtml(formatChange(item.rateMetric?.change))}</small>` : '';
      const arrow = item.rate ? '<svg class="product-funnel-arrow-svg" viewBox="0 0 56 66" aria-hidden="true"><path d="M5 2 L18 50 L49 50 M43 44 L49 50 L43 56"></path></svg>' : '';
      return `<div class="product-funnel-rate">${rate}</div><div class="product-funnel-arrow-slot${item.rate === 'CTOR' ? ' ctor' : ''}">${arrow}</div><div class="product-funnel-step product-funnel-step-${index + 1}"><span>${item.label}</span><div class="product-funnel-value"><strong>${valueForMetric(item.metric, 'number')}</strong><small class="${trendClass(item.metric?.change)}">${escapeHtml(formatChange(item.metric?.change))}</small></div></div>`;
    }).join('');
  }

  function renderFinance() {
    const finance = state.snapshot?.finance || emptySnapshot(state.period).finance;
    const items = [['Tổng phí & thuế', finance.feeTax], ['Hoa hồng KOC / Affiliate', finance.affiliate], ['Chi phí Ads', finance.ads], ['Hoàn tiền', finance.refunds], ['Còn lại (Lợi nhuận gộp ước tính)', finance.grossProfit]];
    const total = items.reduce((sum, item) => sum + Math.max(0, Number(item[1]) || 0), 0) || 1;
    const donut = $('#financeDonut');
    const radius = 72;
    const circumference = 2 * Math.PI * radius;
    let offset = 0;
    const segments = items.map(([label, value], index) => {
      const amount = Math.max(0, Number(value) || 0);
      const share = amount / total * 100;
      const dash = circumference * share / 100;
      const displayLabel = repairText(label);
      const detail = `${formatMoneyFull(value)} (${formatPercent(share)} cơ cấu)`;
      const segment = `<circle class="finance-segment" data-finance-index="${index}" cx="100" cy="100" r="${radius}" stroke="${colors[index] || '#22c55e'}" stroke-dasharray="${dash} ${Math.max(0, circumference - dash)}" stroke-dashoffset="${-offset}" tabindex="0"><title>${escapeHtml(displayLabel)}: ${escapeHtml(detail)}</title></circle>`;
      offset += dash;
      return segment;
    }).join('');
    donut.innerHTML = `<svg class="donut-svg" viewBox="0 0 200 200" role="img" aria-label="Cơ cấu chi phí">${segments}</svg><div class="finance-tooltip" hidden></div>`;
    const legend = $('#financeLegend');
    if (legend) legend.innerHTML = items.map(([label], index) => `<div class="legend-row"><span class="legend-swatch" style="background:${colors[index] || '#22c55e'}"></span><span>${escapeHtml(repairText(label))}</span></div>`).join('');
    const tooltip = donut.querySelector('.finance-tooltip');
    const showTooltip = (event, index) => {
      const [label, value] = items[index];
      const amount = Math.max(0, Number(value) || 0);
      const share = amount / total * 100;
      tooltip.innerHTML = `<strong>${escapeHtml(repairText(label))}</strong><span>${escapeHtml(formatMoneyFull(value))} · ${escapeHtml(formatPercent(share))}</span>`;
      tooltip.hidden = false;
      if (event?.clientX !== undefined) {
        const rect = donut.getBoundingClientRect();
        const x = Math.max(12, Math.min(rect.width - 12, event.clientX - rect.left));
        const y = Math.max(12, event.clientY - rect.top - 10);
        tooltip.style.left = `${x}px`; tooltip.style.top = `${y}px`;
      }
    };
    const hideTooltip = () => { tooltip.hidden = true; };
    donut.querySelectorAll('.finance-segment').forEach((segment) => {
      const index = Number(segment.dataset.financeIndex);
      segment.addEventListener('mouseenter', (event) => showTooltip(event, index));
      segment.addEventListener('mousemove', (event) => showTooltip(event, index));
      segment.addEventListener('mouseleave', hideTooltip);
      segment.addEventListener('focus', () => showTooltip(null, index));
      segment.addEventListener('blur', hideTooltip);
    });
  }

  function changeMarkup(value) { return `<small class="change-note ${trendClass(value)}">${escapeHtml(formatChange(value))}</small>`; }
  function renderSources() {
    const rows = state.snapshot?.sources || [];
    $('#sourcesTable').innerHTML = rows.length ? rows.map((row) => `<tr><td class="table-primary">${escapeHtml(repairText(row.label))}</td><td>${formatMoney(row.gmv)}${changeMarkup(row.change?.gmv)}</td><td>${formatPercent(row.contribution * 100)}${changeMarkup(row.change?.contribution)}</td><td>${formatNumber(row.impressions)}${changeMarkup(row.change?.impressions)}</td><td>${formatNumber(row.clicks)}${changeMarkup(row.change?.clicks)}</td><td>${formatPercent(row.ctr === null ? null : row.ctr * 100)}${changeMarkup(row.change?.ctr)}</td><td>${formatPercent(row.ctor === null ? null : row.ctor * 100)}${changeMarkup(row.change?.ctor)}</td></tr>`).join('') : `<tr><td colspan="7"><div class="empty-state">Chưa có dữ liệu nguồn trong kỳ này.</div></td></tr>`;
  }
  function renderProducts() {
    const rows = state.snapshot?.products || [];
    $('#productsTable').innerHTML = rows.length ? rows.map((row) => `<tr><td><div class="product-cell">${row.imageUrl ? `<img src="${escapeHtml(row.imageUrl)}" alt="">` : '<span class="product-placeholder">SP</span>'}<span><strong class="table-primary">${escapeHtml(repairText(row.title))}</strong><small class="table-secondary">ID: ${escapeHtml(row.id)}</small></span></div></td><td>${formatMoney(row.gmv)}${changeMarkup(row.change?.gmv)}</td><td>${formatNumber(row.orders)}${changeMarkup(row.change?.orders)}</td><td>${formatNumber(row.impressions)}${changeMarkup(row.change?.impressions)}</td><td>${formatNumber(row.clicks)}${changeMarkup(row.change?.clicks)}</td><td>${formatPercent(row.ctr === null ? null : row.ctr * 100)}${changeMarkup(row.change?.ctr)}</td><td>${formatPercent(row.ctor === null ? null : row.ctor * 100)}${changeMarkup(row.change?.ctor)}</td></tr>`).join('') : `<tr><td colspan="7"><div class="empty-state">Chưa có dữ liệu sản phẩm trong kỳ này.</div></td></tr>`;
  }

  function inputCell(value, field, id, area = false) { return area ? `<textarea data-field="${field}" data-id="${id}" rows="2">${escapeHtml(value)}</textarea>` : `<input data-field="${field}" data-id="${id}" value="${escapeHtml(value)}">`; }
  function renderReview() {
    const rows = state.review || [];
    $('#reviewTable').innerHTML = `<div class="edit-grid review-work"><div class="edit-head">STT</div><div class="edit-head">Công việc</div><div class="edit-head">Phụ trách</div><div class="edit-head">Deadline</div><div class="edit-head">Trạng thái</div><div class="edit-head">Đánh giá kết quả</div>${rows.map((row, index) => `<div class="edit-cell row-number">${index + 1}</div><div class="edit-cell"><span class="readonly-value"><strong>${escapeHtml(row.title)}</strong>${row.detail ? `\n${escapeHtml(row.detail)}` : ''}${row.kpi ? `\nKPI: ${escapeHtml(row.kpi)}` : ''}</span></div><div class="edit-cell"><span class="readonly-value">${escapeHtml(row.owner)}</span></div><div class="edit-cell"><span class="readonly-value">${escapeHtml(row.deadline)}</span></div><div class="edit-cell"><select data-previous-field="status" data-id="${escapeHtml(row.id)}"><option value="">Chọn trạng thái</option>${['Đạt', 'Chưa đạt', 'Trễ hạn'].map((value) => `<option value="${value}"${row.status === value ? ' selected' : ''}>${value}</option>`).join('')}</select><div class="save-state" data-save-state="${escapeHtml(row.id)}"></div></div><div class="edit-cell"><textarea data-previous-field="result" data-id="${escapeHtml(row.id)}" rows="2" placeholder="Nhập kết quả thực tế">${escapeHtml(row.result || '')}</textarea></div>`).join('')}</div>`;
    if (!rows.length) $('#reviewTable').innerHTML = '<div class="empty-state">Chưa có công việc kỳ trước</div>';
  }
  function renderEvaluations() {
    const rows = state.evaluations || [];
    $('#evaluationTable').innerHTML = `<div class="edit-grid"><div class="edit-head">STT</div><div class="edit-head">Chỉ số / Phân khúc</div><div class="edit-head">Thực trạng kỳ này</div><div class="edit-head">Nguyên nhân chính</div><div class="edit-head">Hành động tối ưu kỳ sau</div>${rows.map((row, index) => `<div class="edit-cell row-number">${index + 1}</div>${['segment', 'situation', 'cause', 'action'].map((field) => `<div class="edit-cell"><span class="readonly-value">${escapeHtml(row[field])}</span></div>`).join('')}`).join('')}</div>`;
    if (!rows.length) $('#evaluationTable').innerHTML = '<div class="empty-state">Chưa có đánh giá. Thêm nội dung sau khi xem số liệu.</div>';
  }
  function renderWork() {
    const rows = state.workItems || [];
    $('#workTable').innerHTML = `<div class="edit-grid work"><div class="edit-head">STT</div><div class="edit-head">Công việc</div><div class="edit-head">Chi tiết hành động</div><div class="edit-head">Mục tiêu KPI</div><div class="edit-head">Phụ trách</div><div class="edit-head">Deadline</div><div class="edit-head"></div>${rows.map((row, index) => `<div class="edit-cell row-number">${index + 1}</div>${['title', 'detail', 'kpi', 'owner', 'deadline'].map((field) => `<div class="edit-cell"><span class="readonly-value">${escapeHtml(row[field])}</span></div>`).join('')}<div class="edit-cell"></div>`).join('')}</div>`;
    if (!rows.length) $('#workTable').innerHTML = '<div class="empty-state">Chưa có công việc. Thêm một dòng để bắt đầu kế hoạch.</div>';
  }
  function renderPopupEvaluations() {
    const rows = state.settingsDraft?.evaluations || [];
    $('#popupEvaluationTable').innerHTML = rows.length ? `<div class="edit-grid"><div class="edit-head">STT</div><div class="edit-head">Chỉ số / Phân khúc</div><div class="edit-head">Thực trạng</div><div class="edit-head">Nguyên nhân</div><div class="edit-head">Hành động</div>${rows.map((row, index) => `<div class="edit-cell row-number">${index + 1}<button class="delete-row" data-delete-evaluation="${row.id}" type="button" aria-label="Xóa dòng">×</button></div><div class="edit-cell">${inputCell(row.segment, 'segment', row.id, true)}</div><div class="edit-cell">${inputCell(row.situation, 'situation', row.id, true)}</div><div class="edit-cell">${inputCell(row.cause, 'cause', row.id, true)}</div><div class="edit-cell">${inputCell(row.action, 'action', row.id, true)}</div>`).join('')}</div>` : '<div class="empty-state">Chưa có dòng đánh giá.</div>';
    bindPopupEditors();
  }
  function renderPopupWork() {
    const rows = state.settingsDraft?.workItems || [];
    $('#popupWorkTable').innerHTML = rows.length ? `<div class="edit-grid work"><div class="edit-head">STT</div><div class="edit-head">Công việc</div><div class="edit-head">Chi tiết hành động</div><div class="edit-head">Mục tiêu KPI</div><div class="edit-head">Phụ trách</div><div class="edit-head">Deadline</div><div class="edit-head"></div>${rows.map((row, index) => `<div class="edit-cell row-number">${index + 1}</div><div class="edit-cell">${inputCell(row.title, 'title', row.id, true)}</div><div class="edit-cell">${inputCell(row.detail, 'detail', row.id, true)}</div><div class="edit-cell">${inputCell(row.kpi, 'kpi', row.id, true)}</div><div class="edit-cell">${inputCell(row.owner, 'owner', row.id)}</div><div class="edit-cell"><input type="date" data-field="deadline" data-id="${row.id}" value="${escapeHtml(row.deadline)}"></div><div class="edit-cell"><button class="delete-row" data-delete-work="${row.id}" type="button" aria-label="Xóa công việc">×</button></div>`).join('')}</div>` : '<div class="empty-state">Chưa có công việc cho kỳ này.</div>';
    bindPopupEditors();
  }
  function renderPeriodPicker() {
    const label = $('#periodPickerLabel');
    if (label) label.textContent = state.period ? `${state.period.title}` : 'Đang tải kỳ báo cáo...';
    const popover = $('#periodPopover');
    if (!popover) return;
    const kind = state.kind;
    const options = periodAnchors(kind).map((anchor, index) => {
      const period = makePeriod(kind, anchor);
      const isSelected = anchor === state.anchorDate && kind === state.kind;
      const isCurrent = index === 0;
      return `<button class="period-option${isSelected ? ' is-selected' : ''}" type="button" data-period-kind="${kind}" data-period-anchor="${anchor}"><strong>${isCurrent ? `${kind === 'week' ? 'Tuần hiện tại' : 'Tháng hiện tại'} · ` : ''}${escapeHtml(period.title)}</strong><small>${isCurrent ? 'So sánh cùng kỳ trước' : `Bắt đầu ${kind === 'week' ? 'Thứ 7' : 'ngày 1'}`}</small></button>`;
    }).join('');
    popover.innerHTML = `<div class="period-tabs"><button class="period-tab${kind === 'week' ? ' is-active' : ''}" type="button" data-period-tab="week">Tuần trong năm</button><button class="period-tab${kind === 'month' ? ' is-active' : ''}" type="button" data-period-tab="month">Tháng trong năm</button></div><div class="period-options">${options || '<div class="empty-state">Chưa có kỳ báo cáo.</div>'}</div>`;
    popover.querySelectorAll('[data-period-tab]').forEach((button) => button.addEventListener('click', () => { state.kind = button.dataset.periodTab; renderPeriodPicker(); }));
    popover.querySelectorAll('[data-period-anchor]').forEach((button) => button.addEventListener('click', () => selectPeriod(button.dataset.periodKind, button.dataset.periodAnchor)));
  }
  function togglePeriodPicker(force) {
    const popover = $('#periodPopover');
    const button = $('#periodPickerButton');
    if (!popover || !button) return;
    const open = typeof force === 'boolean' ? force : popover.hidden;
    if (open) renderPeriodPicker();
    popover.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
  }
  function selectPeriod(kind, anchorDate, updatePath = true) {
    state.kind = kind; state.anchorDate = anchorDate; state.period = makePeriod(kind, anchorDate); state.snapshot = emptySnapshot(state.period); state.id = ''; state.review = []; state.evaluations = []; state.workItems = [];
    if (updatePath) syncPeriodPath(state.period);
    togglePeriodPicker(false); renderAll(); bindEditors(); loadSource();
  }
  function renderAll() {
    $('#pageTitle').textContent = state.kind === 'week' ? 'Báo cáo tuần' : 'Báo cáo tháng';
    $('#periodLine').textContent = periodLabel(state.period);
    renderPeriodPicker(); renderMetrics(); renderFunnel(); renderFinance(); renderSources(); renderProducts(); renderReview(); renderEvaluations(); renderWork();
  }

  function syncEditableRows(root, collection) {
    root.querySelectorAll('[data-field]').forEach((input) => input.addEventListener('input', () => {
      const item = collection.find((row) => row.id === input.dataset.id); if (item) item[input.dataset.field] = input.value;
    }));
  }
  function bindPopupEditors() {
    if (!state.settingsDraft) return;
    syncEditableRows($('#popupEvaluationTable'), state.settingsDraft.evaluations);
    syncEditableRows($('#popupWorkTable'), state.settingsDraft.workItems);
  }
  function bindEditors() {
    $('#reviewTable').querySelectorAll('[data-previous-field]').forEach((input) => input.addEventListener('change', async () => {
      const item = state.review.find((row) => row.id === input.dataset.id);
      if (!item || state.kind !== 'week') return;
      item[input.dataset.previousField] = input.value;
      const status = $(`[data-save-state="${CSS.escape(item.id)}"]`);
      if (status) status.textContent = 'Đang lưu...';
      try {
        await api('/api/previous-work-item', { method: 'PATCH', body: JSON.stringify({ currentWeekStartDate: state.period.startDate, taskId: item.id, [input.dataset.previousField]: input.value }) });
        if (status) status.textContent = 'Đã lưu';
      } catch (error) {
        if (status) status.textContent = error.message || 'Lưu thất bại';
      }
    }));
  }
  function updatePeriodPreview() { const kind = document.querySelector('input[name="reportKind"]:checked')?.value || state.kind; const period = window.__periods?.[kind]; const anchor = $('#anchorDate').value; if (!anchor) return; const [year, month, day] = anchor.split('-').map(Number); const date = new Date(Date.UTC(year, month - 1, day)); let start; let end; if (kind === 'week') { start = new Date(date); start.setUTCDate(start.getUTCDate() - 7); end = new Date(date); end.setUTCDate(end.getUTCDate() - 1); } else { end = new Date(Date.UTC(year, month, 0)); start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1)); } const f = (d) => `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`; $('#periodPreview').textContent = kind === 'week' ? `Kỳ báo cáo: ${f(start)} - ${f(end)}` : `Kỳ báo cáo: tháng ${String(start.getUTCMonth() + 1).padStart(2, '0')}/${start.getUTCFullYear()}`; $('#anchorHelp').textContent = kind === 'week' ? 'Chọn thứ 7 làm mốc chốt tuần.' : 'Chọn ngày 1 của tháng cần xem.'; }

  async function loadSource(forceRefresh = false) {
    if (!state.period) return;
    setBusy(true); setSync('Đang lấy số liệu', 'loading'); setNotice('');
    try {
      let snapshot;
      let lastError;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try { snapshot = await api('/api/source-report', { method: 'POST', body: JSON.stringify({ kind: state.kind, anchorDate: state.anchorDate, forceRefresh }) }); break; }
        catch (error) { lastError = error; if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 650)); }
      }
      if (!snapshot) throw lastError || new Error('Không thể lấy số liệu.');
      snapshot.period = state.period;
      state.snapshot = snapshot;
      state.id = snapshot.id || '';
      state.review = snapshot.previousWorkItems || [];
      state.evaluations = snapshot.evaluations || [];
      state.workItems = snapshot.workItems || [];
      renderAll(); bindEditors(); setSync('Đã đồng bộ', 'ready'); setNotice('');
    }
    catch (error) { setSync('Chưa đồng bộ'); setNotice(error.message || 'Không thể lấy số liệu.'); }
    finally { setBusy(false); }
  }
  async function saveCurrent() {
    if (!state.snapshot?.dataAvailable) { setNotice('Hãy lấy số liệu trước khi lưu báo cáo.'); return; }
    setBusy(true); setNotice('');
    try {
      const payload = { snapshot: state.snapshot, review: [], evaluations: state.evaluations, workItems: state.workItems };
      console.log('Saving for week:', state.period.startDate, payload);
      const saved = await api('/api/reports', { method: 'POST', body: JSON.stringify(payload) });
      state.id = saved.id; state.review = saved.previousWorkItems || []; state.evaluations = saved.evaluations || []; state.workItems = saved.workItems || [];
      setSync('Đã lưu Supabase', 'ready'); setNotice('Báo cáo và các công việc đã được lưu. Bạn có thể mở lại từ kho lưu trữ.', true); await loadHistory(state.historyKind);
    }
    catch (error) { setNotice(error.message || 'Không thể lưu báo cáo.'); }
    finally { setBusy(false); }
  }
  function loadRecord(record) { state.id = record.id; state.kind = record.period.kind; state.anchorDate = record.period.anchorDate; state.period = makePeriod(record.period.kind, record.period.anchorDate); record.period = state.period; state.snapshot = record; state.review = record.previousWorkItems || []; state.evaluations = record.evaluations || []; state.workItems = record.workItems || []; syncPeriodPath(state.period); renderAll(); bindEditors(); closeHistory(); setSync('Đã mở báo cáo lưu', 'ready'); setNotice(`Đang xem ${state.period.title}.`, true); }
  async function loadHistory(kind = state.historyKind) { state.historyKind = kind; const list = $('#historyList'); list.innerHTML = '<div class="empty-state">Đang tải...</div>'; try { const rows = await api(`/api/reports?kind=${encodeURIComponent(kind)}`); list.innerHTML = rows.length ? rows.map((row) => { const displayPeriod = makePeriod(row.period.kind, row.period.anchorDate); return `<button class="history-item" data-report-id="${escapeHtml(row.id)}" type="button"><strong>${escapeHtml(displayPeriod.title)}</strong><small>${formatDate(displayPeriod.startDate)} - ${formatDate(displayPeriod.endDate)} · Cập nhật ${formatDate(row.updatedAt?.slice(0, 10))}</small></button>`; }).join('') : '<div class="empty-state">Chưa có báo cáo đã lưu.</div>'; list.querySelectorAll('[data-report-id]').forEach((button) => button.addEventListener('click', async () => { try { loadRecord(await api(`/api/reports/${encodeURIComponent(button.dataset.reportId)}`)); } catch (error) { setNotice(error.message); } })); } catch (error) { list.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`; } }
  function openHistory() { $('#overlay').hidden = false; $('#historyDrawer').classList.add('is-open'); $('#historyDrawer').setAttribute('aria-hidden', 'false'); loadHistory(state.historyKind); }
  function closeHistory() { $('#overlay').hidden = true; $('#historyDrawer').classList.remove('is-open'); $('#historyDrawer').setAttribute('aria-hidden', 'true'); }
  function popupPeriod() {
    const kind = document.querySelector('input[name="reportKind"]:checked')?.value || state.kind;
    const anchorDate = $('#anchorDate').value;
    return anchorDate ? makePeriod(kind, anchorDate) : null;
  }
  function syncDraftRates() {
    if (!state.settingsDraft) return;
    const read = (selector) => $(selector).value === '' ? null : Number($(selector).value);
    state.settingsDraft.shippingSpeedRate = read('#fastShippingRateInput');
    state.settingsDraft.responseRate = read('#quickResponseRateInput');
  }
  async function loadSettingsDraft() {
    const period = popupPeriod();
    if (!period) return;
    const token = newId();
    state.settingsDraft = { token, period, shippingSpeedRate: null, responseRate: null, evaluations: [], workItems: [], loading: true };
    $('#fastShippingRateInput').value = '';
    $('#quickResponseRateInput').value = '';
    $('#popupEvaluationTable').innerHTML = '<div class="empty-state">Đang tải dữ liệu kỳ đã chọn...</div>';
    $('#popupWorkTable').innerHTML = '<div class="empty-state">Đang tải dữ liệu kỳ đã chọn...</div>';
    try {
      const context = await api(`/api/manual-context?kind=${encodeURIComponent(period.kind)}&periodStart=${encodeURIComponent(period.startDate)}`);
      if (state.settingsDraft?.token !== token) return;
      state.settingsDraft = { token, period, shippingSpeedRate: context.shippingSpeedRate, responseRate: context.responseRate, evaluations: context.evaluations || [], workItems: context.workItems || [], loading: false };
      $('#fastShippingRateInput').value = context.shippingSpeedRate ?? '';
      $('#quickResponseRateInput').value = context.responseRate ?? '';
      renderPopupEvaluations(); renderPopupWork();
    } catch (error) {
      if (state.settingsDraft?.token !== token) return;
      state.settingsDraft.loading = false;
      $('#popupEvaluationTable').innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
      $('#popupWorkTable').innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
    }
  }
  async function openSettings() {
    const dialog = $('#settingsDialog');
    document.querySelector(`input[name="reportKind"][value="${state.kind}"]`).checked = true;
    $('#anchorDate').value = state.anchorDate;
    updatePeriodPreview(); dialog.showModal();
    await loadSettingsDraft();
  }
  function applyManualRate(metric, value) {
    if (value === null || !Number.isFinite(value)) return { ...metric, value: null, change: null };
    const previous = metric?.previous;
    return { ...metric, value, change: previous !== null && previous !== undefined && previous !== 0 ? (value - previous) / Math.abs(previous) : null };
  }
  async function applySettings(event) {
    event.preventDefault();
    syncDraftRates();
    const draft = state.settingsDraft;
    if (!draft || draft.loading) return;
    setBusy(true); setNotice('');
    try {
      const source = await api('/api/source-report', { method: 'POST', body: JSON.stringify({ kind: draft.period.kind, anchorDate: draft.period.anchorDate }) });
      source.period = draft.period;
      source.operations.fastShippingRate = applyManualRate(source.operations.fastShippingRate, draft.shippingSpeedRate);
      source.operations.quickResponseRate = applyManualRate(source.operations.quickResponseRate, draft.responseRate);
      const payload = { snapshot: source, review: [], evaluations: draft.evaluations, workItems: draft.workItems };
      console.log('Saving for week:', draft.period.startDate, payload);
      const saved = await api('/api/reports', { method: 'POST', body: JSON.stringify(payload) });
      state.kind = draft.period.kind; state.anchorDate = draft.period.anchorDate; state.period = draft.period;
      saved.period = draft.period; state.snapshot = saved; state.id = saved.id; state.review = saved.previousWorkItems || []; state.evaluations = saved.evaluations || []; state.workItems = saved.workItems || [];
      syncPeriodPath(state.period); $('#settingsDialog').close(); renderAll(); bindEditors(); setSync('Đã lưu Supabase', 'ready'); setNotice('Đã lưu toàn bộ dữ liệu nhập tay cho đúng kỳ báo cáo.', true); await loadHistory(state.historyKind);
    } catch (error) { setNotice(error.message || 'Không thể lưu dữ liệu nhập tay.'); }
    finally { setBusy(false); }
  }
  function addEvaluation() {
    if (!state.settingsDraft) return;
    state.settingsDraft.evaluations.push({ id: newId(), segment: '', situation: '', cause: '', action: '' }); renderPopupEvaluations();
  }
  function addWork() {
    if (!state.settingsDraft) return;
    state.settingsDraft.workItems.push({ id: newId(), title: '', detail: '', kpi: '', owner: '', deadline: '', status: '', result: '' }); renderPopupWork();
  }
  function wire() {
    $('#historyButton').addEventListener('click', openHistory); $('#closeHistoryButton').addEventListener('click', closeHistory); $('#overlay').addEventListener('click', closeHistory); $('#refreshButton').addEventListener('click', () => loadSource(true)); $('#saveButton').addEventListener('click', () => $('#settingsForm').requestSubmit()); $('#addEvaluationButton').addEventListener('click', addEvaluation); $('#addWorkButton').addEventListener('click', addWork); $('#settingsForm').addEventListener('submit', applySettings); $('#anchorDate').addEventListener('change', () => { updatePeriodPreview(); loadSettingsDraft(); }); $('#periodPickerButton').addEventListener('click', () => togglePeriodPicker());
    document.querySelectorAll('input[name="reportKind"]').forEach((input) => input.addEventListener('change', () => { updatePeriodPreview(); loadSettingsDraft(); }));
    ['#fastShippingRateInput', '#quickResponseRateInput'].forEach((selector) => $(selector).addEventListener('input', syncDraftRates));
    document.querySelectorAll('[data-history-kind]').forEach((tab) => tab.addEventListener('click', () => { document.querySelectorAll('[data-history-kind]').forEach((item) => item.classList.toggle('is-active', item === tab)); loadHistory(tab.dataset.historyKind); }));
    document.addEventListener('click', (event) => { if (!event.target.closest('.period-toolbar')) togglePeriodPicker(false); });
    window.addEventListener('popstate', () => { const route = periodFromPath(); if (route) selectPeriod(route.kind, route.anchorDate, false); });
    $('#popupEvaluationTable').addEventListener('click', (event) => { const button = event.target.closest('[data-delete-evaluation]'); if (!button || !state.settingsDraft) return; state.settingsDraft.evaluations = state.settingsDraft.evaluations.filter((row) => row.id !== button.dataset.deleteEvaluation); renderPopupEvaluations(); });
    $('#popupWorkTable').addEventListener('click', (event) => { const button = event.target.closest('[data-delete-work]'); if (!button || !state.settingsDraft) return; state.settingsDraft.workItems = state.settingsDraft.workItems.filter((row) => row.id !== button.dataset.deleteWork); renderPopupWork(); });
    document.addEventListener('keydown', (event) => { if (event.key.toLowerCase() === 'i' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) { event.preventDefault(); openSettings(); } if (event.key === 'Escape') { closeHistory(); togglePeriodPicker(false); } });
  }

  async function init() {
    wire();
    try { const defaults = await api('/api/default-periods'); window.__periods = defaults; const route = periodFromPath(); state.kind = route?.kind || 'week'; state.anchorDate = route?.anchorDate || defaults.week.anchorDate; state.period = makePeriod(state.kind, state.anchorDate); syncPeriodPath(state.period, true); state.snapshot = emptySnapshot(state.period); renderAll(); bindEditors(); await loadHistory('week'); await loadSource(); }
    catch (error) { setNotice(error.message || 'Không thể khởi tạo báo cáo.'); renderAll(); }
  }
  init();
})();
