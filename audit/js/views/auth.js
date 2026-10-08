/* Écrans hors session : première configuration de l'appareil, ouverture de session, messages. */
import { html } from '../core/util.js';
import { session } from '../core/session.js';
import * as auth from '../core/auth.js';
import { bindActions, toast, formValues } from '../ui/dom.js';
import { seedAll } from '../app/bootstrap.js';
import { saveOrgSettings } from '../app/settings.js';

const LOGO = 'icons/logo-oeg.png';
let unbind = null;
function bind(root, handlers) { unbind?.(); unbind = bindActions(root, handlers); }
/** Retire les gestionnaires des écrans de connexion (appelé à l'entrée dans l'application). */
export function teardownAuth() { unbind?.(); unbind = null; }
const footer = () => html`<p class="tiny muted" style="text-align:center;margin-top:16px">Version ${self.AUDIT_VERSION || ''} · ${session.device?.name || ''}${session.mode ? ' · mode ' + (session.mode === 'server' ? 'serveur' : 'autonome') : ''}</p>`;

export function renderMessage(root, { title, message }) {
  teardownAuth();
  root.innerHTML = String(html`<div class="auth"><div class="auth-card"><img class="logo" src="${LOGO}" alt=""><h1>${title}</h1><p class="sub">${message}</p></div></div>`);
}

export function renderSetup(root, { onDone }) {
  let mode = 'standalone';
  const draw = () => {
    root.innerHTML = String(html`<div class="auth"><div class="auth-card">
      <img class="logo" src="${LOGO}" alt="Office de l'Eau de Guyane">
      <h1>Configuration de l’appareil</h1>
      <p class="sub">Audit terrain des prestations de prélèvement — première utilisation sur cet appareil.</p>
      <div class="seg" style="margin-bottom:14px">
        <button type="button" data-act="mode" data-value="standalone" class="${mode === 'standalone' ? 'sel brand' : ''}">Mode autonome<small>sans serveur</small></button>
        <button type="button" data-act="mode" data-value="server" class="${mode === 'server' ? 'sel brand' : ''}">Serveur<small>synchronisation</small></button>
      </div>
      ${mode === 'standalone' ? html`<form data-submit="standalone" autocomplete="off">
        <div class="banner info">Les données restent chiffrées sur cet appareil. Un serveur de synchronisation pourra être configuré plus tard ; en attendant, les échanges entre appareils se font par export/import de paquets de données.</div>
        <div class="field"><label>Organisme</label><input name="orgName" value="Office de l’Eau de Guyane" required></div>
        <div class="grid2">
          <div class="field"><label>Nom de l’appareil</label><input name="deviceName" value="${auth.defaultDeviceName()}" required></div>
          <div class="field"><label>N° de l’appareil (1 à 99)</label><input name="deviceNumber" type="number" min="1" max="99" value="1" required><div class="hint">Unique par appareil : garantit des numéros d’audit uniques.</div></div>
        </div>
        <h3>Compte administrateur</h3>
        <div class="field"><label>Nom et prénom</label><input name="name" required autocomplete="name"></div>
        <div class="grid2">
          <div class="field"><label>Identifiant</label><input name="username" required autocapitalize="none" autocomplete="username"></div>
          <div class="field"><label>Mot de passe (8 caractères min.)</label><input name="password" type="password" required minlength="8" autocomplete="new-password"></div>
        </div>
        <div class="field"><label>Confirmer le mot de passe</label><input name="password2" type="password" required autocomplete="new-password"></div>
        <label class="check sel"><input type="checkbox" name="oeg" checked> Reprendre le référentiel des fiches terrain OEG (stations, organismes, préleveurs, campagnes)</label>
        <label class="check" style="margin-top:8px"><input type="checkbox" name="demo" checked> Ajouter des données de démonstration fictives (prestataire « DÉMO », 3 prestations, documents « EXEMPLE »)</label>
        <p class="hint" id="setupErr" style="color:var(--nc)"></p>
        <button class="btn primary lg block" type="submit" id="setupBtn">Créer et ouvrir la session</button>
      </form>` : html`<form data-submit="server" autocomplete="off">
        <div class="banner info">Connexion requise pour la première ouverture. Ensuite, la session pourra être ouverte hors connexion sur cet appareil.</div>
        <div class="field"><label>Adresse du serveur</label><input name="url" placeholder="https://audit.exemple.fr" value="${location.origin}" required inputmode="url" autocapitalize="none"></div>
        <div class="field"><label>Nom de l’appareil</label><input name="deviceName" value="${auth.defaultDeviceName()}" required></div>
        <div class="grid2">
          <div class="field"><label>Identifiant</label><input name="username" required autocapitalize="none" autocomplete="username"></div>
          <div class="field"><label>Mot de passe</label><input name="password" type="password" required autocomplete="current-password"></div>
        </div>
        <p class="hint" id="setupErr" style="color:var(--nc)"></p>
        <button class="btn primary lg block" type="submit" id="setupBtn">Se connecter</button>
      </form>`}
      ${footer()}
    </div></div>`);
  };
  draw();
  bind(root, {
    mode(el) { mode = el.dataset.value; draw(); },
    async standalone(form) {
      const v = formValues(form), err = form.querySelector('#setupErr'), btn = form.querySelector('#setupBtn');
      err.textContent = '';
      if (v.password !== v.password2) { err.textContent = 'Les deux mots de passe ne correspondent pas.'; return; }
      btn.disabled = true; btn.textContent = 'Préparation de l’appareil…';
      try {
        await auth.setupStandalone({ deviceName: v.deviceName, deviceNumber: v.deviceNumber, admin: { name: v.name, username: v.username, password: v.password } });
        await seedAll({ oeg: !!v.oeg, demo: !!v.demo });
        await saveOrgSettings({ orgName: v.orgName }, 'Configuration initiale');
        toast('Appareil configuré ✓', 'ok');
        onDone({ password: v.password });
      } catch (e) { err.textContent = e.message; btn.disabled = false; btn.textContent = 'Créer et ouvrir la session'; }
    },
    async server(form) {
      const v = formValues(form), err = form.querySelector('#setupErr'), btn = form.querySelector('#setupBtn');
      err.textContent = ''; btn.disabled = true; btn.textContent = 'Connexion…';
      try {
        await auth.loadDevice();
        await auth.updateDevice({ name: v.deviceName });
        await auth.serverLogin(v.url, v.username, v.password, { firstSetup: true });
        onDone({ password: v.password });
      } catch (e) { err.textContent = e.message === 'Failed to fetch' ? 'Serveur injoignable : vérifiez l’adresse et la connexion.' : e.message; btn.disabled = false; btn.textContent = 'Se connecter'; }
    }
  });
}

export async function renderLogin(root, { message = '', onUnlocked }) {
  const users = await auth.knownUsers();
  let selected = users[0]?.username || '';
  let other = false;
  const draw = () => {
    root.innerHTML = String(html`<div class="auth"><div class="auth-card">
      <img class="logo" src="${LOGO}" alt="Office de l'Eau de Guyane">
      <h1>Audit des prestations de prélèvement</h1>
      <p class="sub">${navigator.onLine ? 'Ouverture de session' : 'Hors connexion — ouverture de session locale'}</p>
      ${message ? html`<div class="banner info">${message}</div>` : ''}
      <form data-submit="login" autocomplete="off">
        ${!other ? html`<div class="user-tiles">${users.map(u => html`<button type="button" class="user-tile ${u.username === selected ? 'sel' : ''}" data-act="pick" data-u="${u.username}">
          <span class="avatar">${(u.name || u.username).split(/\s+/).map(x => x[0]).slice(0, 2).join('').toUpperCase()}</span>
          <span><b>${u.name}</b><br><span class="tiny muted">${auth.ROLES[u.role] || u.role} · ${u.username}</span></span></button>`)}</div>`
        : html`<div class="field"><label>Identifiant</label><input name="username" required autocapitalize="none" autocomplete="username"></div>`}
        <div class="field"><label>Mot de passe</label><input name="password" type="password" required autocomplete="current-password" autofocus></div>
        <p class="hint" id="loginErr" style="color:var(--nc)"></p>
        <button class="btn primary lg block" type="submit" id="loginBtn">Ouvrir la session</button>
      </form>
      ${session.mode === 'server' ? html`<button class="btn ghost block" style="margin-top:10px" data-act="other">${other ? 'Comptes déjà utilisés sur cet appareil' : 'Autre compte (connexion au serveur)'}</button>` : ''}
      ${footer()}
    </div></div>`);
    root.querySelector('input[name=password]')?.focus();
  };
  draw();
  bind(root, {
    pick(el) { selected = el.dataset.u; root.querySelectorAll('.user-tile').forEach(t => t.classList.toggle('sel', t === el)); root.querySelector('input[name=password]').focus(); },
    other() { other = !other; draw(); },
    async login(form) {
      const v = formValues(form), err = form.querySelector('#loginErr'), btn = form.querySelector('#loginBtn');
      err.textContent = ''; btn.disabled = true; btn.textContent = 'Vérification…';
      try {
        if (other) {
          await auth.serverLogin(session.serverUrl, v.username, v.password);
          onUnlocked({ password: v.password });
          return;
        }
        const r = await auth.unlock(selected, v.password);
        if (!r.ok) { err.textContent = r.error; btn.disabled = false; btn.textContent = 'Ouvrir la session'; return; }
        onUnlocked({ password: v.password });
      } catch (e) { err.textContent = e.message === 'Failed to fetch' ? 'Serveur injoignable.' : e.message; btn.disabled = false; btn.textContent = 'Ouvrir la session'; }
    }
  });
}
