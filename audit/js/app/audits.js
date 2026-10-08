/* Opérations métier sur les audits : création (instantanés), réponses, écarts, clôture, signatures,
 * verrouillage scellé, modifications motivées après signature et vérification d'intégrité. */
import { store } from '../core/store.js';
import { session, appVersion } from '../core/session.js';
import { saveMedia } from '../core/media.js';
import { can } from '../core/auth.js';
import { uuid, nowISO, clone, canonicalJSON, sha256Hex, diff, compactValue, addDays, localDate } from '../core/util.js';
import { allItems, progress, validateResponses, visibleStructure, rankGrids } from '../domain/grids.js';
import { computeAlerts } from '../domain/rules.js';
import { auditSummary } from '../domain/summary.js';
import { nextNumber } from './numbering.js';
import { applicableDocuments, snapshotDocument } from './documents.js';
import { orgSettings } from './settings.js';

export const auditDeviations = auditId => store.filter('deviation', d => d.auditId === auditId).sort((a, b) => String(a.number).localeCompare(String(b.number), 'fr', { numeric: true }));
export const auditMedia = auditId => store.filter('media', m => m.auditId === auditId);

/** Contexte des conditions de grille (matrice, type de prélèvement, prestataire…). */
export function auditContext(audit) {
  const prestation = audit.prestationId ? store.get('prestation', audit.prestationId) : null;
  const matrix = store.get('matrix', audit.matrixId || prestation?.matrixId);
  const stype = store.get('samplingType', audit.samplingTypeId || prestation?.samplingTypeId);
  const provider = store.get('provider', audit.providerId);
  const site = store.get('site', audit.siteId);
  return {
    matrixCode: matrix?.code || '', samplingTypeCode: stype?.code || '', providerKind: provider?.kind || '', providerId: provider?.id || '',
    auditKind: audit.kind || '', network: (site?.networks || []).join(','), controlLevel: prestation?.controlLevel || ''
  };
}

export function mediaCounts(audit) {
  const counts = {};
  for (const m of auditMedia(audit.id)) if (m.link?.type === 'item' && m.link.itemId) counts[m.link.itemId] = (counts[m.link.itemId] || 0) + 1;
  return counts;
}

/** État calculé complet d'un audit (pour l'affichage). */
export function auditState(audit, { includeMissing = false } = {}) {
  const grid = audit.gridSnapshot;
  const ctx = auditContext(audit);
  const counts = mediaCounts(audit);
  const deviations = auditDeviations(audit.id);
  const prestation = audit.prestationId ? store.get('prestation', audit.prestationId) : null;
  const point = store.get('point', audit.pointId);
  const operators = (audit.operatorIds || []).map(id => store.get('operator', id)).filter(Boolean);
  const settings = orgSettings();
  const alerts = computeAlerts({ audit, grid, ctx, point, prestation, operators, settings, mediaCounts: counts, includeMissing, today: localDate() })
    .filter(a => !(audit.dismissedAlerts || []).some(d => d.key === a.key));
  const deviationsByItem = {};
  for (const d of deviations) if (d.itemId) deviationsByItem[d.itemId] = (deviationsByItem[d.itemId] || 0) + 1;
  return {
    grid, ctx, counts, deviations, prestation, point, operators, alerts,
    structure: visibleStructure(grid, audit.responses || {}, ctx),
    progress: progress(grid, audit.responses || {}, ctx, counts),
    validation: validateResponses(grid, audit.responses || {}, ctx, { mediaCounts: counts, deviationsByItem }),
    summary: auditSummary({ audit, grid, ctx, deviations: deviations.filter(d => d.status !== 'annule'), criticalities: store.all('criticality'), alerts })
  };
}

export function gridsFor(prestation) {
  const grids = store.all('grid').filter(g => g.status === 'publiee');
  return rankGrids(grids, { samplingTypeId: prestation?.samplingTypeId, matrixId: prestation?.matrixId, providerId: prestation?.providerId, protocolDocKey: prestation?.protocolDocKey, cctpDocKey: prestation?.cctpDocKey });
}

/**
 * Crée un audit. Tout ce qui sert de référence est FIGÉ dans l'audit : copie de la grille, instantané
 * des documents applicables (version + empreinte), identification de l'appareil et de l'application.
 */
export async function createAudit({ prestationId = null, gridId, kind = 'planifie', providerId, siteId, pointId, operatorIds = [], samplingTypeId = null, matrixId = null }) {
  if (!can('audit.create')) throw new Error('Votre profil ne permet pas de créer un audit.');
  const grid = store.get('grid', gridId);
  if (!grid) throw new Error('Grille d’audit introuvable.');
  const prestation = prestationId ? store.get('prestation', prestationId) : null;
  const now = nowISO(), today = localDate();
  const { number, source } = await nextNumber('AUD', new Date().getFullYear());
  const docs = applicableDocuments(prestation || { providerId, samplingTypeId, siteId }, today);
  const documentsSnapshot = await Promise.all(docs.map(snapshotDocument));
  const gridSnapshot = clone(grid);
  const audit = {
    id: uuid(), number, numberSource: source, kind,
    prestationId: prestation?.id || null,
    providerId: providerId || prestation?.providerId || null,
    siteId: siteId || prestation?.siteId || null,
    pointId: pointId || prestation?.pointIds?.[0] || null,
    operatorIds: operatorIds.length ? operatorIds : [...(prestation?.operatorIds || [])],
    samplingTypeId: samplingTypeId || prestation?.samplingTypeId || null,
    matrixId: matrixId || prestation?.matrixId || null,
    campaignId: prestation?.campaignId || null,
    auditorId: session.user.id, auditorName: session.user.name, auditorRole: session.user.role,
    device: { id: session.device.id, name: session.device.name, userAgent: navigator.userAgent },
    appVersion: appVersion(),
    gridId: grid.id, gridCode: grid.code, gridVersion: grid.version, gridSnapshot,
    gridSha256: await sha256Hex(canonicalJSON(gridSnapshot)),
    documentsSnapshot,
    protocolVersion: documentsSnapshot.find(d => d.type === 'PROTOCOLE')?.version || null,
    cctpVersion: documentsSnapshot.find(d => d.type === 'CCTP')?.version || null,
    startedAt: now, endedAt: null, status: 'en_cours',
    responses: {}, gps: [], samples: [], equipmentChecks: [], dismissedAlerts: [],
    signatures: {}, lock: null, amendments: [], reports: [], conclusions: { strengths: '', vigilance: '', comment: '' }
  };
  await store.put('audit', audit, { action: 'create', reason: kind === 'inopine' ? 'Audit inopiné' : null });
  if (prestation) await addPrestationHistory(prestation, { event: 'audit-demarre', auditId: audit.id, label: `Audit ${number} démarré` });
  return store.get('audit', audit.id);
}

export async function addPrestationHistory(prestation, entry, patch = {}) {
  const p = store.get('prestation', prestation.id);
  await store.put('prestation', { ...p, ...patch, statusHistory: [...(p.statusHistory || []), { at: nowISO(), by: session.user?.name, ...entry }] }, { reason: entry.reason || entry.label });
}
export async function setPrestationStatus(prestation, status, reason) {
  await addPrestationHistory(prestation, { event: 'statut', from: prestation.status, to: status, reason }, { status });
}

/* ---------- Modification d'un audit (avant ou après signature) ---------- */
/**
 * Applique une modification. Sur un audit verrouillé, il faut le droit « audit.amend » et un motif :
 * l'amendement conserve les valeurs avant/après, l'auteur, la date et la nouvelle empreinte.
 */
export async function updateAudit(audit, mutate, { reason = null, action = null } = {}) {
  const before = store.get('audit', audit.id);
  const next = clone(before);
  mutate(next);
  if (before.lock?.lockedAt) {
    if (!can('audit.amend')) throw new Error('Audit signé et verrouillé : modification réservée au responsable qualité ou à l’administrateur.');
    if (!reason) throw new Error('Un motif est obligatoire pour modifier un audit signé.');
    const changes = diff(before, next, { ignore: ['amendments', 'updatedAt', 'updatedBy', 'updatedByName', '_rev', '_lv', 'reports'] });
    if (!changes.length) return before;
    const hashBefore = await auditContentHash(before);
    const hashAfter = await auditContentHash(next);
    next.amendments = [...(before.amendments || []), {
      id: uuid(), at: nowISO(), by: session.user.id, byName: session.user.name, role: session.user.role, reason,
      changes: changes.slice(0, 80).map(c => ({ path: c.path, before: compactValue(c.before), after: compactValue(c.after) })), hashBefore, hashAfter
    }];
    return store.put('audit', next, { action: 'amend', reason });
  }
  return store.put('audit', next, { action: action || undefined, reason });
}

export async function setResponse(audit, itemId, patch, { reason = null } = {}) {
  return updateAudit(audit, a => {
    const prev = a.responses[itemId] || {};
    const r = { ...prev, ...patch, at: nowISO(), by: session.user.id, byName: session.user.name };
    for (const k of Object.keys(r)) if (r[k] === undefined) delete r[k];
    a.responses[itemId] = r;
  }, { reason });
}

/* ---------- Échantillons ---------- */
export function sampleIdFor(audit, index) {
  const pattern = orgSettings().sampleIdPattern || '{AUDIT}-E{NN}';
  const site = store.get('site', audit.siteId);
  const d = new Date();
  return pattern.replace('{AUDIT}', audit.number).replace('{SITE}', site?.code || 'SITE').replace('{YYYYMMDD}', localDate(d).replace(/-/g, ''))
    .replace('{NNN}', String(index).padStart(3, '0')).replace('{NN}', String(index).padStart(2, '0'));
}

/* ---------- Écarts ---------- */
export function nextDeviationNumber(audit) {
  const n = store.all('deviation', { withDeleted: true }).filter(d => d.auditId === audit.id).length + 1;
  return `${audit.number}-E${String(n).padStart(2, '0')}`;
}
export function defaultDueDate(criticalityCode) {
  const c = store.all('criticality').find(x => x.code === criticalityCode);
  return c?.defaultDelayDays ? addDays(localDate(), c.defaultDelayDays) : '';
}
export async function createDeviation(audit, data) {
  if (!can('deviation.manage')) throw new Error('Votre profil ne permet pas d’enregistrer un écart.');
  const now = new Date();
  const dev = {
    id: uuid(), number: nextDeviationNumber(audit), auditId: audit.id, auditNumber: audit.number,
    providerId: audit.providerId, siteId: audit.siteId, pointId: audit.pointId, prestationId: audit.prestationId,
    date: localDate(now), time: now.toTimeString().slice(0, 5),
    itemId: data.itemId || null, itemCode: data.itemCode || null, requirement: data.requirement || '', docRefs: data.docRefs || [],
    description: data.description || '', auditorObservation: data.auditorObservation || '', location: data.location || null,
    criticalityCode: data.criticalityCode || 'MIN', typeCode: data.typeCode || null,
    immediateAction: data.immediateAction || '', correctiveActionRequested: data.correctiveActionRequested || '',
    responsible: data.responsible || '', dueDate: data.dueDate || defaultDueDate(data.criticalityCode || 'MIN'),
    status: 'ouvert', source: data.source || 'manuel', alertCode: data.alertCode || null,
    correctiveActions: [], history: [{ at: nowISO(), by: session.user.name, event: 'Création', status: 'ouvert' }]
  };
  return store.put('deviation', dev, { action: 'create', reason: audit.lock?.lockedAt ? (data.reason || 'Écart ajouté après signature') : null });
}
export async function updateDeviation(dev, patch, { reason = null, event = null } = {}) {
  const cur = store.get('deviation', dev.id);
  const next = { ...cur, ...patch };
  if (event || (patch.status && patch.status !== cur.status)) next.history = [...(cur.history || []), { at: nowISO(), by: session.user.name, event: event || `Statut : ${cur.status} → ${patch.status}`, status: next.status, reason }];
  return store.put('deviation', next, { reason });
}

/* ---------- Clôture, signature, verrouillage ---------- */
/**
 * Projection du contenu probant de l'audit, couverte par l'empreinte de signature :
 * l'audit (hors signatures, verrou, métadonnées), les constats des écarts (hors suivi : statut,
 * responsable, échéance, actions correctives) et les médias (hors images de signature).
 * Les écarts et médias ajoutés après le verrouillage relèvent du suivi et sont tracés au journal.
 */
const DEVIATION_CONSTAT = ['id', 'number', 'date', 'time', 'itemId', 'itemCode', 'requirement', 'docRefs', 'description', 'auditorObservation', 'criticalityCode', 'typeCode', 'immediateAction', 'correctiveActionRequested', 'location', 'source', 'alertCode'];
export function auditContent(audit) {
  const lockedAt = audit.lock?.lockedAt || null;
  const before = e => !lockedAt || String(e.createdAt || '') <= lockedAt;
  const deviations = auditDeviations(audit.id).filter(before).map(d => Object.fromEntries(DEVIATION_CONSTAT.map(k => [k, d[k] ?? null])));
  const media = auditMedia(audit.id).filter(m => m.link?.type !== 'signature' && before(m))
    .map(m => ({ id: m.id, sha256: m.sha256, link: m.link, takenAt: m.takenAt, derivedFrom: m.derivedFrom || null })).sort((a, b) => a.id.localeCompare(b.id));
  const { signatures, lock, amendments, reports, status, endedAt, updatedAt, updatedBy, updatedByName, _rev, _lv, _conflict, dismissedAlerts, ...content } = audit;
  return { audit: content, deviations, media };
}
export async function auditContentHash(audit) { return sha256Hex(canonicalJSON(auditContent(audit))); }

export async function finishAudit(audit) {
  return updateAudit(audit, a => { a.endedAt = a.endedAt || nowISO(); a.status = 'termine'; }, { action: 'finish' });
}
export async function reopenAudit(audit) {
  if (audit.lock?.lockedAt) throw new Error('Audit verrouillé');
  return updateAudit(audit, a => { a.status = 'en_cours'; a.endedAt = null; a.signatures = {}; }, { action: 'reopen', reason: 'Réouverture avant signature' });
}

/** Enregistre une signature (role : 'auditor' | 'provider'). */
export async function signAudit(audit, role, { bytes, mime, name, fn = '', refused = false, comment = '' }) {
  const contentHash = await auditContentHash(audit);
  let media = null;
  if (bytes) media = await saveMedia(bytes, { mime, kind: 'signature', name: `signature-${role}.png`, link: { type: 'signature', id: audit.id, itemId: role }, auditId: audit.id });
  const sig = { role, name, function: fn, at: nowISO(), mediaId: media?.id || null, mediaSha256: media?.sha256 || null, refused, comment, contentHash, userId: role === 'auditor' ? session.user.id : null, deviceId: session.device.id, offline: !navigator.onLine };
  return updateAudit(audit, a => { a.signatures = { ...(a.signatures || {}), [role]: sig }; }, { action: 'sign' });
}

/** Verrouille l'audit signé : empreinte SHA-256 du contenu probant, plus aucune modification sans trace. */
export async function lockAudit(audit) {
  const a = store.get('audit', audit.id);
  if (!a.signatures?.auditor) throw new Error('La signature de l’auditeur est requise.');
  if (!a.signatures?.provider) throw new Error('La signature du représentant du prestataire (ou son refus motivé) est requise.');
  const contentHash = await auditContentHash(a);
  if (a.signatures.auditor.contentHash !== contentHash) throw new Error('Le contenu a été modifié après la signature de l’auditeur : faites signer à nouveau.');
  const lock = { lockedAt: nowISO(), lockedBy: session.user.id, lockedByName: session.user.name, contentHash, appVersion: appVersion(), deviceId: session.device.id };
  const saved = await store.put('audit', { ...a, lock, status: 'signe', endedAt: a.endedAt || nowISO() }, { action: 'lock', reason: 'Signature et verrouillage de l’audit' });
  if (a.prestationId) {
    const p = store.get('prestation', a.prestationId);
    const devs = auditDeviations(a.id).filter(d => d.status !== 'annule' && d.criticalityCode !== 'OBS');
    if (p) await setPrestationStatus(p, devs.length ? 'realisee_ecart' : 'auditee', `Audit ${a.number} signé${devs.length ? ` — ${devs.length} écart(s)` : ''}`);
  }
  return saved;
}

/** Vérifie l'intégrité d'un audit signé : empreinte actuelle vs empreinte scellée / dernier amendement. */
export async function verifyAuditSeal(audit) {
  if (!audit.lock?.lockedAt) return { locked: false };
  const current = await auditContentHash(audit);
  const amendments = audit.amendments || [];
  const expected = amendments.length ? amendments[amendments.length - 1].hashAfter : audit.lock.contentHash;
  return {
    locked: true, current, sealed: audit.lock.contentHash, expected, ok: current === expected,
    amended: amendments.length > 0, amendments: amendments.length,
    message: current === expected
      ? (amendments.length ? `Contenu intègre — ${amendments.length} modification(s) après signature, toutes tracées.` : 'Contenu intègre — identique au contenu signé.')
      : 'ATTENTION : le contenu ne correspond pas à l’empreinte enregistrée (modification non tracée).'
  };
}

export async function abandonAudit(audit, reason) {
  if (audit.lock?.lockedAt) throw new Error('Un audit signé ne peut pas être abandonné.');
  if (!(audit.auditorId === session.user.id || can('audit.delete'))) throw new Error('Droit insuffisant.');
  return updateAudit(audit, a => { a.status = 'abandonne'; a.abandonReason = reason; a.endedAt = nowISO(); }, { action: 'abandon', reason });
}

/** Réponses éventuelles « par défaut » d'un critère à partir des données connues (aide à la saisie). */
export function itemByCode(audit, code) { return allItems(audit.gridSnapshot).find(i => i.code === code) || null; }
