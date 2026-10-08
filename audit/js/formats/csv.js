/* Lecture/écriture CSV (séparateur détecté automatiquement : « ; », « , » ou tabulation). Fichier pur. */

export function detectDelimiter(text) {
  const firstLine = [];
  let q = false;
  for (const ch of text.slice(0, 5000)) {
    if (ch === '"') q = !q;
    if (!q && (ch === '\n' || ch === '\r')) break;
    firstLine.push(q ? '' : ch);
  }
  const line = firstLine.join('');
  const counts = { ';': line.split(';').length - 1, ',': line.split(',').length - 1, '\t': line.split('\t').length - 1 };
  const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return best[1] > 0 ? best[0] : ';';
}

/** Retourne un tableau de lignes (tableaux de cellules). Gère guillemets, retours à la ligne dans les cellules, BOM. */
export function parseCSV(text, delimiter) {
  text = String(text || '').replace(/^﻿/, '');
  const d = delimiter || detectDelimiter(text);
  const rows = []; let row = []; let cell = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += ch;
      continue;
    }
    if (ch === '"' && cell === '') { q = true; continue; }
    if (ch === d) { row.push(cell); cell = ''; continue; }
    if (ch === '\r') continue;
    if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; continue; }
    cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(c => String(c).trim() !== ''));
}

function quote(v, d) {
  if (v === null || v === undefined) return '';
  let s = typeof v === 'number' ? String(v).replace('.', ',') : String(v);
  if (/^[=+\-@]/.test(s) && typeof v !== 'number') s = "'" + s;   // neutralise les formules (injection CSV)
  return /["\n\r]/.test(s) || s.includes(d) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
/** rows : tableau de tableaux (première ligne = en-têtes). BOM UTF-8 pour une ouverture correcte dans Excel. */
export function toCSV(rows, d = ';') {
  return '﻿' + rows.map(r => r.map(v => quote(v, d)).join(d)).join('\r\n') + '\r\n';
}
/** Objets → lignes selon une liste de colonnes [{key|get, label}]. */
export function objectsToRows(objects, columns) {
  return [columns.map(c => c.label), ...objects.map(o => columns.map(c => (c.get ? c.get(o) : o[c.key]) ?? ''))];
}
