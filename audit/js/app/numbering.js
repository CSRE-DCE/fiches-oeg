/* Numérotation unique des audits, y compris hors connexion (format AUD-AAAA-NNNNNN).
 *  - mode serveur : l'appareil réserve à l'avance des blocs de numéros auprès du serveur (lors de
 *    chaque synchronisation) et les consomme hors connexion ; si le bloc est épuisé hors connexion, il
 *    utilise sa plage de secours propre (900000 + n° d'appareil × 1000 + rang) ;
 *  - mode autonome : plage propre à l'appareil (n° d'appareil × 10000 + rang), le n° d'appareil
 *    (1 à 99) étant choisi à l'installation pour que deux appareils ne produisent jamais le même numéro.
 */
import { meta } from '../core/db.js';
import { session } from '../core/session.js';

export const fmtNumber = (prefix, year, n) => `${prefix}-${year}-${String(n).padStart(6, '0')}`;

let chain = Promise.resolve();
/** Sérialise les allocations (deux audits créés très vite ne reçoivent jamais le même numéro). */
export function nextNumber(prefix = 'AUD', year = new Date().getFullYear()) {
  const p = chain.then(() => allocate(prefix, year));
  chain = p.catch(() => {});
  return p;
}

async function allocate(prefix, year) {
  const key = `${prefix}-${year}`;
  const deviceNo = Math.max(1, Math.min(99, Number(session.device?.number) || 1));
  if (session.mode === 'server') {
    const blocks = await meta.get('numBlocks', {});
    const list = blocks[key] || [];
    const b = list.find(x => x.next <= x.to);
    if (b) { const n = b.next++; await meta.set('numBlocks', { ...blocks, [key]: list.filter(x => x.next <= x.to) }); return { number: fmtNumber(prefix, year, n), source: 'bloc serveur' }; }
    const c = await meta.get(`numFallback:${key}`, 0) + 1;
    if (c > 999) throw new Error('Plage de numéros de secours épuisée : synchronisez l’appareil.');
    await meta.set(`numFallback:${key}`, c);
    return { number: fmtNumber(prefix, year, 900000 + deviceNo * 1000 + c), source: 'plage de secours appareil' };
  }
  const c = await meta.get(`numLocal:${key}`, 0) + 1;
  if (c > 9999) throw new Error('Plage de numéros de l’appareil épuisée pour cette année.');
  await meta.set(`numLocal:${key}`, c);
  return { number: fmtNumber(prefix, year, deviceNo * 10000 + c), source: 'plage appareil' };
}

/** Nombre de numéros réservés encore disponibles (mode serveur). */
export async function availableNumbers(prefix = 'AUD', year = new Date().getFullYear()) {
  const blocks = await meta.get('numBlocks', {});
  return (blocks[`${prefix}-${year}`] || []).reduce((s, b) => s + Math.max(0, b.to - b.next + 1), 0);
}
export async function addBlock(prefix, year, from, to) {
  const blocks = await meta.get('numBlocks', {});
  const key = `${prefix}-${year}`;
  blocks[key] = [...(blocks[key] || []), { from, to, next: from }];
  await meta.set('numBlocks', blocks);
}
