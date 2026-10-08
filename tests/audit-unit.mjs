/* Tests unitaires de la PWA d'audit (modules purs) — node --test tests/audit-unit.mjs
 * Couvre : logique conditionnelle des grilles, avancement et complétude, alertes, synthèse,
 * comparaison, fusion à trois versions, formats (CSV, ICS, XLSX, PDF), normalisation, référentiel
 * initial, droits, chaîne d'empreintes du journal. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { evalCondition, itemIndex, visibleStructure, progress, validateResponses, validateGrid, rankGrids, allItems } from '../audit/js/domain/grids.js';
import { computeAlerts, operatorStatus, equipmentStatus } from '../audit/js/domain/rules.js';
import { auditSummary, recurringDeviations, isOverdue } from '../audit/js/domain/summary.js';
import { compareAudits } from '../audit/js/domain/compare.js';
import { mergeEntity } from '../audit/js/domain/merge.js';
import { GRID_GENERAL, GRID_RAPIDE, DEFAULT_GRIDS } from '../audit/js/domain/default-grids.js';
import { baseReferential, oegReferential, oegProgramme, demoData, parseSessionMonth } from '../audit/js/domain/seed.js';
import { parseDate, parseTime, guessMapping, resolveRef } from '../audit/js/domain/normalize.js';
import { canWrite, roleCan } from '../audit/js/domain/permissions.js';
import { parseCSV, toCSV, detectDelimiter } from '../audit/js/formats/csv.js';
import { parseICS, expandEvents, toICS } from '../audit/js/formats/ics.js';
import { writeXLSX, readXLSX, sheetToTable } from '../audit/js/formats/xlsx.js';
import { PDFDocument, toWinAnsi } from '../audit/js/formats/pdf.js';
import { canonicalJSON, diff, html, raw, haversine } from '../audit/js/core/util.js';
import { trailHash, verifyTrail } from '../audit/js/core/store.js';

const loadDATA = () => { const src = fs.readFileSync(new URL('../js/data.js', import.meta.url), 'utf8').replace(/const LOGO=[^\n]*/, ''); return new Function(src.replace(/^const DATA=/, 'return ').replace(/;\s*$/, ''))(); };
const R = (status, extra = {}) => ({ status, at: '2026-10-08T10:00:00Z', ...extra });

test('grilles par défaut valides', () => {
  for (const g of DEFAULT_GRIDS) assert.deepEqual(validateGrid(g), [], g.code);
  assert.ok(allItems(GRID_GENERAL).length >= 90);
});

test('logique conditionnelle : chaîne du froid affichée seulement si demandée', () => {
  const idx = itemIndex(GRID_GENERAL);
  const vis = resp => visibleStructure(GRID_GENERAL, resp, {}).find(s => s.id === 'sec-transport').visibleItems.map(i => i.code);
  assert.ok(!vis({}).includes('T07'));
  assert.ok(vis({ 'it-T00': { value: true } }).includes('T07'));
  assert.ok(!vis({ 'it-T00': { value: false } }).includes('T07'));
  assert.equal(evalCondition({ ctx: 'matrixCode', op: 'eq', value: 'ESO' }, {}, idx, { matrixCode: 'ESO' }), true);
  assert.equal(evalCondition({ any: [{ item: 'M09', op: 'truthy' }, { ctx: 'auditKind', op: 'eq', value: 'inopine' }] }, {}, idx, { auditKind: 'inopine' }), true);
  // purge du forage uniquement en eau souterraine
  const obs = ctx => visibleStructure(GRID_GENERAL, {}, ctx).find(s => s.id === 'sec-obs').visibleItems.map(i => i.code);
  assert.ok(obs({ matrixCode: 'ESO' }).includes('O14'));
  assert.ok(!obs({ matrixCode: 'ESU' }).includes('O14'));
});

test('avancement et contrôle de complétude (justification obligatoire en cas de NC)', () => {
  const p0 = progress(GRID_RAPIDE, {}, {});
  assert.equal(p0.answered, 0);
  const resp = { 'it-R01': R('NC'), 'it-R02': { value: '2' } };
  const issues = validateResponses(GRID_RAPIDE, resp, {});
  assert.ok(issues.some(i => i.itemId === 'it-R01' && i.level === 'error' && /justification/.test(i.message)));
  assert.ok(issues.some(i => i.itemId === 'it-R03' && /obligatoire/.test(i.message)));
  const issues2 = validateResponses(GRID_RAPIDE, { ...resp, 'it-R01': R('NC', { comment: 'carte absente' }) }, {}, { mediaCounts: { 'it-R01': 1 }, deviationsByItem: { 'it-R01': 1 } });
  assert.ok(!issues2.some(i => i.itemId === 'it-R01'));
  // photo obligatoire satisfaite par un média
  assert.ok(progress(GRID_RAPIDE, {}, {}, { 'it-R05': 1 }).answered === 1);
});

test('sélection des grilles par champ d’application', () => {
  const spec = { ...GRID_RAPIDE, id: 'g-eso', scope: { matrixIds: ['mat-ESO'] } };
  const ranked = rankGrids([GRID_GENERAL, spec], { matrixId: 'mat-ESO' });
  assert.equal(ranked[0].id, 'g-eso');
  assert.deepEqual(rankGrids([GRID_GENERAL, spec], { matrixId: 'mat-ESU' }).map(g => g.id), [GRID_GENERAL.id]);
});

test('alertes : jamais de non-conformité automatique, toutes les situations du cahier des charges', () => {
  const audit = {
    startedAt: '2026-10-08T10:00:00Z', responses: { 'it-T00': { value: true }, 'it-T07': { value: 11 }, 'it-D02': { value: 'v1' }, 'it-M09': { value: true }, 'it-T10': { value: '2026-10-09T15:00' } },
    gps: [{ id: 'g', lat: 4.95, lon: -52.3, accuracy: 10 }], samples: [{ id: 's1', sampleId: 'E01', code: '', date: '2026-10-08', time: '08:00' }],
    equipmentChecks: [{ id: 'e1', label: 'Sonde', inventoryNo: 'X1', validUntil: '2026-01-01', status: 'service' }],
    operatorIds: ['op1'], siteId: 'site-2', providerId: 'p1', documentsSnapshot: [{ type: 'PROTOCOLE', version: '2', reference: 'P' }]
  };
  const alerts = computeAlerts({ audit, grid: GRID_GENERAL, point: { code: 'P', lat: 5.0, lon: -53.0 }, prestation: { id: 'x', siteId: 'site-1', providerId: 'p1', plannedDate: '2026-10-08' }, operators: [{ id: 'op1', firstName: 'A', lastName: 'B', qualifications: [{ type: 'habilitation', label: 'H', validUntil: '2025-01-01' }] }], settings: { gpsThresholdM: 100 } });
  const codes = alerts.map(a => a.code);
  for (const c of ['GPS_FAR', 'EQUIPMENT_INVALID', 'SAMPLE_UNIDENTIFIED', 'OPERATOR_NOT_QUALIFIED', 'PRESTATION_DIFFERENT', 'TEMP_OUT', 'PROTOCOL_WRONG', 'MATERIAL_MISSING', 'DELAY_EXCEEDED']) assert.ok(codes.includes(c), c);
  assert.ok(alerts.every(a => !('status' in a)), 'une alerte ne porte aucune réponse de conformité');
  assert.equal(alerts[0].level, 'critique');
  const missing = computeAlerts({ audit: { responses: {} }, grid: GRID_RAPIDE, includeMissing: true });
  assert.ok(missing.some(a => a.code === 'REQUIRED_MISSING'));
});

test('habilitations et équipements', () => {
  assert.equal(operatorStatus({ qualifications: [{ type: 'habilitation', validUntil: '2027-01-01' }] }, '2026-10-08').ok, true);
  assert.equal(operatorStatus({ qualifications: [] }, '2026-10-08').ok, false);
  assert.equal(equipmentStatus({ inventoryNo: 'A', status: 'service', validUntil: '2027-01-01' }, '2026-10-08').ok, true);
  assert.equal(equipmentStatus({ inventoryNo: 'A', status: 'hors_service' }, '2026-10-08').level, 'critique');
});

test('synthèse factuelle sans score, écarts récurrents, retards', () => {
  const crit = baseReferential().criticality;
  const s = auditSummary({ audit: { responses: { 'it-R01': R('C'), 'it-R03': R('NC', { comment: 'x' }), 'it-R04': R('NA') } }, grid: GRID_RAPIDE, deviations: [{ criticalityCode: 'MAJ' }], criticalities: crit });
  assert.equal(s.counts.C, 1); assert.equal(s.counts.NC, 1); assert.equal(s.counts.NA, 1);
  assert.equal(s.byCriticality.find(c => c.code === 'MAJ').count, 1);
  assert.ok(!('score' in s));
  const rec = recurringDeviations([{ providerId: 'p', itemCode: 'Q04', auditId: 'a1', status: 'clos' }, { providerId: 'p', itemCode: 'Q04', auditId: 'a2', status: 'ouvert' }, { providerId: 'p', itemCode: 'Q05', auditId: 'a2', status: 'ouvert' }]);
  assert.equal(rec.length, 1); assert.equal(rec[0].open, 1);
  assert.equal(isOverdue({ status: 'ouvert', dueDate: '2026-01-01' }, '2026-10-08'), true);
  assert.equal(isOverdue({ status: 'clos', dueDate: '2026-01-01' }, '2026-10-08'), false);
});

test('comparaison de deux audits successifs', () => {
  const a = { gridSnapshot: GRID_RAPIDE, responses: { 'it-R01': R('NC'), 'it-R03': R('C'), 'it-R04': R('NC') } };
  const b = { gridSnapshot: GRID_RAPIDE, responses: { 'it-R01': R('C'), 'it-R03': R('NC'), 'it-R04': R('NC') } };
  const r = compareAudits(a, b);
  assert.equal(r.stats.amelioration, 1); assert.equal(r.stats.degradation, 1);
  assert.deepEqual(r.persistent.map(x => x.code), ['R04']);
});

test('fusion à trois versions : champs disjoints conservés, concurrence tracée, verrou préservé', () => {
  const base = { id: 'a', responses: { q1: { status: 'C', at: '1' } }, samples: [{ id: 's1', code: 'A' }] };
  const local = { ...base, updatedAt: '2026-10-08T10:00:00Z', responses: { q1: { status: 'NC', at: '2026-10-08T10:00:00Z' }, q2: { status: 'C', at: '2' } }, samples: [{ id: 's1', code: 'A' }, { id: 's2', code: 'B' }] };
  const remote = { ...base, _rev: 5, updatedAt: '2026-10-08T09:00:00Z', responses: { q1: { status: 'NA', at: '2026-10-08T09:00:00Z' }, q3: { status: 'C', at: '3' } }, samples: [{ id: 's1', code: 'A2' }], lock: { lockedAt: 'x' }, status: 'signe' };
  const { merged, conflicts } = mergeEntity('audit', base, local, remote);
  assert.equal(merged.responses.q2.status, 'C'); assert.equal(merged.responses.q3.status, 'C');
  assert.equal(merged.responses.q1.status, 'NC');
  assert.ok(conflicts.some(c => c.path.startsWith('responses.q1') && c.kept === 'local'));
  assert.deepEqual(merged.samples.map(s => s.code).sort(), ['A2', 'B']);
  assert.equal(merged.lock.lockedAt, 'x'); assert.equal(merged.status, 'signe'); assert.equal(merged._rev, 5);
  assert.equal(mergeEntity('trail', null, { id: 't', x: 1 }, { id: 't', x: 1 }).conflicts.length, 0);
});

test('CSV : séparateur, guillemets, injection de formules', () => {
  assert.equal(detectDelimiter('a;b;c\n1;2;3'), ';');
  const rows = parseCSV('﻿Réf;Lieu;Note\nP1;"Crique ""A""; amont";"ligne1\nligne2"\n');
  assert.deepEqual(rows[1], ['P1', 'Crique "A"; amont', 'ligne1\nligne2']);
  const out = toCSV([['a', 'b'], ['=SOMME(A1)', 3.5]]);
  assert.ok(out.includes("'=SOMME(A1)")); assert.ok(out.includes('3,5'));
});

test('iCalendar : lecture, récurrence, écriture', () => {
  const ics = 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:e1\r\nSUMMARY:Prélèvement Mahury\\, aval\r\nDTSTART:20261012T083000\r\nLOCATION:Mahury\r\nRRULE:FREQ=WEEKLY;COUNT=3\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:e2\r\nSUMMARY:Journée\r\nDTSTART;VALUE=DATE:20261020\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n';
  const ev = parseICS(ics);
  assert.equal(ev[0].summary, 'Prélèvement Mahury, aval'); assert.equal(ev[0].start.time, '08:30'); assert.equal(ev[1].start.allDay, true);
  const occ = expandEvents(ev);
  assert.deepEqual(occ.filter(o => o.uid.startsWith('e1')).map(o => o.occurrence), ['2026-10-12', '2026-10-19', '2026-10-26']);
  const back = parseICS(toICS([{ uid: 'x', date: '2026-10-12', time: '08:30', summary: 'A; B, C' }]));
  assert.equal(back[0].summary, 'A; B, C');
});

test('Excel : écriture puis relecture', async () => {
  const bytes = writeXLSX([{ name: 'Prestations', rows: [['Réf', 'Date', 'Nb'], ['P-1', '12/10/2026', 3], ['P-2', 'Crique & <B>', 4.5]] }]);
  assert.equal(bytes[0], 0x50); assert.equal(bytes[1], 0x4B);
  const wb = await readXLSX(bytes.buffer);
  const t = sheetToTable(wb.sheets[0].rows);
  assert.deepEqual(t.headers, ['Réf', 'Date', 'Nb']);
  assert.deepEqual(t.rows[1], ['P-2', 'Crique & <B>', 4.5]);
});

test('PDF : structure valide, table de références croisées exacte', () => {
  const doc = new PDFDocument({ title: 'Rapport d’audit' });
  doc.heading('1. Identification'); doc.keyValues([['Numéro', 'AUD-2026-000001'], ['Température', '5 ± 3 °C — œuvre']]);
  doc.table({ columns: [{ label: 'A', width: 100 }, { label: 'B', width: 300 }], rows: Array.from({ length: 120 }, (_, i) => [String(i), 'texte '.repeat(i % 20)]) });
  const bytes = doc.output();
  const text = Buffer.from(bytes).toString('latin1');
  assert.ok(text.startsWith('%PDF-1.4')); assert.ok(text.trimEnd().endsWith('%%EOF'));
  assert.ok(doc.pages.length > 2);
  const startxref = Number(text.match(/startxref\n(\d+)/)[1]);
  assert.equal(text.slice(startxref, startxref + 4), 'xref');
  const offsets = text.slice(startxref).split('\n').slice(3).filter(l => / 00000 n /.test(l)).map(l => Number(l.slice(0, 10)));
  offsets.forEach((o, i) => assert.ok(text.slice(o).startsWith(`${i + 1} 0 obj`), `objet ${i + 1}`));
  assert.deepEqual(toWinAnsi('é’€'), [0xE9, 0x92, 0x80]);
});

test('normalisation des imports', () => {
  assert.equal(parseDate('12/10/2026'), '2026-10-12'); assert.equal(parseDate('12-10-26'), '2026-10-12');
  assert.equal(parseDate('31/02/2026'), ''); assert.equal(parseDate('46307'), '2026-10-12');
  assert.equal(parseTime('8h30'), '08:30'); assert.equal(parseTime('0830'), '08:30');
  const m = guessMapping(['Date prévue', 'Station', 'Organisme préleveur', 'Heure'], [{ key: 'plannedDate', label: 'Date prévue' }, { key: 'site', label: 'Site', hints: ['station'] }, { key: 'provider', label: 'Prestataire', hints: ['organisme'] }, { key: 'plannedTime', label: 'Heure prévue', hints: ['heure'] }]);
  assert.deepEqual(m, { plannedDate: 0, site: 1, provider: 2, plannedTime: 3 });
  assert.equal(resolveRef([{ code: 'HYD', name: 'HYDRECO' }], 'hydreco').code, 'HYD');
});

test('référentiel initial repris des fiches terrain OEG', () => {
  const DATA = loadDATA();
  const r = oegReferential(DATA);
  assert.ok(r.site.length > 100); assert.equal(r.site.length, r.point.length);
  assert.ok(r.site.every(s => s.lat > 1 && s.lat < 6.5 && s.lon > -55 && s.lon < -51), 'coordonnées en Guyane');
  const prog = oegProgramme(DATA);
  assert.ok(prog.length > 100 && prog.every(p => r.campaign.some(c => c.id === p.campaignId) && r.site.some(s => s.id === p.siteId)));
  assert.deepEqual(parseSessionMonth('S2 - Déc.26'), { year: 2026, month: 12 });
  const demo = demoData({ today: '2026-10-08' });
  assert.equal(demo.prestation.length, 3);
});

test('droits par profil', () => {
  assert.equal(canWrite('auditeur', 'audit'), true);
  assert.equal(canWrite('auditeur', 'grid'), false);
  assert.equal(canWrite('consultation', 'audit'), false);
  assert.equal(canWrite('consultation', 'trail'), true);
  assert.equal(canWrite('auditeur', 'conflict'), false);
  assert.equal(roleCan('rq', 'audit.amend'), true); assert.equal(roleCan('auditeur', 'audit.amend'), false);
});

test('journal chaîné : toute altération est détectée', async () => {
  const entries = []; let prev = '';
  for (let i = 1; i <= 5; i++) { const e = { id: 'e' + i, seq: i, at: `2026-10-08T10:0${i}:00Z`, deviceId: 'd1', action: 'update', entityLabel: 'AUD-1', prevHash: prev }; e.hash = await trailHash(e); prev = e.hash; entries.push(e); }
  assert.equal((await verifyTrail(entries)).ok, true);
  const altered = entries.map(e => ({ ...e })); altered[2].entityLabel = 'AUD-2';
  assert.equal((await verifyTrail(altered)).ok, false);
  const removed = entries.filter(e => e.seq !== 3);
  const r = await verifyTrail(removed);
  assert.equal(r.ok, false); assert.match(r.devices[0].breaks[0].reason, /manquante/);
});

test('utilitaires : JSON canonique, différences, échappement HTML, distance', () => {
  assert.equal(canonicalJSON({ b: 1, a: [2, { d: 1, c: 2 }] }), '{"a":[2,{"c":2,"d":1}],"b":1}');
  assert.deepEqual(diff({ a: 1, r: { x: 1 } }, { a: 2, r: { x: 1, y: 2 } }).map(d => d.path), ['a', 'r.y']);
  assert.equal(String(html`<b>${'<script>'}</b>${raw('<i>ok</i>')}`), '<b>&lt;script&gt;</b><i>ok</i>');
  assert.ok(Math.abs(haversine(4.93, -52.33, 4.94, -52.33) - 1112) < 5);
});
