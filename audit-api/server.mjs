/* Serveur de référence de la PWA d'audit des prestations de prélèvement.
 * Aucune dépendance : Node.js ≥ 20. Démarrage : node audit-api/server.mjs
 *
 *  - API REST /api/v1 : authentification (jetons par utilisateur et par appareil), rôles, appareils
 *    révocables, synchronisation différentielle (push/pull par révision et curseur), médias,
 *    réservation de numéros d'audit, journal serveur, API d'interopérabilité (lecture, exports CSV).
 *  - Sert aussi l'application (fichiers statiques du dépôt) : un seul point d'accès HTTPS.
 *
 * Variables d'environnement : PORT, HOST, DATA_DIR, STATIC_ROOT, TLS_CERT, TLS_KEY, CORS_ORIGINS,
 * TOKEN_TTL_HOURS, ADMIN_USERNAME, ADMIN_PASSWORD, SERVER_SECRET, ALERT_WEBHOOK_URL.
 */
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JsonDB } from './lib/db.mjs';
import { hashPassword, verifyPassword, newToken, sha256, uuid, loadServerSecret, seal, unseal, FailureLimiter } from './lib/security.mjs';
import { ROLES, roleCan, canWrite } from '../audit/js/domain/permissions.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const VERSION = '1.0.0';
const LOCAL_ONLY = new Set(['conflict', 'syncLog', 'localSecret', 'syncBase']);
const SERVER_MANAGED = new Set(['user']);
const ID_RE = /^[\w:.@\-]{1,160}$/;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.pdf': 'application/pdf', '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8' };

class ApiError extends Error { constructor(status, message, code) { super(message); this.status = status; this.code = code; } }

export function createApp(cfg = {}) {
  const config = {
    port: Number(cfg.port ?? process.env.PORT ?? 8080), host: cfg.host ?? process.env.HOST ?? '0.0.0.0',
    dataDir: path.resolve(cfg.dataDir ?? process.env.DATA_DIR ?? path.join(HERE, 'data')),
    staticRoot: path.resolve(cfg.staticRoot ?? process.env.STATIC_ROOT ?? path.join(HERE, '..')),
    tokenTtlHours: Number(cfg.tokenTtlHours ?? process.env.TOKEN_TTL_HOURS ?? 168),
    corsOrigins: (cfg.corsOrigins ?? process.env.CORS_ORIGINS ?? '').split(',').map(s => s.trim()).filter(Boolean),
    adminUsername: cfg.adminUsername ?? process.env.ADMIN_USERNAME ?? 'admin',
    adminPassword: cfg.adminPassword ?? process.env.ADMIN_PASSWORD ?? null,
    alertWebhook: cfg.alertWebhook ?? process.env.ALERT_WEBHOOK_URL ?? null,
    tlsCert: cfg.tlsCert ?? process.env.TLS_CERT ?? null, tlsKey: cfg.tlsKey ?? process.env.TLS_KEY ?? null,
    quiet: !!cfg.quiet
  };
  fs.mkdirSync(config.dataDir, { recursive: true });
  const db = new JsonDB(config.dataDir);
  const secret = loadServerSecret(config.dataDir);
  const limiter = new FailureLimiter();
  const log = (...a) => { if (!config.quiet) console.log(new Date().toISOString(), ...a); };

  /* ---------- Utilisateurs ---------- */
  const publicUser = u => ({ id: u.id, username: u.username, name: u.name, role: u.role, active: u.active !== false });
  function upsertUserEntity(u) { db.put('user', u.id, { data: { ...publicUser(u), createdAt: u.createdAt }, by: 'serveur' }); }
  function createUser({ username, name, role, password, active = true }, by = 'serveur') {
    username = String(username || '').trim().toLowerCase();
    if (!/^[a-z0-9._-]{2,40}$/.test(username)) throw new ApiError(400, 'Identifiant invalide (2 à 40 caractères : lettres, chiffres, . _ -)');
    if (!ROLES[role]) throw new ApiError(400, 'Profil inconnu');
    if (!password || String(password).length < 8) throw new ApiError(400, 'Mot de passe : 8 caractères minimum');
    if (Object.values(db.data.users).some(u => u.username === username)) throw new ApiError(409, 'Identifiant déjà utilisé');
    const u = { id: uuid(), username, name: String(name || username).trim(), role, active, password: hashPassword(password), createdAt: new Date().toISOString() };
    db.data.users[u.id] = u; upsertUserEntity(u); db.save();
    db.journal({ event: 'user.create', by, userId: u.id, username, role });
    return u;
  }
  if (!Object.keys(db.data.users).length) {
    const pw = config.adminPassword || newToken().slice(0, 16);
    createUser({ username: config.adminUsername, name: 'Administrateur', role: 'admin', password: pw });
    db.flush();
    if (!config.adminPassword) console.log(`\n*** Compte administrateur initial : ${config.adminUsername} / ${pw} — changez ce mot de passe dès la première connexion. ***\n`);
  }

  /* ---------- Authentification ---------- */
  function authenticate(req) {
    const h = req.headers.authorization || '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : null;
    // Un appareil désactivé est signalé comme tel même si ses sessions ont été supprimées.
    const claimed = db.data.devices[String(req.headers['x-device-id'] || '')];
    if (claimed?.revoked) throw new ApiError(401, 'Appareil désactivé par l’administrateur', 'DEVICE_REVOKED');
    if (!token) throw new ApiError(401, 'Authentification requise', 'UNAUTHENTICATED');
    const s = db.data.sessions[sha256(token)];
    if (!s) throw new ApiError(401, 'Session inconnue ou expirée', 'TOKEN_EXPIRED');
    if (new Date(s.expiresAt) < new Date()) { delete db.data.sessions[sha256(token)]; db.save(); throw new ApiError(401, 'Session expirée', 'TOKEN_EXPIRED'); }
    const user = db.data.users[s.userId];
    if (!user || user.active === false) throw new ApiError(401, 'Compte désactivé', 'USER_DISABLED');
    const device = db.data.devices[s.deviceId];
    if (device?.revoked) throw new ApiError(401, 'Appareil désactivé par l’administrateur', 'DEVICE_REVOKED');
    if (device) { device.lastSeenAt = new Date().toISOString(); device.lastUser = user.name; db.save(); }
    return { user, device, tokenHash: sha256(token) };
  }
  const requirePerm = (ctx, perm) => { if (!roleCan(ctx.user.role, perm)) throw new ApiError(403, 'Droit insuffisant pour cette opération'); };

  /* ---------- Routes ---------- */
  const routes = [];
  const on = (method, pattern, fn, { auth = true } = {}) => {
    const keys = []; const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
    routes.push({ method, re, keys, fn, auth });
  };

  on('GET', '/health', () => ({ ok: true, service: 'oeg-audit-api', version: VERSION, time: new Date().toISOString() }), { auth: false });
  on('GET', '/openapi.json', () => JSON.parse(fs.readFileSync(path.join(HERE, 'openapi.json'), 'utf8')), { auth: false });

  on('POST', '/auth/login', ({ body, req }) => {
    const username = String(body.username || '').trim().toLowerCase();
    const ip = req.socket.remoteAddress;
    if (limiter.blocked('u:' + username) || limiter.blocked('ip:' + ip)) throw new ApiError(429, 'Trop de tentatives : réessayez dans 15 minutes.');
    const user = Object.values(db.data.users).find(u => u.username === username);
    if (!user || !verifyPassword(body.password, user.password)) { limiter.fail('u:' + username); limiter.fail('ip:' + ip); db.journal({ event: 'login.failure', username, ip }); throw new ApiError(401, 'Identifiant ou mot de passe incorrect', 'BAD_CREDENTIALS'); }
    if (user.active === false) throw new ApiError(401, 'Compte désactivé', 'USER_DISABLED');
    limiter.reset('u:' + username);
    const dev = body.device || {};
    if (!dev.id || !ID_RE.test(dev.id)) throw new ApiError(400, 'Identifiant d’appareil manquant');
    let device = db.data.devices[dev.id];
    if (device?.revoked) { db.journal({ event: 'login.revoked-device', username, deviceId: dev.id }); throw new ApiError(401, 'Appareil désactivé par l’administrateur', 'DEVICE_REVOKED'); }
    if (!device) {
      device = db.data.devices[dev.id] = { id: dev.id, name: String(dev.name || 'Appareil').slice(0, 80), number: ++db.data.deviceCounter, userAgent: String(dev.userAgent || '').slice(0, 300), registeredAt: new Date().toISOString(), registeredBy: user.username, revoked: false };
      db.journal({ event: 'device.register', deviceId: dev.id, number: device.number, by: user.username });
    }
    device.name = String(dev.name || device.name).slice(0, 80);
    device.lastSeenAt = new Date().toISOString(); device.lastUser = user.name;
    let deviceKey;
    if (body.deviceKey && !device.keyEscrow) device.keyEscrow = seal(secret, body.deviceKey);
    else if (!body.deviceKey && device.keyEscrow) deviceKey = unseal(secret, device.keyEscrow);
    const token = newToken();
    const expiresAt = new Date(Date.now() + config.tokenTtlHours * 3600000).toISOString();
    db.data.sessions[sha256(token)] = { userId: user.id, deviceId: dev.id, createdAt: new Date().toISOString(), expiresAt };
    user.lastLoginAt = new Date().toISOString();
    db.save();
    db.journal({ event: 'login', userId: user.id, username, deviceId: dev.id });
    return { token, expiresAt, user: publicUser(user), device: { id: device.id, number: device.number, registeredAt: device.registeredAt }, ...(deviceKey ? { deviceKey } : {}) };
  }, { auth: false });

  on('POST', '/auth/logout', ({ ctx }) => { delete db.data.sessions[ctx.tokenHash]; db.save(); return { ok: true }; });
  on('GET', '/me', ({ ctx }) => ({ user: publicUser(ctx.user), device: ctx.device ? { id: ctx.device.id, number: ctx.device.number } : null }));
  on('POST', '/me/password', ({ ctx, body }) => {
    if (!verifyPassword(body.oldPassword, ctx.user.password)) throw new ApiError(400, 'Mot de passe actuel incorrect');
    if (!body.newPassword || String(body.newPassword).length < 8) throw new ApiError(400, 'Mot de passe : 8 caractères minimum');
    ctx.user.password = hashPassword(body.newPassword); db.save();
    db.journal({ event: 'user.password', userId: ctx.user.id });
    return { ok: true };
  });

  /* Utilisateurs (administrateur) */
  on('GET', '/users', ({ ctx }) => { requirePerm(ctx, 'users.manage'); return { users: Object.values(db.data.users).map(u => ({ ...publicUser(u), lastLoginAt: u.lastLoginAt || null, createdAt: u.createdAt })) }; });
  on('POST', '/users', ({ ctx, body }) => { requirePerm(ctx, 'users.manage'); return { user: publicUser(createUser(body, ctx.user.username)) }; });
  on('PATCH', '/users/:id', ({ ctx, body, params }) => {
    requirePerm(ctx, 'users.manage');
    const u = db.data.users[params.id]; if (!u) throw new ApiError(404, 'Utilisateur inconnu');
    if (body.role !== undefined) { if (!ROLES[body.role]) throw new ApiError(400, 'Profil inconnu'); u.role = body.role; }
    if (body.name !== undefined) u.name = String(body.name).trim();
    if (body.active !== undefined) u.active = !!body.active;
    if (body.password) { if (String(body.password).length < 8) throw new ApiError(400, 'Mot de passe : 8 caractères minimum'); u.password = hashPassword(body.password); }
    if (!Object.values(db.data.users).some(x => x.role === 'admin' && x.active !== false)) throw new ApiError(400, 'Il doit rester au moins un administrateur actif');
    if (u.active === false) for (const [k, s] of Object.entries(db.data.sessions)) if (s.userId === u.id) delete db.data.sessions[k];
    upsertUserEntity(u); db.save();
    db.journal({ event: 'user.update', by: ctx.user.username, userId: u.id, changes: Object.keys(body).filter(k => k !== 'password').concat(body.password ? ['password'] : []) });
    return { user: publicUser(u) };
  });

  /* Appareils (administrateur) */
  on('GET', '/devices', ({ ctx }) => { requirePerm(ctx, 'devices.manage'); return { devices: Object.values(db.data.devices).map(({ keyEscrow, ...d }) => d).sort((a, b) => a.number - b.number) }; });
  on('POST', '/devices/:id/revoke', ({ ctx, params, body }) => {
    requirePerm(ctx, 'devices.manage');
    const d = db.data.devices[params.id]; if (!d) throw new ApiError(404, 'Appareil inconnu');
    Object.assign(d, { revoked: true, revokedAt: new Date().toISOString(), revokedBy: ctx.user.username, revokeReason: String(body.reason || '') });
    for (const [k, s] of Object.entries(db.data.sessions)) if (s.deviceId === d.id) delete db.data.sessions[k];
    db.save(); db.journal({ event: 'device.revoke', by: ctx.user.username, deviceId: d.id, reason: d.revokeReason });
    return { ok: true };
  });
  on('POST', '/devices/:id/restore', ({ ctx, params }) => {
    requirePerm(ctx, 'devices.manage');
    const d = db.data.devices[params.id]; if (!d) throw new ApiError(404, 'Appareil inconnu');
    Object.assign(d, { revoked: false, restoredAt: new Date().toISOString(), restoredBy: ctx.user.username });
    delete d.keyEscrow;   // un appareil réactivé repart d'une nouvelle clé (ses données locales ont été effacées)
    db.save(); db.journal({ event: 'device.restore', by: ctx.user.username, deviceId: d.id });
    return { ok: true };
  });

  /* Synchronisation */
  const META = new Set(['updatedAt', 'updatedBy', 'updatedByName', '_rev', '_lv']);
  const changedKeys = (a = {}, b = {}) => [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(k => !META.has(k) && JSON.stringify(a[k]) !== JSON.stringify(b[k]));
  on('POST', '/sync/push', ({ ctx, body }) => {
    const results = [];
    for (const c of (body.changes || []).slice(0, 200)) {
      const { type, id } = c;
      const ref = { type, id };
      try {
        if (!ID_RE.test(String(type)) || !ID_RE.test(String(id))) throw new ApiError(400, 'type ou identifiant invalide');
        if (LOCAL_ONLY.has(type) || SERVER_MANAGED.has(type)) { results.push({ ...ref, status: 'ignored' }); continue; }
        if (!canWrite(ctx.user.role, type) && !(ctx.user.role === 'admin' && !['trail'].includes(type))) throw new ApiError(403, `profil « ${ROLES[ctx.user.role]} » non autorisé à modifier « ${type} »`);
        const data = c.data || {};
        if (data.id !== undefined && data.id !== id) throw new ApiError(400, 'identifiant incohérent');
        if (JSON.stringify(data).length > 5_000_000) throw new ApiError(413, 'objet trop volumineux');
        const cur = db.get(type, id);
        if (cur && (Number(c.baseRev) || 0) !== cur.rev) { results.push({ ...ref, status: 'conflict', current: { rev: cur.rev, data: cur.data, deleted: cur.deleted } }); continue; }
        if (type === 'trail' && cur) throw new ApiError(409, 'le journal est en ajout seul : entrée existante non modifiable');
        if (type === 'audit' && cur?.data?.lock?.lockedAt && !roleCan(ctx.user.role, 'audit.amend')) {
          const keys = changedKeys(cur.data, data);
          if (keys.some(k => k !== 'reports')) throw new ApiError(403, 'audit signé et verrouillé : modification réservée au responsable qualité');
        }
        if (type === 'audit' && cur?.data?.lock?.lockedAt && !data.lock?.lockedAt) throw new ApiError(403, 'un audit verrouillé ne peut pas être déverrouillé');
        const rec = db.put(type, id, { data, deleted: !!c.deleted, by: ctx.user.username, deviceId: ctx.device?.id });
        db.journal({ event: 'sync.put', seq: rec.seq, type, id, rev: rec.rev, deleted: !!c.deleted, by: ctx.user.username, deviceId: ctx.device?.id, sha256: sha256(JSON.stringify(data)) });
        results.push({ ...ref, status: 'ok', rev: rec.rev, seq: rec.seq });
        if (type === 'alert' && !cur) notifyAlert(data);
      } catch (e) { results.push({ ...ref, status: 'rejected', error: e.message }); }
    }
    return { results, serverTime: new Date().toISOString() };
  });
  on('GET', '/sync/pull', ({ query }) => {
    const since = Number(query.since) || 0, limit = Math.min(1000, Number(query.limit) || 500);
    const r = db.changesSince(since, limit);
    return { changes: r.changes, cursor: r.changes.length ? r.changes[r.changes.length - 1].seq : since, more: r.more, serverTime: new Date().toISOString() };
  });
  on('POST', '/sequences/reserve', ({ ctx, body }) => {
    requirePerm(ctx, 'audit.create');
    const name = String(body.name || 'AUD').replace(/[^\w-]/g, ''), year = Number(body.year) || new Date().getFullYear(), count = Math.min(100, Math.max(1, Number(body.count) || 20));
    const key = `${name}-${year}`;
    const from = (db.data.sequences[key] || 0) + 1, to = from + count - 1;
    if (to >= 900000) throw new ApiError(409, 'plage de numérotation épuisée');
    db.data.sequences[key] = to; db.save();
    db.journal({ event: 'sequence.reserve', key, from, to, by: ctx.user.username, deviceId: ctx.device?.id });
    return { name, year, from, to };
  });

  /* Médias */
  on('PUT', '/media/:id', ({ ctx, params, raw, req }) => {
    if (!canWrite(ctx.user.role, 'media')) throw new ApiError(403, 'Droit insuffisant');
    if (!ID_RE.test(params.id)) throw new ApiError(400, 'identifiant invalide');
    const hash = sha256(raw);
    const expected = req.headers['x-sha256'];
    if (expected && expected !== hash) throw new ApiError(400, 'empreinte SHA-256 incorrecte : fichier altéré pendant le transfert');
    const existing = db.getMedia(params.id);
    if (existing && existing.meta.sha256 !== hash) throw new ApiError(409, 'média déjà enregistré avec un contenu différent (les médias sont immuables)');
    if (!existing) { db.putMedia(params.id, raw, { sha256: hash, mime: String(req.headers['content-type'] || 'application/octet-stream'), size: raw.length, by: ctx.user.username, at: new Date().toISOString() }); db.journal({ event: 'media.put', id: params.id, sha256: hash, size: raw.length, by: ctx.user.username }); }
    return { ok: true, sha256: hash };
  });
  on('GET', '/media/:id', ({ params }) => {
    const m = db.getMedia(params.id); if (!m) throw new ApiError(404, 'média inconnu');
    return { __raw: m.bytes, contentType: m.meta.mime, headers: { 'X-Sha256': m.meta.sha256 } };
  });

  /* Interopérabilité (lecture) */
  on('GET', '/entities/:type', ({ params, query }) => {
    let list = db.list(params.type);
    if (query.updatedSince) list = list.filter(e => e.updatedAt >= query.updatedSince);
    return { type: params.type, count: list.length, items: list.slice(0, Math.min(5000, Number(query.limit) || 1000)) };
  });
  on('GET', '/entities/:type/:id', ({ params }) => { const r = db.get(params.type, params.id); if (!r || r.deleted) throw new ApiError(404, 'introuvable'); return { id: params.id, rev: r.rev, updatedAt: r.updatedAt, ...r.data }; });
  on('GET', '/export/:name', ({ params }) => {
    const csv = (rows) => '﻿' + rows.map(r => r.map(v => { const s = String(v ?? ''); return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(';')).join('\r\n');
    const name = id => db.get('provider', id)?.data?.name || '';
    const site = id => db.get('site', id)?.data?.name || '';
    if (params.name === 'deviations.csv') return { __raw: Buffer.from(csv([['Numéro', 'Date', 'Audit', 'Prestataire', 'Site', 'Exigence', 'Description', 'Criticité', 'Action corrective', 'Responsable', 'Délai', 'Statut'], ...db.list('deviation').map(d => [d.number, d.date, d.auditNumber, name(d.providerId), site(d.siteId), d.requirement, d.description, d.criticalityCode, d.correctiveActionRequested, d.responsible, d.dueDate, d.status])])), contentType: 'text/csv; charset=utf-8' };
    if (params.name === 'audits.csv') return { __raw: Buffer.from(csv([['Numéro', 'Type', 'Début', 'Fin', 'Statut', 'Prestataire', 'Site', 'Auditeur', 'Grille', 'Version', 'Verrouillé le', 'Empreinte'], ...db.list('audit').map(a => [a.number, a.kind, a.startedAt, a.endedAt, a.status, name(a.providerId), site(a.siteId), a.auditorName, a.gridCode, a.gridVersion, a.lock?.lockedAt, a.lock?.contentHash])])), contentType: 'text/csv; charset=utf-8' };
    throw new ApiError(404, 'export inconnu (deviations.csv, audits.csv)');
  });
  on('GET', '/journal', ({ ctx, query }) => { requirePerm(ctx, 'trail.view'); return { entries: db.readJournal({ since: Number(query.since) || 0, limit: Math.min(2000, Number(query.limit) || 500) }) }; });
  on('GET', '/admin/backup', ({ ctx }) => { requirePerm(ctx, 'settings.manage'); db.journal({ event: 'backup', by: ctx.user.username }); return { __raw: Buffer.from(JSON.stringify({ format: 'oeg-audit-server-backup-v1', at: new Date().toISOString(), data: db.data })), contentType: 'application/json', headers: { 'Content-Disposition': 'attachment; filename="sauvegarde-serveur-audit.json"' } }; });

  function notifyAlert(alert) {
    log('ALERTE D’URGENCE', alert.category, '—', alert.message);
    if (!config.alertWebhook) return;
    fetch(config.alertWebhook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'alerte-urgence', service: 'oeg-audit', alert }) })
      .then(r => db.journal({ event: 'alert.webhook', status: r.status, alertId: alert.id }))
      .catch(e => db.journal({ event: 'alert.webhook-error', error: e.message, alertId: alert.id }));
  }

  /* ---------- Serveur HTTP ---------- */
  function securityHeaders(res) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Permissions-Policy', 'geolocation=(self), camera=(self), microphone=(self)');
    if (config.tlsCert) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
  }
  function cors(req, res) {
    const origin = req.headers.origin;
    if (origin && (config.corsOrigins.includes(origin) || config.corsOrigins.includes('*'))) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Device-Id, X-Sha256');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, OPTIONS');
      res.setHeader('Access-Control-Expose-Headers', 'X-Sha256');
      res.setHeader('Access-Control-Max-Age', '600');
    }
  }
  const send = (res, status, obj) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };
  function readBody(req, max) {
    return new Promise((resolve, reject) => {
      const chunks = []; let size = 0;
      req.on('data', c => { size += c.length; if (size > max) { reject(new ApiError(413, 'requête trop volumineuse')); req.destroy(); } else chunks.push(c); });
      req.on('end', () => resolve(Buffer.concat(chunks)));
      req.on('error', reject);
    });
  }
  function serveStatic(req, res, pathname) {
    if (pathname === '/') { res.writeHead(302, { Location: '/audit/' }); return res.end(); }
    let p = path.normalize(path.join(config.staticRoot, decodeURIComponent(pathname)));
    if (!p.startsWith(config.staticRoot) || /[\\/](\.git|node_modules|audit-api[\\/]data)([\\/]|$)/.test(p)) { res.writeHead(404); return res.end(); }
    if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, 'index.html');
    if (!fs.existsSync(p)) { res.writeHead(404); return res.end('Introuvable'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    fs.createReadStream(p).pipe(res);
  }
  async function handler(req, res) {
    securityHeaders(res); cors(req, res);
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
    const url = new URL(req.url, 'http://x');
    if (!url.pathname.startsWith('/api/v1/')) {
      if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
      return serveStatic(req, res, url.pathname);
    }
    const sub = url.pathname.slice('/api/v1'.length);
    try {
      const r = routes.find(x => x.method === req.method && x.re.test(sub));
      if (!r) throw new ApiError(404, 'route inconnue');
      const m = sub.match(r.re);
      const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
      const ctx = r.auth ? authenticate(req) : null;
      const isMedia = req.method === 'PUT' && sub.startsWith('/media/');
      const rawBody = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await readBody(req, isMedia ? 30_000_000 : 50_000_000) : Buffer.alloc(0);
      let body = {};
      if (!isMedia && rawBody.length) { try { body = JSON.parse(rawBody.toString('utf8')); } catch (e) { throw new ApiError(400, 'JSON invalide'); } }
      const out = await r.fn({ req, ctx, params, body, raw: rawBody, query: Object.fromEntries(url.searchParams) });
      if (out?.__raw) { res.writeHead(200, { 'Content-Type': out.contentType || 'application/octet-stream', 'Cache-Control': 'no-store', ...(out.headers || {}) }); return res.end(out.__raw); }
      send(res, 200, out ?? { ok: true });
    } catch (e) {
      if (!(e instanceof ApiError)) { log('ERREUR', e); return send(res, 500, { error: 'Erreur interne du serveur' }); }
      send(res, e.status, { error: e.message, ...(e.code ? { code: e.code } : {}) });
    }
  }
  const server = config.tlsCert && config.tlsKey
    ? https.createServer({ cert: fs.readFileSync(config.tlsCert), key: fs.readFileSync(config.tlsKey) }, handler)
    : http.createServer(handler);
  return {
    server, db, config,
    listen() { return new Promise(r => server.listen(config.port, config.host, () => { log(`Serveur d’audit ${VERSION} — ${config.tlsCert ? 'https' : 'http'}://${config.host}:${server.address().port}/audit/ — données : ${config.dataDir}`); r(server.address().port); })); },
    close() { db.flush(); return new Promise(r => server.close(() => r())); },
    createUser
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const app = createApp();
  await app.listen();
  const stop = () => { app.db.flush(); process.exit(0); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
}
