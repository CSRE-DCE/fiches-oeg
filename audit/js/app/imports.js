/* Imports : calendriers de prestations et référentiels, depuis Excel, CSV, iCalendar, une API JSON,
 * un calendrier partagé (URL .ics), le programme des fiches terrain OEG ou une saisie manuelle.
 * Étapes : lecture → correspondance des colonnes → prévisualisation (nouveau / modifié / inchangé /
 * erreur) → application. Chaque import est enregistré (lot d'import tracé, empreinte du fichier). */
import { store } from '../core/store.js';
import { session } from '../core/session.js';
import { uuid, nowISO, normalize, sha256Hex, deepEqual } from '../core/util.js';
import { META_FIELDS } from '../core/store.js';
import { parseCSV } from '../formats/csv.js';
import { parseICS, expandEvents } from '../formats/ics.js';
import { readXLSX, sheetToTable } from '../formats/xlsx.js';
import { parseDate, parseTime, parseNumber, parseList, parseBool, guessMapping, resolveRef } from '../domain/normalize.js';
import { PRESTATION_STATUS, CONTROL_LEVELS, PROVIDER_KINDS, DOC_TYPES, DOC_STATUS, EQUIPMENT_STATUS } from '../domain/model.js';
import { utmToLatLon } from '../../../js/geo.js';

const statusFromLabel = (map, v) => { const n = normalize(v); return Object.keys(map).find(k => normalize(k) === n || normalize(map[k]?.label || map[k]) === n) || null; };

/* ---------- Définition des cibles ---------- */
export const TARGETS = {
  prestation: {
    label: 'Prestations programmées (calendrier)', type: 'prestation',
    fields: [
      { key: 'ref', label: 'Référence', hints: ['reference', 'ref', 'id', 'numero', 'uid', 'identifiant'] },
      { key: 'plannedDate', label: 'Date prévue', required: true, hints: ['date prevue', 'date', 'jour', 'date debut', 'start', 'debut'] },
      { key: 'plannedTime', label: 'Heure prévue', hints: ['heure', 'horaire', 'heure prevue', 'time'] },
      { key: 'site', label: 'Site / station (code ou nom)', required: true, hints: ['site', 'station', 'code station', 'lieu', 'location', 'point', 'nom station'] },
      { key: 'point', label: 'Point (code)', hints: ['point', 'code point'] },
      { key: 'provider', label: 'Prestataire / organisme', required: true, hints: ['prestataire', 'organisme', 'titulaire', 'operateur', 'categories', 'intervenant'] },
      { key: 'partner', label: 'Partenaire', hints: ['partenaire'] },
      { key: 'operators', label: 'Opérateurs (codes, séparés par « ; »)', hints: ['operateurs', 'preleveurs', 'equipe preleveurs', 'agents'] },
      { key: 'samplingType', label: 'Type de prélèvement', hints: ['type de prelevement', 'type prelevement', 'prestation', 'type'] },
      { key: 'matrix', label: 'Matrice', hints: ['matrice', 'milieu'] },
      { key: 'campaign', label: 'Campagne / session', hints: ['campagne', 'session'] },
      { key: 'marketRef', label: 'Référence du marché', hints: ['marche', 'reference marche', 'contrat'] },
      { key: 'protocol', label: 'Protocole (clé ou référence)', hints: ['protocole'] },
      { key: 'cctp', label: 'CCTP (clé ou référence)', hints: ['cctp', 'cahier des charges'] },
      { key: 'method', label: 'Méthode', hints: ['methode', 'norme'] },
      { key: 'frequency', label: 'Fréquence', hints: ['frequence', 'periodicite'] },
      { key: 'controlLevel', label: 'Niveau de contrôle', hints: ['niveau de controle', 'controle'] },
      { key: 'team', label: 'Équipe', hints: ['equipe'] },
      { key: 'status', label: 'Statut', hints: ['statut', 'etat', 'status'] },
      { key: 'notes', label: 'Remarques', hints: ['remarque', 'commentaire', 'description', 'notes', 'resume', 'summary'] }
    ]
  },
  site: {
    label: 'Sites', type: 'site',
    fields: [
      { key: 'code', label: 'Code', required: true, hints: ['code', 'code station', 'code sandre', 'code bss', 'identifiant'] },
      { key: 'name', label: 'Nom', required: true, hints: ['nom', 'station', 'libelle', 'site'] },
      { key: 'networks', label: 'Réseau(x)', hints: ['reseau', 'reseaux', 'marche'] },
      { key: 'kind', label: 'Nature (cours d’eau, forage…)', hints: ['nature', 'type'] },
      { key: 'commune', label: 'Commune', hints: ['commune', 'ville'] },
      { key: 'bassin', label: 'Bassin versant', hints: ['bassin', 'bv'] },
      { key: 'masseEau', label: 'Masse d’eau', hints: ['masse', 'code me', 'masse d eau'] },
      { key: 'lat', label: 'Latitude (WGS84)', hints: ['latitude', 'lat'] },
      { key: 'lon', label: 'Longitude (WGS84)', hints: ['longitude', 'lon', 'lng'] },
      { key: 'x', label: 'X (RGFG95 / UTM 22N)', hints: ['x', 'x l93', 'easting'] },
      { key: 'y', label: 'Y (RGFG95 / UTM 22N)', hints: ['y', 'northing'] }
    ]
  },
  point: {
    label: 'Points de prélèvement', type: 'point',
    fields: [
      { key: 'site', label: 'Site (code)', required: true, hints: ['site', 'code site', 'station'] },
      { key: 'code', label: 'Code du point', required: true, hints: ['code point', 'code', 'point'] },
      { key: 'name', label: 'Nom / description courte', hints: ['nom', 'libelle'] },
      { key: 'lat', label: 'Latitude', hints: ['latitude', 'lat'] },
      { key: 'lon', label: 'Longitude', hints: ['longitude', 'lon'] },
      { key: 'description', label: 'Description / accès', hints: ['description', 'acces'] },
      { key: 'gpsThreshold', label: 'Seuil d’écart GPS (m)', hints: ['seuil', 'tolerance'] }
    ]
  },
  provider: {
    label: 'Prestataires / partenaires', type: 'provider',
    fields: [
      { key: 'code', label: 'Code', required: true, hints: ['code', 'sigle'] },
      { key: 'name', label: 'Raison sociale', required: true, hints: ['nom', 'raison sociale', 'prestataire', 'organisme'] },
      { key: 'kind', label: 'Nature (régie / prestataire / partenaire)', hints: ['nature', 'type'] },
      { key: 'address', label: 'Adresse', hints: ['adresse'] },
      { key: 'phone', label: 'Téléphone', hints: ['telephone', 'tel'] },
      { key: 'email', label: 'Courriel', hints: ['mail', 'courriel', 'email'] },
      { key: 'contractRef', label: 'Référence du marché', hints: ['marche', 'contrat'] },
      { key: 'contractStart', label: 'Début du marché', hints: ['debut'] },
      { key: 'contractEnd', label: 'Fin du marché', hints: ['fin'] }
    ]
  },
  operator: {
    label: 'Opérateurs et habilitations', type: 'operator',
    fields: [
      { key: 'provider', label: 'Prestataire (code ou nom)', required: true, hints: ['prestataire', 'organisme'] },
      { key: 'code', label: 'Code / initiales', required: true, hints: ['code', 'initiales', 'trigramme'] },
      { key: 'lastName', label: 'Nom', hints: ['nom'] },
      { key: 'firstName', label: 'Prénom', hints: ['prenom'] },
      { key: 'function', label: 'Fonction', hints: ['fonction', 'poste'] },
      { key: 'habilitation', label: 'Habilitation', hints: ['habilitation', 'qualification'] },
      { key: 'habilitationRef', label: 'Référence de l’habilitation', hints: ['reference habilitation', 'numero habilitation'] },
      { key: 'habilitationValidUntil', label: 'Validité de l’habilitation', hints: ['validite', 'echeance', 'expiration'] }
    ]
  },
  equipment: {
    label: 'Équipements', type: 'equipment',
    fields: [
      { key: 'inventoryNo', label: 'N° d’inventaire', required: true, hints: ['inventaire', 'gmao', 'code interne', 'code'] },
      { key: 'provider', label: 'Prestataire (code ou nom)', hints: ['prestataire', 'organisme', 'proprietaire'] },
      { key: 'label', label: 'Désignation', hints: ['designation', 'nom', 'libelle'] },
      { key: 'category', label: 'Catégorie (mesure / prélèvement)', hints: ['categorie', 'type'] },
      { key: 'brand', label: 'Marque', hints: ['marque', 'fabricant'] },
      { key: 'model', label: 'Modèle', hints: ['modele'] },
      { key: 'serial', label: 'N° de série', hints: ['serie', 'numero de serie', 'sn'] },
      { key: 'lastCheckDate', label: 'Date de vérification', hints: ['verification', 'date verification'] },
      { key: 'calibrationDate', label: 'Date d’étalonnage', hints: ['etalonnage', 'date etalonnage'] },
      { key: 'validUntil', label: 'Date de validité', hints: ['validite', 'echeance'] },
      { key: 'certificateRef', label: 'Certificat', hints: ['certificat', 'constat'] },
      { key: 'status', label: 'Statut', hints: ['statut', 'etat'] }
    ]
  },
  document: {
    label: 'Documents (métadonnées : CCTP, protocoles…)', type: 'document',
    fields: [
      { key: 'docKey', label: 'Clé du document', required: true, hints: ['cle', 'code', 'identifiant'] },
      { key: 'type', label: 'Type', required: true, hints: ['type'] },
      { key: 'name', label: 'Intitulé', required: true, hints: ['nom', 'intitule', 'titre'] },
      { key: 'reference', label: 'Référence', hints: ['reference'] },
      { key: 'version', label: 'Version', required: true, hints: ['version', 'indice'] },
      { key: 'applicableFrom', label: 'Date d’application', hints: ['application', 'debut', 'date d application'] },
      { key: 'applicableTo', label: 'Fin de validité', hints: ['fin', 'fin de validite'] },
      { key: 'status', label: 'Statut', hints: ['statut'] }
    ]
  }
};

/* ---------- Lecture des sources ---------- */
/** Retourne {headers, rows (tableaux), sha256, name, kind}. */
export async function readSource({ file = null, text = null, url = null, kind = null }) {
  let name = file?.name || url || 'saisie';
  let buffer = null;
  if (file) buffer = await file.arrayBuffer();
  if (url) {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`Source inaccessible (${res.status})`);
    buffer = await res.arrayBuffer();
  }
  const bytes = buffer ? new Uint8Array(buffer) : new TextEncoder().encode(text || '');
  const sha256 = await sha256Hex(bytes);
  const lower = String(name).toLowerCase();
  kind = kind || (lower.endsWith('.xlsx') || lower.endsWith('.xlsm') ? 'xlsx' : lower.endsWith('.ics') || lower.includes('ical') ? 'ics' : lower.endsWith('.json') ? 'json' : (bytes[0] === 0x50 && bytes[1] === 0x4B) ? 'xlsx' : 'csv');
  const asText = () => new TextDecoder().decode(bytes);
  if (kind === 'xlsx') {
    const wb = await readXLSX(buffer);
    const sheet = wb.sheets.find(s => sheetToTable(s.rows).rows.length) || wb.sheets[0];
    const t = sheetToTable(sheet?.rows || []);
    return { kind, name, sha256, sheet: sheet?.name, sheets: wb.sheets.map(s => s.name), headers: t.headers, rows: t.rows };
  }
  if (kind === 'ics' || /BEGIN:VCALENDAR/.test(asText().slice(0, 200))) {
    const events = expandEvents(parseICS(asText()), { max: 400 });
    const headers = ['UID', 'Résumé', 'Lieu', 'Description', 'Catégories', 'Date', 'Heure', 'Statut'];
    return { kind: 'ics', name, sha256, headers, rows: events.map(e => [e.uid || '', e.summary || '', e.location || '', e.description || '', (e.categories || []).join(', '), e.start?.date || '', e.start?.time || '', e.status || '']) };
  }
  if (kind === 'json') {
    let data = JSON.parse(asText());
    if (!Array.isArray(data)) data = data.items || data.data || data.prestations || data.results || [];
    const headers = [...new Set(data.flatMap(o => Object.keys(o || {})))];
    return { kind, name, sha256, headers, rows: data.map(o => headers.map(h => typeof o[h] === 'object' && o[h] !== null ? JSON.stringify(o[h]) : o[h] ?? '')) };
  }
  const rows = parseCSV(asText());
  const headerIdx = rows.findIndex(r => r.filter(c => String(c).trim()).length >= 2);
  return { kind: 'csv', name, sha256, headers: (rows[headerIdx] || []).map(h => String(h).trim()), rows: rows.slice(headerIdx + 1) };
}

export function suggestMapping(target, headers) { return guessMapping(headers, TARGETS[target].fields); }

/* ---------- Construction des entités ---------- */
const get = (row, mapping, key) => mapping[key] === undefined || mapping[key] === '' || mapping[key] === null ? '' : (row[Number(mapping[key])] ?? '');
const refs = {
  site: v => resolveRef(store.all('site'), v, { keys: ['code', 'name'] }),
  provider: v => resolveRef(store.all('provider'), v, { keys: ['code', 'name'] }),
  campaign: v => resolveRef(store.all('campaign'), v, { keys: ['code', 'label'] }),
  samplingType: v => resolveRef(store.all('samplingType'), v, { keys: ['code', 'label'] }),
  matrix: v => resolveRef(store.all('matrix'), v, { keys: ['code', 'label'] }),
  method: v => resolveRef(store.all('method'), v, { keys: ['code', 'reference', 'label'] }),
  docKey: v => { if (!v) return null; const d = resolveRef(store.all('document'), v, { keys: ['docKey', 'reference', 'name'] }); return d?.docKey || null; }
};

function buildPrestation(row, mapping, ctx) {
  const errors = [], warnings = [];
  const plannedDate = parseDate(get(row, mapping, 'plannedDate'));
  if (!plannedDate) errors.push('date prévue absente ou invalide');
  const siteRaw = get(row, mapping, 'site');
  const site = refs.site(siteRaw);
  if (!site) errors.push(`site « ${siteRaw} » introuvable dans le référentiel`);
  const provRaw = get(row, mapping, 'provider');
  const provider = refs.provider(provRaw);
  if (!provider) errors.push(`prestataire « ${provRaw} » introuvable`);
  const partner = get(row, mapping, 'partner') ? refs.provider(get(row, mapping, 'partner')) : null;
  const pointRaw = get(row, mapping, 'point');
  const points = site ? store.filter('point', p => p.siteId === site.id) : [];
  const point = pointRaw ? resolveRef(points, pointRaw, { keys: ['code', 'name'] }) : points[0];
  if (pointRaw && !point) warnings.push(`point « ${pointRaw} » introuvable : point principal du site retenu`);
  const operators = parseList(get(row, mapping, 'operators')).map(c => resolveRef(store.filter('operator', o => !provider || o.providerId === provider.id), c, { keys: ['code', 'lastName'] }));
  if (operators.some(o => !o)) warnings.push('opérateur(s) non reconnu(s) ignoré(s)');
  const st = get(row, mapping, 'samplingType'), mx = get(row, mapping, 'matrix'), cp = get(row, mapping, 'campaign');
  const samplingType = st ? refs.samplingType(st) : null; if (st && !samplingType) warnings.push(`type de prélèvement « ${st} » non reconnu`);
  const matrix = mx ? refs.matrix(mx) : (site?.matrixId ? { id: site.matrixId } : null);
  const campaign = cp ? refs.campaign(cp) : null; if (cp && !campaign) warnings.push(`campagne « ${cp} » non reconnue`);
  const status = statusFromLabel(PRESTATION_STATUS, get(row, mapping, 'status')) || 'prevue';
  const controlLevel = statusFromLabel(CONTROL_LEVELS, get(row, mapping, 'controlLevel')) || 'complet';
  const ref = String(get(row, mapping, 'ref') || '').trim() || `${site?.code || 'SITE'}-${plannedDate}`;
  const externalId = `${ctx.sourceKey}|${ref}`;
  const entity = {
    ref, marketRef: String(get(row, mapping, 'marketRef') || ''), campaignId: campaign?.id || null, siteId: site?.id || null, pointIds: point ? [point.id] : [],
    plannedDate, plannedTime: parseTime(get(row, mapping, 'plannedTime')), dateIndicative: false, frequency: String(get(row, mapping, 'frequency') || ''),
    samplingTypeId: samplingType?.id || null, matrixId: matrix?.id || null, providerId: provider?.id || null, partnerId: partner?.id || null,
    operatorIds: operators.filter(Boolean).map(o => o.id), team: String(get(row, mapping, 'team') || ''),
    protocolDocKey: refs.docKey(get(row, mapping, 'protocol')) || '', cctpDocKey: refs.docKey(get(row, mapping, 'cctp')) || '', methodId: refs.method(get(row, mapping, 'method'))?.id || '',
    controlLevel, status, notes: String(get(row, mapping, 'notes') || ''),
    source: { kind: ctx.kind, label: ctx.name, externalId, importedAt: nowISO() }
  };
  const existing = store.find('prestation', p => p.source?.externalId === externalId) || store.find('prestation', p => p.ref === ref && p.siteId === entity.siteId);
  return { entity, existing, errors, warnings, keepFromExisting: ['statusHistory', 'status'] };
}
function buildSite(row, mapping) {
  const errors = [];
  const code = String(get(row, mapping, 'code')).trim(), name = String(get(row, mapping, 'name')).trim();
  if (!code) errors.push('code manquant'); if (!name) errors.push('nom manquant');
  let lat = parseNumber(get(row, mapping, 'lat')), lon = parseNumber(get(row, mapping, 'lon'));
  const x = parseNumber(get(row, mapping, 'x')), y = parseNumber(get(row, mapping, 'y'));
  if ((lat === null || lon === null) && x !== null && y !== null) [lat, lon] = utmToLatLon(x, y, 22);
  const existing = store.find('site', s => s.code === code);
  const entity = { id: existing?.id || 'site-' + code, code, name, networks: parseList(get(row, mapping, 'networks')), kind: String(get(row, mapping, 'kind') || existing?.kind || ''), commune: String(get(row, mapping, 'commune') || ''), bassin: String(get(row, mapping, 'bassin') || ''), masseEau: String(get(row, mapping, 'masseEau') || ''), lat: lat !== null ? +lat.toFixed(6) : null, lon: lon !== null ? +lon.toFixed(6) : null, x, y };
  return { entity, existing, errors, warnings: [], extra: existing ? null : { type: 'point', entity: { id: 'pt-' + code, siteId: entity.id, code, name: 'Point de prélèvement ' + name, lat: entity.lat, lon: entity.lon } } };
}
function buildPoint(row, mapping) {
  const errors = [];
  const site = refs.site(get(row, mapping, 'site'));
  if (!site) errors.push('site introuvable');
  const code = String(get(row, mapping, 'code')).trim(); if (!code) errors.push('code manquant');
  const existing = site ? store.find('point', p => p.siteId === site.id && p.code === code) : null;
  const entity = { id: existing?.id, siteId: site?.id, code, name: String(get(row, mapping, 'name') || existing?.name || code), lat: parseNumber(get(row, mapping, 'lat')), lon: parseNumber(get(row, mapping, 'lon')), description: String(get(row, mapping, 'description') || ''), gpsThreshold: parseNumber(get(row, mapping, 'gpsThreshold')) };
  return { entity, existing, errors, warnings: [] };
}
function buildProvider(row, mapping) {
  const errors = [];
  const code = String(get(row, mapping, 'code')).trim(), name = String(get(row, mapping, 'name')).trim();
  if (!code) errors.push('code manquant'); if (!name) errors.push('raison sociale manquante');
  const kind = statusFromLabel(PROVIDER_KINDS, get(row, mapping, 'kind')) || (normalize(get(row, mapping, 'kind')).includes('regie') ? 'regie' : 'prestataire');
  const existing = store.find('provider', p => p.code === code) || store.find('provider', p => normalize(p.name) === normalize(name));
  const contracts = [...(existing?.contracts || [])];
  const cref = String(get(row, mapping, 'contractRef') || '').trim();
  if (cref && !contracts.some(c => c.ref === cref)) contracts.push({ id: uuid(), ref: cref, label: '', start: parseDate(get(row, mapping, 'contractStart')), end: parseDate(get(row, mapping, 'contractEnd')), lots: '' });
  const entity = { id: existing?.id || 'prov-' + code.replace(/[^\w-]/g, '_'), code, name, kind, address: String(get(row, mapping, 'address') || existing?.address || ''), phone: String(get(row, mapping, 'phone') || existing?.phone || ''), email: String(get(row, mapping, 'email') || existing?.email || ''), contracts, active: true };
  return { entity, existing, errors, warnings: [] };
}
function buildOperator(row, mapping) {
  const errors = [];
  const provider = refs.provider(get(row, mapping, 'provider'));
  if (!provider) errors.push('prestataire introuvable');
  const code = String(get(row, mapping, 'code')).trim(); if (!code) errors.push('code manquant');
  const existing = provider ? store.find('operator', o => o.providerId === provider.id && o.code === code) : null;
  const quals = [...(existing?.qualifications || [])];
  const hab = String(get(row, mapping, 'habilitation') || '').trim();
  if (hab) {
    const validUntil = parseDate(get(row, mapping, 'habilitationValidUntil'));
    const ref = String(get(row, mapping, 'habilitationRef') || '');
    const q = quals.find(x => normalize(x.label) === normalize(hab));
    if (q) Object.assign(q, { validUntil: validUntil || q.validUntil, ref: ref || q.ref }); else quals.push({ id: uuid(), type: 'habilitation', label: hab, ref, obtainedAt: '', validUntil, samplingTypeIds: [] });
  }
  const entity = { id: existing?.id || `op-${provider?.code || 'X'}-${code}`, providerId: provider?.id, code, lastName: String(get(row, mapping, 'lastName') || existing?.lastName || code), firstName: String(get(row, mapping, 'firstName') || existing?.firstName || ''), function: String(get(row, mapping, 'function') || existing?.function || ''), qualifications: quals, active: true };
  return { entity, existing, errors, warnings: [] };
}
function buildEquipment(row, mapping) {
  const errors = [];
  const inv = String(get(row, mapping, 'inventoryNo')).trim(); if (!inv) errors.push('n° d’inventaire manquant');
  const provider = get(row, mapping, 'provider') ? refs.provider(get(row, mapping, 'provider')) : null;
  const existing = store.find('equipment', e => e.inventoryNo === inv);
  const cat = normalize(get(row, mapping, 'category'));
  const entity = { id: existing?.id, inventoryNo: inv, providerId: provider?.id || existing?.providerId || null, label: String(get(row, mapping, 'label') || existing?.label || ''), category: cat.includes('prel') ? 'prelevement' : 'mesure', brand: String(get(row, mapping, 'brand') || ''), model: String(get(row, mapping, 'model') || ''), serial: String(get(row, mapping, 'serial') || ''), lastCheckDate: parseDate(get(row, mapping, 'lastCheckDate')), calibrationDate: parseDate(get(row, mapping, 'calibrationDate')), calibrationRequired: !!parseDate(get(row, mapping, 'calibrationDate')) || !!existing?.calibrationRequired, validUntil: parseDate(get(row, mapping, 'validUntil')), certificateRef: String(get(row, mapping, 'certificateRef') || ''), status: statusFromLabel(EQUIPMENT_STATUS, get(row, mapping, 'status')) || existing?.status || 'service' };
  return { entity, existing, errors, warnings: [] };
}
function buildDocument(row, mapping) {
  const errors = [];
  const docKey = String(get(row, mapping, 'docKey')).trim(), version = String(get(row, mapping, 'version')).trim();
  const type = statusFromLabel(DOC_TYPES, get(row, mapping, 'type')) || Object.keys(DOC_TYPES).find(k => normalize(get(row, mapping, 'type')).includes(normalize(k))) || 'AUTRE';
  if (!docKey) errors.push('clé manquante'); if (!version) errors.push('version manquante');
  const existing = store.find('document', d => d.docKey === docKey && String(d.version) === version);
  if (existing && existing.status === 'en_vigueur') errors.push('cette version est en vigueur : elle ne peut pas être modifiée (créez une nouvelle version)');
  const entity = { id: existing?.id, docKey, type, name: String(get(row, mapping, 'name')), reference: String(get(row, mapping, 'reference') || docKey), version, applicableFrom: parseDate(get(row, mapping, 'applicableFrom')), applicableTo: parseDate(get(row, mapping, 'applicableTo')), status: statusFromLabel(DOC_STATUS, get(row, mapping, 'status')) || 'brouillon', providerIds: [], samplingTypeIds: [], articles: existing?.articles || [] };
  return { entity, existing, errors, warnings: [] };
}
const BUILDERS = { prestation: buildPrestation, site: buildSite, point: buildPoint, provider: buildProvider, operator: buildOperator, equipment: buildEquipment, document: buildDocument };

function sameContent(existing, entity, keep = []) {
  const a = {}, b = {};
  for (const k of Object.keys(entity)) { if (META_FIELDS.includes(k) || k === 'id' || k === 'source' || keep.includes(k)) continue; a[k] = existing?.[k] ?? null; b[k] = entity[k] ?? null; }
  return deepEqual(a, b);
}

/** Prévisualisation : [{row, status:'new'|'update'|'same'|'error', entity, existing, errors, warnings}] */
export function previewImport(target, source, mapping) {
  const ctx = { kind: source.kind, name: source.name, sourceKey: source.sourceKey || normalize(source.name).replace(/\s+/g, '-') };
  const seen = new Set();
  return source.rows.map((row, i) => {
    const r = BUILDERS[target](row, mapping, ctx);
    let status = r.errors.length ? 'error' : !r.existing ? 'new' : sameContent(r.existing, r.entity, r.keepFromExisting) ? 'same' : 'update';
    const dupKey = JSON.stringify([r.entity.ref, r.entity.code, r.entity.inventoryNo, r.entity.docKey, r.entity.version, r.entity.siteId, r.entity.plannedDate]);
    if (status !== 'error' && seen.has(dupKey)) { r.errors.push('ligne en double dans le fichier'); status = 'error'; }
    seen.add(dupKey);
    return { index: i + 1, row, status, ...r };
  });
}

/** Applique les lignes sélectionnées et enregistre le lot d'import. */
export async function applyImport(target, source, preview, selected = null) {
  const type = TARGETS[target].type;
  const rows = preview.filter(p => (p.status === 'new' || p.status === 'update') && (!selected || selected.has(p.index)));
  const batchId = uuid();
  const list = [], extras = [];
  for (const p of rows) {
    const keep = {};
    for (const k of p.keepFromExisting || []) if (p.existing?.[k] !== undefined) keep[k] = p.existing[k];
    const e = { ...(p.existing || {}), ...p.entity, ...keep, id: p.existing?.id || p.entity.id || uuid() };
    if (type === 'prestation') { e.source = { ...e.source, importId: batchId }; if (!p.existing) e.statusHistory = [{ at: nowISO(), by: session.user.name, event: 'import', label: `Importée depuis ${source.name}` }]; }
    list.push(e);
    if (p.extra) extras.push(p.extra);
  }
  const reason = `Import ${TARGETS[target].label} depuis ${source.name}`;
  await store.bulkPut(type, list, { reason, label: `${list.length} ${TARGETS[target].label.toLowerCase()}` });
  for (const x of extras) await store.bulkPut(x.type, [x.entity], { reason });
  const counts = { new: rows.filter(r => r.status === 'new').length, update: rows.filter(r => r.status === 'update').length, same: preview.filter(r => r.status === 'same').length, error: preview.filter(r => r.status === 'error').length };
  await store.put('importBatch', { id: batchId, at: nowISO(), by: session.user.name, target, source: { kind: source.kind, name: source.name, sha256: source.sha256, sheet: source.sheet || null, url: source.url || null }, counts, ids: list.map(e => e.id) }, { action: 'import', reason });
  return counts;
}
