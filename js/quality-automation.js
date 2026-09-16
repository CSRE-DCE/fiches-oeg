/* ========== V19 : CONTRÔLES QUALITE AUTOMATISES + TABLEAU DE BORD ========== */
(function(){
  const V19_VERSION='20.0';
  const UNITS={ph:'u.pH',temp:'°C',cond:'µS/cm',sal:'µS/cm',o2mg:'mg/L',o2pc:'%',turb:'NTU',air:'°C'};
  window.UNITS=UNITS;
  const LABELS={ph:'pH',temp:"Température de l'eau",cond:'Conductivité',sal:'Salinité',o2mg:'Oxygène dissous',o2pc:'Saturation O₂',turb:'Turbidité',air:"Température de l'air"};
  const RANGES={ph:{min:4,max:8,unit:'u.pH'},temp:{min:21,max:32,unit:'°C'}};
  custom.qualityConfig=custom.qualityConfig||{};
  if(custom.qualityConfig.gpsMaxDeviationM==null || Number(custom.qualityConfig.gpsMaxDeviationM)===100) custom.qualityConfig.gpsMaxDeviationM=1000;
  if(custom.qualityConfig.maxDelayHours==null) custom.qualityConfig.maxDelayHours=48;
  custom.qualityConfig.appVersion=V19_VERSION;
  saveLS(LSC,custom);

  function qcNum(v){const n=Number(String(v).replace(',','.'));return Number.isFinite(n)?n:null}
  function pad(n){return String(n).padStart(2,'0')}
  function dtLocal(date,time){ if(!date||!time)return null; const d=new Date(`${date}T${time}`); return Number.isNaN(d.getTime())?null:d; }
  function asDate(s){const d=new Date(s);return Number.isNaN(d.getTime())?null:d}
  function recKey(r){return [r.network||'',r.activity||'',r.bioOperation||'',r.session||'',r.station||'',r.date||''].join('|')}
  function stationKey(s){return s?.code||s?.code_bss||s?.nom||''}
  function allRecords(){return Array.isArray(records)?records:[]}
  function withState(fn,r){const old={network:state.network,activity:state.activity,bioOperation:state.bioOperation,session:state.session,station:state.station};
    state.network=r?.network||state.network;state.activity=r?.activity||null;state.bioOperation=r?.bioOperation||null;state.session=r?.session||null;state.station=r?.station||null;
    let x;try{x=fn()}finally{Object.assign(state,old)}return x;}
  function programmedStation(r){
    if(!r?.network||!r?.station)return {ok:false,reason:'Réseau ou station absent'};
    const arr=withState(()=>stationsFor(r.network,r.activity),r)||[];
    const found=arr.find(s=>String(s.nom||'')===String(r.station));
    return {ok:!!found,station:found||null,reason:found?'Station programmée':'Station absente de la programmation de la session/opération sélectionnée'};
  }
  function operatorStatus(name){
    const target=String(name||'').trim().toLowerCase();
    const all=custom.preleveurs||[];
    const match=all.find(o=>String(operatorDisplay(o)).trim().toLowerCase()===target);
    if(match){
      const due=match.habilitationEcheance||match.habEch||'';
      const d=due?new Date(due+'T23:59:59'):null;
      if(d && d<new Date()) return {state:'expired',label:'Habilitation expirée'};
      return due?{state:'valid',label:'Habilitation enregistrée'}:{state:'unknown',label:'Habilitation à documenter'};
    }
    if((OEG_PRELEVEURS||[]).map(String).some(x=>x.toLowerCase()===target)) return {state:'unknown',label:'Préleveur historique OEG — habilitation à documenter'};
    return {state:'missing',label:'Opérateur non référencé dans les habilitations'};
  }
  function eqStatusFor(gmao){return equipStatus(equipmentByGmao(gmao))}
  function stationCoords(r){const s=r?.stationInfo||getStation();return s||null}
  function dateTimeOfRecord(r){return dtLocal(r?.date,r?.heureDebut)}
  function custodyDateOfRecord(r){return asDate(r?.sampleTrace?.custodyDate||r?.sample?.remise||r?.sample?.esoRemise||r?.custodyDate||'')}
  function filtrationCheck(r){
    const s=r?.sample||{}; const out=[];
    const pairs=[['filtresSite',''],['filtresSiteEso','eso']];
    pairs.forEach(([field,p])=>{
      const v=s[field]||''; const relevant=field==='filtresSiteEso'?r.network==='ESO':r.network!=='ESO';
      if(!relevant||!v)return;
      if(v==='Non'){
        const d=s['filtreDate'+p],h=s['filtreHeure'+p];
        out.push(d&&h?{label:'Filtration hors site : date/heure renseignées',ok:true}:{label:'Filtration hors site : date/heure manquantes',ok:false,level:'critical'});
      }else if(v==='Oui'){
        const keys=['chloro','metaux','autres']; const any=keys.some(k=>s['filtreParam_'+p+k]);
        out.push({label:'Filtration sur site : paramètre sélectionné',ok:any,level:any?'info':'warning'});
        keys.forEach(k=>{if(s['filtreParam_'+p+k]){
          const vol=s['filtre_'+p+k+'_volume']; const mode=s['filtreMode_'+p+k];
          out.push({label:`Filtration ${k}: volume renseigné`,ok:vol!==''&&vol!=null,level:'critical'});
          out.push({label:`Filtration ${k}: mode renseigné`,ok:!!mode,level:'critical'});
        }});
      }
    });
    return out;
  }
  function coldChainCheck(r){
    const s=r?.sampleTrace||{}; const sm=r?.sample||{}; const cooling=sm.transportFroid||sm.esoFroid||'';
    const checks=[];
    if(cooling){
      checks.push({label:'Chaîne de froid : moyen renseigné',ok:true});
      checks.push({label:'Chaîne de froid : suivi température renseigné',ok:!!(sm.transportSuivi||sm.esoSuivi||''),level:'critical'});
      checks.push({label:'Chaîne de froid : température départ renseignée',ok:s.tempDeparture!==''&&s.tempDeparture!=null,level:'critical'});
      checks.push({label:'Chaîne de froid : température réception renseignée',ok:s.tempReception!==''&&s.tempReception!=null,level:'critical'});
    }
    return checks;
  }
  function delayCheck(r){
    const p=dateTimeOfRecord(r), c=custodyDateOfRecord(r); if(!p||!c)return [{label:'Délai prélèvement → remise calculable',ok:false,level:'warning'}];
    const hours=(c-p)/36e5;
    if(hours<0)return [{label:'Délai prélèvement → remise cohérent',ok:false,level:'critical',detail:`${hours.toFixed(1)} h`}];
    const max=Number(custom.qualityConfig.maxDelayHours)||48;
    return [{label:`Délai prélèvement → remise ≤ ${max} h (règle OEG paramétrable)`,ok:hours<=max,level:hours<=max?'info':'warning',detail:`${hours.toFixed(1)} h`}];
  }
  function duplicateCheck(r){
    const key=recKey(r); const dup=allRecords().filter(x=>x.id!==r.id&&recKey(x)===key);
    return {ok:dup.length===0,detail:dup.length?`${dup.length} doublon(s) potentiel(s)`:'Aucun doublon exact'};
  }
  function atypicalChecks(r){
    const out=[];Object.entries(r?.insitu||{}).forEach(([k,d])=>{const n=qcNum(d?.value);if(n==null)return;
      if(RANGES[k]){const z=RANGES[k];out.push({label:`${LABELS[k]} : valeur dans la plage  ${z.min}–${z.max} ${z.unit}`,ok:n>=z.min&&n<=z.max,level:'warning',detail:String(n)});}
      else out.push({label:`${LABELS[k]||k} : valeur numérique`,ok:Number.isFinite(n),level:'critical'});
    });return out;
  }
  function insituChecks(r){
    const out=[]; const entries=Object.entries(r?.insitu||{}); const withVal=entries.filter(([k,d])=>d&&String(d.value??'').trim()!=='');
    out.push({label:'Mesures in situ : au moins une mesure enregistrée',ok:withVal.length>0,level:'warning'});
    if(withVal.length>0){
      entries.forEach(([k,d])=>{const blank=String(d?.value??'').trim()==='';if(blank)out.push({label:`${LABELS[k]||k} : mesure manquante — à justifier ou réaliser`,ok:false,level:'warning'});});
    }
    entries.forEach(([k,d])=>{
      const val=String(d?.value??'').trim();if(val==='')return;
      const n=qcNum(val); out.push({label:`${LABELS[k]||k} : valeur numérique`,ok:n!==null,level:'critical'});
      out.push({label:`${LABELS[k]||k} : unité attendue ${UNITS[k]||'—'}`,ok:UNITS[k]!=null,level:'warning'});
      if(!d?.gmao) out.push({label:`${LABELS[k]||k} : code GMAO présent`,ok:false,level:'critical'});
      else {const st=eqStatusFor(d.gmao);out.push({label:`${LABELS[k]||k} : équipement valide`,ok:st.cls!=='metrologyBad',level:st.cls==='metrologyWarn'?'warning':'critical',detail:st.label});}
    });return out;
  }
  function gpsChecks(r){
    const s=stationCoords(r); const xt=qcNum(r?.xTerrain),yt=qcNum(r?.yTerrain),xs=qcNum(s?.x),ys=qcNum(s?.y);
    if(xs==null||ys==null)return [{label:'Coordonnées GPS théoriques disponibles',ok:true,level:'info'}];
    const out=[];out.push({label:'Coordonnées GPS terrain numériques',ok:xt!==null&&yt!==null,level:'critical'});
    if(xt!==null&&yt!==null){
      const d=Math.hypot(xt-xs,yt-ys),max=Number(custom.qualityConfig.gpsMaxDeviationM)||1000;
      out.push({label:'Écart GPS calculé',ok:true,level:'info',detail:`${d.toFixed(1)} m`});
      out.push({label:`Écart GPS ≤ ${max} m (règle OEG paramétrable)`,ok:d<=max,level:'warning',detail:`${d.toFixed(1)} m`});
    } else out.push({label:'Écart GPS calculable',ok:false,level:'critical'});
    return out;
  }
  function qualityChecksV19(r){
    const checks=[];
    checks.push({label:'Station et réseau renseignés',ok:!!(r?.network&&r?.station),level:'critical'});
    const ps=programmedStation(r);checks.push({label:'Station programmée pour la session / opération',ok:ps.ok,level:'critical'});checks.push({label:'Session cohérente avec la station',ok:ps.ok,level:'critical'});
    checks.push({label:'Date renseignée',ok:!!r?.date,level:'critical'});
    const start=dtLocal(r?.date,r?.heureDebut), end=dtLocal(r?.date,r?.heureFin);checks.push({label:'Heure début/fin cohérentes',ok:!!start&&!!end&&end>=start,level:'critical'});
    const ops=r?.preleveurs||[]; if(ops.length){ops.forEach(op=>{const st=operatorStatus(op);checks.push({label:`Opérateur ${op} : habilitation`,ok:st.state==='valid'||(st.state==='unknown'),level:st.state==='expired'||st.state==='missing'?'critical':'warning',warn:st.state==='unknown',detail:st.label})})}
    else checks.push({label:'Opérateur(s) renseigné(s)',ok:false,level:'critical'});
    checks.push({label:'Signature présente',ok:!!(r?.signature&&r.signature.length>100),level:'critical'});
    const gps=gpsChecks(r);checks.push(...gps);
    const dup=duplicateCheck(r);checks.push({label:'Absence de doublon exact',ok:dup.ok,level:'critical',detail:dup.detail});
    checks.push(...insituChecks(r));
    checks.push(...atypicalChecks(r));
    checks.push(...filtrationCheck(r));
    checks.push(...coldChainCheck(r));
    checks.push(...delayCheck(r));
    const ncs=openNCsFor(r?.id);checks.push({label:'Aucune NC critique ouverte',ok:ncs.every(n=>n.severity!=='Critique'),level:'critical'});
    checks.push({label:'Empreinte d’intégrité présente',ok:!!r?.lifecycle?.integrityHash,level:'critical'});
    const missing=(!r?.sampleTrace?.sampleId && r?.sample && r?.network!=='BIO');checks.push({label:'Identifiant échantillon / traçabilité',ok:!missing,level:'warning'});
    return checks;
  }
  function statusFromChecks(c){return c.some(x=>!x.ok&&(x.level||'critical')==='critical')?'critical':c.some(x=>!x.ok)?'warning':'ok'}
  function renderChecksV19(r){
    const h=$('qualityChecks');if(!h)return;const c=qualityChecksV19(r);h.innerHTML=c.map(x=>{const cls=x.ok?'ok':(x.level==='warning'?'warn':'bad');return `<div class="qualityCheck ${cls}">${x.ok?'✓':'✕'} ${qEscape(x.label)}${x.detail?` <span class="meta">${qEscape(x.detail)}</span>`:''}</div>`}).join('');
  }
  window.OEGQualityV19={qualityChecksFor:qualityChecksV19,statusFromChecks};


  /* Enhanced dashboard */
  function sessionDefs(n){
    if(n==='RCO')return [{l:'S1 - Octobre 2026',d:'2026-10-15'},{l:'S2 - Décembre 2026',d:'2026-12-15'},{l:'S3 - Février 2027',d:'2027-02-15'},{l:'S4 - Avril 2027',d:'2027-04-15'}];
    if(n==='Chimie')return [{l:'S1 - Sept.26',d:'2026-09-15'},{l:'S2 - Déc.26',d:'2026-12-15'},{l:'S3 - Fév.27',d:'2027-02-15'},{l:'S4 - Juin.27',d:'2027-06-15'}];
    if(n==='ESO')return [{l:'Juillet 2026',d:'2026-07-15'},{l:'Novembre 2026',d:'2026-11-15'}];
    if(n==='BIO')return [{l:'Campagne biologique 2026',d:'2026-06-15'}];
    if(n==='EL')return (DATA.EL_SESSIONS||[]).map((x,i)=>({l:x.label,d:`${2026+(i>3?1:0)}-${String([9,10,11,12,1,3,5,7][i]).padStart(2,'0')}-15`}));
    return [];
  }
  function plannedUnits(n){
    const out=[]; const defs=sessionDefs(n);
    defs.forEach(sd=>{
      if(n==='RCO'){
        const old=state.session;state.session=sd.l;const arr=stationsFor('RCO',RCO_COMBINED_ACTIVITY)||[];state.session=old;arr.forEach(s=>out.push({key:`${n}|${sd.l}|${stationKey(s)}`,station:s.nom,session:sd.l}));
      } else if(n==='Chimie'){
        const old=state.session;state.session=sd.l;const arr=stationsFor('Chimie')||[];state.session=old;arr.forEach(s=>out.push({key:`${n}|${sd.l}|${stationKey(s)}`,station:s.nom,session:sd.l}));
      } else if(n==='BIO'){
        const old={activity:state.activity,bioOperation:state.bioOperation,session:state.session};
        state.activity=BIO_EAU_ACTIVITY;state.bioOperation='PC+IA';
        bioStationsForOperation('PC+IA').forEach(s=>out.push({key:`${n}|${BIO_EAU_ACTIVITY}|PC+IA|${stationKey(s)}`,station:s.nom,session:sd.l,activity:BIO_EAU_ACTIVITY,bioOperation:'PC+IA'}));
        Object.assign(state,old);
      } else if(n==='ESO'){
        (DATA.ESO||[]).forEach(s=>out.push({key:`${n}|${sd.l}|${stationKey(s)}`,station:s.nom,session:sd.l}));
      } else if(n==='EL'){
        (DATA.EL_STATIONS||[]).forEach(s=>out.push({key:`${n}|${sd.l}|${stationKey(s)}`,station:s.nom,session:sd.l}));
      }
    });
    return out;
  }
  function unitKey(r){return `${r.network||''}|${r.network==='BIO'?(r.activity||'')+'|'+(r.bioOperation||''):''}|${r.session||''}|${stationKey(r.stationInfo)||r.station||''}`}
  function plannedForRecord(r){
    const n=r.network; const arr=plannedUnits(n);return arr.some(x=>x.station===r.station&&x.session===r.session&&(n!=='BIO'||(x.activity===(r.activity||'')&&(x.bioOperation||'')===(r.bioOperation||''))));
  }
  function dashQualityMetrics(){
    const now=new Date(); const rs=allRecords();
    const missions={}; const stations={}; dashNetList().forEach(n=>{missions[n]={planned:plannedUnits(n).length,realized:0,control:0,validated:0,postponed:0,anomalies:0,scheduled:0};stations[n]=[]});
    rs.forEach(r=>{const n=r.network;if(!missions[n])return;const st=r.lifecycle?.status||'À contrôler';missions[n].realized++;if(st==='À contrôler')missions[n].control++;if(st==='Validée')missions[n].validated++;if(st==='Reportée')missions[n].postponed++;const qs=qualityChecksV19(r);if(qs.some(x=>!x.ok))missions[n].anomalies++;if(plannedForRecord(r))missions[n].scheduled++;});
    const plannedStationKeys={};dashNetList().forEach(n=>{plannedStationKeys[n]=plannedUnits(n)});
    dashNetList().forEach(n=>{const planned=plannedStationKeys[n];missions[n].coverage=planned.length?Math.round(new Set(planned.filter(p=>rs.some(r=>r.network===n&&r.station===p.station&&r.session===p.session)).map(p=>p.key)).size/planned.length*100):0});
    const eq=custom.equipements||[];let eqValid=0,eq30=0,eqExp=0,eqImm=0;eq.forEach(e=>{const st=equipStatus(e);if(e.statut==='Hors service'||e.statut==='Immobilisé'){eqImm++;return}if(st.cls==='metrologyBad')eqExp++;else if(st.cls==='metrologyWarn')eq30++;else eqValid++});
    const ops=custom.preleveurs||[];let hvalid=0,h30=0,h60=0,h90=0,hexp=0;ops.forEach(o=>{const due=o.habilitationEcheance||o.habEch;if(!due)return;const d=new Date(due+'T23:59:59'),days=(d-now)/864e5;if(days<0)hexp++;else{hvalid++;if(days<31)h30++;else if(days<61)h60++;else if(days<91)h90++}});
    const ncs=custom.nonConformites||[],open=ncs.filter(x=>x.status!=='Clôturée'),crit=open.filter(x=>x.severity==='Critique'),late=open.filter(x=>x.dueDate&&x.dueDate<now.toISOString().slice(0,10));
    let totalChecks=0,passChecks=0,atypical=0,outRange=0,modifiedAfter=0;rs.forEach(r=>{const c=qualityChecksV19(r);c.forEach(x=>{totalChecks++;if(x.ok)passChecks++});if(c.some(x=>/plage/.test(x.label)&&!x.ok))atypical++;if(c.some(x=>/plage/.test(x.label)&&!x.ok))outRange++;if(r.lifecycle?.validatedAt&&r.lifecycle?.updatedAt&&r.lifecycle.updatedAt>r.lifecycle.validatedAt)modifiedAfter++});
    return {missions,stations,metrology:{valid:eqValid,soon30:eq30,expired:eqExp,immobilized:eqImm},hab:{valid:hvalid,d30:h30,d60:h60,d90:h90,expired:hexp},quality:{open:open.length,critical:crit.length,late:late.length,pending:rs.filter(r=>(r.lifecycle?.status||'À contrôler')==='À contrôler').length},data:{completeness:totalChecks?Math.round(passChecks/totalChecks*100):100,atypical,outRange,modifiedAfter}};
  }
  function renderEnhancedDashboard(){
    const host=$('dashQualityBoard');if(!host)return;const m=dashQualityMetrics();
    const missionRows=dashNetList().map(n=>{const x=m.missions[n];return `<tr><td><b>${qEscape(netLabel(n))}</b></td><td>${x.planned}</td><td>${x.realized}</td><td>${x.control}</td><td>${x.validated}</td><td>${x.postponed}</td><td>${x.anomalies}</td></tr>`}).join('');
    const stationRows=dashNetList().map(n=>{const x=m.missions[n];const recs=allRecords().filter(r=>r.network===n);const latest=recs.slice().sort((a,b)=>String(b.date||'').localeCompare(String(a.date||'')))[0];const allPlan=plannedUnits(n);const realizedKeys=new Set(recs.map(r=>`${r.session}|${r.station}`));const notDone=allPlan.filter(p=>!realizedKeys.has(`${p.session}|${p.station}`)).length;const off=recs.filter(r=>!plannedForRecord(r)).length;const next=allPlan.filter(p=>{if(realizedKeys.has(`${p.session}|${p.station}`))return false;const d=sessionDefs(n).find(z=>z.l===p.session)?.d;return d&&new Date(d)>=new Date()}).sort((a,b)=>String(a.session).localeCompare(String(b.session)))[0]?.session||'—';return `<tr><td><b>${qEscape(netLabel(n))}</b></td><td>${x.coverage}%</td><td>${qEscape(latest?.date||'—')}</td><td>${qEscape(next)}</td><td>${notDone}</td><td>${off}</td></tr>`}).join('');
    host.innerHTML=`<div class="card"><h2>Missions</h2><div class="tableWrap"><table class="suiviTable"><thead><tr><th>Réseau</th><th>Prévues</th><th>Réalisées</th><th>À contrôler</th><th>Validées</th><th>Reportées</th><th>Anomalies</th></tr></thead><tbody>${missionRows}</tbody></table></div></div>
    <div class="card"><h2>Stations</h2><div class="tableWrap"><table class="suiviTable"><thead><tr><th>Réseau</th><th>Couverture campagnes</th><th>Dernière mesure</th><th>Prochaine échéance</th><th>Stations non réalisées</th><th>Hors programmation</th></tr></thead><tbody>${stationRows}</tbody></table></div></div>
    <div class="grid2"><div class="card"><h2>Métrologie</h2><div class="qualityChecks"><div class="qualityCheck ok">✓ Équipements valides <b>${m.metrology.valid}</b></div><div class="qualityCheck warn">⚠ Échéance &lt;30 jours <b>${m.metrology.soon30}</b></div><div class="qualityCheck bad">✕ Expirés <b>${m.metrology.expired}</b></div><div class="qualityCheck bad">✕ Immobilisés <b>${m.metrology.immobilized}</b></div></div></div>
    <div class="card"><h2>Habilitations</h2><div class="qualityChecks"><div class="qualityCheck ok">✓ Valides <b>${m.hab.valid}</b></div><div class="qualityCheck warn">⚠ &lt;30 j <b>${m.hab.d30}</b></div><div class="qualityCheck warn">⚠ 30–60 j <b>${m.hab.d60}</b></div><div class="qualityCheck warn">⚠ 60–90 j <b>${m.hab.d90}</b></div><div class="qualityCheck bad">✕ Expirées <b>${m.hab.expired}</b></div></div></div></div>
    <div class="grid2"><div class="card"><h2>Qualité</h2><div class="qualityChecks"><div class="qualityCheck warn">⚠ NC ouvertes <b>${m.quality.open}</b></div><div class="qualityCheck bad">✕ NC critiques <b>${m.quality.critical}</b></div><div class="qualityCheck warn">⚠ Actions en retard <b>${m.quality.late}</b></div><div class="qualityCheck warn">⚠ Fiches en attente de validation <b>${m.quality.pending}</b></div></div></div>
    <div class="card"><h2>Données</h2><div class="qualityChecks"><div class="qualityCheck ok">✓ Taux de complétude <b>${m.data.completeness}%</b></div><div class="qualityCheck warn">⚠ Valeurs atypiques <b>${m.data.atypical}</b></div><div class="qualityCheck warn">⚠ Mesures hors plage <b>${m.data.outRange}</b></div><div class="qualityCheck warn">⚠ Fiches modifiées après validation <b>${m.data.modifiedAfter}</b></div></div></div></div>`;
  }
  if(!$('dashQualityBoard')){
    const dash=$('dashboard'); const first=dash?.firstElementChild; if(first)first.insertAdjacentHTML('afterend','<div id="dashQualityBoard"></div>');
  }

  /* Replace quality validation check function and display. */
  qualityChecksFor=qualityChecksV19;
  if(typeof renderQualityChecks==='function')renderQualityChecks=renderChecksV19;
  $('qualityRecord')?.addEventListener('change',()=>renderChecksV19(records.find(x=>x.id===val('qualityRecord'))));

  /* Add configurable OEG control thresholds to the quality page. */
  const qcard=$('quality')?.querySelector('.card:nth-of-type(4)');
  if(qcard && !$('v19QualityConfig')){
    qcard.insertAdjacentHTML('beforeend',`<hr><div id="v19QualityConfig"><h3>Paramètres de contrôle interne OEG</h3><div class="grid2"><div class="field"><label>Écart GPS maximum (m)</label><input id="gpsMaxDeviationM" type="number" min="0" step="1"></div><div class="field"><label>Délai maximum prélèvement → remise (h)</label><input id="maxDelayHours" type="number" min="0" step="1"></div></div><p class="note">Ces seuils sont des règles internes OEG configurables. Ils ne doivent pas être présentés comme des limites COFRAC ou réglementaires sans justification documentaire.</p></div>`);
    setField('gpsMaxDeviationM',custom.qualityConfig.gpsMaxDeviationM);setField('maxDelayHours',custom.qualityConfig.maxDelayHours);
    $('gpsMaxDeviationM').oninput=()=>{custom.qualityConfig.gpsMaxDeviationM=Number(val('gpsMaxDeviationM'));saveLS(LSC,custom);renderDashboard()};
    $('maxDelayHours').oninput=()=>{custom.qualityConfig.maxDelayHours=Number(val('maxDelayHours'));saveLS(LSC,custom);renderDashboard()};
  }


  window.renderEnhancedDashboard=renderEnhancedDashboard;
  renderDashboard();
})();