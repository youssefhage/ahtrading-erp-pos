/**
 * IndexedDB-based offline cache for POS data.
 *
 * Stores catalog items, customers, cashiers, promotions, barcodes,
 * config, and exchange rates per company so the POS can boot and
 * operate without any network connectivity.
 *
 * Each data type is stored in its own object store, keyed by company.
 * A metadata store tracks when each dataset was last refreshed.
 */

const DB_NAME = "pos_offline_cache";
const DB_VERSION = 1;

const STORES = {
  config: "config",
  items: "items",
  barcodes: "barcodes",
  customers: "customers",
  cashiers: "cashiers",
  promotions: "promotions",
  meta: "meta",
};

let _dbPromise = null;

/**
 * Open (or create) the IndexedDB database.
 * Returns a cached promise so only one connection is made.
 */
function openDB() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB not available"));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      for (const storeName of Object.values(STORES)) {
        if (!db.objectStoreNames.contains(storeName)) {
          db.createObjectStore(storeName);
        }
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      _dbPromise = null;
      reject(request.error);
    };
  });
  return _dbPromise;
}

/**
 * Generic put: write a value into a store under a key.
 */
async function put(storeName, key, value) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const store = tx.objectStore(storeName);
    const req = store.put(value, key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

/**
 * Generic get: read a value from a store by key.
 */
async function get(storeName, key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const store = tx.objectStore(storeName);
    const req = store.get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Save fetched data for a company into IndexedDB.
 * Call this after every successful fetchData round.
 *
 * @param {string} companyKey  "official" or "unofficial"
 * @param {object} data        { config, items, barcodes, customers, cashiers, promotions }
 */
export async function cacheCompanyData(companyKey, data) {
  try {
    const key = String(companyKey || "official");
    const writes = [];
    if (data.config != null) writes.push(put(STORES.config, key, data.config));
    if (data.items != null) writes.push(put(STORES.items, key, data.items));
    if (data.barcodes != null) writes.push(put(STORES.barcodes, key, data.barcodes));
    if (data.customers != null) writes.push(put(STORES.customers, key, data.customers));
    if (data.cashiers != null) writes.push(put(STORES.cashiers, key, data.cashiers));
    if (data.promotions != null) writes.push(put(STORES.promotions, key, data.promotions));
    writes.push(put(STORES.meta, key, { cachedAt: Date.now() }));
    await Promise.all(writes);
  } catch (e) {
    console.warn("[POS] offline cache write failed:", e?.message || e);
  }
}

/**
 * Load cached data for a company from IndexedDB.
 * Returns null for any field that isn't cached yet.
 *
 * @param {string} companyKey  "official" or "unofficial"
 * @returns {Promise<{ config, items, barcodes, customers, cashiers, promotions, cachedAt } | null>}
 */
export async function loadCachedCompanyData(companyKey) {
  try {
    const key = String(companyKey || "official");
    const [config, items, barcodes, customers, cashiers, promotions, meta] = await Promise.all([
      get(STORES.config, key),
      get(STORES.items, key),
      get(STORES.barcodes, key),
      get(STORES.customers, key),
      get(STORES.cashiers, key),
      get(STORES.promotions, key),
      get(STORES.meta, key),
    ]);
    if (!meta) return null;
    return {
      config: config || null,
      items: items || [],
      barcodes: barcodes || [],
      customers: customers || [],
      cashiers: cashiers || [],
      promotions: promotions || [],
      cachedAt: meta?.cachedAt || 0,
    };
  } catch (e) {
    console.warn("[POS] offline cache read failed:", e?.message || e);
    return null;
  }
}

/**
 * Check whether any cached data exists at all.
 */
export async function hasCachedData(companyKey) {
  try {
    const key = String(companyKey || "official");
    const meta = await get(STORES.meta, key);
    return !!meta;
  } catch (_) {
    return false;
  }
}
