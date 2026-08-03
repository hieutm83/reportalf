(() => {
  const $ = (selector) => document.querySelector(selector);
  const state = { kind: 'week', anchorDate: '', period: null, snapshot: null, id: '', review: [], evaluations: [], workItems: [], historyKind: 'week' };
  const colors = ['#2f6df6', '#4ea9a1', '#e5a943', '#d98695'];

  const emptyMetric = () => ({ value: null, previous: null, change: null });
  const emptySnapshot = (period) => ({ period, generatedAt: '', dataAvailable: false, warnings: [],
    core: { gmv: emptyMetric(), orders: emptyMetric(), aov: emptyMetric(), adsCostPerOrder: emptyMetric() },
    operations: { cancellationRate: emptyMetric(), returnRate: emptyMetric(), fastShippingRate: emptyMetric(), quickResponseRate: emptyMetric() },
    funnel: { impressions: emptyMetric(), clicks: emptyMetric(), skuOrders: emptyMetric(), ctr: emptyMetric(), ctor: emptyMetric() },
    finance: { feeTax: 0, affiliate: 0, ads: 0, refunds: 0, grossProfit: 0, gmv: 0, totalCostRate: null }, sources: [], products: [] });

  function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char])); }
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
  function formatPercent(value) { return value === null || value === undefined ? 'Chưa có' : `${formatNumber(value, 2)}%`; }
  function formatDate(value) { if (!value) return ''; const [year, month, day] = value.split('-'); return `${day}/${month}/${year}`; }
  function formatChange(value) { return value === null || value === undefined ? 'Không có dữ liệu kỳ trước' : `${value >= 0 ? '▲' : '▼'} ${formatNumber(Math.abs(value) * 100, 2)}%`; }
  function trendClass(value) { return value === null || value === undefined ? 'trend-flat' : value >= 0 ? 'trend-up' : 'trend-down'; }
  function valueForMetric(metric, kind) { const value = metric?.value; if (kind === 'money') return formatMoney(value); if (kind === 'percent') return formatPercent(value); return formatNumber(value); }
  function periodLabel(period) { return period ? `${period.title} · ${formatDate(period.startDate)} - ${formatDate(period.endDate)}` : 'Đang tải kỳ báo cáo...'; }
  function makePeriod(kind, anchorDate) {
    const [year, month, day] = String(anchorDate).split('-').map(Number);
    const anchor = new Date(Date.UTC(year, month - 1, day));
    if (kind === 'week') {
      const start = new Date(anchor); start.setUTCDate(start.getUTCDate() - 7);
      const end = new Date(anchor); end.setUTCDate(end.getUTCDate() - 1);
      const iso = (date) => date.toISOString().slice(0, 10);
      return { kind, anchorDate, startDate: iso(start), endDate: iso(end), title: `Tuần ${formatDate(iso(start))} - ${formatDate(iso(end))}` };
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
  function setBusy(busy) { document.body.classList.toggle('is-loading', busy); $('#refreshButton').disabled = busy; $('#saveButton').disabled = busy; }

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
      renderMetricCard('Tỷ lệ gửi hàng nhanh', snapshot.operations.fastShippingRate, 'percent', true), renderMetricCard('Tỷ lệ phản hồi nhanh', snapshot.operations.quickResponseRate, 'percent', true)
    ].join('');
  }

  function renderFunnel() {
    const funnel = state.snapshot?.funnel || emptySnapshot(state.period).funnel;
    const rows = [
      ['Lượt hiển thị sản phẩm', funnel.impressions, 'number'], ['Lượt nhấp vào sản phẩm', funnel.clicks, 'number'], ['Đơn hàng SKU', funnel.skuOrders, 'number']
    ];
    $('#funnel').innerHTML = rows.map(([label, metric, kind], index) => `<div class="funnel-step"><span>${label}</span><strong>${valueForMetric(metric, kind)}</strong></div>${index < 2 ? `<div class="funnel-detail"><span>${index === 0 ? 'CTR' : 'CTOR'}</span><strong>${formatPercent(index === 0 ? funnel.ctr.value : funnel.ctor.value)}</strong><span class="${trendClass(index === 0 ? funnel.ctr.change : funnel.ctor.change)}">${formatChange(index === 0 ? funnel.ctr.change : funnel.ctor.change)}</span></div>` : ''}`).join('');
  }

  function renderFinance() {
    const finance = state.snapshot?.finance || emptySnapshot(state.period).finance;
    const items = [['Phí và thuế', finance.feeTax], ['Hoa hồng KOC', finance.affiliate], ['Chi phí Ads', finance.ads], ['Hoàn tiền', finance.refunds]];
    const total = items.reduce((sum, item) => sum + Math.max(0, Number(item[1]) || 0), 0) || 1;
    let cursor = 0;
    const stops = items.map(([label, value], index) => { const start = cursor; cursor += (Math.max(0, Number(value) || 0) / total) * 100; return `${colors[index]} ${start}% ${cursor}%`; });
    $('#financeDonut').style.background = `conic-gradient(${stops.join(', ')})`;
    $('#financeLegend').innerHTML = items.map(([label, value], index) => `<div class="legend-row"><i class="legend-swatch" style="background:${colors[index]}"></i><span>${label}<small>${formatPercent(total > 1 ? (Number(value) || 0) / total * 100 : 0)} cơ cấu</small></span><strong>${formatMoney(value)}</strong></div>`).join('');
    $('#financeFooter').innerHTML = `<span>Lợi nhuận gộp ước tính <strong>${formatMoney(finance.grossProfit)}</strong></span><span>Tổng chi phí / GMV <strong>${formatPercent(finance.totalCostRate === null ? null : finance.totalCostRate * 100)}</strong></span>`;
  }

  function changeMarkup(value) { return `<small class="change-note ${trendClass(value)}">${escapeHtml(formatChange(value))}</small>`; }
  function renderSources() {
    const rows = state.snapshot?.sources || [];
    $('#sourcesTable').innerHTML = rows.length ? rows.map((row) => `<tr><td class="table-primary">${escapeHtml(row.label)}</td><td>${formatMoney(row.gmv)}</td><td>${formatPercent(row.contribution * 100)}</td><td>${formatNumber(row.impressions)}</td><td>${formatNumber(row.clicks)}</td><td>${formatPercent(row.ctr === null ? null : row.ctr * 100)}</td><td>${formatPercent(row.ctor === null ? null : row.ctor * 100)}</td></tr>`).join('') : `<tr><td colspan="7"><div class="empty-state">Chưa có dữ liệu nguồn trong kỳ này.</div></td></tr>`;
  }
  function renderProducts() {
    const rows = state.snapshot?.products || [];
    $('#productsTable').innerHTML = rows.length ? rows.map((row) => `<tr><td><div class="product-cell">${row.imageUrl ? `<img src="${escapeHtml(row.imageUrl)}" alt="">` : '<span class="product-placeholder">SP</span>'}<span><strong class="table-primary">${escapeHtml(row.title)}</strong><small class="table-secondary">ID: ${escapeHtml(row.id)}</small></span></div></td><td>${formatMoney(row.gmv)}${changeMarkup(row.change?.gmv)}</td><td>${formatNumber(row.orders)}${changeMarkup(row.change?.orders)}</td><td>${formatNumber(row.impressions)}${changeMarkup(row.change?.impressions)}</td><td>${formatNumber(row.clicks)}${changeMarkup(row.change?.clicks)}</td><td>${formatPercent(row.ctr === null ? null : row.ctr * 100)}${changeMarkup(row.change?.ctr)}</td><td>${formatPercent(row.ctor === null ? null : row.ctor * 100)}${changeMarkup(row.change?.ctor)}</td></tr>`).join('') : `<tr><td colspan="7"><div class="empty-state">Chưa có dữ liệu sản phẩm trong kỳ này.</div></td></tr>`;
  }

  function inputCell(value, field, id, area = false) { return area ? `<textarea data-field="${field}" data-id="${id}" rows="2">${escapeHtml(value)}</textarea>` : `<input data-field="${field}" data-id="${id}" value="${escapeHtml(value)}">`; }
  function renderReview() {
    const rows = state.review || [];
    $('#reviewTable').innerHTML = `<div class="edit-grid"><div class="edit-head">STT</div><div class="edit-head">Công việc kỳ trước</div><div class="edit-head">Trạng thái</div><div class="edit-head">Đánh giá kết quả / Tác động</div><div class="edit-head">Nguyên nhân chưa đạt / Bài học</div>${rows.map((row, index) => `<div class="edit-cell row-number">${index + 1}</div><div class="edit-cell">${inputCell(row.previousWork, 'previousWork', row.id, true)}</div><div class="edit-cell">${inputCell(row.status, 'status', row.id)}</div><div class="edit-cell">${inputCell(row.impact, 'impact', row.id, true)}</div><div class="edit-cell">${inputCell(row.lesson, 'lesson', row.id, true)}</div>`).join('')}</div>`;
    if (!rows.length) $('#reviewTable').innerHTML = '<div class="empty-state">Chưa có công việc kỳ trước. Bạn có thể bắt đầu nhập ở kế hoạch mới.</div>';
  }
  function renderEvaluations() {
    const rows = state.evaluations || [];
    $('#evaluationTable').innerHTML = `<div class="edit-grid"><div class="edit-head">STT</div><div class="edit-head">Chỉ số / Phân khúc</div><div class="edit-head">Thực trạng kỳ này</div><div class="edit-head">Nguyên nhân chính</div><div class="edit-head">Hành động tối ưu kỳ sau</div>${rows.map((row, index) => `<div class="edit-cell row-number">${index + 1}</div><div class="edit-cell">${inputCell(row.segment, 'segment', row.id, true)}</div><div class="edit-cell">${inputCell(row.situation, 'situation', row.id, true)}</div><div class="edit-cell">${inputCell(row.cause, 'cause', row.id, true)}</div><div class="edit-cell">${inputCell(row.action, 'action', row.id, true)}</div>`).join('')}</div>`;
    if (!rows.length) $('#evaluationTable').innerHTML = '<div class="empty-state">Chưa có đánh giá. Thêm nội dung sau khi xem số liệu.</div>';
  }
  function renderWork() {
    const rows = state.workItems || [];
    $('#workTable').innerHTML = `<div class="edit-grid work"><div class="edit-head">STT</div><div class="edit-head">Công việc</div><div class="edit-head">Chi tiết hành động</div><div class="edit-head">Mục tiêu KPI</div><div class="edit-head">Phụ trách</div><div class="edit-head">Deadline</div><div class="edit-head"></div>${rows.map((row, index) => `<div class="edit-cell row-number">${index + 1}</div><div class="edit-cell">${inputCell(row.title, 'title', row.id, true)}</div><div class="edit-cell">${inputCell(row.detail, 'detail', row.id, true)}</div><div class="edit-cell">${inputCell(row.kpi, 'kpi', row.id, true)}</div><div class="edit-cell">${inputCell(row.owner, 'owner', row.id)}</div><div class="edit-cell">${inputCell(row.deadline, 'deadline', row.id)}</div><div class="edit-cell"><button class="delete-row" data-delete-work="${row.id}" type="button" aria-label="Xóa công việc">×</button></div>`).join('')}</div>`;
    if (!rows.length) $('#workTable').innerHTML = '<div class="empty-state">Chưa có công việc. Thêm một dòng để bắt đầu kế hoạch.</div>';
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
  function selectPeriod(kind, anchorDate) {
    state.kind = kind; state.anchorDate = anchorDate; state.period = makePeriod(kind, anchorDate); state.snapshot = emptySnapshot(state.period); state.id = ''; state.review = []; state.evaluations = []; state.workItems = [];
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
  function bindEditors() { syncEditableRows($('#reviewTable'), state.review); syncEditableRows($('#evaluationTable'), state.evaluations); syncEditableRows($('#workTable'), state.workItems); }
  function updatePeriodPreview() { const kind = document.querySelector('input[name="reportKind"]:checked')?.value || state.kind; const period = window.__periods?.[kind]; const anchor = $('#anchorDate').value; if (!anchor) return; const [year, month, day] = anchor.split('-').map(Number); const date = new Date(Date.UTC(year, month - 1, day)); let start; let end; if (kind === 'week') { start = new Date(date); start.setUTCDate(start.getUTCDate() - 7); end = new Date(date); end.setUTCDate(end.getUTCDate() - 1); } else { end = new Date(Date.UTC(year, month, 0)); start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1)); } const f = (d) => `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`; $('#periodPreview').textContent = kind === 'week' ? `Kỳ báo cáo: ${f(start)} - ${f(end)}` : `Kỳ báo cáo: tháng ${String(start.getUTCMonth() + 1).padStart(2, '0')}/${start.getUTCFullYear()}`; $('#anchorHelp').textContent = kind === 'week' ? 'Chọn thứ 7 làm mốc chốt tuần.' : 'Chọn ngày 1 của tháng cần xem.'; }

  async function loadSource() {
    if (!state.period) return;
    setBusy(true); setSync('Đang lấy số liệu', 'loading'); setNotice('');
    try {
      let snapshot;
      let lastError;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try { snapshot = await api('/api/source-report', { method: 'POST', body: JSON.stringify({ kind: state.kind, anchorDate: state.anchorDate }) }); break; }
        catch (error) { lastError = error; if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 650)); }
      }
      if (!snapshot) throw lastError || new Error('Không thể lấy số liệu.');
      state.snapshot = snapshot; state.id = ''; renderAll(); bindEditors(); setSync('Đã đồng bộ', 'ready'); setNotice('Số liệu đã được lấy từ dashboard nguồn. Hãy lưu để giữ lại báo cáo và công việc.', true);
    }
    catch (error) { setSync('Chưa đồng bộ'); setNotice(error.message || 'Không thể lấy số liệu.'); }
    finally { setBusy(false); }
  }
  async function saveCurrent() {
    if (!state.snapshot?.dataAvailable) { setNotice('Hãy lấy số liệu trước khi lưu báo cáo.'); return; }
    setBusy(true); setNotice('');
    try { const saved = await api('/api/reports', { method: 'POST', body: JSON.stringify({ snapshot: state.snapshot, review: state.review, evaluations: state.evaluations, workItems: state.workItems }) }); state.id = saved.id; setSync('Đã lưu Supabase', 'ready'); setNotice('Báo cáo và các công việc đã được lưu. Bạn có thể mở lại từ kho lưu trữ.', true); await loadHistory(state.historyKind); }
    catch (error) { setNotice(error.message || 'Không thể lưu báo cáo.'); }
    finally { setBusy(false); }
  }
  function loadRecord(record) { state.id = record.id; state.kind = record.period.kind; state.anchorDate = record.period.anchorDate; state.period = record.period; state.snapshot = record; state.review = record.review || []; state.evaluations = record.evaluations || []; state.workItems = record.workItems || []; renderAll(); bindEditors(); closeHistory(); setSync('Đã mở báo cáo lưu', 'ready'); setNotice(`Đang xem ${record.period.title}.`, true); }
  async function loadHistory(kind = state.historyKind) { state.historyKind = kind; const list = $('#historyList'); list.innerHTML = '<div class="empty-state">Đang tải...</div>'; try { const rows = await api(`/api/reports?kind=${encodeURIComponent(kind)}`); list.innerHTML = rows.length ? rows.map((row) => `<button class="history-item" data-report-id="${escapeHtml(row.id)}" type="button"><strong>${escapeHtml(row.period.title)}</strong><small>${formatDate(row.period.startDate)} - ${formatDate(row.period.endDate)} · Cập nhật ${formatDate(row.updatedAt?.slice(0, 10))}</small></button>`).join('') : '<div class="empty-state">Chưa có báo cáo đã lưu.</div>'; list.querySelectorAll('[data-report-id]').forEach((button) => button.addEventListener('click', async () => { try { loadRecord(await api(`/api/reports/${encodeURIComponent(button.dataset.reportId)}`)); } catch (error) { setNotice(error.message); } })); } catch (error) { list.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`; } }
  function openHistory() { $('#overlay').hidden = false; $('#historyDrawer').classList.add('is-open'); $('#historyDrawer').setAttribute('aria-hidden', 'false'); loadHistory(state.historyKind); }
  function closeHistory() { $('#overlay').hidden = true; $('#historyDrawer').classList.remove('is-open'); $('#historyDrawer').setAttribute('aria-hidden', 'true'); }
  function openSettings() { const dialog = $('#settingsDialog'); document.querySelector(`input[name="reportKind"][value="${state.kind}"]`).checked = true; $('#anchorDate').value = state.anchorDate; updatePeriodPreview(); dialog.showModal(); }
  function applySettings(event) { event.preventDefault(); state.kind = document.querySelector('input[name="reportKind"]:checked').value; state.anchorDate = $('#anchorDate').value; state.period = makePeriod(state.kind, state.anchorDate); state.snapshot = emptySnapshot(state.period); state.id = ''; state.review = []; state.evaluations = []; state.workItems = []; $('#settingsDialog').close(); renderAll(); bindEditors(); loadSource(); }
  function addWork() { state.workItems.push({ id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}`, title: '', detail: '', kpi: '', owner: '', deadline: '' }); renderWork(); bindEditors(); }
  function wire() {
    $('#historyButton').addEventListener('click', openHistory); $('#closeHistoryButton').addEventListener('click', closeHistory); $('#overlay').addEventListener('click', closeHistory); $('#refreshButton').addEventListener('click', loadSource); $('#saveButton').addEventListener('click', saveCurrent); $('#addWorkButton').addEventListener('click', addWork); $('#settingsForm').addEventListener('submit', applySettings); $('#anchorDate').addEventListener('change', updatePeriodPreview); $('#periodPickerButton').addEventListener('click', () => togglePeriodPicker());
    document.querySelectorAll('input[name="reportKind"]').forEach((input) => input.addEventListener('change', updatePeriodPreview)); document.querySelectorAll('[data-history-kind]').forEach((tab) => tab.addEventListener('click', () => { document.querySelectorAll('[data-history-kind]').forEach((item) => item.classList.toggle('is-active', item === tab)); loadHistory(tab.dataset.historyKind); }));
    document.addEventListener('click', (event) => { if (!event.target.closest('.period-toolbar')) togglePeriodPicker(false); });
    $('#workTable').addEventListener('click', (event) => { const button = event.target.closest('[data-delete-work]'); if (!button) return; state.workItems = state.workItems.filter((row) => row.id !== button.dataset.deleteWork); renderWork(); bindEditors(); }); document.addEventListener('keydown', (event) => { if (event.key.toLowerCase() === 'i' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) { event.preventDefault(); openSettings(); } if (event.key === 'Escape') { closeHistory(); togglePeriodPicker(false); } });
  }

  async function init() {
    wire();
    try { const defaults = await api('/api/default-periods'); window.__periods = defaults; state.period = defaults.week; state.anchorDate = defaults.week.anchorDate; state.snapshot = emptySnapshot(state.period); renderAll(); bindEditors(); await loadHistory('week'); await loadSource(); }
    catch (error) { setNotice(error.message || 'Không thể khởi tạo báo cáo.'); renderAll(); }
  }
  init();
})();
