/* Composants d'interface réutilisables (gabarits HTML). */
import { html, raw, esc, fmtDate, fmtDateTime, fmtTime } from '../core/util.js';
import { store } from '../core/store.js';
import { mediaURL } from '../core/media.js';
import { hasSpeech } from './dom.js';
import {
  PRESTATION_STATUS, AUDIT_STATUS, DEVIATION_STATUS, DOC_STATUS, PROVIDER_KINDS, RESPONSES, ALERT_LEVELS
} from '../domain/model.js';

export function badge(text, cls = '') { return html`<span class="badge ${cls}">${text}</span>`; }
export function statusBadge(map, key) { const s = map[key]; return s ? badge(s.label || s, s.cls || '') : badge(key || '—', 'na'); }
export const prestationBadge = s => statusBadge(PRESTATION_STATUS, s);
export const auditBadge = a => a?.lock?.lockedAt ? badge('🔒 Signé — verrouillé', 'ok') : statusBadge(AUDIT_STATUS, a?.status);
export const deviationBadge = s => statusBadge(DEVIATION_STATUS, s);
export const docBadge = s => statusBadge(DOC_STATUS, s);
export function kindBadge(kind) { return badge(PROVIDER_KINDS[kind] || kind || '—', kind === 'regie' ? 'brand' : kind === 'partenaire' ? 'info' : 'outline'); }
export function responseBadge(code) { const r = RESPONSES[code]; return r ? badge(r.label, r.cls) : ''; }
export function critBadge(code) {
  const c = store.all('criticality').find(x => x.code === code);
  if (!c) return code ? badge(code, 'na') : badge('Criticité ?', 'na');
  return html`<span class="badge crit" style="background:${c.color || '#55636a'}">${c.label}</span>`;
}
export function alertLevelBadge(level) { const l = ALERT_LEVELS[level]; return l ? badge(l.label, l.cls) : ''; }

export function kv(pairs) {
  const rows = pairs.filter(p => p && p[1] !== undefined && p[1] !== null && p[1] !== '' && !(Array.isArray(p[1]) && !p[1].length));
  return html`<div class="kv">${rows.map(([k, v]) => html`<div>${k}</div><div>${v}</div>`)}</div>`;
}
export function empty(icon, text, action = '') { return html`<div class="empty"><span class="ic">${icon}</span><div>${text}</div>${action ? html`<div style="margin-top:12px">${action}</div>` : ''}</div>`; }
export function pageTitle(title, sub = '', right = '', back = '') {
  return html`${back ? html`<a class="back" href="${back}">‹ Retour</a>` : ''}<div class="page-title"><div><h1>${title}</h1>${sub ? html`<div class="sub">${sub}</div>` : ''}</div>${right ? html`<div class="row">${right}</div>` : ''}</div>`;
}
export function field(label, control, { required = false, hint = '', id = '' } = {}) {
  return html`<div class="field"><label ${id ? raw(`for="${esc(id)}"`) : ''}>${label}${required ? html` <span class="req">*</span>` : ''}</label>${control}${hint ? html`<div class="hint">${hint}</div>` : ''}</div>`;
}
export function options(list, selected, { placeholder = '— sélectionner —', value = x => x.id, label = x => x.label || x.name } = {}) {
  const sel = Array.isArray(selected) ? selected.map(String) : [String(selected ?? '')];
  return html`${placeholder !== null ? html`<option value="">${placeholder}</option>` : ''}${list.map(x => {
    const v = typeof x === 'string' ? x : value(x), l = typeof x === 'string' ? x : label(x);
    return html`<option value="${v}" ${sel.includes(String(v)) ? raw('selected') : ''}>${l}</option>`;
  })}`;
}
/** Boutons segmentés (choix unique). opts : [{value, label, cls, icon, sub}] */
export function seg(act, opts, value, data = {}) {
  const attrs = raw(Object.entries(data).map(([k, v]) => `data-${k}="${esc(v)}"`).join(' '));
  return html`<div class="seg">${opts.map(o => html`<button type="button" class="${String(o.value) === String(value) ? 'sel ' + (o.cls || 'brand') : ''}" data-act="${act}" data-value="${o.value}" ${attrs} aria-pressed="${String(o.value) === String(value)}">${o.icon ? html`<span class="k">${o.icon}</span>` : ''}${o.label}${o.sub ? html`<small>${o.sub}</small>` : ''}</button>`)}</div>`;
}
export function voiceBtn(targetId) {
  return hasSpeech() ? html`<button type="button" class="icon-btn" data-act="voice" data-target="${targetId}" title="Saisie vocale" aria-label="Saisie vocale">🎤</button>` : '';
}
export function progressBar(pct) { return html`<div class="progress" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><span style="width:${pct}%"></span></div>`; }

/** Boutons d'ajout de preuves (photo appareil, galerie, fichier). link = {type, id, itemId?} */
export function evidenceButtons(link, { auditId = '', photo = true, gallery = true, file = true, label = 'Photo' } = {}) {
  const data = raw(`data-link="${esc(JSON.stringify(link))}" data-audit="${esc(auditId || '')}"`);
  return html`${photo ? html`<label class="btn primary sm"><span class="ic">📷</span>${label}<input type="file" accept="image/*" capture="environment" hidden data-change="media-add" ${data}></label>` : ''}
    ${gallery ? html`<label class="btn ghost sm"><span class="ic">🖼️</span>Galerie<input type="file" accept="image/*" multiple hidden data-change="media-add" ${data}></label>` : ''}
    ${file ? html`<label class="btn ghost sm"><span class="ic">📎</span>Document<input type="file" accept="application/pdf,image/*,.doc,.docx,.xls,.xlsx,.odt,.txt" multiple hidden data-change="media-add" data-kind="document" ${data}></label>` : ''}`;
}
/** Vignettes de médias ; les images sont chargées ensuite par hydrateMedia(). */
export function thumbs(list) {
  if (!list?.length) return '';
  return html`<div class="thumbs">${list.map(m => m.mime?.startsWith('image/')
    ? html`<button type="button" class="thumb" data-act="media-view" data-id="${m.id}" title="${m.caption || ''}"><img data-media="${m.id}" alt="${m.caption || 'Photographie'}">${m.derivedFrom ? html`<span class="t-badge">annotée</span>` : ''}<span class="t-meta">${fmtTime(m.takenAt)} · ${m.authorName || ''}</span></button>`
    : html`<button type="button" class="thumb file" data-act="media-view" data-id="${m.id}"><span class="ic">📄</span>${m.name || 'Document'}</button>`)}</div>`;
}
export async function hydrateMedia(root) {
  for (const img of root.querySelectorAll('img[data-media]')) {
    if (img.getAttribute('src')) continue;
    const url = await mediaURL(img.dataset.media).catch(() => null);
    if (url) img.src = url; else img.alt = 'Image non disponible sur cet appareil';
  }
}

export function userName(id) { return store.get('user', id)?.name || ''; }
export function providerName(id) { return store.get('provider', id)?.name || '—'; }
export function siteName(id) { const s = store.get('site', id); return s ? `${s.name}${s.code ? ' (' + s.code + ')' : ''}` : '—'; }
export function operatorName(o) { if (typeof o === 'string') o = store.get('operator', o); return o ? ([o.firstName, o.lastName].filter(Boolean).join(' ') || o.code) + (o.code && o.firstName ? ` (${o.code})` : '') : '—'; }
export function docLabel(d) { return d ? `${d.reference || d.name} — v${d.version}` : '—'; }
export { fmtDate, fmtDateTime, fmtTime };
