/* ========== V18 : TABLEAU DE BORD INSPIRE DU MODELE OEG ========== */
function dashNetList(){ return ['RCO','BIO','ESO','Chimie','EL']; }
// Stations ayant au moins une fiche (comme le suivi) : la liste dépendait auparavant de l'état du
// formulaire et restait vide pour BIO et Chimie.
function dashStationList(net){
  const map=new Map();
  (Array.isArray(records)?records:[]).filter(r=>r.network===net&&r.station).forEach(r=>{if(!map.has(r.station))map.set(r.station,{...(r.stationInfo||{}),nom:r.station})});
  return [...map.values()].sort((a,b)=>String(a.nom||'').localeCompare(String(b.nom||''),'fr'));
}
function dashRecordStationKey(r){ return `${r.network||''}::${r.station||''}`; }
function renderDashNetworkStats(){
  const host=$('dashNetworkStats'); if(!host)return;
  const all=Array.isArray(records)?records:[];
  host.innerHTML='';
  dashNetList().forEach(n=>{
    const rs=all.filter(r=>r.network===n), validated=rs.filter(r=>r.lifecycle?.status==='Validée').length;
    // non-conformités ouvertes du réseau (même définition que « Planification / réalisation »)
    const nc=(custom.nonConformites||[]).filter(x=>x.status!=='Clôturée'&&rs.some(r=>r.id===x.recordId)).length;
    const pct=rs.length?Math.round(validated/rs.length*100):0;
    host.insertAdjacentHTML('beforeend',`<div class="dashKpi"><div class="k">${escapeHTML(netLabel(n))}</div><div class="v">${rs.length}</div><div class="meta">${validated} validées · ${nc} anomalie(s)</div><div class="dashProgress"><span style="width:${pct}%"></span></div></div>`);
  });
}
function renderDashStations(){
  const n=$('dashNetwork')?.value||'RCO', sel=$('dashStation'); if(!sel)return;
  const arr=dashStationList(n), prev=sel.value;
  sel.innerHTML='<option value="">— sélectionner —</option>'+arr.map(x=>`<option value="${escapeHTML(x.nom)}">${escapeHTML(x.nom)} — ${escapeHTML(x.code||'')}</option>`).join('');
  if(arr.some(x=>x.nom===prev)) sel.value=prev;
  renderDashStation();
}
function renderDashStation(){
  const n=$('dashNetwork')?.value||'RCO', st=$('dashStation')?.value||'', info=$('dashStationInfo'), host=$('dashParams'); if(!info||!host)return;
  const station=dashStationList(n).find(x=>x.nom===st);
  const rs=(records||[]).filter(r=>r.network===n&&r.station===st).slice().sort((a,b)=>String(a.date||'').localeCompare(String(b.date||'')));
  if(!station||!st){ info.innerHTML='<div class="suiviEmpty">Sélectionnez une station pour afficher son aperçu direct.</div>'; host.innerHTML=''; return; }
  info.innerHTML=`<div class="grid3"><div class="field"><label>Code SANDRE</label><input class="readonly" readonly value="${escapeHTML(station.code||'—')}"></div><div class="field"><label>Bassin / masse d'eau</label><input class="readonly" readonly value="${escapeHTML(station.bassin||station.bv||'—')}"></div><div class="field"><label>Fiches enregistrées</label><input class="readonly" readonly value="${rs.length}"></div></div>`;
  // Mêmes paramètres et valeurs que l'onglet Suivi (EL par profondeur ; mesure vide = absente).
  const params=(typeof suiviParamsFor==='function'?suiviParamsFor(n,st):[]);
  // Redox remains excluded from the user-facing station overview, even if old data contain it.
  const visible=params.filter(k=>!/^redox/.test(k));
  if(!visible.length){host.innerHTML='<div class="suiviEmpty">Aucune mesure in situ enregistrée pour cette station.</div>';return;}
  const labels={ph:'pH',temp:'Température eau (°C)',cond:'Conductivité',sal:'Salinité',o2mg:'O₂ dissous (mg/L)',o2pc:'Saturation O₂ (%)',turb:'Turbidité (NTU)',air:'Température air (°C)'};
  host.innerHTML=visible.map(k=>{
    const vals=rs.map(r=>numOrNull(suiviValueFor(r,k))).filter(v=>v!==null);
    const avg=vals.length?(vals.reduce((a,b)=>a+b,0)/vals.length):null, min=vals.length?Math.min(...vals):null,max=vals.length?Math.max(...vals):null;
    return `<div class="suiviParamCard"><h3>${escapeHTML((labels[k]||SUIVI_PARAMS[k]?.label||k)+(SUIVI_PARAMS[k]?.unit&&!labels[k]?' ('+SUIVI_PARAMS[k].unit+')':''))}</h3><div class="suiviMiniGrid"><div><span>Dernière</span><b>${vals.length?vals[vals.length-1].toLocaleString('fr-FR',{maximumFractionDigits:2}):'—'}</b></div><div><span>Moyenne</span><b>${avg!=null?avg.toLocaleString('fr-FR',{maximumFractionDigits:2}):'—'}</b></div><div><span>Min</span><b>${min!=null?min.toLocaleString('fr-FR',{maximumFractionDigits:2}):'—'}</b></div><div><span>Max</span><b>${max!=null?max.toLocaleString('fr-FR',{maximumFractionDigits:2}):'—'}</b></div></div>${(()=>{const b=typeof stationBounds==='function'?stationBounds(n,st,k):null,f=v=>v.toLocaleString('fr-FR',{maximumFractionDigits:2});
      // Bornes tirées de l'historique de la station (utilisées pendant la saisie)
      return b?`<div class="meta stationBounds">Plage habituelle de la station : <b>${f(b.lo2)} – ${f(b.hi2)}</b> · alerte au-delà de ${f(b.lo3)} – ${f(b.hi3)} (${b.n} mesures)</div>`:`<div class="meta stationBounds">Historique en construction : ${vals.length}/${STATION_BOUNDS_MIN} mesures avant le calcul de la plage habituelle de la station.</div>`})()}</div>`;
  }).join('');
}
function renderDashPlan(){
  const body=$('dashPlan'); if(!body)return; const all=records||[]; body.innerHTML='';
  dashNetList().forEach(n=>{
    const rs=all.filter(r=>r.network===n), val=rs.filter(r=>r.lifecycle?.status==='Validée').length, ctrl=rs.filter(r=>r.lifecycle?.status==='À contrôler').length, anomalies=(custom.nonConformites||[]).filter(x=>{const rec=all.find(r=>r.id===x.recordId);return rec?.network===n&&x.status!=='Clôturée'}).length;
    const pct=rs.length?Math.round(val/rs.length*100):0;
    body.insertAdjacentHTML('beforeend',`<tr><td><b>${escapeHTML(netLabel(n))}</b></td><td>${rs.length}</td><td>${ctrl}</td><td>${val}</td><td>${anomalies}</td><td>${pct}%</td></tr>`);
  });
}
function renderDashActions(){
  const h=$('dashActions'); if(!h)return; const all=records||[]; const actions=[];
  const openNC=(custom.nonConformites||[]).filter(x=>x.status!=='Clôturée'); if(openNC.length) actions.push(`<div class="dashAction"><b>${openNC.length}</b> non-conformité(s) ouverte(s) <span class="badge">à traiter</span></div>`);
  const unvalidated=all.filter(r=>r.lifecycle?.status==='À contrôler'); if(unvalidated.length) actions.push(`<div class="dashAction"><b>${unvalidated.length}</b> fiche(s) à contrôler / valider</div>`);
  const today=new Date().toISOString().slice(0,10);
  const expired=(custom.equipements||[]).filter(e=>{const due=e.echeance||e.calDue;return due&&due<today}); if(expired.length) actions.push(`<div class="dashAction"><b>${expired.length}</b> équipement(s) dont l'échéance métrologique est dépassée</div>`);
  const noHab=(custom.preleveurs||[]).filter(o=>{const due=o.habilitationEcheance||o.habEch;return due&&due<today}); if(noHab.length) actions.push(`<div class="dashAction"><b>${noHab.length}</b> habilitation(s) à renouveler</div>`);
  h.innerHTML=actions.length?actions.join(''):'<div class="dashAction">Aucune action prioritaire détectée.</div>';
}
function renderDashRecent(){
  const h=$('dashRecent'); if(!h)return; const arr=(records||[]).slice().sort((a,b)=>String(b.savedAt||'').localeCompare(String(a.savedAt||''))).slice(0,6);
  h.innerHTML=arr.length?arr.map(r=>`<div class="listcard"><div class="listtop"><div><div class="listname">${escapeHTML(r.station||'—')}</div><div class="meta">${escapeHTML(netLabel(r.network||''))} · ${escapeHTML(r.date||'—')}</div></div><span class="badge">${escapeHTML(r.lifecycle?.status||'À contrôler')}</span></div></div>`).join(''):'<div class="suiviEmpty">Aucune fiche enregistrée.</div>';
}
/* ---- Avancement d'une campagne : stations programmées d'une session, faites / non réalisées / à faire ---- */
function campaignStations(net,session){
  // Programme de la session (même règle que la liste des stations du formulaire, état rétabli ensuite)
  const keep={session:state.session,bioOperation:state.bioOperation};
  const out=new Map();
  try{
    state.session=session;
    if(net==='BIO')BIO_OPERATIONS.forEach(op=>{state.bioOperation=op;stationsFor('BIO',BIO_EAU_ACTIVITY).forEach(s=>{if(!out.has(s.nom))out.set(s.nom,{...s,op})})});
    else (stationsFor(net,(activities(net,session)||[])[0])||[]).forEach(s=>{if(!out.has(s.nom))out.set(s.nom,s)});
  }finally{state.session=keep.session;state.bioOperation=keep.bioOperation}
  return [...out.values()];
}
function campaignProgress(net,session){
  const rs=(records||[]).filter(r=>r.network===net&&r.session===session&&!r.conflict);
  const prog=campaignStations(net,session),names=new Set(prog.map(s=>s.nom));
  // Station visitée hors programme (ajoutée à la main, autre session…) : listée aussi
  rs.forEach(r=>{if(r.station&&!names.has(r.station)){names.add(r.station);prog.push({...(r.stationInfo||{}),nom:r.station,horsProgramme:true})}});
  const rows=prog.map(s=>{
    const mine=rs.filter(r=>r.station===s.nom).sort((a,b)=>String(b.date||'').localeCompare(String(a.date||'')));
    const done=mine.find(r=>r.prelevementRealise!=='Non'),nr=!done&&mine.find(r=>r.prelevementRealise==='Non'),last=done||nr||null;
    const etat=done?'faite':nr?'nonRealisee':'aFaire',st=last?.lifecycle?.status||'';
    return {s,etat,rec:last,aValider:!!last&&st!=='Validée'};
  }).sort((a,b)=>({aFaire:0,nonRealisee:1,faite:2}[a.etat]-{aFaire:0,nonRealisee:1,faite:2}[b.etat])||String(a.s.nom).localeCompare(String(b.s.nom),'fr'));
  const c=k=>rows.filter(x=>x.etat===k).length;
  return {rows,total:rows.length,faites:c('faite'),nonRealisees:c('nonRealisee'),aFaire:c('aFaire'),aValider:rows.filter(x=>x.aValider).length};
}
window.campaignProgress=campaignProgress;
function renderCampaign(){
  const nSel=$('campNetwork'),sSel=$('campSession');if(!nSel||!sSel)return;
  if(!nSel.options.length)nSel.innerHTML=dashNetList().map(x=>`<option value="${x}">${escapeHTML(netLabel(x))}</option>`).join('');
  const net=nSel.value,ses=sessions(net)||[];
  if(sSel.dataset.net!==net){
    // Session proposée : la plus récente ayant des fiches, sinon la première
    const used=ses.filter(x=>(records||[]).some(r=>r.network===net&&r.session===x));
    sSel.innerHTML=ses.map(x=>`<option value="${escapeHTML(x)}">${escapeHTML(x)}</option>`).join('');sSel.dataset.net=net;
    if(used.length)sSel.value=used[used.length-1];
  }
  const p=campaignProgress(net,sSel.value),pct=p.total?Math.round((p.faites+p.nonRealisees)/p.total*100):0;
  const kpi=(k,v,m)=>`<div class="dashKpi"><div class="k">${k}</div><div class="v">${v}</div><div class="meta">${m}</div></div>`;
  $('campKpis').innerHTML=kpi('Stations programmées',p.total,pct+' % visitées')+kpi('Faites',p.faites,'prélèvement réalisé')+kpi('Non réalisées',p.nonRealisees,'visite sans prélèvement')+kpi('Restant à faire',p.aFaire,'pas encore de fiche')+kpi('Fiches à valider',p.aValider,'à contrôler / valider');
  const lab={faite:'<span class="campOk">✓ Faite</span>',nonRealisee:'<span class="campNr">⛔ Non réalisée</span>',aFaire:'<span class="campTodo">⏳ À faire</span>'};
  $('campTable').querySelector('tbody').innerHTML=p.rows.map(x=>`<tr class="camp_${x.etat}"><td>${escapeHTML(x.s.nom)}${x.s.op?` <span class="meta">${escapeHTML(x.s.op)}</span>`:''}${x.s.horsProgramme?' <span class="meta">(hors programme)</span>':''}</td><td>${escapeHTML(x.s.code||x.s.code_bss||'')}</td><td>${lab[x.etat]}</td><td>${escapeHTML(x.rec?.date?x.rec.date.split('-').reverse().join('/'):'')}</td><td>${x.rec?escapeHTML(x.rec.lifecycle?.status||'À contrôler')+(x.aValider?' — <b>à valider</b>':''):''}</td></tr>`).join('')||'<tr><td colspan="5">Aucune station programmée.</td></tr>';
}
$('campNetwork')?.addEventListener('change',renderCampaign);
$('campSession')?.addEventListener('change',renderCampaign);
function renderDashboard(){
  try{renderCampaign()}catch(e){console.error(e)}
  renderDashNetworkStats();
  const n=$('dashNetwork'); if(n && !n.options.length){ n.innerHTML=dashNetList().map(x=>`<option value="${x}">${escapeHTML(netLabel(x))}</option>`).join(''); }
  renderDashStations(); renderDashPlan(); renderDashActions(); renderDashRecent();
  /* Contrôles qualité automatisés (fusionné depuis l'ancien correctif V19) */
  if(typeof window.renderEnhancedDashboard==='function')window.renderEnhancedDashboard();
}
$('dashNetwork')?.addEventListener('change',renderDashStations);
$('dashStation')?.addEventListener('change',renderDashStation);