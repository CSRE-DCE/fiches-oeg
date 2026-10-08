/* Photographies, signatures et pièces jointes.
 * Le contenu binaire est chiffré dans le magasin IndexedDB « media » ; les métadonnées (date, heure,
 * auteur, audit, objet contrôlé, GPS, empreinte SHA-256…) forment une entité « media » synchronisée
 * et journalisée comme les autres. Un média n'est jamais modifié : une photo annotée est un nouveau
 * média qui référence l'original (derivedFrom), l'original restant conservé intact.
 */
import { idb } from './db.js';
import { encryptBytes, decryptBytes } from './crypto.js';
import { session } from './session.js';
import { store } from './store.js';
import { uuid, nowISO, sha256Hex } from './util.js';

const urlCache = new Map();
let remoteFetcher = null;
/** Le moteur de synchronisation fournit une fonction de téléchargement des médias absents localement. */
export function setRemoteFetcher(fn) { remoteFetcher = fn; }

export async function saveMedia(bytes, info = {}) {
  bytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const id = uuid();
  const sha256 = await sha256Hex(bytes);
  const { iv, ct } = await encryptBytes(session.dek, bytes);
  await idb.batch([
    { store: 'media', key: id, value: { iv, ct } },
    { store: 'outbox', key: `__bin:${id}`, value: { type: '__bin', id, at: nowISO() } }
  ]);
  const entity = {
    id, sha256, size: bytes.length, mime: info.mime || 'application/octet-stream',
    kind: info.kind || 'photo', name: info.name || '', caption: info.caption || '',
    takenAt: info.takenAt || nowISO(), author: session.user?.id || null, authorName: session.user?.name || '',
    auditId: info.auditId || null, link: info.link || null, gps: info.gps || null,
    width: info.width || null, height: info.height || null, derivedFrom: info.derivedFrom || null,
    annotation: info.annotation || null
  };
  await store.put('media', entity, { action: info.derivedFrom ? 'annotate' : 'create' });
  return store.get('media', id);
}

export async function hasLocalBytes(id) { return !!(await idb.get('media', id)); }

export async function mediaBytes(id) {
  let rec = await idb.get('media', id);
  if (!rec && remoteFetcher) {
    const bytes = await remoteFetcher(id);
    if (bytes) {
      const { iv, ct } = await encryptBytes(session.dek, bytes);
      await idb.put('media', id, { iv, ct });
      return bytes;
    }
  }
  if (!rec) return null;
  return decryptBytes(session.dek, rec.iv, rec.ct);
}

/** Stocke localement le binaire reçu du serveur (préparation du terrain). */
export async function storeRemoteBytes(id, bytes) {
  const { iv, ct } = await encryptBytes(session.dek, bytes);
  await idb.put('media', id, { iv, ct });
}

export async function mediaURL(id) {
  if (!id) return null;
  if (urlCache.has(id)) return urlCache.get(id);
  const m = store.get('media', id);
  const bytes = await mediaBytes(id).catch(() => null);
  if (!bytes) return null;
  const url = URL.createObjectURL(new Blob([bytes], { type: m?.mime || 'application/octet-stream' }));
  urlCache.set(id, url);
  return url;
}
export async function mediaDataURL(id) {
  const m = store.get('media', id);
  const bytes = await mediaBytes(id);
  if (!bytes) return null;
  return new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(new Blob([bytes], { type: m?.mime })); });
}
export async function verifyMedia(id) {
  const m = store.get('media', id); const bytes = await mediaBytes(id).catch(() => null);
  if (!m || !bytes) return { ok: false, reason: 'contenu absent de l’appareil' };
  const h = await sha256Hex(bytes);
  return h === m.sha256 ? { ok: true } : { ok: false, reason: 'empreinte différente : contenu altéré' };
}
export function revokeAllURLs() { for (const u of urlCache.values()) URL.revokeObjectURL(u); urlCache.clear(); }

/** Médias rattachés à un objet (critère, échantillon, équipement, écart, point…). */
export function mediaFor(link) {
  return store.filter('media', m => m.link && m.link.type === link.type && m.link.id === link.id && (link.itemId === undefined || m.link.itemId === link.itemId))
    .sort((a, b) => String(a.takenAt).localeCompare(String(b.takenAt)));
}
