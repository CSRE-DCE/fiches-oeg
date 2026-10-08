/* Modules spécialisés de l'audit terrain : opérateurs et habilitations, équipements de mesure,
 * relevé GPS du point, traçabilité des échantillons, saisie des écarts. */
import { html, raw, uuid, nowISO, localDate, localTime, fmtDate, fmtDateTime, fmtTime, haversine, fmtDistance, sortBy, normalize } from '../core/util.js';
import { store } from '../core/store.js';
import { session } from '../core/session.js';
import { can } from '../core/auth.js';
import { mediaFor } from '../core/media.js';
import { openModal, toast, promptDialog, confirmDialog, formValues } from '../ui/dom.js';
import { field, options, badge, kv, thumbs, evidenceButtons, voiceBtn, operatorName, critBadge, deviationBadge, seg } from '../ui/components.js';
import { getPosition } from '../ui/gps.js';
import { operatorStatus, equipmentStatus } from '../domain/rules.js';
import { EQUIPMENT_STATUS, QUALIFICATION_TYPES } from '../domain/model.js';
import { updateAudit, sampleIdFor, createDeviation, defaultDueDate, auditDeviations } from '../app/audits.js';
import { refLabel } from '../app/documents.js';
import { orgSettings } from '../app/settings.js';

/** Opérateurs pris en compte dans l'audit : référentiel + opérateurs non référencés saisis sur place. */
export function auditOperators(audit) {
  return [...(audit.operatorIds || []).map(id => store.get('operator', id)).filter(Boolean), ...(audit.adHocOperators || [])];
}

/* ---------- Opérateurs ---------- */
export function operatorsModule(audit, editable) {
  const date = (audit.startedAt || '').slice(0, 10);
  const ops = auditOperators(audit);
  const candidates = sortBy(store.filter('operator', o => o.providerId === audit.providerId && o.active !== false && !(audit.operatorIds || []).includes(o.id)), 'code');
  return html`<div class="module"><h3>👷 Opérateurs contrôlés</h3>
    ${ops.length ? html`<div class="list">${ops.map(o => { const st = operatorStatus(o, date, audit.samplingTypeId); const ph = mediaFor({ type: 'operator', id: o.id }).filter(m => m.auditId === audit.id); return html`
      <div class="li ${st.ok ? 'stripe-ok' : 'stripe-nc'}"><div class="li-main"><div class="li-title">${operatorName(o)} ${o.adHoc ? badge('saisi sur place', 'warn') : ''}</div>
        <div class="li-sub">${o.function || 'Fonction non précisée'}</div>
        <div class="li-sub">${(o.qualifications || []).map(q => `${QUALIFICATION_TYPES[q.type] || q.type} : ${q.label}${q.ref ? ' (' + q.ref + ')' : ''}${q.validUntil ? ' → ' + fmtDate(q.validUntil) : ''}`).join(' ; ') || 'Aucune habilitation enregistrée'}</div>
        ${st.ok ? badge('Habilité à la date de l’audit', 'ok') : badge('Non habilité : ' + st.message, 'nc')}
        ${thumbs(ph)}
        ${editable ? html`<div class="item-tools">${evidenceButtons({ type: 'operator', id: o.id }, { auditId: audit.id, label: 'Justificatif', gallery: false })}<button class="btn ghost sm" data-act="op-remove" data-id="${o.id}">Retirer</button></div>` : ''}
      </div></div>`; })}</div>` : html`<p class="note">Aucun opérateur enregistré pour cet audit.</p>`}
    ${editable ? html`<div class="btn-row" style="margin-top:10px">
      ${candidates.length ? html`<select data-change="op-add" style="flex:1;min-width:200px"><option value="">＋ Ajouter un opérateur du prestataire…</option>${candidates.map(o => html`<option value="${o.id}">${operatorName(o)}</option>`)}</select>` : ''}
      <button class="btn ghost" data-act="op-adhoc">＋ Opérateur non référencé</button></div>` : ''}
  </div>`;
}
export const operatorHandlers = {
  async 'op-add'(el) {
    if (!el.value) return;
    const audit = store.get('audit', this.params.id);
    await updateAudit(audit, a => { a.operatorIds = [...new Set([...(a.operatorIds || []), el.value])]; }, { reason: this.amendReason });
    this.refresh();
  },
  async 'op-remove'(el) {
    const audit = store.get('audit', this.params.id);
    if (!(await confirmDialog({ title: 'Retirer l’opérateur', message: 'Retirer cet opérateur de l’audit ? (la modification est tracée)' }))) return;
    await updateAudit(audit, a => { a.operatorIds = (a.operatorIds || []).filter(x => x !== el.dataset.id); a.adHocOperators = (a.adHocOperators || []).filter(x => x.id !== el.dataset.id); }, { reason: this.amendReason });
    this.refresh();
  },
  async 'op-adhoc'() {
    const m = openModal({
      title: 'Opérateur non référencé',
      body: html`<form id="adhoc" class="grid2">
        ${field('Nom', html`<input name="lastName" required>`, { required: true })}${field('Prénom', html`<input name="firstName">`)}
        ${field('Fonction', html`<input name="function" placeholder="ex. technicien préleveur">`)}${field('Habilitation présentée', html`<input name="habilitation" placeholder="ex. prélèvement eaux de surface">`)}
        ${field('Référence', html`<input name="ref">`)}${field('Valide jusqu’au', html`<input type="date" name="validUntil">`)}
      </form><p class="note">L’opérateur est enregistré dans cet audit ; le responsable qualité pourra l’ajouter au référentiel.</p>`,
      actions: [{ label: 'Annuler' }, { label: 'Ajouter', act: 'ok', cls: 'primary' }],
      handlers: { ok() { const f = this.root.querySelector('#adhoc'); if (!f.reportValidity()) return; this.close(formValues(f)); } }
    });
    const v = await m.result; if (!v) return;
    const audit = store.get('audit', this.params.id);
    const op = { id: 'adhoc-' + uuid(), adHoc: true, providerId: audit.providerId, code: '', lastName: v.lastName, firstName: v.firstName, function: v.function, qualifications: v.habilitation ? [{ id: uuid(), type: 'habilitation', label: v.habilitation, ref: v.ref, validUntil: v.validUntil, samplingTypeIds: [] }] : [] };
    await updateAudit(audit, a => { a.adHocOperators = [...(a.adHocOperators || []), op]; }, { reason: this.amendReason });
    this.refresh();
  }
};

/* ---------- Équipements de mesure ---------- */
export function equipmentModule(audit, editable) {
  const date = (audit.startedAt || '').slice(0, 10);
  const list = audit.equipmentChecks || [];
  return html`<div class="module"><h3>🧪 Matériel de mesure contrôlé</h3>
    ${list.length ? html`<div class="list">${list.map(e => { const st = equipmentStatus(e, date); const ph = mediaFor({ type: 'equipment', id: e.id }); return html`
      <div class="li ${st.ok ? 'stripe-ok' : st.level === 'critique' ? 'stripe-nc' : 'stripe-warn'}"><div class="li-main">
        <div class="li-title">${e.label || 'Équipement'} <span class="mono tiny">${e.inventoryNo || ''}</span></div>
        <div class="li-sub">${[e.brand, e.model].filter(Boolean).join(' ')}${e.serial ? ' · n° série ' + e.serial : ''}</div>
        <div class="li-sub">Vérification : ${fmtDate(e.checkDate) || '—'} · Étalonnage : ${fmtDate(e.calibrationDate) || (e.calibrationRequired ? 'requis, non renseigné' : 'non applicable')} · Validité : ${fmtDate(e.validUntil) || '—'} · Certificat : ${e.certificateAvailable === true ? 'disponible' : e.certificateAvailable === false ? 'non disponible' : '—'}</div>
        <div class="row" style="gap:6px;margin-top:6px">${st.ok ? badge('Valide', 'ok') : badge(st.reasons.join(' ; '), st.level === 'critique' ? 'nc' : 'warn')}${e.conformity ? badge(e.conformity === 'C' ? 'Jugé conforme' : e.conformity === 'NC' ? 'Jugé non conforme' : 'NA', e.conformity === 'C' ? 'ok' : e.conformity === 'NC' ? 'nc' : 'na') : ''}</div>
        ${thumbs(ph)}
        ${editable ? html`<div class="item-tools">${evidenceButtons({ type: 'equipment', id: e.id }, { auditId: audit.id, label: 'Photo étiquette', gallery: false })}<button class="btn ghost sm" data-act="eq-edit" data-id="${e.id}">Modifier</button><button class="btn ghost sm" data-act="eq-remove" data-id="${e.id}">Retirer</button></div>` : ''}
      </div></div>`; })}</div>` : html`<p class="note">Aucun équipement de mesure enregistré.</p>`}
    ${editable ? html`<div class="btn-row" style="margin-top:10px"><button class="btn primary" data-act="eq-add"><span class="ic">＋</span>Équipement</button><button class="btn ghost" data-act="eq-scan"><span class="ic">▦</span>Scanner l’étiquette</button></div>` : ''}
  </div>`;
}
function equipmentForm(audit, e = {}) {
  const registry = sortBy(store.filter('equipment', x => (!audit.providerId || x.providerId === audit.providerId || !x.providerId) && x.status !== 'reforme'), 'label');
  const m = openModal({
    title: e.id ? 'Équipement contrôlé' : 'Ajouter un équipement contrôlé', wide: true,
    body: html`<form id="eqf">
      ${!e.id && registry.length ? field('Depuis le registre des équipements', html`<select name="registryId" data-change="eq-pick">${options(registry, '', { label: x => `${x.label} — ${x.inventoryNo}${x.serial ? ' / ' + x.serial : ''}`, placeholder: 'Équipement non enregistré (saisie)' })}</select>`) : ''}
      <div class="grid2">
        ${field('Identification / désignation', html`<input name="label" value="${e.label || ''}" required>`, { required: true })}
        ${field('N° d’inventaire', html`<div class="input-wrap"><input name="inventoryNo" value="${e.inventoryNo || ''}"><button type="button" class="icon-btn" data-act="eq-scanfield" title="Scanner">▦</button></div>`)}
        ${field('Marque', html`<input name="brand" value="${e.brand || ''}">`)}${field('Modèle', html`<input name="model" value="${e.model || ''}">`)}
        ${field('N° de série', html`<input name="serial" value="${e.serial || ''}">`)}${field('Statut', html`<select name="status">${options(Object.entries(EQUIPMENT_STATUS).map(([id, label]) => ({ id, label })), e.status || 'service', { placeholder: null })}</select>`)}
        ${field('Date de vérification', html`<input type="date" name="checkDate" value="${e.checkDate || ''}">`)}${field('Date d’étalonnage', html`<input type="date" name="calibrationDate" value="${e.calibrationDate || ''}">`)}
        ${field('Date de validité', html`<input type="date" name="validUntil" value="${e.validUntil || ''}">`)}${field('Référence du certificat', html`<input name="certificateRef" value="${e.certificateRef || ''}">`)}
      </div>
      <label class="check"><input type="checkbox" name="calibrationRequired" ${e.calibrationRequired ? 'checked' : ''}> Étalonnage requis pour cet équipement</label>
      ${field('Certificat disponible sur place', seg('eq-cert', [{ value: 'true', label: 'Oui', cls: 'ok' }, { value: 'false', label: 'Non', cls: 'nc' }, { value: '', label: 'Non vérifié', cls: 'na' }], String(e.certificateAvailable ?? '')))}
      <input type="hidden" name="certificateAvailable" value="${String(e.certificateAvailable ?? '')}">
      ${field('Conformité constatée', seg('eq-conf', [{ value: 'C', label: 'Conforme', cls: 'ok' }, { value: 'NC', label: 'Non conforme', cls: 'nc' }, { value: 'NA', label: 'Non applicable', cls: 'na' }], e.conformity || ''))}
      <input type="hidden" name="conformity" value="${e.conformity || ''}">
      ${field('Observation', html`<div class="input-wrap"><textarea name="comment" id="eqComment">${e.comment || ''}</textarea>${voiceBtn('eqComment')}</div>`)}
    </form>`,
    actions: [{ label: 'Annuler' }, { label: 'Enregistrer', act: 'ok', cls: 'primary' }],
    handlers: {
      'eq-pick'(el) { const r = store.get('equipment', el.value); if (!r) return; const f = this.root.querySelector('#eqf'); for (const k of ['label', 'inventoryNo', 'brand', 'model', 'serial', 'validUntil', 'certificateRef', 'status']) if (f.elements[k]) f.elements[k].value = r[k] || ''; f.elements.checkDate.value = r.lastCheckDate || ''; f.elements.calibrationDate.value = r.calibrationDate || ''; f.elements.calibrationRequired.checked = !!r.calibrationRequired; },
      'eq-cert'(el) { this.root.querySelector('[name=certificateAvailable]').value = el.dataset.value; el.parentElement.querySelectorAll('button').forEach(b => b.className = b === el ? 'sel ' + ({ true: 'ok', false: 'nc', '': 'na' }[el.dataset.value]) : ''); },
      'eq-conf'(el) { this.root.querySelector('[name=conformity]').value = el.dataset.value; el.parentElement.querySelectorAll('button').forEach(b => b.className = b === el ? 'sel ' + ({ C: 'ok', NC: 'nc', NA: 'na' }[el.dataset.value]) : ''); },
      async 'eq-scanfield'() { const { scanCode } = await import('../ui/scanner.js'); const v = await scanCode({ title: 'Étiquette de l’équipement' }); if (v) this.root.querySelector('[name=inventoryNo]').value = v; },
      async voice(el) { (await import('../ui/voice.js')).dictate(this.root.querySelector('#' + el.dataset.target)); },
      ok() {
        const f = this.root.querySelector('#eqf'); if (!f.reportValidity()) return;
        const v = formValues(f);
        const ca = v.certificateAvailable === 'true' ? true : v.certificateAvailable === 'false' ? false : null;
        this.close({ ...e, ...v, certificateAvailable: ca, statusLabel: EQUIPMENT_STATUS[v.status], equipmentId: v.registryId || e.equipmentId || null, id: e.id || uuid(), at: e.at || nowISO() });
      }
    }
  });
  return m.result;
}
export const equipmentHandlers = {
  async 'eq-add'() {
    const audit = store.get('audit', this.params.id);
    const e = await equipmentForm(audit); if (!e) return;
    delete e.registryId;
    await updateAudit(audit, a => { a.equipmentChecks = [...(a.equipmentChecks || []), e]; }, { reason: this.amendReason });
    this.refresh();
  },
  async 'eq-edit'(el) {
    const audit = store.get('audit', this.params.id);
    const cur = audit.equipmentChecks.find(x => x.id === el.dataset.id);
    const e = await equipmentForm(audit, cur); if (!e) return;
    delete e.registryId;
    await updateAudit(audit, a => { a.equipmentChecks = a.equipmentChecks.map(x => x.id === e.id ? e : x); }, { reason: this.amendReason });
    this.refresh();
  },
  async 'eq-remove'(el) {
    if (!(await confirmDialog({ title: 'Retirer l’équipement', message: 'Retirer cet équipement de l’audit ? (tracé au journal)' }))) return;
    const audit = store.get('audit', this.params.id);
    await updateAudit(audit, a => { a.equipmentChecks = a.equipmentChecks.filter(x => x.id !== el.dataset.id); }, { reason: this.amendReason });
    this.refresh();
  },
  async 'eq-scan'() {
    const { scanCode } = await import('../ui/scanner.js');
    const code = await scanCode({ title: 'Scanner l’étiquette de l’équipement' }); if (!code) return;
    const audit = store.get('audit', this.params.id);
    const n = normalize(code);
    const r = store.find('equipment', x => [x.inventoryNo, x.serial].some(v => v && (normalize(v) === n || n.includes(normalize(v)))));
    const base = r ? { label: r.label, inventoryNo: r.inventoryNo, brand: r.brand, model: r.model, serial: r.serial, checkDate: r.lastCheckDate, calibrationDate: r.calibrationDate, calibrationRequired: r.calibrationRequired, validUntil: r.validUntil, certificateRef: r.certificateRef, status: r.status, equipmentId: r.id, scannedCode: code } : { inventoryNo: code, scannedCode: code };
    if (!r) toast('Équipement absent du registre : complétez la fiche.', 'warn');
    const e = await equipmentForm(audit, { ...base, id: undefined }); if (!e) return;
    delete e.registryId;
    await updateAudit(audit, a => { a.equipmentChecks = [...(a.equipmentChecks || []), e]; }, { reason: this.amendReason });
    this.refresh();
  }
};

/* ---------- GPS ---------- */
export function gpsModule(audit, editable) {
  const point = store.get('point', audit.pointId);
  const threshold = Number(point?.gpsThreshold) || Number(orgSettings().gpsThresholdM) || 100;
  const readings = audit.gps || [];
  const photos = mediaFor({ type: 'point', id: audit.pointId || 'x' }).filter(m => m.auditId === audit.id);
  return html`<div class="module"><h3>📍 Position du point de prélèvement</h3>
    ${kv([['Point attendu', point ? `${point.code} — ${point.name}` : 'non renseigné'], ['Coordonnées attendues', point?.lat ? `${point.lat.toFixed(6)}, ${point.lon.toFixed(6)}` : 'non renseignées'], ['Seuil d’alerte', fmtDistance(threshold)]])}
    ${readings.length ? html`<div class="table-wrap" style="margin-top:10px"><table class="tbl"><thead><tr><th>Heure</th><th>Position</th><th>Précision</th><th>Écart au point</th></tr></thead><tbody>
      ${readings.map(g => { const d = point?.lat ? haversine(point.lat, point.lon, g.lat, g.lon) : null; return html`<tr><td>${fmtTime(g.at)}${g.source === 'manuel' ? html`<div class="tiny muted">saisie manuelle</div>` : ''}</td><td class="mono tiny">${g.lat.toFixed(6)}<br>${g.lon.toFixed(6)}</td><td>${g.accuracy ? '±' + Math.round(g.accuracy) + ' m' : '—'}</td><td>${d === null ? '—' : d > threshold ? badge(fmtDistance(d), 'nc') : badge(fmtDistance(d), 'ok')}</td></tr>`; })}</tbody></table></div>` : html`<p class="note">Aucun relevé de position.</p>`}
    ${thumbs(photos)}
    ${editable ? html`<div class="btn-row" style="margin-top:10px"><button class="btn primary" data-act="gps-read"><span class="ic">📍</span>Relever la position</button><button class="btn ghost" data-act="gps-manual">Saisie manuelle</button>${point ? evidenceButtons({ type: 'point', id: point.id }, { auditId: audit.id, label: 'Photo du point', gallery: false, file: false }) : ''}</div>` : ''}
    <div id="gpsMsg" class="hint"></div>
  </div>`;
}
export const gpsHandlers = {
  async 'gps-read'() {
    const msg = document.getElementById('gpsMsg'); if (msg) msg.textContent = 'Acquisition GPS en cours (restez immobile à découvert)…';
    try {
      const pos = await getPosition({ timeout: 30000 });
      const audit = store.get('audit', this.params.id);
      await updateAudit(audit, a => { a.gps = [...(a.gps || []), pos]; }, { reason: this.amendReason });
      toast(`Position relevée (±${Math.round(pos.accuracy)} m)`, 'ok');
      this.refresh();
    } catch (e) { if (msg) msg.textContent = e.message; toast(e.message, 'err'); }
  },
  async 'gps-manual'() {
    const v = await promptDialog({ title: 'Saisie manuelle de la position', label: 'Latitude, longitude (WGS84, degrés décimaux)', placeholder: '4.9372, -52.3260', multiline: false, voice: false, hint: 'À utiliser si le GPS de l’appareil est indisponible (position lue sur un GPS de terrain).' });
    if (!v) return;
    const m = v.replace(/;/g, ',').split(',').map(s => Number(s.trim()));
    if (m.length !== 2 || !m.every(isFinite) || Math.abs(m[0]) > 90 || Math.abs(m[1]) > 180) { toast('Format attendu : latitude, longitude', 'err'); return; }
    const audit = store.get('audit', this.params.id);
    await updateAudit(audit, a => { a.gps = [...(a.gps || []), { id: uuid(), lat: m[0], lon: m[1], accuracy: null, at: nowISO(), source: 'manuel' }]; }, { reason: this.amendReason });
    this.refresh();
  }
};

/* ---------- Échantillons ---------- */
export function samplesModule(audit, editable) {
  const list = audit.samples || [];
  return html`<div class="module"><h3>🧴 Échantillons (${list.length})</h3>
    ${list.length ? html`<div class="list">${list.map(s => { const ph = mediaFor({ type: 'sample', id: s.id }); const ok = s.code || s.scannedCode; return html`
      <div class="li ${ok ? 'stripe-ok' : 'stripe-nc'}"><div class="li-main">
        <div class="li-title">${s.sampleId} ${ok ? html`<span class="mono tiny">${s.code || s.scannedCode}</span>` : badge('Non identifié', 'nc')}</div>
        <div class="li-sub">${fmtDate(s.date)} ${s.time || ''} · ${store.get('matrix', s.matrixId)?.label || ''} · ${s.container || ''}${s.preservative ? ' · ' + s.preservative : ''}${s.volume ? ` · ${s.volume} ${s.volumeUnit || 'mL'}` : ''}${s.temperature !== '' && s.temperature !== null && s.temperature !== undefined ? ` · ${s.temperature} °C` : ''}</div>
        <div class="li-sub">${operatorName(s.operatorId)}${s.conservation ? ' · ' + s.conservation : ''}${s.observations ? ' · ' + s.observations : ''}</div>
        ${thumbs(ph)}
        ${editable ? html`<div class="item-tools">${evidenceButtons({ type: 'sample', id: s.id }, { auditId: audit.id, label: 'Photo étiquette', gallery: false, file: false })}<button class="btn ghost sm" data-act="smp-edit" data-id="${s.id}">Modifier</button><button class="btn ghost sm" data-act="smp-remove" data-id="${s.id}">Retirer</button></div>` : ''}
      </div></div>`; })}</div>` : html`<p class="note">Aucun échantillon enregistré.</p>`}
    ${editable ? html`<div class="btn-row" style="margin-top:10px"><button class="btn primary" data-act="smp-add"><span class="ic">＋</span>Échantillon</button><button class="btn ghost" data-act="smp-scan"><span class="ic">▦</span>Scanner une étiquette</button></div>` : ''}
  </div>`;
}
function sampleForm(audit, s) {
  const ops = auditOperators(audit);
  const containers = store.all('container').map(c => c.label);
  const m = openModal({
    title: `Échantillon ${s.sampleId}`, wide: true,
    body: html`<form id="smpf">
      <div class="grid2">
        ${field('Identifiant (généré)', html`<input name="sampleId" value="${s.sampleId}" readonly>`)}
        ${field('Code / étiquette', html`<div class="input-wrap"><input name="code" id="smpCode" value="${s.code || ''}" placeholder="code porté sur le flacon"><button type="button" class="icon-btn" data-act="smp-scanfield" title="Scanner QR / code-barres">▦</button></div>`, { hint: 'Scanner le QR code ou le code-barres de l’étiquette.' })}
        ${field('Point', html`<select name="pointId">${options(store.filter('point', p => p.siteId === audit.siteId), s.pointId, { label: p => p.code, placeholder: null })}</select>`)}
        ${field('Opérateur', html`<select name="operatorId">${options(ops, s.operatorId, { label: o => operatorName(o) })}</select>`)}
        ${field('Date', html`<input type="date" name="date" value="${s.date}">`)}${field('Heure', html`<div class="input-wrap"><input type="time" name="time" value="${s.time}"><button type="button" class="btn ghost sm" data-act="smp-now">Maintenant</button></div>`)}
        ${field('Type de prélèvement', html`<select name="samplingTypeId">${options(store.all('samplingType'), s.samplingTypeId)}</select>`)}${field('Matrice', html`<select name="matrixId">${options(store.all('matrix'), s.matrixId)}</select>`)}
        ${field('Contenant', html`<select name="container">${options(containers, s.container)}</select>`)}${field('Conservateur', html`<input name="preservative" value="${s.preservative || ''}" placeholder="ex. HNO3, aucun">`)}
        ${field('Volume', html`<div class="input-wrap"><input name="volume" inputmode="decimal" value="${s.volume || ''}"><select name="volumeUnit" style="max-width:90px">${options(['mL', 'L', 'g', 'kg'], s.volumeUnit || 'mL', { placeholder: null })}</select></div>`)}
        ${field('Température (si applicable)', html`<div class="input-wrap"><input name="temperature" inputmode="decimal" value="${s.temperature ?? ''}"><span class="unit">°C</span></div>`)}
      </div>
      ${field('Conditions de conservation', html`<input name="conservation" value="${s.conservation || ''}" placeholder="ex. glacière 4 °C, obscurité">`)}
      ${field('Observations', html`<div class="input-wrap"><textarea name="observations" id="smpObs">${s.observations || ''}</textarea>${voiceBtn('smpObs')}</div>`)}
    </form>`,
    actions: [{ label: 'Annuler' }, { label: 'Enregistrer l’échantillon', act: 'ok', cls: 'primary' }],
    handlers: {
      'smp-now'() { this.root.querySelector('[name=time]').value = localTime(); this.root.querySelector('[name=date]').value = localDate(); },
      async 'smp-scanfield'() { const { scanCode } = await import('../ui/scanner.js'); const v = await scanCode({ title: 'Étiquette de l’échantillon' }); if (v) { this.root.querySelector('#smpCode').value = v; s.scannedCode = v; } },
      async voice(el) { (await import('../ui/voice.js')).dictate(this.root.querySelector('#' + el.dataset.target)); },
      ok() {
        const v = formValues(this.root.querySelector('#smpf'));
        v.volume = v.volume === '' ? '' : Number(String(v.volume).replace(',', '.'));
        v.temperature = v.temperature === '' ? '' : Number(String(v.temperature).replace(',', '.'));
        this.close({ ...s, ...v });
      }
    }
  });
  return m.result;
}
function newSample(audit, extra = {}) {
  const n = (audit.samples || []).length + 1;
  return { id: uuid(), sampleId: sampleIdFor(audit, n), code: '', scannedCode: '', pointId: audit.pointId, date: localDate(), time: localTime(), operatorId: (audit.operatorIds || [])[0] || '', samplingTypeId: audit.samplingTypeId, matrixId: audit.matrixId, container: '', preservative: '', volume: '', volumeUnit: 'mL', temperature: '', conservation: '', observations: '', createdAt: nowISO(), createdBy: session.user.name, ...extra };
}
export const sampleHandlers = {
  async 'smp-add'() {
    const audit = store.get('audit', this.params.id);
    const s = await sampleForm(audit, newSample(audit)); if (!s) return;
    await updateAudit(audit, a => { a.samples = [...(a.samples || []), s]; }, { reason: this.amendReason });
    this.refresh();
  },
  async 'smp-scan'() {
    const { scanCode } = await import('../ui/scanner.js');
    const code = await scanCode({ title: 'Scanner l’étiquette de l’échantillon' }); if (!code) return;
    const audit = store.get('audit', this.params.id);
    if ((audit.samples || []).some(x => x.code === code || x.scannedCode === code)) { toast('Ce code est déjà enregistré dans l’audit.', 'warn'); return; }
    const s = await sampleForm(audit, newSample(audit, { code, scannedCode: code })); if (!s) return;
    await updateAudit(audit, a => { a.samples = [...(a.samples || []), s]; }, { reason: this.amendReason });
    this.refresh();
  },
  async 'smp-edit'(el) {
    const audit = store.get('audit', this.params.id);
    const s = await sampleForm(audit, { ...audit.samples.find(x => x.id === el.dataset.id) }); if (!s) return;
    await updateAudit(audit, a => { a.samples = a.samples.map(x => x.id === s.id ? s : x); }, { reason: this.amendReason });
    this.refresh();
  },
  async 'smp-remove'(el) {
    if (!(await confirmDialog({ title: 'Retirer l’échantillon', message: 'Retirer cet échantillon de l’audit ? (tracé au journal)' }))) return;
    const audit = store.get('audit', this.params.id);
    await updateAudit(audit, a => { a.samples = a.samples.filter(x => x.id !== el.dataset.id); }, { reason: this.amendReason });
    this.refresh();
  }
};

/* ---------- Écarts ---------- */
/** Formulaire de saisie d'un écart. prefill : {itemId, itemCode, requirement, docRefs, description, typeCode, source, alertCode} */
export async function openDeviationForm(audit, prefill = {}) {
  const crits = sortBy(store.all('criticality'), 'rank');
  const types = store.all('deviationType');
  let critCode = prefill.criticalityCode || 'MIN';
  const loc = await getPosition({ timeout: 4000, maximumAge: 120000 }).catch(() => null);
  const refsText = (prefill.docRefs || []).map(r => refLabel(r, audit.documentsSnapshot)).join(' ; ');
  const m = openModal({
    title: 'Nouvel écart', wide: true,
    body: html`<form id="devf">
      <div class="banner info">N° attribué à l’enregistrement · ${fmtDate(localDate())} ${localTime()} · ${loc ? `GPS ${loc.lat.toFixed(5)}, ${loc.lon.toFixed(5)}` : 'position non disponible'}</div>
      ${field('Exigence concernée', html`<input name="requirement" value="${prefill.requirement || ''}" required>`, { required: true })}
      ${refsText ? field('Référence documentaire', html`<input value="${refsText}" readonly>`) : field('Référence documentaire', html`<div class="grid2"><select name="refDoc">${options(audit.documentsSnapshot.map(d => ({ id: d.docKey, label: `${d.reference} v${d.version}` })), '', { placeholder: 'Document…' })}</select><input name="refArticle" placeholder="article / paragraphe"></div>`)}
      ${field('Description factuelle du constat', html`<div class="input-wrap"><textarea name="description" id="devDesc" required>${prefill.description || ''}</textarea>${voiceBtn('devDesc')}</div>`, { required: true, hint: 'Ce qui a été observé, sans interprétation.' })}
      ${field('Observation de l’auditeur', html`<div class="input-wrap"><textarea name="auditorObservation" id="devObs">${prefill.auditorObservation || ''}</textarea>${voiceBtn('devObs')}</div>`)}
      ${field('Niveau de criticité', html`<div class="seg">${crits.map(c => html`<button type="button" data-act="crit" data-code="${c.code}" class="${c.code === critCode ? 'sel' : ''}" style="${c.code === critCode ? `background:${c.color};color:#fff;border-color:transparent` : `border-color:${c.color};color:${c.color}`}">${c.label}</button>`)}</div><div class="hint" id="critDef">${crits.find(c => c.code === critCode)?.definition || ''}</div>`, { required: true })}
      <div class="grid2">
        ${field('Type d’écart', html`<select name="typeCode">${options(types, prefill.typeCode, { value: t => t.code })}</select>`)}
        ${field('Responsable du traitement', html`<input name="responsible" value="${store.get('provider', audit.providerId)?.name || ''}">`)}
      </div>
      ${field('Action immédiate', html`<div class="input-wrap"><textarea name="immediateAction" id="devImm" placeholder="ex. arrêt du prélèvement, nouveau prélèvement, isolement des échantillons…"></textarea>${voiceBtn('devImm')}</div>`)}
      ${field('Action corrective demandée', html`<div class="input-wrap"><textarea name="correctiveActionRequested" id="devCorr"></textarea>${voiceBtn('devCorr')}</div>`)}
      ${field('Délai', html`<input type="date" name="dueDate" id="devDue" value="${defaultDueDate(critCode)}">`, { hint: 'Proposé d’après le niveau de criticité (modifiable).' })}
      <p class="note">Les photographies et preuves peuvent être ajoutées à l’écart juste après son enregistrement.</p>
    </form>`,
    actions: [{ label: 'Annuler' }, { label: 'Enregistrer l’écart', act: 'ok', cls: 'danger' }],
    handlers: {
      crit(el) {
        critCode = el.dataset.code;
        this.root.querySelectorAll('[data-act=crit]').forEach(b => { const c = crits.find(x => x.code === b.dataset.code); const sel = b === el; b.className = sel ? 'sel' : ''; b.style.cssText = sel ? `background:${c.color};color:#fff;border-color:transparent` : `border-color:${c.color};color:${c.color}`; });
        this.root.querySelector('#critDef').textContent = crits.find(c => c.code === critCode)?.definition || '';
        this.root.querySelector('#devDue').value = defaultDueDate(critCode);
      },
      async voice(el) { (await import('../ui/voice.js')).dictate(this.root.querySelector('#' + el.dataset.target)); },
      ok() {
        const f = this.root.querySelector('#devf'); if (!f.reportValidity()) return;
        const v = formValues(f);
        const crit = crits.find(c => c.code === critCode);
        if (crit?.requiresImmediateAction && !v.immediateAction.trim()) { toast(`« ${crit.label} » : une action immédiate est requise.`, 'err'); return; }
        const docRefs = prefill.docRefs?.length ? prefill.docRefs : v.refDoc ? [{ docKey: v.refDoc, article: v.refArticle, docType: audit.documentsSnapshot.find(d => d.docKey === v.refDoc)?.type }] : [];
        this.close({ ...prefill, ...v, docRefs, criticalityCode: critCode, location: loc ? { lat: loc.lat, lon: loc.lon, accuracy: loc.accuracy } : null });
      }
    }
  });
  const data = await m.result;
  if (!data) return null;
  delete data.refDoc; delete data.refArticle;
  const dev = await createDeviation(audit, data);
  toast(`Écart ${dev.number} enregistré`, 'ok');
  return dev;
}

export function deviationChips(audit, itemId) {
  const devs = auditDeviations(audit.id).filter(d => d.itemId === itemId);
  return devs.length ? html`<div class="row dev-link" style="gap:6px">${devs.map(d => html`<a class="badge nc" href="#/ecart/${d.id}">⚠ ${d.number}</a>${critBadge(d.criticalityCode)}${deviationBadge(d.status)}`)}</div>` : '';
}
