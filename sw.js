/* Service worker — Fiches terrain OEG
 * Rend l'application utilisable hors connexion après la première ouverture.
 * Stratégie : "cache d'abord" pour les fichiers de l'application (fiables hors-ligne),
 * "réseau d'abord avec repli sur le cache" pour les ressources externes (fond de carte,
 * Google Drive...) qui ne sont utiles que lorsqu'il y a une connexion de toute façon.
 *
 * IMPORTANT : à chaque modification des fichiers de l'application, changez CACHE_VERSION
 * ci-dessous pour que les tablettes déjà installées récupèrent la nouvelle version.
 */
const CACHE_VERSION = 'oeg-v5';
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
    // Fichiers de l'application : cache d'abord, avec rafraîchissement discret en tâche de fond.
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_VERSION);
      const cached = await cache.match(req);
      const network = fetch(req).then(resp => {
        if (resp && resp.ok) cache.put(req, resp.clone());
        return resp;
      }).catch(() => null);
      return cached || (await network) || new Response('Hors-ligne : ressource non disponible.', { status: 503 });
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
