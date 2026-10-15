/* js/partage.js — Partage du référentiel et des données qualité entre tablettes (transport : js/sync.js).
 *
 * Chaque tablette publie sur le dossier Drive commun SES fichiers de partage (référentiel ; qualité),
 * et lit ceux des autres : deux tablettes n'écrivent donc jamais dans le même fichier.
 *
 * Les éléments partagés (opérateurs, équipements, stations ajoutées, accès, programme de marché,
 * organismes récepteurs ; non-conformités, configuration qualité, métadonnées CRT, fiches supprimées)
 * n'ont pas de date de modification : cette tablette mémorise, pour chacun, l'empreinte de son contenu
 * et la date à laquelle elle l'a vu changer (ou supprimé). À la fusion, pour un même élément, la
 * modification la plus récente l'emporte ; une suppression plus récente qu'une modification retire
 * l'élément partout. Un élément dont la date est inconnue (présent avant cette version, ou venant d'une
 * tablette pas encore à jour) ne remplace jamais un élément local : il est seulement ajouté s'il manque.
 * Le journal d'audit est réuni (union, sans doublon).
 *
 * Les fiches terrain voyagent, elles, dans leurs propres fichiers (js/sync.js) ; une fiche supprimée est
 * notée ici (deletedRecords) pour ne pas revenir à la récupération suivante, et retirée des autres
 * tablettes si elle n'y a pas été modifiée depuis.
 */
(function(){
  'use strict';
  const STATE_KEY='oeg_share_state_v1';
  const DEVICE_KEY='oeg_device_id';
  const AUDIT_MAX=5000;

  function loadJson(k,f){try{const r=localStorage.getItem(k);return r?JSON.parse(r):f}catch(e){return f}}
  let deviceId=null;
  try{deviceId=localStorage.getItem(DEVICE_KEY)}catch(e){}
  if(!deviceId){deviceId='T'+Math.random().toString(36).slice(2,10).toUpperCase();try{localStorage.setItem(DEVICE_KEY,deviceId)}catch(e){}}
  // kinds[kind][key] = {h: empreinte, t: date de la dernière modification connue (ms, 0 = inconnue), d: 1 si supprimé}
  let st=loadJson(STATE_KEY,null);
  if(!st||typeof st!=='object'||!st.kinds)st={kinds:{},init:{}};
  function saveState(){try{localStorage.setItem(STATE_KEY,JSON.stringify(st))}catch(e){}}

  // ---------- Collections partagées : lecture / écriture et identifiant de chaque élément ----------
  const opKey=o=>{if(typeof o==='string')return 'init|'+o.trim().toLowerCase();const d=typeof operatorDisplay==='function'?operatorDisplay(o):[o.prenom,o.nom].filter(Boolean).join(' ');const g=typeof operatorOrg==='function'?operatorOrg(o):(o.organisme||'');return (d+'|'+g).trim().toLowerCase()};
  const ovCode=g=>g==='ESO'?'code_bss':'code';
  // Opérateur à l'ancien format (simple chaîne d'initiales) : même conversion qu'au chargement (app-core.js)
  const OEG_INIT=['PF','AA','SM','ML','MG','MB'];
  const normOp=o=>typeof o==='string'?{nom:o,prenom:'',organisme:OEG_INIT.includes(o)?"Office de l'Eau de Guyane":'',legacy:true}:o;
  const KINDS={
    // Référentiel
    preleveurs:{group:'ref',type:'list',get:c=>Array.isArray(c.preleveurs)?c.preleveurs.map(normOp):c.preleveurs,set:(c,v)=>{c.preleveurs=v},key:opKey},
    equipements:{group:'ref',type:'list',get:c=>c.equipements,set:(c,v)=>{c.equipements=v},key:x=>String(x&&x.gmao||'').trim()},
    stations:{group:'ref',type:'list',get:c=>c.stations,set:(c,v)=>{c.stations=v},key:s=>String(s&&s.network||'')+'|'+String(s&&s.nom||'').trim()},
    receiverOrgs:{group:'ref',type:'list',get:c=>c.receiverOrgs,set:(c,v)=>{c.receiverOrgs=v},key:s=>String(s||'').trim()},
    stationAccess:{group:'ref',type:'map',get:c=>c.stationAccess,set:(c,v)=>{c.stationAccess=v}},
    stationOverrides:{group:'ref',type:'overrides',get:c=>c.stationOverrides,set:(c,v)=>{c.stationOverrides=v}},
    // Qualité
    nonConformites:{group:'qual',type:'list',get:c=>c.nonConformites,set:(c,v)=>{c.nonConformites=v},key:n=>String(n&&n.id||'')},
    qualityConfig:{group:'qual',type:'map',get:c=>c.qualityConfig,set:(c,v)=>{c.qualityConfig=v},skip:['appVersion']},
    crtMeta:{group:'qual',type:'map',get:c=>c.crtMeta,set:(c,v)=>{c.crtMeta=v}},
    deletedRecords:{group:'qual',type:'map',get:c=>c.deletedRecords,set:(c,v)=>{c.deletedRecords=v}}
  };
  // Collection -> {clé: élément}. En cas de doublon local (ancienne fusion), le premier est retenu ; les
  // autres sont conservés tels quels à la réécriture (rien n'est perdu).
  function toMap(kind,c){
    const K=KINDS[kind],raw=K.get(c),m={};
    if(!raw)return m;
    if(K.type==='list'){(Array.isArray(raw)?raw:[]).forEach(x=>{const k=K.key(x);if(k&&!(k in m))m[k]=x});}
    else if(K.type==='map'){Object.entries(raw).forEach(([k,v])=>{if(!(K.skip||[]).includes(k)&&v!==undefined)m[k]=v});}
    else if(K.type==='overrides'){Object.entries(raw).forEach(([g,rows])=>(Array.isArray(rows)?rows:[]).forEach(r=>{const k=g+'|'+String(r&&r[ovCode(g)]);if(!(k in m))m[k]=r}));}
    return m;
  }
  // Réécrit la collection locale : ordre local conservé, éléments remplacés / retirés / ajoutés
  function writeBack(kind,c,changes){
    const K=KINDS[kind];
    if(K.type==='list'){
      const out=[],done=new Set();
      (Array.isArray(K.get(c))?K.get(c):[]).forEach(x=>{const k=K.key(x);
        if(k in changes){if(done.has(k))return;done.add(k);if(changes[k]!==null)out.push(changes[k]);return}
        out.push(x)});
      Object.entries(changes).forEach(([k,v])=>{if(!done.has(k)&&v!==null)out.push(v)});
      K.set(c,out);
    }else if(K.type==='map'){
      const o={...(K.get(c)||{})};
      Object.entries(changes).forEach(([k,v])=>{if(v===null)delete o[k];else o[k]=v});
      K.set(c,o);
    }else{
      const o={};Object.entries(K.get(c)||{}).forEach(([g,rows])=>{o[g]=(Array.isArray(rows)?rows:[]).slice()});
      Object.entries(changes).forEach(([k,v])=>{const i=k.indexOf('|'),g=k.slice(0,i),code=k.slice(i+1);o[g]=o[g]||[];
        const idx=o[g].findIndex(r=>String(r&&r[ovCode(g)])===code);
        if(v===null){if(idx>=0)o[g].splice(idx,1)}else if(idx>=0)o[g][idx]=v;else o[g].push(v)});
      K.set(c,o);
    }
  }
  // Empreinte rapide et synchrone du contenu d'un élément (FNV-1a 2×32 bits), pour détecter un changement
  function hashOf(v){
    const t=JSON.stringify(typeof stableObj==='function'?stableObj(v):v)||'';let h1=0x811c9dc5,h2=0x01000193^0x5bd1e995;
    for(let i=0;i<t.length;i++){const c=t.charCodeAt(i);h1=Math.imul(h1^c,16777619);h2=Math.imul(h2^c,2246822519)}
    return (h1>>>0).toString(36)+'.'+(h2>>>0).toString(36)+'.'+t.length.toString(36);
  }

  // ---------- Datation des changements faits sur cette tablette ----------
  // Appelé avant chaque envoi : un élément nouveau, modifié ou supprimé depuis le dernier passage prend la
  // date du moment. Au tout premier passage, les éléments déjà présents gardent une date inconnue (0).
  function stamp(){
    const now=Date.now();let dirty=false;
    for(const kind of Object.keys(KINDS)){
      const m=toMap(kind,custom),meta=st.kinds[kind]||(st.kinds[kind]={}),first=!st.init[kind];
      for(const [k,v] of Object.entries(m)){
        const h=hashOf(v),e=meta[k];
        if(!e||e.d||e.h!==h){meta[k]={h,t:(first&&!e)?0:now};dirty=true}
      }
      // Collection vidée d'un coup (au moins 3 éléments) : réinitialisation de l'appareil ou incident, pas une
      // série de suppressions voulues — rien n'est retiré des autres tablettes, les éléments reviendront
      const gone=Object.keys(meta).filter(k=>!(k in m)&&!meta[k].d),live=Object.keys(meta).filter(k=>!meta[k].d).length;
      if(gone.length>=3&&gone.length===live&&!Object.keys(m).length){st.kinds[kind]={};dirty=true;continue}
      gone.forEach(k=>{meta[k]={t:now,d:1};dirty=true});
      if(first){st.init[kind]=1;dirty=true}
    }
    if(dirty)saveState();
  }

  // ---------- Contenu des fichiers de partage de cette tablette ----------
  // Mêmes champs que les anciens fichiers « _referentiel » / « _qualite » (lisibles, réimportables par
  // « Importer JSON »), plus share : identifiant de la tablette et dates des éléments (suppressions comprises).
  function payload(group){
    const o={type:group==='ref'?'referentiel_operateurs_equipements_stations':'qualite_audit_non_conformites'};
    const meta={};
    Object.entries(KINDS).forEach(([kind,K])=>{
      if(K.group!==group)return;
      o[kind]=K.get(custom)||(K.type==='list'?[]:{});
      const mm={};Object.entries(st.kinds[kind]||{}).forEach(([k,e])=>{mm[k]=e.d?{t:e.t,d:1}:{t:e.t}});meta[kind]=mm;
    });
    if(group==='qual')o.auditTrail=custom.auditTrail||[];
    o.share={format:2,deviceId,meta};
    o.exportedAt=new Date().toISOString();
    return o;
  }

  // ---------- Fusion d'un fichier venu d'une autre tablette ----------
  // Renvoie {changed, kinds:[collections modifiées], records:nb de fiches retirées}
  async function mergeRemote(p){
    const res={changed:false,kinds:[],records:0};
    if(!p||typeof p!=='object')return res;
    if(p.share&&p.share.deviceId===deviceId)return res; // notre propre fichier
    const rmetaAll=(p.share&&p.share.meta)||{};
    for(const [kind,K] of Object.entries(KINDS)){
      if(K.get(p)===undefined&&!rmetaAll[kind])continue;
      const rmap=toMap(kind,p),rmeta=rmetaAll[kind]||{},lmap=toMap(kind,custom),meta=st.kinds[kind]||(st.kinds[kind]={});
      const changes={};let touched=false;
      const keys=new Set([...Object.keys(rmap),...Object.keys(rmeta).filter(k=>rmeta[k]&&rmeta[k].d)]);
      for(const k of keys){
        const re=rmeta[k]||{},rt=Number(re.t)||0,le=meta[k],lt=le?Number(le.t)||0:0;
        if(!(k in rmap)){ // supprimé sur l'autre tablette
          if(k in lmap){if(rt>lt){changes[k]=null;meta[k]={t:rt,d:1};touched=true}}
          else if(!le||(!le.d&&rt>lt)||(le.d&&rt>lt)){meta[k]={t:rt,d:1};touched=true}
          continue;
        }
        const rv=rmap[k],rh=hashOf(rv);
        if(!(k in lmap)){
          if(le&&le.d&&lt>=rt)continue; // supprimé ici après cette version
          changes[k]=rv;meta[k]={h:rh,t:rt};touched=true;continue;
        }
        const lh=le&&le.h?le.h:hashOf(lmap[k]);
        if(lh===rh){if(rt>lt){meta[k]={h:rh,t:rt};touched=true}continue}
        if(rt>lt){changes[k]=rv;meta[k]={h:rh,t:rt};touched=true}
      }
      if(Object.keys(changes).length){writeBack(kind,custom,changes);res.changed=true;res.kinds.push(kind)}
      if(touched)saveState();
    }
    // Journal d'audit : union sans doublon, ordre chronologique, 5000 lignes au plus (les plus récentes)
    if(Array.isArray(p.auditTrail)&&p.auditTrail.length){
      const have=new Set((custom.auditTrail||[]).map(a=>a&&a.id));
      const add=p.auditTrail.filter(a=>a&&a.id&&!have.has(a.id));
      if(add.length){
        const all=(custom.auditTrail||[]).concat(add).sort((a,b)=>String(a.timestamp||'').localeCompare(String(b.timestamp||''))||String(a.id).localeCompare(String(b.id))).slice(-AUDIT_MAX);
        // Lignes plus anciennes que les 5000 conservées ici : écartées, sans compter comme un changement
        const addIds=new Set(add.map(a=>a.id));
        if(all.some(a=>addIds.has(a.id))){custom.auditTrail=all;res.changed=true;res.kinds.push('auditTrail')}
      }
    }
    res.records=applyRecordDeletions();
    if(res.records)res.changed=true;
    return res;
  }

  // Fiches supprimées sur une tablette : retirées ici, sauf si elles y ont été modifiées après la
  // suppression (la modification l'emporte) ou si elles sont ouvertes en modification.
  function deletedAt(id){const d=(custom.deletedRecords||{})[id];const t=d?Date.parse(d):NaN;return isNaN(t)?null:t}
  function isDeletedVersion(rec){
    if(!rec||!rec.id)return false;const t=deletedAt(rec.id);if(t===null)return false;
    const s=Date.parse(typeof recordStamp==='function'?recordStamp(rec):'');
    return isNaN(s)||s<=t;
  }
  function applyRecordDeletions(){
    if(!custom.deletedRecords||typeof records==='undefined')return 0;
    const editing=(typeof state!=='undefined'&&state)?state.editing:null;
    const before=records.length;
    const keep=records.filter(r=>r.id===editing||!isDeletedVersion(r));
    if(keep.length===before)return 0;
    records.length=0;keep.forEach(r=>records.push(r));
    return before-keep.length;
  }
  function noteRecordDeleted(id){
    if(!id)return;
    custom.deletedRecords=custom.deletedRecords||{};
    custom.deletedRecords[id]=new Date().toISOString();
  }

  // ---------- Écrans à rafraîchir après une fusion ----------
  function refreshUI(res){
    const k=new Set(res.kinds||[]),call=(f,...a)=>{try{if(typeof f==='function')f(...a)}catch(e){}};
    if(k.has('stationOverrides'))call(window.applyStationOverrides||(typeof applyStationOverrides==='function'?applyStationOverrides:null));
    if(k.has('stations')||k.has('stationOverrides')){
      // Liste des stations de la fiche : rafraîchie sans perdre la station choisie
      if(typeof fillStations==='function'&&typeof state!=='undefined'&&state.network){const cur=state.station;call(fillStations);if(cur&&$('station'))$('station').value=cur}
      call(window.mapStations);
    }
    if(k.has('preleveurs')){
      // Organisme, signataire et validateur en cours conservés (la mise à jour des listes les remettait à zéro)
      const keep=['org','signName','qualityValidator'].map(id=>[id,$(id)?$(id).value:'']);
      call(window.renderOperators||(typeof renderOperators==='function'?renderOperators:null));
      call(window.renderOrgOptions,keep[0][1]||undefined);call(window.renderPre);call(window.refreshPeople);
      keep.forEach(([id,v])=>{const e=$(id);if(!e||!v||e.value===v)return;if(e.tagName==='SELECT'&&![...e.options].some(o=>o.value===v)){const o=document.createElement('option');o.value=v;o.textContent=v;e.appendChild(o)}e.value=v});
    }
    if(k.has('equipements'))call(typeof renderEquipment==='function'?renderEquipment:null);
    if(k.has('qualityConfig'))call(typeof loadQualityConfig==='function'?loadQualityConfig:null);
    if(k.has('stations')||k.has('preleveurs')||k.has('equipements'))call(typeof renderAdmin==='function'?renderAdmin:null);
    if(res.records){call(typeof updateCount==='function'?updateCount:null);call(typeof renderList==='function'?renderList:null)}
    if($('quality')?.classList.contains('active'))call(typeof renderQuality==='function'?renderQuality:null);
    if($('suivi')?.classList.contains('active'))call(typeof renderSuivi==='function'?renderSuivi:null);
  }

  // État de départ daté dès l'ouverture de l'appli : tout changement fait ensuite (même avant le premier
  // envoi) aura sa date ; seul ce qui existait avant cette version garde une date inconnue
  try{stamp()}catch(e){}

  window.OEGShare={deviceId,stamp,payload,mergeRemote,refreshUI,noteRecordDeleted,isDeletedVersion,applyRecordDeletions,_state:()=>st};
})();
