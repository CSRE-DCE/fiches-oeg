/* ========== V17 : SYSTEME QUALITE / TRAÇABILITE / METROLOGIE ========== */
custom.auditTrail = Array.isArray(custom.auditTrail) ? custom.auditTrail : [];
custom.nonConformites = Array.isArray(custom.nonConformites) ? custom.nonConformites : [];
custom.qualityConfig = custom.qualityConfig || {};
custom.equipements = Array.isArray(custom.equipements) ? custom.equipements : [];
custom.preleveurs = Array.isArray(custom.preleveurs) ? custom.preleveurs : [];
records = Array.isArray(records) ? records : [];
records.forEach(r=>{
  if(!r.lifecycle) r.lifecycle={status:'À contrôler',version:1,createdAt:r.savedAt||new Date().toISOString(),updatedAt:r.savedAt||new Date().toISOString()};
  if(!r.lifecycle.status) r.lifecycle.status='À contrôler';
  if(!Array.isArray(r.auditRefs)) r.auditRefs=[];
});
saveLS(LSC,custom);
saveLS(LS,records);

function qEscape(v){return escapeHTML(v==null?'':String(v))}
function qActor(){
  const sign=val('signName').trim();
  if(sign)return sign;
  if(state.preleveurs?.length)return state.preleveurs.join(' / ');
  return val('org')||'Non renseigné';
}
function stableObj(x){
  if(Array.isArray(x))return x.map(stableObj);
  if(x&&typeof x==='object'){const o={};Object.keys(x).sort().forEach(k=>o[k]=stableObj(x[k]));return o}
  return x;
}
async function sha256(text){
  try{
    if(window.crypto?.subtle){
      const buf=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));
      return [...new Uint8Array(buf)].map(b=>b.toString(16).padStart(2,'0')).join('');
    }
  }catch(e){}
  let h=2166136261>>>0;for(let i=0;i<text.length;i++){h^=text.charCodeAt(i);h=Math.imul(h,16777619)}return 'FNV1A-'+(h>>>0).toString(16);
}
function integrityPayload(r){
  const copy=JSON.parse(JSON.stringify(r||{}));
  if(copy.lifecycle)delete copy.lifecycle.integrityHash;
  return JSON.stringify(stableObj(copy));
}
async function audit(event,recordId,details={}){
  const row={id:Date.now()+'_'+Math.random().toString(36).slice(2,7),timestamp:new Date().toISOString(),action:event,recordId:recordId||'',actor:qActor(),details};
  custom.auditTrail.push(row);if(custom.auditTrail.length>5000)custom.auditTrail=custom.auditTrail.slice(-5000);saveLS(LSC,custom);return row.id;
}
function setField(id,v){if($(id))$(id).value=v??''}
function radioSet(name,v){if(!v)return;const q=document.querySelector(`input[name="${name}"][value="${CSS.escape(v)}"]`);if(q)q.checked=true}

/* --- Métrologie --- */
function equipStatus(e){
  if(!e)return {cls:'metrologyBad',label:'Non référencé'};
  if(e.statut==='Hors service')return {cls:'metrologyBad',label:'Hors service'};
  if(e.echeance){
    const d=new Date(e.echeance+'T23:59:59');
    const now=new Date(); const diff=d-now;
    if(diff<0)return {cls:'metrologyBad',label:'Étalonnage expiré'};
    if(diff<30*864e5)return {cls:'metrologyWarn',label:'Échéance < 30 j'};
  }
  return {cls:'metrologyOK',label:'Statut métrologique OK'};
}
function renderOperators(){
  const h=$('operatorData');if(!h)return;
  h.innerHTML=(custom.preleveurs||[]).map((o,i)=>{
    const hab=o.habilitation||'Non renseignée';const ech=o.habilitationEcheance||'—';
    return `<div class="listcard"><div class="listtop"><div><b>${qEscape(operatorDisplay(o))}</b><div class="meta">${qEscape(operatorOrg(o)||'Organisme non renseigné')} · Habilitation : ${qEscape(hab)} · Échéance : ${qEscape(ech)}</div></div><button class="btn danger small" data-i="${i}">Supprimer</button></div></div>`;
  }).join('');
  h.querySelectorAll('button').forEach(b=>b.onclick=async()=>{const i=Number(b.dataset.i);const o=custom.preleveurs[i];custom.preleveurs.splice(i,1);saveLS(LSC,custom);await audit('SUPPRESSION_OPERATEUR','',{operateur:operatorDisplay(o),organisme:operatorOrg(o)});renderOperators();renderOrgOptions();renderPre();renderQuality();});
  /* Rafraîchit les listes signataire / validateur (fusionné depuis l'ancien correctif) */
  if(typeof window.refreshPeople==='function')window.refreshPeople();
}
function renderEquipment(){
  const h=$('equipmentData');if(!h)return;
  h.innerHTML=(custom.equipements||[]).map((x,i)=>{const st=equipStatus(x);return `<div class="listcard"><div class="listtop"><div><b>${qEscape(x.type)}</b> — ${qEscape(x.gmao)} — ${qEscape(x.nom)} — série ${qEscape(x.serie)}<div class="meta">Étalonnage : ${qEscape(x.calDate||'—')} · Échéance : ${qEscape(x.echeance||'—')} · ${qEscape(x.cert||'')}</div><span class="metrologyStatus ${st.cls}">${qEscape(st.label)}</span></div><button class="btn danger small" data-i="${i}">Supprimer</button></div></div>`}).join('');
  h.querySelectorAll('button').forEach(b=>b.onclick=async()=>{const i=Number(b.dataset.i);const x=custom.equipements[i];custom.equipements.splice(i,1);saveLS(LSC,custom);await audit('SUPPRESSION_EQUIPEMENT','',{gmao:x.gmao,nom:x.nom});renderEquipment();if(state.station)buildInsitu();renderQuality();});
}
$('addOperator').onclick=async()=>{
  const nom=val('newOpNom').trim(),prenom=val('newOpPrenom').trim(),organisme=val('newOpOrg').trim(),habilitation=val('newOpHabil').trim(),habilitationEcheance=val('newOpHabEch');
  if(!nom||!prenom||!organisme){toast('Nom, prénom et organisme sont requis');return}
  const exists=(custom.preleveurs||[]).some(o=>operatorDisplay(o).toLowerCase()===(`${prenom} ${nom}`).toLowerCase()&&operatorOrg(o).toLowerCase()===organisme.toLowerCase());
  if(exists){toast('Cet opérateur existe déjà pour cet organisme');return}
  custom.preleveurs.push({nom,prenom,organisme,habilitation,habilitationEcheance});saveLS(LSC,custom);await audit('AJOUT_OPERATEUR','',{operateur:`${prenom} ${nom}`,organisme,habilitation});
  ['newOpNom','newOpPrenom','newOpOrg','newOpHabil','newOpHabEch'].forEach(id=>setField(id,''));renderOperators();renderOrgOptions(organisme);if(val('org')===organisme)renderPre();renderQuality();toast('Opérateur validé');
};
$('addEquipment').onclick=async()=>{
  const e={type:val('newEqType'),gmao:val('newEqGmao').trim(),nom:val('newEqNom').trim(),serie:val('newEqSerie').trim(),calDate:val('newEqCalDate'),echeance:val('newEqCalDue'),cert:val('newEqCert'),statut:'En service'};
  if(!e.gmao||!e.nom||!e.serie){toast('Code GMAO, nom et n° série sont requis');return}
  if((custom.equipements||[]).some(x=>x.gmao===e.gmao)){toast('Ce code GMAO existe déjà');return}
  custom.equipements.push(e);saveLS(LSC,custom);await audit('AJOUT_EQUIPEMENT','',{gmao:e.gmao,nom:e.nom,serie:e.serie});['newEqGmao','newEqNom','newEqSerie','newEqCalDate','newEqCalDue','newEqCert'].forEach(id=>setField(id,''));renderEquipment();if(state.station)buildInsitu();renderQuality();toast('Équipement validé');
};





function recordDiff(oldR,newR){
  const keys=['network','activity','bioOperation','session','station','date','heureDebut','heureFin','organisme','preleveurs','xTerrain','yTerrain','ecartM','methodRef','methodVersion','qc','qcType','obs','comment','lifecycle','sampleTrace','quality'];
  return keys.filter(k=>JSON.stringify(oldR?.[k])!==JSON.stringify(newR?.[k]));
}
async function saveQualityRecord(){
  /* Garde-fous hauteur sédiment + turbidité (ancien correctif) */
  const bad=[...document.querySelectorAll('input[id$="SedHauteur"]')].some(h=>h.value!==''&&(Number(h.value)<0||Number(h.value)>5));
  if(bad){toast('Hauteur de prélèvement : maximum 5 cm');return}
  /* Turbidité : le formulaire EL utilise 3 répétitions par profondeur.
     L'ancien contrôle regardait uniquement les champs IV génériques (iv_turb_1..3),
     ce qui provoquait une fausse erreur sur les fiches EL. */
  if(state.network==='EL'){
    const depths=['surf','inter','fond'];
    for(const d of depths){
      const vals=[1,2,3].map(n=>val(`el_turb_${d}_${n}`).trim());
      const any=vals.some(v=>v!=='');
      if(any && (vals.length!==3 || vals.some(v=>v==='' || !Number.isFinite(Number(v))))){
        toast('Turbidité : les 3 mesures doivent être renseignées pour chaque profondeur utilisée');
        return;
      }
    }
  }else{
    const turb=[1,2,3].map(n=>val('iv_turb_'+n)).filter(v=>v!=='').map(Number);
    if(turb.length!==3||turb.some(v=>!Number.isFinite(v))){toast('Turbidité : les 3 mesures sont obligatoires');return}
  }
  const wasEditing=!!state.editing;
  /* Audit si modification après validation (ancien correctif) */
  const before=state.editing?records.find(x=>x.id===state.editing):null;
  if(before?.lifecycle?.status==='Validée') await audit('MODIFICATION_APRES_VALIDATION',before.id,{previousStatus:'Validée'});
  const result=await (async function saveQualityRecordCore(){
  if(!state.network||!state.station){toast('Sélectionnez le réseau et la station');return}
  const id=state.editing||Date.now()+'_'+Math.random().toString(36).slice(2,7);
  const previous=records.find(x=>x.id===state.editing);
  const r=collectRecord();r.id=id;
  const now=new Date().toISOString();const actor=qActor();
  const life=previous?.lifecycle||{status:'À contrôler',version:0,createdAt:now,createdBy:actor};
  r.lifecycle={...life,status:'À contrôler',version:(Number(life.version)||0)+(previous?1:0),createdAt:life.createdAt||now,createdBy:life.createdBy||actor,updatedAt:now,updatedBy:actor,modifiedAfterValidation:previous?.lifecycle?.status==='Validée'};
  r.auditRefs=Array.isArray(previous?.auditRefs)?previous.auditRefs.slice():[];
  r.lifecycle.integrityHash=await sha256(integrityPayload(r));
  if(previous){r.lifecycle.status=previous.lifecycle.status||'À contrôler';records=records.map(x=>x.id===id?r:x)}else records.push(r);
  const auditId=await audit(previous?'MODIFICATION_FICHE':'CREATION_FICHE',id,{station:r.station,network:r.network,session:r.session,changedFields:recordDiff(previous,r),version:r.lifecycle.version});
  r.auditRefs.push(auditId);
  saveLS(LSC,custom);
  if(!saveLS(LS,records)){records=previous?records.map(x=>x.id===id?previous:x):records.filter(x=>x!==r);return}
  state.editing=null;$('save').textContent='💾 Enregistrer la fiche';updateCount();renderList();renderQuality();if($('suivi')?.classList.contains('active'))renderSuivi();toast(previous?'Fiche mise à jour ✓':'Fiche enregistrée ✓');
  if(typeof window.maybeAutoBackup==='function')setTimeout(()=>window.maybeAutoBackup(),1200);
  })();
  if(!wasEditing && typeof window.clearFormNoConfirm==='function'){setTimeout(()=>window.clearFormNoConfirm(),0)}
  return result;
}$('save').onclick=saveQualityRecord;

/* --- Validation --- */
function openNCsFor(id){return (custom.nonConformites||[]).filter(n=>n.recordId===id&&n.status!=='Clôturée')}
function qualityChecksFor(r){
  const checks=[];
  checks.push({label:'Station et réseau renseignés',ok:!!(r?.network&&r?.station)});
  checks.push({label:'Opérateur(s) renseigné(s)',ok:Array.isArray(r?.preleveurs)&&r.preleveurs.length>0});
  checks.push({label:'Date et horaires',ok:!!(r?.date&&r?.heureDebut&&r?.heureFin)});
  checks.push({label:'Signature présente',ok:!!(r?.signature&&r.signature.length>100)});
  checks.push({label:'Alerte métrologique bloquante',ok:!metrologyAlertsFor(r).some(x=>x.level==='critical'),warn:metrologyAlertsFor(r).some(x=>x.level==='warning')});
  checks.push({label:'Non-conformité critique ouverte',ok:openNCsFor(r?.id).every(n=>n.severity!=='Critique')});
  checks.push({label:'Empreinte d’intégrité',ok:!!r?.lifecycle?.integrityHash});
  return checks;
}
function metrologyAlertsFor(r){
  const out=[];Object.values(r?.insitu||{}).forEach(d=>{if(!d||!d.gmao)return;const e=equipmentByGmao(d.gmao),st=equipStatus(e);if(st.cls==='metrologyBad')out.push({level:'critical',label:`${d.gmao}: ${st.label}`});else if(st.cls==='metrologyWarn')out.push({level:'warning',label:`${d.gmao}: ${st.label}`})});return out;
}
function fillQualityRecordSelects(){
  const arr=records.slice().sort((a,b)=>(b.savedAt||'').localeCompare(a.savedAt||''));
  ['qualityRecord','ncRecord'].forEach(id=>{const el=$(id);if(!el)return;const cur=el.value;el.innerHTML='<option value="">— sélectionner une fiche —</option>'+arr.map(r=>`<option value="${qEscape(r.id)}">${qEscape(r.station)} · ${qEscape(r.network)} · ${qEscape(r.date||'')} · ${qEscape(r.lifecycle?.status||'À contrôler')}</option>`).join('');if(arr.some(r=>r.id===cur))el.value=cur});
}
function renderQuality(){
  fillQualityRecordSelects();
  const c={draft:0,control:0,valid:0,rejected:0,openNC:0,criticalNC:0,expiredEq:0};records.forEach(r=>{const s=r.lifecycle?.status||'À contrôler';if(s==='Brouillon')c.draft++;else if(s==='À contrôler')c.control++;else if(s==='Validée')c.valid++;else if(s==='Rejetée')c.rejected++});(custom.nonConformites||[]).forEach(n=>{if(n.status!=='Clôturée'){c.openNC++;if(n.severity==='Critique')c.criticalNC++}});(custom.equipements||[]).forEach(e=>{if(equipStatus(e).cls==='metrologyBad')c.expiredEq++});
  $('qualitySummary').innerHTML=[['Fiches à contrôler',c.control],['Fiches validées',c.valid],['NC ouvertes',c.openNC],['NC critiques',c.criticalNC],['Équipements expirés',c.expiredEq]].map(x=>`<div class="qualityStat"><div class="k">${x[0]}</div><div class="v">${x[1]}</div></div>`).join('');
  renderNCList();renderAudit();
}
function renderQualityChecks(){
  const r=records.find(x=>x.id===val('qualityRecord'));const h=$('qualityChecks');if(!r){$('qualityStatus').value='';h.innerHTML='';return}$('qualityStatus').value=r.lifecycle?.status||'À contrôler';const checks=qualityChecksFor(r);h.innerHTML=checks.map(x=>`<div class="qualityCheck ${x.ok?'ok':(x.warn?'warn':'bad')}">${x.ok?'✓':'✕'} ${qEscape(x.label)}</div>`).join('');
}
$('qualityRecord').onchange=renderQualityChecks;
$('qualityControl').onclick=async()=>{const id=val('qualityRecord');const r=records.find(x=>x.id===id);if(!r)return toast('Sélectionnez une fiche');const now=new Date().toISOString();r.lifecycle={...(r.lifecycle||{}),status:'À contrôler',updatedAt:now,updatedBy:val('qualityValidator')||qActor(),validationComment:val('qualityValidationComment')||''};saveLS(LS,records);await audit('RETOUR_A_CONTROLER',id,{comment:r.lifecycle.validationComment});renderQuality();renderQualityChecks();toast('Fiche remise à contrôler');};
$('qualityValidate').onclick=async()=>{const id=val('qualityRecord');const r=records.find(x=>x.id===id);if(!r)return toast('Sélectionnez une fiche');const name=val('qualityValidator').trim();const checks=qualityChecksFor(r);if(!name)return toast('Nom du validateur requis');if(checks.some(c=>!c.ok)){toast('Validation bloquée : contrôles qualité incomplets');renderQualityChecks();return}const now=val('qualityValidationDate')?new Date(val('qualityValidationDate')).toISOString():new Date().toISOString();r.lifecycle={...(r.lifecycle||{}),status:'Validée',validatedAt:now,validatedBy:name,validationComment:val('qualityValidationComment'),updatedAt:now,updatedBy:name};r.lifecycle.integrityHash=await sha256(integrityPayload(r));saveLS(LS,records);await audit('VALIDATION_FICHE',id,{validator:name,comment:r.lifecycle.validationComment});renderQuality();renderQualityChecks();toast('Fiche validée ✓');};
$('qualityReject').onclick=async()=>{const id=val('qualityRecord');const r=records.find(x=>x.id===id);if(!r)return toast('Sélectionnez une fiche');const name=val('qualityValidator').trim();if(!name)return toast('Nom du validateur requis');const now=new Date().toISOString();r.lifecycle={...(r.lifecycle||{}),status:'Rejetée',validatedAt:now,validatedBy:name,validationComment:val('qualityValidationComment'),updatedAt:now,updatedBy:name};r.lifecycle.integrityHash=await sha256(integrityPayload(r));saveLS(LS,records);await audit('REJET_FICHE',id,{validator:name,comment:r.lifecycle.validationComment});renderQuality();renderQualityChecks();toast('Fiche rejetée');};

/* --- Non-conformités --- */
$('addNC').onclick=async()=>{const recordId=val('ncRecord');const desc=val('ncDescription').trim();if(!recordId||!desc)return toast('Fiche et description de l’écart requis');const n={id:Date.now()+'_'+Math.random().toString(36).slice(2,6),recordId,category:val('ncCategory'),severity:val('ncSeverity'),status:val('ncStatus'),responsible:val('ncResponsible'),dueDate:val('ncDueDate'),description:desc,immediate:val('ncImmediate'),corrective:val('ncCorrective'),createdAt:new Date().toISOString(),createdBy:qActor()};custom.nonConformites.push(n);saveLS(LSC,custom);await audit('CREATION_NON_CONFORMITE',recordId,{id:n.id,severity:n.severity,category:n.category});['ncResponsible','ncDueDate','ncDescription','ncImmediate','ncCorrective'].forEach(id=>setField(id,''));renderQuality();toast('Non-conformité enregistrée');};
function renderNCList(){const h=$('ncList');if(!h)return;const arr=(custom.nonConformites||[]).slice().sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)));h.innerHTML=arr.length?arr.map(n=>{const r=records.find(x=>x.id===n.recordId);return `<div class="listcard"><div class="listtop"><div><b>${qEscape(n.severity)} — ${qEscape(n.category)}</b><div class="meta">${qEscape(r?.station||'Fiche supprimée')} · ${qEscape(n.status)} · ${qEscape(n.createdAt?.slice(0,16).replace('T',' '))}</div></div><button class="btn ${n.status==='Clôturée'?'ghost':'primary'} small" data-nc="${qEscape(n.id)}">${n.status==='Clôturée'?'Réouvrir':'Clôturer'}</button></div><div style="margin-top:6px;font-size:12px">${qEscape(n.description)}</div><div class="meta" style="margin-top:4px">Responsable : ${qEscape(n.responsible||'—')} · Échéance : ${qEscape(n.dueDate||'—')}</div></div>`}).join(''):'<div class="suiviEmpty">Aucune non-conformité enregistrée.</div>';h.querySelectorAll('[data-nc]').forEach(b=>b.onclick=async()=>{const n=custom.nonConformites.find(x=>x.id===b.dataset.nc);if(!n)return;n.status=n.status==='Clôturée'?'Ouverte':'Clôturée';n.closedAt=n.status==='Clôturée'?new Date().toISOString():'';n.closedBy=qActor();saveLS(LSC,custom);await audit(n.status==='Clôturée'?'CLOTURE_NON_CONFORMITE':'REOUVERTURE_NON_CONFORMITE',n.recordId,{id:n.id});renderQuality()})}

async function verifyAllIntegrity(){let ok=0,bad=0;for(const r of records){const expected=await sha256(integrityPayload(r));if(r.lifecycle?.integrityHash===expected)ok++;else bad++}$('integrityResult').innerHTML=`<div class="banner ${bad?'danger':''}" style="margin:0">Empreintes vérifiées : <b>${ok}</b> OK · <b>${bad}</b> à contrôler.</div>`;await audit('VERIFICATION_INTEGRITE','',{ok,bad});renderAudit()}
$('runIntegrity').onclick=verifyAllIntegrity;
$('clearAuditView').onclick=renderQuality;
function renderAudit(){const h=$('auditBody');if(!h)return;const arr=(custom.auditTrail||[]).slice().reverse().slice(0,250);h.innerHTML=arr.length?arr.map(a=>`<tr><td>${qEscape((a.timestamp||'').replace('T',' ').slice(0,19))}</td><td>${qEscape(a.action)}</td><td>${qEscape((records.find(r=>r.id===a.recordId)?.station)||a.recordId||'—')}</td><td>${qEscape(a.actor)}</td><td>${qEscape(JSON.stringify(a.details||{}).slice(0,220))}</td></tr>`).join(''):'<tr><td colspan="5">Aucun évènement d’audit.</td></tr>'}

/* --- Export / import renforcés --- */
$('exportJSON').onclick=async()=>{await audit('EXPORT_JSON','',{records:records.length});saveLS(LSC,custom);download('sauvegarde_OEG_'+Date.now()+'.json',JSON.stringify({records,custom,version:20,exportedAt:new Date().toISOString()},null,2),'application/json')};
$('exportCSV').onclick=async()=>{await audit('EXPORT_CSV','',{records:records.length});const cols=['id','network','activity','bioOperation','session','station','date','heureDebut','heureFin','organisme','preleveurs','xTheorique','yTheorique','xTerrain','yTerrain','ecartM','methodRef','methodVersion','obs','comment','status'];const rows=[cols.join(';')];records.forEach(r=>rows.push(cols.map(c=>csv(c==='status'?(r.lifecycle?.status||''):(c==='preleveurs'?r.preleveurs:r[c]))).join(';')));download('fiches_OEG_'+Date.now()+'.csv','\uFEFF'+rows.join('\n'),'text/csv;charset=utf-8')};

/* Import : conserver un historique et initialiser les nouvelles structures. */
// Gestionnaire unique du bouton "Importer JSON" (seul point d'entrée — ne pas en ajouter un
// second ailleurs, la dernière affectation à .onchange écraserait silencieusement les autres).
// Accepte soit une sauvegarde consolidée ({records:[...],custom:{...}}, export manuel ou
// sauvegarde automatique périodique), soit plusieurs fichiers individuels sélectionnés d'un
// coup (une fiche = un fichier, comme écrits dans le dossier local ou récupérés depuis Drive) —
// utile pour récupérer des fiches d'une ancienne version de l'appli après une mise à jour.
// Les fiches dont l'identifiant existe déjà sont mises à jour, les autres sont ajoutées ; le
// référentiel (équipements/opérateurs/stations) est fusionné via mergeCustomInto() plutôt
// qu'écrasé, pour ne jamais perdre de données déjà présentes sur cet appareil.
function ensureLifecycle(r){
  if(!r.lifecycle)r.lifecycle={status:'À contrôler',version:1,createdAt:r.savedAt||new Date().toISOString(),updatedAt:r.savedAt||new Date().toISOString()};
  return r;
}
$('importJSON').onchange=e=>{
  const files=[...e.target.files];
  if(!files.length)return;
  let imported=0,updated=0,fail=0,pending=files.length;
  const finish=async()=>{
    saveLS(LS,records);saveLS(LSC,custom);
    await audit('IMPORT_JSON','',{nouvelles:imported,misesAJour:updated,echecs:fail});
    renderOperators();renderEquipment();renderOrgOptions();renderPre();updateCount();renderList();renderQuality();
    if($('suivi')?.classList.contains('active'))renderSuivi();
    e.target.value='';
    toast(`Import terminé : ${imported} nouvelle(s) fiche(s), ${updated} mise(s) à jour`+(fail?`, ${fail} fichier(s) invalide(s)`:'')+' ✓');
  };
  files.forEach(f=>{
    const fr=new FileReader();
    fr.onload=()=>{
      try{
        const d=JSON.parse(fr.result);
        if(Array.isArray(d.records)){
          d.records.forEach(r=>{
            ensureLifecycle(r);
            const idx=records.findIndex(x=>x.id===r.id);
            if(idx>-1){records[idx]=r;updated++}else{records.push(r);imported++}
          });
          if(d.custom)mergeCustomInto(custom,d.custom);
        }else if(d&&d.id&&d.network){
          ensureLifecycle(d);
          const idx=records.findIndex(x=>x.id===d.id);
          if(idx>-1){records[idx]=d;updated++}else{records.push(d);imported++}
        }else{fail++}
      }catch(err){fail++}
      if(--pending===0)finish();
    };
    fr.onerror=()=>{fail++;if(--pending===0)finish()};
    fr.readAsText(f);
  });
};

/* --- Liste des fiches : statut + métrologie + NC ouvertes --- */
function renderList(){const q=val('search').toLowerCase(),h=$('records');let arr=records.slice().sort((a,b)=>(b.savedAt||'').localeCompare(a.savedAt||''));if(q)arr=arr.filter(x=>JSON.stringify(x).toLowerCase().includes(q));if(!arr.length){h.innerHTML='<div class="empty">Aucune fiche enregistrée.</div>';return}h.innerHTML='';arr.forEach(f=>{const d=document.createElement('div');d.className='listcard';const st=f.lifecycle?.status||'À contrôler',nc=openNCsFor(f.id).length;d.innerHTML=`<div class="listtop"><div><div class="listname">${qEscape(f.station)}</div><div class="meta">${qEscape(f.network)} · ${qEscape(f.activity||'')}${f.network==='BIO'&&f.bioOperation?' · '+qEscape(f.bioOperation):''} · ${qEscape(f.date||'')} · ${qEscape(f.heureDebut||'')}–${qEscape(f.heureFin||'')}</div></div><span class="badge">${qEscape(st)}</span></div><div class="meta" style="margin-top:5px">${nc?`⚠ ${nc} NC ouverte(s)`:'✓ Aucune NC ouverte'} · Version ${qEscape(f.lifecycle?.version||1)}</div><div class="actions" style="margin-top:8px"><button class="btn ghost small">✏ Modifier</button><button class="btn ghost small">⧉ Dupliquer</button><button class="btn danger small">🗑 Supprimer</button></div>`;const b=d.querySelectorAll('button');b[0].onclick=()=>loadRecord(f.id);b[1].onclick=()=>{loadRecord(f.id);state.editing=null;$('save').textContent='💾 Enregistrer la fiche'};b[2].onclick=async()=>{if(confirm('Supprimer cette fiche ?')){records=records.filter(x=>x.id!==f.id);saveLS(LS,records);await audit('SUPPRESSION_FICHE',f.id,{station:f.station,network:f.network});updateCount();renderList();renderQuality();if($('suivi')?.classList.contains('active'))renderSuivi()}};h.appendChild(d)})}

/* --- Qualité : configuration persistante --- */
['qualityMethodRef','qualityMethodVersion','qualityInterlab','qualityMaterialRef'].forEach(id=>{
  $(id).oninput=()=>{custom.qualityConfig[id]=val(id);saveLS(LSC,custom)};
});
function loadQualityConfig(){Object.entries(custom.qualityConfig||{}).forEach(([k,v])=>{if($(k))$(k).value=v||''})}

/* --- Onglet Qualité --- */
document.querySelector('.tab[data-tab="quality"]').addEventListener('click',()=>{renderQuality();loadQualityConfig();});

/* Initialisation finale */
renderOperators();renderEquipment();renderQuality();loadQualityConfig();