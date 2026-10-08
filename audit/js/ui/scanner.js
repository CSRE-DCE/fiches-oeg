/* Lecture de QR codes, codes-barres et étiquettes avec la caméra.
 * Utilise l'API BarcodeDetector lorsqu'elle existe (Android/Chrome : QR, Code 128, EAN, DataMatrix…),
 * sinon la bibliothèque jsQR embarquée (QR codes uniquement). Saisie manuelle toujours possible. */
import { html } from '../core/util.js';
import { openModal, toast } from './dom.js';

let jsqrLoading = null;
function loadJsQR() {
  if (globalThis.jsQR) return Promise.resolve(globalThis.jsQR);
  if (!jsqrLoading) jsqrLoading = new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = new URL('../../vendor/jsqr/jsQR.js', import.meta.url).href;
    s.onload = () => res(globalThis.jsQR); s.onerror = () => rej(new Error('Lecteur QR indisponible'));
    document.head.appendChild(s);
  });
  return jsqrLoading;
}

/** Ouvre le lecteur ; retourne le texte lu (ou saisi) ou null. */
export function scanCode({ title = 'Scanner une étiquette' } = {}) {
  let stream = null, stopped = false, detector = null;
  const stop = () => { stopped = true; stream?.getTracks().forEach(t => t.stop()); };
  const modal = openModal({
    title,
    body: html`<div style="position:relative;background:#000;border-radius:12px;overflow:hidden;aspect-ratio:4/3">
        <video id="__scanv" playsinline muted style="width:100%;height:100%;object-fit:cover"></video>
        <div style="position:absolute;inset:18% 15%;border:3px solid #00ac97;border-radius:14px;box-shadow:0 0 0 999px #0006"></div>
      </div>
      <p class="note" id="__scanmsg">Placez le code dans le cadre.</p>
      <div class="field"><label>Ou saisir le code manuellement</label><div class="input-wrap"><input id="__scanmanual" inputmode="text" autocomplete="off"><button class="btn primary" data-act="manual">Valider</button></div></div>`,
    onClose: stop,
    handlers: { manual() { const v = this.root.querySelector('#__scanmanual').value.trim(); if (v) this.close(v); } },
    async onMount(root, api) {
      const video = root.querySelector('#__scanv'), msg = root.querySelector('#__scanmsg');
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('Caméra non disponible');
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
        if (stopped) return stop();
        video.srcObject = stream; await video.play();
      } catch (e) { msg.textContent = 'Caméra indisponible : saisissez le code manuellement. (' + e.message + ')'; return; }
      if ('BarcodeDetector' in globalThis) {
        try { const formats = await globalThis.BarcodeDetector.getSupportedFormats(); detector = new globalThis.BarcodeDetector({ formats }); msg.textContent = 'Lecture des QR codes et codes-barres…'; } catch (e) { detector = null; }
      }
      let jsqr = null;
      if (!detector) { try { jsqr = await loadJsQR(); msg.textContent = 'Lecture des QR codes… (codes-barres : saisie manuelle sur ce navigateur)'; } catch (e) { msg.textContent = e.message; } }
      const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d', { willReadFrequently: true });
      const tick = async () => {
        if (stopped || !video.videoWidth) { if (!stopped) setTimeout(tick, 250); return; }
        try {
          if (detector) {
            const codes = await detector.detect(video);
            if (codes.length) { navigator.vibrate?.(80); api.close(codes[0].rawValue); return; }
          } else if (jsqr) {
            const w = Math.min(640, video.videoWidth), h = Math.round(video.videoHeight * w / video.videoWidth);
            canvas.width = w; canvas.height = h; ctx.drawImage(video, 0, 0, w, h);
            const r = jsqr(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'dontInvert' });
            if (r?.data) { navigator.vibrate?.(80); api.close(r.data); return; }
          }
        } catch (e) { /* image suivante */ }
        setTimeout(tick, 200);
      };
      tick();
    }
  });
  return modal.result.then(v => { stop(); if (v) toast('Code lu : ' + v, 'ok', 1800); return v || null; });
}
