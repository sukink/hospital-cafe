(function () {
  'use strict';

  const API = window.API_BASE_URL || '';
  const TOKEN_KEY = 'hospitalCafeAdminToken';
  const SUPER_KEY = 'hospitalCafeAdminIsSuper';

  let menuCache = [];
  let toastTimer = null;

  function getToken() {
    return sessionStorage.getItem(TOKEN_KEY);
  }

  function setToken(token) {
    if (!token) return false;
    sessionStorage.setItem(TOKEN_KEY, token);
    return true;
  }

  function clearToken() {
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(SUPER_KEY);
  }

  function isSuperAdmin() {
    return sessionStorage.getItem(SUPER_KEY) === '1';
  }

  function authHeaders() {
    const token = getToken();
    return {
      'Authorization': token ? `Bearer ${token}` : '',
      'Content-Type': 'application/json'
    };
  }

  async function apiFetch(url, options = {}) {
    const token = getToken();
    if (!token) {
      showLogin();
      return null;
    }

    const requestOptions = {
      ...options,
      headers: {
        ...authHeaders(),
        ...(options.headers || {})
      }
    };

    try {
      const response = await fetch(url, requestOptions);

      if (response.status === 401) {
        clearToken();
        showLogin();
        showToast('Admin session expired. Please login again.');
        return null;
      }

      const data = await response.json();
      if (!response.ok) {
        return { ...data, success: false, status: response.status };
      }
      return data;
    } catch (error) {
      console.error('[API] Network error:', url, error);
      showToast('Network error. Please check your connection.');
      return { success: false, message: 'Network error.' };
    }
  }

  function showToast(message) {
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('visible'), 2200);
  }

  function escapeHtml(value) {
    const div = document.createElement('div');
    div.textContent = value == null ? '' : String(value);
    return div.innerHTML;
  }

  function formatTime(timestamp) {
    if (!timestamp) return '—';
    try {
      const date = new Date(timestamp);
      return Number.isNaN(date.getTime()) ? String(timestamp) : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
    } catch (error) {
      return timestamp;
    }
  }

  function showDashboard() {
    const loginView = document.getElementById('admin-login-view');
    const adminApp = document.getElementById('admin-app');
    if (loginView) loginView.style.display = 'none';
    if (adminApp) adminApp.style.display = 'block';
    applySuperAdminUiGate();
    loadEverything();
  }

  function applySuperAdminUiGate() {
    const staffTabBtn = document.querySelector('.admin-tab-btn[data-tab="staff"]');
    const notice = document.getElementById('staff-not-super-notice');
    const createCard = document.getElementById('staff-create-card');
    const isSuper = isSuperAdmin();

    if (notice) notice.style.display = isSuper ? 'none' : 'block';
    if (createCard) createCard.style.display = isSuper ? 'block' : 'none';
    if (staffTabBtn) staffTabBtn.style.display = 'inline-block'; // visible either way; content is gated

  }

  function showLogin() {
    const loginView = document.getElementById('admin-login-view');
    const adminApp = document.getElementById('admin-app');
    if (adminApp) adminApp.style.display = 'none';
    if (loginView) loginView.style.display = 'block';
  }

  // Back Button
  const backBtn = document.getElementById('admin-back-btn');
  if (backBtn) {
    backBtn.addEventListener('click', () => { window.location.href = 'index.html'; });
  }

  // Login Form Submission
  const loginForm = document.getElementById('admin-login-form');
  if (loginForm) {
    loginForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const usernameInput = document.getElementById('admin-username-input');
      const passwordInput = document.getElementById('admin-password-input');
      const errorEl = document.getElementById('admin-login-error');
      if (errorEl) errorEl.textContent = '';

      const username = usernameInput ? usernameInput.value.trim() : '';
      const password = passwordInput ? passwordInput.value : '';
      if (!username || !password) {
        if (errorEl) errorEl.textContent = 'Please enter your username and password.';
        return;
      }

      try {
        const response = await fetch(`${API}/api/admin/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password })
        });

        const data = await response.json();
        if (!response.ok || !data.success || !data.token) {
          if (errorEl) errorEl.textContent = data.message || 'Incorrect username or password.';
          return;
        }

        setToken(data.token);
        sessionStorage.setItem(SUPER_KEY, data.is_super ? '1' : '0');
        if (passwordInput) passwordInput.value = '';
        showDashboard();
      } catch (error) {
        if (errorEl) errorEl.textContent = 'Network error. Please try again.';
      }
    });
  }

  // Logout Button
  const logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      try {
        await apiFetch(`${API}/api/admin/logout`, { method: 'POST' });
      } catch (error) { /* ignore */ }
      clearToken();
      showLogin();
    });
  }

  // Admin Tabs Switching
  document.querySelectorAll('.admin-tab-btn').forEach(button => {
    button.addEventListener('click', () => {
      document.querySelectorAll('.admin-tab-btn').forEach(btn => btn.classList.remove('active'));
      document.querySelectorAll('.admin-section').forEach(section => section.classList.remove('active'));
      button.classList.add('active');
      const tabName = button.getAttribute('data-tab');
      const section = document.getElementById(`tab-${tabName}`);
      if (section) section.classList.add('active');

      if (tabName === 'completed' || tabName === 'history') {
        loadCompletedOrders();
      } else if (tabName === 'reports' || tabName === 'analytics') {
        loadReports();
      } else if (tabName === 'menu') {
        loadMenuAdmin();
      } else if (tabName === 'active') {
        loadOrders();
      } else if (tabName === 'addons') {
        loadAddons();
      } else if (tabName === 'staff') {
        loadStaffUsers();
      }
    });
  });

  async function loadEverything() {
    await Promise.all([loadStats(), loadOrders(), loadMenuAdmin()]);
  }

  function handleAuthFailure(data) {
    if (!data) return false;
    if (data.status === 401 || /unauthorized/i.test(data.message || '')) {
      clearToken();
      showLogin();
      return true;
    }
    return false;
  }

  // Statistics
  async function loadStats() {
    const data = await apiFetch(`${API}/api/orders/stats/summary`);
    if (!data || !data.success) {
      if (data) handleAuthFailure(data);
      return;
    }
    renderStats(data.stats || {});
  }

  function statCardsHtml(stats) {
    return `
      <div class="stat-card pending"><div class="label">Pending Orders</div><div class="value">${stats.pending_orders ?? 0}</div></div>
      <div class="stat-card preparing"><div class="label">Preparing</div><div class="value">${stats.preparing_orders ?? 0}</div></div>
      <div class="stat-card ready"><div class="label">Ready</div><div class="value">${stats.ready_orders ?? 0}</div></div>
      <div class="stat-card delivered"><div class="label">Completed</div><div class="value">${stats.completed_orders ?? 0}</div></div>
      <div class="stat-card"><div class="label">Today's Orders</div><div class="value">${stats.total_orders ?? 0}</div></div>
      <div class="stat-card revenue"><div class="label">Today's Revenue</div><div class="value">₹${stats.today_revenue ?? 0}</div></div>
    `;
  }

  function renderStats(stats) {
    const grid = document.getElementById('stats-grid-summary') || document.getElementById('stats-grid');
    if (grid) grid.innerHTML = statCardsHtml(stats);
  }

  // Active Orders
  async function loadOrders() {
    const data = await apiFetch(`${API}/api/orders/active`);
    if (!data || !data.success) {
      if (data) handleAuthFailure(data);
      return;
    }
    renderOrders(Array.isArray(data.orders) ? data.orders : []);
  }

  const STATUS_OPTIONS = ['Preparing', 'Ready', 'Delivered', 'Cancelled'];

  function statusOptionsHtml(current) {
    return STATUS_OPTIONS.map(status => `<option value="${status}" ${status === current ? 'selected' : ''}>${status}</option>`).join('');
  }

  function itemsSummary(items) {
    if (!Array.isArray(items) || items.length === 0) return 'No items';
    return items.map(item => {
      const addons = Array.isArray(item.addons) && item.addons.length
        ? `<div style="font-size:11px; color:var(--muted); margin-left:8px;">+ ${item.addons.map(a => escapeHtml(a.name)).join(', ')}</div>`
        : '';
      return `<div>${escapeHtml(item.item_name || item.name)} × ${item.quantity ?? 1}${addons}</div>`;
    }).join('');
  }

  function specialInstructionText(order) {
    const value = order.special_instructions || order.specialInstructions || order.notes || '';
    return value ? escapeHtml(value) : '—';
  }

  function renderOrders(orders) {
    const tbody = document.getElementById('active-orders-table-body') || document.getElementById('orders-table-body');
    const empty = document.getElementById('active-orders-empty') || document.getElementById('orders-empty');
    if (!tbody) return;

    tbody.innerHTML = '';
    if (!orders || orders.length === 0) {
      if (empty) empty.style.display = 'block';
      return;
    }
    if (empty) empty.style.display = 'none';

    orders.forEach(order => {
      const row = document.createElement('tr');
      const orderNumber = order.order_number || `#${order.id}`;
      const transactionId = order.transaction_id || 'N/A';
      const roomNumber = order.room_number || 'N/A';
      const totalAmount = order.total_amount ?? 0;
      const paymentStatus = order.payment_status || 'Pending';
      const orderTime = order.time_placed || order.order_time;
      const status = order.status || 'New';

      const paymentClass = paymentStatus === 'Successful' || paymentStatus === 'Paid'
        ? 'color:#155724;font-weight:bold;'
        : 'color:#721c24;font-weight:bold;';

      row.innerHTML = `
        <td><strong>${escapeHtml(orderNumber)}</strong></td>
        <td>Room ${escapeHtml(roomNumber)}</td>
        <td>${itemsSummary(order.items)}</td>
        <td><strong>₹${totalAmount}</strong><br><small style="${paymentClass}">${escapeHtml(paymentStatus)}</small></td>
        <td><small style="font-family:monospace; color:#555;">${escapeHtml(transactionId)}</small></td>
        <td>${formatTime(orderTime)}</td>
        <td>${specialInstructionText(order)}</td>
        <td><select class="status-select" data-order-id="${order.id}">${statusOptionsHtml(status)}</select></td>
        <td><button type="button" class="small-btn primary" data-action="update-status">Update</button></td>
      `;

      const select = row.querySelector('.status-select');
      const updateButton = row.querySelector('[data-action="update-status"]');

      if (updateButton && select) {
        updateButton.addEventListener('click', () => {
          if (select.value === 'Cancelled') {
            openCancelReasonModal(order.id);
            return;
          }
          updateOrderStatus(order.id, select.value);
        });
      }

      tbody.appendChild(row);
    });
  }

  const cancelReasonModal = document.getElementById('cancel-reason-modal');
  const cancelReasonInput = document.getElementById('cancel-reason-input');
  const cancelReasonSubmit = document.getElementById('cancel-reason-submit');
  const cancelReasonClose = document.getElementById('cancel-reason-close');
  const cancelReasonError = document.getElementById('cancel-reason-error');
  let pendingCancelOrderId = null;

  function closeCancelReasonModal() {
    pendingCancelOrderId = null;
    if (cancelReasonInput) cancelReasonInput.value = '';
    if (cancelReasonError) cancelReasonError.textContent = '';
    if (cancelReasonModal) cancelReasonModal.style.display = 'none';
  }

  function openCancelReasonModal(orderId) {
    pendingCancelOrderId = orderId;
    if (cancelReasonError) cancelReasonError.textContent = '';
    if (cancelReasonInput) cancelReasonInput.value = '';
    if (cancelReasonModal) cancelReasonModal.style.display = 'flex';
    if (cancelReasonInput) cancelReasonInput.focus();
  }

  if (cancelReasonClose) {
    cancelReasonClose.addEventListener('click', closeCancelReasonModal);
  }
  if (cancelReasonModal) {
    cancelReasonModal.addEventListener('click', event => {
      if (event.target === cancelReasonModal) closeCancelReasonModal();
    });
  }
  if (cancelReasonSubmit) {
    cancelReasonSubmit.addEventListener('click', async () => {
      const reason = cancelReasonInput ? cancelReasonInput.value.trim() : '';
      if (!reason) {
        if (cancelReasonError) cancelReasonError.textContent = 'Cancellation reason is required.';
        return;
      }
      if (!pendingCancelOrderId) return;
      await updateOrderStatus(pendingCancelOrderId, 'Cancelled', reason);
      closeCancelReasonModal();
    });
  }

  async function updateOrderStatus(orderId, status, cancellationReason = '') {
    if (!orderId) return;
    if (status === 'Cancelled' && !String(cancellationReason || '').trim()) {
      showToast('Please enter a cancellation reason.');
      return;
    }
    const data = await apiFetch(`${API}/api/orders/${orderId}/status`, {
      method: 'PATCH',
      body: JSON.stringify({
        status,
        cancellation_reason: cancellationReason,
        admin_id: sessionStorage.getItem('hospitalCafeAdminUser') || 'Admin'
      })
    });

    if (!data || !data.success) {
      if (data) handleAuthFailure(data);
      showToast(data?.message || 'Could not update order status.');
      return;
    }

    showToast(`Order updated to ${status}`);
    await loadOrders();
    await loadStats();
  }

  // Completed / History Orders (Receipt Timeline view)
  async function loadCompletedOrders() {
    try {
      const search = document.getElementById('completed-search')?.value || '';
      const status = document.getElementById('completed-status-filter')?.value || '';
      const date = document.getElementById('completed-date-filter')?.value || '';

      let url = `${API}/api/orders/completed?`;
      if (search) url += `search=${encodeURIComponent(search)}&`;
      if (status) url += `status=${encodeURIComponent(status)}&`;
      if (date) url += `date=${encodeURIComponent(date)}&`;

      const data = await apiFetch(url);
      if (!data || !data.success) return;

      renderCompletedOrders(data.orders || []);
    } catch (err) {
      console.error('Completed Orders Error:', err);
    }
  }

  function renderCompletedOrders(orders) {
    const tbody = document.getElementById('completed-orders-table-body') || document.getElementById('completed-table-body');
    const empty = document.getElementById('completed-orders-empty') || document.getElementById('completed-empty');
    if (!tbody) return;

    tbody.innerHTML = '';
    if (!orders || orders.length === 0) {
      if (empty) empty.style.display = 'block';
      return;
    }
    if (empty) empty.style.display = 'none';

    orders.forEach(order => {
      const row = document.createElement('tr');
      const cancelledReason = order.cancellation_reason
        ? `<div style="margin-top:6px; color:#721c24; font-size:12px;"><strong>Reason:</strong> ${escapeHtml(order.cancellation_reason)}</div>`
        : '';
      row.innerHTML = `
        <td><strong>${escapeHtml(order.order_number || ('#' + order.id))}</strong></td>
        <td><small style="font-family:monospace; color:#555;">${escapeHtml(order.transaction_id || 'N/A')}</small></td>
        <td>Room ${escapeHtml(order.room_number)}</td>
        <td><strong>₹${order.total_amount}</strong><br><small style="color:#155724; font-weight:bold;">${escapeHtml(order.payment_status)}</small></td>
        <td><span style="padding:4px 8px; border-radius:5px; background:#e2e3e5; font-size:12px;">${escapeHtml(order.status)}</span></td>
        <td>
          <div style="font-size: 12px; line-height: 1.5;">
            <div>📥 <strong>Received:</strong> ${formatTime(order.time_placed || order.order_time)}</div>
            <div>💳 <strong>Paid:</strong> ${formatTime(order.time_payment || order.order_time)}</div>
            <div>✅ <strong>Completed:</strong> ${formatTime(order.time_delivered)}</div>
          </div>
          ${cancelledReason}
        </td>
      `;
      tbody.appendChild(row);
    });
  }

  const filterBtn = document.getElementById('completed-filter-btn') || document.querySelector('.completed-filter-action');
  if (filterBtn) {
    filterBtn.addEventListener('click', loadCompletedOrders);
  }

  // Reports & Analytics
  let lastReportsOrders = []; // kept for CSV export

  function reportsRangeParams() {
    const quickDate = document.getElementById('reports-date-filter')?.value || '';
    const startDate = document.getElementById('reports-start-date-filter')?.value || '';
    const endDate = document.getElementById('reports-end-date-filter')?.value || '';

    if (startDate && endDate) {
      return `?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`;
    }
    if (quickDate) {
      return `?date=${encodeURIComponent(quickDate)}`;
    }
    return '';
  }

  let lastReportsItemRows = []; // per food-item rows (incl. add-ons) for the detailed CSV

  async function loadReports() {
    try {
      const qs = reportsRangeParams();

      const [summaryData, ordersData] = await Promise.all([
        apiFetch(`${API}/api/admin/reports/daily${qs}`),
        apiFetch(`${API}/api/admin/reports/orders-list${qs}`)
      ]);

      if (!summaryData || !summaryData.success) return;

      const report = summaryData.report || {};
      // Target the INNER container only — never the outer #tab-reports, which
      // also holds the page heading and the date filter bar above.
      const container = document.getElementById('reports-container');
      if (!container) return;

      const orders = (ordersData && ordersData.success && Array.isArray(ordersData.orders)) ? ordersData.orders : [];
      lastReportsOrders = orders;
      lastReportsItemRows = (ordersData && ordersData.success && Array.isArray(ordersData.itemRows)) ? ordersData.itemRows : [];
      const grandTotal = orders.reduce((sum, o) => sum + Number(o.total_amount || 0), 0);

      const orderRowsHtml = orders.length > 0
        ? orders.map(o => `
            <tr>
              <td>${escapeHtml(o.room_number || '—')}</td>
              <td style="font-family:monospace;">${escapeHtml(o.transaction_id || '—')}</td>
              <td>₹${Number(o.total_amount || 0)}</td>
              <td>${escapeHtml(o.status || '—')}</td>
            </tr>
          `).join('')
        : `<tr><td colspan="4" style="text-align:center; color:var(--muted);">No orders for this date.</td></tr>`;

      container.innerHTML = `
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; margin-bottom: 25px;">
          <div class="stat-card"><div class="label">Total Orders</div><div class="value">${report.total_orders || 0}</div></div>
          <div class="stat-card revenue"><div class="label">Total Revenue</div><div class="value">₹${report.total_revenue || 0}</div></div>
          <div class="stat-card delivered"><div class="label">Completed Orders</div><div class="value">${report.completed_orders || 0}</div></div>
          <div class="stat-card"><div class="label">Cancelled Orders</div><div class="value">${report.cancelled_orders || 0}</div></div>
        </div>
        <div style="background: #fff; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.05); margin-bottom: 20px;">
          <h3>Performance Timeline & Metrics</h3>
          <p style="margin: 10px 0;"><strong>Total Order Value:</strong> ₹${report.total_revenue || 0}</p>
          <p style="margin: 10px 0;"><strong>Average Prep Time:</strong> ${report.avg_prep_time ? Math.round(report.avg_prep_time) : '0'} mins</p>
          <p style="margin: 10px 0;"><strong>Average Delivery Time:</strong> ${report.avg_delivery_time ? Math.round(report.avg_delivery_time) : '0'} mins</p>
        </div>
        <div class="table-container">
          <table>
            <thead>
              <tr>
                <th>Room No</th>
                <th>Txn ID</th>
                <th>Amount</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>${orderRowsHtml}</tbody>
            <tfoot>
              <tr style="font-weight:bold; border-top:2px solid var(--border);">
                <td colspan="2">TOTAL</td>
                <td>₹${grandTotal}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
      `;
    } catch (err) {
      console.error('Reports Error:', err);
    }
  }

  const reportsApplyBtn = document.getElementById('reports-apply-btn');
  if (reportsApplyBtn) {
    reportsApplyBtn.addEventListener('click', loadReports);
  }

  const reportsExportBtn = document.getElementById('reports-export-btn');
  if (reportsExportBtn) {
    reportsExportBtn.addEventListener('click', () => {
      if (!lastReportsItemRows.length) {
        showToast('Nothing to export for this date.');
        return;
      }
      const header = ['Order ID', 'Date', 'Time', 'Room Number', 'Food Item', 'Quantity', 'Add-ons', 'Base Price', 'Add-on Price', 'Total Amount', 'Order Status'];
      const rows = lastReportsItemRows.map(r => {
        const d = r.order_time ? new Date(r.order_time) : null;
        return [
          r.order_number || '',
          d ? d.toLocaleDateString() : '',
          d ? d.toLocaleTimeString() : '',
          r.room_number || '',
          r.item_name || '',
          r.quantity ?? '',
          r.addons || '',
          r.base_price ?? 0,
          r.addon_price ?? 0,
          r.line_total ?? 0,
          r.status || ''
        ];
      });
      const grandLineTotal = lastReportsItemRows.reduce((sum, r) => sum + Number(r.line_total || 0), 0);
      rows.push(['', '', '', '', '', '', '', '', 'TOTAL', grandLineTotal, '']);

      const csv = [header, ...rows]
        .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
        .join('\n');

      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const dateLabel = document.getElementById('reports-start-date-filter')?.value && document.getElementById('reports-end-date-filter')?.value
        ? `${document.getElementById('reports-start-date-filter').value}_to_${document.getElementById('reports-end-date-filter').value}`
        : (document.getElementById('reports-date-filter')?.value || new Date().toISOString().slice(0, 10));
      a.href = url;
      a.download = `orders-report-${dateLabel}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    });
  }

  // Menu Management
  async function loadMenuAdmin() {
    const data = await apiFetch(`${API}/api/menu/all`);
    if (!data || !data.success) {
      if (data) handleAuthFailure(data);
      return;
    }
    menuCache = Array.isArray(data.items) ? data.items : [];
    renderMenuAdmin();
  }

  function renderMenuAdmin() {
    const grid = document.getElementById('menu-admin-grid');
    if (!grid) return;
    grid.innerHTML = '';

    menuCache.forEach(item => {
      const card = document.createElement('div');
      card.className = 'menu-admin-card' + (item.available ? '' : ' disabled');
      card.innerHTML = `
        <div class="row1">
          <div>
            <div class="name">${escapeHtml(item.name)} ${item.food_type === 'veg' ? '🟢' : '🔴'}</div>
            <div class="meta">${escapeHtml(item.category || '')} • ${escapeHtml(item.serving || '')}</div>
          </div>
          <div class="price">₹${Number(item.price || 0)}</div>
        </div>
        <div class="actions">
          <button class="small-btn primary" data-action="edit" type="button">Edit</button>
          <button class="small-btn" data-action="toggle" type="button">${item.available ? 'Disable' : 'Enable'}</button>
          <button class="small-btn danger" data-action="delete" type="button">Delete</button>
        </div>
      `;

      card.querySelector('[data-action="edit"]').addEventListener('click', () => openMenuModal(item));
      card.querySelector('[data-action="toggle"]').addEventListener('click', () => toggleAvailability(item));
      card.querySelector('[data-action="delete"]').addEventListener('click', () => deleteMenuItem(item));
      grid.appendChild(card);
    });
  }

  async function toggleAvailability(item) {
    const data = await apiFetch(`${API}/api/menu/${item.id}/availability`, {
      method: 'PATCH',
      body: JSON.stringify({ available: item.available ? 0 : 1 })
    });
    if (!data || !data.success) {
      if (data) handleAuthFailure(data);
      showToast(data?.message || 'Could not update item.');
      return;
    }
    showToast(`${item.name} ${item.available ? 'disabled' : 'enabled'}`);
    loadMenuAdmin();
  }

  async function deleteMenuItem(item) {
    if (!confirm(`Delete "${item.name}" from the menu? This cannot be undone.`)) return;
    const data = await apiFetch(`${API}/api/menu/${item.id}`, { method: 'DELETE' });
    if (!data || !data.success) {
      if (data) handleAuthFailure(data);
      showToast(data?.message || 'Could not delete item.');
      return;
    }
    showToast(`${item.name} deleted`);
    loadMenuAdmin();
  }

  const overlay = document.getElementById('menu-modal-overlay');
  const addItemBtn = document.getElementById('add-item-btn');
  const modalCancel = document.getElementById('menu-modal-cancel');

  if (addItemBtn) addItemBtn.addEventListener('click', () => openMenuModal(null));
  if (modalCancel) modalCancel.addEventListener('click', closeMenuModal);
  if (overlay) overlay.addEventListener('click', e => { if (e.target === overlay) closeMenuModal(); });

  function openMenuModal(item) {
    const title = document.getElementById('menu-modal-title');
    const error = document.getElementById('menu-modal-error');
    if (title) title.textContent = item ? 'Edit Food Item' : 'Add Food Item';
    if (error) error.textContent = '';

    document.getElementById('mi-id').value = item ? item.id : '';
    document.getElementById('mi-name').value = item ? item.name : '';
    document.getElementById('mi-category').value = item ? item.category : 'Breakfast';
    document.getElementById('mi-type').value = item ? item.food_type : 'veg';
    document.getElementById('mi-serving').value = item ? item.serving : '';
    document.getElementById('mi-price').value = item ? Number(item.price) : '';
    document.getElementById('mi-description').value = item ? (item.description || '') : '';
    document.getElementById('mi-available').checked = item ? !!item.available : true;
    if (overlay) overlay.classList.add('visible');
  }

  function closeMenuModal() {
    if (overlay) overlay.classList.remove('visible');
  }

  const menuItemForm = document.getElementById('menu-item-form');
  if (menuItemForm) {
    menuItemForm.addEventListener('submit', async event => {
      event.preventDefault();
      const errorEl = document.getElementById('menu-modal-error');
      if (errorEl) errorEl.textContent = '';

      const id = document.getElementById('mi-id').value;
      const payload = {
        name: document.getElementById('mi-name').value.trim(),
        category: document.getElementById('mi-category').value,
        food_type: document.getElementById('mi-type').value,
        serving: document.getElementById('mi-serving').value.trim(),
        price: Number(document.getElementById('mi-price').value),
        description: document.getElementById('mi-description').value.trim(),
        available: document.getElementById('mi-available').checked ? 1 : 0
      };

      if (!payload.name || !payload.serving || !payload.price || payload.price <= 0) {
        if (errorEl) errorEl.textContent = 'Please fill in name, serving, and a valid price.';
        return;
      }

      const url = id ? `${API}/api/menu/${id}` : `${API}/api/menu`;
      const method = id ? 'PUT' : 'POST';

      const data = await apiFetch(url, { method, body: JSON.stringify(payload) });
      if (!data || !data.success) {
        if (data) handleAuthFailure(data);
        if (errorEl) errorEl.textContent = data?.message || 'Could not save item.';
        return;
      }

      showToast(id ? 'Item updated' : 'Item added');
      closeMenuModal();
      loadMenuAdmin();
    });
  }


  // ---------- Add-ons Management ----------
  let addonsCache = [];

  async function loadAddons() {
    // Menu items are needed for the "applies to" checklist in the modal.
    if (!menuCache.length) await loadMenuAdmin();
    const data = await apiFetch(`${API}/api/addons`);
    if (!data || !data.success) {
      if (data) handleAuthFailure(data);
      return;
    }
    addonsCache = Array.isArray(data.addons) ? data.addons : [];
    renderAddons();
  }

  function renderAddons() {
    const tbody = document.getElementById('addons-table-body');
    const empty = document.getElementById('addons-empty');
    if (!tbody) return;
    tbody.innerHTML = '';

    if (addonsCache.length === 0) {
      if (empty) empty.style.display = 'block';
      return;
    }
    if (empty) empty.style.display = 'none';

    addonsCache.forEach(addon => {
      const row = document.createElement('tr');
      const dishNames = (addon.items || []).map(i => escapeHtml(i.name)).join(', ') || '<span style="color:var(--muted);">No dishes linked</span>';
      row.innerHTML = `
        <td><strong>${escapeHtml(addon.name)}</strong></td>
        <td>+₹${Number(addon.price)}</td>
        <td style="max-width:260px;">${dishNames}</td>
        <td>${addon.available ? '<span style="color:#16a34a;font-weight:600;">Available</span>' : '<span style="color:#dc2626;font-weight:600;">Disabled</span>'}</td>
        <td>
          <button class="small-btn primary" data-action="edit" type="button">Edit</button>
          <button class="small-btn" data-action="toggle" type="button">${addon.available ? 'Disable' : 'Enable'}</button>
          <button class="small-btn danger" data-action="delete" type="button">Delete</button>
        </td>
      `;
      row.querySelector('[data-action="edit"]').addEventListener('click', () => openAddonModal(addon));
      row.querySelector('[data-action="toggle"]').addEventListener('click', () => toggleAddonAvailability(addon));
      row.querySelector('[data-action="delete"]').addEventListener('click', () => deleteAddon(addon));
      tbody.appendChild(row);
    });
  }

  async function toggleAddonAvailability(addon) {
    const data = await apiFetch(`${API}/api/addons/${addon.id}/availability`, {
      method: 'PATCH',
      body: JSON.stringify({ available: addon.available ? 0 : 1 })
    });
    if (!data || !data.success) {
      if (data) handleAuthFailure(data);
      showToast(data?.message || 'Could not update add-on.');
      return;
    }
    showToast(`${addon.name} ${addon.available ? 'disabled' : 'enabled'}`);
    loadAddons();
  }

  async function deleteAddon(addon) {
    if (!confirm(`Delete "${addon.name}"? This cannot be undone. Past orders keep their own record of it.`)) return;
    const data = await apiFetch(`${API}/api/addons/${addon.id}`, { method: 'DELETE' });
    if (!data || !data.success) {
      if (data) handleAuthFailure(data);
      showToast(data?.message || 'Could not delete add-on.');
      return;
    }
    showToast(`${addon.name} deleted`);
    loadAddons();
  }

  const addonOverlay = document.getElementById('addon-modal-overlay');
  const addAddonBtn = document.getElementById('add-addon-btn');
  const addonModalCancel = document.getElementById('addon-modal-cancel');

  if (addAddonBtn) addAddonBtn.addEventListener('click', () => openAddonModal(null));
  if (addonModalCancel) addonModalCancel.addEventListener('click', closeAddonModal);
  if (addonOverlay) addonOverlay.addEventListener('click', e => { if (e.target === addonOverlay) closeAddonModal(); });

  function openAddonModal(addon) {
    const title = document.getElementById('addon-modal-title');
    const error = document.getElementById('addon-modal-error');
    if (title) title.textContent = addon ? 'Edit Add-on' : 'Add Add-on';
    if (error) error.textContent = '';

    document.getElementById('ad-id').value = addon ? addon.id : '';
    document.getElementById('ad-name').value = addon ? addon.name : '';
    document.getElementById('ad-price').value = addon ? Number(addon.price) : '';
    document.getElementById('ad-available').checked = addon ? !!addon.available : true;

    const selectedIds = new Set(addon ? (addon.menu_item_ids || []) : []);
    const list = document.getElementById('ad-items-list');
    if (list) {
      if (menuCache.length === 0) {
        list.innerHTML = '<span style="color:var(--muted);">No food items yet — add one under Menu Management first.</span>';
      } else {
        list.innerHTML = menuCache.map(item => `
          <label style="display:flex; align-items:center; gap:0.5rem; padding:0.25rem 0; cursor:pointer;">
            <input type="checkbox" value="${item.id}" ${selectedIds.has(item.id) ? 'checked' : ''}>
            <span>${escapeHtml(item.name)} <small style="color:var(--muted);">(${escapeHtml(item.category || '')})</small></span>
          </label>
        `).join('');
      }
    }
    if (addonOverlay) addonOverlay.classList.add('visible');
  }

  function closeAddonModal() {
    if (addonOverlay) addonOverlay.classList.remove('visible');
  }

  const addonForm = document.getElementById('addon-form');
  if (addonForm) {
    addonForm.addEventListener('submit', async event => {
      event.preventDefault();
      const errorEl = document.getElementById('addon-modal-error');
      if (errorEl) errorEl.textContent = '';

      const id = document.getElementById('ad-id').value;
      const menu_item_ids = Array.from(document.querySelectorAll('#ad-items-list input[type="checkbox"]:checked')).map(cb => Number(cb.value));

      const payload = {
        name: document.getElementById('ad-name').value.trim(),
        price: Number(document.getElementById('ad-price').value),
        available: document.getElementById('ad-available').checked ? 1 : 0,
        menu_item_ids
      };

      if (!payload.name || isNaN(payload.price) || payload.price < 0) {
        if (errorEl) errorEl.textContent = 'Please enter a name and a valid price.';
        return;
      }
      if (menu_item_ids.length === 0) {
        if (errorEl) errorEl.textContent = 'Select at least one dish this add-on applies to.';
        return;
      }

      const url = id ? `${API}/api/addons/${id}` : `${API}/api/addons`;
      const method = id ? 'PUT' : 'POST';

      const data = await apiFetch(url, { method, body: JSON.stringify(payload) });
      if (!data || !data.success) {
        if (data) handleAuthFailure(data);
        if (errorEl) errorEl.textContent = data?.message || 'Could not save add-on.';
        return;
      }

      showToast(id ? 'Add-on updated' : 'Add-on added');
      closeAddonModal();
      loadAddons();
    });
  }

  // ---------- Staff Accounts (super admin only) ----------
  const staffCreateForm = document.getElementById('staff-create-form');
  if (staffCreateForm) {
    staffCreateForm.addEventListener('submit', async event => {
      event.preventDefault();
      const errorEl = document.getElementById('staff-create-error');
      if (errorEl) errorEl.textContent = '';

      const username = document.getElementById('staff-new-username').value.trim();
      const password = document.getElementById('staff-new-password').value;
      const isSuper = document.getElementById('staff-new-is-super').checked;

      if (!username || !password) {
        if (errorEl) errorEl.textContent = 'Username and password are required.';
        return;
      }

      const data = await apiFetch(`${API}/api/admin/users`, {
        method: 'POST',
        body: JSON.stringify({ username, password, is_super: isSuper })
      });

      if (!data || !data.success) {
        if (errorEl) errorEl.textContent = data?.message || 'Could not create account.';
        return;
      }

      showToast('New ID created');
      staffCreateForm.reset();
      loadStaffUsers();
    });
  }

  async function loadStaffUsers() {
    const data = await apiFetch(`${API}/api/admin/users`);
    if (!data || !data.success) {
      // Non-super accounts get a 403 here — that's expected, just show the notice.
      renderStaffUsers([]);
      return;
    }
    renderStaffUsers(Array.isArray(data.users) ? data.users : []);
  }

  function renderStaffUsers(users) {
    const tbody = document.getElementById('staff-users-table-body');
    if (!tbody) return;
    const canManage = isSuperAdmin();

    tbody.innerHTML = '';
    users.forEach(user => {
      const row = document.createElement('tr');
      const statusColor = user.status === 'active' ? '#16a34a' : '#dc2626';
      row.innerHTML = `
        <td>${escapeHtml(user.username)}</td>
        <td>${user.is_super ? '<strong>Super Admin</strong>' : 'Staff'}</td>
        <td><span style="color:${statusColor}; font-weight:600;">${escapeHtml(user.status)}</span></td>
        <td>${formatTime(user.created_at)}</td>
        <td>
          ${canManage ? `
            <button type="button" class="small-btn" data-action="toggle-status">${user.status === 'active' ? 'Disable' : 'Activate'}</button>
            <button type="button" class="small-btn danger" data-action="delete-user">Delete</button>
          ` : '—'}
        </td>
      `;

      if (canManage) {
        row.querySelector('[data-action="toggle-status"]').addEventListener('click', () =>
          updateStaffUserStatus(user.id, user.status === 'active' ? 'inactive' : 'active'));
        row.querySelector('[data-action="delete-user"]').addEventListener('click', () =>
          deleteStaffUser(user.id, user.username));
      }

      tbody.appendChild(row);
    });
  }

  async function updateStaffUserStatus(id, status) {
    const data = await apiFetch(`${API}/api/admin/users/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status })
    });
    if (!data || !data.success) {
      showToast(data?.message || 'Could not update account.');
      return;
    }
    showToast(status === 'active' ? 'Account activated' : 'Account disabled');
    loadStaffUsers();
  }

  async function deleteStaffUser(id, username) {
    if (!confirm(`Delete the account "${username}"? This cannot be undone.`)) return;
    const data = await apiFetch(`${API}/api/admin/users/${id}`, { method: 'DELETE' });
    if (!data || !data.success) {
      showToast(data?.message || 'Could not delete account.');
      return;
    }
    showToast('Account deleted');
    loadStaffUsers();
  }

  if (getToken()) {
    showDashboard();
  } else {
    showLogin();
  }
})();
