/* Chiffrement des données stockées localement (WebCrypto, AES-GCM 256 bits).
 *
 * Principe : une clé de données (DEK) aléatoire, propre à l'appareil, chiffre toutes les données
 * (audits, référentiels, photos). Cette clé n'est jamais stockée en clair : pour chaque utilisateur
 * de l'appareil, elle est « enveloppée » (chiffrée) avec une clé dérivée de son mot de passe
 * (PBKDF2-SHA256, sel aléatoire). Ouvrir une session hors connexion = réussir à désenvelopper la DEK
 * (l'étiquette d'authentification AES-GCM prouve que le mot de passe est correct).
 * À la fermeture de session (manuelle ou par inactivité), la DEK est effacée de la mémoire.
 */
import { bytesToBase64, base64ToBytes } from './util.js';

export const KDF_ITERATIONS = 310000;
const subtle = () => globalThis.crypto.subtle;
const enc = new TextEncoder(), dec = new TextDecoder();

export function randomBytes(n) { return globalThis.crypto.getRandomValues(new Uint8Array(n)); }

async function deriveKey(password, salt, iterations) {
  const base = await subtle().importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  return subtle().deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base,
    { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
export async function importDEK(raw) {
  return subtle().importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}
export function newDEKRaw() { return randomBytes(32); }

/** Enveloppe la DEK avec le mot de passe d'un utilisateur. */
export async function wrapDEK(dekRaw, password, iterations = KDF_ITERATIONS) {
  const salt = randomBytes(16), iv = randomBytes(12);
  const kek = await deriveKey(password, salt, iterations);
  const ct = await subtle().encrypt({ name: 'AES-GCM', iv }, kek, dekRaw);
  return { salt: bytesToBase64(salt), iv: bytesToBase64(iv), wrapped: bytesToBase64(new Uint8Array(ct)), iterations, alg: 'PBKDF2-SHA256/AES-GCM-256' };
}
/** Désenveloppe la DEK ; retourne null si le mot de passe est faux. */
export async function unwrapDEK(entry, password) {
  try {
    const kek = await deriveKey(password, base64ToBytes(entry.salt), entry.iterations || KDF_ITERATIONS);
    const raw = await subtle().decrypt({ name: 'AES-GCM', iv: base64ToBytes(entry.iv) }, kek, base64ToBytes(entry.wrapped));
    return new Uint8Array(raw);
  } catch (e) { return null; }
}

export async function encryptBytes(key, bytes) {
  const iv = randomBytes(12);
  const ct = await subtle().encrypt({ name: 'AES-GCM', iv }, key, bytes);
  return { iv, ct: new Uint8Array(ct) };
}
export async function decryptBytes(key, iv, ct) {
  return new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv }, key, ct));
}
export async function encryptJSON(key, obj) { return encryptBytes(key, enc.encode(JSON.stringify(obj))); }
export async function decryptJSON(key, iv, ct) { return JSON.parse(dec.decode(await decryptBytes(key, iv, ct))); }

/** Chiffrement d'un export (sauvegarde) avec un mot de passe dédié. */
export async function encryptWithPassword(password, text) {
  const salt = randomBytes(16), iv = randomBytes(12);
  const key = await deriveKey(password, salt, KDF_ITERATIONS);
  const ct = await subtle().encrypt({ name: 'AES-GCM', iv }, key, enc.encode(text));
  return { format: 'oeg-audit-backup-enc-v1', kdf: 'PBKDF2-SHA256', iterations: KDF_ITERATIONS, salt: bytesToBase64(salt), iv: bytesToBase64(iv), data: bytesToBase64(new Uint8Array(ct)) };
}
export async function decryptWithPassword(password, payload) {
  const key = await deriveKey(password, base64ToBytes(payload.salt), payload.iterations || KDF_ITERATIONS);
  const pt = await subtle().decrypt({ name: 'AES-GCM', iv: base64ToBytes(payload.iv) }, key, base64ToBytes(payload.data));
  return dec.decode(pt);
}
