/* Géolocalisation de l'appareil (fonctionne sans réseau : le GPS ne nécessite pas de connexion). */
import { nowISO, uuid } from '../core/util.js';

let last = null;

function err(e) {
  const msg = { 1: 'Accès à la position refusé : autorisez la localisation pour ce site dans les réglages du navigateur.', 2: 'Position indisponible (signal GPS insuffisant). Réessayez à découvert.', 3: 'Délai dépassé pour obtenir la position GPS. Réessayez à découvert.' }[e?.code];
  return new Error(msg || e?.message || 'Géolocalisation impossible');
}

/** Position précise (relevé GPS demandé par l'utilisateur). */
export function getPosition({ timeout = 25000, maximumAge = 0 } = {}) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('Géolocalisation non disponible sur cet appareil.'));
    navigator.geolocation.getCurrentPosition(p => {
      last = { id: uuid(), lat: p.coords.latitude, lon: p.coords.longitude, accuracy: p.coords.accuracy, altitude: p.coords.altitude, at: nowISO(), source: 'gps' };
      resolve(last);
    }, e => reject(err(e)), { enableHighAccuracy: true, timeout, maximumAge });
  });
}
/** Position rapide (photos) : dernière position connue de moins de 2 min, sinon tentative courte. */
export async function quickPosition() {
  if (last && Date.now() - new Date(last.at).getTime() < 120000) return { lat: last.lat, lon: last.lon, accuracy: last.accuracy, at: last.at };
  try { const p = await getPosition({ timeout: 4000, maximumAge: 120000 }); return { lat: p.lat, lon: p.lon, accuracy: p.accuracy, at: p.at }; }
  catch (e) { return null; }
}
export function lastPosition() { return last; }
