/* Carte interactive (Leaflet embarqué) et préchargement des tuiles pour un usage hors connexion.
 * Les tuiles sont conservées dans un cache dédié du navigateur (servi par le service worker). Le
 * préchargement est volontairement limité (niveau de zoom et nombre de tuiles plafonnés) pour respecter
 * les conditions d'utilisation des serveurs de tuiles ; un serveur interne peut être configuré. */
import { orgSettings } from '../app/settings.js';

export const TILE_CACHE = 'oeg-audit-tiles';
const MAX_TILES = 1500;

export function createMap(el, { center = [4.0, -53.0], zoom = 7 } = {}) {
  const L = globalThis.L;
  if (!L) throw new Error('Carte indisponible (Leaflet non chargé).');
  const s = orgSettings();
  const map = L.map(el, { zoomControl: true, attributionControl: true, preferCanvas: true }).setView(center, zoom);
  L.tileLayer(s.tileUrl, { maxZoom: 18, attribution: s.tileAttribution, crossOrigin: true }).addTo(map);
  return map;
}

function lon2tile(lon, z) { return Math.floor((lon + 180) / 360 * 2 ** z); }
function lat2tile(lat, z) { const r = lat * Math.PI / 180; return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * 2 ** z); }

/** Liste des URL de tuiles couvrant une emprise, du zoom minZ au zoom maxZ. */
export function tileUrls(bounds, minZ, maxZ, template = orgSettings().tileUrl) {
  const urls = [];
  for (let z = minZ; z <= maxZ; z++) {
    const x1 = lon2tile(bounds.west, z), x2 = lon2tile(bounds.east, z), y1 = lat2tile(bounds.north, z), y2 = lat2tile(bounds.south, z);
    for (let x = Math.min(x1, x2); x <= Math.max(x1, x2); x++) for (let y = Math.min(y1, y2); y <= Math.max(y1, y2); y++) {
      urls.push(template.replace('{z}', z).replace('{x}', x).replace('{y}', y).replace('{s}', 'a').replace('{r}', ''));
      if (urls.length > MAX_TILES) return urls;
    }
  }
  return urls;
}

/** Précharge les tuiles ; onProgress(done, total). Retourne {saved, failed, skipped, total}. */
export async function preloadTiles(urls, onProgress = () => {}) {
  if (urls.length > MAX_TILES) throw new Error(`Zone trop étendue (${urls.length} tuiles, maximum ${MAX_TILES}) : zoomez davantage.`);
  const cache = await caches.open(TILE_CACHE);
  let done = 0, saved = 0, failed = 0, skipped = 0;
  const queue = [...urls];
  const worker = async () => {
    while (queue.length) {
      const url = queue.shift();
      try {
        if (await cache.match(url)) skipped++;
        else { const r = await fetch(url, { mode: 'cors' }); if (r.ok) { await cache.put(url, r); saved++; } else failed++; }
      } catch (e) { failed++; }
      onProgress(++done, urls.length);
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  return { saved, failed, skipped, total: urls.length };
}
export async function tileCacheCount() { try { return (await (await caches.open(TILE_CACHE)).keys()).length; } catch (e) { return 0; } }
export async function clearTileCache() { await caches.delete(TILE_CACHE); }
