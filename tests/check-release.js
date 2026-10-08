/* Vérifications statiques avant publication (lancées par GitHub Actions à chaque pull request).
 * Elles détectent les erreurs qui cassaient l'appli sur les tablettes :
 *  - erreur de syntaxe dans un fichier JavaScript (ou un script intégré à index.html) ;
 *  - fichier référencé par index.html absent, ou oublié dans le cache hors-ligne (sw.js) ;
 *  - fichiers de l'appli modifiés SANS incrémenter OEG_BUILD dans version.js (les tablettes
 *    resteraient alors sur l'ancienne version) ;
 *  - identifiant HTML en double (un getElementById ne trouverait que le premier).
 * Usage : node tests/check-release.js   (variable BASE_REF = branche de comparaison, optionnelle)
 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const { execFileSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const errors = [];
const fail = m => errors.push(m);

// 1) Syntaxe des fichiers JavaScript
const jsFiles = ['sw.js', 'version.js', ...fs.readdirSync(path.join(ROOT, 'js')).filter(f => f.endsWith('.js')).map(f => 'js/' + f)];
for (const f of jsFiles) {
  try { execFileSync(process.execPath, ['--check', path.join(ROOT, f)], { stdio: 'pipe' }); }
  catch (e) { fail(`Erreur de syntaxe dans ${f} :\n${String(e.stderr || e.message).trim()}`); }
}

// 2) Scripts intégrés dans index.html
const html = read('index.html');
let n = 0;
for (const m of html.matchAll(/<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/g)) {
  n++;
  if (/type="module"/.test(m[1])) continue;
  try { new vm.Script(m[2], { filename: `index.html (script intégré n°${n})` }); }
  catch (e) { fail(`Erreur de syntaxe dans le script intégré n°${n} de index.html : ${e.message}`); }
}

// 3) Fichiers référencés par index.html : présents et dans le cache hors-ligne
const sw = read('sw.js');
const shellMatch = sw.match(/const APP_SHELL\s*=\s*\[([\s\S]*?)\]/);
if (!shellMatch) fail('APP_SHELL introuvable dans sw.js');
const shell = shellMatch ? [...shellMatch[1].matchAll(/'([^']+)'/g)].map(m => m[1].replace(/^\.\//, '')) : [];
for (const f of shell) if (f && !fs.existsSync(path.join(ROOT, f))) fail(`sw.js met en cache "${f}", qui n'existe pas`);
const refs = [...html.matchAll(/\b(?:src|href)="([^"#?]+)"/g)].map(m => m[1])
  .filter(u => !/^(https?:|data:|mailto:|tel:|javascript:|\/\/)/.test(u));
for (const u of new Set(refs)) {
  if (!fs.existsSync(path.join(ROOT, u))) fail(`index.html référence "${u}", qui n'existe pas`);
  else if (!shell.includes(u)) fail(`"${u}" est utilisé par index.html mais absent de APP_SHELL dans sw.js (indisponible hors-ligne)`);
}
for (const f of jsFiles.filter(f => f.startsWith('js/'))) if (!shell.includes(f)) fail(`${f} absent de APP_SHELL dans sw.js`);

// 4) Identifiants HTML en double
const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]);
const dup = [...new Set(ids.filter((x, i) => ids.indexOf(x) !== i))];
if (dup.length) fail('Identifiants HTML en double dans index.html : ' + dup.join(', '));

// 5) Numéro de version
const ctx = { self: {} }; vm.runInNewContext(read('version.js'), ctx);
if (!Number.isInteger(ctx.self.OEG_BUILD)) fail('version.js : OEG_BUILD doit être un nombre entier');
const base = process.env.BASE_REF;
if (base) {
  const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8' });
  const changed = git('diff', '--name-only', `${base}...HEAD`).split('\n').filter(Boolean);
  const appChanged = changed.filter(f => f === 'index.html' || f === 'styles.css' || f === 'sw.js' || f === 'manifest.json' || f.startsWith('js/') || f.startsWith('img/'));
  if (appChanged.length) {
    let baseBuild = null;
    try { const c = { self: {} }; vm.runInNewContext(git('show', `${base}:version.js`), c); baseBuild = c.self.OEG_BUILD; } catch (e) { /* version.js absent de la base */ }
    if (baseBuild !== null && !(ctx.self.OEG_BUILD > baseBuild))
      fail(`Fichiers de l'appli modifiés (${appChanged.join(', ')}) mais OEG_BUILD n'a pas été incrémenté dans version.js (actuel : ${ctx.self.OEG_BUILD}, base : ${baseBuild})`);
  }
}

if (errors.length) {
  console.error('❌ ' + errors.length + ' problème(s) :\n\n' + errors.map(e => '• ' + e).join('\n'));
  process.exit(1);
}
console.log(`✅ Vérifications OK — ${jsFiles.length} fichiers JS, ${n} scripts intégrés, ${shell.length} fichiers en cache, build ${ctx.self.OEG_BUILD}`);
