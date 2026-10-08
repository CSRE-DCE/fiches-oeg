/* Administration : utilisateurs et rôles, appareils (désactivation d'un appareil perdu), paramètres de
 * l'organisation, données ; écran « Mon compte ». */
import { html, raw, fmtDateTime, fmtBytes, sortBy, uuid } from '../core/util.js';
import { store } from '../core/store.js';
import { session } from '../core/session.js';
import { meta, destroyDB, storageEstimate } from '../core/db.js';
import { ROLES, PERMISSIONS, can, addLocalAccount, setLocalAccountDisabled, syncKeyringProfile, changePassword, adminApi, knownUsers, normUsername, updateDevice } from '../core/auth.js';
import { toast, openModal, formValues, promptDialog, confirmDialog } from '../ui/dom.js';
import { pageTitle, kv, badge, empty, options, field } from '../ui/components.js';
import { orgSettings, saveOrgSettings, pref, setPref, applyDisplayPrefs } from '../app/settings.js';

const PERM_LABELS = { 'audit.create': 'Créer un audit', 'audit.edit': 'Réaliser ses audits', 'audit.editOthers': 'Modifier les audits des autres', 'audit.amend': 'Modifier un audit signé (motif)', 'audit.delete': 'Abandonner un audit', 'deviation.manage': 'Enregistrer / suivre les écarts', 'deviation.close': 'Clôturer les écarts', 'observation.create': 'Observations et urgences', 'planning.manage': 'Gérer le planning et les imports', 'ref.manage': 'Gérer référentiels, documents, grilles', 'trail.view': 'Consulter le journal', 'users.manage': 'Gérer les utilisateurs', 'devices.manage': 'Gérer les appareils', 'settings.manage': 'Paramétrer l’application', export: 'Exporter' };
const SETTINGS = [
  ['orgName', 'Nom de l’organisme', 'text'], ['gpsThresholdM', 'Seuil d’alerte d’écart GPS (m)', 'number'], ['autoLockMinutes', 'Verrouillage automatique après inactivité (min)', 'number'],
  ['transportMaxHours', 'Délai maximal prélèvement → remise (h, par défaut)', 'number'], ['dateToleranceDays', 'Tolérance de date avant alerte « prestation différente » (jours)', 'number'],
  ['sampleIdPattern', 'Modèle d’identifiant d’échantillon ({AUDIT}, {SITE}, {YYYYMMDD}, {NN}, {NNN})', 'text'], ['tileUrl', 'Serveur de tuiles de carte ({z}/{x}/{y})', 'text'],
  ['tileAttribution', 'Attribution de la carte', 'text'], ['maxPreloadZoom', 'Zoom maximal de préchargement de la carte', 'number'], ['reportFooter', 'Mention de pied de page des rapports', 'text']
];

async function serverUsers() { try { return (await adminApi('/users')).users; } catch (e) { return { error: e.message }; } }
async function serverDevices() { try { return (await adminApi('/devices')).devices; } catch (e) { return { error: e.message }; } }

function userForm(u = null, { server = false } = {}) {
  const isNew = !u;
  u = u || { username: '', name: '', role: 'auditeur', active: true };
  const m = openModal({
    title: isNew ? 'Nouvel utilisateur' : 'Utilisateur ' + u.name,
    body: html`<form id="uf">${field('Nom et prénom', html`<input name="name" value="${u.name}" required>`, { required: true })}
      ${field('Identifiant', html`<input name="username" value="${u.username}" required autocapitalize="none" ${isNew ? '' : raw('readonly')}>`, { required: true })}
      ${field('Profil', html`<select name="role">${options(Object.entries(ROLES).map(([id, label]) => ({ id, label })), u.role, { placeholder: null })}</select>`)}
      ${field(isNew ? 'Mot de passe initial' : 'Nouveau mot de passe (laisser vide pour ne pas changer)', html`<input name="password" type="password" ${isNew ? raw('required minlength="8"') : ''} autocomplete="new-password">`)}
      <label class="check"><input type="checkbox" name="active" ${u.active !== false ? 'checked' : ''}> Compte actif</label>
      ${!server ? html`<p class="note">Mode autonome : le compte est créé sur cet appareil uniquement ; ses données sont chiffrées avec la clé de l’appareil.</p>` : ''}</form>`,
    actions: [{ label: 'Annuler' }, { label: 'Enregistrer', act: 'ok', cls: 'primary' }],
    handlers: { ok() { const f = this.root.querySelector('#uf'); if (!f.reportValidity()) return; this.close(formValues(f)); } }
  });
  return m.result;
}

export default {
  nav: 'admin', title: 'Administration',
  async render() {
    const server = session.mode === 'server';
    const org = orgSettings();
    const est = await storageEstimate();
    const persisted = await navigator.storage?.persisted?.().catch(() => null);
    let users, devices = null;
    if (can('users.manage')) users = server ? await serverUsers() : sortBy(store.all('user'), 'name');
    if (can('devices.manage') && server) devices = await serverDevices();
    const local = await knownUsers();
    return html`${pageTitle('Administration', server ? `Mode serveur — ${session.serverUrl}` : 'Mode autonome')}
      ${can('users.manage') ? html`<div class="card"><h2>Utilisateurs et profils ${html`<button class="btn primary sm" data-act="user-new">＋ Utilisateur</button>`}</h2>
        ${users?.error ? html`<div class="banner warn">${users.error}</div>` : html`<div class="list">${(users || []).map(u => html`<button class="li ${u.active === false ? '' : 'stripe-info'}" data-act="user-edit" data-u="${u.username}"><span class="avatar">${(u.name || '?').split(/\s+/).map(x => x[0]).slice(0, 2).join('').toUpperCase()}</span><div class="li-main"><div class="li-title">${u.name}</div><div class="li-sub">${u.username} · ${ROLES[u.role] || u.role}${u.lastLoginAt ? ' · dernière connexion ' + fmtDateTime(u.lastLoginAt) : ''}</div></div>${u.active === false ? badge('Désactivé', 'na') : badge('Actif', 'ok')}</button>`)}</div>`}
        <details style="margin-top:10px"><summary>Droits par profil</summary><div class="table-wrap"><table class="tbl"><thead><tr><th>Droit</th>${Object.values(ROLES).map(r => html`<th>${r}</th>`)}</tr></thead><tbody>${Object.entries(PERMISSIONS).map(([p, roles]) => html`<tr><td>${PERM_LABELS[p] || p}</td>${Object.keys(ROLES).map(r => html`<td>${roles.includes(r) ? '✓' : ''}</td>`)}</tr>`)}</tbody></table></div></details></div>` : ''}
      ${can('devices.manage') ? html`<div class="card"><h2>Appareils</h2>
        ${server ? (devices?.error ? html`<div class="banner warn">${devices.error}</div>` : html`<div class="list">${(devices || []).map(d => html`<div class="li ${d.revoked ? 'stripe-nc' : ''}"><div class="li-main"><div class="li-title">${d.name} ${d.id === session.device.id ? badge('cet appareil', 'info') : ''}</div><div class="li-sub">n° ${d.number} · ${d.lastUser || ''} · vu le ${fmtDateTime(d.lastSeenAt)}</div>${d.revoked ? badge('Désactivé le ' + fmtDateTime(d.revokedAt), 'nc') : ''}</div>${d.revoked ? html`<button class="btn ghost sm" data-act="dev-restore" data-id="${d.id}">Réactiver</button>` : html`<button class="btn danger-ghost sm" data-act="dev-revoke" data-id="${d.id}">Désactiver (perdu)</button>`}</div>`)}</div>
          <p class="note">Un appareil désactivé ne peut plus se synchroniser ; à sa prochaine connexion, ses données locales sont effacées.</p>`)
          : html`${kv([['Cet appareil', `${session.device.name} — n° ${session.device.number}`], ['Identifiant', session.device.id]])}<p class="note">En mode autonome, la désactivation à distance d’un appareil perdu nécessite un serveur. Les données restent protégées par le chiffrement et les mots de passe.</p>`}</div>` : ''}
      ${can('settings.manage') ? html`<div class="card"><h2>Paramètres de l’organisation</h2><form id="setf"><div class="grid2">${SETTINGS.map(([k, l, t]) => field(l, html`<input name="${k}" type="${t === 'number' ? 'number' : 'text'}" value="${org[k] ?? ''}">`))}</div>
        <button class="btn primary" type="button" data-act="save-settings">Enregistrer les paramètres</button></form></div>` : ''}
      <div class="card"><h2>Données et stockage</h2>${kv([['Stockage utilisé', est ? `${fmtBytes(est.usage)} sur ${fmtBytes(est.quota)}` : 'inconnu'], ['Stockage persistant', persisted === true ? 'oui (protégé contre l’effacement automatique)' : persisted === false ? 'non garanti' : 'inconnu'], ['Audits', String(store.count('audit'))], ['Médias', String(store.count('media'))], ['Entrées de journal', String(store.count('trail'))], ['Comptes sur l’appareil', local.map(u => u.name).join(', ')]])}
        ${can('ref.manage') ? html`<div class="btn-row" style="margin-top:10px"><button class="btn ghost" data-act="seed">Compléter le référentiel de base</button><button class="btn ghost" data-act="seed-oeg">Reprendre le référentiel des fiches terrain</button><button class="btn ghost" data-act="seed-demo">Ajouter les données de démonstration</button><button class="btn ghost" data-act="purge-demo">Retirer les données de démonstration</button></div>` : ''}</div>
      ${can('settings.manage') ? html`<div class="card" style="border-color:var(--nc)"><h2>Zone sensible</h2><p class="note">Efface toutes les données de cet appareil (base chiffrée, comptes locaux, cartes). Les données non synchronisées ou non exportées seront perdues.</p><button class="btn danger" data-act="wipe">Effacer les données de cet appareil</button></div>` : ''}`;
  },
  handlers: {
    async 'user-new'() {
      const v = await userForm(null, { server: session.mode === 'server' }); if (!v) return;
      try {
        if (session.mode === 'server') await adminApi('/users', { method: 'POST', body: { username: v.username, name: v.name, role: v.role, password: v.password, active: v.active } });
        else await addLocalAccount({ username: v.username, name: v.name, role: v.role, password: v.password });
        toast('Utilisateur créé', 'ok'); this.refresh();
      } catch (e) { toast(e.message, 'err'); }
    },
    async 'user-edit'(el) {
      const server = session.mode === 'server';
      const list = server ? await serverUsers() : store.all('user');
      const u = list.find(x => x.username === el.dataset.u);
      const v = await userForm(u, { server }); if (!v) return;
      try {
        if (server) await adminApi('/users/' + encodeURIComponent(u.id), { method: 'PATCH', body: { name: v.name, role: v.role, active: v.active, ...(v.password ? { password: v.password } : {}) } });
        else {
          if (u.id === session.user.id && v.role !== 'admin' && !store.filter('user', x => x.role === 'admin' && x.active !== false && x.id !== u.id).length) { toast('Il doit rester au moins un administrateur actif.', 'err'); return; }
          await store.put('user', { ...u, name: v.name, role: v.role, active: v.active }, { reason: 'Modification du compte' });
          if (v.password) await addLocalAccount({ id: u.id, username: u.username, name: v.name, role: v.role, password: v.password });
          await syncKeyringProfile({ username: u.username, name: v.name, role: v.role, active: v.active });
          await setLocalAccountDisabled(u.username, v.active === false);
        }
        toast('Compte mis à jour', 'ok'); this.refresh();
      } catch (e) { toast(e.message, 'err'); }
    },
    async 'dev-revoke'(el) {
      const reason = await promptDialog({ title: 'Désactiver l’appareil', label: 'Motif (appareil perdu, volé, réaffecté…)' }); if (!reason) return;
      try { await adminApi(`/devices/${encodeURIComponent(el.dataset.id)}/revoke`, { method: 'POST', body: { reason } }); toast('Appareil désactivé', 'ok'); this.refresh(); } catch (e) { toast(e.message, 'err'); }
    },
    async 'dev-restore'(el) { try { await adminApi(`/devices/${encodeURIComponent(el.dataset.id)}/restore`, { method: 'POST', body: {} }); this.refresh(); } catch (e) { toast(e.message, 'err'); } },
    async 'save-settings'() {
      const v = formValues(document.getElementById('setf'));
      for (const [k, , t] of SETTINGS) if (t === 'number') v[k] = Number(v[k]);
      await saveOrgSettings(v, 'Modification des paramètres');
      toast('Paramètres enregistrés', 'ok');
    },
    async seed() { const { seedBase } = await import('../app/bootstrap.js'); await seedBase(); toast('Référentiel de base complété', 'ok'); this.refresh(); },
    async 'seed-oeg'() { const { seedOEG } = await import('../app/bootstrap.js'); const c = await seedOEG(); toast(`Référentiel repris : ${Object.entries(c).map(([k, n]) => `${n} ${k}`).join(', ')}`, 'ok', 5000); this.refresh(); },
    async 'seed-demo'() { const { seedDemo } = await import('../app/bootstrap.js'); await seedDemo(); toast('Données de démonstration ajoutées', 'ok'); this.refresh(); },
    async 'purge-demo'() {
      if (!(await confirmDialog({ title: 'Retirer la démonstration', message: 'Supprimer le prestataire, les opérateurs, équipements, prestations et documents fictifs de démonstration ? Les audits déjà réalisés sont conservés.', danger: true }))) return;
      const ids = { provider: ['prov-DEMO'], operator: ['op-DEMO-1', 'op-DEMO-2'], equipment: ['eq-DEMO-1', 'eq-DEMO-2', 'eq-DEMO-3'], prestation: ['pres-DEMO-1', 'pres-DEMO-2', 'pres-DEMO-3'], document: ['doc-CCTP-EX-v1', 'doc-PROTO-EX-v1', 'doc-PROTO-EX-v2', 'doc-CONSIGNES-EX-v1'] };
      for (const [t, list] of Object.entries(ids)) for (const id of list) await store.remove(t, id, 'Retrait des données de démonstration');
      toast('Données de démonstration retirées', 'ok'); this.refresh();
    },
    async wipe() {
      const v = await promptDialog({ title: 'Effacer cet appareil', label: 'Tapez EFFACER pour confirmer', multiline: false, voice: false });
      if (v !== 'EFFACER') return;
      await destroyDB();
      try { const keys = await caches.keys(); await Promise.all(keys.filter(k => k.startsWith('oeg-audit-tiles')).map(k => caches.delete(k))); } catch (e) { /* ignore */ }
      location.reload();
    }
  }
};

export const accountView = {
  nav: 'compte', title: 'Mon compte',
  async render() {
    return html`${pageTitle('Mon compte', `${session.user.name} — ${ROLES[session.user.role]}`)}
      <div class="card"><h2>Session</h2>${kv([['Nom', session.user.name], ['Identifiant', session.user.username], ['Profil', ROLES[session.user.role]], ['Session ouverte le', fmtDateTime(session.unlockedAt)], ['Appareil', `${session.device.name} (n° ${session.device.number})`], ['Mode', session.mode === 'server' ? 'Serveur — ' + session.serverUrl : 'Autonome'], ['Version de l’application', `${self.AUDIT_VERSION} (${self.AUDIT_BUILD_DATE})`]])}
        <div class="btn-row" style="margin-top:10px"><button class="btn ghost" data-act="password">Changer mon mot de passe</button><button class="btn ghost" data-act="rename">Renommer l’appareil</button><button class="btn ghost" data-act="update">Rechercher une mise à jour</button></div></div>
      <div class="card"><h2>Affichage terrain</h2>
        <label class="check ${pref('sun') ? 'sel' : ''}"><input type="checkbox" data-change="sun" ${pref('sun') ? 'checked' : ''}> Mode « plein soleil » (contraste renforcé, texte agrandi)</label>
        <p class="note">Boutons larges utilisables avec des gants, navigation principale en bas d’écran, saisie vocale et lecture de QR codes lorsque l’appareil les propose.</p></div>`;
  },
  handlers: {
    sun(el) { setPref('sun', el.checked); applyDisplayPrefs(); },
    async password() {
      const m = openModal({ title: 'Changer mon mot de passe', body: html`<form id="pw">${field('Mot de passe actuel', html`<input type="password" name="old" required>`)}${field('Nouveau mot de passe (8 caractères min.)', html`<input type="password" name="n1" required minlength="8">`)}${field('Confirmation', html`<input type="password" name="n2" required>`)}</form>`, actions: [{ label: 'Annuler' }, { label: 'Changer', act: 'ok', cls: 'primary' }], handlers: { ok() { const f = this.root.querySelector('#pw'); if (!f.reportValidity()) return; this.close(formValues(f)); } } });
      const v = await m.result; if (!v) return;
      if (v.n1 !== v.n2) { toast('Les mots de passe ne correspondent pas.', 'err'); return; }
      try {
        if (session.mode === 'server') await adminApi('/me/password', { method: 'POST', body: { oldPassword: v.old, newPassword: v.n1 } });
        await changePassword(v.old, v.n1); toast('Mot de passe changé', 'ok');
      } catch (e) { toast(e.message, 'err'); }
    },
    async rename() { const n = await promptDialog({ title: 'Nom de l’appareil', label: 'Nom', value: session.device.name, multiline: false, voice: false }); if (n) { await updateDevice({ name: n }); toast('Appareil renommé', 'ok'); this.refresh(); } },
    async update() {
      const reg = await navigator.serviceWorker?.getRegistration();
      if (!reg) { toast('Mise à jour automatique indisponible sur ce navigateur.', 'warn'); return; }
      await reg.update().catch(() => {});
      toast(reg.installing || reg.waiting ? 'Nouvelle version en cours d’installation : rechargement…' : 'Application à jour.', 'ok');
      if (reg.waiting) { reg.waiting.postMessage('skipWaiting'); setTimeout(() => location.reload(), 800); }
    }
  }
};
