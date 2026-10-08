/* Point d'entrée de la PWA d'audit des prestations de prélèvement. */
import { openDB, destroyDB } from './core/db.js';
import { session } from './core/session.js';
import { store } from './core/store.js';
import * as auth from './core/auth.js';
import { revokeAllURLs } from './core/media.js';
import { route, startRouter, stopRouter } from './ui/router.js';
import { toast } from './ui/dom.js';
import { initSync, stopSync, runSync } from './app/sync.js';
import { applyDisplayPrefs, orgSettings } from './app/settings.js';
import { renderSetup, renderLogin, renderMessage, teardownAuth } from './views/auth.js';
import { renderShell, updateShell } from './views/shell.js';

const app = document.getElementById('app');

route('/', () => import('./views/planning.js'));
route('prestation/:id', () => import('./views/prestation.js'));
route('nouvel-audit', () => import('./views/audit-new.js'));
route('audit/:id/:step?', () => import('./views/audit.js'));
route('audits', () => import('./views/audits.js'));
route('comparer', () => import('./views/compare.js'));
route('ecarts', () => import('./views/deviations.js'));
route('ecart/:id', () => import('./views/deviations.js').then(m => ({ default: m.detailView })));
route('observations', () => import('./views/observations.js'));
route('prestataires', () => import('./views/providers.js'));
route('prestataire/:id', () => import('./views/providers.js').then(m => ({ default: m.detailView })));
route('carte', () => import('./views/map.js'));
route('tableau-de-bord', () => import('./views/dashboard.js'));
route('documents', () => import('./views/documents.js'));
route('document/:id', () => import('./views/documents.js').then(m => ({ default: m.detailView })));
route('grilles', () => import('./views/grids.js'));
route('grille/:id', () => import('./views/grids.js').then(m => ({ default: m.detailView })));
route('referentiels', () => import('./views/referentials.js'));
route('referentiel/:type', () => import('./views/referentials.js').then(m => ({ default: m.listView })));
route('import', () => import('./views/imports.js'));
route('export', () => import('./views/exports.js'));
route('synchronisation', () => import('./views/sync.js'));
route('journal', () => import('./views/trail.js'));
route('administration', () => import('./views/admin.js'));
route('compte', () => import('./views/admin.js').then(m => ({ default: m.accountView })));
route('menu', () => import('./views/menu.js'));

/* ---------- Verrouillage automatique par inactivité ---------- */
let idleTimer = null;
function watchActivity() {
  const touch = () => { session.lastActivity = Date.now(); };
  ['pointerdown', 'keydown', 'touchstart'].forEach(e => window.addEventListener(e, touch, { passive: true }));
  clearInterval(idleTimer);
  idleTimer = setInterval(() => {
    if (!session.unlocked) return;
    const minutes = Number(orgSettings().autoLockMinutes) || 30;
    if (Date.now() - session.lastActivity > minutes * 60000) lockApp('inactivité');
  }, 20000);
}

export async function lockApp(reason = 'manuel') {
  stopSync(); stopRouter(); revokeAllURLs();
  await auth.lock(reason);
  document.body.classList.remove('in-audit');
  showLogin(reason === 'inactivité' ? 'Session verrouillée après inactivité. Vos saisies sont enregistrées sur l’appareil.' : '');
}

/** Appareil révoqué par l'administrateur : effacement complet des données locales. */
async function onRevoked() {
  stopSync(); stopRouter(); revokeAllURLs();
  store.unload();
  try { await destroyDB(); } catch (e) { /* déjà supprimée */ }
  try { Object.keys(localStorage).filter(k => k.startsWith('oeg-audit:')).forEach(k => localStorage.removeItem(k)); } catch (e) { /* ignore */ }
  try { const keys = await caches.keys(); await Promise.all(keys.filter(k => k.startsWith('oeg-audit-tiles')).map(k => caches.delete(k))); } catch (e) { /* ignore */ }
  renderMessage(app, { title: 'Appareil désactivé', message: 'Cet appareil a été désactivé par l’administrateur (appareil perdu ou retiré). Toutes les données locales ont été effacées. Contactez votre administrateur pour réactiver un appareil.' });
}

async function enterApp({ password = null } = {}) {
  document.body.classList.remove('auth-mode');
  teardownAuth();
  auth.restoreToken();
  renderShell(app, { lock: () => lockApp('manuel') });
  watchActivity();
  initSync({ revoked: onRevoked });
  await startRouter(document.getElementById('view'), { onRoute: updateShell });
  if (session.mode === 'server' && password) {
    const r = await auth.refreshServerToken(password);
    if (r?.revoked) return onRevoked();
    runSync({ reason: 'ouverture de session' }).then(async res => {
      if (res?.pulled || res?.pushed) toast(`Synchronisation : ${res.pushed} envoi(s), ${res.pulled} réception(s)`, 'ok');
      // Serveur vierge : le premier administrateur / responsable qualité initialise le référentiel de base.
      if (!res?.errors?.length && !res?.skipped && !store.count('grid') && auth.can('ref.manage')) {
        const { seedBase } = await import('./app/bootstrap.js');
        await seedBase();
        toast('Serveur vierge : référentiel de base et grilles initialisés. Reprenez les stations depuis Administration › Données.', 'ok', 7000);
        runSync({ reason: 'initialisation du référentiel' });
      }
    }).catch(() => {});
  }
}

function showLogin(message = '') {
  document.body.classList.add('auth-mode');
  renderLogin(app, { message, onUnlocked: ({ password }) => enterApp({ password }) });
}

async function boot() {
  applyDisplayPrefs();
  try { await openDB(); }
  catch (e) { renderMessage(app, { title: 'Stockage indisponible', message: e.message + ' — l’application a besoin du stockage du navigateur (IndexedDB). Évitez la navigation privée.' }); return; }
  await auth.loadDevice();
  if (!(await auth.isSetUp())) {
    document.body.classList.add('auth-mode');
    renderSetup(app, { onDone: ({ password }) => enterApp({ password }) });
  } else showLogin();
}

window.AuditApp = { store, session, lockApp };   // diagnostic et tests automatisés
boot();
