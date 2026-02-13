(function uiShellRevamp() {
  if (typeof state === 'undefined' || typeof el === 'undefined') return;

  const orderQueueLimit = 12;

  function cloneTicketLine(line) {
    return {
      key: line?.key || '',
      companyKey: line?.companyKey || 'unofficial',
      agentBase: line?.agentBase || '',
      id: line?.id || '',
      sku: line?.sku || '',
      name: line?.name || '',
      barcode: line?.barcode || '',
      price_usd: Number(line?.price_usd || 0),
      price_lbp: Number(line?.price_lbp || 0),
      qty: Number(line?.qty || 0),
    };
  }

  function fmtMoney(v) {
    return Number(v || 0).toFixed(2);
  }

  function formatTicketTime(ts) {
    const d = new Date(Number(ts || Date.now()));
    return `${String(d.getHours()).padStart(2, '0')} : ${String(d.getMinutes()).padStart(2, '0')}`;
  }

  function renderQueueSummary() {
    const queueBadge = el('queueCount');
    if (queueBadge) {
      const len = Array.isArray(state.ui.orderQueue) ? state.ui.orderQueue.length : 0;
      queueBadge.textContent = `Open Drafts: ${len}`;
    }
  }

  function renderOrderQueue() {
    const root = el('orderQueue');
    if (!root) return;

    const list = Array.isArray(state.ui.orderQueue) ? state.ui.orderQueue : [];
    state.ui.orderQueue = list;
    root.innerHTML = '';
    if (!list.length) {
      root.innerHTML = '<div class="queueEmpty">No queued draft sales.</div>';
      return;
    }

    for (const t of list.slice(0, orderQueueLimit)) {
      const row = document.createElement('div');
      const linesCount = Array.isArray(t.lines)
        ? t.lines.reduce((sum, line) => sum + Number(line.qty || 0), 0)
        : 0;
      row.className = `queueItem ${t.status === 'Paid' ? 'ticketDone' : ''}`;
      row.innerHTML = `
        <div>
          <div class="queueRowTitle">${escapeHtml(t.code || 'Order')}</div>
          <div class="queueMeta">${escapeHtml(t.status || 'Open')} · ${formatTicketTime(t.createdAt)} · ${linesCount} item(s) · $${fmtMoney(t.total)}</div>
        </div>
        <div class="queueActions">
          <button type="button" class="btn ghost tiny" data-ticket="${escapeHtml(String(t.id || ''))}" data-action="resume">Load</button>
          <button type="button" class="btn ghost tiny" data-ticket="${escapeHtml(String(t.id || ''))}" data-action="close">Done</button>
        </div>
      `;
      root.appendChild(row);
    }

    root.querySelectorAll('[data-action]').forEach((btn) => {
      btn.addEventListener('click', (event) => {
        const ticketId = String(event.currentTarget?.getAttribute('data-ticket') || '');
        const action = String(event.currentTarget?.getAttribute('data-action') || '');
        if (!ticketId) return;
        if (action === 'resume') return resumeQueuedTicket(ticketId);
        if (action === 'close') return closeQueuedTicket(ticketId);
      });
    });
  }

  function makeQueueTicket(status, lines) {
    state.ui.lastOrderSeq = Number(state.ui.lastOrderSeq || 0) + 1;
    const total = lines.reduce((sum, line) => sum + Number(line.price_usd || 0) * Number(line.qty || 0), 0);
    return {
      id: `${Date.now()}-${state.ui.lastOrderSeq}`,
      code: `SO-${String(state.ui.lastOrderSeq).padStart(3, '0')}`,
      status,
      createdAt: Date.now(),
      total,
      lines: lines.map(cloneTicketLine),
      customer: state.ui.customerLabel || 'Guest',
      invoiceMode: getInvoiceCompany(),
    };
  }

  function queueCurrentOrder(status, clearCart = false) {
    if (!state.cart.length) {
      setStatus('Cart is empty.', 'warn');
      return;
    }
    const snapshot = state.cart.map(cloneTicketLine);
    const ticket = makeQueueTicket(status, snapshot);
    state.ui.orderQueue = [ticket, ...state.ui.orderQueue];
    if (state.ui.orderQueue.length > orderQueueLimit) {
      state.ui.orderQueue.length = orderQueueLimit;
    }
    if (clearCart) {
      state.cart = [];
      renderCart();
    }
    renderOrderQueue();
    renderQueueSummary();
    setStatus(`Draft ${ticket.code} ${status.toLowerCase()} saved.`, 'ok');
    return ticket;
  }

  function resolveQueueIndex(ticketId) {
    if (!Array.isArray(state.ui.orderQueue)) return -1;
    return state.ui.orderQueue.findIndex((item) => String(item.id || '') === String(ticketId || ''));
  }

  function closeQueuedTicket(ticketId) {
    const i = resolveQueueIndex(ticketId);
    if (i < 0) return;
    state.ui.orderQueue.splice(i, 1);
    renderOrderQueue();
    renderQueueSummary();
    setStatus('Draft removed.', 'warn');
  }

  function resumeQueuedTicket(ticketId) {
    const i = resolveQueueIndex(ticketId);
    if (i < 0) return;
    if (state.cart.length) {
      const ok = window.confirm('Replace current cart with this order?');
      if (!ok) return;
    }
    const ticket = state.ui.orderQueue.splice(i, 1)[0];
    const lines = Array.isArray(ticket?.lines) ? ticket.lines : [];
    state.cart = lines.map(cloneTicketLine);
    renderCart();
    renderOrderQueue();
    renderQueueSummary();
    setStatus(`Loaded ${ticket.code} into cart.`, 'ok');
  }

  function wrapRenderCart() {
    const originalRenderCart = window.renderCart;
    if (typeof originalRenderCart !== 'function') return;
    window.renderCart = function () {
      const r = originalRenderCart.apply(this, arguments);
      renderOrderQueue();
      renderQueueSummary();
      return r;
    };
  }

  function wrapPay() {
    const originalPay = window.pay;
    if (typeof originalPay !== 'function') return;
    window.pay = async function () {
      const linesBefore = state.cart.map(cloneTicketLine);
      const totalBefore = linesBefore.reduce((sum, c) => sum + Number(c.price_usd || 0) * Number(c.qty || 0), 0);
      try {
        const res = await originalPay.apply(this, arguments);
        const paid = makeQueueTicket('Paid', linesBefore);
        paid.total = totalBefore;
        paid.status = 'Paid';
        state.ui.orderQueue = [paid, ...state.ui.orderQueue];
        if (state.ui.orderQueue.length > orderQueueLimit) {
          state.ui.orderQueue.length = orderQueueLimit;
        }
        renderOrderQueue();
        renderQueueSummary();
        return res;
      } catch (e) {
        throw e;
      }
    };
  }

  function wireRevampControls() {
    el('holdBtn')?.addEventListener('click', () => {
      queueCurrentOrder('Draft', true);
    });
  }

  wireRevampControls();
  renderOrderQueue();
  renderQueueSummary();
  wrapRenderCart();
  wrapPay();
})();
