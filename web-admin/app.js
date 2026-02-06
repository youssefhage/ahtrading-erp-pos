const storage = {
  get(key, fallback) {
    return localStorage.getItem(key) || fallback;
  },
  set(key, value) {
    localStorage.setItem(key, value);
  },
  remove(key) {
    localStorage.removeItem(key);
  }
};

const api = {
  base() {
    return storage.get('apiBase', 'http://localhost:8000');
  },
  companyId() {
    return storage.get('companyId', '');
  },
  token() {
    return storage.get('authToken', '');
  },
  headers() {
    const companyId = api.companyId();
    const token = api.token();
    const headers = { 'Content-Type': 'application/json' };
    if (companyId) headers['X-Company-Id'] = companyId;
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return headers;
  },
  async get(path) {
    const res = await fetch(`${api.base()}${path}`, { headers: api.headers() });
    if (!res.ok) throw new Error(await res.text());
    return res;
  },
  async post(path, body) {
    const res = await fetch(`${api.base()}${path}`, { method: 'POST', headers: api.headers(), body: JSON.stringify(body) });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },
  async patch(path, body) {
    const res = await fetch(`${api.base()}${path}`, { method: 'PATCH', headers: api.headers(), body: JSON.stringify(body) });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }
};

const el = (id) => document.getElementById(id);

function renderTable(target, rows) {
  if (!rows || rows.length === 0) {
    target.textContent = 'No data';
    return;
  }
  const headers = Object.keys(rows[0]);
  const table = document.createElement('table');
  const thead = document.createElement('thead');
  const trHead = document.createElement('tr');
  headers.forEach(h => {
    const th = document.createElement('th');
    th.textContent = h;
    trHead.appendChild(th);
  });
  thead.appendChild(trHead);
  const tbody = document.createElement('tbody');
  rows.forEach(row => {
    const tr = document.createElement('tr');
    headers.forEach(h => {
      const td = document.createElement('td');
      const val = row[h];
      td.textContent = val === null || val === undefined ? '' : String(val);
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  table.appendChild(thead);
  table.appendChild(tbody);
  target.innerHTML = '';
  target.appendChild(table);
}

function setStatus(text) {
  const status = el('statusBlock');
  if (status) status.textContent = text;
}

function formatNumber(value) {
  const number = Number(value || 0);
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(number);
}

function formatCurrency(value, code) {
  if (code === 'USD') {
    return `$${formatNumber(value)}`;
  }
  return `LBP ${formatNumber(value)}`;
}

function setMetric(id, value, formatter = formatNumber) {
  const target = el(id);
  if (!target) return;
  target.textContent = formatter(value);
}

function loadConnection() {
  el('apiBase').value = api.base();
  el('companyId').value = api.companyId();
  const sessionCompany = el('sessionCompany');
  if (sessionCompany) sessionCompany.value = api.companyId();
}

async function testConnection() {
  const status = el('connStatus');
  status.textContent = 'Testing...';
  try {
    const res = await fetch(`${api.base()}/health`);
    if (!res.ok) throw new Error('API not reachable');
    status.textContent = 'Connected';
  } catch (err) {
    status.textContent = `Error: ${err.message}`;
  }
}

function showSection(name) {
  document.querySelectorAll('.section').forEach(section => {
    section.classList.toggle('active', section.dataset.section === name);
  });
  document.querySelectorAll('.nav__item').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.section === name);
  });
  const label = document.querySelector(`.nav__item[data-section=\"${name}\"]`)?.textContent;
  el('pageTitle').textContent = label || name.replace('-', ' ').replace(/\\b\\w/g, c => c.toUpperCase());
}

async function login() {
  const status = el('loginStatus');
  status.textContent = 'Logging in...';
  try {
    const res = await api.post('/auth/login', {
      email: el('loginEmail').value,
      password: el('loginPassword').value
    });
    storage.set('authToken', res.token);
    status.textContent = `Logged in. Companies: ${res.companies.join(', ')}`;
    renderTable(el('sessionInfo'), [{ token: res.token, user_id: res.user_id }]);
    loadMetrics();
  } catch (err) {
    status.textContent = `Error: ${err.message}`;
  }
}

async function logout() {
  try {
    await api.post('/auth/logout', {});
  } catch (err) {
    // ignore
  }
  storage.remove('authToken');
  const status = el('loginStatus');
  if (status) status.textContent = 'Logged out';
  renderTable(el('sessionInfo'), []);
}

function setCompanyFromSession() {
  const value = el('sessionCompany').value.trim();
  if (value) storage.set('companyId', value);
  el('companyId').value = value;
  loadMetrics();
}

async function loadRates() {
  const res = await api.get('/config/exchange-rates');
  const data = await res.json();
  renderTable(el('ratesList'), data.rates);
}

async function loadMetrics() {
  if (!api.companyId()) {
    setStatus('Set company ID');
    return;
  }
  try {
    const res = await api.get('/reports/metrics');
    const data = await res.json();
    const metrics = data.metrics || {};
    setMetric('metricSalesUsd', metrics.sales_today_usd, (v) => formatCurrency(v, 'USD'));
    setMetric('metricSalesLbp', metrics.sales_today_lbp, (v) => formatCurrency(v, 'LBP'));
    setMetric('metricPurchasesUsd', metrics.purchases_today_usd, (v) => formatCurrency(v, 'USD'));
    setMetric('metricPurchasesLbp', metrics.purchases_today_lbp, (v) => formatCurrency(v, 'LBP'));
    setMetric('metricArUsd', metrics.ar_usd, (v) => formatCurrency(v, 'USD'));
    setMetric('metricArLbp', metrics.ar_lbp, (v) => formatCurrency(v, 'LBP'));
    setMetric('metricApUsd', metrics.ap_usd, (v) => formatCurrency(v, 'USD'));
    setMetric('metricApLbp', metrics.ap_lbp, (v) => formatCurrency(v, 'LBP'));
    setMetric('metricStockUsd', metrics.stock_value_usd, (v) => formatCurrency(v, 'USD'));
    setMetric('metricStockLbp', metrics.stock_value_lbp, (v) => formatCurrency(v, 'LBP'));
    setMetric('metricLowStock', metrics.low_stock_count, formatNumber);
    setMetric('metricItems', metrics.items_count, formatNumber);
    setMetric('metricCustomers', metrics.customers_count, formatNumber);
    setMetric('metricSuppliers', metrics.suppliers_count, formatNumber);
    setStatus('Live');
  } catch (err) {
    setStatus('Metrics unavailable');
  }
}

async function addRate() {
  const payload = {
    rate_date: el('rateDate').value,
    rate_type: el('rateType').value || 'market',
    usd_to_lbp: Number(el('usdToLbp').value || 0)
  };
  await api.post('/config/exchange-rates', payload);
  await loadRates();
}

async function loadTax() {
  const res = await api.get('/config/tax-codes');
  const data = await res.json();
  renderTable(el('taxList'), data.tax_codes);
}

async function addTax() {
  const payload = {
    name: el('taxName').value,
    rate: Number(el('taxRate').value || 0),
    tax_type: 'vat',
    reporting_currency: 'LBP'
  };
  await api.post('/config/tax-codes', payload);
  await loadTax();
}

async function loadPaymentMethods() {
  const res = await api.get('/config/payment-methods');
  const data = await res.json();
  renderTable(el('paymentMethodsList'), data.methods);
}

async function savePaymentMethod() {
  const payload = {
    method: el('payMethod').value,
    role_code: el('payRoleCode').value
  };
  await api.post('/config/payment-methods', payload);
  await loadPaymentMethods();
}

async function loadDevices() {
  const res = await api.get('/pos/devices');
  const data = await res.json();
  renderTable(el('devicesList'), data.devices);
}

async function registerDevice() {
  if (!api.companyId()) {
    setStatus('Set company ID');
    return;
  }
  const code = el('deviceCode').value.trim();
  if (!code) return;
  const branchId = el('deviceBranchId').value.trim();
  const query = new URLSearchParams();
  query.append('company_id', api.companyId());
  query.append('device_code', code);
  if (branchId) query.append('branch_id', branchId);
  const res = await api.post(`/pos/devices/register?${query.toString()}`, {});
  renderTable(el('deviceRegisterOutput'), [res]);
  await loadDevices();
}

async function resetDeviceToken() {
  const deviceId = el('deviceResetId').value.trim();
  if (!deviceId) return;
  const res = await api.post(`/pos/devices/${deviceId}/reset-token`, {});
  renderTable(el('deviceResetOutput'), [res]);
  await loadDevices();
}

async function loadItems() {
  const res = await api.get('/items');
  const data = await res.json();
  renderTable(el('itemsList'), data.items);
}

async function addItem() {
  const payload = {
    sku: el('itemSku').value,
    name: el('itemName').value,
    unit_of_measure: el('itemUom').value || 'pcs',
    barcode: el('itemBarcode').value || null,
    reorder_point: Number(el('itemReorderPoint').value || 0),
    reorder_qty: Number(el('itemReorderQty').value || 0)
  };
  await api.post('/items', payload);
  await loadItems();
}

async function addPrice() {
  const payload = {
    price_usd: Number(el('priceUsd').value || 0),
    price_lbp: Number(el('priceLbp').value || 0),
    effective_from: el('priceFrom').value
  };
  await api.post(`/items/${el('priceItemId').value}/prices`, payload);
}

async function loadCustomers() {
  const res = await api.get('/customers');
  const data = await res.json();
  renderTable(el('customersList'), data.customers);
}

async function addCustomer() {
  const payload = {
    name: el('customerName').value,
    phone: el('customerPhone').value || null,
    email: el('customerEmail').value || null,
    credit_limit_usd: Number(el('customerLimitUsd').value || 0),
    credit_limit_lbp: Number(el('customerLimitLbp').value || 0)
  };
  await api.post('/customers', payload);
  await loadCustomers();
}

async function loadSuppliers() {
  const res = await api.get('/suppliers');
  const data = await res.json();
  renderTable(el('suppliersList'), data.suppliers);
}

async function addSupplier() {
  const payload = {
    name: el('supplierName').value,
    phone: el('supplierPhone').value || null,
    email: el('supplierEmail').value || null
  };
  await api.post('/suppliers', payload);
  await loadSuppliers();
}

async function mapSupplierItem() {
  const supplierId = el('mapSupplierId').value;
  const payload = {
    item_id: el('mapItemId').value,
    is_primary: el('mapPrimary').value === 'true',
    lead_time_days: Number(el('mapLead').value || 0),
    min_order_qty: Number(el('mapMinQty').value || 0),
    last_cost_usd: Number(el('mapCostUsd').value || 0),
    last_cost_lbp: Number(el('mapCostLbp').value || 0)
  };
  await api.post(`/suppliers/${supplierId}/items`, payload);
}

async function loadStock() {
  const query = new URLSearchParams();
  if (el('stockItemId').value) query.append('item_id', el('stockItemId').value);
  if (el('stockWarehouseId').value) query.append('warehouse_id', el('stockWarehouseId').value);
  const res = await api.get(`/inventory/stock?${query.toString()}`);
  const data = await res.json();
  renderTable(el('stockList'), data.stock);
}

async function adjustStock() {
  const payload = {
    item_id: el('adjItemId').value,
    warehouse_id: el('adjWarehouseId').value,
    qty_in: Number(el('adjQtyIn').value || 0),
    qty_out: Number(el('adjQtyOut').value || 0),
    unit_cost_usd: Number(el('adjCostUsd').value || 0),
    unit_cost_lbp: Number(el('adjCostLbp').value || 0)
  };
  await api.post('/inventory/adjust', payload);
  await loadStock();
}

async function loadSales() {
  const res = await api.get('/sales/invoices');
  const data = await res.json();
  renderTable(el('salesList'), data.invoices);
}

async function loadReturns() {
  const res = await api.get('/sales/returns');
  const data = await res.json();
  renderTable(el('returnsList'), data.returns);
}

async function postPayment() {
  const payload = {
    invoice_id: el('payInvoiceId').value,
    method: el('payMethod').value,
    amount_usd: Number(el('payUsd').value || 0),
    amount_lbp: Number(el('payLbp').value || 0)
  };
  await api.post('/sales/payments', payload);
}

async function loadOrders() {
  const res = await api.get('/purchases/orders');
  const data = await res.json();
  renderTable(el('ordersList'), data.orders);
}

async function loadReceipts() {
  const res = await api.get('/purchases/receipts');
  const data = await res.json();
  renderTable(el('receiptsList'), data.receipts);
}

async function loadSupplierInvoices() {
  const res = await api.get('/purchases/invoices');
  const data = await res.json();
  renderTable(el('supplierInvoicesList'), data.invoices);
}

async function createPO() {
  const qty = Number(el('poQty').value || 0);
  const costUsd = Number(el('poCostUsd').value || 0);
  const costLbp = Number(el('poCostLbp').value || 0);
  const payload = {
    supplier_id: el('poSupplierId').value,
    exchange_rate: Number(el('poRate').value || 0),
    lines: [
      {
        item_id: el('poItemId').value,
        qty,
        unit_cost_usd: costUsd,
        unit_cost_lbp: costLbp,
        line_total_usd: qty * costUsd,
        line_total_lbp: qty * costLbp
      }
    ]
  };
  await api.post('/purchases/orders', payload);
  await loadOrders();
}

async function issueIntercompany() {
  const payload = {
    source_company_id: el('icSourceCompany').value,
    issue_company_id: el('icIssueCompany').value,
    sell_company_id: el('icSellCompany').value,
    source_invoice_id: el('icInvoice').value,
    warehouse_id: el('icWarehouse').value,
    lines: [
      {
        item_id: el('icItem').value,
        qty: Number(el('icQty').value || 0),
        unit_cost_usd: Number(el('icCostUsd').value || 0),
        unit_cost_lbp: Number(el('icCostLbp').value || 0)
      }
    ]
  };
  await api.post('/intercompany/issue', payload);
}

async function settleIntercompany() {
  const payload = {
    from_company_id: el('icFromCompany').value,
    to_company_id: el('icToCompany').value,
    amount_usd: Number(el('icAmountUsd').value || 0),
    amount_lbp: Number(el('icAmountLbp').value || 0),
    exchange_rate: Number(el('icRate').value || 0),
    method: el('icMethod').value
  };
  await api.post('/intercompany/settle', payload);
}

async function loadTrial() {
  const res = await api.get('/reports/trial-balance');
  const data = await res.json();
  renderTable(el('trialBalance'), data.trial_balance);
}

async function loadDefaults() {
  const res = await api.get('/config/account-defaults');
  const data = await res.json();
  renderTable(el('defaultsList'), data.defaults);
}

async function saveDefaults() {
  const payload = {
    role_code: el('defRole').value,
    account_code: el('defAccount').value
  };
  await api.post('/config/account-defaults', payload);
  await loadDefaults();
}

async function loadVat() {
  const period = el('vatPeriod').value;
  const format = el('vatFormat').value;
  const query = new URLSearchParams();
  if (period) query.append('period', period);
  if (format) query.append('format', format);
  const res = await api.get(`/reports/vat?${query.toString()}`);
  if (format === 'csv') {
    const text = await res.text();
    el('vatOutput').textContent = text;
  } else {
    const data = await res.json();
    renderTable(el('vatOutput'), data.vat);
  }
}

async function loadGL() {
  const start = el('glStart').value;
  const end = el('glEnd').value;
  const format = el('glFormat').value;
  const query = new URLSearchParams();
  if (start) query.append('start_date', start);
  if (end) query.append('end_date', end);
  if (format) query.append('format', format);
  const res = await api.get(`/reports/gl?${query.toString()}`);
  if (format === 'csv') {
    const text = await res.text();
    el('glOutput').textContent = text;
  } else {
    const data = await res.json();
    renderTable(el('glOutput'), data.gl);
  }
}

async function loadInventoryValuation() {
  const format = el('invFormat').value;
  const query = new URLSearchParams();
  if (format) query.append('format', format);
  const res = await api.get(`/reports/inventory-valuation?${query.toString()}`);
  if (format === 'csv') {
    const text = await res.text();
    el('invOutput').textContent = text;
  } else {
    const data = await res.json();
    renderTable(el('invOutput'), data.inventory);
  }
}

async function loadAI() {
  const res = await api.get('/ai/recommendations');
  const data = await res.json();
  renderTable(el('aiList'), data.recommendations);
}

async function loadAISettings() {
  const res = await api.get('/ai/settings');
  const data = await res.json();
  renderTable(el('aiSettingsList'), data.settings);
}

async function saveAISettings() {
  const payload = {
    agent_code: el('aiAgentCode').value,
    auto_execute: el('aiAuto').value === 'true',
    max_amount_usd: Number(el('aiMaxAmount').value || 0),
    max_actions_per_day: Number(el('aiMaxActions').value || 0)
  };
  await api.post('/ai/settings', payload);
  await loadAISettings();
}

async function loadTemplates() {
  const res = await api.get('/coa/templates');
  const data = await res.json();
  renderTable(el('templatesList'), data.templates);
}

async function cloneTemplate() {
  const payload = {
    template_code: el('cloneTemplateCode').value,
    effective_from: el('cloneEffectiveFrom').value
  };
  await api.post('/coa/clone', payload);
}

async function loadAccounts() {
  const res = await api.get('/coa/accounts');
  const data = await res.json();
  renderTable(el('accountsList'), data.accounts);
}

async function updateAccount() {
  const isPostable = el('accountPostable').value;
  const payload = {
    name_en: el('accountNameEn').value || null
  };
  if (isPostable) payload.is_postable = isPostable === 'true';
  await api.patch(`/coa/accounts/${el('accountId').value}`, payload);
}

async function loadMappings() {
  const res = await api.get('/coa/mappings');
  const data = await res.json();
  renderTable(el('mappingsList'), data.mappings);
}

async function createMapping() {
  const payload = {
    source_account_id: el('mapSourceAccount').value,
    target_template_account_id: el('mapTargetAccount').value,
    mapping_type: 'direct',
    effective_from: el('mapEffectiveFrom').value
  };
  await api.post('/coa/mappings', payload);
  await loadMappings();
}

async function loadUsers() {
  const res = await api.get('/users');
  const data = await res.json();
  renderTable(el('usersList'), data.users);
}

async function createUser() {
  const payload = {
    email: el('userEmail').value,
    password: el('userPassword').value
  };
  await api.post('/users', payload);
  await loadUsers();
}

async function loadRoles() {
  const res = await api.get('/users/roles');
  const data = await res.json();
  renderTable(el('rolesList'), data.roles);
}

async function createRole() {
  const payload = { name: el('roleName').value };
  await api.post('/users/roles', payload);
  await loadRoles();
}

async function assignRole() {
  const payload = {
    user_id: el('assignUserId').value,
    role_id: el('assignRoleId').value
  };
  await api.post('/users/roles/assign', payload);
}

async function loadPermissions() {
  const res = await api.get('/users/permissions');
  const data = await res.json();
  renderTable(el('permissionsList'), data.permissions);
}

async function loadRolePermissions() {
  const roleId = el('permRoleId').value;
  if (!roleId) return;
  const res = await api.get(`/users/roles/${roleId}/permissions`);
  const data = await res.json();
  renderTable(el('rolePermissionsList'), data.permissions);
}

async function assignPermission() {
  const payload = {
    role_id: el('permRoleId').value,
    permission_code: el('permCode').value
  };
  await api.post('/users/roles/permissions', payload);
  await loadRolePermissions();
}

function bind() {
  document.querySelectorAll('.nav__item').forEach(btn => {
    btn.addEventListener('click', () => {
      showSection(btn.dataset.section);
    });
  });
  document.querySelectorAll('[data-open]').forEach(btn => {
    btn.addEventListener('click', () => showSection(btn.dataset.open));
  });
  el('saveConn').addEventListener('click', () => {
    storage.set('apiBase', el('apiBase').value.trim());
    storage.set('companyId', el('companyId').value.trim());
    el('connStatus').textContent = 'Saved';
    loadMetrics();
  });
  el('testConn').addEventListener('click', testConnection);
  el('addRate').addEventListener('click', addRate);
  el('addTax').addEventListener('click', addTax);
  const loadPaymentMethodsBtn = el('loadPaymentMethods');
  if (loadPaymentMethodsBtn) loadPaymentMethodsBtn.addEventListener('click', loadPaymentMethods);
  const savePaymentMethodBtn = el('savePaymentMethod');
  if (savePaymentMethodBtn) savePaymentMethodBtn.addEventListener('click', savePaymentMethod);
  el('registerDevice').addEventListener('click', registerDevice);
  el('resetDeviceToken').addEventListener('click', resetDeviceToken);
  const loadDevicesBtn = el('loadDevices');
  if (loadDevicesBtn) loadDevicesBtn.addEventListener('click', loadDevices);
  el('addItem').addEventListener('click', addItem);
  const loadItemsBtn = el('loadItems');
  if (loadItemsBtn) loadItemsBtn.addEventListener('click', loadItems);
  el('addPrice').addEventListener('click', addPrice);
  el('addCustomer').addEventListener('click', addCustomer);
  const loadCustomersBtn = el('loadCustomers');
  if (loadCustomersBtn) loadCustomersBtn.addEventListener('click', loadCustomers);
  el('addSupplier').addEventListener('click', addSupplier);
  const loadSuppliersBtn = el('loadSuppliers');
  if (loadSuppliersBtn) loadSuppliersBtn.addEventListener('click', loadSuppliers);
  el('mapSupplierItem').addEventListener('click', mapSupplierItem);
  el('loadStock').addEventListener('click', loadStock);
  el('adjustStock').addEventListener('click', adjustStock);
  el('loadSales').addEventListener('click', loadSales);
  el('loadReturns').addEventListener('click', loadReturns);
  el('postPayment').addEventListener('click', postPayment);
  el('loadOrders').addEventListener('click', loadOrders);
  el('loadReceipts').addEventListener('click', loadReceipts);
  el('loadSupplierInvoices').addEventListener('click', loadSupplierInvoices);
  el('createPO').addEventListener('click', createPO);
  el('issueIntercompany').addEventListener('click', issueIntercompany);
  el('settleIntercompany').addEventListener('click', settleIntercompany);
  el('loadTrial').addEventListener('click', loadTrial);
  el('loadDefaults').addEventListener('click', loadDefaults);
  el('saveDefaults').addEventListener('click', saveDefaults);
  el('loadVat').addEventListener('click', loadVat);
  el('loadGL').addEventListener('click', loadGL);
  el('loadInv').addEventListener('click', loadInventoryValuation);
  el('loadAI').addEventListener('click', loadAI);
  el('saveAI').addEventListener('click', saveAISettings);
  el('loadAISettings').addEventListener('click', loadAISettings);
  el('loadTemplates').addEventListener('click', loadTemplates);
  el('cloneTemplate').addEventListener('click', cloneTemplate);
  el('loadAccounts').addEventListener('click', loadAccounts);
  el('updateAccount').addEventListener('click', updateAccount);
  el('createMapping').addEventListener('click', createMapping);
  el('loadMappings').addEventListener('click', loadMappings);
  el('loadUsers').addEventListener('click', loadUsers);
  el('createUser').addEventListener('click', createUser);
  el('loadRoles').addEventListener('click', loadRoles);
  el('createRole').addEventListener('click', createRole);
  el('assignRole').addEventListener('click', assignRole);
  const loadPermissionsBtn = el('loadPermissions');
  if (loadPermissionsBtn) loadPermissionsBtn.addEventListener('click', loadPermissions);
  const assignPermissionBtn = el('assignPermission');
  if (assignPermissionBtn) assignPermissionBtn.addEventListener('click', assignPermission);
  const loadRolePermissionsBtn = el('loadRolePermissions');
  if (loadRolePermissionsBtn) loadRolePermissionsBtn.addEventListener('click', loadRolePermissions);
  el('login').addEventListener('click', login);
  el('logout').addEventListener('click', logout);
  el('setCompany').addEventListener('click', setCompanyFromSession);
}

loadConnection();
bind();
showSection('dashboard');
setStatus('Ready');
loadMetrics();
