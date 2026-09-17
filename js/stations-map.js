(function(){
  const q=id=>document.getElementById(id), E=escapeHTML; /* echappement HTML unifie (voir app-core.js) */
  const fixedOrgs=['HYDRECO','NBC','DGTM'];
  const fixedPre={HYDRECO:['DB','NB','EV','ER','YK','FC','HL','NG','GQ','FCh'],NBC:['ML','FD','FR','JN','RC'],DGTM:['OPC','MM']};
  const legacyPre=(typeof OEG_PRELEVEURS!=='undefined'?OEG_PRELEVEURS:[]);
  function orgList(){return ['Office de l\'Eau de Guyane',...fixedOrgs,...(custom.preleveurs||[]).map(operatorOrg).filter(o=>o&&!fixedOrgs.includes(o)&&o!=="Office de l'Eau de Guyane")].filter((x,i,a)=>a.indexOf(x)===i)}
  function preList(org){if(fixedPre[org])return fixedPre[org].slice();if(org==="Office de l'Eau de Guyane")return legacyPre.slice();return [...new Set((custom.preleveurs||[]).filter(o=>operatorOrg(o)===org).map(operatorDisplay))]}
  function fillOrgSelect(id,selected){const h=q(id);if(!h)return;const cur=selected??h.value;h.innerHTML='<option value="">— sélectionner un organisme —</option>'+orgList().map(o=>'<option value="'+E(o)+'">'+E(o)+'</option>').join('');if(orgList().includes(cur))h.value=cur}
  function refreshPreUI(){
    const org=q('org')?.value||''; const list=preList(org); const h=q('preleveurs'); if(h){const sel=new Set(state?.preleveurs||[]);h.innerHTML=list.map((p,i)=>'<label class="check"><input type="checkbox" id="pre_fixed_'+i+'" value="'+E(p)+'" '+(sel.has(p)?'checked':'')+'><span>'+E(p)+'</span></label>').join('');h.querySelectorAll('input').forEach(x=>x.onchange=()=>{state.preleveurs=[...h.querySelectorAll('input:checked')].map(a=>a.value);refreshSign()})}
    refreshSign();
  }
  function refreshSign(){const h=q('signName');if(!h)return;const list=preList(q('org')?.value||'');const cur=h.value;h.innerHTML='<option value="">— sélectionner un opérateur —</option>'+list.map(x=>'<option value="'+E(x)+'">'+E(x)+'</option>').join('');if(list.includes(cur))h.value=cur;}
  // Keep the mission organism strictly named "Organisme préleveur" and provide the requested fixed organizations.
  window.orgList=orgList;window.preList=preList;window.fillOrgSelect=fillOrgSelect;window.refreshPreUI=refreshPreUI;
  
  q('org')?.addEventListener('change',()=>{state.preleveurs=[];refreshPreUI()});
  q('newOpOrg')?.addEventListener('change',()=>{if(q('org')&&q('org').value===q('newOpOrg').value)refreshPreUI()});
  fillOrgSelect('newOpOrg');
  // Signature operator: initials are only those belonging to the selected sampling organization.
  refreshSign();


  // Station navigation: network -> network/market -> basin -> station.
  // Une même station physique peut être suivie par plusieurs réseaux (ex. beaucoup de
  // stations Chimie partagent leur code avec une station BIO_CE) : on tague donc chaque
  // station directement depuis le tableau DATA d'où elle provient, réseau par réseau,
  // plutôt que de deviner un réseau unique par recherche de code (ce qui faisait
  // disparaître Chimie, toujours masqué par BIO trouvé en premier).
  function stationNetwork(x){
    if(x?.network)return x.network;
    const key=x?.code||x?.code_bss||x?.nom;
    const sources=[['RCO',DATA?.RCO13||[],DATA?.RCO_BIO12||[]],['BIO',DATA?.BIO_CE||[],DATA?.BIO_FISH||[],DATA?.BIO_ADNE||[],DATA?.BIO_PHYTO||[]],['ESO',DATA?.ESO||[]],['Chimie',DATA?.CH_STATIONS||[]],['EL',DATA?.EL_STATIONS||[]]];
    for(const [n,...arrs] of sources)if(arrs.some(a=>a.some(s=>(s.code||s.code_bss||s.nom)===key)))return n;
    return '';
  }
  function navStations(){
    const out=[];
    const sources=[['RCO',DATA?.RCO13||[],DATA?.RCO_BIO12||[]],['BIO',DATA?.BIO_CE||[],DATA?.BIO_FISH||[],DATA?.BIO_ADNE||[],DATA?.BIO_PHYTO||[]],['ESO',DATA?.ESO||[]],['Chimie',DATA?.CH_STATIONS||[]],['EL',DATA?.EL_STATIONS||[]]];
    sources.forEach(([n,...arrs])=>{
      const seen=new Set();
      arrs.forEach(arr=>arr.forEach(s=>{
        const key=s.code||s.code_bss||s.nom;
        if(seen.has(key))return; // doublon interne au même réseau (ex. station listée dans RCO13 ET RCO_BIO12)
        seen.add(key);
        out.push({...s,network:n});
      }));
    });
    (custom.stations||[]).filter(s=>s.nom).forEach(s=>out.push({...s,network:s.network||stationNetwork(s)||''}));
    return out;
  }
  function mapStationsFixed(){
    // Le sélecteur "Réseau / marché" fonctionne comme les puces réseau de l'onglet
    // "Éditer une nouvelle fiche terrain" : le choisir donne directement les stations associées.
    const all=navStations(),mf=q('stationMarketFilter')?.value||'',bf=q('stationBassinFilter')?.value||'',sf=(q('stationSearchFilter')?.value||'').trim().toLowerCase();
    const rows=all.filter(x=>{const m=meta(x);return(!mf||x.network===mf)&&(!bf||m.b===bf)&&(!sf||String(x.nom||'').toLowerCase().includes(sf))});
    const mh=q('stationMarketFilter');
    if(mh){
      const cur=mh.value;
      mh.innerHTML='<option value="">Tous les réseaux / marchés</option>'+NETWORKS.map(([n])=>'<option value="'+E(n)+'">'+E(netLabel(n))+'</option>').join('');
      if(NETWORKS.some(([n])=>n===cur))mh.value=cur;
    }
    const bh=q('stationBassinFilter');
    if(bh){
      const cur=bh.value;
      const vals=[...new Set(rows.map(x=>meta(x).b).filter(Boolean))].sort((a,b)=>String(a).localeCompare(String(b),'fr'));
      bh.innerHTML='<option value="">Tous les bassins versants</option>'+vals.map(v=>'<option value="'+E(v)+'">'+E(v)+'</option>').join('');
      if(vals.includes(cur))bh.value=cur;
    }
    if(q('stationResultCount'))q('stationResultCount').textContent=rows.length+' station(s) correspondant aux filtres.';
    if(!window.L||!q('guyaneLeafletMap'))return;
    if(!window.guyaneMap){window.guyaneMap=L.map('guyaneLeafletMap',{zoomControl:true,preferCanvas:true}).setView([4,-53],7);L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap contributors'}).addTo(window.guyaneMap);window.guyaneLayer=L.layerGroup().addTo(window.guyaneMap)}
    window.guyaneLayer.clearLayers();if(window.guyaneRouteLayer){try{window.guyaneMap.removeLayer(window.guyaneRouteLayer)}catch(e){}}
    const bounds=[];rows.forEach(x=>{const ll=stationLatLon(x);if(!ll)return;const m=meta(x),modes=stationTransportDetailed(x),marker=L.circleMarker(ll,{radius:7,weight:2,fillOpacity:.9});marker.bindPopup('<b>'+E(x.nom)+'</b><br>Réseau / marché : '+E(netLabel(x.network)||'—')+(m.m?' ('+E(m.m)+')':'')+'<br>Bassin versant : '+E(m.b||'—')+'<br><b>Transport :</b> '+modes.map(m=>transportIcon(m)+' '+E(m)).join(', ')+'<br><button type="button" class="btn primary small" data-route="'+E(stationKey(x))+'">📍 Aller sur la station</button> <button type="button" class="btn ghost small" data-open="'+E(stationKey(x))+'">Fiche</button>');marker.on('popupopen',()=>{const rb=document.querySelector('[data-route="'+CSS.escape(stationKey(x))+'"]');if(rb)rb.onclick=()=>routeToStation(x);const ob=document.querySelector('[data-open="'+CSS.escape(stationKey(x))+'"]');if(ob)ob.onclick=()=>openStationEnhanced(x)});marker.addTo(window.guyaneLayer);bounds.push(ll)});
    if(bounds.length)window.guyaneMap.fitBounds(bounds,{padding:[25,25],maxZoom:10});else window.guyaneMap.setView([4,-53],7);setTimeout(()=>window.guyaneMap.invalidateSize(),100);
    const select=q('gotoStation');if(select){const cur=select.value;select.innerHTML='<option value="">— sélectionner —</option>'+rows.map(x=>'<option value="'+E(stationKey(x))+'">'+E(x.nom)+'</option>').join('');if(rows.some(x=>stationKey(x)===cur))select.value=cur;select.onchange=()=>{const x=rows.find(s=>stationKey(s)===select.value);if(!x)return;const ll=stationLatLon(x);if(ll)window.guyaneMap.setView(ll,13);q('stationInfo').innerHTML='<b>'+E(x.nom)+'</b><br>Réseau / marché : '+E(netLabel(x.network)||'—')+(meta(x).m?' ('+E(meta(x).m)+')':'')+' · Bassin versant : '+E(meta(x).b||'—')+'<br><b>Moyens de transport :</b> '+stationTransportDetailed(x).map(m=>transportIcon(m)+' '+E(m)).join(', ')+'<div class="actions" style="margin-top:8px"><button class="btn primary small" id="routeSelected">🚗 Calculer l’itinéraire</button><button class="btn ghost small" id="openSelected">Ouvrir la fiche</button></div>';q('routeSelected').onclick=()=>routeToStation(x);q('openSelected').onclick=()=>openStationEnhanced(x)}}
  }
  window.mapStations=mapStationsFixed;
  ['stationMarketFilter','stationBassinFilter'].forEach(id=>q(id)?.addEventListener('change',mapStationsFixed));
  (function(){
    let t=null;
    q('stationSearchFilter')?.addEventListener('input',()=>{if(t)clearTimeout(t);t=setTimeout(mapStationsFixed,200)});
  })();

  q('crtRecord')?.addEventListener('change',()=>setTimeout(()=>window.setupCRT&&window.setupCRT(),0));
  // Ensure the existing CRT preview/generation UI is functional and explicit.
  q('crtPreview')?.addEventListener('click',()=>setTimeout(()=>{if(!q('crtPreviewBox')?.querySelector('.crtReport'))toast('Impossible de générer l’aperçu du CRT pour cette fiche.');},100));
  // First render after all overrides are installed.
  setTimeout(()=>{try{window.renderOrgOptions?.(q('org')?.value);refreshPreUI();mapStationsFixed();window.setupCRT&&window.setupCRT()}catch(e){console.error(e)}},150);
})();