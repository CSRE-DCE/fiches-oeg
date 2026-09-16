const $=id=>document.getElementById(id), val=id=>($(id)?.value||'');

const LS='oeg_field_v7';
const LSC='oeg_custom_v7';
const OEG_PRELEVEURS=['PF','AA','SM','ML','MG','MB'];
const PRELEVEURS_BY_ORG={HYDRECO:['DB','NB','EV','ER','YK','FC','HL','NG','GQ','FCh'],NBC:['ML','FD','FR','JN','RC'],DGTM:['OPC','MM']};
const PRELEVEUR_ORGS=Object.keys(PRELEVEURS_BY_ORG);

function load(key,fallback){
  try{const v=localStorage.getItem(key); return v?JSON.parse(v):fallback}catch(e){return fallback}
}
function saveLS(key,valeur){
  try{
    localStorage.setItem(key,JSON.stringify(valeur));
    if((key===LS||key===LSC)&&window.OEGSync)window.OEGSync.notifyChange();
    return true;
  }catch(e){
    // Le stockage du navigateur a une limite (souvent 5 à 10 Mo) — les photos, même
    // compressées, peuvent la faire atteindre après plusieurs fiches. Sans ce
    // traitement, l'erreur passait inaperçue et la sauvegarde échouait silencieusement :
    // la fiche (et ses photos) semblait enregistrée alors qu'elle ne l'était pas.
    toast('⚠️ Stockage plein — la sauvegarde a échoué. Exportez vos fiches en JSON (onglet Données) puis supprimez d’anciennes fiches pour libérer de la place.');
    return false;
  }
}
function escapeHTML(v){return String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;')}
function toast(t){let x=document.createElement('div');x.textContent=t;x.style.cssText='position:fixed;left:50%;bottom:92px;transform:translateX(-50%);background:#08477e;color:#fff;padding:10px 16px;border-radius:24px;z-index:9999;font-weight:800;font-size:13px';document.body.appendChild(x);setTimeout(()=>x.remove(),2200)}

let records=load(LS,load('oeg_field_v3',[]));
let custom=load(LSC,load('oeg_custom_v3',{preleveurs:[],stations:[],equipements:[]}));
custom.preleveurs=(custom.preleveurs||[]).map(o=>typeof o==='string'?{nom:o,prenom:'',organisme:o==='PF'||o==='AA'||o==='SM'||o==='ML'||o==='MG'||o==='MB'?'Office de l\'Eau de Guyane':'',legacy:true}:o);
custom.stations=custom.stations||[];
custom.equipements=custom.equipements||[];

let state={network:null,activity:null,bioOperation:null,session:null,station:null,editing:null,preleveurs:[],photos:[],draw:null,signature:null};

const NETWORKS=[
  ['RCO','RCO'],
  ['BIO','BIO'],
  ['ESO','ESO'],
  ['Chimie','Chimie'],
  ['EL','EL']
];

function netLabel(n){return ({RCO:'RCO',BIO:'BIO',ESO:'ESO',Chimie:'Chimie ESC',EL:'EL — suivi littoral'})[n]||n}

/* Icônes des moyens de transport, partagées par la carte, l'itinéraire, l'éditeur d'accès et le CRT. */
const TRANSPORT_ICONS={
  'Voiture':'🚗',
  '4x4':'🚙',
  'À pied':'🥾',
  'Bateau motorisé':'🚤',
  'Bateau motorisé / pirogue':'🛶',
  'Canoë / kayak':'🛶',
  'Avion':'✈️',
  'Autre':'📍'
};
function transportIcon(mode){return TRANSPORT_ICONS[mode]||'📍'}
function transportLabel(mode){return transportIcon(mode)+' '+mode}

const RCO_SESSION_IA = 'S1 - Octobre 2026';
const RCO_COMBINED_ACTIVITY = 'Eau / Sédiments / IA / Diatomées';
const BIO_EAU_ACTIVITY = 'Eau dans le cours d’eau';
const BIO_OPERATIONS = ['PC+IA','PC+IA+ADNe','PC+IA+Phyto'];
const activities=(n,session=state.session)=>{
  if(n==='BIO') return [BIO_EAU_ACTIVITY];
  if(n==='RCO') return [RCO_COMBINED_ACTIVITY];
  return [];
};
const sessions=n=>{
  if(n==='RCO') return ['S1 - Octobre 2026','S2 - Décembre 2026','S3 - Février 2027','S4 - Avril 2027'];
  if(n==='BIO') return ['Campagne biologique 2026'];
  if(n==='ESO') return ['Juillet 2026','Novembre 2026'];
  if(n==='Chimie') return ['S1 - Sept.26','S2 - Déc.26','S3 - Fév.27','S4 - Juin.27'];
  if(n==='EL') return DATA.EL_SESSIONS.map(x=>x.label);
  return [];
};

function uniqueByCode(arr){
  const m=new Map();
  arr.forEach(s=>{
    const k=s.code||s.code_bss||s.nom;
    if(!m.has(k)) m.set(k,{...s});
  });
  return [...m.values()];
}

/* ==================== Import programme de marché (Excel) ==================== */
custom.stationOverrides=custom.stationOverrides||{};
function applyStationOverrides(){
  Object.entries(custom.stationOverrides||{}).forEach(([arrName,rows])=>{
    if(!Array.isArray(DATA[arrName]))return;
    const key=arrName==='ESO'?'code_bss':'code';
    rows.forEach(row=>{
      const idx=DATA[arrName].findIndex(s=>String(s[key])===String(row[key]));
      if(idx>=0)DATA[arrName][idx]=Object.assign({},DATA[arrName][idx],row);
      else DATA[arrName].push(row);
    });
  });
}
applyStationOverrides();

const MI_FIELD_LABELS={code:'Code station',nom:'Nom',x:'X',y:'Y',bv:'Bassin versant',pressions:'Pressions',statut:'Statut'};
const MI_HEADER_HINTS={code:['code','cs station','identite'],nom:['nom','station'],x:['x'],y:['y'],bv:['bassin','bv'],pressions:['pression'],statut:['statut']};
function miGuessField(header){
  const h=(header||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  for(const [field,hints] of Object.entries(MI_HEADER_HINTS)) if(hints.some(hint=>h.includes(hint)))return field;
  return '';
}
let miParsedRows=null,miHeaders=null,miMapping={};
function setupMarketImport(){
  const fileInput=$('miFile');if(!fileInput)return;
  fileInput.onchange=(e)=>{
    const file=e.target.files[0];if(!file)return;
    const reader=new FileReader();
    reader.onload=(ev)=>{
      try{
        const wb=XLSX.read(ev.target.result,{type:'array'});
        const ws=wb.Sheets[wb.SheetNames[0]];
        const rows=XLSX.utils.sheet_to_json(ws,{header:1,defval:''});
        let headerRowIdx=rows.findIndex(r=>r.filter(c=>String(c).trim()).length>=2);
        if(headerRowIdx<0)headerRowIdx=0;
        miHeaders=rows[headerRowIdx].map(h=>String(h||'').trim());
        miParsedRows=rows.slice(headerRowIdx+1).filter(r=>r.some(c=>String(c).trim()));
        miMapping={};
        miHeaders.forEach((h,i)=>{const g=miGuessField(h);if(g&&!Object.values(miMapping).includes(i))miMapping[g]=i});
        renderMiMapping();
      }catch(err){toast('Fichier illisible : '+err.message)}
    };
    reader.readAsArrayBuffer(file);
  };
  function renderMiMapping(){
    const box=$('miMapping');const fields=Object.keys(MI_FIELD_LABELS);
    box.innerHTML='<h3>Correspondance des colonnes</h3><div class="hint">Vérifiez que chaque champ pointe vers la bonne colonne du fichier (Code et Nom sont indispensables).</div><div class="grid2">'+
      fields.map(f=>`<div class="field"><label>${MI_FIELD_LABELS[f]}${f==='code'||f==='nom'?' *':''}</label><select data-mi-field="${f}"><option value="">— ignorer —</option>${miHeaders.map((h,i)=>`<option value="${i}" ${miMapping[f]===i?'selected':''}>${escapeHTML(h||'(colonne '+(i+1)+')')}</option>`).join('')}</select></div>`).join('')+
      '</div><button class="btn ghost small" id="miPreviewBtn">Prévisualiser les différences</button>';
    box.querySelectorAll('[data-mi-field]').forEach(sel=>sel.onchange=()=>{miMapping[sel.dataset.miField]=sel.value===''?undefined:Number(sel.value)});
    $('miPreviewBtn').onclick=renderMiDiff;
  }
  function renderMiDiff(){
    const group=val('miGroup');const key=group==='ESO'?'code_bss':'code';
    if(miMapping.code===undefined||miMapping.nom===undefined){toast('Il faut au moins faire correspondre Code et Nom');return}
    const current=DATA[group]||[];
    const currentByCode=Object.fromEntries(current.map(s=>[String(s[key]||s.code||s.nom),s]));
    const imported=(miParsedRows||[]).map(r=>{
      const o={};
      Object.entries(miMapping).forEach(([f,i])=>{if(i!==undefined){let v=r[i];if((f==='x'||f==='y')&&v!=='')v=Number(v);o[f]=v}});
      if(group==='ESO'){o.code_bss=o.code;delete o.code}
      return o;
    }).filter(o=>o[key]);
    const rowsHtml=imported.map(o=>{
      const cur=currentByCode[String(o[key])];
      let status,diffFields=[];
      if(!cur)status='new';
      else{Object.keys(o).forEach(f=>{if(f!==key&&String(cur[f]??'')!==String(o[f]??''))diffFields.push(f)});status=diffFields.length?'changed':'same'}
      if(status==='same')return '';
      const badge=status==='new'?'<span class="miBadgeNew">Nouvelle</span>':'<span class="miBadgeChanged">Modifiée</span>';
      const detail=status==='changed'?diffFields.map(f=>`${MI_FIELD_LABELS[f]||f} : « ${escapeHTML(String(cur[f]??'—'))} » → « ${escapeHTML(String(o[f]??'—'))} »`).join('<br>'):'Nouvelle station à ajouter au référentiel.';
      return `<div class="miDiffRow"><label class="check"><input type="checkbox" class="miDiffCheck" checked data-code="${escapeHTML(String(o[key]))}"><span><b>${escapeHTML(String(o.nom||o[key]))}</b> (${escapeHTML(String(o[key]))}) ${badge}</span></label><div class="miDiffDetail">${detail}</div></div>`;
    }).join('');
    const missing=current.filter(s=>!imported.some(o=>String(o[key])===String(s[key]||s.code||s.nom)));
    const missingHtml=missing.length?`<div class="banner warn">⚠️ ${missing.length} station(s) du référentiel actuel absente(s) du fichier importé — elles ne sont pas supprimées automatiquement : ${missing.map(s=>escapeHTML(s.nom)).join(', ')}</div>`:'';
    $('miDiff').innerHTML=(rowsHtml||'<div class="hint">Aucune différence détectée : le fichier correspond déjà au référentiel actuel.</div>')+missingHtml;
    window.__miImportedRows=imported;window.__miGroupKey=key;
    $('miApply').disabled=!rowsHtml;
  }
  $('miApply').onclick=()=>{
    const group=val('miGroup');const key=window.__miGroupKey||(group==='ESO'?'code_bss':'code');
    const checked=new Set([...document.querySelectorAll('.miDiffCheck:checked')].map(c=>c.dataset.code));
    const toApply=(window.__miImportedRows||[]).filter(o=>checked.has(String(o[key])));
    if(!toApply.length){toast('Aucune ligne sélectionnée');return}
    custom.stationOverrides[group]=custom.stationOverrides[group]||[];
    toApply.forEach(o=>{
      const idx=custom.stationOverrides[group].findIndex(x=>String(x[key])===String(o[key]));
      if(idx>=0)custom.stationOverrides[group][idx]=o;else custom.stationOverrides[group].push(o);
    });
    saveLS(LSC,custom);applyStationOverrides();
    toast(toApply.length+' station(s) mise(s) à jour ✓');
    $('miDiff').innerHTML='';$('miApply').disabled=true;miParsedRows=null;$('miMapping').innerHTML='';$('miFile').value='';
    if(state.network)fillStations();
    if(typeof window.mapStations==='function')try{window.mapStations()}catch(e){}
  };
}
/* ==================== fin import programme de marché ==================== */
function bioStationsForOperation(op){
  const ce=DATA.BIO_CE||[];
  const key=s=>s.code||s.code_bss||s.nom;
  const ceCodes=new Set(ce.map(key));
  const adneCodes=new Set((DATA.BIO_ADNE||[]).map(key));
  const phytoCodes=new Set((DATA.BIO_PHYTO||[]).map(key));
  if(op==='PC+IA'){
    // PC+IA = stations dont l'opération est uniquement PC+IA,
    // donc exclure les stations qui ont également ADNe ou Phytoplancton.
    return uniqueByCode(ce.filter(s=>{
      const k=key(s); return ceCodes.has(k) && !adneCodes.has(k) && !phytoCodes.has(k);
    }));
  }
  const targetCodes=op==='PC+IA+ADNe' ? adneCodes : phytoCodes;
  return uniqueByCode(ce.filter(s=>targetCodes.has(key(s))));
}

function stationsFor(n,a){
  let arr=[];
  if(n==='RCO'){
    // S1 : prélèvement commun Eau + Sédiments + IA + Diatomées = 13 stations Eau/Sédiments + 12 stations IA/Diat.
    // S2-S4 : seules les 13 stations Eau/Sédiments restent disponibles.
    arr = (state.session===RCO_SESSION_IA)
      ? uniqueByCode([...(DATA.RCO13||[]), ...(DATA.RCO_BIO12||[])])
      : (DATA.RCO13||[]);
  }else if(n==='BIO'){
    if(a===BIO_EAU_ACTIVITY) arr=bioStationsForOperation(state.bioOperation);
  }else if(n==='ESO') arr=DATA.ESO.map(s=>({...s,code:s.code_bss,bassin:s.commune}));
  else if(n==='Chimie') arr=DATA.CH_STATIONS
      .filter(s=>s.sessions && state.session && s.sessions[state.session])
      .map(s=>({...s,bassin:s.bv}));
  else if(n==='EL') arr=DATA.EL_STATIONS;
  const customs=(custom.stations||[]).filter(s=>s.network===n);
  return arr.concat(customs);
}
function getStation(){
  return stationsFor(state.network,state.activity).find(s=>(s.nom||'')===state.station);
}
function fill(id,arr){
  const el=$(id); if(!el)return;
  el.innerHTML='<option value="">— sélectionner —</option>';
  arr.forEach(x=>{
    const o=document.createElement('option');
    if(Array.isArray(x)){o.value=x[0];o.textContent='['+x[0]+'] '+x[1]}
    else{o.value=x;o.textContent=x}
    el.appendChild(o);
  });
}
function renderNetworks(){
  const h=$('networks');h.innerHTML='';
  NETWORKS.forEach(([n])=>{
    const c=document.createElement('div');c.className='chip';c.dataset.n=n;c.textContent=netLabel(n);
    c.onclick=()=>selectNetwork(n);h.appendChild(c);
  });
}
function refreshSiteFields(){const surf=$('surfaceSandre');if(surf)surf.classList.toggle('hide',state.network==='ESO');document.querySelectorAll('.elHide').forEach(e=>e.classList.toggle('hide',state.network==='EL'))}
function reorderNetworkFields(n){
  const card=$('networks')?.closest('.card');
  if(!card)return;
  const activity=$('activityWrap'), bioOp=$('bioOperationWrap'), session=$('sessionWrap');
  if(!activity||!bioOp||!session)return;
  if(n==='RCO'){
    card.insertBefore(session,activity);
    card.insertBefore(activity,session.nextSibling);
  }else{
    card.insertBefore(activity, session);
    card.insertBefore(bioOp, session);
  }
}
function selectNetwork(n){
  state.network=n;state.activity=null;state.session=null;state.station=null;state.preleveurs=[];
  document.querySelectorAll('#networks .chip').forEach(c=>c.classList.toggle('sel',c.dataset.n===n));
  reorderNetworkFields(n);
  const acts=activities(n,null), sess=sessions(n);
  $('activityWrap').classList.toggle('hide',!acts.length);fill('activity',acts);
  $('bioOperationWrap').classList.add('hide');fill('bioOperation',BIO_OPERATIONS);$('bioOperation').value='';state.bioOperation=null;
  $('sessionWrap').classList.toggle('hide',!sess.length);fill('session',sess);
  const notes={
    RCO:'CCTP RCO 2026-27 : 4 sessions — octobre 2026, décembre 2026, février 2027 et avril 2027. Eau + Sédiments + IA + Diatomées constituent un prélèvement commun ; les 12 stations IA/Diat sont disponibles uniquement en S1.',
    BIO:'Type de suivi / opération : Eau dans le cours d’eau ou Poissons. Pour Eau dans le cours d’eau : PC+IA (stations uniquement PC+IA), PC+IA+ADNe ou PC+IA+Phyto.',
    ESO:'Onglet ESO calé sur la fiche terrain ESO transmise : ouvrage, purge, prélèvement, mesures in situ, filtration et remise.',
    Chimie:'Fiche terrain Chimie transmise : prélèvement, filtration, conservation, caractérisation du site et mesures in situ.',
    EL:'Réseau EL repris de l’application terrain OEG transmise.'
  };
  $('cctpNote').textContent=notes[n]||'';$('cctpNote').classList.toggle('hide',!notes[n]);
  fillStations();refreshSiteFields();hideForm();
}
function fillStations(){
  const list=stationsFor(state.network,state.activity),el=$('station');el.innerHTML='<option value="">— sélectionner —</option>';
  list.forEach(s=>{
    const o=document.createElement('option');o.value=s.nom||'';
    o.textContent=(s.nom||'')+(s.protocoles&&s.protocoles.length?' — '+s.protocoles.join(' + '):'');
    el.appendChild(o);
  });
  $('stationHint').textContent=list.length?`${list.length} station(s) disponibles.`:'Aucune station programmée pour cette sélection.';
}
$('activity').onchange=()=>{
  state.activity=val('activity');state.station=null;
  const isBioEau=state.network==='BIO' && state.activity===BIO_EAU_ACTIVITY;
  $('bioOperationWrap').classList.toggle('hide',!isBioEau);
  if(isBioEau){fill('bioOperation',BIO_OPERATIONS);$('bioOperation').value=state.bioOperation||'';}
  else {state.bioOperation=null;$('bioOperation').value='';}
  fillStations();hideForm();
};
$('bioOperation').onchange=()=>{
  state.bioOperation=val('bioOperation');state.station=null;fillStations();hideForm();
};
$('session').onchange=()=>{
  state.session=val('session');
  if(state.network==='RCO'){
    // L'activité RCO reste unique : Eau + Sédiments + IA + Diatomées.
    // La restriction porte uniquement sur les stations IA/Diat (disponibles en S1 seulement).
    state.activity=RCO_COMBINED_ACTIVITY;
    fill('activity',activities('RCO',state.session));
  }
  state.station=null;fillStations();hideForm();
};
$('station').onchange=()=>{
  state.station=val('station');
  if(!state.station){hideForm();return}
  renderAuto();refreshSiteFields();showForm();buildAll();
};

function dedupeProgram(v){
  const s=String(v||'').trim().replace(/\s+/g,' ');
  if(!s)return '';
  const m=s.match(/^(.+?)\s+\1(?:\s+\1)*$/);
  return m?m[1]:s;
}
function renderAuto(){
  const s=getStation(); if(!s)return;
  $('autoCard').classList.remove('hide');
  const rows=[];
  if(state.network==='ESO'){
    rows.push(['Code BSS',s.code_bss],['Commune',s.commune],['Type de point',s.type_point],['Aquifère',s.aquifere],['Environnement',s.environnement],['Pression',s.pression],['Année entrée réseau',s.annee]);
  }else if(state.network==='Chimie'){
    rows.push(['Code station',s.code],['Code masse d’eau',s.code_me],['Bassin versant / commune',s.bassin||s.bv||s.commune||''],['Statut',s.statut||''],['Pressions',s.pressions||'']);
  }else{
    rows.push(['Code station',s.code],['Code masse d’eau',s.code_me],['Bassin / commune',s.bassin||s.bv||s.commune||''],['Statut',s.statut||''],['Pressions',s.pressions||'']);
    if(s.operateur)rows.push(['Opérateur / programme',dedupeProgram(s.operateur)]);
  }
  $('auto').innerHTML='';
  rows.forEach(([lab,v])=>{
    const d=document.createElement('div');d.className='field';
    d.innerHTML=`<label>${escapeHTML(lab)}</label><input class="readonly" readonly value="${escapeHTML(v)}">`;
    $('auto').appendChild(d);
  });
  $('xTheo').value=Number.isFinite(Number(s.x))?s.x:'';
  $('yTheo').value=Number.isFinite(Number(s.y))?s.y:'';
  updateDistance();
}
function showForm(){
  ['missionCard','siteCard','insituCard','sampleCard','specificCard','mediaCard','obsCard','signCard'].forEach(id=>$(id).classList.remove('hide'));
}
function hideForm(){
  $('autoCard').classList.toggle('hide',!state.station);
  ['missionCard','siteCard','insituCard','sampleCard','specificCard','mediaCard','obsCard','signCard'].forEach(id=>$(id).classList.add('hide'));
}

const W=[['1','Ensoleillé'],['2','Faiblement nuageux'],['8','Fortement nuageux'],['3','Temps humide'],['4','Pluie fine'],['5','Pluie forte / orage'],['6','Neige'],['7','Gel'],['9','Conditions crépusculaires'],['10','Temps sec']];
const S={
  seuil:[['0','Inconnu'],['1','Amont d’un seuil'],['2','Aval d’un seuil'],['3','Absence de seuil'],['4','Entre deux seuils'],['5','Sur un seuil'],['6','Un seuil à l’intérieur du point'],['7','Plusieurs seuils à l’intérieur du point']],
  type:[['0','Inconnu'],['1','De la rive'],['2','À pied dans le lit'],['3','Depuis un pont'],['4','Depuis une embarcation']],
  hydro:[['0','Inconnu'],['1','Pas d’eau'],['2','Trous d’eau / flaques / stagnante'],['3','Basses eaux'],['4','Moyennes eaux'],['5','Lit plein ou presque'],['6','Crue débordante']],
  aspect:[['1','Propre'],['2','Sale']],
  yn0:[['0','Inconnu ou non réalisé'],['1','Oui'],['2','Non']],
  yn:[['1','Oui'],['2','Non']],
  teinte:[['1','Incolore'],['2','Bleu'],['3','Bleu-vert'],['4','Vert'],['5','Vert-jaune'],['6','Jaune'],['7','Jaune-marron'],['8','Marron-clair'],['9','Marron-foncé'],['10','Gris'],['11','Noir'],['12','Blanc']],
  coloration:[['0','Inconnu ou non réalisé'],['1','Incolore'],['2','Légèrement coloré'],['3','Très coloré']],
  limpidite:[['0','Inconnu ou non réalisé'],['1','Limpide'],['2','Légèrement trouble'],['3','Trouble']],
  odeur:[['0','Inconnu ou non réalisé'],['1','Sans'],['2','Légère'],['3','Forte']],
  ombre:[['1','Absent'],['2','Faible'],['3','Importante']],
  debit:[['0','Inconnu'],['1','Stable'],['2','En augmentation'],['3','En diminution'],['4','Irrégulier']]
};
function setupSandre(){
  fill('meteo',W);
  [['seuil','seuil'],['typePrelSandre','type'],['hydro','hydro'],['aspect','aspect'],['irisations','yn0'],['mousse','yn0'],['feuilles','yn0'],['boues','yn0'],['autresCorps','yn'],['teinte','teinte'],['coloration','coloration'],['limpidite','limpidite'],['odeur','odeur'],['ombre','ombre'],['debitTendance','debit']].forEach(x=>fill(x[0],S[x[1]]));
}
setupSandre();

function operatorDisplay(o){
  if(typeof o==='string')return o;
  if(o.legacy && o.nom && !o.prenom)return o.nom;
  return [o.prenom,o.nom].filter(Boolean).join(' ')||o.nom||'';
}
function operatorOrg(o){
  if(typeof o==='string')return o;
  return o.organisme||'';
}
function orgOptions(){
  const orgs=["Office de l'Eau de Guyane",...(custom.preleveurs||[]).map(operatorOrg).filter(Boolean)];
  return [...new Set(orgs)];
}
function renderOrgOptions(selected){
  (function renderOrgOptionsCore(selected){
    const h=$('org'); if(!h)return;
    h.innerHTML='';
    orgOptions().forEach(o=>{const op=document.createElement('option');op.value=o;op.textContent=o;h.appendChild(op)});
    if(selected && orgOptions().includes(selected))h.value=selected;
  })(selected);
  /* Rafraîchit les listes signataire / validateur (ancien correctif) */
  if(typeof window.refreshPeople==='function')window.refreshPeople();
  /* Organismes fixes (OEG + HYDRECO/NBC/DGTM) + listes préleveurs dédiées (ancien correctif) */
  const h=$('org');
  if(h && typeof window.orgList==='function'){
    const sel2=selected??h.value;
    h.innerHTML=window.orgList().map(o=>'<option value="'+escapeHTML(o)+'">'+escapeHTML(o)+'</option>').join('');
    if(window.orgList().includes(sel2))h.value=sel2;
  }
  if(typeof window.fillOrgSelect==='function')window.fillOrgSelect('newOpOrg');
  if(typeof window.refreshPreUI==='function')window.refreshPreUI();
}
function allPreForOrg(org){
  const base=org==="Office de l'Eau de Guyane"?OEG_PRELEVEURS:[];
  const extra=(custom.preleveurs||[]).filter(o=>operatorOrg(o)===org).map(operatorDisplay);
  return [...new Set([...base,...extra])];
}
$('org').onchange=()=>{state.preleveurs=[];renderPre()};
function equipmentByGmao(code){return (custom.equipements||[]).find(e=>e.gmao===code)}

function radios(name){
  return `<div class="radioGrid">
    <label class="radio"><input type="radio" name="${name}" value="in-situ"> In situ</label>
    <label class="radio"><input type="radio" name="${name}" value="seau"> Seau / intermédiaire</label>
  </div>`;
}
function yesNo(name){
  return `<div class="radioGrid">
    <label class="radio"><input type="radio" name="${name}" value="Oui"> Oui</label>
    <label class="radio"><input type="radio" name="${name}" value="Non"> Non</label>
  </div>`;
}
function eqSelect(id,type){
  const arr=(custom.equipements||[]).filter(e=>!type||e.type===type);
  return `<select id="${id}"><option value="">— sélectionner le code GMAO —</option>${arr.map(e=>`<option value="${escapeHTML(e.gmao)}">${escapeHTML(e.gmao)}</option>`).join('')}</select>`;
}
function eqInfo(prefix){
  return `<div class="grid2">
    <div class="field"><label>Nom</label><input class="readonly" id="${prefix}_nom" readonly></div>
    <div class="field"><label>N° série</label><input class="readonly" id="${prefix}_serie" readonly></div>
  </div>`;
}
function bindEqSelect(selectId,prefix){
  const el=$(selectId);if(!el)return;
  el.onchange=()=>{
    const e=equipmentByGmao(el.value);
    if($(`${prefix}_nom`))$(`${prefix}_nom`).value=e?.nom||'';
    if($(`${prefix}_serie`))$(`${prefix}_serie`).value=e?.serie||'';
  };
}


function isEL(){return state.network==='EL'}
function elStationType(){return getStation()?.type||'MEC'}
function elSelect(id, options, selected=''){
  const o=document.createElement('select');o.id=id;
  o.innerHTML='<option value="">— sélectionner —</option>'+options.map(x=>`<option value="${escapeHTML(x)}">${escapeHTML(x)}</option>`).join('');
  o.value=selected;return o;
}
// Listes déroulantes reprises du classeur FT_EL_2024-2025_v2 (onglet « Liste paramètres »).
const EL_METEO=['Ensoleillé','Couvert','Crachin','Averse'];
const EL_MER=['Belle','Peu agitée','Agitée'];
const EL_MAREE=['Montante','Etal','Descendante'];
const EL_MOYEN_ECH=['Btle NISKIN ou équivalent','Autre'];
const EL_CONSERVATION=['Glacière réfrigérée','Réfrigérateur','Bloc','Autre'];
const EL_ACTIVITES=['Port maritime','Port de plaisance','Pêche','Dragage'];
const EL_TEINTE=['Marron','Bleu','Vert','Jaune','Gris','Noir','Blanc'];
const EL_HYDRO=['Basse eau','Moyenne eau','Haute eau','Crue débordante'];
const EL_INTENSITE=['Peu colorée','Très colorée','Incolore'];
const EL_ASPECT=['Propre','Sale'];
const EL_TYPEPREL=['Rive','Pont','Embarcation'];
const EL_LIMP=['Limpide','Peu trouble','Trouble'];
const EL_OMBRE=['Absente','Faible','Importante'];
const EL_INC=['Oui','Non'];
/* Codes des appareils repris de l’onglet « Liste paramètres » du modèle Excel EL. */
const EL_PROBES={
  temp:['CSRE-02.MIL.V-1','CSRE-02.MIL.V-2','CSRE-02.MIL.V-3','CSRE-02.MIL.V-4','CSRE-02.MIL.V-5'],
  ph:['CSRE-02.SND.PH.VI-7b','CSRE-02.SND.PH.VI-7c','CSRE-02.SND.PH.VI-7d','CSRE-02.SND.PH.VI-7e','CSRE-02.SND.PH.VI-7f'],
  sal:['CSRE-02.SND.COND.VI-1','CSRE-02.SND.COND.VI-5','CSRE-02.SND.COND.V-3'],
  condus:['CSRE-02.SND.COND.VI-1','CSRE-02.SND.COND.VI-5','CSRE-02.SND.COND.V-3'],
  condms:['CSRE-02.SND.COND.VI-1','CSRE-02.SND.COND.VI-5','CSRE-02.SND.COND.V-3'],
  o2mg:['CSRE-02.SND.OXY.V-1','CSRE-02.SND.OXY.VI-6'],
  o2pc:['CSRE-02.SND.OXY.V-1','CSRE-02.SND.OXY.VI-6'],
  turb:['CSRE-02.TUR.I-1','CSRE-02.TUR.I-3','CSRE-02.TUR.II-3','CSRE-02.TUR.','CSRE-02.TUR.III-6','CSRE-02.TUR.III-10']
};
const EL_PARAM_LABELS={temp:'T (°C)',ph:'pH (u.pH)',sal:'Salinité',condus:'Cond. (µS/cm)',condms:'Cond. (mS/cm)',o2mg:'O₂ (mg O₂/L)',o2pc:'O₂ (%)'};
function elProbeSelect(k){
  const fixed=EL_PROBES[k]||[];
  const custom_gmao=(custom.equipements||[]).filter(e=>e.type==='sonde').map(e=>e.gmao).filter(Boolean);
  const opts=[...new Set([...fixed,...custom_gmao])];
  return '<div class="elProbeCell"><div class="elProbeLabel">Code sonde / appareil</div><select class="elProbeSelect" id="el_probe_'+k+'"><option value="">— sélectionner —</option>'+opts.map(x=>'<option value="'+escapeHTML(x)+'">'+escapeHTML(x)+'</option>').join('')+'</select></div>';
}
function buildELInsitu(){
  const h=$('insitu'); if(!h)return;
  const params=[
    ['temp','T (°C)','°C'],['ph','pH (u.pH)','u.pH'],['sal','Salinité',''],['condus','Cond. (µS/cm)','µS/cm'],
    ['condms','Cond. (mS/cm)','mS/cm'],['o2mg','O2 (mg O2/L)','mg O2/L'],['o2pc','O2 (%)','%']
  ];
  h.innerHTML=`<div class="elHead"><div><b>MESURE IN SITU — EL</b><div class="hint" style="color:#fff">Niveaux réels mesurés à chaque profondeur · code appareil associé à chaque paramètre · turbidité sur 3 mesures</div></div><span class="elBadge">${escapeHTML(elStationType())}</span></div>
  <div class="field"><label>Boîtier / appareil multiparamètre</label>${eqSelect('insituBoitier','boitier')}</div>
  <div class="field"><label>Profondeur totale (m)</label><input id="elDepth" type="number" step="any" value="${elStationType()==='MEC'?'10':''}"><div class="hint">Renseigner ici calcule automatiquement les niveaux ci-dessous : surface 0,5 m · intermédiaire = profondeur totale / 2 · fond = profondeur totale − 1 m. Les valeurs restent modifiables ensuite.</div></div>
  <table class="elTable"><thead><tr><th>Paramètre</th><th>Surface<br><span class="hint">Niveau (m)</span></th><th>Mesure intermédiaire<br><span class="hint">Niveau (m)</span></th><th>Fond -1 m<br><span class="hint">Niveau (m)</span></th><th>Code sonde / appareil</th></tr></thead><tbody>
  <tr><td><b>Niveaux</b><div class="hint">Profondeur relevée sur le terrain</div></td>${['surf','inter','fond'].map(d=>`<td class="elDepth"><input id="el_depth_${d}" type="number" step="any" inputmode="decimal" placeholder="m"></td>`).join('')}<td class="hint">Chaque valeur est enregistrée séparément.</td></tr>
  ${params.map(p=>`<tr><td>${p[1]}<div class="hint">${p[2]}</div></td>${['surf','inter','fond'].map(d=>`<td><input id="el_${p[0]}_${d}" type="number" step="any" inputmode="decimal"></td>`).join('')}<td>${elProbeSelect(p[0])}</td></tr>`).join('')}
  <tr><td>Turb. (NTU)<div class="hint">3 mesures / profondeur · seule la moyenne est reprise dans le CRT</div></td>${['surf','inter','fond'].map(d=>`<td><div class="elTurbGrid">${[1,2,3].map(n=>`<input id="el_turb_${d}_${n}" type="number" step="any" inputmode="decimal" placeholder="M${n}">`).join('')}</div><div class="elTurbAvg" id="el_turb_avg_${d}">Moyenne : —</div></td>`).join('')}<td>${elProbeSelect('turb')}</td></tr>
  </tbody></table>`;
  ['surf','inter','fond'].forEach(d=>[1,2,3].forEach(n=>$(`el_turb_${d}_${n}`).addEventListener('input',()=>refreshELTurb(d))));
  $('elDepth').addEventListener('input',refreshELDepthLevels);
}
function refreshELTurb(d){
  const vals=[1,2,3].map(n=>Number(val(`el_turb_${d}_${n}`)));
  const a=$(`el_turb_avg_${d}`); const all=vals.every(Number.isFinite);
  if(a)a.textContent='Moyenne des 3 mesures : '+(all?(vals.reduce((x,y)=>x+y,0)/3).toFixed(2)+' NTU':'—');
}
function refreshELDepthLevels(){
  const total=Number(val('elDepth'));
  if(!Number.isFinite(total)||total<=0)return;
  if($('el_depth_surf'))$('el_depth_surf').value=0.5;
  if($('el_depth_inter'))$('el_depth_inter').value=(total/2).toFixed(2);
  if($('el_depth_fond'))$('el_depth_fond').value=(total-1).toFixed(2);
}
function buildELSite(){
  const c=$('siteCard');if(!c)return;
  const mec=elStationType()==='MEC';
  c.innerHTML=`<h2>${mec?'7 · Conditions du site — MEC':'7 · Conditions du site — MET'}</h2>
  <div class="elSectionTitle">Conditions générales</div>
  <div class="grid2"><div class="field"><label>Météo</label><select id="meteo">${EL_METEO.map(x=>`<option>${x}</option>`).join('')}</select>
  </div>${mec?`<div class="field"><label>État de la mer</label><select id="elMer"><option></option>${EL_MER.map(x=>`<option>${x}</option>`).join('')}</select></div>
  <div class="field"><label>Marée</label><select id="elMaree"><option></option>${EL_MAREE.map(x=>`<option>${x}</option>`).join('')}</select></div>
  <div class="field"><label>Coefficient de marée</label><input id="elCoefMaree" type="number" step="any"></div>`:
  `<div class="field"><label>Situation hydrologique</label><select id="hydro"><option></option>${EL_HYDRO.map(x=>`<option>${x}</option>`).join('')}</select></div>`}</div>
  ${mec?`<div class="elSectionTitle">Contexte du prélèvement</div><div class="grid2"><div class="field"><label>Activités anthropiques</label><select id="elActivites"><option value="">— sélectionner —</option>${EL_ACTIVITES.map(x=>`<option>${x}</option>`).join('')}</select></div></div>`:
  `<div class="elSectionTitle">Observations de l'eau et des abords</div><div class="grid2">
  <div class="field"><label>Limpidité de l'eau</label><select id="limpidite"><option></option>${EL_LIMP.map(x=>`<option>${x}</option>`).join('')}</select></div>
  <div class="field"><label>Teinte de l'eau</label><select id="teinte"><option></option>${EL_TEINTE.map(x=>`<option>${x}</option>`).join('')}</select></div>
  <div class="field"><label>Irisation sur l'eau</label><select id="irisations"><option></option>${EL_INC.map(x=>`<option>${x}</option>`).join('')}</select></div>
  <div class="field"><label>Mousse de détergent</label><select id="mousse"><option></option>${EL_INC.map(x=>`<option>${x}</option>`).join('')}</select></div>
  <div class="field"><label>Boues organiques flottantes</label><select id="boues"><option></option>${EL_INC.map(x=>`<option>${x}</option>`).join('')}</select></div>
  <div class="field"><label>Intensité</label><select id="elIntensite"><option></option>${EL_INTENSITE.map(x=>`<option>${x}</option>`).join('')}</select></div>
  <div class="field"><label>Ombre</label><select id="ombre"><option></option>${EL_OMBRE.map(x=>`<option>${x}</option>`).join('')}</select></div>
  <div class="field"><label>Type de prélèvement</label><select id="typePrelSandre"><option></option>${EL_TYPEPREL.map(x=>`<option>${x}</option>`).join('')}</select></div>
  <div class="field"><label>Feuilles, branches, litière</label><select id="feuilles"><option></option>${EL_INC.map(x=>`<option>${x}</option>`).join('')}</select></div>
  <div class="field"><label>Aspect des abords</label><select id="aspect"><option></option>${EL_ASPECT.map(x=>`<option>${x}</option>`).join('')}</select></div>
  <div class="field"><label>Incidence activité humaine</label><select id="elIncidence"><option></option>${EL_INC.map(x=>`<option>${x}</option>`).join('')}</select></div></div>`}
  <div class="field"><label>Observations</label><textarea id="siteObs"></textarea></div>`;
}
function buildELSample(){
  const h=$('sample');if(!h)return;const mec=elStationType()==='MEC';
  h.innerHTML=`<div class="elHead"><div><b>ÉCHANTILLONNAGE — EL</b><div class="hint" style="color:#fff">Rubriques reprises du modèle Excel FT_EL</div></div><span class="elBadge">${mec?'MEC':'MET'}</span></div>
  <div class="grid2"><div class="field"><label>Gants nitriles à usage unique</label>${yesNo('gants')}</div>
  <div class="field"><label>Moyen d'échantillonnage</label><select id="elMoyenEchSample"><option value="">— sélectionner —</option>${EL_MOYEN_ECH.map(x=>`<option>${x}</option>`).join('')}</select></div>
  ${mec?`<div class="field"><label>Chlorophylle</label>${yesNo('elChloro')}</div><div class="field"><label>Filtre chlorophylle</label><input id="elFiltreChloro" value="Filtre acétate de cellulose"></div><div class="field"><label>Vf chlorophylle (mL)</label><input id="elVfChloro" type="number" step="any"></div>`:''}
  </div>
  <h3>Transport / remise</h3><div class="grid2"><div class="field"><label>Moyen de refroidissement</label><select id="transportFroid"><option></option><option>Glacières + blocs eutectiques</option><option>Véhicule réfrigéré</option><option>Autre</option></select></div><div class="field"><label>Suivi température</label><select id="transportSuivi"><option></option><option>Pastilles min/max</option><option>Thermomètre flacon</option><option>Enregistreur</option></select></div><div class="field"><label>Organisme récepteur</label><input id="recepteur"></div><div class="field"><label>Date / heure remise</label><input id="remise" type="datetime-local"></div></div>`;
  setTimeout(()=>receivers('recepteur'),0);
}
function buildInsitu(){
  (function buildInsituCore(){
  const h=$('insitu');h.innerHTML='';
  const ps=[
    ['ph','pH','u.pH','sonde'],
    ['temp','Température eau','°C','sonde'],
    ['cond','Conductivité à 25°C','µS/cm','sonde'],
    ['o2mg','Oxygène dissous','mg/L O2','sonde'],
    ['o2pc','Saturation O2','%','sonde'],
    ['turb','Turbidité','NTU','sonde'],
    ['air','Température air','°C','sonde']
  ];
  ps.splice(3,0,['sal','Salinité','','sonde']);
  ps.push(['redox','Potentiel redox','mV/ENH','sonde']);
  if(state.network==='ESO'){
    h.innerHTML=`<div class="note">Mode de mesure commun à toutes les sondes.</div>
      <div class="grid2"><div class="field"><label>Mode de mesure</label>${radios('eso_mode')}</div><div class="field"><label>Boîtier / appareil multiparamètre</label>${eqSelect('insituBoitier','boitier')}</div></div>
      <table class="table"><thead><tr><th>Paramètre</th><th>Valeur</th><th>Code GMAO sonde/capteur</th><th>Nom</th><th>N° série</th><th>Étalonnage</th><th>Contrôle</th></tr></thead><tbody id="esoSensorTable"></tbody></table>`;
    const tb=$('esoSensorTable');
    ps.filter(x=>x[0]!=='air').forEach(p=>{
      const tr=document.createElement('tr');
      tr.innerHTML=`<td><b>${escapeHTML(p[1])}</b><br><span class="hint">${escapeHTML(p[2])}</span></td>
        <td><input id="iv_${p[0]}" type="number" step="any"><span id="ivs_${p[0]}"></span></td>
        <td>${eqSelect('ig_'+p[0],'sonde')}</td>
        <td><input class="readonly" id="ign_${p[0]}" readonly></td>
        <td><input class="readonly" id="igs_${p[0]}" readonly></td>
        <td><input id="ic_${p[0]}" type="date"></td>
        <td><select id="iq_${p[0]}"><option></option><option>Oui</option><option>Non</option></select></td>`;
      tb.appendChild(tr);const el=$('ig_'+p[0]); el.onchange=()=>{
        const e=equipmentByGmao(el.value);
        $('ign_'+p[0]).value=e?.nom||'';$('igs_'+p[0]).value=e?.serie||'';
      };
    });
    return;
  }
  let t=`<div class="grid2"><div class="field"><label>Mode de mesure</label>${radios('global_mode')}</div><div class="field"><label>Boîtier / appareil multiparamètre</label>${eqSelect('insituBoitier','boitier')}</div></div><table class="table"><thead><tr><th>Paramètre</th><th>Valeur</th><th>Code GMAO sonde/capteur</th><th>Nom</th><th>N° série</th><th>Étalonnage</th><th>Contrôle</th></tr></thead><tbody>`;
  ps.filter(p=>p[0]!=='redox').forEach(p=>t+=`<tr><td><b>${escapeHTML(p[1])}</b><br><span class="hint">${escapeHTML(p[2])}</span></td><td><input id="iv_${p[0]}" type="number" step="any"><span id="ivs_${p[0]}"></span></td><td>${eqSelect('ig_'+p[0],'sonde')}</td><td><input class="readonly" id="ign_${p[0]}" readonly></td><td><input class="readonly" id="igs_${p[0]}" readonly></td><td><input id="ic_${p[0]}" type="date"></td><td><select id="iq_${p[0]}"><option></option><option>Oui</option><option>Non</option></select></td></tr>`);
  t+='</tbody></table>';h.innerHTML+=t;
  ps.filter(p=>p[0]!=='redox').forEach(p=>{
    const el=$('ig_'+p[0]);if(el)el.onchange=()=>{const e=equipmentByGmao(el.value);$('ign_'+p[0]).value=e?.nom||'';$('igs_'+p[0]).value=e?.serie||''};
  });
  })();
  /* Badge métrologique après sélection GMAO (ancien correctif) */
  document.querySelectorAll('select[id^="ig_"]').forEach(sel=>{
    const p=sel.id.slice(3);let badge=document.getElementById('ims_'+p);if(!badge){badge=document.createElement('div');badge.id='ims_'+p;sel.parentElement.appendChild(badge)}
    const render=()=>{const st=equipStatus(equipmentByGmao(sel.value));badge.className='metrologyStatus '+st.cls;badge.textContent=st.label;};
    sel.addEventListener('change',render);render();
  });
  /* Colonne "Mode" (in-situ / seau) par sonde, ajoutée après coup (ancien correctif) */
  setTimeout(()=>{
    document.querySelectorAll('#insitu table').forEach(t=>{const th=t.querySelector('thead tr');if(th&&!th.querySelector('.modeHead')){const x=document.createElement('th');x.className='modeHead';x.textContent='Mode';th.insertBefore(x,th.children[1]);t.querySelectorAll('tbody tr').forEach(tr=>{const ig=tr.querySelector('select[id^="ig_"]');const key=ig?.id.slice(3);if(!key)return;const td=document.createElement('td');td.innerHTML='<select id="imode_'+key+'"><option value="">—</option><option value="in-situ">in-situ</option><option value="seau">seau / intermédiaire</option></select>';tr.insertBefore(td,tr.children[1]);const old=state.editing&&records.find(r=>r.id===state.editing)?.insitu?.[key]?.mode;if(old)td.firstElementChild.value=old})}});
  },0);
  /* Turbidité : trois mesures obligatoires par station + moyenne calculée automatiquement */
  (function buildInsituTurbCore(){
    const base=$('iv_turb');
    if(!base)return;
    const cell=base.parentElement;
    if(cell.querySelector('.turbReplicates'))return;
    const oldValue=base.value;
    base.style.display='none';
    const status=$('ivs_turb'); if(status)status.style.display='none';
    const wrap=document.createElement('div');wrap.className='turbReplicates';wrap.style.cssText='display:grid;grid-template-columns:repeat(3,minmax(70px,1fr));gap:6px;margin-top:4px';
    ['1','2','3'].forEach(n=>{const lab=document.createElement('label');lab.className='hint';lab.innerHTML='Mesure '+n+'<input id="iv_turb_'+n+'" type="number" step="any" inputmode="decimal" placeholder="NTU" aria-label="Turbidité mesure '+n+'" required>';wrap.appendChild(lab)});
    cell.insertBefore(wrap,base);
    const avg=document.createElement('div');avg.id='iv_turb_moyenne';avg.className='hint';avg.style.marginTop='4px';avg.textContent='Moyenne des 3 mesures : —';
    cell.insertBefore(avg,base);
    function refreshTurbAverage(){
      const vals=[1,2,3].map(n=>Number(val('iv_turb_'+n))).filter(Number.isFinite);
      avg.textContent='Moyenne des 3 mesures : '+(vals.length===3?((vals[0]+vals[1]+vals[2])/3).toFixed(2)+' NTU':'—');
    }
    ['1','2','3'].forEach(n=>$('iv_turb_'+n).addEventListener('input',refreshTurbAverage));
    const existing=state.editing&&records.find(r=>r.id===state.editing)?.insitu?.turb;
    const vals=Array.isArray(existing?.mesures)?existing.mesures:[existing?.value,existing?.value,existing?.value];
    vals.slice(0,3).forEach((v,i)=>{if(v!==undefined&&v!==null&&v!==''&&$('iv_turb_'+(i+1)))$('iv_turb_'+(i+1)).value=v});
    if(!existing&&oldValue){['1','2','3'].forEach(x=>$('iv_turb_'+x).value=oldValue)}
    refreshTurbAverage();
  })();
  /* Suppression du champ global "Mode de mesure" + reset des sélecteurs par sonde (ancien correctif) */
  setTimeout(()=>{
    $('insitu')?.querySelectorAll('.field').forEach(f=>{if(f.querySelector('label')?.textContent.trim()==='Mode de mesure')f.remove()});
    $('insitu')?.querySelectorAll('select[id^="imode_"]').forEach(sel=>{if(!sel.value)sel.value=''});
  },0);
}
function filterPanel(prefix=''){ 
  const p=prefix;
  const idk=k=>p+k;
  const col=(key,label)=>`<div class="filterCol">
    <div class="filterHead"><label class="check" style="border:0;padding:0;background:transparent"><input type="checkbox" id="filtreParam_${idk(key)}" value="Oui"><span>${label}${key==='autres'?': <input id="filtre_${idk(key)}_nom" type="text" placeholder="préciser" style="width:120px;display:inline-block;margin-left:4px">':''}</span></label></div>
    <div class="field"><label>Volume filtré (mL)</label><input id="filtre_${idk(key)}_volume" type="number" step="any" disabled></div>
    <div class="field"><label>Mode de filtration réalisé</label><div class="radioGrid filterModes">
      <label class="radio"><input type="radio" name="filtreMode_${idk(key)}" value="Sous vide à l’aide d’une pompe" disabled> Sous vide à l’aide d’une pompe</label>
      <label class="radio"><input type="radio" name="filtreMode_${idk(key)}" value="À l’aide d’une seringue + filtre" disabled> À l’aide d’une seringue + filtre</label>
    </div></div>
  </div>`;
  return `<div class="field"><label>Échantillons filtrés sur site ?</label>${yesNo('filtresSite'+(p||''))}</div>
  <div id="filterDateWrap${p}" class="grid2 hide"><div class="field"><label>Date de filtration</label><input id="filtreDate${p}" type="date"></div><div class="field"><label>Heure de filtration</label><input id="filtreHeure${p}" type="time"></div></div>
  <div class="filterTable"><div class="filterBanner"><div>Paramètre(s) filtré(s)</div>${col('chloro','Chlorophylle')}${col('metaux','Métaux')}${col('autres','Autre')}</div></div>
  <h3>Agents de conservation rajoutés sur site ?</h3>${yesNo('consOui'+(p||''))}
  <div id="consFields${p}" class="hide">
    ${(state.network==='BIO'?['HYDRECO']:['HYDRECO','EUROFINS']).map((lab,i)=>`<div class="labBlock"><div class="labTitle">Flaconnage du laboratoire ${i+1} : <input id="consLab${p}${i}" value="${lab}" class="labInput"></div>
      <div class="labGrid"><div><b>Paramètre(s) concerné(s)</b>${['DCO','NTK','COT','P total','Métaux'].map(x=>`<label class="check labCheck"><input type="checkbox" name="consParams_${p}${i}" value="${x}"><span>${x}</span></label>`).join('')}<label class="check labCheck"><input type="checkbox" name="consParams_${p}${i}" value="Autre"><span>Autre</span></label></div><div><b>Type d’agent de conservation</b>${['H2SO4','H3PO4','HNO3','K2Cr2O7','NaOH'].map(x=>`<label class="check labCheck"><input type="checkbox" name="consAgent_${p}${i}" value="${x}"><span>${x}</span></label>`).join('')}</div>
        <div><b>Conditionnement du conservateur</b><label class="check labCheck"><input type="radio" name="consCond_${p}${i}" value="Déjà présent dans le flacon"><span>Déjà présent dans le flacon</span></label><label class="check labCheck"><input type="radio" name="consCond_${p}${i}" value="Rajouté par le préleveur"><span>Rajouté par le préleveur</span></label><label class="check labCheck"><input type="radio" name="consCond_${p}${i}" value="Autre"><span>Autre</span></label></div>
        <div><b>Observation</b><textarea id="consObs${p}${i}" placeholder="Observation"></textarea></div>
        <div><b>Conservation</b><label class="check labCheck"><input type="checkbox" name="consKeep_${p}${i}" value="Glacière + blocs eutectiques"><span>Glacière + blocs eutectiques</span></label><label class="check labCheck"><input type="checkbox" name="consKeep_${p}${i}" value="Réfrigérateur"><span>Réfrigérateur</span></label><label class="check labCheck"><input type="checkbox" name="consKeep_${p}${i}" value="Autre"><span>Autre</span></label></div>
      </div></div>`).join('')}
  </div>`;
}
function bindFilterPanel(prefix=''){
  const p=prefix;
  const fs=`filtresSite${p}`, c=`consOui${p}`;
  document.querySelectorAll(`input[name="${fs}"]`).forEach(x=>x.onchange=()=>{
    $(`filterDateWrap${p}`)?.classList.toggle('hide',radioValue(fs)!=='Non')
  });
  document.querySelectorAll(`input[name="${c}"]`).forEach(x=>x.onchange=()=>{
    $(`consFields${p}`)?.classList.toggle('hide',radioValue(c)!=='Oui')
  });
  ['chloro','metaux','autres'].forEach(k=>{
    const ck=$(`filtreParam_${p+k}`); if(!ck)return;
    ck.onchange=()=>{
      const active=ck.checked;
      const v=$(`filtre_${p+k}_volume`); if(v)v.disabled=!active;
      document.querySelectorAll(`input[name="filtreMode_${p+k}"]`).forEach(i=>i.disabled=!active);
    };
  });
}

function bindRadioShow(name,wrapId,showValues){
  document.querySelectorAll(`input[name="${name}"]`).forEach(x=>x.onchange=()=>{
    const v=radioValue(name);$(wrapId)?.classList.toggle('hide',!showValues.includes(v));
  });
}
function buildSample(){
  (function buildSampleCore(){
  const h=$('sample');
  const common=`<div class="grid2">
    <div class="field"><label>Type d’échantillonnage</label><select id="stype"><option></option><option>Ponctuel</option><option>Composite</option><option>Autre</option></select></div>
    <div class="field"><label>Mode de prélèvement</label><div class="radioGrid"><label class="radio"><input type="radio" name="smode" value="Direct"> Direct</label><label class="radio"><input type="radio" name="smode" value="Seau / intermédiaire"> Seau / intermédiaire</label></div></div>
  </div><div class="field"><label>Gants nitriles à usage unique</label>${yesNo('gants')}</div>`;
  if(state.network==='ESO'){
    h.innerHTML=common+`<h3>Fiche ESO — caractéristiques du prélèvement</h3>
      <div class="grid2">
        <div class="field"><label>Nature du point</label><input id="esoNature" placeholder="AEP, PZ, source…"></div>
        <div class="field"><label>Lieu précis du prélèvement</label><input id="esoLieu" placeholder="Robinet, tête de puits, exutoire…"></div>
        <div class="field"><label>Point de référence choisi</label><input id="esoRef" placeholder="Haut de tubage, dalle, repère…"></div>
        <div class="field"><label>Pompe à demeure</label>${yesNo('pompeDemeureRadio')}</div>
      </div>
      <h3>Purge</h3>
      <div class="grid2">
        <div class="field"><label>Heure début purge</label><input id="purgeStart" type="time"></div>
        <div class="field"><label>Heure fin purge</label><input id="purgeEnd" type="time"></div>
        <div class="field"><label>Débit de purge (m³/h)</label><input id="purgeDebit" type="number" step="any"></div>
        <div class="field"><label>Durée de purge (min)</label><input id="purgeDuree" type="number" step="any"></div>
        <div class="field"><label>Niveau dynamique final (m)</label><input id="purgeNivFinal" type="number" step="any"></div>
        <div class="field"><label>Méthode de purge</label><input id="purgeMethode" placeholder="Pompe, tuyaux, protocole…"></div>
      </div>
      <h3>Échantillonnage ESO</h3>
      <div class="grid2">
        <div class="field"><label>Profondeur d’échantillonnage (m)</label><input id="esoEchProf" type="number" step="any"></div>
        <div class="field"><label>Débit de pompage (m³/h)</label><input id="esoEchDebit" type="number" step="any"></div>
        <div class="field"><label>Heure début prélèvement</label><input id="esoEchStart" type="time"></div>
        <div class="field"><label>Heure fin prélèvement</label><input id="esoEchEnd" type="time"></div>
        <div class="field"><label>Méthode d’échantillonnage</label><input id="esoEchMethode"></div>
        <div class="field"><label>Niveau piézométrique (m)</label><input id="esoNiveau" type="number" step="any"></div>
      </div>
      <h3>Pré-traitement / filtration</h3>${filterPanel('eso')}
      <h3>Remise / transport</h3>
      <div class="grid2">
        <div class="field"><label>Suivi température</label><select id="esoSuivi"><option></option><option>Pastilles min/max</option><option>Thermomètre flacon</option><option>Enregistreur</option></select></div>
        <div class="field"><label>Moyen de refroidissement</label><select id="esoFroid"><option></option><option>Glacière</option><option>Véhicule réfrigéré</option><option>Autre</option></select></div>
        <div class="field"><label>Organisme récepteur</label><input id="esoRecepteur"></div>
        <div class="field"><label>Date et heure de remise</label><input id="esoRemise" type="datetime-local"></div>
      </div>`;
    setTimeout(()=>{bindFilterPanel('eso');receivers('esoRecepteur')},0);
    return;
  }
  const base=common+`<h3>Pré-traitement / filtration / conservation</h3>${filterPanel('')}
    <h3>Transport</h3>
    <div class="grid2">
      <div class="field"><label>Moyen de refroidissement</label><select id="transportFroid"><option></option><option>Glacières + blocs eutectiques</option><option>Véhicule réfrigéré</option><option>Autre</option></select></div>
      <div class="field"><label>Suivi température</label><select id="transportSuivi"><option></option><option>Pastilles min/max</option><option>Thermomètre flacon</option><option>Enregistreur</option></select></div>
      <div class="field"><label>Organisme récepteur</label><input id="recepteur"></div>
      <div class="field"><label>Date / heure remise</label><input id="remise" type="datetime-local"></div>
    </div>`;
  const chimSed=(state.network==='Chimie'&&state.session==='S1 - Sept.26')?sedimentPanel('chimie'):'';
  h.innerHTML=base+chimSed;
  setTimeout(()=>{bindFilterPanel('');if(chimSed)bindSedimentPanel('chimie');receivers('recepteur')},0);
  })();
  const root=$('sample');if(!root)return;
  if(!$('sampleTraceBlock')){
    const box=document.createElement('div');box.id='sampleTraceBlock';box.className='card';box.style.marginTop='10px';box.innerHTML=`<h3>Traçabilité échantillon / chaîne de possession</h3><div class="grid2"><div class="field"><label>ID échantillon / code flacon</label><input id="sampleId" placeholder="Identifiant unique"></div><div class="field"><label>Référence flaconnage / lot</label><input id="sampleBottleLot"></div><div class="field"><label>Température au départ (°C)</label><input id="tempDeparture" type="number" step="any"></div><div class="field"><label>Température à réception (°C)</label><input id="tempReception" type="number" step="any"></div><div class="field"><label>Transporteur / agent de remise</label><input id="transportAgent"></div><div class="field"><label>Date / heure de remise</label><input id="custodyDate" type="datetime-local"></div></div><div class="field"><label>Observations chaîne de possession</label><textarea id="custodyObs"></textarea></div>`;
    root.appendChild(box);
  }
  /* Corrige l'ordre des champs labo + règles hauteur sédiment (ancien correctif) */
  setTimeout(()=>{
    if(typeof window.sedRules==='function')window.sedRules();
    document.querySelectorAll('.labGrid').forEach(g=>{const ag=[...g.children].find(d=>d.textContent.includes('Type d’agent')),pa=[...g.children].find(d=>d.textContent.includes('Paramètre(s) concerné(s)'));if(ag&&pa){g.insertBefore(pa,g.firstChild);g.insertBefore(ag,pa.nextSibling);ag.querySelectorAll('input').forEach(a=>a.disabled=true);pa.querySelectorAll('input').forEach(p=>p.onchange=()=>ag.querySelectorAll('input').forEach(a=>a.disabled=!g.querySelectorAll('input:checked').length))}});
  },0);
}function bindSampleVisibility(){bindFilterPanel('');bindFilterPanel('eso')}

function sedimentPanel(prefix,title='Échantillonnage de sédiments'){
  const p=prefix;
  return `<div class="sedimentPanel">
    <div class="sedimentTitle">🪣 ${title}</div>
    <div class="sedimentRow"><div class="sedimentLabel">Prélèvement de sédiments réalisé ?</div><div class="sedimentValue">${yesNo(p+'Sed')}</div></div>
    <div id="${p}SedDetails" class="hide">
      <div class="sedimentRow"><div class="sedimentLabel">Port de gants nitriles à usage unique ?</div><div class="sedimentValue">${yesNo(p+'SedGants')}</div></div>
      <div class="sedimentRow"><div class="sedimentLabel">Hauteur prélevée</div><div class="sedimentValue"><input id="${p}SedHauteur" type="number" min="0" max="5" step="0.1" placeholder="…… cm" title="Maximum 5 cm"></div></div>
      <div class="sedimentRow"><div class="sedimentLabel">Type d’échantillonnage</div><div class="sedimentValue"><div class="radioGrid"><label class="radio"><input type="radio" name="${p}SedType" value="Ponctuel"> Ponctuel</label><label class="radio"><input type="radio" name="${p}SedType" value="Composite"> Composite</label><label class="radio"><input type="radio" name="${p}SedType" value="Autre"> Autre, préciser</label></div><input id="${p}SedTypeAutre" type="text" placeholder="Préciser" style="margin-top:6px"></div></div>
      <div class="sedimentRow"><div class="sedimentLabel">Mode de prélèvement</div><div class="sedimentValue"><div class="radioGrid"><label class="radio"><input type="radio" name="${p}SedMode" value="Direct"> Direct</label><label class="radio"><input type="radio" name="${p}SedMode" value="Intermédiaire (benne à sédiments, pelle…)" > Intermédiaire (benne à sédiments, pelle…)</label></div></div></div>
      <div class="sedimentRow"><div class="sedimentLabel">Si « intermédiaire », sélectionner l’outil de prélèvement utilisé</div><div class="sedimentValue"><div class="sedimentTools">${['Drague manuelle','Benne de type « Van Veen »','Benne de type « Ekman »','Carottier','Autre'].map((x,i)=>`<label class="check"><input type="checkbox" name="${p}SedOutil" value="${x}"><span>${x}</span></label>`).join('')}</div><input id="${p}SedOutilAutre" type="text" placeholder="Préciser autre outil" style="margin-top:6px"></div></div>
      <div class="sedimentRow"><div class="sedimentLabel">Tamisage des échantillons sur site ?</div><div class="sedimentValue">${yesNo(p+'SedTamis')}</div></div>
      <div id="${p}SedTamisDetails" class="hide">
        <div class="sedimentRow"><div class="sedimentLabel">Si oui, matériaux utilisés pour le tamisage</div><div class="sedimentValue">${yesNo(p+'SedMateriaux')}<input id="${p}SedMat" type="text" placeholder="Préciser les matériaux / équipement" style="margin-top:6px"></div></div>
        <div class="sedimentRow"><div class="sedimentLabel">Granulométrie du tamis</div><div class="sedimentValue"><div class="radioGrid"><label class="radio"><input type="radio" name="${p}SedGran" value="< 2 mm"> &lt; 2 mm</label><label class="radio"><input type="radio" name="${p}SedGran" value="< 0,63 mm"> &lt; 0,63 mm</label><label class="radio"><input type="radio" name="${p}SedGran" value="Autre"> Autre</label></div><input id="${p}SedGranAutre" type="text" placeholder="Préciser autre granulométrie" style="margin-top:6px"></div></div>
      </div>
      <div class="sedimentRow"><div class="sedimentLabel">Organisme récepteur</div><div class="sedimentValue"><input id="${p}SedRecepteur"></div></div>
      <div class="sedimentRow"><div class="sedimentLabel">Date / heure remise</div><div class="sedimentValue"><input id="${p}SedRemise" type="datetime-local"></div></div>
    </div>
  </div>`;
}
function bindSedimentPanel(prefix){
  const p=prefix;
  document.querySelectorAll(`input[name="${p}Sed"]`).forEach(x=>x.onchange=()=>{
    const on=radioValue(p+'Sed')==='Oui';
    $(`${p}SedDetails`)?.classList.toggle('hide',!on);
  });
  document.querySelectorAll(`input[name="${p}SedTamis"]`).forEach(x=>x.onchange=()=>{
    const on=radioValue(p+'SedTamis')==='Oui';
    $(`${p}SedTamisDetails`)?.classList.toggle('hide',!on);
  });
}

function buildSpecific(){
  const h=$('specific');h.innerHTML='';
  if(state.network==='EL'){
    const s=getStation(),mec=s?.type==='MEC';
    h.innerHTML=`<div class="elHead"><div><b>INFORMATIONS SPÉCIFIQUES EL</b><div class="hint" style="color:#fff">Lecture de la fiche ${mec?'MEC':'MET'} du modèle Excel</div></div><span class="elBadge">${mec?'MEC':'MET'}</span></div>
    <div class="grid2"><div class="field"><label>Session</label><input class="readonly" readonly value="${escapeHTML(state.session||'')}"></div>
    </div>`;
    return;
  }
  if(state.network==='BIO'&&state.activity===BIO_EAU_ACTIVITY){
    const s=getStation();
    const isFishStation=(DATA.BIO_FISH||[]).some(x=>(x.code||x.code_bss||x.nom)===(s?.code||s?.code_bss||s?.nom));
    const species=['Chevaine','Barbeau fluviatile','Gardon','Brème commune','Perche','Truite (pour les lacs)'];
    const ceModule=`<div class="bioModuleTitle">🌊 Module Cours d’eau</div>
      <div class="banner info"><b>Fiche BIO par station.</b> Opération sélectionnée : <b>${escapeHTML(state.bioOperation||'—')}</b>.</div>
      <div class="grid2"><div class="field"><label>Référence opération Eau / Cours d’eau</label><input id="bioSemaine"></div><div class="field"><label>Lecture échelle / information hydrométrique (m)</label><input id="bioEchelle"></div>
      ${state.bioOperation==='PC+IA+ADNe'?'<div class="field"><label>Référence prélèvement ADNe</label><input id="adneRef"></div><div class="field"><label>Observation ADNe</label><input id="adneObs"></div>':''}
      ${state.bioOperation==='PC+IA+Phyto'?'<div class="field"><label>Référence prélèvement Phytoplancton</label><input id="phytoRef"></div><div class="field"><label>Observation Phytoplancton</label><input id="phytoObs"></div></div><div class="banner info">🔬 <b>Consignes ONEMA — fixation et conservation du phytoplancton.</b> Fixation au Lugol alcalin : environ 0,5&nbsp;% dans l’échantillon (≈ 8 gouttes / 100 mL, teinte brun clair « whisky »). Conservation : 3 semaines maximum à l’obscurité à température ambiante, ou 12 mois si maintenu au froid et à l’obscurité (1 à 4&nbsp;°C). Pour une conservation plus longue (2 ans minimum requis), une double fixation au glutaraldéhyde (0,5&nbsp;%) ou au formol (5&nbsp;%) est indispensable. Filtration chlorophylle : privilégier un filtrat exempt de lumière, jusqu’au dosage (norme NF T90-117).</div><div class="grid2"><div class="field"><label>Fixateur utilisé</label><select id="phytoFixateur"><option value="">— sélectionner —</option><option>Lugol alcalin</option><option>Glutaraldéhyde</option><option>Formol</option><option>Lugol + double fixation</option></select></div><div class="field"><label>Volume de fixateur ajouté (mL)</label><input id="phytoFixateurVol" type="number" step="any"></div><div class="field"><label>Volume filtré pour la chlorophylle (mL)</label><input id="phytoChloroVol" type="number" step="any"></div><div class="field"><label>Transparence — disque de Secchi (m)</label><input id="phytoSecchi" type="number" step="any"></div>':''}</div>`;
    const bioteModule=isFishStation?`<div class="bioModuleTitle">🐟 Module Biote (poissons)</div>
      <div class="banner info">Station rattachée au suivi biote (poissons) — opération de pêche, conditionnement et transport à compléter en plus du module Cours d’eau.</div>
      <div class="grid2">
        <div class="field"><label>Identification du lot (référence unique)</label><input id="fishLot"></div>
        <div class="field"><label>Date / heure de l’opération</label><input id="fishDateOp" type="datetime-local"></div>
        <div class="field"><label>Méthode de capture employée</label><input id="fishMethod"></div>
        <div class="field"><label>Durée de l’opération</label><input id="fishDuration"></div>
        <div class="field"><label>Conditions météorologiques</label><input id="fishWeather"></div>
        <div class="field"><label>Conditions hydrologiques</label><input id="fishHydro"></div>
        <div class="field"><label>Date / heure mise en enceinte réfrigérée</label><input id="fishCold" type="datetime-local"></div>
        <div class="field"><label>Température de stockage (°C)</label><input id="fishTemp"></div>
        <div class="field"><label>Durée de stockage dans l’enceinte</label><input id="fishStorage"></div>
        <div class="field"><label>Date / heure mise en enceinte réfrigérée pour envoi au laboratoire</label><input id="fishColdSend" type="datetime-local"></div>
        <div class="field"><label>Date / heure d’envoi au laboratoire</label><input id="fishSend" type="datetime-local"></div>
        <div class="field"><label>Date / heure d’arrivée au laboratoire</label><input id="fishLab" type="datetime-local"></div>
        <div class="field"><label>Poids frais total du lot (g)</label><input id="fishWeight"></div>
        <div class="field"><label>Autres informations utiles</label><input id="fishOtherInfo"></div>
      </div>
      <h3>Échantillon composite monospécifique — individus (taille / poids)</h3>
      <div class="hint">Poids total minimal du lot : 800 g (préférablement 1 kg).</div>
      <table class="table"><thead><tr><th>Espèce</th>${[1,2,3,4,5,6,7,8,9,10].map(i=>`<th>Ind.${i}</th>`).join('')}</tr></thead><tbody>${species.map(sp=>`<tr><td><b>${sp}</b></td>${[1,2,3,4,5,6,7,8,9,10].map(i=>`<td><input id="f_${sp.replaceAll(' ','_')}_${i}_t" placeholder="mm"><input id="f_${sp.replaceAll(' ','_')}_${i}_p" placeholder="g"></td>`).join('')}</tr>`).join('')}</tbody></table>
      <div class="field"><label>Remarques concernant les conditions de pêche</label><textarea id="fishObs" placeholder="Conditions météo/hydro défavorables, travaux sur berge, activités nautiques, présence d’animaux, rejets en amont…"></textarea></div>`:'';
    h.innerHTML=ceModule+bioteModule;
    return;
  }
  if(state.network==='RCO'&&state.activity===RCO_COMBINED_ACTIVITY){
    const s1 = state.session===RCO_SESSION_IA;
    h.innerHTML=`<div class="banner info">CCTP RCO : Eau + Sédiments + IA + Diatomées sont traités ensemble. Les stations supplémentaires IA/Diat sont disponibles uniquement en S1 — Octobre 2026.</div>
      <div class="grid2">
        <div class="field"><label>Eau prélevée ?</label>${yesNo('rcoEau')}</div>
        ${s1 ? `<div class="field"><label>Invertébrés aquatiques réalisés ?</label>${yesNo('rcoInv')}</div><div class="field"><label>Diatomées réalisées ?</label>${yesNo('rcoDia')}</div>` : ''}
      </div>
      ${sedimentPanel('rco')}
      ${s1 ? `<div class="grid2"><div class="field"><label>Référence prélèvement IA</label><input id="rcoInvRef"></div><div class="field"><label>Référence prélèvement Diatomées</label><input id="rcoDiaRef"></div></div>` : ''}
      <div class="field"><label>Notes RCO</label><textarea id="rcoBioObs"></textarea></div>`;
    setTimeout(()=>bindSedimentPanel('rco'),0);
    return;
  }
  if(state.network==='ESO'){
    h.innerHTML=`<div class="banner info">Structure ESO calée sur la fiche terrain : lieu précis, référence, purge, mesures physico-chimiques, prélèvement, filtration et remise.</div>`;
    return;
  }
  h.innerHTML=`<div class="field"><label>Référence / informations spécifiques</label><input id="specRef"></div>`;
}

function buildAll(){
  if(isEL()){
    buildELInsitu();buildELSample();buildSpecific();buildELSite();initCanvases();
    const s=getStation(); if(s&&$('elDepth')){$('elDepth').value=s.type==='MEC'?'10':'';refreshELDepthLevels();}
    return;
  }
  buildInsitu();buildSample();buildSpecific();initCanvases()
}

function collectSimple(ids){
  const o={};ids.forEach(id=>{if($(id))o[id]=val(id)});return o;
}
function radioValue(name){return document.querySelector(`input[name="${name}"]:checked`)?.value||''}
function collectInsitu(){
  if(state.network==='EL'){
    const o={type:elStationType(),profondeur:val('elDepth'),profondeurs:{surface:val('el_depth_surf'),intermediaire:val('el_depth_inter'),fond:val('el_depth_fond')},params:{}};
    ['temp','ph','sal','condus','condms','o2mg','o2pc'].forEach(k=>{
      o.params[k]={surface:val(`el_${k}_surf`),intermediaire:val(`el_${k}_inter`),fond:val(`el_${k}_fond`),sonde:val(`el_probe_${k}`)};
    });
    o.turbidite={};
    ['surf','inter','fond'].forEach(d=>{
      const a=[1,2,3].map(n=>Number(val(`el_turb_${d}_${n}`)));
      o.turbidite[d]={mesures:a.map(v=>Number.isFinite(v)?v:null),moyenne:a.every(Number.isFinite)?a.reduce((x,y)=>x+y,0)/3:null,sonde:val('el_probe_turb')};
    });
    return o;
  }
  const ps=['ph','temp','cond','sal','o2mg','o2pc','turb','air','redox'];
  const o={mode:state.network==='ESO'?radioValue('eso_mode'):radioValue('global_mode')};
  ps.forEach(k=>{
    if($('iv_'+k))o[k]={value:val('iv_'+k),gmao:val('ig_'+k),nom:val('ign_'+k),serie:val('igs_'+k),etalonnage:val('ic_'+k),controle:val('iq_'+k)}
  });
  /* Mode de mesure par sonde (ancien correctif) */
  Object.keys(o).forEach(k=>{if(k==='mode')return;const m=$('imode_'+k);if(m)o[k].mode=m.value});
  o.mode='par appareil';
  /* Turbidité : mesures, nombre valide et moyenne (ancien correctif) */
  if(o.turb){
    const vals=[1,2,3].map(n=>val('iv_turb_'+n)).map(Number);
    o.turb.mesures=vals.map(v=>Number.isFinite(v)?v:null);
    const valid=vals.filter(Number.isFinite);
    o.turb.nbMesures=valid.length;
    o.turb.value=valid.length===3?(valid[0]+valid[1]+valid[2])/3:'';
    o.turb.moyenne=o.turb.value;
  }
  return o;
}function collectSample(){
  if(state.network==='EL'){
    const o=collectSimple(['stype','elMoyenEchSample','elConservationSample','elFiltreChloro','elVfChloro','transportFroid','transportSuivi','recepteur','remise']);
    o.smode=radioValue('smode');o.gants=radioValue('gants');o.elChloro=radioValue('elChloro');
    o.recepteurs=$('recepteur')?._receiverRows?.()||[];
    o.recepteur=o.recepteurs.map(x=>x.organisme).filter(Boolean).join(' ; ');
    o.remise=o.recepteurs[0]?.dateHeure||'';
    return o;
  }
  const ids=['stype','filtreDate','filtreHeure','filtre_chloro_volume','filtre_metaux_volume','filtre_autres_volume','filtre_autres_nom','recepteur','remise','transportFroid','transportSuivi','esoNature','esoLieu','esoRef','purgeStart','purgeEnd','purgeDebit','purgeDuree','purgeNivFinal','purgeMethode','esoEchProf','esoEchDebit','esoEchStart','esoEchEnd','esoEchMethode','esoNiveau','esoSuivi','esoFroid','esoRecepteur','esoRemise','filtreDateeso','filtreHeureeso'];
  const o=collectSimple(ids);
  o.smode=radioValue('smode');o.gants=radioValue('gants');o.filtresSite=radioValue('filtresSite');o.filtresSiteEso=radioValue('filtresSiteeso');o.consOui=radioValue('consOui');o.consOuiEso=radioValue('consOuieso');
  o.pompeDemeure=radioValue('pompeDemeureRadio');
  ['chloro','metaux','autres'].forEach(k=>{
    o['filtreParam_'+k]=!!$(`filtreParam_${k}`)?.checked;
    o['filtreMode_'+k]=radioValue('filtreMode_'+k);
    o['filtreParam_eso_'+k]=!!$(`filtreParam_eso${k}`)?.checked;
    o['filtreMode_eso_'+k]=radioValue('filtreMode_eso'+k);
  });
  // ESO-specific radio values
  ['rco','chimie'].forEach(p=>{
    const cap=p==='rco'?'rco':'chimie';
    o[cap+'Sed']=radioValue(cap+'Sed');
    o[cap+'SedGants']=radioValue(cap+'SedGants');
    o[cap+'SedTamis']=radioValue(cap+'SedTamis');
    o[cap+'SedType']=radioValue(cap+'SedType');
    o[cap+'SedTypeAutre']=val(cap+'SedTypeAutre');
    o[cap+'SedMode']=radioValue(cap+'SedMode');
    o[cap+'SedGran']=radioValue(cap+'SedGran');
    o[cap+'SedMateriaux']=radioValue(cap+'SedMateriaux');
    o[cap+'SedMat']=val(cap+'SedMat');
    o[cap+'SedGranAutre']=val(cap+'SedGranAutre');
    o[cap+'SedOutilAutre']=val(cap+'SedOutilAutre');
    o[cap+'SedOutils']=[...document.querySelectorAll(`input[name="${cap}SedOutil"]:checked`)].map(x=>x.value);
    o[cap+'SedRecepteur']=val(cap+'SedRecepteur');
    o[cap+'SedRemise']=val(cap+'SedRemise');
  });
  // Conservation blocks
  ['','eso'].forEach(p=>{
    const cons=radioValue('consOui'+p); if(cons){o['consOui'+p]=cons; o['consLabs'+p]=[0,1].map(i=>({lab:val(`consLab${p}${i}`),agents:[...document.querySelectorAll(`input[name="consAgent_${p}${i}"]:checked`)].map(x=>x.value),params:[...document.querySelectorAll(`input[name="consParams_${p}${i}"]:checked`)].map(x=>x.value),conditionnement:radioValue(`consCond_${p}${i}`),observation:val(`consObs${p}${i}`),conservation:[...document.querySelectorAll(`input[name="consKeep_${p}${i}"]:checked`)].map(x=>x.value)}))}
  });
  o.recepteurs=$('recepteur')?._receiverRows?.()||[]; o.esoRecepteurs=$('esoRecepteur')?._receiverRows?.()||[]; o.recepteur=o.recepteurs.map(x=>x.organisme).filter(Boolean).join(' ; '); o.remise=o.recepteurs[0]?.dateHeure||''; o.esoRecepteur=o.esoRecepteurs.map(x=>x.organisme).filter(Boolean).join(' ; '); o.esoRemise=o.esoRecepteurs[0]?.dateHeure||'';
  return o;
}
function collectSpecific(){
  const o={};document.querySelectorAll('#specific input,#specific select,#specific textarea').forEach(e=>{if(e.id)o[e.id]=e.type==='checkbox'?e.checked:e.value});return o;
}
function collectConditions(){
  if(state.network==='EL'){
    return collectSimple(['meteo','hydro','irisations','mousse','boues','feuilles','aspect','ombre','typePrelSandre','teinte','elIntensite','elIncidence','siteObs','elMer','elMaree','elCoefMaree','elActivites']);
  }
  return collectSimple(['meteo','seuil','typePrelSandre','hydro','aspect','irisations','mousse','feuilles','boues','autresCorps','teinte','coloration','limpidite','odeur','ombre','berge','debitTendance','macro','largeur','profMoy','siteObs']);
}
function updateDistance(){
  const s=getStation();
  const x=parseFloat(val('xT')),y=parseFloat(val('yT'));
  if(s&&Number.isFinite(x)&&Number.isFinite(y)&&Number.isFinite(Number(s.x))&&Number.isFinite(Number(s.y))){
    const d=ecartGPS(Number(s.x),Number(s.y),x,y);
    $('distance').textContent=d.toFixed(1)+' m';
  }else $('distance').textContent='—';
}
$('xT').oninput=updateDistance;$('yT').oninput=updateDistance;

function setupCanvas(c){
  const dpr=devicePixelRatio||1,r=c.getBoundingClientRect();c.width=r.width*dpr;c.height=r.height*dpr;
  const ctx=c.getContext('2d');ctx.scale(dpr,dpr);ctx.lineWidth=2;ctx.lineCap='round';
  let active=false;c.onpointerdown=e=>{active=true;c.setPointerCapture(e.pointerId);const q=c.getBoundingClientRect();ctx.beginPath();ctx.moveTo(e.clientX-q.left,e.clientY-q.top)};
  c.onpointermove=e=>{if(!active)return;const q=c.getBoundingClientRect();ctx.lineTo(e.clientX-q.left,e.clientY-q.top);ctx.stroke()};
  c.onpointerup=()=>active=false;c.onpointercancel=()=>active=false;return ctx
}
function restoreCanvas(c,data){const im=new Image();im.onload=()=>c.getContext('2d').drawImage(im,0,0,c.clientWidth,c.clientHeight);im.src=data}
function initCanvases(){
  const dEl=$('draw'),sEl=$('signature');
  if(dEl&&dEl.width>0&&!state.draw)state.draw=dEl.toDataURL('image/png');
  if(sEl&&sEl.width>0&&!state.signature)state.signature=sEl.toDataURL('image/png');
  setupCanvas(dEl);setupCanvas(sEl);
  if(state.draw)restoreCanvas(dEl,state.draw);if(state.signature)restoreCanvas(sEl,state.signature);
}
$('clearDraw').onclick=()=>{$('draw').getContext('2d').clearRect(0,0,$('draw').clientWidth,$('draw').clientHeight);state.draw=null};
$('clearSig').onclick=()=>{$('signature').getContext('2d').clearRect(0,0,$('signature').clientWidth,$('signature').clientHeight);state.signature=null};
$('printBtn').onclick=()=>window.print();

$('photos').onchange=async e=>{
  for(const f of [...e.target.files].slice(0,5-state.photos.length))state.photos.push(await compress(f));
  renderPhotos();e.target.value=''
};
function compress(file){
  return new Promise(res=>{const fr=new FileReader(),im=new Image();fr.onload=()=>{im.onload=()=>{const max=1280,s=Math.min(1,max/Math.max(im.width,im.height)),c=document.createElement('canvas');c.width=Math.round(im.width*s);c.height=Math.round(im.height*s);c.getContext('2d').drawImage(im,0,0,c.width,c.height);res(c.toDataURL('image/jpeg',.72))};im.src=fr.result};fr.readAsDataURL(file)})
}
function renderPhotos(){
  const h=$('mediaGrid');h.innerHTML='';
  state.photos.forEach((p,i)=>{const d=document.createElement('div');d.className='thumb';d.innerHTML=`<img src="${p}"><button>×</button>`;d.querySelector('button').onclick=()=>{state.photos.splice(i,1);renderPhotos()};h.appendChild(d)})
}

function collectRecord(){
  const s=getStation();
  const r={
    id:state.editing||Date.now()+'_'+Math.random().toString(36).slice(2,7),
    network:state.network,activity:state.activity,bioOperation:state.bioOperation,session:state.session,station:state.station,stationInfo:s,
    date:val('date'),heureDebut:val('start'),heureFin:val('end'),organisme:val('org'),preleveurs:state.preleveurs,
    xTheorique:s?.x??'',yTheorique:s?.y??'',xTerrain:val('xT'),yTerrain:val('yT'),ecartM:$('distance').textContent,
    conditions:collectConditions(),insitu:collectInsitu(),sample:collectSample(),specific:collectSpecific(),
    photos:(state.photos||[]).map(p=>typeof p==='string'?{data:p,group:'Amont'}:p),projection:val('projection'),schemaLegend:{ecoulement:!!$('legendeEcoulement')?.checked,prelevement:!!$('legendePrelevement')?.checked,berges:!!$('legendeBerges')?.checked,acces:!!$('legendeAcces')?.checked,autre:val('legendeAutre')},dessin:$('draw').toDataURL('image/png'),signature:$('signature').toDataURL('image/png'),signName:val('signName'),
    qc:radioValue('qc'),qcType:val('qcType'),obs:val('obs'),comment:val('comment'),savedAt:new Date().toISOString()
  };
  /* --- Champs qualité / traçabilité étendus (ancien correctif) --- */
  r.methodRef=val('methodRef');r.methodVersion=val('methodVersion');
  r.sampleTrace={sampleId:val('sampleId'),bottleLot:val('sampleBottleLot'),tempDeparture:val('tempDeparture'),tempReception:val('tempReception'),transportAgent:val('transportAgent'),custodyDate:val('custodyDate'),custodyObs:val('custodyObs')};
  r.quality={representative:radioValue('representative'),representativeJustification:val('representativeJustification'),qcBlank:radioValue('qc_blank'),qcDuplicate:radioValue('qc_duplicate'),qcMaterial:radioValue('qc_material'),uncertaintySource:val('uncertaintySource')};
  /* --- Légende du schéma étendue + regroupement des photos (ancien correctif) --- */
  r.projection=val('projection');
  const lk=['ecoulement','prelevement','sediment','foret','herbes','branche','arbre','tronc','plantes','voiture','roches','bateauNonMotorise','bateau','carbet','boues','pont','maison','village','activite','sables','route','cale','industrielle'];
  r.schemaLegend={};lk.forEach(k=>{const id='legende'+k.charAt(0).toUpperCase()+k.slice(1);r.schemaLegend[k]=!!$(id)?.checked});
  r.schemaLegend.autre=val('legendeAutre');
  r.photos=(state.photos||[]).map(p=>typeof p==='string'?{data:p,group:'Amont'}:p);
  /* Unités canoniques des mesures in situ (ancien correctif) */
  if(r.insitu)Object.entries(r.insitu).forEach(([k,d])=>{if(d)d.unite=(window.UNITS&&window.UNITS[k])||d.unite||''});
  return r;
}
function clearForm(){
  if(!confirm('Effacer le formulaire en cours ?'))return;
  state={network:null,activity:null,bioOperation:null,session:null,station:null,editing:null,preleveurs:[],photos:[],draw:null,signature:null};
  document.querySelectorAll('input,textarea').forEach(e=>{if(e.type!=='file')e.value=''});
  document.querySelectorAll('select').forEach(e=>e.value='');document.querySelectorAll('input[type=radio]').forEach(e=>e.checked=false);
  document.querySelectorAll('#networks .chip').forEach(c=>c.classList.remove('sel'));fill('station',[]);
  $('activityWrap').classList.add('hide');$('sessionWrap').classList.add('hide');hideForm();renderPre();renderPhotos();$('save').textContent='💾 Enregistrer la fiche';
}
$('clearForm').onclick=clearForm;

function updateCount(){$('count').textContent=records.length}
$('search').oninput=()=>{if(typeof window.renderList==='function')window.renderList()};

function loadRecord(id){
  (function loadRecordCore(id){
  const f=records.find(x=>x.id===id);if(!f)return;
  state.editing=id;state.network=f.network;state.activity=f.activity;state.bioOperation=f.bioOperation||'';state.session=f.session;state.station=f.station;state.preleveurs=f.preleveurs||[];state.photos=f.photos||[];state.draw=f.dessin||null;state.signature=f.signature||null;
  selectNetwork(f.network);
  state.activity=f.activity;state.preleveurs=f.preleveurs||[];state.bioOperation=f.bioOperation||'';
  // Legacy activity names
  if(state.network==='BIO' && ['Eau dans un cours d’eau (CE)','Phytoplancton','ADNe','Eau dans un cours d’eau / ADNe / Phytoplancton','Eaux de surface — stations communes CE + ADNe + Phytoplancton'].includes(f.activity)){
    state.activity=BIO_EAU_ACTIVITY;
    if(!state.bioOperation) state.bioOperation='PC+IA';
  }
  $('activity').value=state.activity||'';
  $('bioOperationWrap').classList.toggle('hide',!(state.network==='BIO'&&state.activity===BIO_EAU_ACTIVITY));
  fill('bioOperation',BIO_OPERATIONS);$('bioOperation').value=state.bioOperation||'';
  fill('session',sessions(state.network));$('session').value=f.session||'';state.session=f.session||null;fillStations();$('station').value=f.station||'';state.station=f.station||null;renderAuto();showForm();buildAll(); setTimeout(()=>{const rs=f.sample||{};receivers('recepteur');receivers('esoRecepteur');$('recepteur')?._renderReceiverRows?.(rs.recepteurs||((rs.recepteur||rs.remise)?[{organisme:rs.recepteur||'',dateHeure:rs.remise||''}]:[]));$('esoRecepteur')?._renderReceiverRows?.(rs.esoRecepteurs||((rs.esoRecepteur||rs.esoRemise)?[{organisme:rs.esoRecepteur||'',dateHeure:rs.esoRemise||''}]:[]))},180);
  if(f.insitu?.mode){const name=state.network==='ESO'?'eso_mode':'global_mode';const q=document.querySelector(`input[name="${name}"][value="${f.insitu.mode}"]`);if(q)q.checked=true}
  if(f.insitu){
    Object.keys(f.insitu).forEach(k=>{
      const d=f.insitu[k];if(d&&typeof d==='object'&&$(`iv_${k}`)){
        $(`iv_${k}`).value=d.value||'';if($(`ig_${k}`)){$(`ig_${k}`).value=d.gmao||'';const e=equipmentByGmao(d.gmao||'');if($(`ign_${k}`))$(`ign_${k}`).value=e?.nom||d.nom||'';if($(`igs_${k}`))$(`igs_${k}`).value=e?.serie||d.serie||''}
        if($(`ic_${k}`))$(`ic_${k}`).value=d.etalonnage||'';if($(`iq_${k}`))$(`iq_${k}`).value=d.controle||'';if($(`imode_${k}`))$(`imode_${k}`).value=d.mode||''
      }
    })
  }
  if(f.insitu?.turb){
    const tm=f.insitu.turb.mesures||[];
    [1,2,3].forEach((n,i)=>{if($('iv_turb_'+n))$('iv_turb_'+n).value=(tm[i]!=null?tm[i]:'')});
    const avg=$('iv_turb_moyenne');
    if(avg){const vals=[1,2,3].map(n=>Number(val('iv_turb_'+n))).filter(Number.isFinite);avg.textContent='Moyenne des 3 mesures : '+(vals.length===3?((vals[0]+vals[1]+vals[2])/3).toFixed(2)+' NTU':'—');}
  }
  if(f.network==='EL' && f.insitu?.params){
    const d=f.insitu;
    [['surface','el_depth_surf'],['intermediaire','el_depth_inter'],['fond','el_depth_fond']].forEach(([k,id])=>{if($(id))$(id).value=d.profondeurs?.[k]??''});
    Object.entries(d.params).forEach(([k,v])=>{
      if(!v||typeof v!=='object')return;
      if($(`el_${k}_surf`))$(`el_${k}_surf`).value=v.surface??'';
      if($(`el_${k}_inter`))$(`el_${k}_inter`).value=v.intermediaire??'';
      if($(`el_${k}_fond`))$(`el_${k}_fond`).value=v.fond??'';
      if($(`el_probe_${k}`))$(`el_probe_${k}`).value=v.sonde??'';
    });
    ['surf','inter','fond'].forEach(dn=>{
      const tm=d.turbidite?.[dn]?.mesures||[];
      [1,2,3].forEach((n,i)=>{if($(`el_turb_${dn}_${n}`))$(`el_turb_${dn}_${n}`).value=tm[i]??''});
      if($('el_probe_turb'))$('el_probe_turb').value=d.turbidite?.[dn]?.sonde||d.turbidite?.surf?.sonde||'';
      refreshELTurb(dn);
    });
  }
  const mainMap={date:f.date,start:f.heureDebut,end:f.heureFin,org:f.organisme,xT:f.xTerrain,yT:f.yTerrain,signName:f.signName,qcType:f.qcType,obs:f.obs,comment:f.comment,...(f.conditions||{})}; if($('projection'))$('projection').value=f.projection||'RGFG 95 / UTM 22N'; ['ecoulement','prelevement','sediment','foret','herbes','branche','arbre','tronc','plantes','voiture','roches','bateauNonMotorise','bateau','carbet','boues','pont','maison','village','activite','sables','route','cale','industrielle'].forEach(k=>{const id='legende'+k.charAt(0).toUpperCase()+k.slice(1);if($(id))$(id).checked=!!f.schemaLegend?.[k]}); if($('legendeAutre'))$('legendeAutre').value=f.schemaLegend?.autre||'';
  Object.entries(mainMap).forEach(([k,v])=>{if($(k))$(k).value=v||''});
  renderOrgOptions(f.organisme);renderPre();
  if(f.qc){const q=document.querySelector(`input[name="qc"][value="${f.qc}"]`);if(q)q.checked=true}
  if(f.sample){
    Object.entries(f.sample).forEach(([k,v])=>{
      if($(k))$(k).value=v||'';
    });
    ['smode','gants','filtresSite','consOui','pompeDemeureRadio','filtresSiteeso','consOuieso'].forEach(k=>{if(f.sample[k]){const q=document.querySelector(`input[name="${k}"][value="${f.sample[k]}"]`);if(q)q.checked=true}});
    ['global_mode','eso_mode'].forEach(k=>{if(f.insitu?.mode){const q=document.querySelector(`input[name="${k}"][value="${f.insitu.mode}"]`);if(q)q.checked=true}});
    ['chloro','metaux','autres'].forEach(k=>{
      const q=document.querySelector(`#filtreParam_${k}`); if(q)q.checked=!!f.sample['filtreParam_'+k] || f.sample['filtre_'+k]==='Oui';
      const qe=document.querySelector(`#filtreParam_eso${k}`); if(qe)qe.checked=!!f.sample['filtreParam_eso_'+k];
      if(f.sample['filtreMode_'+k]){const m=document.querySelector(`input[name="filtreMode_${k}"][value="${f.sample['filtreMode_'+k]}"]`);if(m)m.checked=true}
      if(f.sample['filtreMode_eso_'+k]){const me=document.querySelector(`input[name="filtreMode_eso${k}"][value="${f.sample['filtreMode_eso_'+k]}"]`);if(me)me.checked=true}
    });
    // restore conservation blocks
    ['','eso'].forEach(p=>{
      (f.sample['consLabs'+p]||[]).forEach((lab,i)=>{
        if($(`consLab${p}${i}`))$(`consLab${p}${i}`).value=lab.lab||'';
        (lab.agents||[]).forEach(v=>{const q=document.querySelector(`input[name="consAgent_${p}${i}"][value="${v}"]`);if(q)q.checked=true});
        (lab.params||[]).forEach(v=>{const q=document.querySelector(`input[name="consParams_${p}${i}"][value="${v}"]`);if(q)q.checked=true});
        if(lab.conditionnement){const q=document.querySelector(`input[name="consCond_${p}${i}"][value="${lab.conditionnement}"]`);if(q)q.checked=true}
        if($(`consObs${p}${i}`))$(`consObs${p}${i}`).value=lab.observation||'';
        (lab.conservation||[]).forEach(v=>{const q=document.querySelector(`input[name="consKeep_${p}${i}"][value="${v}"]`);if(q)q.checked=true});
      });
    });
    bindSampleVisibility(); ['','eso'].forEach(pp=>[0,1].forEach(ii=>{const wrap=$('consAgentWrap_'+pp+ii);if(!wrap)return;const ps=[...document.querySelectorAll('input[name="consParams_'+pp+ii+'"]')];const sync=()=>{const on=ps.some(x=>x.checked);wrap.querySelectorAll('input').forEach(x=>x.disabled=!on)};ps.forEach(x=>x.addEventListener('change',sync));sync()}));
    document.querySelectorAll('input[name="filtresSite"],input[name="consOui"],input[name="filtresSiteeso"],input[name="consOuieso"]').forEach(q=>q.dispatchEvent(new Event('change')));
    ['chloro','metaux','autres'].forEach(k=>{document.querySelector(`#filtreParam_${k}`)?.dispatchEvent(new Event('change'));document.querySelector(`#filtreParam_eso${k}`)?.dispatchEvent(new Event('change'))});
    ['rco','chimie'].forEach(cap=>{
      if(f.sample[cap+'Sed']){const q=document.querySelector(`input[name="${cap}Sed"][value="${f.sample[cap+'Sed']}"]`);if(q){q.checked=true;q.dispatchEvent(new Event('change'))}}
      ['SedGants','SedMateriaux','SedTamis','SedType','SedMode','SedGran'].forEach(suffix=>{const key=cap+suffix;if(f.sample[key]){const q=document.querySelector(`input[name="${key}"][value="${f.sample[key]}"]`);if(q)q.checked=true}});
      (f.sample[cap+'SedOutils']||[]).forEach(v=>{const q=document.querySelector(`input[name="${cap}SedOutil"][value="${v}"]`);if(q)q.checked=true});
      ['SedHauteur','SedTypeAutre','SedOutilAutre','SedMat','SedGranAutre','SedRecepteur','SedRemise'].forEach(suffix=>{const id=cap+suffix;if($(id)&&f.sample[id]!=null)$(id).value=f.sample[id]||''});
      document.querySelectorAll(`input[name="${cap}Sed"],input[name="${cap}SedTamis"]`).forEach(q=>q.dispatchEvent(new Event('change')));
    });
  }
  // Restore dynamically generated specific fields
  Object.entries(f.specific||{}).forEach(([k,v])=>{const e=$(k);if(e){if(e.type==='checkbox')e.checked=!!v;else e.value=v||''}});
  renderPhotos();updateDistance();$('save').textContent='💾 Mettre à jour la fiche';window.scrollTo(0,0);
  })(id);
  /* Restaure les champs qualité / traçabilité étendus (ancien correctif) */
  const f=records.find(x=>x.id===id);if(!f)return;
  setField('methodRef',f.methodRef);setField('methodVersion',f.methodVersion);
  const st=f.sampleTrace||{};setField('sampleId',st.sampleId);setField('sampleBottleLot',st.bottleLot);setField('tempDeparture',st.tempDeparture);setField('tempReception',st.tempReception);setField('transportAgent',st.transportAgent);setField('custodyDate',st.custodyDate);setField('custodyObs',st.custodyObs);
  const q=f.quality||{};radioSet('representative',q.representative);setField('representativeJustification',q.representativeJustification);radioSet('qc_blank',q.qcBlank);radioSet('qc_duplicate',q.qcDuplicate);radioSet('qc_material',q.qcMaterial);setField('uncertaintySource',q.uncertaintySource);
}
const SUIVI_PARAMS={
  ph:{label:'pH',unit:'u.pH'},
  temp:{label:'Température eau',unit:'°C'},
  cond:{label:'Conductivité à 25°C',unit:'µS/cm'},
  sal:{label:'Salinité',unit:''},
  o2mg:{label:'Oxygène dissous',unit:'mg/L O2'},
  o2pc:{label:'Saturation O2',unit:'%'},
  turb:{label:'Turbidité',unit:'NTU'},
  air:{label:'Température air',unit:'°C'}
};
// EL mesure chaque paramètre sur 3 profondeurs (surface / intermédiaire / fond) : on ajoute
// une entrée de suivi par profondeur pour ne pas perdre les 2/3 des données mesurées.
['ph','temp','cond','sal','o2mg','o2pc','turb'].forEach(base=>{
  [['surf','surface'],['inter','intermédiaire'],['fond','fond -1 m']].forEach(([suffix,depthLabel])=>{
    SUIVI_PARAMS[base+'_'+suffix]={label:SUIVI_PARAMS[base].label+' ('+depthLabel+')',unit:SUIVI_PARAMS[base].unit};
  });
});
const SUIVI_SESSION_ORDER={
  RCO:['S1 - Octobre 2026','S2 - Décembre 2026','S3 - Février 2027','S4 - Avril 2027'],
  Chimie:['S1 - Sept.26','S2 - Déc.26','S3 - Fév.27','S4 - Juin.27'],
  ESO:['Juillet 2026','Novembre 2026'],
  BIO:['Campagne biologique 2026'],
  EL:(DATA.EL_SESSIONS||[]).map(x=>x.label)
};
/* Valeur in situ representative d'un parametre, quelle que soit la structure du reseau.
   Les reseaux RCO/BIO/Chimie/ESO stockent une seule mesure par parametre (insitu[k].value).
   EL mesure a 3 profondeurs (surface/intermediaire/fond) : la profondeur de surface est
   retenue comme valeur de suivi, coherente avec les autres reseaux ; la turbidite EL utilise
   la moyenne des 3 repetitions de surface, comme dans le CRT. */
function suiviValueFor(record,param){
  const ins=record.insitu; if(!ins)return undefined;
  if(record.network==='EL'){
    // EL mesure sur 3 profondeurs : on utilise exclusivement les variantes _surf/_inter/_fond
    // (voir extension de SUIVI_PARAMS ci-dessous) pour ne perdre aucune des 3 séries.
    const m=/^(.+)_(surf|inter|fond)$/.exec(param);
    if(!m)return undefined;
    const [,base,depth]=m;
    if(base==='turb')return ins.turbidite?.[depth]?.moyenne;
    const key=base==='cond'?'condus':base;
    const depthKey=depth==='surf'?'surface':depth==='inter'?'intermediaire':'fond';
    const v=ins.params?.[key]?.[depthKey];
    return (v===undefined||v===null||v==='')?undefined:Number(v);
  }
  return ins[param]?.value;
}
function suiviParamsFor(network,station){
  const set=new Set();
  records.filter(r=>r.network===network&&r.station===station).forEach(r=>{
    Object.keys(SUIVI_PARAMS).forEach(k=>{if(Number.isFinite(Number(suiviValueFor(r,k))))set.add(k)})
  });
  return [...set];
}
function suiviStationsFor(network){
  return [...new Set(records.filter(r=>r.network===network&&r.station).map(r=>r.station))].sort((a,b)=>a.localeCompare(b,'fr'));
}
function suiviDateKey(r){return r.session || r.date || r.savedAt?.slice(0,10) || '';}
function suiviSortKey(k,network){
  const a=SUIVI_SESSION_ORDER[network]||[];const i=a.indexOf(k);return i>=0?String(i).padStart(3,'0')+'|'+k:k;
}
function suiviSeries(network,station,param){
  const rows=records.filter(r=>r.network===network&&r.station===station&&Number.isFinite(Number(suiviValueFor(r,param))));
  if(!rows.length)return [];
  const buckets=new Map();
  rows.forEach(r=>{
    const key=suiviDateKey(r); if(!key)return;
    const v=Number(suiviValueFor(r,param)); if(!Number.isFinite(v))return;
    if(!buckets.has(key))buckets.set(key,[]); buckets.get(key).push(v);
  });
  return [...buckets.entries()].map(([period,vals])=>({period,values:vals,mean:vals.reduce((a,b)=>a+b,0)/vals.length,min:Math.min(...vals),max:Math.max(...vals),n:vals.length}))
    .sort((a,b)=>{const ka=suiviSortKey(a.period,network),kb=suiviSortKey(b.period,network);return ka.localeCompare(kb,'fr')});
}
function fillSuiviSelect(id,items,placeholder){
  const el=$(id);if(!el)return;el.innerHTML='';
  const op=document.createElement('option');op.value='';op.textContent=placeholder||'— sélectionner —';el.appendChild(op);
  items.forEach(x=>{const o=document.createElement('option');o.value=x;o.textContent=x;el.appendChild(o)});
}
function drawMiniSuiviChart(canvas,series,label,unit){
  if(!canvas||!series.length)return;
  const rect=canvas.getBoundingClientRect(); const dpr=window.devicePixelRatio||1; const w=Math.max(280,rect.width||420),h=145;
  canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr); const c=canvas.getContext('2d'); c.setTransform(dpr,0,0,dpr,0,0); c.clearRect(0,0,w,h);
  const pad={l:38,r:10,t:12,b:30}, pw=w-pad.l-pad.r,ph=h-pad.t-pad.b;
  const ys=series.map(x=>x.mean); let min=Math.min(...ys),max=Math.max(...ys); if(min===max){min-=1;max+=1}else{const e=(max-min)*0.15;min-=e;max+=e}
  const xAt=i=>pad.l+(series.length===1?pw/2:i*(pw/(series.length-1)));
  const yAt=v=>pad.t+(max-v)*(ph/(max-min));
  c.strokeStyle='#d6dfdf';c.lineWidth=1;
  for(let i=0;i<4;i++){const v=min+i*(max-min)/3,y=yAt(v);c.beginPath();c.moveTo(pad.l,y);c.lineTo(w-pad.r,y);c.stroke();c.fillStyle='#6e7b82';c.font='9px Arial';c.textAlign='right';c.fillText(Number(v.toFixed(2)).toString(),pad.l-5,y+3)}
  c.strokeStyle='#003d7a';c.lineWidth=2;c.beginPath();series.forEach((p,i)=>{const x=xAt(i),y=yAt(p.mean);if(i===0)c.moveTo(x,y);else c.lineTo(x,y)});c.stroke();
  series.forEach((p,i)=>{const x=xAt(i),y=yAt(p.mean);c.fillStyle='#00ac97';c.beginPath();c.arc(x,y,3.5,0,Math.PI*2);c.fill();c.fillStyle='#003d7a';c.font='8.5px Arial';c.textAlign='center';const lab=p.period.length>11?p.period.slice(0,10)+'…':p.period;c.fillText(lab,x,h-13)});
  c.fillStyle='#6e7b82';c.font='9px Arial';c.textAlign='left';c.fillText(unit,pad.l,10);
}
function renderSuiviControls(){
  const networks=[...new Set(records.map(r=>r.network).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'fr'));
  const currentN=val('suiviNetwork'),currentS=val('suiviStation');
  fillSuiviSelect('suiviNetwork',networks,'— réseau —');
  if(networks.includes(currentN))$('suiviNetwork').value=currentN;
  const n=val('suiviNetwork'); const stations=suiviStationsFor(n); fillSuiviSelect('suiviStation',stations,'— station —');
  if(stations.includes(currentS))$('suiviStation').value=currentS;
}
function renderSuivi(){
  renderSuiviControls();
  const n=val('suiviNetwork'),s=val('suiviStation'); const dash=$('suiviDashboard'),empty=$('suiviEmpty'),msg=$('suiviMessage'),grid=$('suiviParamGrid');
  if(!dash||!empty||!grid)return;
  if(!n){dash.classList.add('hide');empty.classList.add('hide');msg.textContent=records.length?'Sélectionnez un réseau puis une station.':'Aucune fiche enregistrée pour le moment.';return}
  if(!s){dash.classList.add('hide');empty.classList.add('hide');msg.textContent='Sélectionnez une station.';return}
  const params=suiviParamsFor(n,s);
  if(!params.length){dash.classList.add('hide');empty.classList.remove('hide');msg.textContent='';return}
  empty.classList.add('hide');dash.classList.remove('hide');msg.textContent=params.length+' paramètre(s) in situ disponible(s) pour cette station.';
  const sample=records.find(r=>r.network===n&&r.station===s);
  $('suiviStationTitle').textContent=s;
  $('suiviStationMeta').textContent=[sample?.stationInfo?.code_me?'Masse d’eau '+sample.stationInfo.code_me:'',sample?.stationInfo?.bassin||'',sample?.stationInfo?.pressions||''].filter(Boolean).join(' · ')||'Aperçu de la station';
  $('suiviStationBadge').textContent=(sample?.stationInfo?.code||'Station');
  grid.innerHTML='';
  params.forEach(p=>{
    const series=suiviSeries(n,s,p),all=series.flatMap(x=>x.values); if(!all.length)return;
    const mean=all.reduce((a,b)=>a+b,0)/all.length,min=Math.min(...all),max=Math.max(...all),last=all[all.length-1];
    const card=document.createElement('div');card.className='suiviParamCard';
    card.innerHTML=`<div class="suiviParamHead"><div><div class="suiviParamName">${escapeHTML(SUIVI_PARAMS[p].label)}</div><div class="suiviParamUnit">${escapeHTML(SUIVI_PARAMS[p].unit)}</div></div><div class="suiviParamValue">${last.toFixed(2)}</div></div><div class="suiviParamBody"><div class="suiviMiniStats"><div class="suiviMiniStat"><div class="k">Moyenne</div><div class="v">${mean.toFixed(2)}</div></div><div class="suiviMiniStat"><div class="k">Min</div><div class="v">${min.toFixed(2)}</div></div><div class="suiviMiniStat"><div class="k">Max</div><div class="v">${max.toFixed(2)}</div></div></div><canvas class="suiviMiniChart"></canvas><div style="overflow:auto"><table class="suiviTrendTable"><thead><tr><th>Période</th><th>Moy.</th><th>N</th></tr></thead><tbody>${series.map(x=>`<tr><td>${escapeHTML(x.period)}</td><td>${x.mean.toFixed(3)}</td><td>${x.n}</td></tr>`).join('')}</tbody></table></div></div>`;
    grid.appendChild(card); drawMiniSuiviChart(card.querySelector('canvas'),series,SUIVI_PARAMS[p].label,SUIVI_PARAMS[p].unit);
  });
}
$('suiviNetwork').onchange=()=>{ $('suiviStation').value=''; renderSuivi() };
$('suiviStation').onchange=renderSuivi;
window.addEventListener('resize',()=>{if(document.getElementById('suivi')?.classList.contains('active'))renderSuivi()});

function csv(v){let s=Array.isArray(v)?v.join(' / '):v??'';s=String(s).replaceAll('"','""');return /[";\n]/.test(s)?'"'+s+'"':s}
function download(fn,c,m){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([c],{type:m}));a.download=fn;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),500)}
const AUTO_BACKUP_INTERVAL_MS=10*60*1000;
function maybeAutoBackup(){
  const last=custom.lastAutoBackup||0;
  if(Date.now()-last<AUTO_BACKUP_INTERVAL_MS){refreshAutoBackupStatus();return}
  custom.lastAutoBackup=Date.now();
  saveLS(LSC,custom);
  download('sauvegarde_auto_OEG_'+Date.now()+'.json',JSON.stringify({records,custom,version:20,exportedAt:new Date().toISOString(),auto:true},null,2),'application/json');
  toast('Sauvegarde automatique téléchargée ✓');
  refreshAutoBackupStatus();
}
function refreshAutoBackupStatus(){
  const el=$('autoBackupStatus');if(!el)return;
  const last=custom.lastAutoBackup;
  if(!last){el.textContent='Sauvegarde automatique : en attente du premier enregistrement de fiche.';return}
  const mins=Math.round((Date.now()-last)/60000);
  el.textContent='Dernière sauvegarde automatique : '+new Date(last).toLocaleString('fr-FR')+(mins<1?' (à l’instant)':' (il y a '+mins+' min)');
}
window.refreshAutoBackupStatus=refreshAutoBackupStatus;
$('importJSON').onchange=e=>{const f=e.target.files[0];if(!f)return;const fr=new FileReader();fr.onload=()=>{try{const d=JSON.parse(fr.result);if(d.records)records=records.concat(d.records);if(d.custom)custom=d.custom;saveLS(LS,records);saveLS(LSC,custom);renderOperators();renderEquipment();renderOrgOptions();renderPre();updateCount();renderList();if($('suivi')?.classList.contains('active'))renderSuivi();toast('Sauvegarde importée ✓')}catch(err){toast('JSON invalide')}};fr.readAsText(f)};
$('reset').onclick=()=>{if(confirm('Effacer toutes les fiches et données personnalisées ?')){localStorage.removeItem(LS);localStorage.removeItem(LSC);localStorage.removeItem('oeg_field_v3');localStorage.removeItem('oeg_custom_v3');records=[];custom={preleveurs:[],stations:[],equipements:[]};updateCount();renderList();renderAdmin()}};
function renderAdmin(){
  renderOperators();renderEquipment();refreshAutoBackupStatus();
  const allStations=stations(); const mk=[...new Set(allStations.map(x=>x.marche||x.market||'').filter(Boolean))]; const bv=[...new Set(allStations.map(x=>x.bassin||x.bassinVersant||'').filter(Boolean))]; const sm=$('customMarche'),sb=$('customBassin'); if(sm){const c=sm.value;sm.innerHTML='<option value="">— sélectionner un marché —</option>'+mk.map(v=>'<option>'+E(v)+'</option>').join('');if(mk.includes(c))sm.value=c} if(sb){const c=sb.value;sb.innerHTML='<option value="">— sélectionner un bassin versant —</option>'+bv.map(v=>'<option>'+E(v)+'</option>').join('');if(bv.includes(c))sb.value=c}
  const s=$('stationData');s.innerHTML=(custom.stations||[]).map((x,i)=>`<div class="listcard"><b>${escapeHTML(x.network)}</b> — ${escapeHTML(x.nom)} (${escapeHTML(x.code||'sans code')}) <button class="btn danger small" data-i="${i}">Supprimer</button></div>`).join('');
  s.querySelectorAll('button').forEach(b=>b.onclick=()=>{custom.stations.splice(Number(b.dataset.i),1);saveLS(LSC,custom);renderAdmin()});
}
$('addStation').onclick=()=>{
  const x={network:val('customNet')||'RCO',marche:val('customMarche'),nom:val('customStation').trim(),code:val('customCode').trim()||'Non défini',x:val('customX'),y:val('customY'),projection:val('customProjection')||'RGFG 95 / UTM 22N',bassin:val('customBassin'),bassinVersant:val('customBassin'),masseEau:val('customME'),transport:val('customTransport'),custom:true};
  if(!x.nom||x.x===''||x.y===''){toast('Nom de station + X et Y sont obligatoires');return}
  custom.stations.push(x);saveLS(LSC,custom);['customNet','customStation','customCode','customX','customY','customME','customTransport'].forEach(id=>$(id).value='');if($('customMarche'))$('customMarche').value='';if($('customBassin'))$('customBassin').value='';if($('customProjection'))$('customProjection').value='RGFG 95 / UTM 22N';renderAdmin();
};

['new','dashboard','list','suivi','quality','data'].forEach(v=>document.querySelector(`.tab[data-tab="${v}"]`).onclick=()=>{
  document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));document.querySelector(`.tab[data-tab="${v}"]`).classList.add('active');
  document.querySelectorAll('.view').forEach(x=>x.classList.remove('active'));$(v).classList.add('active');
  $('bar').style.display=v==='new'?'flex':'none';if(v==='dashboard')renderDashboard();if(v==='list')renderList();if(v==='suivi')renderSuivi();if(v==='quality')renderQuality();if(v==='data')renderAdmin()
});

renderNetworks();renderOrgOptions("Office de l'Eau de Guyane");setupSandre();if(typeof window.renderOperators==='function')window.renderOperators();else setTimeout(()=>window.renderOperators&&window.renderOperators(),0);if(typeof window.renderEquipment==='function')window.renderEquipment();else setTimeout(()=>window.renderEquipment&&window.renderEquipment(),0);if(typeof window.renderPre==='function')window.renderPre();else setTimeout(()=>window.renderPre&&window.renderPre(),0);updateCount();if(typeof window.renderList==='function')window.renderList();else setTimeout(()=>window.renderList&&window.renderList(),0);$('date').valueAsDate=new Date();setupMarketImport();


window.addEventListener('beforeprint',()=>{
  const h=$('printHeaderTitle');if(!h)return;
  const net=state.network||'';const st=state.station||'';const dt=$('date')?.value||'';
  h.textContent='Fiche terrain'+(net?' — '+net:'')+(st?' — '+st:'')+(dt?' — '+dt:'');
});