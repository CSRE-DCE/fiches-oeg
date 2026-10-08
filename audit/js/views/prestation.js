/* Fiche de préparation d'une prestation programmée (avant déplacement) + édition de la prestation. */
import { html, fmtDate, fmtDateTime, localDate, sortBy, uuid, nowISO } from '../core/util.js';
import { store } from '../core/store.js';
import { session } from '../core/session.js';
import { can } from '../core/auth.js';
import { hasLocalBytes } from '../core/media.js';
import { navigate } from '../ui/router.js';
import { openModal, toast, promptDialog, choiceDialog, formValues } from '../ui/dom.js';
import { pageTitle, kv, prestationBadge, kindBadge, auditBadge, badge, docBadge, empty, options, critBadge, deviationBadge, operatorName, field } from '../ui/components.js';
import { PRESTATION_STATUS, CONTROL_LEVELS, DOC_TYPES, OPEN_DEVIATION, EQUIPMENT_STATUS } from '../domain/model.js';
import { operatorStatus, equipmentStatus } from '../domain/rules.js';
import { recurringDeviations } from '../domain/summary.js';
import { applicableDocuments, docInForce } from '../app/documents.js';
import { createAudit, gridsFor, setPrestationStatus } from '../app/audits.js';
import { auditsOf } from './planning.js';

function docRow(d, availability) {
  return html`<a class="li" href="#/document/${d.id}"><div class="li-main"><div class="li-title">${DOC_TYPES[d.type] || d.type} — ${d.reference || d.name}</div>
    <div class="li-sub">${d.name}</div><div class="row" style="gap:6px;margin-top:6px"><span class="version-pill">v${d.version}</span>${docBadge(d.status)}
    <span class="badge outline">Applicable ${d.applicableFrom ? 'du ' + fmtDate(d.applicableFrom) : ''}${d.applicableTo ? ' au ' + fmtDate(d.applicableTo) : ''}</span>
    ${d.fileMediaId ? (availability[d.id] ? badge('✓ Disponible hors connexion', 'ok') : badge('Fichier à télécharger', 'warn')) : (d.articles?.length ? badge('✓ Texte disponible hors connexion', 'ok') : badge('Métadonnées seules', 'na'))}</div></div><span class="chev">›</span></a>`;
}

export default {
  nav: 'planning', title: 'Préparation',
  async render({ id }) {
    const p = store.get('prestation', id);
    if (!p) return html`<div class="card">${empty('❓', 'Prestation introuvable.')}<a class="btn ghost" href="#/">Retour au planning</a></div>`;
    const today = localDate();
    const site = store.get('site', p.siteId), prov = store.get('provider', p.providerId), partner = store.get('provider', p.partnerId);
    const points = (p.pointIds || []).map(x => store.get('point', x)).filter(Boolean);
    const docs = applicableDocuments(p, p.plannedDate && p.plannedDate > today ? p.plannedDate : today);
    const availability = {};
    for (const d of docs) if (d.fileMediaId) availability[d.id] = await hasLocalBytes(d.fileMediaId);
    const proto = docInForce(p.protocolDocKey, today), cctp = docInForce(p.cctpDocKey, today);
    const ops = (p.operatorIds || []).map(x => store.get('operator', x)).filter(Boolean);
    const eqs = store.filter('equipment', e => e.providerId === p.providerId && e.status !== 'reforme');
    const audits = auditsOf(p.id);
    const current = audits.find(a => a.status === 'en_cours' || a.status === 'termine');
    const provAudits = sortBy(store.filter('audit', a => a.providerId === p.providerId && a.status !== 'abandonne' && a.prestationId !== p.id), '-startedAt').slice(0, 5);
    const provDevs = store.filter('deviation', d => d.providerId === p.providerId && OPEN_DEVIATION.includes(d.status));
    const recurring = recurringDeviations(store.filter('deviation', d => d.providerId === p.providerId));
    const camp = store.get('campaign', p.campaignId);
    const date = p.plannedDate || today;
    return html`
      ${pageTitle(site?.name || 'Prestation', `${p.ref} · ${p.plannedDate ? fmtDate(p.plannedDate) : 'date à fixer'}${p.plannedTime ? ' à ' + p.plannedTime : ''}${p.dateIndicative ? ' (date indicative)' : ''}`, html`${prestationBadge(p.status)}`, '#/')}
      <div class="btn-row" style="margin-bottom:12px">
        ${current ? html`<a class="btn primary lg" href="#/audit/${current.id}"><span class="ic">▶</span>Reprendre l’audit ${current.number}</a>`
          : can('audit.create') ? html`<button class="btn primary lg" data-act="start"><span class="ic">▶</span>Démarrer l’audit</button>` : ''}
        ${audits.filter(a => a.lock?.lockedAt).map(a => html`<a class="btn ok" href="#/audit/${a.id}">🔒 ${a.number}</a>`)}
      </div>
      <div class="card"><h2>Informations générales</h2>${kv([
        ['Référence de la prestation', p.ref], ['Référence du marché', p.marketRef],
        ['Prestataire', prov ? html`<a href="#/prestataire/${prov.id}">${prov.name}</a> ${kindBadge(prov.kind)}` : '—'],
        ['Partenaire', partner?.name], ['Équipe de prélèvement', [p.team, ops.map(o => operatorName(o)).join(', ')].filter(Boolean).join(' — ')],
        ['Date', p.plannedDate ? fmtDate(p.plannedDate) + (p.dateIndicative ? ' (indicative)' : '') : 'à fixer'], ['Heure', p.plannedTime],
        ['Site', site ? `${site.name} (${site.code})` : '—'], ['Campagne', camp?.label],
        ['Type de prélèvement', store.get('samplingType', p.samplingTypeId)?.label], ['Matrice', store.get('matrix', p.matrixId)?.label],
        ['Protocole applicable', proto ? html`${proto.reference} <span class="version-pill">v${proto.version}</span>` : (p.protocolDocKey ? `${p.protocolDocKey} — aucune version en vigueur` : 'non précisé')],
        ['CCTP applicable', cctp ? html`${cctp.reference} <span class="version-pill">v${cctp.version}</span>` : (p.cctpDocKey ? `${p.cctpDocKey} — aucune version en vigueur` : 'non précisé')],
        ['Méthode', store.get('method', p.methodId)?.reference], ['Fréquence', p.frequency], ['Niveau de contrôle attendu', CONTROL_LEVELS[p.controlLevel]],
        ['Remarques', p.notes], ['Source', p.source?.label || p.source?.kind]
      ])}
      ${can('planning.manage') ? html`<div class="btn-row" style="margin-top:10px"><button class="btn ghost sm" data-act="edit">✏️ Modifier la prestation</button></div>` : ''}</div>

      <div class="card"><h2>Documents applicables <span class="badge info">versions utilisées pour l’audit</span></h2>
        ${docs.length ? html`<div class="list">${docs.map(d => docRow(d, availability))}</div>` : empty('📄', 'Aucun document rattaché. Renseignez le CCTP et le protocole de la prestation.')}
        <p class="note">Les versions affichées seront figées dans l’audit au démarrage : une modification ultérieure d’un document ne modifiera jamais un audit déjà réalisé.</p></div>

      <div class="card"><h2>Site et point(s) de prélèvement</h2>
        ${kv([['Site', site ? `${site.name} — ${site.code}` : ''], ['Réseau(x)', (site?.networks || []).join(', ')], ['Nature', site?.kind], ['Commune / bassin', [site?.commune, site?.bassin].filter(Boolean).join(' / ')], ['Accès', (site?.transportModes || []).join(', ')], ['Pressions', site?.pressions]])}
        <div class="list" style="margin-top:10px">${points.map(pt => html`<div class="li"><div class="li-main"><div class="li-title">📍 ${pt.code} — ${pt.name}</div><div class="li-sub">${pt.lat ? `${pt.lat.toFixed(6)}, ${pt.lon.toFixed(6)} (WGS84)` : 'coordonnées non renseignées'}${pt.description ? ' · ' + pt.description : ''}</div></div>${pt.lat ? html`<a class="btn ghost sm" href="#/carte?point=${pt.id}">Carte</a>` : ''}</div>`)}</div></div>

      <div class="card"><h2>Opérateurs prévus et habilitations</h2>
        ${ops.length ? html`<div class="list">${ops.map(o => { const st = operatorStatus(o, date, p.samplingTypeId); return html`<div class="li ${st.ok ? 'stripe-ok' : 'stripe-nc'}"><div class="li-main"><div class="li-title">${operatorName(o)}</div><div class="li-sub">${o.function || ''} · ${(o.qualifications || []).map(q => `${q.label}${q.validUntil ? ' → ' + fmtDate(q.validUntil) : ''}`).join(' ; ') || 'aucune habilitation enregistrée'}</div></div>${st.ok ? badge('Habilité', 'ok') : badge('À vérifier', 'nc')}</div>`; })}</div>`
          : html`<p class="note">Aucun opérateur nominatif programmé : ils seront identifiés sur place.</p>`}</div>

      <div class="card"><h2>Équipements enregistrés du prestataire</h2>
        ${eqs.length ? html`<div class="table-wrap"><table class="tbl"><thead><tr><th>Équipement</th><th>Inventaire</th><th>Validité</th><th>État</th></tr></thead><tbody>${eqs.map(e => { const st = equipmentStatus(e, date); return html`<tr><td>${e.label}<div class="tiny muted">${e.brand} ${e.model}</div></td><td class="mono">${e.inventoryNo}</td><td>${fmtDate(e.validUntil) || '—'}</td><td>${st.ok ? badge('Valide', 'ok') : badge(st.reasons[0], st.level === 'critique' ? 'nc' : 'warn')}</td></tr>`; })}</tbody></table></div>` : html`<p class="note">Aucun équipement enregistré pour ce prestataire.</p>`}</div>

      <div class="card"><h2>Historique du prestataire avant audit</h2>
        <div class="kpis" style="margin-bottom:10px">
          <a class="kpi" href="#/audits?prestataire=${p.providerId}"><span class="k">Audits réalisés</span><span class="v">${store.count('audit', a => a.providerId === p.providerId && a.status !== 'abandonne')}</span></a>
          <a class="kpi ${provDevs.length ? 'alert-kpi' : ''}" href="#/ecarts?prestataire=${p.providerId}"><span class="k">Écarts ouverts</span><span class="v">${provDevs.length}</span></a>
          <div class="kpi ${recurring.length ? 'warn-kpi' : ''}"><span class="k">Écarts récurrents</span><span class="v">${recurring.length}</span></div>
        </div>
        ${provAudits.length ? html`<div class="list">${provAudits.map(a => html`<a class="li" href="#/audit/${a.id}"><div class="li-main"><div class="li-title">${a.number}</div><div class="li-sub">${fmtDate(a.startedAt)} · ${store.get('site', a.siteId)?.name || ''}</div></div>${auditBadge(a)}</a>`)}</div>` : html`<p class="note">Aucun audit antérieur de ce prestataire.</p>`}
        ${provDevs.length ? html`<h3>Écarts ouverts</h3><div class="list">${provDevs.slice(0, 6).map(d => html`<a class="li" href="#/ecart/${d.id}"><div class="li-main"><div class="li-title">${d.number}</div><div class="li-sub">${d.requirement}</div></div>${critBadge(d.criticalityCode)}${deviationBadge(d.status)}</a>`)}</div>` : ''}
        ${recurring.length ? html`<h3>Points de vigilance (écarts récurrents)</h3><ul>${recurring.slice(0, 5).map(r => html`<li>${r.requirement} — ${r.audits.length} audits</li>`)}</ul>` : ''}</div>

      <div class="card"><h2>Statut de la prestation</h2>
        <div class="row" style="margin-bottom:10px">${prestationBadge(p.status)}${audits.length ? badge(`${audits.length} audit(s)`, 'info') : badge('Non auditée', 'outline')}</div>
        ${can('audit.create') || can('planning.manage') ? html`<div class="btn-row">${Object.entries(PRESTATION_STATUS).filter(([k]) => k !== p.status && k !== 'auditee').map(([k, s]) => html`<button class="btn ghost sm" data-act="status" data-s="${k}">${s.label}</button>`)}</div>` : ''}
        ${(p.statusHistory || []).length ? html`<div class="table-wrap" style="margin-top:10px"><table class="tbl"><thead><tr><th>Date</th><th>Par</th><th>Évènement</th></tr></thead><tbody>${[...p.statusHistory].reverse().map(h => html`<tr><td>${fmtDateTime(h.at)}</td><td>${h.by || ''}</td><td>${h.label || (h.to ? `${PRESTATION_STATUS[h.from]?.label || ''} → ${PRESTATION_STATUS[h.to]?.label || h.to}` : h.event)}${h.reason ? html`<div class="tiny muted">${h.reason}</div>` : ''}</td></tr>`)}</tbody></table></div>` : ''}
      </div>`;
  },
  handlers: {
    async start() {
      const p = store.get('prestation', this.params.id);
      const grids = gridsFor(p);
      if (!grids.length) { toast('Aucune grille publiée applicable : publiez une grille dans la bibliothèque.', 'err'); return; }
      let gridId = grids[0].id;
      if (grids.length > 1) {
        gridId = await choiceDialog({ title: 'Choisir la grille d’audit', message: 'Grilles applicables à cette prestation (la plus spécifique en premier) :', options: grids.map(g => ({ value: g.id, label: `${g.name} — v${g.version}`, desc: g.description })) });
        if (!gridId) return;
      }
      const a = await createAudit({ prestationId: p.id, gridId, kind: 'planifie' });
      toast(`Audit ${a.number} créé`, 'ok');
      navigate('/audit/' + a.id);
    },
    async status(el) {
      const p = store.get('prestation', this.params.id);
      const s = el.dataset.s;
      const reason = await promptDialog({ title: `Passer la prestation à « ${PRESTATION_STATUS[s].label} »`, label: 'Motif / commentaire', required: ['annulee', 'reportee', 'non_realisee'].includes(s) });
      if (reason === null) return;
      if (s === 'reportee') {
        const d = await promptDialog({ title: 'Nouvelle date prévue', label: 'Date (JJ/MM/AAAA)', multiline: false, required: false, voice: false });
        const { parseDate } = await import('../domain/normalize.js');
        const nd = parseDate(d);
        if (nd) await store.put('prestation', { ...store.get('prestation', p.id), plannedDate: nd, dateIndicative: false }, { reason: `Report au ${fmtDate(nd)} : ${reason}` });
      }
      await setPrestationStatus(store.get('prestation', p.id), s, reason);
      toast('Statut mis à jour', 'ok'); this.refresh();
    },
    async edit() { const r = await editPrestation(store.get('prestation', this.params.id)); if (r) this.refresh(); }
  }
};

/** Formulaire de création / modification d'une prestation (saisie manuelle). */
export function editPrestation(p = null) {
  const isNew = !p;
  p = p || { id: uuid(), ref: '', plannedDate: localDate(), plannedTime: '', status: 'prevue', pointIds: [], operatorIds: [], controlLevel: 'complet', statusHistory: [], source: { kind: 'manuel', label: 'Saisie manuelle' } };
  const siteOpts = sortBy(store.all('site'), 'name');
  const docOpts = type => sortBy([...new Map(store.filter('document', d => d.type === type).map(d => [d.docKey, { id: d.docKey, label: `${d.reference || d.docKey} — ${d.name}` }])).values()], 'label');
  const m = openModal({
    title: isNew ? 'Nouvelle prestation programmée' : `Modifier la prestation ${p.ref}`, wide: true,
    body: html`<form id="prestForm" class="grid2">
      ${field('Référence', html`<input name="ref" value="${p.ref}" required>`, { required: true })}
      ${field('Référence du marché', html`<input name="marketRef" value="${p.marketRef || ''}">`)}
      ${field('Date prévue', html`<input type="date" name="plannedDate" value="${p.plannedDate || ''}" required>`, { required: true })}
      ${field('Heure prévue', html`<input type="time" name="plannedTime" value="${p.plannedTime || ''}">`)}
      ${field('Site', html`<select name="siteId" required>${options(siteOpts, p.siteId, { label: s => `${s.name} (${s.code})` })}</select>`, { required: true })}
      ${field('Point (code)', html`<select name="pointId">${options(store.filter('point', x => x.siteId === p.siteId), p.pointIds?.[0], { label: x => `${x.code} — ${x.name}`, placeholder: 'Point principal du site' })}</select>`, { hint: 'Enregistrez puis rouvrez pour choisir parmi les points du nouveau site.' })}
      ${field('Prestataire / régie', html`<select name="providerId" required>${options(sortBy(store.all('provider'), 'name'), p.providerId)}</select>`, { required: true })}
      ${field('Partenaire', html`<select name="partnerId">${options(sortBy(store.filter('provider', x => x.kind === 'partenaire'), 'name'), p.partnerId, { placeholder: 'Aucun' })}</select>`)}
      ${field('Campagne', html`<select name="campaignId">${options(sortBy(store.all('campaign'), 'label'), p.campaignId, { placeholder: 'Aucune' })}</select>`)}
      ${field('Type de prélèvement', html`<select name="samplingTypeId">${options(store.all('samplingType'), p.samplingTypeId)}</select>`)}
      ${field('Matrice', html`<select name="matrixId">${options(store.all('matrix'), p.matrixId)}</select>`)}
      ${field('Méthode', html`<select name="methodId">${options(store.all('method'), p.methodId, { label: x => `${x.reference} — ${x.label}` })}</select>`)}
      ${field('Protocole', html`<select name="protocolDocKey">${options(docOpts('PROTOCOLE'), p.protocolDocKey)}</select>`)}
      ${field('CCTP', html`<select name="cctpDocKey">${options(docOpts('CCTP'), p.cctpDocKey)}</select>`)}
      ${field('Fréquence', html`<input name="frequency" value="${p.frequency || ''}" placeholder="ex. mensuelle">`)}
      ${field('Niveau de contrôle attendu', html`<select name="controlLevel">${options(Object.entries(CONTROL_LEVELS).map(([id, label]) => ({ id, label })), p.controlLevel, { placeholder: null })}</select>`)}
      ${field('Équipe', html`<input name="team" value="${p.team || ''}">`)}
      ${field('Remarques', html`<input name="notes" value="${p.notes || ''}">`)}
      <div style="grid-column:1/-1">${field('Opérateurs programmés', html`<div class="checks">${sortBy(store.filter('operator', o => o.active !== false), 'providerId', 'code').map(o => html`<label class="check"><input type="checkbox" name="operatorIds" data-multi value="${o.id}" ${(p.operatorIds || []).includes(o.id) ? 'checked' : ''}> ${operatorName(o)} <span class="tiny muted">${store.get('provider', o.providerId)?.code || ''}</span></label>`)}</div>`)}</div>
    </form>`,
    actions: [{ label: 'Annuler', act: '__close' }, { label: 'Enregistrer', act: 'save', cls: 'primary' }],
    handlers: {
      async save() {
        const form = this.root.querySelector('#prestForm');
        if (!form.reportValidity()) return;
        const v = formValues(form);
        const pts = store.filter('point', x => x.siteId === v.siteId);
        const pointId = pts.some(x => x.id === v.pointId) ? v.pointId : pts[0]?.id;
        const next = { ...p, ...v, pointIds: pointId ? [pointId] : [], dateIndicative: false };
        delete next.pointId;
        if (isNew) next.statusHistory = [{ at: nowISO(), by: session.user.name, event: 'création', label: 'Prestation créée manuellement' }];
        await store.put('prestation', next, { reason: isNew ? 'Saisie manuelle' : 'Modification de la prestation' });
        toast('Prestation enregistrée', 'ok');
        this.close(next);
      }
    }
  });
  return m.result;
}
