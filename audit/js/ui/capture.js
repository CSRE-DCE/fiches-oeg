/* Prise de photographies et de pièces jointes, visionneuse et annotation.
 * Chaque photo est compressée (1600 px max, JPEG), horodatée, géolocalisée si possible et rattachée à
 * l'objet contrôlé (audit, critère, échantillon, équipement, écart, point…). */
import { html, fmtDateTime, fmtBytes, nowISO } from '../core/util.js';
import { saveMedia, mediaURL, mediaBytes, verifyMedia } from '../core/media.js';
import { store } from '../core/store.js';
import { session } from '../core/session.js';
import { openModal, toast, downloadBlob, readFileAsArrayBuffer } from './dom.js';
import { kv } from './components.js';
import { quickPosition } from './gps.js';

const MAX_SIDE = 1600, QUALITY = 0.82;

function loadImage(blob) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { res(img); setTimeout(() => URL.revokeObjectURL(url), 1000); };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('Image illisible')); };
    img.src = url;
  });
}
function canvasToBytes(canvas, type = 'image/jpeg', quality = QUALITY) {
  return new Promise((res, rej) => canvas.toBlob(async b => b ? res(new Uint8Array(await b.arrayBuffer())) : rej(new Error('Conversion impossible')), type, quality));
}
/** Redimensionne et convertit une image en JPEG. Retourne {bytes, width, height}. */
export async function compressImage(blob, maxSide = MAX_SIDE, quality = QUALITY) {
  const img = await loadImage(blob);
  const s = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.round(img.naturalWidth * s), h = Math.round(img.naturalHeight * s);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); ctx.drawImage(img, 0, 0, w, h);
  return { bytes: await canvasToBytes(c, 'image/jpeg', quality), width: w, height: h };
}
/** Conversion de n'importe quelle image (PNG de signature…) en JPEG pour le rapport PDF. */
export async function toJPEG(bytes, mime, maxSide = 1400) {
  if (mime === 'image/jpeg') return bytes;
  return (await compressImage(new Blob([bytes], { type: mime }), maxSide, 0.88)).bytes;
}

/**
 * Enregistre les fichiers choisis dans un <input type=file data-link=…>.
 * Retourne la liste des médias créés.
 */
export async function addFilesFromInput(input, extra = {}) {
  const files = [...(input.files || [])];
  input.value = '';
  if (!files.length) return [];
  const link = JSON.parse(input.dataset.link || 'null');
  const auditId = input.dataset.audit || extra.auditId || null;
  const asDocument = input.dataset.kind === 'document';
  const gps = await quickPosition().catch(() => null);
  const created = [];
  for (const f of files) {
    try {
      if (f.type.startsWith('image/') && !asDocument || (asDocument && f.type.startsWith('image/') && f.size > 2_000_000)) {
        const { bytes, width, height } = await compressImage(f);
        created.push(await saveMedia(bytes, { mime: 'image/jpeg', kind: extra.kind || 'photo', name: f.name, link, auditId, gps, width, height, takenAt: nowISO(), caption: extra.caption || '' }));
      } else {
        if (f.size > 25_000_000) { toast(`${f.name} : fichier trop volumineux (25 Mo maximum).`, 'err'); continue; }
        const bytes = new Uint8Array(await readFileAsArrayBuffer(f));
        created.push(await saveMedia(bytes, { mime: f.type || 'application/octet-stream', kind: extra.kind || 'document', name: f.name, link, auditId, gps, takenAt: nowISO(), caption: extra.caption || '' }));
      }
    } catch (e) { toast(`${f.name} : ${e.message}`, 'err'); }
  }
  if (created.length) toast(`${created.length} preuve(s) enregistrée(s) ✓`, 'ok', 1800);
  return created;
}

function linkLabel(link) {
  if (!link) return '—';
  const names = { audit: 'Audit', item: 'Critère', sample: 'Échantillon', equipment: 'Équipement', deviation: 'Écart', point: 'Point de prélèvement', observation: 'Observation', operator: 'Opérateur', document: 'Document', signature: 'Signature', action: 'Action corrective', gps: 'Relevé GPS' };
  return `${names[link.type] || link.type}${link.itemId ? ' — ' + link.itemId.replace(/^it-/, '') : ''}`;
}

/** Visionneuse : image ou document, métadonnées, vérification d'intégrité, annotation. */
export async function viewMedia(id, { readOnly = false, onChange } = {}) {
  const m = store.get('media', id);
  if (!m) return toast('Média introuvable', 'err');
  const url = await mediaURL(id);
  const audit = m.auditId ? store.get('audit', m.auditId) : null;
  const derived = store.filter('media', x => x.derivedFrom === id);
  const isImg = m.mime?.startsWith('image/');
  const modal = openModal({
    title: isImg ? 'Photographie' : (m.name || 'Document'), wide: true,
    body: html`${!url ? html`<div class="banner warn">Contenu non disponible sur cet appareil (il sera téléchargé à la prochaine synchronisation).</div>` : isImg ? html`<img src="${url}" alt="" style="width:100%;border-radius:12px;background:#111">` : html`<div class="btn-row"><a class="btn primary" href="${url}" target="_blank" rel="noopener">Ouvrir le document</a></div>`}
      <div style="margin-top:12px">${kv([
        ['Date et heure', fmtDateTime(m.takenAt)], ['Auteur', m.authorName], ['Audit', audit?.number], ['Objet contrôlé', linkLabel(m.link)],
        ['Position GPS', m.gps ? `${m.gps.lat.toFixed(6)}, ${m.gps.lon.toFixed(6)} (±${Math.round(m.gps.accuracy || 0)} m)` : 'non relevée'],
        ['Légende', m.caption], ['Fichier', `${m.name || ''} ${m.mime} · ${fmtBytes(m.size)}`], ['Empreinte SHA-256', html`<span class="mono tiny">${m.sha256}</span>`],
        ['Version annotée de', m.derivedFrom ? 'la photographie originale (conservée)' : ''], ['Versions annotées', derived.length ? `${derived.length}` : '']
      ])}</div><div id="__verify" class="hint"></div>`,
    actions: [
      ...(isImg && !readOnly && url ? [{ label: '✏️ Annoter', act: 'annotate', cls: 'ghost' }] : []),
      ...(!readOnly ? [{ label: 'Légende', act: 'caption', cls: 'ghost' }] : []),
      { label: 'Vérifier l’intégrité', act: 'verify', cls: 'ghost' },
      ...(url ? [{ label: 'Télécharger', act: 'download', cls: 'ghost' }] : []),
      { label: 'Fermer', act: '__close', cls: 'primary' }
    ],
    handlers: {
      async verify() { const r = await verifyMedia(id); this.root.querySelector('#__verify').innerHTML = r.ok ? '✅ Contenu intègre : l’empreinte SHA-256 correspond à celle enregistrée.' : `❌ ${r.reason}`; },
      async download() { const b = await mediaBytes(id); downloadBlob(b, m.name || `${m.id}.${(m.mime || '').split('/')[1] || 'bin'}`, m.mime); },
      async caption() {
        const { promptDialog } = await import('./dom.js');
        const v = await promptDialog({ title: 'Légende de la photographie', label: 'Légende', value: m.caption || '', required: false, multiline: false });
        if (v === null) return;
        await store.put('media', { ...store.get('media', id), caption: v }, { reason: 'Modification de la légende' });
        this.close(); onChange?.();
      },
      async annotate() { this.close(); const created = await annotateMedia(id); if (created) onChange?.(created); }
    }
  });
  return modal.result;
}

/** Éditeur d'annotation : trait libre, flèche, cercle, texte ; enregistre une NOUVELLE image dérivée. */
export async function annotateMedia(id) {
  const m = store.get('media', id);
  const url = await mediaURL(id);
  if (!url) return null;
  const img = await loadImage(await (await fetch(url)).blob());
  const W = img.naturalWidth, H = img.naturalHeight;
  const shapes = [];
  let tool = 'pen', color = '#ff2d2d', drawing = null;
  const modal_ctx = {};
  const modal = openModal({
    title: 'Annoter la photographie', wide: true,
    body: html`<div class="row" style="margin-bottom:10px">
        <div class="seg compact" style="flex:1;grid-template-columns:repeat(4,1fr)">
          ${[['pen', '✏️ Trait'], ['arrow', '➜ Flèche'], ['circle', '◯ Cercle'], ['text', 'T Texte']].map(([t, l]) => html`<button type="button" data-act="tool" data-tool="${t}" class="${t === 'pen' ? 'sel brand' : ''}">${l}</button>`)}
        </div>
        <div class="swatches">${['#ff2d2d', '#ffd400', '#ffffff', '#000000', '#00c853'].map(c => html`<button type="button" class="swatch ${c === color ? 'sel' : ''}" style="background:${c}" data-act="color" data-color="${c}" aria-label="Couleur ${c}"></button>`)}</div>
      </div>
      <div class="annot-wrap"><canvas id="__annot" width="${W}" height="${H}"></canvas></div>
      <p class="note">L’original est conservé intact : l’annotation crée une nouvelle image liée à l’originale.</p>`,
    actions: [{ label: '↶ Annuler le dernier', act: 'undo', cls: 'ghost' }, { label: 'Abandonner', act: '__close', cls: 'ghost' }, { label: 'Enregistrer l’annotation', act: 'save', cls: 'primary' }],
    onMount(root) {
      const cv = root.querySelector('#__annot'), ctx = cv.getContext('2d');
      const lw = Math.max(4, Math.round(Math.max(W, H) / 220));
      const redraw = () => {
        ctx.drawImage(img, 0, 0, W, H);
        for (const s of [...shapes, ...(drawing ? [drawing] : [])]) {
          ctx.strokeStyle = s.color; ctx.fillStyle = s.color; ctx.lineWidth = lw; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
          if (s.tool === 'pen') { ctx.beginPath(); s.pts.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); ctx.stroke(); }
          if (s.tool === 'circle') { const r = Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]); ctx.beginPath(); ctx.arc(s.a[0], s.a[1], r, 0, Math.PI * 2); ctx.stroke(); }
          if (s.tool === 'arrow') {
            const [x1, y1] = s.a, [x2, y2] = s.b, ang = Math.atan2(y2 - y1, x2 - x1), hl = lw * 5;
            ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(x2, y2); ctx.lineTo(x2 - hl * Math.cos(ang - 0.45), y2 - hl * Math.sin(ang - 0.45)); ctx.lineTo(x2 - hl * Math.cos(ang + 0.45), y2 - hl * Math.sin(ang + 0.45)); ctx.closePath(); ctx.fill();
          }
          if (s.tool === 'text') { ctx.font = `bold ${lw * 6}px sans-serif`; ctx.lineWidth = lw / 1.5; ctx.strokeStyle = s.color === '#000000' ? '#fff' : '#000'; ctx.strokeText(s.text, s.a[0], s.a[1]); ctx.fillText(s.text, s.a[0], s.a[1]); }
        }
      };
      const pos = e => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) * W / r.width, (e.clientY - r.top) * H / r.height]; };
      cv.addEventListener('pointerdown', async e => {
        cv.setPointerCapture(e.pointerId);
        const p = pos(e);
        if (tool === 'text') {
          const { promptDialog } = await import('./dom.js');
          const t = await promptDialog({ title: 'Texte de l’annotation', label: 'Texte', multiline: false, voice: false });
          if (t) { shapes.push({ tool, color, a: p, text: t }); redraw(); }
          return;
        }
        drawing = tool === 'pen' ? { tool, color, pts: [p] } : { tool, color, a: p, b: p };
      });
      cv.addEventListener('pointermove', e => { if (!drawing) return; const p = pos(e); if (drawing.tool === 'pen') drawing.pts.push(p); else drawing.b = p; redraw(); });
      const end = () => { if (drawing) { shapes.push(drawing); drawing = null; redraw(); } };
      cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
      redraw();
      modal_ctx.redraw = redraw; modal_ctx.canvas = cv;
    },
    handlers: {
      tool(el) { tool = el.dataset.tool; this.root.querySelectorAll('[data-act=tool]').forEach(b => b.className = b === el ? 'sel brand' : ''); },
      color(el) { color = el.dataset.color; this.root.querySelectorAll('.swatch').forEach(b => b.classList.toggle('sel', b === el)); },
      undo() { shapes.pop(); modal_ctx.redraw(); },
      async save() {
        if (!shapes.length) { toast('Aucune annotation à enregistrer.', 'warn'); return; }
        const bytes = await canvasToBytes(modal_ctx.canvas, 'image/jpeg', 0.85);
        const created = await saveMedia(bytes, { mime: 'image/jpeg', kind: 'photo', name: (m.name || 'photo') + ' (annotée)', link: m.link, auditId: m.auditId, gps: m.gps, width: W, height: H, derivedFrom: id, caption: m.caption ? m.caption + ' (annotée)' : 'Photographie annotée', annotation: { shapes: shapes.length, by: session.user?.name } });
        toast('Annotation enregistrée — l’original est conservé ✓', 'ok');
        this.close(created);
      }
    }
  });
  return modal.result.then(v => v || null);
}
