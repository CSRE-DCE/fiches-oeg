/* Suivi (onglet Suivi) — vues au choix au-dessus des graphes :
 *  EL : 1. Évolution par session : un graphe par paramètre, surface / intermédiaire / fond superposés ;
 *       2. Profil de profondeur : la profondeur (m) en ordonnée, une courbe par session ;
 *       3. Profil longitudinal de l'estuaire : les stations de l'estuaire de l'amont vers la mer
 *          (classées du sud vers le nord, les fleuves coulant vers l'océan), une courbe par session,
 *          à la profondeur choisie.
 *  RCO, Chimie, BIO : évolution par session (graphes d'app-core.js) ou profil longitudinal du bassin
 *       versant (stations mesurées classées de l'amont vers l'aval, une courbe par session).
 *  ESO : pas de profil (forages et piézomètres : ni amont ni aval).
 * Chaque profondeur a sa couleur et sa forme de point ; les sessions ont leur propre palette, qui
 * ne commence pas par les couleurs des profondeurs (pas de confusion d'un graphe à l'autre).
 * Palettes vérifiées pour les daltoniens (écart de couleur suffisant entre courbes voisines) ;
 * chaque graphe a aussi sa légende, son info-bulle et son tableau de valeurs.
 * EL_DEPTHS et depthMarkerSvg servent aussi au CRT (crt-access.js). */
const EL_DEPTHS=[
  {key:'surf',field:'surface',label:'Surface',short:'Surf.',color:'#eb6834',shape:'circle'},
  {key:'inter',field:'intermediaire',label:'Intermédiaire',short:'Interm.',color:'#1baf7a',shape:'square'},
  {key:'fond',field:'fond',label:'Fond',short:'Fond',color:'#2a78d6',shape:'triangle'}
];
const EL_SUIVI_DEFS=[['temp','Température de l’eau','°C'],['ph','pH','u.pH'],['sal','Salinité',''],['cond','Conductivité','µS/cm'],['condms','Conductivité','mS/cm'],['o2mg','Oxygène dissous','mg O₂/L'],['o2pc','Saturation O₂','%'],['turb','Turbidité','NTU']];
// Couleur d'une session = sa place dans le calendrier EL (S1 violet, S2 rouge, S3 jaune…), quelle que
// soit la vue ou les sessions présentes : une session garde toujours la même couleur.
const EL_SESSION_COLORS=['#6250d6','#e34948','#eda100','#008300','#e87ba4','#2a78d6','#eb6834','#1baf7a'];
const EL_MAX_SESSIONS=8;
// Vue choisie, bassin (estuaire pour l'EL) affiché et station qui l'a fixé, par réseau ; profondeur du profil EL
const suiviView={},suiviBasin={},suiviBasinAnchor={};let elEstuaryDepth='surf';

// ---------- Outils communs ----------
// Point de légende / de tableau (forme + couleur de la profondeur), en SVG
function depthMarkerSvg(d,size){
  const z=size||11,h=z/2,ring='stroke="#fff" stroke-width="1.5"';
  const m=d.shape==='square'?'<rect x="1.5" y="1.5" width="'+(z-3)+'" height="'+(z-3)+'" fill="'+d.color+'" '+ring+'/>':d.shape==='triangle'?'<path d="M'+h+' 1 L'+(z-1)+' '+(z-1.5)+' L1 '+(z-1.5)+' Z" fill="'+d.color+'" '+ring+'/>':'<circle cx="'+h+'" cy="'+h+'" r="'+(h-1)+'" fill="'+d.color+'" '+ring+'/>';
  return '<svg class="depthMarker" width="'+z+'" height="'+z+'" viewBox="0 0 '+z+' '+z+'" aria-hidden="true">'+m+'</svg>';
}
// Pastille de légende d'une session (trait + point de sa couleur ; pointillé si couleur partagée)
function sessionKeySvg(si){
  return '<svg class="depthMarker" width="20" height="10" viewBox="0 0 20 10" aria-hidden="true"><line x1="1" y1="5" x2="19" y2="5" stroke="'+si.color+'" stroke-width="2.4"'+(si.dash?' stroke-dasharray="4 3"':'')+'/><circle cx="10" cy="5" r="3.4" fill="'+si.color+'" stroke="#fff" stroke-width="1.2"/></svg>';
}
function elMean(a){return a.length?a.reduce((x,y)=>x+y,0)/a.length:null}
function elFmt(v){return v==null?'—':Number(v).toFixed(2)}
const EL_NO_SESSION='#6e7b82';
const SUIVI_MOIS=['janvier','fevrier','mars','avril','mai','juin','juillet','aout','septembre','octobre','novembre','decembre'];
// Mois d'un mot, en entier ou abrégé (« Septembre », « Sept. », « Déc. ») ; 0 si ce n'est pas un mois ou si
// l'abréviation est ambiguë (« Jui »)
function suiviMonthOf(word){
  const w=String(word).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();if(w.length<3)return 0;
  const hits=SUIVI_MOIS.map((m,i)=>m.startsWith(w)?i+1:0).filter(Boolean);return hits.length===1?hits[0]:0;
}
// Ordre chronologique d'une session : mois et année lus dans le libellé (« Septembre 2026 » -> 2026-09,
// « Sept.26 » -> 2026-09), date pour une visite sans session, année seule à défaut (« Campagne biologique
// 2026 ») ; l'ordre du calendrier du réseau départage. Auparavant une session d'une autre campagne (2025,
// ou la campagne suivante) était classée après toutes celles en cours.
function elChronoKey(k,net){
  const s=String(k||'');let ym='';
  for(const m of s.matchAll(/([A-Za-zÀ-ÿ]{3,})\.?\s*(\d{4}|\d{2})(?!\d)/g)){const mo=suiviMonthOf(m[1]);if(mo){ym=(m[2].length===2?'20'+m[2]:m[2])+'-'+String(mo).padStart(2,'0');break}}
  if(!ym){const d=/^\d{4}-\d{2}(-\d{2})?/.exec(s),y=/(?:^|\D)(\d{4})(?!\d)/.exec(s);ym=d?d[0]:y?y[1]+'-00':'~'}
  return ym+'|'+suiviSortKey(s,net||'EL');
}
function elSessionCmp(a,b){return elChronoKey(a).localeCompare(elChronoKey(b),'fr')}
// Sessions du calendrier d'un réseau (EL : DATA.EL_SESSIONS ; autres réseaux : SUIVI_SESSION_ORDER)
function suiviSessionList(net){return net==='EL'?(DATA.EL_SESSIONS||[]).map(x=>x.label):(SUIVI_SESSION_ORDER[net]||[])}
function elSessionInfo(label,net){
  const list=suiviSessionList(net||'EL'),i=list.indexOf(label),t=String(label||'');
  const code=(/^(S\d+)\s*-/.exec(t)||[])[1]||'',d=/^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  const slot=i>=0?i:(code?Number(code.slice(1))-1:-1);
  // Nom affiché : « S1 · Septembre 2026 » (libellé sans le code ni la saison), « Visite du 10/09/26 » pour une
  // fiche sans session ; code court sur les graphes : « S1 », date, ou « Camp. 2026 » pour un libellé long
  const mois=t.replace(/^S\d+\s*-\s*/,'').replace(/\s*\(.*\)\s*$/,'').trim();
  const year=(/(\d{4})(?!.*\d{4})/.exec(t)||[])[1];
  const short=code||(d?d[3]+'/'+d[2]+'/'+d[1].slice(2):t.length<=12?t:year?t.split(/\s+/)[0].slice(0,4)+'. '+year:t.slice(0,10)+'…');
  return {label,code:short,name:code?(code+(mois?' · '+mois:'')):(d?'Visite du '+d[3]+'/'+d[2]+'/'+d[1].slice(2)+' (sans session)':t),color:slot>=0?EL_SESSION_COLORS[slot%EL_SESSION_COLORS.length]:EL_NO_SESSION,dash:false};
}
// Sessions dans l'ordre chronologique ; au-delà de 8, seules les plus récentes sont tracées (signalé)
function elOrderSessions(keys,net){
  const sorted=[...new Set(keys)].sort((a,b)=>elChronoKey(a,net).localeCompare(elChronoKey(b,net),'fr'));
  const shown=sorted.slice(-EL_MAX_SESSIONS),infos=shown.map(k=>elSessionInfo(k,net)),seen=new Set();
  // Visites sans session (clé = date) : couleurs de la palette non prises par les sessions affichées
  // (auparavant toutes grises et en pointillé)
  const used=new Set(infos.filter(x=>x.color!==EL_NO_SESSION).map(x=>x.color)),free=EL_SESSION_COLORS.filter(c=>!used.has(c));let k=0;
  infos.forEach(x=>{if(x.color===EL_NO_SESSION&&free.length)x.color=free[k++%free.length]});
  // Même couleur pour deux sessions affichées (même code, années différentes) : la plus ancienne en pointillé
  for(let i=infos.length-1;i>=0;i--){if(seen.has(infos[i].color))infos[i].dash=true;seen.add(infos[i].color)}
  return {infos,dropped:sorted.length-shown.length};
}
// Étiquettes de l'axe des sessions : « S1 » (avec l'année si le même code revient), jj/mm/aa pour
// une visite sans session
function elPeriodTicks(P){
  const codes=P.map(p=>(/^(S\d+)\s*-/.exec(p)||[])[1]||''),dup=c=>c&&codes.filter(x=>x===c).length>1;
  return P.map((p,i)=>{const d=/^(\d{4})-(\d{2})-(\d{2})/.exec(p);if(codes[i])return codes[i]+(dup(codes[i])?' ’'+((/(\d{4})/.exec(p)||['',''])[1].slice(2)):'');return d?d[3]+'/'+d[2]+'/'+d[1].slice(2):(p.length>11?p.slice(0,10)+'…':p)});
}
function elWrap(c,text,maxW,maxLines){
  const words=String(text).split(/\s+/),lines=[];let cur='';
  words.forEach(w=>{const t=cur?cur+' '+w:w;if(c.measureText(t).width<=maxW||!cur)cur=t;else{lines.push(cur);cur=w}});
  if(cur)lines.push(cur);
  if(lines.length>maxLines){lines.length=maxLines;lines[maxLines-1]=lines[maxLines-1].replace(/.?$/,'…')}
  return lines.map(l=>{while(l.length>1&&c.measureText(l).width>maxW)l=l.slice(0,-2)+'…';return l});
}
function elPrepCanvas(canvas,h){
  const rect=canvas.getBoundingClientRect(),dpr=window.devicePixelRatio||1,w=Math.max(280,rect.width||420);
  canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);canvas.style.height=h+'px';
  const c=canvas.getContext('2d');c.setTransform(dpr,0,0,dpr,0,0);c.clearRect(0,0,w,h);return {c,w,h};
}
// Étendue de l'axe avec une marge ; jamais sous 0 pour des valeurs positives (salinité, turbidité…)
function elRange(vals){const lo=Math.min(...vals);let min=lo,max=Math.max(...vals);if(min===max){min-=1;max+=1}else{const e=(max-min)*0.15;min-=e;max+=e}if(lo>=0&&min<0)min=0;return [min,max]}
// Marge gauche assez large pour la graduation la plus longue (ex. 53088.33 µS/cm, auparavant rognée)
function elAxisPad(c,min,max,base){c.font='9px Arial';let m=0;for(let i=0;i<4;i++)m=Math.max(m,c.measureText(Number((min+i*(max-min)/3).toFixed(2)).toString()).width);return Math.max(base,Math.ceil(m)+8)}
// Marqueur sur le canevas (forme + couleur, liseré blanc pour les points superposés)
function drawDepthMarker(c,shape,x,y,color){
  c.beginPath();
  if(shape==='square')c.rect(x-4,y-4,8,8);
  else if(shape==='triangle'){c.moveTo(x,y-5.2);c.lineTo(x+5,y+3.6);c.lineTo(x-5,y+3.6);c.closePath()}
  else c.arc(x,y,4.4,0,Math.PI*2);
  c.fillStyle=color;c.fill();c.lineWidth=2;c.strokeStyle='#fff';c.stroke();
}
// Étiquettes directes écartées verticalement quand elles se chevauchent
function elSpread(labels,gap,minY,maxY){
  labels.sort((a,b)=>a.y-b.y);for(let k=1;k<labels.length;k++)if(labels[k].y-labels[k-1].y<gap)labels[k].y=labels[k-1].y+gap;
  const over=labels.length?labels[labels.length-1].y-maxY:0;if(over>0)labels.forEach(l=>l.y=Math.max(minY,l.y-over));
  return labels;
}
// Info-bulle au toucher / survol : pick(x,y) -> {html, cx (ligne verticale) } ou null
function elBindTip(wrap,canvas,pick){
  const tip=wrap.querySelector('.suiviTip'),line=wrap.querySelector('.suiviCross');
  const show=ev=>{
    const r=canvas.getBoundingClientRect(),res=pick(ev.clientX-r.left,ev.clientY-r.top);
    if(!res){hide();return}
    tip.innerHTML=res.html;tip.classList.remove('hide');
    if(res.cx!=null){line.classList.remove('hide');line.style.left=res.cx+'px'}else line.classList.add('hide');
    tip.style.left='0px';
    const px=res.cx!=null?res.cx:ev.clientX-r.left,tw=tip.offsetWidth;
    tip.style.left=Math.max(0,Math.min(r.width-tw,px+10>r.width-tw?px-tw-10:px+10))+'px';
  };
  const hide=()=>{tip.classList.add('hide');line.classList.add('hide')};
  // Au doigt, l'info-bulle reste affichée après le toucher (elle disparaissait dès que le doigt se levait)
  canvas.addEventListener('pointermove',show);canvas.addEventListener('pointerdown',show);
  canvas.addEventListener('pointerleave',e=>{if(e.pointerType!=='touch')hide()});canvas.addEventListener('pointercancel',hide);
}
function elCard(base,label,unit,legend,chartLabel,tableHtml,note){
  const card=document.createElement('div');card.className='suiviParamCard';card.dataset.param=base;
  card.innerHTML='<div class="suiviParamHead"><div><div class="suiviParamName">'+escapeHTML(label)+'</div><div class="suiviParamUnit">'+escapeHTML(unit)+'</div></div></div>'+
    '<div class="suiviParamBody"><div class="suiviDepthLegend">'+legend+'</div>'+
    '<div class="suiviDepthWrap"><canvas class="suiviMiniChart" role="img" aria-label="'+escapeHTML(chartLabel)+'"></canvas><div class="suiviCross hide"></div><div class="suiviTip hide"></div></div>'+
    (note?'<div class="suiviElCardNote">'+note+'</div>':'')+
    '<div style="overflow:auto">'+tableHtml+'</div></div>';
  return card;
}

// ---------- 1. Évolution par session (surface / intermédiaire / fond superposés) ----------
// Données EL d'un paramètre : périodes (sessions, dans l'ordre) et, par profondeur, la valeur de
// chaque période (moyenne si plusieurs visites dans la même session).
function suiviDepthData(network,station,base){
  const depths=EL_DEPTHS.map(d=>({d,byPeriod:new Map(suiviSeries(network,station,base+'_'+d.key).map(x=>[x.period,x]))})).filter(x=>x.byPeriod.size);
  const periods=[...new Set(depths.flatMap(x=>[...x.byPeriod.keys()]))].sort(elSessionCmp);
  return {periods,depths};
}
// Une courbe par profondeur, interrompue quand une session n'a pas de mesure à cette profondeur
// (pas de trait trompeur entre deux sessions non consécutives).
function drawDepthSuiviChart(canvas,data,unit){
  if(!canvas||!data.periods.length)return null;
  const {c,w,h}=elPrepCanvas(canvas,180);
  const [min,max]=elRange(data.depths.flatMap(x=>[...x.byPeriod.values()].map(v=>v.mean)));
  const pad={l:elAxisPad(c,min,max,40),r:48,t:16,b:30},pw=w-pad.l-pad.r,ph=h-pad.t-pad.b,P=data.periods,n=P.length,ins=10;
  // Points écartés de 10 px de l'axe (le premier recouvrait les graduations)
  const xAt=i=>pad.l+ins+(n===1?(pw-2*ins)/2:i*((pw-2*ins)/(n-1))),yAt=v=>pad.t+(max-v)*(ph/(max-min));
  // Légère séparation horizontale des trois profondeurs pour que des valeurs égales restent visibles
  const dodge=data.depths.length>1?{surf:-4,inter:0,fond:4}:{surf:0,inter:0,fond:0};
  c.font='9px Arial';
  for(let i=0;i<4;i++){const v=min+i*(max-min)/3,y=yAt(v);c.strokeStyle='#e5ebee';c.lineWidth=1;c.beginPath();c.moveTo(pad.l,y);c.lineTo(w-pad.r,y);c.stroke();c.fillStyle='#6e7b82';c.textAlign='right';c.fillText(Number(v.toFixed(2)).toString(),pad.l-5,y+3)}
  c.strokeStyle='#c3cdd2';c.beginPath();c.moveTo(pad.l,pad.t+ph);c.lineTo(w-pad.r,pad.t+ph);c.stroke();
  c.fillStyle='#6e7b82';c.textAlign='left';c.fillText(unit,pad.l,10);
  // Axe : code court de la session (« S1 ») ; le nom complet est dans l'info-bulle et le tableau. Étiquettes
  // espacées (une sur deux…) si elles ne tiennent pas, la dernière toujours affichée.
  const xl=elPeriodTicks(P);c.font='9px Arial';const lw=Math.max(...xl.map(t=>c.measureText(t).width))+6,step=n>1?Math.max(1,Math.ceil(lw/((pw-2*ins)/(n-1)))):1;
  xl.forEach((t,i)=>{if((n-1-i)%step)return;c.fillStyle='#52626e';c.textAlign='center';c.fillText(t,xAt(i),h-12)});
  const ends=[];
  data.depths.forEach(({d,byPeriod})=>{
    const dx=dodge[d.key]||0;
    c.strokeStyle=d.color;c.lineWidth=2;c.lineJoin='round';c.beginPath();let open=false;
    P.forEach((p,i)=>{const v=byPeriod.get(p);if(!v){open=false;return}const x=xAt(i)+dx,y=yAt(v.mean);if(open)c.lineTo(x,y);else{c.moveTo(x,y);open=true}});
    c.stroke();
    let last=null;P.forEach((p,i)=>{const v=byPeriod.get(p);if(v){drawDepthMarker(c,d.shape,xAt(i)+dx,yAt(v.mean),d.color);last={i,y:yAt(v.mean)}}});
    if(last&&last.i===n-1)ends.push({d,y:last.y});
  });
  // Étiquettes directes en bout de courbe
  c.font='9px Arial';c.textAlign='left';c.fillStyle='#52626e';elSpread(ends,11,pad.t,h-pad.b).forEach(e=>c.fillText(e.d.short,xAt(n-1)+9,e.y+3));
  return {xAt,n};
}
function renderElEvolution(n,s,grid){
  let count=0;
  EL_SUIVI_DEFS.forEach(([base,label,unit])=>{
    const data=suiviDepthData(n,s,base);if(!data.periods.length)return;count++;
    const lastOf=x=>{const ps=data.periods.filter(p=>x.byPeriod.has(p));return x.byPeriod.get(ps[ps.length-1])};
    const table='<table class="suiviTrendTable"><thead><tr><th>Période</th>'+EL_DEPTHS.map(d=>'<th>'+depthMarkerSvg(d,10)+' '+escapeHTML(d.label)+'</th>').join('')+'</tr></thead><tbody>'+
      data.periods.map(p=>'<tr><td>'+escapeHTML(p)+'</td>'+EL_DEPTHS.map(d=>{const v=data.depths.find(x=>x.d===d)?.byPeriod.get(p);return '<td>'+(v?v.mean.toFixed(2)+(v.n>1?' <small>(n='+v.n+')</small>':''):'—')+'</td>'}).join('')+'</tr>').join('')+'</tbody></table>';
    const card=elCard(base,label,unit,data.depths.map(x=>'<span>'+depthMarkerSvg(x.d,11)+' '+escapeHTML(x.d.label)+'</span>').join(''),label+' : évolution par session en surface, intermédiaire et fond',table);
    card.querySelector('.suiviParamHead').insertAdjacentHTML('beforeend','<div class="suiviDepthLast" title="Dernière valeur mesurée à chaque profondeur">'+data.depths.map(x=>'<span>'+depthMarkerSvg(x.d,11)+' '+lastOf(x).mean.toFixed(2)+'</span>').join('')+'</div>');
    grid.appendChild(card);
    const canvas=card.querySelector('canvas'),geo=drawDepthSuiviChart(canvas,data,unit);
    if(geo)elBindTip(card.querySelector('.suiviDepthWrap'),canvas,x=>{
      let i=0,best=Infinity;for(let k=0;k<geo.n;k++){const dd=Math.abs(geo.xAt(k)-x);if(dd<best){best=dd;i=k}}
      const p=data.periods[i];
      return {cx:geo.xAt(i),html:'<b>'+escapeHTML(p)+'</b>'+data.depths.map(({d,byPeriod})=>{const v=byPeriod.get(p);return '<div>'+depthMarkerSvg(d,10)+' '+escapeHTML(d.label)+' : <b>'+(v?v.mean.toFixed(2)+(unit?' '+escapeHTML(unit):''):'—')+'</b>'+(v&&v.n>1?' <span class="suiviTipN">(moyenne de '+v.n+' visites)</span>':'')+'</div>'}).join('')};
    });
  });
  return count;
}

// ---------- 2. Profil de profondeur (station choisie, une courbe par session) ----------
function elDepthProfileData(station,base){
  const bySes=new Map();
  records.filter(r=>r.network==='EL'&&r.station===station).forEach(r=>{
    const key=suiviDateKey(r);if(!key)return;const P=r.insitu?.profondeurs||{};
    EL_DEPTHS.forEach(d=>{
      const v=numOrNull(suiviValueFor(r,base+'_'+d.key));if(v===null)return;
      const z=numOrNull(P[d.field]),m=bySes.get(key)||{},a=m[d.key]||(m[d.key]={v:[],z:[],nz:[]});
      if(z!==null){a.v.push(v);a.z.push(z)}else a.nz.push(v);bySes.set(key,m);
    });
  });
  const {infos,dropped}=elOrderSessions([...bySes.keys()]);
  // Point tracé = moyenne des seules visites dont la profondeur est saisie ; les autres sont comptées à part
  return {dropped,sessions:infos.map(si=>({si,levels:EL_DEPTHS.map(d=>{const a=bySes.get(si.label)[d.key];if(!a)return null;
    return a.v.length?{d,v:elMean(a.v),z:elMean(a.z),n:a.v.length,noz:a.nz.length}:{d,v:elMean(a.nz),z:null,n:a.nz.length,noz:a.nz.length}}).filter(Boolean)}))};
}
// Valeur en abscisse, profondeur en ordonnée (0 m en haut) ; une courbe par session reliant surface,
// intermédiaire et fond. Les points sans profondeur saisie ne peuvent pas être placés (signalé).
function drawElDepthProfile(canvas,data,unit){
  const pts=data.sessions.flatMap(s=>s.levels.filter(l=>l.z!==null).map(l=>({s,l})));
  if(!pts.length)return null;
  const {c,w,h}=elPrepCanvas(canvas,210);
  const pad={l:44,r:40,t:14,b:30},pw=w-pad.l-pad.r,ph=h-pad.t-pad.b;
  const [vmin,vmax]=elRange(pts.map(p=>p.l.v)),zmax=Math.max(1,...pts.map(p=>p.l.z))*1.1;
  const xAt=v=>pad.l+(v-vmin)/(vmax-vmin)*pw,yAt=z=>pad.t+z/zmax*ph;
  c.font='9px Arial';
  for(let i=0;i<=4;i++){const v=vmin+i*(vmax-vmin)/4,x=xAt(v);c.strokeStyle='#eef2f4';c.lineWidth=1;c.beginPath();c.moveTo(x,pad.t);c.lineTo(x,pad.t+ph);c.stroke();c.fillStyle='#6e7b82';c.textAlign='center';c.fillText(Number(v.toFixed(2)).toString(),x,pad.t+ph+12)}
  for(let i=0;i<=4;i++){const z=zmax*i/4,y=yAt(z);c.strokeStyle='#e5ebee';c.beginPath();c.moveTo(pad.l,y);c.lineTo(pad.l+pw,y);c.stroke();c.fillStyle='#6e7b82';c.textAlign='right';c.fillText(Number(z.toFixed(1)).toString(),pad.l-5,y+3)}
  c.strokeStyle='#c3cdd2';c.beginPath();c.moveTo(pad.l,pad.t);c.lineTo(pad.l,pad.t+ph);c.stroke();
  c.fillStyle='#52626e';c.textAlign='center';c.fillText('Valeur'+(unit?' ('+unit+')':''),pad.l+pw/2,h-4);
  c.save();c.translate(11,pad.t+ph/2);c.rotate(-Math.PI/2);c.fillText('Profondeur (m)',0,0);c.restore();
  const ends=[],marks=[];
  data.sessions.forEach(({si,levels})=>{
    const L=levels.filter(l=>l.z!==null).sort((a,b)=>a.z-b.z);if(!L.length)return;
    c.strokeStyle=si.color;c.lineWidth=2;c.lineJoin='round';c.setLineDash(si.dash?[5,4]:[]);c.beginPath();
    L.forEach((l,i)=>{const x=xAt(l.v),y=yAt(l.z);if(i)c.lineTo(x,y);else c.moveTo(x,y)});c.stroke();c.setLineDash([]);
    L.forEach(l=>{drawDepthMarker(c,'circle',xAt(l.v),yAt(l.z),si.color);marks.push({si,l,x:xAt(l.v),y:yAt(l.z)})});
    const last=L[L.length-1];ends.push({si,x:xAt(last.v),y:yAt(last.z)});
  });
  // Étiquette « S1 » au point le plus profond de chaque courbe (jusqu'à 5 sessions ; au-delà : légende, info-bulle et tableau)
  // En colonne à droite des points du fond, à la couleur de la session et détourées de blanc : une étiquette
  // écartée ne se retrouve plus à côté du point d'une autre session ni sous le graphe.
  if(ends.length<=5){
    const lx=Math.min(Math.max(...ends.map(e=>e.x))+8,w-pad.r+6);ends.sort((a,b)=>a.y-b.y||a.x-b.x);
    c.font='bold 9px Arial';c.textAlign='left';c.lineJoin='round';c.lineWidth=3;c.strokeStyle='#fff';
    elSpread(ends,11,pad.t+4,pad.t+ph-4).forEach(e=>{c.strokeText(e.si.code,lx,e.y+3);c.fillStyle=e.si.color;c.fillText(e.si.code,lx,e.y+3)});
  }
  return {marks};
}
function renderElDepthProfiles(s,grid){
  let count=0;
  EL_SUIVI_DEFS.forEach(([base,label,unit])=>{
    const data=elDepthProfileData(s,base);if(!data.sessions.length)return;count++;
    const noZ=data.sessions.reduce((k,x)=>k+x.levels.reduce((j,l)=>j+(l.noz||0),0),0);
    const table='<table class="suiviTrendTable"><thead><tr><th>Session</th>'+EL_DEPTHS.map(d=>'<th>'+depthMarkerSvg(d,10)+' '+escapeHTML(d.label)+'</th>').join('')+'</tr></thead><tbody>'+
      data.sessions.map(({si,levels})=>'<tr><td>'+sessionKeySvg(si)+' '+escapeHTML(si.label)+'</td>'+EL_DEPTHS.map(d=>{const l=levels.find(x=>x.d===d);return '<td>'+(l?elFmt(l.v)+(l.z!==null?' <small>à '+Number(l.z.toFixed(2))+' m</small>':' <small>(profondeur non saisie)</small>')+(l.n>1?' <small>(n='+l.n+')</small>':'')+(l.z!==null&&l.noz?' <small>(+'+l.noz+' sans profondeur saisie, non tracée(s))</small>':''):'—')+'</td>'}).join('')+'</tr>').join('')+'</tbody></table>';
    const note=[noZ?noZ+' mesure(s) sans profondeur saisie : non placée(s) sur le profil (voir le tableau).':'',data.dropped?data.dropped+' session(s) plus ancienne(s) non tracée(s) (8 au maximum).':''].filter(Boolean).join(' ');
    const card=elCard(base,label,unit,data.sessions.map(({si})=>'<span>'+sessionKeySvg(si)+' '+escapeHTML(si.name)+'</span>').join(''),label+' : profil de profondeur, une courbe par session',table,escapeHTML(note));
    grid.appendChild(card);
    const canvas=card.querySelector('canvas'),geo=drawElDepthProfile(canvas,data,unit);
    if(!geo){card.querySelector('.suiviDepthWrap').innerHTML='<div class="suiviElEmpty">Profondeurs de mesure non saisies : profil impossible à tracer (valeurs dans le tableau).</div>';return}
    elBindTip(card.querySelector('.suiviDepthWrap'),canvas,(x,y)=>{
      let best=null,bd=Infinity;geo.marks.forEach(m=>{const d=Math.hypot(m.x-x,m.y-y);if(d<bd){bd=d;best=m}});
      if(!best||bd>40)return null;
      return {cx:null,html:'<b>'+sessionKeySvg(best.si)+' '+escapeHTML(best.si.label)+'</b><div>'+depthMarkerSvg(best.l.d,10)+' '+escapeHTML(best.l.d.label)+' à '+Number(best.l.z.toFixed(2))+' m : <b>'+elFmt(best.l.v)+(unit?' '+escapeHTML(unit):'')+'</b>'+(best.l.n>1?' <span class="suiviTipN">(moyenne de '+best.l.n+' visites)</span>':'')+'</div>'};
    });
  });
  return count;
}

// ---------- 3. Profil longitudinal (EL : estuaire ; RCO, Chimie, BIO : bassin versant) ----------
// Listes du référentiel de chaque réseau ; l'ESO (forages, piézomètres) n'a ni amont ni aval : pas de profil.
const SUIVI_PROFILE_NETS={
  EL:{data:['EL_STATIONS'],place:'Estuaire',down:'mer →'},
  RCO:{data:['RCO13','RCO_BIO12'],place:'Bassin versant',down:'aval →'},
  Chimie:{data:['CH_STATIONS'],place:'Bassin versant',down:'aval →'},
  BIO:{data:['BIO_CE','BIO_FISH','BIO_PHYTO','BIO_ADNE'],place:'Bassin versant',down:'aval →'}
};
// Paramètres in situ des cours d'eau, dans l'ordre des graphes
const RIVER_PROFILE_PARAMS=['temp','ph','cond','condms','sal','o2mg','o2pc','turb','air'];
function netStationsAll(net){
  // Référentiel, stations ajoutées, puis stations connues seulement par les fiches (station ajoutée sur une
  // autre tablette, supprimée ici, ou renommée) — le référentiel l'emporte en cas de même nom
  const m=new Map();[...(SUIVI_PROFILE_NETS[net]?.data||[]).flatMap(k=>DATA[k]||[]),...(custom.stations||[]).filter(s=>s.network===net),...records.filter(r=>r.network===net&&r.station).map(r=>({...(r.stationInfo||{}),nom:r.station}))].forEach(s=>{if(s&&s.nom&&!m.has(s.nom))m.set(s.nom,s)});
  return [...m.values()];
}
function elStationsAll(){return netStationsAll('EL')}
function elBassinOf(s){return String(s?.bassin||s?.bv||s?.bassinVersant||'').trim()}
function netBasins(net){return [...new Set(netStationsAll(net).map(elBassinOf).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'fr'))}
function elEstuaries(){return netBasins('EL')}
// Amont -> aval (mer) : du sud vers le nord (ordonnée UTM croissante), les fleuves de Guyane coulant vers le nord
function netBasinStations(net,bassin){
  const y=s=>{const p=typeof stationXY22==='function'?stationXY22(s):null;return p?p[1]:Infinity};
  return netStationsAll(net).filter(s=>elBassinOf(s)===bassin).sort((a,b)=>y(a)-y(b)||String(a.nom).localeCompare(String(b.nom),'fr'));
}
function elEstuaryStations(bassin){return netBasinStations('EL',bassin)}
// Valeurs d'un paramètre par session et par station du bassin. measuredOnly : seules les stations mesurées
// (et la station `keep`) sont gardées — un bassin versant compte jusqu'à 11 stations au référentiel.
function netProfileData(net,bassin,param,measuredOnly,keep){
  let sts=netBasinStations(net,bassin);const bySes=new Map();
  records.filter(r=>r.network===net&&sts.some(st=>st.nom===r.station)).forEach(r=>{
    const key=suiviDateKey(r),v=numOrNull(suiviValueFor(r,param));if(!key||v===null)return;
    const m=bySes.get(key)||new Map(),a=m.get(r.station)||[];a.push(v);m.set(r.station,a);bySes.set(key,m);
  });
  const total=sts.length;
  if(measuredOnly)sts=sts.filter(st=>st.nom===keep||[...bySes.values()].some(m=>m.has(st.nom)));
  const names=sts.map(s=>s.nom),{infos,dropped}=elOrderSessions([...bySes.keys()],net);
  return {stations:sts,hidden:total-sts.length,dropped,sessions:infos.map(si=>{const m=bySes.get(si.label);return {si,vals:names.map(n=>{const a=m.get(n);return a?{v:elMean(a),n:a.length}:null})}})};
}
function elEstuaryData(bassin,base,depthKey){return netProfileData('EL',bassin,base+'_'+depthKey)}
// Stations à intervalles réguliers en abscisse, une courbe par session (interrompue là où une
// station n'a pas été mesurée), station sélectionnée surlignée. Noms en biais quand les stations
// sont trop serrées pour les écrire à plat.
function drawElEstuary(canvas,data,unit,highlight,down){
  const vals=data.sessions.flatMap(s=>s.vals.filter(Boolean).map(x=>x.v));if(!vals.length)return null;
  const n=data.stations.length,w0=Math.max(280,canvas.getBoundingClientRect().width||420),tilt=n>1&&(w0-100)/(n-1)<58;
  const {c,w,h}=elPrepCanvas(canvas,tilt?260:220);
  // Marge droite assez large pour l'étiquette de session en bout de courbe (« Camp. 2026 » recouvrait le dernier point)
  c.font='bold 9px Arial';const codeW=data.sessions.length<=5?Math.max(0,...data.sessions.map(x=>c.measureText(x.si.code).width)):0;
  const [min,max]=elRange(vals),pad={l:elAxisPad(c,min,max,42),r:Math.max(30,Math.ceil(codeW)+12),t:16,b:tilt?86:46},pw=w-pad.l-pad.r,ph=h-pad.t-pad.b,ins=10;
  const xAt=i=>pad.l+ins+(n===1?(pw-2*ins)/2:i*((pw-2*ins)/(n-1))),yAt=v=>pad.t+(max-v)*(ph/(max-min)),gap=n>1?(pw-2*ins)/(n-1):pw;
  const hi=data.stations.findIndex(s=>s.nom===highlight);
  if(hi>=0){c.fillStyle='rgba(0,61,122,.07)';const bw=Math.min(44,gap*.8);c.fillRect(xAt(hi)-bw/2,pad.t,bw,ph)}
  c.font='9px Arial';
  for(let i=0;i<4;i++){const v=min+i*(max-min)/3,y=yAt(v);c.strokeStyle='#e5ebee';c.lineWidth=1;c.beginPath();c.moveTo(pad.l,y);c.lineTo(w-pad.r,y);c.stroke();c.fillStyle='#6e7b82';c.textAlign='right';c.fillText(Number(v.toFixed(2)).toString(),pad.l-5,y+3)}
  c.strokeStyle='#c3cdd2';c.beginPath();c.moveTo(pad.l,pad.t+ph);c.lineTo(w-pad.r,pad.t+ph);c.stroke();
  c.fillStyle='#6e7b82';c.textAlign='left';c.fillText(unit,pad.l,10);
  data.stations.forEach((s,i)=>{
    const has=data.sessions.some(x=>x.vals[i]);c.font=(i===hi?'bold ':'')+'8.5px Arial';c.fillStyle=i===hi?'#003d7a':has?'#52626e':'#a9b4ba';
    if(tilt){
      // En biais (45°) vers le bas à gauche, raccourci pour ne sortir ni du canevas ni de la marge du bas
      const maxL=Math.min((xAt(i)-4)*Math.SQRT2,(pad.b-14)*Math.SQRT2);let t=String(s.nom);
      while(t.length>1&&c.measureText(t).width>maxL)t=t.slice(0,-2)+'…';
      c.save();c.translate(xAt(i)+3,pad.t+ph+9);c.rotate(-Math.PI/4);c.textAlign='right';c.fillText(t,0,0);c.restore();return;
    }
    // Nom centré sous la station, recalé pour rester entier au bord du graphe (auparavant rogné côté mer)
    c.textAlign='center';
    const L=elWrap(c,s.nom,Math.max(40,Math.min(gap-4,110)),2),tw=Math.max(...L.map(l=>c.measureText(l).width)),x=Math.min(w-2-tw/2,Math.max(2+tw/2,xAt(i)));
    L.forEach((l,k)=>c.fillText(l,x,pad.t+ph+13+k*10));
  });
  c.font='8.5px Arial';c.fillStyle='#8a979e';
  if(tilt){c.textAlign='right';c.fillText('← amont · '+(down||'mer →'),w-pad.r,10)}
  else{c.textAlign='left';c.fillText('amont',pad.l,h-3);c.textAlign='right';c.fillText(down||'mer →',w-pad.r,h-3)}
  const ends=[];
  data.sessions.forEach(({si,vals:V})=>{
    c.strokeStyle=si.color;c.lineWidth=2;c.lineJoin='round';c.setLineDash(si.dash?[5,4]:[]);c.beginPath();let open=false;
    V.forEach((x,i)=>{if(!x){open=false;return}const px=xAt(i),py=yAt(x.v);if(open)c.lineTo(px,py);else{c.moveTo(px,py);open=true}});
    c.stroke();c.setLineDash([]);
    let last=null;V.forEach((x,i)=>{if(x){drawDepthMarker(c,'circle',xAt(i),yAt(x.v),si.color);last={i,y:yAt(x.v)}}});
    if(last)ends.push({si,x:xAt(last.i),y:last.y});
  });
  if(ends.length<=5){c.font='bold 9px Arial';c.textAlign='left';c.fillStyle='#17212b';elSpread(ends,11,pad.t,pad.t+ph).forEach(e=>c.fillText(e.si.code,Math.min(e.x+7,w-c.measureText(e.si.code).width-2),e.y+3))}
  return {xAt,n,padB:pad.b};
}
function renderNetProfile(net,s,grid){
  const isEL=net==='EL',cfg=SUIVI_PROFILE_NETS[net],bassin=suiviBasin[net]||'';let count=0;
  const depth=isEL?(EL_DEPTHS.find(d=>d.key===elEstuaryDepth)||EL_DEPTHS[0]):null;
  if(!netBasinStations(net,bassin).length){grid.insertAdjacentHTML('beforeend','<div class="suiviElEmpty">'+(isEL?'Aucune station EL rattachée à cet estuaire.':'Aucune station '+escapeHTML(net)+' rattachée à ce bassin versant.')+'</div>');return 0}
  const defs=isEL?EL_SUIVI_DEFS.map(([base,label,unit])=>({base,param:base+'_'+depth.key,label,unit})):RIVER_PROFILE_PARAMS.filter(k=>SUIVI_PARAMS[k]).map(k=>({base:k,param:k,label:SUIVI_PARAMS[k].label,unit:SUIVI_PARAMS[k].unit}));
  defs.forEach(({base,param,label,unit})=>{
    const data=netProfileData(net,bassin,param,!isEL,s);if(!data.sessions.length)return;count++;
    const table='<table class="suiviTrendTable"><thead><tr><th>Session</th>'+data.stations.map(st=>'<th'+(st.nom===s?' class="suiviElHi"':'')+'>'+escapeHTML(st.nom)+'</th>').join('')+'</tr></thead><tbody>'+
      data.sessions.map(({si,vals})=>'<tr><td>'+sessionKeySvg(si)+' '+escapeHTML(si.label)+'</td>'+vals.map((x,i)=>'<td'+(data.stations[i].nom===s?' class="suiviElHi"':'')+'>'+(x?elFmt(x.v)+(x.n>1?' <small>(n='+x.n+')</small>':''):'—')+'</td>').join('')+'</tr>').join('')+'</tbody></table>';
    const note=[data.hidden?data.hidden+' station(s) du bassin sans mesure de ce paramètre, non affichée(s).':'',data.dropped?data.dropped+' session(s) plus ancienne(s) non tracée(s) (8 au maximum).':''].filter(Boolean).join(' ');
    const what=isEL?label+' le long de l’estuaire '+bassin+' ('+depth.label.toLowerCase()+'), une courbe par session':label+' le long du bassin versant '+bassin+', de l’amont vers l’aval, une courbe par session';
    const card=elCard(base,label,unit,data.sessions.map(({si})=>'<span>'+sessionKeySvg(si)+' '+escapeHTML(si.name)+'</span>').join(''),what,table,escapeHTML(note));
    if(isEL)card.querySelector('.suiviParamUnit').insertAdjacentHTML('beforeend',(unit?' · ':'')+depthMarkerSvg(depth,10)+' '+escapeHTML(depth.label));
    grid.appendChild(card);
    const canvas=card.querySelector('canvas'),geo=drawElEstuary(canvas,data,unit,s,cfg.down);
    if(geo)card.querySelector('.suiviCross').style.bottom=geo.padB+'px'; // la ligne de repère s'arrête à l'axe, au-dessus des noms
    if(geo)elBindTip(card.querySelector('.suiviDepthWrap'),canvas,x=>{
      let i=0,best=Infinity;for(let k=0;k<geo.n;k++){const dd=Math.abs(geo.xAt(k)-x);if(dd<best){best=dd;i=k}}
      return {cx:geo.xAt(i),html:'<b>'+escapeHTML(data.stations[i].nom)+'</b>'+(isEL?' <span class="suiviTipN">('+escapeHTML(depth.label.toLowerCase())+')</span>':'')+data.sessions.map(({si,vals})=>{const x=vals[i];return '<div>'+sessionKeySvg(si)+' '+escapeHTML(si.code)+' : <b>'+(x?elFmt(x.v)+(unit?' '+escapeHTML(unit):''):'—')+'</b>'+(x&&x.n>1?' <span class="suiviTipN">(moyenne de '+x.n+' visites)</span>':'')+'</div>'}).join('')};
    });
  });
  if(!count)grid.insertAdjacentHTML('beforeend','<div class="suiviElEmpty">'+(isEL?'Aucune mesure '+escapeHTML(depth.label.toLowerCase())+' enregistrée sur les stations de cet estuaire.':'Aucune mesure in situ enregistrée sur les stations '+escapeHTML(net)+' de ce bassin versant.')+'</div>');
  return count;
}

// ---------- Barre de choix de la vue (au-dessus des graphes) ----------
function clearSuiviEL(){const b=$('suiviElBar');if(b)b.remove()}
const SUIVI_VIEWS={
  EL:[['evolution','📈 Évolution par session','Surface, intermédiaire et fond sur le même graphe, session après session.'],
      ['profondeur','⬇️ Profil de profondeur','Profondeur (m) en ordonnée : une courbe par session, de la surface au fond.'],
      ['estuaire','↔️ Profil longitudinal de l’estuaire','Stations de l’estuaire de l’amont vers la mer (classées du sud au nord), une courbe par session, à la profondeur choisie. La station sélectionnée est surlignée.']],
  river:[['evolution','📈 Évolution par session','Un graphe par paramètre, session après session.'],
      ['bassin','↔️ Profil longitudinal du bassin','Stations mesurées du bassin versant de l’amont vers l’aval (classées du sud au nord, les fleuves de Guyane coulant vers la mer ; les affluents se placent selon leur latitude), une courbe par session. La station sélectionnée est surlignée.']]
};
// Affiche la barre de vues du réseau et, sauf pour l'évolution des cours d'eau (graphes d'app-core.js),
// les graphes de la vue choisie. Renvoie true si les graphes sont tracés ici.
function renderSuiviViews(n,s,grid){
  const cfg=SUIVI_PROFILE_NETS[n];
  if(!cfg){clearSuiviEL();return false} // ESO : pas de profil longitudinal
  // Bassin (estuaire) : par défaut celui de la station choisie (réinitialisé quand on change de station)
  if(suiviBasinAnchor[n]!==s){suiviBasinAnchor[n]=s;const st=netStationsAll(n).find(x=>x.nom===s)||records.find(r=>r.network===n&&r.station===s)?.stationInfo;suiviBasin[n]=elBassinOf(st)||netBasins(n)[0]||''}
  const views=SUIVI_VIEWS[n==='EL'?'EL':'river'],profile=n==='EL'?'estuaire':'bassin';
  let view=suiviView[n];if(!views.some(v=>v[0]===view))view=suiviView[n]='evolution';
  let bar=$('suiviElBar');
  if(!bar){bar=document.createElement('div');bar.id='suiviElBar';bar.className='suiviElBar';grid.parentNode.insertBefore(bar,grid)}
  bar.innerHTML='<div class="suiviElSeg" role="tablist">'+views.map(([v,l])=>'<button type="button" role="tab" class="suiviElTab'+(view===v?' on':'')+'" aria-selected="'+(view===v)+'" data-v="'+v+'">'+l+'</button>').join('')+'</div>'+
    (view===profile?'<div class="suiviElOpts"><div class="field"><label>'+escapeHTML(cfg.place)+'</label><select id="suiviElEstuary">'+netBasins(n).map(b=>'<option'+(b===suiviBasin[n]?' selected':'')+'>'+escapeHTML(b)+'</option>').join('')+'</select></div>'+
      (n==='EL'?'<div class="field"><label>Profondeur</label><select id="suiviElDepth">'+EL_DEPTHS.map(d=>'<option value="'+d.key+'"'+(d.key===elEstuaryDepth?' selected':'')+'>'+escapeHTML(d.label)+'</option>').join('')+'</select></div>':'')+'</div>':'')+
    '<div class="suiviElHelp">'+escapeHTML(views.find(v=>v[0]===view)[2])+'</div>';
  bar.querySelectorAll('.suiviElTab').forEach(b=>b.onclick=()=>{suiviView[n]=b.dataset.v;renderSuivi()});
  const es=$('suiviElEstuary');if(es)es.onchange=()=>{suiviBasin[n]=es.value;renderSuivi()};
  const ed=$('suiviElDepth');if(ed)ed.onchange=()=>{elEstuaryDepth=ed.value;renderSuivi()};
  if(n!=='EL'&&view==='evolution')return false;
  grid.innerHTML='';
  if(view===profile)renderNetProfile(n,s,grid);
  else if(view==='profondeur')renderElDepthProfiles(s,grid);
  else renderElEvolution(n,s,grid);
  return true;
}
