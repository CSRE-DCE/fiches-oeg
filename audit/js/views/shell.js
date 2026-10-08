/* Structure de l'application : en-tête (réseau, synchronisation, utilisateur), navigation latérale
 * (tablette paysage / ordinateur), barre de navigation basse (téléphone), boutons Urgence et
 * Observation toujours accessibles. */
import { html, localDate } from '../core/util.js';
import { session } from '../core/session.js';
import { store } from '../core/store.js';
import { ROLES, can } from '../core/auth.js';
import { bindActions } from '../ui/dom.js';
import { navigate } from '../ui/router.js';
import { syncState, onSyncState, runSync } from '../app/sync.js';
import { orgSettings } from '../app/settings.js';
import { OPEN_DEVIATION } from '../domain/model.js';

const NAV = [
  { key: 'planning', href: '#/', ic: '📅', label: 'Planning', bottom: true, group: 'Terrain' },
  { key: 'audits', href: '#/audits', ic: '📋', label: 'Audits', bottom: true, group: 'Terrain' },
  { key: 'ecarts', href: '#/ecarts', ic: '⚠️', label: 'Écarts', bottom: true, group: 'Terrain', badge: 'overdue' },
  { key: 'observations', href: '#/observations', ic: '👁️', label: 'Observations', group: 'Terrain' },
  { key: 'carte', href: '#/carte', ic: '🗺️', label: 'Carte', bottom: true, group: 'Terrain' },
  { key: 'dashboard', href: '#/tableau-de-bord', ic: '📊', label: 'Tableau de bord', group: 'Suivi' },
  { key: 'prestataires', href: '#/prestataires', ic: '🏢', label: 'Prestataires', group: 'Suivi' },
  { key: 'historique', href: '#/audits?vue=historique', ic: '🕘', label: 'Historique et comparaison', group: 'Suivi' },
  { key: 'documents', href: '#/documents', ic: '📚', label: 'Documents', group: 'Gestion' },
  { key: 'grilles', href: '#/grilles', ic: '🧩', label: 'Grilles d’audit', group: 'Gestion' },
  { key: 'referentiels', href: '#/referentiels', ic: '🗂️', label: 'Référentiels', group: 'Gestion' },
  { key: 'import', href: '#/import', ic: '📥', label: 'Import', group: 'Gestion' },
  { key: 'export', href: '#/export', ic: '📤', label: 'Export', group: 'Gestion' },
  { key: 'sync', href: '#/synchronisation', ic: '🔄', label: 'Synchronisation', group: 'Système' },
  { key: 'journal', href: '#/journal', ic: '🧾', label: 'Journal d’audit', group: 'Système', perm: 'trail.view' },
  { key: 'admin', href: '#/administration', ic: '⚙️', label: 'Administration', group: 'Système' },
  { key: 'menu', href: '#/menu', ic: '☰', label: 'Menu', bottom: true, mobileOnly: true }
];
let unbinds = [];

export function navItems() { return NAV.filter(n => !n.mobileOnly && (!n.perm || can(n.perm))); }

export function renderShell(root, { lock }) {
  unbinds.forEach(u => u()); unbinds = [];
  const org = orgSettings();
  const groups = [...new Set(navItems().map(n => n.group))];
  root.innerHTML = String(html`
    <header class="app-top" id="appTop">
      <img class="logo" src="icons/logo-oeg.png" alt="Office de l'Eau de Guyane">
      <div class="titles"><h1>Audit des prestations de prélèvement</h1><small>${org.orgName} · contrôle terrain hors connexion</small></div>
      <button class="top-pill" data-act="shell-sync" id="netPill" title="État de la connexion et de la synchronisation"><span class="dot"></span><span class="lbl" id="netLbl">…</span></button>
      <button class="top-pill" data-act="shell-account" title="Mon compte"><span>👤</span><span class="lbl">${session.user.name.split(' ')[0]}</span></button>
      <button class="top-pill" data-act="shell-lock" title="Verrouiller la session" aria-label="Verrouiller la session">🔒</button>
    </header>
    <div class="app-shell">
      <nav class="rail" id="rail" aria-label="Navigation principale">
        ${groups.map(g => html`<div class="rail-sep">${g}</div>${navItems().filter(n => n.group === g).map(n => html`<a href="${n.href}" data-nav="${n.key}"><span class="ic">${n.ic}</span>${n.label}${n.badge ? html`<span class="badge nc hide" data-badge="${n.badge}" style="margin-left:auto"></span>` : ''}</a>`)}`)}
        <div class="rail-sep">Session</div>
        <a href="#/compte" data-nav="compte"><span class="ic">👤</span>${session.user.name}<span class="tiny muted" style="margin-left:auto">${ROLES[session.user.role]}</span></a>
      </nav>
      <main class="view" id="view" tabindex="-1"></main>
    </div>
    <nav class="bottom-nav" id="bottomNav" aria-label="Navigation">
      ${NAV.filter(n => n.bottom).map(n => html`<a href="${n.href}" data-nav="${n.key}"><span class="ic">${n.ic}</span>${n.label}${n.badge ? html`<span class="nav-badge hide" data-badge="${n.badge}"></span>` : ''}</a>`)}
    </nav>
    <div class="fab-stack" id="fabs">
      ${can('observation.create') ? html`<button class="fab fab-obs" data-act="shell-observation" title="Observation simple"><span class="ic">👁️</span><span>Observation</span></button>` : ''}
      ${can('observation.create') ? html`<button class="fab fab-urgent" data-act="shell-urgent" title="Signaler une situation critique"><span class="ic">⚠</span><span>Urgence</span></button>` : ''}
    </div>`);
  const handlers = {
    'shell-sync'() { navigate('/synchronisation'); },
    'shell-account'() { navigate('/compte'); },
    'shell-lock'() { lock(); },
    async 'shell-urgent'() { (await import('./observations.js')).openEmergency(); },
    async 'shell-observation'() { (await import('./observations.js')).openQuickObservation(); }
  };
  for (const id of ['appTop', 'fabs']) unbinds.push(bindActions(document.getElementById(id), handlers));
  unbinds.push(onSyncState(updateNet));
  unbinds.push(store.subscribe(type => { if (type === 'deviation' || type === '*') updateBadges(); }));
  window.addEventListener('online', updateNet); window.addEventListener('offline', updateNet);
  updateNet(); updateBadges();
}

function updateNet() {
  const pill = document.getElementById('netPill'), lbl = document.getElementById('netLbl');
  if (!pill) return;
  const online = navigator.onLine;
  pill.classList.toggle('offline', !online);
  pill.classList.toggle('pending', online && session.mode === 'server' && syncState.pending > 0);
  let text = online ? 'En ligne' : 'Hors connexion';
  if (session.mode !== 'server') text = online ? 'Mode autonome' : 'Hors connexion';
  if (syncState.running) text = 'Synchronisation…';
  else if (syncState.pending && session.mode === 'server') text += ` · ${syncState.pending} en attente`;
  if (syncState.needsLogin) text = 'Reconnexion requise';
  lbl.textContent = text;
  pill.title = `${text}${syncState.lastSyncAt ? ' — dernière synchronisation : ' + new Date(syncState.lastSyncAt).toLocaleString('fr-FR') : ''}`;
}

function updateBadges() {
  const today = localDate();
  const overdue = store.filter('deviation', d => OPEN_DEVIATION.includes(d.status) && d.dueDate && d.dueDate < today).length;
  for (const el of document.querySelectorAll('[data-badge=overdue]')) { el.textContent = overdue; el.classList.toggle('hide', !overdue); el.title = `${overdue} écart(s) en retard`; }
}

export function updateShell({ nav, path }) {
  for (const a of document.querySelectorAll('[data-nav]')) a.classList.toggle('active', a.dataset.nav === nav);
  document.body.classList.toggle('in-audit', path.startsWith('/audit/'));
  const v = document.getElementById('view'); v?.focus?.({ preventScroll: true });
  updateBadges();
}
export { runSync };
