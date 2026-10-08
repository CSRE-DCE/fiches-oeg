/* Accès IndexedDB (base « oeg-audit »), distincte de celle des fiches terrain.
 *   meta      : réglages techniques lisibles avant ouverture de session (appareil, trousseau de clés,
 *               curseur de synchronisation…). Aucune donnée d'audit ici.
 *   entities  : toutes les données métier, chiffrées (clé "type:id" → {type, id, iv, ct}).
 *   media     : contenu binaire des photos/documents, chiffré (clé id → {iv, ct}).
 *   outbox    : modifications locales en attente d'envoi au serveur (clé "type:id").
 */
const DB_NAME = 'oeg-audit', VERSION = 1;
let dbp = null;
let destroyed = false;   // base effacée (appareil révoqué) : plus aucune écriture possible

export function openDB() {
  if (destroyed) return Promise.reject(new Error('Données locales effacées'));
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) return reject(new Error('IndexedDB indisponible sur ce navigateur'));
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of ['meta', 'entities', 'media', 'outbox']) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s);
    };
    req.onsuccess = () => { const db = req.result; db.onversionchange = () => { db.close(); dbp = null; }; resolve(db); };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('Base de données bloquée par un autre onglet : fermez les autres onglets de l\'application.'));
  });
  dbp.catch(() => { dbp = null; });
  return dbp;
}

function tx(stores, mode, fn) {
  return openDB().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(stores, mode);
    let result;
    const out = fn(...(Array.isArray(stores) ? stores : [stores]).map(s => t.objectStore(s)));
    if (out && typeof out.onsuccess !== 'undefined') out.onsuccess = () => { result = out.result; };
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Transaction annulée (stockage plein ?)'));
  }));
}

export const idb = {
  get: (store, key) => tx(store, 'readonly', s => s.get(key)),
  put: (store, key, value) => tx(store, 'readwrite', s => s.put(value, key)),
  del: (store, key) => tx(store, 'readwrite', s => s.delete(key)),
  clear: store => tx(store, 'readwrite', s => s.clear()),
  keys: store => tx(store, 'readonly', s => s.getAllKeys()),
  all: store => tx(store, 'readonly', s => s.getAll()),
  /** Paires [clé, valeur] d'un magasin. */
  entries: store => openDB().then(db => new Promise((resolve, reject) => {
    const out = [];
    const req = db.transaction(store, 'readonly').objectStore(store).openCursor();
    req.onsuccess = () => { const c = req.result; if (c) { out.push([c.key, c.value]); c.continue(); } else resolve(out); };
    req.onerror = () => reject(req.error);
  })),
  /** Écritures groupées atomiques : ops = [{store, key, value}] (value undefined = suppression). */
  batch: ops => {
    const stores = [...new Set(ops.map(o => o.store))];
    if (!stores.length) return Promise.resolve();
    return tx(stores, 'readwrite', (...objs) => {
      const map = Object.fromEntries(stores.map((s, i) => [s, objs[i]]));
      for (const o of ops) o.value === undefined ? map[o.store].delete(o.key) : map[o.store].put(o.value, o.key);
    });
  }
};

export const meta = {
  get: async (key, fallback = null) => { const v = await idb.get('meta', key); return v === undefined ? fallback : v; },
  set: (key, value) => idb.put('meta', key, value),
  del: key => idb.del('meta', key)
};

/** Efface entièrement la base locale (appareil perdu révoqué, réinitialisation). */
export async function destroyDB() {
  destroyed = true;
  if (dbp) { try { (await dbp).close(); } catch (e) { /* déjà fermée */ } dbp = null; }
  await new Promise((resolve, reject) => {
    const r = indexedDB.deleteDatabase(DB_NAME);
    r.onsuccess = () => resolve(); r.onerror = () => reject(r.error); r.onblocked = () => resolve();
  });
}

export async function storageEstimate() {
  try { return await navigator.storage.estimate(); } catch (e) { return null; }
}
