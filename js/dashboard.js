/* ========== V18 : TABLEAU DE BORD INSPIRE DU MODELE OEG ========== */
function dashNetList(){ return ['RCO','BIO','ESO','Chimie','EL']; }
function dashStationList(net){
  try { return stationsFor(net, state.session).slice().sort((a,b)=>String(a.nom||'').localeCompare(String(b.nom||''))); }
  catch(e){ return []; }
}
function dashRecordStationKey(r){ return `${r.network||''}::${r.station||''}`; }
function renderDashNetworkStats(){
  const host=$('dashNetworkStats'); if(!host)return;
  const all=Array.isArray(records)?records:[];
  host.innerHTML='';
  dashNetList().forEach(n=>{
    const rs=all.filter(r=>r.network===n), validated=rs.filter(r=>r.lifecycle?.status==='Validée').length;
    const nc=rs.filter(r=>(r.qc?.status==='anomalie')||r.lifecycle?.hasCriticalNC||r.nonConformiteCount>0).length;
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
  const rs=(records||[]).filter(r=>r.network===n&&r.station===st);
  if(!station||!st){ info.innerHTML='<div class="suiviEmpty">Sélectionnez une station pour afficher son aperçu direct.</div>'; host.innerHTML=''; return; }
  info.innerHTML=`<div class="grid3"><div class="field"><label>Code SANDRE</label><input class="readonly" readonly value="${escapeHTML(station.code||'—')}"></div><div class="field"><label>Bassin / masse d'eau</label><input class="readonly" readonly value="${escapeHTML(station.bassin||station.bv||'—')}"></div><div class="field"><label>Fiches enregistrées</label><input class="readonly" readonly value="${rs.length}"></div></div>`;
  const params=['ph','temp','cond','sal','o2mg','o2pc','turb','redox','air'].filter(k=>rs.some(r=>r.insitu?.[k]?.value!==''&&r.insitu?.[k]?.value!=null));
  // Redox remains excluded from the user-facing station overview, even if old data contain it.
  const visible=params.filter(k=>k!=='redox');
  if(!visible.length){host.innerHTML='<div class="suiviEmpty">Aucune mesure in situ enregistrée pour cette station.</div>';return;}
  const labels={ph:'pH',temp:'Température eau (°C)',cond:'Conductivité',sal:'Salinité',o2mg:'O₂ dissous (mg/L)',o2pc:'Saturation O₂ (%)',turb:'Turbidité (NTU)',air:'Température air (°C)'};
  host.innerHTML=visible.map(k=>{
    const vals=rs.map(r=>Number(r.insitu?.[k]?.value)).filter(Number.isFinite);
    const avg=vals.length?(vals.reduce((a,b)=>a+b,0)/vals.length):null, min=vals.length?Math.min(...vals):null,max=vals.length?Math.max(...vals):null;
    return `<div class="suiviParamCard"><h3>${labels[k]}</h3><div class="suiviMiniGrid"><div><span>Dernière</span><b>${vals.length?vals[vals.length-1].toLocaleString('fr-FR',{maximumFractionDigits:2}):'—'}</b></div><div><span>Moyenne</span><b>${avg!=null?avg.toLocaleString('fr-FR',{maximumFractionDigits:2}):'—'}</b></div><div><span>Min</span><b>${min!=null?min.toLocaleString('fr-FR',{maximumFractionDigits:2}):'—'}</b></div><div><span>Max</span><b>${max!=null?max.toLocaleString('fr-FR',{maximumFractionDigits:2}):'—'}</b></div></div></div>`;
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
  const expired=(custom.equipements||[]).filter(e=>e.calDue && e.calDue < new Date().toISOString().slice(0,10)); if(expired.length) actions.push(`<div class="dashAction"><b>${expired.length}</b> équipement(s) dont l'échéance métrologique est dépassée</div>`);
  const noHab=(custom.preleveurs||[]).filter(o=>o.habEch && o.habEch < new Date().toISOString().slice(0,10)); if(noHab.length) actions.push(`<div class="dashAction"><b>${noHab.length}</b> habilitation(s) à renouveler</div>`);
  h.innerHTML=actions.length?actions.join(''):'<div class="dashAction">Aucune action prioritaire détectée.</div>';
}
function renderDashRecent(){
  const h=$('dashRecent'); if(!h)return; const arr=(records||[]).slice().sort((a,b)=>String(b.savedAt||'').localeCompare(String(a.savedAt||''))).slice(0,6);
  h.innerHTML=arr.length?arr.map(r=>`<div class="listcard"><div class="listtop"><div><div class="listname">${escapeHTML(r.station||'—')}</div><div class="meta">${escapeHTML(netLabel(r.network||''))} · ${escapeHTML(r.date||'—')}</div></div><span class="badge">${escapeHTML(r.lifecycle?.status||'À contrôler')}</span></div></div>`).join(''):'<div class="suiviEmpty">Aucune fiche enregistrée.</div>';
}
function renderDashboard(){
  renderDashNetworkStats();
  const n=$('dashNetwork'); if(n && !n.options.length){ n.innerHTML=dashNetList().map(x=>`<option value="${x}">${escapeHTML(netLabel(x))}</option>`).join(''); }
  renderDashStations(); renderDashPlan(); renderDashActions(); renderDashRecent();
  /* Contrôles qualité automatisés (fusionné depuis l'ancien correctif V19) */
  if(typeof window.renderEnhancedDashboard==='function')window.renderEnhancedDashboard();
}
$('dashNetwork')?.addEventListener('change',renderDashStations);
$('dashStation')?.addEventListener('change',renderDashStation);