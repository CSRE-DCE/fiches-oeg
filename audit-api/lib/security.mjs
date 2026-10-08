/* Sécurité du serveur : hachage des mots de passe (scrypt), jetons, chiffrement au repos des clés
 * d'appareils déposées (AES-256-GCM avec un secret serveur), limitation des tentatives. */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export function hashPassword(password, salt = crypto.randomBytes(16).toString('base64')) {
  const hash = crypto.scryptSync(String(password), salt, 64, { N: 16384, r: 8, p: 1 }).toString('base64');
  return { salt, hash, alg: 'scrypt-N16384-r8-p1' };
}
export function verifyPassword(password, rec) {
  if (!rec?.hash || !rec?.salt) return false;
  const h = crypto.scryptSync(String(password), rec.salt, 64, { N: 16384, r: 8, p: 1 });
  const ref = Buffer.from(rec.hash, 'base64');
  return ref.length === h.length && crypto.timingSafeEqual(ref, h);
}
export const newToken = () => crypto.randomBytes(32).toString('base64url');
export const sha256 = data => crypto.createHash('sha256').update(data).digest('hex');
export const uuid = () => crypto.randomUUID();

/** Secret serveur : variable SERVER_SECRET (64 caractères hexadécimaux) ou fichier généré (droits 600). */
export function loadServerSecret(dataDir) {
  if (process.env.SERVER_SECRET && /^[0-9a-f]{64}$/i.test(process.env.SERVER_SECRET)) return Buffer.from(process.env.SERVER_SECRET, 'hex');
  const f = path.join(dataDir, 'server-secret.key');
  if (!fs.existsSync(f)) fs.writeFileSync(f, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
  return Buffer.from(fs.readFileSync(f, 'utf8').trim(), 'hex');
}
export function seal(secret, plaintextB64) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', secret, iv);
  const ct = Buffer.concat([c.update(Buffer.from(plaintextB64, 'base64')), c.final()]);
  return { iv: iv.toString('base64'), ct: ct.toString('base64'), tag: c.getAuthTag().toString('base64') };
}
export function unseal(secret, box) {
  const d = crypto.createDecipheriv('aes-256-gcm', secret, Buffer.from(box.iv, 'base64'));
  d.setAuthTag(Buffer.from(box.tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(box.ct, 'base64')), d.final()]).toString('base64');
}

/** Limiteur simple : n échecs maximum par clé sur une fenêtre glissante. */
export class FailureLimiter {
  constructor(max = 10, windowMs = 15 * 60000) { this.max = max; this.windowMs = windowMs; this.map = new Map(); }
  blocked(key) { const l = (this.map.get(key) || []).filter(t => Date.now() - t < this.windowMs); this.map.set(key, l); return l.length >= this.max; }
  fail(key) { const l = this.map.get(key) || []; l.push(Date.now()); this.map.set(key, l); }
  reset(key) { this.map.delete(key); }
}
