/* Persistance du serveur de référence : un fichier JSON (écriture atomique différée) + un journal
 * NDJSON en ajout seul + un dossier de médias. Suffisant pour une organisation de taille moyenne ;
 * l'interface (get/put/changesSince…) permet de la remplacer par une base PostgreSQL. */
import fs from 'node:fs';
import path from 'node:path';

export class JsonDB {
  constructor(dir) {
    this.dir = dir;
    this.file = path.join(dir, 'db.json');
    this.journalFile = path.join(dir, 'journal.ndjson');
    this.mediaDir = path.join(dir, 'media');
    fs.mkdirSync(this.mediaDir, { recursive: true });
    this.data = { seq: 0, entities: {}, users: {}, sessions: {}, devices: {}, sequences: {}, deviceCounter: 0 };
    if (fs.existsSync(this.file)) this.data = { ...this.data, ...JSON.parse(fs.readFileSync(this.file, 'utf8')) };
    this.timer = null;
  }
  save() { clearTimeout(this.timer); this.timer = setTimeout(() => this.flush(), 150); }
  flush() {
    clearTimeout(this.timer); this.timer = null;
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data));
    fs.renameSync(tmp, this.file);
  }
  journal(entry) { fs.appendFileSync(this.journalFile, JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n'); }
  readJournal({ since = 0, limit = 500 } = {}) {
    if (!fs.existsSync(this.journalFile)) return [];
    const lines = fs.readFileSync(this.journalFile, 'utf8').split('\n').filter(Boolean);
    return lines.slice(since, since + limit).map((l, i) => ({ line: since + i + 1, ...JSON.parse(l) }));
  }

  /* --- entités synchronisées --- */
  get(type, id) { return this.data.entities[type]?.[id] || null; }
  put(type, id, { data, deleted = false, by, deviceId }) {
    const cur = this.get(type, id);
    const rec = { rev: (cur?.rev || 0) + 1, seq: ++this.data.seq, deleted, data, updatedAt: new Date().toISOString(), by, deviceId };
    (this.data.entities[type] = this.data.entities[type] || {})[id] = rec;
    this.save();
    return rec;
  }
  changesSince(seq, limit) {
    const out = [];
    for (const [type, map] of Object.entries(this.data.entities)) for (const [id, r] of Object.entries(map)) if (r.seq > seq) out.push({ seq: r.seq, type, id, rev: r.rev, deleted: r.deleted, data: r.data });
    out.sort((a, b) => a.seq - b.seq);
    return { changes: out.slice(0, limit), more: out.length > limit };
  }
  list(type) { return Object.entries(this.data.entities[type] || {}).filter(([, r]) => !r.deleted).map(([id, r]) => ({ id, rev: r.rev, updatedAt: r.updatedAt, ...r.data })); }

  /* --- médias --- */
  mediaPath(id) { return path.join(this.mediaDir, id.replace(/[^\w.-]/g, '_')); }
  putMedia(id, bytes, meta) { fs.writeFileSync(this.mediaPath(id), bytes); fs.writeFileSync(this.mediaPath(id) + '.json', JSON.stringify(meta)); }
  getMedia(id) {
    const p = this.mediaPath(id);
    if (!fs.existsSync(p)) return null;
    return { bytes: fs.readFileSync(p), meta: JSON.parse(fs.readFileSync(p + '.json', 'utf8')) };
  }
}
