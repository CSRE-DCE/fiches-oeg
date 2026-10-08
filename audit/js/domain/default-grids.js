/* Grilles d'audit fournies au démarrage. Elles sont des MODÈLES : le responsable qualité les adapte
 * (nouvelle version) à ses CCTP, protocoles et à son système qualité depuis la bibliothèque de grilles.
 * Références normatives indiquées à titre d'exemple : NF EN ISO/IEC 17025:2017 (§ 6.2 personnel,
 * § 6.4 équipements, § 7.3 échantillonnage, § 7.4 manutention des objets, § 7.5 enregistrements
 * techniques) et série NF EN ISO 5667 (échantillonnage de l'eau). Les articles de CCTP et de protocole
 * renvoient aux documents d'exemple et doivent être remplacés par les références réelles.
 */

const C = (code, label, extra = {}) => ({ id: 'it-' + code, code, label, kind: 'conformity', required: true, evidenceOnNC: true, ...extra });
const iso = (clause, requirement) => ({ docKey: 'ISO17025', docType: 'REFERENTIEL', article: clause, requirement });
const cctp = (article, requirement) => ({ docKey: 'CCTP-SURV-EAUX', docType: 'CCTP', article, requirement });
const proto = (article, requirement) => ({ docKey: 'PROTO-PREL-ESU', docType: 'PROTOCOLE', article, requirement });
const norm = (docKey, article, requirement) => ({ docKey, docType: 'NORME', article, requirement });
const RESP_QUALIF = ['C', 'NC', 'NA', 'NV'];

export const GRID_GENERAL = {
  id: 'grid-prel-eau-general-v1',
  code: 'GR-PREL-EAU',
  name: 'Audit terrain — prélèvement d’eau (surface, souterraine, littorale)',
  version: '1.0',
  status: 'publiee',
  publishedAt: '2026-10-01T00:00:00.000Z',
  description: 'Grille générale couvrant la qualification du prestataire, la vérification documentaire, le matériel, la préparation, l’identification du point, les conditions environnementales, l’observation du prélèvement, la traçabilité des échantillons, la conservation et le transport. Les analyses de laboratoire sont hors périmètre.',
  scope: { samplingTypeIds: [], matrixIds: [], providerIds: [], protocolDocKeys: [], cctpDocKeys: [], environments: [] },
  settings: { transportMaxHours: 24 },
  sections: [
    {
      id: 'sec-qualif', title: 'Identification et qualification du prestataire', domain: 'prelevement', module: 'operators', phase: 'avant',
      help: 'Vérifier l’identité, la fonction et les habilitations de chaque opérateur présent. Les habilitations enregistrées dans la base prestataires sont rappelées ci-dessus avec leur validité.',
      items: [
        C('Q01', 'Identité du prestataire conforme à la prestation programmée', { responses: RESP_QUALIF, refs: [cctp('3.1', 'Titulaire du marché ou sous-traitant déclaré')] }),
        C('Q02', 'Identité de l’opérateur vérifiée', { responses: RESP_QUALIF, refs: [iso('6.2', 'Personnel')] }),
        { id: 'it-Q03', code: 'Q03', label: 'Fonction de l’opérateur', kind: 'select', options: ['Technicien préleveur', 'Chef d’équipe', 'Ingénieur / chargé d’études', 'Agent en formation (accompagné)', 'Autre'] },
        C('Q04', 'Habilitation au prélèvement concerné présentée', { responses: RESP_QUALIF, refs: [iso('6.2.5', 'Autorisation du personnel à réaliser des activités spécifiques'), cctp('4.2', 'Qualification du personnel préleveur')] }),
        C('Q05', 'Qualification / formation justifiée', { responses: RESP_QUALIF, refs: [iso('6.2.2', 'Exigences de compétence documentées')] }),
        C('Q06', 'Autorisation éventuelle (accès au site, navigation, travail isolé…)', { responses: RESP_QUALIF, required: false }),
        C('Q07', 'Expérience exigée par le marché', { responses: RESP_QUALIF, required: false, refs: [cctp('4.2', 'Expérience minimale du personnel')] }),
        C('Q08', 'Documents justificatifs présents', { responses: RESP_QUALIF }),
        C('Q09', 'Validité des habilitations à la date de l’audit', { responses: RESP_QUALIF, help: 'Une alerte apparaît automatiquement si une habilitation enregistrée est expirée.' }),
        C('Q10', 'Adéquation des compétences avec le prélèvement réalisé', { responses: RESP_QUALIF, refs: [iso('6.2.2', 'Compétences adaptées à l’activité')] })
      ]
    },
    {
      id: 'sec-doc', title: 'Vérification documentaire avant prélèvement', domain: 'prelevement', phase: 'avant',
      items: [
        C('D01', 'Protocole applicable présent sur le terrain', { refs: [iso('8.3', 'Maîtrise des documents : documents disponibles sur le lieu d’utilisation'), proto('1', 'Domaine d’application')] }),
        { id: 'it-D02', code: 'D02', label: 'Version du protocole présentée par l’opérateur', kind: 'text', required: true, compareTo: 'protocolVersion', help: 'Saisir la version lue sur le document de l’opérateur : elle est comparée à la version applicable enregistrée dans l’audit.' },
        C('D03', 'Bonne version du protocole utilisée', { refs: [iso('8.3.2', 'Utilisation des versions pertinentes')] }),
        C('D04', 'Connaissance du protocole par l’opérateur', { help: 'Questionner l’opérateur sur 2 ou 3 étapes clés (ordre de remplissage, conservation, mesures in situ).', responses: ['C', 'NC', 'NA', 'NV'] }),
        C('D05', 'Cohérence entre prestation programmée et prestation réellement réalisée', { refs: [cctp('2.3', 'Programme de prélèvement')] }),
        C('D06', 'Identification correcte du site'),
        C('D07', 'Identification correcte du point de prélèvement'),
        C('D08', 'Identification de la campagne'),
        C('D09', 'Connaissance des consignes particulières', { required: false }),
        C('D10', 'Disponibilité des documents nécessaires (fiche terrain, plan, étiquettes, bordereaux)')
      ]
    },
    {
      id: 'sec-mat', title: 'Matériel de prélèvement', domain: 'prelevement', phase: 'avant',
      items: [
        C('M01', 'Matériel adapté au prélèvement', { refs: [norm('ISO5667-1', '', 'Choix du matériel d’échantillonnage')] }),
        C('M02', 'Matériel propre'),
        C('M03', 'Matériel en bon état'),
        C('M04', 'Matériel compatible avec le milieu et les paramètres recherchés', { help: 'Ex. : matériaux inertes vis-à-vis des micropolluants, flaconnage fourni par le laboratoire.' }),
        C('M05', 'Absence de contamination apparente'),
        C('M06', 'Consommables appropriés (gants, filtres, seringues…)'),
        C('M07', 'Contenants appropriés (nature, volume, préparation par le laboratoire)', { refs: [norm('ISO5667-3', '', 'Contenants et conservation')] }),
        C('M08', 'Dispositifs de prélèvement appropriés (bouteille, perche, pompe…)'),
        { id: 'it-M09', code: 'M09', label: 'Matériel manquant constaté ?', kind: 'boolean', required: true, alerts: [{ op: 'truthy', level: 'attention', code: 'MATERIAL_MISSING', title: 'Matériel manquant', message: 'Du matériel prévu par le protocole est manquant.', requirement: 'Matériel prévu par le protocole disponible', typeCode: 'MATERIEL' }] },
        { id: 'it-M10', code: 'M10', label: 'Matériel manquant (préciser)', kind: 'text', required: true, condition: { item: 'M09', op: 'truthy' } }
      ]
    },
    {
      id: 'sec-equip', title: 'Matériel de mesure', domain: 'prelevement', module: 'equipment', phase: 'avant',
      help: 'Enregistrer chaque équipement de mesure utilisé (sonde multiparamètre, thermomètre, GPS…). Un équipement hors validité déclenche une alerte.',
      items: [
        C('E01', 'Équipements de mesure identifiés (inventaire, n° de série)', { refs: [iso('6.4.8', 'Identification de l’état d’étalonnage')] }),
        C('E02', 'Vérification / étalonnage réalisé avant les mesures', { refs: [iso('6.4.6', 'Étalonnage des équipements')] }),
        C('E03', 'Traçabilité des étalons et solutions (lots, dates de péremption)', { required: false, refs: [iso('6.5', 'Traçabilité métrologique')] }),
        C('E04', 'Certificats / constats de vérification disponibles', { required: false })
      ]
    },
    {
      id: 'sec-prep', title: 'Préparation du prélèvement', domain: 'prelevement', phase: 'avant',
      items: [
        C('P01', 'Préparation du matériel'),
        C('P02', 'Préparation des contenants'),
        C('P03', 'Préparation des consommables'),
        C('P04', 'Préparation des équipements'),
        C('P05', 'Préparation des glacières', { required: false }),
        C('P06', 'Préparation des moyens de conservation (pains de glace, réfrigérants)', { required: false }),
        C('P07', 'Préparation des documents'),
        C('P08', 'Préparation des étiquettes'),
        C('P09', 'Identification des échantillons préparée (pré-étiquetage)'),
        C('P10', 'Disponibilité des équipements de protection individuelle'),
        C('P11', 'Respect des conditions préalables définies par le protocole', { refs: [proto('3', 'Conditions préalables')] })
      ]
    },
    {
      id: 'sec-point', title: 'Identification du point de prélèvement', domain: 'prelevement', module: 'gps', phase: 'pendant',
      help: 'Relever la position GPS : une alerte apparaît si la position est éloignée des coordonnées attendues (seuil réglable).',
      items: [
        C('L01', 'Site conforme au programme'),
        { id: 'it-L02', code: 'L02', label: 'Code du point relevé sur place', kind: 'text', required: false },
        C('L03', 'Point conforme au point programmé (code, description)', { refs: [cctp('2.4', 'Localisation des points de prélèvement')] }),
        C('L04', 'Cohérence entre point programmé et point réellement échantillonné'),
        { id: 'it-L05', code: 'L05', label: 'Photographie du point de prélèvement', kind: 'photo', required: true },
        { id: 'it-L06', code: 'L06', label: 'Accessibilité', kind: 'select', options: ['Accessible', 'Accès difficile', 'Inaccessible'], required: true, alerts: [{ op: 'eq', value: 'Inaccessible', level: 'attention', code: 'POINT_INACCESSIBLE', message: 'Point déclaré inaccessible : vérifier la solution de repli prévue par le protocole.' }] },
        { id: 'it-L07', code: 'L07', label: 'Conditions particulières du point', kind: 'text', required: false }
      ]
    },
    {
      id: 'sec-env', title: 'Conditions environnementales', domain: 'prelevement', phase: 'pendant',
      items: [
        { id: 'it-V01', code: 'V01', label: 'Météo', kind: 'select', options: ['Ensoleillé', 'Nuageux', 'Couvert', 'Pluie faible', 'Pluie forte', 'Orage'], required: true },
        { id: 'it-V02', code: 'V02', label: 'Température de l’air', kind: 'number', unit: '°C', step: 0.1, required: false },
        { id: 'it-V03', code: 'V03', label: 'Pluie dans les 72 h précédentes', kind: 'select', options: ['Aucune', 'Faible', 'Modérée', 'Forte', 'Inconnue'], required: false },
        { id: 'it-V04', code: 'V04', label: 'Vent', kind: 'select', options: ['Nul', 'Faible', 'Modéré', 'Fort'], required: false },
        { id: 'it-V05', code: 'V05', label: 'État du milieu', kind: 'multiselect', options: ['Normal', 'Eau trouble', 'Hautes eaux / crue', 'Basses eaux / étiage', 'Marée montante', 'Marée descendante', 'Présence d’irisations', 'Présence de mousses', 'Odeur'], required: true },
        { id: 'it-V06', code: 'V06', label: 'Niveau d’eau', kind: 'number', unit: 'm', step: 0.01, allowNA: true, required: false },
        { id: 'it-V07', code: 'V07', label: 'Débit (si applicable)', kind: 'number', unit: 'm³/s', step: 0.001, allowNA: true, required: false },
        { id: 'it-V08', code: 'V08', label: 'Turbidité (si applicable)', kind: 'number', unit: 'FNU', step: 0.1, allowNA: true, required: false },
        { id: 'it-V09', code: 'V09', label: 'Événement susceptible d’influencer le prélèvement ?', kind: 'boolean', required: true },
        { id: 'it-V10', code: 'V10', label: 'Événement (préciser)', kind: 'text', required: true, condition: { item: 'V09', op: 'truthy' } }
      ]
    },
    {
      id: 'sec-obs', title: 'Observation du prélèvement et de la méthode', domain: 'prelevement', phase: 'pendant',
      help: 'Observer le déroulement réel du prélèvement. « Non observé » si l’étape n’a pas pu être vue par l’auditeur.',
      items: [
        { id: 'it-O01', code: 'O01', label: 'Méthode de prélèvement utilisée', kind: 'select', optionsFrom: 'method', required: true },
        C('O02', 'Adéquation de la méthode au prélèvement', { refs: [iso('7.2.1', 'Sélection des méthodes appropriées'), iso('7.3.1', 'Plan et méthode d’échantillonnage')] }),
        C('O03', 'Respect de l’ordre des opérations', { refs: [proto('4.1', 'Ordre de remplissage des flacons')] }),
        C('O04', 'Rinçage du matériel avec l’eau du milieu (si prévu)', { required: false }),
        C('O05', 'Respect des volumes', { refs: [proto('4.2', 'Volumes à prélever')] }),
        C('O06', 'Respect des profondeurs (si applicable)', { required: false }),
        C('O07', 'Respect des temps (stabilisation, purge, durée)', { required: false }),
        C('O08', 'Respect des conditions particulières'),
        C('O09', 'Respect des fréquences / du calendrier', { required: false }),
        C('O10', 'Respect des points de prélèvement'),
        C('O11', 'Absence de modification non justifiée de la méthode', { refs: [iso('7.3.3', 'Enregistrement des écarts au plan ou à la méthode d’échantillonnage')] }),
        C('O12', 'Maîtrise des risques de contamination (gants, ordre des flacons, absence de contact)'),
        C('O13', 'Maîtrise des risques de perte ou d’altération de l’échantillon'),
        C('O14', 'Purge du forage / stabilisation des paramètres avant prélèvement', { condition: { ctx: 'matrixCode', op: 'eq', value: 'ESO' }, refs: [norm('ISO5667-11', '', 'Purge des ouvrages')] }),
        C('O15', 'Mesures in situ réalisées selon la méthode (sondes, temps de stabilisation)', { required: false }),
        C('O16', 'Contrôles qualité terrain réalisés si prévus (blanc, duplicata)', { required: false, refs: [norm('ISO5667-14', '', 'Contrôle qualité de l’échantillonnage')] }),
        C('O17', 'Enregistrements terrain réalisés au fur et à mesure (fiche terrain)', { refs: [iso('7.3.3', 'Enregistrement des données d’échantillonnage'), iso('7.5', 'Enregistrements techniques')] })
      ]
    },
    {
      id: 'sec-ech', title: 'Traçabilité des échantillons', domain: 'prelevement', module: 'samples', phase: 'pendant',
      help: 'Enregistrer chaque échantillon individuellement (identifiant généré automatiquement, scan possible de l’étiquette).',
      items: [
        C('S01', 'Échantillons identifiés individuellement et de façon univoque', { refs: [iso('7.4.2', 'Système d’identification univoque des objets')] }),
        C('S02', 'Étiquettes lisibles et résistantes à l’eau'),
        C('S03', 'Conservateurs ajoutés conformément au protocole', { required: false, refs: [norm('ISO5667-3', '', 'Conservation des échantillons')] }),
        C('S04', 'Concordance échantillons / fiche terrain / demande d’analyse')
      ]
    },
    {
      id: 'sec-transport', title: 'Conservation et transport', domain: 'transport', phase: 'apres',
      help: 'Contrôle de la partie pré-analytique directement liée au prélèvement, jusqu’à la remise au laboratoire. Les analyses ne sont pas auditées.',
      items: [
        { id: 'it-T00', code: 'T00', label: 'Prélèvement nécessitant une conservation à température contrôlée', kind: 'boolean', required: true, help: 'Si « Oui », les contrôles de la chaîne du froid s’affichent automatiquement.' },
        C('T01', 'Conditionnement adapté', { refs: [iso('7.4.1', 'Transport et stockage des objets')] }),
        C('T02', 'Fermeture des contenants'),
        C('T03', 'Identification maintenue (étiquettes intactes)'),
        C('T04', 'Conditions de conservation conformes (obscurité, délai, conservateur)', { refs: [norm('ISO5667-3', '', 'Conservation et manipulation des échantillons')] }),
        C('T05', 'Contrôle du contenant isotherme (glacière)', { condition: { item: 'T00', op: 'truthy' } }),
        C('T06', 'Contrôle du moyen de conservation (pains de glace, enceinte réfrigérée)', { condition: { item: 'T00', op: 'truthy' } }),
        { id: 'it-T07', code: 'T07', label: 'Température dans l’enceinte de transport', kind: 'number', unit: '°C', step: 0.1, required: true, condition: { item: 'T00', op: 'truthy' }, refs: [cctp('6.3', 'Température de transport 5 ± 3 °C')], alerts: [{ op: 'outside', value: [2, 8], level: 'critique', code: 'TEMP_OUT', title: 'Température hors critère', message: 'Température {value} °C hors de l’intervalle 5 ± 3 °C.', requirement: 'Température de transport 5 ± 3 °C', typeCode: 'TRANSPORT' }] },
        { id: 'it-T08', code: 'T08', label: 'Heure de la mesure de température', kind: 'time', required: true, condition: { item: 'T00', op: 'truthy' } },
        C('T09', 'Maintien de la chaîne du froid', { condition: { item: 'T00', op: 'truthy' }, refs: [cctp('6.3', 'Chaîne du froid')] }),
        { id: 'it-T10', code: 'T10', label: 'Date et heure de remise au laboratoire / transporteur', kind: 'datetime', required: true, delayFrom: 'samples', maxHours: 24, refs: [cctp('6.4', 'Délai maximal de 24 h entre prélèvement et remise')], help: 'Le délai depuis le premier prélèvement est calculé automatiquement.' },
        C('T11', 'Délai entre prélèvement et remise respecté', { refs: [cctp('6.4', 'Délai de remise')] }),
        C('T12', 'Conditions de transport adaptées'),
        C('T13', 'Protection contre les contaminations'),
        C('T14', 'Protection contre les détériorations (casse, renversement)'),
        C('T15', 'Traçabilité de la remise au laboratoire (bordereau / chaîne de possession signée)', { refs: [iso('7.4.1', 'Préservation de l’intégrité'), iso('7.4.3', 'Enregistrement des écarts à réception')] }),
        { id: 'it-T16', code: 'T16', label: 'Laboratoire / destinataire', kind: 'text', required: false }
      ]
    }
  ]
};

/** Grille courte pour les contrôles inopinés ou les visites de courte durée. */
export const GRID_RAPIDE = {
  id: 'grid-controle-rapide-v1',
  code: 'GR-RAPIDE',
  name: 'Contrôle inopiné rapide',
  version: '1.0',
  status: 'publiee',
  publishedAt: '2026-10-01T00:00:00.000Z',
  description: 'Contrôle court des points essentiels : habilitation, protocole, point, matériel, identification et conservation des échantillons.',
  scope: { samplingTypeIds: [], matrixIds: [], providerIds: [], protocolDocKeys: [], cctpDocKeys: [], environments: [] },
  settings: { transportMaxHours: 24 },
  sections: [
    { id: 'r-qualif', title: 'Opérateur et documents', domain: 'prelevement', module: 'operators', items: [
      C('R01', 'Opérateur habilité pour le prélèvement réalisé', { responses: RESP_QUALIF, refs: [iso('6.2.5', 'Autorisation du personnel')] }),
      { id: 'it-R02', code: 'R02', label: 'Version du protocole présentée', kind: 'text', required: true, compareTo: 'protocolVersion' },
      C('R03', 'Protocole applicable disponible et connu')
    ] },
    { id: 'r-point', title: 'Point et matériel', domain: 'prelevement', module: 'gps', items: [
      C('R04', 'Point de prélèvement conforme'),
      { id: 'it-R05', code: 'R05', label: 'Photographie du point', kind: 'photo', required: true },
      C('R06', 'Matériel propre, adapté et en bon état'),
      C('R07', 'Maîtrise des risques de contamination')
    ] },
    { id: 'r-ech', title: 'Échantillons', domain: 'prelevement', module: 'samples', items: [
      C('R08', 'Échantillons identifiés de façon univoque', { refs: [iso('7.4.2', 'Identification des objets')] })
    ] },
    { id: 'r-transport', title: 'Conservation', domain: 'transport', items: [
      { id: 'it-R09', code: 'R09', label: 'Conservation à température contrôlée requise', kind: 'boolean', required: true },
      { id: 'it-R10', code: 'R10', label: 'Température de l’enceinte', kind: 'number', unit: '°C', step: 0.1, required: true, condition: { item: 'R09', op: 'truthy' }, alerts: [{ op: 'outside', value: [2, 8], level: 'critique', code: 'TEMP_OUT', title: 'Température hors critère', message: 'Température {value} °C hors de l’intervalle 5 ± 3 °C.', typeCode: 'TRANSPORT' }] },
      C('R11', 'Conditionnement et fermeture des contenants conformes')
    ] }
  ]
};

export const DEFAULT_GRIDS = [GRID_GENERAL, GRID_RAPIDE];
