/* Fiche terrain imprimée (bouton « 🖨 Imprimer / PDF » ou Ctrl+P sur l'onglet de saisie), mise en
 * page sur le modèle des rapports de l'Office de l'Eau : en-tête avec le logo répété sur chaque page,
 * rubriques numérotées sur bandeau bleu marine, tableaux libellé / valeur, photos en grand, bandeau
 * « La connaissance aujourd'hui pour les rivières de demain » en pied de page.
 * Le document est construit à partir du formulaire tel qu'il est affiché : un bloc déplié par une
 * réponse « Oui » (déploiement, filtration, conservation…) est imprimé, un bloc masqué ne l'est pas.
 * Boutons radio et cases à cocher deviennent le texte de la réponse choisie ; ni « non référencé »,
 * ni coches, ni statut de la fiche (le statut reste dans l'application). */
(function(){
  const ASSETS={}; // logo, bandeau, légende : data: URL préparées au démarrage (voir plus bas)
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  // Éléments jamais imprimés : aides, boutons, outils de saisie
  const SKIP='.hint,.note,.banner,.actions,button,.btn,.drawToolbar,.photoSourceBtns,.metrologyStatus,.elProbeLabel,script,style,datalist,option';
  const shown=el=>el.getClientRects().length>0;
  // Mentions de saisie ajoutées à une valeur (« ancienne saisie », « non référencé sur cette tablette »), coches
  // et pictogrammes des intertitres (🌊, 🐟…), absents des documents de l'Office
  const clean=s=>String(s||'').replace(/\s*\((?:ancienne saisie|non référencé[^)]*)\)/gi,'').replace(/[✓✔☑✅\uFE0F]|\p{Emoji_Presentation}/gu,'').replace(/\s+/g,' ').trim();
  function frDate(v){const m=/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}:\d{2}))?/.exec(String(v||''));return m?m[3]+'/'+m[2]+'/'+m[1]+(m[4]?' '+m[4]:''):String(v||'')}
  function controlValue(el){
    if(el.tagName==='SELECT'){const o=el.options[el.selectedIndex];return o&&el.value!==''?clean(o.text):''}
    const t=String(el.type||'').toLowerCase();
    if(t==='date'||t==='datetime-local')return frDate(el.value);
    // Texte saisi par l'agent imprimé tel quel (seuls les espaces sont resserrés) : les mentions retirées par
    // clean() ne concernent que les libellés et les options des listes
    return el.tagName==='TEXTAREA'?String(el.value||'').trim():String(el.value||'').replace(/\s+/g,' ').trim();
  }
  // Texte affiché d'un bloc : valeurs des champs, réponse cochée (les options non cochées sont omises),
  // morceaux séparés par « · » entre blocs (le texte d'une même ligne reste collé)
  function collect(root,exclude){
    const ex=new Set([].concat(exclude||[]).filter(Boolean)),parts=[];let cur='';
    const flush=()=>{const t=clean(cur);if(t)parts.push(t);cur=''};
    const walk=n=>{
      if(n.nodeType===3){cur+=n.nodeValue;return}
      if(n.nodeType!==1||ex.has(n))return;
      const el=n;
      if(el.matches(SKIP)||!shown(el)&&!el.matches('input[type=radio],input[type=checkbox]'))return;
      if(el.matches('input,select,textarea')){
        const t=String(el.type||'').toLowerCase();
        if(t==='radio'||t==='checkbox'){if(el.checked&&!el.closest('label')){flush();parts.push(clean(el.value))}return}
        if(t==='file'||t==='hidden'||t==='button')return;
        // Répétitions de turbidité (cases « M1 », « M2 », « M3 ») : repère gardé devant la valeur
        // Unité indiquée dans la case (taille « mm », poids « g » des poissons…) imprimée avec la valeur
        flush();const v=controlValue(el),phr=String(el.placeholder||'').trim();
        if(v)parts.push(/^M\d$/.test(phr)?phr+' : '+v:/^(mm|cm|m|g|kg|mL|L|°C|NTU|%)$/i.test(phr)?v+' '+phr:v);return;
      }
      if(el.matches('.paramUnit')){const u=clean(el.textContent);if(u)cur+=' ('+u+')';return}
      const opt=el.tagName==='LABEL'&&el.querySelector('input[type=radio],input[type=checkbox]');
      if(opt&&!opt.checked)return; // option non choisie
      const block=!/^inline/.test(getComputedStyle(el).display);
      if(block||opt)flush();
      el.childNodes.forEach(walk);
      if(block||opt)flush();
    };
    walk(root);flush();
    return parts.reduce((a,p)=>a?a+(/:$/.test(a)?' ':' · ')+p:p,'');
  }
  function labelOf(lab){
    if(!lab)return {text:'',code:''};
    const code=lab.querySelector('.sandreCode');
    // « X terrain — selon projection sélectionnée ci-dessus » → « X terrain — RGFG 95 / UTM 22N » : libellé court,
    // X et Y terrain sur une même ligne comme les coordonnées théoriques
    const text=collect(lab,code).replace(/\s*—\s*selon projection sélectionnée ci-dessus\s*$/i,()=>' — '+(val('projection')||'projection choisie'));
    return {text,code:code?clean(code.textContent):''};
  }
  // ---------- Lecture du formulaire ----------
  function tableBlock(t){
    // Code SANDRE d'un paramètre sur une seconde ligne, en petit, comme dans les tableaux libellé / valeur
    const rowsOf=sec=>[...(sec?sec.rows:[])].filter(shown).map(tr=>[...tr.cells].filter(shown).map(c=>{const codes=[...c.querySelectorAll('.sandreCode')];return {text:collect(c,codes),code:codes.map(x=>clean(x.textContent)).join(' '),th:c.tagName==='TH',span:c.colSpan||1}}));
    const head=rowsOf(t.tHead),body=[...t.tBodies].flatMap(rowsOf);
    if(!t.tHead&&!t.tBodies.length)return null;
    return {t:'table',head,body};
  }
  function canvasBlock(cv,caption,cls){
    // Le schéma / la signature tels qu'enregistrés (state.draw / state.signature) ; à défaut, le canevas
    let src=typeof canvasData==='function'?canvasData(cv.id):'';
    if(!src)try{src=cv.toDataURL('image/png')}catch(e){}
    return src?{t:'img',src,caption,cls}:null;
  }
  function photosBlock(){
    const ph=(state.photos||[]).map(p=>typeof p==='string'?{data:p,group:'Amont'}:p).filter(p=>p&&p.data);
    // Photos du site d'abord, puis les photos annexes (observation inhabituelle)
    const order=ph.filter(p=>p.group!=='Annexe').concat(ph.filter(p=>p.group==='Annexe'));
    return {t:'photos',items:order.map((p,i)=>({src:p.data,caption:'Photo '+(i+1)+(p.group==='Annexe'?' — Annexe (observation inhabituelle)':p.group?' — '+p.group:'')}))};
  }
  function walkCard(card,blocks){
    const kv=(label,value,o)=>blocks.push({t:'kv',label:label.text,code:label.code,value,wide:!!(o&&o.wide)});
    const visit=el=>{
      if(el.matches('h2')||el.matches(SKIP)||!shown(el))return;
      if(el.id==='networks'||el.querySelector&&el.querySelector(':scope > #networks')){
        const lab=el.id==='networks'?null:el.querySelector(':scope > label');
        kv(lab?labelOf(lab):{text:'Réseau / marché',code:''},reseauMarche());return;
      }
      if(el.querySelector('input[type=file]')&&el.matches('.field')){blocks.push({t:'h',text:labelOf(el.querySelector(':scope > label')).text||'Photos'});return}
      if(el.matches('.photoGroups,#mediaGrid')){if(!blocks.some(b=>b.t==='photos'))blocks.push(photosBlock());return}
      if(el.matches('table')){const b=tableBlock(el);if(b)blocks.push(b);return}
      if(el.matches('canvas')){const b=canvasBlock(el,el.id==='signature'?'Signature':'',el.id==='signature'?'fpSign':'fpDraw');if(b)blocks.push(b);return}
      if(el.matches('.schemaLegendBox')){
        // Légende de référence du schéma (image), puis l'élément ajouté à la main s'il y en a un
        const img=el.querySelector('img');if(img)blocks.push({t:'img',src:ASSETS.legend||img.getAttribute('src'),caption:'Légende du schéma',cls:'fpLegend'});
        const extra=el.querySelector('input');if(extra&&extra.value.trim())kv({text:'Autre élément de légende',code:''},clean(extra.value));
        return;
      }
      if(el.matches('img'))return;
      if(el.matches('.gpsbox')){const k=el.firstElementChild,m=el.querySelector('.metric');kv({text:collect(k),code:''},m?collect(m):'');return}
      if(el.matches('h3,h4,.elSectionTitle,.sedimentTitle,.bioModuleTitle,.labTitle,.elHead,.insituHead')){const t=collect(el);if(t)blocks.push({t:'h',text:t});return}
      if(el.matches('.filterCol')){
        // Colonne d'un paramètre filtré : « Chlorophylle : Oui / Non », puis ses champs si coché
        const box=el.querySelector('.filterHead input[type=checkbox]'),nm=clean(String(el.querySelector('.filterHead span')?.firstChild?.nodeValue||'Paramètre').replace(/:\s*$/,''));
        const extra=el.querySelector('.filterHead input[type=text]');
        kv({text:'Paramètre filtré — '+nm,code:''},box&&box.checked?'Oui'+(extra&&extra.value.trim()?' · '+extra.value.trim():''):'Non');
        if(box&&box.checked)el.querySelectorAll(':scope > .field, :scope > .filterBody > .field').forEach(f=>{if(shown(f))kv({text:nm+' — '+labelOf(f.querySelector(':scope > label')).text,code:''},collect(f,f.querySelector(':scope > label')))});
        return;
      }
      if(el.matches('.filterBanner')){const t=el.firstElementChild;if(t&&!t.classList.contains('filterCol'))blocks.push({t:'h',text:collect(t)});[...el.children].forEach(c=>{if(c!==t)visit(c)});return}
      if(el.matches('.labGrid')){[...el.children].forEach(c=>{if(!shown(c))return;const b=c.querySelector(':scope > b');if(b)kv({text:collect(b),code:''},collect(c,b),{wide:!!c.querySelector('textarea')});else visit(c)});return}
      const isField=el.matches('.field,.sedimentRow');
      if(isField&&!el.querySelector('.field,.sedimentRow,table,canvas,.filterCol,.labGrid,.photoGroups')){
        const lab=el.querySelector(':scope > label:not(.radio):not(.check), :scope > .sedimentLabel');
        if(!lab&&!el.querySelector('input,select,textarea')){const t=collect(el);if(t)blocks.push({t:'p',text:t});return}
        kv(labelOf(lab),collect(el,lab),{wide:!!el.querySelector('textarea')});return;
      }
      if(isField){const lab=el.querySelector(':scope > label:not(.radio):not(.check), :scope > .sedimentLabel');if(lab){const t=labelOf(lab).text;if(t)blocks.push({t:'h',text:t})}[...el.children].forEach(c=>{if(c!==lab)visit(c)});return}
      // Bloc de choix hors champ (réponse Oui / Non sous un intertitre, cases d'un laboratoire…)
      if(el.matches('.radioGrid,.checkGrid,.sedimentTools')||el.matches('label.radio,label.check')){
        const v=collect(el);const last=blocks[blocks.length-1];
        if(last&&last.t==='h'){blocks.pop();blocks.push({t:'kv',label:last.text,code:'',value:v})}else if(v)blocks.push({t:'p',text:v});
        return;
      }
      if(!el.children.length){const t=collect(el);if(t)blocks.push({t:'p',text:t});return}
      [...el.children].forEach(visit);
    };
    [...card.children].forEach(visit);
  }
  function reseauMarche(){
    const n=state.network;if(!n)return '';
    const st=typeof getStation==='function'?getStation():null,m=st&&typeof meta==='function'?meta(st).m:'';
    return netLabel(n)+(m?' — '+m:'');
  }
  function ficheCards(){
    return [...document.querySelectorAll('.card')].filter(c=>c.querySelector(':scope > h2')&&/^\d+\s*·/.test(c.querySelector(':scope > h2').textContent.trim())&&(typeof inFiche!=='function'||inFiche(c))&&shown(c));
  }
  // ---------- Rendu ----------
  function kvTable(rows){
    let html='',pend=null;
    const cell=r=>'<th>'+esc(r.label)+(r.code?' <span class="fpCode">'+esc(r.code)+'</span>':'')+'</th>';
    const val=r=>'<td>'+esc(r.value).replace(/\n/g,'<br>')+'</td>';
    rows.forEach(r=>{
      const wide=r.wide||String(r.value).length>42||String(r.label).length>48;
      if(wide){if(pend){html+='<tr>'+cell(pend)+val(pend)+'<th class="fpVoid"></th><td class="fpVoid"></td></tr>';pend=null}html+='<tr>'+cell(r)+'<td colspan="3">'+esc(r.value).replace(/\n/g,'<br>')+'</td></tr>';return}
      // Coordonnée X : toujours en début de ligne, pour que son Y soit à côté (X / Y théoriques et terrain), quel
      // que soit le nombre de champs avant (une fiche « non réalisé » n'a qu'une heure de passage)
      if(pend&&/^X\s/.test(String(r.label))){html+='<tr>'+cell(pend)+val(pend)+'<th class="fpVoid"></th><td class="fpVoid"></td></tr>';pend=null}
      if(pend){html+='<tr>'+cell(pend)+val(pend)+cell(r)+val(r)+'</tr>';pend=null}else pend=r;
    });
    if(pend)html+='<tr>'+cell(pend)+val(pend)+'<th class="fpVoid"></th><td class="fpVoid"></td></tr>';
    return '<table class="fpKv"><colgroup><col style="width:21%"><col style="width:29%"><col style="width:21%"><col style="width:29%"></colgroup>'+html+'</table>';
  }
  function dataTable(b){
    const row=(r,head)=>'<tr>'+r.map(c=>{const tag=head?'th':c.th?'th':'td';return '<'+tag+(c.span>1?' colspan="'+c.span+'"':'')+(c.text.length<=12&&!c.code?' class="fpNw"':'')+'>'+esc(c.text)+(c.code?'<span class="fpCode">'+esc(c.code)+'</span>':'')+'</'+tag+'>'}).join('')+'</tr>';
    return '<table class="fpTable">'+(b.head.length?'<thead>'+b.head.map(r=>row(r,true)).join('')+'</thead>':'')+'<tbody>'+b.body.map(r=>row(r,false)).join('')+'</tbody></table>';
  }
  function renderBlocks(blocks){
    let html='',kv=[];
    const flush=()=>{if(kv.length)html+=kvTable(kv);kv=[]};
    blocks.forEach(b=>{
      if(b.t==='kv'){kv.push(b);return}
      flush();
      if(b.t==='h')html+='<h3 class="fpH3">'+esc(b.text)+'</h3>';
      else if(b.t==='p')html+='<p class="fpP">'+esc(b.text)+'</p>';
      else if(b.t==='table')html+=dataTable(b);
      else if(b.t==='img')html+='<figure class="fpFig '+(b.cls||'')+'"><img src="'+esc(b.src)+'" alt="'+esc(b.caption)+'">'+(b.caption?'<figcaption>'+esc(b.caption)+'</figcaption>':'')+'</figure>';
      else if(b.t==='photos')html+=b.items.length?'<div class="fpPhotos">'+b.items.map(p=>'<figure class="fpPhoto"><img src="'+esc(p.src)+'" alt="'+esc(p.caption)+'"><figcaption>'+esc(p.caption)+'</figcaption></figure>').join('')+'</div>':'<p class="fpP fpMuted">Aucune photographie.</p>';
    });
    flush();
    return html;
  }
  function buildFichePrint(){
    const st=typeof getStation==='function'?getStation():null,code=st?(st.code||st.code_bss||''):'';
    const date=frDate(val('date')),net=state.network?netLabel(state.network):'',rm=reseauMarche();
    const nonRealise=typeof isNonRealise==='function'&&isNonRealise();
    const sections=ficheCards().map(card=>{
      const title=card.querySelector(':scope > h2').textContent.trim().replace(/^(\d+)\s*·\s*/,'$1. ');
      const blocks=[];walkCard(card,blocks);
      return '<section class="fpSec"><h2 class="fpBar">'+esc(title)+'</h2>'+renderBlocks(blocks)+'</section>';
    }).join('');
    const now=new Date(),edited=String(now.getDate()).padStart(2,'0')+'/'+String(now.getMonth()+1).padStart(2,'0')+'/'+now.getFullYear()+' '+String(now.getHours()).padStart(2,'0')+':'+String(now.getMinutes()).padStart(2,'0');
    const sub=[code,date,val('session'),val('org')].filter(Boolean).join(' · ');
    let box=document.getElementById('fichePrint');
    if(!box){box=document.createElement('div');box.id='fichePrint';document.body.appendChild(box)}
    box.innerHTML=
      '<div class="fpHead"><img src="'+esc(ASSETS.logo||'img/logo-oeg-rond.png')+'" alt=""><div class="fpOrg"><div class="fpOrgName">OFFICE DE L’EAU DE GUYANE</div><div class="fpOrgSub">Fiche terrain'+(rm?' — '+esc(rm):'')+'</div></div><div class="fpRef"><div>'+esc(code||state.station||'')+'</div><span>'+esc(date)+'</span></div></div>'+
      '<div class="fpFoot"><img class="fpBand" src="'+esc(ASSETS.band||'img/bandeau-oeg.svg')+'" alt=""><div class="fpFootLine">Fiche terrain '+esc(net)+(state.station?' — '+esc(state.station):'')+(date?' — '+esc(date):'')+(()=>{const r=state.editing&&typeof records!=='undefined'?records.find(x=>x.id===state.editing):null,u=r&&typeof recordStamp==='function'?recordStamp(r):'';if(!u)return '';const d=new Date(u);return ' · modifiée le '+esc(isNaN(d)?u:d.toLocaleString('fr-FR',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}))})()+' · éditée le '+esc(edited)+' · Office de l’Eau de Guyane</div><div class="fpSlogan">La connaissance aujourd’hui<br>pour les rivières de demain</div><div class="fpUrl">www.eauguyane.fr</div></div>'+
      '<table class="fpDoc"><thead><tr><td><div class="fpSpH"></div></td></tr></thead><tfoot><tr><td><div class="fpSpF"></div></td></tr></tfoot><tbody><tr><td>'+
      '<div class="fpKicker">FICHE TERRAIN'+(rm?' — '+esc(rm.toUpperCase()):'')+'</div><h1 class="fpTitle">'+esc(state.station?'Prélèvement '+(net?net+' — ':'')+state.station:'Fiche terrain')+'</h1>'+(sub?'<div class="fpSub">'+esc(sub)+'</div>':'')+
      (nonRealise?'<div class="fpAlert">PRÉLÈVEMENT NON RÉALISÉ — motif, photographies et coordonnées relevées sur place ci-dessous.</div>':'')+
      sections+'</td></tr></tbody></table>';
    return box;
  }
  // ---------- Impression ----------
  const PAGE_CSS='@page{size:A4;margin:7mm 0 0 0;@top-right{content:"Page " counter(page) " / " counter(pages);font-family:Barlow,Arial,sans-serif;font-size:7.5pt;color:#4c6180;margin-right:14mm;vertical-align:bottom}@bottom-right{content:none}}';
  function ficheActive(){const v=document.getElementById('new');return !!(v&&v.classList.contains('active'))}
  // Titre de la page pendant l'impression = nom proposé pour le PDF : FT_Réseau-marché_année_session_station
  let titleBefore=null;
  function setPrintTitle(){
    if(typeof ficheFileBase!=='function')return;
    const ed=state.editing&&typeof records!=='undefined'?records.find(x=>x.id===state.editing):null;
    const st=typeof getStation==='function'?getStation():null;
    if(titleBefore===null)titleBefore=document.title;
    document.title=ficheFileBase({network:state.network,session:state.session,station:state.station,stationInfo:st,date:val('date'),conflict:ed?.conflict});
  }
  function restoreTitle(){if(titleBefore!==null){document.title=titleBefore;titleBefore=null}}
  window.addEventListener('afterprint',()=>setTimeout(restoreTitle,500));
  function startFichePrint(){
    if(!ficheActive())return false;
    // Formulaire à nouveau visible le temps de le relire (le mode impression d'une fiche précédente le masque)
    document.body.classList.remove('fpPrinting');
    buildFichePrint();
    let s=document.getElementById('fichePrintPage');
    if(!s){s=document.createElement('style');s.id='fichePrintPage';document.head.appendChild(s)}
    s.textContent=PAGE_CSS;document.body.classList.add('fpPrinting');
    setPrintTitle();
    return true;
  }
  function endFichePrint(){
    restoreTitle();
    document.body.classList.remove('fpPrinting');
    document.getElementById('fichePrintPage')?.remove();
    const b=document.getElementById('fichePrint');if(b)b.innerHTML='';
  }
  // La fiche reste en place après l'impression : sur certaines tablettes, « afterprint » arrive avant
  // que l'aperçu soit prêt (il serait vidé). Elle est refaite ou retirée à l'impression suivante
  // (un CRT imprimé ensuite ne reprend donc ni la fiche ni ses marges de page).
  let freshUntil=0;
  // Bouton « Imprimer / PDF » : on attend les polices et les images avant d'ouvrir l'impression
  async function printFiche(){
    if(!startFichePrint()){endFichePrint();window.print();return}
    try{if(document.fonts)await Promise.all(['400 10px Barlow','600 10px Barlow','700 10px Barlow','700 10px "Barlow Condensed"'].map(f=>document.fonts.load(f)))}catch(e){}
    try{await Promise.all([...document.querySelectorAll('#fichePrint img')].map(i=>i.decode?i.decode().catch(()=>{}):null))}catch(e){}
    freshUntil=Date.now()+5000; // pas de reconstruction au « beforeprint » de cette impression
    window.print();
  }
  window.addEventListener('beforeprint',()=>{if(Date.now()<freshUntil&&ficheActive()){freshUntil=0;return}freshUntil=0;if(!startFichePrint())endFichePrint()});
  // Logo, bandeau du pied de page et légende du schéma gardés en mémoire sous forme de données (data:), et
  // polices chargées d'avance : une impression par Ctrl+P (que l'appli ne peut pas faire attendre) les
  // imprime sans délai de chargement — une image ordinaire créée au moment d'imprimer sortait vide
  let assetsDone;window.fichePrintAssetsReady=new Promise(r=>{assetsDone=r});
  setTimeout(async()=>{
    const asData=async(u,k)=>{try{const r=await fetch(u);if(!r.ok)return;const b=await r.blob();ASSETS[k]=await new Promise((res,rej)=>{const fr=new FileReader();fr.onload=()=>res(fr.result);fr.onerror=rej;fr.readAsDataURL(b)})}catch(e){}};
    await asData('img/logo-oeg-rond.png','logo');await asData('img/bandeau-oeg.svg','band');await asData('img/legende-schema.png','legend');assetsDone();
    try{if(document.fonts)['400 10px Barlow','600 10px Barlow','700 10px Barlow','700 10px "Barlow Condensed"'].forEach(f=>document.fonts.load(f).catch(()=>{}))}catch(e){}
  },1500);
  Object.assign(window,{buildFichePrint,printFiche,startFichePrint,endFichePrint});
})();
