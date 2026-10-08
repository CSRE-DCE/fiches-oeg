/* Tests de bout en bout de la PWA d'audit dans Chromium (Playwright), avec le serveur de référence.
 *  A. Parcours terrain complet en mode autonome : configuration, préparation, audit, logique
 *     conditionnelle, alertes, preuves, écart, échantillons, équipements, signatures, verrouillage,
 *     rapport PDF, modification motivée après signature, vérification d'intégrité, tous les écrans.
 *  B. Hors connexion réel : service worker, rechargement sans réseau, ouverture de session locale.
 *  C. Serveur : deux appareils, synchronisation différentielle, fusion de conflit, droits, médias,
 *     alerte d'urgence, révocation d'un appareil perdu (effacement des données locales).
 * Usage : node tests/audit-e2e.mjs   (après npm install && npx playwright install chromium)
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../audit-api/server.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const PHOTO = new URL('./fixtures/photo.jpg', import.meta.url).pathname;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oeg-audit-e2e-'));
let failures = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) { failures++; process.exitCode = 1; } };

const app = createApp({ port: 0, host: '127.0.0.1', dataDir: path.join(tmp, 'server'), adminPassword: 'admin-pass-123', quiet: true });
const port = await app.listen();
const BASE = `http://localhost:${port}`;
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const errors = [];

async function newDevice(name, opts = {}) {
  const ctx = await browser.newContext({ serviceWorkers: opts.sw ? 'allow' : 'block', viewport: { width: 430, height: 900 }, geolocation: { latitude: 4.93, longitude: -52.33, accuracy: 12 }, permissions: ['geolocation'], acceptDownloads: true });
  await ctx.route(/tile\.openstreetmap\.org/, r => r.abort());
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(`${name}: ${e.message}`));
  await page.goto(BASE + '/audit/');
  await page.waitForSelector('form[data-submit=standalone]');
  return { ctx, page };
}
async function setupStandalone(page) {
  await page.fill('input[name=name]', 'Marie Auditrice'); await page.fill('input[name=username]', 'marie');
  await page.fill('input[name=password]', 'motdepasse1'); await page.fill('input[name=password2]', 'motdepasse1');
  await page.click('#setupBtn');
  await page.waitForSelector('#view .page-title', { timeout: 30000 });
}
async function signPad(page) {
  await page.waitForSelector('#__sig');
  const b = await page.locator('#__sig').boundingBox();
  await page.mouse.move(b.x + 20, b.y + 40); await page.mouse.down();
  for (let i = 0; i < 20; i++) await page.mouse.move(b.x + 20 + i * 10, b.y + 40 + Math.sin(i) * 20);
  await page.mouse.up(); await page.click('.modal [data-act=ok]'); await page.waitForTimeout(700);
}
const go = async (page, hash, sel) => { await page.goto(`${BASE}/audit/#${hash}`); if (sel) await page.waitForSelector(sel); };
const texts = (page, sel) => page.evaluate(s => [...document.querySelectorAll(s)].map(e => e.textContent.trim()), sel);

try {
  /* ---------------- A. Parcours terrain (mode autonome) ---------------- */
  const { page } = await newDevice('A');
  await setupStandalone(page);
  ok(await page.evaluate(() => AuditApp.store.count('site')) === 108, 'A : référentiel des fiches terrain repris (108 sites)');
  ok((await page.textContent('#view')).includes('Planning des prestations'), 'A : planning affiché');
  await page.click('a[href="#/prestation/pres-DEMO-1"]');
  await page.waitForSelector('[data-act=start]');
  ok((await page.textContent('#view')).includes('versions utilisées pour l’audit'), 'A : fiche de préparation avec documents applicables');
  await page.click('[data-act=start]');
  await page.waitForSelector('.modal [data-act=pick], .audit-head');
  if (await page.$('.modal [data-act=pick]')) await page.click('.modal [data-act=pick]');
  await page.waitForSelector('.audit-head');
  const auditId = await page.evaluate(() => location.hash.split('/')[2]);
  const audit0 = await page.evaluate(id => AuditApp.store.get('audit', id), auditId);
  ok(/^AUD-2026-01\d{4}$/.test(audit0.number) || /^AUD-\d{4}-01\d{4}$/.test(audit0.number), 'A : numéro d’audit ' + audit0.number);
  ok(audit0.documentsSnapshot.some(d => d.type === 'PROTOCOLE' && d.version === '2' && d.sha256.length === 64), 'A : instantané figé du protocole applicable (v2)');
  ok(audit0.gridSnapshot && audit0.appVersion && audit0.device?.id, 'A : grille, version de l’application et appareil enregistrés');

  await go(page, `/audit/${auditId}/sec-qualif`, '#item-it-Q01');
  for (const c of ['Q01', 'Q02', 'Q05', 'Q06', 'Q07', 'Q08', 'Q09', 'Q10']) { await page.click(`#item-it-${c} [data-act=resp][data-value=C]`); await page.waitForTimeout(120); }
  await page.click('#item-it-Q04 [data-act=resp][data-value=NC]'); await page.waitForTimeout(200);
  ok((await page.textContent('#item-it-Q04')).includes('Justification obligatoire'), 'A : justification exigée en cas de non-conformité');
  await page.fill('#cm-it-Q04', 'Carte d’habilitation non présentée.'); await page.locator('#cm-it-Q04').blur(); await page.waitForTimeout(300);
  await page.setInputFiles('#item-it-Q04 input[data-change=media-add][capture]', PHOTO); await page.waitForTimeout(1500);
  const photo = await page.evaluate(id => AuditApp.store.filter('media', m => m.auditId === id)[0], auditId);
  ok(photo && photo.sha256.length === 64 && photo.link.itemId === 'it-Q04' && photo.gps && photo.authorName === 'Marie Auditrice', 'A : photo horodatée, géolocalisée, attribuée et rattachée au critère');
  await page.click('#item-it-Q04 [data-act=dev-new]'); await page.waitForSelector('#devf');
  await page.click('.modal [data-act=crit][data-code=MAJ]');
  await page.fill('#devf [name=correctiveActionRequested]', 'Présenter la carte sous 15 jours.');
  await page.click('.modal [data-act=ok]'); await page.waitForTimeout(700);
  const dev = await page.evaluate(() => AuditApp.store.all('deviation')[0]);
  ok(dev && dev.number.endsWith('-E01') && dev.criticalityCode === 'MAJ' && dev.dueDate && dev.itemCode === 'Q04', 'A : écart numéroté, criticité et délai par défaut');

  await go(page, `/audit/${auditId}/sec-transport`, '#item-it-T00');
  ok(!(await page.$('#item-it-T07')), 'A : contrôles de la chaîne du froid masqués par défaut');
  await page.click('#item-it-T00 [data-act=val-btn][data-value=true]'); await page.waitForTimeout(400);
  ok(!!(await page.$('#item-it-T07')), 'A : logique conditionnelle — chaîne du froid affichée');
  await page.fill('#item-it-T07 input[data-num]', '11.5'); await page.locator('#item-it-T07 input[data-num]').blur(); await page.waitForTimeout(500);
  ok((await texts(page, '#item-it-T07 .alert .a-title')).some(t => t.includes('Température hors critère')), 'A : alerte température hors critère');
  ok(await page.evaluate(id => AuditApp.store.get('audit', id).responses['it-T07'].status === undefined, auditId), 'A : l’alerte ne crée pas de non-conformité automatiquement');

  await go(page, `/audit/${auditId}/sec-point`, '[data-act=gps-read]');
  await page.click('[data-act=gps-read]'); await page.waitForTimeout(1200);
  ok((await texts(page, '.alert .a-title')).some(t => t.includes('Position éloignée')), 'A : alerte position GPS éloignée du point');
  await page.setInputFiles('#item-it-L05 input[data-change=media-add][capture]', PHOTO); await page.waitForTimeout(1500);

  await go(page, `/audit/${auditId}/sec-ech`, '[data-act=smp-add]');
  await page.click('[data-act=smp-add]'); await page.waitForSelector('#smpf'); await page.fill('#smpCode', 'FLACON-001'); await page.click('.modal [data-act=ok]'); await page.waitForTimeout(500);
  await page.click('[data-act=smp-add]'); await page.waitForSelector('#smpf'); await page.click('.modal [data-act=ok]'); await page.waitForTimeout(500);
  const samples = await page.evaluate(id => AuditApp.store.get('audit', id).samples, auditId);
  ok(samples.length === 2 && samples[0].sampleId.endsWith('-E01') && samples[1].sampleId.endsWith('-E02'), 'A : identifiants d’échantillons générés');
  ok((await texts(page, '.alert .a-title')).some(t => t.includes('Échantillon non identifié')), 'A : alerte échantillon non identifié');

  await go(page, `/audit/${auditId}/sec-equip`, '[data-act=eq-add]');
  await page.click('[data-act=eq-add]'); await page.waitForSelector('#eqf'); await page.selectOption('#eqf [name=registryId]', 'eq-DEMO-2'); await page.click('.modal [data-act=ok]'); await page.waitForTimeout(500);
  ok((await texts(page, '.alert .a-title')).some(t => t.includes('Équipement non valide')), 'A : alerte équipement hors validité');

  // Réponses restantes (critères obligatoires) par l'interface de programmation de l'application
  await page.evaluate(async id => {
    const { setResponse, auditState } = await import('/audit/js/app/audits.js');
    const { store } = await import('/audit/js/core/store.js');
    let a = store.get('audit', id);
    for (const s of auditState(a).structure.filter(s => s.visible)) for (const it of s.visibleItems) {
      const r = a.responses[it.id]; if (r && (r.status || r.value !== undefined) || it.kind === 'photo' || it.kind === 'info') continue;
      const p = it.kind === 'conformity' ? { status: 'C' } : it.kind === 'boolean' ? { value: false } : it.kind === 'select' ? { value: (it.options || ['Méthode'])[0] } : it.kind === 'multiselect' ? { value: [it.options[0]] } : it.kind === 'number' ? { value: 5 } : it.kind === 'time' ? { value: '10:00' } : it.kind === 'datetime' ? { value: new Date(Date.now() + 3600e3).toISOString().slice(0, 16) } : { value: 'v2' };
      a = await setResponse(a, it.id, p);
    }
  }, auditId);
  await go(page, `/audit/${auditId}/synthese`, '.kpis');
  ok((await page.textContent('#view')).includes('sans score global'), 'A : synthèse factuelle sans score global');

  await go(page, `/audit/${auditId}/signatures`, '[data-act=finish]');
  await page.click('[data-act=finish]'); await page.waitForTimeout(400);
  await page.click('[data-act=sign-auditor]'); await signPad(page);
  await page.fill('#repName', 'Paul Modèle'); await page.click('[data-act=sign-provider]'); await signPad(page);
  await page.click('[data-act=lock]'); await page.waitForSelector('.modal [data-act=yes]'); await page.click('.modal [data-act=yes]'); await page.waitForTimeout(900);
  const locked = await page.evaluate(id => AuditApp.store.get('audit', id), auditId);
  ok(locked.status === 'signe' && locked.lock.contentHash.length === 64 && locked.signatures.auditor && locked.signatures.provider, 'A : audit signé (hors connexion) et verrouillé avec empreinte');
  ok(await page.evaluate(() => AuditApp.store.get('prestation', 'pres-DEMO-1').status) === 'realisee_ecart', 'A : prestation passée à « réalisée avec écart »');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-act=report]')]);
  const pdf = fs.readFileSync(await dl.path());
  ok(pdf.subarray(0, 8).toString() === '%PDF-1.4' && pdf.length > 20000 && /_rapport\.pdf$/.test(dl.suggestedFilename()) && !/PROVISOIRE/.test(dl.suggestedFilename()), `A : rapport PDF définitif (${pdf.length} octets)`);

  // Modification après signature : motif obligatoire, valeur précédente conservée
  await page.click('[data-act=amend-start]'); await page.waitForSelector('#__prompt');
  await page.fill('#__prompt', 'Correction d’une erreur de saisie'); await page.click('.modal [data-act=ok]'); await page.waitForTimeout(300);
  await go(page, `/audit/${auditId}/sec-transport`, '#item-it-T07 input[data-num]');
  await page.fill('#item-it-T07 input[data-num]', '6.2'); await page.locator('#item-it-T07 input[data-num]').blur(); await page.waitForTimeout(500);
  const amended = await page.evaluate(async id => { const { verifyAuditSeal } = await import('/audit/js/app/audits.js'); const a = AuditApp.store.get('audit', id); return { am: a.amendments, seal: await verifyAuditSeal(a) }; }, auditId);
  ok(amended.am.length === 1 && amended.am[0].reason === 'Correction d’une erreur de saisie' && amended.am[0].changes.some(c => c.path === 'responses.it-T07.value' && c.before === 11.5 && c.after === 6.2), 'A : modification après signature historisée (avant/après, motif, auteur)');
  ok(amended.seal.ok && amended.seal.amended, 'A : intégrité vérifiée après modification tracée');
  // Altération hors application détectée
  const tampered = await page.evaluate(async id => { const { verifyAuditSeal } = await import('/audit/js/app/audits.js'); const a = structuredClone(AuditApp.store.get('audit', id)); a.responses['it-Q01'].status = 'NC'; return (await verifyAuditSeal(a)).ok; }, auditId);
  ok(tampered === false, 'A : une modification non tracée est détectée');

  // Observation et urgence
  await page.click('[data-act=shell-urgent]'); await page.waitForSelector('#obsf');
  await page.fill('#obsText', 'Berge effondrée près du point de prélèvement'); await page.click('.modal [data-act=ok]'); await page.waitForTimeout(800);
  ok(await page.evaluate(() => AuditApp.store.count('alert') === 1 && AuditApp.store.all('observation')[0].kind === 'urgence' && !!AuditApp.store.all('observation')[0].gps), 'A : urgence enregistrée (observation localisée + alerte à transmettre)');

  // Tous les écrans
  for (const r of ['/', '/audits', '/audits?vue=historique', '/ecarts', `/ecart/${dev.id}`, '/observations', '/prestataires', '/prestataire/prov-DEMO', '/carte', '/tableau-de-bord', '/documents', '/document/doc-PROTO-EX-v2', '/grilles', '/grille/grid-prel-eau-general-v1', '/referentiels', '/referentiel/equipment', '/import', '/export', '/synchronisation', '/journal', '/administration', '/compte', '/menu', '/nouvel-audit', '/comparer']) {
    await go(page, r); await page.waitForTimeout(250);
    const h1 = await page.evaluate(() => document.querySelector('#view h1')?.textContent || '');
    ok(h1 && !/Erreur/.test(h1), `A : écran ${r} → ${h1}`);
  }
  await go(page, '/journal', '[data-act=verify]'); await page.click('[data-act=verify]'); await page.waitForTimeout(1500);
  const integ = await texts(page, '#integrity .banner');
  ok(integ.length === 3 && integ.every(t => t.startsWith('✅')), 'A : vérification d’intégrité (journal chaîné, sceaux, médias)');
  // Export Excel du registre des écarts
  await go(page, '/ecarts', '[data-act=export]');
  const [xl] = await Promise.all([page.waitForEvent('download'), page.click('[data-act=export]')]);
  ok(fs.readFileSync(await xl.path()).subarray(0, 2).toString() === 'PK', 'A : export Excel du registre des écarts');

  /* ---------------- B. Hors connexion réel (service worker) ---------------- */
  const off = await newDevice('Hors-ligne', { sw: true });
  await setupStandalone(off.page);
  await off.page.evaluate(() => navigator.serviceWorker.ready);
  await off.page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 15000 }).catch(() => {});
  await off.page.waitForTimeout(1500);
  await off.ctx.setOffline(true);
  await off.page.reload();
  await off.page.waitForSelector('form[data-submit=login]', { timeout: 15000 });
  await off.page.fill('input[name=password]', 'motdepasse1'); await off.page.click('#loginBtn');
  await off.page.waitForSelector('#view .page-title', { timeout: 15000 });
  ok((await off.page.textContent('#view')).includes('Planning des prestations'), 'B : application et données disponibles sans réseau (session locale)');
  await go(off.page, '/prestation/pres-DEMO-2', '[data-act=start]');
  await off.page.click('[data-act=start]'); await off.page.waitForSelector('.modal [data-act=pick], .audit-head');
  if (await off.page.$('.modal [data-act=pick]')) await off.page.click('.modal [data-act=pick]');
  await off.page.waitForSelector('.audit-head');
  ok(true, 'B : audit démarré hors connexion');
  await off.page.click('[data-act=shell-lock]'); await off.page.waitForSelector('form[data-submit=login]');
  await off.page.fill('input[name=password]', 'mauvais-mdp'); await off.page.click('#loginBtn'); await off.page.waitForTimeout(800);
  ok((await off.page.textContent('#loginErr')).includes('incorrect'), 'B : mot de passe incorrect refusé hors connexion');
  const raw = await off.page.evaluate(() => new Promise(res => { const r = indexedDB.open('oeg-audit'); r.onsuccess = () => { const tx = r.result.transaction('entities'); const q = tx.objectStore('entities').getAll(); q.onsuccess = () => res(q.result.slice(0, 50).map(v => Object.keys(v).sort().join(',') + '|' + (new TextDecoder().decode(v.ct).includes('Acarouany')))); }; }));
  ok(raw.every(x => x.startsWith('ct,id,iv,type|false')), 'B : données stockées chiffrées sur l’appareil');
  await off.ctx.close();

  /* ---------------- C. Serveur : deux appareils ---------------- */
  const sync = p => p.evaluate(async () => (await import('/audit/js/app/sync.js')).runSync({ reason: 'test' }));
  const serverSetup = async (p, u, pw, n) => {
    await p.click('[data-act=mode][data-value=server]'); await p.waitForSelector('form[data-submit=server]');
    await p.fill('form[data-submit=server] [name=deviceName]', n); await p.fill('form[data-submit=server] [name=username]', u); await p.fill('form[data-submit=server] [name=password]', pw);
    await p.click('#setupBtn'); await p.waitForSelector('#view .page-title', { timeout: 30000 }); await p.waitForTimeout(2500);
  };
  const S1 = await newDevice('Serveur-A'); await serverSetup(S1.page, 'admin', 'admin-pass-123', 'Tablette A');
  ok(await S1.page.evaluate(() => AuditApp.store.count('grid')) === 2, 'C : serveur vierge — référentiel de base initialisé');
  await S1.page.evaluate(async () => { const b = await import('/audit/js/app/bootstrap.js'); await b.seedOEG(); await b.seedDemo(); });
  let r = await sync(S1.page);
  ok(!r.errors.length && r.pushed > 100, `C : envoi initial (${r.pushed} objets)`);
  await S1.page.evaluate(async () => (await import('/audit/js/core/auth.js')).adminApi('/users', { method: 'POST', body: { username: 'jean', name: 'Jean Auditeur', role: 'auditeur', password: 'jean-pass-123' } }));
  const S2 = await newDevice('Serveur-B'); await serverSetup(S2.page, 'jean', 'jean-pass-123', 'Téléphone B');
  ok(await S2.page.evaluate(() => AuditApp.store.count('site')) === 108, 'C : appareil B — référentiel reçu');
  const sid = await S2.page.evaluate(async () => {
    const { createAudit, setResponse } = await import('/audit/js/app/audits.js');
    const a = await createAudit({ prestationId: 'pres-DEMO-1', gridId: 'grid-prel-eau-general-v1' });
    await setResponse(a, 'it-Q01', { status: 'C' });
    const { saveMedia } = await import('/audit/js/core/media.js');
    await saveMedia(new Uint8Array([1, 2, 3, 4, 5]), { mime: 'application/octet-stream', kind: 'document', name: 'preuve.bin', auditId: a.id, link: { type: 'item', id: a.id, itemId: 'it-Q01' } });
    return a.id;
  });
  r = await sync(S2.page);
  ok(!r.errors.length && r.media === 1, 'C : B envoie audit et média');
  await sync(S1.page);
  const got = await S1.page.evaluate(async id => { const { mediaBytes } = await import('/audit/js/core/media.js'); const m = AuditApp.store.filter('media', x => x.auditId === id)[0]; return [...(await mediaBytes(m.id))]; }, sid);
  ok(JSON.stringify(got) === '[1,2,3,4,5]', 'C : A reçoit l’audit et le média intègre');
  await S1.page.evaluate(async id => { const { setResponse } = await import('/audit/js/app/audits.js'); await setResponse(AuditApp.store.get('audit', id), 'it-Q02', { status: 'NC', comment: 'A' }); await setResponse(AuditApp.store.get('audit', id), 'it-Q05', { status: 'C' }); }, sid);
  await S2.page.evaluate(async id => { const { setResponse } = await import('/audit/js/app/audits.js'); await setResponse(AuditApp.store.get('audit', id), 'it-Q02', { status: 'C', comment: 'B' }); await setResponse(AuditApp.store.get('audit', id), 'it-Q08', { status: 'C' }); }, sid);
  await sync(S1.page); r = await sync(S2.page); await sync(S1.page);
  const m1 = await S1.page.evaluate(id => AuditApp.store.get('audit', id).responses, sid);
  ok(m1['it-Q05']?.status === 'C' && m1['it-Q08']?.status === 'C' && m1['it-Q02']?.comment === 'B', 'C : fusion des modifications concurrentes, convergence des deux appareils');
  ok(await S2.page.evaluate(() => AuditApp.store.count('conflict')) === 1, 'C : valeur écartée conservée dans le rapport de conflit');
  await S2.page.evaluate(async () => { const g = AuditApp.store.get('grid', 'grid-controle-rapide-v1'); await AuditApp.store.put('grid', { ...g, name: 'piratée' }); });
  r = await sync(S2.page);
  ok(r.rejected === 1 && app.db.get('grid', 'grid-controle-rapide-v1').data.name !== 'piratée', 'C : écriture non autorisée refusée par le serveur');
  await S2.page.evaluate(() => AuditApp.store.put('alert', { id: 'al-1', level: 'critique', message: 'test', at: new Date().toISOString() }));
  await sync(S2.page);
  ok(!!app.db.get('alert', 'al-1'), 'C : alerte d’urgence transmise au serveur');
  const devB = await S2.page.evaluate(() => AuditApp.session.device.id);
  await S1.page.evaluate(async id => (await import('/audit/js/core/auth.js')).adminApi(`/devices/${id}/revoke`, { method: 'POST', body: { reason: 'perdu' } }), devB);
  await sync(S2.page); await S2.page.waitForTimeout(1200);
  ok(/Appareil désactivé/.test(await S2.page.textContent('body')), 'C : appareil révoqué informé');
  ok(!(await S2.page.evaluate(async () => (await indexedDB.databases()).map(d => d.name))).includes('oeg-audit'), 'C : données de l’appareil révoqué effacées');
  const health = await (await fetch(BASE + '/api/v1/health')).json();
  ok(health.ok === true, 'C : API /health');
  const unauth = await fetch(BASE + '/api/v1/sync/pull');
  ok(unauth.status === 401, 'C : API protégée par authentification');
} catch (e) {
  console.error('FAIL exception', e); process.exitCode = 1; failures++;
} finally {
  ok(errors.length === 0, 'aucune erreur JavaScript ' + JSON.stringify(errors));
  await browser.close(); await app.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(failures ? `❌ ${failures} échec(s)` : '✅ Tous les tests de bout en bout de l’application d’audit sont passés');
}
