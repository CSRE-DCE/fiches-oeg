/* Vocabulaire métier : réponses, statuts, types d'objets. Fichier pur (aucune dépendance). */

/** Réponses possibles à un critère de conformité. */
export const RESPONSES = {
  C: { label: 'Conforme', short: 'C', cls: 'ok', icon: '✓' },
  NC: { label: 'Non conforme', short: 'NC', cls: 'nc', icon: '✗' },
  NA: { label: 'Non applicable', short: 'NA', cls: 'na', icon: '—' },
  NO: { label: 'Non observé', short: 'NO', cls: 'no', icon: '◌' },
  NV: { label: 'Non vérifiable', short: 'NV', cls: 'nv', icon: '?' }
};
export const DEFAULT_RESPONSES = ['C', 'NC', 'NA', 'NO'];

export const ITEM_KINDS = {
  conformity: 'Conformité (C / NC / NA / NO / NV)',
  boolean: 'Oui / Non',
  select: 'Liste de choix',
  multiselect: 'Choix multiples',
  number: 'Valeur numérique',
  text: 'Texte court',
  longtext: 'Texte libre',
  date: 'Date',
  time: 'Heure',
  datetime: 'Date et heure',
  photo: 'Photographie obligatoire',
  info: 'Information (sans réponse)'
};

/** Modules spécialisés pouvant être insérés dans une section de grille. */
export const SECTION_MODULES = {
  '': 'Aucun',
  operators: 'Opérateurs contrôlés et habilitations',
  equipment: 'Équipements de mesure (identification, étalonnage, validité)',
  gps: 'Relevé GPS et contrôle de la position',
  samples: 'Traçabilité des échantillons'
};

/** Domaine d'une section : sépare clairement le contrôle du prélèvement de celui du transport. */
export const DOMAINS = {
  prelevement: 'Contrôle du prélèvement',
  transport: 'Contrôle du transport (pré-analytique)'
};

export const PROVIDER_KINDS = { regie: 'Régie', prestataire: 'Prestataire externe', partenaire: 'Partenaire' };

export const PRESTATION_STATUS = {
  prevue: { label: 'Prévue', cls: 'info' },
  realisee: { label: 'Réalisée', cls: 'ok' },
  auditee: { label: 'Auditée', cls: 'brand' },
  annulee: { label: 'Annulée', cls: 'na' },
  reportee: { label: 'Reportée', cls: 'warn' },
  non_realisee: { label: 'Non réalisée', cls: 'nc' },
  realisee_ecart: { label: 'Réalisée avec écart', cls: 'warn' }
};

export const CONTROL_LEVELS = {
  aucun: 'Aucun contrôle prévu',
  documentaire: 'Contrôle documentaire',
  partiel: 'Audit partiel',
  complet: 'Audit complet sur site',
  inopine: 'Audit inopiné'
};

export const AUDIT_STATUS = {
  en_cours: { label: 'En cours', cls: 'info' },
  termine: { label: 'Terminé — à signer', cls: 'warn' },
  signe: { label: 'Signé — verrouillé', cls: 'ok' },
  abandonne: { label: 'Abandonné', cls: 'na' }
};

export const DEVIATION_STATUS = {
  ouvert: { label: 'Ouvert', cls: 'nc' },
  action_en_cours: { label: 'Action en cours', cls: 'warn' },
  a_verifier: { label: 'À vérifier', cls: 'info' },
  clos: { label: 'Clos', cls: 'ok' },
  annule: { label: 'Annulé', cls: 'na' }
};
export const OPEN_DEVIATION = ['ouvert', 'action_en_cours', 'a_verifier'];

export const ACTION_STATUS = {
  a_faire: 'À faire',
  en_cours: 'En cours',
  realisee: 'Réalisée — à vérifier',
  efficace: 'Vérifiée efficace',
  inefficace: 'Vérifiée inefficace'
};

export const DOC_TYPES = {
  CCTP: 'CCTP',
  CDC: 'Cahier des charges',
  PROTOCOLE: 'Protocole',
  PROCEDURE: 'Procédure',
  MODOP: 'Mode opératoire',
  PLAN_PREL: 'Plan de prélèvement',
  PLAN_SITE: 'Plan du site',
  CONSIGNES: 'Consignes particulières',
  NORME: 'Méthode normalisée',
  REFERENTIEL: 'Référentiel qualité (ISO/IEC 17025, Cofrac)',
  REGLEMENTATION: 'Exigence réglementaire',
  AUTRE: 'Autre'
};
export const DOC_STATUS = {
  brouillon: { label: 'Brouillon', cls: 'na' },
  en_vigueur: { label: 'En vigueur', cls: 'ok' },
  remplace: { label: 'Remplacé', cls: 'warn' },
  archive: { label: 'Archivé', cls: 'na' }
};

export const EQUIPMENT_STATUS = {
  service: 'En service',
  verification: 'En attente de vérification',
  reparation: 'En réparation',
  hors_service: 'Hors service',
  reforme: 'Réformé'
};

export const QUALIFICATION_TYPES = {
  habilitation: 'Habilitation',
  qualification: 'Qualification',
  formation: 'Formation',
  autorisation: 'Autorisation',
  experience: 'Expérience'
};

export const OBSERVATION_KINDS = { observation: 'Observation terrain', urgence: 'Situation critique (urgence)' };
export const EMERGENCY_CATEGORIES = ['Risque pour la sécurité', 'Contamination des échantillons', 'Pollution constatée sur le milieu', 'Échantillons compromis', 'Accident / incident', 'Prestation non conforme grave', 'Autre'];

export const ALERT_LEVELS = {
  critique: { label: 'Critique', cls: 'nc', rank: 3 },
  attention: { label: 'Attention', cls: 'warn', rank: 2 },
  info: { label: 'Information', cls: 'info', rank: 1 }
};

/** Libellé lisible d'une valeur de réponse. */
export function responseText(item, r) {
  if (!r) return '';
  const parts = [];
  if (r.status) parts.push(RESPONSES[r.status]?.label || r.status);
  if (r.value !== undefined && r.value !== null && r.value !== '') {
    let v = r.value;
    if (item?.kind === 'boolean') v = v === true ? 'Oui' : v === false ? 'Non' : v;
    if (Array.isArray(v)) v = v.join(', ');
    if (item?.kind === 'number' && item.unit) v = `${String(v).replace('.', ',')} ${item.unit}`;
    if (item?.kind === 'datetime' && /T/.test(v)) v = v.replace('T', ' ');
    parts.push(String(v));
  }
  return parts.join(' · ');
}
