/* Utilitaires purs (sans DOM) : identifiants, dates, échappement HTML, JSON canonique, empreintes.
 * Importables aussi bien par l'application que par les tests Node (node --test). */

export function uuid() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const b = globalThis.crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export const nowISO = () => new Date().toISOString();
const pad = (n, l = 2) => String(n).padStart(l, '0');

/** Date locale au format AAAA-MM-JJ (valeur d'un <input type="date">). */
export function localDate(d = new Date()) {
  d = d instanceof Date ? d : new Date(d);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
/** Heure locale HH:MM. */
export function localTime(d = new Date()) {
  d = d instanceof Date ? d : new Date(d);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
/** Valeur d'un <input type="datetime-local"> (AAAA-MM-JJTHH:MM). */
export function localDateTime(d = new Date()) { return localDate(d) + 'T' + localTime(d); }

export function fmtDate(v) {
  if (!v) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) { const [y, m, d] = v.split('-'); return `${d}/${m}/${y}`; }
  const d = new Date(v); if (isNaN(d)) return String(v);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}
export function fmtTime(v) {
  if (!v) return '';
  if (/^\d{2}:\d{2}/.test(v)) return v.slice(0, 5);
  const d = new Date(v); return isNaN(d) ? String(v) : localTime(d);
}
export function fmtDateTime(v) {
  if (!v) return '';
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v)) return fmtDate(v.slice(0, 10)) + ' ' + v.slice(11);
  const d = new Date(v); if (isNaN(d)) return String(v);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${localTime(d)}`;
}
export function fmtNumber(v, digits = 2) {
  if (v === null || v === undefined || v === '' || isNaN(Number(v))) return '';
  return Number(v).toLocaleString('fr-FR', { maximumFractionDigits: digits });
}
export function fmtBytes(n) {
  if (!n) return '0 o';
  const u = ['o', 'Ko', 'Mo', 'Go']; let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(i ? 1 : 0).replace('.', ',')} ${u[i]}`;
}
/** Nombre de jours entiers entre deux dates AAAA-MM-JJ (b - a). */
export function daysBetween(a, b) {
  const da = Date.UTC(...String(a).slice(0, 10).split('-').map((x, i) => i === 1 ? x - 1 : +x));
  const db = Date.UTC(...String(b).slice(0, 10).split('-').map((x, i) => i === 1 ? x - 1 : +x));
  return Math.round((db - da) / 86400000);
}
export function addDays(date, n) {
  const d = new Date(String(date).slice(0, 10) + 'T12:00:00');
  d.setDate(d.getDate() + n); return localDate(d);
}

/* ---------- HTML sûr ---------- */
export function esc(v) {
  return String(v ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}
export class SafeHTML { constructor(s) { this.s = s; } toString() { return this.s; } }
export const raw = s => new SafeHTML(String(s ?? ''));
function part(v) {
  if (v === null || v === undefined || v === false) return '';
  if (v instanceof SafeHTML) return v.s;
  if (Array.isArray(v)) return v.map(part).join('');
  return esc(v);
}
/** Gabarit HTML : toutes les valeurs interpolées sont échappées, sauf celles produites par html`` ou raw(). */
export function html(strings, ...vals) {
  let out = strings[0];
  for (let i = 0; i < vals.length; i++) out += part(vals[i]) + strings[i + 1];
  return new SafeHTML(out);
}

/* ---------- JSON canonique et empreintes ---------- */
/** Sérialisation stable (clés triées) : deux objets égaux donnent exactement la même chaîne. */
export function canonicalJSON(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return '[' + v.map(x => x === undefined ? 'null' : canonicalJSON(x)).join(',') + ']';
  return '{' + Object.keys(v).filter(k => v[k] !== undefined).sort().map(k => JSON.stringify(k) + ':' + canonicalJSON(v[k])).join(',') + '}';
}
export function toHex(buf) { return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join(''); }
export async function sha256Hex(data) {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data instanceof ArrayBuffer ? new Uint8Array(data) : data;
  return toHex(await globalThis.crypto.subtle.digest('SHA-256', bytes));
}

/* ---------- Divers ---------- */
export const clone = v => (v === undefined ? undefined : structuredClone(v));
export function debounce(fn, ms) {
  let t = null;
  const d = (...a) => { clearTimeout(t); t = setTimeout(() => { t = null; fn(...a); }, ms); };
  d.flush = (...a) => { if (t) { clearTimeout(t); t = null; fn(...a); } };
  d.pending = () => t !== null;
  return d;
}
export function normalize(s) {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}
export function groupBy(arr, fn) {
  const m = new Map();
  for (const x of arr) { const k = fn(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x); }
  return m;
}
export function countBy(arr, fn) {
  const m = {};
  for (const x of arr) { const k = fn(x); m[k] = (m[k] || 0) + 1; }
  return m;
}
export function sortBy(arr, ...keys) {
  return [...arr].sort((a, b) => {
    for (const k of keys) {
      const desc = typeof k === 'string' && k.startsWith('-');
      const f = typeof k === 'function' ? k : (x => x?.[desc ? k.slice(1) : k]);
      const va = f(a), vb = f(b);
      if (va === vb) continue;
      if (va === undefined || va === null || va === '') return 1;
      if (vb === undefined || vb === null || vb === '') return -1;
      const c = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb), 'fr', { numeric: true });
      return desc ? -c : c;
    }
    return 0;
  });
}
export function truncate(s, n = 120) { s = String(s ?? ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; }

/** Distance orthodromique (m) entre deux positions WGS84. */
export function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371008.8, r = Math.PI / 180;
  const dLat = (lat2 - lat1) * r, dLon = (lon2 - lon1) * r;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}
export function fmtDistance(m) {
  if (m === null || m === undefined || isNaN(m)) return '—';
  return m >= 1000 ? `${(m / 1000).toFixed(2).replace('.', ',')} km` : `${Math.round(m)} m`;
}

/** Comparaison profonde de deux valeurs JSON. */
export function deepEqual(a, b) { return canonicalJSON(a) === canonicalJSON(b); }

/**
 * Liste les différences entre deux objets JSON, jusqu'à une profondeur donnée.
 * Retourne [{path, before, after}] ; les clés `ignore` (au premier niveau) sont exclues.
 */
export function diff(before, after, { ignore = [], maxDepth = 4 } = {}) {
  const out = [];
  const walk = (a, b, path, depth) => {
    if (deepEqual(a, b)) return;
    const objA = a && typeof a === 'object' && !Array.isArray(a), objB = b && typeof b === 'object' && !Array.isArray(b);
    if (objA && objB && depth < maxDepth) {
      for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
        if (depth === 0 && ignore.includes(k)) continue;
        walk(a[k], b[k], path ? path + '.' + k : k, depth + 1);
      }
      return;
    }
    if (Array.isArray(a) && Array.isArray(b) && depth < maxDepth && a.every(x => x && x.id) && b.every(x => x && x.id)) {
      const ma = new Map(a.map(x => [x.id, x])), mb = new Map(b.map(x => [x.id, x]));
      for (const id of new Set([...ma.keys(), ...mb.keys()])) walk(ma.get(id), mb.get(id), `${path}[${id}]`, depth + 1);
      return;
    }
    out.push({ path, before: a, after: b });
  };
  walk(before ?? {}, after ?? {}, '', 0);
  return out;
}

/** Réduit une valeur pour le journal (pas d'images en base64, textes tronqués). */
export function compactValue(v, max = 400) {
  if (v === undefined) return undefined;
  if (typeof v === 'string') return v.startsWith('data:') ? `[données ${v.length} car.]` : truncate(v, max);
  const s = JSON.stringify(v);
  if (s && s.length > max) return truncate(s.replace(/"data:[^"]{50,}"/g, '"[données]"'), max);
  return v;
}

export function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

export function bytesToBase64(bytes) {
  bytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
export function base64ToBytes(b64) {
  const s = atob(b64); const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
export function dataUrlToBytes(url) {
  const [head, b64] = String(url).split(',');
  return { mime: (head.match(/data:([^;]+)/) || [])[1] || 'application/octet-stream', bytes: base64ToBytes(b64 || '') };
}
