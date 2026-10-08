/* Pavé de signature tactile (doigt, stylet, souris). */
import { html } from '../core/util.js';
import { openModal, toast } from './dom.js';

/** Ouvre un pavé de signature ; retourne {bytes (PNG), strokes} ou null. */
export function signaturePad({ title = 'Signature', signer = '', statement = '' } = {}) {
  let strokes = [];
  const modal_ctx = {};
  const modal = openModal({
    title,
    body: html`${signer ? html`<p style="margin:0 0 6px;font-weight:800">${signer}</p>` : ''}${statement ? html`<p class="note">${statement}</p>` : ''}
      <canvas class="sig-pad" id="__sig"></canvas><p class="hint">Signez dans le cadre avec le doigt ou un stylet.</p>`,
    actions: [{ label: 'Effacer', act: 'clear', cls: 'ghost' }, { label: 'Annuler', act: '__close', cls: 'ghost' }, { label: 'Valider la signature', act: 'ok', cls: 'primary' }],
    onMount(root) {
      const cv = root.querySelector('#__sig');
      const ratio = Math.max(1, globalThis.devicePixelRatio || 1);
      const fit = () => { const r = cv.getBoundingClientRect(); cv.width = Math.round(r.width * ratio); cv.height = Math.round(r.height * ratio); draw(); };
      const ctx = cv.getContext('2d');
      let cur = null;
      function draw() {
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
        ctx.strokeStyle = '#0b2a4a'; ctx.lineWidth = 2.6 * ratio; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        for (const s of [...strokes, ...(cur ? [cur] : [])]) { ctx.beginPath(); s.forEach((p, i) => i ? ctx.lineTo(p[0] * cv.width, p[1] * cv.height) : ctx.moveTo(p[0] * cv.width, p[1] * cv.height)); ctx.stroke(); }
      }
      const pos = e => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height]; };
      cv.addEventListener('pointerdown', e => { cv.setPointerCapture(e.pointerId); cur = [pos(e)]; draw(); });
      cv.addEventListener('pointermove', e => { if (cur) { cur.push(pos(e)); draw(); } });
      const end = () => { if (cur && cur.length) strokes.push(cur); cur = null; draw(); };
      cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
      requestAnimationFrame(fit);
      modal_ctx.canvas = cv; modal_ctx.draw = draw;
    },
    handlers: {
      clear() { strokes = []; modal_ctx.draw(); },
      ok() {
        const points = strokes.reduce((s, x) => s + x.length, 0);
        if (points < 8) { toast('Signature trop courte : signez dans le cadre.', 'warn'); return; }
        modal_ctx.canvas.toBlob(async b => this.close({ bytes: new Uint8Array(await b.arrayBuffer()), mime: 'image/png', strokes: strokes.length }), 'image/png');
      }
    }
  });
  return modal.result.then(v => v || null);
}
