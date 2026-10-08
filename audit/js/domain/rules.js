/* Alertes intelligentes. Fichier pur (testé sous Node).
 *
 * Une alerte signale une situation qui mérite l'attention de l'auditeur. Elle n'est JAMAIS
 * transformée automatiquement en non-conformité : elle propose seulement de créer un écart
 * pré-rempli, l'auditeur garde la décision finale.
 */
import { allItems, itemIndex, responseValue, visibleStructure, isAnswered, isAnswerable } from './grids.js';
import { haversine, fmtDistance, fmtDate, daysBetween } from '../core/util.js';

const LEVEL_RANK = { critique: 3, attention: 2, info: 1 };

function cmp(op, a, b) {
  const n = v => Number(String(v).replace(',', '.'));
  switch (op) {
    case 'eq': return String(a) === String(b);
    case 'neq': return String(a) !== String(b);
    case 'gt': return n(a) > n(b);
    case 'gte': return n(a) >= n(b);
    case 'lt': return n(a) < n(b);
    case 'lte': return n(a) <= n(b);
    case 'outside': return n(a) < n(b[0]) || n(a) > n(b[1]);
    case 'in': return (Array.isArray(b) ? b : [b]).map(String).includes(String(a));
    case 'truthy': return a === true;
    default: return false;
  }
}
const normVersion = v => String(v ?? '').toLowerCase().replace(/^(version|v)\s*/i, '').replace(/\s+/g, '').trim();

export function sampleDateTime(s) {
  if (!s?.date) return null;
  const d = new Date(`${s.date}T${(s.time || '00:00').slice(0, 5)}:00`);
  return isNaN(d) ? null : d;
}

/** Validité d'une qualification à une date donnée. */
export function qualificationValid(q, date) {
  if (!q) return false;
  if (q.validUntil && String(q.validUntil).slice(0, 10) < date) return false;
  if (q.obtainedAt && String(q.obtainedAt).slice(0, 10) > date) return false;
  return true;
}
/** État des habilitations d'un opérateur : {ok, valid:[…], expired:[…], message}. */
export function operatorStatus(op, date, samplingTypeId = null) {
  const quals = (op?.qualifications || []).filter(q => !q.type || ['habilitation', 'qualification', 'autorisation'].includes(q.type));
  const relevant = quals.filter(q => !q.samplingTypeIds?.length || !samplingTypeId || q.samplingTypeIds.includes(samplingTypeId));
  const valid = relevant.filter(q => qualificationValid(q, date));
  const expired = relevant.filter(q => q.validUntil && String(q.validUntil).slice(0, 10) < date);
  let message = '';
  if (!relevant.length) message = 'aucune habilitation enregistrée pour ce type de prélèvement';
  else if (!valid.length) message = `habilitation expirée (${expired.map(q => `${q.label || q.type} le ${fmtDate(q.validUntil)}`).join(', ')})`;
  return { ok: valid.length > 0, valid, expired, message };
}
/** État de validité d'un équipement contrôlé : {ok, level, reasons:[]}. */
export function equipmentStatus(eq, date) {
  const reasons = [];
  let level = null;
  if (eq.status && eq.status !== 'service') { reasons.push(`statut « ${eq.statusLabel || eq.status} »`); level = 'critique'; }
  if (eq.validUntil && String(eq.validUntil).slice(0, 10) < date) { reasons.push(`validité expirée le ${fmtDate(eq.validUntil)}`); level = 'critique'; }
  if (eq.calibrationRequired && !eq.calibrationDate) { reasons.push('date d’étalonnage non renseignée'); level = level || 'attention'; }
  if (eq.calibrationRequired && eq.certificateAvailable === false) { reasons.push('certificat d’étalonnage non disponible'); level = level || 'attention'; }
  if (eq.conformity === 'NC') { reasons.push('jugé non conforme par l’auditeur'); level = level || 'attention'; }
  if (!eq.inventoryNo && !eq.serial) { reasons.push('équipement non identifié (ni n° d’inventaire ni n° de série)'); level = level || 'attention'; }
  return { ok: !reasons.length, level, reasons };
}

/**
 * Calcule les alertes d'un audit.
 * input : {audit, grid, ctx, point, site, prestation, operators, settings, today, mediaCounts, includeMissing}
 */
export function computeAlerts(input) {
  const { audit, grid, ctx = {}, point, prestation, operators = [], settings = {}, mediaCounts = {} } = input;
  const today = input.today || (audit.startedAt || '').slice(0, 10) || new Date().toISOString().slice(0, 10);
  const auditDate = (audit.startedAt || today).slice(0, 10);
  const responses = audit.responses || {};
  const out = [];
  const add = a => out.push({ level: 'attention', ...a, key: a.key || `${a.code}:${a.itemId || a.target?.id || ''}` });
  const structure = grid ? visibleStructure(grid, responses, ctx) : [];
  const visibleIds = new Set(structure.filter(s => s.visible).flatMap(s => s.visibleItems.map(i => i.id)));
  const items = grid ? allItems(grid).filter(i => visibleIds.has(i.id)) : [];
  const sectionOfModule = mod => structure.find(s => s.visible && s.module === mod)?.id || null;

  // 1. Mauvais point de prélèvement (écart GPS)
  const reading = (audit.gps || []).filter(g => g && isFinite(g.lat) && isFinite(g.lon)).slice(-1)[0];
  if (reading && point && isFinite(point.lat) && isFinite(point.lon)) {
    const threshold = Number(point.gpsThreshold) || Number(settings.gpsThresholdM) || 100;
    const d = haversine(point.lat, point.lon, reading.lat, reading.lon);
    if (d > threshold) {
      add({
        code: 'GPS_FAR', level: d > threshold * 5 ? 'critique' : 'attention', sectionId: sectionOfModule('gps'), target: { type: 'gps', id: reading.id },
        title: 'Position éloignée du point attendu',
        message: `Position relevée à ${fmtDistance(d)} du point ${point.code || ''} (seuil ${fmtDistance(threshold)}${reading.accuracy ? `, précision ±${Math.round(reading.accuracy)} m` : ''}). Vérifier qu’il s’agit du bon point de prélèvement.`,
        deviation: { requirement: 'Prélèvement réalisé au point programmé', description: `Position du prélèvement relevée à ${fmtDistance(d)} des coordonnées attendues du point ${point.code || ''}.`, typeCode: 'LOCALISATION' }
      });
    }
  }

  // 2. Équipements non valides
  for (const eq of audit.equipmentChecks || []) {
    const st = equipmentStatus(eq, auditDate);
    if (!st.ok) add({
      code: 'EQUIPMENT_INVALID', level: st.level, sectionId: sectionOfModule('equipment'), target: { type: 'equipment', id: eq.id },
      title: 'Équipement non valide',
      message: `${eq.label || eq.model || 'Équipement'} ${eq.inventoryNo ? `(n° ${eq.inventoryNo})` : ''} : ${st.reasons.join(' ; ')}.`,
      deviation: { requirement: 'Équipement de mesure vérifié/étalonné et en cours de validité', description: `Équipement ${eq.label || ''} ${eq.inventoryNo || eq.serial || ''} : ${st.reasons.join(' ; ')}.`, typeCode: 'MATERIEL' }
    });
  }

  // 3. Échantillons non identifiés
  for (const s of audit.samples || []) {
    if (!String(s.code || '').trim() && !String(s.scannedCode || '').trim()) add({
      code: 'SAMPLE_UNIDENTIFIED', level: 'critique', sectionId: sectionOfModule('samples'), target: { type: 'sample', id: s.id },
      title: 'Échantillon non identifié',
      message: `L’échantillon ${s.sampleId || ''} n’a ni code ni étiquette scannée.`,
      deviation: { requirement: 'Identification univoque de chaque échantillon', description: `Échantillon ${s.sampleId || ''} sans identification (code/étiquette absent).`, typeCode: 'TRACABILITE' }
    });
  }

  // 4. Opérateurs non habilités
  const stId = audit.samplingTypeId || prestation?.samplingTypeId || null;
  for (const opId of audit.operatorIds || []) {
    const op = operators.find(o => o.id === opId);
    if (!op) continue;
    const st = operatorStatus(op, auditDate, stId);
    if (!st.ok) add({
      code: 'OPERATOR_NOT_QUALIFIED', level: 'critique', sectionId: sectionOfModule('operators'), target: { type: 'operator', id: op.id },
      title: 'Opérateur non habilité',
      message: `${[op.firstName, op.lastName].filter(Boolean).join(' ') || op.code} : ${st.message}.`,
      deviation: { requirement: 'Personnel habilité pour le prélèvement réalisé', description: `Opérateur ${[op.firstName, op.lastName].filter(Boolean).join(' ')} : ${st.message}.`, typeCode: 'COMPETENCE' }
    });
  }

  // 5. Prestation différente de celle programmée
  if (prestation) {
    const diffs = [];
    if (audit.siteId && prestation.siteId && audit.siteId !== prestation.siteId) diffs.push('site différent');
    if (audit.pointId && (prestation.pointIds || []).length && !prestation.pointIds.includes(audit.pointId)) diffs.push('point de prélèvement différent');
    if (audit.providerId && prestation.providerId && audit.providerId !== prestation.providerId) diffs.push('prestataire différent');
    if (audit.samplingTypeId && prestation.samplingTypeId && audit.samplingTypeId !== prestation.samplingTypeId) diffs.push('type de prélèvement différent');
    const planned = (prestation.operatorIds || []);
    const present = (audit.operatorIds || []);
    if (planned.length && present.length && !present.some(id => planned.includes(id))) diffs.push('aucun des opérateurs programmés n’est présent');
    if (prestation.plannedDate && Math.abs(daysBetween(prestation.plannedDate, auditDate)) > (Number(settings.dateToleranceDays) || 0) && !prestation.dateIndicative) diffs.push(`date programmée le ${fmtDate(prestation.plannedDate)}`);
    if (diffs.length) add({
      code: 'PRESTATION_DIFFERENT', level: 'attention', target: { type: 'prestation', id: prestation.id },
      title: 'Prestation différente de celle programmée',
      message: `Constat : ${diffs.join(', ')}.`,
      deviation: { requirement: 'Prestation réalisée conformément à la programmation', description: `Écart avec la prestation programmée ${prestation.ref || ''} : ${diffs.join(', ')}.`, typeCode: 'DOCUMENTAIRE' }
    });
  }

  // 6. Règles portées par les critères (température hors critère, matériel manquant…)
  const docs = audit.documentsSnapshot || [];
  for (const it of items) {
    const r = responses[it.id];
    const v = responseValue(it, r);
    for (const rule of it.alerts || []) {
      if (v === undefined || v === null || v === '' || v === 'NA') continue;
      if (cmp(rule.op, v, rule.value)) add({
        code: rule.code || 'ITEM_RULE', level: rule.level || 'attention', sectionId: it.sectionId, itemId: it.id,
        title: rule.title || it.label,
        message: (rule.message || `${it.label} : valeur ${v}`).replace('{value}', String(v).replace('.', ',')),
        deviation: { requirement: rule.requirement || it.label, description: `${it.label} : ${String(v).replace('.', ',')}${it.unit ? ' ' + it.unit : ''}. ${rule.message || ''}`.trim(), typeCode: rule.typeCode || null, refs: it.refs }
      });
    }
    // Version du protocole présentée ≠ version applicable
    if (it.compareTo === 'protocolVersion' && r?.value) {
      const proto = docs.find(d => d.type === 'PROTOCOLE');
      if (proto && normVersion(r.value) !== normVersion(proto.version)) add({
        code: 'PROTOCOL_WRONG', level: 'critique', sectionId: it.sectionId, itemId: it.id,
        title: 'Protocole incorrect',
        message: `Version présentée « ${r.value} » ≠ version applicable « ${proto.version} » (${proto.reference || proto.name}).`,
        deviation: { requirement: `Utilisation de la version applicable du protocole (${proto.reference} v${proto.version})`, description: `L’opérateur utilise la version « ${r.value} » au lieu de la version applicable ${proto.version}.`, typeCode: 'DOCUMENTAIRE' }
      });
    }
    // Délai entre prélèvement et remise
    if (it.delayFrom === 'samples' && r?.value) {
      const remise = new Date(String(r.value).length === 16 ? r.value + ':00' : r.value);
      const times = (audit.samples || []).map(sampleDateTime).filter(Boolean);
      const max = Number(it.maxHours) || Number(settings.transportMaxHours) || 24;
      if (times.length && !isNaN(remise)) {
        const first = new Date(Math.min(...times.map(t => t.getTime())));
        const h = (remise - first) / 3600000;
        if (h > max) add({
          code: 'DELAY_EXCEEDED', level: 'critique', sectionId: it.sectionId, itemId: it.id,
          title: 'Délai dépassé',
          message: `${h.toFixed(1).replace('.', ',')} h entre le premier prélèvement et la remise (maximum ${max} h).`,
          deviation: { requirement: `Délai maximal de ${max} h entre prélèvement et remise au laboratoire`, description: `Délai constaté : ${h.toFixed(1).replace('.', ',')} h.`, typeCode: 'TRANSPORT', refs: it.refs }
        });
        if (h < 0) add({ code: 'DELAY_NEGATIVE', level: 'attention', sectionId: it.sectionId, itemId: it.id, title: 'Heure de remise incohérente', message: 'L’heure de remise est antérieure au premier prélèvement.' });
      }
    }
  }

  // 7. Informations obligatoires absentes (affichées lors de la clôture)
  if (input.includeMissing) {
    for (const s of structure) {
      if (!s.visible) continue;
      const missing = s.visibleItems.filter(it => isAnswerable(it) && it.required && !isAnswered(it, mediaCounts[it.id] ? { ...(responses[it.id] || {}), mediaCount: mediaCounts[it.id] } : responses[it.id]));
      if (missing.length) add({ code: 'REQUIRED_MISSING', level: 'info', sectionId: s.id, key: 'REQUIRED_MISSING:' + s.id, title: 'Information obligatoire absente', message: `${missing.length} critère(s) obligatoire(s) sans réponse dans « ${s.title} » : ${missing.slice(0, 4).map(i => i.code || i.label).join(', ')}${missing.length > 4 ? '…' : ''}` });
    }
  }

  // Dédoublonnage et tri par gravité
  const seen = new Set();
  return out.filter(a => !seen.has(a.key) && seen.add(a.key)).sort((a, b) => (LEVEL_RANK[b.level] || 0) - (LEVEL_RANK[a.level] || 0));
}

export { itemIndex };
