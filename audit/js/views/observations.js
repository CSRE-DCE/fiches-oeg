/* Observations terrain simples (sans audit complet) et signalement d'urgence.
 * L'urgence crée immédiatement une observation critique + une alerte transmise en priorité dès que la
 * connexion est disponible (file d'envoi prioritaire). */
import { html, raw, fmtDateTime, fmtDate, sortBy, uuid, nowISO, localDate } from '../core/util.js';
import { store } from '../core/store.js';
import { session } from '../core/session.js';
import { can } from '../core/auth.js';
import { mediaFor } from '../core/media.js';
import { navigate, currentView } from '../ui/router.js';
import { toast, openModal, choiceDialog, formValues } from '../ui/dom.js';
import { pageTitle, kv, badge, empty, options, thumbs, hydrateMedia, evidenceButtons, siteName, providerName, operatorName, voiceBtn, field } from '../ui/components.js';
import { addFilesFromInput, viewMedia, compressImage } from '../ui/capture.js';
import { getPosition } from '../ui/gps.js';
import { saveMedia } from '../core/media.js';
import { EMERGENCY_CATEGORIES } from '../domain/model.js';
import { createDeviation } from '../app/audits.js';

/** Contexte courant : audit ouvert à l'écran, sinon rien. */
function currentContext() {
  const v = currentView();
  const auditId = v?.pattern === 'audit/:id/:step?' ? v.params.id : null;
  const audit = auditId ? store.get('audit', auditId) : null;
  const prestationId = v?.pattern === 'prestation/:id' ? v.params.id : audit?.prestationId || null;
  const p = prestationId ? store.get('prestation', prestationId) : null;
  return { audit, prestation: p, providerId: audit?.providerId || p?.providerId || '', siteId: audit?.siteId || p?.siteId || '', operatorIds: audit?.operatorIds || p?.operatorIds || [] };
}

async function captureForm({ urgent }) {
  const c = currentContext();
  let photoFiles = [];
  const posPromise = getPosition({ timeout: urgent ? 12000 : 8000, maximumAge: 60000 }).catch(e => ({ error: e.message }));
  const m = openModal({
    title: urgent ? '⚠ Signaler une situation critique' : '👁 Observation terrain', urgent, wide: true,
    body: html`<form id="obsf">
      <div class="banner ${urgent ? 'nc' : 'info'}" id="obsCtx">${fmtDateTime(nowISO())} · position en cours d’acquisition…${c.audit ? html` · audit ${c.audit.number}` : ''}</div>
      <label class="btn ${urgent ? 'danger' : 'primary'} lg block" style="margin-bottom:10px"><span class="ic">📷</span>Prendre une photo<input type="file" accept="image/*" capture="environment" hidden data-change="photo"></label>
      <div class="thumbs" id="obsThumbs"></div>
      ${urgent ? field('Nature de la situation', html`<div class="opt-list">${EMERGENCY_CATEGORIES.map((x, i) => html`<button type="button" data-act="cat" data-v="${x}" class="${i === 0 ? 'sel' : ''}">${x}</button>`)}</div><input type="hidden" name="category" value="${EMERGENCY_CATEGORIES[0]}">`) : ''}
      ${field(urgent ? 'Description de la situation' : 'Observation', html`<div class="input-wrap"><textarea name="text" id="obsText" required placeholder="${urgent ? 'Ce qui se passe, risques, personnes concernées…' : 'Pratique observée, constat…'}"></textarea>${voiceBtn('obsText')}</div>`, { required: true })}
      <div class="grid2">
        ${field('Prestataire', html`<select name="providerId">${options(sortBy(store.all('provider'), 'name'), c.providerId, { placeholder: 'Non précisé' })}</select>`)}
        ${field('Site', html`<select name="siteId">${options(sortBy(store.all('site'), 'name'), c.siteId, { placeholder: 'Non précisé', label: s => `${s.name} (${s.code})` })}</select>`)}
      </div>
      ${field('Opérateur concerné', html`<select name="operatorId">${options(sortBy(store.filter('operator', o => !c.providerId || o.providerId === c.providerId), 'code'), c.operatorIds?.[0], { label: o => operatorName(o), placeholder: 'Non précisé' })}</select>`)}
    </form>`,
    actions: [{ label: 'Annuler' }, { label: urgent ? '⚠ Enregistrer et transmettre l’alerte' : 'Enregistrer l’observation', act: 'ok', cls: urgent ? 'danger' : 'primary' }],
    async onMount(root) {
      const pos = await posPromise;
      const el = root.querySelector('#obsCtx'); if (!el) return;
      el.textContent = `${fmtDateTime(nowISO())} · ${pos?.lat ? `GPS ${pos.lat.toFixed(5)}, ${pos.lon.toFixed(5)} (±${Math.round(pos.accuracy)} m)` : 'position indisponible'}${c.audit ? ' · audit ' + c.audit.number : ''}${c.prestation ? ' · prestation ' + c.prestation.ref : ''}`;
    },
    handlers: {
      async photo(el) {
        for (const f of el.files) { const r = await compressImage(f); photoFiles.push(r); const url = URL.createObjectURL(new Blob([r.bytes], { type: 'image/jpeg' })); this.root.querySelector('#obsThumbs').insertAdjacentHTML('beforeend', `<div class="thumb"><img src="${url}" alt=""></div>`); }
        el.value = '';
      },
      cat(el) { this.root.querySelectorAll('[data-act=cat]').forEach(b => b.classList.toggle('sel', b === el)); this.root.querySelector('[name=category]').value = el.dataset.v; },
      async voice(el) { (await import('../ui/voice.js')).dictate(this.root.querySelector('#' + el.dataset.target)); },
      ok() { const f = this.root.querySelector('#obsf'); if (!f.reportValidity()) return; this.close(formValues(f)); }
    }
  });
  const v = await m.result;
  if (!v) return null;
  const pos = await posPromise;
  const gps = pos?.lat ? { lat: pos.lat, lon: pos.lon, accuracy: pos.accuracy, at: pos.at } : null;
  const obs = {
    id: uuid(), kind: urgent ? 'urgence' : 'observation', at: nowISO(), author: session.user.id, authorName: session.user.name,
    category: v.category || '', text: v.text, providerId: v.providerId || null, siteId: v.siteId || null, operatorId: v.operatorId || null,
    prestationId: c.prestation?.id || null, linkedAuditId: c.audit?.id || null, linkedDeviationId: null, gps, status: urgent ? 'alerte' : 'nouvelle'
  };
  await store.put('observation', obs, { action: urgent ? 'emergency' : 'create' });
  for (const p of photoFiles) await saveMedia(p.bytes, { mime: 'image/jpeg', kind: 'photo', link: { type: 'observation', id: obs.id }, gps, width: p.width, height: p.height, caption: urgent ? 'Situation critique' : 'Observation terrain' });
  if (urgent) {
    await store.put('alert', {
      id: uuid(), observationId: obs.id, level: 'critique', category: obs.category, message: obs.text, at: obs.at, by: session.user.name,
      providerId: obs.providerId, providerName: providerName(obs.providerId), siteId: obs.siteId, siteName: siteName(obs.siteId), prestationId: obs.prestationId, auditId: obs.linkedAuditId,
      gps, photos: photoFiles.length, deviceName: session.device.name, status: 'a_transmettre'
    }, { action: 'emergency' });
    const { scheduleSync } = await import('../app/sync.js');
    scheduleSync(0);
    toast(navigator.onLine && session.mode === 'server' ? 'Alerte enregistrée et en cours de transmission' : 'Alerte enregistrée — transmission dès que la connexion sera disponible', 'warn', 6000);
  } else toast('Observation enregistrée ✓', 'ok');
  return obs;
}
export const openEmergency = () => captureForm({ urgent: true });
export const openQuickObservation = () => captureForm({ urgent: false });

export default {
  nav: 'observations', title: 'Observations',
  async render(params, q) {
    let list = sortBy(store.all('observation'), '-at');
    if (q.type) list = list.filter(o => o.kind === q.type);
    if (q.libres) list = list.filter(o => !o.linkedAuditId && !o.linkedDeviationId);
    const alerts = store.all('alert');
    return html`${pageTitle('Observations terrain', 'Constats ponctuels sans audit complet, situations critiques', can('observation.create') ? html`<button class="btn primary" data-act="new"><span class="ic">👁️</span>Observation</button><button class="btn danger" data-act="urgent"><span class="ic">⚠</span>Urgence</button>` : '')}
      <div class="chips" style="margin-bottom:10px">${[['', 'Toutes'], ['observation', 'Observations'], ['urgence', 'Urgences']].map(([k, l]) => html`<button class="chip ${(q.type || '') === k ? 'sel' : ''}" data-act="q" data-k="type" data-v="${k}">${l}</button>`)}<button class="chip ${q.libres ? 'sel' : ''}" data-act="q" data-k="libres" data-v="${q.libres ? '' : '1'}">Non rattachées</button></div>
      ${list.length ? html`<div class="list">${list.map(o => { const al = alerts.find(a => a.observationId === o.id); const ph = mediaFor({ type: 'observation', id: o.id }); return html`
        <div class="li ${o.kind === 'urgence' ? 'stripe-nc' : 'stripe-info'}"><div class="li-main">
          <div class="li-title">${o.kind === 'urgence' ? '⚠ ' + (o.category || 'Urgence') : 'Observation'} — ${fmtDateTime(o.at)}</div>
          <div class="li-sub">${o.text}</div>
          <div class="li-sub">${o.authorName} · ${providerName(o.providerId)} · ${siteName(o.siteId)}${o.operatorId ? ' · ' + operatorName(o.operatorId) : ''}${o.gps ? ` · GPS ${o.gps.lat.toFixed(4)}, ${o.gps.lon.toFixed(4)}` : ''}</div>
          <div class="row" style="gap:6px;margin-top:6px">${al ? (al._rev ? badge('Alerte transmise', 'ok') : badge('Alerte en attente de transmission', 'warn')) : ''}${o.linkedAuditId ? html`<a class="badge info" href="#/audit/${o.linkedAuditId}">Audit ${store.get('audit', o.linkedAuditId)?.number || ''}</a>` : ''}${o.linkedDeviationId ? html`<a class="badge nc" href="#/ecart/${o.linkedDeviationId}">Écart ${store.get('deviation', o.linkedDeviationId)?.number || ''}</a>` : ''}</div>
          ${thumbs(ph)}
          ${can('observation.create') ? html`<div class="item-tools"><button class="btn ghost sm" data-act="link-audit" data-id="${o.id}">Rattacher à un audit</button>${can('deviation.manage') ? html`<button class="btn ghost sm" data-act="to-dev" data-id="${o.id}">Créer un écart</button>` : ''}</div>` : ''}
        </div></div>`; })}</div>` : html`<div class="card">${empty('👁️', 'Aucune observation enregistrée.')}</div>`}
      ${session.mode !== 'server' && alerts.length ? html`<p class="note">Mode autonome : les alertes restent sur l’appareil (aucun serveur de transmission configuré).</p>` : ''}`;
  },
  async mount(root) { await hydrateMedia(root); },
  handlers: {
    async new() { if (await openQuickObservation()) this.refresh(); },
    async urgent() { if (await openEmergency()) this.refresh(); },
    q(el) { const q = { ...this.query, [el.dataset.k]: el.dataset.v }; if (!el.dataset.v) delete q[el.dataset.k]; navigate('/observations?' + new URLSearchParams(q), { replace: true }); },
    async 'media-view'(el) { await viewMedia(el.dataset.id); },
    async 'link-audit'(el) {
      const o = store.get('observation', el.dataset.id);
      const audits = sortBy(store.filter('audit', a => a.status !== 'abandonne' && (!o.siteId || a.siteId === o.siteId || !o.providerId || a.providerId === o.providerId)), '-startedAt').slice(0, 30);
      if (!audits.length) { toast('Aucun audit correspondant.', 'warn'); return; }
      const id = await choiceDialog({ title: 'Rattacher l’observation', options: audits.map(a => ({ value: a.id, label: `${a.number} — ${siteName(a.siteId)}`, desc: `${fmtDate(a.startedAt)} · ${providerName(a.providerId)}` })) });
      if (!id) return;
      await store.put('observation', { ...o, linkedAuditId: id }, { reason: 'Rattachement à un audit' });
      this.refresh();
    },
    async 'to-dev'(el) {
      const o = store.get('observation', el.dataset.id);
      let auditId = o.linkedAuditId;
      if (!auditId) { toast('Rattachez d’abord l’observation à un audit.', 'warn'); return; }
      const audit = store.get('audit', auditId);
      const { openDeviationForm } = await import('./audit-modules.js');
      const dev = await openDeviationForm(audit, { requirement: o.category || 'Observation terrain', description: o.text, source: 'observation', reason: audit.lock?.lockedAt ? 'Écart issu d’une observation terrain' : null });
      if (dev) { await store.put('observation', { ...store.get('observation', o.id), linkedDeviationId: dev.id }, { reason: 'Écart créé à partir de l’observation' }); this.refresh(); }
    }
  }
};
