/* Initialisation des données : référentiels de base, grilles, documents de référence, référentiel
 * des fiches terrain OEG (stations) et jeu de démonstration facultatif. */
import { store } from '../core/store.js';
import { baseReferential, referenceDocuments, oegReferential, oegProgramme, demoData } from '../domain/seed.js';
import { DEFAULT_GRIDS } from '../domain/default-grids.js';

let dataPromise = null;
/** Charge le référentiel des fiches terrain (../js/data.js, partagé avec l'application de fiches). */
export function loadOEGData() {
  const read = () => new Function('return typeof DATA !== "undefined" ? DATA : null')();
  const existing = read();
  if (existing) return Promise.resolve(existing);
  if (!dataPromise) dataPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = new URL('../../../js/data.js', import.meta.url).href;
    s.onload = () => resolve(read());
    s.onerror = () => { dataPromise = null; reject(new Error('Référentiel des fiches terrain indisponible (js/data.js).')); };
    document.head.appendChild(s);
  });
  return dataPromise;
}

const only = (type, list) => list.filter(e => !store.getRaw(type, e.id));

export async function seedBase() {
  const ref = baseReferential();
  for (const [type, list] of Object.entries(ref)) {
    const todo = type === 'setting' ? list.filter(s => !store.getRaw('setting', s.id)) : only(type, list);
    if (todo.length) await store.bulkPut(type, todo, { reason: 'Référentiel initial', action: 'seed', label: `${todo.length} ${type}` });
  }
  const docs = only('document', referenceDocuments());
  if (docs.length) await store.bulkPut('document', docs, { reason: 'Documents de référence', action: 'seed' });
  const grids = only('grid', DEFAULT_GRIDS);
  if (grids.length) await store.bulkPut('grid', grids, { reason: 'Grilles d’audit par défaut', action: 'seed' });
}

export async function seedOEG() {
  const DATA = await loadOEGData();
  if (!DATA) throw new Error('Référentiel des fiches terrain introuvable.');
  const ref = oegReferential(DATA);
  const counts = {};
  for (const type of ['provider', 'site', 'point', 'operator', 'campaign']) {
    const todo = only(type, ref[type]);
    counts[type] = todo.length;
    if (todo.length) await store.bulkPut(type, todo, { reason: 'Reprise du référentiel des fiches terrain OEG', action: 'seed', label: `${todo.length} ${type}` });
  }
  return counts;
}

export async function seedDemo() {
  const demo = demoData({});
  for (const type of ['document', 'provider', 'operator', 'equipment', 'prestation']) {
    const todo = only(type, demo[type]);
    if (todo.length) await store.bulkPut(type, todo, { reason: 'Données de démonstration (fictives)', action: 'seed' });
  }
}

/** Prestations du programme des fiches terrain (Chimie, EL, RCO). Ne remplace jamais une prestation existante. */
export async function importOEGProgramme({ networks = ['Chimie', 'EL', 'RCO'] } = {}) {
  const DATA = await loadOEGData();
  const list = only('prestation', oegProgramme(DATA, { networks }));
  if (list.length) await store.bulkPut('prestation', list, { reason: `Import du programme des fiches terrain (${networks.join(', ')})`, action: 'import', label: `${list.length} prestation(s)` });
  return list.length;
}

export async function seedAll({ oeg = true, demo = false } = {}) {
  await seedBase();
  if (oeg) await seedOEG();
  if (demo) await seedDemo();
}
