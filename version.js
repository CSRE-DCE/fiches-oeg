/* Numéro de version UNIQUE de l'application, lu à la fois par la page (index.html) et par
 * le service worker (sw.js, qui en déduit le nom de son cache).
 *
 * À INCRÉMENTER À CHAQUE PUBLICATION, et c'est le seul endroit à modifier : les tablettes
 * détectent alors la nouvelle version et remplacent leur cache. La vérification automatique
 * (GitHub Actions) refuse une modification des fichiers de l'appli sans changement ici.
 */
self.OEG_BUILD = 45;
self.OEG_BUILD_DATE = '2026-10-09';
