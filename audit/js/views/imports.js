/* Assistant d'import : calendriers de prestations et référentiels. */
import { html, raw, fmtDateTime, sortBy, uuid, nowISO, localDate } from '../core/util.js';
import { store } from '../core/store.js';
import { can } from '../core/auth.js';
import { toast, downloadBlob, choiceDialog, confirmDialog } from '../ui/dom.js';
import { pageTitle, badge, empty, options, field } from '../ui/components.js';
import { TARGETS, readSource, suggestMapping, previewImport, applyImport } from '../app/imports.js';
import { toCSV } from '../formats/csv.js';

let wiz = { target: 'prestation', source: null, mapping: {}, preview: null, selected: null, url: '', urlKind: 'ics' };
const STATUS = { new: ['Nouveau', 'ok'], update: ['Modifié', 'info'], same: ['Inchangé', 'na'], error: ['Erreur', 'nc'] };

function mappingTable() {
  const s = wiz.source, fields = TARGETS[wiz.target].fields;
  return html`<div class="card"><h2>2 · Correspondance des colonnes</h2>
    <p class="note">Source : <b>${s.name}</b> (${s.kind.toUpperCase()}${s.sheet ? ', feuille « ' + s.sheet + ' »' : ''}) — ${s.rows.length} ligne(s) — empreinte <span class="mono tiny">${s.sha256.slice(0, 16)}…</span></p>
    <div class="table-wrap"><table class="tbl"><thead><tr><th>Champ</th><th>Colonne du fichier</th><th>Exemple</th></tr></thead><tbody>
    ${fields.map(f => { const col = wiz.mapping[f.key]; const sample = col !== undefined && col !== '' ? s.rows.find(r => String(r[col] ?? '').trim())?.[col] : ''; return html`<tr><td>${f.label}${f.required ? html` <span style="color:var(--nc)">*</span>` : ''}</td>
      <td><select data-change="map" data-k="${f.key}">${options(s.headers.map((h, i) => ({ id: String(i), label: h || `Colonne ${i + 1}` })), col === undefined ? '' : String(col), { placeholder: '— non importé —' })}</select></td><td class="tiny">${String(sample ?? '').slice(0, 60)}</td></tr>`; })}
    </tbody></table></div>
    <div class="btn-row" style="margin-top:10px"><button class="btn primary" data-act="preview">Prévisualiser l’import</button></div></div>`;
}
function previewTable() {
  const p = wiz.preview;
  const c = k => p.filter(r => r.status === k).length;
  const show = p.slice(0, 300);
  const label = r => r.entity.ref || r.entity.code || r.entity.inventoryNo || `${r.entity.docKey || ''} v${r.entity.version || ''}`;
  return html`<div class="card"><h2>3 · Prévisualisation</h2>
    <div class="row" style="margin-bottom:10px">${Object.entries(STATUS).map(([k, [l, cls]]) => badge(`${l} : ${c(k)}`, cls))}</div>
    <div class="table-wrap"><table class="tbl"><thead><tr><th></th><th>Ligne</th><th>Élément</th><th>État</th><th>Détail</th></tr></thead><tbody>
    ${show.map(r => html`<tr><td>${['new', 'update'].includes(r.status) ? html`<input type="checkbox" data-change="pick" data-i="${r.index}" ${wiz.selected.has(r.index) ? raw('checked') : ''}>` : ''}</td><td>${r.index}</td><td>${label(r)}${r.entity.plannedDate ? html`<div class="tiny muted">${r.entity.plannedDate} ${r.entity.plannedTime || ''}</div>` : ''}</td><td>${badge(STATUS[r.status][0], STATUS[r.status][1])}</td><td class="tiny">${[...r.errors, ...r.warnings].join(' ; ')}</td></tr>`)}
    </tbody></table></div>${p.length > 300 ? html`<p class="note">300 premières lignes affichées sur ${p.length}.</p>` : ''}
    <div class="btn-row" style="margin-top:10px"><button class="btn ok lg" data-act="apply" ${wiz.selected.size ? '' : raw('disabled')}>Importer ${wiz.selected.size} élément(s)</button>
      ${wiz.source.url ? html`<button class="btn ghost" data-act="save-source">Enregistrer cette source (synchronisation régulière)</button>` : ''}</div></div>`;
}

export default {
  nav: 'import', title: 'Import',
  async render() {
    if (!can('planning.manage') && !can('ref.manage')) return html`<div class="card">${empty('🔒', 'Votre profil ne permet pas d’importer des données.')}</div>`;
    const batches = sortBy(store.all('importBatch'), '-at').slice(0, 15);
    const sources = store.all('importSource');
    const allowed = Object.entries(TARGETS).filter(([k]) => k === 'prestation' ? can('planning.manage') : can('ref.manage'));
    return html`${pageTitle('Import de calendriers et de référentiels', 'Excel, CSV, iCalendar (ICS), API JSON, calendrier partagé, programme des fiches terrain')}
      <div class="card"><h2>1 · Données à importer et source</h2>
        ${field('Type de données', html`<select data-change="target">${options(allowed.map(([id, t]) => ({ id, label: t.label })), wiz.target, { placeholder: null })}</select>`)}
        <div class="grid2">
          <div class="field"><label>Fichier (Excel .xlsx, CSV, ICS, JSON)</label><label class="btn primary block">📂 Choisir un fichier<input type="file" hidden accept=".xlsx,.xlsm,.csv,.txt,.ics,.json,text/csv,text/calendar,application/json" data-change="file"></label></div>
          <div class="field"><label>Ou adresse d’un calendrier partagé / d’une API</label><div class="input-wrap"><input id="srcUrl" value="${wiz.url}" placeholder="https://…/calendrier.ics" inputmode="url"><select id="srcKind" style="max-width:120px">${options([{ id: 'ics', label: 'ICS' }, { id: 'json', label: 'API JSON' }, { id: 'csv', label: 'CSV' }], wiz.urlKind, { placeholder: null })}</select><button class="btn ghost" data-act="fetch">Lire</button></div><div class="hint">Le serveur distant doit autoriser l’accès depuis le navigateur (CORS).</div></div>
        </div>
        <div class="btn-row">
          ${wiz.target === 'prestation' ? html`<button class="btn ghost" data-act="programme">Programme des fiches terrain OEG</button><button class="btn ghost" data-act="manual">Saisie manuelle d’une prestation</button>` : ''}
          <button class="btn ghost" data-act="template">Télécharger un modèle CSV</button>
        </div></div>
      ${wiz.source ? mappingTable() : ''}
      ${wiz.preview ? previewTable() : ''}
      ${sources.length ? html`<div class="card"><h2>Sources synchronisées</h2><div class="list">${sources.map(s => html`<div class="li"><div class="li-main"><div class="li-title">${s.name}</div><div class="li-sub">${TARGETS[s.target]?.label} · ${s.kind.toUpperCase()} · ${s.url}</div><div class="li-sub">Dernière lecture : ${s.lastRunAt ? fmtDateTime(s.lastRunAt) + ' — ' + (s.lastResult || '') : 'jamais'}</div></div><button class="btn ghost sm" data-act="run-source" data-id="${s.id}">Synchroniser</button></div>`)}</div></div>` : ''}
      <div class="card"><h2>Historique des imports</h2>${batches.length ? html`<div class="table-wrap"><table class="tbl"><thead><tr><th>Date</th><th>Par</th><th>Données</th><th>Source</th><th>Résultat</th></tr></thead><tbody>${batches.map(b => html`<tr><td>${fmtDateTime(b.at)}</td><td>${b.by}</td><td>${TARGETS[b.target]?.label || b.target}</td><td>${b.source?.name}<div class="tiny mono muted">${(b.source?.sha256 || '').slice(0, 16)}</div></td><td>${b.counts.new} nouveau(x), ${b.counts.update} modifié(s), ${b.counts.error} erreur(s)</td></tr>`)}</tbody></table></div>` : html`<p class="note">Aucun import.</p>`}</div>`;
  },
  handlers: {
    target(el) { wiz = { ...wiz, target: el.value, source: null, preview: null, mapping: {} }; this.refresh(); },
    async file(el) {
      const f = el.files[0]; el.value = ''; if (!f) return;
      try { const s = await readSource({ file: f }); wiz = { ...wiz, source: s, mapping: suggestMapping(wiz.target, s.headers), preview: null }; this.refresh(); }
      catch (e) { toast('Lecture impossible : ' + e.message, 'err', 6000); }
    },
    async fetch() {
      const url = document.getElementById('srcUrl').value.trim(), kind = document.getElementById('srcKind').value;
      if (!url) return;
      wiz.url = url; wiz.urlKind = kind;
      try { const s = await readSource({ url, kind }); s.url = url; s.sourceKey = 'url:' + url; wiz = { ...wiz, source: s, mapping: suggestMapping(wiz.target, s.headers), preview: null }; this.refresh(); }
      catch (e) { toast('Source inaccessible : ' + (e.message === 'Failed to fetch' ? 'réseau ou autorisation CORS' : e.message), 'err', 6000); }
    },
    map(el) { if (el.value === '') delete wiz.mapping[el.dataset.k]; else wiz.mapping[el.dataset.k] = Number(el.value); wiz.preview = null; },
    preview() {
      const missing = TARGETS[wiz.target].fields.filter(f => f.required && wiz.mapping[f.key] === undefined);
      if (missing.length) { toast('Champs obligatoires non associés : ' + missing.map(f => f.label).join(', '), 'err', 6000); return; }
      wiz.preview = previewImport(wiz.target, wiz.source, wiz.mapping);
      wiz.selected = new Set(wiz.preview.filter(r => r.status === 'new' || r.status === 'update').map(r => r.index));
      this.refresh();
    },
    pick(el) { const i = Number(el.dataset.i); if (el.checked) wiz.selected.add(i); else wiz.selected.delete(i); },
    async apply() {
      const c = await applyImport(wiz.target, wiz.source, wiz.preview, wiz.selected);
      toast(`Import terminé : ${c.new} nouveau(x), ${c.update} modifié(s)`, 'ok', 5000);
      wiz = { ...wiz, source: null, preview: null, mapping: {} };
      this.refresh();
    },
    async 'save-source'() {
      const s = wiz.source;
      await store.put('importSource', { id: uuid(), name: s.name, url: s.url, kind: s.kind, target: wiz.target, mapping: wiz.mapping, createdAt: nowISO() }, { reason: 'Source d’import enregistrée' });
      toast('Source enregistrée', 'ok'); this.refresh();
    },
    async 'run-source'(el) {
      const src = store.get('importSource', el.dataset.id);
      try {
        const s = await readSource({ url: src.url, kind: src.kind }); s.url = src.url; s.sourceKey = 'url:' + src.url;
        const p = previewImport(src.target, s, src.mapping);
        const c = await applyImport(src.target, s, p);
        const result = `${c.new} nouveau(x), ${c.update} modifié(s), ${c.error} erreur(s)`;
        await store.put('importSource', { ...src, lastRunAt: nowISO(), lastResult: result });
        toast('Synchronisation : ' + result, c.error ? 'warn' : 'ok', 5000);
      } catch (e) { await store.put('importSource', { ...src, lastRunAt: nowISO(), lastResult: 'échec : ' + e.message }); toast(e.message, 'err'); }
      this.refresh();
    },
    async programme() {
      const nets = await choiceDialog({ title: 'Programme des fiches terrain OEG', message: 'Prestations déduites des sessions de campagne du référentiel des fiches terrain (date indicative = 1er jour du mois de session). Les prestations déjà présentes ne sont pas modifiées.', options: [{ value: 'Chimie,EL,RCO', label: 'Tous les réseaux programmés (Chimie, EL, RCO)' }, { value: 'Chimie', label: 'Chimie' }, { value: 'EL', label: 'EL — suivi littoral' }, { value: 'RCO', label: 'RCO' }] });
      if (!nets) return;
      const { importOEGProgramme } = await import('../app/bootstrap.js');
      const n = await importOEGProgramme({ networks: nets.split(',') });
      toast(`${n} prestation(s) importée(s)`, 'ok'); this.refresh();
    },
    async manual() { const { editPrestation } = await import('./prestation.js'); const p = await editPrestation(); if (p) location.hash = '#/prestation/' + p.id; },
    template() { downloadBlob(toCSV([TARGETS[wiz.target].fields.map(f => f.label)]), `modele_import_${wiz.target}.csv`, 'text/csv;charset=utf-8'); }
  }
};
