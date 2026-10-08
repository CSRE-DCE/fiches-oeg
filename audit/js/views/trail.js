/* Journal d'audit informatique : qui a fait quoi, quand, sur quel appareil, avec quelle valeur
 * précédente et quel motif ; vérification d'intégrité (chaîne d'empreintes, sceaux des audits, médias). */
import { html, raw, fmtDateTime, sortBy, normalize, localDate } from '../core/util.js';
import { store, verifyTrail } from '../core/store.js';
import { can } from '../core/auth.js';
import { navigate } from '../ui/router.js';
import { toast, openModal, downloadBlob } from '../ui/dom.js';
import { pageTitle, badge, empty, options } from '../ui/components.js';
import { verifyAuditSeal } from '../app/audits.js';
import { verifyMedia } from '../core/media.js';

const ACTIONS = { create: 'Création', update: 'Modification', delete: 'Suppression', amend: 'Modification après signature', 'amend-start': 'Début de modification tracée', 'amend-stop': 'Fin de modification tracée', sign: 'Signature', lock: 'Verrouillage', finish: 'Clôture', reopen: 'Réouverture', abandon: 'Abandon', report: 'Rapport généré', export: 'Export', import: 'Import', seed: 'Initialisation', login: 'Ouverture de session', logout: 'Fermeture de session', setup: 'Configuration de l’appareil', publish: 'Publication', emergency: 'Urgence', annotate: 'Annotation de photo', backup: 'Sauvegarde', 'password-change': 'Changement de mot de passe', 'attach-server': 'Rattachement au serveur' };
const TYPES = { audit: 'Audit', deviation: 'Écart', prestation: 'Prestation', media: 'Média', document: 'Document', grid: 'Grille', provider: 'Prestataire', operator: 'Opérateur', site: 'Site', point: 'Point', user: 'Utilisateur', observation: 'Observation', alert: 'Alerte', equipment: 'Équipement', setting: 'Réglages', importBatch: 'Import' };

function filtered(q) {
  let list = store.all('trail');
  if (q.action) list = list.filter(t => t.action === q.action);
  if (q.objet) list = list.filter(t => t.entityType === q.objet);
  if (q.user) list = list.filter(t => t.userName === q.user);
  if (q.du) list = list.filter(t => t.at.slice(0, 10) >= q.du);
  if (q.au) list = list.filter(t => t.at.slice(0, 10) <= q.au);
  if (q.q) { const s = normalize(q.q); list = list.filter(t => normalize(`${t.entityLabel} ${t.reason} ${t.userName}`).includes(s)); }
  return sortBy(list, '-at', '-seq');
}

export default {
  nav: 'journal', title: 'Journal d’audit',
  async render(params, q) {
    if (!can('trail.view')) return html`<div class="card">${empty('🔒', 'Journal réservé à l’encadrement et au responsable qualité.')}</div>`;
    const list = filtered(q);
    const users = [...new Set(store.all('trail').map(t => t.userName).filter(Boolean))].sort();
    const page = Number(q.page || 0), size = 100;
    return html`${pageTitle('Journal d’audit informatique', `${list.length} entrée(s) — journal chaîné par empreintes SHA-256`, html`<button class="btn primary" data-act="verify">🔎 Vérifier l’intégrité</button><button class="btn ghost" data-act="csv">Exporter</button>`)}
      <details class="card" ${Object.keys(q).some(k => k !== 'page') ? 'open' : ''}><summary>Filtres</summary><div class="grid3" style="margin-top:10px">
        <div class="field"><label>Action</label><select data-change="f" data-k="action">${options(Object.entries(ACTIONS).map(([id, label]) => ({ id, label })), q.action, { placeholder: 'Toutes' })}</select></div>
        <div class="field"><label>Objet</label><select data-change="f" data-k="objet">${options(Object.entries(TYPES).map(([id, label]) => ({ id, label })), q.objet, { placeholder: 'Tous' })}</select></div>
        <div class="field"><label>Utilisateur</label><select data-change="f" data-k="user">${options(users, q.user, { placeholder: 'Tous' })}</select></div>
        <div class="field"><label>Du</label><input type="date" value="${q.du || ''}" data-change="f" data-k="du"></div><div class="field"><label>Au</label><input type="date" value="${q.au || ''}" data-change="f" data-k="au"></div>
        <div class="field"><label>Recherche</label><input type="search" value="${q.q || ''}" data-change="f" data-k="q"></div></div></details>
      <div id="integrity"></div>
      ${list.length ? html`<div class="table-wrap"><table class="tbl"><thead><tr><th>Date et heure</th><th>Utilisateur</th><th>Appareil</th><th>Action</th><th>Objet</th><th>Motif / détail</th></tr></thead><tbody>
        ${list.slice(page * size, page * size + size).map(t => html`<tr class="click" data-act="detail" data-id="${t.id}"><td>${fmtDateTime(t.at)}</td><td>${t.userName || '—'}<div class="tiny muted">${t.role || ''}</div></td><td class="tiny">${t.deviceName || ''}<div class="muted">n° ${t.seq}</div></td><td>${ACTIONS[t.action] || t.action}</td><td>${TYPES[t.entityType] || t.entityType || ''}<div class="tiny">${t.entityLabel || ''}</div></td><td class="tiny">${t.reason ? html`<b>${t.reason}</b><br>` : ''}${t.changeCount ? `${t.changeCount} champ(s) : ${(t.changes || []).slice(0, 3).map(c => c.path).join(', ')}` : ''}</td></tr>`)}
      </tbody></table></div>
      <div class="row between" style="margin-top:10px">${page > 0 ? html`<button class="btn ghost sm" data-act="page" data-p="${page - 1}">‹ Précédentes</button>` : html`<span></span>`}<span class="tiny muted">${page * size + 1}–${Math.min(list.length, page * size + size)} / ${list.length}</span>${(page + 1) * size < list.length ? html`<button class="btn ghost sm" data-act="page" data-p="${page + 1}">Suivantes ›</button>` : html`<span></span>`}</div>`
        : html`<div class="card">${empty('🧾', 'Aucune entrée.')}</div>`}`;
  },
  handlers: {
    f(el) { const q = { ...this.query, [el.dataset.k]: el.value }; delete q.page; if (!el.value) delete q[el.dataset.k]; navigate('/journal?' + new URLSearchParams(q), { replace: true }); },
    page(el) { navigate('/journal?' + new URLSearchParams({ ...this.query, page: el.dataset.p }), { replace: true }); },
    detail(el) {
      const t = store.get('trail', el.dataset.id);
      openModal({ title: `${ACTIONS[t.action] || t.action} — ${t.entityLabel || ''}`, wide: true, body: html`<div class="kv"><div>Date</div><div>${fmtDateTime(t.at)} (${t.at})</div><div>Utilisateur</div><div>${t.userName} (${t.role})</div><div>Appareil</div><div>${t.deviceName} — ${t.deviceId}</div><div>Version</div><div>${t.appVersion}</div><div>Motif</div><div>${t.reason || '—'}</div><div>N° d’ordre</div><div>${t.seq}</div><div>Empreinte</div><div class="mono tiny">${t.hash}</div><div>Empreinte précédente</div><div class="mono tiny">${t.prevHash || '(début de chaîne)'}</div></div>
        ${(t.changes || []).length ? html`<h3>Modifications (valeur précédente → nouvelle valeur)</h3><div class="table-wrap"><table class="tbl"><thead><tr><th>Champ</th><th>Avant</th><th>Après</th></tr></thead><tbody>${t.changes.map(c => html`<tr><td class="mono tiny">${c.path}</td><td class="tiny">${JSON.stringify(c.before ?? null)}</td><td class="tiny">${JSON.stringify(c.after ?? null)}</td></tr>`)}</tbody></table></div>` : ''}`, actions: [{ label: 'Fermer', cls: 'primary' }] });
    },
    async verify() {
      const box = document.getElementById('integrity');
      box.innerHTML = '<div class="banner info">Vérification en cours…</div>';
      const r = await verifyTrail(store.all('trail'));
      const seals = [];
      for (const a of store.filter('audit', a => a.lock?.lockedAt)) seals.push({ a, r: await verifyAuditSeal(a) });
      let mediaBad = 0, mediaMissing = 0;
      for (const m of store.all('media')) { const v = await verifyMedia(m.id); if (!v.ok) { if (v.reason.includes('absent')) mediaMissing++; else mediaBad++; } }
      const badSeals = seals.filter(s => !s.r.ok);
      box.innerHTML = String(html`<div class="card"><h2>Résultat de la vérification</h2>
        <div class="banner ${r.ok ? 'ok' : 'nc'}">${r.ok ? '✅ Journal intègre : chaîne d’empreintes continue sur tous les appareils.' : '❌ Anomalie détectée dans le journal.'}</div>
        <div class="table-wrap"><table class="tbl"><thead><tr><th>Appareil</th><th>Entrées</th><th>Période</th><th>Anomalies</th></tr></thead><tbody>${r.devices.map(d => html`<tr><td>${d.deviceName}</td><td>${d.count}</td><td>${fmtDateTime(d.first)} → ${fmtDateTime(d.last)}</td><td>${d.breaks.length ? d.breaks.map(b => `n°${b.seq} : ${b.reason}`).join(' ; ') : badge('Aucune', 'ok')}</td></tr>`)}</tbody></table></div>
        <div class="banner ${badSeals.length ? 'nc' : 'ok'}" style="margin-top:10px">${badSeals.length ? `❌ ${badSeals.length} audit(s) signé(s) dont le contenu ne correspond pas à l’empreinte : ${badSeals.map(s => s.a.number).join(', ')}` : `✅ ${seals.length} audit(s) signé(s) : contenu conforme aux empreintes scellées (modifications ultérieures toutes tracées).`}</div>
        <div class="banner ${mediaBad ? 'nc' : 'ok'}">${mediaBad ? `❌ ${mediaBad} média(s) altéré(s).` : '✅ Photos et pièces jointes : empreintes SHA-256 conformes.'}${mediaMissing ? ` ${mediaMissing} média(s) non présents sur cet appareil (non vérifiés).` : ''}</div>
        <p class="note">Le journal de chaque appareil est une chaîne : chaque entrée contient l’empreinte de la précédente. Une entrée supprimée, insérée ou modifiée rompt la chaîne.</p></div>`);
      await store.log('integrity-check', { entityLabel: 'Vérification d’intégrité', details: { journal: r.ok, auditsSignes: seals.length, sceauxInvalides: badSeals.length, mediasAlteres: mediaBad } });
    },
    async csv() {
      const { table, exportWorkbook } = await import('../app/exports.js');
      const bytes = await exportWorkbook([{ name: 'Journal d’audit', rows: table('trail', filtered(this.query)) }], 'journal_audit.xlsx', 'Journal d’audit');
      downloadBlob(bytes, `journal_audit_${localDate()}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    }
  }
};
