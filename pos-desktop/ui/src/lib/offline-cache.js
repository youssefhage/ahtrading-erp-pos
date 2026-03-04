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

const STORE_NAMES = ["config", "items", "barcodes", "customers", "cashiers", "promotions", "meta"];

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
      for (const name of STORE_NAMES) {
        if (!db.objectStoreNames.contains(name)) {
          db.createObjectStore(name);
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

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Save fetched data for a company into IndexedDB.
 * Uses a single transaction across all stores for atomicity.
 *
 * @param {string} companyKey  "official" or "unofficial"
 * @param {object} data        { config, items, barcodes, customers, cashiers, promotions }
 */
export async function cacheCompanyData(companyKey, data) {
  try {
    const key = String(companyKey || "official");
    const db = await openDB();
    const tx = db.transaction(STORE_NAMES, "readwrite");

    const putInto = (storeName, value) => {
      if (value != null) tx.objectStore(storeName).put(value, key);
    };
    putInto("config", data.config);
    putInto("items", data.items);
    putInto("barcodes", data.barcodes);
    putInto("customers", data.customers);
    putInto("cashiers", data.cashiers);
    putInto("promotions", data.promotions);
    tx.objectStore("meta").put({ cachedAt: Date.now() }, key);

    await new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("Transaction aborted"));
    });
  } catch (e) {
    console.warn("[POS] offline cache write failed:", e?.message || e);
  }
}

/**
 * Load cached data for a company from IndexedDB.
 * Uses a single read transaction for consistency.
 * Returns null if no cached data exists.
 *
 * @param {string} companyKey  "official" or "unofficial"
 * @returns {Promise<{ config, items, barcodes, customers, cashiers, promotions, cachedAt } | null>}
 */
export async function loadCachedCompanyData(companyKey) {
  try {
    const key = String(companyKey || "official");
    const db = await openDB();
    const tx = db.transaction(STORE_NAMES, "readonly");

    const getFrom = (storeName) =>
      new Promise((resolve) => {
        const req = tx.objectStore(storeName).get(key);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(undefined);
      });

    const [config, items, barcodes, customers, cashiers, promotions, meta] = await Promise.all([
      getFrom("config"),
      getFrom("items"),
      getFrom("barcodes"),
      getFrom("customers"),
      getFrom("cashiers"),
      getFrom("promotions"),
      getFrom("meta"),
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
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction("meta", "readonly");
      const req = tx.objectStore("meta").get(key);
      req.onsuccess = () => resolve(!!req.result);
      req.onerror = () => resolve(false);
    });
  } catch (_) {
    return false;
  }
}
