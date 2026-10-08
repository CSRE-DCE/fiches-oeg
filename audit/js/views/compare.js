/* Comparaison de deux audits successifs (critère par critère, apparié par code). */
import { html, fmtDate, sortBy } from '../core/util.js';
import { store } from '../core/store.js';
import { pageTitle, empty, badge, siteName, providerName, options } from '../ui/components.js';
import { navigate } from '../ui/router.js';
import { compareAudits } from '../domain/compare.js';
import { auditDeviations } from '../app/audits.js';

const CHANGE = { amelioration: ['Amélioration', 'ok', '▲'], degradation: ['Dégradation', 'nc', '▼'], modifie: ['Modifié', 'warn', '≠'], identique: ['Identique', 'na', '='], nouveau: ['Nouveau critère', 'info', '+'], retire: ['Critère retiré', 'na', '−'] };

export default {
  nav: 'historique', title: 'Comparaison',
  async render(params, q) {
    const a = store.get('audit', q.a), b = store.get('audit', q.b);
    const all = sortBy(store.all('audit').filter(x => x.status !== 'abandonne'), '-startedAt');
    const picker = html`<div class="card"><h2>Audits comparés</h2><div class="grid2">
      <div class="field"><label>Audit le plus ancien</label><select data-change="pick" data-k="a">${options(all, q.a, { label: x => `${x.number} — ${fmtDate(x.startedAt)} — ${siteName(x.siteId)}` })}</select></div>
      <div class="field"><label>Audit le plus récent</label><select data-change="pick" data-k="b">${options(all, q.b, { label: x => `${x.number} — ${fmtDate(x.startedAt)} — ${siteName(x.siteId)}` })}</select></div></div>
      ${a ? html`<button class="btn ghost sm" data-act="previous">Proposer l’audit précédent du même site/prestataire</button>` : ''}</div>`;
    if (!a || !b) return html`${pageTitle('Comparer deux audits', '', '', '#/audits?vue=historique')}${picker}`;
    const r = compareAudits(a, b, { deviationsOld: auditDeviations(a.id), deviationsNew: auditDeviations(b.id) });
    return html`${pageTitle('Comparaison de deux audits', `${a.number} (${fmtDate(a.startedAt)}) → ${b.number} (${fmtDate(b.startedAt)})`, '', '#/audits?vue=historique')}
      ${picker}
      ${a.siteId !== b.siteId || a.providerId !== b.providerId ? html`<div class="banner warn">Attention : les deux audits ne portent pas sur le même site et/ou le même prestataire (${siteName(a.siteId)} / ${providerName(a.providerId)} → ${siteName(b.siteId)} / ${providerName(b.providerId)}).</div>` : ''}
      ${!r.sameGrid ? html`<div class="banner info">Grilles différentes : les critères sont appariés par code.</div>` : r.gridVersions[0] !== r.gridVersions[1] ? html`<div class="banner info">Versions de grille différentes (v${r.gridVersions[0]} → v${r.gridVersions[1]}).</div>` : ''}
      <div class="kpis" style="margin-bottom:12px">
        ${Object.entries(r.stats).map(([k, v]) => html`<div class="kpi"><span class="k">${CHANGE[k][0]}</span><span class="v" style="color:var(--${CHANGE[k][1] === 'na' ? 'muted' : CHANGE[k][1]})">${v}</span></div>`)}
        <div class="kpi"><span class="k">Écarts</span><span class="v">${r.deviations.before} → ${r.deviations.after}</span></div>
      </div>
      ${r.persistent.length ? html`<div class="banner nc">${r.persistent.length} non-conformité(s) persistante(s) : ${r.persistent.map(p => p.code).join(', ')}</div>` : ''}
      <div class="card"><h2>Critère par critère</h2><div class="table-wrap"><table class="tbl"><thead><tr><th>Code</th><th>Critère</th><th>${a.number}</th><th>${b.number}</th><th>Évolution</th></tr></thead><tbody>
        ${r.rows.filter(x => q.tout || x.change !== 'identique').map(x => html`<tr><td class="mono">${x.code || ''}</td><td>${x.label}<div class="tiny muted">${x.section || ''}</div></td><td>${x.before || '—'}</td><td>${x.after || '—'}</td><td>${badge(CHANGE[x.change][2] + ' ' + CHANGE[x.change][0], CHANGE[x.change][1])}</td></tr>`)}
      </tbody></table></div>
      <button class="btn ghost sm" style="margin-top:10px" data-act="all">${q.tout ? 'Masquer les critères identiques' : `Afficher aussi les ${r.stats.identique} critère(s) identique(s)`}</button></div>`;
  },
  handlers: {
    pick(el) { const q = { ...this.query, [el.dataset.k]: el.value }; navigate('/comparer?' + new URLSearchParams(q), { replace: true }); },
    all() { const q = { ...this.query }; if (q.tout) delete q.tout; else q.tout = '1'; navigate('/comparer?' + new URLSearchParams(q), { replace: true }); },
    previous() {
      const b = store.get('audit', this.query.b || this.query.a);
      const prev = sortBy(store.filter('audit', x => x.id !== b.id && x.siteId === b.siteId && x.providerId === b.providerId && x.startedAt < b.startedAt && x.status !== 'abandonne'), '-startedAt')[0];
      if (!prev) return;
      navigate(`/comparer?a=${prev.id}&b=${b.id}`, { replace: true });
    }
  }
};
