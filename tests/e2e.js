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
      records.push(base('R1',st[0],'2026-10-05'),base('R2',st[1],'2027-02-10'));saveLS(LS,records);
    });
    await p.click('.tab[data-tab="crt"]');await p.waitForTimeout(500);
    const pick=id=>p.evaluate(id=>{const s=$('crtRecord');s.value=id;s.dispatchEvent(new Event('change',{bubbles:true}))},id);
    await pick('R1');await p.waitForTimeout(300);
    let txt=await p.textContent('#crtPreviewBox');
    ok(txt.includes('SAISON SÈCHE'),'CRT : visite d’octobre = saison sèche');
    await pick('R2');await p.waitForTimeout(300);
    ok((await p.textContent('#crtPreviewBox')).includes('SAISON DES PLUIES'),'CRT : visite de février = saison des pluies (auparavant toujours « sèche »)');
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
