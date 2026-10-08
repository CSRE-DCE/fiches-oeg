/* Service worker — PWA d'audit des prestations de prélèvement.
 *  - Fichiers de l'application : « réseau d'abord, repli sur le cache » (toujours la dernière version
 *    dès qu'il y a du réseau ; utilisation intégrale hors connexion sinon). Tous les fichiers sont
 *    préchargés à l'installation : l'application fonctionne hors connexion dès la première ouverture.
 *  - Tuiles de carte : « cache d'abord », dans un cache séparé conservé d'une version à l'autre
 *    (zones préchargées depuis l'écran Carte).
 *  - API du serveur (/api/) : jamais mise en cache (données chiffrées gérées par l'application).
 * IMPORTANT : à chaque modification des fichiers du dossier audit/, incrémenter AUDIT_BUILD dans
 * audit/version.js (seul endroit à modifier).
 */
importScripts('./version.js');
const CACHE = 'oeg-audit-build-' + self.AUDIT_BUILD;
const TILE_CACHE = 'oeg-audit-tiles';
const SHELL = [
  './',
  './index.html',
  './styles.css',
  './manifest.webmanifest',
  './version.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/logo-oeg.png',
  './vendor/leaflet/leaflet.js',
  './vendor/leaflet/leaflet.css',
  './vendor/leaflet/images/marker-icon.png',
  './vendor/leaflet/images/marker-icon-2x.png',
  './vendor/leaflet/images/marker-shadow.png',
  './vendor/leaflet/images/layers.png',
  './vendor/leaflet/images/layers-2x.png',
  './vendor/jsqr/jsQR.js',
  '../js/geo.js',
  '../js/data.js',
  './js/main.js',
  './js/core/util.js',
  './js/core/crypto.js',
  './js/core/db.js',
  './js/core/session.js',
  './js/core/store.js',
  './js/core/auth.js',
  './js/core/media.js',
  './js/domain/model.js',
  './js/domain/grids.js',
  './js/domain/rules.js',
  './js/domain/summary.js',
  './js/domain/compare.js',
  './js/domain/merge.js',
  './js/domain/seed.js',
  './js/domain/default-grids.js',
  './js/domain/normalize.js',
  './js/formats/csv.js',
  './js/formats/ics.js',
  './js/formats/xlsx.js',
  './js/formats/pdf.js',
  './js/app/settings.js',
  './js/app/numbering.js',
  './js/app/sync.js',
  './js/app/documents.js',
  './js/app/audits.js',
  './js/app/report.js',
  './js/app/imports.js',
  './js/app/exports.js',
  './js/app/bootstrap.js',
  './js/ui/dom.js',
  './js/ui/router.js',
  './js/ui/components.js',
  './js/ui/capture.js',
  './js/ui/gps.js',
  './js/ui/voice.js',
  './js/ui/scanner.js',
  './js/ui/signature.js',
  './js/ui/map.js',
  './js/views/auth.js',
  './js/views/shell.js',
  './js/views/planning.js',
  './js/views/prestation.js',
  './js/views/audit-new.js',
  './js/views/audit.js',
  './js/views/audit-modules.js',
  './js/views/audits.js',
  './js/views/compare.js',
  './js/views/deviations.js',
  './js/views/observations.js',
  './js/views/providers.js',
  './js/views/map.js',
  './js/views/dashboard.js',
  './js/views/documents.js',
  './js/views/grids.js',
  './js/views/referentials.js',
  './js/views/imports.js',
  './js/views/exports.js',
  './js/views/sync.js',
  './js/views/trail.js',
  './js/views/admin.js',
  './js/views/menu.js'
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(SHELL);
    self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(n => n.startsWith('oeg-audit-build-') && n !== CACHE).map(n => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => { if (event.data === 'skipWaiting') self.skipWaiting(); });

const isTile = url => /\/\d+\/\d+\/\d+(@2x)?\.(png|jpe?g|webp)(\?.*)?$/i.test(url.pathname + url.search);

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.pathname.includes('/api/')) return;               // API : jamais de cache
  if (url.origin === self.location.origin) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      try {
        const resp = await fetch(req, { cache: 'no-store' });
        if (resp && resp.ok && resp.type === 'basic') cache.put(req, resp.clone());
        return resp;
      } catch (e) {
        const cached = await cache.match(req, { ignoreSearch: true });
        if (cached) return cached;
        if (req.mode === 'navigate') return (await cache.match('./index.html')) || new Response('Hors connexion', { status: 503 });
        return new Response('Hors connexion : ressource non disponible.', { status: 503 });
      }
    })());
    return;
  }
  if (isTile(url)) {
    event.respondWith((async () => {
      const cache = await caches.open(TILE_CACHE);
      const cached = await cache.match(req);
      if (cached) return cached;
      try {
        const resp = await fetch(req);
        if (resp && (resp.ok || resp.type === 'opaque')) cache.put(req, resp.clone());
        return resp;
      } catch (e) { return new Response('', { status: 504 }); }
    })());
  }
});
