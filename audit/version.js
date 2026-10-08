/* Numéro de version UNIQUE de la PWA d'audit, lu à la fois par la page (audit/index.html) et par
 * son service worker (audit/sw.js, qui en déduit le nom de son cache).
 *
 * À INCRÉMENTER À CHAQUE PUBLICATION des fichiers du dossier audit/ : les appareils détectent alors
 * la nouvelle version et remplacent leur cache. La vérification automatique (GitHub Actions)
 * refuse une modification des fichiers de l'appli d'audit sans changement ici.
 *
 * La version est aussi enregistrée dans chaque audit (« version de l'application »).
 */
self.AUDIT_BUILD = 1;
self.AUDIT_BUILD_DATE = '2026-10-08';
self.AUDIT_VERSION = '1.0.' + self.AUDIT_BUILD;
