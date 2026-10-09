/* js/terrain.js — Confort et sécurité de saisie sur le terrain.
 *
 *  1. Indicateur toujours visible (en-tête) : fiches pas encore sauvegardées dans le dossier
 *     local / sur Google Drive, connexion, place occupée sur l'appareil.
 *  2. Contrôle avant enregistrement : champs indispensables, valeurs impossibles (bloquant),
 *     champs recommandés et valeurs inhabituelles (confirmation) ; anti double-appui.
 *  3. Contrôle des mesures in situ en direct, à côté de chaque champ.
 *  4. Bouton « Fin de journée » : synchronise puis télécharge un export JSON complet.
 *
 * Chargé en dernier (après sync.js) : script classique, utilise les globales de app-core.js
 * (state, records, $, val, toast, showTab...).
 */
(function(){
  'use strict';

  // ---------- 3. Plages de valeurs ----------
  // "habituel" (facultatif, aucun paramètre ne l'utilise pour l'instant) : plage de référence ;
  // en dehors, la valeur est signalée comme inhabituelle (simple confirmation).
  // "possible" : bornes physiques ; en dehors, c'est presque toujours une faute de frappe
  // (virgule oubliée, mauvaise unité) et l'enregistrement est bloqué.
  const PLAGES={
    ph:   {label:'pH',unit:'u.pH',possible:[0,14]},
    temp: {label:"Température de l'eau",unit:'°C',possible:[0,45]},
    air:  {label:"Température de l'air",unit:'°C',possible:[0,50]},
    cond: {label:'Conductivité',unit:'µS/cm',possible:[0,100000]},
    condus:{label:'Conductivité',unit:'µS/cm',possible:[0,100000]},
    condms:{label:'Conductivité',unit:'mS/cm',possible:[0,100]},
    o2mg: {label:'Oxygène dissous',unit:'mg/L',possible:[0,25]},
    o2pc: {label:'Saturation O₂',unit:'%',possible:[0,250]},
    turb: {label:'Turbidité',unit:'NTU',possible:[0,10000]},
    redox:{label:'Potentiel redox',unit:'mV',possible:[-1000,1000]}
  };
  const PROFONDEURS={surf:'surface',inter:'intermédiaire',fond:'fond'};

  // Identifie le paramètre d'un champ de mesure : iv_ph, iv_turb_2, el_ph_surf, el_turb_fond_1...
  function paramOf(id){
    let m=id.match(/^iv_([a-z0-9]+?)(?:_\d)?$/);
    if(m&&PLAGES[m[1]])return {k:m[1],where:''};
    m=id.match(/^el_([a-z0-9]+)_(surf|inter|fond)(?:_\d)?$/);
    if(m&&PLAGES[m[1]])return {k:m[1],where:PROFONDEURS[m[2]]};
    return null;
  }
  function num(v){const s=String(v??'').trim().replace(',','.');if(s==='')return null;const n=Number(s);return Number.isFinite(n)?n:NaN}
  function fmt(a){return a[0]+'–'+a[1]}

  // Retourne null (champ vide) ou {level:'ok'|'warn'|'bad', text}
  function checkValue(id,value){
    const p=paramOf(id);if(!p)return null;
    const n=num(value);if(n===null)return null;
    const z=PLAGES[p.k];
    if(Number.isNaN(n))return {level:'bad',text:'❌ nombre invalide'};
    if(n<z.possible[0]||n>z.possible[1])return {level:'bad',text:`❌ impossible (${fmt(z.possible)} ${z.unit}) — vérifiez la saisie`};
    if(z.habituel&&(n<z.habituel[0]||n>z.habituel[1]))return {level:'warn',text:`⚠ inhabituel (habituel ${fmt(z.habituel)} ${z.unit})`};
    return {level:'ok',text:'✓'};
  }
  function describe(id){const p=paramOf(id),z=PLAGES[p.k];return z.label+(p.where?' ('+p.where+')':'')}

  function statusEl(input){
    // Champ in situ classique : emplacement prévu <span id="ivs_ph"> ; sinon on en crée un.
    const planned=/^iv_[a-z0-9]+$/.test(input.id)?$('ivs_'+input.id.slice(3)):null;
    if(planned&&planned.style.display!=='none')return planned;
    let s=$(input.id+'__st');
    if(!s){s=document.createElement('span');s.id=input.id+'__st';input.insertAdjacentElement('afterend',s)}
    return s;
  }
  function refreshField(input){
    if(!input||!input.id||!paramOf(input.id))return;
    const r=checkValue(input.id,input.value),s=statusEl(input);
    if(!r){s.className='';s.textContent='';input.classList.remove('valueBad','valueWarn');return}
    s.className='valueStatus '+(r.level==='ok'?'ok':'alert');
    s.textContent=r.text;
    input.classList.toggle('valueBad',r.level==='bad');
    input.classList.toggle('valueWarn',r.level==='warn');
  }
  // Les cartes de la fiche (mesures in situ, prélèvement...) sont des enfants directs de <body>,
  // hors de #new : on utilise la même règle que inFiche() dans app-core.js.
  function inForm(el){return !!(el&&el.closest)&&(typeof inFiche==='function'?inFiche(el):!!el.closest('#new'))&&!el.closest('#endOfDayCard')}
  function measureInputs(){return [...document.querySelectorAll('input[id^="iv_"],input[id^="el_"]')].filter(i=>paramOf(i.id)&&inForm(i))}
  function refreshAllFields(){measureInputs().forEach(refreshField)}
  document.addEventListener('input',e=>{const t=e.target;if(t&&t.id&&inForm(t)){refreshField(t);t.classList.remove('fieldMissing')}});
  // Virgule décimale : sur une tablette dont le navigateur n'est pas en français, un champ
  // numérique ignorait la virgule (« 125,5 » devenait 1255, accepté sans alerte). On remplace
  // la virgule tapée par un point, compris par tous les navigateurs.
  document.addEventListener('beforeinput',e=>{
    const t=e.target;
    if(e.data===','&&t&&t.tagName==='INPUT'&&t.type==='number'&&inForm(t)){e.preventDefault();document.execCommand('insertText',false,'.')}
  },true);
  document.addEventListener('change',e=>{const t=e.target;if(inForm(t)){t.classList.remove('fieldMissing');t.closest('.fieldMissing')?.classList.remove('fieldMissing')}});
  // Les valeurs chargées par programme (modification d'une fiche, brouillon) ne déclenchent pas
  // d'événement : on rafraîchit régulièrement tant que l'onglet de saisie est affiché.
  // Formulaire vidé (fiche enregistrée ou « Effacer ») : on retire aussi les surlignages.
  function clearHighlights(){document.querySelectorAll('.fieldMissing').forEach(el=>el.classList.remove('fieldMissing'))}
  setInterval(()=>{
    if(!$('new')?.classList.contains('active'))return;
    refreshAllFields();
    if(!state.network)clearHighlights();
  },2000);

  // ---------- 2. Contrôle avant enregistrement ----------
  function preSaveProblems(){
    const blocking=[],warnings=[],fields=[];
    if(!state.network||!state.station)return {blocking,warnings,fields}; // message déjà géré par l'enregistrement
    if(!val('date')){blocking.push('Date de la visite');fields.push('date')}
    if(!val('start')){warnings.push('Heure de début');fields.push('start')}
    if(!(state.preleveurs||[]).length){warnings.push('Préleveur(s)');fields.push('preleveurs')}
    if(!val('xT')||!val('yT')){warnings.push('Coordonnées terrain (X / Y) — utilisez le bouton GPS si possible');fields.push('xT','yT')}
    measureInputs().forEach(i=>{
      const r=checkValue(i.id,i.value);if(!r||r.level==='ok')return;
      const line=`${describe(i.id)} = ${i.value} : ${r.text.replace(/^[❌⚠] /,'')}`;
      (r.level==='bad'?blocking:warnings).push(line);fields.push(i.id);
    });
    return {blocking,warnings,fields};
  }
  function highlight(ids){
    ids.forEach(id=>{const el=$(id);if(el)el.classList.add('fieldMissing')});
    const first=ids.map(id=>$(id)).find(Boolean);
    if(first&&first.scrollIntoView)first.scrollIntoView({behavior:'smooth',block:'center'});
  }

  const saveBtn=$('save');
  if(saveBtn&&typeof saveBtn.onclick==='function'){
    const originalSave=saveBtn.onclick;
    let saving=false;
    saveBtn.onclick=async function(ev){
      if(saving)return; // anti double-appui : un seul enregistrement à la fois
      const pb=preSaveProblems();
      if(pb.blocking.length){
        highlight(pb.fields);
        alert('Enregistrement impossible :\n\n• '+pb.blocking.join('\n• ')+(pb.warnings.length?'\n\nÀ vérifier aussi :\n• '+pb.warnings.join('\n• '):''));
        return;
      }
      if(pb.warnings.length&&!confirm('Avant d’enregistrer, vérifiez :\n\n• '+pb.warnings.join('\n• ')+'\n\nEnregistrer quand même ?')){highlight(pb.fields);return}
      saving=true;saveBtn.disabled=true;
      const label=saveBtn.textContent;saveBtn.textContent='⏳ Enregistrement…';
      try{await originalSave.call(this,ev)}
      finally{
        saving=false;saveBtn.disabled=false;clearHighlights();
        if(saveBtn.textContent==='⏳ Enregistrement…')saveBtn.textContent=label;
      }
    };
  }

  // ---------- 1. Indicateur de sauvegarde toujours visible ----------
  const pill=document.createElement('button');
  pill.type='button';pill.id='backupPill';pill.className='backupPill';
  pill.title='État des sauvegardes — touchez pour ouvrir l’onglet Données';
  pill.innerHTML='<span class="bpMain">…</span><span class="bpSub"></span>';
  document.querySelector('.topin')?.appendChild(pill);
  pill.onclick=()=>{if(typeof showTab==='function')showTab('data');const t=$('localFileStatus');if(t)t.scrollIntoView({behavior:'smooth',block:'center'})};

  function formatMo(bytes){return bytes>=1e9?(bytes/1e9).toFixed(1)+' Go':Math.max(1,Math.round(bytes/1e6))+' Mo'}
  let refreshTimer=null,refreshing=false,refreshAgain=false;
  async function refreshPill(){
    if(refreshing){refreshAgain=true;return}
    refreshing=true;
    try{
      let main,level;
      const st=window.OEGSync?.backupStatus?await window.OEGSync.backupStatus():null;
      if(!st||!st.configured){
        main=st&&st.localNeedsPermission?'⚠ Dossier de sauvegarde à réautoriser':'⚠ Sauvegarde automatique non configurée';level='warn';
      }else if(st.pending){
        main=`⏳ ${st.pending} fiche${st.pending>1?'s':''} à sauvegarder`;level='warn';
      }else{
        main=`✓ ${st.total} fiche${st.total>1?'s':''} sauvegardée${st.total>1?'s':''}`;level='ok';
      }
      const sub=[];
      if(!navigator.onLine)sub.push('hors ligne');
      try{
        const est=await navigator.storage?.estimate?.();
        if(est&&est.usage!=null){
          sub.push(formatMo(est.usage)+' utilisés');
          if(est.quota&&est.usage/est.quota>0.8){sub.push('stockage presque plein !');level='warn'}
        }
      }catch(e){}
      pill.querySelector('.bpMain').textContent=main;
      pill.querySelector('.bpSub').textContent=sub.join(' · ');
      pill.dataset.level=level;
    }catch(e){/* l'indicateur ne doit jamais gêner la saisie */}
    finally{
      refreshing=false;
      if(refreshAgain){refreshAgain=false;scheduleRefresh()}
    }
  }
  function scheduleRefresh(){if(refreshTimer)clearTimeout(refreshTimer);refreshTimer=setTimeout(refreshPill,1200)}
  ['oeg:records-changed','oeg:sync-done','online','offline'].forEach(ev=>window.addEventListener(ev,scheduleRefresh));
  (window.OEGRecordsReady||Promise.resolve()).then(()=>setTimeout(refreshPill,300));
  setInterval(refreshPill,60000);
  window.refreshBackupPill=refreshPill;

  // ---------- 4. Fin de journée ----------
  const data=$('data');
  if(data){
    const card=document.createElement('div');card.className='card';card.id='endOfDayCard';
    card.innerHTML='<h2>🌙 Fin de journée</h2>'+
      '<p class="note">Un seul bouton avant de ranger la tablette : envoie toutes les fiches vers le dossier de sauvegarde et Google Drive (si configurés), puis télécharge un export JSON complet de sécurité.</p>'+
      '<button class="btn primary" id="endOfDayBtn" type="button">🌙 Clôturer la journée</button><div id="endOfDayResult" style="margin-top:9px"></div>';
    data.insertBefore(card,data.firstChild);
    const btn=$('endOfDayBtn'),out=$('endOfDayResult');
    btn.onclick=async()=>{
      btn.disabled=true;out.className='banner info';out.textContent='Synchronisation en cours…';
      const lines=[];let ok=true;
      try{
        await (window.OEGRecordsReady||Promise.resolve());
        if(window.OEGSync){
          await window.OEGSync.manualSyncNow();
          const st=await window.OEGSync.backupStatus();
          if(!st.configured){ok=false;lines.push('⚠ Aucune sauvegarde automatique configurée (dossier local ou Google Drive) : l’export JSON ci-dessous est la seule copie hors de la tablette.')}
          else if(st.pending){ok=false;lines.push(`⚠ ${st.pending} fiche(s) pas encore sauvegardée(s)`+(navigator.onLine?' — réessayez dans un instant.':' — pas de connexion : la synchronisation reprendra dès le retour du réseau.'))}
          else lines.push(`✓ ${st.total} fiche(s) sauvegardée(s)`+(st.drive?' sur Google Drive':'')+(st.drive&&st.local?' et':'')+(st.local?' dans le dossier local':'')+'.');
        }
        $('exportJSON')?.click();
        lines.push('✓ Export JSON de sécurité téléchargé (dossier Téléchargements de la tablette).');
      }catch(e){ok=false;lines.push('⚠ Problème pendant la clôture : '+(e&&e.message||e)+'. Faites un export JSON manuel.')}
      finally{btn.disabled=false}
      out.className='banner '+(ok?'info':'danger');
      out.textContent=lines.join('\n');out.style.whiteSpace='pre-line';
      refreshPill();
    };
  }
})();
