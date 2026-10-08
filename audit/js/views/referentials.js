/* Référentiels administrables (types de prélèvements, matrices, équipements, unités, opérateurs, sites,
 * points, niveaux d'écart, types d'écarts, méthodes, contenants, campagnes). Formulaires génériques
 * décrits par un schéma ; chaque modification est tracée au journal. */
import { html, raw, uuid, sortBy, normalize, localDate } from '../core/util.js';
import { store } from '../core/store.js';
import { can } from '../core/auth.js';
import { navigate } from '../ui/router.js';
import { toast, openModal, formValues, promptDialog, downloadBlob } from '../ui/dom.js';
import { pageTitle, badge, empty, options, field } from '../ui/components.js';
import { EQUIPMENT_STATUS } from '../domain/model.js';
import { equipmentStatus } from '../domain/rules.js';
import { toCSV } from '../formats/csv.js';

const ref = (type, label = x => x.label || x.name) => ({ type: 'ref', ref: type, label });
export const SCHEMAS = {
  samplingType: { title: 'Types de prélèvements', icon: '🧪', fields: [{ k: 'code', l: 'Code', req: true }, { k: 'label', l: 'Libellé', req: true }, { k: 'matrixIds', l: 'Matrices', type: 'multiref', ref: 'matrix' }, { k: 'description', l: 'Description', type: 'textarea' }] },
  matrix: { title: 'Matrices', icon: '💧', fields: [{ k: 'code', l: 'Code', req: true }, { k: 'label', l: 'Libellé', req: true }] },
  method: { title: 'Méthodes', icon: '📐', fields: [{ k: 'code', l: 'Code', req: true }, { k: 'label', l: 'Libellé', req: true }, { k: 'reference', l: 'Référence (norme, mode opératoire)' }, { k: 'docKey', l: 'Clé du document associé' }] },
  unit: { title: 'Unités', icon: '📏', fields: [{ k: 'code', l: 'Code', req: true }, { k: 'symbol', l: 'Symbole', req: true }, { k: 'label', l: 'Libellé' }, { k: 'quantity', l: 'Grandeur' }] },
  criticality: { title: 'Niveaux d’écart (criticité)', icon: '🚦', fields: [{ k: 'code', l: 'Code', req: true }, { k: 'label', l: 'Libellé', req: true }, { k: 'rank', l: 'Rang (0 = moins grave)', type: 'number', req: true }, { k: 'color', l: 'Couleur', type: 'color' }, { k: 'defaultDelayDays', l: 'Délai de traitement par défaut (jours)', type: 'number' }, { k: 'requiresImmediateAction', l: 'Action immédiate obligatoire', type: 'checkbox' }, { k: 'definition', l: 'Définition (système qualité)', type: 'textarea' }] },
  deviationType: { title: 'Types d’écarts', icon: '🏷️', fields: [{ k: 'code', l: 'Code', req: true }, { k: 'label', l: 'Libellé', req: true }] },
  container: { title: 'Contenants', icon: '🧴', fields: [{ k: 'code', l: 'Code', req: true }, { k: 'label', l: 'Libellé', req: true }] },
  equipment: { title: 'Équipements', icon: '🔧', fields: [{ k: 'inventoryNo', l: 'N° d’inventaire', req: true }, { k: 'label', l: 'Désignation', req: true }, { k: 'providerId', l: 'Prestataire / propriétaire', ...ref('provider') }, { k: 'category', l: 'Catégorie', type: 'select', opts: [['mesure', 'Matériel de mesure'], ['prelevement', 'Matériel de prélèvement']] }, { k: 'brand', l: 'Marque' }, { k: 'model', l: 'Modèle' }, { k: 'serial', l: 'N° de série' }, { k: 'lastCheckDate', l: 'Date de vérification', type: 'date' }, { k: 'calibrationDate', l: 'Date d’étalonnage', type: 'date' }, { k: 'calibrationRequired', l: 'Étalonnage requis', type: 'checkbox' }, { k: 'validUntil', l: 'Date de validité', type: 'date' }, { k: 'certificateRef', l: 'Certificat / constat' }, { k: 'status', l: 'Statut', type: 'select', opts: Object.entries(EQUIPMENT_STATUS) }], sub: e => { const s = equipmentStatus(e, localDate()); return s.ok ? badge('Valide', 'ok') : badge(s.reasons[0], s.level === 'critique' ? 'nc' : 'warn'); } },
  operator: { title: 'Opérateurs', icon: '👷', fields: [{ k: 'providerId', l: 'Prestataire', req: true, ...ref('provider') }, { k: 'code', l: 'Code / initiales', req: true }, { k: 'lastName', l: 'Nom' }, { k: 'firstName', l: 'Prénom' }, { k: 'function', l: 'Fonction' }, { k: 'active', l: 'Actif', type: 'checkbox' }], note: 'Les habilitations se gèrent depuis la fiche du prestataire.' },
  site: { title: 'Sites', icon: '🏞️', fields: [{ k: 'code', l: 'Code', req: true }, { k: 'name', l: 'Nom', req: true }, { k: 'networks', l: 'Réseaux (séparés par « ; »)', type: 'list' }, { k: 'kind', l: 'Nature' }, { k: 'commune', l: 'Commune' }, { k: 'bassin', l: 'Bassin versant' }, { k: 'masseEau', l: 'Masse d’eau' }, { k: 'matrixId', l: 'Matrice principale', ...ref('matrix') }, { k: 'lat', l: 'Latitude (WGS84)', type: 'number' }, { k: 'lon', l: 'Longitude (WGS84)', type: 'number' }, { k: 'transportModes', l: 'Moyens d’accès (séparés par « ; »)', type: 'list' }, { k: 'notes', l: 'Accès / consignes', type: 'textarea' }] },
  point: { title: 'Points de prélèvement', icon: '📍', fields: [{ k: 'siteId', l: 'Site', req: true, ...ref('site', s => `${s.name} (${s.code})`) }, { k: 'code', l: 'Code du point', req: true }, { k: 'name', l: 'Nom' }, { k: 'lat', l: 'Latitude', type: 'number' }, { k: 'lon', l: 'Longitude', type: 'number' }, { k: 'gpsThreshold', l: 'Seuil d’alerte GPS propre au point (m)', type: 'number' }, { k: 'description', l: 'Description / repérage', type: 'textarea' }] },
  campaign: { title: 'Campagnes', icon: '🗓️', fields: [{ k: 'code', l: 'Code', req: true }, { k: 'label', l: 'Libellé', req: true }, { k: 'network', l: 'Réseau' }, { k: 'start', l: 'Début', type: 'date' }, { k: 'end', l: 'Fin', type: 'date' }] }
};
const LINKS = [['prestataires', '🏢', 'Prestataires, partenaires et régie'], ['documents', '📚', 'Documents (CCTP, protocoles, normes…)'], ['grilles', '🧩', 'Grilles d’audit']];
const titleOf = (type, e) => e.label || e.name || (type === 'operator' ? [e.firstName, e.lastName].filter(Boolean).join(' ') || e.code : e.code) || e.id;

export default {
  nav: 'referentiels', title: 'Référentiels',
  async render() {
    return html`${pageTitle('Référentiels', 'Données de base administrables utilisées par les audits')}
      <div class="list">${Object.entries(SCHEMAS).map(([t, s]) => html`<a class="li" href="#/referentiel/${t}"><span style="font-size:24px">${s.icon}</span><div class="li-main"><div class="li-title">${s.title}</div><div class="li-sub">${store.count(t)} élément(s)</div></div><span class="chev">›</span></a>`)}
      ${LINKS.map(([h, i, l]) => html`<a class="li" href="#/${h}"><span style="font-size:24px">${i}</span><div class="li-main"><div class="li-title">${l}</div></div><span class="chev">›</span></a>`)}</div>`;
  }
};

function control(f, value) {
  const v = value ?? '';
  switch (f.type) {
    case 'textarea': return html`<textarea name="${f.k}">${v}</textarea>`;
    case 'number': return html`<input name="${f.k}" type="text" inputmode="decimal" value="${v}" ${f.req ? raw('required') : ''}>`;
    case 'date': return html`<input name="${f.k}" type="date" value="${v}">`;
    case 'color': return html`<input name="${f.k}" type="color" value="${v || '#55636a'}" style="min-height:52px">`;
    case 'checkbox': return html`<label class="check"><input type="checkbox" name="${f.k}" ${value === undefined && f.k === 'active' || value ? raw('checked') : ''}> ${f.l}</label>`;
    case 'select': return html`<select name="${f.k}">${options(f.opts.map(([id, label]) => ({ id, label })), v, { placeholder: null })}</select>`;
    case 'ref': return html`<select name="${f.k}" ${f.req ? raw('required') : ''}>${options(sortBy(store.all(f.ref), x => f.label(x)), v, { label: f.label })}</select>`;
    case 'multiref': return html`<select name="${f.k}" multiple size="4">${options(store.all(f.ref), v || [], { placeholder: null })}</select>`;
    case 'list': return html`<input name="${f.k}" value="${(v || []).join('; ')}">`;
    default: return html`<input name="${f.k}" value="${v}" ${f.req ? raw('required') : ''}>`;
  }
}
function readValues(schema, v) {
  const out = {};
  for (const f of schema.fields) {
    let x = v[f.k];
    if (f.type === 'number') x = x === '' || x === undefined ? null : Number(String(x).replace(',', '.'));
    if (f.type === 'list') x = String(x || '').split(';').map(s => s.trim()).filter(Boolean);
    out[f.k] = x;
  }
  return out;
}

export function editEntity(type, e = null) {
  const schema = SCHEMAS[type];
  const isNew = !e;
  e = e || { id: uuid() };
  const m = openModal({
    title: (isNew ? 'Nouveau : ' : 'Modifier : ') + schema.title.toLowerCase(), wide: true,
    body: html`<form id="rf"><div class="grid2">${schema.fields.map(f => f.type === 'checkbox' ? html`<div class="field">${control(f, e[f.k])}</div>` : field(f.l, control(f, e[f.k]), { required: f.req }))}</div>${schema.note ? html`<p class="note">${schema.note}</p>` : ''}</form>`,
    actions: [{ label: 'Annuler' }, { label: 'Enregistrer', act: 'ok', cls: 'primary' }],
    handlers: {
      async ok() {
        const f = this.root.querySelector('#rf'); if (!f.reportValidity()) return;
        const vals = readValues(schema, formValues(f));
        const codeKey = schema.fields[0].k === 'code' ? 'code' : schema.fields[0].k === 'inventoryNo' ? 'inventoryNo' : null;
        if (codeKey && store.find(type, x => x.id !== e.id && String(x[codeKey]) === String(vals[codeKey]) && (type !== 'point' || x.siteId === vals.siteId) && (type !== 'operator' || x.providerId === vals.providerId))) { toast('Ce code existe déjà.', 'err'); return; }
        const next = { ...e, ...vals };
        if (type === 'equipment') next.statusLabel = EQUIPMENT_STATUS[next.status];
        await store.put(type, next, { reason: isNew ? 'Création' : 'Modification du référentiel' });
        this.close(next);
      }
    }
  });
  return m.result;
}

export const listView = {
  nav: 'referentiels', title: 'Référentiel',
  async render({ type }, q) {
    const schema = SCHEMAS[type];
    if (!schema) return html`<div class="card">${empty('❓', 'Référentiel inconnu.')}</div>`;
    let list = store.all(type);
    if (q.q) { const t = normalize(q.q); list = list.filter(e => normalize(JSON.stringify(e)).includes(t)); }
    list = sortBy(list, type === 'criticality' ? 'rank' : (x => titleOf(type, x)));
    const manage = can('ref.manage');
    const second = e => schema.fields.slice(1, 4).filter(f => !['textarea', 'checkbox', 'multiref'].includes(f.type)).map(f => f.type === 'ref' ? (store.get(f.ref, e[f.k]) ? f.label(store.get(f.ref, e[f.k])) : '') : Array.isArray(e[f.k]) ? e[f.k].join(', ') : e[f.k]).filter(x => x !== '' && x !== null && x !== undefined).join(' · ');
    return html`${pageTitle(schema.title, `${list.length} élément(s)`, html`${manage ? html`<button class="btn primary" data-act="new">＋ Ajouter</button>` : ''}<button class="btn ghost" data-act="csv">Exporter (CSV)</button>`, '#/referentiels')}
      <div class="field"><input type="search" placeholder="Rechercher…" value="${q.q || ''}" data-change="search"></div>
      ${list.length ? html`<div class="list">${list.slice(0, 400).map(e => html`<button class="li" data-act="${manage ? 'edit' : 'noop'}" data-id="${e.id}">${type === 'criticality' ? html`<span style="width:18px;height:18px;border-radius:50%;background:${e.color};flex:none"></span>` : ''}<div class="li-main"><div class="li-title">${titleOf(type, e)}</div><div class="li-sub">${second(e)}</div>${schema.sub ? html`<div style="margin-top:4px">${schema.sub(e)}</div>` : ''}</div>${manage ? html`<span class="chev">›</span>` : ''}</button>`)}</div>${list.length > 400 ? html`<p class="note">400 premiers éléments affichés : affinez la recherche.</p>` : ''}` : html`<div class="card">${empty('🗂️', 'Aucun élément.')}</div>`}`;
  },
  handlers: {
    search(el) { navigate(`/referentiel/${this.params.type}?q=${encodeURIComponent(el.value)}`, { replace: true }); },
    noop() {},
    async new() { if (await editEntity(this.params.type)) this.refresh(); },
    async edit(el) {
      const type = this.params.type, e = store.get(type, el.dataset.id);
      const m = openModal({ title: titleOf(type, e), body: html`<p class="note">Créé le ${new Date(e.createdAt).toLocaleString('fr-FR')} par ${e.createdByName || '—'} · modifié le ${new Date(e.updatedAt).toLocaleString('fr-FR')} par ${e.updatedByName || '—'}</p>`, actions: [{ label: 'Supprimer', act: 'del', cls: 'danger-ghost' }, { label: 'Modifier', act: 'edit', cls: 'primary' }], handlers: { del() { this.close('del'); }, edit() { this.close('edit'); } } });
      const choice = await m.result;
      if (choice === 'edit') { if (await editEntity(type, e)) this.refresh(); }
      if (choice === 'del') {
        const reason = await promptDialog({ title: 'Supprimer l’élément', label: 'Motif (la suppression est tracée ; les audits passés conservent leurs données)' });
        if (!reason) return;
        await store.remove(type, e.id, reason); toast('Élément supprimé', 'ok'); this.refresh();
      }
    },
    async csv() {
      const type = this.params.type, schema = SCHEMAS[type];
      const rows = [['id', ...schema.fields.map(f => f.l)], ...store.all(type).map(e => [e.id, ...schema.fields.map(f => Array.isArray(e[f.k]) ? e[f.k].join('; ') : f.type === 'ref' ? (store.get(f.ref, e[f.k]) ? f.label(store.get(f.ref, e[f.k])) : '') : e[f.k] ?? '')])];
      downloadBlob(toCSV(rows), `referentiel_${type}_${localDate()}.csv`, 'text/csv;charset=utf-8');
      await store.log('export', { entityLabel: `Référentiel ${schema.title}`, details: `${rows.length - 1} lignes CSV` });
    }
  }
};
