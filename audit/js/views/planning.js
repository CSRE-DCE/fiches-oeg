/* Planning des prestations : aujourd'hui, à venir, en retard, non auditées ; liste ou calendrier. */
import { html, localDate, addDays, fmtDate, normalize, sortBy, groupBy } from '../core/util.js';
import { store } from '../core/store.js';
import { session } from '../core/session.js';
import { can } from '../core/auth.js';
import { navigate } from '../ui/router.js';
import { toast } from '../ui/dom.js';
import { pageTitle, prestationBadge, kindBadge, auditBadge, options, empty, siteName } from '../ui/components.js';
import { PRESTATION_STATUS } from '../domain/model.js';

const DAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const longDate = d => { const x = new Date(d + 'T12:00:00'); return `${DAYS[x.getDay()]} ${x.getDate()} ${MONTHS[x.getMonth()]} ${x.getFullYear()}`; };

export function auditsOf(prestationId) { return sortBy(store.filter('audit', a => a.prestationId === prestationId && a.status !== 'abandonne'), '-startedAt'); }
const CLOSED = ['annulee', 'auditee', 'non_realisee'];
export function isLate(p, today = localDate()) { return p.plannedDate && p.plannedDate < today && p.status === 'prevue' && !auditsOf(p.id).length; }

function filterList(q) {
  const today = localDate();
  let list = store.all('prestation');
  const period = q.periode || 'semaine';
  if (q.jour) list = list.filter(p => p.plannedDate === q.jour);
  else if (period === 'jour') list = list.filter(p => p.plannedDate === today);
  else if (period === 'semaine') list = list.filter(p => p.plannedDate >= today && p.plannedDate <= addDays(today, 6));
  else if (period === 'avenir') list = list.filter(p => p.plannedDate >= today);
  else if (period === 'retard') list = list.filter(p => isLate(p, today));
  else if (period === 'nonauditees') list = list.filter(p => !auditsOf(p.id).some(a => a.lock?.lockedAt) && !['annulee'].includes(p.status) && p.plannedDate <= today);
  if (q.prestataire) list = list.filter(p => p.providerId === q.prestataire);
  if (q.campagne) list = list.filter(p => p.campaignId === q.campagne);
  if (q.statut) list = list.filter(p => p.status === q.statut);
  if (q.q) { const t = normalize(q.q); list = list.filter(p => normalize(`${p.ref} ${siteName(p.siteId)} ${store.get('provider', p.providerId)?.name}`).includes(t)); }
  return sortBy(list, 'plannedDate', 'plannedTime', 'ref');
}

function card(p) {
  const site = store.get('site', p.siteId), prov = store.get('provider', p.providerId);
  const audits = auditsOf(p.id), a = audits[0];
  const late = isLate(p);
  const stripe = late ? 'stripe-nc' : a?.lock?.lockedAt ? 'stripe-ok' : a ? 'stripe-info' : p.status === 'reportee' ? 'stripe-warn' : '';
  return html`<a class="li ${stripe}" href="#/prestation/${p.id}">
    <div style="text-align:center;min-width:54px"><div class="strong" style="font-size:17px">${p.plannedTime || '—'}</div><div class="tiny muted">${p.dateIndicative ? 'indicatif' : fmtDate(p.plannedDate).slice(0, 5)}</div></div>
    <div class="li-main"><div class="li-title">${site?.name || 'Site ?'} <span class="tiny muted">${site?.code || ''}</span></div>
      <div class="li-sub">${prov?.name || '—'} · ${store.get('samplingType', p.samplingTypeId)?.label || 'Type non précisé'}</div>
      <div class="row" style="gap:6px;margin-top:6px">${prestationBadge(p.status)}${kindBadge(prov?.kind)}${late ? html`<span class="badge nc">En retard</span>` : ''}${a ? html`<span class="badge info">${a.number}</span>${auditBadge(a)}` : html`<span class="badge outline">Non auditée</span>`}</div>
    </div><span class="chev">›</span></a>`;
}

function calendar(q, all) {
  const today = localDate();
  const month = q.mois || today.slice(0, 7);
  const [y, m] = month.split('-').map(Number);
  const first = new Date(y, m - 1, 1), start = new Date(first); start.setDate(1 - ((first.getDay() + 6) % 7));
  const byDay = groupBy(all, p => p.plannedDate);
  const cells = [];
  for (let i = 0; i < 42; i++) { const d = new Date(start); d.setDate(start.getDate() + i); cells.push(localDate(d)); }
  const prev = localDate(new Date(y, m - 2, 1)).slice(0, 7), next = localDate(new Date(y, m, 1)).slice(0, 7);
  return html`<div class="card"><div class="row between" style="margin-bottom:8px">
      <button class="btn ghost sm" data-act="q" data-k="mois" data-v="${prev}">‹</button><b style="font-size:17px">${MONTHS[m - 1]} ${y}</b><button class="btn ghost sm" data-act="q" data-k="mois" data-v="${next}">›</button></div>
    <div class="cal">${['L', 'M', 'M', 'J', 'V', 'S', 'D'].map(d => html`<div class="dow">${d}</div>`)}
    ${cells.map(d => { const n = (byDay.get(d) || []).length, late = (byDay.get(d) || []).filter(p => isLate(p)).length; return html`<button data-act="q" data-k="jour" data-v="${d}" class="${d.slice(0, 7) !== month ? 'out' : ''} ${d === today ? 'today' : ''} ${q.jour === d ? 'sel' : ''}">${Number(d.slice(8))}${n ? html`<span class="cnt" style="${late ? 'background:var(--nc-bg);color:var(--nc)' : ''}">${n}</span>` : ''}</button>`; })}</div></div>`;
}

export default {
  nav: 'planning', title: 'Planning',
  async render(params, q) {
    const today = localDate();
    const list = filterList(q);
    const all = store.all('prestation');
    const counts = {
      jour: all.filter(p => p.plannedDate === today).length,
      semaine: all.filter(p => p.plannedDate >= today && p.plannedDate <= addDays(today, 6)).length,
      retard: all.filter(p => isLate(p, today)).length,
      nonauditees: all.filter(p => !auditsOf(p.id).some(a => a.lock?.lockedAt) && p.status !== 'annulee' && p.plannedDate <= today).length
    };
    const inProgress = store.filter('audit', a => a.status === 'en_cours' && a.auditorId === session.user.id);
    const period = q.jour ? '' : (q.periode || 'semaine');
    const chips = [['jour', 'Aujourd’hui', counts.jour], ['semaine', '7 jours', counts.semaine], ['avenir', 'À venir'], ['retard', 'En retard', counts.retard], ['nonauditees', 'Non auditées', counts.nonauditees], ['toutes', 'Toutes']];
    const grouped = groupBy(list, p => p.plannedDate || '');
    return html`
      ${pageTitle('Planning des prestations', longDate(today), html`
        ${can('audit.create') ? html`<a class="btn accent" href="#/nouvel-audit"><span class="ic">⚡</span>Audit inopiné</a>` : ''}
        <button class="btn ghost" data-act="prepare" title="Synchroniser et télécharger les documents pour le terrain"><span class="ic">🧳</span>Préparer le terrain</button>
        ${can('planning.manage') ? html`<button class="btn ghost" data-act="newPrestation"><span class="ic">＋</span>Prestation</button>` : ''}`)}
      ${inProgress.length ? html`<div class="card" style="border-color:var(--sky)"><h2>▶ Audits en cours — continuer</h2><div class="list">${inProgress.map(a => html`<a class="li stripe-info" href="#/audit/${a.id}"><div class="li-main"><div class="li-title">${a.number} — ${siteName(a.siteId)}</div><div class="li-sub">${store.get('provider', a.providerId)?.name || ''} · démarré le ${fmtDate(a.startedAt)}</div></div><span class="btn primary sm">Reprendre</span></a>`)}</div></div>` : ''}
      <div class="chips" style="margin-bottom:10px">${chips.map(([k, l, n]) => html`<button class="chip ${period === k ? 'sel' : ''}" data-act="q" data-k="periode" data-v="${k}">${l}${n !== undefined ? html`<span class="count">${n}</span>` : ''}</button>`)}
        <button class="chip ${q.mode === 'calendrier' ? 'sel' : ''}" data-act="q" data-k="mode" data-v="${q.mode === 'calendrier' ? '' : 'calendrier'}">🗓️ Calendrier</button></div>
      <details class="card" ${q.prestataire || q.campagne || q.statut || q.q ? 'open' : ''}><summary>Filtres${q.prestataire || q.campagne || q.statut || q.q ? ' (actifs)' : ''}</summary>
        <div class="grid2" style="margin-top:10px">
          <div class="field"><label>Prestataire / partenaire / régie</label><select data-change="qsel" data-k="prestataire">${options(sortBy(store.all('provider'), 'name'), q.prestataire, { placeholder: 'Tous' })}</select></div>
          <div class="field"><label>Campagne</label><select data-change="qsel" data-k="campagne">${options(sortBy(store.all('campaign'), 'label'), q.campagne, { placeholder: 'Toutes' })}</select></div>
          <div class="field"><label>Statut</label><select data-change="qsel" data-k="statut">${options(Object.entries(PRESTATION_STATUS).map(([id, s]) => ({ id, label: s.label })), q.statut, { placeholder: 'Tous' })}</select></div>
          <div class="field"><label>Recherche (site, référence)</label><input type="search" value="${q.q || ''}" data-change="qsel" data-k="q" placeholder="ex. Mahury"></div>
        </div>
        <button class="btn ghost sm" data-act="reset">Effacer les filtres</button>
      </details>
      ${q.mode === 'calendrier' ? calendar(q, all) : ''}
      ${q.jour ? html`<div class="banner info row between"><span>Prestations du ${longDate(q.jour)}</span><button class="btn ghost sm" data-act="q" data-k="jour" data-v="">Toutes les dates</button></div>` : ''}
      ${!all.length ? html`<div class="card">${empty('📅', 'Aucune prestation programmée sur cet appareil.', html`<div class="btn-row">
          ${can('planning.manage') ? html`<a class="btn primary" href="#/import">📥 Importer un calendrier (Excel, CSV, ICS, API)</a><button class="btn ghost" data-act="programme">Importer le programme des fiches terrain OEG</button>` : ''}
          ${session.mode === 'server' ? html`<button class="btn ghost" data-act="prepare">Synchroniser</button>` : ''}</div>`)}</div>`
        : !list.length ? html`<div class="card">${empty('🔎', 'Aucune prestation pour cette sélection.')}</div>`
        : html`${[...grouped.entries()].map(([d, ps]) => html`<div class="date-head">${d ? longDate(d) : 'Sans date'} · ${ps.length}</div><div class="list">${ps.slice(0, 200).map(card)}</div>`)}`}
      <p class="note" style="margin-top:14px">${list.length} prestation(s) affichée(s). Les prestations peuvent être réalisées en régie, par des prestataires externes ou des partenaires.</p>`;
  },
  handlers: {
    q(el) { const q = { ...this.query, [el.dataset.k]: el.dataset.v }; if (el.dataset.k === 'periode') delete q.jour; if (!q[el.dataset.k]) delete q[el.dataset.k]; navigate('/?' + new URLSearchParams(q), { replace: true }); },
    qsel(el) { const q = { ...this.query, [el.dataset.k]: el.value }; if (!el.value) delete q[el.dataset.k]; navigate('/?' + new URLSearchParams(q), { replace: true }); },
    reset() { navigate('/', { replace: true }); },
    async newPrestation() { const { editPrestation } = await import('./prestation.js'); const p = await editPrestation(); if (p) navigate('/prestation/' + p.id); },
    async programme() {
      const { importOEGProgramme } = await import('../app/bootstrap.js');
      const n = await importOEGProgramme();
      toast(`${n} prestation(s) importée(s) depuis le programme des fiches terrain`, 'ok');
      this.refresh();
    },
    async prepare() {
      const { runSync, prefetchMedia } = await import('../app/sync.js');
      if (session.mode !== 'server') { toast('Mode autonome : toutes les données sont déjà sur l’appareil. Pensez à précharger la carte (écran Carte).', '', 4500); return; }
      if (!navigator.onLine) { toast('Hors connexion : la préparation nécessite le réseau.', 'warn'); return; }
      toast('Synchronisation et téléchargement des documents…');
      const r = await runSync({ reason: 'préparation du terrain' });
      const n = await prefetchMedia();
      toast(r.errors?.length ? `Préparation incomplète : ${r.errors[0]}` : `Prêt pour le terrain ✓ (${r.pulled || 0} mise(s) à jour, ${n} document(s) téléchargé(s))`, r.errors?.length ? 'warn' : 'ok', 5000);
      this.refresh();
    }
  }
};
