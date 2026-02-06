const api = {
  async get(path) {
    const res = await fetch(`/api${path}`);
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },
  async post(path, payload) {
    const res = await fetch(`/api${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }
};

const state = {
  items: [],
  cart: [],
  config: null,
  shiftId: '',
  scanBuffer: '',
  lastScanTime: 0
};

const el = (id) => document.getElementById(id);

function renderItems(list) {
  const container = el('items');
  container.innerHTML = '';
  list.forEach(item => {
    const card = document.createElement('div');
    card.className = 'item';
    card.innerHTML = `
      <h3>${item.name}</h3>
      <small>${item.sku}</small>
      <div>${item.price_usd || 0} USD · ${item.price_lbp || 0} LBP</div>
    `;
    card.addEventListener('click', () => addToCart(item));
    container.appendChild(card);
  });
}

function renderCart() {
  const container = el('cart');
  container.innerHTML = '';
  state.cart.forEach(item => {
    const row = document.createElement('div');
    row.className = 'cart-item';
    row.innerHTML = `
      <span>${item.name}</span>
      <div class="qty">
        <button data-id="${item.id}" data-action="dec">-</button>
        <span>${item.qty}</span>
        <button data-id="${item.id}" data-action="inc">+</button>
      </div>
    `;
    row.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', () => {
        const action = btn.dataset.action;
        if (action === 'inc') item.qty += 1;
        if (action === 'dec') item.qty = Math.max(1, item.qty - 1);
        renderCart();
        updateTotals();
      });
    });
    container.appendChild(row);
  });
}

function updateTotals() {
  const totalUsd = state.cart.reduce((sum, i) => sum + (i.price_usd || 0) * i.qty, 0);
  const rate = Number(el('rate').value || state.config?.exchange_rate || 0);
  const totalLbp = state.cart.reduce((sum, i) => {
    const line = (i.price_lbp || 0) * i.qty;
    if (line === 0 && rate) {
      return sum + (i.price_usd || 0) * i.qty * rate;
    }
    return sum + line;
  }, 0);
  el('totalUsd').textContent = totalUsd.toFixed(2);
  el('totalLbp').textContent = Math.round(totalLbp).toLocaleString();
  const loyaltyRate = Number(state.config?.loyalty_rate || 0);
  el('loyaltyPoints').textContent = loyaltyRate ? (totalUsd * loyaltyRate).toFixed(2) : '0';
}

function addToCart(item) {
  const existing = state.cart.find(i => i.id === item.id);
  if (existing) {
    existing.qty += 1;
  } else {
    state.cart.push({ ...item, qty: 1 });
  }
  renderCart();
  updateTotals();
}

async function loadItems() {
  const data = await api.get('/items');
  state.items = data.items || [];
  renderItems(state.items);
}

function filterItems() {
  const term = el('search').value.toLowerCase();
  const list = state.items.filter(i =>
    i.name.toLowerCase().includes(term) ||
    (i.sku || '').toLowerCase().includes(term) ||
    (i.barcode || '').toLowerCase().includes(term)
  );
  renderItems(list);
}

async function loadConfig() {
  const data = await api.get('/config');
  state.config = data;
  state.shiftId = data.shift_id || '';
  el('rate').value = data.exchange_rate || 0;
  el('currency').value = data.pricing_currency || 'USD';
}

function renderShiftStatus(shift) {
  const status = el('shiftStatus');
  if (!shift) {
    status.textContent = 'No open shift';
    return;
  }
  status.textContent = `Open · ${shift.id || ''}`;
}

async function loadShiftStatus() {
  try {
    const res = await api.post('/shift/status', {});
    const shift = res.shift || null;
    state.shiftId = shift ? shift.id : '';
    renderShiftStatus(shift);
  } catch (err) {
    el('shiftStatus').textContent = `Shift status error`;
  }
}

async function openShift() {
  const payload = {
    opening_cash_usd: Number(el('shiftOpenUsd').value || 0),
    opening_cash_lbp: Number(el('shiftOpenLbp').value || 0)
  };
  try {
    const res = await api.post('/shift/open', payload);
    const shift = res.shift || null;
    state.shiftId = shift ? shift.id : '';
    renderShiftStatus(shift);
  } catch (err) {
    el('shiftStatus').textContent = `Open failed`;
  }
}

async function closeShift() {
  const payload = {
    closing_cash_usd: Number(el('shiftCloseUsd').value || 0),
    closing_cash_lbp: Number(el('shiftCloseLbp').value || 0)
  };
  try {
    const res = await api.post('/shift/close', payload);
    state.shiftId = '';
    renderShiftStatus(null);
    if (res.shift) {
      el('shiftStatus').textContent = `Closed · variance USD ${res.shift.variance_usd || 0}`;
    }
  } catch (err) {
    el('shiftStatus').textContent = `Close failed`;
  }
}

async function syncPull() {
  el('syncStatus').textContent = 'Pulling...';
  try {
    const res = await api.post('/sync/pull', {});
    await loadItems();
    await loadConfig();
    el('syncStatus').textContent = `Pulled ${res.items || 0} items`;
  } catch (err) {
    el('syncStatus').textContent = `Error: ${err.message}`;
  }
}

async function syncPush() {
  el('syncStatus').textContent = 'Syncing...';
  try {
    const res = await api.post('/sync/push', {});
    el('syncStatus').textContent = `Sent ${res.sent || 0}`;
  } catch (err) {
    el('syncStatus').textContent = `Error: ${err.message}`;
  }
}

async function completeSale() {
  if (!state.cart.length) return;
  if (!state.shiftId) {
    el('saleStatus').textContent = 'Open a shift before sales';
    return;
  }
  if (el('paymentMethod').value === 'credit' && !el('customerId').value) {
    el('saleStatus').textContent = 'Credit sale requires customer ID';
    return;
  }
  const payload = {
    cart: state.cart.map(i => ({
      id: i.id,
      qty: i.qty,
      price_usd: i.price_usd || 0,
      price_lbp: i.price_lbp || 0
    })),
    exchange_rate: Number(el('rate').value || 0),
    pricing_currency: el('currency').value,
    customer_id: el('customerId').value || null,
    payment_method: el('paymentMethod').value || 'cash',
    shift_id: state.shiftId
  };
  const status = el('saleStatus');
  status.textContent = 'Saving...';
  try {
    const res = await api.post('/sale', payload);
    status.textContent = `Saved offline: ${res.event_id}`;
    state.cart = [];
    renderCart();
    updateTotals();
  } catch (err) {
    status.textContent = `Error: ${err.message}`;
  }
}

async function completeReturn() {
  if (!state.cart.length) return;
  if (!state.shiftId) {
    el('saleStatus').textContent = 'Open a shift before returns';
    return;
  }
  const payload = {
    cart: state.cart.map(i => ({
      id: i.id,
      qty: i.qty,
      price_usd: i.price_usd || 0,
      price_lbp: i.price_lbp || 0
    })),
    exchange_rate: Number(el('rate').value || 0),
    pricing_currency: el('currency').value,
    invoice_id: null,
    refund_method: el('paymentMethod').value || 'cash',
    shift_id: state.shiftId
  };
  const status = el('saleStatus');
  status.textContent = 'Saving return...';
  try {
    const res = await api.post('/return', payload);
    status.textContent = `Return saved offline: ${res.event_id}`;
    state.cart = [];
    renderCart();
    updateTotals();
  } catch (err) {
    status.textContent = `Error: ${err.message}`;
  }
}

function bind() {
  el('search').addEventListener('input', filterItems);
  el('syncPull').addEventListener('click', syncPull);
  el('syncPush').addEventListener('click', syncPush);
  el('openShift').addEventListener('click', openShift);
  el('closeShift').addEventListener('click', closeShift);
  el('clear').addEventListener('click', () => {
    state.cart = [];
    renderCart();
    updateTotals();
  });
  el('complete').addEventListener('click', completeSale);
  el('return').addEventListener('click', completeReturn);

  document.addEventListener('keydown', (event) => {
    const now = Date.now();
    const gap = now - state.lastScanTime;
    state.lastScanTime = now;
    if (gap > 100) {
      state.scanBuffer = '';
    }
    if (event.key === 'Enter') {
      const code = state.scanBuffer.trim();
      state.scanBuffer = '';
      if (!code) return;
      const match = state.items.find(i => (i.barcode || '').toLowerCase() === code.toLowerCase() || (i.sku || '').toLowerCase() === code.toLowerCase());
      if (match) {
        addToCart(match);
      }
      return;
    }
    if (event.key.length === 1) {
      state.scanBuffer += event.key;
    }
  });
}

loadConfig().then(() => {
  renderShiftStatus(state.shiftId ? { id: state.shiftId } : null);
  loadShiftStatus();
  loadItems();
});
bind();
