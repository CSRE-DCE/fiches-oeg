/* Réglages de l'organisation (entité « setting » id=org, synchronisée) et préférences de l'appareil. */
import { store } from '../core/store.js';
import { baseReferential } from '../domain/seed.js';

const DEFAULTS = baseReferential().setting[0];

export function orgSettings() { return { ...DEFAULTS, ...(store.get('setting', 'org') || {}) }; }
export async function saveOrgSettings(patch, reason) {
  return store.put('setting', { ...orgSettings(), ...patch, id: 'org' }, { reason });
}

/* Préférences purement locales (affichage) : localStorage, sans donnée sensible. */
export function pref(key, fallback = null) { try { const v = localStorage.getItem('oeg-audit:' + key); return v === null ? fallback : JSON.parse(v); } catch (e) { return fallback; } }
export function setPref(key, value) { try { localStorage.setItem('oeg-audit:' + key, JSON.stringify(value)); } catch (e) { /* navigation privée */ } }
export function applyDisplayPrefs() {
  document.body.classList.toggle('sun', !!pref('sun', false));
}
