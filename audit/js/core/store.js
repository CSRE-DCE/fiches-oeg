/* Dépôt de données de l'application.
 *
 * - Toutes les entités sont gardées en mémoire après ouverture de session (lecture instantanée,
 *   y compris hors connexion) et persistées chiffrées dans IndexedDB.
 * - Chaque écriture locale :
 *     1. met à jour les métadonnées (créé/modifié par, quand, version locale) ;
 *     2. est inscrite dans la file d'envoi (outbox) pour la synchronisation ;
 *     3. produit une entrée du JOURNAL D'AUDIT (qui, quoi, quand, valeur avant/après, motif),
 *        chaînée par empreinte SHA-256 à l'entrée précédente : toute suppression ou altération
 *        d'une entrée rompt la chaîne et est détectée par la vérification d'intégrité.
 * - Les suppressions sont logiques (pierre tombale `_deleted`) : rien n'est effacé sans trace.
 */
import { idb, meta } from './db.js';
import { encryptJSON, decryptJSON } from './crypto.js';
import { session } from './session.js';
import { uuid, nowISO, diff, compactValue, canonicalJSON, sha256Hex, clone } from './util.js';

export const META_FIELDS = ['_rev', '_lv', 'createdAt', 'createdBy', 'createdByName', 'updatedAt', 'updatedBy', 'updatedByName', '_conflict'];
/** Types jamais envoyés au serveur. */
export const LOCAL_ONLY = new Set(['conflict', 'syncLog', 'localSecret', 'syncBase']);
/** Types sans entrée de journal (le journal lui-même, éléments techniques). */
const NO_TRAIL = new Set(['trail', 'conflict', 'syncLog', 'localSecret', 'syncBase']);

export function entityLabel(type, e) {
  if (!e) return '';
  return e.number || e.code || e.ref || e.reference || e.name || e.label || e.title || e.username ||
    (e.lastName ? `${e.lastName} ${e.firstName || ''}`.trim() : '') || e.id;
}

class DataStore {
  constructor() {
    this.data = new Map();
    this.listeners = new Set();
    this.queue = Promise.resolve();
    this.trailHead = null;   // {seq, hash} de la dernière entrée du journal de cet appareil
    this.loaded = false;
  }
  _map(type) { if (!this.data.has(type)) this.data.set(type, new Map()); return this.data.get(type); }

  async load() {
    this.data.clear();
    const rows = await idb.entries('entities');
    for (const [, v] of rows) {
      try { const obj = await decryptJSON(session.dek, v.iv, v.ct); this._map(v.type).set(obj.id, obj); }
      catch (e) { console.warn('Entité illisible', v.type, v.id, e); }
    }
    this.trailHead = await meta.get('trailHead:' + session.device.id, { seq: 0, hash: '' });
    this.loaded = true;
    this.emit('*', null);
  }
  unload() { this.data.clear(); this.loaded = false; }

  /* ---------- lecture ---------- */
  get(type, id) { const e = this._map(type).get(id); return e && !e._deleted ? e : null; }
  getRaw(type, id) { return this._map(type).get(id) || null; }
  all(type, { withDeleted = false } = {}) {
    const out = [...this._map(type).values()];
    return withDeleted ? out : out.filter(e => !e._deleted);
  }
  find(type, fn) { return this.all(type).find(fn) || null; }
  filter(type, fn) { return this.all(type).filter(fn); }
  count(type, fn) { return fn ? this.filter(type, fn).length : this.all(type).length; }
  types() { return [...this.data.keys()]; }

  /* ---------- événements ---------- */
  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(type, id) { for (const fn of this.listeners) { try { fn(type, id); } catch (e) { console.error(e); } } }

  /* ---------- écriture ---------- */
  /**
   * Enregistre une entité. opts : {action, reason, trail:false, label, silent}
   * Retourne l'entité enregistrée (copie) ; la persistance est garantie à la résolution de la promesse.
   */
  put(type, data, opts = {}) {
    const prev = this.getRaw(type, data.id);
    const now = nowISO(), u = session.user || {};
    const entity = clone(data);
    entity.id = entity.id || uuid();
    if (!prev) { entity.createdAt = entity.createdAt || now; entity.createdBy = entity.createdBy || u.id || null; entity.createdByName = entity.createdByName || u.name || null; }
    else { entity.createdAt = prev.createdAt; entity.createdBy = prev.createdBy; entity.createdByName = prev.createdByName; }
    entity._rev = prev ? prev._rev || 0 : (entity._rev || 0);
    const changes = diff(prev || {}, entity, { ignore: META_FIELDS });
    if (prev && !changes.length && !opts.force) return Promise.resolve(prev);
    entity.updatedAt = now; entity.updatedBy = u.id || null; entity.updatedByName = u.name || null;
    entity._lv = (prev?._lv || 0) + 1;
    this._map(type).set(entity.id, entity);
    this.emit(type, entity.id);
    const action = opts.action || (prev ? (entity._deleted ? 'delete' : 'update') : 'create');
    return this._enqueue(async () => {
      const ops = [await this._entityOp(type, entity)];
      if (!LOCAL_ONLY.has(type)) ops.push({ store: 'outbox', key: `${type}:${entity.id}`, value: { type, id: entity.id, baseRev: entity._rev || 0, at: now } });
      if (!NO_TRAIL.has(type) && opts.trail !== false) {
        ops.push(...await this._trailOps({
          action, entityType: type, entityId: entity.id, entityLabel: opts.label || entityLabel(type, entity),
          changes: prev ? changes.slice(0, 60).map(c => ({ path: c.path, before: compactValue(c.before), after: compactValue(c.after) })) : [],
          changeCount: changes.length, reason: opts.reason || null
        }));
      }
      await idb.batch(ops);
      return entity;
    });
  }

  /** Enregistrement groupé (imports, référentiels) : une seule entrée de journal récapitulative. */
  bulkPut(type, list, { reason = null, action = 'import', label = '' } = {}) {
    const now = nowISO(), u = session.user || {};
    const saved = [];
    for (const data of list) {
      const prev = this.getRaw(type, data.id);
      const e = clone(data);
      e.id = e.id || uuid();
      e.createdAt = prev?.createdAt || e.createdAt || now; e.createdBy = prev?.createdBy || e.createdBy || u.id || null;
      e.createdByName = prev?.createdByName || e.createdByName || u.name || null;
      e._rev = prev?._rev || e._rev || 0;
      if (prev && !diff(prev, e, { ignore: META_FIELDS }).length) continue;
      e.updatedAt = now; e.updatedBy = u.id || null; e.updatedByName = u.name || null; e._lv = (prev?._lv || 0) + 1;
      this._map(type).set(e.id, e); saved.push(e);
    }
    if (saved.length) this.emit(type, null);
    return this._enqueue(async () => {
      if (!saved.length) return saved;
      const ops = [];
      for (const e of saved) {
        ops.push(await this._entityOp(type, e));
        if (!LOCAL_ONLY.has(type)) ops.push({ store: 'outbox', key: `${type}:${e.id}`, value: { type, id: e.id, baseRev: e._rev || 0, at: now } });
      }
      ops.push(...await this._trailOps({ action, entityType: type, entityId: null, entityLabel: label || `${saved.length} élément(s)`, changes: [], changeCount: saved.length, reason }));
      await idb.batch(ops);
      return saved;
    });
  }

  /** Suppression logique (pierre tombale conservée et synchronisée). */
  remove(type, id, reason = null) {
    const prev = this.get(type, id);
    if (!prev) return Promise.resolve(null);
    return this.put(type, { ...prev, _deleted: true, deletedAt: nowISO(), deletedBy: session.user?.id || null, deleteReason: reason }, { action: 'delete', reason });
  }

  /** Entrée de journal sans modification d'entité (connexion, export, génération de rapport…). */
  log(action, { entityType = null, entityId = null, entityLabel = '', reason = null, details = null } = {}) {
    return this._enqueue(async () => {
      await idb.batch(await this._trailOps({ action, entityType, entityId, entityLabel, changes: details ? [{ path: 'détails', before: null, after: compactValue(details, 800) }] : [], changeCount: 0, reason }));
    });
  }

  /** Application d'une version reçue du serveur : ni file d'envoi ni journal (déjà tracé à la source). */
  applyRemote(type, data, { keepOutbox = false } = {}) {
    const entity = clone(data);
    this._map(type).set(entity.id, entity);
    this.emit(type, entity.id);
    return this._enqueue(async () => {
      const ops = [await this._entityOp(type, entity)];
      if (!keepOutbox) ops.push({ store: 'outbox', key: `${type}:${entity.id}`, value: undefined });
      await idb.batch(ops);
      return entity;
    });
  }
  /** Application groupée de versions serveur (une transaction), avec mémorisation de la version de base. */
  applyRemoteMany(list, { withBase = true } = {}) {
    const ops = [];
    const prepared = list.map(({ type, data }) => {
      const entity = clone(data);
      this._map(type).set(entity.id, entity);
      let base = null;
      if (withBase && type !== 'trail' && type !== 'media') {
        base = { id: `${type}:${entity.id}`, data: entity };
        this._map('syncBase').set(base.id, base);
      }
      return { type, entity, base };
    });
    if (prepared.length) this.emit('*', null);
    return this._enqueue(async () => {
      for (const { type, entity, base } of prepared) {
        ops.push(await this._entityOp(type, entity), { store: 'outbox', key: `${type}:${entity.id}`, value: undefined });
        if (base) ops.push(await this._entityOp('syncBase', base));
      }
      if (ops.length) await idb.batch(ops);
    });
  }
  setBase(type, entity) {
    if (type === 'trail' || type === 'media') return Promise.resolve();
    const base = { id: `${type}:${entity.id}`, data: clone(entity) };
    this._map('syncBase').set(base.id, base);
    return this._enqueue(async () => { await idb.batch([await this._entityOp('syncBase', base)]); });
  }
  getBase(type, id) { return this._map('syncBase').get(`${type}:${id}`)?.data || null; }

  /**
   * Enregistre le résultat d'une fusion de conflit : sans entrée de journal (la fusion est tracée dans
   * le rapport de conflit), avec ou sans renvoi au serveur selon que la version locale a apporté des
   * modifications.
   */
  applyMerged(type, data, { needsPush, baseRev }) {
    const entity = clone(data);
    entity._lv = (this.getRaw(type, entity.id)?._lv || 0) + 1;
    this._map(type).set(entity.id, entity);
    this.emit(type, entity.id);
    return this._enqueue(async () => {
      await idb.batch([await this._entityOp(type, entity),
        { store: 'outbox', key: `${type}:${entity.id}`, value: needsPush ? { type, id: entity.id, baseRev, at: nowISO() } : undefined }]);
      return entity;
    });
  }
  /** Met à jour uniquement les métadonnées de synchronisation (révision serveur). */
  setRev(type, id, rev) {
    const e = this.getRaw(type, id); if (!e) return Promise.resolve();
    e._rev = rev;
    return this._enqueue(async () => { await idb.batch([await this._entityOp(type, e)]); });
  }

  _enqueue(fn) {
    const p = this.queue.then(fn);
    this.queue = p.catch(err => { console.error('Écriture locale impossible', err); this.emit('error', String(err?.message || err)); });
    return p;
  }
  flush() { return this.queue; }

  async _entityOp(type, entity) {
    const { iv, ct } = await encryptJSON(session.dek, entity);
    return { store: 'entities', key: `${type}:${entity.id}`, value: { type, id: entity.id, iv, ct } };
  }

  async _trailOps(fields) {
    const u = session.user || {}, d = session.device || {};
    const head = this.trailHead || { seq: 0, hash: '' };
    const entry = {
      id: uuid(), seq: head.seq + 1, at: nowISO(),
      userId: u.id || null, userName: u.name || null, role: u.role || null,
      deviceId: d.id || null, deviceName: d.name || null, appVersion: (globalThis.self && self.AUDIT_VERSION) || 'dev',
      ...fields, prevHash: head.hash || ''
    };
    entry.hash = await trailHash(entry);
    this.trailHead = { seq: entry.seq, hash: entry.hash };
    this._map('trail').set(entry.id, entry);
    this.emit('trail', entry.id);
    return [
      await this._entityOp('trail', entry),
      { store: 'outbox', key: `trail:${entry.id}`, value: { type: 'trail', id: entry.id, baseRev: 0, at: entry.at } },
      { store: 'meta', key: 'trailHead:' + d.id, value: this.trailHead }
    ];
  }
}

export async function trailHash(entry) {
  const { hash, _rev, _lv, ...rest } = entry;
  return sha256Hex((entry.prevHash || '') + '|' + canonicalJSON(rest));
}

/**
 * Vérifie la chaîne d'empreintes du journal, appareil par appareil.
 * Retourne {ok, devices:[{deviceId, deviceName, count, breaks:[{seq, reason}]}]}.
 */
export async function verifyTrail(entries) {
  const byDevice = new Map();
  for (const e of entries) { const k = e.deviceId || '?'; if (!byDevice.has(k)) byDevice.set(k, []); byDevice.get(k).push(e); }
  const devices = [];
  for (const [deviceId, list] of byDevice) {
    list.sort((a, b) => a.seq - b.seq);
    const breaks = [];
    let prev = null;
    for (const e of list) {
      if (await trailHash(e) !== e.hash) breaks.push({ seq: e.seq, at: e.at, reason: 'contenu modifié (empreinte incorrecte)' });
      if (prev) {
        if (e.seq !== prev.seq + 1) breaks.push({ seq: e.seq, at: e.at, reason: `entrée(s) manquante(s) entre n°${prev.seq} et n°${e.seq}` });
        else if (e.prevHash !== prev.hash) breaks.push({ seq: e.seq, at: e.at, reason: 'chaînage rompu avec l’entrée précédente' });
      } else if (e.seq !== 1 && e.prevHash === '') breaks.push({ seq: e.seq, at: e.at, reason: 'début de chaîne inattendu' });
      prev = e;
    }
    devices.push({ deviceId, deviceName: list[list.length - 1]?.deviceName || deviceId, count: list.length, first: list[0]?.at, last: list[list.length - 1]?.at, breaks });
  }
  return { ok: devices.every(d => !d.breaks.length), devices };
}

export const store = new DataStore();
