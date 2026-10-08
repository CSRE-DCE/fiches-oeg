/* Authentification, rôles et droits.
 *
 * Deux modes :
 *  - autonome : comptes locaux à l'appareil, créés par l'administrateur local ;
 *  - serveur  : comptes gérés par le serveur ; la première connexion d'un utilisateur sur un appareil
 *               se fait en ligne, les suivantes peuvent se faire hors connexion (mot de passe vérifié
 *               localement par désenveloppement de la clé de chiffrement).
 */
import { meta } from './db.js';
import { session, clearSession } from './session.js';
import { store } from './store.js';
import { wrapDEK, unwrapDEK, importDEK, newDEKRaw } from './crypto.js';
import { uuid, nowISO, bytesToBase64, base64ToBytes } from './util.js';

export const ROLES = {
  admin: 'Administrateur',
  rq: 'Responsable qualité',
  superviseur: 'Superviseur',
  auditeur: 'Auditeur',
  consultation: 'Consultation'
};

/** Matrice des droits par profil (le serveur applique la même matrice à la synchronisation). */
export const PERMISSIONS = {
  'audit.create': ['admin', 'rq', 'superviseur', 'auditeur'],
  'audit.edit': ['admin', 'rq', 'superviseur', 'auditeur'],
  'audit.editOthers': ['admin', 'rq', 'superviseur'],
  'audit.amend': ['admin', 'rq'],                 // modification d'un audit signé (avec motif)
  'audit.delete': ['admin', 'rq'],                // abandon d'un audit non signé
  'deviation.manage': ['admin', 'rq', 'superviseur', 'auditeur'],
  'deviation.close': ['admin', 'rq', 'superviseur'],
  'observation.create': ['admin', 'rq', 'superviseur', 'auditeur'],
  'planning.manage': ['admin', 'rq', 'superviseur'],
  'ref.manage': ['admin', 'rq'],                  // référentiels, documents, grilles
  'trail.view': ['admin', 'rq', 'superviseur'],
  'users.manage': ['admin'],
  'devices.manage': ['admin'],
  'settings.manage': ['admin'],
  'export': ['admin', 'rq', 'superviseur', 'auditeur', 'consultation']
};

export function can(perm, user = session.user) {
  if (!user) return false;
  return (PERMISSIONS[perm] || []).includes(user.role);
}
/** Droit d'éditer un audit précis (auteur ou encadrement). */
export function canEditAudit(audit, user = session.user) {
  if (!audit || !user) return false;
  if (audit.lock?.lockedAt) return false;
  if (!can('audit.edit', user)) return false;
  return audit.auditorId === user.id || can('audit.editOthers', user);
}

/* ---------- trousseau de clés local ---------- */
export async function getKeyring() { return meta.get('keyring', { users: {} }); }
async function saveKeyring(k) { await meta.set('keyring', k); }
export async function isSetUp() { const k = await getKeyring(); return Object.keys(k.users).length > 0; }
export async function knownUsers() {
  const k = await getKeyring();
  return Object.entries(k.users).map(([username, e]) => ({ username, name: e.name, role: e.role, lastLogin: e.lastLogin }))
    .sort((a, b) => String(b.lastLogin || '').localeCompare(String(a.lastLogin || '')));
}

export async function loadDevice() {
  let device = await meta.get('device');
  if (!device) {
    device = { id: uuid(), name: defaultDeviceName(), number: 1, createdAt: nowISO() };
    await meta.set('device', device);
  }
  session.device = device;
  session.mode = await meta.get('mode', null);
  session.serverUrl = await meta.get('serverUrl', '');
  return device;
}
export async function updateDevice(patch) {
  const device = { ...(await meta.get('device')), ...patch };
  await meta.set('device', device); session.device = device; return device;
}
export function defaultDeviceName() {
  const ua = globalThis.navigator?.userAgent || '';
  const os = /Android/.test(ua) ? 'Android' : /iPad|iPhone|Macintosh/.test(ua) && 'ontouchend' in (globalThis.document || {}) ? 'iPad/iPhone' : /Windows/.test(ua) ? 'Windows' : /Mac/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : 'Appareil';
  const br = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Navigateur';
  return `${os} · ${br}`;
}

async function openWithDEK(dekRaw, user) {
  session.dekRaw = dekRaw;
  session.dek = await importDEK(dekRaw);
  session.user = user;
  session.unlockedAt = nowISO();
  session.lastActivity = Date.now();
  await store.load();
}

/** Premier démarrage en mode autonome : crée l'administrateur local et la clé de l'appareil. */
export async function setupStandalone({ deviceName, deviceNumber, admin }) {
  if (await isSetUp()) throw new Error('Cet appareil est déjà configuré.');
  validatePassword(admin.password);
  await loadDevice();
  await updateDevice({ name: deviceName || defaultDeviceName(), number: Math.max(1, Math.min(99, Number(deviceNumber) || 1)) });
  await meta.set('mode', 'standalone'); session.mode = 'standalone';
  const dekRaw = newDEKRaw();
  const user = { id: uuid(), username: normUsername(admin.username), name: admin.name.trim(), role: 'admin', active: true };
  const k = await getKeyring();
  k.users[user.username] = { userId: user.id, name: user.name, role: user.role, wrap: await wrapDEK(dekRaw, admin.password), lastLogin: nowISO() };
  await saveKeyring(k);
  await openWithDEK(dekRaw, user);
  await store.put('user', { ...user, source: 'local' }, { action: 'create', reason: 'Configuration initiale de l’appareil' });
  await store.log('setup', { entityLabel: session.device.name, details: { mode: 'autonome', device: session.device } });
  return user;
}

/** Ouverture de session hors connexion (ou en ligne, la vérification est locale). */
export async function unlock(username, password) {
  username = normUsername(username);
  const k = await getKeyring();
  const entry = k.users[username];
  if (!entry) return { ok: false, error: 'Compte inconnu sur cet appareil.' };
  if (entry.disabled) return { ok: false, error: 'Ce compte est désactivé sur cet appareil.' };
  const dekRaw = await unwrapDEK(entry.wrap, password);
  if (!dekRaw) {
    entry.failures = (entry.failures || 0) + 1; entry.lastFailure = nowISO();
    await saveKeyring(k);
    return { ok: false, error: 'Mot de passe incorrect.' };
  }
  entry.failures = 0; entry.lastLogin = nowISO();
  await saveKeyring(k);
  await openWithDEK(dekRaw, { id: entry.userId, username, name: entry.name, role: entry.role });
  // Le profil enregistré dans les données (rôle mis à jour par un administrateur) fait foi.
  const profile = store.get('user', entry.userId);
  if (profile) {
    if (profile.active === false) { await lock('compte désactivé'); return { ok: false, error: 'Ce compte a été désactivé.' }; }
    session.user = { id: profile.id, username, name: profile.name, role: profile.role };
    if (profile.role !== entry.role || profile.name !== entry.name) { entry.role = profile.role; entry.name = profile.name; await saveKeyring(k); }
  }
  await store.log('login', { entityType: 'user', entityId: session.user.id, entityLabel: session.user.name });
  return { ok: true, user: session.user, password };
}

export async function lock(reason = 'manuel') {
  if (session.unlocked) {
    try { await store.log('logout', { entityType: 'user', entityId: session.user.id, entityLabel: session.user.name, reason }); await store.flush(); } catch (e) { /* journal best effort */ }
  }
  store.unload();
  clearSession();
}

/** Crée un compte local (mode autonome) ou enregistre localement un compte serveur. */
export async function addLocalAccount({ id, username, name, role, password, source = 'local', extra = {} }) {
  if (!session.dekRaw) throw new Error('Session fermée');
  validatePassword(password);
  username = normUsername(username);
  const k = await getKeyring();
  if (k.users[username] && k.users[username].userId !== id) throw new Error('Identifiant déjà utilisé sur cet appareil.');
  const userId = id || uuid();
  k.users[username] = { userId, name, role, wrap: await wrapDEK(session.dekRaw, password), lastLogin: null };
  await saveKeyring(k);
  if (source === 'local') {
    const existing = store.get('user', userId);
    await store.put('user', { ...(existing || {}), id: userId, username, name, role, active: true, source, ...extra });
  }
  return userId;
}
export async function removeLocalAccount(username) {
  const k = await getKeyring(); delete k.users[normUsername(username)]; await saveKeyring(k);
}
export async function setLocalAccountDisabled(username, disabled) {
  const k = await getKeyring(); const e = k.users[normUsername(username)];
  if (e) { e.disabled = !!disabled; await saveKeyring(k); }
}
export async function syncKeyringProfile(user) {
  const k = await getKeyring(); const e = k.users[normUsername(user.username)];
  if (e) { e.name = user.name; e.role = user.role; e.disabled = user.active === false; await saveKeyring(k); }
}

export async function changePassword(oldPassword, newPassword) {
  validatePassword(newPassword);
  const k = await getKeyring();
  const entry = k.users[session.user.username];
  if (!entry || !(await unwrapDEK(entry.wrap, oldPassword))) throw new Error('Mot de passe actuel incorrect.');
  entry.wrap = await wrapDEK(session.dekRaw, newPassword);
  await saveKeyring(k);
  await store.log('password-change', { entityType: 'user', entityId: session.user.id, entityLabel: session.user.name });
}

export function validatePassword(p) {
  if (!p || String(p).length < 8) throw new Error('Le mot de passe doit comporter au moins 8 caractères.');
}
export function normUsername(u) { return String(u || '').trim().toLowerCase(); }

/* ---------- mode serveur ---------- */
export function apiUrl(path) {
  const base = String(session.serverUrl || '').replace(/\/+$/, '');
  return base + '/api/v1' + path;
}
export function assertSecureUrl(url) {
  const u = new URL(url);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
  if (u.protocol !== 'https:' && !local) throw new Error('Le serveur doit être joint en HTTPS (communications chiffrées).');
  return u.origin + u.pathname.replace(/\/+$/, '');
}

/** Connexion en ligne ; crée la clé de l'appareil au premier démarrage, ou récupère la clé déposée. */
export async function serverLogin(serverUrl, username, password, { firstSetup = false } = {}) {
  serverUrl = assertSecureUrl(serverUrl);
  await loadDevice();
  const k = await getKeyring();
  const hasLocalKey = Object.keys(k.users).length > 0;
  const freshKey = !hasLocalKey ? newDEKRaw() : null;
  const res = await fetch(serverUrl + '/api/v1/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: normUsername(username), password,
      device: { id: session.device.id, name: session.device.name, userAgent: navigator.userAgent },
      // Au premier démarrage, la clé de l'appareil est déposée sur le serveur (canal HTTPS) : elle
      // permettra à un autre utilisateur autorisé d'ouvrir une session sur cet appareil sans perte des
      // données non encore synchronisées. Le serveur refuse ce dépôt pour un appareil révoqué.
      deviceKey: freshKey ? bytesToBase64(freshKey) : undefined
    })
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Connexion refusée (${res.status})`);
  let dekRaw = freshKey;
  if (!dekRaw) {
    const entry = k.users[normUsername(username)];
    dekRaw = entry ? await unwrapDEK(entry.wrap, password) : null;
    if (!dekRaw && body.deviceKey) dekRaw = base64ToBytes(body.deviceKey);
    if (!dekRaw) throw new Error('Impossible d’ouvrir les données de cet appareil avec ce compte. Contactez l’administrateur.');
  }
  await meta.set('mode', 'server'); await meta.set('serverUrl', serverUrl);
  session.mode = 'server'; session.serverUrl = serverUrl;
  if (body.device?.number) await updateDevice({ number: body.device.number, serverRegisteredAt: body.device.registeredAt || nowISO() });
  const user = { id: body.user.id, username: body.user.username, name: body.user.name, role: body.user.role };
  k.users[user.username] = { userId: user.id, name: user.name, role: user.role, wrap: await wrapDEK(dekRaw, password), lastLogin: nowISO() };
  await saveKeyring(k);
  await openWithDEK(dekRaw, user);
  session.token = body.token; session.tokenExpiresAt = body.expiresAt;
  await saveToken();
  await store.log(firstSetup ? 'setup' : 'login', { entityType: 'user', entityId: user.id, entityLabel: user.name, details: { mode: 'serveur', serveur: serverUrl } });
  return user;
}

/** Renouvelle le jeton serveur après une ouverture de session locale (si le réseau est disponible). */
export async function refreshServerToken(password) {
  if (session.mode !== 'server' || !navigator.onLine) return false;
  try {
    const res = await fetch(apiUrl('/auth/login'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: session.user.username, password, device: { id: session.device.id, name: session.device.name, userAgent: navigator.userAgent } })
    });
    const body = await res.json().catch(() => ({}));
    if (res.status === 401 && body.code === 'DEVICE_REVOKED') return { revoked: true };
    if (!res.ok) return false;
    session.token = body.token; session.tokenExpiresAt = body.expiresAt;
    if (body.user?.role && body.user.role !== session.user.role) { session.user.role = body.user.role; await syncKeyringProfile({ ...session.user }); }
    await saveToken();
    return true;
  } catch (e) { return false; }
}
/** Le jeton est conservé chiffré (avec la clé de l'appareil) pour reprendre la synchronisation après verrouillage. */
async function saveToken() {
  if (!session.token) return;
  await store.put('localSecret', { id: 'serverToken:' + session.user.id, token: session.token, expiresAt: session.tokenExpiresAt });
}
export function restoreToken() {
  const t = store.get('localSecret', 'serverToken:' + session.user?.id);
  if (t && (!t.expiresAt || new Date(t.expiresAt) > new Date())) { session.token = t.token; session.tokenExpiresAt = t.expiresAt; }
}
