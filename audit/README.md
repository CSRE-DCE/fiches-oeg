# PWA — Audit terrain des prestations de prélèvement

Application web progressive (ordinateur, tablette, smartphone) pour auditer sur le terrain les
prestations de prélèvement et d'échantillonnage réalisées **en régie**, par des **prestataires
externes** ou par des **partenaires**. Elle fonctionne **entièrement hors connexion** et constitue,
pour chaque audit, un **dossier de preuve** :

> ce qui devait être fait → ce qui a été observé → la preuve → l'écart éventuel → sa criticité → l'action demandée.

Périmètre : le processus de prélèvement et la partie pré-analytique directement liée (conservation,
transport, remise au laboratoire). Les analyses de laboratoire, leur validation, le traitement
statistique et l'interprétation des résultats sont **hors périmètre**.

L'application reprend la charte et le référentiel de l'application « Fiches terrain OEG » du même
dépôt (logo, couleurs, 108 stations, organismes, préleveurs, campagnes).

---

## Démarrage

| Usage | Comment |
|---|---|
| **Mode autonome** (sans serveur) | Ouvrir `audit/index.html` servi en HTTPS (par ex. GitHub Pages : `…/fiches-oeg/audit/`). Au premier lancement : créer l'administrateur local, choisir un n° d'appareil (1 à 99), reprendre le référentiel OEG et, si souhaité, les données de démonstration. |
| **Mode serveur** (synchronisation) | `node audit-api/server.mjs` (Node ≥ 20, aucune dépendance) — voir [`audit-api/README.md`](../audit-api/README.md). Le serveur sert aussi l'application : ouvrir `https://<serveur>/audit/` et choisir « Serveur » au premier lancement. |
| **Installer** | Menu du navigateur → « Installer l'application » / « Ajouter à l'écran d'accueil ». |
| **Avant le terrain** | Planning → **Préparer le terrain** (synchronisation + téléchargement des documents) ; Carte → **Précharger la zone affichée**. |

Données de démonstration : prestataire « DÉMO — Prélèvements Exemple SARL (fictif) », trois
prestations, documents « EXEMPLE » (CCTP, protocole en 2 versions). Elles se retirent en un clic
(Administration › Données).

---

## Correspondance avec le cahier des charges

| § | Exigence | Réalisation |
|---|---|---|
| 3 | Hors connexion | Service worker (toute l'application préchargée), données dans IndexedDB, session locale, GPS, photos, signatures, rapport PDF sans réseau. Synchronisation automatique au retour du réseau, gestion des conflits, journal de synchronisation. |
| 4 | Prestations et calendriers | Import Excel, CSV, iCalendar, API JSON, calendrier partagé (URL .ics, sources enregistrées et resynchronisables), programme des fiches terrain OEG, saisie manuelle. Statuts : prévue, réalisée, auditée, annulée, reportée, non réalisée, réalisée avec écart (historisés). Vue liste et calendrier, filtres, retards, non auditées. |
| 5 | Fiche de préparation | Informations générales, documents applicables (version utilisée, disponibilité hors connexion), site/points, opérateurs et habilitations, équipements, historique du prestataire. |
| 6 | Identification de l'audit | N° unique `AUD-AAAA-NNNNNN` (garanti hors connexion), dates/heures, auditeur, appareil, versions de l'application, de la grille, du protocole et du CCTP, prestataire, opérateurs, site, prestation. |
| 7–16 | Grilles de contrôle | Grille par défaut (≈ 100 critères) : qualification, documentaire, matériel de prélèvement, matériel de mesure (module équipements), préparation, point de prélèvement (module GPS), conditions environnementales, observation et méthode, traçabilité des échantillons (module échantillons, QR/code-barres), conservation et transport (séparé du prélèvement). Grille courte « contrôle inopiné ». |
| 11 | GPS | Relevé à la demande, saisie manuelle de secours, distance au point attendu, alerte au-delà d'un seuil réglable (global ou par point). |
| 12 | Réponses | Conforme, Non conforme, Non applicable, Non observé, Non vérifiable (au choix par critère), observation libre, photo, pièce jointe, référence documentaire (CCTP, article, paragraphe, protocole, méthode, exigence). |
| 17 | Écarts | Numéro, date, heure, exigence, référence, description factuelle, observation, preuves, localisation, criticité paramétrable, action immédiate, action corrective, responsable, délai, statut ; actions correctives suivies jusqu'à la vérification d'efficacité. |
| 18–19 | Preuves | Photos compressées, horodatées, auteur, audit, objet contrôlé, GPS, empreinte SHA-256 ; annotation (l'original est conservé) ; documents, certificats, captures. |
| 20–21 | Signature et verrouillage | Signatures tactiles de l'auditeur et du représentant (ou refus motivé), hors connexion. Verrouillage avec empreinte SHA-256 du contenu ; toute modification ultérieure exige le droit adéquat et un motif, conserve la valeur précédente, l'auteur, la date et la nouvelle empreinte. |
| 22 | Synthèse | Décomptes C/NC/NA/NO/NV, écarts par criticité, exigences les plus fréquemment non conformes, points forts, points de vigilance, actions demandées — **sans score global**. |
| 23 | Rapport PDF | 16 rubriques + synthèse, photos, empreintes, historique ; « RAPPORT PROVISOIRE » tant que l'audit n'est pas verrouillé ; empreinte du PDF consignée dans l'audit. |
| 24 | Gestion documentaire | Versions par clé de document, dates d'application, statut (brouillon, en vigueur, remplacé, archivé). Une version en vigueur est immuable ; l'audit fige la version applicable (empreinte + articles). |
| 25–26 | Bibliothèque de grilles | Modèles par type de prélèvement, matrice, prestataire, protocole, CCTP, environnement ; sections, critères, réponses, nombres, listes, photos, références, règles d'alerte, **conditions d'affichage** (réponse à un critère ou contexte de l'audit). Publication figée, nouvelles versions, import/export JSON. |
| 27 | Alertes | Mauvais point, équipement non valide, matériel manquant, échantillon non identifié, information obligatoire absente, température hors critère, délai dépassé, protocole incorrect, opérateur non habilité, prestation différente. **Aucune alerte n'est convertie automatiquement en non-conformité** : l'auditeur crée un écart pré-rempli ou écarte l'alerte avec un motif. |
| 28–29 | Prestataires, historique | Identité, contrats, accréditation, opérateurs et habilitations, équipements, sites, audits, écarts, écarts récurrents, actions ; recherche par prestataire/site/point ; **comparaison de deux audits** critère par critère. |
| 30 | Tableau de bord | Audits programmés, réalisés, en retard, prestations non auditées, écarts ouverts / en retard / récurrents, prestataires, sites et campagnes contrôlés ; chaque valeur ouvre la liste des enregistrements correspondants. |
| 31 | Carte | Leaflet embarqué ; statut des points (aujourd'hui, à auditer, en retard, en cours, audité) ; tuiles préchargées disponibles hors connexion. |
| 32–33 | Audit inopiné, observation | Démarrage immédiat (site le plus proche par GPS) ; observation simple rattachable ensuite à un audit ou à un écart. |
| 34 | Sécurité | Authentification, 5 profils et matrice de droits (appliquée aussi par le serveur), chiffrement AES-256-GCM des données locales, HTTPS, verrouillage par inactivité, journalisation, désactivation à distance d'un appareil perdu (effacement à la reconnexion), sauvegarde chiffrée. |
| 36–37 | Import / export, API | PDF, Excel, CSV, ICS, paquets JSON (archivage, transfert entre appareils, sauvegarde chiffrée) ; API REST documentée (`audit-api/openapi.json`) : lecture des objets, exports CSV, journal. |
| 38 | Référentiels | Types de prélèvement, matrices, équipements, unités, opérateurs, sites, points, niveaux et types d'écarts, méthodes, contenants, campagnes, prestataires, documents, grilles. |
| 41–43 | Ergonomie terrain | Boutons de 52 à 60 px, navigation en bas d'écran (une main), mode « plein soleil », barre de progression et repère *Section → Critère → Réponse → Preuve → Validation*, saisie vocale, scan QR/code-barres, horodatage automatique, enregistrement continu (« continuer plus tard »). |
| 44 | Urgence | Bouton permanent : photo, catégorie, description, position, heure, prestation et prestataire du contexte ; alerte transmise en priorité dès qu'une connexion existe (webhook serveur configurable). |

---

## Architecture

```
audit/
  index.html, styles.css, manifest.webmanifest, sw.js, version.js   coquille PWA (sans étape de construction)
  js/core/     util, crypto (AES-GCM, PBKDF2), db (IndexedDB), store (dépôt + journal chaîné), auth, media
  js/domain/   modèle, grilles (conditions, avancement), alertes, synthèse, comparaison, fusion 3 voies,
               droits, référentiels initiaux, grilles par défaut, normalisation — modules purs testés sous Node
  js/formats/  CSV, iCalendar, XLSX (lecture/écriture), PDF — sans dépendance
  js/app/      services : audits, documents, numérotation, synchronisation, rapport, imports, exports
  js/ui/       DOM, routeur, composants, photo/annotation, signature, scanner, voix, GPS, carte
  js/views/    écrans
  vendor/      Leaflet 1.9.4 (BSD-2), jsQR 1.4.0 (Apache-2.0) — embarqués pour le hors connexion
audit-api/     serveur de référence Node (API REST + fichiers statiques)
```

- **Aucune étape de construction** (modules ES natifs), comme l'application de fiches terrain.
- **Données** : toutes les entités sont chiffrées dans IndexedDB (`oeg-audit`) avec une clé propre à
  l'appareil, elle-même enveloppée par le mot de passe de chaque utilisateur (PBKDF2-SHA256, 310 000
  itérations). Ouvrir une session hors connexion revient à désenvelopper cette clé.
- **Journal d'audit** : chaque écriture produit une entrée (qui, quoi, quand, appareil, avant/après,
  motif) chaînée par SHA-256 à la précédente ; la vérification d'intégrité détecte toute suppression,
  insertion ou altération. Les suppressions sont logiques (rien n'est effacé sans trace).
- **Synchronisation** : file d'envoi locale, contrôle optimiste par révision, réception différentielle
  par curseur, fusion à trois versions champ par champ (réponses critère par critère, listes par
  identifiant), rapport de conflit restaurable, blocs de numéros d'audit réservés à l'avance.
- **Numérotation hors connexion** : blocs réservés auprès du serveur ; à défaut, plage propre à
  l'appareil (n° d'appareil) — deux appareils ne produisent jamais le même numéro.

### Références qualité

La conception s'appuie sur les principes de la NF EN ISO/IEC 17025:2017 applicables à
l'échantillonnage : § 6.2 (personnel : habilitations et validité), § 6.4 et 6.5 (équipements,
étalonnage, traçabilité métrologique), § 7.2 (méthodes), § 7.3 (échantillonnage, enregistrement des
écarts au plan), § 7.4 (identification, transport, intégrité des objets), § 7.5 (enregistrements
techniques), § 7.10 (travaux non conformes), § 8.3 et 8.4 (maîtrise des documents et des
enregistrements), § 8.7 (actions correctives). Les références normatives des grilles (série
NF EN ISO 5667) et les **documents Cofrac** sont des entrées du référentiel documentaire à compléter
et maintenir à jour par le responsable qualité (versions à vérifier). L'application est un outil de
maîtrise : elle ne vaut pas, à elle seule, preuve d'accréditation.

---

## Paramétrage

Administration › Paramètres : seuil GPS, verrouillage automatique, délai maximal de transport,
modèle d'identifiant d'échantillon, serveur de tuiles (interne recommandé pour un préchargement
étendu), mentions des rapports. Référentiels › Niveaux d'écart : libellés, définitions, couleurs,
délais, action immédiate obligatoire — à aligner sur le système qualité.

## Tests

```bash
npm install && npx playwright install chromium
node tests/check-release.js        # syntaxe, cache hors connexion complet, numéro de version
node --test tests/audit-unit.mjs   # 18 tests unitaires (logique métier, formats, droits, journal)
node tests/audit-e2e.mjs           # parcours terrain complet, hors connexion réel, serveur 2 appareils
```

À chaque publication de fichiers du dossier `audit/`, incrémenter `AUDIT_BUILD` dans
`audit/version.js` (contrôlé par la CI) pour que les appareils installés se mettent à jour.

## Limites connues

- Les identifiants d'opérateurs repris des fiches terrain sont des initiales : compléter l'identité et
  les habilitations (sinon l'alerte « opérateur non habilité » est levée, ce qui est voulu).
- Le serveur de référence stocke ses données dans un fichier JSON : adapté à une organisation de taille
  moyenne ; pour un volume important, remplacer `audit-api/lib/db.mjs` par une base PostgreSQL.
- Lecture des codes-barres : native sur Android/Chrome (BarcodeDetector) ; ailleurs, QR codes via jsQR
  et saisie manuelle. Saisie vocale selon le navigateur (souvent avec réseau).
- Le préchargement de carte respecte les conditions du serveur OpenStreetMap (zoom et volume plafonnés).
