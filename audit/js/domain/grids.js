/* Grilles d'audit dynamiques : logique conditionnelle, avancement, contrôle de complétude.
 * Fichier pur (testé sous Node).
 *
 * Une grille : {id, code, name, version, status, scope, settings, sections:[{id, title, domain, module,
 *   phase, help, condition, subsections?, items:[item]}]}
 * Un critère (item) : {id, code, label, help, kind, responses, options, unit, min, max, required,
 *   justifyOn:['NC'], evidenceOnNC, refs:[{docKey, docType, article, paragraph, requirement}],
 *   condition, alerts:[{op, value, level, message}], compareTo, delayFrom, maxHours}
 * Une condition : {item:'CODE'|id, op, value} | {ctx:'matrixCode', op, value} | {all:[…]} | {any:[…]} | {not:…}
 */
import { DEFAULT_RESPONSES } from './model.js';

export const OPERATORS = {
  eq: 'est égal à', neq: 'est différent de', in: 'fait partie de', nin: 'ne fait pas partie de',
  gt: 'est supérieur à', gte: 'est supérieur ou égal à', lt: 'est inférieur à', lte: 'est inférieur ou égal à',
  answered: 'est renseigné', empty: 'n’est pas renseigné', truthy: 'est « Oui »', falsy: 'est « Non »'
};

/** Liste à plat des sections (sous-sections incluses) dans l'ordre d'affichage. */
export function flatSections(grid) {
  const out = [];
  const walk = (secs, parent = null, depth = 0) => {
    for (const s of secs || []) { out.push({ ...s, parentId: parent?.id || null, depth }); walk(s.subsections, s, depth + 1); }
  };
  walk(grid?.sections);
  return out;
}
export function allItems(grid) {
  const out = [];
  for (const s of flatSections(grid)) for (const it of s.items || []) out.push({ ...it, sectionId: s.id, sectionTitle: s.title, domain: s.domain || 'prelevement' });
  return out;
}
export function itemIndex(grid) {
  const m = new Map();
  for (const it of allItems(grid)) { m.set(it.id, it); if (it.code) m.set(it.code, it); }
  return m;
}

/** Valeur d'un critère utilisée par les conditions et règles. */
export function responseValue(item, r) {
  if (!r) return undefined;
  if (item?.kind === 'conformity') return r.status;
  if (r.status === 'NA') return 'NA';
  return r.value;
}

function compare(op, actual, expected) {
  const num = v => (v === '' || v === null || v === undefined) ? NaN : Number(String(v).replace(',', '.'));
  switch (op) {
    case 'eq': return actual === expected || String(actual) === String(expected);
    case 'neq': return !(actual === expected || String(actual) === String(expected));
    case 'in': return (Array.isArray(expected) ? expected : [expected]).some(e => Array.isArray(actual) ? actual.map(String).includes(String(e)) : String(actual) === String(e));
    case 'nin': return !compare('in', actual, expected);
    case 'gt': return num(actual) > num(expected);
    case 'gte': return num(actual) >= num(expected);
    case 'lt': return num(actual) < num(expected);
    case 'lte': return num(actual) <= num(expected);
    case 'answered': return actual !== undefined && actual !== null && actual !== '' && !(Array.isArray(actual) && !actual.length);
    case 'empty': return !compare('answered', actual);
    case 'truthy': return actual === true || actual === 'Oui' || actual === 'oui' || actual === 'C';
    case 'falsy': return actual === false || actual === 'Non' || actual === 'non';
    default: return false;
  }
}

/**
 * Évalue une condition. `responses` : réponses de l'audit ; `index` : critères par id/code ;
 * `ctx` : contexte de l'audit (matrice, type de prélèvement, type de prestataire…).
 */
export function evalCondition(cond, responses, index, ctx = {}) {
  if (!cond) return true;
  if (Array.isArray(cond)) return cond.every(c => evalCondition(c, responses, index, ctx));
  if (cond.all) return cond.all.every(c => evalCondition(c, responses, index, ctx));
  if (cond.any) return cond.any.some(c => evalCondition(c, responses, index, ctx));
  if (cond.not) return !evalCondition(cond.not, responses, index, ctx);
  if (cond.ctx) return compare(cond.op || 'eq', ctx[cond.ctx], cond.value);
  if (cond.item) {
    const item = index.get(cond.item);
    if (!item) return false;
    return compare(cond.op || 'eq', responseValue(item, responses?.[item.id]), cond.value);
  }
  return true;
}

/** Une condition est-elle valide (critères référencés existants, opérateur connu) ? */
export function conditionErrors(cond, index, path = 'condition') {
  if (!cond) return [];
  if (Array.isArray(cond)) return cond.flatMap((c, i) => conditionErrors(c, index, `${path}[${i}]`));
  if (cond.all || cond.any) return (cond.all || cond.any).flatMap((c, i) => conditionErrors(c, index, `${path}[${i}]`));
  if (cond.not) return conditionErrors(cond.not, index, path + '.not');
  const errs = [];
  if (cond.op && !OPERATORS[cond.op]) errs.push(`${path} : opérateur inconnu « ${cond.op} »`);
  if (cond.item && !index.get(cond.item)) errs.push(`${path} : critère « ${cond.item} » introuvable`);
  if (!cond.item && !cond.ctx) errs.push(`${path} : condition sans critère ni contexte`);
  return errs;
}

/**
 * Structure visible de la grille pour un audit : les sections/critères dont la condition n'est pas
 * remplie sont masqués (et exclus de l'avancement et des contrôles de complétude).
 */
export function visibleStructure(grid, responses = {}, ctx = {}) {
  const index = itemIndex(grid);
  const out = [];
  const walk = (secs, parentVisible = true, depth = 0) => {
    for (const s of secs || []) {
      const visible = parentVisible && evalCondition(s.condition, responses, index, ctx);
      const items = (s.items || []).map(it => ({ ...it, sectionId: s.id, domain: s.domain || 'prelevement', visible: visible && evalCondition(it.condition, responses, index, ctx) }));
      out.push({ ...s, depth, visible, items, visibleItems: items.filter(i => i.visible) });
      walk(s.subsections, visible, depth + 1);
    }
  };
  walk(grid?.sections);
  return out;
}

export function isAnswerable(item) { return item.kind !== 'info'; }
export function isAnswered(item, r) {
  if (!isAnswerable(item)) return true;
  if (!r) return false;
  if (r.status === 'NA' || r.status === 'NV' || r.status === 'NO') return true;
  switch (item.kind) {
    case 'conformity': return !!r.status;
    case 'photo': return (r.mediaCount || 0) > 0;
    case 'multiselect': return Array.isArray(r.value) && r.value.length > 0;
    case 'boolean': return r.value === true || r.value === false;
    case 'number': return r.value !== '' && r.value !== null && r.value !== undefined && !isNaN(Number(r.value));
    default: return r.value !== undefined && r.value !== null && String(r.value).trim() !== '';
  }
}
export function allowedResponses(item) {
  if (item.kind === 'conformity') return item.responses?.length ? item.responses : DEFAULT_RESPONSES;
  return item.allowNA ? ['NA'] : [];
}
/** Une justification est exigée pour cette réponse (toujours en cas de non-conformité). */
export function needsJustification(item, r) {
  if (!r?.status) return false;
  const on = item.justifyOn || ['NC'];
  return on.includes(r.status) || r.status === 'NC';
}

/** Avancement global et par section (critères visibles uniquement). */
export function progress(grid, responses = {}, ctx = {}, mediaCounts = {}) {
  const sections = visibleStructure(grid, responses, ctx);
  const bySection = {};
  let total = 0, answered = 0;
  for (const s of sections) {
    const st = { total: 0, answered: 0, nc: 0, missingRequired: 0, visible: s.visible };
    for (const it of s.visibleItems) {
      if (!isAnswerable(it)) continue;
      const r = withMedia(responses[it.id], mediaCounts[it.id]);
      st.total++;
      if (isAnswered(it, r)) st.answered++;
      else if (it.required) st.missingRequired++;
      if (r?.status === 'NC') st.nc++;
    }
    bySection[s.id] = st;
    if (s.visible) { total += st.total; answered += st.answered; }
  }
  return { total, answered, percent: total ? Math.round(answered * 100 / total) : 0, bySection };
}
function withMedia(r, count) { return count ? { ...(r || {}), mediaCount: count } : r; }

/**
 * Contrôle de complétude avant clôture/signature.
 * Retourne [{level:'error'|'warning', sectionId, itemId, code, message}].
 * Les erreurs bloquent la signature ; les avertissements laissent la décision à l'auditeur.
 */
export function validateResponses(grid, responses = {}, ctx = {}, { mediaCounts = {}, deviationsByItem = {} } = {}) {
  const issues = [];
  for (const s of visibleStructure(grid, responses, ctx)) {
    if (!s.visible) continue;
    for (const it of s.visibleItems) {
      if (!isAnswerable(it)) continue;
      const r = withMedia(responses[it.id], mediaCounts[it.id]);
      const ref = { sectionId: s.id, itemId: it.id, code: it.code };
      if (it.required && !isAnswered(it, r)) issues.push({ level: 'error', ...ref, message: `${it.code || ''} ${it.label} : réponse obligatoire manquante` });
      if (needsJustification(it, r) && !String(r.comment || '').trim()) issues.push({ level: 'error', ...ref, message: `${it.code || ''} ${it.label} : justification obligatoire (${r.status === 'NC' ? 'non-conformité' : r.status})` });
      if (r?.status === 'NC' && it.evidenceOnNC && !(mediaCounts[it.id] > 0)) issues.push({ level: 'warning', ...ref, message: `${it.code || ''} ${it.label} : non-conformité sans photographie ni preuve jointe` });
      if (r?.status === 'NC' && !deviationsByItem[it.id]) issues.push({ level: 'warning', ...ref, message: `${it.code || ''} ${it.label} : non-conformité sans écart enregistré (à décider par l’auditeur)` });
      if (it.kind === 'number' && r && r.value !== '' && r.value !== undefined && r.value !== null && isNaN(Number(r.value))) issues.push({ level: 'error', ...ref, message: `${it.code || ''} ${it.label} : valeur numérique invalide` });
    }
  }
  return issues;
}

/** Une grille est-elle structurellement correcte (identifiants uniques, conditions valides) ? */
export function validateGrid(grid) {
  const errors = [];
  if (!grid?.name) errors.push('Nom de la grille manquant');
  const ids = new Set(), codes = new Set();
  const index = itemIndex(grid);
  for (const s of flatSections(grid)) {
    if (!s.id) errors.push(`Section « ${s.title} » sans identifiant`);
    if (ids.has(s.id)) errors.push(`Identifiant de section en double : ${s.id}`); ids.add(s.id);
    errors.push(...conditionErrors(s.condition, index, `Section « ${s.title} »`));
    for (const it of s.items || []) {
      if (!it.id) errors.push(`Critère « ${it.label} » sans identifiant`);
      if (ids.has(it.id)) errors.push(`Identifiant en double : ${it.id}`); ids.add(it.id);
      if (it.code) { if (codes.has(it.code)) errors.push(`Code de critère en double : ${it.code}`); codes.add(it.code); }
      if (!it.label) errors.push(`Critère ${it.code || it.id} sans libellé`);
      if ((it.kind === 'select' || it.kind === 'multiselect') && !(it.options || []).length && !it.optionsFrom) errors.push(`Critère ${it.code || it.id} : liste de choix vide`);
      errors.push(...conditionErrors(it.condition, index, `Critère ${it.code || it.id}`));
    }
  }
  return errors;
}

/**
 * Grilles applicables à une prestation, de la plus spécifique à la plus générale.
 * scope de grille : {samplingTypeIds, matrixIds, providerIds, protocolDocKeys, cctpDocKeys, environments}
 */
export function rankGrids(grids, target = {}) {
  const dims = [['samplingTypeIds', 'samplingTypeId'], ['matrixIds', 'matrixId'], ['providerIds', 'providerId'], ['protocolDocKeys', 'protocolDocKey'], ['cctpDocKeys', 'cctpDocKey'], ['environments', 'environment']];
  const scored = [];
  for (const g of grids) {
    if (g.status && g.status !== 'publiee') continue;
    let score = 0, ok = true;
    for (const [gk, tk] of dims) {
      const list = g.scope?.[gk] || [];
      if (!list.length) continue;
      if (target[tk] && list.includes(target[tk])) score += 10; else { ok = false; break; }
    }
    if (ok) scored.push({ grid: g, score });
  }
  return scored.sort((a, b) => b.score - a.score || String(b.grid.version).localeCompare(String(a.grid.version), 'fr', { numeric: true })).map(x => x.grid);
}
