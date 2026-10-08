/* Audit inopiné (non planifié) : prestataire, site, prestation éventuelle, grille → démarrage immédiat. */
import { html, sortBy, localDate, addDays, haversine, fmtDistance, fmtDate } from '../core/util.js';
import { store } from '../core/store.js';
import { can } from '../core/auth.js';
import { navigate } from '../ui/router.js';
import { toast, formValues } from '../ui/dom.js';
import { pageTitle, options, field, operatorName, empty } from '../ui/components.js';
import { PROVIDER_KINDS } from '../domain/model.js';
import { createAudit, gridsFor } from '../app/audits.js';
import { getPosition } from '../ui/gps.js';

let draft = {};

export default {
  nav: 'planning', title: 'Audit inopiné',
  async render(params, q) {
    if (!can('audit.create')) return html`<div class="card">${empty('🔒', 'Votre profil ne permet pas de créer un audit.')}</div>`;
    if (q.prestation && draft.prestationId !== q.prestation) {
      const p = store.get('prestation', q.prestation);
      if (p) draft = { prestationId: p.id, providerId: p.providerId, siteId: p.siteId, pointId: p.pointIds?.[0], samplingTypeId: p.samplingTypeId, matrixId: p.matrixId, operatorIds: p.operatorIds || [] };
    }
    const providers = sortBy(store.filter('provider', p => p.active !== false), 'kind', 'name');
    const sites = sortBy(store.all('site'), 'name');
    const points = store.filter('point', p => p.siteId === draft.siteId);
    const today = localDate();
    const prestations = sortBy(store.filter('prestation', p => (!draft.providerId || p.providerId === draft.providerId) && (!draft.siteId || p.siteId === draft.siteId) && p.plannedDate >= addDays(today, -31) && p.plannedDate <= addDays(today, 31)), 'plannedDate');
    const grids = gridsFor({ providerId: draft.providerId, samplingTypeId: draft.samplingTypeId, matrixId: draft.matrixId });
    const ops = sortBy(store.filter('operator', o => o.providerId === draft.providerId && o.active !== false), 'code');
    return html`
      ${pageTitle('Audit inopiné', 'Contrôle non planifié, démarré immédiatement sur le terrain', '', '#/')}
      <form class="card" data-submit="start" id="newAuditForm">
        <h2>1 · Prestataire contrôlé</h2>
        ${field('Prestataire, partenaire ou régie', html`<select name="providerId" data-change="set" required>${providers.length ? Object.entries(PROVIDER_KINDS).map(([k, label]) => html`<optgroup label="${label}">${options(providers.filter(p => p.kind === k), draft.providerId, { placeholder: null })}</optgroup>`) : ''}<option value="" ${!draft.providerId ? 'selected' : ''}>— sélectionner —</option></select>`, { required: true })}
        <h2 style="margin-top:14px">2 · Site et point</h2>
        <div class="btn-row" style="margin-bottom:10px"><button type="button" class="btn ghost" data-act="nearest"><span class="ic">📍</span>Site le plus proche (GPS)</button></div>
        <div id="nearestInfo" class="hint"></div>
        ${field('Site', html`<select name="siteId" data-change="set" required>${options(sites, draft.siteId, { label: s => `${s.name} (${s.code})${s.networks?.length ? ' — ' + s.networks.join(', ') : ''}` })}</select>`, { required: true })}
        ${points.length ? field('Point de prélèvement', html`<select name="pointId" data-change="set">${options(points, draft.pointId, { label: p => `${p.code} — ${p.name}`, placeholder: null })}</select>`) : ''}
        <h2 style="margin-top:14px">3 · Prestation observée</h2>
        ${field('Prestation programmée correspondante (facultatif)', html`<select name="prestationId" data-change="set">${options(prestations, draft.prestationId, { label: p => `${fmtDate(p.plannedDate)} — ${p.ref}`, placeholder: 'Aucune — prestation non programmée' })}</select>`, { hint: 'Prestations de ce prestataire sur ce site à ± 1 mois.' })}
        <div class="grid2">
          ${field('Type de prélèvement observé', html`<select name="samplingTypeId" data-change="set">${options(store.all('samplingType'), draft.samplingTypeId)}</select>`)}
          ${field('Matrice', html`<select name="matrixId" data-change="set">${options(store.all('matrix'), draft.matrixId)}</select>`)}
        </div>
        ${ops.length ? field('Opérateur(s) présent(s)', html`<div class="checks">${ops.map(o => html`<label class="check ${(draft.operatorIds || []).includes(o.id) ? 'sel' : ''}"><input type="checkbox" name="operatorIds" data-multi value="${o.id}" data-change="set" ${(draft.operatorIds || []).includes(o.id) ? 'checked' : ''}> ${operatorName(o)}</label>`)}</div>`, { hint: 'D’autres opérateurs pourront être ajoutés dans l’audit.' }) : ''}
        <h2 style="margin-top:14px">4 · Grille d’audit</h2>
        ${grids.length ? html`<div class="list">${grids.map((g, i) => html`<label class="li" style="cursor:pointer"><input type="radio" name="gridId" value="${g.id}" ${(draft.gridId ? draft.gridId === g.id : i === 0) ? 'checked' : ''} data-change="set"><div class="li-main"><div class="li-title">${g.name}</div><div class="li-sub">${g.code} v${g.version} — ${g.description || ''}</div></div></label>`)}</div>` : html`<div class="banner warn">Aucune grille publiée n’est applicable.</div>`}
        <button class="btn primary lg block" type="submit" style="margin-top:16px" ${grids.length ? '' : 'disabled'}><span class="ic">⚡</span>Démarrer immédiatement le contrôle</button>
      </form>`;
  },
  handlers: {
    set(el) {
      const form = el.form || document.getElementById('newAuditForm');
      const v = formValues(form);
      const siteChanged = v.siteId !== draft.siteId;
      draft = { ...draft, ...v };
      if (siteChanged) { draft.pointId = store.find('point', p => p.siteId === v.siteId)?.id; const s = store.get('site', v.siteId); if (s?.matrixId && !draft.matrixId) draft.matrixId = s.matrixId; }
      if (el.name === 'prestationId' && v.prestationId) { const p = store.get('prestation', v.prestationId); Object.assign(draft, { samplingTypeId: p.samplingTypeId || draft.samplingTypeId, matrixId: p.matrixId || draft.matrixId, operatorIds: p.operatorIds?.length ? p.operatorIds : draft.operatorIds }); }
      if (el.name !== 'gridId') this.refresh();
    },
    async nearest() {
      const info = document.getElementById('nearestInfo');
      info.textContent = 'Recherche de la position GPS…';
      try {
        const pos = await getPosition({ timeout: 20000 });
        const pts = store.filter('point', p => isFinite(p.lat) && isFinite(p.lon)).map(p => ({ p, d: haversine(pos.lat, pos.lon, p.lat, p.lon) })).sort((a, b) => a.d - b.d);
        if (!pts.length) { info.textContent = 'Aucun point géolocalisé dans le référentiel.'; return; }
        const best = pts[0];
        draft = { ...draft, siteId: best.p.siteId, pointId: best.p.id };
        toast(`Site le plus proche : ${store.get('site', best.p.siteId)?.name} (${fmtDistance(best.d)})`, 'ok');
        this.refresh();
      } catch (e) { info.textContent = e.message; }
    },
    async start(form) {
      const v = formValues(form);
      if (!v.providerId || !v.siteId || !v.gridId) { toast('Prestataire, site et grille sont obligatoires.', 'err'); return; }
      const a = await createAudit({ prestationId: v.prestationId || null, gridId: v.gridId, kind: 'inopine', providerId: v.providerId, siteId: v.siteId, pointId: v.pointId || null, operatorIds: v.operatorIds || [], samplingTypeId: v.samplingTypeId || null, matrixId: v.matrixId || null });
      draft = {};
      toast(`Audit inopiné ${a.number} démarré`, 'ok');
      navigate('/audit/' + a.id);
    }
  }
};
