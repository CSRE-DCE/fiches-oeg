/* Synchronisation : état, file d'envoi, journal de synchronisation, conflits et résolution. */
import { html, raw, fmtDateTime, sortBy, compactValue, clone } from '../core/util.js';
import { store } from '../core/store.js';
import { session } from '../core/session.js';
import { can, refreshServerToken, attachToServer } from '../core/auth.js';
import { toast, promptDialog, confirmDialog, openModal, formValues } from '../ui/dom.js';
import { pageTitle, kv, badge, empty, field } from '../ui/components.js';
import { runSync, syncState, outboxEntries, retryRejected, dropOutboxEntry, serverHealth, prefetchMedia } from '../app/sync.js';
import { meta } from '../core/db.js';

const TYPE_LABELS = { audit: 'Audits', deviation: 'Écarts', media: 'Médias (métadonnées)', __bin: 'Fichiers (photos, documents)', trail: 'Journal d’audit', prestation: 'Prestations', observation: 'Observations', alert: 'Alertes d’urgence', document: 'Documents', grid: 'Grilles' };
const show = v => { const c = compactValue(v, 160); return c === undefined || c === null ? '—' : typeof c === 'string' ? c : JSON.stringify(c); };

/** Applique une valeur à un chemin « a.b[id].c » (identifiants d'éléments de liste entre crochets). */
export function setPath(obj, path, value) {
  const segs = [];
  for (const part of path.split('.')) { const m = part.match(/^([^[]*)((?:\[[^\]]+\])*)$/); if (m[1]) segs.push(m[1]); for (const b of m[2].matchAll(/\[([^\]]+)\]/g)) segs.push({ id: b[1] }); }
  let cur = obj;
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i], last = i === segs.length - 1;
    if (typeof s === 'object') {
      const idx = cur.findIndex(x => x.id === s.id);
      if (last) { if (value === null || value === undefined) { if (idx >= 0) cur.splice(idx, 1); } else if (idx >= 0) cur[idx] = value; else cur.push(value); return obj; }
      cur = cur[idx];
    } else {
      if (last) { if (value === undefined) delete cur[s]; else cur[s] = value; return obj; }
      if (cur[s] === undefined) cur[s] = typeof segs[i + 1] === 'object' ? [] : {};
      cur = cur[s];
    }
    if (cur === undefined) throw new Error('Chemin introuvable : ' + path);
  }
  return obj;
}

export default {
  nav: 'sync', title: 'Synchronisation',
  async render() {
    const out = await outboxEntries();
    const byType = {};
    for (const e of out) byType[e.type] = (byType[e.type] || 0) + 1;
    const rejected = out.filter(e => e.rejected);
    const logs = sortBy(store.all('syncLog'), '-at').slice(0, 30);
    const conflicts = sortBy(store.all('conflict'), x => x.resolved ? 1 : 0, '-at');
    const cursor = await meta.get('syncCursor', 0);
    const server = session.mode === 'server';
    return html`${pageTitle('Synchronisation', server ? `Serveur : ${session.serverUrl}` : 'Mode autonome (sans serveur)')}
      <div class="card"><h2>État</h2>${kv([
        ['Mode', server ? 'Serveur — synchronisation différentielle' : 'Autonome — données uniquement sur cet appareil'], ['Connexion', navigator.onLine ? 'En ligne' : 'Hors connexion'],
        ['Appareil', `${session.device.name} (n° ${session.device.number}) — ${session.device.id}`], ['Modifications en attente d’envoi', String(out.length)],
        ['Dernière synchronisation', syncState.lastSyncAt ? fmtDateTime(syncState.lastSyncAt) : (server ? 'aucune depuis l’ouverture de session' : '—')],
        ['Curseur de réception', server ? String(cursor) : ''], ['Session serveur', server ? (session.token ? `valide${session.tokenExpiresAt ? ' jusqu’au ' + fmtDateTime(session.tokenExpiresAt) : ''}` : 'reconnexion requise') : ''],
        ['Dernière erreur', syncState.lastError]
      ])}
      ${server ? html`<div class="btn-row" style="margin-top:10px"><button class="btn primary lg" data-act="sync" ${syncState.running ? raw('disabled') : ''}>🔄 Synchroniser maintenant</button>
        ${!session.token || syncState.needsLogin ? html`<button class="btn warn" data-act="relogin">Se reconnecter au serveur</button>` : ''}
        <button class="btn ghost" data-act="full">Réception complète</button><button class="btn ghost" data-act="prefetch">Télécharger les documents pour le terrain</button></div>`
        : html`<p class="note">Sans serveur, les échanges entre appareils se font par paquets de données (Export › Paquet / Import de paquet). Toutes les modifications restent en file : elles seront envoyées si l’appareil est rattaché à un serveur.</p>
          ${can('settings.manage') ? html`<button class="btn primary" data-act="attach">Rattacher cet appareil à un serveur</button>` : ''}`}</div>
      <div class="card"><h2>File d’envoi</h2>${out.length ? html`<div class="row" style="gap:6px">${Object.entries(byType).map(([t, n]) => badge(`${TYPE_LABELS[t] || t} : ${n}`, 'outline'))}</div>` : html`<p class="note">Aucune modification en attente.</p>`}
        ${rejected.length ? html`<div class="banner nc" style="margin-top:10px">${rejected.length} modification(s) refusée(s) par le serveur.</div><div class="list">${rejected.map(e => html`<div class="li stripe-nc"><div class="li-main"><div class="li-title">${TYPE_LABELS[e.type] || e.type} — ${store.getRaw(e.type, e.id)?.number || e.id}</div><div class="li-sub">${e.error}</div></div><button class="btn ghost sm" data-act="drop" data-key="${e.key}">Retirer</button></div>`)}</div><button class="btn ghost sm" data-act="retry">Réessayer</button>` : ''}</div>
      <div class="card"><h2>Conflits (${conflicts.filter(c => !c.resolved).length} à examiner)</h2>
        ${conflicts.length ? html`<div class="list">${conflicts.map(c => html`<div class="li ${c.resolved ? '' : 'stripe-warn'}"><div class="li-main"><div class="li-title">${TYPE_LABELS[c.entityType] || c.entityType} — ${c.label}</div><div class="li-sub">${fmtDateTime(c.at)} · ${c.details.length} valeur(s) en concurrence${c.origin ? ' · ' + c.origin : ''}</div>${c.resolved ? badge('Examiné — ' + (c.resolution || ''), 'ok') : ''}</div><button class="btn ghost sm" data-act="conflict" data-id="${c.id}">Examiner</button></div>`)}</div>`
          : html`<p class="note">Aucun conflit. En cas de modifications concurrentes d’une même donnée sur deux appareils, la fusion est faite champ par champ et les valeurs écartées sont conservées ici.</p>`}</div>
      <div class="card"><h2>Journal de synchronisation</h2>${logs.length ? html`<div class="table-wrap"><table class="tbl"><thead><tr><th>Date</th><th>Origine</th><th>Envois</th><th>Fichiers</th><th>Réceptions</th><th>Conflits</th><th>Erreurs</th></tr></thead><tbody>${logs.map(l => html`<tr><td>${fmtDateTime(l.at)}<div class="tiny muted">${l.durationMs} ms</div></td><td>${l.reason}</td><td>${l.pushed}</td><td>${l.media}</td><td>${l.pulled}</td><td>${l.conflicts}</td><td class="tiny">${(l.errors || []).join(' ; ') || '—'}</td></tr>`)}</tbody></table></div>` : html`<p class="note">Aucune synchronisation enregistrée sur cet appareil.</p>`}</div>`;
  },
  handlers: {
    async sync() { const r = await runSync({ reason: 'manuelle' }); toast(r.skipped ? 'Synchronisation non lancée : ' + r.skipped : r.errors?.length ? 'Terminée avec erreurs : ' + r.errors[0] : `Synchronisé : ${r.pushed} envoi(s), ${r.pulled} réception(s)`, r.errors?.length || r.skipped ? 'warn' : 'ok', 5000); this.refresh(); },
    async full() { if (!(await confirmDialog({ title: 'Réception complète', message: 'Retélécharger toutes les données du serveur (les modifications locales en attente sont conservées et fusionnées) ?' }))) return; const r = await runSync({ reason: 'réception complète', full: true }); toast(`Réception : ${r.pulled || 0} élément(s)`, 'ok'); this.refresh(); },
    async prefetch() { const n = await prefetchMedia(); toast(`${n} fichier(s) téléchargé(s) pour un usage hors connexion`, 'ok'); },
    async relogin() {
      const pw = await promptDialog({ title: 'Reconnexion au serveur', label: `Mot de passe de ${session.user.username}`, multiline: false, voice: false });
      if (!pw) return;
      const r = await refreshServerToken(pw);
      if (r?.revoked) { location.reload(); return; }
      toast(r ? 'Reconnecté au serveur' : 'Reconnexion impossible (réseau ou mot de passe)', r ? 'ok' : 'err');
      if (r) await runSync({ reason: 'reconnexion' });
      this.refresh();
    },
    async retry() { await retryRejected(); await runSync({ reason: 'nouvel essai' }); this.refresh(); },
    async drop(el) { if (await confirmDialog({ title: 'Retirer de la file', message: 'Cette modification ne sera plus envoyée au serveur (elle reste sur l’appareil). Continuer ?', danger: true })) { await dropOutboxEntry(el.dataset.key); this.refresh(); } },
    async attach() {
      const m = openModal({ title: 'Rattacher l’appareil à un serveur', body: html`<form id="af">${field('Adresse du serveur', html`<input name="url" required placeholder="https://audit.exemple.fr" value="${location.origin}">`)}<div class="grid2">${field('Identifiant (compte serveur)', html`<input name="username" required autocapitalize="none">`)}${field('Mot de passe', html`<input name="password" type="password" required>`)}</div><p class="note">Toutes les données de l’appareil seront envoyées au serveur lors de la synchronisation. Les comptes locaux restent utilisables hors connexion.</p></form>`, actions: [{ label: 'Annuler' }, { label: 'Rattacher', act: 'ok', cls: 'primary' }], handlers: { ok() { const f = this.root.querySelector('#af'); if (!f.reportValidity()) return; this.close(formValues(f)); } } });
      const v = await m.result; if (!v) return;
      const h = await serverHealth(v.url);
      if (!h) { toast('Serveur injoignable à cette adresse.', 'err'); return; }
      try { await attachToServer(v.url, v.username, v.password); toast('Appareil rattaché au serveur', 'ok'); await runSync({ reason: 'rattachement au serveur' }); location.reload(); }
      catch (e) { toast(e.message, 'err', 6000); }
    },
    async conflict(el) {
      const c = store.get('conflict', el.dataset.id);
      const m = openModal({
        title: `Conflit — ${c.label}`, wide: true,
        body: html`<p class="note">Les deux versions ont été fusionnées automatiquement ; pour chaque valeur modifiée des deux côtés, la plus récente a été retenue. Vous pouvez restaurer la valeur écartée.</p>
          <div class="table-wrap"><table class="tbl"><thead><tr><th>Champ</th><th>Valeur de cet appareil</th><th>Valeur reçue</th><th>Retenue</th><th></th></tr></thead><tbody>
          ${c.details.map((d, i) => html`<tr><td class="mono tiny">${d.path || '(objet)'}</td><td class="tiny">${show(d.localValue)}</td><td class="tiny">${show(d.remoteValue)}</td><td>${badge(d.kept === 'local' ? 'cet appareil' : 'reçue', 'info')}</td><td>${!c.resolved && d.path && store.get(c.entityType, c.entityId) ? html`<button class="btn ghost sm" data-act="restore" data-i="${i}">Restaurer l’autre valeur</button>` : ''}</td></tr>`)}</tbody></table></div>`,
        actions: [{ label: 'Fermer' }, ...(c.resolved ? [] : [{ label: 'Marquer comme examiné', act: 'ok', cls: 'primary' }])],
        handlers: {
          async restore(btn) {
            const d = c.details[Number(btn.dataset.i)];
            const cur = clone(store.get(c.entityType, c.entityId));
            const value = d.kept === 'local' ? d.remoteValue : d.localValue;
            try { setPath(cur, d.path, value ?? undefined); } catch (e) { toast(e.message, 'err'); return; }
            if (c.entityType === 'audit' && cur.lock?.lockedAt) { toast('Audit verrouillé : restaurez la valeur par une modification motivée depuis l’audit.', 'warn', 6000); return; }
            await store.put(c.entityType, cur, { reason: `Résolution de conflit : restauration de la valeur ${d.kept === 'local' ? 'reçue' : 'de cet appareil'} (${d.path})` });
            await store.put('conflict', { ...c, resolved: true, resolution: 'valeur restaurée', resolvedAt: new Date().toISOString(), resolvedBy: session.user.name });
            this.close(true);
          },
          async ok() { await store.put('conflict', { ...c, resolved: true, resolution: 'fusion acceptée', resolvedAt: new Date().toISOString(), resolvedBy: session.user.name }); this.close(true); }
        }
      });
      if (await m.result) this.refresh();
    }
  }
};
