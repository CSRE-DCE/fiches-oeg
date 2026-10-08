/* Gestion documentaire : version applicable à une date, instantané figé dans l'audit.
 * Un document « en vigueur » n'est jamais modifié : toute évolution crée une nouvelle version.
 * L'audit conserve la référence exacte (référence, version, empreinte SHA-256 du contenu) et une copie
 * des articles cités : une modification ultérieure d'un protocole ne peut pas modifier un audit passé. */
import { store } from '../core/store.js';
import { canonicalJSON, sha256Hex, sortBy, localDate } from '../core/util.js';

export function versionsOf(docKey) {
  return sortBy(store.filter('document', d => d.docKey === docKey), x => -Number(String(x.version).replace(/[^\d.]/g, '')) || 0, '-applicableFrom');
}
/** Version en vigueur d'un document à une date donnée. */
export function docInForce(docKey, date = localDate()) {
  if (!docKey) return null;
  const list = store.filter('document', d => d.docKey === docKey && ['en_vigueur', 'remplace', 'archive'].includes(d.status) && d.status !== 'brouillon');
  const ok = list.filter(d => (!d.applicableFrom || d.applicableFrom <= date) && (!d.applicableTo || d.applicableTo >= date) && d.status !== 'archive');
  return sortBy(ok, '-applicableFrom')[0] || list.find(d => d.status === 'en_vigueur') || null;
}
/** Documents applicables à une prestation (CCTP, protocole + documents ciblant le prestataire/le type). */
export function applicableDocuments(prestation, date = localDate()) {
  const out = new Map();
  const add = d => { if (d && !out.has(d.docKey)) out.set(d.docKey, d); };
  add(docInForce(prestation?.cctpDocKey, date));
  add(docInForce(prestation?.protocolDocKey, date));
  const method = prestation?.methodId ? store.get('method', prestation.methodId) : null;
  if (method?.docKey) add(docInForce(method.docKey, date));
  for (const d of store.filter('document', d => d.status === 'en_vigueur' && (d.providerIds?.includes(prestation?.providerId) || d.samplingTypeIds?.includes(prestation?.samplingTypeId) || ['CONSIGNES', 'PLAN_PREL', 'PLAN_SITE'].includes(d.type) && (d.siteIds || []).includes(prestation?.siteId)))) add(docInForce(d.docKey, date));
  return [...out.values()];
}
export async function documentHash(doc) {
  const { id, docKey, type, name, reference, version, applicableFrom, applicableTo, articles, summary, fileSha256 } = doc;
  return sha256Hex(canonicalJSON({ id, docKey, type, name, reference, version, applicableFrom, applicableTo, articles, summary, fileSha256 }));
}
/** Instantané figé d'un document pour un audit. */
export async function snapshotDocument(doc) {
  const file = doc.fileMediaId ? store.get('media', doc.fileMediaId) : null;
  return {
    id: doc.id, docKey: doc.docKey, type: doc.type, name: doc.name, reference: doc.reference, version: doc.version,
    applicableFrom: doc.applicableFrom, applicableTo: doc.applicableTo, status: doc.status,
    articles: (doc.articles || []).map(a => ({ number: a.number, title: a.title, text: a.text })),
    fileMediaId: doc.fileMediaId || null, fileSha256: file?.sha256 || null,
    sha256: await documentHash({ ...doc, fileSha256: file?.sha256 || null })
  };
}
/** Libellé de référence documentaire d'un critère, résolu dans l'instantané de l'audit. */
export function refLabel(ref, snapshot = []) {
  const d = snapshot.find(x => x.docKey === ref.docKey) || store.all('document').find(x => x.docKey === ref.docKey && x.status === 'en_vigueur');
  const name = d ? `${d.reference || d.name}${d.version ? ' v' + d.version : ''}` : (ref.docType || ref.docKey);
  return [name, ref.article ? `§ ${ref.article}` : '', ref.paragraph ? `al. ${ref.paragraph}` : ''].filter(Boolean).join(' ');
}
export function refArticle(ref, snapshot = []) {
  const d = snapshot.find(x => x.docKey === ref.docKey);
  return d?.articles?.find(a => String(a.number) === String(ref.article)) || null;
}
