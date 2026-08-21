(function () {
  const API = window.API_BASE_URL;
  const TOKEN_KEY = 'hospitalCafeAdminToken';

  let statusFilter = '';
  let menuCache = [];

  // ---------- Token helpers ----------
  function getToken() {
    return sessionStorage.getItem(TOKEN_KEY);
  }
  function setToken(token) {
    sessionStorage.setItem(TOKEN_KEY, token);
  }
  function clearToken() {
    sessionStorage.removeItem(TOKEN_KEY);
  }

  function authHeaders() {
    return { 'Authorization': 'Bearer ' + getToken(), 'Content-Type': 'application/json' };
  }

  // ---------- Toast ----------
  let toastTimer = null;
  function showToast(message) {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('visible'), 2200);
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  }

  function formatTime(ts) {
    try {
      return new Date(ts).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
    } catch (e) {
      return ts;
    }
  }

  // ---------- View switching ----------
  function showDashboard() {
    document.getElementById('admin-login-view').style.display = 'none';
    document.getElementById('admin-app').style.display = 'block';
    loadEverything();
  }
  function showLogin() {
    document.getElementById('admin-app').style.display = 'none';
    document.getElementById('admin-login-view').style.display = 'block';
  }

  // ---------- Login ----------
  document.getElementById('admin-back-btn').addEventListener('click', () => {
    window.location.href = 'index.html';
  });

  document.getElementById('admin-login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const passwordInput = document.getElementById('admin-password-input');
    const errorEl = document.getElementById('admin-login-error');
    errorEl.textContent = '';

    const password = passwordInput.value;
    if (!password) {
      errorEl.textContent = 'Please enter the admin password.';
      return;
    }

    try {
      const res = await fetch(`${API}/api/admin/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      });
      const data = await res.json();
      if (!data.success) {
        errorEl.textContent = data.message || 'Incorrect password. Please try again.';
        return;
      }
      setToken(data.token);
      passwordInput.value = '';
      showDashboard();
    } catch (err) {
      console.error(err);
      errorEl.textContent = 'Network error. Please check your connection and try again.';
    }
  });

  // ---------- Logout ----------
  document.getElementById('logout-btn').addEventListener('click', async () => {
    try {
      await fetch(`${API}/api/admin/logout`, { method: 'POST', headers: authHeaders() });
    } catch (e) { /* ignore */ }
    clearToken();
    showLogin();
  });

  // ---------- Tabs ----------
  document.querySelectorAll('.admin-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.admin-tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.admin-section').forEach(s => s.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('tab-' + btn.getAttribute('data-tab')).classList.add('active');
    });
  });

  // ---------- Load everything ----------
  async function loadEverything() {
    await Promise.all([loadStats(), loadOrders(), loadMenuAdmin()]);
  }

  function handleAuthFailure(data) {
    if (data && data.message && /not authorized/i.test(data.message)) {
      clearToken();
      showLogin();
      return true;
    }
    return false;
  }

  // ---------- Statistics ----------
  async function loadStats() {
    try {
      const res = await fetch(`${API}/api/orders/stats/summary`, { headers: authHeaders() });
      const data = await res.json();
      if (!data.success) { handleAuthFailure(data); return; }
      renderStats(data.stats);
    } catch (err) {
      console.error(err);
    }
  }

  function statCardsHtml(stats) {
    return `
      <div class="stat-card pending"><div class="label">Pending Orders</div><div class="value">${stats.pending}</div></div>
      <div class="stat-card preparing"><div class="label">Preparing</div><div class="value">${stats.preparing}</div></div>
      <div class="stat-card ready"><div class="label">Ready</div><div class="value">${stats.ready}</div></div>
      <div class="stat-card delivered"><div class="label">Delivered</div><div class="value">${stats.delivered}</div></div>
      <div class="stat-card"><div class="label">Today's Orders</div><div class="value">${stats.todaysOrders}</div></div>
      <div class="stat-card revenue"><div class="label">Today's Order Amount</div><div class="value">₹${stats.todaysRevenue}</div></div>
    `;
  }

  function renderStats(stats) {
    document.getElementById('stats-grid').innerHTML = statCardsHtml(stats);
    document.getElementById('stats-grid-mini').innerHTML = statCardsHtml(stats);
  }

  // ---------- Orders ----------
  document.getElementById('order-filter-row').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-status]');
    if (!btn) return;
    document.querySelectorAll('#order-filter-row .chip-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    statusFilter = btn.getAttribute('data-status');
    loadOrders();
  });

  async function loadOrders() {
    try {
      const url = `${API}/api/orders` + (statusFilter ? `?status=${encodeURIComponent(statusFilter)}` : '');
      const res = await fetch(url, { headers: authHeaders() });
      const data = await res.json();
      if (!data.success) { handleAuthFailure(data); return; }
      renderOrders(data.orders);
    } catch (err) {
      console.error(err);
    }
  }

  const STATUS_OPTIONS = ['Pending', 'Preparing', 'Ready', 'Delivered', 'Cancelled'];

  function statusOptionsHtml(current) {
    return STATUS_OPTIONS.map(s => `<option value="${s}" ${s === current ? 'selected' : ''}>${s}</option>`).join('');
  }

  function itemsSummary(items) {
    return items.map(it => `${escapeHtml(it.item_name)} × ${it.quantity}`).join(', ');
  }

  function renderOrders(orders) {
    const cardsEl = document.getElementById('orders-cards');
    const tbodyEl = document.getElementById('orders-table-body');
    const emptyEl = document.getElementById('orders-empty');

    cardsEl.innerHTML = '';
    tbodyEl.innerHTML = '';

    if (orders.length === 0) {
      emptyEl.style.display = 'block';
      return;
    }
    emptyEl.style.display = 'none';

    orders.forEach(order => {
      // Payment badge with Transaction ID
      const paymentBadge = order.payment_status === 'Paid' 
        ? `<span style="background: #d4edda; color: #155724; padding: 4px 8px; border-radius: 4px; font-weight: bold; font-size: 12px; display: inline-block; margin-top: 6px;">💰 Amount Received: ₹${order.total_amount}</span>
           <br><span style="font-size: 11px; color: #555; display: inline-block; margin-top: 4px; font-family: monospace;">Txn ID: ${escapeHtml(order.transaction_id || 'N/A')}</span>`
        : `<span style="background: #f8d7da; color: #721c24; padding: 4px 8px; border-radius: 4px; font-size: 12px; display: inline-block; margin-top: 6px;">Unpaid</span>`;

      // Mobile card
      const card = document.createElement('div');
      card.className = 'order-card';
      card.innerHTML = `
        <div class="head">
          <span class="order-id">Order #${order.id}</span>
          <span class="room">Room ${escapeHtml(order.room_number)}</span>
        </div>
        <div class="time">${formatTime(order.order_time)}</div>
        ${paymentBadge}
        <div class="items-list" style="margin-top: 10px;">
          ${order.items.map(it => `<div class="row"><span>${escapeHtml(it.item_name)} × ${it.quantity}</span><span>₹${it.amount}</span></div>`).join('')}
        </div>
        ${order.special_instructions ? `<div class="instructions">Note: ${escapeHtml(order.special_instructions)}</div>` : ''}
        <div class="total-row"><span>TOTAL</span><span>₹${order.total_amount}</span></div>
        <div class="status-row">
          <select class="status-select" data-order-id="${order.id}">${statusOptionsHtml(order.status)}</select>
        </div>
      `;
      card.querySelector('.status-select').addEventListener('change', (e) => updateOrderStatus(order.id, e.target.value));
      cardsEl.appendChild(card);

      // Desktop row
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>#${order.id}</td>
        <td>${escapeHtml(order.room_number)}</td>
        <td>${itemsSummary(order.items)}${order.special_instructions ? `<br><span style="color:var(--muted); font-size:12px;">Note: ${escapeHtml(order.special_instructions)}</span>` : ''}</td>
        <td>₹${order.total_amount}<br>${paymentBadge}</td>
        <td>${formatTime(order.order_time)}</td>
        <td></td>
        <td></td>
      `;
      const statusTd = tr.children[5];
      const select = document.createElement('select');
      select.className = 'status-select';
      select.innerHTML = statusOptionsHtml(order.status);
      select.addEventListener('change', (e) => updateOrderStatus(order.id, e.target.value));
      statusTd.appendChild(select);
      tbodyEl.appendChild(tr);
    });
  }

  async function updateOrderStatus(orderId, status) {
    try {
      const res = await fetch(`${API}/api/orders/${orderId}`, {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify({ status })
      });
      const data = await res.json();
      if (!data.success) {
        if (!handleAuthFailure(data)) showToast(data.message || 'Could not update status.');
        return;
      }
      showToast(`Order #${orderId} updated to ${status}`);
      loadOrders();
      loadStats();
    } catch (err) {
      console.error(err);
      showToast('Network error updating status.');
    }
  }

  // ---------- Menu management ----------
  async function loadMenuAdmin() {
    try {
      const res = await fetch(`${API}/api/menu/all`, { headers: authHeaders() });
      const data = await res.json();
      if (!data.success) { handleAuthFailure(data); return; }
      menuCache = data.items;
      renderMenuAdmin();
    } catch (err) {
      console.error(err);
    }
  }

  function renderMenuAdmin() {
    const grid = document.getElementById('menu-admin-grid');
    grid.innerHTML = '';
    menuCache.forEach(item => {
      const card = document.createElement('div');
      card.className = 'menu-admin-card' + (item.available ? '' : ' disabled');
      card.innerHTML = `
        <div class="row1">
          <div>
            <div class="name">${escapeHtml(item.name)} ${item.food_type === 'veg' ? '🟢' : '🔴'}</div>
            <div class="meta">${escapeHtml(item.category)} • ${escapeHtml(item.serving)}</div>
          </div>
          <div class="price">₹${Number(item.price)}</div>
        </div>
        <div class="actions">
          <button class="small-btn primary" data-action="edit">Edit</button>
          <button class="small-btn" data-action="toggle">${item.available ? 'Disable' : 'Enable'}</button>
          <button class="small-btn danger" data-action="delete">Delete</button>
        </div>
      `;
      card.querySelector('[data-action="edit"]').addEventListener('click', () => openMenuModal(item));
      card.querySelector('[data-action="toggle"]').addEventListener('click', () => toggleAvailability(item));
      card.querySelector('[data-action="delete"]').addEventListener('click', () => deleteMenuItem(item));
      grid.appendChild(card);
    });
  }

  async function toggleAvailability(item) {
    try {
      const res = await fetch(`${API}/api/menu/${item.id}/availability`, {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify({ available: item.available ? 0 : 1 })
      });
      const data = await res.json();
      if (!data.success) { if (!handleAuthFailure(data)) showToast(data.message || 'Could not update item.'); return; }
      showToast(`${item.name} ${item.available ? 'disabled' : 'enabled'}`);
      loadMenuAdmin();
    } catch (err) {
      console.error(err);
      showToast('Network error.');
    }
  }

  async function deleteMenuItem(item) {
    if (!confirm(`Delete "${item.name}" from the menu? This cannot be undone.`)) return;
    try {
      const res = await fetch(`${API}/api/menu/${item.id}`, { method: 'DELETE', headers: authHeaders() });
      const data = await res.json();
      if (!data.success) { if (!handleAuthFailure(data)) showToast(data.message || 'Could not delete item.'); return; }
      showToast(`${item.name} deleted`);
      loadMenuAdmin();
    } catch (err) {
      console.error(err);
      showToast('Network error.');
    }
  }

  // ---------- Menu modal (add / edit) ----------
  const overlay = document.getElementById('menu-modal-overlay');

  document.getElementById('add-item-btn').addEventListener('click', () => openMenuModal(null));
  document.getElementById('menu-modal-cancel').addEventListener('click', closeMenuModal);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeMenuModal(); });

  function openMenuModal(item) {
    document.getElementById('menu-modal-title').textContent = item ? 'Edit Food Item' : 'Add Food Item';
    document.getElementById('menu-modal-error').textContent = '';
    document.getElementById('mi-id').value = item ? item.id : '';
    document.getElementById('mi-name').value = item ? item.name : '';
    document.getElementById('mi-category').value = item ? item.category : 'Breakfast';
    document.getElementById('mi-type').value = item ? item.food_type : 'veg';
    document.getElementById('mi-serving').value = item ? item.serving : '';
    document.getElementById('mi-price').value = item ? Number(item.price) : '';
    document.getElementById('mi-description').value = item ? (item.description || '') : '';
    document.getElementById('mi-available').checked = item ? !!item.available : true;
    overlay.classList.add('visible');
  }

  function closeMenuModal() {
    overlay.classList.remove('visible');
  }

  document.getElementById('menu-item-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errorEl = document.getElementById('menu-modal-error');
    errorEl.textContent = '';

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
      errorEl.textContent = 'Please fill in name, serving, and a valid price.';
      return;
    }

    try {
      const url = id ? `${API}/api/menu/${id}` : `${API}/api/menu`;
      const method = id ? 'PUT' : 'POST';
      const res = await fetch(url, { method, headers: authHeaders(), body: JSON.stringify(payload) });
      const data = await res.json();
      if (!data.success) {
        if (!handleAuthFailure(data)) errorEl.textContent = data.message || 'Could not save item.';
        return;
      }
      showToast(id ? 'Item updated' : 'Item added');
      closeMenuModal();
      loadMenuAdmin();
    } catch (err) {
      console.error(err);
      errorEl.textContent = 'Network error. Please try again.';
    }
  });

  // ---------- Init ----------
  if (getToken()) {
    showDashboard();
  } else {
    showLogin();
  }
})();