/* Générateur PDF minimal sans dépendance (PDF 1.4, polices standard Helvetica, images JPEG).
 * Mise en page en flux : titres, paragraphes, tableaux avec en-têtes répétés, listes clé/valeur,
 * images, filigrane, en-têtes et pieds de page numérotés « page X / Y ». Fichier pur.
 */

const A4 = [595.28, 841.89];

/* ---------- Encodage WinAnsi (polices standard) ---------- */
const WIN_EXTRA = { '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85, '†': 0x86, '‡': 0x87, 'ˆ': 0x88, '‰': 0x89, 'Š': 0x8A, '‹': 0x8B, 'Œ': 0x8C, 'Ž': 0x8E, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97, '˜': 0x98, '™': 0x99, 'š': 0x9A, '›': 0x9B, 'œ': 0x9C, 'ž': 0x9E, 'Ÿ': 0x9F };
const FALLBACK = { '✓': 'v', '✔': 'v', '✗': 'x', '✘': 'x', '≥': '>=', '≤': '<=', '→': '->', '←': '<-', '↔': '<->', '◌': 'o', '●': '•', '○': 'o', '■': '•', '▲': '^', '⚠': '!', ' ': ' ', ' ': ' ', '‑': '-', '−': '-', '×': 'x', 'ō': 'o', ' ': ' ', '\t': '  ' };
function encodeChar(ch) {
  const c = ch.codePointAt(0);
  if (c >= 32 && c < 127) return [c];
  if (WIN_EXTRA[ch] !== undefined) return [WIN_EXTRA[ch]];
  if (c >= 0xA0 && c <= 0xFF) return [c];
  if (FALLBACK[ch] !== undefined) return [...FALLBACK[ch]].flatMap(encodeChar);
  const base = ch.normalize('NFD')[0];
  if (base && base !== ch && base.codePointAt(0) < 127) return [base.codePointAt(0)];
  return [63]; // « ? » pour un caractère non représentable (emoji…)
}
export function toWinAnsi(str) { const out = []; for (const ch of String(str ?? '')) out.push(...encodeChar(ch)); return out; }

/* ---------- Métriques Helvetica (AFM, millièmes d'em) pour les codes 32–126 ---------- */
const HELV = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
const HELVB = [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584];
const HIGH = { 0x80: 556, 0x82: 222, 0x84: 333, 0x85: 1000, 0x8C: 1000, 0x91: 222, 0x92: 222, 0x93: 333, 0x94: 333, 0x95: 350, 0x96: 556, 0x97: 1000, 0x99: 1000, 0x9C: 944, 0xA0: 278, 0xAB: 556, 0xB0: 400, 0xB1: 584, 0xB2: 333, 0xB3: 333, 0xB5: 556, 0xBB: 556, 0xC6: 1000, 0xD7: 584, 0xDF: 611, 0xE6: 889, 0xF7: 584 };
function charWidth(code, bold) {
  const t = bold ? HELVB : HELV;
  if (code >= 32 && code <= 126) return t[code - 32];
  if (HIGH[code]) return HIGH[code];
  if (code >= 0xC0) {
    const base = String.fromCharCode(code).normalize('NFD')[0].charCodeAt(0);
    if (base >= 32 && base <= 126) return t[base - 32];
  }
  return 556;
}

const FONTS = { regular: { key: 'F1', base: 'Helvetica', bold: false }, bold: { key: 'F2', base: 'Helvetica-Bold', bold: true }, italic: { key: 'F3', base: 'Helvetica-Oblique', bold: false } };

/* ---------- JPEG ---------- */
export function jpegInfo(bytes) {
  if (bytes[0] !== 0xFF || bytes[1] !== 0xD8) throw new Error('Image JPEG attendue');
  let p = 2;
  while (p < bytes.length) {
    if (bytes[p] !== 0xFF) { p++; continue; }
    const m = bytes[p + 1];
    if (m === 0xD8 || m === 0x01 || (m >= 0xD0 && m <= 0xD7)) { p += 2; continue; }
    const len = (bytes[p + 2] << 8) | bytes[p + 3];
    if ([0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF].includes(m)) {
      return { height: (bytes[p + 5] << 8) | bytes[p + 6], width: (bytes[p + 7] << 8) | bytes[p + 8], components: bytes[p + 9] };
    }
    p += 2 + len;
  }
  throw new Error('Dimensions JPEG introuvables');
}

const hex = bytes => bytes.map(b => b.toString(16).padStart(2, '0')).join('');
const num = n => (Math.round(n * 100) / 100).toString();
function rgb(c) {
  if (!c) return [0, 0, 0];
  if (Array.isArray(c)) return c;
  const h = c.replace('#', '');
  return [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255];
}

export class PDFDocument {
  constructor({ title = '', author = '', subject = '', keywords = '', margins = {}, pageSize = A4 } = {}) {
    this.info = { title, author, subject, keywords };
    this.W = pageSize[0]; this.H = pageSize[1];
    this.m = { top: 62, bottom: 52, left: 42, right: 42, ...margins };
    this.pages = []; this.images = []; this.y = 0; this.page = null;
    this.headerFn = null; this.footerFn = null; this.watermark = null;
    this.newPage();
  }
  get contentWidth() { return this.W - this.m.left - this.m.right; }
  newPage() { this.page = { ops: [] }; this.pages.push(this.page); this.y = this.m.top; if (this.onNewPage) this.onNewPage(this); return this; }
  ensure(h) { if (this.y + h > this.H - this.m.bottom) this.newPage(); return this; }
  remaining() { return this.H - this.m.bottom - this.y; }
  op(s) { this.page.ops.push(s); }

  /* --- primitives (y mesuré depuis le haut de la page) --- */
  width(str, font = 'regular', size = 10) {
    const bold = FONTS[font]?.bold;
    return toWinAnsi(str).reduce((s, c) => s + charWidth(c, bold), 0) * size / 1000;
  }
  wrap(str, font = 'regular', size = 10, maxWidth = this.contentWidth) {
    const out = [];
    for (const para of String(str ?? '').split(/\r?\n/)) {
      const words = para.split(/(\s+)/).filter(w => w !== '');
      let line = '';
      for (const w of words) {
        const cand = line + w;
        if (this.width(cand.trimEnd(), font, size) <= maxWidth || !line.trim()) {
          if (!line.trim() && this.width(w, font, size) > maxWidth) {
            // mot plus long que la ligne : découpage caractère par caractère
            let chunk = '';
            for (const ch of w) { if (this.width(chunk + ch, font, size) > maxWidth) { out.push(chunk); chunk = ''; } chunk += ch; }
            line = chunk;
          } else line = cand;
        } else { out.push(line.trimEnd()); line = /^\s+$/.test(w) ? '' : w; }
      }
      out.push(line.trimEnd());
    }
    return out;
  }
  text(str, x, y, { font = 'regular', size = 10, color = '#10202b', align = 'left', width = 0 } = {}) {
    const f = FONTS[font] || FONTS.regular;
    let tx = x;
    if (align !== 'left' && width) { const w = this.width(str, font, size); tx = align === 'center' ? x + (width - w) / 2 : x + width - w; }
    const [r, g, b] = rgb(color);
    this.op(`BT /${f.key} ${num(size)} Tf ${num(r)} ${num(g)} ${num(b)} rg ${num(tx)} ${num(this.H - y - size * 0.8)} Td <${hex(toWinAnsi(str))}> Tj ET`);
  }
  rect(x, y, w, h, { fill = null, stroke = null, lineWidth = 0.6 } = {}) {
    const parts = [];
    if (fill) { const [r, g, b] = rgb(fill); parts.push(`${num(r)} ${num(g)} ${num(b)} rg`); }
    if (stroke) { const [r, g, b] = rgb(stroke); parts.push(`${num(r)} ${num(g)} ${num(b)} RG ${num(lineWidth)} w`); }
    parts.push(`${num(x)} ${num(this.H - y - h)} ${num(w)} ${num(h)} re ${fill && stroke ? 'B' : fill ? 'f' : 'S'}`);
    this.op('q ' + parts.join(' ') + ' Q');
  }
  line(x1, y1, x2, y2, { color = '#d6dfdf', width = 0.6 } = {}) {
    const [r, g, b] = rgb(color);
    this.op(`q ${num(r)} ${num(g)} ${num(b)} RG ${num(width)} w ${num(x1)} ${num(this.H - y1)} m ${num(x2)} ${num(this.H - y2)} l S Q`);
  }
  addImage(bytes) {
    const found = this.images.find(i => i.bytes === bytes);
    if (found) return found;
    const info = jpegInfo(bytes);
    const img = { name: 'Im' + (this.images.length + 1), bytes, ...info };
    this.images.push(img);
    return img;
  }
  drawImage(img, x, y, w, h) { this.page.usesImages = true; this.op(`q ${num(w)} 0 0 ${num(h)} ${num(x)} ${num(this.H - y - h)} cm /${img.name} Do Q`); }

  /* --- flux --- */
  spacer(h = 8) { this.y += h; return this; }
  heading(str, { level = 1, color = '#003d7a' } = {}) {
    const size = level === 1 ? 15 : level === 2 ? 12 : 10.5;
    this.ensure(size + 28);
    if (level === 1) {
      this.y += 4;
      this.rect(this.m.left, this.y, this.contentWidth, size + 10, { fill: color });
      this.text(str, this.m.left + 8, this.y + 5, { font: 'bold', size, color: '#ffffff' });
      this.y += size + 18;
    } else {
      this.y += level === 2 ? 6 : 3;
      const lines = this.wrap(str, 'bold', size);
      for (const l of lines) { this.text(l, this.m.left, this.y, { font: 'bold', size, color }); this.y += size + 3; }
      if (level === 2) this.line(this.m.left, this.y, this.m.left + this.contentWidth, this.y, { color: '#00ac97', width: 1 });
      this.y += 6;
    }
    return this;
  }
  paragraph(str, { size = 9.5, font = 'regular', color = '#10202b', indent = 0, gap = 4, lineGap = 2.6 } = {}) {
    if (str === undefined || str === null || str === '') return this;
    for (const l of this.wrap(str, font, size, this.contentWidth - indent)) {
      this.ensure(size + lineGap);
      this.text(l, this.m.left + indent, this.y, { font, size, color });
      this.y += size + lineGap;
    }
    this.y += gap;
    return this;
  }
  bullets(list, opts = {}) { for (const s of list || []) this.paragraph('•  ' + s, { indent: 6, gap: 1, ...opts }); this.y += 3; return this; }
  /** Liste clé / valeur sur deux colonnes. */
  keyValues(pairs, { labelWidth = 170, size = 9 } = {}) {
    const rows = pairs.filter(p => p && p[1] !== undefined && p[1] !== null && p[1] !== '');
    return this.table({ columns: [{ label: '', width: labelWidth }, { label: '', width: this.contentWidth - labelWidth }], rows: rows.map(([k, v]) => [{ text: k, font: 'bold', color: '#0c447c', fill: '#eef4f9' }, String(v)]), fontSize: size, header: false });
  }
  /**
   * Tableau. columns : [{label, width, align}] ; rows : [[cellule]] avec cellule = texte ou
   * {text, font, color, fill, align}. L'en-tête est répété à chaque saut de page.
   */
  table({ columns, rows, fontSize = 8.5, header = true, headerFill = '#003d7a', zebra = true, padding = 4, maxLinesPerCell = 60 }) {
    const lh = fontSize + 2.4;
    const totalW = columns.reduce((s, c) => s + c.width, 0);
    const scale = totalW > this.contentWidth ? this.contentWidth / totalW : 1;
    const cols = columns.map(c => ({ ...c, width: c.width * scale }));
    const drawHeader = () => {
      if (!header) return;
      const hl = cols.map(c => this.wrap(c.label, 'bold', fontSize, c.width - padding * 2));
      const h = Math.max(...hl.map(l => l.length)) * lh + padding * 2;
      let x = this.m.left;
      cols.forEach((c, i) => {
        this.rect(x, this.y, c.width, h, { fill: headerFill, stroke: '#ffffff', lineWidth: 0.5 });
        hl[i].forEach((l, k) => this.text(l, x + padding, this.y + padding + k * lh, { font: 'bold', size: fontSize, color: '#ffffff' }));
        x += c.width;
      });
      this.y += h;
    };
    this.ensure(lh * 3);
    drawHeader();
    rows.forEach((row, ri) => {
      const cells = cols.map((c, i) => {
        const cell = row[i]; const o = cell && typeof cell === 'object' ? cell : { text: cell };
        let lines = this.wrap(o.text ?? '', o.font || 'regular', o.size || fontSize, c.width - padding * 2);
        if (lines.length > maxLinesPerCell) lines = [...lines.slice(0, maxLinesPerCell - 1), lines[maxLinesPerCell - 1] + ' […]'];
        return { ...o, lines };
      });
      const h = Math.max(1, ...cells.map(c => c.lines.length)) * lh + padding * 2;
      if (this.y + h > this.H - this.m.bottom) { this.newPage(); drawHeader(); }
      let x = this.m.left;
      cells.forEach((c, i) => {
        const fill = c.fill || (zebra && ri % 2 ? '#f5f8f9' : '#ffffff');
        this.rect(x, this.y, cols[i].width, h, { fill, stroke: '#cfdadd', lineWidth: 0.5 });
        c.lines.forEach((l, k) => this.text(l, x + padding, this.y + padding + k * lh, { font: c.font || 'regular', size: c.size || fontSize, color: c.color || '#10202b', align: c.align || cols[i].align || 'left', width: cols[i].width - padding * 2 }));
        x += cols[i].width;
      });
      this.y += h;
    });
    this.y += 8;
    return this;
  }
  /** Grille d'images JPEG avec légendes. items : [{bytes, caption}] */
  imageGrid(items, { cols = 3, gap = 8, maxHeight = 150, captionSize = 7 } = {}) {
    const cw = (this.contentWidth - gap * (cols - 1)) / cols;
    for (let i = 0; i < items.length; i += cols) {
      const row = items.slice(i, i + cols).map(it => {
        try { const img = this.addImage(it.bytes); const ratio = img.height / img.width; const w = Math.min(cw, maxHeight / ratio); return { img, w, h: w * ratio, caption: this.wrap(it.caption || '', 'regular', captionSize, cw) }; }
        catch (e) { return { error: true, caption: this.wrap((it.caption || '') + ' [image illisible]', 'regular', captionSize, cw) }; }
      });
      const rowH = Math.max(...row.map(r => (r.h || 20) + r.caption.length * (captionSize + 2) + 6));
      this.ensure(rowH);
      row.forEach((r, k) => {
        const x = this.m.left + k * (cw + gap);
        if (!r.error) { this.drawImage(r.img, x + (cw - r.w) / 2, this.y, r.w, r.h); this.rect(x + (cw - r.w) / 2, this.y, r.w, r.h, { stroke: '#9aa9ae', lineWidth: 0.4 }); }
        r.caption.forEach((l, j) => this.text(l, x, this.y + (r.h || 20) + 3 + j * (captionSize + 2), { size: captionSize, color: '#4b5a61' }));
      });
      this.y += rowH + 4;
    }
    return this;
  }
  /** Image unique (signature…) dans une boîte de dimensions maximales. */
  image(bytes, { maxWidth = 200, maxHeight = 80, x = null } = {}) {
    const img = this.addImage(bytes);
    const s = Math.min(maxWidth / img.width, maxHeight / img.height, 1);
    const w = img.width * s, h = img.height * s;
    this.ensure(h + 4);
    this.drawImage(img, x ?? this.m.left, this.y, w, h);
    this.y += h + 4;
    return { w, h };
  }

  /* --- sortie --- */
  output() {
    const total = this.pages.length;
    this.pages.forEach((p, i) => {
      this.page = p;
      if (this.watermark) {
        // Filigrane en texte détouré (contour seul), par-dessus le contenu sans le masquer.
        const [r, g, b] = rgb(this.watermark.color || '#c9772a');
        const t = toWinAnsi(this.watermark.text);
        p.ops.push(`q 0.8192 0.5736 -0.5736 0.8192 ${num(this.W * 0.16)} ${num(this.H * 0.2)} cm BT 1 Tr 0.9 w /F2 ${this.watermark.size || 54} Tf ${num(r)} ${num(g)} ${num(b)} RG 0 0 Td <${hex(t)}> Tj ET Q`);
      }
      if (this.headerFn) this.headerFn(this, i + 1, total);
      if (this.footerFn) this.footerFn(this, i + 1, total);
    });
    const objects = [];
    const add = body => { objects.push(body); return objects.length; };
    const enc = s => { const b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 0xFF; return b; };
    const catalogId = add(null), pagesId = add(null);
    const fontIds = {};
    for (const f of Object.values(FONTS)) fontIds[f.key] = add(`<< /Type /Font /Subtype /Type1 /BaseFont /${f.base} /Encoding /WinAnsiEncoding >>`);
    const imgIds = {};
    for (const img of this.images) {
      const cs = img.components === 1 ? '/DeviceGray' : img.components === 4 ? '/DeviceCMYK' : '/DeviceRGB';
      imgIds[img.name] = add({ head: `<< /Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} /ColorSpace ${cs} /BitsPerComponent 8 /Filter /DCTDecode${img.components === 4 ? ' /Decode [1 0 1 0 1 0 1 0]' : ''} /Length ${img.bytes.length} >>`, bytes: img.bytes });
    }
    const fontRes = Object.entries(fontIds).map(([k, id]) => `/${k} ${id} 0 R`).join(' ');
    const xobj = Object.entries(imgIds).map(([k, id]) => `/${k} ${id} 0 R`).join(' ');
    const pageIds = [];
    for (const p of this.pages) {
      const content = p.ops.join('\n');
      const cid = add({ head: `<< /Length ${content.length} >>`, bytes: enc(content) });
      pageIds.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${num(this.W)} ${num(this.H)}] /Resources << /Font << ${fontRes} >>${xobj ? ` /XObject << ${xobj} >>` : ''} >> /Contents ${cid} 0 R >>`));
    }
    objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map(id => id + ' 0 R').join(' ')}] /Count ${pageIds.length} >>`;
    objects[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R /Lang (fr-FR) >>`;
    const d = new Date(), p2 = n => String(n).padStart(2, '0');
    const pdfDate = `D:${d.getUTCFullYear()}${p2(d.getUTCMonth() + 1)}${p2(d.getUTCDate())}${p2(d.getUTCHours())}${p2(d.getUTCMinutes())}${p2(d.getUTCSeconds())}Z`;
    const infoStr = s => `<FEFF${[...String(s)].map(ch => { const c = ch.codePointAt(0); return c > 0xFFFF ? '003F' : c.toString(16).padStart(4, '0'); }).join('')}>`;
    const infoId = add(`<< /Title ${infoStr(this.info.title)} /Author ${infoStr(this.info.author)} /Subject ${infoStr(this.info.subject)} /Keywords ${infoStr(this.info.keywords)} /Creator ${infoStr('PWA Audit prélèvements OEG')} /Producer ${infoStr('pdf.js minimal OEG')} /CreationDate (${pdfDate}) >>`);
    const chunks = [enc('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n')];
    let offset = chunks[0].length;
    const xref = [];
    objects.forEach((o, i) => {
      xref.push(offset);
      let part;
      if (typeof o === 'string') part = [enc(`${i + 1} 0 obj\n${o}\nendobj\n`)];
      else part = [enc(`${i + 1} 0 obj\n${o.head}\nstream\n`), o.bytes, enc('\nendstream\nendobj\n')];
      for (const c of part) { chunks.push(c); offset += c.length; }
    });
    const xrefStart = offset;
    let tail = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` + xref.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('');
    tail += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R /Info ${infoId} 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
    chunks.push(enc(tail));
    const out = new Uint8Array(chunks.reduce((s, c) => s + c.length, 0));
    let k = 0; for (const c of chunks) { out.set(c, k); k += c.length; }
    return out;
  }
}
