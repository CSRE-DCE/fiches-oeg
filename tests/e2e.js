/* Test de bout en bout dans Chromium (Playwright), avec un faux Google Drive simulé.
 * Couvre les scénarios qui faisaient perdre des fiches aux agents :
 *  A. migration automatique des fiches de localStorage vers IndexedDB ;
 *  B. stockage de gros volumes (photos) ;
 *  C. « Récupérer l'historique » : fusion selon la date de modification, copies de conflit ;
 *  D. envoi automatique quand une autre tablette a modifié la même fiche ;
 * plus la navigation entre onglets et le chargement des images.
 * Usage : npm run test:e2e   (après npm install && npx playwright install chromium)
 */
const { chromium } = require('playwright');
const http=require('http'),fs=require('fs'),path=require('path');
const ROOT=path.join(__dirname,'..');
const TYPES={'.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.html':'text/html'};
const srv=http.createServer((q,s)=>{let p=path.join(ROOT,decodeURIComponent(q.url.split('?')[0]));if(p.endsWith('/'))p+='index.html';fs.readFile(p,(e,d)=>{if(e){s.writeHead(404);return s.end()}s.writeHead(200,{'Content-Type':TYPES[path.extname(p)]||'application/octet-stream'});s.end(d)})}).listen(8765);
const ok=(c,m)=>{console.log((c?'PASS ':'FAIL ')+m);if(!c)process.exitCode=1};
const rec=(id,upd,extra={})=>({id,network:'RCO',station:'ST'+id,date:'2026-10-01',savedAt:upd,lifecycle:{status:'À contrôler',version:1,createdAt:upd,updatedAt:upd},auditRefs:[],photos:[],...extra});
(async()=>{
  const browser=await chromium.launch(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{});
  const ctx=await browser.newContext({serviceWorkers:'block'});
  // fake Drive
  const drive=new Map();let nid=1;
  await ctx.route('https://unpkg.com/**',r=>r.abort());
  await ctx.route('https://accounts.google.com/**',r=>r.fulfill({contentType:'text/javascript',body:'window.google={accounts:{oauth2:{initTokenClient:o=>({requestAccessToken(){this.callback({access_token:"tok",expires_in:3600})}})}}}'}));
  await ctx.route('https://www.googleapis.com/**',async r=>{
    const u=new URL(r.request().url()),m=r.request().method();
    const body=r.request().postData()||'';
    const part=()=>{const parts=body.split(/--oegboundary[^\r\n]*/);const meta=JSON.parse(parts[1].split('\r\n\r\n')[1]);const txt=parts[2].split('\r\n\r\n').slice(1).join('\r\n\r\n').replace(/\r\n$/,'');return {meta,txt}};
    if(m==='GET'&&u.pathname==='/drive/v3/files')return r.fulfill({json:{files:[...drive].map(([id,f])=>({id,name:f.name,version:String(f.v)}))}});
    let mm;
    if(m==='GET'&&(mm=u.pathname.match(/^\/drive\/v3\/files\/(.+)$/))){const f=drive.get(mm[1]);if(u.searchParams.get('alt')==='media')return r.fulfill({body:f.text,contentType:'application/json'});return r.fulfill({json:{version:String(f.v)}})}
    if(m==='POST'&&u.pathname.startsWith('/upload')){const {meta,txt}=part();const id='f'+(nid++);drive.set(id,{name:meta.name,text:txt,v:1});return r.fulfill({json:{id,version:'1'}})}
    if(m==='PATCH'&&(mm=u.pathname.match(/files\/(.+)$/))){const {meta,txt}=part();const f=drive.get(mm[1]);f.name=meta.name;f.text=txt;f.v++;return r.fulfill({json:{id:mm[1],version:String(f.v)}})}
    r.fulfill({status:500});
  });
  const page=await ctx.newPage();
  const errs=[];page.on('pageerror',e=>errs.push(e.message));
  await page.goto('http://localhost:8765/');
  // --- Navigation et images ---
  for(const t of ['list','suivi','quality','data','stations','crt','dashboard','new']){
    await page.click(`.tab[data-tab="${t}"]`);
    ok(await page.evaluate(t=>document.getElementById(t).classList.contains('active')&&document.querySelectorAll('.view.active').length===1,t),`onglet « ${t} » affiché seul`);
  }
  ok(await page.evaluate(()=>getComputedStyle(document.getElementById('bar')).display)==='flex','barre d’enregistrement visible sur la nouvelle fiche');
  const broken=await page.evaluate(()=>[...document.images].filter(i=>i.getAttribute('src')&&!i.getAttribute('src').startsWith('data:')&&i.complete&&i.naturalWidth===0).map(i=>i.getAttribute('src')));
  ok(broken.length===0,'images chargées '+JSON.stringify(broken));
  ok(/build \d+/.test(await page.evaluate(()=>window.APP_BUILD)),'numéro de version affiché : '+await page.evaluate(()=>window.APP_BUILD));
  // --- A: migration ---
  await page.evaluate(r=>{localStorage.setItem('oeg_field_v7',JSON.stringify(r));localStorage.setItem('oeg_sync_drive_cfg_v1',JSON.stringify({clientId:'x',folderId:'F',connected:true}))},
    [rec('1','2026-10-01T08:00:00.000Z'),rec('2','2026-10-01T08:00:00.000Z'),rec('3','2026-10-01T08:00:00.000Z'),rec('4','2026-10-01T08:00:00.000Z')]);
  await page.reload();await page.evaluate(()=>window.OEGRecordsReady);
  ok(await page.evaluate(()=>records.length)===4,'migration : 4 fiches chargées');
  ok(await page.evaluate(()=>localStorage.getItem('oeg_field_v7'))===null,'migration : localStorage libéré');
  ok((await page.evaluate(()=>OEGStore.get('oeg_field_v7'))).length===4,'migration : 4 fiches dans IndexedDB');
  ok(await page.$eval('#count',e=>e.textContent)==='4','compteur affiché = 4');
  // --- B: gros volume (photos) ---
  await page.evaluate(()=>{const big='data:image/jpeg;base64,'+'A'.repeat(500000);for(let i=0;i<30;i++)records.push({id:'big'+i,network:'EL',station:'B',date:'2026-10-02',savedAt:new Date().toISOString(),lifecycle:{status:'À contrôler',updatedAt:new Date().toISOString()},photos:[{data:big,group:'Amont'}]});return saveLS(LS,records)});
  await page.waitForTimeout(1500);
  await page.reload();await page.evaluate(()=>window.OEGRecordsReady);
  ok(await page.evaluate(()=>records.length)===34,'15 Mo de photos : 34 fiches toujours là après rechargement');
  await page.evaluate(()=>{records=records.filter(r=>!r.id.startsWith('big'));saveLS(LS,records)});
  // --- C: fusion Drive ---
  const res0=await page.evaluate(()=>OEGSync.manualSyncNow());
  await page.waitForTimeout(2500);
  const byRid=()=>{const m={};for(const [fid,f] of drive){if(f.name.startsWith('fiche_')){const r=JSON.parse(f.text);m[r.id]=fid}}return m};
  const fids=byRid();ok(Object.keys(fids).length===4,'envoi initial : 4 fiches sur Drive');
  const setRemote=(id,upd,comment)=>{const f=drive.get(fids[id]);const r=JSON.parse(f.text);r.lifecycle.updatedAt=upd;r.comment=comment;f.text=JSON.stringify(r);f.v++};
  setRemote('1','2026-10-05T10:00:00.000Z','modif tablette B');           // distant plus récent, local intact -> remplacé
  setRemote('2','2026-10-05T10:00:00.000Z','modif tablette B');           // conflit : distant plus récent + local modifié
  setRemote('3','2026-10-03T10:00:00.000Z','modif ancienne tablette B');  // conflit : local plus récent + distant modifié
  drive.set('fNEW',{name:'fiche_new.json',v:1,text:JSON.stringify(rec('9','2026-10-04T00:00:00.000Z'))});
  await page.evaluate(()=>{const g=id=>records.find(r=>r.id===id);
    g('2').comment='modif locale';g('2').lifecycle.updatedAt='2026-10-04T10:00:00.000Z';
    g('3').comment='modif locale récente';g('3').lifecycle.updatedAt='2026-10-06T10:00:00.000Z';
    g('4').comment='modif locale seule';g('4').lifecycle.updatedAt='2026-10-06T10:00:00.000Z';});
  const res=await page.evaluate(()=>OEGSync.pullFromDrive());
    const st=await page.evaluate(()=>records.map(r=>({id:r.id,c:r.comment,cf:r.conflict&&r.conflict.originalId})));
  const g=id=>st.find(r=>r.id===id);
  ok(g('1').c==='modif tablette B','fiche 1 : version Drive plus récente adoptée');
  ok(g('2').c==='modif tablette B'&&st.some(r=>r.cf==='2'&&r.c==='modif locale'),'fiche 2 : Drive adopté + copie de la saisie locale conservée');
  ok(g('3').c==='modif locale récente'&&st.some(r=>r.cf==='3'&&r.c==='modif ancienne tablette B'),'fiche 3 : locale gardée + copie de la version Drive');
  ok(g('4').c==='modif locale seule'&&!st.some(r=>r.cf==='4'),'fiche 4 : locale gardée, pas de copie inutile');
  ok(!!g('9'),'fiche 9 : nouvelle fiche importée');
  ok(res.conflicts===2,'2 conflits signalés');
  await page.click('.tab[data-tab="list"]');
  ok((await page.textContent('#records')).includes('Copie de conflit'),'liste : avertissement de conflit visible');
  // re-sync puis 2e pull : stable, aucune nouvelle copie
  await page.evaluate(()=>OEGSync.manualSyncNow());
  const res2=await page.evaluate(()=>OEGSync.pullFromDrive());
  ok(res2.conflicts===0&&res2.updated===0,'2e récupération : stable, aucun nouveau conflit '+JSON.stringify(res2));
  const n=await page.evaluate(()=>records.length);
  await page.reload();await page.evaluate(()=>window.OEGRecordsReady);
  ok(await page.evaluate(()=>records.length)===n,'après rechargement : '+n+' fiches conservées');
  // --- D : envoi automatique, deux tablettes sans "Récupérer l'historique" ---
  await page.evaluate(()=>OEGSync.manualSyncNow());
  const fids2=byRid();
  const remoteOf=id=>JSON.parse(drive.get(fids2[id]).text);
  const bump=(id,upd,comment)=>{const f=drive.get(fids2[id]);const r=JSON.parse(f.text);r.lifecycle.updatedAt=upd;r.comment=comment;f.text=JSON.stringify(r);f.v++};
  bump('1','2026-10-07T10:00:00.000Z','tablette B (récente)');
  bump('4','2026-10-06T12:00:00.000Z','tablette B (ancienne)');
  await page.evaluate(()=>{const g=id=>records.find(r=>r.id===id);
    g('1').comment='tablette A (ancienne)';g('1').lifecycle.updatedAt='2026-10-07T09:00:00.000Z';
    g('4').comment='tablette A (récente)';g('4').lifecycle.updatedAt='2026-10-07T12:00:00.000Z';
    g('9').comment='tablette A seule';g('9').lifecycle.updatedAt='2026-10-07T12:00:00.000Z';
    saveLS(LS,records)});
  await page.waitForTimeout(6000);
  const texts=[...drive.values()].filter(f=>f.name.startsWith('fiche_')).map(f=>JSON.parse(f.text).comment);
  ok(remoteOf('1').comment==='tablette B (récente)','D fiche 1 : version récente de B NON écrasée sur Drive');
  ok(texts.includes('tablette A (ancienne)'),'D fiche 1 : saisie de A conservée (copie envoyée sur Drive)');
  ok(remoteOf('4').comment==='tablette A (récente)','D fiche 4 : version récente de A envoyée');
  ok(texts.includes('tablette B (ancienne)'),'D fiche 4 : saisie de B conservée (copie sur Drive)');
  ok(texts.includes('tablette A seule'),'D fiche 9 : envoi normal sans conflit');
  const st2=await page.evaluate(()=>records.map(r=>({id:r.id,c:r.comment,cf:r.conflict&&r.conflict.originalId})));
  ok(st2.find(r=>r.id==='1').c==='tablette B (récente)'&&!st2.some(r=>r.cf==='9'),'D : état local cohérent');
  const nFiles=drive.size;await page.evaluate(()=>OEGSync.manualSyncNow());await page.waitForTimeout(2000);
  ok(drive.size===nFiles,'D : stable, pas de boucle ni de nouvelle copie');
  ok(errs.length===0,'aucune erreur JavaScript '+JSON.stringify(errs));
  // --- F : confort terrain (indicateur, contrôles de saisie, fin de journée) ---
  {
    const c3=await browser.newContext({serviceWorkers:'block',acceptDownloads:true});
    await c3.route('https://unpkg.com/**',r=>r.abort());
    const p=await c3.newPage();const e3=[];p.on('pageerror',e=>e3.push(e.message));
    const dialogs=[];let answer=false;
    p.on('dialog',async d=>{dialogs.push(d.type()+':'+d.message());answer?await d.accept():await d.dismiss()});
    await p.goto('http://localhost:8765/');await p.evaluate(()=>window.OEGRecordsReady);
    await p.waitForFunction(()=>!/…/.test(document.getElementById('backupPill').textContent));
    ok((await p.textContent('#backupPill')).includes('non configurée'),'indicateur : sauvegarde non configurée signalée');
    await p.click('#networks .chip[data-n="RCO"]');
    for(const id of ['session','activity','station'])await p.evaluate(id=>{const s=document.getElementById(id);s.value=[...s.options].find(o=>o.value).value;s.dispatchEvent(new Event('change',{bubbles:true}))},id);
    await p.fill('#iv_ph','75');
    ok((await p.textContent('#ivs_ph')).includes('impossible'),'pH 75 signalé impossible en direct');
    await p.fill('#iv_ph','8.6');
    ok((await p.textContent('#ivs_ph')).includes('✓'),'pH 8.6 accepté (pas de plage de référence pH/température)');
    await p.fill('#iv_temp','35');
    ok((await p.textContent('#ivs_temp')).includes('✓'),'température 35 °C acceptée');
    await p.fill('#iv_temp','');
    await p.fill('#date','');
    await p.click('#save');await p.waitForTimeout(300);
    ok(dialogs.at(-1)?.startsWith('alert:')&&dialogs.at(-1).includes('Date de la visite')&&await p.evaluate(()=>records.length)===0,'date manquante : enregistrement bloqué');
    await p.fill('#date','2026-10-08');for(const n of [1,2,3])await p.fill('#iv_turb_'+n,'12');
    await p.click('#save');await p.waitForTimeout(300);
    ok(dialogs.at(-1)?.startsWith('confirm:')&&dialogs.at(-1).includes('Préleveur(s)')&&!dialogs.at(-1).includes('pH')&&await p.evaluate(()=>records.length)===0,'champs recommandés manquants : confirmation demandée (sans mention du pH), refus = pas d’enregistrement');
    answer=true;
    await p.evaluate(()=>{const b=document.getElementById('save');b.click();b.click();b.click()});
    await p.waitForTimeout(1500);
    ok(await p.evaluate(()=>records.length)===1,'triple appui sur Enregistrer : une seule fiche créée');
    ok(await p.evaluate(()=>document.querySelectorAll('.fieldMissing').length)===0,'après enregistrement : plus aucun champ surligné');
    await p.click('#networks .chip[data-n="RCO"]');
    for(const id of ['session','activity','station'])await p.evaluate(id=>{const s=document.getElementById(id);s.value=[...s.options].find(o=>o.value).value;s.dispatchEvent(new Event('change',{bubbles:true}))},id);
    await p.fill('#iv_ph','6.8');await p.waitForTimeout(3500);
    const draft=await p.evaluate(()=>OEGStore.get('oeg_draft_v1'));
    ok(draft?.record?.insitu?.ph?.value==='6.8','brouillon : une mesure in situ saisie est bien enregistrée');
    await p.click('.tab[data-tab="data"]');
    ok(!await p.isVisible('#iv_ph'),'onglet Données : la fiche en cours n’apparaît plus dessous');
    await p.click('.tab[data-tab="list"]');await p.click('#records .listcard button');
    ok(await p.evaluate(()=>document.getElementById('new').classList.contains('active'))&&await p.isVisible('#iv_ph')&&await p.inputValue('#iv_ph')==='8.6','liste → Modifier : ouvre la fiche dans l’onglet de saisie');
    await p.click('.tab[data-tab="data"]');
    const dl=p.waitForEvent('download',{timeout:10000});
    await p.click('#endOfDayBtn');
    const file=await dl.catch(()=>null);
    ok(!!file&&/sauvegarde_OEG_.*\.json$/.test(file.suggestedFilename()),'fin de journée : export JSON téléchargé');
    ok((await p.textContent('#endOfDayResult')).includes('Aucune sauvegarde automatique'),'fin de journée : absence de sauvegarde configurée signalée');
    ok(e3.length===0,'aucune erreur JavaScript (terrain) '+JSON.stringify(e3));
    await c3.close();
  }
  // --- E : service worker réel (version.js, cache hors-ligne) ---
  const ctx2=await browser.newContext();
  await ctx2.route('https://unpkg.com/**',r=>r.abort());
  const p2=await ctx2.newPage();const errs2=[];p2.on('pageerror',e=>errs2.push(e.message));
  await p2.goto('http://localhost:8765/');
  await p2.evaluate(()=>navigator.serviceWorker.ready);
  await p2.waitForFunction(()=>!!navigator.serviceWorker.controller,null,{timeout:10000}).catch(()=>{});
  await p2.waitForLoadState('load');
  const cacheInfo=await p2.evaluate(async()=>{const keys=await caches.keys();const c=await caches.open('oeg-build-'+self.OEG_BUILD);return {keys,logo:!!await c.match('./img/logo-oeg.png'),version:!!await c.match('./version.js')}});
  ok(cacheInfo.keys.length===1&&cacheInfo.keys[0]==='oeg-build-'+await p2.evaluate(()=>self.OEG_BUILD),'cache nommé d’après version.js '+JSON.stringify(cacheInfo.keys));
  ok(cacheInfo.logo&&cacheInfo.version,'logo et version.js disponibles hors-ligne');
  await ctx2.setOffline(true);
  await p2.reload();
  ok(await p2.evaluate(()=>!!document.getElementById('count')&&/build/.test(window.APP_BUILD)),'l’appli s’ouvre hors-ligne');
  ok(errs2.length===0,'aucune erreur JavaScript (service worker) '+JSON.stringify(errs2));
  await ctx2.close();
  await browser.close();srv.close();
})();
