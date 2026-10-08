/* Bibliothèque de grilles d'audit : modèles par type de prélèvement, matrice, prestataire, protocole,
 * CCTP, environnement ; sections, critères, réponses, champs numériques, listes, photos, références
 * documentaires, règles d'alerte et logique conditionnelle. Une grille publiée est figée ; elle évolue
 * par nouvelle version. */
import { html, raw, uuid, sortBy, clone, localDate, nowISO, normalize, canonicalJSON, sha256Hex } from '../core/util.js';
import { store } from '../core/store.js';
import { can } from '../core/auth.js';
import { navigate } from '../ui/router.js';
import { toast, openModal, formValues, confirmDialog, downloadBlob, readFileAsText } from '../ui/dom.js';
import { pageTitle, kv, badge, empty, options, field } from '../ui/components.js';
import { ITEM_KINDS, SECTION_MODULES, DOMAINS, RESPONSES, DOC_TYPES } from '../domain/model.js';
import { flatSections, allItems, itemIndex, validateGrid, OPERATORS } from '../domain/grids.js';

const GRID_STATUS = { brouillon: ['Brouillon', 'warn'], publiee: ['Publiée', 'ok'], archivee: ['Archivée', 'na'] };
const statusBadge = s => badge(GRID_STATUS[s]?.[0] || s, GRID_STATUS[s]?.[1] || 'na');
const CTX_KEYS = { matrixCode: 'Code de matrice (ESU, ESO, EL…)', samplingTypeCode: 'Code du type de prélèvement', providerKind: 'Nature du prestataire (regie, prestataire, partenaire)', auditKind: 'Type d’audit (planifie, inopine)', network: 'Réseau du site' };

export function conditionText(cond, index) {
  if (!cond) return '';
  if (cond.all) return cond.all.map(c => conditionText(c, index)).join(' ET ');
  if (cond.any) return cond.any.map(c => conditionText(c, index)).join(' OU ');
  if (cond.not) return 'NON (' + conditionText(cond.not, index) + ')';
  const subject = cond.item ? `« ${index.get(cond.item)?.code || cond.item} »` : CTX_KEYS[cond.ctx] || cond.ctx;
  const val = cond.value === undefined ? '' : Array.isArray(cond.value) ? cond.value.join(', ') : String(cond.value);
  return `${subject} ${OPERATORS[cond.op || 'eq']} ${val}`.trim();
}

export default {
  nav: 'grilles', title: 'Grilles',
  async render() {
    const grids = sortBy(store.all('grid'), 'code', '-version');
    return html`${pageTitle('Bibliothèque de grilles d’audit', `${grids.length} grille(s)`, can('ref.manage') ? html`<button class="btn primary" data-act="new">＋ Grille</button><label class="btn ghost">Importer (JSON)<input type="file" accept="application/json" hidden data-change="import"></label>` : '')}
      <div class="list">${grids.map(g => html`<a class="li ${g.status === 'publiee' ? 'stripe-ok' : g.status === 'brouillon' ? 'stripe-warn' : ''}" href="#/grille/${g.id}"><div class="li-main"><div class="li-title">${g.name}</div><div class="li-sub">${g.code} · v${g.version} · ${flatSections(g).length} section(s) · ${allItems(g).length} critère(s)</div>
        <div class="row" style="gap:6px;margin-top:4px">${statusBadge(g.status)}${scopeBadges(g)}</div></div><span class="chev">›</span></a>`)}</div>
      <p class="note">Une grille publiée est figée : chaque audit en conserve une copie intégrale. Pour faire évoluer une grille, créez une nouvelle version.</p>`;
  },
  handlers: {
    async new() {
      if (!can('ref.manage')) return;
      const g = { id: uuid(), code: 'GR-' + Math.random().toString(36).slice(2, 6).toUpperCase(), name: 'Nouvelle grille', version: '1.0', status: 'brouillon', description: '', scope: { samplingTypeIds: [], matrixIds: [], providerIds: [], protocolDocKeys: [], cctpDocKeys: [], environments: [] }, settings: { transportMaxHours: 24 }, sections: [{ id: 'sec-' + uuid().slice(0, 8), title: 'Section 1', domain: 'prelevement', module: '', items: [] }] };
      await store.put('grid', g, { reason: 'Création d’une grille' });
      navigate('/grille/' + g.id);
    },
    async import(el) {
      const f = el.files[0]; el.value = ''; if (!f) return;
      try {
        const g = JSON.parse(await readFileAsText(f));
        const errs = validateGrid(g);
        if (errs.length) { toast('Grille invalide : ' + errs[0], 'err', 6000); return; }
        const copy = { ...g, id: uuid(), status: 'brouillon', importedAt: nowISO(), importedFrom: f.name };
        await store.put('grid', copy, { action: 'import', reason: `Import de ${f.name}` });
        navigate('/grille/' + copy.id);
      } catch (e) { toast('Fichier illisible : ' + e.message, 'err'); }
    }
  }
};

function scopeBadges(g) {
  const s = g.scope || {};
  const parts = [...(s.samplingTypeIds || []).map(id => store.get('samplingType', id)?.code), ...(s.matrixIds || []).map(id => store.get('matrix', id)?.code), ...(s.providerIds || []).map(id => store.get('provider', id)?.code), ...(s.protocolDocKeys || []), ...(s.cctpDocKeys || []), ...(s.environments || [])].filter(Boolean);
  return parts.length ? parts.map(p => badge(p, 'outline')) : badge('Toutes prestations', 'outline');
}

/* ---------- Formulaires d'édition ---------- */
function sectionForm(g, s = null) {
  s = s || { id: 'sec-' + uuid().slice(0, 8), title: '', domain: 'prelevement', module: '', help: '', items: [] };
  const idx = itemIndex(g);
  const m = openModal({
    title: s.title ? 'Section ' + s.title : 'Nouvelle section', wide: true,
    body: html`<form id="sf">${field('Titre', html`<input name="title" value="${s.title}" required>`, { required: true })}
      <div class="grid2">${field('Domaine', html`<select name="domain">${options(Object.entries(DOMAINS).map(([id, label]) => ({ id, label })), s.domain || 'prelevement', { placeholder: null })}</select>`, { hint: 'Sépare le contrôle du prélèvement de celui du transport.' })}
      ${field('Module spécialisé', html`<select name="module">${options(Object.entries(SECTION_MODULES).map(([id, label]) => ({ id, label })), s.module || '', { placeholder: null })}</select>`)}</div>
      ${field('Consigne pour l’auditeur', html`<textarea name="help">${s.help || ''}</textarea>`)}
      ${conditionFields(idx, s.condition, 'Afficher la section seulement si…')}</form>`,
    actions: [{ label: 'Annuler' }, { label: 'Enregistrer', act: 'ok', cls: 'primary' }],
    handlers: {
      ok() {
        const f = this.root.querySelector('#sf'); if (!f.reportValidity()) return;
        const v = formValues(f);
        let condition; try { condition = readCondition(v); } catch (e) { toast(e.message, 'err'); return; }
        this.close({ ...s, title: v.title, domain: v.domain, module: v.module, help: v.help, condition });
      }
    }
  });
  return m.result;
}

function conditionFields(idx, cond, label) {
  const simpleItem = cond && cond.item && !cond.all && !cond.any;
  const simpleCtx = cond && cond.ctx && !cond.all && !cond.any;
  const mode = !cond ? 'none' : simpleItem ? 'item' : simpleCtx ? 'ctx' : 'json';
  const items = [...new Map([...idx.values()].map(i => [i.id, i])).values()];
  return html`<details ${cond ? 'open' : ''}><summary>${label}${cond ? ' (condition définie)' : ''}</summary>
    <div class="field"><select name="condMode">${options([{ id: 'none', label: 'Toujours affiché' }, { id: 'item', label: 'Selon la réponse à un critère' }, { id: 'ctx', label: 'Selon le contexte de l’audit' }, { id: 'json', label: 'Condition avancée (JSON)' }], mode, { placeholder: null })}</select></div>
    <div class="grid3">
      ${field('Critère', html`<select name="condItem">${options(items, simpleItem ? cond.item : '', { value: i => i.code || i.id, label: i => `${i.code || ''} ${i.label}`.trim() })}</select>`)}
      ${field('Contexte', html`<select name="condCtx">${options(Object.entries(CTX_KEYS).map(([id, label]) => ({ id, label })), simpleCtx ? cond.ctx : '')}</select>`)}
      ${field('Opérateur', html`<select name="condOp">${options(Object.entries(OPERATORS).map(([id, label]) => ({ id, label })), (simpleItem || simpleCtx) ? cond.op || 'eq' : 'eq', { placeholder: null })}</select>`)}
    </div>
    ${field('Valeur (C, NC, Oui → truthy, texte, nombre ; plusieurs valeurs séparées par « ; »)', html`<input name="condValue" value="${(simpleItem || simpleCtx) && cond.value !== undefined ? (Array.isArray(cond.value) ? cond.value.join(';') : String(cond.value)) : ''}">`)}
    ${field('Condition avancée (JSON : {"all":[…]} / {"any":[…]})', html`<textarea name="condJson" class="mono">${mode === 'json' ? JSON.stringify(cond, null, 1) : ''}</textarea>`)}
  </details>`;
}
function readCondition(v) {
  if (v.condMode === 'none' || !v.condMode) return undefined;
  if (v.condMode === 'json') { try { return JSON.parse(v.condJson); } catch (e) { throw new Error('Condition JSON invalide'); } }
  const parseVal = s => { const parts = String(s).split(';').map(x => x.trim()).filter(x => x !== ''); const conv = x => x === 'true' ? true : x === 'false' ? false : (x !== '' && !isNaN(Number(x)) ? Number(x) : x); return parts.length > 1 ? parts.map(conv) : parts.length ? conv(parts[0]) : undefined; };
  if (v.condMode === 'item') { if (!v.condItem) throw new Error('Choisissez le critère de la condition'); return { item: v.condItem, op: v.condOp, ...(['answered', 'empty', 'truthy', 'falsy'].includes(v.condOp) ? {} : { value: parseVal(v.condValue) }) }; }
  if (!v.condCtx) throw new Error('Choisissez le contexte de la condition');
  return { ctx: v.condCtx, op: v.condOp, value: parseVal(v.condValue) };
}

function itemForm(g, it = null) {
  it = it || { id: 'it-' + uuid().slice(0, 8), code: '', label: '', kind: 'conformity', required: true, evidenceOnNC: true, refs: [] };
  const idx = itemIndex(g);
  const docKeys = [...new Map(store.all('document').map(d => [d.docKey, { id: d.docKey, label: `${DOC_TYPES[d.type] || d.type} — ${d.reference || d.docKey}`, type: d.type }])).values()];
  let refs = clone(it.refs || []);
  const rangeRule = (it.alerts || []).find(a => a.op === 'outside');
  const refRows = () => html`${refs.map((r, i) => html`<div class="tree-item" style="flex-wrap:wrap"><select data-ri="${i}" data-rk="docKey" style="min-width:200px;flex:1">${options(docKeys, r.docKey)}</select><input data-ri="${i}" data-rk="article" value="${r.article || ''}" placeholder="article §" style="max-width:110px"><input data-ri="${i}" data-rk="paragraph" value="${r.paragraph || ''}" placeholder="alinéa" style="max-width:90px"><input data-ri="${i}" data-rk="requirement" value="${r.requirement || ''}" placeholder="exigence (résumé)" style="flex-basis:100%"><button type="button" class="btn ghost sm" data-act="rdel" data-i="${i}">Retirer</button></div>`)}`;
  const m = openModal({
    title: it.label ? `Critère ${it.code}` : 'Nouveau critère', wide: true,
    body: html`<form id="itf"><div class="grid2">
      ${field('Code', html`<input name="code" value="${it.code}" required>`, { required: true })}
      ${field('Type de réponse', html`<select name="kind">${options(Object.entries(ITEM_KINDS).map(([id, label]) => ({ id, label })), it.kind, { placeholder: null })}</select>`)}</div>
      ${field('Libellé du critère', html`<textarea name="label" required>${it.label}</textarea>`, { required: true })}
      ${field('Aide / méthode de vérification', html`<textarea name="help">${it.help || ''}</textarea>`)}
      <div class="checks"><label class="check"><input type="checkbox" name="required" ${it.required ? 'checked' : ''}> Réponse obligatoire</label><label class="check"><input type="checkbox" name="evidenceOnNC" ${it.evidenceOnNC ? 'checked' : ''}> Preuve attendue si NC</label><label class="check"><input type="checkbox" name="allowNA" ${it.allowNA ? 'checked' : ''}> « Non applicable » possible (valeurs)</label></div>
      ${field('Réponses proposées (conformité)', html`<div class="checks">${Object.entries(RESPONSES).map(([k, r]) => html`<label class="check"><input type="checkbox" name="responses" data-multi value="${k}" ${(it.responses?.length ? it.responses : ['C', 'NC', 'NA', 'NO']).includes(k) ? 'checked' : ''}> ${r.label}</label>`)}</div>`)}
      <div class="grid2">${field('Options (listes ; une par ligne)', html`<textarea name="options">${(it.options || []).join('\n')}</textarea>`)}${field('Unité (valeur numérique)', html`<input name="unit" value="${it.unit || ''}" list="unitList"><datalist id="unitList">${store.all('unit').map(u => html`<option value="${u.symbol}">`)}</datalist>`)}</div>
      <h3>Alerte sur valeur</h3>
      <div class="grid3">${field('Alerte si hors de : min', html`<input name="alertMin" inputmode="decimal" value="${rangeRule ? rangeRule.value[0] : ''}">`)}${field('max', html`<input name="alertMax" inputmode="decimal" value="${rangeRule ? rangeRule.value[1] : ''}">`)}${field('Message', html`<input name="alertMsg" value="${rangeRule?.message || ''}" placeholder="ex. Température hors critère">`)}</div>
      ${field('Règles d’alerte avancées (JSON)', html`<textarea name="alertsJson" class="mono">${(it.alerts || []).filter(a => a !== rangeRule).length ? JSON.stringify((it.alerts || []).filter(a => a !== rangeRule), null, 1) : ''}</textarea>`, { hint: 'ex. [{"op":"truthy","level":"attention","message":"Matériel manquant"}]' })}
      <h3>Références documentaires</h3><div class="tree-sec" id="refs">${refRows()}</div><button type="button" class="btn ghost sm" data-act="radd">＋ Référence (CCTP, protocole, norme…)</button>
      ${conditionFields(idx, it.condition, 'Afficher le critère seulement si…')}</form>`,
    actions: [{ label: 'Annuler' }, { label: 'Enregistrer le critère', act: 'ok', cls: 'primary' }],
    onMount(root, api) { api.collect = () => { for (const el of root.querySelectorAll('[data-ri]')) refs[Number(el.dataset.ri)][el.dataset.rk] = el.value; }; },
    handlers: {
      radd() { this.collect(); refs.push({ docKey: '', article: '', requirement: '' }); this.root.querySelector('#refs').innerHTML = String(refRows()); },
      rdel(el) { this.collect(); refs.splice(Number(el.dataset.i), 1); this.root.querySelector('#refs').innerHTML = String(refRows()); },
      ok() {
        const f = this.root.querySelector('#itf'); if (!f.reportValidity()) return;
        this.collect();
        const v = formValues(f);
        let condition, alerts = [];
        try { condition = readCondition(v); } catch (e) { toast(e.message, 'err'); return; }
        try { if (v.alertsJson.trim()) alerts = JSON.parse(v.alertsJson); } catch (e) { toast('Règles d’alerte JSON invalides', 'err'); return; }
        if (v.alertMin !== '' && v.alertMax !== '') alerts.push({ op: 'outside', value: [Number(String(v.alertMin).replace(',', '.')), Number(String(v.alertMax).replace(',', '.'))], level: 'critique', code: 'VALUE_OUT', title: v.alertMsg || 'Valeur hors critère', message: (v.alertMsg || 'Valeur') + ' : {value} hors de l’intervalle [' + v.alertMin + ' ; ' + v.alertMax + ']' });
        const next = { ...it, code: v.code.trim(), label: v.label.trim(), kind: v.kind, help: v.help, required: v.required, evidenceOnNC: v.evidenceOnNC, allowNA: v.allowNA, responses: v.kind === 'conformity' ? v.responses : undefined, options: ['select', 'multiselect'].includes(v.kind) ? v.options.split('\n').map(s => s.trim()).filter(Boolean) : undefined, unit: v.kind === 'number' ? v.unit : undefined, refs: refs.filter(r => r.docKey).map(r => ({ ...r, docType: docKeys.find(d => d.id === r.docKey)?.type })), alerts: alerts.length ? alerts : undefined, condition };
        for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k];
        this.close(next);
      }
    }
  });
  return m.result;
}

/* ---------- Détail / édition ---------- */
export const detailView = {
  nav: 'grilles', title: 'Grille',
  async render({ id }) {
    const g = store.get('grid', id);
    if (!g) return html`<div class="card">${empty('❓', 'Grille introuvable.')}</div>`;
    const idx = itemIndex(g);
    const editable = g.status === 'brouillon' && can('ref.manage');
    const errors = validateGrid(g);
    const used = store.count('audit', a => a.gridId === g.id);
    const s = g.scope || {};
    return html`${pageTitle(g.name, `${g.code} · version ${g.version}`, html`${statusBadge(g.status)}`, '#/grilles')}
      ${errors.length ? html`<div class="banner nc">${errors.length} problème(s) : ${errors.slice(0, 3).join(' ; ')}</div>` : ''}
      <div class="card"><h2>Description et champ d’application</h2>${kv([['Description', g.description], ['Types de prélèvement', (s.samplingTypeIds || []).map(x => store.get('samplingType', x)?.label).join(', ') || 'tous'], ['Matrices', (s.matrixIds || []).map(x => store.get('matrix', x)?.label).join(', ') || 'toutes'], ['Prestataires', (s.providerIds || []).map(x => store.get('provider', x)?.name).join(', ') || 'tous'], ['Protocoles', (s.protocolDocKeys || []).join(', ') || 'tous'], ['CCTP', (s.cctpDocKeys || []).join(', ') || 'tous'], ['Environnements', (s.environments || []).join(', ') || 'tous'], ['Délai maximal de transport (alerte)', (g.settings?.transportMaxHours || 24) + ' h'], ['Audits utilisant cette version', String(used)], ['Publiée le', g.publishedAt ? new Date(g.publishedAt).toLocaleDateString('fr-FR') : '']])}
        <div class="btn-row" style="margin-top:10px">
          ${editable ? html`<button class="btn ghost sm" data-act="meta">✏️ Description et champ d’application</button><button class="btn ok sm" data-act="publish" ${errors.length ? raw('disabled') : ''}>Publier</button>` : ''}
          ${can('ref.manage') && g.status !== 'brouillon' ? html`<button class="btn primary sm" data-act="newversion">＋ Nouvelle version (brouillon)</button>` : ''}
          ${can('ref.manage') && g.status === 'publiee' ? html`<button class="btn ghost sm" data-act="archive">Archiver</button>` : ''}
          <button class="btn ghost sm" data-act="export">Exporter (JSON)</button>
          ${editable && !used ? html`<button class="btn danger-ghost sm" data-act="delete">Supprimer le brouillon</button>` : ''}
        </div></div>
      ${(g.sections || []).map((sec, si) => html`<div class="tree-sec"><div class="ts-head"><b class="grow">${si + 1}. ${sec.title}</b><span class="domain-tag ${sec.domain || 'prelevement'}">${sec.domain === 'transport' ? 'Transport' : 'Prélèvement'}</span>${sec.module ? badge(SECTION_MODULES[sec.module], 'info') : ''}
          ${editable ? html`<button class="icon-btn" data-act="sec-up" data-s="${si}" title="Monter">↑</button><button class="icon-btn" data-act="sec-edit" data-s="${si}" title="Modifier">✏️</button><button class="icon-btn" data-act="sec-del" data-s="${si}" title="Supprimer">🗑</button>` : ''}</div>
        ${sec.condition ? html`<div class="tree-item tiny" style="color:var(--sky)">Affichée si : ${conditionText(sec.condition, idx)}</div>` : ''}
        ${(sec.items || []).map((it, ii) => html`<div class="tree-item"><span class="item-code">${it.code}</span><div class="grow"><div>${it.label}${it.required ? html` <span style="color:var(--nc)">*</span>` : ''}</div>
            <div class="tiny muted">${ITEM_KINDS[it.kind]}${it.unit ? ' · ' + it.unit : ''}${it.refs?.length ? ' · réf. ' + it.refs.map(r => [r.docKey, r.article].filter(Boolean).join(' § ')).join(' ; ') : ''}${it.alerts?.length ? ' · ' + it.alerts.length + ' règle(s) d’alerte' : ''}</div>
            ${it.condition ? html`<div class="tiny" style="color:var(--sky)">Affiché si : ${conditionText(it.condition, idx)}</div>` : ''}</div>
          ${editable ? html`<button class="icon-btn" data-act="it-up" data-s="${si}" data-i="${ii}" title="Monter">↑</button><button class="icon-btn" data-act="it-edit" data-s="${si}" data-i="${ii}" title="Modifier">✏️</button><button class="icon-btn" data-act="it-del" data-s="${si}" data-i="${ii}" title="Supprimer">🗑</button>` : ''}</div>`)}
        ${editable ? html`<div class="tree-item"><button class="btn ghost sm" data-act="it-add" data-s="${si}">＋ Critère</button></div>` : ''}</div>`)}
      ${editable ? html`<button class="btn primary" data-act="sec-add">＋ Section</button>` : ''}`;
  },
  handlers: {
    async meta() {
      const g = store.get('grid', this.params.id), s = g.scope || {};
      const m = openModal({ title: 'Description et champ d’application', wide: true, body: html`<form id="mf"><div class="grid2">${field('Nom', html`<input name="name" value="${g.name}" required>`)}${field('Code', html`<input name="code" value="${g.code}" required>`)}${field('Version', html`<input name="version" value="${g.version}" required>`)}${field('Délai maximal de transport (h)', html`<input name="transportMaxHours" type="number" value="${g.settings?.transportMaxHours || 24}">`)}</div>
          ${field('Description', html`<textarea name="description">${g.description || ''}</textarea>`)}
          <p class="note">Champ d’application (vide = toutes les prestations). Plusieurs choix possibles.</p>
          <div class="grid2">${field('Types de prélèvement', html`<select name="samplingTypeIds" multiple size="5">${options(store.all('samplingType'), s.samplingTypeIds || [], { placeholder: null })}</select>`)}${field('Matrices', html`<select name="matrixIds" multiple size="5">${options(store.all('matrix'), s.matrixIds || [], { placeholder: null })}</select>`)}
          ${field('Prestataires', html`<select name="providerIds" multiple size="5">${options(sortBy(store.all('provider'), 'name'), s.providerIds || [], { placeholder: null })}</select>`)}${field('Protocoles', html`<select name="protocolDocKeys" multiple size="5">${options([...new Set(store.filter('document', d => d.type === 'PROTOCOLE').map(d => d.docKey))], s.protocolDocKeys || [], { placeholder: null })}</select>`)}
          ${field('CCTP', html`<select name="cctpDocKeys" multiple size="5">${options([...new Set(store.filter('document', d => d.type === 'CCTP').map(d => d.docKey))], s.cctpDocKeys || [], { placeholder: null })}</select>`)}${field('Environnements (séparés par « ; »)', html`<input name="environments" value="${(s.environments || []).join('; ')}" placeholder="ex. fleuve; littoral; forage">`)}</div></form>`,
        actions: [{ label: 'Annuler' }, { label: 'Enregistrer', act: 'ok', cls: 'primary' }], handlers: { ok() { const f = this.root.querySelector('#mf'); if (!f.reportValidity()) return; this.close(formValues(f)); } } });
      const v = await m.result; if (!v) return;
      await store.put('grid', { ...g, name: v.name, code: v.code, version: v.version, description: v.description, settings: { ...(g.settings || {}), transportMaxHours: Number(v.transportMaxHours) || 24 }, scope: { samplingTypeIds: v.samplingTypeIds, matrixIds: v.matrixIds, providerIds: v.providerIds, protocolDocKeys: v.protocolDocKeys, cctpDocKeys: v.cctpDocKeys, environments: v.environments.split(';').map(x => x.trim()).filter(Boolean) } }, { reason: 'Modification du champ d’application' });
      this.refresh();
    },
    async 'sec-add'() { const g = store.get('grid', this.params.id); const s = await sectionForm(g); if (!s) return; await store.put('grid', { ...g, sections: [...g.sections, s] }); this.refresh(); },
    async 'sec-edit'(el) { const g = clone(store.get('grid', this.params.id)); const i = Number(el.dataset.s); const s = await sectionForm(g, g.sections[i]); if (!s) return; g.sections[i] = s; await store.put('grid', g); this.refresh(); },
    async 'sec-del'(el) { const g = clone(store.get('grid', this.params.id)); const i = Number(el.dataset.s); if (!(await confirmDialog({ title: 'Supprimer la section', message: `Supprimer « ${g.sections[i].title} » et ses ${g.sections[i].items.length} critère(s) ?`, danger: true }))) return; g.sections.splice(i, 1); await store.put('grid', g); this.refresh(); },
    async 'sec-up'(el) { const g = clone(store.get('grid', this.params.id)); const i = Number(el.dataset.s); if (!i) return; [g.sections[i - 1], g.sections[i]] = [g.sections[i], g.sections[i - 1]]; await store.put('grid', g); this.refresh(); },
    async 'it-add'(el) { const g = clone(store.get('grid', this.params.id)); const it = await itemForm(g); if (!it) return; g.sections[Number(el.dataset.s)].items.push(it); await store.put('grid', g); this.refresh(); },
    async 'it-edit'(el) { const g = clone(store.get('grid', this.params.id)); const s = g.sections[Number(el.dataset.s)], i = Number(el.dataset.i); const it = await itemForm(g, s.items[i]); if (!it) return; s.items[i] = it; await store.put('grid', g); this.refresh(); },
    async 'it-del'(el) { const g = clone(store.get('grid', this.params.id)); const s = g.sections[Number(el.dataset.s)]; s.items.splice(Number(el.dataset.i), 1); await store.put('grid', g); this.refresh(); },
    async 'it-up'(el) { const g = clone(store.get('grid', this.params.id)); const s = g.sections[Number(el.dataset.s)], i = Number(el.dataset.i); if (!i) return; [s.items[i - 1], s.items[i]] = [s.items[i], s.items[i - 1]]; await store.put('grid', g); this.refresh(); },
    async publish() {
      const g = store.get('grid', this.params.id);
      if (!(await confirmDialog({ title: 'Publier la grille', message: 'La grille sera figée et proposée pour les nouveaux audits. Les versions publiées précédentes de même code seront archivées.', okLabel: 'Publier' }))) return;
      for (const old of store.filter('grid', x => x.code === g.code && x.status === 'publiee' && x.id !== g.id)) await store.put('grid', { ...old, status: 'archivee', archivedAt: nowISO() }, { reason: `Remplacée par la version ${g.version}` });
      await store.put('grid', { ...g, status: 'publiee', publishedAt: nowISO(), sha256: await sha256Hex(canonicalJSON(g.sections)) }, { action: 'publish', reason: 'Publication de la grille' });
      toast('Grille publiée', 'ok'); this.refresh();
    },
    async newversion() {
      const g = store.get('grid', this.params.id);
      const v = String(g.version).split('.'); v[v.length - 1] = String(Number(v[v.length - 1] || 0) + 1);
      const copy = { ...clone(g), id: uuid(), version: v.join('.'), status: 'brouillon', publishedAt: null, sha256: null, previousVersionId: g.id };
      await store.put('grid', copy, { reason: `Nouvelle version de ${g.code}` });
      navigate('/grille/' + copy.id);
    },
    async archive() { const g = store.get('grid', this.params.id); await store.put('grid', { ...g, status: 'archivee', archivedAt: nowISO() }, { reason: 'Archivage' }); this.refresh(); },
    async delete() { if (!(await confirmDialog({ title: 'Supprimer le brouillon', message: 'Supprimer définitivement ce brouillon de grille ? (tracé au journal)', danger: true }))) return; await store.remove('grid', this.params.id, 'Suppression d’un brouillon'); navigate('/grilles'); },
    export() { const g = store.get('grid', this.params.id); const { _rev, _lv, ...rest } = g; downloadBlob(JSON.stringify(rest, null, 2), `${g.code}_v${g.version}.json`, 'application/json'); }
  }
};
