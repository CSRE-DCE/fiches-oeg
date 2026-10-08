/* Synthèse factuelle d'un audit et indicateurs d'historique. Fichier pur (testé sous Node).
 * Volontairement AUCUN score global : seuls des décomptes traçables sont produits. */
import { visibleStructure, isAnswerable } from './grids.js';
import { OPEN_DEVIATION } from './model.js';

/**
 * @param {object} p {audit, grid, ctx, deviations:[…], criticalities:[…], alerts:[…]}
 */
export function auditSummary({ audit, grid, ctx = {}, deviations = [], criticalities = [], alerts = [] }) {
  const responses = audit.responses || {};
  const structure = grid ? visibleStructure(grid, responses, ctx) : [];
  const counts = { controlled: 0, C: 0, NC: 0, NA: 0, NO: 0, NV: 0, unanswered: 0, measures: 0 };
  const sections = [];
  const ncItems = [];
  for (const s of structure) {
    if (!s.visible) continue;
    const st = { id: s.id, title: s.title, domain: s.domain || 'prelevement', C: 0, NC: 0, NA: 0, NO: 0, NV: 0, unanswered: 0, total: 0 };
    for (const it of s.visibleItems) {
      if (!isAnswerable(it)) continue;
      const r = responses[it.id];
      if (it.kind === 'conformity') {
        st.total++; counts.controlled++;
        if (r?.status) { st[r.status]++; counts[r.status]++; } else { st.unanswered++; counts.unanswered++; }
        if (r?.status === 'NC') ncItems.push({ code: it.code, label: it.label, section: s.title, comment: r.comment || '', refs: it.refs || [] });
      } else if (r && (r.value !== undefined && r.value !== '' && r.value !== null)) counts.measures++;
    }
    sections.push(st);
  }
  const crit = new Map(criticalities.map(c => [c.code, c]));
  const byCriticality = criticalities.slice().sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0))
    .map(c => ({ code: c.code, label: c.label, color: c.color, count: deviations.filter(d => d.criticalityCode === c.code).length }));
  const unknown = deviations.filter(d => !crit.has(d.criticalityCode)).length;
  if (unknown) byCriticality.push({ code: '?', label: 'Criticité non renseignée', count: unknown });

  // Exigences les plus fréquemment non conformes (dans l'audit : par référence documentaire / section)
  const freq = new Map();
  for (const n of ncItems) {
    const keys = n.refs.length ? n.refs.map(r => [r.docType || r.docKey, r.article].filter(Boolean).join(' art. ')) : [n.section];
    for (const k of keys) freq.set(k, (freq.get(k) || 0) + 1);
  }
  const frequentRequirements = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([requirement, count]) => ({ requirement, count }));

  const strengths = sections.filter(s => s.total >= 2 && s.C === s.total).map(s => `${s.title} : ${s.C}/${s.total} critères conformes`);
  const vigilance = [];
  for (const s of sections) {
    const parts = [];
    if (s.NC) parts.push(`${s.NC} non-conformité(s)`);
    if (s.NO) parts.push(`${s.NO} critère(s) non observé(s)`);
    if (s.NV) parts.push(`${s.NV} critère(s) non vérifiable(s)`);
    if (s.unanswered) parts.push(`${s.unanswered} sans réponse`);
    if (parts.length) vigilance.push(`${s.title} : ${parts.join(', ')}`);
  }
  for (const a of alerts.filter(a => a.level !== 'info')) vigilance.push(`Alerte — ${a.title} : ${a.message}`);

  const actions = deviations.filter(d => d.correctiveActionRequested || d.immediateAction)
    .map(d => ({ number: d.number, criticality: crit.get(d.criticalityCode)?.label || d.criticalityCode || '', action: d.correctiveActionRequested || '', immediate: d.immediateAction || '', responsible: d.responsible || '', dueDate: d.dueDate || '' }));

  return { counts, sections, ncItems, deviationsCount: deviations.length, byCriticality, frequentRequirements, strengths, vigilance, actions, samples: (audit.samples || []).length, equipment: (audit.equipmentChecks || []).length };
}

/**
 * Écarts récurrents : même exigence (code de critère ou type d'écart) relevée dans au moins
 * `min` audits distincts pour un même prestataire.
 */
export function recurringDeviations(deviations, { min = 2, key = d => d.itemCode || d.typeCode || d.requirement } = {}) {
  const groups = new Map();
  for (const d of deviations) {
    if (d.status === 'annule') continue;
    const k = `${d.providerId || '?'}|${key(d) || '?'}`;
    if (!groups.has(k)) groups.set(k, { providerId: d.providerId, requirement: d.requirement || key(d), key: key(d), deviations: [], audits: new Set() });
    const g = groups.get(k); g.deviations.push(d); g.audits.add(d.auditId);
  }
  return [...groups.values()].filter(g => g.audits.size >= min)
    .map(g => ({ ...g, audits: [...g.audits], count: g.deviations.length, open: g.deviations.filter(d => OPEN_DEVIATION.includes(d.status)).length }))
    .sort((a, b) => b.audits.length - a.audits.length);
}

/** Échéance dépassée d'un écart encore ouvert. */
export function isOverdue(d, today) {
  return OPEN_DEVIATION.includes(d.status) && d.dueDate && String(d.dueDate).slice(0, 10) < today;
}
