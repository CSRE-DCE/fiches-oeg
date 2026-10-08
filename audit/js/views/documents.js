/* Gestion documentaire : CCTP, protocoles, procédures, modes opératoires, plans, consignes, normes et
 * référentiels. Versions successives d'un même document (clé), dates d'application, statut ; un
 * document en vigueur n'est plus modifiable (nouvelle version obligatoire). */
import { html, fmtDate, fmtDateTime, sortBy, uuid, normalize, addDays, localDate } from '../core/util.js';
import { store } from '../core/store.js';
import { can } from '../core/auth.js';
import { hasLocalBytes } from '../core/media.js';
import { navigate } from '../ui/router.js';
import { toast, openModal, formValues, promptDialog, confirmDialog } from '../ui/dom.js';
import { pageTitle, kv, badge, docBadge, empty, options, field, auditBadge } from '../ui/components.js';
import { addFilesFromInput, viewMedia } from '../ui/capture.js';
import { DOC_TYPES, DOC_STATUS } from '../domain/model.js';
import { versionsOf, docInForce, documentHash } from '../app/documents.js';

export default {
  nav: 'documents', title: 'Documents',
  async render(params, q) {
    const today = localDate();
    let docs = store.all('document');
    if (q.type) docs = docs.filter(d => d.type === q.type);
    if (q.q) { const t = normalize(q.q); docs = docs.filter(d => normalize(`${d.name} ${d.reference} ${d.docKey}`).includes(t)); }
    const keys = sortBy([...new Set(docs.map(d => d.docKey))].map(k => ({ k, d: docInForce(k, today) || versionsOf(k)[0] })), x => x.d?.type, x => x.d?.name);
    return html`${pageTitle('Documents applicables', `${keys.length} document(s) · ${docs.length} version(s)`, can('ref.manage') ? html`<button class="btn primary" data-act="new">＋ Document</button>` : '')}
      <div class="chips" style="margin-bottom:10px"><button class="chip ${!q.type ? 'sel' : ''}" data-act="type" data-v="">Tous</button>${Object.entries(DOC_TYPES).filter(([k]) => store.count('document', d => d.type === k)).map(([k, l]) => html`<button class="chip ${q.type === k ? 'sel' : ''}" data-act="type" data-v="${k}">${l}</button>`)}</div>
      <div class="field"><input type="search" placeholder="Rechercher un document…" value="${q.q || ''}" data-change="search"></div>
      ${keys.length ? html`<div class="list">${keys.map(({ k, d }) => { const vs = versionsOf(k); return html`<a class="li" href="#/document/${d.id}"><div class="li-main"><div class="li-title">${DOC_TYPES[d.type] || d.type} — ${d.reference || k}</div><div class="li-sub">${d.name}</div>
        <div class="row" style="gap:6px;margin-top:4px"><span class="version-pill">v${d.version}</span>${docBadge(d.status)}${vs.length > 1 ? badge(`${vs.length} versions`, 'outline') : ''}${d.applicableFrom ? badge('depuis le ' + fmtDate(d.applicableFrom), 'outline') : ''}</div></div><span class="chev">›</span></a>`; })}</div>` : html`<div class="card">${empty('📚', 'Aucun document.')}</div>`}`;
  },
  handlers: {
    type(el) { navigate('/documents' + (el.dataset.v ? '?type=' + el.dataset.v : ''), { replace: true }); },
    search(el) { navigate('/documents?q=' + encodeURIComponent(el.value), { replace: true }); },
    async new() { const d = await editDocument(); if (d) navigate('/document/' + d.id); }
  }
};

function editDocument(d = null, { newVersionOf = null } = {}) {
  const isNew = !d;
  const base = newVersionOf ? { ...newVersionOf, id: uuid(), version: String((Number(String(newVersionOf.version).replace(/[^\d.]/g, '')) || 0) + 1), status: 'brouillon', applicableFrom: localDate(), applicableTo: '', fileMediaId: null, previousVersionId: newVersionOf.id } : null;
  d = d || base || { id: uuid(), docKey: '', type: 'PROTOCOLE', name: '', reference: '', version: '1', applicableFrom: localDate(), applicableTo: '', status: 'brouillon', providerIds: [], samplingTypeIds: [], siteIds: [], articles: [], summary: '' };
  let articles = (d.articles || []).map(a => ({ ...a, id: a.id || uuid() }));
  const artRows = () => html`${articles.map((a, i) => html`<div class="tree-item" style="flex-wrap:wrap;align-items:flex-start"><input data-ai="${i}" data-ak="number" value="${a.number || ''}" placeholder="n°" style="max-width:80px"><input data-ai="${i}" data-ak="title" value="${a.title || ''}" placeholder="titre" style="flex:1;min-width:160px"><textarea data-ai="${i}" data-ak="text" placeholder="texte de l’exigence" style="flex-basis:100%;min-height:60px">${a.text || ''}</textarea><button type="button" class="btn ghost sm" data-act="adel" data-i="${i}">Supprimer l’article</button></div>`)}`;
  const m = openModal({
    title: newVersionOf ? `Nouvelle version de ${newVersionOf.reference}` : isNew ? 'Nouveau document' : `Modifier ${d.reference} v${d.version} (brouillon)`, wide: true,
    body: html`<form id="df"><div class="grid2">
      ${field('Clé du document (stable entre versions)', html`<input name="docKey" value="${d.docKey}" required ${newVersionOf || !isNew ? 'readonly' : ''}>`, { required: true, hint: 'ex. CCTP-SURV-EAUX, PROTO-PREL-ESU' })}
      ${field('Type', html`<select name="type">${options(Object.entries(DOC_TYPES).map(([id, label]) => ({ id, label })), d.type, { placeholder: null })}</select>`)}
      ${field('Intitulé', html`<input name="name" value="${d.name}" required>`, { required: true })}${field('Référence', html`<input name="reference" value="${d.reference || ''}">`)}
      ${field('Version', html`<input name="version" value="${d.version}" required>`, { required: true })}${field('Statut', html`<input value="${DOC_STATUS[d.status]?.label}" readonly>`)}
      ${field('Date d’application', html`<input type="date" name="applicableFrom" value="${d.applicableFrom || ''}">`)}${field('Fin de validité', html`<input type="date" name="applicableTo" value="${d.applicableTo || ''}">`)}
    </div>
    ${field('Prestataires concernés (vide = tous)', html`<select name="providerIds" multiple size="4">${options(sortBy(store.all('provider'), 'name'), d.providerIds || [], { placeholder: null })}</select>`)}
    ${field('Types de prélèvement concernés (vide = tous)', html`<select name="samplingTypeIds" multiple size="4">${options(store.all('samplingType'), d.samplingTypeIds || [], { placeholder: null })}</select>`)}
    ${field('Résumé / objet', html`<textarea name="summary">${d.summary || ''}</textarea>`)}
    <h3>Articles / exigences (référençables depuis les grilles)</h3><div class="tree-sec" id="arts">${artRows()}</div><button type="button" class="btn ghost sm" data-act="aadd">＋ Article</button></form>`,
    actions: [{ label: 'Annuler' }, { label: 'Enregistrer le brouillon', act: 'ok', cls: 'primary' }],
    onMount(root, api) { api.collect = () => { for (const el of root.querySelectorAll('[data-ai]')) articles[Number(el.dataset.ai)][el.dataset.ak] = el.value; }; },
    handlers: {
      aadd() { this.collect(); articles.push({ id: uuid(), number: '', title: '', text: '' }); this.root.querySelector('#arts').innerHTML = String(artRows()); },
      adel(el) { this.collect(); articles.splice(Number(el.dataset.i), 1); this.root.querySelector('#arts').innerHTML = String(artRows()); },
      async ok() {
        const f = this.root.querySelector('#df'); if (!f.reportValidity()) return;
        this.collect();
        const v = formValues(f);
        if (store.find('document', x => x.docKey === v.docKey && String(x.version) === String(v.version) && x.id !== d.id)) { toast('Cette version existe déjà pour ce document.', 'err'); return; }
        const next = { ...d, ...v, articles: articles.filter(a => a.number || a.title || a.text), status: 'brouillon' };
        await store.put('document', next, { reason: newVersionOf ? `Nouvelle version (v${next.version}) de ${next.docKey}` : isNew ? 'Création du document' : 'Modification du brouillon' });
        this.close(next);
      }
    }
  });
  return m.result;
}

export const detailView = {
  nav: 'documents', title: 'Document',
  async render({ id }) {
    const d = store.get('document', id);
    if (!d) return html`<div class="card">${empty('❓', 'Document introuvable.')}</div>`;
    const versions = versionsOf(d.docKey);
    const file = d.fileMediaId ? store.get('media', d.fileMediaId) : null;
    const local = file ? await hasLocalBytes(file.id) : false;
    const usedBy = store.filter('audit', a => (a.documentsSnapshot || []).some(s => s.id === d.id));
    const manage = can('ref.manage');
    const hash = await documentHash({ ...d, fileSha256: file?.sha256 || null });
    return html`${pageTitle(`${d.reference || d.docKey}`, d.name, html`<span class="version-pill">v${d.version}</span>${docBadge(d.status)}`, '#/documents')}
      ${d.status === 'en_vigueur' ? html`<div class="banner ok">Version en vigueur : elle ne peut plus être modifiée. Toute évolution passe par une nouvelle version, les audits déjà réalisés conservant la version qui était applicable.</div>` : d.status === 'brouillon' ? html`<div class="banner warn">Brouillon : non utilisé par les audits tant qu’il n’est pas mis en vigueur.</div>` : ''}
      <div class="card"><h2>Identification</h2>${kv([['Nom', d.name], ['Référence', d.reference], ['Clé', d.docKey], ['Type', DOC_TYPES[d.type]], ['Version', d.version], ['Date d’application', fmtDate(d.applicableFrom)], ['Fin de validité', fmtDate(d.applicableTo)], ['Statut', DOC_STATUS[d.status]?.label], ['Prestataires concernés', (d.providerIds || []).map(x => store.get('provider', x)?.name).join(', ') || 'tous'], ['Types de prélèvement', (d.samplingTypeIds || []).map(x => store.get('samplingType', x)?.label).join(', ') || 'tous'], ['Empreinte SHA-256 du contenu', html`<span class="mono tiny">${hash}</span>`]])}
        ${d.summary ? html`<p>${d.summary}</p>` : ''}
        <div class="btn-row" style="margin-top:10px">
          ${file ? html`<button class="btn ghost" data-act="open-file" data-id="${file.id}">📄 ${file.name || 'Fichier joint'} ${local ? '(hors connexion ✓)' : '(à télécharger)'}</button>` : ''}
          ${manage && d.status === 'brouillon' ? html`<label class="btn ghost">📎 ${file ? 'Remplacer le fichier' : 'Joindre le fichier (PDF…)'}<input type="file" hidden accept="application/pdf,.doc,.docx,.odt,image/*" data-change="file" data-link='${JSON.stringify({ type: 'document', id: d.id })}' data-kind="document"></label>
            <button class="btn ghost" data-act="edit">✏️ Modifier</button><button class="btn ok" data-act="publish">Mettre en vigueur</button>` : ''}
          ${manage && d.status === 'en_vigueur' ? html`<button class="btn primary" data-act="newversion">＋ Nouvelle version</button><button class="btn ghost" data-act="archive">Archiver</button>` : ''}
        </div></div>
      <div class="card"><h2>Articles / exigences (${(d.articles || []).length})</h2>${(d.articles || []).length ? d.articles.map(a => html`<div class="doc-article"><h4>${a.number} — ${a.title}</h4><p>${a.text}</p></div>`) : html`<p class="note">Aucun article saisi.</p>`}</div>
      <div class="card"><h2>Historique des versions</h2><div class="list">${versions.map(v => html`<a class="li ${v.id === d.id ? 'stripe-info' : ''}" href="#/document/${v.id}"><div class="li-main"><div class="li-title">v${v.version}</div><div class="li-sub">${fmtDate(v.applicableFrom)}${v.applicableTo ? ' → ' + fmtDate(v.applicableTo) : ''} · créé par ${v.createdByName || '—'} le ${fmtDate(v.createdAt)}</div></div>${docBadge(v.status)}</a>`)}</div></div>
      <div class="card"><h2>Audits ayant utilisé cette version (${usedBy.length})</h2>${usedBy.length ? html`<div class="list">${usedBy.map(a => html`<a class="li" href="#/audit/${a.id}"><div class="li-main"><div class="li-title">${a.number}</div><div class="li-sub">${fmtDate(a.startedAt)}</div></div>${auditBadge(a)}</a>`)}</div>` : html`<p class="note">Aucun audit.</p>`}</div>`;
  },
  handlers: {
    async 'open-file'(el) { await viewMedia(el.dataset.id, { readOnly: true }); },
    async file(el) {
      const [m] = await addFilesFromInput(el, { kind: 'document' });
      if (!m) return;
      const d = store.get('document', this.params.id);
      await store.put('document', { ...d, fileMediaId: m.id, fileSha256: m.sha256 }, { reason: 'Fichier du document joint' });
      this.refresh();
    },
    async edit() { if (await editDocument(store.get('document', this.params.id))) this.refresh(); },
    async newversion() { const n = await editDocument(null, { newVersionOf: store.get('document', this.params.id) }); if (n) navigate('/document/' + n.id); },
    async publish() {
      const d = store.get('document', this.params.id);
      if (!d.applicableFrom) { toast('Renseignez la date d’application.', 'err'); return; }
      if (!(await confirmDialog({ title: 'Mettre en vigueur', message: `La version ${d.version} deviendra applicable le ${fmtDate(d.applicableFrom)} et ne pourra plus être modifiée. La version en vigueur précédente sera marquée « remplacée ».`, okLabel: 'Mettre en vigueur' }))) return;
      for (const old of store.filter('document', x => x.docKey === d.docKey && x.status === 'en_vigueur' && x.id !== d.id)) {
        await store.put('document', { ...old, status: 'remplace', applicableTo: old.applicableTo && old.applicableTo < d.applicableFrom ? old.applicableTo : addDays(d.applicableFrom, -1), replacedBy: d.id }, { reason: `Remplacé par la version ${d.version}` });
      }
      await store.put('document', { ...d, status: 'en_vigueur', publishedAt: new Date().toISOString() }, { action: 'publish', reason: 'Mise en vigueur' });
      toast('Version mise en vigueur', 'ok'); this.refresh();
    },
    async archive() {
      const reason = await promptDialog({ title: 'Archiver le document', label: 'Motif' }); if (!reason) return;
      const d = store.get('document', this.params.id);
      await store.put('document', { ...d, status: 'archive', applicableTo: d.applicableTo || localDate() }, { reason });
      this.refresh();
    }
  }
};
