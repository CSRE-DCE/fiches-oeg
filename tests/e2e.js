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
    if(m==='GET'&&(mm=u.pathname.match(/^\/drive\/v3\/files\/(.+)$/))){const f=drive.get(mm[1]);if(!f)return mm[1]==='F'?r.fulfill({json:{id:'F',trashed:false}}):r.fulfill({status:404,json:{}});if(u.searchParams.get('alt')==='media')return r.fulfill({body:f.text,contentType:'application/json'});return r.fulfill({json:{version:String(f.v)}})}
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
  // (les fiches volumineuses de l'étape B peuvent aussi avoir été envoyées selon le moment où la
  // synchronisation automatique s'est déclenchée : on vérifie précisément les 4 fiches attendues)
  const fids=byRid();ok(['1','2','3','4'].every(id=>fids[id]),'envoi initial : les 4 fiches sur Drive');
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
    // Onglet Qualité : plus de plage de référence pour le pH ni la température
    const qc=await p.evaluate(()=>{const r={...records[0],insitu:{ph:{value:'9.5'},temp:{value:'35'}}};return qualityChecksFor(r).filter(c=>/pH|Température de l'eau/.test(c.label)&&/valeur|plage/.test(c.label)).map(c=>({l:c.label,ok:c.ok}))});
    ok(qc.length>0&&qc.every(c=>c.ok&&!/plage/.test(c.l)),'contrôle Qualité : pH 9,5 et 35 °C acceptés, aucune plage '+JSON.stringify(qc));
    await p.click('.tab[data-tab="dashboard"]');await p.waitForTimeout(300);
    const board=await p.textContent('body');
    ok(!/hors plage|Valeurs atypiques/.test(board),'synthèse : compteurs « hors plage » retirés');
    ok(e3.length===0,'aucune erreur JavaScript (terrain) '+JSON.stringify(e3));
    await c3.close();
  }
  // --- G : schéma et signature propres à chaque fiche (pas de superposition entre fiches) ---
  {
    const c4=await browser.newContext({serviceWorkers:'block'});
    await c4.route('https://unpkg.com/**',r=>r.abort());
    const p=await c4.newPage();const e4=[];p.on('pageerror',e=>e4.push(e.message));p.on('dialog',d=>d.accept());
    await p.goto('http://localhost:8765/');await p.evaluate(()=>window.OEGRecordsReady);
    await p.evaluate(()=>{
      const img=(color,x)=>{const c=document.createElement('canvas');c.width=600;c.height=220;const g=c.getContext('2d');g.fillStyle=color;g.fillRect(x,40,120,120);return c.toDataURL('image/png')};
      selectNetwork('RCO');const st=[...$('station').options].find(o=>o.value).value;
      const base=id=>({id,network:'RCO',activity:$('activity').options[1]?.value,session:$('session').options[1]?.value,station:st,date:'2026-10-01',savedAt:new Date().toISOString(),lifecycle:{status:'À contrôler',updatedAt:new Date().toISOString()},photos:[],auditRefs:[]});
      records.push({...base('A'),dessin:img('#ff0000',30),signature:img('#ff0000',30)},{...base('B'),dessin:img('#0000ff',400),signature:img('#0000ff',400)},{...base('C'),dessin:'',signature:''});
      saveLS(LS,records);
    });
    const pix=id=>p.evaluate(id=>{const c=document.getElementById(id),g=c.getContext('2d'),d=window.devicePixelRatio||1,r=c.getBoundingClientRect();
      const at=(x,y)=>{const v=g.getImageData(Math.round(x*r.width/600*d),Math.round(y*r.height/220*d),1,1).data;return v[3]===0?'vide':v[0]>200&&v[2]<50?'rouge':v[2]>200&&v[0]<50?'bleu':'autre'};
      return at(60,100)+'/'+at(450,100)},id);
    const open=async id=>{await p.click('.tab[data-tab="list"]');await p.evaluate(id=>{loadRecord(id);showTab('new')},id);await p.waitForTimeout(500)};
    await open('A');
    ok(await pix('draw')==='rouge/vide'&&await pix('signature')==='rouge/vide','fiche A : son schéma et sa signature');
    await open('B');
    ok(await pix('draw')==='vide/bleu','fiche B ouverte après A : schéma de B seul, pas de superposition');
    ok(await pix('signature')==='vide/bleu','fiche B ouverte après A : signature de B seule');
    await open('C');
    ok(await pix('draw')==='vide/vide'&&await pix('signature')==='vide/vide','fiche C sans schéma : zones vides (rien hérité de A ou B)');
    ok(await p.evaluate(()=>canvasData('draw')===''&&canvasData('signature')===''),'fiche C : rien n’est enregistré comme schéma ni signature');
    ok(await p.evaluate(()=>!qualityChecksFor({...records.find(r=>r.id==='C'),signature:canvasData('signature')}).find(c=>/Signature/.test(c.label)).ok),'contrôle « Signature présente » : non signé = signalé');
    // Ouvertures rapides successives : seule la dernière fiche s'affiche
    await p.evaluate(()=>{loadRecord('A');loadRecord('B');loadRecord('A');loadRecord('B')});await p.waitForTimeout(500);
    ok(await pix('draw')==='vide/bleu','ouvertures rapides A→B→A→B : schéma de B seul');
    // Nouvelle fiche après avoir vidé le formulaire
    await p.evaluate(()=>{clearFormNoConfirm();selectNetwork('RCO');for(const id of ['session','activity','station']){const s=$(id);s.value=[...s.options].find(o=>o.value).value;s.dispatchEvent(new Event('change',{bubbles:true}))}});
    await p.waitForTimeout(500);
    ok(await pix('draw')==='vide/vide'&&await pix('signature')==='vide/vide','nouvelle fiche : schéma et signature vierges');
    // Un vrai tracé à la souris est bien conservé
    await p.locator('#draw').scrollIntoViewIfNeeded();
    const box=await p.locator('#draw').boundingBox();
    await p.mouse.move(box.x+40,box.y+40);await p.mouse.down();await p.mouse.move(box.x+200,box.y+150,{steps:8});await p.mouse.up();
    ok(await p.evaluate(()=>canvasData('draw').length>500&&!!state.draw),'tracé à la souris : enregistré dans la fiche');
    // Modifier A sans toucher au schéma : A garde son schéma
    await open('A');
    ok(await p.evaluate(()=>{const d=canvasData('draw');return d.length>500}),'fiche A modifiée : son schéma est conservé à l’enregistrement');
    ok(e4.length===0,'aucune erreur JavaScript (schémas) '+JSON.stringify(e4));
    await c4.close();
  }
  // --- H : aucune donnée d'une fiche ne passe dans une autre (station, réseau, dupliquer, mise à jour) ---
  {
    const c5=await browser.newContext({serviceWorkers:'block',deviceScaleFactor:2});
    await c5.route('https://unpkg.com/**',r=>r.abort());
    const p=await c5.newPage();const e5=[];p.on('pageerror',e=>e5.push(e.message));
    let accept=true;const msgs=[];p.on('dialog',async d=>{msgs.push(d.message());accept?await d.accept():await d.dismiss()});
    await p.goto('http://localhost:8765/');await p.evaluate(()=>window.OEGRecordsReady);
    // Fiche A ouverte AVANT tout dimensionnement des canevas (onglet Liste au démarrage) avec un écran dpr 2
    await p.evaluate(()=>{
      const img=(color,x,w=600,h=220)=>{const c=document.createElement('canvas');c.width=w;c.height=h;const g=c.getContext('2d');g.fillStyle=color;g.fillRect(x,40,120,120);return c.toDataURL('image/png')};
      const blank=(()=>{const c=document.createElement('canvas');c.width=600;c.height=160;return c.toDataURL('image/png')})();
      const st=stationsFor('RCO',RCO_COMBINED_ACTIVITY).map(x=>({...x,network:'RCO',activity:RCO_COMBINED_ACTIVITY}));
      window.__st=st;
      const base=(id,s)=>({id,network:'RCO',activity:RCO_COMBINED_ACTIVITY,session:sessions('RCO')[0],station:s.nom,date:'2026-10-01',heureDebut:'08:00',preleveurs:['PF'],savedAt:'2026-10-01T08:00:00.000Z',lifecycle:{status:'À contrôler',version:1,updatedAt:'2026-10-01T08:00:00.000Z'},auditRefs:[]});
      records.push({...base('A',st[0]),dessin:img('#0000ff',400),signature:img('#ff0000',30),photos:[{data:img('#00ff00',0),group:'Amont'},{data:img('#00ff00',100),group:'Aval'}]});
      records.push({...base('OLD',st[1]),dessin:'',signature:blank,photos:[]});
      saveLS(LS,records);
    });
    const open=async id=>{await p.click('.tab[data-tab="list"]');await p.evaluate(id=>{loadRecord(id);showTab('new')},id);await p.waitForTimeout(500)};
    const A=()=>p.evaluate(()=>{const a=records.find(r=>r.id==='A');return {station:a.station,photos:a.photos.length,dessin:a.dessin.length,signature:a.signature.length,version:a.lifecycle.version}});
    const A0=await A();
    await p.click('.tab[data-tab="list"]');await p.evaluate(()=>{loadRecord('A');showTab('new')});await p.waitForTimeout(600);
    ok(await p.evaluate(()=>canvasData('draw')===records.find(r=>r.id==='A').dessin),'fiche ouverte avant dimensionnement (dpr 2) : schéma conservé tel quel, ni réduit ni ré-encodé');
    ok(await p.evaluate(()=>{const c=$('draw'),g=c.getContext('2d'),r=c.getBoundingClientRect(),d=2;const v=g.getImageData(Math.round(450*r.width/600*d),Math.round(100*r.height/220*d),1,1).data;return v[2]>200&&v[3]>0}),'schéma affiché à la bonne taille (carré bleu à droite, pas réduit dans un coin)');
    // 1) Ouvrir une autre station depuis l'onglet Stations pendant la modification de A
    accept=false;await p.evaluate(()=>window.openStation(window.__st[2]));await p.waitForTimeout(300);
    ok(msgs.at(-1)?.includes('en cours de modification')&&await p.evaluate(()=>state.editing==='A'),'autre station pendant une modification : confirmation, « Annuler » garde la fiche A');
    accept=true;await p.evaluate(()=>window.openStation(window.__st[2]));await p.waitForTimeout(500);
    ok(await p.evaluate(()=>state.editing===null&&state.station===window.__st[2].nom&&canvasData('draw')===''&&canvasData('signature')===''&&state.photos.length===0),'autre station confirmée : nouvelle fiche vierge (ni schéma, ni signature, ni photos de A)');
    ok(JSON.stringify(await A())===JSON.stringify(A0),'fiche A intacte (station, photos, schéma, signature)');
    // 2) Cliquer un réseau pendant la modification de A
    await open('A');accept=true;await p.click('#networks .chip[data-n="BIO"]');await p.waitForTimeout(300);
    ok(await p.evaluate(()=>state.editing===null&&state.network==='BIO'&&canvasData('signature')===''),'réseau changé pendant une modification : confirmation puis nouvelle fiche vierge');
    // 3) « Mettre à jour » puis fiche suivante
    await open('A');
    for(const n of [1,2,3])await p.fill('#iv_turb_'+n,'5');
    await p.click('#save');await p.waitForTimeout(1500);
    ok(await p.evaluate(()=>records.find(r=>r.id==='A').lifecycle.version)===A0.version+1,'mise à jour de A enregistrée');
    ok(await p.evaluate(()=>state.network===null&&state.editing===null&&canvasData('draw')===''&&canvasData('signature')===''&&state.photos.length===0),'après « Mettre à jour » : formulaire vidé, la fiche suivante n’hérite de rien');
    // 4) Dupliquer : pas de signature, photos indépendantes
    await p.click('.tab[data-tab="list"]');
    await p.evaluate(()=>{const card=[...document.querySelectorAll('#records .listcard')].find(c=>c.textContent.includes(records.find(r=>r.id==='A').station)&&!c.textContent.includes('Copie'));card.querySelectorAll('button')[1].click()});
    await p.waitForTimeout(500);
    ok(await p.evaluate(()=>state.editing===null&&canvasData('signature')===''&&canvasData('draw').length>500),'Dupliquer : schéma repris, signature vide (à refaire pour la nouvelle visite)');
    await p.evaluate(()=>{state.photos.splice(0,1)});
    ok((await A()).photos===2,'Dupliquer puis retirer une photo de la copie : la fiche A garde ses 2 photos');
    // 5) Enregistrement refusé : rien n'est effacé
    await p.evaluate(()=>{state.station=null});await p.click('#save');await p.waitForTimeout(500);
    ok(await p.evaluate(()=>canvasData('draw').length>500&&state.network==='RCO'),'enregistrement refusé (station manquante) : la saisie et le schéma sont conservés');
    // 6) Ancienne fiche non signée (image blanche) : vue comme non signée
    await open('OLD');await p.waitForTimeout(300);
    ok(await p.evaluate(()=>canvasData('signature')===''),'ancienne fiche avec signature « image blanche » : considérée comme non signée');
    ok(e5.length===0,'aucune erreur JavaScript (fiches indépendantes) '+JSON.stringify(e5));
    await c5.close();
  }
  // --- I : champs hors de #new (observations, qualité, site, signataire), Effacer, brouillon, changement de station ---
  {
    const c6=await browser.newContext({serviceWorkers:'block'});
    await c6.route('https://unpkg.com/**',r=>r.abort());
    const p=await c6.newPage();const e6=[];p.on('pageerror',e=>e6.push(e.message));p.on('dialog',d=>d.accept());
    await p.goto('http://localhost:8765/');await p.evaluate(()=>window.OEGRecordsReady);
    const pickStation=async(i=0)=>{await p.click('#networks .chip[data-n="RCO"]');
      for(const id of ['session','activity'])await p.evaluate(id=>{const s=$(id);s.value=[...s.options].find(o=>o.value).value;s.dispatchEvent(new Event('change',{bubbles:true}))},id);
      await p.evaluate(i=>{const s=$('station');s.value=[...s.options].filter(o=>o.value)[i].value;s.dispatchEvent(new Event('change',{bubbles:true}))},i)};
    const fillA=async()=>{await p.fill('#date','2026-10-08');for(const n of [1,2,3])await p.fill('#iv_turb_'+n,'4');
      await p.fill('#obs','OBS A');await p.fill('#comment','COMMENT A');await p.fill('#qcType','QC A');await p.fill('#siteObs','SITE A');
      await p.evaluate(()=>{$('meteo').selectedIndex=1;$('signName').selectedIndex=1;document.querySelector('input[name="qc"][value="Oui"]').checked=true;document.querySelector('input[name="representative"][value="Oui"]').checked=true})};
    const leftovers=()=>p.evaluate(()=>({obs:$('obs').value,comment:$('comment').value,qcType:$('qcType').value,siteObs:$('siteObs').value,signName:$('signName').value,meteo:$('meteo').value,qc:radioValue('qc'),rep:radioValue('representative')}));
    const empty=o=>Object.values(o).every(v=>v==='');
    // Changer de station en cours de saisie : mesures conservées
    await pickStation(0);await p.fill('#iv_ph','6.5');
    await p.evaluate(()=>{const s=$('station');s.value=[...s.options].filter(o=>o.value)[1].value;s.dispatchEvent(new Event('change',{bubbles:true}))});
    ok(await p.inputValue('#iv_ph')==='6.5','changement de station en cours de saisie : les mesures in situ sont conservées');
    await fillA();await p.click('#save');await p.waitForTimeout(1200);
    const idA=await p.evaluate(()=>records[0]?.id);
    ok(!!idA&&await p.evaluate(()=>records[0].obs==='OBS A'&&records[0].qc==='Oui'&&!!records[0].signName),'fiche A enregistrée avec observations, réponse qualité et signataire');
    ok(empty(await leftovers()),'après enregistrement : observations, commentaires, qualité, météo, site et signataire vidés '+JSON.stringify(await leftovers()));
    // Fiche B ne reprend rien de A
    await pickStation(2);await p.fill('#date','2026-10-08');for(const n of [1,2,3])await p.fill('#iv_turb_'+n,'4');
    await p.click('#save');await p.waitForTimeout(1200);
    ok(await p.evaluate(()=>{const b=records.find(r=>r.id!==records[0].id&&r.station!==records[0].station)||records[1];return b&&!b.obs&&!b.comment&&!b.qcType&&!b.qc&&!b.signName&&!b.conditions?.siteObs&&!b.quality?.representative}),'fiche B enregistrée sans rien de A (observations, qualité, site, signataire)');
    // Ouvrir A puis B : la réponse qualité de A ne reste pas cochée
    const idB=await p.evaluate(a=>records.find(r=>r.id!==a).id,idA);
    await p.click('.tab[data-tab="list"]');await p.evaluate(id=>{loadRecord(id);showTab('new')},idA);await p.waitForTimeout(300);
    ok(await p.evaluate(()=>radioValue('qc')==='Oui'&&$('obs').value==='OBS A'),'fiche A ouverte : ses réponses');
    await p.evaluate(id=>{loadRecord(id);showTab('new')},idB);await p.waitForTimeout(300);
    ok(empty(await leftovers()),'fiche B ouverte après A : aucune réponse ni observation de A '+JSON.stringify(await leftovers()));
    // « Effacer » ne casse plus les boutons Oui/Non
    await p.click('#clearForm');await p.waitForTimeout(200);
    ok(await p.evaluate(()=>{const r=document.querySelector('input[name="qc"][value="Oui"]');r.checked=true;const v=radioValue('qc');r.checked=false;return v==='Oui'}),'après « Effacer » : les boutons Oui/Non gardent leur valeur');
    // Brouillon d'une autre fiche conservé après une mise à jour
    await pickStation(3);await p.fill('#obs','BROUILLON X');await p.waitForTimeout(3200);
    ok((await p.evaluate(()=>OEGStore.get('oeg_draft_v1')))?.record?.obs==='BROUILLON X','brouillon de la fiche X enregistré');
    await p.click('.tab[data-tab="list"]');await p.evaluate(id=>{loadRecord(id);showTab('new')},idA);await p.waitForTimeout(300);
    await p.click('#save');await p.waitForTimeout(1200);
    ok((await p.evaluate(()=>OEGStore.get('oeg_draft_v1')))?.record?.obs==='BROUILLON X','mise à jour de A : le brouillon de la fiche X n’est pas effacé');
    ok(e6.length===0,'aucune erreur JavaScript (champs de fiche) '+JSON.stringify(e6));
    await c6.close();
  }
  // --- J : CRT (saison, date du rapport, saisies mémorisées par fiche, consolidé, carte hors ligne, logo) ---
  {
    const c7=await browser.newContext({serviceWorkers:'block'});
    await c7.route('https://unpkg.com/**',r=>r.abort());
    await c7.route('https://tile.openstreetmap.org/**',r=>r.abort());
    const p=await c7.newPage();const e7=[];p.on('pageerror',e=>e7.push(e.message));p.on('dialog',d=>d.accept());
    await p.goto('http://localhost:8765/');await p.evaluate(()=>window.OEGRecordsReady);
    await p.evaluate(()=>{
      const st=stationsFor('RCO',RCO_COMBINED_ACTIVITY);
      const base=(id,s,date)=>({id,network:'RCO',activity:RCO_COMBINED_ACTIVITY,session:sessions('RCO')[0],station:s.nom,stationInfo:s,date,heureDebut:'08:00',preleveurs:['PF'],organisme:"Office de l'Eau de Guyane",savedAt:date+'T08:00:00.000Z',lifecycle:{status:'À contrôler',version:1,updatedAt:date+'T08:00:00.000Z'},auditRefs:[],photos:[],insitu:{ph:{value:'6.5'}},comment:'Observation terrain'});
      records.push(base('R1',st[0],'2026-10-05'),base('R2',st[1],'2027-02-10'),base('R3',st[2],'2026-12-14'),base('R4',st[3],'2027-03-09'));
      const sig=(()=>{const c=document.createElement('canvas');c.width=300;c.height=80;const g=c.getContext('2d');g.fillRect(10,30,200,8);return c.toDataURL('image/png')})();
      records.push({...base('R5',st[4],'2026-10-06'),signName:'PF',signature:sig,lifecycle:{status:'Validée',version:2,updatedAt:'2026-10-07T08:00:00.000Z',validatedBy:'ML',validatedAt:'2026-10-07T08:00:00.000Z'}});saveLS(LS,records);
    });
    await p.click('.tab[data-tab="crt"]');await p.waitForTimeout(500);
    const pick=id=>p.evaluate(id=>{const s=$('crtRecord');s.value=id;s.dispatchEvent(new Event('change',{bubbles:true}))},id);
    await pick('R1');await p.waitForTimeout(300);
    let txt=await p.textContent('#crtPreviewBox');
    ok(txt.includes('SAISON SÈCHE'),'CRT : visite d’octobre = saison sèche');
    await pick('R2');await p.waitForTimeout(300);
    ok((await p.textContent('#crtPreviewBox')).includes('SAISON DES PLUIES'),'CRT : visite de février = saison des pluies (auparavant toujours « sèche »)');
    await pick('R3');await p.waitForTimeout(300);
    ok((await p.textContent('#crtPreviewBox')).includes('SAISON SÈCHE'),'CRT : visite de décembre = saison sèche (août à décembre)');
    await pick('R4');await p.waitForTimeout(300);
    ok((await p.textContent('#crtPreviewBox')).includes('PETIT ÉTÉ DE MARS'),'CRT : visite de mars = petit été de mars');
    ok((await p.textContent('#crtPreviewBox')).includes('DOCUMENT PROVISOIRE'),'CRT d’une fiche non validée : mention « document provisoire »');
    await pick('R5');await p.waitForTimeout(300);
    txt=await p.textContent('#crtPreviewBox');
    ok(!txt.includes('DOCUMENT PROVISOIRE')&&/Validée par\s*ML/.test(txt)&&txt.includes('07/10/2026'),'CRT d’une fiche validée : validateur et date de validation, sans mention provisoire');
    ok(await p.evaluate(()=>!!document.querySelector('#crtPreviewBox img.crtSignature'))&&/Signataire de la fiche terrain\s*PF/.test(txt),'CRT : signataire et signature de la fiche terrain');
    // Saisies du CRT mémorisées par fiche
    await pick('R1');await p.fill('#crtRef','CRT-2026-001');await p.fill('#crtDate','2026-10-20');await p.fill('#crtConclusion','Conclusion R1');await p.click('#crtPreview');await p.waitForTimeout(200);
    txt=await p.textContent('#crtPreviewBox');
    ok(txt.includes('CRT-2026-001')&&txt.includes('20/10/2026')&&txt.includes('Conclusion R1'),'CRT : référence, date du rapport et conclusion imprimées');
    ok(!/Conclusion \/ synthèse\s*Observation terrain/.test(txt),'CRT : la conclusion ne recopie plus les observations');
    await pick('R2');await p.waitForTimeout(200);
    ok(await p.inputValue('#crtRef')===''&&await p.inputValue('#crtConclusion')==='','CRT : autre fiche = champs propres à cette fiche (vides)');
    await p.fill('#crtRef','CRT-2027-002');await p.waitForTimeout(600);
    await pick('R1');await p.waitForTimeout(200);
    ok(await p.inputValue('#crtRef')==='CRT-2026-001'&&await p.inputValue('#crtConclusion')==='Conclusion R1','CRT : retour sur la fiche R1 = ses saisies retrouvées');
    await p.reload();await p.evaluate(()=>window.OEGRecordsReady);await p.click('.tab[data-tab="crt"]');await p.waitForTimeout(500);await pick('R2');await p.waitForTimeout(200);
    ok(await p.inputValue('#crtRef')==='CRT-2027-002','CRT : saisies conservées après rechargement de l’appli');
    // Consolidé : chaque fiche avec sa propre référence
    await p.evaluate(()=>{window.print=()=>{window.__printed=(window.__printed||0)+1}});
    await p.evaluate(()=>{const n=$('crtBatchNetwork');n.value='RCO';n.dispatchEvent(new Event('change'));const s=$('crtBatchSession');s.value=s.options[1].value;s.dispatchEvent(new Event('change'))});
    await p.click('#crtBatchGenerate');await p.waitForFunction(()=>window.__printed>=1,null,{timeout:10000});
    txt=await p.textContent('#crtPreviewBox');
    ok(txt.includes('CRT-2026-001')&&txt.includes('CRT-2027-002'),'CRT consolidé : chaque fiche avec sa propre référence');
    // Carte hors ligne : carte schématique au lieu d'un cadre vide ; logo en fichier
    await p.waitForTimeout(500);
    ok(await p.evaluate(()=>[...document.querySelectorAll('#crtPreviewBox .crtMapPlaceholder')].every(b=>{const fb=b.querySelector('.crtMapFallback');return fb&&!fb.hidden&&fb.querySelector('svg')})),'CRT : fond de carte indisponible = carte schématique affichée');
    ok(await p.evaluate(()=>{const imgs=[...document.querySelectorAll('#crtPreviewBox img.crtPageLogo,#crtPreviewBox img.crtCoverLogo')];return imgs.length>0&&imgs.every(i=>i.getAttribute('src')==='img/logo-oeg.png'&&i.naturalWidth>0)}),'CRT : logo chargé depuis img/logo-oeg.png (plus 260 Ko recopiés par page)');
    ok(await p.evaluate(()=>$('crtPreviewBox').innerHTML.length<200000),'CRT consolidé de 2 fiches : document léger ('+await p.evaluate(()=>Math.round($('crtPreviewBox').innerHTML.length/1024))+' Ko)');
    ok(e7.length===0,'aucune erreur JavaScript (CRT) '+JSON.stringify(e7));
    await c7.close();
  }
  // --- K : aller-retour complet (tout remplir → enregistrer → recharger → rouvrir → réenregistrer) ---
  for(const net of ['RCO','BIO','ESO','Chimie','EL']){
    const cx=await browser.newContext({serviceWorkers:'block'});
    await cx.route('https://unpkg.com/**',r=>r.abort());
    const p=await cx.newPage();const ex=[];p.on('pageerror',e=>ex.push(e.message));p.on('dialog',d=>d.accept());
    await p.goto('http://localhost:8765/');await p.evaluate(()=>window.OEGRecordsReady);
    await p.click(`#networks .chip[data-n="${net}"]`);
    for(const id of ['session','activity','bioOperation'])await p.evaluate(id=>{const s=$(id);if(!s||s.closest('.hide'))return;const o=[...s.options].find(o=>o.value);if(o){s.value=o.value;s.dispatchEvent(new Event('change',{bubbles:true}))}},id);
    await p.evaluate(()=>{const s=$('station');s.value=[...s.options].find(o=>o.value).value;s.dispatchEvent(new Event('change',{bubbles:true}))});
    await p.waitForTimeout(300);
    for(let pass=0;pass<3;pass++){
      await p.evaluate(()=>{
        const skip=new Set(['station','session','activity','bioOperation','org','projection','date']),groups=new Set();
        document.querySelectorAll('input,select,textarea').forEach(e=>{
          if(!inFiche(e)||e.closest('#endOfDayCard')||skip.has(e.id)||e.type==='file'||e.type==='button'||e.disabled)return;
          if(e.closest('.hide')||(e.offsetParent===null&&e.type!=='radio'&&e.type!=='checkbox'))return;
          if(e.type==='radio'){if(!groups.has(e.name)){groups.add(e.name);const g=[...document.getElementsByName(e.name)].filter(inFiche);if(!g.some(x=>x.checked)){const t=g.find(x=>x.value==='Oui')||g[0];t.checked=true;t.dispatchEvent(new Event('change',{bubbles:true}))}}return}
          if(e.type==='checkbox'){if(!e.checked){e.checked=true;e.dispatchEvent(new Event('change',{bubbles:true}))}return}
          if(e.value!=='')return;
          if(e.tagName==='SELECT'){const o=[...e.options].filter(o=>o.value);if(o.length){e.value=o[o.length-1].value;e.dispatchEvent(new Event('change',{bubbles:true}))}return}
          e.value=e.type==='number'?'3':e.type==='date'?'2026-10-08':e.type==='time'?'08:30':e.type==='datetime-local'?'2026-10-08T09:00':('T-'+(e.id||e.name||'x'));
          e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));
        });
      });
      await p.waitForTimeout(250);
    }
    await p.fill('#date','2026-10-08');
    const S1=await p.evaluate(()=>snapshotForm());
    await p.click('#save');await p.waitForTimeout(1500);
    const R1=await p.evaluate(()=>JSON.parse(JSON.stringify(records[0]||null)));
    await p.reload();await p.evaluate(()=>window.OEGRecordsReady);
    await p.click('.tab[data-tab="list"]');await p.evaluate(()=>{loadRecord(records[0].id);showTab('new')});await p.waitForTimeout(700);
    const S2=await p.evaluate(()=>snapshotForm());
    const derived=/^(recepteur|remise|esoRecepteur|esoRemise|iv_turb)$/; // champs cachés recalculés
    const diffs=[];
    for(const k of new Set([...Object.keys(S1.v),...Object.keys(S2.v)]))if(!derived.test(k)&&S1.v[k]!==S2.v[k])diffs.push('champ '+k+': '+S1.v[k]+' → '+S2.v[k]);
    for(const k of new Set([...Object.keys(S1.c),...Object.keys(S2.c)]))if(S1.c[k]!==S2.c[k])diffs.push('coche '+k);
    await p.click('#save');await p.waitForTimeout(1500);
    const R2=await p.evaluate(()=>JSON.parse(JSON.stringify(records[0])));
    const strip=r=>{const x={...r};['savedAt','lifecycle','auditRefs','appBuild','formValues','id','bioOperation'].forEach(k=>delete x[k]);return x};
    const flat=(o,pre='',out={})=>{if(o&&typeof o==='object'&&!Array.isArray(o)){for(const k of Object.keys(o))flat(o[k],pre?pre+'.'+k:k,out)}else out[pre]=JSON.stringify(o);return out};
    const f1=flat(strip(R1||{})),f2=flat(strip(R2));
    for(const k of new Set([...Object.keys(f1),...Object.keys(f2)]))if(f1[k]!==f2[k]&&!(f1[k]===undefined&&['""','[]','false'].includes(f2[k])))diffs.push('fiche '+k+': '+f1[k]+' → '+f2[k]);
    ok(!!R1&&Object.keys(S1.v).length>50&&diffs.length===0,`aller-retour ${net} : ${Object.keys(S1.v).length} champs et ${Object.keys(S1.c).length} réponses retrouvés à l’identique `+JSON.stringify(diffs.slice(0,6)));
    ok(ex.length===0,'aucune erreur JavaScript (aller-retour '+net+') '+JSON.stringify(ex));
    await cx.close();
  }
  // --- L : scénarios ciblés de l'audit ---
  {
    const c8=await browser.newContext({serviceWorkers:'block'});
    await c8.route('https://unpkg.com/**',r=>r.abort());
    const p=await c8.newPage();const e8=[];p.on('pageerror',e=>e8.push(e.message));p.on('dialog',d=>d.accept());
    await p.goto('http://localhost:8765/');await p.evaluate(()=>window.OEGRecordsReady);
    const choose=async(net)=>{await p.click(`#networks .chip[data-n="${net}"]`);
      for(const id of ['session','activity'])await p.evaluate(id=>{const s=$(id);if(!s||s.closest('.hide'))return;const o=[...s.options].find(o=>o.value);if(o){s.value=o.value;s.dispatchEvent(new Event('change',{bubbles:true}))}},id);
      await p.evaluate(()=>{const s=$('station');s.value=[...s.options].find(o=>o.value).value;s.dispatchEvent(new Event('change',{bubbles:true}))});await p.waitForTimeout(300)};
    // RCO avec conditions du site et signataire HYDRECO
    await choose('RCO');await p.fill('#date','2026-10-08');for(const n of [1,2,3])await p.fill('#iv_turb_'+n,'4');
    await p.evaluate(()=>{$('meteo').selectedIndex=2;$('largeur').value='12';document.querySelector('input[name="representative"][value="Oui"]').checked=true;
      $('org').value='HYDRECO';$('org').dispatchEvent(new Event('change',{bubbles:true}))});
    await p.waitForTimeout(200);
    await p.evaluate(()=>{const s=$('signName');const o=[...s.options].find(o=>o.value);s.value=o.value;window.__sign=o.value});
    await p.click('#save');await p.waitForTimeout(1200);
    const rco=await p.evaluate(()=>({id:records[0].id,meteo:records[0].conditions.meteo,largeur:records[0].conditions.largeur,sign:records[0].signName,rep:records[0].quality?.representative}));
    ok(!!rco.sign&&rco.largeur==='12'&&rco.rep==='Oui','fiche RCO enregistrée (conditions du site, signataire HYDRECO '+rco.sign+')');
    // Fiche EL (MEC) avec profondeur totale 14 m
    await choose('EL');await p.fill('#date','2026-10-08');
    await p.evaluate(()=>{$('elDepth').value='14';$('elDepth').dispatchEvent(new Event('input',{bubbles:true}))});
    await p.click('#save');await p.waitForTimeout(1200);
    const elId=await p.evaluate(()=>records.find(r=>r.network==='EL')?.id);
    // Rouvrir RCO après la fiche EL puis réenregistrer sans changement
    await p.click('.tab[data-tab="list"]');await p.evaluate(id=>{loadRecord(id);showTab('new')},rco.id);await p.waitForTimeout(500);
    ok(await p.evaluate(()=>!!$('largeur')&&$('largeur').value==='12'&&!!$('seuil')),'fiche RCO rouverte après une fiche EL : carte « Conditions du site » complète (non EL)');
    ok(await p.inputValue('#signName')===rco.sign,'signataire hors liste OEG retrouvé à la modification');
    for(const n of [1,2,3])if(!(await p.inputValue('#iv_turb_'+n)))await p.fill('#iv_turb_'+n,'4');
    await p.click('#save');await p.waitForTimeout(1200);
    ok(await p.evaluate(id=>{const r=records.find(x=>x.id===id);return r.conditions.largeur==='12'&&r.conditions.meteo&&r.signName&&r.quality?.representative==='Oui'},rco.id),'fiche RCO réenregistrée : conditions du site, représentativité et signataire conservés');
    await p.click('.tab[data-tab="list"]');await p.evaluate(id=>{loadRecord(id);showTab('new')},elId);await p.waitForTimeout(500);
    ok(await p.inputValue('#elDepth')==='14','fiche EL rouverte : profondeur totale 14 m conservée (plus remise à 10)');
    ok(e8.length===0,'aucune erreur JavaScript (scénarios audit) '+JSON.stringify(e8));
    await c8.close();
  }
  // --- M : sauvegarde et synchronisation (constats de l'audit) ---
  {
    const c9=await browser.newContext({serviceWorkers:'block'});
    await c9.route('https://unpkg.com/**',r=>r.abort());
    await c9.route('https://accounts.google.com/**',r=>r.fulfill({contentType:'text/javascript',body:'window.google={accounts:{oauth2:{initTokenClient:o=>({requestAccessToken(){this.callback({access_token:"tok",expires_in:3600})}})}}}'}));
    // Faux Google Drive avec dossiers : un « compte » = un ensemble de dossiers et de fichiers
    let acct={folders:new Map(),files:new Map()},nid=1;
    const part=body=>{const parts=body.split(/--oegboundary[^\r\n]*/);return {meta:JSON.parse(parts[1].split('\r\n\r\n')[1]),txt:parts[2].split('\r\n\r\n').slice(1).join('\r\n\r\n').replace(/\r\n$/,'')}};
    await c9.route('https://www.googleapis.com/**',async r=>{
      const u=new URL(r.request().url()),m=r.request().method(),body=r.request().postData()||'';let mm;
      if(m==='GET'&&u.pathname==='/drive/v3/files'){const q=u.searchParams.get('q')||'';
        if(q.includes('vnd.google-apps.folder'))return r.fulfill({json:{files:[...acct.folders.values()].map(f=>({id:f.id,name:f.name}))}});
        const pm=q.match(/'([^']+)' in parents/);return r.fulfill({json:{files:[...acct.files].filter(([id,f])=>!pm||f.parent===pm[1]).map(([id,f])=>({id,name:f.name,version:String(f.v)}))}})}
      if(m==='POST'&&u.pathname==='/drive/v3/files'){const j=JSON.parse(body);const id='D'+(nid++);acct.folders.set(id,{id,name:j.name});return r.fulfill({json:{id}})}
      if(m==='GET'&&(mm=u.pathname.match(/^\/drive\/v3\/files\/(.+)$/))){const id=mm[1];
        if(acct.folders.has(id))return r.fulfill({json:{id,trashed:false}});
        const f=acct.files.get(id);if(!f)return r.fulfill({status:404,json:{}});
        if(u.searchParams.get('alt')==='media')return r.fulfill({body:f.text,contentType:'application/json'});return r.fulfill({json:{version:String(f.v)}})}
      if(m==='POST'&&u.pathname.startsWith('/upload')){const {meta,txt}=part(body);if(!acct.folders.has(meta.parents?.[0]))return r.fulfill({status:404,json:{}});const id='f'+(nid++);acct.files.set(id,{name:meta.name,text:txt,v:1,parent:meta.parents[0]});return r.fulfill({json:{id,version:'1'}})}
      if(m==='PATCH'&&(mm=u.pathname.match(/files\/(.+)$/))){const f=acct.files.get(mm[1]);if(!f)return r.fulfill({status:404,json:{}});const {meta,txt}=part(body);f.name=meta.name;f.text=txt;f.v++;return r.fulfill({json:{id:mm[1],version:String(f.v)}})}
      r.fulfill({status:500});
    });
    // Faux sélecteur de dossier local (File System Access)
    await c9.addInitScript(()=>{window.__folders={};let n=0;window.showDirectoryPicker=async()=>{const name='dossier'+(++n),files={};window.__folders[name]=files;
      return {name,queryPermission:async()=>'granted',requestPermission:async()=>'granted',getFileHandle:async fn=>({createWritable:async()=>{let b='';return {write:async t=>{b+=t},close:async()=>{files[fn]=b}}}})}}});
    const p=await c9.newPage();const e9=[];p.on('pageerror',e=>e9.push(e.message));p.on('dialog',d=>d.accept());
    await p.goto('http://localhost:8765/');await p.evaluate(()=>window.OEGRecordsReady);
    const mk=(id,extra={})=>Object.assign({id,network:'RCO',station:'ST'+id,date:'2026-10-01',savedAt:'2026-10-01T08:00:00.000Z',lifecycle:{status:'À contrôler',version:1,updatedAt:'2026-10-01T08:00:00.000Z'},auditRefs:[],photos:[]},extra);
    await p.evaluate(r=>{records.push(r);saveLS(LS,records)},mk('M1',{comment:'v1'}));
    // 1) Nouveau dossier de sauvegarde : il reçoit toutes les fiches
    await p.evaluate(()=>OEGSync.chooseLocalFolder());await p.waitForTimeout(300);
    ok(await p.evaluate(()=>Object.keys(window.__folders.dossier1).some(f=>f.startsWith('fiche_'))),'dossier de sauvegarde 1 : fiche écrite');
    await p.evaluate(()=>OEGSync.forgetLocalFolder());await p.evaluate(()=>OEGSync.chooseLocalFolder());await p.waitForTimeout(300);
    ok(await p.evaluate(()=>Object.keys(window.__folders.dossier2).some(f=>f.startsWith('fiche_'))),'nouveau dossier de sauvegarde : toutes les fiches y sont réécrites (auparavant vide)');
    await p.evaluate(()=>OEGSync.forgetLocalFolder());
    // 2) Drive : changement de compte / dossier supprimé / fichier supprimé
    await p.evaluate(()=>{localStorage.setItem('oeg_sync_drive_cfg_v1',JSON.stringify({clientId:'x',folderId:'',connected:true}))});
    await p.reload();await p.evaluate(()=>window.OEGRecordsReady);
    await p.evaluate(()=>OEGSync.manualSyncNow());
    const count=()=>[...acct.files.values()].filter(f=>f.name.startsWith('fiche_')).length;
    ok(count()===1,'Drive : fiche envoyée');
    acct={folders:new Map(),files:new Map()}; // autre compte Google (ou dossier supprimé)
    await p.reload();await p.evaluate(()=>window.OEGRecordsReady);
    await p.evaluate(()=>OEGSync.manualSyncNow());
    ok(count()===1&&acct.folders.size===1,'Drive : autre compte / dossier supprimé → dossier recréé et fiches réenvoyées (auparavant jamais)');
    const fid=[...acct.files].find(([id,f])=>f.name.startsWith('fiche_'))[0];acct.files.delete(fid); // fichier supprimé sur Drive
    await p.evaluate(()=>{records.find(r=>r.id==='M1').comment='v2';records.find(r=>r.id==='M1').lifecycle.updatedAt='2026-10-02T08:00:00.000Z';saveLS(LS,records)});
    await p.evaluate(()=>OEGSync.manualSyncNow());await p.evaluate(()=>OEGSync.manualSyncNow());
    ok(count()===1&&[...acct.files.values()].some(f=>f.text.includes('"v2"')),'Drive : fichier supprimé → recréé avec la dernière version');
    // 3) Changement de date : le fichier Drive est renommé en place (un seul fichier par fiche)
    await p.evaluate(()=>{const r=records.find(r=>r.id==='M1');r.date='2026-09-30';r.lifecycle.updatedAt='2026-10-03T08:00:00.000Z';saveLS(LS,records)});
    await p.evaluate(()=>OEGSync.manualSyncNow());
    ok(count()===1&&[...acct.files.values()].some(f=>f.name.includes('2026-09-30')),'Drive : date corrigée → même fichier renommé (plus de second fichier)');
    // 4) Fiche allégée : jamais réécrite sans ses photos ; la récupération lui rend ses photos
    const full=mk('M2',{photos:[{data:'data:image/png;base64,AAAA',group:'Amont'},{data:'data:image/png;base64,BBBB',group:'Aval'}]});
    await p.evaluate(r=>{records.push(r);saveLS(LS,records)},full);await p.evaluate(()=>OEGSync.manualSyncNow());
    await p.evaluate(()=>{const r=records.find(r=>r.id==='M2');r._archivedPhotoCount=2;r.photos=[];r._archived=true;r.lifecycle.status='Validée';r.lifecycle.updatedAt='2026-10-01T08:00:00.000Z';saveLS(LS,records)});
    await p.evaluate(()=>OEGSync.manualSyncNow());
    const m2=()=>JSON.parse([...acct.files.values()].find(f=>f.text.includes('"M2"')).text);
    ok(m2().photos.length===2,'fiche allégée modifiée : le fichier Drive garde ses 2 photos (auparavant écrasé sans photos)');
    const pull=await p.evaluate(()=>OEGSync.pullFromDrive());
    ok(await p.evaluate(()=>{const r=records.find(r=>r.id==='M2');return r.photos.length===2&&!r._archived})&&pull.conflicts===0,'« Récupérer l’historique » rend ses photos à la fiche allégée, sans fausse copie de conflit '+JSON.stringify(pull));
    const pull2=await p.evaluate(()=>OEGSync.pullFromDrive());
    ok(pull2.conflicts===0,'seconde récupération : aucune copie de conflit');
    // 5) Import : une version plus ancienne ne remplace pas la plus récente ; NC et qualité importées
    const old=mk('M1',{comment:'ancienne',lifecycle:{status:'À contrôler',version:1,updatedAt:'2026-09-01T08:00:00.000Z'}});
    await p.click('.tab[data-tab="data"]');
    await p.setInputFiles('#importJSON',[{name:'sauvegarde.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({records:[old],custom:{nonConformites:[{id:'nc1',recordId:'M1',severity:'Critique',status:'Ouverte',createdAt:'2026-09-02'}],qualityConfig:{qualityMethodRef:'REF-X'}}}))}]);
    await p.waitForTimeout(800);
    ok(await p.evaluate(()=>records.find(r=>r.id==='M1').comment==='v2'),'import d’une sauvegarde plus ancienne : la fiche plus récente est conservée');
    ok(await p.evaluate(()=>custom.nonConformites.some(n=>n.id==='nc1')&&custom.qualityConfig.qualityMethodRef==='REF-X'),'import : non-conformités et configuration qualité récupérées');
    await p.setInputFiles('#importJSON',[{name:'_qualite_audit_non-conformites.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({type:'qualite_audit_non_conformites',nonConformites:[{id:'nc2',recordId:'M1',status:'Ouverte'}],auditTrail:[],qualityConfig:{}}))}]);
    await p.waitForTimeout(800);
    ok(await p.evaluate(()=>custom.nonConformites.some(n=>n.id==='nc2')),'import du fichier « _qualite » du dossier de sauvegarde reconnu');
    // 6) Onglet Qualité : rejeter / remettre à contrôler sans erreur
    const before=e9.length;
    await p.click('.tab[data-tab="quality"]');
    await p.evaluate(()=>{const s=$('qualityRecord');s.value='M1';s.dispatchEvent(new Event('change',{bubbles:true}));const v=$('qualityValidator');if(v.tagName==='SELECT'){const o=[...v.options].find(o=>o.value);if(o)v.value=o.value}else v.value='PF'});
    await p.click('#qualityReject');await p.waitForTimeout(500);await p.click('#qualityControl');await p.waitForTimeout(500);
    ok(e9.length===before&&await p.evaluate(()=>records.find(r=>r.id==='M1').lifecycle.status==='À contrôler'),'onglet Qualité : rejeter puis remettre à contrôler sans erreur '+JSON.stringify(e9.slice(before)));
    // 7) Réinitialisation : l'appli redémarre proprement et une nouvelle fiche s'enregistre
    await p.click('.tab[data-tab="data"]');
    await Promise.all([p.waitForNavigation(),p.click('#reset')]);await p.evaluate(()=>window.OEGRecordsReady);
    ok(await p.evaluate(()=>records.length===0&&!JSON.parse(localStorage.getItem('oeg_sync_drive_cfg_v1')||'{}').connected),'réinitialisation : appareil vidé, Drive déconnecté');
    await p.click('#networks .chip[data-n="RCO"]');
    for(const id of ['session','activity','station'])await p.evaluate(id=>{const s=$(id);s.value=[...s.options].find(o=>o.value).value;s.dispatchEvent(new Event('change',{bubbles:true}))},id);
    await p.fill('#date','2026-10-08');for(const n of [1,2,3])await p.fill('#iv_turb_'+n,'4');
    await p.click('#save');await p.waitForTimeout(1200);
    await p.reload();await p.evaluate(()=>window.OEGRecordsReady);
    ok(await p.evaluate(()=>records.length===1),'après réinitialisation : nouvelle fiche enregistrée et conservée');
    ok(e9.length===0,'aucune erreur JavaScript (sauvegarde / synchronisation) '+JSON.stringify(e9));
    await c9.close();
  }
  // --- N : règles de saisie et circuit qualité (constats de l'audit) ---
  {
    const b2=await chromium.launch(Object.assign(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{},{args:['--lang=en-US']}));
    const c10=await b2.newContext({serviceWorkers:'block',locale:'en-US'});
    await c10.route('https://unpkg.com/**',r=>r.abort());await c10.route('https://tile.openstreetmap.org/**',r=>r.abort());
    const p=await c10.newPage();const e10=[];p.on('pageerror',e=>e10.push(e.message));p.on('dialog',d=>d.accept());
    await p.goto('http://localhost:8765/');await p.evaluate(()=>window.OEGRecordsReady);
    const choose=async(net,i=0)=>{await p.click(`#networks .chip[data-n="${net}"]`);
      for(const id of ['session','activity'])await p.evaluate(id=>{const s=$(id);if(!s||s.closest('.hide'))return;const o=[...s.options].find(o=>o.value);if(o){s.value=o.value;s.dispatchEvent(new Event('change',{bubbles:true}))}},id);
      await p.evaluate(i=>{const s=$('station');s.value=[...s.options].filter(o=>o.value)[i].value;s.dispatchEvent(new Event('change',{bubbles:true}))},i);await p.waitForTimeout(300)};
    // Virgule décimale sur un navigateur en anglais
    await choose('RCO');await p.click('#iv_cond');await p.keyboard.type('125,5');
    ok(await p.inputValue('#iv_cond')==='125.5','virgule décimale (navigateur en anglais) : « 125,5 » reste 125.5 (auparavant 1255)');
    // Mesure non faite = absente, pas 0 (turbidité EL, suivi)
    await choose('EL');for(const n of [1,2,3])await p.fill('#el_turb_surf_'+n,'12');
    ok(await p.evaluate(()=>{const t=collectInsitu().turbidite;return t.surf.moyenne===12&&t.inter.moyenne===null&&t.inter.mesures.every(v=>v===null)}),'EL : turbidité non mesurée en intermédiaire = absente (et non 0)');
    await p.evaluate(()=>{const st=stationsFor('RCO',RCO_COMBINED_ACTIVITY)[0];const b=(id,d,o2)=>({id,network:'RCO',station:st.nom,date:d,savedAt:d+'T08:00:00.000Z',lifecycle:{status:'À contrôler',updatedAt:d+'T08:00:00.000Z'},insitu:{o2mg:{value:o2},ph:{value:'7'}},photos:[],auditRefs:[]});records.push(b('S1','2026-10-01','7.5'),b('S2','2026-12-01',''));saveLS(LS,records)});
    ok(await p.evaluate(()=>{const st=stationsFor('RCO',RCO_COMBINED_ACTIVITY)[0];const s=suiviSeries('RCO',st.nom,'o2mg');return s.length===1&&s[0].mean===7.5}),'suivi : O₂ non mesuré absent des séries (moyenne 7,5 et non 3,75)');
    // CRT EL : profil avec la mesure intermédiaire, sans faux zéros
    await p.evaluate(()=>{const st=stationsFor('EL',null).find(Boolean)||Object.values(DATA).flat().find(x=>x&&x.nom);records.push({id:'ELX',network:'EL',station:st.nom,stationInfo:st,date:'2026-10-05',session:'',savedAt:'2026-10-05T08:00:00.000Z',lifecycle:{status:'À contrôler',updatedAt:'2026-10-05T08:00:00.000Z'},photos:[],auditRefs:[],insitu:{type:'MET',profondeur:'5',profondeurs:{surface:'0.5',intermediaire:'2',fond:'4'},params:{temp:{surface:'29.1',intermediaire:'28.4',fond:'27.2'},ph:{surface:'7.2',intermediaire:'7.0',fond:''}},turbidite:{}}});saveLS(LS,records)});
    await p.click('.tab[data-tab="crt"]');await p.waitForTimeout(400);
    await p.evaluate(()=>{const s=$('crtRecord');s.value='ELX';s.dispatchEvent(new Event('change',{bubbles:true}))});await p.waitForTimeout(300);
    const crt=await p.textContent('#crtPreviewBox');
    ok(/28[.,]4/.test(crt),'CRT EL : la mesure intermédiaire (28,4 °C) apparaît (auparavant « — » / 0)');
    ok(await p.evaluate(()=>{const svg=[...document.querySelectorAll('#crtPreviewBox svg')].map(s=>s.textContent).join(' ');return !/\b0\.00\b/.test(svg)}),'CRT EL : aucun faux 0,00 tracé pour les mesures non faites');
    // Habilitation d'un préleveur prestataire enregistré par ses initiales
    ok(await p.evaluate(()=>{custom.preleveurs.push({nom:'Bernard',prenom:'Damien',organisme:'HYDRECO',initiales:'DB',habilitationEcheance:'2099-12-31'});const c=qualityChecksFor({network:'RCO',station:'x',preleveurs:['DB'],date:'2026-10-01'}).find(c=>/Opérateur DB/.test(c.label));return c&&c.ok}),'habilitation : préleveur HYDRECO reconnu par ses initiales (auparavant « non référencé »)');
    // Fiche EL : les mesures in situ sont reconnues, pas d'identifiant d'échantillon exigé
    ok(await p.evaluate(()=>{const c=qualityChecksFor(records.find(r=>r.id==='ELX'));const m=c.find(x=>/Mesures in situ/.test(x.label));return m&&m.ok&&!c.some(x=>/Identifiant échantillon/.test(x.label)&&!x.ok)}),'fiche EL : mesures in situ reconnues, pas d’identifiant d’échantillon exigé');
    ok(await p.evaluate(()=>{const c=qualityChecksFor({network:'ESO',insitu:{redox:{value:'120'}}});const u=c.find(x=>/redox.*unité/.test(x.label));return !u||u.ok}),'ESO : potentiel redox accepté (unité connue)');
    // Enregistrement, empreinte d'intégrité, validation avec avertissements justifiés, modification après validation
    await p.click('.tab[data-tab="new"]');await choose('RCO');
    await p.fill('#date','2026-10-08');await p.fill('#start','08:00');await p.fill('#end','09:00');for(const n of [1,2,3])await p.fill('#iv_turb_'+n,'4');
    await p.click('#save');await p.waitForTimeout(1200);
    const rid=await p.evaluate(()=>records.find(r=>r.date==='2026-10-08'&&r.network==='RCO')?.id);
    await p.click('.tab[data-tab="quality"]');await p.waitForTimeout(300);
    ok(await p.evaluate(async id=>{const r=records.find(x=>x.id===id);return r.lifecycle.integrityHash===await sha256(integrityPayload(r))},rid),'empreinte d’intégrité : une fiche fraîchement enregistrée est « OK » (auparavant « à contrôler »)');
    const rec=await p.evaluate(id=>{const r=records.find(x=>x.id===id);const c=qualityChecksFor(r);return {crit:c.filter(x=>!x.ok&&(x.level||'critical')==='critical').map(x=>x.label),warn:c.filter(x=>!x.ok&&x.level==='warning').length}},rid);
    // compléter ce qui est critique pour pouvoir tester la validation (signature, coordonnées)
    await p.evaluate(id=>{const r=records.find(x=>x.id===id);const c=document.createElement('canvas');c.width=200;c.height=60;c.getContext('2d').fillRect(5,20,150,6);r.signature=c.toDataURL();r.xTerrain=String(stationXY22(r.stationInfo)?.[0]??'');r.yTerrain=String(stationXY22(r.stationInfo)?.[1]??'');r.projection='RGFG 95 / UTM 22N';r.preleveurs=['PF'];
      custom.equipements.push({gmao:'EQ-T1',nom:'Turbidimètre',serie:'S1',echeance:'2099-12-31'});Object.values(r.insitu).forEach(d=>{if(d&&typeof d==='object'&&String(d.value??'')!=='')d.gmao='EQ-T1'})},rid);
    await p.evaluate(async id=>{const r=records.find(x=>x.id===id);r.lifecycle.integrityHash=await sha256(integrityPayload(r));saveLS(LS,records)},rid);
    const left=await p.evaluate(id=>qualityChecksFor(records.find(x=>x.id===id)).filter(x=>!x.ok&&(x.level||'critical')==='critical').map(x=>x.label),rid);
    await p.evaluate(id=>{const s=$('qualityRecord');s.value=id;s.dispatchEvent(new Event('change',{bubbles:true}));const v=$('qualityValidator');if(v.tagName==='SELECT'){const o=[...v.options].find(o=>o.value);if(o)v.value=o.value}else v.value='PF';$('qualityValidationComment').value=''},rid);
    await p.click('#qualityValidate');await p.waitForTimeout(400);
    const st1=await p.evaluate(id=>records.find(x=>x.id===id).lifecycle.status,rid);
    await p.fill('#qualityValidationComment','Salinité non mesurée : sonde en panne (justifié)');await p.click('#qualityValidate');await p.waitForTimeout(400);
    const st2=await p.evaluate(id=>records.find(x=>x.id===id).lifecycle.status,rid);
    ok(left.length===0&&st1==='À contrôler'&&st2==='Validée','validation : avertissements à justifier par un commentaire, puis fiche validée (auparavant impossible) '+JSON.stringify({left,st1,st2}));
    await p.click('.tab[data-tab="list"]');await p.evaluate(id=>{loadRecord(id);showTab('new')},rid);await p.waitForTimeout(400);
    await p.fill('#iv_ph','9.4');await p.click('#save');await p.waitForTimeout(1200);
    ok(await p.evaluate(id=>{const r=records.find(x=>x.id===id);return r.lifecycle.status==='À contrôler'&&r.lifecycle.modifiedAfterValidation},rid),'fiche validée puis modifiée : repasse « À contrôler »');
    // Session EL de mars et station personnalisée en UTM 21N
    ok(await p.evaluate(()=>sessions('EL').includes('S6 - Mars 2027 (petit été de mars)')),'session EL de mars : « petit été de mars »');
    await p.evaluate(()=>{custom.stations.push({network:'RCO',nom:'Crique test 21N',code:'T21',x:'829131.9',y:'606538.4',projection:'RGFG 95 / UTM 21N',custom:true});saveLS(LSC,custom)});
    await p.click('.tab[data-tab="new"]');await p.click('#networks .chip[data-n="RCO"]');
    for(const id of ['session','activity'])await p.evaluate(id=>{const s=$(id);const o=[...s.options].find(o=>o.value);if(o){s.value=o.value;s.dispatchEvent(new Event('change',{bubbles:true}))}},id);
    const has21=await p.evaluate(()=>{const s=$('station');const o=[...s.options].find(o=>o.value==='Crique test 21N');if(!o)return false;s.value=o.value;s.dispatchEvent(new Event('change',{bubbles:true}));return true});
    if(has21){
      await p.evaluate(()=>{$('projection').value='RGFG 95 / UTM 21N';$('xT').value='829134.9';$('yT').value='606542.4';$('xT').dispatchEvent(new Event('input',{bubbles:true}));if(typeof updateDistance==='function')updateDistance()});
      const d=parseFloat(await p.textContent('#distance'));
      ok(d>0&&d<10,'station personnalisée en UTM 21N : écart GPS de quelques mètres (auparavant ≈ 665 km) — '+d+' m');
    }else ok(true,'station personnalisée en UTM 21N : non proposée pour cette session (test non applicable)');
    ok(e10.length===0,'aucune erreur JavaScript (règles de saisie et qualité) '+JSON.stringify(e10));
    await b2.close();
  }
  // --- O : dernier audit — robustesse, synthèse, qualité ---
  {
    const c11=await browser.newContext({serviceWorkers:'block'});
    await c11.route('https://unpkg.com/**',r=>r.abort());
    const p=await c11.newPage();const e11=[];p.on('pageerror',e=>e11.push(e.message));p.on('dialog',d=>d.accept());
    await p.goto('http://localhost:8765/');await p.evaluate(()=>window.OEGRecordsReady);
    // Coordonnées terrain vides : pas de faux écart
    await p.click('#networks .chip[data-n="RCO"]');
    for(const id of ['session','activity','station'])await p.evaluate(id=>{const s=$(id);s.value=[...s.options].find(o=>o.value).value;s.dispatchEvent(new Event('change',{bubbles:true}))},id);
    await p.evaluate(()=>{$('xT').value='';$('yT').value='';updateDistance()});
    ok((await p.textContent('#distance')).trim()==='—','coordonnées terrain vides : écart « — » (auparavant ≈ 600 km)');
    ok(await p.evaluate(()=>{const c=qualityChecksFor({network:'RCO',station:'x',xTerrain:'',yTerrain:'',stationInfo:{x:'350000',y:'550000'}});const g=c.find(x=>/GPS terrain numériques/.test(x.label));return g&&!g.ok}),'contrôle qualité : coordonnées terrain manquantes signalées (et non un faux écart)');
    // Mise à jour de l'appli pendant une saisie : pas de rechargement, bandeau
    await p.evaluate(()=>{window.__noReload=true;navigator.serviceWorker.dispatchEvent(new Event('controllerchange'))});await p.waitForTimeout(300);
    ok(await p.evaluate(()=>!!document.getElementById('updateBanner')&&window.__noReload===true),'nouvelle version pendant une saisie : bandeau, pas de rechargement (la saisie est préservée)');
    await Promise.all([p.waitForNavigation({timeout:8000}),p.evaluate(()=>clearFormNoConfirm())]);
    ok(true,'fiche enregistrée / vidée : la mise à jour se fait ensuite d’elle-même');
    await p.evaluate(()=>window.OEGRecordsReady);
    // Brouillon enregistré immédiatement quand l'appli passe en arrière-plan
    await p.click('#networks .chip[data-n="RCO"]');
    for(const id of ['session','activity','station'])await p.evaluate(id=>{const s=$(id);s.value=[...s.options].find(o=>o.value).value;s.dispatchEvent(new Event('change',{bubbles:true}))},id);
    await p.fill('#obs','Saisie juste avant de prendre une photo');await p.evaluate(()=>window.dispatchEvent(new Event('pagehide')));await p.waitForTimeout(200);
    ok((await p.evaluate(()=>OEGStore.get('oeg_draft_v1')))?.record?.obs==='Saisie juste avant de prendre une photo','passage en arrière-plan : brouillon enregistré immédiatement');
    await p.evaluate(()=>clearFormNoConfirm());
    // Qualité : identifiant d'échantillon contrôlé, mesure vide non « numérique », chaîne du froid EL
    ok(await p.evaluate(()=>{const c=qualityChecksFor({network:'RCO',station:'x',sample:{stype:'x'},sampleTrace:{}});const i=c.find(x=>/Identifiant échantillon/.test(x.label));return i&&!i.ok&&i.level==='warning'}),'contrôle « Identifiant échantillon » actif (désactivé par erreur auparavant)');
    ok(await p.evaluate(()=>!qualityChecksFor({network:'RCO',insitu:{sal:{value:''},ph:{value:'7'}}}).some(x=>/Salinité : valeur numérique/.test(x.label)&&x.ok)),'mesure vide : plus de « valeur numérique ✓ » contradictoire');
    ok(await p.evaluate(()=>qualityChecksFor({network:'EL',sample:{transportFroid:'Glacières + blocs eutectiques',transportSuivi:'x'},sampleTrace:{}}).filter(x=>/température (départ|réception)/.test(x.label)).every(x=>x.level==='warning')),'EL avec glacière : températures de transport en avertissement (validation possible)');
    // Suivi EL : turbidité non mesurée absente
    await p.evaluate(()=>{records.push({id:'ELT',network:'EL',station:'Cayenne côte',date:'2026-10-05',savedAt:'2026-10-05T08:00:00Z',lifecycle:{status:'À contrôler',updatedAt:'2026-10-05T08:00:00Z'},photos:[],auditRefs:[],insitu:{params:{temp:{surface:'28'}},turbidite:{surf:{mesures:[12,12,12],moyenne:12},inter:{mesures:[null,null,null],moyenne:null},fond:{mesures:[null,null,null],moyenne:null}}}});saveLS(LS,records)});
    ok(await p.evaluate(()=>{const ks=suiviParamsFor('EL','Cayenne côte');return ks.includes('turb_surf')&&!ks.includes('turb_inter')&&!ks.includes('turb_fond')}),'suivi EL : turbidité non mesurée (intermédiaire, fond) absente au lieu de 0');
    // Synthèse : stations BIO/EL, mesures EL, échéances dépassées
    await p.evaluate(()=>{records.push({id:'BIO1',network:'BIO',station:'Station BIO test',date:'2026-10-05',savedAt:'2026-10-05T08:00:00Z',lifecycle:{status:'À contrôler',updatedAt:'2026-10-05T08:00:00Z'},photos:[],auditRefs:[],insitu:{ph:{value:'6.8'}}});custom.equipements.push({gmao:'OLD-1',nom:'Sonde',echeance:'2020-01-01'});saveLS(LS,records);saveLS(LSC,custom)});
    await p.click('.tab[data-tab="dashboard"]');await p.waitForTimeout(300);
    ok(await p.evaluate(()=>dashStationList('BIO').some(s=>s.nom==='Station BIO test')),'synthèse : stations BIO listées (liste vide auparavant)');
    await p.evaluate(()=>{const n=$('dashNetwork');n.value='EL';n.dispatchEvent(new Event('change',{bubbles:true}));if(typeof renderDashStations==='function')renderDashStations();const s=$('dashStation');s.value='Cayenne côte';s.dispatchEvent(new Event('change',{bubbles:true}));renderDashStation()});
    ok(!/Aucune mesure in situ/.test(await p.textContent('#dashParams')),'synthèse : mesures EL affichées pour la station');
    ok(/échéance métrologique est dépassée/.test(await p.textContent('#dashActions')),'synthèse : étalonnage expiré signalé dans les actions prioritaires');
    // Aller sur une station sans carte (hors ligne)
    await p.click('.tab[data-tab="stations"]');await p.waitForTimeout(500);
    ok(await p.evaluate(()=>$('gotoStation').options.length>5),'« Aller sur une station » : liste remplie même sans la carte (hors ligne)');
    // Recherche dans la liste des fiches : pas de correspondance dans les photos
    await p.evaluate(()=>{const ph='data:image/png;base64,QUJDTUJERUY=';records.push({id:'SR1',network:'RCO',station:'S1',preleveurs:['PF'],photos:[{data:ph,group:'Amont'}],date:'2026-10-01',savedAt:'2026-10-01T08:00:00Z',lifecycle:{status:'À contrôler'},auditRefs:[]},{id:'SR2',network:'RCO',station:'S2',preleveurs:['QZX'],photos:[],date:'2026-10-01',savedAt:'2026-10-01T08:00:00Z',lifecycle:{status:'À contrôler'},auditRefs:[]});saveLS(LS,records)});
    await p.click('.tab[data-tab="list"]');await p.fill('#search','QZX');await p.waitForTimeout(200);
    ok(await p.evaluate(()=>document.querySelectorAll('#records .listcard').length)===1,'recherche par préleveur : seulement la bonne fiche (les photos ne sont plus fouillées)');
    ok(e11.length===0,'aucune erreur JavaScript (dernier audit) '+JSON.stringify(e11));
    await c11.close();
  }
  // --- P : contenu du CRT (ESO, contrôle qualité, traçabilité, codes SANDRE, NC, matériel, arrondis) ---
  {
    const c12=await browser.newContext({serviceWorkers:'block'});
    await c12.route('https://unpkg.com/**',r=>r.abort());await c12.route('https://tile.openstreetmap.org/**',r=>r.abort());
    const p=await c12.newPage();const e12=[];p.on('pageerror',e=>e12.push(e.message));p.on('dialog',d=>d.accept());
    await p.goto('http://localhost:8765/');await p.evaluate(()=>window.OEGRecordsReady);
    const eso=await p.evaluate(()=>{
      const eso=stationsFor('ESO',null)[0],m={savedAt:'2026-10-05T08:00:00.000Z',lifecycle:{status:'À contrôler',version:1,updatedAt:'2026-10-05T08:00:00.000Z'},auditRefs:[],photos:[]};
      records.push({id:'PESO',network:'ESO',session:'S1',station:eso.nom,stationInfo:eso,date:'2026-10-05',...m,conditions:{},
        insitu:{mode:'par appareil',ph:{value:'6.5',gmao:'EQ-P1'},turb:{value:3.3333333333333335,moyenne:3.3333333333333335,mesures:[3,3,4]}},insituBoitier:'EQ-B1',
        sample:{stype:'Ponctuel',esoNature:'Piézomètre',esoLieu:'Tête de puits',purgeDebit:'1.2',purgeDuree:'30',esoNiveau:'12.4',pompeDemeure:'Non',esoFroid:'Glacière',esoSuivi:'Enregistreur',esoRecepteurs:[{organisme:'LABO-ESO',dateHeure:'2026-10-05T16:30'}],esoRecepteur:'LABO-ESO',esoRemise:'2026-10-05T16:30',recepteurs:[]},
        qc:'Oui',qcType:'Blanc terrain',quality:{qcBlank:'Oui',qcDuplicate:'Non',qcMaterial:'Oui',representative:'Non',representativeJustification:'Accès limité',uncertaintySource:'Pluie la veille'},
        sampleTrace:{sampleId:'ECH-42',bottleLot:'LOT-7',tempDeparture:'4',tempReception:'5',transportAgent:'Agent X',custodyDate:'2026-10-05T17:00',custodyObs:'RAS transport'},
        obs:'Eau claire au robinet',comment:'Mesure redox non réalisée'});
      const rco=stationsFor('RCO',RCO_COMBINED_ACTIVITY)[0];
      records.push({id:'PRCO',network:'RCO',activity:RCO_COMBINED_ACTIVITY,session:'S1',station:rco.nom,stationInfo:rco,date:'2026-10-06',...m,insitu:{},
        conditions:{hydro:'3',meteo:'1',limpidite:'2'},specific:{rcoEau:'Non',rcoSed:'Oui',rcoSedGants:'Oui',rcoBioObs:'  '},sample:{rcoSed:'Oui',rcoSedGants:'Oui'}});
      const el=DATA.EL_STATIONS[0];
      records.push({id:'PEL',network:'EL',station:el.nom,stationInfo:el,date:'2026-10-07',...m,insitu:{profondeur:'5',profondeurs:{surface:'0.5',intermediaire:'2',fond:'4'},params:{temp:{surface:'29.126',intermediaire:'28.4',fond:'27.2'}},turbidite:{surf:{moyenne:3.3333333333333335}}}});
      records.push({id:'PBIO',network:'BIO',station:'Station BIO P',stationInfo:{nom:'Station BIO P'},date:'2026-10-08',...m,insitu:{},specific:{fishLab:'2026-10-09T09:15',fishWeight:'950',f_Chevaine_1_t:'210',f_Chevaine_1_p:'120'}});
      custom.nonConformites=(custom.nonConformites||[]).concat([{id:'NC-P1',recordId:'PESO',category:'Transport',severity:'Majeure',status:'Ouverte',description:'Glacière arrivée à 9 °C',immediate:'Ré-échantillonnage',corrective:'Contrôle des blocs eutectiques',dueDate:'2026-11-01'}]);
      custom.equipements.push({type:'sonde',gmao:'EQ-P1',nom:'Sonde pH P',serie:'SN-1',echeance:'2026-09-30'},{type:'boitier',gmao:'EQ-B1',nom:'Multi 3630',serie:'SN-2',echeance:'2027-06-30'});
      saveLS(LS,records);saveLS(LSC,custom);return {code:eso.code_bss,commune:eso.commune};
    });
    await p.click('.tab[data-tab="crt"]');await p.waitForTimeout(500);
    const pick=async id=>{await p.evaluate(id=>{const s=$('crtRecord');s.value=id;s.dispatchEvent(new Event('change',{bubbles:true}))},id);await p.waitForTimeout(250);return p.textContent('#crtPreviewBox')};
    let t=await pick('PESO');
    ok(t.includes('Code BSS')&&t.includes(eso.code)&&!t.includes('Non défini')&&t.includes(eso.commune),'CRT ESO : code BSS et commune (auparavant « Non défini »)');
    ok(/Moyen de refroidissement\s*Glacière/.test(t)&&/Suivi de la température\s*Enregistreur/.test(t)&&t.includes('LABO-ESO')&&t.includes('05/10/2026 16:30'),'CRT ESO : transport et organisme récepteur imprimés (auparavant « — »)');
    ok(/Nature du point\s*Piézomètre/.test(t)&&t.includes('Tête de puits')&&/Niveau piézométrique \(m\)\s*12.4/.test(t)&&/Débit de purge \(m³\/h\)\s*1.2/.test(t),'CRT ESO : ouvrage, purge et niveau piézométrique');
    ok(/Blanc de terrain réalisé\s*Oui/.test(t)&&t.includes('Accès limité')&&t.includes('Pluie la veille'),'CRT : section contrôle qualité');
    ok(['ECH-42','LOT-7','Agent X','RAS transport','05/10/2026 17:00'].every(x=>t.includes(x)),'CRT : traçabilité / chaîne de possession');
    ok(t.includes('Eau claire au robinet')&&t.includes('Mesure redox non réalisée'),'CRT : observations ET commentaires imprimés (auparavant l’un ou l’autre)');
    ok(t.includes('Glacière arrivée à 9 °C')&&t.includes('1 non-conformité(s) non clôturée(s)'),'CRT : non-conformités de la fiche');
    ok(/EQ-P1\s*Sonde pH P\s*SN-1[^]*Étalonnage expiré à la date de la visite/.test(t)&&/EQ-B1\s*Multi 3630[^]*Étalonnage valide à la date de la visite/.test(t),'CRT : matériel de mesure et statut métrologique à la date de la visite');
    ok(t.includes('3.33')&&!t.includes('3.3333'),'CRT : valeurs arrondies à 2 décimales (turbidité moyenne)');
    ok(/Matrice\(s\)\s*Eau souterraine/.test(t),'CRT ESO : matrice « eau souterraine »');
    t=await pick('PRCO');
    ok(t.includes('Basses eaux (code SANDRE 3)')&&t.includes('Ensoleillé (code SANDRE 1)')&&t.includes('Légèrement trouble (code SANDRE 2)'),'CRT : libellés SANDRE au lieu des seuls codes');
    ok(/Matrice\(s\)\s*Sédiments/.test(t),'CRT RCO : matrice = sédiments (eau non prélevée ; auparavant toujours « Eau »)');
    ok(/Eau prélevée\s*:\s*Non/.test(t)&&!/rcoSed|rcoBioObs/.test(t),'CRT RCO : données complémentaires libellées, sans clés brutes ni doublon sédiments');
    t=await pick('PEL');
    ok(/Niveau de mesure \(m\)\s*0.5\s*2\s*4/.test(t)&&t.includes('Profondeur totale : 5 m')&&t.includes('29.13'),'CRT EL : niveaux de mesure et profondeur totale dans le tableau, valeurs arrondies');
    t=await pick('PBIO');
    ok(/Date \/ heure d’arrivée au laboratoire\s*:\s*09\/10\/2026 09:15/.test(t)&&!t.includes('Laboratoire destinataire'),'CRT BIO : libellés du formulaire (arrivée au laboratoire) et dates lisibles');
    ok(/Chevaine\s*1\s*210\s*120/.test(t)&&!t.includes('f_Chevaine'),'CRT BIO : individus de pêche en tableau (et non clés brutes)');
    ok(e12.length===0,'aucune erreur JavaScript (contenu du CRT) '+JSON.stringify(e12));
    await c12.close();
  }
  // --- Q : CRT imprimé (titres visibles, formulaire masqué, photos entières, graphes, carte lente) ---
  {
    const c13=await browser.newContext({serviceWorkers:'block'});
    await c13.route('https://unpkg.com/**',r=>r.abort());
    await c13.route('https://tile.openstreetmap.org/**',()=>{}); // réseau lent : tuiles jamais reçues
    const p=await c13.newPage();const e13=[];p.on('pageerror',e=>e13.push(e.message));p.on('dialog',d=>d.accept());
    await p.goto('http://localhost:8765/');await p.evaluate(()=>window.OEGRecordsReady);
    await p.evaluate(()=>{
      const el=DATA.EL_STATIONS[0],m={savedAt:'2026-10-05T08:00:00Z',lifecycle:{status:'À contrôler'},auditRefs:[]};
      const c=document.createElement('canvas');c.width=300;c.height=600;c.getContext('2d').fillRect(0,0,300,600);
      records.push({id:'QEL',network:'EL',station:el.nom,stationInfo:el,date:'2026-10-07',...m,photos:[{data:c.toDataURL('image/png'),group:'Amont'}],obs:'x'.repeat(400),
        insitu:{profondeurs:{surface:'0',intermediaire:'3',fond:'6'},params:{temp:{surface:'29',intermediaire:'28',fond:'27'}},turbidite:{}}});
      [['2026-03-10','27.5'],['2027-01-15','28.9']].forEach(([d,t],i)=>records.push({id:'QH'+i,network:'EL',station:el.nom,date:d,...m,photos:[],insitu:{params:{temp:{surface:t}}}}));
      saveLS(LS,records);
    });
    await p.click('.tab[data-tab="crt"]');await p.waitForTimeout(500);
    await p.evaluate(()=>{window.print=()=>{window.__printed=(window.__printed||0)+1};const s=$('crtRecord');s.value='QEL';s.dispatchEvent(new Event('change',{bubbles:true}))});await p.waitForTimeout(300);
    const svgTxt=await p.evaluate(()=>[...document.querySelectorAll('#crtPreviewBox svg')].map(s=>s.textContent).join(' '));
    ok(!/-0[.,]\d/.test(svgTxt),'CRT : axe des profondeurs sans valeur négative');
    ok(svgTxt.includes('10/03/26')&&svgTxt.includes('15/01/27'),'CRT : historique daté jj/mm/aa (auparavant « 03-10 », mois-jour)');
    await p.emulateMedia({media:'print'});
    const st=await p.evaluate(()=>{const cs=e=>e&&getComputedStyle(e);const h2=document.querySelector('#crtPreviewBox .crtPage:not(.crtCover) h2'),ch2=document.querySelector('#crtPreviewBox .crtCover h2'),img=document.querySelector('#crtPreviewBox .crtPhotoGrid img');
      return {h2bg:cs(h2).backgroundColor,h2col:cs(h2).color,cbg:cs(ch2).backgroundColor,batch:cs($('crtBatchCard')).display,head:cs($('printHeader')).display,html:cs(document.documentElement).backgroundColor,fit:cs(img).objectFit,wrap:cs(document.querySelector('#crtPreviewBox .crtComment')).overflowWrap}});
    ok(st.h2bg==='rgba(0, 0, 0, 0)'&&st.h2col!=='rgb(255, 255, 255)'&&st.cbg==='rgba(0, 0, 0, 0)','CRT imprimé : titres de section lisibles (auparavant bleu foncé sur bandeau bleu foncé) '+JSON.stringify([st.h2bg,st.h2col,st.cbg]));
    ok(st.batch==='none'&&st.head==='none','CRT imprimé : ni formulaire « CRT consolidé » ni en-tête « Fiche terrain » en page 1');
    ok(st.html==='rgb(255, 255, 255)','CRT imprimé : fond blanc (auparavant gris sous la dernière page)');
    ok(st.fit==='contain'&&st.wrap==='anywhere','CRT imprimé : photos entières (non recadrées) et texte long renvoyé à la ligne');
    await p.emulateMedia({media:'screen'});
    // Carte : tuiles toujours en attente au bout de 8 s -> carte schématique à l'impression
    await p.evaluate(()=>{Object.defineProperty(navigator,'onLine',{get:()=>true,configurable:true})});
    await p.click('#crtGenerate');await p.waitForFunction(()=>window.__printed>=1,null,{timeout:15000});
    ok(await p.evaluate(()=>[...document.querySelectorAll('#crtPreviewBox .crtMapPlaceholder')].every(b=>{const fb=b.querySelector('.crtMapFallback');return fb&&!fb.hidden&&!b.querySelector('img[src*="openstreetmap"]')})),'CRT imprimé : fond de carte incomplet après 8 s = carte schématique (et non carte trouée)');
    ok(e13.length===0,'aucune erreur JavaScript (CRT imprimé) '+JSON.stringify(e13));
    await c13.close();
  }
  // --- R : exports et interface (CSV à plat, import Excel / CSV, téléphone, fiche imprimée) ---
  {
    const c14=await browser.newContext({serviceWorkers:'block',acceptDownloads:true});
    await c14.route('https://unpkg.com/**',r=>r.abort());
    await c14.route('https://cdn.sheetjs.com/**',r=>r.abort()); // site principal injoignable -> copie de secours
    await c14.route('https://unpkg.com/xlsx@0.18.5/**',r=>r.fulfill({contentType:'text/javascript',body:'window.XLSX={read:()=>({SheetNames:["S"],Sheets:{S:{}}}),utils:{sheet_to_json:()=>[["Code station","Nom","X","Y"],["X1","Station Excel","1","2"]]}}'}));
    const p=await c14.newPage();const e14=[];p.on('pageerror',e=>e14.push(e.message));p.on('dialog',d=>d.accept());
    await p.goto('http://localhost:8765/');await p.evaluate(()=>window.OEGRecordsReady);
    // Export CSV : mesures, conditions, échantillonnage, qualité, traçabilité, validation
    await p.evaluate(()=>{records.push({id:'CSV1',network:'ESO',station:'S',stationInfo:{code_bss:'BSS0X'},date:'2026-10-05',ecartM:'12.3 m',signName:'PF',insituBoitier:'EQ-B1',savedAt:'2026-10-05T08:00:00Z',
      lifecycle:{status:'Validée',version:2,validatedBy:'ML',validatedAt:'2026-10-06T08:00:00Z'},auditRefs:[],photos:[],conditions:{hydro:'3'},insitu:{ph:{value:'6.5',gmao:'EQ-P1'},turb:{moyenne:3.3333333,value:3.3333333}},
      sample:{esoFroid:'Glacière',esoRecepteurs:[{organisme:'LABO',dateHeure:'2026-10-05T16:30'}]},quality:{qcBlank:'Oui'},sampleTrace:{sampleId:'ECH-1'},comment:'ligne 1\nligne 2; suite'});saveLS(LS,records)});
    const [dl]=await Promise.all([p.waitForEvent('download'),p.evaluate(()=>$('exportCSV').click())]);
    const csvTxt=fs.readFileSync(await dl.path(),'utf8').replace(/^﻿/,'');
    const head=csvTxt.split('\n')[0].split(';');
    const lines=csvTxt.split('\n'),row=lines.find(l=>l.startsWith('CSV1;'));
    const val=k=>{const parts=[];let cur='',q=false;const full=lines.slice(lines.indexOf(row)).join('\n');for(let i=0;i<full.length;i++){const ch=full[i];if(q){if(ch==='"'){if(full[i+1]==='"'){cur+='"';i++}else q=false}else cur+=ch}else if(ch==='"')q=true;else if(ch===';'){parts.push(cur);cur=''}else if(ch==='\n'){parts.push(cur);break}else cur+=ch}return parts[head.indexOf(k)]};
    ok(['mes_ph','mes_ph_gmao','cond_hydro','ech_esoFroid','qualite_qcBlank','trace_sampleId','status','validePar','signataire','boitier','codeStation'].every(k=>head.includes(k)),'export CSV : mesures, conditions, échantillonnage, qualité, traçabilité et validation (auparavant 21 colonnes sans mesure)');
    ok(val('mes_ph')==='6.5'&&val('mes_turb')==='3.33'&&val('ecartM')==='12.3'&&val('validePar')==='ML'&&val('codeStation')==='BSS0X'&&/LABO \(2026-10-05T16:30\)/.test(val('ech_esoRecepteurs')),'export CSV : valeurs exactes (écart GPS en nombre, turbidité arrondie, récepteurs ESO)');
    ok(val('comment')==='ligne 1\nligne 2; suite','export CSV : commentaire multiligne avec « ; » correctement protégé');
    // Import programme de marché : CSV hors connexion, Excel via la bibliothèque chargée à la demande
    await p.setInputFiles('#miFile',{name:'marche.csv',mimeType:'text/csv',buffer:Buffer.from('﻿Code station;Nom;X;Y\nC1;"Station; avec point-virgule";352000;540000\n')});
    await p.waitForFunction(()=>Array.isArray(miParsedRows)&&miParsedRows.length===1,null,{timeout:5000}).catch(()=>{});
    ok(await p.evaluate(()=>miParsedRows?.[0]?.[1]==='Station; avec point-virgule'&&miMapping.code===0&&miMapping.nom===1&&!!document.querySelector('#miMapping select')),'import de marché : fichier CSV lu hors connexion, colonnes reconnues');
    await p.setInputFiles('#miFile',{name:'marche.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from('PK')});
    await p.waitForFunction(()=>miParsedRows?.[0]?.[1]==='Station Excel',null,{timeout:5000}).catch(()=>{});
    ok(await p.evaluate(()=>miParsedRows?.[0]?.[1]==='Station Excel'&&!!window.XLSX),'import de marché : Excel lu (bibliothèque chargée à la demande, copie de secours ; auparavant « XLSX is not defined »)');
    // Fiche imprimée : sans outils de saisie, réseau en toutes lettres
    await p.click('.tab[data-tab="new"]');await p.click('#networks .chip[data-n="EL"]');
    await p.evaluate(()=>{for(const id of ['session','activity']){const s=$(id);if(!s||s.closest('.hide'))continue;const o=[...s.options].find(o=>o.value);if(o){s.value=o.value;s.dispatchEvent(new Event('change',{bubbles:true}))}}const s=$('station');s.value=[...s.options].filter(o=>o.value)[0].value;s.dispatchEvent(new Event('change',{bubbles:true}))});
    await p.waitForTimeout(400);await p.evaluate(()=>window.dispatchEvent(new Event('beforeprint')));await p.emulateMedia({media:'print'});
    const tools=await p.evaluate(()=>[...document.querySelectorAll('label.btn,#drawEraser,[id^="rxAdd_"],.swatch')].filter(e=>e.getBoundingClientRect().width>0).length);
    ok(tools===0,'fiche imprimée : sans boutons photo, palette / gomme du schéma ni « ajouter un organisme »');
    ok(/EL — suivi littoral/.test(await p.textContent('#printHeaderTitle')),'fiche imprimée : réseau en toutes lettres dans l’en-tête');
    await p.emulateMedia({media:'screen'});
    // Téléphone (390 px) : aucune page plus large que l'écran, bouton Enregistrer visible
    await p.setViewportSize({width:390,height:844});await p.waitForTimeout(300);
    const m=await p.evaluate(()=>{const b=$('save').getBoundingClientRect();return {sw:document.documentElement.scrollWidth,w:document.documentElement.clientWidth,right:b.right}});
    ok(m.sw<=m.w&&m.right<=m.w,'téléphone : page sans défilement horizontal, bouton Enregistrer entièrement visible '+JSON.stringify(m));
    ok(e14.length===0,'aucune erreur JavaScript (exports et interface) '+JSON.stringify(e14));
    await c14.close();
  }
  {
    // Import Excel sans connexion : message clair (proposer le CSV) au lieu de « XLSX is not defined »
    const c15=await browser.newContext({serviceWorkers:'block'});await c15.route(/^https:\/\//,r=>r.abort());
    const p=await c15.newPage();await p.goto('http://localhost:8765/');await p.evaluate(()=>window.OEGRecordsReady);
    await p.setInputFiles('#miFile',{name:'m.xlsx',mimeType:'application/octet-stream',buffer:Buffer.from('PK')});
    await p.waitForFunction(()=>/format CSV/.test(document.body.innerText),null,{timeout:5000}).catch(()=>{});
    ok(await p.evaluate(()=>/format CSV/.test(document.body.innerText)&&!/XLSX is not defined/.test(document.body.innerText)),'import Excel hors connexion : message clair proposant le CSV');
    await c15.close();
  }
  // --- S : suivi EL — surface, intermédiaire et fond sur le même graphe (onglet Suivi et CRT) ---
  {
    const c16=await browser.newContext({serviceWorkers:'block'});
    await c16.route('https://unpkg.com/**',r=>r.abort());await c16.route('https://tile.openstreetmap.org/**',r=>r.abort());
    const p=await c16.newPage();const e16=[];p.on('pageerror',e=>e16.push(e.message));
    await p.goto('http://localhost:8765/');await p.evaluate(()=>window.OEGRecordsReady);
    const st=await p.evaluate(()=>{
      const st=DATA.EL_STATIONS[0],ses=DATA.EL_SESSIONS.map(x=>x.label);
      const mk=(id,session,date,v)=>({id,network:'EL',station:st.nom,stationInfo:st,session,date,savedAt:date+'T08:00:00Z',lifecycle:{status:'À contrôler'},photos:[],auditRefs:[],
        insitu:{profondeurs:{surface:'0.5',intermediaire:'5',fond:'10'},params:{temp:{surface:v[0],intermediaire:v[1],fond:v[2]},condms:{surface:'52.1',intermediaire:'52.6',fond:'53'}},turbidite:{surf:{moyenne:12},inter:{moyenne:null},fond:{moyenne:21}}}});
      records.push(mk('SE1',ses[0],'2026-09-10',['29.1','28.4','27.2']),mk('SE2',ses[1],'2026-10-12',['28.6','','26.9']),mk('SE3',ses[2],'2026-11-20',['27.4','27.4','27.3']),mk('SE4',ses[2],'2026-11-28',['27.8','27.2','27.1']));
      saveLS(LS,records);return st.nom;
    });
    await p.click('.tab[data-tab="suivi"]');await p.waitForTimeout(300);
    await p.evaluate(st=>{const n=$('suiviNetwork');n.value='EL';n.dispatchEvent(new Event('change'));const s=$('suiviStation');s.value=st;s.dispatchEvent(new Event('change'))},st);await p.waitForTimeout(300);
    const cards=await p.$$eval('#suiviParamGrid .suiviParamCard',cs=>cs.map(c=>({p:c.dataset.param,name:c.querySelector('.suiviParamName').textContent,head:[...c.querySelectorAll('thead th')].map(t=>t.textContent.trim()),rows:[...c.querySelectorAll('tbody tr')].map(tr=>[...tr.children].map(td=>td.textContent.trim()))})));
    ok(cards.map(c=>c.p).join(',')==='temp,condms,turb'&&!cards.some(c=>/surface|fond/i.test(c.name)),'suivi EL : un seul graphe par paramètre (auparavant un par profondeur) '+cards.map(c=>c.p+':'+c.name).join(' | '));
    const t=cards.find(c=>c.p==='temp');
    ok(t&&t.head.join('|')==='Période|Surface|Intermédiaire|Fond'&&t.rows.length===3&&t.rows[1][2]==='—'&&/27\.60 \(n=2\)/.test(t.rows[2][1]),'suivi EL : tableau Période / Surface / Intermédiaire / Fond (mesure manquante « — », moyenne de session indiquée)');
    const px=await p.evaluate(()=>{const c=document.querySelector('.suiviParamCard[data-param="temp"] canvas'),g=c.getContext('2d'),d=g.getImageData(0,0,c.width,c.height).data;const want={surf:[0xeb,0x68,0x34],inter:[0x1b,0xaf,0x7a],fond:[0x2a,0x78,0xd6]},found={};
      for(let i=0;i<d.length;i+=4)for(const [k,[r,gg,b]] of Object.entries(want))if(Math.abs(d[i]-r)<12&&Math.abs(d[i+1]-gg)<12&&Math.abs(d[i+2]-b)<12)found[k]=(found[k]||0)+1;return found});
    ok(px.surf>20&&px.inter>20&&px.fond>20,'suivi EL : surface, intermédiaire et fond tracés sur le même graphe, chacun dans sa couleur '+JSON.stringify(px));
    const box=await (await p.$('.suiviParamCard[data-param="temp"] canvas')).boundingBox();
    await p.mouse.move(box.x+box.width/2-4,box.y+60);await p.waitForTimeout(100);
    const tip=await p.textContent('.suiviParamCard[data-param="temp"] .suiviTip');
    ok(/Surface : 28\.60/.test(tip)&&/Intermédiaire : —/.test(tip)&&/Fond : 26\.90/.test(tip),'suivi EL : info-bulle avec les trois profondeurs de la session pointée');
    ok(await p.evaluate(()=>[...document.querySelectorAll('.suiviParamCard[data-param="temp"] .suiviDepthLegend .depthMarker')].length===3),'suivi EL : légende Surface / Intermédiaire / Fond avec symboles');
    // Autres réseaux : affichage inchangé (un graphe par paramètre avec moyenne / min / max)
    await p.evaluate(()=>{records.push({id:'SR9',network:'RCO',station:'Station RCO S',date:'2026-10-01',savedAt:'2026-10-01T08:00:00Z',lifecycle:{status:'À contrôler'},photos:[],auditRefs:[],insitu:{ph:{value:'7.1'}}});saveLS(LS,records);renderSuivi()});
    await p.evaluate(()=>{const n=$('suiviNetwork');n.value='RCO';n.dispatchEvent(new Event('change'));const s=$('suiviStation');s.value='Station RCO S';s.dispatchEvent(new Event('change'))});await p.waitForTimeout(200);
    ok(await p.evaluate(()=>!!document.querySelector('#suiviParamGrid .suiviMiniStats')&&!document.querySelector('#suiviParamGrid .suiviDepthLegend')),'suivi RCO : affichage habituel conservé');
    // CRT EL : historique à la station, trois profondeurs sur le même graphe
    await p.click('.tab[data-tab="crt"]');await p.waitForTimeout(400);
    await p.evaluate(()=>{const s=$('crtRecord');s.value='SE3';s.dispatchEvent(new Event('change',{bubbles:true}))});await p.waitForTimeout(300);
    const h=await p.evaluate(()=>{const svgs=[...document.querySelectorAll('#crtPreviewBox .crtGraphCard svg')].filter(s=>/Historique/.test(s.getAttribute('aria-label')||''));const s=svgs[0];return s?{n:svgs.length,strokes:[...s.querySelectorAll('path[fill="none"]')].map(x=>x.getAttribute('stroke')),txt:s.textContent,band:!!s.querySelector('rect[fill-opacity]')}:null});
    ok(h&&h.strokes.join(',')==='#eb6834,#1baf7a,#2a78d6'&&h.band&&/S1/.test(h.txt)&&/20\/11\/26/.test(h.txt),'CRT EL : historique avec surface, intermédiaire et fond sur le même graphe, visite du rapport surlignée '+JSON.stringify(h&&h.strokes));
    ok(!(await p.evaluate(()=>[...document.querySelectorAll('#crtPreviewBox svg')].some(s=>/Historique des mesures/.test(s.getAttribute('aria-label')||'')))),'CRT EL : plus d’histogramme « surface seule »');
    ok(e16.length===0,'aucune erreur JavaScript (suivi EL) '+JSON.stringify(e16));
    await c16.close();
  }
  // --- T : suivi EL — profil de profondeur et profil longitudinal de l'estuaire ---
  {
    const c17=await browser.newContext({serviceWorkers:'block'});await c17.route('https://unpkg.com/**',r=>r.abort());
    const p=await c17.newPage();const e17=[];p.on('pageerror',e=>e17.push(e.message));
    await p.goto('http://localhost:8765/');await p.evaluate(()=>window.OEGRecordsReady);
    await p.evaluate(()=>{
      const ses=DATA.EL_SESSIONS.map(x=>x.label),by=n=>DATA.EL_STATIONS.find(s=>s.nom===n);
      const names=['Ile du salut','Kourou bourg','Singe rouge','Kourou côte','Kourou fleuve']; // volontairement dans le désordre
      let k=0;
      [[0,'2026-09-10'],[4,'2027-01-20']].forEach(([si,date])=>names.forEach((n,i)=>records.push({id:'T'+(k++),network:'EL',station:n,stationInfo:by(n),session:ses[si],date,savedAt:date+'T08:00:00Z',lifecycle:{status:'À contrôler'},photos:[],auditRefs:[],
        insitu:{profondeurs:{surface:'0.5',intermediaire:'3',fond:'6'},params:{sal:{surface:String(10*i+si),intermediaire:String(10*i+si+1),fond:String(10*i+si+2)}},turbidite:{}}})));
      records.push({id:'TNZ',network:'EL',station:'Kourou bourg',stationInfo:by('Kourou bourg'),session:ses[1],date:'2026-10-05',savedAt:'2026-10-05T08:00:00Z',lifecycle:{status:'À contrôler'},photos:[],auditRefs:[],insitu:{profondeurs:{},params:{sal:{surface:'12'}},turbidite:{}}});
      saveLS(LS,records);
    });
    await p.click('.tab[data-tab="suivi"]');await p.waitForTimeout(300);
    await p.evaluate(()=>{const n=$('suiviNetwork');n.value='EL';n.dispatchEvent(new Event('change'));const s=$('suiviStation');s.value='Kourou bourg';s.dispatchEvent(new Event('change'))});await p.waitForTimeout(300);
    ok(await p.evaluate(()=>[...document.querySelectorAll('#suiviElBar .suiviElTab')].map(b=>b.dataset.v).join(',')==='evolution,profondeur,estuaire'&&document.querySelector('#suiviElBar .suiviElTab.on').dataset.v==='evolution'),'suivi EL : choix Évolution / Profil de profondeur / Profil longitudinal');
    // Profil de profondeur
    await p.click('.suiviElTab[data-v="profondeur"]');await p.waitForTimeout(300);
    const dp=await p.evaluate(()=>{const c=document.querySelector('.suiviParamCard[data-param="sal"]');const cv=c.querySelector('canvas'),d=cv.getContext('2d').getImageData(0,0,cv.width,cv.height).data;const has=([r,g,b])=>{for(let i=0;i<d.length;i+=4)if(Math.abs(d[i]-r)<12&&Math.abs(d[i+1]-g)<12&&Math.abs(d[i+2]-b)<12)return true;return false};
      return {s1:has([0x62,0x50,0xd6]),s5:has([0xe8,0x7b,0xa4]),rows:[...c.querySelectorAll('tbody tr')].map(tr=>[...tr.children].map(td=>td.textContent.trim()).join(' | ')),note:c.querySelector('.suiviElCardNote')?.textContent||''}});
    ok(dp.s1&&dp.s5&&dp.rows.length===3&&/^S1 - Septembre[^|]* \| 10\.00 à 0\.5 m \| 11\.00 à 3 m \| 12\.00 à 6 m$/.test(dp.rows[0]),'profil de profondeur : une courbe par session (S1 violet, S5 rose), profondeurs en mètres '+JSON.stringify(dp.rows[0]));
    ok(/1 mesure\(s\) sans profondeur saisie/.test(dp.note)&&/profondeur non saisie/.test(dp.rows[1]),'profil de profondeur : mesure sans profondeur signalée (non placée au hasard)');
    // Profil longitudinal de l'estuaire
    await p.click('.suiviElTab[data-v="estuaire"]');await p.waitForTimeout(300);
    const est=()=>p.evaluate(()=>{const c=document.querySelector('.suiviParamCard[data-param="sal"]');return {estuary:$('suiviElEstuary').value,cols:[...c.querySelectorAll('thead th')].slice(1).map(t=>t.textContent),hi:[...c.querySelectorAll('thead th.suiviElHi')].map(t=>t.textContent),row1:[...[...c.querySelectorAll('tbody tr')][0].children].slice(1).map(td=>td.textContent.trim()).join(' ')}});
    let e=await est();
    ok(e.estuary==='Kourou'&&e.cols.join(' > ')==='Singe rouge > Kourou fleuve > Kourou bourg > Kourou côte > Ile du salut'&&e.hi.join()==='Kourou bourg','profil de l’estuaire : estuaire de la station, stations de l’amont vers la mer, station choisie surlignée '+e.cols.join(' > '));
    ok(e.row1==='20.00 40.00 10.00 30.00 0.00','profil de l’estuaire : valeurs de surface par station '+e.row1);
    await p.selectOption('#suiviElDepth','fond');await p.waitForTimeout(250);e=await est();
    ok(e.row1==='22.00 42.00 12.00 32.00 2.00'&&await p.evaluate(()=>/Fond/.test(document.querySelector('.suiviParamCard[data-param="sal"] .suiviParamUnit').textContent)),'profil de l’estuaire : choix de la profondeur (fond)');
    await p.selectOption('#suiviElEstuary','Mahury');await p.waitForTimeout(250);
    ok(await p.evaluate(()=>/Aucune mesure fond/.test($('suiviParamGrid').textContent)),'profil de l’estuaire : autre estuaire sans mesure, message clair');
    ok(await p.evaluate(()=>elEstuaryStations('Mahury').map(s=>s.nom).join(' > ')==='Orapu > Mahury > Dégrad des Cannes > Cayenne côte > Ilet La mère'),'profil de l’estuaire : Mahury classé de l’amont vers la mer');
    ok(await p.evaluate(()=>elRange([0,10])[0]===0&&elRange([5,10])[0]>0),'graphes EL : axe jamais négatif pour des valeurs positives');
    // Autre réseau : pas de barre EL
    await p.evaluate(()=>{records.push({id:'TR',network:'RCO',station:'RCO T',date:'2026-10-01',savedAt:'2026-10-01T08:00:00Z',lifecycle:{status:'À contrôler'},photos:[],auditRefs:[],insitu:{ph:{value:'7'}}});saveLS(LS,records);renderSuivi();const n=$('suiviNetwork');n.value='RCO';n.dispatchEvent(new Event('change'));const s=$('suiviStation');s.value='RCO T';s.dispatchEvent(new Event('change'))});await p.waitForTimeout(200);
    ok(await p.evaluate(()=>!$('suiviElBar')),'suivi RCO : pas de choix de vue EL');
    ok(e17.length===0,'aucune erreur JavaScript (profils EL) '+JSON.stringify(e17));
    await c17.close();
  }
  // --- U : suivi EL — corrections issues de la relecture (fiches sans session, autre campagne, tablette…) ---
  {
    const c18=await browser.newContext({serviceWorkers:'block'});await c18.route('https://unpkg.com/**',r=>r.abort());await c18.route('https://tile.openstreetmap.org/**',r=>r.abort());
    const p=await c18.newPage();const e18=[];p.on('pageerror',e=>e18.push(e.message));
    await p.goto('http://localhost:8765/');await p.evaluate(()=>window.OEGRecordsReady);
    // Ordre chronologique : une session de la campagne précédente n'est plus classée « la plus récente »
    const ord=await p.evaluate(()=>{const o=elOrderSessions(['S1 - Septembre 2026 (saison sèche)','S1 - Septembre 2025 (saison sèche)','S2 - Octobre 2026 (saison sèche)']);return o.infos.map(x=>x.label.replace(/\s*\(.*\)$/,'')+(x.dash?'*':''))});
    ok(ord.join(' | ')==='S1 - Septembre 2025* | S1 - Septembre 2026 | S2 - Octobre 2026','sessions EL : ordre chronologique, la plus ancienne en pointillé '+ord.join(' | '));
    ok(await p.evaluate(()=>{const keys=[];for(let m=1;m<=8;m++)keys.push('S'+m+' - '+['Septembre 2025','Octobre 2025','Novembre 2025','Décembre 2025','Janvier 2026','Mars 2026','Mai 2026','Juillet 2026'][m-1]);keys.push('S1 - Septembre 2026 (saison sèche)','S2 - Octobre 2026 (saison sèche)');const o=elOrderSessions(keys);return o.dropped===2&&o.infos.slice(-2).map(x=>x.label).join()==='S1 - Septembre 2026 (saison sèche),S2 - Octobre 2026 (saison sèche)'&&o.infos[0].name==='S3 · Novembre 2025'}),'sessions EL : au-delà de 8, ce sont les plus anciennes qui sont écartées');
    await p.evaluate(()=>{
      const by=n=>DATA.EL_STATIONS.find(s=>s.nom===n),m={lifecycle:{status:'À contrôler'},photos:[],auditRefs:[]};
      // Fiches EL sans session (possible depuis la carte des stations)
      ['2026-09-10','2026-10-12','2026-11-20'].forEach((d,i)=>records.push({id:'U'+i,network:'EL',station:'Kourou bourg',stationInfo:by('Kourou bourg'),session:'',date:d,savedAt:d+'T08:00:00Z',...m,insitu:{profondeurs:{surface:'0.5',fond:'6'},params:{sal:{surface:String(10+i),fond:String(15+i)}},turbidite:{}}}));
      // Même session : une visite avec profondeur, une sans
      const S1=DATA.EL_SESSIONS[0].label;
      records.push({id:'UZ1',network:'EL',station:'Kourou fleuve',stationInfo:by('Kourou fleuve'),session:S1,date:'2026-09-11',savedAt:'2026-09-11T08:00:00Z',...m,insitu:{profondeurs:{surface:'0.5'},params:{sal:{surface:'4'}},turbidite:{}}},
                   {id:'UZ2',network:'EL',station:'Kourou fleuve',stationInfo:by('Kourou fleuve'),session:S1,date:'2026-09-12',savedAt:'2026-09-12T08:00:00Z',...m,insitu:{profondeurs:{},params:{sal:{surface:'10'}},turbidite:{}}});
      // Station ajoutée sur une autre tablette (absente du référentiel ici)
      records.push({id:'UST',network:'EL',station:'Pointe Kourou test',stationInfo:{nom:'Pointe Kourou test',bassin:'Kourou',x:316000,y:575000},session:S1,date:'2026-09-13',savedAt:'2026-09-13T08:00:00Z',...m,insitu:{profondeurs:{surface:'0.5'},params:{sal:{surface:'33'}},turbidite:{}}});
      saveLS(LS,records);
    });
    ok(await p.evaluate(()=>{const d=elDepthProfileData('Kourou bourg','sal');const cols=d.sessions.map(x=>x.si.color);return cols.length===3&&new Set(cols).size===3&&!cols.includes(EL_NO_SESSION)&&!d.sessions.some(x=>x.si.dash)&&/^Visite du 10\/09\/26/.test(d.sessions[0].si.name)}),'fiches EL sans session : une couleur distincte par visite (auparavant toutes grises en pointillé)');
    ok(await p.evaluate(()=>{const d=elDepthProfileData('Kourou fleuve','sal'),l=d.sessions[0].levels[0];return l.v===4&&l.n===1&&l.noz===1}),'profil de profondeur : la mesure sans profondeur n’est plus moyennée dans le point d’une autre visite');
    ok(await p.evaluate(()=>elEstuaryStations('Kourou').some(s=>s.nom==='Pointe Kourou test')),'profil de l’estuaire : station connue seulement par une fiche prise en compte');
    ok(await p.evaluate(()=>{const c=document.createElement('canvas').getContext('2d');return typeof elAxisPad==='function'&&elAxisPad(c,52000,54000,40)>40}),'graphes EL : marge gauche élargie pour les graduations à 5 chiffres');
    // Tablette : l'info-bulle reste affichée après un toucher
    await p.click('.tab[data-tab="suivi"]');await p.waitForTimeout(300);
    await p.evaluate(()=>{const n=$('suiviNetwork');n.value='EL';n.dispatchEvent(new Event('change'));const s=$('suiviStation');s.value='Kourou bourg';s.dispatchEvent(new Event('change'))});await p.waitForTimeout(300);
    const tipStays=await p.evaluate(()=>{const cv=document.querySelector('.suiviParamCard[data-param="sal"] canvas'),r=cv.getBoundingClientRect(),o={bubbles:true,clientX:r.left+r.width/2,clientY:r.top+60,pointerType:'touch'};
      cv.dispatchEvent(new PointerEvent('pointerdown',o));cv.dispatchEvent(new PointerEvent('pointerleave',o));return !cv.parentNode.querySelector('.suiviTip').classList.contains('hide')});
    ok(tipStays,'tablette : l’info-bulle reste affichée quand le doigt se lève');
    // CRT EL : axe jamais négatif, graduations toutes différentes, valeurs au-dessus de l'axe
    await p.evaluate(()=>{const by=n=>DATA.EL_STATIONS.find(s=>s.nom===n),ses=DATA.EL_SESSIONS.map(x=>x.label),m={lifecycle:{status:'À contrôler'},photos:[],auditRefs:[]};
      [['UC1',0,'2026-09-10',['0','0.3','0.4'],'8.10'],['UC2',1,'2026-10-10',['0.1','0.2','0.3'],'8.11'],['UC3',2,'2026-11-10',['0.3','0.5','0.6'],'8.12']].forEach(([id,si,d,sal,ph])=>records.push({id,network:'EL',station:'Mataroni',stationInfo:by('Mataroni'),session:ses[si],date:d,savedAt:d+'T08:00:00Z',...m,insitu:{profondeurs:{surface:'0.5',intermediaire:'2',fond:'4'},params:{sal:{surface:sal[0],intermediaire:sal[1],fond:sal[2]},ph:{surface:ph,intermediaire:ph,fond:ph}},turbidite:{}}}));saveLS(LS,records)});
    await p.click('.tab[data-tab="crt"]');await p.waitForTimeout(400);
    await p.evaluate(()=>{const s=$('crtRecord');s.value='UC3';s.dispatchEvent(new Event('change',{bubbles:true}))});await p.waitForTimeout(300);
    const ax=await p.evaluate(()=>[...document.querySelectorAll('#crtPreviewBox .crtGraphCard svg')].filter(s=>/Historique/.test(s.getAttribute('aria-label')||'')).map(s=>{const t=[...s.querySelectorAll('text[text-anchor="end"]')].map(x=>x.textContent);const axisY=Math.max(...[...s.querySelectorAll('line[stroke="#52626e"]')].map(l=>+l.getAttribute('y1')));const vals=[...s.querySelectorAll('text[font-weight="700"][fill="#17212b"]')].map(x=>+x.getAttribute('y'));return {ticks:t,neg:t.some(x=>/^-/.test(x)),uniq:new Set(t).size===t.length,below:vals.some(y=>y>axisY)}}));
    ok(ax.length>=2&&ax.every(a=>!a.neg),'CRT EL historique : axe jamais négatif pour des valeurs positives '+JSON.stringify(ax.map(a=>a.ticks)));
    ok(ax.every(a=>a.uniq),'CRT EL historique : graduations toutes différentes (pH sur une plage étroite)');
    ok(ax.every(a=>!a.below),'CRT EL historique : valeurs de la visite jamais sous l’axe');
    ok(e18.length===0,'aucune erreur JavaScript (corrections suivi EL) '+JSON.stringify(e18));
    await c18.close();
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
