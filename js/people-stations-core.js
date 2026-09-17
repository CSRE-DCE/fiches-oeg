(function(){
const q=id=>document.getElementById(id); const E=escapeHTML; /* echappement HTML unifie (voir app-core.js) */
function sedRules(){document.querySelectorAll('input[id$="SedHauteur"]').forEach(i=>{i.min=0;i.max=5;i.step=.1;i.oninput=()=>{if(+i.value>5){i.setCustomValidity('Maximum 5 cm');i.style.borderColor='var(--red)';toast('Alerte : maximum 5 cm')}else{i.setCustomValidity('');i.style.borderColor=''}}});document.querySelectorAll('input[name$="SedMode"]').forEach(r=>r.onchange=()=>{const p=r.name.replace('SedMode',''),show=radioValue(r.name)==='Intermédiaire (benne à sédiments, pelle…)';document.querySelectorAll('input[name="'+p+'SedOutil"]').forEach(x=>{x.disabled=!show;x.closest('.sedimentRow')?.classList.toggle('hide',!show)})})}
window.sedRules=sedRules;
function people(){const arr=(custom.preleveurs||[]).map(o=>typeof o==='string'?o:({name:[o.prenom,o.nom].filter(Boolean).join(' ')||o.nom||'',init:o.initiales||((o.prenom||'')[0]||'').concat((o.nom||'')[0]||'').toUpperCase(),org:o.organisme||''}));return arr}
window.people=people;
function refreshPeople(){const names=[...(typeof OEG_PRELEVEURS!=='undefined'?OEG_PRELEVEURS:[]),...people().map(o=>o.init+' — '+o.name)];['signName','qualityValidator'].forEach(id=>{const h=q(id);if(!h)return;const cur=h.value;h.innerHTML='<option value="">— sélectionner —</option>'+[...new Set(names)].map(v=>'<option value="'+E(v)+'">'+E(v)+'</option>').join('');if(names.includes(cur))h.value=cur})}
window.renderOrgOptions=renderOrgOptions;window.renderOperators=renderOperators;window.refreshPeople=refreshPeople;
function refreshPre(){const h=q('preleveurs');if(!h)return;const org=val('org'),base=org==='Office de l’Eau de Guyane'?(OEG_PRELEVEURS||[]):[],extra=people().filter(o=>o.org===org).map(o=>o.init),list=[...new Set([...base,...extra])],sel=new Set(state.preleveurs||[]);h.innerHTML=list.map((p,i)=>'<label class="check"><input type="checkbox" id="prex_'+i+'" value="'+E(p)+'" '+(sel.has(p)?'checked':'')+'><span>'+E(p)+'</span></label>').join('');h.querySelectorAll('input').forEach(x=>x.onchange=()=>state.preleveurs=[...h.querySelectorAll('input:checked')].map(a=>a.value))}
function renderPre(){refreshPre();if(typeof window.refreshPreUI==='function')window.refreshPreUI()}
window.renderPre=renderPre;
q('org')?.addEventListener('change',refreshPre);
q('addOperator')?.addEventListener('click',()=>setTimeout(()=>{const o=(custom.preleveurs||[]).at(-1);if(o){o.initiales=o.initiales||((o.prenom||'')[0]||'').concat((o.nom||'')[0]||'').toUpperCase();o.habilitations=[...document.querySelectorAll('#newOpHabil input:checked')].map(x=>x.value);o.habilitation=o.habilitations.join(', ');saveLS(LSC,custom)}refreshPeople();refreshPre()},50));
function receiverOrgOptions(){
  const base=["Office de l'Eau de Guyane","HYDRECO","EUROFINS"];
  const customOrgs=(custom.preleveurs||[]).map(operatorOrg).filter(Boolean);
  const manualOrgs=custom.receiverOrgs||[];
  return [...new Set([...base,...customOrgs,...manualOrgs])].sort((a,b)=>a.localeCompare(b,'fr'));
}
function rememberReceiverOrg(name){
  const v=(name||'').trim();
  if(!v||receiverOrgOptions().includes(v))return;
  custom.receiverOrgs=custom.receiverOrgs||[];
  custom.receiverOrgs.push(v);
  saveLS(LSC,custom);
}
function receivers(id){
  const input=q(id);if(!input||input.dataset.multi)return;
  input.dataset.multi='1';
  const dateId=id==='recepteur'?'remise':'esoRemise', dateInput=q(dateId);
  const field=input.closest('.field'), dateField=dateInput?.closest('.field');
  if(field)field.classList.add('hide');if(dateField)dateField.classList.add('hide');
  const w=document.createElement('div');w.className='transportReceivers';w.id='rxManager_'+id;
  w.innerHTML='<h4>Organismes récepteurs</h4><div class="hint">Choisissez un organisme dans la liste ou tapez directement le nom d’un nouvel organisme — il sera proposé automatiquement dans toutes les fiches suivantes. Plusieurs organismes peuvent être ajoutés, chacun avec sa propre date et heure de remise.</div><div id="rxRows_'+id+'"></div><button type="button" class="btn ghost small" id="rxAdd_'+id+'">＋ Ajouter un organisme récepteur</button><datalist id="rxOrgList_'+id+'"></datalist>';
  (field?.parentElement||input.parentElement).appendChild(w);
  const refreshDatalist=()=>{const dl=q('rxOrgList_'+id);if(dl)dl.innerHTML=receiverOrgOptions().map(o=>'<option value="'+E(o)+'">').join('')};
  refreshDatalist();
  const rows=()=>[...w.querySelectorAll('.receiverRow')].map(r=>({organisme:r.querySelector('.rxOrg')?.value.trim()||'',dateHeure:r.querySelector('.rxDate')?.value||''})).filter(x=>x.organisme||x.dateHeure);
  const draw=arr=>{const host=q('rxRows_'+id);host.innerHTML='';(arr&&arr.length?arr:[{organisme:'',dateHeure:''}]).forEach((x,i)=>{const r=document.createElement('div');r.className='receiverRow';r.innerHTML='<div class="field"><label>Organisme récepteur '+(i+1)+'</label><input class="rxOrg" list="rxOrgList_'+id+'" placeholder="Sélectionner ou saisir un organisme" value="'+E(x.organisme||'')+'"></div><div class="field"><label>Date et heure de remise</label><input class="rxDate" type="datetime-local" value="'+escapeHTML(x.dateHeure||'')+'"></div><button type="button" class="btn danger small rxRemove">Supprimer</button>';host.appendChild(r);const orgInput=r.querySelector('.rxOrg');orgInput.addEventListener('change',()=>{rememberReceiverOrg(orgInput.value);refreshDatalist()});r.querySelector('.rxRemove').onclick=()=>{if(host.children.length===1){orgInput.value='';r.querySelector('.rxDate').value=''}else{r.remove();[...host.children].forEach((row,j)=>row.querySelector('label').textContent='Organisme récepteur '+(j+1))}}})};
  let initial=[];try{initial=input.dataset.receivers?JSON.parse(input.dataset.receivers):[]}catch(e){}
  if(!initial.length&&(input.value||dateInput?.value))initial=[{organisme:input.value||'',dateHeure:dateInput?.value||''}];
  draw(initial);
  q('rxAdd_'+id).onclick=()=>{const a=rows();a.push({organisme:'',dateHeure:''});draw(a)};
  input._receiverRows=rows;input._renderReceiverRows=draw;
}
window.receivers=receivers;
function photoGroups(){const f=q('photos'),root=q('mediaGrid');if(!f||!root||f.dataset.grouped)return;f.dataset.grouped='1';const sel=document.createElement('select');sel.id='photoGroup';sel.innerHTML='<option>Amont</option><option>Aval</option><option>Rive gauche</option><option>Rive droite</option>';f.parentElement.appendChild(sel);const holder=document.createElement('div');holder.className='photoGroups';holder.innerHTML=['Amont','Aval','Rive gauche','Rive droite'].map(g=>'<div class="photoGroup"><h4>'+g+'</h4><div class="mediaGrid" data-group="'+g+'"></div></div>').join('');root.parentElement.insertBefore(holder,root);root.classList.add('hide');f.onchange=async e=>{for(const file of [...e.target.files].slice(0,5-state.photos.length))state.photos.push({data:await compress(file),group:sel.value});e.target.value='';drawPhotoGroups()};window.drawPhotoGroups=()=>{holder.querySelectorAll('[data-group]').forEach(h=>h.innerHTML='');(state.photos||[]).forEach((p,i)=>{const data=typeof p==='string'?p:p.data,g=typeof p==='string'?'Amont':(p.group||'Amont'),h=holder.querySelector('[data-group="'+g+'"]');if(h)h.insertAdjacentHTML('beforeend','<div class="thumb"><img src="'+data+'"><button data-i="'+i+'">×</button></div>')});holder.querySelectorAll('button').forEach(b=>b.onclick=()=>{state.photos.splice(+b.dataset.i,1);drawPhotoGroups()})};drawPhotoGroups()}
function stations(){let a=[];Object.values(DATA||{}).forEach(v=>Array.isArray(v)&&v.forEach(x=>a.push(x)));return a.concat(custom.stations||[]).filter(x=>x.nom)}
function meta(x){const a=(custom.stationAccess||{})[x?.code||x?.nom]||{};return {m:x.marche||x.market||a.marche||'',b:x.bassin||x.bassinVersant||x.bv||a.bassin||'',x:+x.x,y:+x.y}}
window.guyaneMap=null;window.guyaneLayer=null;
/* utmToLatLon() est fournie par js/geo.js (module ES partagé, voir window.utmToLatLon). */
function stationLatLon(x){if(Number.isFinite(+x.lat)&&Number.isFinite(+x.lon))return [+x.lat,+x.lon];const ex=Number(x.x),ny=Number(x.y);if(!Number.isFinite(ex)||!Number.isFinite(ny))return null;const proj=String(x.projection||x.refSpatial||x.reference||'RGFG 95 / UTM 22N');return utmToLatLon(ex,ny,/21/.test(proj)?21:22)}
function stationTransport(x){return x.transport||x.moyensTransport||x.transportNecessaire||'À préciser'}window.stations=stations;window.meta=meta;window.stationLatLon=stationLatLon;window.stationTransport=stationTransport;


function geoErrorMessage(err){
  if(!err||err.code===undefined)return 'Impossible d’obtenir la position.';
  if(err.code===1)return 'Localisation refusée — autorisez l’accès à la position dans les réglages du navigateur pour ce site.';
  if(err.code===2)return 'Position indisponible — vérifiez que le GPS/la localisation est activé sur l’appareil.';
  if(err.code===3)return 'Délai dépassé pour obtenir la position — réessayez, de préférence à l’extérieur avec un bon signal.';
  return 'Impossible d’obtenir la position : '+(err.message||'erreur inconnue');
}
window.geoErrorMessage=geoErrorMessage;
q('routeUsePosition')?.addEventListener('click',()=>{if(!navigator.geolocation)return toast('Géolocalisation non disponible sur cet appareil/navigateur');navigator.geolocation.getCurrentPosition(p=>{q('routeDeparture').value=p.coords.latitude.toFixed(6)+', '+p.coords.longitude.toFixed(6);toast('Position de départ renseignée ✓')},err=>toast(geoErrorMessage(err)),{enableHighAccuracy:true,timeout:10000,maximumAge:0})});

q('geolocateBtn')?.addEventListener('click',()=>{if(!navigator.geolocation)return toast('Géolocalisation non disponible sur cet appareil/navigateur');navigator.geolocation.getCurrentPosition(p=>{const zone=/21/.test(val('projection'))?21:22;const [x,y]=latLonToUtm(p.coords.latitude,p.coords.longitude,zone);q('xT').value=x.toFixed(2);q('yT').value=y.toFixed(2);updateDistance();toast('Position GPS renseignée ✓')},err=>toast(geoErrorMessage(err)),{enableHighAccuracy:true,timeout:10000,maximumAge:0})});

q('qualityRecord')?.addEventListener('change',()=>{if(q('qualityEditBtn'))return;const b=document.createElement('button');b.id='qualityEditBtn';b.className='btn ghost small';b.textContent='✏ Modifier la fiche';q('qualityChecks').parentElement.insertBefore(b,q('qualityChecks'));b.onclick=()=>{if(val('qualityRecord')){loadRecord(val('qualityRecord'));document.querySelector('[data-tab="new"]').click()}}});
const pb=q('printBtn');if(pb)pb.onclick=()=>window.print();
['new','list','suivi','quality','data','stations','crt','dashboard'].forEach(v=>{const b=document.querySelector('.tab[data-tab="'+v+'"]');if(!b)return;b.onclick=()=>{document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));b.classList.add('active');document.querySelectorAll('.view').forEach(x=>x.classList.remove('active'));q(v).classList.add('active');q('bar').style.display=v==='new'?'flex':'none';if(v==='dashboard')renderDashboard();if(v==='list')renderList();if(v==='suivi')renderSuivi();if(v==='quality')renderQuality();if(v==='data')renderAdmin();if(v==='stations')mapStations()}});
window.clearFormNoConfirm=clearFormNoConfirm;window.saveQualityRecord=saveQualityRecord;
function clearFormNoConfirm(){state={network:null,activity:null,bioOperation:null,session:null,station:null,editing:null,preleveurs:[],photos:[],draw:null,signature:null};document.querySelectorAll('#new input,#new textarea').forEach(e=>{if(e.type!=='file')e.value=''});document.querySelectorAll('#new select').forEach(e=>e.value='');document.querySelectorAll('#new input[type=radio],#new input[type=checkbox]').forEach(e=>e.checked=false);document.querySelectorAll('#networks .chip').forEach(c=>c.classList.remove('sel'));fill('station',[]);$('activityWrap').classList.add('hide');$('sessionWrap').classList.add('hide');hideForm();renderPre();if(window.drawPhotoGroups)drawPhotoGroups();$('save').textContent='💾 Enregistrer la fiche';if(window.clearDraft)window.clearDraft()}

// ---------- Brouillon automatique (protège contre la perte de saisie en cours) ----------
// Enregistre périodiquement, dans localStorage (jamais dans "records"), le contenu de la
// fiche en cours de création. Au prochain chargement de l'appli, si un brouillon existe,
// une bannière propose de le reprendre. Le brouillon est effacé dès que la fiche est
// réellement enregistrée ou que le formulaire est explicitement vidé (clearFormNoConfirm).
(function(){
  const DRAFT_KEY='oeg_draft_v1';
  let draftTimer=null, draftId=null;
  function canDraft(){return !state.editing && state.network && q('new')?.classList.contains('active')}
  function saveDraftNow(){
    if(!canDraft())return;
    try{
      if(!draftId)draftId=Date.now()+'_'+Math.random().toString(36).slice(2,7);
      const r=collectRecord();r.id=draftId;
      localStorage.setItem(DRAFT_KEY,JSON.stringify({record:r,savedAt:new Date().toISOString()}));
    }catch(e){/* stockage plein ou indisponible : tant pis pour ce brouillon */}
  }
  function scheduleDraftSave(){if(draftTimer)clearTimeout(draftTimer);draftTimer=setTimeout(saveDraftNow,2500)}
  window.clearDraft=function(){
    try{localStorage.removeItem(DRAFT_KEY)}catch(e){}
    draftId=null;if(draftTimer){clearTimeout(draftTimer);draftTimer=null}
    q('draftBanner')?.remove();
  };
  document.addEventListener('input',e=>{if(e.target?.closest?.('#new'))scheduleDraftSave()});
  document.addEventListener('change',e=>{if(e.target?.closest?.('#new'))scheduleDraftSave()});
  function showDraftBanner(draft){
    if(q('draftBanner'))return;
    const r=draft.record,when=new Date(draft.savedAt).toLocaleString('fr-FR');
    const label=[r.station,r.network,r.date].filter(Boolean).join(' · ');
    const div=document.createElement('div');div.id='draftBanner';div.className='banner info';
    div.innerHTML='📝 Brouillon non enregistré retrouvé ('+escapeHTML(label||'fiche en cours')+', enregistré le '+escapeHTML(when)+'). <button type="button" class="btn primary small" id="draftRestoreBtn" style="margin-left:8px">Reprendre</button> <button type="button" class="btn ghost small" id="draftDiscardBtn">Ignorer</button>';
    const host=q('new');if(host)host.insertBefore(div,host.firstChild);
    q('draftRestoreBtn').onclick=()=>{
      records.push(r);
      document.querySelector('[data-tab="new"]')?.click();
      loadRecord(r.id);
      const idx=records.findIndex(x=>x.id===r.id);if(idx>-1)records.splice(idx,1);
      state.editing=null;draftId=r.id;$('save').textContent='💾 Enregistrer la fiche';
      div.remove();toast('Brouillon restauré ✓');
    };
    q('draftDiscardBtn').onclick=()=>window.clearDraft();
  }
  setTimeout(()=>{
    try{
      const raw=localStorage.getItem(DRAFT_KEY);
      if(raw){const draft=JSON.parse(raw);if(draft?.record)showDraftBanner(draft)}
    }catch(e){}
  },300);
})();
setTimeout(()=>{refreshPeople();refreshPre();photoGroups();receivers('recepteur');receivers('esoRecepteur');sedRules();document.querySelectorAll('input[id$="SedHauteur"]').forEach(h=>{h.addEventListener('input',()=>{if(+h.value>5){h.value=5;toast('La hauteur de prélèvement ne peut pas dépasser 5 cm')}})})},100);
})();