<div class="shell">
  <div class="surfaceGlow" aria-hidden="true"></div>

  <header class="top">
    <section class="brandBlock">
      <div class="brandBadge">WH</div>
      <div>
        <div class="brandTitle">Wholesale POS</div>
        <div class="brandSub">compact checkout-first workflow · dual-ledger safe mode</div>
        <div id="status" class="srOnly" aria-live="polite"></div>
      </div>
    </section>

    <section class="topControls">
      <label class="pill">
        Checkout mode
        <select id="invoiceCompany" aria-label="Checkout mode">
          <option value="auto" selected>Auto (mixed-safe)</option>
          <option value="unofficial">Force Unofficial</option>
          <option value="official">Force Official</option>
        </select>
      </label>
      <button id="syncBtn" class="btn">Sync both</button>
      <button id="pushBtn" class="btn ghost">Push both</button>
      <button id="reconnectBothBtn" class="btn ghost">Reconnect</button>
      <button id="themeToggle" class="btn ghost">Dark Theme</button>
      <button id="densityToggle" class="btn ghost">Density: Auto</button>
      <button id="settingsBtn" class="btn ghost">Settings</button>
      <button id="loginBtn" class="btn ghost">Cashier PIN</button>
      <button id="managerBtn" class="btn ghost">Manager</button>
    </section>

    <section class="edgeBadges">
      <span id="edgeUnofficial" class="edgeBadge edgeUnknown">Unofficial…</span>
      <span id="edgeOfficial" class="edgeBadge edgeUnknown">Official…</span>
    </section>
  </header>

  <section class="statusStrip">
    <div class="leftFacts">
      <span id="statusPill" class="statusPill info" aria-live="polite">Loading…</span>
      <span id="cartSummary" class="factPill">Cart: 0 line(s)</span>
      <span id="activeCustomer" class="factPill">Customer: Guest</span>
      <span id="queueCount" class="factPill">Open Drafts: 0</span>
    </div>
    <div class="rightHints">
      <span class="kbd">⌨ <strong>Cmd/Ctrl + K</strong> focus scan</span>
      <span class="kbd">⌨ <strong>Enter</strong> add match</span>
      <span class="kbd">⌨ <strong>Cmd/Ctrl + Enter</strong> pay</span>
    </div>
  </section>

  <main class="layout">
    <section class="panel panelLeft">
      <div class="panelTitleWrap">
        <h2>Draft workspace</h2>
      </div>
      <div class="inlineActions">
        <button id="holdBtn" class="btn ghost" type="button">Save Draft</button>
        <button id="openCartBtn" class="btn ghost" type="button">Open Cart</button>
      </div>
      <div class="sectionTitle">Draft queue</div>
      <div id="orderQueue" class="orderQueue" aria-live="polite"></div>
    </section>

    <section class="panel panelCenter">
      <div class="panelHead">
        <h2>Scan / search</h2>
        <div class="miniActions">
          <button id="focusScanBtn" class="btn ghost tiny" type="button">Focus</button>
          <button id="clearSearchBtn" class="btn ghost tiny" type="button">Clear</button>
        </div>
      </div>

      <div class="scanRow">
        <input id="scan" type="text" placeholder="Scan barcode or search SKU / name" autocomplete="off" />
        <button id="addBtn" class="btn" type="button">Add</button>
      </div>

      <div id="searchChips" class="chipRow" role="list">
        <button class="chip active" type="button" data-filter="all">All</button>
        <button class="chip" type="button" data-filter="quick">Quick</button>
        <button class="chip" type="button" data-filter="recent">Recent</button>
        <button class="chip" type="button" data-filter="popular">Popular</button>
      </div>

      <div id="scanMeta" class="scanMeta" aria-live="polite">Waiting for input…</div>
      <p class="hint">Tip: scanner works anywhere on screen. Keep one eye on the item list.</p>
      <div id="results" class="results"></div>
    </section>

    <section class="panel panelRight">
      <div class="panelHead">
        <h2>Current sale</h2>
        <label class="check">
          <input id="flagOfficial" type="checkbox" />
          <span>Issue as Official for review</span>
        </label>
      </div>

      <div id="cart" class="cart"></div>

      <div class="totals">
        <div class="row"><span>Items</span><strong id="tItems">0</strong></div>
        <div class="row"><span>Invoice handling</span><strong id="tInvoiceCompany">Auto</strong></div>
        <div class="row"><span>Subtotal (USD)</span><strong id="tSubtotal">0.00</strong></div>
        <div class="row"><span>VAT (USD)</span><strong id="tVat">0.00</strong></div>
        <div class="row total"><span>Total (USD)</span><strong id="tTotal">0.00</strong></div>
        <div id="splitTotals" class="splitTotals hidden" aria-label="Split invoice totals (estimated)">
          <div class="row split"><span>Official total</span><strong id="tTotalOfficial">0.00</strong></div>
          <div class="row split"><span>Unofficial total</span><strong id="tTotalUnofficial">0.00</strong></div>
        </div>
      </div>

      <div class="payArea">
        <label class="pill">
          Customer ID (optional)
          <input id="customerId" type="text" placeholder="Leave blank for guest" />
        </label>
        <div class="custLookup">
          <input id="customerQuery" type="text" placeholder="Search customer name / phone" />
          <button id="customerSearchBtn" class="btn ghost" type="button">Find</button>
          <button id="customerCreateToggleBtn" class="btn ghost" type="button">New</button>
        </div>

        <div id="customerCreatePanel" class="custCreate hidden">
          <div class="custCreateGrid">
            <input id="customerCreateName" type="text" placeholder="Customer name *" />
            <input id="customerCreatePhone" type="text" placeholder="Phone" />
            <input id="customerCreateEmail" type="email" placeholder="Email" />
          </div>
          <div class="custCreateActions">
            <button id="customerCreateBtn" class="btn" type="button">Create</button>
            <button id="customerCreateCancelBtn" class="btn ghost" type="button">Cancel</button>
          </div>
          <div id="customerCreateStatus" class="customerStatus" aria-live="polite"></div>
        </div>

        <div id="customerResults" class="custResults"></div>

        <label class="pill paymentLabel">
          Payment
          <select id="payment">
            <option value="cash" selected>Cash</option>
            <option value="card">Card</option>
            <option value="transfer">Transfer</option>
            <option value="credit">Credit</option>
          </select>
        </label>

        <div class="payActions">
          <button id="payBtn" class="btn primary">Pay + Print</button>
          <button id="receiptBtn" class="btn ghost">Last receipt</button>
          <button id="clearCartBtn" class="btn ghost" type="button">Clear</button>
        </div>
      </div>
    </section>
  </main>

  <footer class="footer">This is a local-first POS console for wholesale retail. Actions are still routed to official/unofficial agents.</footer>

  <div id="settingsBackdrop" class="backdrop hidden"></div>
  <div id="settingsModal" class="modal hidden" role="dialog" aria-modal="true" aria-labelledby="settingsTitle">
    <div class="modalHeader">
      <div>
        <h3 id="settingsTitle">POS Connection Settings</h3>
        <p>Use quick connect or edit agent settings directly. Device token is update-only.</p>
      </div>
    </div>
    <div class="modalBody">
      <section class="cfgCard">
        <h4>Wholesale UI</h4>
        <label class="cfgField">Other agent URL<input id="otherAgentUrl" type="text" value="http://localhost:7072" /></label>
      </section>

      <section class="quickCard">
        <h4>Quick Connect</h4>
        <div class="quickGrid">
          <label class="cfgField">
            Target Agent
            <select id="quickAgent">
              <option value="official">Official Agent</option>
              <option value="unofficial">Unofficial Agent</option>
            </select>
          </label>
          <label class="cfgField">API Base URL<input id="quickApiBaseUrl" type="text" placeholder="https://api.example.com" /></label>
          <label class="cfgField">Email<input id="quickEmail" type="email" placeholder="admin@example.com" autocomplete="username" /></label>
          <label class="cfgField">Password<input id="quickPassword" type="password" placeholder="Password" autocomplete="current-password" /></label>
          <label class="cfgField">MFA Code<input id="quickMfaCode" type="text" placeholder="123456" /></label>
          <button id="quickSignIn" class="btn" type="button">Sign In</button>
        </div>
        <div class="quickGrid quickGridSecond">
          <label class="cfgField">
            Company
            <select id="quickCompany"><option value="">Select a company...</option></select>
          </label>
          <label class="cfgField">
            Branch (optional)
            <select id="quickBranch"><option value="">None</option></select>
          </label>
          <label class="cfgField">Device Code<input id="quickDeviceCode" type="text" placeholder="POS-01" /></label>
          <label class="cfgField quickCheckField">
            <span>Token behavior</span>
            <label class="checkInline"><input id="quickResetToken" type="checkbox" checked /> Reset token if device already exists</label>
          </label>
          <button id="quickApply" class="btn primary" type="button">Register + Apply</button>
        </div>
        <div id="quickStatus" class="quickStatus" aria-live="polite"></div>
      </section>

      <div class="twoCols">
        <section class="cfgCard">
          <h4>Official Agent</h4>
          <label class="cfgField">API Base URL<input id="officialApiBaseUrl" type="text" placeholder="https://api.example.com" /></label>
          <label class="cfgField">Company ID<input id="officialCompanyId" type="text" placeholder="UUID" /></label>
          <label class="cfgField">Branch ID<input id="officialBranchId" type="text" placeholder="UUID (optional)" /></label>
          <label class="cfgField">Device Code<input id="officialDeviceCode" type="text" placeholder="POS-01" /></label>
          <label class="cfgField">Device ID<input id="officialDeviceId" type="text" placeholder="UUID" /></label>
          <label class="cfgField">Device Token (new)<input id="officialDeviceToken" type="password" placeholder="Leave blank to keep current" /></label>
          <label class="cfgField">Shift ID<input id="officialShiftId" type="text" placeholder="UUID (optional)" /></label>
        </section>
        <section class="cfgCard">
          <h4>Unofficial Agent</h4>
          <label class="cfgField">API Base URL<input id="unofficialApiBaseUrl" type="text" placeholder="https://api.example.com" /></label>
          <label class="cfgField">Company ID<input id="unofficialCompanyId" type="text" placeholder="UUID" /></label>
          <label class="cfgField">Branch ID<input id="unofficialBranchId" type="text" placeholder="UUID (optional)" /></label>
          <label class="cfgField">Device Code<input id="unofficialDeviceCode" type="text" placeholder="POS-02" /></label>
          <label class="cfgField">Device ID<input id="unofficialDeviceId" type="text" placeholder="UUID" /></label>
          <label class="cfgField">Device Token (new)<input id="unofficialDeviceToken" type="password" placeholder="Leave blank to keep current" /></label>
          <label class="cfgField">Shift ID<input id="unofficialShiftId" type="text" placeholder="UUID (optional)" /></label>
        </section>
      </div>
    </div>
    <div id="settingsStatus" class="modalStatus" aria-live="polite"></div>
    <div class="modalActions">
      <button id="settingsCancel" class="btn ghost" type="button">Cancel</button>
      <button id="settingsSave" class="btn primary" type="button">Save Settings</button>
    </div>
  </div>

  <div id="cartBackdrop" class="backdrop hidden"></div>
  <div id="cartModal" class="modal hidden" role="dialog" aria-modal="true" aria-labelledby="cartTitle">
    <div class="modalHeader">
      <div>
        <h3 id="cartTitle">Cart (Full)</h3>
      </div>
    </div>
    <div class="modalBody">
      <div id="cartFull" class="cart cartFull"></div>
    </div>
    <div class="modalActions">
      <button id="cartCloseBtn" class="btn ghost" type="button">Close</button>
    </div>
  </div>

  <div id="managerBackdrop" class="backdrop hidden"></div>
  <div id="managerModal" class="modal hidden" role="dialog" aria-modal="true" aria-labelledby="managerTitle">
    <div class="modalHeader">
      <div>
        <h3 id="managerTitle">Manager access</h3>
      </div>
    </div>
    <div class="modalBody">
      <section class="cfgCard">
        <h4>Admin Portal</h4>
        <label class="cfgField">Admin URL<input id="adminUrl" type="text" placeholder="https://admin.example.com" /></label>
        <div class="row">
          <button id="adminSuggestBtn" class="btn ghost" type="button">Suggest</button>
          <button id="adminOpenBtn" class="btn primary" type="button" disabled>Open</button>
        </div>
        <div id="managerStatus" class="quickStatus" aria-live="polite"></div>
      </section>

      <section class="cfgCard">
        <h4>Manager PIN</h4>
        <div class="quickGrid">
          <label class="cfgField">PIN<input id="managerPin" type="password" placeholder="PIN" autocomplete="off" /></label>
          <button id="managerUnlockBtn" class="btn" type="button">Unlock</button>
        </div>
        <div class="quickGrid quickGridSecond">
          <label class="cfgField">New PIN<input id="managerPinNew" type="password" placeholder="New PIN" autocomplete="off" /></label>
          <label class="cfgField">Confirm<input id="managerPinNew2" type="password" placeholder="Confirm PIN" autocomplete="off" /></label>
          <button id="managerSetPinBtn" class="btn ghost" type="button">Set PIN</button>
        </div>
        <div class="row">
          <button id="managerLockBtn" class="btn ghost" type="button">Lock</button>
          <button id="managerResetPinBtn" class="btn ghost" type="button">Reset PIN</button>
        </div>
      </section>
    </div>
    <div class="modalActions">
    </div>
  </div>
</div>
