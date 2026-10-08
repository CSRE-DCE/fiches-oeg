/* Tableau de bord qualité : indicateurs descriptifs et traçables (chaque chiffre ouvre la liste des
 * enregistrements qui le composent). Aucun score agrégé. */
import { html, fmtDate, localDate, addDays, sortBy, groupBy } from '../core/util.js';
import { store } from '../core/store.js';
import { navigate } from '../ui/router.js';
import { openModal } from '../ui/dom.js';
import { pageTitle, siteName, providerName, auditBadge, critBadge, deviationBadge, prestationBadge, options } from '../ui/components.js';
import { OPEN_DEVIATION } from '../domain/model.js';
import { isOverdue, recurringDeviations } from '../domain/summary.js';
import { auditsOf, isLate } from './planning.js';

function period(q) {
  const today = localDate();
  const p = q.periode || 'annee';
  if (p === 'annee') return { from: today.slice(0, 4) + '-01-01', to: today.slice(0, 4) + '-12-31', label: 'Année ' + today.slice(0, 4) };
  if (p === '12mois') return { from: addDays(today, -365), to: today, label: '12 derniers mois' };
  if (p === 'campagne' && q.campagne) { const c = store.get('campaign', q.campagne); return { from: c?.start || '0000', to: c?.end || '9999', label: c?.label || 'Campagne', campaignId: q.campagne }; }
  return { from: '0000-01-01', to: '9999-12-31', label: 'Toutes périodes' };
}

function compute(q) {
  const today = localDate(), P = period(q);
  const inP = d => d && d >= P.from && d <= P.to;
  const prest = store.all('prestation').filter(p => inP(p.plannedDate) && (!P.campaignId || p.campaignId === P.campaignId));
  const audits = store.all('audit').filter(a => a.status !== 'abandonne' && inP((a.startedAt || '').slice(0, 10)) && (!P.campaignId || a.campaignId === P.campaignId));
  const signed = audits.filter(a => a.lock?.lockedAt);
  const devs = store.all('deviation').filter(d => inP(d.date) && (!P.campaignId || audits.some(a => a.id === d.auditId)));
  const allDevs = store.all('deviation');
  return {
    P, prest, audits, signed, devs,
    programmes: prest.filter(p => p.plannedDate >= today && p.status !== 'annulee' && p.controlLevel !== 'aucun'),
    realises: signed,
    enRetard: prest.filter(p => isLate(p, today)),
    nonAuditees: prest.filter(p => p.plannedDate <= today && p.status !== 'annulee' && !auditsOf(p.id).some(a => a.lock?.lockedAt)),
    enCours: audits.filter(a => !a.lock?.lockedAt),
    ouverts: allDevs.filter(d => OPEN_DEVIATION.includes(d.status)),
    retard: allDevs.filter(d => isOverdue(d, today)),
    recurrents: recurringDeviations(allDevs),
    prestataires: [...new Set(signed.map(a => a.providerId))],
    sites: [...new Set(signed.map(a => a.siteId))],
    campagnes: [...new Set(signed.map(a => a.campaignId).filter(Boolean))]
  };
}

function bars(rows, { color = 'var(--sky)', empty = 'Aucune donnée' } = {}) {
  if (!rows.length) return html`<p class="note">${empty}</p>`;
  const max = Math.max(1, ...rows.map(r => r.value));
  return html`<div class="bars" role="list">${rows.map(r => html`<div class="bar-row" role="listitem" title="${r.label} : ${r.value}${r.detail ? ' — ' + r.detail : ''}"><span class="bl">${r.label}</span><span class="bt"><span style="width:${Math.max(r.value ? 2 : 0, r.value / max * 100)}%;background:${r.color || color}"></span></span><span class="bn">${r.value}</span></div>`)}</div>`;
}

export default {
  nav: 'dashboard', title: 'Tableau de bord',
  async render(params, q) {
    const d = compute(q);
    const crits = sortBy(store.all('criticality'), '-rank');
    const kpi = (k, label, n, cls = '', sub = '') => html`<button class="kpi ${cls}" data-act="list" data-k="${k}"><span class="k">${label}</span><span class="v">${n}</span>${sub ? html`<span class="tiny muted">${sub}</span>` : ''}</button>`;
    const byProvider = [...groupBy(d.signed, a => a.providerId).entries()].map(([id, l]) => ({ label: providerName(id), value: l.length })).sort((a, b) => b.value - a.value).slice(0, 10);
    const openByProvider = [...groupBy(d.ouverts, x => x.providerId).entries()].map(([id, l]) => ({ label: providerName(id), value: l.length })).sort((a, b) => b.value - a.value).slice(0, 10);
    const campaigns = sortBy(store.all('campaign').filter(c => store.count('prestation', p => p.campaignId === c.id)), 'start').map(c => {
      const ps = store.filter('prestation', p => p.campaignId === c.id);
      const audited = ps.filter(p => auditsOf(p.id).some(a => a.lock?.lockedAt)).length;
      return { c, total: ps.length, audited, late: ps.filter(p => isLate(p)).length };
    });
    return html`${pageTitle('Tableau de bord qualité', `${d.P.label} — indicateurs descriptifs, chaque valeur est consultable en détail`)}
      <div class="chips" style="margin-bottom:10px">${[['annee', 'Année en cours'], ['12mois', '12 derniers mois'], ['tout', 'Tout'], ['campagne', 'Par campagne']].map(([k, l]) => html`<button class="chip ${(q.periode || 'annee') === k ? 'sel' : ''}" data-act="period" data-v="${k}">${l}</button>`)}</div>
      ${(q.periode === 'campagne') ? html`<div class="field"><select data-change="campaign">${options(sortBy(store.all('campaign'), 'start'), q.campagne, { placeholder: 'Choisir une campagne' })}</select></div>` : ''}
      <h3>Audits et prestations</h3>
      <div class="kpis">
        ${kpi('programmes', 'Audits programmés (à venir)', d.programmes.length)}
        ${kpi('realises', 'Audits réalisés (signés)', d.realises.length)}
        ${kpi('enCours', 'Audits en cours / à signer', d.enCours.length)}
        ${kpi('enRetard', 'Audits en retard', d.enRetard.length, d.enRetard.length ? 'alert-kpi' : '', 'date passée, non audité')}
        ${kpi('nonAuditees', 'Prestations non auditées', d.nonAuditees.length, d.nonAuditees.length ? 'warn-kpi' : '')}
      </div>
      <h3>Écarts</h3>
      <div class="kpis">
        ${kpi('ouverts', 'Écarts ouverts', d.ouverts.length, d.ouverts.length ? 'warn-kpi' : '')}
        ${kpi('retard', 'Écarts en retard', d.retard.length, d.retard.length ? 'alert-kpi' : '')}
        ${kpi('recurrents', 'Écarts récurrents', d.recurrents.length, d.recurrents.length ? 'warn-kpi' : '', 'même exigence, ≥ 2 audits')}
        ${kpi('devs', 'Écarts relevés sur la période', d.devs.length)}
      </div>
      <h3>Couverture du contrôle</h3>
      <div class="kpis">
        ${kpi('prestataires', 'Prestataires contrôlés', d.prestataires.length, '', `sur ${store.count('provider', p => p.active !== false)}`)}
        ${kpi('sites', 'Sites contrôlés', d.sites.length, '', `sur ${store.count('site')}`)}
        ${kpi('campagnes', 'Campagnes contrôlées', d.campagnes.length, '', `sur ${store.count('campaign')}`)}
      </div>
      <div class="grid2" style="margin-top:12px">
        <div class="card"><h2>Écarts ouverts par criticité</h2>${bars(crits.map(c => ({ label: c.label, value: d.ouverts.filter(x => x.criticalityCode === c.code).length, color: c.color })))}</div>
        <div class="card"><h2>Écarts ouverts par prestataire</h2>${bars(openByProvider, { empty: 'Aucun écart ouvert' })}</div>
        <div class="card"><h2>Audits signés par prestataire</h2>${bars(byProvider, { empty: 'Aucun audit signé sur la période' })}</div>
        <div class="card"><h2>Exigences le plus souvent en écart</h2>${bars([...groupBy(d.devs, x => x.itemCode || x.typeCode || '—').entries()].map(([k, l]) => ({ label: `${k} — ${l[0].requirement || ''}`, value: l.length })).sort((a, b) => b.value - a.value).slice(0, 8), { empty: 'Aucun écart sur la période' })}</div>
      </div>
      <div class="card"><h2>Avancement par campagne</h2>${campaigns.length ? html`<div class="table-wrap"><table class="tbl"><thead><tr><th>Campagne</th><th>Période</th><th>Prestations</th><th>Auditées</th><th>Taux de contrôle</th><th>En retard</th></tr></thead><tbody>
        ${campaigns.map(x => html`<tr class="click" data-act="goto" data-href="#/?campagne=${x.c.id}&periode=toutes"><td>${x.c.label}</td><td>${fmtDate(x.c.start)} → ${fmtDate(x.c.end)}</td><td>${x.total}</td><td>${x.audited}</td><td>${x.total ? Math.round(x.audited * 100 / x.total) : 0} %</td><td>${x.late}</td></tr>`)}</tbody></table></div>` : html`<p class="note">Aucune campagne avec prestations.</p>`}</div>`;
  },
  handlers: {
    period(el) { navigate('/tableau-de-bord?periode=' + el.dataset.v, { replace: true }); },
    campaign(el) { navigate(`/tableau-de-bord?periode=campagne&campagne=${el.value}`, { replace: true }); },
    goto(el) { location.hash = el.dataset.href; },
    list(el) {
      const d = compute(this.query), k = el.dataset.k;
      const TITLES = { programmes: 'Audits programmés', realises: 'Audits réalisés (signés)', enCours: 'Audits en cours', enRetard: 'Audits en retard', nonAuditees: 'Prestations non auditées', ouverts: 'Écarts ouverts', retard: 'Écarts en retard', recurrents: 'Écarts récurrents', devs: 'Écarts de la période', prestataires: 'Prestataires contrôlés', sites: 'Sites contrôlés', campagnes: 'Campagnes contrôlées' };
      let rows;
      if (['programmes', 'enRetard', 'nonAuditees'].includes(k)) rows = sortBy(d[k], 'plannedDate').map(p => html`<a class="li" href="#/prestation/${p.id}"><div class="li-main"><div class="li-title">${siteName(p.siteId)}</div><div class="li-sub">${fmtDate(p.plannedDate)} · ${providerName(p.providerId)} · ${p.ref}</div></div>${prestationBadge(p.status)}</a>`);
      else if (['realises', 'enCours'].includes(k)) rows = sortBy(d[k], '-startedAt').map(a => html`<a class="li" href="#/audit/${a.id}"><div class="li-main"><div class="li-title">${a.number}</div><div class="li-sub">${fmtDate(a.startedAt)} · ${siteName(a.siteId)} · ${providerName(a.providerId)}</div></div>${auditBadge(a)}</a>`);
      else if (['ouverts', 'retard', 'devs'].includes(k)) rows = d[k].map(x => html`<a class="li" href="#/ecart/${x.id}"><div class="li-main"><div class="li-title">${x.number}</div><div class="li-sub">${x.requirement} · ${providerName(x.providerId)}</div></div>${critBadge(x.criticalityCode)}${deviationBadge(x.status)}</a>`);
      else if (k === 'recurrents') rows = d.recurrents.map(r => html`<a class="li" href="#/ecarts?prestataire=${r.providerId}&filtre=tous"><div class="li-main"><div class="li-title">${r.requirement}</div><div class="li-sub">${providerName(r.providerId)} · ${r.audits.length} audits · ${r.count} écarts</div></div></a>`);
      else if (k === 'prestataires') rows = d.prestataires.map(id => html`<a class="li" href="#/prestataire/${id}"><div class="li-main"><div class="li-title">${providerName(id)}</div></div></a>`);
      else if (k === 'sites') rows = d.sites.map(id => html`<a class="li" href="#/audits?site=${id}"><div class="li-main"><div class="li-title">${siteName(id)}</div></div></a>`);
      else rows = d.campagnes.map(id => html`<div class="li"><div class="li-main"><div class="li-title">${store.get('campaign', id)?.label}</div></div></div>`);
      const m = openModal({ title: `${TITLES[k]} (${rows.length})`, wide: true, body: rows.length ? html`<div class="list">${rows}</div>` : html`<p class="note">Aucun enregistrement.</p>`, actions: [{ label: 'Fermer', cls: 'primary' }] });
      m.root.addEventListener('click', e => { if (e.target.closest('a[href^="#/"]')) m.close(); });
    }
  }
};
