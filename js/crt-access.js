(function(){
  const $=id=>document.getElementById(id), E=escapeHTML; /* echappement HTML unifie (voir app-core.js) */
  const val=id=>$(id)?.value||'';
  const transportModes=['Voiture','4x4','À pied','Bateau motorisé','Bateau motorisé / pirogue','Canoë / kayak','Véhicule tout-terrain','Avion','Autre'];
  function ensureStationAccess(x){
    custom.stationAccess=custom.stationAccess||{};
    const key=x?.code||x?.nom; if(!key)return {modes:[],etapes:'',pointDepart:'',difficulte:''};
    return custom.stationAccess[key]||{modes:(x?.transportModes&&x.transportModes.length?x.transportModes:(x?.transport?[x.transport]:[])),etapes:x?.itineraire||x?.acces||'',pointDepart:x?.pointDepart||'',marche:x?.marche||x?.market||'',bassin:x?.bassin||x?.bassinVersant||x?.bv||'',difficulte:x?.difficulte||''};
  }
  /* Etoiles pour le niveau d'accessibilite (1 = tres difficile, 5 = tres facile). */
  function starRating(n){
    const v=Number(n);
    if(!Number.isFinite(v)||v<1||v>5)return '—';
    return '★'.repeat(v)+'☆'.repeat(5-v)+' ('+v+'/5)';
  }
  function stationTransportDetailed(x){const a=ensureStationAccess(x);return (a.modes&&a.modes.length?a.modes:[stationTransport(x)]).filter(Boolean)}
  function stationKey(x){return x?.code||x?.nom||''}
  function saveAccess(x,modes,etapes,depart,marche,difficulte){custom.stationAccess=custom.stationAccess||{};const prev=ensureStationAccess(x);custom.stationAccess[stationKey(x)]={...prev,modes,etapes,pointDepart:depart,marche,difficulte};saveLS(LSC,custom)}
  function openStationEnhanced(x){
    if(!x)return;
    state.network=x.network||state.network;state.activity=x.activity||state.activity;state.station=x.nom;state.session=state.session||null;
    const st=stationsFor(state.network,state.activity).find(s=>s.nom===x.nom)||x;
    try{fillStations();$('station').value=x.nom;refreshSiteFields();showForm();document.querySelector('[data-tab="new"]').click();toast('Station sélectionnée : '+x.nom)}catch(e){toast('Station sélectionnée : '+x.nom)}
  }
  window.openStation=openStationEnhanced;
  window.openStationEnhanced=openStationEnhanced;
  window.stationTransportDetailed=stationTransportDetailed;
  window.stationKey=stationKey;
  window.ensureStationAccess=ensureStationAccess;

  async function routeToStation(x){
    const ll=stationLatLon(x); if(!ll){toast('Coordonnées de station indisponibles');return}
    const info=$('stationInfo'); const modes=stationTransportDetailed(x); const access=ensureStationAccess(x);
    let origin=null;
    const dep=val('routeDeparture').trim();
    if(!dep){
      try{origin=await new Promise((res,rej)=>navigator.geolocation.getCurrentPosition(p=>res([p.coords.latitude,p.coords.longitude]),rej,{enableHighAccuracy:true,timeout:12000,maximumAge:60000}));}
      catch(e){info.innerHTML='<b>'+E(x.nom)+'</b><br>Position actuelle indisponible. Cliquez sur « Ma position » ou renseignez un départ.';return;}
    } else if(/^[-+]?\d+(?:\.\d+)?\s*,\s*[-+]?\d+(?:\.\d+)?$/.test(dep)){
      const a=dep.split(',').map(Number); origin=[a[0],a[1]];
    } else {
      info.innerHTML='<b>'+E(x.nom)+'</b><br>Le départ saisi sera utilisé par la navigation externe. Pour le tracé automatique, utilisez « Ma position » ou saisissez latitude, longitude.';
      return;
    }
    const preferred=modes.find(m=>/pied/i.test(m))&&!modes.some(m=>/voiture|4x4|véhicule/i.test(m))?'foot':'driving';
    const profile=preferred;
    info.innerHTML='<b>'+E(x.nom)+'</b><br>Calcul du trajet et des étapes…';
    const extGoogle='https://www.google.com/maps/dir/?api=1&origin='+origin[0]+','+origin[1]+'&destination='+ll[0]+','+ll[1];
    const extWaze='https://www.waze.com/ul?ll='+encodeURIComponent(ll[0]+','+ll[1])+'&navigate=yes';
    try{
      const url='https://router.project-osrm.org/route/v1/'+profile+'/'+origin[1]+','+origin[0]+';'+ll[1]+','+ll[0]+'?overview=full&geometries=geojson&steps=true&annotations=true';
      const data=await fetch(url).then(r=>{if(!r.ok)throw new Error('route');return r.json()});
      const rr=data.routes?.[0]; if(!rr)throw new Error('no route');
      if(window.guyaneRouteLayer){try{window.guyaneMap.removeLayer(window.guyaneRouteLayer)}catch(e){}}
      if(window.L&&window.guyaneMap&&rr.geometry){window.guyaneRouteLayer=L.geoJSON(rr.geometry,{weight:6}).addTo(window.guyaneMap);window.guyaneMap.fitBounds(window.guyaneRouteLayer.getBounds(),{padding:[30,30],maxZoom:14})}
      const steps=(rr.legs||[]).flatMap(l=>l.steps||[]).map(st=>st.maneuver?.instruction||st.name||'Continuer').filter(Boolean).slice(0,40);
      const km=(rr.distance/1000).toFixed(1),min=Math.max(1,Math.round(rr.duration/60));
      const accessLines=(access.etapes||'').split(/\n|→|;/).map(t=>t.trim()).filter(Boolean);
      const allSteps=steps.concat(accessLines.map(t=>'Accès station : '+t));
      const nonRoad=modes.filter(m=>!/voiture|4x4|pied|véhicule/i.test(m));
      info.innerHTML='<b>'+E(x.nom)+'</b><div class="transportChips">'+modes.map(m=>'<span class="transportChip">'+transportIcon(m)+' '+E(m)+'</span>').join('')+'</div><div class="routePanel"><div class="routeSummary"><div class="routeMetric"><span>Distance calculée</span><b>'+km+' km</b></div><div class="routeMetric"><span>Durée routière estimée</span><b>'+min+' min</b></div><div class="routeMetric"><span>Mode routier</span><b>'+E(profile==='foot'?'À pied':'Véhicule')+'</b></div></div><p><b>Départ :</b> '+E(origin[0].toFixed(6)+', '+origin[1].toFixed(6))+' · <b>Arrivée :</b> '+E(ll[0].toFixed(6)+', '+ll[1].toFixed(6))+'</p>'+(nonRoad.length?'<div class="banner warn"><b>Correspondance terrain :</b> '+E(nonRoad.join(', '))+'. '+E(access.etapes||'Consultez les consignes d’accès enregistrées.')+'</div>':'')+'<h4>Itinéraire étape par étape</h4><ol class="routeSteps">'+(allSteps.length?allSteps.map(t=>'<li>'+E(t)+'</li>').join(''):'<li>Suivre le tracé affiché jusqu’à la station.</li>')+'</ol><div class="actions"><button class="btn primary small" id="goStationNow">Ouvrir la fiche</button><a class="btn ghost small" target="_blank" rel="noopener" href="'+extGoogle+'">Google Maps</a><a class="btn ghost small" target="_blank" rel="noopener" href="'+extWaze+'">Waze</a></div></div>';
      $('goStationNow').onclick=()=>openStationEnhanced(x);
    }catch(e){
      info.innerHTML='<b>'+E(x.nom)+'</b><div class="transportChips">'+modes.map(m=>'<span class="transportChip">'+transportIcon(m)+' '+E(m)+'</span>').join('')+'</div><div class="routePanel"><b>Navigation GPS externe</b><p>Le calcul routier détaillé n’est pas disponible actuellement. Les moyens de transport et les consignes de la station restent affichés ci-dessus.</p><p><b>Accès :</b> '+E(access.etapes||'—')+'</p><div class="actions"><button class="btn primary small" id="goStationFallback">Ouvrir la fiche</button><a class="btn ghost small" target="_blank" rel="noopener" href="'+extGoogle+'">Google Maps</a><a class="btn ghost small" target="_blank" rel="noopener" href="'+extWaze+'">Waze</a></div></div>';
      $('goStationFallback').onclick=()=>openStationEnhanced(x);
    }
  }
  window.routeToStation=routeToStation;

  function renderAccessEditor(){
    const data=$('data'); if(!data||$('stationAccessEditor'))return;
    const card=document.createElement('div');card.className='card';card.id='stationAccessEditor';
    card.innerHTML='<h2>Accès et moyens de transport par station</h2><div class="grid2"><div class="field"><label>Station</label><select id="accessStation"><option value="">— sélectionner —</option></select></div><div class="field"><label>Marché de la station</label><input id="accessMarket" placeholder="Marché / lot / contrat"></div><div class="field"><label>Point de départ / base</label><input id="accessDepart" placeholder="Cayenne, Régina, Maripasoula…"></div></div><div class="grid2"><div class="field"><label>Moyens de transport nécessaires</label><div id="accessModes" class="checkGrid"></div></div><div class="field"><label>Niveau d’accessibilité</label><select id="accessDifficulte"><option value="">— non renseigné —</option><option value="1">★☆☆☆☆ Très difficile</option><option value="2">★★☆☆☆ Difficile</option><option value="3">★★★☆☆ Moyen</option><option value="4">★★★★☆ Facile</option><option value="5">★★★★★ Très facile</option></select></div></div><div class="field"><label>Étapes / consignes d’accès</label><textarea id="accessSteps" placeholder="Ex. véhicule → piste → pirogue → marche 20 min"></textarea></div><button class="btn primary small" id="saveAccess">Enregistrer l’accès station</button>';
    data.appendChild(card);
    const all=stations();$('accessStation').innerHTML+=[...new Map(all.map(x=>[stationKey(x),x])).values()].sort((a,b)=>String(a.nom).localeCompare(String(b.nom))).map(x=>'<option value="'+E(stationKey(x))+'">'+E(x.nom)+'</option>').join('');
    $('accessModes').innerHTML=transportModes.map((m,i)=>'<label class="check"><input type="checkbox" value="'+E(m)+'" id="am_'+i+'"><span>'+transportIcon(m)+' '+E(m)+'</span></label>').join('');
    $('accessStation').onchange=()=>{const x=all.find(s=>stationKey(s)===$('accessStation').value);if(!x)return;const a=ensureStationAccess(x);document.querySelectorAll('#accessModes input').forEach(c=>c.checked=a.modes.includes(c.value));$('accessDepart').value=a.pointDepart||'';$('accessSteps').value=a.etapes||'';$('accessMarket').value=a.marche||meta(x).m||'';$('accessDifficulte').value=a.difficulte||''};
    $('saveAccess').onclick=()=>{const x=all.find(s=>stationKey(s)===$('accessStation').value);if(!x)return toast('Sélectionnez une station');const modes=[...document.querySelectorAll('#accessModes input:checked')].map(c=>c.value);saveAccess(x,modes,val('accessSteps'),val('accessDepart'),val('accessMarket').trim(),val('accessDifficulte'));toast('Accès station enregistré ✓');mapStations()};
  }

  function setupCRT(){
    (function setupCRTCore(){
      const sel=$('crtRecord'); if(!sel)return;
      const esc=E;
      const refreshList=()=>{const current=String(sel.value||'');sel.innerHTML='<option value="">— sélectionner une fiche —</option>'+records.slice().sort((a,b)=>String(b.savedAt||'').localeCompare(String(a.savedAt||''))).map(r=>'<option value="'+esc(r.id)+'">'+esc(r.station)+' · '+esc(r.date||'')+' · '+esc(r.network||'')+' · '+esc(r.session||'')+'</option>').join('');if(current&&records.some(r=>String(r.id)===current))sel.value=current;};
      refreshList();
      const crtAuthor=$('crtAuthor'), crtPre=$('crtPreleveur');
      function refreshCrtPre(){
        const rr=records.find(x=>String(x.id)===String(val('crtRecord'))),org=rr?.organisme||'';
        let list=[]; if(typeof window.preList==='function')list=window.preList(org); else if(typeof allPreForOrg==='function')list=allPreForOrg(org);
        if(!list.length)list=(rr?.preleveurs||[]).filter(Boolean);
        list=[...new Set(list.filter(Boolean))];
        if(crtPre)crtPre.innerHTML='<option value="">— tous les préleveurs —</option>'+list.map(x=>'<option value="'+esc(x)+'">'+esc(x)+'</option>').join('');
        if(crtAuthor){const cur=crtAuthor.value;crtAuthor.innerHTML='<option value="">— sélectionner —</option>'+list.map(x=>'<option value="'+esc(x)+'">'+esc(x)+'</option>').join('');if(list.includes(cur))crtAuthor.value=cur;}
      }
      refreshCrtPre();
      sel.onchange=()=>{refreshCrtPre();render()};
      const FIELD_LABELS={
        meteo:'Météo',seuil:'Influence de seuil(s)',typePrelSandre:'Type de prélèvement',hydro:'Situation hydrologique',
        aspect:'Aspect des abords',irisations:'Irisation sur l’eau',mousse:'Mousse de détergent',feuilles:'Feuilles, branches, litière',
        boues:'Boues organiques flottantes',autresCorps:'Autres corps/produits',teinte:'Teinte de l’eau',coloration:'Coloration apparente',
        limpidite:'Limpidité de l’eau',odeur:'Odeur',ombre:'Ombrage',berge:'Distance berge (m)',debitTendance:'Tendance du débit',
        macro:'Recouvrement macrophytes (%)',largeur:'Largeur du cours d’eau (m)',profMoy:'Profondeur moyenne (m)',siteObs:'Observations du site',
        elMer:'État de la mer',elMaree:'Marée',elCoefMaree:'Coefficient de marée',elActivites:'Activités anthropiques',
        elIntensite:'Intensité',elIncidence:'Incidence sur le prélèvement',elDepth:'Profondeur totale (m)',
        fishLot:'N° de lot',fishDateOp:'Date de l’opération',fishMethod:'Méthode',fishDuration:'Durée de pêche',
        fishWeight:'Poids total (g)',fishTemp:'Température de conservation',fishStorage:'Mode de conservation',fishCold:'Chaîne du froid respectée',
        fishSend:'Envoi laboratoire',fishLab:'Laboratoire destinataire',fishObs:'Observations',
        fishWeather:'Conditions météorologiques (pêche)',fishHydro:'Conditions hydrologiques (pêche)',fishColdSend:'Mise au froid pour envoi',fishOtherInfo:'Autres informations utiles',
        bioEchelle:'Échelle d’observation',bioSemaine:'Semaine de prélèvement',
        rcoDiaRef:'Référence diatomées',rcoInvRef:'Référence invertébrés',rcoBioObs:'Notes RCO',
        phytoRef:'Référence phytoplancton',phytoObs:'Observations phytoplancton',
        phytoFixateur:'Fixateur utilisé',phytoFixateurVol:'Volume de fixateur (mL)',phytoChloroVol:'Volume filtré chlorophylle (mL)',phytoSecchi:'Transparence — disque de Secchi (m)',
        adneRef:'Référence ADNe',adneObs:'Observations ADNe',
        elMoyenEchSample:'Moyen d’échantillonnage',elConservationSample:'Conservation échantillon',elFiltreChloro:'Filtre chlorophylle',elVfChloro:'Volume filtré chlorophylle (mL)',
        specRef:'Référence / informations spécifiques'
      };
      function getR(){return records.find(r=>String(r.id)===String(val('crtRecord')))}
      function fmt(v){if(v==null||v==='')return '—';if(Array.isArray(v))return v.map(fmt).join(' ; ');if(typeof v==='object')return Object.entries(v).filter(([k,x])=>x!==''&&x!=null&&k!=='signature').map(([k,x])=>'<div><b>'+esc(FIELD_LABELS[k]||k)+'</b> : '+fmt(x)+'</div>').join('')||'—';return esc(String(v))}
      function num(v){const n=Number(String(v??'').replace(',','.'));return Number.isFinite(n)?n:null}
      function photoHtml(r){const groups=['Amont','Aval','Rive gauche','Rive droite'];let h='';groups.forEach(g=>{const arr=(r.photos||[]).filter(p=>(typeof p==='string'?'Amont':(p.group||'Amont'))===g);if(arr.length)h+='<div class="crtPhotoGroup"><h4>'+esc(g)+'</h4><div class="crtPhotoGrid">'+arr.map(p=>'<figure><img src="'+esc(typeof p==='string'?p:p.data)+'" alt="Photo '+esc(g)+'"><figcaption>'+esc(g)+'</figcaption></figure>').join('')+'</div></div>'});return h||'<div class="crtNoData">Aucune photographie enregistrée.</div>'}
      function matrix(r){const s=r.sample||{},v=[];if(s.matriceEau==='Oui'||s.eau==='Oui'||s.matrice==='Eau')v.push('Eau');if(s.matriceSediment==='Oui'||s.sediments==='Oui'||s.sediment==='Oui')v.push('Sédiments');return v.join(' · ')||((/sédiment/i.test(r.activity||''))?'Sédiments':'Eau')}
      function header(code,r,label){return '<div class="crtPageHead"><div class="crtPageHeadLeft"><img src="data:image/png;base64,'+LOGO+'" class="crtPageLogo" alt="OEG"><span>'+esc(label||'RAPPORT DE TERRAIN')+'</span></div><div class="crtPageHeadRight"><b>'+esc(code)+' — '+esc(r.station)+'</b><br><span class="crtSmall">'+esc(r.network||'—')+' · '+esc(r.date||'—')+' · '+esc(r.session||'—')+'</span></div></div>'}
      function graphSvg(series,unit){
        const W=640,H=280,L=78,R=30,T=28,B=54,iw=W-L-R,ih=H-T-B;
        if(!series.length)return '<div class="crtNoData">Aucune mesure exploitable pour ce paramètre.</div>';
        const o=series.slice().sort((a,b)=>a.depth-b.depth),xs=o.map(x=>x.value),ys=o.map(x=>x.depth);
        let xmin=Math.min(...xs),xmax=Math.max(...xs),ymin=Math.min(...ys),ymax=Math.max(...ys);
        const xr=(xmax-xmin), yr=(ymax-ymin);
        const padX=xr?xr*.14:Math.max(Math.abs(xmax)*.12,1), padY=yr?Math.max(yr*.08,.25):1;
        let x0=xmin-padX,x1=xmax+padX;
        if(xmin===xmax){x0=xmin-Math.max(Math.abs(xmin)*.2,1);x1=xmax+Math.max(Math.abs(xmax)*.2,1)}
        let y0=Math.min(0,ymin-padY),y1=Math.max(ymax+padY,Math.max(1,ymax));
        if(y1===y0)y1=y0+1;
        const sx=v=>L+(v-x0)/(x1-x0)*iw,sy=v=>T+(v-y0)/(y1-y0)*ih;
        const fmt=v=>{const n=Number(v);if(Math.abs(n)>=100)return n.toFixed(0);if(Math.abs(n)>=10)return n.toFixed(1);return n.toFixed(2)};
        let g='';
        for(let i=0;i<=5;i++){const x=x0+(x1-x0)*i/5,px=sx(x);g+='<line x1="'+px.toFixed(1)+'" y1="'+T+'" x2="'+px.toFixed(1)+'" y2="'+(T+ih)+'" stroke="#dfe7ec"/><text x="'+px.toFixed(1)+'" y="'+(H-30)+'" text-anchor="middle" font-size="9" fill="#617180">'+esc(fmt(x))+'</text>'}
        for(let i=0;i<=5;i++){const y=y0+(y1-y0)*i/5,py=sy(y);g+='<line x1="'+L+'" y1="'+py.toFixed(1)+'" x2="'+(L+iw)+'" y2="'+py.toFixed(1)+'" stroke="#edf1f4"/><text x="'+(L-9)+'" y="'+(py+3).toFixed(1)+'" text-anchor="end" font-size="9" fill="#617180">'+esc(fmt(y))+'</text>'}
        const path=o.length>1?o.map((p,i)=>(i?'L':'M')+sx(p.value).toFixed(1)+' '+sy(p.depth).toFixed(1)).join(' '):'';
        const pts=o.map(p=>{const px=sx(p.value),py=sy(p.depth);return '<line x1="'+L+'" y1="'+py.toFixed(1)+'" x2="'+px.toFixed(1)+'" y2="'+py.toFixed(1)+'" stroke="#c9d5dc" stroke-dasharray="3 3"/><circle cx="'+px.toFixed(1)+'" cy="'+py.toFixed(1)+'" r="5" fill="#003D7A" stroke="#fff" stroke-width="2"/><text x="'+(px+9).toFixed(1)+'" y="'+(py-7).toFixed(1)+'" font-size="9" font-weight="700" fill="#003D7A">'+esc(fmt(p.value))+' '+esc(unit)+'</text><text x="'+(L+5)+'" y="'+(py-7).toFixed(1)+'" font-size="8.5" fill="#17212b">'+esc(p.name)+'</text>'}).join('');
        return '<svg viewBox="0 0 '+W+' '+H+'" role="img" aria-label="Profil vertical '+esc(unit)+' selon la profondeur"><rect width="100%" height="100%" fill="#fff"/><rect x="'+L+'" y="'+T+'" width="'+iw+'" height="'+ih+'" fill="#f8fafb" stroke="#cbd6dd"/>'+g+'<line x1="'+L+'" y1="'+T+'" x2="'+L+'" y2="'+(T+ih)+'" stroke="#52626e" stroke-width="1.4"/><line x1="'+L+'" y1="'+(T+ih)+'" x2="'+(L+iw)+'" y2="'+(T+ih)+'" stroke="#52626e" stroke-width="1.4"/>'+(o.length>1?'<path d="'+path+'" fill="none" stroke="#003D7A" stroke-width="2.8" stroke-linejoin="round" stroke-linecap="round"/>':'')+pts+'<text x="'+(L+iw/2)+'" y="'+(H-8)+'" text-anchor="middle" font-size="10" font-weight="700" fill="#17212b">Valeur ('+esc(unit)+')</text><text x="18" y="'+(T+ih/2)+'" text-anchor="middle" transform="rotate(-90 18 '+(T+ih/2)+')" font-size="10" font-weight="700" fill="#17212b">Profondeur / niveau (m)</text></svg>';
      }
      function elCards(ins){
        const defs=[['temp','Température de l’eau','°C'],['ph','pH','u.pH'],['sal','Salinité','—'],['condus','Conductivité','µS/cm'],['condms','Conductivité','mS/cm'],['o2mg','Oxygène dissous','mg O₂/L'],['o2pc','Saturation O₂','%'],['turb','Turbidité','NTU']];
        const p=ins.profondeurs||{},labels={surf:'Surface',inter:'Mesure intermédiaire',fond:'Fond -1 m'};
        return defs.map(([k,label,unit])=>{
          let series=[];
          if(k==='turb'){const t=ins.turbidite||{};series=[['surf',t.surf?.moyenne],['inter',t.inter?.moyenne],['fond',t.fond?.moyenne]].map(([d,v])=>({name:labels[d],depth:num(p[d==='surf'?'surface':d==='inter'?'intermediaire':'fond']),value:num(v)})).filter(x=>x.depth!==null&&x.value!==null)}
          else {const d=ins.params?.[k]||{};series=[['surface',d.surface],['intermediaire',d.inter],['fond',d.fond]].map(([dep,v])=>({name:dep==='surface'?'Surface':dep==='intermediaire'?'Mesure intermédiaire':'Fond -1 m',depth:num(p[dep]),value:num(v)})).filter(x=>x.depth!==null&&x.value!==null)}
          const d=ins.params?.[k]||{},probe=k==='turb'?((ins.turbidite?.surf?.sonde||ins.turbidite?.inter?.sonde||ins.turbidite?.fond?.sonde||'—')):(d.sonde||'—');
          return '<div class="crtGraphCard"><h3>'+esc(label)+' <span class="crtSmall">('+esc(unit)+')</span></h3>'+graphSvg(series,unit)+'<div class="crtGraphMeta"><b>Code sonde / appareil :</b> '+esc(probe)+'</div></div>';
        }).join('');
      }      function elDataTable(ins){
        const defs=[['temp','Température (°C)'],['ph','pH (u.pH)'],['sal','Salinité'],['condus','Conductivité (µS/cm)'],['condms','Conductivité (mS/cm)'],['o2mg','O₂ dissous (mg/L)'],['o2pc','Saturation O₂ (%)'],['turb','Turbidité (NTU)']];
        const rows=defs.map(([k,label])=>{
          let surf,inter,fond;
          if(k==='turb'){const t=ins.turbidite||{};surf=t.surf?.moyenne;inter=t.inter?.moyenne;fond=t.fond?.moyenne}
          else{const d=ins.params?.[k]||{};surf=d.surface;inter=d.inter;fond=d.fond}
          if(surf==null&&inter==null&&fond==null)return '';
          return '<tr><td>'+esc(label)+'</td><td>'+esc(surf??'—')+'</td><td>'+esc(inter??'—')+'</td><td>'+esc(fond??'—')+'</td></tr>';
        }).join('');
        return rows?'<table class="crtTable" style="margin-top:4mm"><thead><tr><th>Paramètre</th><th>Surface</th><th>Mesure intermédiaire</th><th>Fond -1 m</th></tr></thead><tbody>'+rows+'</tbody></table>':'';
      }

      function genericMetrics(ins){
        const labels={ph:['pH','u.pH'],temp:['Température de l’eau','°C'],cond:['Conductivité à 25°C','µS/cm'],sal:['Salinité','—'],o2mg:['Oxygène dissous','mg O₂/L'],o2pc:['Saturation O₂','%'],turb:['Turbidité','NTU'],air:['Température de l’air','°C'],redox:['Potentiel redox','mV']};
        const rows=Object.entries(ins).filter(([k,v])=>k!=='mode'&&v&&typeof v==='object'&&labels[k]);
        return rows.length?'<div class="crtMetricGrid">'+rows.map(([k,v])=>{let value=v.value;if(k==='turb'&&Array.isArray(v.mesures))value=v.moyenne??v.value;return '<div class="crtMetric"><div class="lab">'+esc(labels[k][0])+'</div><div class="val">'+esc(value==null||value===''?'—':value)+' <small>'+esc(labels[k][1])+'</small></div><div class="meta">'+(v.mode?'Mode : '+esc(v.mode):'')+(v.gmao?' · Code : '+esc(v.gmao):'')+'</div></div>'}).join('')+'</div>':'<div class="crtNoData">Aucune mesure in situ enregistrée.</div>';
      }      function genericDataTable(ins){
        const labels={ph:['pH','u.pH'],temp:['Température de l’eau','°C'],cond:['Conductivité à 25°C','µS/cm'],sal:['Salinité','—'],o2mg:['Oxygène dissous','mg O₂/L'],o2pc:['Saturation O₂','%'],turb:['Turbidité','NTU'],air:['Température de l’air','°C'],redox:['Potentiel redox','mV']};
        const rows=Object.entries(ins).filter(([k,v])=>k!=='mode'&&v&&typeof v==='object'&&labels[k]);
        if(!rows.length)return '';
        const trs=rows.map(([k,v])=>{
          let value=v.value;if(k==='turb'&&Array.isArray(v.mesures))value=v.moyenne??v.value;
          return '<tr><td>'+esc(labels[k][0])+'</td><td>'+esc(value==null||value===''?'—':value)+'</td><td>'+esc(labels[k][1])+'</td><td>'+esc(v.mode||'—')+'</td><td>'+esc(v.gmao||'—')+'</td></tr>';
        }).join('');
        return '<table class="crtTable" style="margin-top:4mm"><thead><tr><th>Paramètre</th><th>Valeur</th><th>Unité</th><th>Mode</th><th>Code sonde / appareil</th></tr></thead><tbody>'+trs+'</tbody></table>';
      }

      function fmtConditions(cond,network){
        if(network!=='EL')return fmt(cond);
        const filtered=Object.fromEntries(Object.entries(cond||{}).filter(([k])=>!['elMer','elMaree','elCoefMaree'].includes(k)));
        return fmt(filtered);
      }
      function sommaire(r){
        const hasChloro=r.network==='EL';
        const hasSed=r.network==='Chimie'||r.network==='RCO';
        const items=[
          ['📍','Station & localisation','Identification, accès, carte'+(r.network==='EL'?'':', schéma du lieu')],
          ['🧪','Mesures & échantillonnage','Conditions de terrain, mesures in situ, échantillonnage et conservation'+(hasChloro?', chlorophylle':'')],
          ['📋','Observations & validation','Observations, données complémentaires'+(hasSed?', sédiments':'')+', photographies, conclusion et validation'],
        ];
        return '<div class="crtSommaireList">'+items.map((it,i)=>'<div class="crtSommaireItem"><span class="crtSommaireIcon">'+it[0]+'</span><div><b>'+(i+2)+'. '+esc(it[1])+'</b><br><span class="crtSmall">'+esc(it[2])+'</span></div></div>').join('')+'</div>';
      }
      function sedimentSection(sample,prefix){
        const p=prefix;
        if((sample?.[p+'Sed']||'')!=='Oui')return '';
        const type=sample[p+'SedType']==='Autre'?(sample[p+'SedTypeAutre']||'Autre'):(sample[p+'SedType']||'—');
        const gran=sample[p+'SedGran']==='Autre'?(sample[p+'SedGranAutre']||'Autre'):(sample[p+'SedGran']||'—');
        const outils=(sample[p+'SedOutils']||[]).join(', ')+(sample[p+'SedOutilAutre']?' ('+sample[p+'SedOutilAutre']+')':'');
        const isInter=(sample[p+'SedMode']||'').startsWith('Intermédiaire');
        const tamis=sample[p+'SedTamis']==='Oui';
        return '<h2>🪣 Échantillonnage de sédiments</h2><table class="crtTable">'+
          '<tr><th>Gants nitriles</th><td>'+esc(sample[p+'SedGants']||'—')+'</td><th>Hauteur prélevée</th><td>'+(sample[p+'SedHauteur']?esc(sample[p+'SedHauteur'])+' cm':'—')+'</td></tr>'+
          '<tr><th>Type d’échantillonnage</th><td>'+esc(type)+'</td><th>Mode de prélèvement</th><td>'+esc(sample[p+'SedMode']||'—')+'</td></tr>'+
          (isInter?'<tr><th>Outil(s) utilisé(s)</th><td colspan="3">'+esc(outils||'—')+'</td></tr>':'')+
          '<tr><th>Tamisage sur site</th><td>'+esc(sample[p+'SedTamis']||'—')+'</td><th>Granulométrie du tamis</th><td>'+esc(tamis?gran:'—')+'</td></tr>'+
          (tamis&&sample[p+'SedMateriaux']==='Oui'?'<tr><th>Matériaux de tamisage</th><td colspan="3">'+esc(sample[p+'SedMat']||'—')+'</td></tr>':'')+
          '<tr><th>Organisme récepteur</th><td>'+esc(sample[p+'SedRecepteur']||'—')+'</td><th>Date / heure remise</th><td>'+esc(sample[p+'SedRemise']||'—')+'</td></tr>'+
        '</table>';
      }
      function synthesis(r,ins,sample){
        const params=Object.keys(ins&&ins.params?ins.params:ins||{}).filter(k=>k!=='mode'&&ins[k]&&typeof ins[k]==='object').length||Object.keys(ins?.params||{}).length;
        const sedDone=(sample?.chimieSed==='Oui'||sample?.rcoSed==='Oui');
        const bits=[];
        bits.push((r.network==='EL'?'Mesures physico-chimiques réalisées à 3 profondeurs':params?params+' paramètre(s) physico-chimique(s) mesuré(s) in situ':'Aucune mesure in situ enregistrée'));
        if(r.network==='EL'&&sample?.elChloro==='Oui')bits.push('prélèvement pour dosage de la chlorophylle');
        if(sedDone)bits.push('prélèvement de sédiments réalisé');
        const statut=r.lifecycle?.status;
        return '<p class="crtSmall">Visite de terrain du '+esc(r.date||'—')+' à la station <b>'+esc(r.station||'—')+'</b> ('+esc(netLabel(r.network)||r.network||'—')+'). '+esc(bits.join(' ; ')||'—')+'.'+(statut?' Statut de la fiche : <b>'+esc(statut)+'</b>.':'')+'</p>';
      }
      function locationSvg(ll){
        if(!ll)return '<div class="crtNoData">Coordonnées non calculables pour cette station.</div>';
        const outline=[[5.75,-53.95],[5.68,-53.72],[5.60,-53.50],[5.48,-53.20],[5.30,-52.90],[5.16,-52.65],[5.05,-52.45],[4.93,-52.33],[4.85,-52.20],[4.60,-52.05],[4.35,-51.85],[4.15,-51.62],[3.90,-51.80],[3.65,-51.80],[3.20,-51.95],[2.85,-52.35],[2.45,-52.50],[2.35,-52.90],[2.30,-53.50],[2.23,-54.03],[2.23,-54.48],[2.90,-54.35],[3.65,-54.03],[4.30,-54.38],[5.15,-54.35],[5.50,-54.03],[5.75,-53.95]];
        const W=300,H=300,padding=14;
        const lats=outline.map(p=>p[0]),lons=outline.map(p=>p[1]);
        const latMin=Math.min(...lats),latMax=Math.max(...lats),lonMin=Math.min(...lons),lonMax=Math.max(...lons);
        const sx=lon=>padding+(lon-lonMin)/(lonMax-lonMin)*(W-2*padding);
        const sy=lat=>padding+(latMax-lat)/(latMax-latMin)*(H-2*padding);
        const path=outline.map((p,i)=>(i?'L':'M')+sx(p[1]).toFixed(1)+' '+sy(p[0]).toFixed(1)).join(' ')+' Z';
        const px=sx(ll[1]),py=sy(ll[0]);
        return '<svg viewBox="0 0 '+W+' '+H+'" role="img" aria-label="Localisation schématique en Guyane"><path d="'+path+'" fill="var(--crt-soft)" stroke="var(--crt-blue)" stroke-width="1.6" stroke-linejoin="round"/><circle cx="'+px.toFixed(1)+'" cy="'+py.toFixed(1)+'" r="6" fill="var(--crt-turq)" stroke="#fff" stroke-width="2"/><circle cx="'+px.toFixed(1)+'" cy="'+py.toFixed(1)+'" r="11" fill="none" stroke="var(--crt-turq)" stroke-width="1.4"/></svg>';
      }
      function locationMap(ll){
        // Carte réelle (tuiles OpenStreetMap), centrée précisément sur la station,
        // ajustée pour remplir exactement le cadre .crtMapPlaceholder (recadrée, jamais
        // débordante) quelle que soit sa taille réelle au moment de l'impression.
        // Nécessite un accès internet au moment de la génération/impression du CRT —
        // à défaut, on retombe sur la carte schématique de la Guyane (locationSvg).
        if(!ll)return '<div class="crtNoData">Coordonnées non calculables pour cette station.</div>';
        const zoom=14,tileSize=256,viewportW=900,viewportH=320;
        const [lat,lon]=ll;
        const n=Math.pow(2,zoom);
        const worldX=(lon+180)/360*n*tileSize;
        const latRad=lat*Math.PI/180;
        const worldY=(1-Math.log(Math.tan(latRad)+1/Math.cos(latRad))/Math.PI)/2*n*tileSize;
        const originX=worldX-viewportW/2,originY=worldY-viewportH/2;
        const firstTileX=Math.floor(originX/tileSize),firstTileY=Math.floor(originY/tileSize);
        const tilesX=Math.ceil(viewportW/tileSize)+1,tilesY=Math.ceil(viewportH/tileSize)+1;
        let tiles='';
        for(let ty=0;ty<tilesY;ty++){
          for(let tx=0;tx<tilesX;tx++){
            const gx=firstTileX+tx,gy=firstTileY+ty;
            const left=gx*tileSize-originX,top=gy*tileSize-originY;
            tiles+='<img src="https://tile.openstreetmap.org/'+zoom+'/'+gx+'/'+gy+'.png" style="position:absolute;left:'+left+'px;top:'+top+'px;width:'+tileSize+'px;height:'+tileSize+'px" alt="">';
          }
        }
        const markerX=worldX-originX,markerY=worldY-originY;
        return '<div style="position:relative;width:100%;height:100%;overflow:hidden">'+
          '<div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:'+viewportW+'px;height:'+viewportH+'px">'+tiles+
          '<div style="position:absolute;left:'+(markerX-9)+'px;top:'+(markerY-9)+'px;width:18px;height:18px;border-radius:50%;background:var(--crt-turq);border:2.5px solid #fff;box-shadow:0 0 0 1px var(--crt-blue)"></div>'+
          '</div></div>';
      }
      function render(){
        const r=getR(),box=$('crtPreviewBox');if(!r){box.innerHTML='<div class="hint">Sélectionnez une fiche puis cliquez sur « Aperçu du CRT ».</div>';return}
        const station=stations().find(s=>s.nom===r.station)||r.stationInfo||{},access=ensureStationAccess(station),modes=stationTransportDetailed(station),m=meta(station),ll=stationLatLon(station),proj=r.projection||station.projection||'RGFG 95 / UTM 22N',code=r.codeSandre||r.code||station.code||'Non défini',desc=station.description||station.descriptionStation||station.pressionDescription||station.pression||'',ins=r.insitu||{},operators=val('crtPreleveur')||((r.preleveurs||[]).join(' · ')||'—'),season=(r.session||'').toLowerCase().includes('pluie')?'SAISON DES PLUIES':'SAISON SÈCHE';
        const mapLink=ll?'Position : '+esc(ll[0].toFixed(6))+' ; '+esc(ll[1].toFixed(6)):'';
        const title=val('crtObjet')||'Mise en œuvre de la DCE en Guyane — Rapport de terrain';
        const graphBlock=r.network==='EL'?'<div class="crtGraphLegend"><b>Profil vertical in situ.</b> Chaque courbe relie les valeurs mesurées aux niveaux réellement saisis sur la fiche terrain. La turbidité affichée correspond uniquement à la moyenne des trois répétitions.</div><div class="crtGraphGrid">'+elCards(ins)+'</div>'+elDataTable(ins):'<div class="crtGraphLegend"><b>Mesures in situ.</b> Présentation harmonisée des valeurs enregistrées sur la fiche terrain, avec conservation des unités et des informations appareil.</div>'+genericMetrics(ins)+genericDataTable(ins);
        const elMaritime=r.network==='EL'?'<br><br><b>Conditions maritimes</b><br>État de la mer : '+esc(r.conditions?.elMer||'—')+'<br>Marée : '+esc(r.conditions?.elMaree||'—')+(r.conditions?.elCoefMaree?' (coefficient '+esc(r.conditions.elCoefMaree)+')':''):'';
        const sample=r.sample||{};
        const chloroBlock=(r.network==='EL'&&station.type==='MEC')?'<h2>Chlorophylle</h2><table class="crtTable"><tr><th>Prélèvement chlorophylle</th><td>'+esc(sample.elChloro||'—')+'</td><th>Filtre utilisé</th><td>'+esc(sample.elFiltreChloro||'—')+'</td></tr><tr><th>Volume filtré</th><td colspan="3">'+(sample.elVfChloro?esc(sample.elVfChloro)+' mL':'—')+'</td></tr></table>':'';
        box.innerHTML='<div class="crtReport">'+
          '<section class="crtPage crtCover" data-report="'+esc(code)+' — '+esc(r.station)+'"><img src="data:image/png;base64,'+LOGO+'" alt="Office de l\'Eau de Guyane" class="crtCoverLogo"><div class="crtKicker">OFFICE DE L’EAU DE GUYANE</div><h1>COMPTE RENDU TECHNIQUE</h1><h2>'+esc(title)+'</h2><div class="crtSession">'+esc(r.session||'Session non renseignée')+'</div><div class="crtCoverStation"><b>'+esc(code)+' — '+esc(r.station)+'</b><br><span>'+esc(m.b||'Bassin versant non renseigné')+'</span></div><div class="crtCoverMeta"><div><b>Organisme</b>'+esc(r.organisme||'—')+'</div><div><b>Préleveur(s)</b>'+esc(operators)+'</div><div><b>Date</b>'+esc(r.date||'—')+'</div><div><b>Référence CRT</b>'+esc(val('crtRef')||'—')+'</div></div><div class="crtSynthesis">'+synthesis(r,ins,sample)+'</div></section>'+
          '<section class="crtPage" data-report="'+esc(code)+' — '+esc(r.station)+'">'+header(code,r,'SOMMAIRE')+'<h2>📖 Sommaire du rapport</h2>'+sommaire(r)+'</section>'+
          '<section class="crtPage" data-report="'+esc(code)+' — '+esc(r.station)+'">'+header(code,r,'STATION · LOCALISATION')+'<h2>🆔 Identification de la station</h2><table class="crtTable"><tr><th>Code SANDRE</th><td>'+esc(code)+'</td><th>Réseau</th><td>'+esc(r.network||'—')+'</td></tr><tr><th>Bassin versant</th><td>'+esc(m.b||'—')+'</td><th>Marché</th><td>'+esc(m.m||'—')+'</td></tr><tr><th>Date</th><td>'+esc(r.date||'—')+'</td><th>Horaires</th><td>'+esc((r.heureDebut||'—')+' – '+(r.heureFin||'—'))+'</td></tr></table><h2>🚗 Description / accès</h2><p class="crtSmall">'+esc(desc||'Description à compléter dans les données station.')+'</p><div class="accessGrid"><div><b>Accessibilité</b><br>'+starRating(access.difficulte||station.difficulte)+'</div><div><b>Moyens</b><br>'+(modes.length?modes.map(x=>transportIcon(x)+' '+esc(x)).join(' · '):'—')+'</div><div><b>Départ / base</b><br>'+esc(access.pointDepart||'—')+'</div><div><b>Consignes</b><br>'+esc(access.etapes||'—')+'</div></div><h2>🗺️ Localisation</h2><div class="crtMapPlaceholder">'+locationMap(ll)+'</div><p class="crtSmall">'+(mapLink||'Coordonnées non disponibles')+(ll?' · © contributeurs OpenStreetMap':'')+'</p>'+(r.network==='EL'?'':'<h2>✏️ Schéma de station</h2><div class="crtSchema">'+(r.dessin?'<img src="'+esc(r.dessin)+'" alt="Schéma du lieu d’échantillonnage">':'<span class="crtSmall">Aucun schéma enregistré.</span>')+'</div>')+'</section>'+
          '<section class="crtPage" data-report="'+esc(code)+' — '+esc(r.station)+'">'+header(code,r,'MESURES · ÉCHANTILLONNAGE')+'<h2>🌦️ Conditions de terrain</h2><div class="crtTwoCol"><div>'+fmtConditions(r.conditions,r.network)+'</div><div><b>Saison</b><br>'+esc(season)+'<br><br><b>Matrice(s)</b><br>'+esc(matrix(r))+elMaritime+'</div></div><h2>📊 Visualisation des données in situ</h2>'+graphBlock+'<h2>🧴 Échantillonnage et conservation</h2><table class="crtTable"><tr><th>Type de prélèvement</th><td>'+fmt(sample.stype||r.stype||'—')+'</td><th>Conservation</th><td>'+fmt(sample.elConservationSample||sample.conservation||r.conservation||'—')+'</td></tr><tr><th>Transport froid</th><td>'+fmt(sample.transportFroid||'—')+'</td><th>Suivi</th><td>'+fmt(sample.transportSuivi||'—')+'</td></tr><tr><th>Récepteur</th><td colspan="3">'+fmt(sample.recepteur||sample.recepteurs||r.recepteur||'—')+'</td></tr></table>'+chloroBlock+'</section>'+
          '<section class="crtPage" data-report="'+esc(code)+' — '+esc(r.station)+'">'+header(code,r,'OBSERVATIONS · VALIDATION')+'<h2>📝 Observations</h2><div class="crtComment">'+esc(r.comment||r.obs||'RAS')+'</div><h2>➕ Données complémentaires</h2><div>'+fmt(r.specific||{})+'</div>'+(r.network==='Chimie'?sedimentSection(sample,'chimie'):r.network==='RCO'?sedimentSection(sample,'rco'):'')+'<h2>📷 Photographies</h2>'+photoHtml(r)+'<h2>✅ Conclusion / synthèse</h2><div class="crtComment">'+esc(val('crtConclusion')||r.comment||r.obs||'—')+'</div><h2>🖊️ Validation</h2><table class="crtTable"><tr><th>Rédacteur</th><td>'+esc(val('crtAuthor')||'—')+'</td><th>Statut</th><td>'+esc(r.lifecycle?.status||'—')+'</td></tr><tr><th>Organisme</th><td>'+esc(r.organisme||'—')+'</td><th>Référence</th><td>'+esc(val('crtRef')||'—')+'</td></tr><tr><th>Identifiant fiche</th><td colspan="3" class="crtTraceId">'+esc(r.id||'—')+'</td></tr></table><p class="crtSmall">Cet identifiant permet de retrouver la fiche source dans l’application (onglet « Liste des fiches »).</p><div class="crtLegendBlock"><b>Référentiel graphique</b><br><span class="crtSmall">Les valeurs, niveaux, unités et codes appareils affichés dans ce CRT proviennent de la fiche terrain enregistrée. Aucune donnée n’est recalculée hormis la moyenne des trois mesures de turbidité lorsque celle-ci est disponible.</span></div></section></div>';
      }
      $('crtPreview').onclick=render;
      $('crtGenerate').onclick=()=>{try{if(!getR())return toast('Sélectionnez une fiche');render();setTimeout(()=>{const r=getR(),box=$('crtPreviewBox');if(!box?.querySelector('.crtReport'))return toast('Aperçu CRT impossible : vérifiez la fiche sélectionnée.');const oldTitle=document.title;document.title='CRT_'+(r.station||'station')+'_'+(val('crtRef')||'rapport');window.print();setTimeout(()=>document.title=oldTitle,1500)},80)}catch(e){console.error(e);toast('Erreur CRT : '+e.message)}};
      setTimeout(refreshCrtPre,0);
    })();
  }
  document.querySelectorAll('.tab[data-tab="stations"]').forEach(b=>b.addEventListener('click',()=>setTimeout(()=>window.mapStations&&window.mapStations(),120)));
  document.querySelectorAll('.tab[data-tab="data"]').forEach(b=>b.addEventListener('click',()=>setTimeout(renderAccessEditor,80)));
  document.querySelectorAll('.tab[data-tab="crt"]').forEach(b=>b.addEventListener('click',()=>setTimeout(setupCRT,80)));
  setTimeout(()=>{if(window.L){try{mapStations()}catch(e){}}renderAccessEditor();setupCRT()},400);
  window.setupCRT=setupCRT;
})();