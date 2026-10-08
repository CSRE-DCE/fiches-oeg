/* Carte : sites, points, prestations programmées, audits réalisés et à réaliser ; zones préchargées. */
import { html, esc, fmtDate, localDate, sortBy } from '../core/util.js';
import { store } from '../core/store.js';
import { can } from '../core/auth.js';
import { navigate } from '../ui/router.js';
import { toast, confirmDialog } from '../ui/dom.js';
import { pageTitle } from '../ui/components.js';
import { createMap, tileUrls, preloadTiles, tileCacheCount, clearTileCache } from '../ui/map.js';
import { getPosition } from '../ui/gps.js';
import { orgSettings } from '../app/settings.js';
import { auditsOf, isLate } from './planning.js';

let map = null, layer = null, meMarker = null;
const COLORS = { late: '#b3261e', progress: '#d98a00', done: '#1b7a43', planned: '#1f5f99', today: '#00ac97', none: '#8a979c' };
const LABELS = { today: 'Prestation aujourd’hui', planned: 'Prestation à auditer', late: 'En retard / non auditée', progress: 'Audit en cours', done: 'Audité (signé)', none: 'Sans prestation' };

function pointStatus(pt, today) {
  const prest = store.filter('prestation', p => (p.pointIds || []).includes(pt.id) || (p.siteId === pt.siteId && !(p.pointIds || []).length));
  const audits = store.filter('audit', a => a.pointId === pt.id || (a.siteId === pt.siteId && !a.pointId));
  if (audits.some(a => a.status === 'en_cours' || a.status === 'termine')) return { s: 'progress', prest, audits };
  if (prest.some(p => p.plannedDate === today && !auditsOf(p.id).length)) return { s: 'today', prest, audits };
  if (prest.some(p => isLate(p, today))) return { s: 'late', prest, audits };
  if (prest.some(p => p.plannedDate >= today && !auditsOf(p.id).some(a => a.lock?.lockedAt))) return { s: 'planned', prest, audits };
  if (audits.some(a => a.lock?.lockedAt)) return { s: 'done', prest, audits };
  return { s: 'none', prest, audits };
}

export default {
  nav: 'carte', title: 'Carte',
  async render(params, q) {
    const n = await tileCacheCount();
    const f = q.filtre || 'tous';
    return html`${pageTitle('Carte des sites et des audits', `${store.count('point')} point(s) de prélèvement · ${n} tuile(s) de carte disponibles hors connexion`)}
      <div class="chips" style="margin-bottom:8px">${[['tous', 'Tous'], ['aauditer', 'À auditer'], ['retard', 'En retard'], ['audites', 'Audités'], ['jour', 'Aujourd’hui']].map(([k, l]) => html`<button class="chip ${f === k ? 'sel' : ''}" data-act="filter" data-v="${k}">${l}</button>`)}</div>
      <div class="map-box" id="mapBox" role="application" aria-label="Carte interactive"></div>
      <div class="map-legend">${Object.entries(LABELS).map(([k, l]) => html`<span><i style="background:${COLORS[k]}"></i>${l}</span>`)}</div>
      <div class="btn-row" style="margin-top:8px"><button class="btn ghost" data-act="me">📍 Ma position</button><button class="btn ghost" data-act="preload">⬇️ Précharger la zone affichée</button>${n ? html`<button class="btn ghost" data-act="clear">Vider le cache de carte</button>` : ''}</div>
      <p class="note" id="preloadMsg">Préchargement limité au niveau de zoom ${orgSettings().maxPreloadZoom} et à 1 500 tuiles par zone, pour respecter les conditions d’utilisation du serveur de tuiles (configurable dans Administration). Les points restent affichés même sans fond de carte.</p>`;
  },
  mount(root, params, q) {
    const today = localDate();
    map = createMap(root.querySelector('#mapBox'));
    layer = globalThis.L.layerGroup().addTo(map);
    const f = q.filtre || 'tous';
    const bounds = [];
    let focus = null;
    for (const pt of store.all('point')) {
      if (!isFinite(pt.lat) || !isFinite(pt.lon) || pt.lat === null) continue;
      const st = pointStatus(pt, today);
      if (f === 'aauditer' && !['planned', 'today', 'late'].includes(st.s)) continue;
      if (f === 'retard' && st.s !== 'late') continue;
      if (f === 'audites' && st.s !== 'done') continue;
      if (f === 'jour' && st.s !== 'today') continue;
      const site = store.get('site', pt.siteId);
      const next = sortBy(st.prest.filter(p => p.plannedDate >= today), 'plannedDate')[0];
      const last = sortBy(st.audits, '-startedAt')[0];
      const m = globalThis.L.circleMarker([pt.lat, pt.lon], { radius: st.s === 'none' ? 6 : 9, color: '#fff', weight: 2, fillColor: COLORS[st.s], fillOpacity: 0.95 }).addTo(layer);
      m.bindPopup(`<b>${esc(site?.name || pt.name)}</b><br><span style="color:#55636a">${esc(pt.code)} · ${esc((site?.networks || []).join(', '))}</span><br>${esc(LABELS[st.s])}
        ${next ? `<br>Prochaine prestation : ${esc(fmtDate(next.plannedDate))} — ${esc(store.get('provider', next.providerId)?.name || '')}<br><a class="btn primary" href="#/prestation/${esc(next.id)}">Fiche de préparation</a>` : ''}
        ${last ? `<br>Dernier audit : <a href="#/audit/${esc(last.id)}">${esc(last.number)}</a> (${esc(fmtDate(last.startedAt))})` : ''}
        ${can('audit.create') ? `<br><a class="btn ghost" href="#/nouvel-audit" data-site="${esc(pt.siteId)}">Audit inopiné</a>` : ''}`);
      bounds.push([pt.lat, pt.lon]);
      if (q.point === pt.id) focus = { m, pt };
    }
    if (focus) { map.setView([focus.pt.lat, focus.pt.lon], 13); focus.m.openPopup(); }
    else if (bounds.length) map.fitBounds(bounds, { padding: [20, 20], maxZoom: 12 });
    setTimeout(() => map?.invalidateSize(), 100);
  },
  unmount() { if (map) { map.remove(); map = null; layer = null; meMarker = null; } },
  handlers: {
    filter(el) { navigate('/carte?filtre=' + el.dataset.v, { replace: true }); },
    async me() {
      try {
        const p = await getPosition({ timeout: 20000 });
        if (meMarker) meMarker.remove();
        meMarker = globalThis.L.circleMarker([p.lat, p.lon], { radius: 10, color: '#fff', weight: 3, fillColor: '#7b2cbf', fillOpacity: 1 }).addTo(map).bindPopup(`Ma position (±${Math.round(p.accuracy)} m)`).openPopup();
        map.setView([p.lat, p.lon], Math.max(map.getZoom(), 12));
      } catch (e) { toast(e.message, 'err'); }
    },
    async preload() {
      if (!navigator.onLine) { toast('Le préchargement nécessite une connexion.', 'warn'); return; }
      const b = map.getBounds(), z = map.getZoom(), maxZ = Math.min(Number(orgSettings().maxPreloadZoom) || 14, z + 3);
      const urls = tileUrls({ west: b.getWest(), east: b.getEast(), north: b.getNorth(), south: b.getSouth() }, Math.max(3, z - 2), Math.max(z, Math.min(maxZ, 18)));
      if (urls.length > 1500) { toast(`Zone trop étendue (${urls.length}+ tuiles) : zoomez sur la zone de terrain.`, 'warn', 5000); return; }
      if (!(await confirmDialog({ title: 'Précharger la carte', message: `${urls.length} tuile(s) vont être téléchargées pour un usage hors connexion (zoom ${Math.max(3, z - 2)} à ${Math.max(z, maxZ)}).`, okLabel: 'Télécharger' }))) return;
      const msg = document.getElementById('preloadMsg');
      const r = await preloadTiles(urls, (d, t) => { if (msg) msg.textContent = `Téléchargement des tuiles : ${d} / ${t}`; });
      toast(`Carte préchargée : ${r.saved} nouvelle(s), ${r.skipped} déjà présente(s)${r.failed ? `, ${r.failed} échec(s)` : ''}`, r.failed ? 'warn' : 'ok', 5000);
      this.refresh();
    },
    async clear() { if (await confirmDialog({ title: 'Vider le cache de carte', message: 'Supprimer les tuiles préchargées ?', danger: true })) { await clearTileCache(); this.refresh(); } }
  }
};
