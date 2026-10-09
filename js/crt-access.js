(function(){
  const $=id=>document.getElementById(id), E=escapeHTML; /* echappement HTML unifie (voir app-core.js) */
  const val=id=>$(id)?.value||'';
  const transportModes=['Voiture','4x4','À pied','Bateau motorisé','Bateau motorisé / pirogue','Canoë / kayak','Véhicule tout-terrain','Avion','Autre'];
  function ensureStationAccess(x){
    custom.stationAccess=custom.stationAccess||{};
    const key=x?.code||x?.nom; if(!key)return {modes:[],etapes:'',pointDepart:'',difficulte:''};
    return custom.stationAccess[key]||{modes:(x?.transportModes&&x.transportModes.length?x.transportModes:(x?.transport?[x.transport]:[])),etapes:x?.itineraire||x?.acces||'',pointDepart:x?.pointDepart||'',marche:x?.marche||x?.market||'',bassin:x?.bassin||x?.bassinVersant||x?.bv||'',difficulte:x?.difficulte||''};
  }
  /* Accessibilite : 1 étoile = très facile … 5 étoiles = très difficile. Valeur stockée inchangée (1 = très difficile, 5 = très facile) pour conserver les saisies existantes. */
  function starRating(n){
    const raw=Number(n);
    if(!Number.isFinite(raw)||raw<1||raw>5)return '—';
    const v=6-raw;
    return '★'.repeat(v)+'☆'.repeat(5-v)+' ('+v+'/5)';
  }
  function stationTransportDetailed(x){const a=ensureStationAccess(x);return (a.modes&&a.modes.length?a.modes:[stationTransport(x)]).filter(Boolean)}
  function stationKey(x){return x?.code||x?.nom||''}
  function saveAccess(x,modes,etapes,depart,marche,difficulte){custom.stationAccess=custom.stationAccess||{};const prev=ensureStationAccess(x);custom.stationAccess[stationKey(x)]={...prev,modes,etapes,pointDepart:depart,marche,difficulte};saveLS(LSC,custom)}
  function openStationEnhanced(x){
    if(!x)return;
    // Fiche enregistrée en cours de modification : confirmation puis nouvelle fiche vierge,
    // sinon l'enregistrement écrasait cette fiche avec la nouvelle station (voir app-core.js).
    if(state.editing){if(!(window.leaveEditedFiche&&window.leaveEditedFiche()))return;if(x.network)selectNetwork(x.network)}
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
    card.innerHTML='<h2>Accès et moyens de transport par station</h2><div class="grid2"><div class="field"><label>Station</label><select id="accessStation"><option value="">— sélectionner —</option></select></div><div class="field"><label>Marché de la station</label><input id="accessMarket" placeholder="Marché / lot / contrat"></div><div class="field"><label>Point de départ / base</label><input id="accessDepart" placeholder="Cayenne, Régina, Maripasoula…"></div></div><div class="grid2"><div class="field"><label>Moyens de transport nécessaires</label><div id="accessModes" class="checkGrid"></div></div><div class="field"><label>Niveau d’accessibilité</label><select id="accessDifficulte"><option value="">— non renseigné —</option><option value="5">★☆☆☆☆ Très facile</option><option value="4">★★☆☆☆ Facile</option><option value="3">★★★☆☆ Moyen</option><option value="2">★★★★☆ Difficile</option><option value="1">★★★★★ Très difficile</option></select></div></div><div class="field"><label>Étapes / consignes d’accès</label><textarea id="accessSteps" placeholder="Ex. véhicule → piste → pirogue → marche 20 min"></textarea></div><button class="btn primary small" id="saveAccess">Enregistrer l’accès station</button>';
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
      sel.onchange=()=>{refreshCrtPre();loadMetaIntoForm();render()};
      const FIELD_LABELS={
        meteo:'Météo',seuil:'Influence de seuil(s)',typePrelSandre:'Type de prélèvement',hydro:'Situation hydrologique',
        aspect:'Aspect des abords',irisations:'Irisation sur l’eau',mousse:'Mousse de détergent',feuilles:'Feuilles, branches, litière',
        boues:'Boues organiques flottantes',autresCorps:'Autres corps/produits',teinte:'Teinte de l’eau',coloration:'Coloration apparente',
        limpidite:'Limpidité de l’eau',odeur:'Odeur',ombre:'Ombrage',berge:'Distance berge (m)',debitTendance:'Tendance du débit',
        macro:'Recouvrement macrophytes (%)',largeur:'Largeur du cours d’eau (m)',profMoy:'Profondeur moyenne (m)',siteObs:'Observations du site',
        elMer:'État de la mer',elMaree:'Marée',elCoefMaree:'Coefficient de marée',elActivites:'Activités anthropiques',
        elIntensite:'Intensité',elIncidence:'Incidence activité humaine',elDepth:'Profondeur totale (m)',
        // Libellés repris à l'identique du formulaire (auparavant plusieurs ne correspondaient pas :
        // « Laboratoire destinataire » pour la date d'arrivée au laboratoire, etc.)
        fishLot:'Identification du lot (référence unique)',fishDateOp:'Date / heure de l’opération',fishMethod:'Méthode de capture employée',fishDuration:'Durée de l’opération',
        fishWeather:'Conditions météorologiques',fishHydro:'Conditions hydrologiques',fishCold:'Date / heure mise en enceinte réfrigérée',fishTemp:'Température de stockage (°C)',
        fishStorage:'Durée de stockage dans l’enceinte',fishColdSend:'Date / heure mise en enceinte réfrigérée pour envoi au laboratoire',fishSend:'Date / heure d’envoi au laboratoire',
        fishLab:'Date / heure d’arrivée au laboratoire',fishWeight:'Poids frais total du lot (g)',fishOtherInfo:'Autres informations utiles',fishObs:'Remarques concernant les conditions de pêche',
        bioEchelle:'Lecture échelle / information hydrométrique (m)',bioSemaine:'Référence opération Eau / Cours d’eau',
        rcoEau:'Eau prélevée',rcoInv:'Invertébrés aquatiques réalisés',rcoDia:'Diatomées réalisées',
        rcoDiaRef:'Référence prélèvement Diatomées',rcoInvRef:'Référence prélèvement IA',rcoBioObs:'Notes RCO',
        phytoRef:'Référence prélèvement Phytoplancton',phytoObs:'Observation Phytoplancton',
        phytoFixateur:'Fixateur utilisé',phytoFixateurVol:'Volume de fixateur ajouté (mL)',phytoChloroVol:'Volume filtré pour la chlorophylle (mL)',phytoSecchi:'Transparence — disque de Secchi (m)',
        adneRef:'Référence prélèvement ADNe',adneObs:'Observation ADNe',
        elMoyenEchSample:'Moyen d’échantillonnage',elConservationSample:'Conservation échantillon',elFiltreChloro:'Filtre chlorophylle',elVfChloro:'Volume filtré chlorophylle (mL)',
        specRef:'Référence / informations spécifiques'
      };
      function getR(){return records.find(r=>String(r.id)===String(val('crtRecord')))}
      // Saisies du CRT (référence, date, rédacteur, préleveur, objet, conclusion, saison) mémorisées
      // PAR FICHE dans custom.crtMeta (et non dans la fiche, pour ne pas modifier son empreinte
      // d'intégrité) : elles ne sont plus perdues en changeant de fiche, et le CRT consolidé reprend
      // celles de chaque fiche. Elles sont incluses dans l'export JSON / la sauvegarde automatique.
      custom.crtMeta=(custom.crtMeta&&typeof custom.crtMeta==='object')?custom.crtMeta:{};
      const META_FIELDS={ref:'crtRef',date:'crtDate',author:'crtAuthor',preleveur:'crtPreleveur',objet:'crtObjet',conclusion:'crtConclusion',saison:'crtSaison'};
      function metaFor(r){return (r&&custom.crtMeta[r.id])||{}}
      function loadMetaIntoForm(){
        const m=metaFor(getR());
        Object.entries(META_FIELDS).forEach(([k,id])=>{const el=$(id);if(el)el.value=m[k]||''});
      }
      let metaTimer=null;
      function saveMetaFromForm(){
        const r=getR();if(!r)return;
        const m={};Object.entries(META_FIELDS).forEach(([k,id])=>{const v=val(id).trim();if(v)m[k]=v});
        if(Object.keys(m).length)custom.crtMeta[r.id]=m;else delete custom.crtMeta[r.id];
        if(metaTimer)clearTimeout(metaTimer);metaTimer=setTimeout(()=>saveLS(LSC,custom),400);
      }
      Object.values(META_FIELDS).forEach(id=>{const el=$(id);if(el){el.oninput=saveMetaFromForm;el.onchange=saveMetaFromForm}});
      // Saison : choisie dans le formulaire CRT, sinon déduite du mois de la visite, selon le
      // calendrier retenu par l'OEG : saison sèche d'août à décembre, saison des pluies de janvier
      // à juillet, avec le « petit été de mars » (mars). Auparavant elle était déduite du nom de
      // la session, qui ne contient jamais « pluie » : toujours « sèche ».
      function seasonFor(r){
        const m=metaFor(r);if(m.saison)return m.saison;
        const month=Number(String(r.date||'').slice(5,7));
        if(!month)return 'SAISON NON DÉTERMINÉE';
        if(month>=8)return 'SAISON SÈCHE';
        if(month===3)return 'PETIT ÉTÉ DE MARS';
        return 'SAISON DES PLUIES';
      }
      function frDate(iso){const s=String(iso||'');const m=s.match(/^(\d{4})-(\d{2})-(\d{2})/);return m?m[3]+'/'+m[2]+'/'+m[1]:(s||'—')}
      function reportDate(r){const d=metaFor(r).date;return d?frDate(d):frDate(new Date().toISOString().slice(0,10))}
      // Date ISO (aaaa-mm-jj ou aaaa-mm-jjThh:mm, saisie des champs date / datetime-local) → jj/mm/aaaa hh:mm
      function fmtDT(v){const s=String(v??'');const m=s.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}:\d{2}))?$/);return m?m[3]+'/'+m[2]+'/'+m[1]+(m[4]?' '+m[4]:''):s}
      // Clés affichées ailleurs dans le CRT (sédiments, individus de pêche) ou jamais imprimées
      const skipKey=k=>k==='signature'||/^(rco|chimie)Sed/.test(k)||/^f_.+_\d+_[tp]$/.test(k);
      const blank=x=>x==null||x===''||x===false||(typeof x==='string'&&!x.trim());
      function fmt(v){if(blank(v))return '—';if(v===true)return 'Oui';if(Array.isArray(v)){const a=v.filter(x=>!blank(x));return a.length?a.map(fmt).join(' ; '):'—'}if(typeof v==='object')return Object.entries(v).filter(([k,x])=>!blank(x)&&!skipKey(k)).map(([k,x])=>'<div><b>'+esc(FIELD_LABELS[k]||k)+'</b> : '+fmt(x)+'</div>').join('')||'—';return esc(fmtDT(String(v).trim()))}
      function num(v){if(v===''||v==null)return null;const n=Number(String(v).replace(',','.'));return Number.isFinite(n)?n:null} // vide = absent (et non 0)
      // Valeur arrondie à 2 décimales (une moyenne de turbidité s'imprimait 3.3333333333333335)
      function r2(v){const n=num(v);if(n===null){const t=String(v??'').trim();return t||'—'}return String(Math.round(n*100)/100)}
      // Cellule texte d'un tableau : vide = « — », dates au format français
      function cell(v){return blank(v)?'—':esc(fmtDT(String(v).trim()))}
      // Tableau libellé / valeur sur deux colonnes ; [libellé, html, true] = valeur déjà mise en forme
      function kvTable(pairs){
        pairs=pairs.filter(Boolean);if(!pairs.length)return '';
        const td=p=>p[2]?p[1]:cell(p[1]);let h='<table class="crtTable">';
        for(let i=0;i<pairs.length;i+=2){const a=pairs[i],b=pairs[i+1];h+='<tr><th>'+esc(a[0])+'</th><td'+(b?'':' colspan="3"')+'>'+td(a)+'</td>'+(b?'<th>'+esc(b[0])+'</th><td>'+td(b)+'</td>':'')+'</tr>'}
        return h+'</table>';
      }
      function photoHtml(r){
        const photos=r.photos||[];
        if(!photos.length)return '<div class="crtNoData">Aucune photographie enregistrée.</div>';
        return '<div class="crtPhotoGrid">'+photos.map(p=>{
          const data=typeof p==='string'?p:p.data, g=typeof p==='string'?'Amont':(p.group||'Amont');
          return '<figure><img src="'+esc(data)+'" alt="Photo '+esc(g)+'"><figcaption>'+esc(g)+'</figcaption></figure>';
        }).join('')+'</div>';
      }
      // Matrice(s) réellement prélevée(s), d'après les réponses de la fiche (auparavant lues dans des
      // champs qui n'existent pas : toujours « Eau », même pour un prélèvement de sédiments RCO).
      function matrix(r){
        const s=r.sample||{},sp=r.specific||{},v=[];
        if(r.network==='ESO')return 'Eau souterraine';
        if(r.network==='RCO'){
          if(sp.rcoEau==='Oui')v.push('Eau');
          if(s.rcoSed==='Oui'||sp.rcoSed==='Oui')v.push('Sédiments');
          if(sp.rcoInv==='Oui')v.push('Invertébrés aquatiques');
          if(sp.rcoDia==='Oui')v.push('Diatomées');
          return v.join(' · ')||'Non renseignée';
        }
        v.push('Eau');
        if(r.network==='Chimie'&&s.chimieSed==='Oui')v.push('Sédiments');
        if(r.network==='BIO'&&Object.entries(sp).some(([k,x])=>/^(fish|f_)/.test(k)&&!blank(x)))v.push('Biote (poissons)');
        return v.join(' · ');
      }
      function header(code,r,label){return '<div class="crtPageHead"><div class="crtPageHeadLeft"><img src="img/logo-oeg.png" class="crtPageLogo" alt="OEG"><span>'+esc(label||'RAPPORT DE TERRAIN')+'</span></div><div class="crtPageHeadRight"><b>'+esc(code)+' — '+esc(r.station)+'</b><br><span class="crtSmall">'+esc(r.network||'—')+' · '+esc(frDate(r.date))+' · '+esc(r.session||'—')+'</span></div></div>'}
      function graphSvg(series,unit){
        const W=640,H=300,L=82,R=34,T=30,B=58,iw=W-L-R,ih=H-T-B;
        if(!series.length)return '<div class="crtNoData">Aucune mesure exploitable pour ce paramètre.</div>';
        const o=series.slice().sort((a,b)=>a.depth-b.depth),xs=o.map(x=>x.value),ys=o.map(x=>x.depth);
        let xmin=Math.min(...xs),xmax=Math.max(...xs),ymin=Math.min(...ys),ymax=Math.max(...ys);
        const xr=(xmax-xmin), yr=(ymax-ymin);
        const padX=xr?xr*.14:Math.max(Math.abs(xmax)*.12,1), padY=yr?Math.max(yr*.08,.25):1;
        let x0=xmin-padX,x1=xmax+padX;
        if(xmin===xmax){x0=xmin-Math.max(Math.abs(xmin)*.2,1);x1=xmax+Math.max(Math.abs(xmax)*.2,1)}
        let y0=0,y1=Math.max(ymax+padY,1); // une profondeur n'est jamais négative (l'axe affichait -0,25 m)
        if(y1===y0)y1=y0+1;
        const sx=v=>L+(v-x0)/(x1-x0)*iw,sy=v=>T+(v-y0)/(y1-y0)*ih;
        const fmt=v=>{const n=Number(v);if(Math.abs(n)>=100)return n.toFixed(0);if(Math.abs(n)>=10)return n.toFixed(1);return n.toFixed(2)};
        let g='';
        for(let i=0;i<=5;i++){const x=x0+(x1-x0)*i/5,px=sx(x);g+='<line x1="'+px.toFixed(1)+'" y1="'+T+'" x2="'+px.toFixed(1)+'" y2="'+(T+ih)+'" stroke="#dfe7ec"/><text x="'+px.toFixed(1)+'" y="'+(H-30)+'" text-anchor="middle" font-size="13" fill="#617180">'+esc(fmt(x))+'</text>'}
        for(let i=0;i<=5;i++){const y=y0+(y1-y0)*i/5,py=sy(y);g+='<line x1="'+L+'" y1="'+py.toFixed(1)+'" x2="'+(L+iw)+'" y2="'+py.toFixed(1)+'" stroke="#edf1f4"/><text x="'+(L-9)+'" y="'+(py+3).toFixed(1)+'" text-anchor="end" font-size="13" fill="#617180">'+esc(fmt(y))+'</text>'}
        const path=o.length>1?o.map((p,i)=>(i?'L':'M')+sx(p.value).toFixed(1)+' '+sy(p.depth).toFixed(1)).join(' '):'';
        const pts=o.map(p=>{const px=sx(p.value),py=sy(p.depth);return '<line x1="'+L+'" y1="'+py.toFixed(1)+'" x2="'+px.toFixed(1)+'" y2="'+py.toFixed(1)+'" stroke="#c9d5dc" stroke-dasharray="3 3"/><circle cx="'+px.toFixed(1)+'" cy="'+py.toFixed(1)+'" r="5" fill="#003D7A" stroke="#fff" stroke-width="2"/><text x="'+(px+9).toFixed(1)+'" y="'+(py-7).toFixed(1)+'" font-size="13" font-weight="700" fill="#003D7A">'+esc(fmt(p.value))+' '+esc(unit)+'</text><text x="'+(L+5)+'" y="'+(py-7).toFixed(1)+'" font-size="12" fill="#17212b">'+esc(p.name)+'</text>'}).join('');
        return '<svg viewBox="0 0 '+W+' '+H+'" role="img" aria-label="Profil vertical '+esc(unit)+' selon la profondeur"><rect width="100%" height="100%" fill="#fff"/><rect x="'+L+'" y="'+T+'" width="'+iw+'" height="'+ih+'" fill="#f8fafb" stroke="#cbd6dd"/>'+g+'<line x1="'+L+'" y1="'+T+'" x2="'+L+'" y2="'+(T+ih)+'" stroke="#52626e" stroke-width="1.4"/><line x1="'+L+'" y1="'+(T+ih)+'" x2="'+(L+iw)+'" y2="'+(T+ih)+'" stroke="#52626e" stroke-width="1.4"/>'+(o.length>1?'<path d="'+path+'" fill="none" stroke="#003D7A" stroke-width="2.8" stroke-linejoin="round" stroke-linecap="round"/>':'')+pts+'<text x="'+(L+iw/2)+'" y="'+(H-8)+'" text-anchor="middle" font-size="13" font-weight="700" fill="#17212b">Valeur ('+esc(unit)+')</text><text x="18" y="'+(T+ih/2)+'" text-anchor="middle" transform="rotate(-90 18 '+(T+ih/2)+')" font-size="13" font-weight="700" fill="#17212b">Profondeur / niveau (m)</text></svg>';
      }
      function elCards(ins){
        const defs=[['temp','Température de l’eau','°C'],['ph','pH','u.pH'],['sal','Salinité','—'],['condus','Conductivité','µS/cm'],['condms','Conductivité','mS/cm'],['o2mg','Oxygène dissous','mg O₂/L'],['o2pc','Saturation O₂','%'],['turb','Turbidité','NTU']];
        const p=ins.profondeurs||{},labels={surf:'Surface',inter:'Mesure intermédiaire',fond:'Fond -1 m'};
        return defs.map(([k,label,unit])=>{
          let series=[];
          if(k==='turb'){const t=ins.turbidite||{};series=[['surf',t.surf?.moyenne],['inter',t.inter?.moyenne],['fond',t.fond?.moyenne]].map(([d,v])=>({name:labels[d],depth:num(p[d==='surf'?'surface':d==='inter'?'intermediaire':'fond']),value:num(v)})).filter(x=>x.depth!==null&&x.value!==null)}
          else {const d=ins.params?.[k]||{};series=[['surface',d.surface],['intermediaire',d.intermediaire??d.inter],['fond',d.fond]].map(([dep,v])=>({name:dep==='surface'?'Surface':dep==='intermediaire'?'Mesure intermédiaire':'Fond -1 m',depth:num(p[dep]),value:num(v)})).filter(x=>x.depth!==null&&x.value!==null)}
          const d=ins.params?.[k]||{},probe=k==='turb'?((ins.turbidite?.surf?.sonde||ins.turbidite?.inter?.sonde||ins.turbidite?.fond?.sonde||'—')):(d.sonde||'—');
          return '<div class="crtGraphCard"><h3>'+esc(label)+' <span class="crtSmall">('+esc(unit)+')</span></h3>'+graphSvg(series,unit)+'<div class="crtGraphMeta"><b>Code sonde / appareil :</b> '+esc(probe)+'</div></div>';
        }).join('');
      }      function elDataTable(ins){
        const defs=[['temp','Température (°C)'],['ph','pH (u.pH)'],['sal','Salinité'],['condus','Conductivité (µS/cm)'],['condms','Conductivité (mS/cm)'],['o2mg','O₂ dissous (mg/L)'],['o2pc','Saturation O₂ (%)'],['turb','Turbidité (NTU)']];
        const p=ins.profondeurs||{};
        // Niveau réel de chaque mesure (auparavant absent du tableau : seuls les graphes le donnaient)
        const depthRow=[p.surface,p.intermediaire,p.fond].some(x=>num(x)!==null)?'<tr><td><b>Niveau de mesure (m)</b></td><td>'+esc(r2(p.surface))+'</td><td>'+esc(r2(p.intermediaire))+'</td><td>'+esc(r2(p.fond))+'</td></tr>':'';
        const rows=defs.map(([k,label])=>{
          let surf,inter,fond;
          if(k==='turb'){const t=ins.turbidite||{};surf=t.surf?.moyenne;inter=t.inter?.moyenne;fond=t.fond?.moyenne}
          else{const d=ins.params?.[k]||{};surf=d.surface;inter=d.intermediaire??d.inter;fond=d.fond}
          if(blank(surf)&&blank(inter)&&blank(fond))return '';
          return '<tr><td>'+esc(label)+'</td><td>'+esc(r2(surf))+'</td><td>'+esc(r2(inter))+'</td><td>'+esc(r2(fond))+'</td></tr>';
        }).join('');
        const total=num(ins.profondeur)!==null?'<p class="crtSmall"><b>Profondeur totale :</b> '+esc(r2(ins.profondeur))+' m</p>':'';
        return (rows||depthRow)?'<table class="crtTable" style="margin-top:4mm"><thead><tr><th>Paramètre</th><th>Surface</th><th>Mesure intermédiaire</th><th>Fond -1 m</th></tr></thead><tbody>'+depthRow+rows+'</tbody></table>'+total:total;
      }

      function genericMetrics(ins){
        const labels={ph:['pH','u.pH'],temp:['Température de l’eau','°C'],cond:['Conductivité à 25°C','µS/cm'],sal:['Salinité','—'],o2mg:['Oxygène dissous','mg O₂/L'],o2pc:['Saturation O₂','%'],turb:['Turbidité','NTU'],air:['Température de l’air','°C'],redox:['Potentiel redox','mV']};
        const rows=Object.entries(ins).filter(([k,v])=>k!=='mode'&&v&&typeof v==='object'&&labels[k]);
        return rows.length?'<div class="crtMetricGrid">'+rows.map(([k,v])=>{let value=v.value;if(k==='turb'&&Array.isArray(v.mesures))value=v.moyenne??v.value;return '<div class="crtMetric"><div class="lab">'+esc(labels[k][0])+'</div><div class="val">'+esc(r2(value))+' <small>'+esc(labels[k][1])+'</small></div><div class="meta">'+(v.mode?'Mode : '+esc(v.mode):'')+(v.gmao?' · Code : '+esc(v.gmao):'')+'</div></div>'}).join('')+'</div>':'<div class="crtNoData">Aucune mesure in situ enregistrée.</div>';
      }      function genericDataTable(ins){
        const labels={ph:['pH','u.pH'],temp:['Température de l’eau','°C'],cond:['Conductivité à 25°C','µS/cm'],sal:['Salinité','—'],o2mg:['Oxygène dissous','mg O₂/L'],o2pc:['Saturation O₂','%'],turb:['Turbidité','NTU'],air:['Température de l’air','°C'],redox:['Potentiel redox','mV']};
        const rows=Object.entries(ins).filter(([k,v])=>k!=='mode'&&v&&typeof v==='object'&&labels[k]);
        if(!rows.length)return '';
        const trs=rows.map(([k,v])=>{
          let value=v.value;if(k==='turb'&&Array.isArray(v.mesures))value=v.moyenne??v.value;
          return '<tr><td>'+esc(labels[k][0])+'</td><td>'+esc(r2(value))+'</td><td>'+esc(labels[k][1])+'</td><td>'+esc(v.mode||'—')+'</td><td>'+esc(v.gmao||'—')+'</td></tr>';
        }).join('');
        return '<table class="crtTable" style="margin-top:4mm"><thead><tr><th>Paramètre</th><th>Valeur</th><th>Unité</th><th>Mode</th><th>Code sonde / appareil</th></tr></thead><tbody>'+trs+'</tbody></table>';
      }

      // ---- Suivi historique à la station (tableau déjà fourni par elDataTable/genericDataTable
      // ci-dessus ; ici on ajoute un histogramme comparant les visites successives) ----
      function paramDefsFor(network){
        if(network==='EL')return [['temp','Température de l’eau','°C'],['ph','pH','u.pH'],['sal','Salinité','—'],['condus','Conductivité','µS/cm'],['condms','Conductivité','mS/cm'],['o2mg','Oxygène dissous','mg O₂/L'],['o2pc','Saturation O₂','%'],['turb','Turbidité','NTU']];
        return [['ph','pH','u.pH'],['temp','Température de l’eau','°C'],['cond','Conductivité à 25°C','µS/cm'],['sal','Salinité','—'],['o2mg','Oxygène dissous','mg O₂/L'],['o2pc','Saturation O₂','%'],['turb','Turbidité','NTU'],['air','Température de l’air','°C'],['redox','Potentiel redox','mV']];
      }
      function paramValue(rec,network,key){
        const i=rec.insitu||{};
        if(network==='EL'){
          if(key==='turb'){const t=i.turbidite||{};return num(t.surf?.moyenne??t.inter?.moyenne??t.fond?.moyenne)}
          const d=i.params?.[key]||{};return num(d.surface??d.intermediaire??d.inter??d.fond);
        }
        const d=i[key]||{};let v=d.value;if(key==='turb'&&Array.isArray(d.mesures))v=d.moyenne??d.value;return num(v);
      }
      function histogramSvg(points){
        const W=640,H=230,L=60,R=16,T=22,B=40,iw=W-L-R,ih=H-T-B;
        if(points.length<2)return '<div class="crtNoData">Historique insuffisant (au moins 2 relevés nécessaires).</div>';
        const vals=points.map(p=>p.value);
        let vmin=Math.min(0,...vals),vmax=Math.max(...vals);if(vmax===vmin)vmax=vmin+1;
        const sy=v=>T+ih-(v-vmin)/(vmax-vmin)*ih;
        const gap=iw/points.length,bw=Math.min(34,gap*.55);
        const fmtv=v=>{const n=Number(v);if(Math.abs(n)>=100)return n.toFixed(0);if(Math.abs(n)>=10)return n.toFixed(1);return n.toFixed(2)};
        let bars='',labels='',grid='';
        for(let i=0;i<=4;i++){const v=vmin+(vmax-vmin)*i/4,py=sy(v);grid+='<line x1="'+L+'" y1="'+py.toFixed(1)+'" x2="'+(L+iw)+'" y2="'+py.toFixed(1)+'" stroke="#edf1f4"/><text x="'+(L-6)+'" y="'+(py+3).toFixed(1)+'" text-anchor="end" font-size="12" fill="#617180">'+esc(fmtv(v))+'</text>'}
        points.forEach((p,i)=>{
          const cx=L+gap*i+gap/2,y=sy(p.value),h=(T+ih)-y;
          bars+='<rect x="'+(cx-bw/2).toFixed(1)+'" y="'+y.toFixed(1)+'" width="'+bw.toFixed(1)+'" height="'+Math.max(0,h).toFixed(1)+'" fill="#00AC97"/>';
          bars+='<text x="'+cx.toFixed(1)+'" y="'+(y-4).toFixed(1)+'" text-anchor="middle" font-size="12" font-weight="700" fill="#003D7A">'+esc(fmtv(p.value))+'</text>';
          labels+='<text x="'+cx.toFixed(1)+'" y="'+(T+ih+15)+'" text-anchor="middle" font-size="11" fill="#617180">'+esc(p.label)+'</text>';
        });
        return '<svg viewBox="0 0 '+W+' '+H+'" role="img" aria-label="Historique des mesures"><rect width="100%" height="100%" fill="#fff"/>'+grid+'<line x1="'+L+'" y1="'+T+'" x2="'+L+'" y2="'+(T+ih)+'" stroke="#52626e" stroke-width="1.2"/><line x1="'+L+'" y1="'+(T+ih)+'" x2="'+(L+iw)+'" y2="'+(T+ih)+'" stroke="#52626e" stroke-width="1.2"/>'+bars+labels+'</svg>';
      }
      // ---- EL : historique sur un même graphe pour les trois profondeurs (couleur + forme de point
      // partagées avec l'onglet Suivi, EL_DEPTHS dans app-core.js). Auparavant : la surface seule,
      // en barres (et l'intermédiaire à sa place quand la surface manquait). ----
      function elDepthValue(rec,k,d){
        const i=rec.insitu||{};
        if(k==='turb')return num(i.turbidite?.[d.key]?.moyenne);
        const p=i.params?.[k]||{};return num(d.field==='intermediaire'?(p.intermediaire??p.inter):p[d.field]);
      }
      function depthMarkSvg(d,x,y,k){
        k=k||1;const ring='stroke="#fff" stroke-width="'+(2*k)+'"',f=v=>v.toFixed(1);
        if(d.shape==='square')return '<rect x="'+f(x-5*k)+'" y="'+f(y-5*k)+'" width="'+f(10*k)+'" height="'+f(10*k)+'" fill="'+d.color+'" '+ring+'/>';
        if(d.shape==='triangle')return '<path d="M'+f(x)+' '+f(y-6.5*k)+' L'+f(x+6*k)+' '+f(y+4.5*k)+' L'+f(x-6*k)+' '+f(y+4.5*k)+' Z" fill="'+d.color+'" '+ring+'/>';
        return '<circle cx="'+f(x)+'" cy="'+f(y)+'" r="'+f(5.5*k)+'" fill="'+d.color+'" '+ring+'/>';
      }
      function elHistorySvg(history,k,unit,currentId){
        const series=EL_DEPTHS.map(d=>({d,pts:history.map(rec=>elDepthValue(rec,k,d))})).filter(x=>x.pts.some(v=>v!==null));
        if(history.filter((rec,i)=>series.some(x=>x.pts[i]!==null)).length<2)return '';
        const W=640,H=250,L=62,R=60,T=18,B=50,iw=W-L-R,ih=H-T-B,n=history.length;
        const vals=series.flatMap(x=>x.pts.filter(v=>v!==null));
        let vmin=Math.min(...vals),vmax=Math.max(...vals);if(vmin===vmax){vmin-=1;vmax+=1}else{const e=(vmax-vmin)*.14;vmin-=e;vmax+=e}
        const sx=i=>L+(n===1?iw/2:i*iw/(n-1)),sy=v=>T+(vmax-v)/(vmax-vmin)*ih;
        const dodge=series.length>1?{surf:-5,inter:0,fond:5}:{surf:0,inter:0,fond:0};
        const fmtv=v=>{const a=Math.abs(v);return a>=100?v.toFixed(0):a>=10?v.toFixed(1):v.toFixed(2)};
        let g='';
        for(let i=0;i<=4;i++){const v=vmin+(vmax-vmin)*i/4,py=sy(v);g+='<line x1="'+L+'" y1="'+py.toFixed(1)+'" x2="'+(L+iw)+'" y2="'+py.toFixed(1)+'" stroke="#e5ebee"/><text x="'+(L-8)+'" y="'+(py+4).toFixed(1)+'" text-anchor="end" font-size="12" fill="#617180">'+esc(fmtv(v))+'</text>'}
        const ci=history.findIndex(rec=>rec.id===currentId);
        if(ci>=0){const bw=n>1?Math.min(46,iw/(n-1)*.8):46;g+='<rect x="'+(sx(ci)-bw/2).toFixed(1)+'" y="'+T+'" width="'+bw.toFixed(1)+'" height="'+ih+'" fill="#003D7A" fill-opacity=".07"/>'}
        g+='<line x1="'+L+'" y1="'+(T+ih)+'" x2="'+(L+iw)+'" y2="'+(T+ih)+'" stroke="#52626e" stroke-width="1.2"/>';
        history.forEach((rec,i)=>{
          const dt=/^\d{4}-\d{2}-\d{2}/.test(rec.date||'')?rec.date.slice(8,10)+'/'+rec.date.slice(5,7)+'/'+rec.date.slice(2,4):'—',ses=(/^(S\d+)\s*-/.exec(rec.session||'')||[])[1]||'';
          const bold=i===ci?' font-weight="700" fill="#003D7A"':' fill="#617180"';
          g+=(ses?'<text x="'+sx(i).toFixed(1)+'" y="'+(T+ih+16)+'" text-anchor="middle" font-size="12"'+bold+'>'+esc(ses)+'</text>':'')+'<text x="'+sx(i).toFixed(1)+'" y="'+(T+ih+(ses?31:16))+'" text-anchor="middle" font-size="11"'+bold+'>'+esc(dt)+'</text>';
        });
        let lines='',marks='';const labs=[];
        series.forEach(({d,pts})=>{
          const dx=dodge[d.key]||0;let path='',open=false;
          pts.forEach((v,i)=>{if(v===null){open=false;return}const x=sx(i)+dx,y=sy(v);path+=(open?'L':'M')+x.toFixed(1)+' '+y.toFixed(1);open=true;marks+=depthMarkSvg(d,x,y);if(i===ci)labs.push({d,x:x+9,y,txt:fmtv(v)})});
          if(path)lines+='<path d="'+path+'" fill="none" stroke="'+d.color+'" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>';
        });
        // Valeurs de la visite du rapport seulement (les autres se lisent sur l'axe), chacune précédée du
        // symbole de sa profondeur (identifiable même écartée de son point) et détourée de blanc.
        labs.sort((a,b)=>a.y-b.y);for(let j=1;j<labs.length;j++)if(labs[j].y-labs[j-1].y<15)labs[j].y=labs[j-1].y+15;
        const vl=labs.map(l=>depthMarkSvg(l.d,l.x+4,l.y,.7)+'<text x="'+(l.x+11).toFixed(1)+'" y="'+(l.y+4).toFixed(1)+'" font-size="12" font-weight="700" fill="#17212b" stroke="#fff" stroke-width="3.5" paint-order="stroke" stroke-linejoin="round">'+esc(l.txt)+'</text>').join('');
        return '<svg viewBox="0 0 '+W+' '+H+'" role="img" aria-label="Historique '+esc(unit)+' par profondeur"><rect width="100%" height="100%" fill="#fff"/>'+g+lines+marks+vl+'</svg>';
      }
      function historyBlock(r,ins){
        const network=r.network,defs=paramDefsFor(network);
        const history=records.filter(x=>x.station===r.station&&x.network===network).slice().sort((a,b)=>String(a.date||'').localeCompare(String(b.date||'')));
        if(history.length<2)return '';
        if(network==='EL'){
          const cards=defs.map(([k,label,unit])=>{const svg=elHistorySvg(history,k,unit,r.id);return svg?'<div class="crtGraphCard"><h3>'+esc(label)+' <span class="crtSmall">('+esc(unit)+')</span></h3>'+svg+'</div>':''}).filter(Boolean).join('');
          if(!cards)return '';
          const key=EL_DEPTHS.map(d=>'<span class="crtDepthKey">'+depthMarkerSvg(d,11)+' '+esc(d.label)+'</span>').join(' ');
          return '<h3 style="margin-top:5mm">📈 Suivi historique à la station ('+history.length+' visite(s))</h3><div class="crtGraphLegend">Valeurs mesurées lors des visites successives à cette station, pour chaque profondeur : '+key+'. La visite du présent rapport est surlignée, avec ses valeurs.</div><div class="crtGraphGrid">'+cards+'</div>';
        }
        const cards=defs.map(([k,label,unit])=>{
          const points=history.map(rec=>({label:/^\d{4}-\d{2}-\d{2}/.test(rec.date||'')?rec.date.slice(8,10)+'/'+rec.date.slice(5,7)+'/'+rec.date.slice(2,4):'—',value:paramValue(rec,network,k)})).filter(p=>p.value!==null);
          if(points.length<2)return '';
          return '<div class="crtGraphCard"><h3>'+esc(label)+' <span class="crtSmall">('+esc(unit)+')</span></h3>'+histogramSvg(points)+'</div>';
        }).filter(Boolean).join('');
        if(!cards)return '';
        return '<h3 style="margin-top:5mm">📈 Suivi historique à la station ('+history.length+' visite(s))</h3><div class="crtGraphLegend">Comparaison, par paramètre, des valeurs mesurées lors des différentes visites de terrain enregistrées sur cette station (toutes sessions confondues).</div><div class="crtGraphGrid">'+cards+'</div>';
      }

      // Conditions SANDRE : la fiche enregistre le code (« 3 ») ; le CRT imprime le libellé suivi du
      // code (« Basses eaux (code SANDRE 3) ») d'après les listes du formulaire (W et S, app-core.js).
      // Les fiches EL enregistrent directement le libellé : rien à traduire.
      const SANDRE_LIST={meteo:'meteo',seuil:'seuil',typePrelSandre:'type',hydro:'hydro',aspect:'aspect',irisations:'yn0',mousse:'yn0',feuilles:'yn0',boues:'yn0',autresCorps:'yn',teinte:'teinte',coloration:'coloration',limpidite:'limpidite',odeur:'odeur',ombre:'ombre',debitTendance:'debit'};
      function sandreLabel(k,v){
        const n=SANDRE_LIST[k];if(!n||blank(v))return v;
        const list=n==='meteo'?(typeof W!=='undefined'?W:[]):((typeof S!=='undefined'&&S[n])||[]);
        const hit=list.find(x=>x[0]===String(v).trim());
        return hit?hit[1]+' (code SANDRE '+hit[0]+')':v;
      }
      function fmtConditions(cond,network){
        if(network!=='EL')return fmt(Object.fromEntries(Object.entries(cond||{}).map(([k,v])=>[k,sandreLabel(k,v)])));
        const filtered=Object.fromEntries(Object.entries(cond||{}).filter(([k])=>!['elMer','elMaree','elCoefMaree'].includes(k)));
        return fmt(filtered);
      }
      function sommaire(r){
        const hasChloro=r.network==='EL';
        const hasSed=r.network==='Chimie'||r.network==='RCO';
        const items=[
          ['📍','Station & localisation','Identification, accès, carte, photographies'+(r.network==='EL'?'':', schéma du lieu')],
          ['🧪','Mesures & échantillonnage','Conditions de terrain, mesures in situ, matériel de mesure, '+(r.network==='ESO'?'ouvrage et purge, ':'')+'échantillonnage, transport'+(hasChloro?', chlorophylle':'')+', traçabilité'],
          ['📋','Observations & validation','Contrôle qualité, observations, données complémentaires'+(hasSed?', sédiments':'')+', non-conformités, conclusion et validation'],
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
        return '<p class="crtSmall">Visite de terrain du '+esc(frDate(r.date))+' à la station <b>'+esc(r.station||'—')+'</b> ('+esc(netLabel(r.network)||r.network||'—')+'). '+esc(bits.join(' ; ')||'—')+'.'+(statut?' Statut de la fiche : <b>'+esc(statut)+'</b>.':'')+'</p>';
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
      function locationMap(points){
        // Carte réelle (tuiles OpenStreetMap) centrée pour faire tenir tous les points fournis,
        // ajustée pour remplir exactement le cadre .crtMapPlaceholder (recadrée, jamais
        // débordante) quelle que soit sa taille réelle au moment de l'impression.
        // points : [{ll:[lat,lon], label, color}], un point par position à distinguer
        // (théorique / terrain). Nécessite un accès internet au moment de la génération/
        // impression du CRT — à défaut, on retombe sur la carte schématique de la Guyane
        // (locationSvg) gérée par l'appelant.
        const valid=(points||[]).filter(p=>p&&p.ll);
        if(!valid.length)return '<div class="crtNoData">Coordonnées non calculables pour cette station.</div>';
        const tileSize=256,viewportW=900,viewportH=320,pad=70;
        const project=(lat,lon,zoom)=>{
          const n=Math.pow(2,zoom);
          const worldX=(lon+180)/360*n*tileSize;
          const latRad=lat*Math.PI/180;
          const worldY=(1-Math.log(Math.tan(latRad)+1/Math.cos(latRad))/Math.PI)/2*n*tileSize;
          return [worldX,worldY];
        };
        let zoom=15;
        if(valid.length>1){
          for(;zoom>3;zoom--){
            const pts=valid.map(p=>project(p.ll[0],p.ll[1],zoom));
            const xs=pts.map(p=>p[0]),ys=pts.map(p=>p[1]);
            const w=Math.max(...xs)-Math.min(...xs),h=Math.max(...ys)-Math.min(...ys);
            if(w<=viewportW-2*pad&&h<=viewportH-2*pad)break;
          }
        }
        const pts=valid.map(p=>project(p.ll[0],p.ll[1],zoom));
        const cx=(Math.min(...pts.map(p=>p[0]))+Math.max(...pts.map(p=>p[0])))/2;
        const cy=(Math.min(...pts.map(p=>p[1]))+Math.max(...pts.map(p=>p[1])))/2;
        const originX=cx-viewportW/2,originY=cy-viewportH/2;
        const firstTileX=Math.floor(originX/tileSize),firstTileY=Math.floor(originY/tileSize);
        const tilesX=Math.ceil(viewportW/tileSize)+1,tilesY=Math.ceil(viewportH/tileSize)+1;
        let tiles='';
        for(let ty=0;ty<tilesY;ty++){
          for(let tx=0;tx<tilesX;tx++){
            const gx=firstTileX+tx,gy=firstTileY+ty;
            const left=gx*tileSize-originX,top=gy*tileSize-originY;
            tiles+='<img onerror="window.crtMapFail&&window.crtMapFail(this)" src="https://tile.openstreetmap.org/'+zoom+'/'+gx+'/'+gy+'.png" style="position:absolute;left:'+left+'px;top:'+top+'px;width:'+tileSize+'px;height:'+tileSize+'px" alt="">';
          }
        }
        const markers=valid.map((p,i)=>{
          const [wx,wy]=pts[i],mx=wx-originX,my=wy-originY,color=p.color||'#00AC97';
          return '<div style="position:absolute;left:'+(mx-9)+'px;top:'+(my-9)+'px;width:18px;height:18px;border-radius:50%;background:'+color+';border:2.5px solid #fff;box-shadow:0 0 0 1px var(--crt-blue)"></div>'+
            '<div style="position:absolute;left:'+(mx-9)+'px;top:'+(my-9)+'px;width:18px;height:18px;border-radius:50%;border:1.4px solid '+color+';transform:scale(1.9)"></div>'+
            '<div style="position:absolute;left:'+(mx+13)+'px;top:'+(my-8)+'px;background:#fff;border:1px solid '+color+';border-radius:3px;padding:1px 5px;font-size:9px;font-weight:800;color:'+color+';white-space:nowrap">'+E(p.label||'')+'</div>';
        }).join('');
        return '<div style="position:relative;width:100%;height:100%;overflow:hidden">'+
          '<div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:'+viewportW+'px;height:'+viewportH+'px">'+tiles+markers+
          '</div></div>';
      }
      // ---- Échantillonnage, transport et remise (champs propres à l'ESO : esoFroid, esoSuivi,
      // esoRecepteurs… — auparavant le CRT ESO imprimait « — » alors qu'ils étaient remplis) ----
      function receiverRows(list,org,date){
        let rows=(Array.isArray(list)?list:[]).filter(x=>x&&(!blank(x.organisme)||!blank(x.dateHeure)));
        if(!rows.length&&(!blank(org)||!blank(date)))rows=[{organisme:org,dateHeure:date}];
        return rows;
      }
      function filtrationPairs(s,eso){
        const sfx=eso?'eso':'',names={chloro:'Chlorophylle',metaux:'Métaux',autres:'Autre'};
        const items=['chloro','metaux','autres'].filter(k=>s[eso?'filtreParam_eso_'+k:'filtreParam_'+k]).map(k=>{
          const vol=s['filtre_'+sfx+k+'_volume'],mode=s[eso?'filtreMode_eso_'+k:'filtreMode_'+k],other=String(s['filtre_'+sfx+'autres_nom']||'').trim();
          return (k==='autres'&&other?'Autre ('+other+')':names[k])+(num(vol)!==null?' : '+r2(vol)+' mL':'')+(blank(mode)?'':' — '+mode);
        });
        const date=[s['filtreDate'+sfx],s['filtreHeure'+sfx]].filter(x=>!blank(x)).map(fmtDT).join(' ');
        return [['Échantillons filtrés sur site',eso?s.filtresSiteEso:s.filtresSite],(date||items.length)?['Date / heure de filtration',date]:null,items.length?['Paramètre(s) filtré(s)',items.map(esc).join('<br>'),true]:null];
      }
      function conservationPairs(s,eso){
        const sfx=eso?'eso':'',done=s['consOui'+sfx]||(eso?s.consOuiEso:s.consOui);
        const labs=(s['consLabs'+sfx]||[]).filter(l=>l&&((l.params||[]).length||(l.agents||[]).length||!blank(l.conditionnement)||!blank(l.observation)||(l.conservation||[]).length));
        return [['Agents de conservation rajoutés sur site',done],...labs.map(l=>['Laboratoire '+(l.lab||''),esc([(l.params||[]).length?'Paramètres : '+l.params.join(', '):'',(l.agents||[]).length?'Agents : '+l.agents.join(', '):'',blank(l.conditionnement)?'':'Conditionnement : '+l.conditionnement,(l.conservation||[]).length?'Conservation : '+l.conservation.join(', '):'',blank(l.observation)?'':'Observation : '+l.observation].filter(Boolean).join(' · ')||'—'),true])];
      }
      function sampleSection(r,s){
        const eso=r.network==='ESO',el=r.network==='EL';
        let h='<h2>🧴 Échantillonnage et conservation</h2>'+kvTable([
          ['Type d’échantillonnage',s.stype||r.stype],['Mode de prélèvement',s.smode],['Gants nitriles à usage unique',s.gants],
          el?['Moyen d’échantillonnage',s.elMoyenEchSample]:null,el?['Conservation de l’échantillon',s.elConservationSample]:null,
          ...(el?[]:filtrationPairs(s,eso)),...(el?[]:conservationPairs(s,eso))
        ]);
        const rec=eso?receiverRows(s.esoRecepteurs,s.esoRecepteur,s.esoRemise):receiverRows(s.recepteurs,s.recepteur,s.remise);
        h+='<h3>Transport et remise au laboratoire</h3>'+kvTable([['Moyen de refroidissement',eso?s.esoFroid:s.transportFroid],['Suivi de la température',eso?s.esoSuivi:s.transportSuivi]])+
          (rec.length?'<table class="crtTable"><thead><tr><th>Organisme récepteur</th><th>Date / heure de remise</th></tr></thead><tbody>'+rec.map(x=>'<tr><td>'+cell(x.organisme)+'</td><td>'+cell(x.dateHeure)+'</td></tr>').join('')+'</tbody></table>':'<p class="crtSmall">Organisme récepteur : non renseigné.</p>');
        return h;
      }
      function esoSection(s){
        const span=(a,b)=>[a,b].filter(x=>!blank(x)).join(' – ');
        return '<h2>🕳️ Ouvrage, purge et prélèvement (ESO)</h2>'+kvTable([
          ['Nature du point',s.esoNature],['Lieu précis du prélèvement',s.esoLieu],['Point de référence choisi',s.esoRef],['Pompe à demeure',s.pompeDemeure],
          ['Niveau piézométrique (m)',s.esoNiveau],['Horaires de purge',span(s.purgeStart,s.purgeEnd)],['Débit de purge (m³/h)',s.purgeDebit],['Durée de purge (min)',s.purgeDuree],
          ['Niveau dynamique final (m)',s.purgeNivFinal],['Méthode de purge',s.purgeMethode],['Profondeur d’échantillonnage (m)',s.esoEchProf],['Débit de pompage (m³/h)',s.esoEchDebit],
          ['Horaires de prélèvement',span(s.esoEchStart,s.esoEchEnd)],['Méthode d’échantillonnage',s.esoEchMethode]
        ]);
      }
      function traceSection(r){
        const t=r.sampleTrace||{};
        return '<h2>🔗 Traçabilité de l’échantillon / chaîne de possession</h2>'+kvTable([
          ['ID échantillon / code flacon',t.sampleId],['Référence flaconnage / lot',t.bottleLot],['Température au départ (°C)',t.tempDeparture],['Température à réception (°C)',t.tempReception],
          ['Transporteur / agent de remise',t.transportAgent],['Date / heure de remise',t.custodyDate],['Observations chaîne de possession',t.custodyObs]
        ]);
      }
      function qualitySection(r){
        const q=r.quality||{};
        return '<h2>🔎 Contrôle qualité</h2>'+kvTable([
          ['Contrôle qualité effectué',r.qc],['Type de contrôle',r.qcType],['Blanc de terrain réalisé',q.qcBlank],['Duplicata / répétition réalisé',q.qcDuplicate],
          ['Contrôle matériel effectué',q.qcMaterial],['Source(s) d’incertitude / facteur influent',q.uncertaintySource],['Zone de prélèvement représentative',q.representative],['Justification / action si non représentative',q.representativeJustification],
          ['Procédure / méthode de référence',r.methodRef],['Version de la méthode',r.methodVersion]
        ]);
      }
      // Observations et commentaires : deux champs distincts du formulaire, imprimés tous les deux
      // (auparavant « commentaire OU observations » : les observations disparaissaient du CRT).
      function obsSection(r){
        const obs=String(r.obs||'').trim(),com=String(r.comment||'').trim();
        if(!obs&&!com)return '<h2>📝 Observations</h2><div class="crtComment">RAS</div>';
        return '<h2>📝 Observations</h2>'+(obs?'<h3>Observations concernant le prélèvement</h3><div class="crtComment">'+esc(obs)+'</div>':'')+(com?'<h3>Commentaires / difficultés / mesures non réalisées</h3><div class="crtComment">'+esc(com)+'</div>':'');
      }
      // Individus de pêche (champs f_<espèce>_<n>_t / _p) : tableau espèce / taille / poids
      function fishTable(sp){
        const rows={};
        Object.entries(sp||{}).forEach(([k,v])=>{const m=k.match(/^f_(.+)_(\d+)_([tp])$/);if(!m||blank(v))return;const n=m[1].replace(/_/g,' ');rows[n]=rows[n]||{};rows[n][m[2]]=rows[n][m[2]]||{};rows[n][m[2]][m[3]]=String(v).trim()});
        const names=Object.keys(rows);if(!names.length)return '';
        return '<h3>Individus mesurés (taille / poids)</h3><table class="crtTable"><thead><tr><th>Espèce</th><th>Individu</th><th>Taille (mm)</th><th>Poids (g)</th></tr></thead><tbody>'+names.map(n=>Object.keys(rows[n]).sort((a,b)=>a-b).map(i=>'<tr><td>'+esc(n)+'</td><td>'+esc(i)+'</td><td>'+cell(rows[n][i].t)+'</td><td>'+cell(rows[n][i].p)+'</td></tr>').join('')).join('')+'</tbody></table>';
      }
      // Matériel de mesure : code GMAO, désignation et statut métrologique À LA DATE DE LA VISITE
      // (et non à la date d'impression du rapport).
      function eqStatusAt(e,date){
        if(!e)return 'Non référencé dans le parc';
        if(e.statut==='Hors service')return 'Hors service';
        const d=String(date||'').slice(0,10);
        if(!e.echeance)return 'Échéance non renseignée';
        return d&&e.echeance<d?'Étalonnage expiré à la date de la visite':'Étalonnage valide à la date de la visite';
      }
      function equipmentSection(r){
        const ins=r.insitu||{},uses=new Map();
        const add=(code,what,st)=>{code=String(code||'').trim();if(!code)return;const u=uses.get(code)||{what:[],st:{}};if(!u.what.includes(what))u.what.push(what);Object.entries(st||{}).forEach(([k,v])=>{if(!blank(v)&&blank(u.st[k]))u.st[k]=v});uses.set(code,u)};
        add(r.insituBoitier,'Boîtier multiparamètre');
        if(r.network==='EL'){
          const lab={temp:'Température',ph:'pH',sal:'Salinité',condus:'Conductivité (µS/cm)',condms:'Conductivité (mS/cm)',o2mg:'O₂ dissous',o2pc:'Saturation O₂'};
          Object.entries(ins.params||{}).forEach(([k,d])=>add(d?.sonde,lab[k]||k));
          const t=ins.turbidite||{};add(t.surf?.sonde||t.inter?.sonde||t.fond?.sonde,'Turbidité');
        }else{
          const lab={ph:'pH',temp:'Température de l’eau',cond:'Conductivité',sal:'Salinité',o2mg:'O₂ dissous',o2pc:'Saturation O₂',turb:'Turbidité',air:'Température de l’air',redox:'Potentiel redox'};
          Object.entries(ins).forEach(([k,d])=>{if(d&&typeof d==='object'&&lab[k])add(d.gmao,lab[k]+(blank(d.controle)?'':' (contrôle : '+d.controle+')'),{nom:d.nom,serie:d.serie,etalonnage:d.etalonnage})});
        }
        if(!uses.size)return '<h2>🧰 Matériel de mesure</h2><p class="crtSmall">Aucun appareil (code GMAO) renseigné sur la fiche.</p>';
        return '<h2>🧰 Matériel de mesure</h2><table class="crtTable"><thead><tr><th>Code GMAO</th><th>Désignation</th><th>N° série</th><th>Utilisé pour</th><th>Étalonnage</th><th>Échéance</th><th>Statut métrologique</th></tr></thead><tbody>'+[...uses].map(([code,u])=>{
          const e=typeof equipmentByGmao==='function'?equipmentByGmao(code):null;
          return '<tr><td>'+esc(code)+'</td><td>'+cell(e?.nom||u.st.nom)+'</td><td>'+cell(e?.serie||u.st.serie)+'</td><td>'+esc(u.what.join(', '))+'</td><td>'+cell(u.st.etalonnage||e?.calDate)+'</td><td>'+cell(e?.echeance)+'</td><td>'+esc(eqStatusAt(e,r.date))+'</td></tr>';
        }).join('')+'</tbody></table>';
      }
      function ncSection(r){
        const list=(custom.nonConformites||[]).filter(n=>String(n.recordId)===String(r.id));
        if(!list.length)return '<h2>⚠️ Non-conformités</h2><p class="crtSmall">Aucune non-conformité enregistrée pour cette fiche.</p>';
        const open=list.filter(n=>n.status!=='Clôturée').length;
        return '<h2>⚠️ Non-conformités</h2>'+(open?'<p class="crtSmall"><b>'+open+' non-conformité(s) non clôturée(s) à la date du rapport.</b></p>':'')+'<table class="crtTable"><thead><tr><th>Gravité</th><th>Statut</th><th>Catégorie / description</th><th>Action immédiate</th><th>Action corrective</th><th>Échéance</th></tr></thead><tbody>'+list.map(n=>'<tr><td>'+cell(n.severity)+'</td><td>'+cell(n.status)+'</td><td>'+(blank(n.category)?'':'<b>'+esc(n.category)+'</b><br>')+cell(n.description)+'</td><td>'+cell(n.immediate)+'</td><td>'+cell(n.corrective)+'</td><td>'+cell(n.dueDate)+'</td></tr>').join('')+'</tbody></table>';
      }
      function buildFicheHtml(r){
        // Station : celle de même code que la station enregistrée dans la fiche (deux réseaux peuvent
        // avoir une station du même nom). Les ESO n'ont pas de code SANDRE mais un code BSS, et une
        // commune à la place du bassin versant (auparavant « Non défini » / « non renseigné »).
        const si=r.stationInfo||{},sc=x=>x?.code||x?.code_bss||'',cands=stations().filter(s=>s.nom===r.station);
        const station=cands.find(s=>sc(s)&&sc(s)===sc(si))||cands[0]||si,eso=r.network==='ESO';
        const access=ensureStationAccess(station),modes=stationTransportDetailed(station),m=meta(station),ll=stationLatLon(station),proj=r.projection||station.projection||'RGFG 95 / UTM 22N',code=r.codeSandre||r.code||sc(station)||sc(si)||'Non défini',codeLabel=eso?'Code BSS':'Code SANDRE',bassin=m.b||station.commune||si.bassin||si.commune||'',bassinLabel=eso?'Commune':'Bassin versant',desc=station.description||station.descriptionStation||station.pressionDescription||station.pression||'',ins=r.insitu||{},cm=metaFor(r),operators=cm.preleveur||((r.preleveurs||[]).join(' · ')||'—'),season=seasonFor(r);
        const llTerrain=(r.xTerrain!==undefined&&r.xTerrain!==''&&r.yTerrain!==undefined&&r.yTerrain!=='')?stationLatLon({x:r.xTerrain,y:r.yTerrain,projection:proj}):null;
        const mapPoints=[{ll,label:'Théorique',color:'#003D7A'},{ll:llTerrain,label:'Terrain',color:'#00AC97'}].filter(p=>p.ll);
        const mapLinkParts=[];
        if(ll)mapLinkParts.push('Théorique : '+esc(ll[0].toFixed(6))+' ; '+esc(ll[1].toFixed(6)));
        if(llTerrain)mapLinkParts.push('Terrain : '+esc(llTerrain[0].toFixed(6))+' ; '+esc(llTerrain[1].toFixed(6))+(r.ecartM?' (écart '+esc(r.ecartM)+')':''));
        const mapLink=mapLinkParts.join(' · ');
        const title=cm.objet||'Mise en œuvre de la DCE en Guyane — Rapport de terrain';
        const graphBlock=r.network==='EL'?'<div class="crtGraphLegend"><b>Profil vertical in situ.</b> Chaque courbe relie les valeurs mesurées aux niveaux réellement saisis sur la fiche terrain. La turbidité affichée correspond uniquement à la moyenne des trois répétitions.</div><div class="crtGraphGrid">'+elCards(ins)+'</div>'+elDataTable(ins):'<div class="crtGraphLegend"><b>Mesures in situ.</b> Présentation harmonisée des valeurs enregistrées sur la fiche terrain, avec conservation des unités et des informations appareil.</div>'+genericMetrics(ins)+genericDataTable(ins);
        const elMaritime=r.network==='EL'?'<br><br><b>Conditions maritimes</b><br>État de la mer : '+esc(r.conditions?.elMer||'—')+'<br>Marée : '+esc(r.conditions?.elMaree||'—')+(r.conditions?.elCoefMaree?' (coefficient '+esc(r.conditions.elCoefMaree)+')':''):'';
        const sample=r.sample||{};
        const chloroBlock=(r.network==='EL'&&station.type==='MEC')?'<h2>Chlorophylle</h2><table class="crtTable"><tr><th>Prélèvement chlorophylle</th><td>'+esc(sample.elChloro||'—')+'</td><th>Filtre utilisé</th><td>'+esc(sample.elFiltreChloro||'—')+'</td></tr><tr><th>Volume filtré</th><td colspan="3">'+(sample.elVfChloro?esc(sample.elVfChloro)+' mL':'—')+'</td></tr></table>':'';
        return '<section class="crtPage crtCover" data-report="'+esc(code)+' — '+esc(r.station)+'"><img src="img/logo-oeg.png" alt="Office de l\'Eau de Guyane" class="crtCoverLogo"><div class="crtKicker">OFFICE DE L’EAU DE GUYANE</div><h1>COMPTE RENDU TECHNIQUE</h1><h2>'+esc(title)+'</h2><div class="crtSession">'+esc(r.session||'Session non renseignée')+'</div><div class="crtCoverStation"><b>'+esc(code)+' — '+esc(r.station)+'</b><br><span>'+esc(bassin||(bassinLabel+' non renseigné'+(eso?'e':'')))+'</span></div><div class="crtCoverMeta"><div><b>Organisme</b>'+esc(r.organisme||'—')+'</div><div><b>Préleveur(s)</b>'+esc(operators)+'</div><div><b>Date de la visite</b>'+esc(frDate(r.date))+'</div><div><b>Référence CRT</b>'+esc(cm.ref||'—')+'</div><div><b>Date du rapport</b>'+esc(reportDate(r))+'</div><div><b>Rédacteur</b>'+esc(cm.author||'—')+'</div></div><div class="crtSynthesis">'+synthesis(r,ins,sample)+'</div>'+(r.lifecycle?.status==='Validée'?'':'<div class="crtDraftBand">DOCUMENT PROVISOIRE — fiche terrain non validée ('+esc(r.lifecycle?.status||'À contrôler')+')</div>')+'</section>'+
          '<section class="crtPage" data-report="'+esc(code)+' — '+esc(r.station)+'">'+header(code,r,'SOMMAIRE')+'<h2>📖 Sommaire du rapport</h2>'+sommaire(r)+'</section>'+
          '<section class="crtPage" data-report="'+esc(code)+' — '+esc(r.station)+'">'+header(code,r,'STATION · LOCALISATION')+'<h2>🆔 Identification de la station</h2>'+kvTable([[codeLabel,code],['Réseau',netLabel(r.network)||r.network],[bassinLabel,bassin],['Marché',m.m],['Date',frDate(r.date)],['Horaires',(r.heureDebut||'—')+' – '+(r.heureFin||'—')],eso?['Type de point',station.type_point||si.type_point]:null,eso?['Aquifère',station.aquifere||si.aquifere]:null])+'<h2>🚗 Description / accès</h2><p class="crtSmall">'+esc(desc||'Description à compléter dans les données station.')+'</p><div class="accessGrid"><div><b>Accessibilité</b><br>'+starRating(access.difficulte||station.difficulte)+'</div><div><b>Moyens</b><br>'+(modes.length?modes.map(x=>transportIcon(x)+' '+esc(x)).join(' · '):'—')+'</div><div><b>Départ / base</b><br>'+esc(access.pointDepart||'—')+'</div><div><b>Consignes</b><br>'+esc(access.etapes||'—')+'</div></div><h2>🗺️ Localisation</h2><div class="crtMapPlaceholder">'+(navigator.onLine?locationMap(mapPoints):'')+'<div class="crtMapFallback"'+(navigator.onLine?' hidden':'')+'>'+locationSvg(ll||llTerrain)+'</div></div><p class="crtSmall">'+(mapLink||'Coordonnées non disponibles')+(mapPoints.length?' · © contributeurs OpenStreetMap':'')+'</p>'+(mapPoints.length>1?'<p class="crtSmall"><span style="color:#003D7A;font-weight:800">● Théorique</span> = position de référence de la station · <span style="color:#00AC97;font-weight:800">● Terrain</span> = position GPS relevée sur place'+(r.ecartM?' (écart mesuré : '+esc(r.ecartM)+')':'')+'</p>':'')+'<h2>📷 Photographies</h2>'+photoHtml(r)+(r.network==='EL'?'':'<h2>✏️ Schéma de station</h2><div class="crtSchema">'+(r.dessin?'<img src="'+esc(r.dessin)+'" alt="Schéma du lieu d’échantillonnage">':'<span class="crtSmall">Aucun schéma enregistré.</span>')+'</div>')+'</section>'+
          '<section class="crtPage" data-report="'+esc(code)+' — '+esc(r.station)+'">'+header(code,r,'MESURES · ÉCHANTILLONNAGE')+'<h2>🌦️ Conditions de terrain</h2><div class="crtTwoCol"><div>'+fmtConditions(r.conditions,r.network)+'</div><div><b>Saison</b><br>'+esc(season)+'<br><br><b>Matrice(s)</b><br>'+esc(matrix(r))+elMaritime+'</div></div><h2>📊 Visualisation des données in situ</h2>'+graphBlock+historyBlock(r,ins)+equipmentSection(r)+(eso?esoSection(sample):'')+sampleSection(r,sample)+chloroBlock+traceSection(r)+'</section>'+
          '<section class="crtPage" data-report="'+esc(code)+' — '+esc(r.station)+'">'+header(code,r,'OBSERVATIONS · VALIDATION')+qualitySection(r)+obsSection(r)+'<h2>➕ Données complémentaires</h2><div>'+fmt(r.specific||{})+'</div>'+fishTable(r.specific)+(r.network==='Chimie'?sedimentSection(sample,'chimie'):r.network==='RCO'?sedimentSection(sample,'rco'):'')+ncSection(r)+'<h2>✅ Conclusion / synthèse</h2><div class="crtComment">'+(cm.conclusion?esc(cm.conclusion):synthesis(r,ins,sample))+'</div><h2>🖊️ Validation</h2><table class="crtTable"><tr><th>Rédacteur</th><td>'+esc(cm.author||'—')+'</td><th>Statut</th><td>'+esc(r.lifecycle?.status||'—')+'</td></tr><tr><th>Signataire de la fiche terrain</th><td>'+esc(r.signName||'—')+'</td><th>Signature</th><td>'+(r.signature?'<img class="crtSignature" src="'+esc(r.signature)+'" alt="Signature">':'<span class="crtSmall">Non signée</span>')+'</td></tr>'+((r.lifecycle?.validatedBy||r.lifecycle?.validatedAt)?'<tr><th>'+(r.lifecycle?.status==='Rejetée'?'Rejetée par':r.lifecycle?.status==='Validée'?'Validée par':'Validation antérieure (fiche modifiée depuis) par')+'</th><td>'+esc(r.lifecycle?.validatedBy||'—')+'</td><th>Le</th><td>'+esc(frDate(r.lifecycle?.validatedAt))+'</td></tr>'+(r.lifecycle?.validationComment?'<tr><th>Commentaire de validation</th><td colspan="3">'+esc(r.lifecycle.validationComment)+'</td></tr>':''):'')+'<tr><th>Organisme</th><td>'+esc(r.organisme||'—')+'</td><th>Référence</th><td>'+esc(cm.ref||'—')+'</td></tr><tr><th>Date du rapport</th><td colspan="3">'+esc(reportDate(r))+'</td></tr><tr><th>Identifiant fiche</th><td colspan="3" class="crtTraceId">'+esc(r.id||'—')+'</td></tr><tr><th>Version applicative</th><td colspan="3">'+esc(r.appBuild||'non enregistrée (fiche antérieure à ce suivi)')+'</td></tr></table><p class="crtSmall">Cet identifiant permet de retrouver la fiche source dans l’application (onglet « Liste des fiches »).</p><div class="crtLegendBlock"><b>Référentiel graphique</b><br><span class="crtSmall">Les valeurs, niveaux, unités et codes appareils affichés dans ce CRT proviennent de la fiche terrain enregistrée. Aucune donnée n’est recalculée hormis la moyenne des trois mesures de turbidité lorsque celle-ci est disponible ; les valeurs numériques sont arrondies à deux décimales. Les codes SANDRE sont accompagnés de leur libellé.</span></div></section>';
      }
      // Tuile de fond de carte indisponible (hors connexion, réseau coupé) : on remplace la carte par
      // la carte schématique de la Guyane plutôt que d'imprimer un cadre vide.
      window.crtMapFail=img=>{const box=img.closest('.crtMapPlaceholder');if(!box||box.dataset.failed)return;box.dataset.failed='1';
        [...box.children].forEach(ch=>{if(!ch.classList.contains('crtMapFallback'))ch.remove()});const fb=box.querySelector('.crtMapFallback');if(fb)fb.hidden=false};
      // N'ouvre l'impression qu'une fois les images (photos, schéma, logo, carte) chargées — sinon
      // elles pouvaient sortir blanches dans le PDF — avec un délai maximal de 8 s.
      function printWhenReady(title){
        const box=$('crtPreviewBox');
        const imgs=[...box.querySelectorAll('img')].filter(i=>!i.complete);
        const ready=Promise.all(imgs.map(i=>new Promise(res=>{i.addEventListener('load',res,{once:true});i.addEventListener('error',res,{once:true})})));
        if(imgs.length)toast('Préparation de l’impression…');
        Promise.race([ready,new Promise(res=>setTimeout(res,8000))]).then(()=>{
          // Fond de carte encore incomplet après 8 s (réseau lent) : carte schématique plutôt qu'une carte trouée
          box.querySelectorAll('.crtMapPlaceholder:not([data-failed]) img').forEach(i=>{if(!i.complete||!i.naturalWidth)window.crtMapFail(i)});
          const oldTitle=document.title;document.title=title;
          window.print();
          setTimeout(()=>document.title=oldTitle,1500);
        });
      }
      function render(){
        const r=getR(),box=$('crtPreviewBox');if(!r){box.innerHTML='<div class="hint">Sélectionnez une fiche puis cliquez sur « Aperçu du CRT ».</div>';return}
        box.innerHTML='<div class="crtReport">'+buildFicheHtml(r)+'</div>';
      }
      // ---- CRT consolidé : compile en un seul fichier tous les CRT d'un même réseau/session ----
      function batchMatches(){
        const net=val('crtBatchNetwork'),ses=val('crtBatchSession');
        if(!net||!ses)return [];
        return records.filter(x=>x.network===net&&x.session===ses).slice().sort((a,b)=>String(a.station||'').localeCompare(String(b.station||''),'fr')||String(a.date||'').localeCompare(String(b.date||'')));
      }
      function refreshBatchNetworks(){
        const sel=$('crtBatchNetwork');if(!sel)return;const cur=sel.value;
        const nets=[...new Set(records.map(x=>x.network).filter(Boolean))].sort();
        sel.innerHTML='<option value="">— sélectionner un réseau —</option>'+nets.map(n=>'<option value="'+esc(n)+'">'+esc(n)+'</option>').join('');
        if(nets.includes(cur))sel.value=cur;
      }
      function refreshBatchSessions(){
        const sel=$('crtBatchSession');if(!sel)return;const cur=sel.value,net=val('crtBatchNetwork');
        const sessions=[...new Set(records.filter(x=>x.network===net).map(x=>x.session).filter(Boolean))].sort();
        sel.innerHTML='<option value="">— sélectionner une session —</option>'+sessions.map(s=>'<option value="'+esc(s)+'">'+esc(s)+'</option>').join('');
        if(sessions.includes(cur))sel.value=cur;
        updateBatchCount();
      }
      function updateBatchCount(){
        const c=$('crtBatchCount');if(!c)return;
        const net=val('crtBatchNetwork'),ses=val('crtBatchSession');
        if(!net||!ses){c.textContent='';return}
        const n=batchMatches().length;
        c.textContent=n?n+' fiche(s) trouvée(s) pour '+net+' · '+ses+'.':'Aucune fiche trouvée pour '+net+' · '+ses+'.';
      }
      refreshBatchNetworks();refreshBatchSessions();
      $('crtBatchNetwork').onchange=()=>{refreshBatchSessions()};
      $('crtBatchSession').onchange=updateBatchCount;
      $('crtBatchGenerate').onclick=()=>{
        try{
          const matches=batchMatches();
          if(!matches.length)return toast('Aucune fiche à compiler pour ce réseau/cette session.');
          const box=$('crtPreviewBox');
          box.innerHTML='<div class="crtReport">'+matches.map(buildFicheHtml).join('')+'</div>';
          printWhenReady('CRT_consolide_'+val('crtBatchNetwork')+'_'+val('crtBatchSession'));
        }catch(e){console.error(e);toast('Erreur CRT consolidé : '+e.message)}
      };
      $('crtPreview').onclick=render;
      $('crtGenerate').onclick=()=>{try{if(!getR())return toast('Sélectionnez une fiche');render();const r=getR(),box=$('crtPreviewBox');if(!box?.querySelector('.crtReport'))return toast('Aperçu CRT impossible : vérifiez la fiche sélectionnée.');printWhenReady('CRT_'+(r.station||'station')+'_'+(val('crtRef')||r.date||'rapport'))}catch(e){console.error(e);toast('Erreur CRT : '+e.message)}};
      setTimeout(()=>{refreshCrtPre();loadMetaIntoForm()},0);
    })();
  }
  document.querySelectorAll('.tab[data-tab="stations"]').forEach(b=>b.addEventListener('click',()=>setTimeout(()=>window.mapStations&&window.mapStations(),120)));
  document.querySelectorAll('.tab[data-tab="data"]').forEach(b=>b.addEventListener('click',()=>setTimeout(renderAccessEditor,80)));
  document.querySelectorAll('.tab[data-tab="crt"]').forEach(b=>b.addEventListener('click',()=>setTimeout(setupCRT,80)));
  setTimeout(()=>{if(window.L){try{mapStations()}catch(e){}}renderAccessEditor();setupCRT()},400);
  window.setupCRT=setupCRT;
})();