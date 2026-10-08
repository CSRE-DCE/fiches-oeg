/* Lecture/écriture iCalendar (RFC 5545) — calendriers partagés (Outlook, Google, Thunderbird…).
 * Fichier pur. Gère le repliement des lignes, l'échappement, les dates (journée, locales, UTC) et
 * les récurrences simples (RRULE FREQ=DAILY/WEEKLY/MONTHLY/YEARLY, INTERVAL, COUNT, UNTIL, BYDAY hebdo). */

function unfold(text) { return String(text || '').replace(/\r\n/g, '\n').replace(/\n[ \t]/g, ''); }
function unescape(v) { return v.replace(/\\n/gi, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\'); }
const pad = n => String(n).padStart(2, '0');

/** Valeur DTSTART/DTEND → {date:'AAAA-MM-JJ', time:'HH:MM'|'' , allDay} (heure locale de l'appareil pour l'UTC). */
export function parseICSDate(value, params = {}) {
  const v = String(value).trim();
  let m = v.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m || params.VALUE === 'DATE') { m = m || v.match(/^(\d{4})(\d{2})(\d{2})/); return { date: `${m[1]}-${m[2]}-${m[3]}`, time: '', allDay: true }; }
  m = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/);
  if (!m) return null;
  if (m[7] === 'Z') {
    const d = new Date(Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)));
    return { date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, time: `${pad(d.getHours())}:${pad(d.getMinutes())}`, allDay: false, utc: true };
  }
  return { date: `${m[1]}-${m[2]}-${m[3]}`, time: `${m[4]}:${m[5]}`, allDay: false, tzid: params.TZID || '' };
}

export function parseICS(text) {
  const lines = unfold(text).split('\n');
  const events = [];
  let ev = null;
  for (const line of lines) {
    if (!line.trim()) continue;
    const idx = line.indexOf(':'); if (idx < 0) continue;
    const left = line.slice(0, idx), value = line.slice(idx + 1);
    const [name, ...rawParams] = left.split(';');
    const params = Object.fromEntries(rawParams.map(p => { const [k, ...v] = p.split('='); return [k.toUpperCase(), v.join('=').replace(/^"|"$/g, '')]; }));
    const key = name.toUpperCase();
    if (key === 'BEGIN' && value.trim() === 'VEVENT') { ev = { categories: [] }; continue; }
    if (key === 'END' && value.trim() === 'VEVENT') { if (ev) events.push(ev); ev = null; continue; }
    if (!ev) continue;
    switch (key) {
      case 'UID': ev.uid = value.trim(); break;
      case 'SUMMARY': ev.summary = unescape(value); break;
      case 'DESCRIPTION': ev.description = unescape(value); break;
      case 'LOCATION': ev.location = unescape(value); break;
      case 'STATUS': ev.status = value.trim(); break;
      case 'CATEGORIES': ev.categories.push(...unescape(value).split(',').map(s => s.trim()).filter(Boolean)); break;
      case 'DTSTART': ev.start = parseICSDate(value, params); break;
      case 'DTEND': ev.end = parseICSDate(value, params); break;
      case 'RRULE': ev.rrule = Object.fromEntries(value.split(';').map(p => p.split('='))); break;
      case 'EXDATE': (ev.exdates = ev.exdates || []).push(...value.split(',').map(v => parseICSDate(v, params)?.date).filter(Boolean)); break;
      case 'RECURRENCE-ID': ev.recurrenceId = parseICSDate(value, params); break;
      default: if (key.startsWith('X-')) (ev.x = ev.x || {})[key] = unescape(value);
    }
  }
  return events;
}

const DAYS = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
/** Développe les occurrences d'événements récurrents (limite de sécurité : `max` occurrences par série). */
export function expandEvents(events, { max = 200, until = null } = {}) {
  const out = [];
  for (const ev of events) {
    if (!ev.start) continue;
    if (!ev.rrule) { out.push({ ...ev, occurrence: ev.start.date }); continue; }
    const r = ev.rrule, freq = r.FREQ, interval = Math.max(1, Number(r.INTERVAL) || 1);
    const count = r.COUNT ? Number(r.COUNT) : null;
    const untilDate = r.UNTIL ? parseICSDate(r.UNTIL)?.date : until;
    const byday = r.BYDAY ? r.BYDAY.split(',').map(d => DAYS[d.slice(-2)]).filter(d => d !== undefined) : null;
    const start = new Date(ev.start.date + 'T12:00:00');
    let n = 0, guard = 0;
    const cur = new Date(start);
    while (n < (count || max) && n < max && guard++ < 5000) {
      const candidates = [];
      if (freq === 'WEEKLY' && byday) {
        const weekStart = new Date(cur); weekStart.setDate(cur.getDate() - cur.getDay());
        for (const d of byday.sort()) { const c = new Date(weekStart); c.setDate(weekStart.getDate() + d); if (c >= start) candidates.push(c); }
      } else candidates.push(new Date(cur));
      for (const c of candidates) {
        const ds = `${c.getFullYear()}-${pad(c.getMonth() + 1)}-${pad(c.getDate())}`;
        if (untilDate && ds > untilDate) { n = Infinity; break; }
        if (n >= (count || max)) break;
        if (!(ev.exdates || []).includes(ds)) out.push({ ...ev, occurrence: ds, start: { ...ev.start, date: ds }, uid: `${ev.uid || 'ev'}#${ds}` });
        n++;
      }
      if (freq === 'DAILY') cur.setDate(cur.getDate() + interval);
      else if (freq === 'WEEKLY') cur.setDate(cur.getDate() + 7 * interval);
      else if (freq === 'MONTHLY') cur.setMonth(cur.getMonth() + interval);
      else if (freq === 'YEARLY') cur.setFullYear(cur.getFullYear() + interval);
      else break;
    }
  }
  return out;
}

function escapeICS(v) { return String(v ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n'); }
function fold(line) { const out = []; let s = line; while (s.length > 74) { out.push(s.slice(0, 74)); s = ' ' + s.slice(74); } out.push(s); return out.join('\r\n'); }
/** events : [{uid, summary, description, location, date:'AAAA-MM-JJ', time:'HH:MM'|'' , durationMin}] */
export function toICS(events, { name = 'Audits de prélèvement' } = {}) {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//OEG//Audit prelevements//FR', 'CALSCALE:GREGORIAN', `X-WR-CALNAME:${escapeICS(name)}`];
  for (const e of events) {
    const d = e.date.replace(/-/g, '');
    lines.push('BEGIN:VEVENT', `UID:${e.uid}`, `DTSTAMP:${stamp}`);
    if (e.time) {
      const [h, m] = e.time.split(':').map(Number);
      const end = new Date(2000, 0, 1, h, m + (e.durationMin || 120));
      lines.push(`DTSTART:${d}T${pad(h)}${pad(m)}00`, `DTEND:${d}T${pad(end.getHours())}${pad(end.getMinutes())}00`);
    } else lines.push(`DTSTART;VALUE=DATE:${d}`);
    lines.push(`SUMMARY:${escapeICS(e.summary)}`);
    if (e.description) lines.push(`DESCRIPTION:${escapeICS(e.description)}`);
    if (e.location) lines.push(`LOCATION:${escapeICS(e.location)}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
