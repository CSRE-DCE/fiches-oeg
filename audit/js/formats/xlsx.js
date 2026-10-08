/* Lecture et écriture de classeurs Excel (.xlsx) sans bibliothèque externe.
 * Un .xlsx est une archive ZIP de fichiers XML :
 *  - lecture : décompression via DecompressionStream('deflate-raw') (navigateurs récents, Node ≥ 18) ;
 *  - écriture : archive ZIP « stockée » (sans compression), lisible par Excel et LibreOffice.
 * Fichier pur (testé sous Node : l'analyse XML se fait par expressions régulières, sans DOMParser). */

const te = new TextEncoder(), td = new TextDecoder();

/* ---------- CRC32 ---------- */
let CRC_TABLE = null;
function crc32(bytes) {
  if (!CRC_TABLE) { CRC_TABLE = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; CRC_TABLE[n] = c >>> 0; } }
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

/* ---------- ZIP ---------- */
export async function unzip(buffer) {
  const b = new Uint8Array(buffer), dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('Fichier non reconnu : ce n’est pas un classeur .xlsx (archive ZIP).');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const files = {};
  for (let i = 0; i < count; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('Archive ZIP endommagée');
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
    const nlen = dv.getUint16(p + 28, true), elen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = td.decode(b.subarray(p + 46, p + 46 + nlen));
    const lnlen = dv.getUint16(local + 26, true), lelen = dv.getUint16(local + 28, true);
    const data = b.subarray(local + 30 + lnlen + lelen, local + 30 + lnlen + lelen + csize);
    files[name] = { method, data };
    p += 46 + nlen + elen + clen;
  }
  return {
    names: Object.keys(files),
    async read(name) {
      const f = files[name]; if (!f) return null;
      if (f.method === 0) return f.data;
      if (f.method !== 8) throw new Error('Méthode de compression ZIP non prise en charge');
      const ds = new DecompressionStream('deflate-raw');
      const w = ds.writable.getWriter(); w.write(f.data); w.close();
      return new Uint8Array(await new Response(ds.readable).arrayBuffer());
    },
    async text(name) { const d = await this.read(name); return d ? td.decode(d) : null; }
  };
}

export function zipStore(entries) {
  // entries : [{name, data:Uint8Array|string}]
  const parts = [], central = [];
  let offset = 0;
  const dosTime = 0, dosDate = ((2026 - 1980) << 9) | (1 << 5) | 1;
  for (const e of entries) {
    const name = te.encode(e.name), data = typeof e.data === 'string' ? te.encode(e.data) : e.data;
    const crc = crc32(data);
    const lh = new Uint8Array(30 + name.length), lv = new DataView(lh.buffer);
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(6, 0x0800, true); lv.setUint16(8, 0, true);
    lv.setUint16(10, dosTime, true); lv.setUint16(12, dosDate, true); lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true); lv.setUint32(22, data.length, true); lv.setUint16(26, name.length, true); lv.setUint16(28, 0, true);
    lh.set(name, 30);
    const ch = new Uint8Array(46 + name.length), cv = new DataView(ch.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, 0x0800, true); cv.setUint16(10, 0, true);
    cv.setUint16(12, dosTime, true); cv.setUint16(14, dosDate, true); cv.setUint32(16, crc, true); cv.setUint32(20, data.length, true); cv.setUint32(24, data.length, true);
    cv.setUint16(28, name.length, true); cv.setUint32(42, offset, true); ch.set(name, 46);
    parts.push(lh, data); central.push(ch);
    offset += lh.length + data.length;
  }
  const cdSize = central.reduce((s, c) => s + c.length, 0);
  const end = new Uint8Array(22), ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, entries.length, true); ev.setUint16(10, entries.length, true);
  ev.setUint32(12, cdSize, true); ev.setUint32(16, offset, true);
  const all = [...parts, ...central, end];
  const out = new Uint8Array(all.reduce((s, a) => s + a.length, 0));
  let p = 0; for (const a of all) { out.set(a, p); p += a.length; }
  return out;
}

/* ---------- XML minimal ---------- */
const decodeXml = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&amp;/g, '&');
const encodeXml = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
const attr = (tag, name) => { const m = tag.match(new RegExp(`\\s${name}="([^"]*)"`)); return m ? decodeXml(m[1]) : null; };
function textOf(xml) { return [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map(m => decodeXml(m[1])).join(''); }

function colIndex(ref) { const letters = ref.match(/^[A-Z]+/)[0]; let n = 0; for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; }
function colName(i) { let s = ''; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; }

/** Numéro de série Excel → AAAA-MM-JJ (et heure si fractionnaire). */
export function excelSerialToISO(serial) {
  const n = Number(serial); if (!isFinite(n)) return null;
  if (n >= 0 && n < 1) { const mins = Math.round(n * 1440); return `${String(Math.floor(mins / 60) % 24).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`; }
  const ms = Math.round((n - 25569) * 86400000);
  const d = new Date(ms);
  const date = d.toISOString().slice(0, 10);
  const frac = n % 1;
  return frac ? `${date}T${d.toISOString().slice(11, 16)}` : date;
}

/** Lit un classeur : {sheets:[{name, rows:[[valeur…]]}]} ; dates converties en AAAA-MM-JJ si le style l'indique. */
export async function readXLSX(buffer) {
  const z = await unzip(buffer);
  const wb = await z.text('xl/workbook.xml');
  if (!wb) throw new Error('Classeur Excel invalide (xl/workbook.xml absent).');
  const rels = (await z.text('xl/_rels/workbook.xml.rels')) || '';
  const relMap = Object.fromEntries([...rels.matchAll(/<Relationship\b[^>]*>/g)].map(m => [attr(m[0], 'Id'), attr(m[0], 'Target')]));
  const shared = [];
  const sst = await z.text('xl/sharedStrings.xml');
  if (sst) for (const m of sst.matchAll(/<si>([\s\S]*?)<\/si>/g)) shared.push(textOf(m[1]));
  // Styles de date : formats numériques intégrés 14-22, 45-47 ou personnalisés contenant j/m/a/d/y
  const dateStyles = new Set();
  const styles = await z.text('xl/styles.xml');
  if (styles) {
    const custom = Object.fromEntries([...styles.matchAll(/<numFmt\b[^>]*>/g)].map(m => [attr(m[0], 'numFmtId'), attr(m[0], 'formatCode') || '']));
    const xfs = styles.match(/<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/);
    if (xfs) [...xfs[1].matchAll(/<xf\b[^>]*\/?>/g)].forEach((m, i) => {
      const id = Number(attr(m[0], 'numFmtId'));
      const code = custom[id] || '';
      if ((id >= 14 && id <= 22) || (id >= 45 && id <= 47) || (/[dmyj]/i.test(code.replace(/"[^"]*"|\[[^\]]*\]/g, '')) && !/^[#0.,%\s]+$/.test(code))) dateStyles.add(i);
    });
  }
  const sheets = [];
  for (const m of wb.matchAll(/<sheet\b[^>]*>/g)) {
    const name = attr(m[0], 'name'), rid = attr(m[0], 'r:id');
    let target = relMap[rid] || '';
    target = target.startsWith('/') ? target.slice(1) : 'xl/' + target.replace(/^\.\//, '');
    const xml = await z.text(target);
    if (!xml) continue;
    const rows = [];
    for (const r of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>|<row\b[^>]*\/>/g)) {
      const rowIdx = Number(attr(r[0], 'r') || rows.length + 1) - 1;
      const row = [];
      for (const c of (r[1] || '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const tag = '<c' + c[1] + '>';
        const ref = attr(tag, 'r'), t = attr(tag, 't'), s = Number(attr(tag, 's') || 0);
        const inner = c[2] || '';
        const v = (inner.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
        let val = '';
        if (t === 's') val = shared[Number(v)] ?? '';
        else if (t === 'inlineStr') val = textOf(inner);
        else if (t === 'str') val = v !== undefined ? decodeXml(v) : '';
        else if (t === 'b') val = v === '1';
        else if (t === 'e') val = '';
        else if (v !== undefined) { const n = Number(v); val = dateStyles.has(s) ? excelSerialToISO(n) : n; }
        row[ref ? colIndex(ref) : row.length] = val;
      }
      rows[rowIdx] = Array.from(row, x => x === undefined ? '' : x);
    }
    sheets.push({ name, rows: Array.from(rows, x => x || []) });
  }
  return { sheets };
}

/**
 * Écrit un classeur. sheets : [{name, rows:[[…]], widths?:[nombre]}] — première ligne en gras, figée,
 * avec filtre automatique. Les nombres restent des nombres ; tout le reste est écrit en texte.
 */
export function writeXLSX(sheets, { title = '', author = '' } = {}) {
  const safeName = (n, i) => (String(n || `Feuille${i + 1}`).replace(/[\\/?*[\]:]/g, ' ').slice(0, 31)) || `Feuille${i + 1}`;
  const entries = [];
  const sheetXml = sh => {
    const rows = sh.rows || [];
    const ncols = Math.max(1, ...rows.map(r => r.length));
    const widths = sh.widths || Array.from({ length: ncols }, (_, c) => Math.min(60, Math.max(8, ...rows.slice(0, 200).map(r => String(r[c] ?? '').length + 2))));
    let x = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">';
    x += '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>';
    x += '<cols>' + widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('') + '</cols><sheetData>';
    rows.forEach((r, ri) => {
      x += `<row r="${ri + 1}">`;
      r.forEach((v, ci) => {
        if (v === null || v === undefined || v === '') return;
        const ref = colName(ci) + (ri + 1), st = ri === 0 ? ' s="1"' : ' s="2"';
        if (typeof v === 'number' && isFinite(v)) x += `<c r="${ref}"${ri === 0 ? ' s="1"' : ''}><v>${v}</v></c>`;
        else if (typeof v === 'boolean') x += `<c r="${ref}" t="b"><v>${v ? 1 : 0}</v></c>`;
        else x += `<c r="${ref}" t="inlineStr"${st}><is><t xml:space="preserve">${encodeXml(v)}</t></is></c>`;
      });
      x += '</row>';
    });
    x += '</sheetData>';
    if (rows.length > 1) x += `<autoFilter ref="A1:${colName(ncols - 1)}${rows.length}"/>`;
    x += '<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/><pageSetup orientation="landscape" paperSize="9"/></worksheet>';
    return x;
  };
  const names = sheets.map((s, i) => safeName(s.name, i));
  entries.push({ name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' + sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') + '</Types>' });
  entries.push({ name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>' });
  entries.push({ name: 'docProps/core.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${encodeXml(title)}</dc:title><dc:creator>${encodeXml(author)}</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString().replace(/\.\d+/, '')}</dcterms:created></cp:coreProperties>` });
  entries.push({ name: 'xl/workbook.xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' + names.map((n, i) => `<sheet name="${encodeXml(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') + '</sheets></workbook>' });
  entries.push({ name: 'xl/_rels/workbook.xml.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') + `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` });
  entries.push({ name: 'xl/styles.xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF003D7A"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment wrapText="0" vertical="top"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>' });
  sheets.forEach((sh, i) => entries.push({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(sh) }));
  return zipStore(entries);
}

/** Feuille → objets, avec la ligne d'en-tête détectée (première ligne d'au moins 2 cellules non vides). */
export function sheetToTable(rows) {
  const headerIdx = rows.findIndex(r => r.filter(c => String(c ?? '').trim()).length >= 2);
  if (headerIdx < 0) return { headers: [], rows: [] };
  const headers = rows[headerIdx].map(h => String(h ?? '').trim());
  return { headers, rows: rows.slice(headerIdx + 1).filter(r => r.some(c => String(c ?? '').trim() !== '')) };
}
