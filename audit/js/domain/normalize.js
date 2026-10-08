/* Normalisation des valeurs importées (dates françaises, heures, nombres, listes). Fichier pur. */
import { normalize } from '../core/util.js';

const pad = n => String(n).padStart(2, '0');

/** '12/10/2026', '12/10/26', '2026-10-12', '12-10-2026', '12.10.2026', '2026-10-12T08:30' → 'AAAA-MM-JJ' (ou '' si invalide). */
export function parseDate(v) {
  if (v === null || v === undefined || v === '') return '';
  if (v instanceof Date && !isNaN(v)) return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`;
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return valid(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})/);
  if (m) { let y = +m[3]; if (y < 100) y += 2000; return valid(y, +m[2], +m[1]); }
  m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return valid(+m[1], +m[2], +m[3]);
  if (/^\d{5}(\.\d+)?$/.test(s)) { const d = new Date(Math.round((Number(s) - 25569) * 86400000)); return d.toISOString().slice(0, 10); }
  return '';
}
function valid(y, mo, d) {
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d ? `${y}-${pad(mo)}-${pad(d)}` : '';
}
/** '8h30', '08:30', '0830', '8:30:00', '2026-10-12T08:30' → 'HH:MM'. */
export function parseTime(v) {
  if (v === null || v === undefined || v === '') return '';
  const s = String(v).trim().toLowerCase();
  let m = s.match(/t(\d{1,2}):(\d{2})/);
  if (!m) m = s.match(/^(\d{1,2})\s*[h:]\s*(\d{0,2})/);
  if (!m) m = s.match(/^(\d{2})(\d{2})$/);
  if (!m) { const n = Number(s.replace(',', '.')); if (isFinite(n) && n > 0 && n < 1) { const mins = Math.round(n * 1440); return `${pad(Math.floor(mins / 60))}:${pad(mins % 60)}`; } return ''; }
  const h = +m[1], mi = +(m[2] || 0);
  return h < 24 && mi < 60 ? `${pad(h)}:${pad(mi)}` : '';
}
export function parseNumber(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return v;
  const n = Number(String(v).replace(/\s/g, '').replace(',', '.'));
  return isFinite(n) ? n : null;
}
export function parseList(v) {
  if (Array.isArray(v)) return v.map(String).map(s => s.trim()).filter(Boolean);
  return String(v ?? '').split(/[;,|\n]/).map(s => s.trim()).filter(Boolean);
}
export function parseBool(v) { const s = normalize(v); return ['oui', 'o', 'yes', 'y', 'vrai', 'true', '1', 'x'].includes(s) ? true : ['non', 'n', 'no', 'faux', 'false', '0'].includes(s) ? false : null; }

/** Proposition de correspondance colonne → champ, d'après les en-têtes. */
export function guessMapping(headers, fields) {
  const mapping = {};
  const used = new Set();
  for (const f of fields) {
    const hints = [f.key, f.label, ...(f.hints || [])].map(normalize);
    let best = -1, bestScore = 0;
    headers.forEach((h, i) => {
      if (used.has(i)) return;
      const nh = normalize(h);
      if (!nh) return;
      let score = 0;
      for (const hint of hints) {
        if (nh === hint) score = Math.max(score, 3);
        else if (nh.includes(hint) || hint.includes(nh)) score = Math.max(score, hint.length > 3 ? 2 : 1);
      }
      if (score > bestScore) { bestScore = score; best = i; }
    });
    if (best >= 0 && bestScore >= 2) { mapping[f.key] = best; used.add(best); }
  }
  return mapping;
}

/** Recherche tolérante dans un référentiel (code exact, puis libellé normalisé, puis inclusion). */
export function resolveRef(list, value, { keys = ['code', 'name', 'label'], allowContains = true } = {}) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const v = normalize(value);
  for (const k of keys) { const f = list.find(x => normalize(x[k]) === v); if (f) return f; }
  if (allowContains && v.length >= 3) {
    for (const k of keys) {
      const f = list.filter(x => x[k] && normalize(x[k]).length >= 3 && (v.includes(normalize(x[k])) || normalize(x[k]).includes(v)));
      if (f.length === 1) return f[0];
    }
  }
  return null;
}
