/* Menu complet (téléphone) : accès à tous les écrans. */
import { html } from '../core/util.js';
import { session } from '../core/session.js';
import { ROLES } from '../core/auth.js';
import { pageTitle } from '../ui/components.js';
import { navItems } from './shell.js';

export default {
  nav: 'menu', title: 'Menu',
  async render() {
    const items = navItems();
    const groups = [...new Set(items.map(n => n.group))];
    return html`${pageTitle('Menu', `${session.user.name} — ${ROLES[session.user.role]}`)}
      ${groups.map(g => html`<div class="date-head">${g}</div><div class="list">${items.filter(n => n.group === g).map(n => html`<a class="li" href="${n.href}"><span style="font-size:24px">${n.ic}</span><div class="li-main"><div class="li-title">${n.label}</div></div><span class="chev">›</span></a>`)}</div>`)}
      <div class="date-head">Session</div><div class="list"><a class="li" href="#/compte"><span style="font-size:24px">👤</span><div class="li-main"><div class="li-title">Mon compte et affichage</div></div><span class="chev">›</span></a></div>`;
  }
};
