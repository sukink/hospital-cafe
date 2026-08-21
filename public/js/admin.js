(function () {
  'use strict';

  const API = window.API_BASE_URL || '';
  const TOKEN_KEY = 'hospitalCafeAdminToken';

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
    loadEverything();
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
      const passwordInput = document.getElementById('admin-password-input');
      const errorEl = document.getElementById('admin-login-error');
      if (errorEl) errorEl.textContent = '';

      const password = passwordInput ? passwordInput.value : '';
      if (!password) {
        if (errorEl) errorEl.textContent = 'Please enter the admin password.';
        return;
      }

      try {
        const response = await fetch(`${API}/api/admin/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password })
        });

        const data = await response.json();
        if (!response.ok || !data.success || !data.token) {
          if (errorEl) errorEl.textContent = data.message || 'Incorrect password. Please try again.';
          return;
        }

        setToken(data.token);
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

  const STATUS_OPTIONS = ['New', 'Accepted', 'Preparing', 'Ready', 'Out for Delivery', 'Delivered', 'Completed', 'Cancelled'];

  function statusOptionsHtml(current) {
    return STATUS_OPTIONS.map(status => `<option value="${status}" ${status === current ? 'selected' : ''}>${status}</option>`).join('');
  }

  function itemsSummary(items) {
    if (!Array.isArray(items) || items.length === 0) return 'No items';
    return items.map(item => `<div>${escapeHtml(item.item_name || item.name)} × ${item.quantity ?? 1}</div>`).join('');
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
      const priority = order.priority || 'Normal';
      const orderTime = order.time_placed || order.order_time;
      const status = order.status || 'New';

      const paymentClass = paymentStatus === 'Successful' || paymentStatus === 'Paid'
        ? 'color:#155724;font-weight:bold;'
        : 'color:#721c24;font-weight:bold;';

      row.innerHTML = `
        <td><strong>${escapeHtml(orderNumber)}</strong><br><small style="font-family:monospace; color:#555;">Txn ID: ${escapeHtml(transactionId)}</small></td>
        <td>Room ${escapeHtml(roomNumber)}</td>
        <td>${itemsSummary(order.items)}</td>
        <td><strong>₹${totalAmount}</strong><br><small style="${paymentClass}">${escapeHtml(paymentStatus)}</small></td>
        <td><span style="padding:4px 8px; border-radius:5px; background:#f1f1f1; font-size:12px;">${escapeHtml(priority)}</span></td>
        <td>${formatTime(orderTime)}</td>
        <td><select class="status-select" data-order-id="${order.id}">${statusOptionsHtml(status)}</select></td>
        <td><button type="button" class="small-btn primary" data-action="update-status">Update</button></td>
      `;

      const select = row.querySelector('.status-select');
      const updateButton = row.querySelector('[data-action="update-status"]');

      if (updateButton && select) {
        updateButton.addEventListener('click', () => updateOrderStatus(order.id, select.value));
      }

      tbody.appendChild(row);
    });
  }

  async function updateOrderStatus(orderId, status) {
    if (!orderId) return;
    const data = await apiFetch(`${API}/api/orders/${orderId}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status })
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
      row.innerHTML = `
        <td><strong>${escapeHtml(order.order_number || ('#' + order.id))}</strong><br><small style="font-family:monospace; color:#555;">Txn ID: ${escapeHtml(order.transaction_id || 'N/A')}</small></td>
        <td>Room ${escapeHtml(order.room_number)}</td>
        <td><strong>₹${order.total_amount}</strong><br><small style="color:#155724; font-weight:bold;">${escapeHtml(order.payment_status)}</small></td>
        <td><span style="padding:4px 8px; border-radius:5px; background:#e2e3e5; font-size:12px;">${escapeHtml(order.status)}</span></td>
        <td>
          <div style="font-size: 12px; line-height: 1.5;">
            <div>📥 <strong>Received:</strong> ${formatTime(order.time_placed || order.order_time)}</div>
            <div>💳 <strong>Paid:</strong> ${formatTime(order.time_payment || order.order_time)}</div>
            <div>✅ <strong>Completed:</strong> ${formatTime(order.time_delivered)}</div>
          </div>
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
  async function loadReports() {
    try {
      const data = await apiFetch(`${API}/api/admin/reports/daily`);
      if (!data || !data.success) return;

      const report = data.report || {};
      const container = document.getElementById('tab-reports') || document.getElementById('tab-analytics') || document.getElementById('reports-container');
      if (!container) return;

      container.innerHTML = `
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; margin-bottom: 25px;">
          <div class="stat-card"><div class="label">Total Orders</div><div class="value">${report.total_orders || 0}</div></div>
          <div class="stat-card revenue"><div class="label">Total Revenue</div><div class="value">₹${report.total_revenue || 0}</div></div>
          <div class="stat-card delivered"><div class="label">Completed Orders</div><div class="value">${report.completed_orders || 0}</div></div>
          <div class="stat-card"><div class="label">Cancelled Orders</div><div class="value">${report.cancelled_orders || 0}</div></div>
        </div>
        <div style="background: #fff; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.05);">
          <h3>Performance Timeline & Metrics</h3>
          <p style="margin: 10px 0;"><strong>Average Order Value:</strong> ₹${report.average_order_value ? Number(report.average_order_value).toFixed(2) : '0.00'}</p>
          <p style="margin: 10px 0;"><strong>Average Prep Time:</strong> ${report.avg_prep_time ? Math.round(report.avg_prep_time) : '0'} mins</p>
          <p style="margin: 10px 0;"><strong>Average Delivery Time:</strong> ${report.avg_delivery_time ? Math.round(report.avg_delivery_time) : '0'} mins</p>
        </div>
      `;
    } catch (err) {
      console.error('Reports Error:', err);
    }
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

  if (getToken()) {
    showDashboard();
  } else {
    showLogin();
  }
})();