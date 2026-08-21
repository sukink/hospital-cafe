(function () {
  const API = window.API_BASE_URL;

  const state = {
    roomNumber: '',
    menu: [],
    activeCategory: 'All',
    activeFilter: 'all',
    lastOrder: null
  };

  const CATEGORY_ICONS = {
    'Breakfast': '🍳',
    'Main Course': '🍛',
    'Snacks': '🥪',
    'Beverages': '☕'
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
      btn.textContent = (CATEGORY_ICONS[cat] ? CATEGORY_ICONS[cat] + ' ' : '') + cat;
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
      card.innerHTML = `
        <div class="img-wrap" aria-hidden="true">${CATEGORY_ICONS[item.category] || '🍽️'}</div>
        <div class="body">
          <span class="veg-tag ${item.food_type}">● ${item.food_type === 'veg' ? 'VEG' : 'NON-VEG'}</span>
          <p class="name">${escapeHtml(item.name)}</p>
          <p class="serving">${escapeHtml(item.serving)}</p>
          <p class="desc">${escapeHtml(item.description || '')}</p>
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
    const qty = Cart.getQuantity(item.id);
    holder.innerHTML = '';
    if (qty === 0) {
      const btn = document.createElement('button');
      btn.className = 'add-btn';
      btn.type = 'button';
      btn.textContent = '+ Add';
      btn.addEventListener('click', () => {
        Cart.add(item);
        renderQtyControl(holder, item);
        updateCartBar();
        showToast(`${item.name} added to cart`);
      });
      holder.appendChild(btn);
    } else {
      const stepper = document.createElement('div');
      stepper.className = 'qty-stepper';
      stepper.innerHTML = `
        <button type="button" data-action="dec" aria-label="Decrease quantity">−</button>
        <span>${qty}</span>
        <button type="button" data-action="inc" aria-label="Increase quantity">+</button>
      `;
      stepper.querySelector('[data-action="dec"]').addEventListener('click', () => {
        Cart.decrease(item.id);
        renderQtyControl(holder, item);
        updateCartBar();
      });
      stepper.querySelector('[data-action="inc"]').addEventListener('click', () => {
        Cart.increase(item.id);
        renderQtyControl(holder, item);
        updateCartBar();
      });
      holder.appendChild(stepper);
    }
  }

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
  function renderCartScreen() {
    const list = document.getElementById('cart-list');
    const emptyEl = document.getElementById('cart-empty');
    const items = Cart.getItems();

    list.innerHTML = '';
    document.getElementById('instructions-card').style.display = items.length ? 'block' : 'none';
    document.getElementById('summary-box').style.display = items.length ? 'block' : 'none';
    document.getElementById('place-order-btn').style.display = items.length ? 'block' : 'none';

    if (items.length === 0) {
      emptyEl.style.display = 'block';
      return;
    }
    emptyEl.style.display = 'none';

    items.forEach(it => {
      const row = document.createElement('div');
      row.className = 'cart-item';
      row.innerHTML = `
        <div class="info">
          <div class="name">${escapeHtml(it.name)}</div>
          <div class="unit">₹${it.price} × ${it.quantity}</div>
        </div>
        <div class="right">
          <span class="amount">₹${it.price * it.quantity}</span>
          <button class="remove-btn" type="button" aria-label="Remove ${escapeHtml(it.name)}">✕</button>
        </div>
      `;
      row.querySelector('.remove-btn').addEventListener('click', () => {
        Cart.remove(it.id);
        renderCartScreen();
        updateCartBar();
      });
      list.appendChild(row);
    });

    const summaryRows = document.getElementById('summary-rows');
    summaryRows.innerHTML = items.map(it => `
      <div class="summary-row"><span>${escapeHtml(it.name)} × ${it.quantity}</span><span>₹${it.price * it.quantity}</span></div>
    `).join('');
    document.getElementById('summary-total').textContent = `₹${Cart.getTotalAmount()}`;
  }

  // --- NEW PAYMENT LOGIC ---

  // 1. First button: Validates cart and moves to Payment Screen
  document.getElementById('place-order-btn').addEventListener('click', () => {
    const errorEl = document.getElementById('order-error');
    errorEl.textContent = '';

    if (Cart.getItems().length === 0) {
      errorEl.textContent = 'Your cart is empty. Please add at least one item.';
      return;
    }

    // Set the amount on the payment screen
    const total = Cart.getTotalAmount();
    document.getElementById('payment-total-display').textContent = `₹${total}`;
    
    // Switch to payment screen
    showScreen('payment');
  });

  // 2. Second button: Simulates payment and places the order
  document.getElementById('dummy-pay-btn').addEventListener('click', async () => {
    const btn = document.getElementById('dummy-pay-btn');
    btn.disabled = true;
    btn.textContent = 'PROCESSING...';

    // Simulate 2-second payment gateway delay
    setTimeout(async () => {
      const payload = {
        roomNumber: state.roomNumber,
        items: Cart.getItems().map(it => ({ itemId: it.id, quantity: it.quantity })),
        specialInstructions: document.getElementById('instructions-input').value.trim(),
        total_amount: Cart.getTotalAmount(), // Tell backend the amount
        payment_status: 'Paid'               // Tell backend it is paid
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
        
        // Reset payment button for next time
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

  // -------------------------

  function renderConfirmation(order) {
    document.getElementById('confirm-order-no').textContent = `Order #${order.id}`;
    document.getElementById('confirm-room-line').textContent = `Room No: ${order.roomNumber}`;
    document.getElementById('confirm-rows').innerHTML = order.items.map(it => `
      <div class="summary-row"><span>${escapeHtml(it.name)} × ${it.quantity}</span><span>₹${it.amount}</span></div>
    `).join('');
    document.getElementById('confirm-total').textContent = `₹${order.total}`;

    const statusEl = document.getElementById('confirm-status');
    statusEl.className = 'status-pill status-pending';
    statusEl.textContent = '🟡 Pending';
  }

  document.getElementById('new-order-btn').addEventListener('click', () => {
    state.activeCategory = 'All';
    state.activeFilter = 'all';
    document.getElementById('instructions-input').value = '';
    renderCategories();
    renderMenu();
    showScreen('menu');
  });

  // ---------- Utility ----------
  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  }
})();