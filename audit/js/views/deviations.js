/* Registre des écarts et suivi des actions correctives. */
import { html, raw, fmtDate, fmtDateTime, localDate, sortBy, normalize, uuid, nowISO } from '../core/util.js';
import { store } from '../core/store.js';
import { session } from '../core/session.js';
import { can } from '../core/auth.js';
import { mediaFor } from '../core/media.js';
import { navigate } from '../ui/router.js';
import { toast, openModal, promptDialog, formValues, downloadBlob } from '../ui/dom.js';
import { pageTitle, kv, badge, critBadge, deviationBadge, empty, options, thumbs, hydrateMedia, evidenceButtons, siteName, providerName, field, voiceBtn } from '../ui/components.js';
import { addFilesFromInput, viewMedia } from '../ui/capture.js';
import { DEVIATION_STATUS, OPEN_DEVIATION, ACTION_STATUS } from '../domain/model.js';
import { isOverdue, recurringDeviations } from '../domain/summary.js';
import { updateDeviation } from '../app/audits.js';
import { refLabel } from '../app/documents.js';

function filtered(q) {
  const today = localDate();
  let list = store.all('deviation');
  const f = q.filtre || 'ouverts';
  if (f === 'ouverts') list = list.filter(d => OPEN_DEVIATION.includes(d.status));
  else if (f === 'retard') list = list.filter(d => isOverdue(d, today));
  else if (f !== 'tous') list = list.filter(d => d.status === f);
  if (q.criticite) list = list.filter(d => d.criticalityCode === q.criticite);
  if (q.prestataire) list = list.filter(d => d.providerId === q.prestataire);
  if (q.site) list = list.filter(d => d.siteId === q.site);
  if (q.q) { const t = normalize(q.q); list = list.filter(d => normalize(`${d.number} ${d.requirement} ${d.description}`).includes(t)); }
  const rank = c => store.all('criticality').find(x => x.code === c)?.rank ?? 0;
  return sortBy(list, d => -rank(d.criticalityCode), 'dueDate', '-number');
}

export default {
  nav: 'ecarts', title: 'Écarts',
  async render(params, q) {
    const today = localDate();
    const all = store.all('deviation');
    const list = filtered(q);
    const f = q.filtre || 'ouverts';
    const recurring = recurringDeviations(all);
    const counts = { ouverts: all.filter(d => OPEN_DEVIATION.includes(d.status)).length, retard: all.filter(d => isOverdue(d, today)).length, a_verifier: all.filter(d => d.status === 'a_verifier').length, clos: all.filter(d => d.status === 'clos').length, tous: all.length };
    return html`
      ${pageTitle('Écarts et actions correctives', 'Registre des écarts — suivi jusqu’à la clôture', html`<button class="btn ghost" data-act="export"><span class="ic">📤</span>Exporter le registre</button>`)}
      <div class="chips" style="margin-bottom:10px">${[['ouverts', 'Ouverts'], ['retard', 'En retard'], ['a_verifier', 'À vérifier'], ['clos', 'Clos'], ['tous', 'Tous']].map(([k, l]) => html`<button class="chip ${f === k ? 'sel' : ''}" data-act="q" data-k="filtre" data-v="${k}">${l}<span class="count">${counts[k]}</span></button>`)}</div>
      <details class="card" ${q.criticite || q.prestataire || q.site || q.q ? 'open' : ''}><summary>Filtres</summary><div class="grid2" style="margin-top:10px">
        <div class="field"><label>Criticité</label><select data-change="qsel" data-k="criticite">${options(sortBy(store.all('criticality'), 'rank'), q.criticite, { value: c => c.code, placeholder: 'Toutes' })}</select></div>
        <div class="field"><label>Prestataire</label><select data-change="qsel" data-k="prestataire">${options(sortBy(store.all('provider'), 'name'), q.prestataire, { placeholder: 'Tous' })}</select></div>
        <div class="field"><label>Site</label><select data-change="qsel" data-k="site">${options(sortBy(store.all('site').filter(s => all.some(d => d.siteId === s.id)), 'name'), q.site, { placeholder: 'Tous' })}</select></div>
        <div class="field"><label>Recherche</label><input type="search" value="${q.q || ''}" data-change="qsel" data-k="q"></div></div></details>
      ${list.length ? html`<div class="list">${list.map(d => html`<a class="li ${isOverdue(d, today) ? 'stripe-nc' : d.status === 'clos' ? 'stripe-ok' : 'stripe-warn'}" href="#/ecart/${d.id}">
          <div class="li-main"><div class="li-title">${d.number}</div><div class="li-sub">${d.requirement}</div><div class="li-sub">${providerName(d.providerId)} · ${siteName(d.siteId)} · ${fmtDate(d.date)}</div>
          <div class="row" style="gap:6px;margin-top:6px">${critBadge(d.criticalityCode)}${deviationBadge(d.status)}${d.dueDate ? badge((isOverdue(d, today) ? '⏰ En retard — ' : 'Délai ') + fmtDate(d.dueDate), isOverdue(d, today) ? 'nc' : 'outline') : ''}${(d.correctiveActions || []).length ? badge(`${d.correctiveActions.length} action(s)`, 'info') : ''}</div></div><span class="chev">›</span></a>`)}</div>`
        : html`<div class="card">${empty('✅', 'Aucun écart pour cette sélection.')}</div>`}
      <div class="card" style="margin-top:12px"><h2>Écarts récurrents (même exigence, ≥ 2 audits, même prestataire)</h2>
        ${recurring.length ? html`<div class="table-wrap"><table class="tbl"><thead><tr><th>Prestataire</th><th>Exigence</th><th>Audits</th><th>Ouverts</th></tr></thead><tbody>${recurring.map(r => html`<tr class="click" data-act="q" data-k="prestataire" data-v="${r.providerId}"><td>${providerName(r.providerId)}</td><td>${r.requirement}</td><td>${r.audits.length}</td><td>${r.open}</td></tr>`)}</tbody></table></div>` : html`<p class="note">Aucun écart récurrent détecté.</p>`}</div>`;
  },
  handlers: {
    q(el) { const q = { ...this.query, [el.dataset.k]: el.dataset.v }; navigate('/ecarts?' + new URLSearchParams(q), { replace: true }); },
    qsel(el) { const q = { ...this.query, [el.dataset.k]: el.value }; if (!el.value) delete q[el.dataset.k]; navigate('/ecarts?' + new URLSearchParams(q), { replace: true }); },
    async export() {
      const { table, exportWorkbook } = await import('../app/exports.js');
      const list = filtered(this.query);
      const bytes = await exportWorkbook([{ name: 'Registre des écarts', rows: table('deviations', list) }], 'registre_ecarts.xlsx', 'Registre des écarts');
      downloadBlob(bytes, `registre_ecarts_${localDate()}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    }
  }
};

/* ---------- Détail d'un écart ---------- */
function actionForm(a = {}) {
  const m = openModal({
    title: a.id ? 'Action corrective' : 'Nouvelle action corrective',
    body: html`<form id="actf">
      ${field('Description de l’action', html`<div class="input-wrap"><textarea name="description" id="actDesc" required>${a.description || ''}</textarea>${voiceBtn('actDesc')}</div>`, { required: true })}
      <div class="grid2">${field('Responsable', html`<input name="responsible" value="${a.responsible || ''}">`)}${field('Échéance', html`<input type="date" name="dueDate" value="${a.dueDate || ''}">`)}</div>
      ${field('Statut', html`<select name="status">${options(Object.entries(ACTION_STATUS).filter(([k]) => can('deviation.close') || !['efficace', 'inefficace'].includes(k)).map(([id, label]) => ({ id, label })), a.status || 'a_faire', { placeholder: null })}</select>`)}
      ${field('Commentaire / preuve de réalisation / vérification d’efficacité', html`<textarea name="comment">${a.comment || ''}</textarea>`)}
    </form>`,
    actions: [{ label: 'Annuler' }, { label: 'Enregistrer', act: 'ok', cls: 'primary' }],
    handlers: {
      async voice(el) { (await import('../ui/voice.js')).dictate(this.root.querySelector('#' + el.dataset.target)); },
      ok() { const f = this.root.querySelector('#actf'); if (!f.reportValidity()) return; const v = formValues(f); this.close({ ...a, ...v, id: a.id || uuid(), createdAt: a.createdAt || nowISO(), createdBy: a.createdBy || session.user.name, updatedAt: nowISO(), ...(v.status === 'realisee' && a.status !== 'realisee' ? { doneAt: nowISO() } : {}), ...(['efficace', 'inefficace'].includes(v.status) && a.status !== v.status ? { verifiedAt: nowISO(), verifiedBy: session.user.name } : {}) }); }
    }
  });
  return m.result;
}

export const detailView = {
  nav: 'ecarts', title: 'Écart',
  async render({ id }) {
    const d = store.get('deviation', id);
    if (!d) return html`<div class="card">${empty('❓', 'Écart introuvable.')}</div>`;
    const audit = store.get('audit', d.auditId);
    const locked = !!audit?.lock?.lockedAt;
    const manage = can('deviation.manage');
    const media = mediaFor({ type: 'deviation', id: d.id });
    const today = localDate();
    const actions = d.correctiveActions || [];
    return html`
      ${pageTitle(`Écart ${d.number}`, `${providerName(d.providerId)} · ${siteName(d.siteId)} · constaté le ${fmtDate(d.date)} à ${d.time || ''}`, html`${critBadge(d.criticalityCode)}${deviationBadge(d.status)}`, '#/ecarts')}
      ${isOverdue(d, today) ? html`<div class="banner nc">⏰ Échéance dépassée (${fmtDate(d.dueDate)}).</div>` : ''}
      <div class="card"><h2>Constat</h2>${kv([
        ['Numéro', d.number], ['Date et heure', `${fmtDate(d.date)} ${d.time || ''}`], ['Audit', audit ? html`<a href="#/audit/${audit.id}${d.itemId ? '/' + (audit.gridSnapshot.sections.find(s => (s.items || []).some(i => i.id === d.itemId))?.id || '') + '?item=' + d.itemId : ''}">${audit.number}</a>` : d.auditNumber],
        ['Critère', d.itemCode], ['Exigence concernée', d.requirement], ['Référence documentaire', (d.docRefs || []).map(r => refLabel(r, audit?.documentsSnapshot || [])).join(' ; ')],
        ['Description factuelle', d.description], ['Observation de l’auditeur', d.auditorObservation], ['Type', store.get('deviationType', 'dtype-' + d.typeCode)?.label || d.typeCode],
        ['Localisation', d.location ? `${d.location.lat.toFixed(6)}, ${d.location.lon.toFixed(6)}` : ''], ['Origine', d.source === 'alerte' ? `Alerte ${d.alertCode} (décision de l’auditeur)` : d.source === 'critere' ? 'Critère non conforme' : 'Saisie manuelle'],
        ['Action immédiate', d.immediateAction], ['Action corrective demandée', d.correctiveActionRequested]
      ])}
      ${locked ? html`<p class="note">Le constat est scellé avec l’audit signé ; seul le suivi (responsable, délai, actions, statut) reste modifiable.</p>` : manage ? html`<button class="btn ghost sm" style="margin-top:10px" data-act="edit-constat">Modifier le constat</button>` : ''}</div>
      <div class="card"><h2>Preuves</h2>${thumbs(media) || html`<p class="note">Aucune preuve jointe.</p>`}
        ${manage ? html`<div class="item-tools">${evidenceButtons({ type: 'deviation', id: d.id }, { auditId: locked ? '' : d.auditId })}</div>` : ''}</div>
      <div class="card"><h2>Suivi</h2>${kv([['Responsable', d.responsible], ['Délai', fmtDate(d.dueDate)], ['Statut', DEVIATION_STATUS[d.status]?.label], ['Clôturé le', d.closedAt ? `${fmtDateTime(d.closedAt)} par ${d.closedBy}` : ''], ['Vérification', d.closureNote]])}
        ${manage ? html`<div class="btn-row" style="margin-top:10px"><button class="btn ghost sm" data-act="edit-follow">Responsable / délai</button>
          ${d.status === 'ouvert' ? html`<button class="btn ghost sm" data-act="status" data-s="action_en_cours">Action en cours</button>` : ''}
          ${['ouvert', 'action_en_cours'].includes(d.status) ? html`<button class="btn ghost sm" data-act="status" data-s="a_verifier">Actions réalisées → à vérifier</button>` : ''}
          ${OPEN_DEVIATION.includes(d.status) && can('deviation.close') ? html`<button class="btn ok sm" data-act="close">Clôturer (vérification)</button><button class="btn danger-ghost sm" data-act="cancel">Annuler l’écart</button>` : ''}
          ${['clos', 'annule'].includes(d.status) && can('deviation.close') ? html`<button class="btn ghost sm" data-act="status" data-s="ouvert">Rouvrir</button>` : ''}</div>` : ''}</div>
      <div class="card"><h2>Actions correctives (${actions.length})</h2>
        ${actions.length ? html`<div class="list">${actions.map(a => { const ph = mediaFor({ type: 'action', id: a.id }); return html`<div class="li ${a.status === 'efficace' ? 'stripe-ok' : a.status === 'inefficace' ? 'stripe-nc' : 'stripe-info'}"><div class="li-main"><div class="li-title">${a.description}</div>
            <div class="li-sub">${a.responsible || '—'} · échéance ${fmtDate(a.dueDate) || '—'} · ${ACTION_STATUS[a.status]}</div>${a.comment ? html`<div class="li-sub">${a.comment}</div>` : ''}${a.verifiedBy ? html`<div class="tiny muted">Vérifiée par ${a.verifiedBy} le ${fmtDate(a.verifiedAt)}</div>` : ''}
            ${thumbs(ph)}${manage ? html`<div class="item-tools">${evidenceButtons({ type: 'action', id: a.id }, { label: 'Preuve' })}<button class="btn ghost sm" data-act="act-edit" data-id="${a.id}">Mettre à jour</button></div>` : ''}</div></div>`; })}</div>` : html`<p class="note">Aucune action corrective enregistrée.</p>`}
        ${manage && !['clos', 'annule'].includes(d.status) ? html`<button class="btn primary" style="margin-top:10px" data-act="act-add">＋ Action corrective</button>` : ''}</div>
      <div class="card"><h2>Historique</h2><div class="table-wrap"><table class="tbl"><thead><tr><th>Date</th><th>Par</th><th>Évènement</th></tr></thead><tbody>${[...(d.history || [])].reverse().map(h => html`<tr><td>${fmtDateTime(h.at)}</td><td>${h.by}</td><td>${h.event}${h.reason ? html`<div class="tiny muted">${h.reason}</div>` : ''}</td></tr>`)}</tbody></table></div></div>`;
  },
  async mount(root) { await hydrateMedia(root); },
  handlers: {
    async 'media-add'(el) { await addFilesFromInput(el); this.refresh(); },
    async 'media-view'(el) { await viewMedia(el.dataset.id, { onChange: () => this.refresh() }); },
    async voice(el) { (await import('../ui/voice.js')).dictate(document.getElementById(el.dataset.target)); },
    async status(el) {
      const d = store.get('deviation', this.params.id);
      const reason = await promptDialog({ title: `Passer à « ${DEVIATION_STATUS[el.dataset.s].label} »`, label: 'Commentaire', required: el.dataset.s === 'ouvert' });
      if (reason === null) return;
      await updateDeviation(d, { status: el.dataset.s }, { reason });
      this.refresh();
    },
    async close() {
      const d = store.get('deviation', this.params.id);
      if ((d.correctiveActions || []).some(a => !['efficace', 'inefficace'].includes(a.status))) toast('Des actions correctives ne sont pas vérifiées.', 'warn');
      const note = await promptDialog({ title: 'Clôturer l’écart', label: 'Vérification de l’efficacité / justification de la clôture', hint: 'Indiquez la preuve de la correction et le résultat de la vérification.' });
      if (!note) return;
      await updateDeviation(d, { status: 'clos', closedAt: nowISO(), closedBy: session.user.name, closureNote: note }, { reason: note, event: 'Clôture après vérification' });
      toast('Écart clôturé', 'ok'); this.refresh();
    },
    async cancel() {
      const d = store.get('deviation', this.params.id);
      const reason = await promptDialog({ title: 'Annuler l’écart', label: 'Motif de l’annulation (l’écart reste tracé)' });
      if (!reason) return;
      await updateDeviation(d, { status: 'annule', closedAt: nowISO(), closedBy: session.user.name, closureNote: reason }, { reason, event: 'Annulation' });
      this.refresh();
    },
    async 'edit-follow'() {
      const d = store.get('deviation', this.params.id);
      const m = openModal({ title: 'Suivi de l’écart', body: html`<form id="ff">${field('Responsable du traitement', html`<input name="responsible" value="${d.responsible || ''}">`)}${field('Délai', html`<input type="date" name="dueDate" value="${d.dueDate || ''}">`)}</form>`, actions: [{ label: 'Annuler' }, { label: 'Enregistrer', act: 'ok', cls: 'primary' }], handlers: { ok() { this.close(formValues(this.root.querySelector('#ff'))); } } });
      const v = await m.result; if (!v) return;
      const reason = d.dueDate && v.dueDate !== d.dueDate ? await promptDialog({ title: 'Modification du délai', label: 'Motif du changement de délai' }) : null;
      if (d.dueDate && v.dueDate !== d.dueDate && !reason) return;
      await updateDeviation(d, v, { reason, event: 'Mise à jour du suivi' });
      this.refresh();
    },
    async 'edit-constat'() {
      const d = store.get('deviation', this.params.id);
      const crits = sortBy(store.all('criticality'), 'rank');
      const m = openModal({ title: 'Modifier le constat', wide: true, body: html`<form id="cf">
          ${field('Exigence concernée', html`<input name="requirement" value="${d.requirement}">`)}
          ${field('Description factuelle', html`<textarea name="description">${d.description}</textarea>`)}
          ${field('Observation de l’auditeur', html`<textarea name="auditorObservation">${d.auditorObservation || ''}</textarea>`)}
          ${field('Criticité', html`<select name="criticalityCode">${options(crits, d.criticalityCode, { value: c => c.code, placeholder: null })}</select>`)}
          ${field('Action immédiate', html`<textarea name="immediateAction">${d.immediateAction || ''}</textarea>`)}
          ${field('Action corrective demandée', html`<textarea name="correctiveActionRequested">${d.correctiveActionRequested || ''}</textarea>`)}</form>`,
        actions: [{ label: 'Annuler' }, { label: 'Enregistrer', act: 'ok', cls: 'primary' }], handlers: { ok() { this.close(formValues(this.root.querySelector('#cf'))); } } });
      const v = await m.result; if (!v) return;
      await updateDeviation(d, v, { event: 'Modification du constat (avant signature)' });
      this.refresh();
    },
    async 'act-add'() {
      const d = store.get('deviation', this.params.id);
      const a = await actionForm({ responsible: d.responsible, dueDate: d.dueDate }); if (!a) return;
      await updateDeviation(d, { correctiveActions: [...(d.correctiveActions || []), a], status: d.status === 'ouvert' ? 'action_en_cours' : d.status }, { event: `Action corrective ajoutée : ${a.description}` });
      this.refresh();
    },
    async 'act-edit'(el) {
      const d = store.get('deviation', this.params.id);
      const cur = d.correctiveActions.find(x => x.id === el.dataset.id);
      const a = await actionForm(cur); if (!a) return;
      const allDone = d.correctiveActions.map(x => x.id === a.id ? a : x).every(x => ['realisee', 'efficace', 'inefficace'].includes(x.status));
      await updateDeviation(d, { correctiveActions: d.correctiveActions.map(x => x.id === a.id ? a : x), ...(allDone && ['ouvert', 'action_en_cours'].includes(d.status) ? { status: 'a_verifier' } : {}) }, { event: `Action corrective : ${ACTION_STATUS[a.status]}` });
      this.refresh();
    }
  }
};
