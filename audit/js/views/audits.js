/* Liste et historique des audits : par prestataire, site, point, statut, période ; sélection de deux
 * audits à comparer. */
import { html, fmtDate, sortBy, normalize, localDate } from '../core/util.js';
import { store } from '../core/store.js';
import { session } from '../core/session.js';
import { navigate } from '../ui/router.js';
import { toast, downloadBlob } from '../ui/dom.js';
import { pageTitle, auditBadge, options, empty, siteName, providerName, badge, progressBar } from '../ui/components.js';
import { AUDIT_STATUS } from '../domain/model.js';
import { auditState } from '../app/audits.js';

let selected = [];

function filtered(q) {
  let list = store.all('audit');
  if (q.prestataire) list = list.filter(a => a.providerId === q.prestataire);
  if (q.site) list = list.filter(a => a.siteId === q.site);
  if (q.point) list = list.filter(a => a.pointId === q.point);
  if (q.statut === 'verrouille') list = list.filter(a => a.lock?.lockedAt);
  else if (q.statut) list = list.filter(a => a.status === q.statut && !a.lock?.lockedAt);
  if (q.mine) list = list.filter(a => a.auditorId === session.user.id);
  if (q.du) list = list.filter(a => (a.startedAt || '').slice(0, 10) >= q.du);
  if (q.au) list = list.filter(a => (a.startedAt || '').slice(0, 10) <= q.au);
  if (q.q) { const t = normalize(q.q); list = list.filter(a => normalize(`${a.number} ${siteName(a.siteId)} ${providerName(a.providerId)} ${a.auditorName}`).includes(t)); }
  return sortBy(list, '-startedAt');
}

export default {
  nav: 'audits', title: 'Audits',
  async render(params, q) {
    const list = filtered(q);
    const historique = q.vue === 'historique';
    const sitesWithAudits = sortBy(store.all('site').filter(s => store.count('audit', a => a.siteId === s.id)), 'name');
    const points = q.site ? store.filter('point', p => p.siteId === q.site) : [];
    return html`
      ${pageTitle(historique ? 'Historique et comparaison' : 'Audits', `${list.length} audit(s)`, html`<a class="btn accent" href="#/nouvel-audit">⚡ Audit inopiné</a>`)}
      <div class="chips" style="margin-bottom:10px">
        ${[['', 'Tous'], ['en_cours', 'En cours'], ['termine', 'À signer'], ['verrouille', 'Signés'], ['abandonne', 'Abandonnés']].map(([k, l]) => html`<button class="chip ${(q.statut || '') === k ? 'sel' : ''}" data-act="q" data-k="statut" data-v="${k}">${l}</button>`)}
        <button class="chip ${q.mine ? 'sel' : ''}" data-act="q" data-k="mine" data-v="${q.mine ? '' : '1'}">Mes audits</button>
      </div>
      <details class="card" ${historique || q.prestataire || q.site ? 'open' : ''}><summary>Rechercher dans l’historique</summary>
        <div class="grid2" style="margin-top:10px">
          <div class="field"><label>Prestataire</label><select data-change="qsel" data-k="prestataire">${options(sortBy(store.all('provider'), 'name'), q.prestataire, { placeholder: 'Tous' })}</select></div>
          <div class="field"><label>Site</label><select data-change="qsel" data-k="site">${options(sitesWithAudits, q.site, { placeholder: 'Tous les sites audités', label: s => `${s.name} (${s.code})` })}</select></div>
          ${points.length > 1 ? html`<div class="field"><label>Point</label><select data-change="qsel" data-k="point">${options(points, q.point, { placeholder: 'Tous', label: p => p.code })}</select></div>` : ''}
          <div class="field"><label>Du</label><input type="date" value="${q.du || ''}" data-change="qsel" data-k="du"></div>
          <div class="field"><label>Au</label><input type="date" value="${q.au || ''}" data-change="qsel" data-k="au"></div>
          <div class="field"><label>Recherche</label><input type="search" value="${q.q || ''}" data-change="qsel" data-k="q" placeholder="numéro, site, auditeur…"></div>
        </div><button class="btn ghost sm" data-act="reset">Effacer</button>
      </details>
      <div class="banner info row between"><span>Comparer deux audits successifs : cochez-en deux (${selected.length}/2).</span>${selected.length === 2 ? html`<button class="btn primary sm" data-act="compare">Comparer</button>` : ''}</div>
      ${list.length ? html`<div class="list">${list.map(a => { const st = auditState(a); const devs = st.deviations.length; return html`
        <div class="li ${a.lock?.lockedAt ? 'stripe-ok' : a.status === 'abandonne' ? '' : 'stripe-info'}">
          <input type="checkbox" aria-label="Sélectionner pour comparaison" data-change="sel" data-id="${a.id}" ${selected.includes(a.id) ? 'checked' : ''}>
          <a class="li-main" href="#/audit/${a.id}" style="text-decoration:none;color:inherit"><div class="li-title">${a.number} — ${siteName(a.siteId)}</div>
            <div class="li-sub">${fmtDate(a.startedAt)} · ${providerName(a.providerId)} · ${a.auditorName} · ${a.kind === 'inopine' ? 'inopiné' : 'planifié'}</div>
            <div class="row" style="gap:6px;margin-top:6px">${auditBadge(a)}${badge(`${st.summary.counts.C} C · ${st.summary.counts.NC} NC`, st.summary.counts.NC ? 'nc' : 'ok')}${devs ? badge(`${devs} écart(s)`, 'warn') : ''}${(a.amendments || []).length ? badge(`${a.amendments.length} modif. après signature`, 'nv') : ''}</div>
            ${a.status === 'en_cours' ? html`<div style="margin-top:6px">${progressBar(st.progress.percent)}</div>` : ''}</a>
          <span class="chev">›</span></div>`; })}</div>`
        : html`<div class="card">${empty('📋', 'Aucun audit pour cette sélection.')}</div>`}`;
  },
  handlers: {
    q(el) { const q = { ...this.query, [el.dataset.k]: el.dataset.v }; if (!el.dataset.v) delete q[el.dataset.k]; navigate('/audits?' + new URLSearchParams(q), { replace: true }); },
    qsel(el) { const q = { ...this.query, [el.dataset.k]: el.value }; if (!el.value) delete q[el.dataset.k]; if (el.dataset.k === 'site') delete q.point; navigate('/audits?' + new URLSearchParams(q), { replace: true }); },
    reset() { navigate('/audits' + (this.query.vue ? '?vue=' + this.query.vue : ''), { replace: true }); },
    sel(el) {
      selected = el.checked ? [...selected.filter(x => x !== el.dataset.id), el.dataset.id].slice(-2) : selected.filter(x => x !== el.dataset.id);
      this.refresh();
    },
    compare() {
      const [a, b] = sortBy(selected.map(id => store.get('audit', id)).filter(Boolean), 'startedAt');
      if (!a || !b) { toast('Sélectionnez deux audits.', 'warn'); return; }
      navigate(`/comparer?a=${a.id}&b=${b.id}`);
    }
  }
};
