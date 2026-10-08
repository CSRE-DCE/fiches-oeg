/* Audit terrain : Section → Critère → Réponse → Preuve → Validation.
 * Enregistrement automatique de chaque saisie sur l'appareil (« continuer plus tard » hors connexion),
 * alertes intelligentes (jamais converties automatiquement en non-conformité), écarts, synthèse,
 * signatures, verrouillage scellé, puis modifications uniquement motivées et historisées. */
import { html, raw, fmtDate, fmtTime, fmtDateTime, localDate, localTime, localDateTime, nowISO, sortBy } from '../core/util.js';
import { store } from '../core/store.js';
import { session } from '../core/session.js';
import { can, canEditAudit } from '../core/auth.js';
import { mediaFor } from '../core/media.js';
import { navigate } from '../ui/router.js';
import { toast, promptDialog, confirmDialog, openModal, downloadBlob, choiceDialog } from '../ui/dom.js';
import { kv, badge, thumbs, hydrateMedia, evidenceButtons, voiceBtn, progressBar, auditBadge, critBadge, deviationBadge, alertLevelBadge, empty, operatorName, siteName, providerName, kindBadge } from '../ui/components.js';
import { addFilesFromInput, viewMedia } from '../ui/capture.js';
import { RESPONSES, DOMAINS, DOC_TYPES, responseText } from '../domain/model.js';
import { allowedResponses, isAnswered, isAnswerable, needsJustification } from '../domain/grids.js';
import { auditState, setResponse, updateAudit, finishAudit, reopenAudit, signAudit, lockAudit, verifyAuditSeal, abandonAudit, auditDeviations } from '../app/audits.js';
import { refLabel, refArticle } from '../app/documents.js';
import { operatorsModule, operatorHandlers, equipmentModule, equipmentHandlers, gpsModule, gpsHandlers, samplesModule, sampleHandlers, openDeviationForm, deviationChips } from './audit-modules.js';

const amendState = new Map();   // « utilisateur:audit » → motif de la modification en cours (audit signé)
const amendKey = id => `${session.user?.id}:${session.unlockedAt}:${id}`;
const STEP_FIXED = { identification: '🪪 Identification', ecarts: '⚠️ Écarts', synthese: '📊 Synthèse', signatures: '✍️ Signatures' };

function stepsOf(st) {
  return ['identification', ...st.structure.filter(s => s.visible).map(s => s.id), 'ecarts', 'synthese', 'signatures'];
}
function itemOptions(item) {
  if (item.optionsFrom === 'method') return store.all('method').map(m => `${m.reference} — ${m.label}`);
  return item.options || [];
}

/* ---------- Critère ---------- */
function itemCard(audit, item, st, editable) {
  const r = audit.responses?.[item.id];
  const n = st.counts[item.id] || 0;
  const answered = isAnswered(item, n ? { ...(r || {}), mediaCount: n } : r);
  const isNC = r?.status === 'NC';
  const missing = !answered && item.required;
  const alerts = st.alerts.filter(a => a.itemId === item.id);
  const media = mediaFor({ type: 'item', id: audit.id, itemId: item.id });
  const dis = editable ? '' : raw('disabled');
  const v = r?.value;
  let control = '';
  const statusBtns = codes => html`<div class="seg">${codes.map(c => html`<button type="button" ${dis} class="${r?.status === c ? 'sel ' + RESPONSES[c].cls : ''}" data-act="resp" data-item="${item.id}" data-value="${c}" aria-pressed="${r?.status === c}"><span class="k">${RESPONSES[c].icon}</span>${RESPONSES[c].label}</button>`)}</div>`;
  const naBtn = item.allowNA ? html`<button type="button" ${dis} class="btn sm ${r?.status === 'NA' ? 'primary' : 'ghost'}" data-act="resp" data-item="${item.id}" data-value="NA">Non applicable</button>` : '';
  switch (item.kind) {
    case 'conformity': control = statusBtns(allowedResponses(item)); break;
    case 'boolean': control = html`<div class="seg">${[['true', 'Oui', 'brand'], ['false', 'Non', 'brand']].map(([val, l, cls]) => html`<button type="button" ${dis} class="${String(v) === val ? 'sel ' + cls : ''}" data-act="val-btn" data-item="${item.id}" data-value="${val}">${l}</button>`)}${item.allowNA ? html`<button type="button" ${dis} class="${r?.status === 'NA' ? 'sel na' : ''}" data-act="resp" data-item="${item.id}" data-value="NA">NA</button>` : ''}</div>`; break;
    case 'select': {
      const opts = itemOptions(item);
      control = opts.length <= 8 ? html`<div class="opt-list">${opts.map(o => html`<button type="button" ${dis} class="${v === o ? 'sel' : ''}" data-act="val-btn" data-item="${item.id}" data-value="${o}">${o}</button>`)}</div>${naBtn}`
        : html`<select ${dis} data-change="val" data-item="${item.id}"><option value="">— choisir —</option>${opts.map(o => html`<option ${v === o ? raw('selected') : ''}>${o}</option>`)}</select>${naBtn}`;
      break;
    }
    case 'multiselect': control = html`<div class="opt-list">${itemOptions(item).map(o => html`<button type="button" ${dis} class="${(v || []).includes(o) ? 'sel' : ''}" data-act="multi" data-item="${item.id}" data-value="${o}">${(v || []).includes(o) ? '✓ ' : ''}${o}</button>`)}</div>`; break;
    case 'number': control = html`<div class="input-wrap"><input ${dis} type="text" inputmode="decimal" value="${v ?? ''}" data-change="val" data-item="${item.id}" data-num placeholder="valeur" style="max-width:220px">${item.unit ? html`<span class="unit">${item.unit}</span>` : ''}${naBtn}</div>`; break;
    case 'text': control = html`<div class="input-wrap"><input ${dis} id="in-${item.id}" value="${v ?? ''}" data-change="val" data-item="${item.id}">${editable ? voiceBtn('in-' + item.id) : ''}${editable && item.scan !== false ? html`<button type="button" class="icon-btn" data-act="scan-val" data-item="${item.id}" title="Scanner">▦</button>` : ''}</div>`; break;
    case 'longtext': control = html`<div class="input-wrap"><textarea ${dis} id="in-${item.id}" data-change="val" data-item="${item.id}">${v ?? ''}</textarea>${editable ? voiceBtn('in-' + item.id) : ''}</div>`; break;
    case 'date': control = html`<div class="input-wrap"><input ${dis} type="date" value="${v ?? ''}" data-change="val" data-item="${item.id}">${editable ? html`<button type="button" class="btn ghost sm" data-act="now" data-item="${item.id}" data-kind="date">Aujourd’hui</button>` : ''}</div>`; break;
    case 'time': control = html`<div class="input-wrap"><input ${dis} type="time" value="${v ?? ''}" data-change="val" data-item="${item.id}">${editable ? html`<button type="button" class="btn ghost sm" data-act="now" data-item="${item.id}" data-kind="time">Maintenant</button>` : ''}</div>`; break;
    case 'datetime': control = html`<div class="input-wrap"><input ${dis} type="datetime-local" value="${v ?? ''}" data-change="val" data-item="${item.id}">${editable ? html`<button type="button" class="btn ghost sm" data-act="now" data-item="${item.id}" data-kind="datetime">Maintenant</button>` : ''}</div>`; break;
    case 'photo': control = html`<p class="note">Photographie requise${n ? ` — ${n} jointe(s) ✓` : ''}.</p>`; break;
    default: control = '';
  }
  const needJ = needsJustification(item, r);
  return html`<article class="item ${answered ? 'answered' : ''} ${isNC ? 'is-nc' : ''} ${missing && audit.status !== 'en_cours' ? 'missing' : ''}" id="item-${item.id}">
    <div class="item-head">${item.code ? html`<span class="item-code">${item.code}</span>` : ''}<div class="item-label">${item.label}${item.required && isAnswerable(item) ? html` <span class="req" title="obligatoire">*</span>` : ''}</div></div>
    ${item.refs?.length ? html`<div class="item-refs">${item.refs.map((rf, i) => html`<button type="button" class="ref-chip" data-act="ref" data-item="${item.id}" data-i="${i}">📄 ${refLabel(rf, audit.documentsSnapshot)}</button>`)}</div>` : ''}
    ${item.help ? html`<div class="item-help">${item.help}</div>` : ''}
    ${control}
    ${alerts.map(a => alertBox(a, editable))}
    ${isAnswerable(item) ? html`<div class="comment"><label class="label" for="cm-${item.id}">${needJ ? html`Justification obligatoire <span class="req">*</span>` : 'Observation (facultatif)'}</label>
      <div class="input-wrap"><textarea ${dis} id="cm-${item.id}" data-change="comment" data-item="${item.id}" rows="2" style="min-height:56px" placeholder="${needJ ? 'Décrire factuellement l’écart constaté' : 'Constat, précision…'}">${r?.comment || ''}</textarea>${editable ? voiceBtn('cm-' + item.id) : ''}</div></div>` : ''}
    ${thumbs(media)}
    <div class="item-tools">
      ${editable && !audit.lock?.lockedAt ? evidenceButtons({ type: 'item', id: audit.id, itemId: item.id }, { auditId: audit.id }) : ''}
      ${editable && (isNC || r?.status === 'NV' || r?.status === 'NO') && can('deviation.manage') ? html`<button class="btn danger-ghost sm" data-act="dev-new" data-item="${item.id}">⚠ Créer un écart</button>` : ''}
    </div>
    ${deviationChips(audit, item.id)}
    ${r?.at ? html`<div class="item-meta">Saisi le ${fmtDate(r.at)} à ${fmtTime(r.at)} par ${r.byName || ''}${n ? ` · ${n} preuve(s)` : ''}</div>` : ''}
  </article>`;
}

function alertBox(a, editable) {
  const icon = a.level === 'critique' ? '⛔' : a.level === 'attention' ? '⚠️' : 'ℹ️';
  return html`<div class="alert ${a.level}" role="alert"><span class="ic">${icon}</span><div class="grow"><div class="a-title">${a.title} ${alertLevelBadge(a.level)}</div><div class="a-msg">${a.message}</div>
    ${a.deviation && editable && can('deviation.manage') ? html`<div class="row" style="gap:8px"><button class="btn sm danger-ghost" data-act="alert-dev" data-key="${a.key}">Créer un écart</button><button class="btn sm ghost" data-act="alert-dismiss" data-key="${a.key}">Ne pas retenir (motif)</button></div>` : ''}
    ${a.deviation ? html`<div class="tiny" style="margin-top:4px;opacity:.85">Alerte d’aide à la décision : aucune non-conformité n’est créée automatiquement.</div>` : ''}</div></div>`;
}

/* ---------- Étapes fixes ---------- */
function identificationStep(audit, st, editable) {
  const prov = store.get('provider', audit.providerId);
  const p = st.prestation;
  return html`
    <div class="card"><h2>Identification de l’audit</h2>${kv([
      ['Numéro d’audit', html`<b class="mono">${audit.number}</b>`], ['Type', audit.kind === 'inopine' ? 'Audit inopiné' : 'Audit planifié'],
      ['Date', fmtDate(audit.startedAt)], ['Heure de début', fmtTime(audit.startedAt)], ['Heure de fin', audit.endedAt ? fmtTime(audit.endedAt) : 'en cours'],
      ['Auditeur', audit.auditorName], ['Appareil utilisé', audit.device?.name], ['Version de l’application', audit.appVersion],
      ['Grille', `${audit.gridSnapshot?.name} — v${audit.gridVersion}`], ['Version du protocole', audit.protocolVersion || 'non renseignée'], ['Version du CCTP', audit.cctpVersion || 'non renseignée'],
      ['Prestataire', prov ? html`${prov.name} ${kindBadge(prov.kind)}` : '—'], ['Opérateur(s) contrôlé(s)', st.operators.map(o => operatorName(o)).join(', ') || 'à identifier'],
      ['Site', siteName(audit.siteId)], ['Point', store.get('point', audit.pointId)?.code], ['Prestation', p ? html`<a href="#/prestation/${p.id}">${p.ref} — ${fmtDate(p.plannedDate)}</a>` : 'non programmée']
    ])}</div>
    <div class="card"><h2>Documents applicables figés dans l’audit</h2>
      ${audit.documentsSnapshot?.length ? html`<div class="list">${audit.documentsSnapshot.map((d, i) => html`<button class="li" data-act="doc-snap" data-i="${i}"><div class="li-main"><div class="li-title">${DOC_TYPES[d.type] || d.type} — ${d.reference}</div><div class="li-sub">${d.name}</div><div class="row" style="gap:6px;margin-top:4px"><span class="version-pill">v${d.version}</span><span class="tiny mono muted">SHA-256 ${d.sha256.slice(0, 16)}…</span></div></div><span class="chev">›</span></button>`)}</div>`
        : html`<p class="note">Aucun document applicable n’était rattaché à la prestation lors de la création de l’audit.</p>`}
      <p class="note">Versions et contenus figés à la création de l’audit : une révision ultérieure d’un document n’affecte pas cet audit.</p></div>
    ${st.alerts.length ? html`<div class="card"><h2>Alertes en cours (${st.alerts.length})</h2>${st.alerts.map(a => alertBox(a, editable))}</div>` : ''}
    ${editable && !audit.lock?.lockedAt ? html`<div class="card"><h2>Actions</h2><div class="btn-row">
      <button class="btn ghost" data-act="later">⏸ Continuer plus tard</button>
      ${audit.auditorId === session.user.id || can('audit.delete') ? html`<button class="btn danger-ghost" data-act="abandon">Abandonner l’audit</button>` : ''}</div>
      <p class="note">Chaque saisie est enregistrée immédiatement sur l’appareil, même sans connexion. L’audit peut être repris à tout moment depuis le planning.</p></div>` : ''}`;
}

function deviationsStep(audit, st, editable) {
  const devs = st.deviations;
  return html`<div class="card"><h2>Écarts de l’audit (${devs.length})</h2>
    ${devs.length ? html`<div class="list">${devs.map(d => html`<a class="li ${d.status === 'clos' ? 'stripe-ok' : 'stripe-nc'}" href="#/ecart/${d.id}"><div class="li-main"><div class="li-title">${d.number}${d.itemCode ? ' · ' + d.itemCode : ''}</div><div class="li-sub">${d.requirement}</div><div class="li-sub">${d.description}</div><div class="row" style="gap:6px;margin-top:4px">${critBadge(d.criticalityCode)}${deviationBadge(d.status)}${d.dueDate ? badge('Délai ' + fmtDate(d.dueDate), 'outline') : ''}</div></div><span class="chev">›</span></a>`)}</div>`
      : empty('✅', 'Aucun écart enregistré pour cet audit.')}
    ${editable && can('deviation.manage') ? html`<button class="btn danger lg block" style="margin-top:12px" data-act="dev-new">⚠ Enregistrer un écart</button>` : ''}
  </div>
  ${st.alerts.filter(a => a.deviation).length ? html`<div class="card"><h2>Alertes pouvant justifier un écart</h2>${st.alerts.filter(a => a.deviation).map(a => alertBox(a, editable))}</div>` : ''}`;
}

function synthesisStep(audit, st, editable) {
  const s = st.summary, c = s.counts;
  const tiles = [['Critères contrôlés', c.controlled, ''], ['Conformes', c.C, 'ok'], ['Non conformes', c.NC, 'nc'], ['Non applicables', c.NA, 'na'], ['Non observés', c.NO, 'no'], ['Non vérifiables', c.NV, 'nv'], ['Écarts', s.deviationsCount, 'nc'], ['Échantillons', s.samples, ''], ['Équipements', s.equipment, '']];
  const max = Math.max(1, ...s.byCriticality.map(x => x.count));
  const dis = editable ? '' : raw('disabled');
  return html`<div class="card"><h2>Synthèse factuelle <span class="badge outline">sans score global</span></h2>
      <div class="kpis">${tiles.map(([k, v, cls]) => html`<div class="kpi"><span class="k">${k}</span><span class="v" style="${cls ? `color:var(--${cls})` : ''}">${v}</span></div>`)}</div>
      <h3>Écarts par niveau de criticité</h3>
      <div class="bars">${s.byCriticality.map(b => html`<div class="bar-row"><span class="bl">${b.label}</span><span class="bt"><span style="width:${b.count / max * 100}%;background:${b.color || 'var(--sky)'}"></span></span><span class="bn">${b.count}</span></div>`)}</div>
      ${s.frequentRequirements.length ? html`<h3>Exigences les plus fréquemment non conformes</h3><ul>${s.frequentRequirements.map(f => html`<li>${f.requirement} — <b>${f.count}</b></li>`)}</ul>` : ''}
      <h3>Points forts (constatés)</h3>${s.strengths.length ? html`<ul>${s.strengths.map(x => html`<li>${x}</li>`)}</ul>` : html`<p class="note">Aucune section entièrement conforme.</p>`}
      <h3>Points de vigilance</h3>${s.vigilance.length ? html`<ul>${s.vigilance.map(x => html`<li>${x}</li>`)}</ul>` : html`<p class="note">Aucun point de vigilance.</p>`}
      <h3>Actions demandées</h3>${s.actions.length ? html`<ul>${s.actions.map(a => html`<li><b>${a.number}</b> (${a.criticality}) : ${a.action || a.immediate}${a.responsible ? ' — ' + a.responsible : ''}${a.dueDate ? ' — avant le ' + fmtDate(a.dueDate) : ''}</li>`)}</ul>` : html`<p class="note">Aucune action demandée.</p>`}
    </div>
    <div class="card"><h2>Conclusions de l’auditeur</h2>
      <div class="field"><label>Points forts complémentaires</label><div class="input-wrap"><textarea ${dis} id="cc-strengths" data-change="concl" data-k="strengths">${audit.conclusions?.strengths || ''}</textarea>${editable ? voiceBtn('cc-strengths') : ''}</div></div>
      <div class="field"><label>Points de vigilance complémentaires</label><div class="input-wrap"><textarea ${dis} id="cc-vigilance" data-change="concl" data-k="vigilance">${audit.conclusions?.vigilance || ''}</textarea>${editable ? voiceBtn('cc-vigilance') : ''}</div></div>
      <div class="field"><label>Commentaire général</label><div class="input-wrap"><textarea ${dis} id="cc-comment" data-change="concl" data-k="comment">${audit.conclusions?.comment || ''}</textarea>${editable ? voiceBtn('cc-comment') : ''}</div></div>
    </div>`;
}

function signaturesStep(audit, st, editable, seal) {
  const errors = st.validation.filter(v => v.level === 'error'), warnings = st.validation.filter(v => v.level === 'warning');
  const sig = audit.signatures || {};
  const locked = !!audit.lock?.lockedAt;
  const sigBlock = (role, label) => {
    const sg = sig[role];
    if (!sg) return html`<p class="note">Non signé.</p>`;
    return html`<div class="banner ${sg.refused ? 'warn' : 'ok'}">${sg.refused ? html`Refus / absence de signature consigné le ${fmtDateTime(sg.at)} — ${sg.name || ''}. Motif : ${sg.comment || '—'}` : html`Signé par <b>${sg.name}</b>${sg.function ? ' (' + sg.function + ')' : ''} le ${fmtDate(sg.at)} à ${fmtTime(sg.at)}${sg.offline ? ' — hors connexion' : ''}`}</div>
      ${sg.mediaId ? thumbs([store.get('media', sg.mediaId)].filter(Boolean)) : ''}<div class="tiny muted mono">Empreinte signée : ${sg.contentHash}</div>`;
  };
  return html`
    ${locked ? html`<div class="card" style="border-color:var(--ok)"><h2>🔒 Audit signé et verrouillé</h2>
      ${kv([['Verrouillé le', fmtDateTime(audit.lock.lockedAt)], ['Par', audit.lock.lockedByName], ['Empreinte scellée (SHA-256)', html`<span class="mono tiny">${audit.lock.contentHash}</span>`], ['Modifications après signature', String((audit.amendments || []).length)], ['Contrôle d’intégrité', seal ? html`<span class="${seal.ok ? 'diff-up' : 'diff-down'}">${seal.message}</span>` : '']])}
      <div class="btn-row" style="margin-top:10px"><button class="btn ghost" data-act="verify">🔎 Vérifier l’intégrité</button></div></div>` : ''}
    <div class="card"><h2>Contrôle avant clôture</h2>
      ${errors.length ? html`<div class="banner nc">${errors.length} point(s) bloquant(s) à compléter avant signature :</div><div class="list">${errors.map(e => html`<a class="li stripe-nc" href="#/audit/${audit.id}/${e.sectionId}" data-scroll="${e.itemId}"><div class="li-main"><div class="li-sub">${e.message}</div></div><span class="chev">›</span></a>`)}</div>` : html`<div class="banner ok">Aucun point bloquant : toutes les réponses obligatoires et justifications sont renseignées.</div>`}
      ${warnings.length ? html`<details style="margin-top:8px"><summary>${warnings.length} avertissement(s) — décision de l’auditeur</summary><ul>${warnings.map(w => html`<li><a href="#/audit/${audit.id}/${w.sectionId}">${w.message}</a></li>`)}</ul></details>` : ''}
      ${st.alerts.filter(a => a.level !== 'info').length ? html`<p class="note">${st.alerts.filter(a => a.level !== 'info').length} alerte(s) active(s) — voir Identification ou les sections concernées.</p>` : ''}
      ${editable && !locked ? html`<div class="btn-row" style="margin-top:10px">${audit.status === 'en_cours' ? html`<button class="btn primary" data-act="finish" ${errors.length ? raw('disabled') : ''}>⏹ Terminer l’audit (heure de fin)</button>` : html`<span class="badge warn">Terminé à ${fmtTime(audit.endedAt)}</span><button class="btn ghost sm" data-act="reopen">Rouvrir</button>`}</div>` : ''}
    </div>
    <div class="card"><h2>Signature de l’auditeur</h2>${sigBlock('auditor')}
      ${editable && !locked && audit.status === 'termine' ? html`<button class="btn primary lg block" data-act="sign-auditor" style="margin-top:8px">✍️ Signer en tant qu’auditeur (${session.user.name})</button>` : ''}</div>
    <div class="card"><h2>Signature du représentant du prestataire</h2>${sigBlock('provider')}
      ${editable && !locked && audit.status === 'termine' && sig.auditor ? html`<div class="grid2" style="margin-top:8px"><div class="field"><label>Nom du représentant</label><input id="repName" value="${sig.provider?.name || operatorName(st.operators[0]) || ''}"></div><div class="field"><label>Fonction</label><input id="repFn" value="${sig.provider?.function || st.operators[0]?.function || ''}"></div></div>
        <div class="btn-row"><button class="btn primary lg" data-act="sign-provider">✍️ Faire signer le représentant</button><button class="btn ghost" data-act="refuse-provider">Refus / absence de signature</button></div>` : ''}
      ${!sig.auditor && !locked ? html`<p class="note">L’auditeur signe en premier.</p>` : ''}</div>
    ${editable && !locked && sig.auditor && sig.provider ? html`<div class="card" style="border-color:var(--brand)"><h2>Validation finale</h2><p>Le verrouillage scelle le contenu de l’audit (empreinte SHA-256). Toute modification ultérieure exigera un motif, sera réservée au responsable qualité et sera historisée avec la valeur précédente.</p><button class="btn ok lg block" data-act="lock">🔒 Valider et verrouiller l’audit</button></div>` : ''}
    <div class="card"><h2>Rapport et dossier de preuve</h2>
      <div class="btn-row"><button class="btn ${locked ? 'primary' : 'ghost'}" data-act="report">📄 ${locked ? 'Rapport d’audit PDF' : 'Rapport provisoire PDF'}</button><button class="btn ghost" data-act="dossier">🗂 Dossier de preuve (JSON + médias)</button></div>
      ${(audit.reports || []).length ? html`<details style="margin-top:8px"><summary>${audit.reports.length} rapport(s) généré(s)</summary><ul>${audit.reports.map(r => html`<li>${fmtDateTime(r.at)} — ${r.by} — ${r.provisional ? 'provisoire' : 'définitif'} — ${r.pages} p. — <span class="mono tiny">${r.sha256.slice(0, 24)}…</span></li>`)}</ul></details>` : ''}
    </div>`;
}

/* ---------- Vue ---------- */
export default {
  nav: 'audits', title: 'Audit',
  async render({ id, step }, q, ctx) {
    const audit = store.get('audit', id);
    if (!audit) return html`<div class="card">${empty('❓', 'Audit introuvable sur cet appareil.')}<a class="btn ghost" href="#/audits">Liste des audits</a></div>`;
    const st = auditState(audit, { includeMissing: step === 'signatures' });
    const steps = stepsOf(st);
    const cur = steps.includes(step) ? step : (audit.status === 'en_cours' ? (st.structure.find(s => s.visible && st.progress.bySection[s.id]?.answered < st.progress.bySection[s.id]?.total)?.id || 'identification') : 'signatures');
    const idx = steps.indexOf(cur);
    const locked = !!audit.lock?.lockedAt;
    const amendReason = amendState.get(amendKey(audit.id)) || null;
    ctx.amendReason = amendReason;
    const editable = locked ? (!!amendReason && can('audit.amend')) : (canEditAudit(audit) && audit.status !== 'abandonne');
    const sec = st.structure.find(s => s.id === cur);
    const bs = sec ? st.progress.bySection[sec.id] : null;
    // Indicateur Section → Critère → Réponse → Preuve → Validation
    const ncNoEvidence = sec ? sec.visibleItems.some(it => audit.responses?.[it.id]?.status === 'NC' && (!(audit.responses[it.id].comment || '').trim() || !(st.counts[it.id] > 0))) : false;
    const stepState = [
      ['Section', 'cur'],
      ['Critère', bs ? (bs.missingRequired === 0 ? 'done' : 'cur') : 'done'],
      ['Réponse', bs ? (bs.answered === bs.total ? 'done' : '') : (st.progress.answered === st.progress.total ? 'done' : '')],
      ['Preuve', sec ? (ncNoEvidence ? '' : 'done') : ''],
      ['Validation', locked ? 'done' : cur === 'signatures' ? 'cur' : '']
    ];
    const chipLabel = s => STEP_FIXED[s] || st.structure.find(x => x.id === s)?.title || s;
    const seal = locked && cur === 'signatures' ? await verifyAuditSeal(audit) : null;
    let body;
    if (cur === 'identification') body = identificationStep(audit, st, editable);
    else if (cur === 'ecarts') body = deviationsStep(audit, st, editable);
    else if (cur === 'synthese') body = synthesisStep(audit, st, editable);
    else if (cur === 'signatures') body = signaturesStep(audit, st, editable, seal);
    else {
      const secAlerts = st.alerts.filter(a => a.sectionId === sec.id && !a.itemId);
      body = html`<div class="card" style="padding:12px 14px"><div class="row between"><h2 style="margin:0;border:0;padding:0">${sec.title}</h2><span class="domain-tag ${sec.domain || 'prelevement'}">${DOMAINS[sec.domain || 'prelevement']}</span></div>
          ${sec.help ? html`<p class="note" style="margin:8px 0 0">${sec.help}</p>` : ''}
          ${sec.domain === 'transport' ? html`<div class="banner scope" style="margin:10px 0 0">Contrôle de la partie pré-analytique liée au prélèvement. Les analyses de laboratoire sont hors périmètre de l’audit.</div>` : ''}</div>
        ${secAlerts.map(a => alertBox(a, editable))}
        ${sec.module === 'operators' ? operatorsModule(audit, editable) : sec.module === 'equipment' ? equipmentModule(audit, editable) : sec.module === 'gps' ? gpsModule(audit, editable) : sec.module === 'samples' ? samplesModule(audit, editable) : ''}
        ${sec.visibleItems.map(it => itemCard(audit, it, st, editable))}
        ${sec.items.length > sec.visibleItems.length ? html`<p class="note">${sec.items.length - sec.visibleItems.length} critère(s) masqué(s) car sans objet compte tenu des réponses (logique conditionnelle).</p>` : ''}`;
    }
    return html`
      <div class="audit-head">
        <div class="ah-row"><div style="min-width:0"><div class="ah-num">${audit.number} ${auditBadge(audit)}</div><div class="ah-meta">${siteName(audit.siteId)} · ${providerName(audit.providerId)}</div></div>
          <div style="text-align:right"><div class="strong">${st.progress.percent} %</div><div class="save-state" id="saveState">${editable ? `Enregistré sur l’appareil ✓ ${fmtTime(audit.updatedAt)}` : locked ? 'Lecture seule' : ''}</div></div></div>
        ${progressBar(st.progress.percent)}
        <div class="steps" style="margin-top:6px">${stepState.map(([l, s], i) => html`${i ? html`<span class="arr">→</span>` : ''}<span class="st ${s}">${l}</span>`)}</div>
        <nav class="sec-chips" aria-label="Sections de l’audit">${steps.map(s => { const p = st.progress.bySection[s]; const done = p && p.total && p.answered === p.total; return html`<a class="sec-chip ${s === cur ? 'sel' : ''} ${done ? 'done' : ''} ${p?.nc ? 'hasnc' : ''}" href="#/audit/${audit.id}/${s}" ${s === cur ? raw('aria-current="step"') : ''}><span class="t">${chipLabel(s)}</span>${p ? html`<span class="c">${p.answered}/${p.total}</span>` : s === 'ecarts' && st.deviations.length ? html`<span class="c">${st.deviations.length}</span>` : ''}</a>`; })}</nav>
      </div>
      ${locked ? html`<div class="banner ${amendReason ? 'warn' : 'ok'} locked-banner"><span class="grow">${amendReason ? html`✏️ Modification tracée en cours — motif : « ${amendReason} ». Chaque changement est historisé (valeur précédente conservée).` : '🔒 Audit signé et verrouillé : lecture seule.'}</span>
        ${can('audit.amend') ? (amendReason ? html`<button class="btn sm ghost" data-act="amend-stop">Terminer les modifications</button>` : html`<button class="btn sm ghost" data-act="amend-start">Modifier (avec motif)</button>`) : ''}</div>` : ''}
      ${!editable && !locked && audit.status !== 'abandonne' ? html`<div class="banner info">Lecture seule : audit réalisé par ${audit.auditorName}.</div>` : ''}
      ${audit.status === 'abandonne' ? html`<div class="banner na">Audit abandonné — ${audit.abandonReason || ''}</div>` : ''}
      ${body}
      <div class="audit-footer">
        ${idx > 0 ? html`<a class="btn ghost lg" href="#/audit/${audit.id}/${steps[idx - 1]}">◀ Précédent</a>` : html`<a class="btn ghost lg" href="#/">◀ Planning</a>`}
        ${idx < steps.length - 1 ? html`<a class="btn primary lg" href="#/audit/${audit.id}/${steps[idx + 1]}">Suivant ▶</a>` : ''}
      </div>`;
  },
  async mount(root, params, q) {
    await hydrateMedia(root);
    if (q.item) document.getElementById('item-' + q.item)?.scrollIntoView({ block: 'center' });
  },
  handlers: {
    ...operatorHandlers, ...equipmentHandlers, ...gpsHandlers, ...sampleHandlers,
    async resp(el) {
      const audit = store.get('audit', this.params.id);
      const cur = audit.responses?.[el.dataset.item];
      const value = el.dataset.value;
      // Un nouvel appui sur la réponse déjà choisie l'annule (correction d'une erreur de saisie, tracée).
      await setResponse(audit, el.dataset.item, cur?.status === value ? { status: undefined } : { status: value }, { reason: this.amendReason });
      navigator.vibrate?.(20);
      this.refresh();
    },
    async 'val-btn'(el) {
      const audit = store.get('audit', this.params.id);
      const raw = el.dataset.value, value = raw === 'true' ? true : raw === 'false' ? false : raw;
      const cur = audit.responses?.[el.dataset.item];
      await setResponse(audit, el.dataset.item, cur?.value === value ? { value: undefined } : { value, status: cur?.status === 'NA' ? undefined : cur?.status }, { reason: this.amendReason });
      this.refresh();
    },
    async multi(el) {
      const audit = store.get('audit', this.params.id);
      const cur = audit.responses?.[el.dataset.item]?.value || [];
      const v = el.dataset.value;
      await setResponse(audit, el.dataset.item, { value: cur.includes(v) ? cur.filter(x => x !== v) : [...cur, v] }, { reason: this.amendReason });
      this.refresh();
    },
    async val(el) {
      const audit = store.get('audit', this.params.id);
      let v = el.value;
      if (el.dataset.num !== undefined && v !== '') { const n = Number(v.replace(',', '.')); if (!isFinite(n)) { toast('Valeur numérique invalide', 'err'); return; } v = n; }
      await setResponse(audit, el.dataset.item, { value: v === '' ? undefined : v, status: audit.responses?.[el.dataset.item]?.status === 'NA' ? undefined : audit.responses?.[el.dataset.item]?.status }, { reason: this.amendReason });
      this.refresh();
    },
    async now(el) {
      const audit = store.get('audit', this.params.id);
      const v = el.dataset.kind === 'date' ? localDate() : el.dataset.kind === 'time' ? localTime() : localDateTime();
      await setResponse(audit, el.dataset.item, { value: v }, { reason: this.amendReason });
      this.refresh();
    },
    async comment(el) {
      const audit = store.get('audit', this.params.id);
      await setResponse(audit, el.dataset.item, { comment: el.value.trim() || undefined }, { reason: this.amendReason });
      const s = document.getElementById('saveState'); if (s) s.textContent = `Enregistré sur l’appareil ✓ ${localTime()}`;
    },
    async concl(el) {
      const audit = store.get('audit', this.params.id);
      await updateAudit(audit, a => { a.conclusions = { ...(a.conclusions || {}), [el.dataset.k]: el.value }; }, { reason: this.amendReason });
      const s = document.getElementById('saveState'); if (s) s.textContent = `Enregistré sur l’appareil ✓ ${localTime()}`;
    },
    async voice(el) { (await import('../ui/voice.js')).dictate(document.getElementById(el.dataset.target)); },
    async 'scan-val'(el) {
      const { scanCode } = await import('../ui/scanner.js');
      const v = await scanCode(); if (!v) return;
      await setResponse(store.get('audit', this.params.id), el.dataset.item, { value: v }, { reason: this.amendReason });
      this.refresh();
    },
    async 'media-add'(el) {
      await addFilesFromInput(el, { auditId: this.params.id });
      this.refresh();
    },
    async 'media-view'(el) { await viewMedia(el.dataset.id, { readOnly: !!store.get('audit', this.params.id)?.lock?.lockedAt, onChange: () => this.refresh() }); },
    async ref(el) {
      const audit = store.get('audit', this.params.id);
      const item = audit.gridSnapshot.sections.flatMap(s => [s, ...(s.subsections || [])]).flatMap(s => s.items || []).find(i => i.id === el.dataset.item);
      const rf = item.refs[Number(el.dataset.i)];
      const art = refArticle(rf, audit.documentsSnapshot);
      openModal({ title: refLabel(rf, audit.documentsSnapshot), body: html`${rf.requirement ? html`<p><b>Exigence :</b> ${rf.requirement}</p>` : ''}${art ? html`<div class="doc-article"><h4>${art.number} — ${art.title}</h4><p>${art.text}</p></div><p class="note">Texte de la version figée dans l’audit.</p>` : html`<p class="note">Texte de l’article non disponible dans l’instantané documentaire.</p>`}`, actions: [{ label: 'Fermer', cls: 'primary' }] });
    },
    'doc-snap'(el) {
      const d = store.get('audit', this.params.id).documentsSnapshot[Number(el.dataset.i)];
      openModal({ title: `${d.reference} — v${d.version}`, wide: true, body: html`${kv([['Document', d.name], ['Type', DOC_TYPES[d.type]], ['Version', d.version], ['Application', `${fmtDate(d.applicableFrom)}${d.applicableTo ? ' → ' + fmtDate(d.applicableTo) : ''}`], ['Empreinte SHA-256', html`<span class="mono tiny">${d.sha256}</span>`]])}${(d.articles || []).map(a => html`<div class="doc-article"><h4>${a.number} — ${a.title}</h4><p>${a.text}</p></div>`)}${d.fileMediaId ? html`<button class="btn ghost" data-act="open-file">Ouvrir le fichier joint</button>` : ''}`, actions: [{ label: 'Fermer', cls: 'primary' }], handlers: { async 'open-file'() { await viewMedia(d.fileMediaId, { readOnly: true }); } } });
    },
    async 'dev-new'(el) {
      const audit = store.get('audit', this.params.id);
      let prefill = { source: 'manuel' };
      if (el.dataset.item) {
        const it = audit.gridSnapshot.sections.flatMap(s => [s, ...(s.subsections || [])]).flatMap(s => s.items || []).find(i => i.id === el.dataset.item);
        const r = audit.responses?.[it.id];
        prefill = { itemId: it.id, itemCode: it.code, requirement: it.refs?.[0]?.requirement || it.label, docRefs: it.refs || [], description: r?.comment || '', source: 'critere', criticalityCode: 'MIN' };
      }
      if (audit.lock?.lockedAt) prefill.reason = this.amendReason;
      const dev = await openDeviationForm(audit, prefill);
      if (dev) this.refresh();
    },
    async 'alert-dev'(el) {
      const audit = store.get('audit', this.params.id);
      const a = auditState(audit, { includeMissing: true }).alerts.find(x => x.key === el.dataset.key);
      if (!a) return;
      const dev = await openDeviationForm(audit, { ...a.deviation, docRefs: a.deviation.refs || [], itemId: a.itemId || null, itemCode: a.itemId ? a.itemId.replace(/^it-/, '') : null, source: 'alerte', alertCode: a.code, criticalityCode: a.level === 'critique' ? 'MAJ' : 'MIN' });
      if (dev) this.refresh();
    },
    async 'alert-dismiss'(el) {
      const reason = await promptDialog({ title: 'Ne pas retenir cette alerte', label: 'Motif (décision de l’auditeur)', required: true });
      if (!reason) return;
      await updateAudit(store.get('audit', this.params.id), a => { a.dismissedAlerts = [...(a.dismissedAlerts || []), { key: el.dataset.key, reason, at: nowISO(), by: session.user.name }]; }, { reason: this.amendReason || reason });
      this.refresh();
    },
    async finish() {
      await finishAudit(store.get('audit', this.params.id));
      toast('Audit terminé : heure de fin enregistrée', 'ok'); this.refresh();
    },
    async reopen() { await reopenAudit(store.get('audit', this.params.id)); this.refresh(); },
    async 'sign-auditor'() {
      const { signaturePad } = await import('../ui/signature.js');
      const s = await signaturePad({ title: 'Signature de l’auditeur', signer: session.user.name, statement: 'Je certifie l’exactitude des constats consignés dans le présent audit.' });
      if (!s) return;
      await signAudit(store.get('audit', this.params.id), 'auditor', { ...s, name: session.user.name, fn: 'Auditeur' });
      toast('Signature de l’auditeur enregistrée', 'ok'); this.refresh();
    },
    async 'sign-provider'() {
      const name = document.getElementById('repName')?.value.trim(), fn = document.getElementById('repFn')?.value.trim();
      if (!name) { toast('Indiquez le nom du représentant du prestataire.', 'err'); return; }
      const { signaturePad } = await import('../ui/signature.js');
      const s = await signaturePad({ title: 'Signature du représentant du prestataire', signer: `${name}${fn ? ' — ' + fn : ''}`, statement: 'Je reconnais avoir pris connaissance des constats de l’audit.' });
      if (!s) return;
      await signAudit(store.get('audit', this.params.id), 'provider', { ...s, name, fn });
      toast('Signature du représentant enregistrée', 'ok'); this.refresh();
    },
    async 'refuse-provider'() {
      const name = document.getElementById('repName')?.value.trim();
      const reason = await promptDialog({ title: 'Refus ou absence de signature', label: 'Motif (refus, représentant absent, impossibilité…)', required: true });
      if (!reason) return;
      await signAudit(store.get('audit', this.params.id), 'provider', { name, refused: true, comment: reason });
      this.refresh();
    },
    async lock() {
      if (!(await confirmDialog({ title: 'Verrouiller l’audit', message: 'Le contenu sera scellé. Les modifications ultérieures exigeront un motif et seront historisées. Continuer ?', okLabel: 'Verrouiller' }))) return;
      try { await lockAudit(store.get('audit', this.params.id)); toast('Audit signé et verrouillé 🔒', 'ok'); }
      catch (e) { toast(e.message, 'err'); }
      this.refresh();
    },
    async verify() { const r = await verifyAuditSeal(store.get('audit', this.params.id)); toast(r.message, r.ok ? 'ok' : 'err', 6000); this.refresh(); },
    async 'amend-start'() {
      const reason = await promptDialog({ title: 'Modifier un audit signé', label: 'Motif de la modification (obligatoire)', hint: 'Le motif, l’auteur, la date et les valeurs avant/après seront conservés.' });
      if (!reason) return;
      amendState.set(amendKey(this.params.id), reason);
      await store.log('amend-start', { entityType: 'audit', entityId: this.params.id, entityLabel: store.get('audit', this.params.id).number, reason });
      this.refresh();
    },
    async 'amend-stop'() {
      amendState.delete(amendKey(this.params.id));
      await store.log('amend-stop', { entityType: 'audit', entityId: this.params.id, entityLabel: store.get('audit', this.params.id).number });
      this.refresh();
    },
    async report() {
      toast('Génération du rapport…', '', 1500);
      const { generateAuditReport } = await import('../app/report.js');
      const r = await generateAuditReport(this.params.id);
      downloadBlob(r.bytes, r.filename, 'application/pdf');
      toast(`Rapport ${r.provisional ? 'provisoire ' : ''}généré (${r.pages} pages)`, 'ok');
      this.refresh();
    },
    async dossier() {
      const { buildAuditDossier } = await import('../app/exports.js');
      const audit = store.get('audit', this.params.id);
      const pkg = await buildAuditDossier(audit.id);
      downloadBlob(JSON.stringify(pkg), `${audit.number}_dossier_preuve.json`, 'application/json');
      await store.log('export', { entityType: 'audit', entityId: audit.id, entityLabel: audit.number, details: 'Dossier de preuve JSON' });
    },
    later() { toast('Audit enregistré sur l’appareil : reprise possible depuis le planning.', 'ok'); navigate('/'); },
    async abandon() {
      const reason = await promptDialog({ title: 'Abandonner l’audit', label: 'Motif de l’abandon' });
      if (!reason) return;
      await abandonAudit(store.get('audit', this.params.id), reason);
      navigate('/audits');
    }
  }
};
