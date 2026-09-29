(function () {
  const API = window.API_BASE_URL;

  const state = {
    roomNumber: '',
    menu: [],
    activeCategory: 'All',
    activeFilter: 'all',
    lastOrder: null
  };

  // ---------- Screen navigation ----------
  function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById('screen-' + id).classList.add('active');
    window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
    updateCartBarVisibility();
  }

  document.querySelectorAll('[data-back]').forEach(btn => {
    btn.addEventListener('click', () => showScreen(btn.getAttribute('data-back')));
  });

  // ---------- Toast ----------
  let toastTimer = null;
  function showToast(message) {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('visible'), 2200);
  }

  // ---------- Landing ----------
  document.getElementById('btn-food-order').addEventListener('click', () => {
    showScreen('room');
    document.getElementById('room-input').focus();
  });

  document.getElementById('btn-admin').addEventListener('click', () => {
    window.location.href = 'admin.html';
  });

  // ---------- Room number ----------
  const ROOM_REGEX = /^[A-Za-z0-9\- ]{1,20}$/;

  document.getElementById('room-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = document.getElementById('room-input');
    const errorEl = document.getElementById('room-error');
    const value = input.value.trim();

    if (!value) {
      errorEl.textContent = 'Please enter your room number.';
      return;
    }
    if (!ROOM_REGEX.test(value)) {
      errorEl.textContent = 'Please enter a valid room number.';
      return;
    }
    errorEl.textContent = '';
    state.roomNumber = value;
    document.getElementById('menu-room-chip').textContent = '📍 Room ' + value;
    document.getElementById('cart-room-line').textContent = 'Room No: ' + value;

    await loadMenu();
    showScreen('menu');
  });

  // ---------- Menu loading & rendering ----------
  async function loadMenu() {
    const grid = document.getElementById('food-grid');
    grid.innerHTML = '<div class="empty-state">Loading menu…</div>';
    try {
      const res = await fetch(`${API}/api/menu`);
      const data = await res.json();
      if (!data.success) throw new Error(data.message || 'Failed to load menu');
      state.menu = data.items;
      renderCategories();
      renderMenu();
    } catch (err) {
      console.error(err);
      grid.innerHTML = '<div class="empty-state">Could not load the menu. Please check your connection and try again.</div>';
    }
  }

  function renderCategories() {
    const scroll = document.getElementById('category-scroll');
    const categories = ['All', ...new Set(state.menu.map(i => i.category))];
    scroll.innerHTML = '';
    categories.forEach(cat => {
      const btn = document.createElement('button');
      btn.className = 'chip-btn' + (cat === state.activeCategory ? ' active' : '');
      btn.type = 'button';
      btn.textContent = cat;
      btn.addEventListener('click', () => {
        state.activeCategory = cat;
        renderCategories();
        renderMenu();
      });
      scroll.appendChild(btn);
    });
  }

  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.activeFilter = btn.getAttribute('data-filter');
      renderMenu();
    });
  });

  function renderMenu() {
    const grid = document.getElementById('food-grid');
    const emptyEl = document.getElementById('menu-empty');
    let items = state.menu;

    if (state.activeCategory !== 'All') {
      items = items.filter(i => i.category === state.activeCategory);
    }
    if (state.activeFilter !== 'all') {
      items = items.filter(i => i.food_type === state.activeFilter);
    }

    grid.innerHTML = '';
    if (items.length === 0) {
      emptyEl.style.display = 'block';
      return;
    }
    emptyEl.style.display = 'none';

    items.forEach(item => {
      const card = document.createElement('article');
      card.className = 'food-card';
      const addonCount = Array.isArray(item.addons) ? item.addons.length : 0;
      card.innerHTML = `
        <div class="img-wrap" aria-hidden="true"><span class="img-placeholder-letter">${escapeHtml((item.name || '?').charAt(0).toUpperCase())}</span></div>
        <div class="body">
          <span class="veg-tag ${item.food_type}">● ${item.food_type === 'veg' ? 'VEG' : 'NON-VEG'}</span>
          <p class="name">${escapeHtml(item.name)}</p>
          <p class="serving">${escapeHtml(item.serving)}</p>
          <p class="desc">${escapeHtml(item.description || '')}</p>
          ${addonCount ? `<p class="desc" style="color:var(--primary); font-weight:600;">🧩 ${addonCount} add-on${addonCount === 1 ? '' : 's'} available</p>` : ''}
          <div class="footer-row">
            <span class="price">₹${Number(item.price)}</span>
            <div class="qty-holder" data-id="${item.id}"></div>
          </div>
        </div>
      `;
      grid.appendChild(card);
      renderQtyControl(card.querySelector('.qty-holder'), item);
    });
  }

  function renderQtyControl(holder, item) {
    const qty = Cart.getQuantityForItem(item.id);
    holder.innerHTML = '';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.addEventListener('click', () => openAddonModal(item));
    if (qty === 0) {
      btn.className = 'add-btn';
      btn.textContent = '+ Add';
    } else {
      btn.className = 'add-btn';
      btn.textContent = `🛒 ${qty} in cart · Add more`;
    }
    holder.appendChild(btn);
  }

  // ---------- Add-on selection modal ----------
  const addonModalOverlay = document.getElementById('addon-modal-overlay');
  let addonModalItem = null;
  let addonModalQty = 1;

  function openAddonModal(item) {
    addonModalItem = item;
    addonModalQty = 1;
    document.getElementById('addon-modal-item-name').textContent = item.name;
    document.getElementById('addon-modal-item-price').textContent = `₹${Number(item.price)} base price`;

    const list = document.getElementById('addon-modal-list');
    const addons = Array.isArray(item.addons) ? item.addons : [];
    if (addons.length === 0) {
      list.innerHTML = '<p style="color:var(--muted,#6B7280); margin:0;">No add-ons available for this item.</p>';
    } else {
      list.innerHTML = `<p style="font-weight:600; margin:0 0 8px;">Available add-ons:</p>` + addons.map(a => `
        <label style="display:flex; align-items:center; justify-content:space-between; padding:10px 0; border-bottom:1px solid #eee; cursor:pointer;">
          <span><input type="checkbox" class="addon-checkbox" value="${a.id}" style="margin-right:10px;">${escapeHtml(a.name)}</span>
          <span>+₹${Number(a.price)}</span>
        </label>
      `).join('');
    }

    list.querySelectorAll('.addon-checkbox').forEach(cb => {
      cb.addEventListener('change', updateAddonModalTotal);
    });

    document.getElementById('addon-modal-qty-value').textContent = addonModalQty;
    updateAddonModalTotal();
    addonModalOverlay.style.display = 'flex';
  }

  function closeAddonModal() {
    addonModalOverlay.style.display = 'none';
    addonModalItem = null;
  }

  function getSelectedAddons() {
    if (!addonModalItem) return [];
    const checked = Array.from(document.querySelectorAll('#addon-modal-list .addon-checkbox:checked')).map(cb => Number(cb.value));
    const all = Array.isArray(addonModalItem.addons) ? addonModalItem.addons : [];
    return all.filter(a => checked.includes(a.id));
  }

  function updateAddonModalTotal() {
    if (!addonModalItem) return;
    const selected = getSelectedAddons();
    const unit = Number(addonModalItem.price) + selected.reduce((sum, a) => sum + Number(a.price), 0);
    const total = unit * addonModalQty;
    document.getElementById('addon-modal-total').textContent = `₹${total}`;
  }

  document.getElementById('addon-modal-qty-dec').addEventListener('click', () => {
    if (addonModalQty <= 1) return;
    addonModalQty -= 1;
    document.getElementById('addon-modal-qty-value').textContent = addonModalQty;
    updateAddonModalTotal();
  });
  document.getElementById('addon-modal-qty-inc').addEventListener('click', () => {
    if (addonModalQty >= 20) return;
    addonModalQty += 1;
    document.getElementById('addon-modal-qty-value').textContent = addonModalQty;
    updateAddonModalTotal();
  });
  document.getElementById('addon-modal-cancel-btn').addEventListener('click', closeAddonModal);
  addonModalOverlay.addEventListener('click', (e) => { if (e.target === addonModalOverlay) closeAddonModal(); });

  document.getElementById('addon-modal-add-btn').addEventListener('click', () => {
    if (!addonModalItem) return;
    const selected = getSelectedAddons();
    Cart.addLine(addonModalItem, selected, addonModalQty);
    updateCartBar();
    renderMenu(); // refresh "N in cart" labels
    showToast(`${addonModalItem.name} added to cart`);
    closeAddonModal();
  });

  // ---------- Sticky cart bar ----------
  function updateCartBar() {
    const count = Cart.getTotalCount();
    const total = Cart.getTotalAmount();
    document.getElementById('cart-bar-count').textContent = `🛒 ${count} Item${count === 1 ? '' : 's'}`;
    document.getElementById('cart-bar-total').textContent = `₹${total}`;
    updateCartBarVisibility();
  }

  function updateCartBarVisibility() {
    const bar = document.getElementById('cart-bar');
    const onMenu = document.getElementById('screen-menu').classList.contains('active');
    if (onMenu && Cart.getTotalCount() > 0) {
      bar.classList.add('visible');
    } else {
      bar.classList.remove('visible');
    }
  }

  document.getElementById('view-cart-btn').addEventListener('click', () => {
    renderCartScreen();
    showScreen('cart');
  });

  // ---------- Cart / Order summary screen ----------
  function addonsLineText(line) {
    if (!line.addons || line.addons.length === 0) return '';
    return line.addons.map(a => `+ ${a.name} (₹${a.price})`).join(', ');
  }

  function renderCartScreen() {
    const list = document.getElementById('cart-list');
    const emptyEl = document.getElementById('cart-empty');
    const lines = Cart.getLines();

    list.innerHTML = '';
    document.getElementById('instructions-card').style.display = lines.length ? 'block' : 'none';
    document.getElementById('summary-box').style.display = lines.length ? 'block' : 'none';
    document.getElementById('place-order-btn').style.display = lines.length ? 'block' : 'none';

    if (lines.length === 0) {
      emptyEl.style.display = 'block';
      return;
    }
    emptyEl.style.display = 'none';

    lines.forEach(line => {
      const addonsText = addonsLineText(line);
      const row = document.createElement('div');
      row.className = 'cart-item';
      row.innerHTML = `
        <div class="info">
          <div class="name">${escapeHtml(line.name)}</div>
          <div class="unit">₹${Cart.lineUnitPrice(line)} × ${line.quantity}</div>
          ${addonsText ? `<div class="unit" style="color:var(--primary);">${escapeHtml(addonsText)}</div>` : ''}
        </div>
        <div class="right">
          <span class="amount">₹${Cart.lineAmount(line)}</span>
          <div class="qty-stepper" style="margin-top:6px;">
            <button type="button" data-action="dec" aria-label="Decrease quantity">−</button>
            <span>${line.quantity}</span>
            <button type="button" data-action="inc" aria-label="Increase quantity">+</button>
          </div>
          <button class="remove-btn" type="button" aria-label="Remove ${escapeHtml(line.name)}">🗑️</button>
        </div>
      `;
      row.querySelector('[data-action="dec"]').addEventListener('click', () => {
        Cart.decreaseLine(line.lineKey);
        renderCartScreen();
        updateCartBar();
      });
      row.querySelector('[data-action="inc"]').addEventListener('click', () => {
        Cart.increaseLine(line.lineKey);
        renderCartScreen();
        updateCartBar();
      });
      row.querySelector('.remove-btn').addEventListener('click', () => {
        Cart.removeLine(line.lineKey);
        renderCartScreen();
        updateCartBar();
      });
      list.appendChild(row);
    });

    const summaryRows = document.getElementById('summary-rows');
    summaryRows.innerHTML = lines.map(line => `
      <div class="summary-row">
        <span>${escapeHtml(line.name)}${addonsLineText(line) ? ' (' + escapeHtml(addonsLineText(line)) + ')' : ''} × ${line.quantity}</span>
        <span>₹${Cart.lineAmount(line)}</span>
      </div>
    `).join('');
    document.getElementById('summary-total').textContent = `₹${Cart.getTotalAmount()}`;
  }

  // --- PAYMENT & TRANSACTION LOGIC ---

  document.getElementById('place-order-btn').addEventListener('click', () => {
    const errorEl = document.getElementById('order-error');
    errorEl.textContent = '';

    if (Cart.getLines().length === 0) {
      errorEl.textContent = 'Your cart is empty. Please add at least one item.';
      return;
    }

    const total = Cart.getTotalAmount();
    document.getElementById('payment-total-display').textContent = `₹${total}`;

    showScreen('payment');
  });

  document.getElementById('add-more-items-btn').addEventListener('click', () => {
    showScreen('menu');
  });

  document.getElementById('cancel-order-btn').addEventListener('click', () => {
    if (!confirm('Cancel this order? Your cart will be cleared.')) return;
    Cart.clear();
    updateCartBar();
    document.getElementById('instructions-input').value = '';
    showToast('Order cancelled.');
    showScreen('menu');
  });

  document.getElementById('dummy-pay-btn').addEventListener('click', async () => {
    const btn = document.getElementById('dummy-pay-btn');
    btn.disabled = true;
    btn.textContent = 'PROCESSING...';

    setTimeout(async () => {
      const payload = {
        roomNumber: state.roomNumber,
        items: Cart.getLines().map(line => ({
          itemId: line.itemId,
          quantity: line.quantity,
          addonIds: line.addons.map(a => a.id)
        })),
        specialInstructions: document.getElementById('instructions-input').value.trim()
      };

      try {
        const res = await fetch(`${API}/api/orders`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const data = await res.json();

        if (!data.success) {
          alert(data.message || 'Could not place your order. Please try again.');
          btn.disabled = false;
          btn.textContent = 'PAY NOW';
          return;
        }

        state.lastOrder = data.order;
        renderConfirmation(data.order);
        Cart.clear();
        updateCartBar();

        btn.disabled = false;
        btn.textContent = 'PAY NOW';

        showScreen('confirm');
      } catch (err) {
        console.error(err);
        alert('Network error. Please check your connection and try again.');
        btn.disabled = false;
        btn.textContent = 'PAY NOW';
      }
    }, 2000);
  });

  // --- LIVE ORDER TRACKING ---
  let trackingInterval = null;

  function renderConfirmation(order) {
    document.getElementById('confirm-order-no').textContent = `Order #${order.id}`;
    document.getElementById('confirm-room-line').textContent = `Room No: ${order.roomNumber}`;
    document.getElementById('confirm-rows').innerHTML = order.items.map(it => {
      const addonsText = Array.isArray(it.addons) && it.addons.length
        ? ` (${it.addons.map(a => `+${a.name}`).join(', ')})`
        : '';
      return `<div class="summary-row"><span>${escapeHtml(it.name)}${escapeHtml(addonsText)} × ${it.quantity}</span><span>₹${it.amount}</span></div>`;
    }).join('');
    document.getElementById('confirm-total').textContent = `₹${order.total}`;

    const statusEl = document.getElementById('confirm-status');
    const cancelReasonEl = document.getElementById('confirm-cancel-reason');
    statusEl.className = 'status-pill status-pending';
    statusEl.textContent = '🟡 Pending';
    statusEl.style = '';
    if (cancelReasonEl) cancelReasonEl.textContent = '';

    if (trackingInterval) clearInterval(trackingInterval);

    trackingInterval = setInterval(async () => {
      try {
        const res = await fetch(`${API}/api/orders/track/${order.id}`);
        const data = await res.json();

        if (data.success) {
          const status = data.status;

          if (status === 'New' || status === 'Accepted') {
            statusEl.textContent = '🟡 New Order';
          } else if (status === 'Preparing') {
            statusEl.textContent = '🔥 Preparing';
            statusEl.style.backgroundColor = '#fff3cd';
            statusEl.style.color = '#856404';
          } else if (status === 'Ready') {
            statusEl.textContent = '✅ Ready';
            statusEl.style.backgroundColor = '#d4edda';
            statusEl.style.color = '#155724';
          } else if (status === 'Delivered' || status === 'Completed') {
            statusEl.textContent = '🎉 Delivered';
            statusEl.style.backgroundColor = '#cce5ff';
            statusEl.style.color = '#004085';
            clearInterval(trackingInterval);
          } else if (status === 'Cancelled') {
            statusEl.textContent = '🗑️ Cancelled';
            statusEl.style.backgroundColor = '#f8d7da';
            statusEl.style.color = '#721c24';
            if (cancelReasonEl && data.order && data.order.cancellation_reason) {
              cancelReasonEl.textContent = `Cancellation reason: ${data.order.cancellation_reason}`;
            }
            clearInterval(trackingInterval);
          }
        }
      } catch (err) {
        console.error('Tracking connection error', err);
      }
    }, 5000);
  }

  document.getElementById('new-order-btn').addEventListener('click', () => {
    if (trackingInterval) clearInterval(trackingInterval);
    state.activeCategory = 'All';
    state.activeFilter = 'all';
    document.getElementById('instructions-input').value = '';
    renderCategories();
    renderMenu();
    showScreen('menu');
  });

  // ---------- My Orders History ----------
  if (document.getElementById('btn-my-orders')) {
    document.getElementById('btn-my-orders').addEventListener('click', async () => {
      const list = document.getElementById('my-orders-list');
      document.getElementById('my-orders-title').textContent = `Recent Orders for Room ${state.roomNumber}`;
      list.innerHTML = '<div style="text-align:center; padding:20px;">Loading history...</div>';

      showScreen('my-orders');

      try {
        const res = await fetch(`${API}/api/orders/room/${state.roomNumber}`);
        const data = await res.json();

        if (data.success && data.orders.length > 0) {
          list.innerHTML = data.orders.map(o => {
            let statusColor = '#666';
            if (o.status === 'New' || o.status === 'Accepted' || o.status === 'Preparing') statusColor = '#d39e00';
            if (o.status === 'Ready' || o.status === 'Delivered' || o.status === 'Completed') statusColor = '#28a745';
            if (o.status === 'Cancelled') statusColor = '#dc3545';
            const cancellationReason = o.cancellation_reason ? `<div style="margin-top:6px; color:#721c24; font-size: 13px;"><strong>Cancelled:</strong> ${escapeHtml(o.cancellation_reason)}</div>` : '';

            return `
              <div style="border: 1px solid #eee; border-radius: 8px; padding: 12px; margin-bottom: 12px; background: #fff; box-shadow: 0 2px 4px rgba(0,0,0,0.05);">
                <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
                  <strong style="font-size: 16px;">Order #${o.id}</strong>
                  <strong style="font-size: 16px;">₹${o.total_amount}</strong>
                </div>
                <div style="display: flex; justify-content: space-between; font-size: 14px;">
                  <span style="color: #888;">🕒 ${o.time}</span>
                  <span style="font-weight: bold; color: ${statusColor};">${o.status}</span>
                </div>
                ${cancellationReason}
              </div>
            `;
          }).join('');
        } else {
          list.innerHTML = '<div style="text-align:center; padding:20px; color:#888;">No recent orders found for this room.</div>';
        }
      } catch (err) {
        list.innerHTML = '<div style="text-align:center; padding:20px; color:red;">Error loading history.</div>';
        console.error(err);
      }
    });
  }

  // ---------- Utility ----------
  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  }
})();
