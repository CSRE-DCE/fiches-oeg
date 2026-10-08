/* Profils et matrice des droits — partagés par l'application (affichage, contrôles locaux) et par le
 * serveur de synchronisation (contrôle effectif des écritures). Fichier pur. */
export const ROLES = {
  admin: 'Administrateur',
  rq: 'Responsable qualité',
  superviseur: 'Superviseur',
  auditeur: 'Auditeur',
  consultation: 'Consultation'
};

export const PERMISSIONS = {
  'audit.create': ['admin', 'rq', 'superviseur', 'auditeur'],
  'audit.edit': ['admin', 'rq', 'superviseur', 'auditeur'],
  'audit.editOthers': ['admin', 'rq', 'superviseur'],
  'audit.amend': ['admin', 'rq'],                 // modification d'un audit signé (avec motif)
  'audit.delete': ['admin', 'rq'],                // abandon d'un audit non signé
  'deviation.manage': ['admin', 'rq', 'superviseur', 'auditeur'],
  'deviation.close': ['admin', 'rq', 'superviseur'],
  'observation.create': ['admin', 'rq', 'superviseur', 'auditeur'],
  'planning.manage': ['admin', 'rq', 'superviseur'],
  'ref.manage': ['admin', 'rq'],                  // référentiels, documents, grilles
  'trail.view': ['admin', 'rq', 'superviseur'],
  'users.manage': ['admin'],
  'devices.manage': ['admin'],
  'settings.manage': ['admin'],
  'export': ['admin', 'rq', 'superviseur', 'auditeur', 'consultation']
};

export function roleCan(role, perm) { return (PERMISSIONS[perm] || []).includes(role); }

export const REFERENTIAL_TYPES = ['provider', 'operator', 'site', 'point', 'equipment', 'samplingType', 'matrix', 'method', 'unit', 'criticality', 'deviationType', 'container', 'campaign', 'document', 'grid'];

/** Droit requis pour enregistrer un objet d'un type donné (null = refusé, '*' = tout profil). */
export function writePermission(type) {
  if (REFERENTIAL_TYPES.includes(type)) return ['ref.manage'];
  switch (type) {
    case 'trail': return '*';
    case 'media': return ['observation.create', 'ref.manage', 'audit.edit'];
    case 'audit': return ['audit.edit'];
    case 'deviation': return ['deviation.manage'];
    case 'observation': case 'alert': return ['observation.create'];
    case 'prestation': return ['planning.manage', 'audit.edit'];
    case 'importBatch': case 'importSource': return ['planning.manage', 'ref.manage'];
    case 'setting': return ['settings.manage'];
    default: return null;
  }
}
export function canWrite(role, type) {
  const p = writePermission(type);
  if (p === '*') return true;
  if (!p) return false;
  return p.some(x => roleCan(role, x));
}
