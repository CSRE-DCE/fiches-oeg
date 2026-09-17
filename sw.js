/* Service worker — Fiches terrain OEG
 * Rend l'application utilisable hors connexion après la première ouverture.
 * Stratégie pour les fichiers de l'application : "réseau d'abord, repli sur le cache".
 * Autrement dit, dès qu'il y a une connexion, la version la plus récente est TOUJOURS
 * utilisée et remplace le cache — impossible de rester bloqué sur une ancienne version
 * tant que l'appareil a du réseau au moment de l'ouverture. Le cache ne sert que de
 * secours quand il n'y a vraiment aucune connexion.
 *
 * IMPORTANT : à chaque modification des fichiers de l'application, changez CACHE_VERSION
 * ci-dessous pour que les tablettes déjà installées récupèrent la nouvelle version.
 */
const CACHE_VERSION = 'oeg-v15';
const APP_SHELL = [
  './',
  './index.html',
  './styles.css',
  './manifest.json',
  './js/geo.js',
  './js/data.js',
  './js/app-core.js',
  './js/dashboard.js',
  './js/quality.js',
  './js/quality-automation.js',
  './js/people-stations-core.js',
  './js/crt-access.js',
  './js/stations-map.js',
  './js/sync.js'
];
// Chargée si disponible au moment de l'installation ; son absence ne doit jamais
// empêcher l'application de fonctionner hors-ligne.
const OPTIONAL_SHELL = [
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_VERSION);
    await cache.addAll(APP_SHELL);
    await Promise.allSettled(OPTIONAL_SHELL.map(url => cache.add(url).catch(() => {})));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(n => n !== CACHE_VERSION).map(n => caches.delete(n)));
    await self.clients.claim();
  })());
});

// Permet à la page de forcer l'activation immédiate d'une nouvelle version
// (déclenché depuis js/sync.js après détection d'une mise à jour).
self.addEventListener('message', event => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});

function isSameOrigin(url) {
  return url.origin === self.location.origin;
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return; // les appels Drive (POST/PATCH) ne passent jamais par le cache
  const url = new URL(req.url);

  if (isSameOrigin(url)) {
    // Fichiers de l'application : réseau d'abord (toujours la version la plus fraîche
    // quand il y a du réseau), repli sur le cache uniquement hors-ligne ou en cas d'échec.
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_VERSION);
      try {
        const resp = await fetch(req, { cache: 'no-store' });
        if (resp && resp.ok) cache.put(req, resp.clone());
        return resp;
      } catch (e) {
        const cached = await cache.match(req);
        return cached || new Response('Hors-ligne : ressource non disponible.', { status: 503 });
      }
    })());
  } else {
    // Ressources externes (fond de carte, polices, API Google...) : réseau d'abord,
    // secours sur le cache si hors-ligne. On ne bloque jamais l'appli si ça échoue.
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_VERSION);
      try {
        const resp = await fetch(req);
        if (resp && resp.ok && req.url.startsWith('https://unpkg.com/')) cache.put(req, resp.clone());
        return resp;
      } catch (e) {
        const cached = await cache.match(req);
        return cached || new Response('', { status: 503 });
      }
    })());
  }
});
