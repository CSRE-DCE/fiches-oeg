/* Aides d'interface : délégation d'événements, modales, confirmations, notifications. */
import { html, raw, esc } from '../core/util.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/**
 * Délégation d'événements : tout élément portant data-act="nom" déclenche handlers.nom(el, ev) au clic ;
 * data-change / data-input pour les événements change / input ; data-submit pour les formulaires.
 */
export function bindActions(root, handlers, ctx = {}) {
  const run = async (name, el, ev) => {
    const fn = handlers[name];
    if (!fn) return;
    try { await fn.call(ctx, el, ev); }
    catch (err) { console.error(err); toast(err?.message || String(err), 'err'); }
  };
  const onClick = ev => {
    const el = ev.target.closest('[data-act]');
    if (!el || !root.contains(el) || el.disabled) return;
    if (el.tagName === 'A' && !el.getAttribute('href')?.startsWith('#/')) ev.preventDefault();
    if (el.tagName === 'BUTTON' || el.dataset.prevent !== undefined) ev.preventDefault();
    run(el.dataset.act, el, ev);
  };
  const onChange = ev => { const el = ev.target.closest('[data-change]'); if (el && root.contains(el)) run(el.dataset.change, el, ev); };
  const onInput = ev => { const el = ev.target.closest('[data-input]'); if (el && root.contains(el)) run(el.dataset.input, el, ev); };
  const onSubmit = ev => { const el = ev.target.closest('form[data-submit]'); if (el) { ev.preventDefault(); run(el.dataset.submit, el, ev); } };
  root.addEventListener('click', onClick);
  root.addEventListener('change', onChange);
  root.addEventListener('input', onInput);
  root.addEventListener('submit', onSubmit);
  return () => { root.removeEventListener('click', onClick); root.removeEventListener('change', onChange); root.removeEventListener('input', onInput); root.removeEventListener('submit', onSubmit); };
}

/* ---------- Notifications ---------- */
export function toast(message, kind = '', ms = 3200) {
  const rootEl = document.getElementById('toast-root') || document.body;
  const el = document.createElement('div');
  el.className = 'toast ' + kind;
  el.setAttribute('role', kind === 'err' ? 'alert' : 'status');
  el.textContent = message;
  rootEl.appendChild(el);
  setTimeout(() => el.remove(), ms);
}

/* ---------- Modales ---------- */
let modalDepth = 0;
/**
 * Ouvre une fenêtre modale. Retourne {root, close(value), result:Promise}.
 * opts : {title, body:SafeHTML, actions:[{label, cls, act}], handlers, wide, urgent, onMount, dismissable}
 */
export function openModal(opts) {
  const back = document.createElement('div');
  back.className = 'modal-back';
  back.style.zIndex = String(200 + modalDepth++);
  const dialog = document.createElement('div');
  dialog.className = 'modal' + (opts.wide ? ' wide' : '') + (opts.urgent ? ' urgent' : '');
  dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true');
  dialog.innerHTML = String(html`
    <div class="modal-head"><h2>${opts.title || ''}</h2>${opts.dismissable === false ? '' : html`<button class="icon-btn" data-act="__close" aria-label="Fermer">✕</button>`}</div>
    <div class="modal-body">${opts.body || ''}</div>
    ${opts.actions?.length ? html`<div class="modal-actions">${opts.actions.map(a => html`<button class="btn ${a.cls || 'ghost'}" data-act="${a.act || '__close'}" ${a.id ? raw(`id="${esc(a.id)}"`) : ''}>${a.label}</button>`)}</div>` : ''}`);
  back.appendChild(dialog);
  document.body.appendChild(back);
  let resolveFn;
  const result = new Promise(r => { resolveFn = r; });
  const prevFocus = document.activeElement;
  const api = {
    root: dialog,
    close(value) {
      if (!back.isConnected) return;
      unbind(); back.remove(); modalDepth--;
      document.removeEventListener('keydown', onKey);
      opts.onClose?.(value);
      resolveFn(value);
      prevFocus?.focus?.();
    },
    setBody(safe) { dialog.querySelector('.modal-body').innerHTML = String(safe); },
    result
  };
  const unbind = bindActions(dialog, { __close: () => api.close(undefined), ...(opts.handlers || {}) }, api);
  const onKey = e => { if (e.key === 'Escape' && opts.dismissable !== false) api.close(undefined); };
  document.addEventListener('keydown', onKey);
  if (opts.dismissable !== false) back.addEventListener('click', e => { if (e.target === back) api.close(undefined); });
  opts.onMount?.(dialog, api);
  setTimeout(() => (dialog.querySelector('[autofocus]') || dialog.querySelector('input,select,textarea'))?.focus?.(), 50);
  return api;
}

export function confirmDialog({ title = 'Confirmer', message = '', okLabel = 'Confirmer', cancelLabel = 'Annuler', danger = false } = {}) {
  const m = openModal({
    title, body: html`<p style="font-size:16px;margin:0">${message}</p>`,
    actions: [{ label: cancelLabel, act: 'no' }, { label: okLabel, cls: danger ? 'danger' : 'primary', act: 'yes' }],
    handlers: { yes() { this.close(true); }, no() { this.close(false); } }
  });
  return m.result.then(v => v === true);
}

/** Saisie d'un texte (motif de modification, commentaire…). Retourne la chaîne ou null si annulé. */
export function promptDialog({ title = '', label = '', value = '', required = true, multiline = true, placeholder = '', hint = '', okLabel = 'Valider', voice = true } = {}) {
  const m = openModal({
    title,
    body: html`<div class="field"><label for="__prompt">${label}${required ? html` <span class="req">*</span>` : ''}</label>
      <div class="input-wrap">${multiline ? html`<textarea id="__prompt" placeholder="${placeholder}">${value}</textarea>` : html`<input id="__prompt" value="${value}" placeholder="${placeholder}">`}
      ${voice && hasSpeech() ? html`<button class="icon-btn" data-act="voice" title="Dicter">🎤</button>` : ''}</div>
      ${hint ? html`<div class="hint">${hint}</div>` : ''}<div class="hint" id="__prompt_err" style="color:var(--nc)"></div></div>`,
    actions: [{ label: 'Annuler', act: 'cancel' }, { label: okLabel, cls: 'primary', act: 'ok' }],
    handlers: {
      ok() {
        const v = this.root.querySelector('#__prompt').value.trim();
        if (required && !v) { this.root.querySelector('#__prompt_err').textContent = 'Ce champ est obligatoire.'; return; }
        this.close(v);
      },
      cancel() { this.close(null); },
      async voice() { const { dictate } = await import('./voice.js'); dictate(this.root.querySelector('#__prompt')); }
    }
  });
  return m.result.then(v => (v === undefined ? null : v));
}

/** Choix parmi des options (gros boutons). Retourne la valeur ou null. */
export function choiceDialog({ title = '', message = '', options = [] } = {}) {
  const m = openModal({
    title,
    body: html`${message ? html`<p class="note">${message}</p>` : ''}<div class="list">${options.map((o, i) => html`
      <button class="li" data-act="pick" data-i="${i}"><div class="li-main"><div class="li-title">${o.label}</div>${o.desc ? html`<div class="li-sub">${o.desc}</div>` : ''}</div><span class="chev">›</span></button>`)}</div>`,
    handlers: { pick(el) { this.close(options[Number(el.dataset.i)].value); } }
  });
  return m.result.then(v => (v === undefined ? null : v));
}

export function hasSpeech() { return !!(globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition); }

/** Téléchargement d'un fichier généré. */
export function downloadBlob(data, filename, mime = 'application/octet-stream') {
  const blob = data instanceof Blob ? data : new Blob([data], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.rel = 'noopener';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

export function readFileAsArrayBuffer(file) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsArrayBuffer(file); });
}
export function readFileAsText(file) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsText(file); });
}

/** Valeurs d'un formulaire (champs portant un attribut name). Les cases à cocher multiples donnent un tableau. */
export function formValues(root) {
  const out = {};
  for (const el of root.querySelectorAll('[name]')) {
    const n = el.name;
    if (el.type === 'checkbox') {
      if (el.dataset.multi !== undefined) { out[n] = out[n] || []; if (el.checked) out[n].push(el.value); }
      else out[n] = el.checked;
    } else if (el.type === 'radio') { if (el.checked) out[n] = el.value; else if (!(n in out)) out[n] = ''; }
    else if (el.multiple) out[n] = [...el.selectedOptions].map(o => o.value);
    else out[n] = el.type === 'number' ? (el.value === '' ? '' : Number(el.value)) : el.value;
  }
  return out;
}
