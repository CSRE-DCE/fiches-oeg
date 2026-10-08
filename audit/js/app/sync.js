/* Synchronisation différentielle avec le serveur.
 *
 *  1. ENVOI : les modifications locales (file « outbox ») sont envoyées par lots, chacune avec la
 *     révision serveur sur laquelle elle s'appuie (baseRev). Les alertes d'urgence partent en premier.
 *  2. RÉCEPTION : seules les modifications survenues depuis le dernier curseur sont téléchargées.
 *  3. CONFLITS : si une même donnée a été modifiée des deux côtés, fusion à trois versions (base
 *     commune, locale, serveur) champ par champ ; les valeurs en concurrence sont conservées dans un
 *     rapport de conflit consultable et restaurable. Rien n'est perdu silencieusement.
 *  4. JOURNAL : chaque synchronisation est tracée (date, sens, volumes, conflits, erreurs).
 *  5. SÉCURITÉ : HTTPS obligatoire hors poste local, jeton par utilisateur et par appareil ; un
 *     appareil révoqué par l'administrateur est effacé à la première connexion.
 */
import { idb, meta } from '../core/db.js';
import { store, LOCAL_ONLY } from '../core/store.js';
import { session } from '../core/session.js';
import { apiUrl, syncKeyringProfile } from '../core/auth.js';
import { setRemoteFetcher, storeRemoteBytes } from '../core/media.js';
import { mergeEntity, stripMeta } from '../domain/merge.js';
import { availableNumbers, addBlock } from './numbering.js';
import { uuid, nowISO, deepEqual, sleep } from '../core/util.js';

const BATCH = 40;
const PRIORITY = { alert: 0, observation: 1, user: 2 };
const listeners = new Set();
export const syncState = { running: false, lastSyncAt: null, lastError: null, pending: 0, online: navigator.onLine, needsLogin: false, lastResult: null };
let onRevoked = () => {};
let timer = null, debounceTimer = null;

export function onSyncState(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit() { for (const fn of listeners) { try { fn({ ...syncState }); } catch (e) { console.error(e); } } }

export async function refreshPending() {
  const keys = await idb.keys('outbox').catch(() => []);
  syncState.pending = keys.length;
  syncState.online = navigator.onLine;
  emit();
  return keys.length;
}

class HttpError extends Error { constructor(status, body) { super(body?.error || `Erreur serveur ${status}`); this.status = status; this.body = body || {}; } }
async function api(path, { method = 'GET', body, raw = false, headers = {} } = {}) {
  const res = await fetch(apiUrl(path), {
    method,
    headers: { Authorization: `Bearer ${session.token}`, 'X-Device-Id': session.device.id, ...(body && !(body instanceof Uint8Array) ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body instanceof Uint8Array ? body : body ? JSON.stringify(body) : undefined
  });
  if (!res.ok) {
    const b = await res.json().catch(() => ({}));
    throw new HttpError(res.status, b);
  }
  if (raw) return new Uint8Array(await res.arrayBuffer());
  return res.status === 204 ? null : res.json();
}

export function initSync({ revoked }) {
  onRevoked = revoked || onRevoked;
  setRemoteFetcher(async id => {
    if (session.mode !== 'server' || !session.token || !navigator.onLine) return null;
    try { return await api(`/media/${encodeURIComponent(id)}`, { raw: true }); } catch (e) { return null; }
  });
  window.addEventListener('online', () => { syncState.online = true; emit(); scheduleSync(1000); });
  window.addEventListener('offline', () => { syncState.online = false; emit(); });
  store.subscribe(type => { if (type !== 'syncLog' && type !== 'conflict' && type !== 'syncBase') { refreshPending(); scheduleSync(8000); } });
  clearInterval(timer);
  timer = setInterval(() => { if (syncState.pending) scheduleSync(0); }, 120000);
  refreshPending();
}
export function stopSync() { clearInterval(timer); clearTimeout(debounceTimer); }

export function scheduleSync(delay = 5000) {
  if (session.mode !== 'server') return;
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => runSync({ reason: 'automatique' }).catch(() => {}), delay);
}

/** Synchronisation complète. Retourne un résumé {pushed, pulled, conflicts, errors}. */
export async function runSync({ reason = 'manuelle', full = false } = {}) {
  if (session.mode !== 'server') return { skipped: 'mode autonome' };
  if (!session.unlocked) return { skipped: 'session fermée' };
  if (!navigator.onLine) { syncState.online = false; emit(); return { skipped: 'hors connexion' }; }
  if (!session.token) { syncState.needsLogin = true; emit(); return { skipped: 'reconnexion requise' }; }
  if (syncState.running) return { skipped: 'déjà en cours' };
  syncState.running = true; syncState.lastError = null; emit();
  const log = { id: uuid(), at: nowISO(), reason, pushed: 0, pulled: 0, media: 0, conflicts: 0, rejected: 0, errors: [], durationMs: 0, user: session.user?.name };
  const t0 = Date.now();
  try {
    await store.flush();
    await push(log);
    await pushMedia(log);
    await pull(log, { full });
    await reserveNumbers(log);
    syncState.lastSyncAt = nowISO(); syncState.needsLogin = false;
    await meta.set('lastSyncAt', syncState.lastSyncAt);
  } catch (e) {
    if (e.status === 401) {
      if (e.body?.code === 'DEVICE_REVOKED') { syncState.running = false; emit(); await onRevoked(); return { revoked: true }; }
      syncState.needsLogin = true; session.token = null;
      log.errors.push('Session serveur expirée : reconnectez-vous (mot de passe) pour reprendre la synchronisation.');
    } else log.errors.push(e.message || String(e));
    syncState.lastError = log.errors[log.errors.length - 1];
  } finally {
    log.durationMs = Date.now() - t0;
    syncState.running = false;
    syncState.lastResult = log;
    await store.put('syncLog', log);
    await refreshPending();
  }
  return log;
}

async function push(log) {
  const entries = (await idb.entries('outbox')).map(([key, v]) => ({ key, ...v })).filter(e => e.type !== '__bin' && !e.rejected && !LOCAL_ONLY.has(e.type));
  entries.sort((a, b) => (PRIORITY[a.type] ?? 5) - (PRIORITY[b.type] ?? 5) || String(a.at).localeCompare(String(b.at)));
  for (let i = 0; i < entries.length; i += BATCH) {
    const batch = entries.slice(i, i + BATCH).map(e => {
      const data = store.getRaw(e.type, e.id);
      return data ? { key: e.key, type: e.type, id: e.id, baseRev: e.baseRev || 0, lv: data._lv, deleted: !!data._deleted, data: withoutSyncMeta(data) } : null;
    }).filter(Boolean);
    if (!batch.length) continue;
    const res = await api('/sync/push', { method: 'POST', body: { deviceId: session.device.id, changes: batch.map(({ key, lv, ...c }) => c) } });
    for (const r of res.results || []) {
      const sent = batch.find(b => b.type === r.type && b.id === r.id);
      if (!sent) continue;
      if (r.status === 'ok') {
        log.pushed++;
        const cur = store.getRaw(r.type, r.id);
        if (cur && cur._lv === sent.lv) {
          await store.setRev(r.type, r.id, r.rev);
          await idb.del('outbox', sent.key);
        } else {
          await store.setRev(r.type, r.id, r.rev);
          await idb.put('outbox', sent.key, { type: r.type, id: r.id, baseRev: r.rev, at: nowISO() });
        }
        await store.setBase(r.type, { ...sent.data, id: r.id, _rev: r.rev });
      } else if (r.status === 'conflict') {
        log.conflicts++;
        await resolveConflict(r.type, r.id, { ...(r.current?.data || {}), id: r.id, _rev: r.current?.rev, ...(r.current?.deleted ? { _deleted: true } : {}) }, log);
      } else {
        log.rejected++;
        log.errors.push(`${r.type} ${r.id} refusé par le serveur : ${r.error || 'motif non précisé'}`);
        await idb.put('outbox', sent.key, { type: r.type, id: r.id, baseRev: sent.baseRev, at: nowISO(), rejected: true, error: r.error || 'refusé' });
      }
    }
  }
}

function withoutSyncMeta(e) { const { _rev, _lv, ...rest } = e; return rest; }

async function pushMedia(log) {
  const bins = (await idb.entries('outbox')).filter(([, v]) => v.type === '__bin');
  for (const [key, v] of bins) {
    const m = store.get('media', v.id);
    const rec = await idb.get('media', v.id);
    if (!m || !rec) { await idb.del('outbox', key); continue; }
    const { decryptBytes } = await import('../core/crypto.js');
    const bytes = await decryptBytes(session.dek, rec.iv, rec.ct);
    await api(`/media/${encodeURIComponent(v.id)}`, { method: 'PUT', body: bytes, headers: { 'Content-Type': m.mime || 'application/octet-stream', 'X-Sha256': m.sha256 } });
    await idb.del('outbox', key);
    log.media++;
  }
}

async function pull(log, { full = false } = {}) {
  let cursor = full ? 0 : await meta.get('syncCursor', 0);
  for (let guard = 0; guard < 1000; guard++) {
    const res = await api(`/sync/pull?since=${encodeURIComponent(cursor)}&limit=500`);
    const direct = [];
    for (const c of res.changes || []) {
      if (LOCAL_ONLY.has(c.type)) continue;
      const remote = { ...(c.data || {}), id: c.id, _rev: c.rev, ...(c.deleted ? { _deleted: true } : {}) };
      const local = store.getRaw(c.type, c.id);
      const pending = await idb.get('outbox', `${c.type}:${c.id}`);
      if (local && (local._rev || 0) >= c.rev && !full) continue;
      if (pending && local && !pending.rejected) await resolveConflict(c.type, c.id, remote, log);
      else direct.push({ type: c.type, data: remote });
      if (c.type === 'user' && c.data?.username) await syncKeyringProfile(c.data);
      log.pulled++;
    }
    if (direct.length) await store.applyRemoteMany(direct);
    cursor = res.cursor ?? cursor;
    await meta.set('syncCursor', cursor);
    if (!res.more) break;
  }
  // Révocation ou modification du profil de l'utilisateur courant
  const me = store.get('user', session.user.id);
  if (me && me.role && me.role !== session.user.role) session.user.role = me.role;
}

/** Fusion à trois versions et rapport de conflit. */
async function resolveConflict(type, id, remote, log) {
  const local = store.getRaw(type, id);
  const base = store.getBase(type, id);
  const { merged, conflicts } = mergeEntity(type, base, local, remote);
  const needsPush = !deepEqual(stripMeta(merged), stripMeta(remote));
  await store.applyMerged(type, merged, { needsPush, baseRev: remote._rev || 0 });
  await store.setBase(type, remote);
  if (conflicts.length) {
    log.conflicts++;
    await store.put('conflict', {
      id: uuid(), entityType: type, entityId: id, at: nowISO(), label: local?.number || local?.ref || local?.name || id,
      details: conflicts.map(c => ({ ...c, localValue: c.localValue, remoteValue: c.remoteValue })), resolved: false,
      localVersion: local, remoteVersion: remote
    });
  }
}

async function reserveNumbers(log) {
  const year = new Date().getFullYear();
  if (await availableNumbers('AUD', year) >= 10) return;
  try {
    const r = await api('/sequences/reserve', { method: 'POST', body: { name: 'AUD', year, count: 25 } });
    if (r?.from) await addBlock('AUD', r.year || year, r.from, r.to);
  } catch (e) { log.errors.push('Réservation de numéros d’audit impossible : ' + e.message); }
}

/** Télécharge les contenus binaires utiles hors connexion (documents applicables, photos de points). */
export async function prefetchMedia(filter = m => m.kind === 'document' || m.link?.type === 'point' || m.link?.type === 'document') {
  if (session.mode !== 'server' || !navigator.onLine || !session.token) return 0;
  let n = 0;
  for (const m of store.filter('media', filter)) {
    if (await idb.get('media', m.id)) continue;
    try { const bytes = await api(`/media/${encodeURIComponent(m.id)}`, { raw: true }); await storeRemoteBytes(m.id, bytes); n++; } catch (e) { /* suivant */ }
    if (n % 10 === 0) await sleep(0);
  }
  return n;
}

/** Abandonne une modification locale refusée par le serveur. */
export async function dropOutboxEntry(key) { await idb.del('outbox', key); await refreshPending(); }
export async function retryRejected() {
  for (const [key, v] of await idb.entries('outbox')) if (v.rejected) await idb.put('outbox', key, { ...v, rejected: false, error: null });
  await refreshPending();
}
export async function outboxEntries() { return (await idb.entries('outbox')).map(([key, v]) => ({ key, ...v })); }

/** Vérifie la joignabilité du serveur. */
export async function serverHealth(url = session.serverUrl) {
  try { const r = await fetch(url.replace(/\/+$/, '') + '/api/v1/health', { cache: 'no-store' }); return r.ok ? await r.json() : null; } catch (e) { return null; }
}
