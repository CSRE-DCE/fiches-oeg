/* Base prestataires / partenaires / régie : identité, contrats, sites, opérateurs, habilitations,
 * équipements, historique des audits, des écarts et des actions correctives. */
import { html, fmtDate, sortBy, localDate, uuid, normalize } from '../core/util.js';
import { store } from '../core/store.js';
import { can } from '../core/auth.js';
import { navigate } from '../ui/router.js';
import { toast, openModal, formValues, confirmDialog } from '../ui/dom.js';
import { pageTitle, kv, badge, kindBadge, empty, options, field, auditBadge, critBadge, deviationBadge, operatorName, siteName } from '../ui/components.js';
import { PROVIDER_KINDS, OPEN_DEVIATION, QUALIFICATION_TYPES, EQUIPMENT_STATUS, ACTION_STATUS } from '../domain/model.js';
import { operatorStatus, equipmentStatus } from '../domain/rules.js';
import { recurringDeviations, isOverdue } from '../domain/summary.js';

export default {
  nav: 'prestataires', title: 'Prestataires',
  async render(params, q) {
    let list = sortBy(store.all('provider'), 'kind', 'name');
    if (q.q) { const t = normalize(q.q); list = list.filter(p => normalize(p.name + ' ' + p.code).includes(t)); }
    const today = localDate();
    return html`${pageTitle('Prestataires, partenaires et régie', `${list.length} organisme(s)`, can('ref.manage') ? html`<button class="btn primary" data-act="new">＋ Prestataire</button>` : '')}
      <div class="field"><input type="search" placeholder="Rechercher…" value="${q.q || ''}" data-change="search"></div>
      ${Object.entries(PROVIDER_KINDS).map(([k, label]) => { const items = list.filter(p => p.kind === k); return items.length ? html`<div class="date-head">${label} · ${items.length}</div><div class="list">${items.map(p => {
        const audits = store.count('audit', a => a.providerId === p.id && a.status !== 'abandonne');
        const open = store.count('deviation', d => d.providerId === p.id && OPEN_DEVIATION.includes(d.status));
        const late = store.count('deviation', d => d.providerId === p.id && isOverdue(d, today));
        return html`<a class="li" href="#/prestataire/${p.id}"><div class="li-main"><div class="li-title">${p.name}</div><div class="li-sub">${p.code} · ${store.count('operator', o => o.providerId === p.id)} opérateur(s) · ${audits} audit(s)</div>
          <div class="row" style="gap:6px;margin-top:4px">${open ? badge(`${open} écart(s) ouvert(s)`, 'warn') : badge('Aucun écart ouvert', 'ok')}${late ? badge(`${late} en retard`, 'nc') : ''}${p.active === false ? badge('Inactif', 'na') : ''}</div></div><span class="chev">›</span></a>`;
      })}</div>` : ''; })}`;
  },
  handlers: {
    search(el) { navigate('/prestataires' + (el.value ? '?q=' + encodeURIComponent(el.value) : ''), { replace: true }); },
    async new() { const p = await editProvider(); if (p) navigate('/prestataire/' + p.id); }
  }
};

export function editProvider(p = null) {
  const isNew = !p;
  p = p || { id: uuid(), code: '', name: '', kind: 'prestataire', contacts: [], contracts: [], accreditation: {}, active: true };
  const m = openModal({
    title: isNew ? 'Nouveau prestataire' : 'Modifier ' + p.name, wide: true,
    body: html`<form id="pf"><div class="grid2">
      ${field('Code', html`<input name="code" value="${p.code}" required>`, { required: true })}${field('Raison sociale', html`<input name="name" value="${p.name}" required>`, { required: true })}
      ${field('Nature', html`<select name="kind">${options(Object.entries(PROVIDER_KINDS).map(([id, label]) => ({ id, label })), p.kind, { placeholder: null })}</select>`)}${field('Statut', html`<select name="active">${options([{ id: 'true', label: 'Actif' }, { id: 'false', label: 'Inactif' }], String(p.active !== false), { placeholder: null })}</select>`)}
      ${field('Adresse', html`<input name="address" value="${p.address || ''}">`)}${field('Téléphone', html`<input name="phone" type="tel" value="${p.phone || ''}">`)}
      ${field('Courriel', html`<input name="email" type="email" value="${p.email || ''}">`)}${field('SIRET', html`<input name="siret" value="${p.siret || ''}">`)}
      ${field('Accréditation — organisme', html`<input name="accBody" value="${p.accreditation?.body || ''}" placeholder="ex. Cofrac">`)}${field('Accréditation — numéro', html`<input name="accNumber" value="${p.accreditation?.number || ''}">`)}
      ${field('Accréditation — portée', html`<input name="accScope" value="${p.accreditation?.scope || ''}">`)}${field('Accréditation — validité', html`<input type="date" name="accValidUntil" value="${p.accreditation?.validUntil || ''}">`)}
    </div>${field('Notes', html`<textarea name="notes">${p.notes || ''}</textarea>`)}</form>`,
    actions: [{ label: 'Annuler' }, { label: 'Enregistrer', act: 'ok', cls: 'primary' }],
    handlers: {
      async ok() {
        const f = this.root.querySelector('#pf'); if (!f.reportValidity()) return;
        const v = formValues(f);
        const next = { ...p, code: v.code, name: v.name, kind: v.kind, active: v.active === 'true', address: v.address, phone: v.phone, email: v.email, siret: v.siret, notes: v.notes, accreditation: { body: v.accBody, number: v.accNumber, scope: v.accScope, validUntil: v.accValidUntil } };
        await store.put('provider', next, { reason: isNew ? 'Création du prestataire' : 'Modification du prestataire' });
        this.close(next);
      }
    }
  });
  return m.result;
}

function operatorForm(providerId, o = null) {
  o = o || { id: uuid(), providerId, code: '', lastName: '', firstName: '', function: '', qualifications: [], active: true };
  let quals = [...(o.qualifications || [])];
  const qualRows = () => html`${quals.map((q, i) => html`<div class="tree-item" style="flex-wrap:wrap"><select data-qi="${i}" data-qk="type" style="max-width:170px">${options(Object.entries(QUALIFICATION_TYPES).map(([id, label]) => ({ id, label })), q.type, { placeholder: null })}</select><input data-qi="${i}" data-qk="label" value="${q.label || ''}" placeholder="intitulé" style="flex:1;min-width:160px"><input data-qi="${i}" data-qk="ref" value="${q.ref || ''}" placeholder="référence" style="max-width:140px"><input type="date" data-qi="${i}" data-qk="obtainedAt" value="${q.obtainedAt || ''}" title="Obtenue le" style="max-width:170px"><input type="date" data-qi="${i}" data-qk="validUntil" value="${q.validUntil || ''}" title="Valide jusqu’au" style="max-width:170px"><button type="button" class="icon-btn" data-act="qdel" data-i="${i}">✕</button></div>`)}`;
  const m = openModal({
    title: o.code ? 'Opérateur ' + operatorName(o) : 'Nouvel opérateur', wide: true,
    body: html`<form id="of"><div class="grid2">
      ${field('Code / initiales', html`<input name="code" value="${o.code}" required>`, { required: true })}${field('Fonction', html`<input name="function" value="${o.function || ''}">`)}
      ${field('Nom', html`<input name="lastName" value="${o.lastName || ''}">`)}${field('Prénom', html`<input name="firstName" value="${o.firstName || ''}">`)}
      ${field('Expérience (années)', html`<input name="experienceYears" type="number" min="0" value="${o.experienceYears ?? ''}">`)}${field('Statut', html`<select name="active">${options([{ id: 'true', label: 'Actif' }, { id: 'false', label: 'Inactif' }], String(o.active !== false), { placeholder: null })}</select>`)}
    </div><h3>Habilitations, qualifications, formations, autorisations</h3><div id="quals" class="tree-sec">${qualRows()}</div>
    <button type="button" class="btn ghost sm" data-act="qadd">＋ Ajouter</button></form>`,
    actions: [{ label: 'Annuler' }, { label: 'Enregistrer', act: 'ok', cls: 'primary' }],
    handlers: {
      qadd() { this.collect(); quals.push({ id: uuid(), type: 'habilitation', label: '', ref: '', obtainedAt: '', validUntil: '', samplingTypeIds: [] }); this.root.querySelector('#quals').innerHTML = String(qualRows()); },
      qdel(el) { this.collect(); quals.splice(Number(el.dataset.i), 1); this.root.querySelector('#quals').innerHTML = String(qualRows()); },
      async ok() {
        const f = this.root.querySelector('#of'); if (!f.reportValidity()) return;
        this.collect();
        const v = formValues(f);
        for (const k of Object.keys(v)) if (k.startsWith('q')) delete v[k];
        const next = { ...o, code: v.code, function: v.function, lastName: v.lastName, firstName: v.firstName, experienceYears: v.experienceYears === '' ? null : Number(v.experienceYears), active: v.active === 'true', qualifications: quals.filter(q => q.label) };
        await store.put('operator', next, { reason: 'Mise à jour des habilitations' });
        this.close(next);
      }
    },
    onMount(root, api) { api.collect = () => { for (const el of root.querySelectorAll('[data-qi]')) quals[Number(el.dataset.qi)][el.dataset.qk] = el.value; }; }
  });
  return m.result;
}

export const detailView = {
  nav: 'prestataires', title: 'Prestataire',
  async render({ id }) {
    const p = store.get('provider', id);
    if (!p) return html`<div class="card">${empty('❓', 'Prestataire introuvable.')}</div>`;
    const today = localDate();
    const ops = sortBy(store.filter('operator', o => o.providerId === id), 'code');
    const eqs = sortBy(store.filter('equipment', e => e.providerId === id), 'label');
    const audits = sortBy(store.filter('audit', a => a.providerId === id && a.status !== 'abandonne'), '-startedAt');
    const devs = sortBy(store.filter('deviation', d => d.providerId === id), '-date');
    const actions = devs.flatMap(d => (d.correctiveActions || []).map(a => ({ ...a, dev: d })));
    const recurring = recurringDeviations(devs);
    const siteIds = [...new Set([...store.filter('prestation', x => x.providerId === id).map(x => x.siteId), ...audits.map(a => a.siteId)])];
    const edit = can('ref.manage');
    return html`${pageTitle(p.name, `${p.code} · ${PROVIDER_KINDS[p.kind] || ''}`, html`${kindBadge(p.kind)}${edit ? html`<button class="btn ghost sm" data-act="edit">✏️ Modifier</button>` : ''}`, '#/prestataires')}
      <div class="kpis" style="margin-bottom:12px">
        <a class="kpi" href="#/audits?prestataire=${id}"><span class="k">Audits</span><span class="v">${audits.length}</span></a>
        <a class="kpi ${devs.some(d => OPEN_DEVIATION.includes(d.status)) ? 'alert-kpi' : ''}" href="#/ecarts?prestataire=${id}"><span class="k">Écarts ouverts</span><span class="v">${devs.filter(d => OPEN_DEVIATION.includes(d.status)).length}</span></a>
        <a class="kpi" href="#/ecarts?prestataire=${id}&filtre=retard"><span class="k">Écarts en retard</span><span class="v">${devs.filter(d => isOverdue(d, today)).length}</span></a>
        <div class="kpi ${recurring.length ? 'warn-kpi' : ''}"><span class="k">Écarts récurrents</span><span class="v">${recurring.length}</span></div>
      </div>
      <div class="card"><h2>Identité et coordonnées</h2>${kv([['Raison sociale', p.name], ['Code', p.code], ['Nature', PROVIDER_KINDS[p.kind]], ['Adresse', p.address], ['Téléphone', p.phone], ['Courriel', p.email], ['SIRET', p.siret], ['Accréditation', p.accreditation?.number ? `${p.accreditation.body || ''} n° ${p.accreditation.number} — ${p.accreditation.scope || ''}${p.accreditation.validUntil ? ' (valide jusqu’au ' + fmtDate(p.accreditation.validUntil) + ')' : ''}` : 'non renseignée'], ['Notes', p.notes]])}
        ${(p.contacts || []).length ? html`<h3>Contacts</h3><ul>${p.contacts.map(c => html`<li>${c.name} — ${c.role || ''} ${c.phone || ''} ${c.email || ''}</li>`)}</ul>` : ''}</div>
      <div class="card"><h2>Contrats / marchés</h2>${(p.contracts || []).length ? html`<div class="table-wrap"><table class="tbl"><thead><tr><th>Référence</th><th>Objet</th><th>Période</th><th>Lots</th></tr></thead><tbody>${p.contracts.map(c => html`<tr><td class="mono">${c.ref}</td><td>${c.label}</td><td>${fmtDate(c.start)} → ${fmtDate(c.end)}</td><td>${c.lots || ''}</td></tr>`)}</tbody></table></div>` : html`<p class="note">Aucun contrat enregistré.</p>`}
        ${edit ? html`<button class="btn ghost sm" style="margin-top:8px" data-act="contract">＋ Contrat</button>` : ''}</div>
      <div class="card"><h2>Opérateurs et habilitations (${ops.length})</h2>
        ${ops.length ? html`<div class="list">${ops.map(o => { const st = operatorStatus(o, today); return html`<div class="li ${o.active === false ? '' : st.ok ? 'stripe-ok' : 'stripe-nc'}"><div class="li-main"><div class="li-title">${operatorName(o)} ${o.active === false ? badge('Inactif', 'na') : ''}</div><div class="li-sub">${o.function || ''}</div><div class="li-sub">${(o.qualifications || []).map(q => `${QUALIFICATION_TYPES[q.type] || q.type} : ${q.label}${q.validUntil ? ' → ' + fmtDate(q.validUntil) : ''}`).join(' ; ') || 'aucune habilitation enregistrée'}</div>${st.ok ? badge('Habilité', 'ok') : badge(st.message, 'nc')}</div>${edit ? html`<button class="btn ghost sm" data-act="op-edit" data-id="${o.id}">Modifier</button>` : ''}</div>`; })}</div>` : html`<p class="note">Aucun opérateur.</p>`}
        ${edit ? html`<button class="btn ghost sm" style="margin-top:8px" data-act="op-new">＋ Opérateur</button>` : ''}</div>
      <div class="card"><h2>Équipements (${eqs.length})</h2>${eqs.length ? html`<div class="table-wrap"><table class="tbl"><thead><tr><th>Équipement</th><th>Inventaire / série</th><th>Validité</th><th>État</th></tr></thead><tbody>${eqs.map(e => { const st = equipmentStatus(e, today); return html`<tr><td>${e.label}<div class="tiny muted">${e.brand} ${e.model}</div></td><td class="mono tiny">${e.inventoryNo}<br>${e.serial}</td><td>${fmtDate(e.validUntil) || '—'}</td><td>${st.ok ? badge(EQUIPMENT_STATUS[e.status] || 'Valide', 'ok') : badge(st.reasons[0], st.level === 'critique' ? 'nc' : 'warn')}</td></tr>`; })}</tbody></table></div>` : html`<p class="note">Aucun équipement enregistré (gestion dans Référentiels › Équipements).</p>`}</div>
      <div class="card"><h2>Sites d’intervention (${siteIds.length})</h2><p>${siteIds.map(s => siteName(s)).join(' · ') || '—'}</p></div>
      <div class="card"><h2>Historique des audits</h2>${audits.length ? html`<div class="list">${audits.slice(0, 20).map(a => html`<a class="li" href="#/audit/${a.id}"><div class="li-main"><div class="li-title">${a.number} — ${siteName(a.siteId)}</div><div class="li-sub">${fmtDate(a.startedAt)} · ${a.auditorName}</div></div>${auditBadge(a)}</a>`)}</div>` : html`<p class="note">Aucun audit.</p>`}</div>
      <div class="card"><h2>Historique des écarts</h2>${devs.length ? html`<div class="list">${devs.slice(0, 30).map(d => html`<a class="li" href="#/ecart/${d.id}"><div class="li-main"><div class="li-title">${d.number}</div><div class="li-sub">${d.requirement}</div></div>${critBadge(d.criticalityCode)}${deviationBadge(d.status)}</a>`)}</div>` : html`<p class="note">Aucun écart.</p>`}
        ${recurring.length ? html`<h3>Écarts récurrents</h3><ul>${recurring.map(r => html`<li>${r.requirement} — ${r.audits.length} audits (${r.open} ouvert(s))</li>`)}</ul>` : ''}</div>
      <div class="card"><h2>Actions correctives (${actions.length})</h2>${actions.length ? html`<div class="table-wrap"><table class="tbl"><thead><tr><th>Écart</th><th>Action</th><th>Échéance</th><th>Statut</th></tr></thead><tbody>${actions.map(a => html`<tr class="click" data-act="goto" data-href="#/ecart/${a.dev.id}"><td>${a.dev.number}</td><td>${a.description}</td><td>${fmtDate(a.dueDate)}</td><td>${ACTION_STATUS[a.status]}</td></tr>`)}</tbody></table></div>` : html`<p class="note">Aucune action corrective.</p>`}</div>`;
  },
  handlers: {
    async edit() { if (await editProvider(store.get('provider', this.params.id))) this.refresh(); },
    async 'op-new'() { if (await operatorForm(this.params.id)) this.refresh(); },
    async 'op-edit'(el) { if (await operatorForm(this.params.id, store.get('operator', el.dataset.id))) this.refresh(); },
    goto(el) { location.hash = el.dataset.href; },
    async contract() {
      const p = store.get('provider', this.params.id);
      const m = openModal({ title: 'Nouveau contrat / marché', body: html`<form id="cf">${field('Référence', html`<input name="ref" required>`, { required: true })}${field('Objet', html`<input name="label">`)}<div class="grid2">${field('Début', html`<input type="date" name="start">`)}${field('Fin', html`<input type="date" name="end">`)}</div>${field('Lots', html`<input name="lots">`)}</form>`, actions: [{ label: 'Annuler' }, { label: 'Ajouter', act: 'ok', cls: 'primary' }], handlers: { ok() { const f = this.root.querySelector('#cf'); if (!f.reportValidity()) return; this.close(formValues(f)); } } });
      const v = await m.result; if (!v) return;
      await store.put('provider', { ...p, contracts: [...(p.contracts || []), { id: uuid(), ...v }] }, { reason: 'Ajout d’un contrat' });
      this.refresh();
    }
  }
};
