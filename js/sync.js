/* js/sync.js — Sauvegarde locale (un dossier, une fiche = un fichier) + synchronisation Google Drive.
 *
 * Ce module est chargé après app-core.js et quality.js (variables/fonctions globales partagées :
 * records, custom, LS, LSC, $, sha256, stableObj — script classique, pas de module ES).
 *
 * Principe général :
 *  - saveLS() (dans app-core.js) appelle window.OEGSync.notifyChange() à chaque sauvegarde.
 *  - notifyChange() attend 1,5 s (regroupe les sauvegardes rapprochées) puis lance performSync().
 *  - performSync() calcule un "hash" du contenu de CHAQUE fiche et de 3 fichiers additionnels
 *    (référentiel opérateurs/équipements/stations, qualité, et un index CSV listant toutes les
 *    fiches). Seuls les fichiers dont le contenu a réellement changé depuis la dernière écriture
 *    sont réécrits — les fiches non modifiées ne sont JAMAIS touchées, ni en local ni sur Drive.
 *  - Le nom de fichier d'une fiche est recalculé à chaque passage à partir de son contenu actuel
 *    (réseau, station, date). S'il a changé depuis la dernière écriture (ex. la date a été
 *    corrigée), un NOUVEAU fichier est créé sous le nouveau nom — l'ancien fichier n'est JAMAIS
 *    supprimé ni modifié, ni en local ni sur Drive : il reste tel quel, comme une version
 *    précédente de la fiche.
 *  - En cas d'échec (hors-ligne, permission perdue...), le hash n'est mis à jour qu'après succès :
 *    la fiche concernée est donc retentée automatiquement au prochain passage.
 */
(function(){
  'use strict';

  const DRIVE_CFG_KEY = 'oeg_sync_drive_cfg_v1';
  const LOCAL_HASH_KEY = 'oeg_sync_local_hashes_v1';
  const LOCAL_NAMES_KEY = 'oeg_sync_local_filenames_v1';
  const DRIVE_HASH_KEY = 'oeg_sync_drive_hashes_v1';
  const DRIVE_FILEIDS_KEY = 'oeg_sync_drive_fileids_v1';
  const DRIVE_NAMES_KEY = 'oeg_sync_drive_filenames_v1';
  const DRIVE_VERSIONS_KEY = 'oeg_sync_drive_versions_v1';
  const DEBOUNCE_MS = 1500;
  const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
  const DRIVE_FOLDER_NAME = 'Fiches terrain OEG';
  const REF_KEY = '_referentiel';
  const QUALITE_KEY = '_qualite';
  const INDEX_KEY = '_index';

  let debounceTimer = null;
  let syncing = false;
  let syncAgainAfter = false;

  // ---------- petit magasin IndexedDB (handle de dossier uniquement — non sérialisable en JSON) ----------
  function idbOpen(){
    return new Promise((resolve,reject)=>{
      if(!('indexedDB' in window)){reject(new Error('no-idb'));return}
      const req = indexedDB.open('oeg-sync-db',1);
      req.onupgradeneeded = ()=>{req.result.createObjectStore('kv')};
      req.onsuccess = ()=>resolve(req.result);
      req.onerror = ()=>reject(req.error);
    });
  }
  async function idbGet(key){
    try{
      const db = await idbOpen();
      return await new Promise((resolve,reject)=>{
        const tx = db.transaction('kv','readonly');
        const r = tx.objectStore('kv').get(key);
        r.onsuccess = ()=>resolve(r.result);
        r.onerror = ()=>reject(r.error);
      });
    }catch(e){return undefined}
  }
  async function idbSet(key,value){
    try{
      const db = await idbOpen();
      return await new Promise((resolve,reject)=>{
        const tx = db.transaction('kv','readwrite');
        tx.objectStore('kv').put(value,key);
        tx.oncomplete = ()=>resolve(true);
        tx.onerror = ()=>reject(tx.error);
      });
    }catch(e){return false}
  }
  async function idbDelete(key){
    try{
      const db = await idbOpen();
      return await new Promise((resolve,reject)=>{
        const tx = db.transaction('kv','readwrite');
        tx.objectStore('kv').delete(key);
        tx.oncomplete = ()=>resolve(true);
        tx.onerror = ()=>reject(tx.error);
      });
    }catch(e){return false}
  }

  // ---------- petites tables JSON dans localStorage ----------
  function loadJson(key, fallback){
    try{const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback}catch(e){return fallback}
  }
  function saveJson(key, value){
    try{localStorage.setItem(key, JSON.stringify(value))}catch(e){}
  }

  let localFolderHandle = null;                   // FileSystemDirectoryHandle | null
  let localHashes = loadJson(LOCAL_HASH_KEY, {});  // id -> hash déjà écrit localement
  let localNames  = loadJson(LOCAL_NAMES_KEY, {}); // id -> nom de fichier attribué
  let driveHashes = loadJson(DRIVE_HASH_KEY, {});  // id -> hash déjà envoyé sur Drive
  let driveFileIds = loadJson(DRIVE_FILEIDS_KEY, {}); // id -> Drive fileId
  let driveNames = loadJson(DRIVE_NAMES_KEY, {});  // id -> nom de fichier actuel sur Drive
  let driveVersions = loadJson(DRIVE_VERSIONS_KEY, {}); // id -> numéro de version Drive du fichier, tel que vu lors du dernier envoi/téléchargement
  let driveCfg = loadJson(DRIVE_CFG_KEY, {clientId:'', folderId:'', connected:false});

  let driveAccessToken = null;
  let driveTokenExpiresAt = 0;
  let tokenClient = null;
  let gisLoading = null;

  function saveDriveCfg(){ saveJson(DRIVE_CFG_KEY, driveCfg) }
  function saveLocalHashes(){ saveJson(LOCAL_HASH_KEY, localHashes) }
  function saveLocalNames(){ saveJson(LOCAL_NAMES_KEY, localNames) }
  function saveDriveHashes(){ saveJson(DRIVE_HASH_KEY, driveHashes) }
  function saveDriveFileIds(){ saveJson(DRIVE_FILEIDS_KEY, driveFileIds) }
  function saveDriveNames(){ saveJson(DRIVE_NAMES_KEY, driveNames) }
  function saveDriveVersions(){ saveJson(DRIVE_VERSIONS_KEY, driveVersions) }

  // ---------- utilitaires de contenu ----------
  function safeName(s){
    return String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'')
      .replace(/[^A-Za-z0-9_-]+/g,'_').replace(/^_+|_+$/g,'').slice(0,50) || 'sans_nom';
  }

  async function hashOf(obj){
    return await sha256(JSON.stringify(stableObj(obj)));
  }

  function filenameForRecord(r){
    return `fiche_${safeName(r.network)}_${safeName(r.station)}_${safeName(r.date)}_${safeName(r.id)}.json`;
  }

  function referentielPayload(){
    return {
      type: 'referentiel_operateurs_equipements_stations',
      preleveurs: custom.preleveurs || [],
      equipements: custom.equipements || [],
      stations: custom.stations || [],
      stationAccess: custom.stationAccess || {},
      exportedAt: new Date().toISOString()
    };
  }
  function qualitePayload(){
    return {
      type: 'qualite_audit_non_conformites',
      nonConformites: custom.nonConformites || [],
      auditTrail: custom.auditTrail || [],
      qualityConfig: custom.qualityConfig || {},
      exportedAt: new Date().toISOString()
    };
  }

  function csvEscape(v){
    let s = String(v??'');
    s = s.replace(/"/g,'""');
    return /[";\n]/.test(s) ? '"'+s+'"' : s;
  }
  function indexCsvPayload(){
    const rows = [['id','reseau','station','date','heureDebut','heureFin','statut','version','nomFichier'].join(';')];
    records.slice().sort((a,b)=>String(a.date||'').localeCompare(String(b.date||''))).forEach(r=>{
      rows.push([r.id, r.network, r.station, r.date, r.heureDebut, r.heureFin, r.lifecycle?.status||'À contrôler', r.lifecycle?.version||1, filenameForRecord(r)].map(csvEscape).join(';'));
    });
    return '\uFEFF' + rows.join('\r\n');
  }

  // Construit la liste des "items" à examiner : chaque fiche + les fichiers de référence/index.
  // item.filename est toujours recalculé à partir du contenu ACTUEL de la fiche (réseau, station,
  // date...) : si ces champs changent, le nom souhaité change aussi, ce qui déclenche un
  // renommage du fichier au moment de l'écriture (voir syncLocalFolder / syncDrive).
  async function collectItems(){
    await (window.OEGRecordsReady||Promise.resolve()); // jamais sur une liste de fiches incomplète
    const items = [];
    for(const r of records){
      // Fiche « allégée » (photos retirées de la tablette par une ancienne version de l'appli) :
      // elle n'est JAMAIS réécrite dans le dossier ni sur Drive, où se trouve la seule copie de ses
      // photos (auparavant toute modification écrasait le fichier par une version sans photos).
      // « Récupérer l'historique » lui rend ses photos, puis elle est de nouveau sauvegardée.
      if(r._archived) continue;
      items.push({id: r.id, filename: filenameForRecord(r), content: r, hash: await hashOf(r)});
    }
    const ref = referentielPayload();
    const qual = qualitePayload();
    // Le hash exclut "exportedAt" (horodatage toujours différent) pour ne pas déclencher
    // une réécriture à chaque passage alors que le contenu réel n'a pas changé.
    const { exportedAt: _refTs, ...refForHash } = ref;
    const { exportedAt: _qualTs, ...qualForHash } = qual;
    items.push({id: REF_KEY, filename: '_referentiel_operateurs_equipements_stations.json', content: ref, hash: await hashOf(refForHash)});
    items.push({id: QUALITE_KEY, filename: '_qualite_audit_non-conformites.json', content: qual, hash: await hashOf(qualForHash)});
    const csvText = indexCsvPayload();
    items.push({id: INDEX_KEY, filename: '_index_fiches.csv', content: null, text: csvText, hash: await sha256(csvText)});
    return items;
  }

  // ---------- dossier local (File System Access API) ----------
  function localFolderSupported(){
    return 'showDirectoryPicker' in window;
  }

  async function chooseLocalFolder(){
    if(!localFolderSupported()){
      if(typeof toast==='function') toast("Non disponible sur ce navigateur — utilisez l'export JSON manuel.");
      return;
    }
    try{
      const handle = await window.showDirectoryPicker({mode:'readwrite'});
      localFolderHandle = handle;
      // Nouveau dossier : il faut y écrire TOUTES les fiches. Auparavant les empreintes du dossier
      // précédent étaient conservées : le nouveau dossier restait vide alors que l'appli affichait
      // « N fiches sauvegardées ».
      localHashes = {}; localNames = {}; saveLocalHashes(); saveLocalNames();
      await idbSet('localFolderHandle', handle);
      renderLocalStatus('Écriture des fiches en cours...');
      await syncLocalFolder(await collectItems());
      renderLocalStatus();
    }catch(e){
      if(e && e.name !== 'AbortError' && typeof toast==='function') toast('Impossible de configurer le dossier local.');
    }
  }

  async function forgetLocalFolder(){
    localFolderHandle = null;
    localHashes = {}; localNames = {}; saveLocalHashes(); saveLocalNames();
    await idbDelete('localFolderHandle');
    renderLocalStatus();
  }

  async function tryReacquireLocalFolder(){
    try{
      const handle = await idbGet('localFolderHandle');
      if(handle) localFolderHandle = handle;
    }catch(e){}
    renderLocalStatus();
  }

  async function localPermissionState(){
    if(!localFolderHandle) return 'none';
    try{return await localFolderHandle.queryPermission({mode:'readwrite'})}catch(e){return 'none'}
  }

  // Redemande l'autorisation dans le contexte du clic utilisateur (exigé par le navigateur).
  async function reauthorizeLocalFolder(){
    if(!localFolderHandle){await chooseLocalFolder(); return}
    try{
      const p = await localFolderHandle.requestPermission({mode:'readwrite'});
      if(p === 'granted'){
        renderLocalStatus('Écriture des fiches en cours...');
        await syncLocalFolder(await collectItems());
        renderLocalStatus();
      }else{
        if(typeof toast==='function') toast('Autorisation refusée pour le dossier local.');
      }
    }catch(e){
      await chooseLocalFolder();
    }
  }

  function itemText(item){
    return item.text !== undefined ? item.text : JSON.stringify(item.content, null, 2);
  }

  // N'écrit que les fiches / fichiers de référence dont le contenu a changé depuis la dernière
  // écriture réussie. Les autres fichiers déjà présents dans le dossier ne sont pas touchés.
  // Si le nom de fichier souhaité d'une fiche a changé (ex. la date a été modifiée), un NOUVEAU
  // fichier est créé sous le nouveau nom — l'ancien fichier n'est jamais supprimé ni modifié,
  // il reste tel quel dans le dossier.
  async function syncLocalFolder(items){
    if(!localFolderHandle) return {written:0, ok:false, reason:'no-handle'};
    let perm = await localFolderHandle.queryPermission({mode:'readwrite'});
    if(perm !== 'granted') return {written:0, ok:false, reason:'permission'};
    let written = 0, failed = 0;
    for(const item of items){
      if(localHashes[item.id] === item.hash) continue; // rien de changé pour cette fiche
      try{
        const fh = await localFolderHandle.getFileHandle(item.filename, {create:true});
        const writable = await fh.createWritable();
        await writable.write(itemText(item));
        await writable.close();
        localHashes[item.id] = item.hash;
        localNames[item.id] = item.filename;
        written++;
      }catch(e){
        failed++; // on retentera cette fiche précise au prochain passage
      }
    }
    if(written){saveLocalHashes(); saveLocalNames()}
    if(written) localStorage.setItem('oeg_sync_local_last', new Date().toISOString());
    return {written, failed, ok: failed===0};
  }

  // ---------- Google Drive (même principe : un fichier par fiche, dans un dossier dédié) ----------
  function loadGisScript(){
    if(window.google && window.google.accounts && window.google.accounts.oauth2) return Promise.resolve();
    if(gisLoading) return gisLoading;
    gisLoading = new Promise((resolve,reject)=>{
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.async = true;
      s.onload = ()=>resolve();
      s.onerror = ()=>reject(new Error('gis-load-failed'));
      document.head.appendChild(s);
    });
    return gisLoading;
  }

  function ensureTokenClient(){
    if(tokenClient) return tokenClient;
    if(!driveCfg.clientId){throw new Error('no-client-id')}
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: driveCfg.clientId,
      scope: DRIVE_SCOPE,
      callback: ()=>{}
    });
    return tokenClient;
  }

  function requestTokenAsync(promptMode){
    return new Promise((resolve,reject)=>{
      try{
        const client = ensureTokenClient();
        client.callback = (resp)=>{
          if(resp && resp.access_token){
            driveAccessToken = resp.access_token;
            driveTokenExpiresAt = Date.now() + ((resp.expires_in||3300) * 1000);
            resolve(resp);
          }else{
            reject(new Error('no-token'));
          }
        };
        client.error_callback = (err)=>{reject(err)};
        client.requestAccessToken({prompt: promptMode});
      }catch(e){reject(e)}
    });
  }

  async function ensureValidToken(interactive){
    if(driveAccessToken && Date.now() < driveTokenExpiresAt - 60000) return true;
    try{
      await loadGisScript();
      await requestTokenAsync(interactive ? 'consent' : '');
      return true;
    }catch(e){
      return false;
    }
  }

  async function driveFetch(url, options){
    const resp = await fetch(url, options);
    if(!resp.ok) throw new Error('drive-http-'+resp.status);
    return resp;
  }

  // Le dossier Drive mémorisé est vérifié une fois par session : s'il n'existe plus (supprimé, ou
  // autre compte Google connecté), on oublie tout ce qui concernait l'ancien dossier et les fiches
  // sont réenvoyées. Auparavant la sauvegarde Drive ne reprenait jamais, tout en restant affichée
  // comme « à jour ».
  let folderVerified = false;
  function resetDriveTables(){
    driveCfg.folderId = ''; saveDriveCfg();
    driveHashes = {}; driveFileIds = {}; driveNames = {}; driveVersions = {};
    saveDriveHashes(); saveDriveFileIds(); saveDriveNames(); saveDriveVersions();
  }
  async function ensureDriveFolder(){
    if(driveCfg.folderId && !folderVerified){
      try{
        const r = await fetch(`https://www.googleapis.com/drive/v3/files/${driveCfg.folderId}?fields=id,trashed`, {headers:{'Authorization':'Bearer ' + driveAccessToken}});
        if(r.status === 404) resetDriveTables();
        else if(r.ok){ const j = await r.json().catch(()=>({})); if(j.trashed) resetDriveTables(); else folderVerified = true; }
      }catch(e){ /* réseau : on garde le dossier, nouvelle vérification au prochain passage */ }
    }
    if(driveCfg.folderId) return driveCfg.folderId;
    folderVerified = true;
    const q = encodeURIComponent(`name='${DRIVE_FOLDER_NAME.replace(/'/g,"\\'")}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
    const listResp = await driveFetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)`, {
      headers:{'Authorization':'Bearer ' + driveAccessToken}
    });
    const listJson = await listResp.json();
    if(listJson.files && listJson.files.length){
      driveCfg.folderId = listJson.files[0].id;
      saveDriveCfg();
      return driveCfg.folderId;
    }
    const createResp = await driveFetch('https://www.googleapis.com/drive/v3/files', {
      method:'POST',
      headers:{'Authorization':'Bearer ' + driveAccessToken, 'Content-Type':'application/json'},
      body: JSON.stringify({name: DRIVE_FOLDER_NAME, mimeType:'application/vnd.google-apps.folder'})
    });
    const createJson = await createResp.json();
    driveCfg.folderId = createJson.id;
    saveDriveCfg();
    return driveCfg.folderId;
  }

  function mimeFor(filename){
    return filename.endsWith('.csv') ? 'text/csv' : 'application/json';
  }

  async function driveCreateFile(filename, folderId, text){
    const metadata = {name: filename, parents:[folderId], mimeType: mimeFor(filename)};
    const boundary = 'oegboundary' + Date.now() + Math.random().toString(36).slice(2);
    const body =
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
      `--${boundary}\r\nContent-Type: ${mimeFor(filename)}\r\n\r\n${text}\r\n--${boundary}--`;
    const resp = await driveFetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,version', {
      method:'POST',
      headers:{'Authorization':'Bearer ' + driveAccessToken, 'Content-Type':'multipart/related; boundary=' + boundary},
      body
    });
    const json = await resp.json();
    return {id: json.id, version: json.version};
  }

  // Met à jour le contenu ET le nom en une seule requête : si le nom souhaité a changé
  // (ex. la date de la fiche a été modifiée), le fichier Drive est renommé au passage —
  // pas besoin de le recréer, Drive l'identifie par son fileId, pas par son nom.
  async function driveUpdateFile(fileId, filename, text){
    const metadata = {name: filename};
    const boundary = 'oegboundary' + Date.now() + Math.random().toString(36).slice(2);
    const body =
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
      `--${boundary}\r\nContent-Type: ${mimeFor(filename)}\r\n\r\n${text}\r\n--${boundary}--`;
    const resp = await driveFetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=multipart&fields=id,version`, {
      method:'PATCH',
      headers:{'Authorization':'Bearer ' + driveAccessToken, 'Content-Type':'multipart/related; boundary=' + boundary},
      body
    });
    const json = await resp.json().catch(()=>({}));
    return json.version;
  }

  // Numéro de version actuel d'un fichier Drive (Drive l'incrémente à chaque modification,
  // quelle que soit la tablette qui modifie le fichier).
  async function driveFileVersion(fileId){
    const resp = await driveFetch(`https://www.googleapis.com/drive/v3/files/${fileId}?fields=version`, {headers:{'Authorization':'Bearer ' + driveAccessToken}});
    const json = await resp.json();
    return json.version;
  }
  async function driveDownloadJson(fileId){
    const resp = await driveFetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {headers:{'Authorization':'Bearer ' + driveAccessToken}});
    return await resp.json();
  }

  // N'envoie que les fiches / fichiers de référence dont le contenu a changé depuis le dernier
  // envoi réussi vers Drive. Si le nom souhaité d'une fiche a changé (ex. date modifiée), un
  // NOUVEAU fichier Drive est créé — l'ancien fichier n'est ni supprimé ni renommé.
  async function syncDrive(items){
    if(!driveCfg.connected) return {ok:false, reason:'not-connected'};
    if(!navigator.onLine) return {ok:false, reason:'offline'};
    const authOk = await ensureValidToken(false);
    if(!authOk){renderDriveStatus('Reconnexion nécessaire'); return {ok:false, reason:'auth'}}
    let folderId;
    try{ folderId = await ensureDriveFolder() }
    catch(e){ renderDriveStatus('Impossible de créer le dossier Drive'); return {ok:false, reason:'folder'} }
    let written = 0, failed = 0;
    const mergeStats = {conflicts:0, merged:0};
    for(const item of items){
      if(driveHashes[item.id] === item.hash) continue; // déjà à jour sur Drive
      const text = itemText(item);
      try{
        // Fichier déjà connu : mis à jour EN PLACE, et renommé si la date ou la station a changé.
        // (Auparavant un changement de nom créait un second fichier : une autre tablette pouvait
        // alors modifier l'ancien sans que personne ne détecte le conflit, et l'une des deux
        // versions était perdue. Drive conserve de toute façon l'historique des versions.)
        if(driveFileIds[item.id]){
          // Fiche : avant d'écraser le fichier Drive, on vérifie qu'aucune autre tablette ne
          // l'a modifié depuis notre dernier passage. Si c'est le cas, on ne l'écrase pas : on
          // télécharge sa version et on la fusionne (même règle que "Récupérer l'historique"),
          // puis l'envoi se refait au passage suivant, sur la fiche fusionnée.
          if(!item.id.startsWith('_') && await remoteChangedElsewhere(item.id)){
            await mergeRemoteRecord(await driveDownloadJson(driveFileIds[item.id]), driveFileIds[item.id], driveNames[item.id], await driveFileVersion(driveFileIds[item.id]), mergeStats);
            mergeStats.merged++;
            continue;
          }
          const version = await driveUpdateFile(driveFileIds[item.id], item.filename, text);
          if(version !== undefined) driveVersions[item.id] = version;
        }else{
          const created = await driveCreateFile(item.filename, folderId, text);
          driveFileIds[item.id] = created.id;
          if(created.version !== undefined) driveVersions[item.id] = created.version;
          saveDriveFileIds();
        }
        driveHashes[item.id] = item.hash;
        driveNames[item.id] = item.filename;
        written++;
      }catch(e){
        // Fichier supprimé sur Drive : on l'oublie pour le recréer au prochain passage
        // (auparavant la fiche échouait indéfiniment).
        if(String(e && e.message) === 'drive-http-404'){
          delete driveFileIds[item.id]; delete driveNames[item.id]; delete driveVersions[item.id]; delete driveHashes[item.id];
          saveDriveFileIds(); saveDriveNames(); saveDriveVersions(); saveDriveHashes();
        }
        failed++; // sera retenté au prochain passage
      }
    }
    if(written){saveDriveHashes(); saveDriveNames()}
    if(written) localStorage.setItem('oeg_sync_drive_last', new Date().toISOString());
    saveDriveVersions();
    if(mergeStats.merged){
      // Fiches fusionnées avec la version d'une autre tablette : on enregistre (ce qui relance
      // une synchronisation pour envoyer le résultat) et on prévient l'agent.
      saveDriveFileIds(); saveDriveHashes(); saveDriveNames();
      saveLS(LS, records);
      if(typeof updateCount==='function') updateCount();
      if(typeof renderList==='function') renderList();
      if(typeof toast==='function') toast(mergeStats.conflicts
        ? `⚠ ${mergeStats.conflicts} fiche(s) modifiée(s) aussi sur une autre tablette : les deux versions sont conservées, vérifiez l'onglet Fiches.`
        : `${mergeStats.merged} fiche(s) mise(s) à jour depuis une autre tablette ✓`);
    }
    renderDriveStatus();
    return {written, failed, ok: failed===0};
  }

  async function connectDrive(){
    const clientIdInput = $('driveClientId');
    const clientId = clientIdInput ? clientIdInput.value.trim() : '';
    if(!clientId){
      if(typeof toast==='function') toast("Renseignez d'abord le Client ID Google (voir le guide).");
      return;
    }
    driveCfg.clientId = clientId;
    saveDriveCfg();
    try{
      await loadGisScript();
      tokenClient = null;
      await requestTokenAsync('consent');
      driveCfg.connected = true;
      folderVerified = false; // autre compte possible : le dossier mémorisé sera vérifié
      saveDriveCfg();
      renderDriveStatus('Envoi des fiches en cours...');
      await syncDrive(await collectItems());
    }catch(e){
      if(typeof toast==='function') toast('Connexion à Google Drive impossible. Vérifiez le Client ID.');
      renderDriveStatus();
    }
  }

  function disconnectDrive(){
    driveCfg.connected = false;
    driveAccessToken = null;
    driveTokenExpiresAt = 0;
    saveDriveCfg();
    renderDriveStatus();
  }

  // Récupère TOUTES les fiches du dossier Drive partagé (utile quand plusieurs tablettes,
  // connectées au même compte Google, contribuent chacune une partie des visites sur une
  // station : sans cet appel, l'historique et l'histogramme du CRT ne voient que les fiches
  // déjà présentes sur CET appareil). Les fiches récupérées sont fusionnées dans "records"
  // (ajoutées si nouvelles ; pour une fiche déjà connue, la version la plus récente l'emporte et une
  // version divergente est conservée en copie de conflit) puis sauvegardées localement — elles
  // seront donc aussi recopiées dans le dossier local de cet appareil au prochain passage.
  async function pullFromDrive(){
    if(!driveCfg.connected){if(typeof toast==='function')toast("Connectez d'abord Google Drive.");return {ok:false,reason:'not-connected'}}
    if(!navigator.onLine){if(typeof toast==='function')toast('Pas de connexion : impossible de récupérer l\u2019historique.');return {ok:false,reason:'offline'}}
    const authOk=await ensureValidToken(false);
    if(!authOk){renderDriveStatus('Reconnexion nécessaire');return {ok:false,reason:'auth'}}
    let folderId;
    try{folderId=await ensureDriveFolder()}catch(e){renderDriveStatus('Impossible d\u2019accéder au dossier Drive');return {ok:false,reason:'folder'}}
    renderDriveStatus('Récupération de l\u2019historique en cours…');
    let files=[],pageToken;
    try{
      do{
        const q=encodeURIComponent(`'${folderId}' in parents and trashed=false`);
        let url=`https://www.googleapis.com/drive/v3/files?q=${q}&fields=nextPageToken,files(id,name,version)&pageSize=1000`;
        if(pageToken)url+='&pageToken='+encodeURIComponent(pageToken);
        const resp=await driveFetch(url,{headers:{'Authorization':'Bearer '+driveAccessToken}});
        const json=await resp.json();
        files=files.concat(json.files||[]);
        pageToken=json.nextPageToken;
      }while(pageToken);
    }catch(e){renderDriveStatus('Échec de la récupération de la liste des fiches');return {ok:false,reason:'list'}}
    // 1) Téléchargement : une même fiche peut exister dans plusieurs fichiers Drive (un
    //    changement de date/station crée un nouveau fichier, l'ancien reste comme version
    //    précédente). On ne retient que la version la plus récente de chaque fiche.
    let failed=0;
    const remoteById=new Map();
    for(const f of files){
      if(f.name.startsWith('_'))continue; // fichiers de référence (équipements, qualité), pas des fiches
      try{
        const resp=await driveFetch(`https://www.googleapis.com/drive/v3/files/${f.id}?alt=media`,{headers:{'Authorization':'Bearer '+driveAccessToken}});
        const rec=await resp.json();
        if(!rec||!rec.id){failed++;continue}
        const prev=remoteById.get(rec.id);
        if(!prev||recordStamp(rec)>recordStamp(prev.rec))remoteById.set(rec.id,{rec,fileId:f.id,name:f.name,version:f.version});
      }catch(e){failed++}
    }
    // 2) Fusion avec les fiches de cet appareil, fondée sur la date de dernière modification.
    //    Règle d'or : une saisie locale n'est JAMAIS écrasée sans être conservée. Quand les deux
    //    versions ont divergé (modifiée ici ET sur une autre tablette), la plus récente devient
    //    la fiche principale et l'autre est gardée comme "copie de conflit" à examiner.
    await (window.OEGRecordsReady||Promise.resolve());
    const stats={imported:0,updated:0,kept:0,conflicts:0};
    for(const {rec,fileId,name,version} of remoteById.values())await mergeRemoteRecord(rec,fileId,name,version,stats);
    const {imported,updated,kept,conflicts}=stats,restored=stats.restoredPhotos||0;
    saveDriveFileIds();saveDriveHashes();saveDriveNames();saveDriveVersions();
    if(imported||updated||conflicts){
      saveLS(LS,records);
      if(typeof updateCount==='function')updateCount();
      if(typeof renderList==='function')renderList();
    }
    renderDriveStatus();
    window.dispatchEvent(new Event('oeg:sync-done'));
    if(typeof toast==='function')toast(`Historique récupéré : ${imported} nouvelle(s) fiche(s), ${updated} mise(s) à jour`+(kept?`, ${kept} version(s) locale(s) plus récente(s) conservée(s)`:'')+(restored?`, photos rendues à ${restored} fiche(s) allégée(s)`:'')+(failed?`, ${failed} échec(s)`:'')+' ✓'+(conflicts?` — ⚠ ${conflicts} conflit(s) : une copie a été conservée, vérifiez l'onglet Fiches.`:''));
    return {ok:true,imported,updated,kept,conflicts,failed};
  }

  // Fusionne UNE fiche venue de Drive avec celle de cet appareil, selon la date de dernière
  // modification. Règle d'or : une saisie n'est JAMAIS écrasée sans être conservée. Quand les
  // deux versions ont divergé (modifiée ici ET sur une autre tablette), la plus récente devient
  // la fiche principale et l'autre est gardée comme "copie de conflit" à examiner.
  async function mergeRemoteRecord(rec,fileId,name,version,stats){
    if(!rec||!rec.id)return;
    const id=rec.id;
    const remoteHash=await hashOf(rec);
    const adoptRemote=()=>{driveFileIds[id]=fileId;driveNames[id]=name;driveHashes[id]=remoteHash;if(version!==undefined)driveVersions[id]=version};
    const idx=records.findIndex(r=>r.id===id);
    if(idx===-1){records.push(rec);adoptRemote();stats.imported=(stats.imported||0)+1;return}
    const local=records[idx];
    // Fiche allégée ici, complète sur Drive : on lui rend ses photos avant de comparer
    // (auparavant chaque récupération créait une fausse copie de conflit).
    if(local._archived&&!rec._archived&&Array.isArray(rec.photos)){
      local.photos=rec.photos.map(p=>p&&typeof p==='object'?{...p}:p);
      delete local._archived;delete local._archivedAt;delete local._archivedPhotoCount;
      stats.restoredPhotos=(stats.restoredPhotos||0)+1;
    }
    const localHash=await hashOf(local);
    if(localHash===remoteHash){adoptRemote();return}
    const localDirty=driveHashes[id]!==localHash;   // modifications locales pas encore envoyées sur Drive
    const remoteSeen=driveHashes[id]===remoteHash;  // version Drive déjà connue de cet appareil
    const remoteNewer=recordStamp(rec)>recordStamp(local);
    const editingId=(typeof state!=='undefined'&&state)?state.editing:null;
    if(remoteNewer&&id!==editingId){
      if(localDirty){records.push(await conflictCopy(local,'cette tablette'));stats.conflicts=(stats.conflicts||0)+1}
      records[idx]=rec;adoptRemote();stats.updated=(stats.updated||0)+1;
    }else{
      // Version locale plus récente (ou fiche ouverte en cours de modification) : elle est
      // conservée et sera envoyée sur Drive. Si la version Drive contient des modifications
      // inconnues ici (autre tablette), elle est d'abord gardée en copie de conflit.
      if(!remoteSeen&&!conflictAlreadyCopied(id,remoteHash)){records.push(await conflictCopy(rec,'Google Drive'));markConflictCopied(id,remoteHash);stats.conflicts=(stats.conflicts||0)+1}
      // La version Drive est désormais connue : le prochain envoi pourra la remplacer.
      if(fileId===driveFileIds[id]&&version!==undefined)driveVersions[id]=version;
      stats.kept=(stats.kept||0)+1;
    }
  }

  // Une même version distante n'est copiée qu'une fois (auparavant, « Récupérer l'historique »
  // pendant la modification d'une fiche créait une copie de conflit de plus à chaque appui).
  const CONFLICTS_SEEN_KEY = 'oeg_sync_conflicts_seen_v1';
  let conflictsSeen = loadJson(CONFLICTS_SEEN_KEY, {});
  function conflictAlreadyCopied(id, hash){ return !!conflictsSeen[id + ':' + hash] }
  function markConflictCopied(id, hash){ conflictsSeen[id + ':' + hash] = 1; saveJson(CONFLICTS_SEEN_KEY, conflictsSeen) }

  // Le fichier Drive de cette fiche a-t-il été modifié ailleurs depuis notre dernier passage ?
  async function remoteChangedElsewhere(id){
    const fileId=driveFileIds[id];
    const current=await driveFileVersion(fileId);
    if(current===undefined)return false; // vérification impossible : comportement habituel
    if(driveVersions[id]!==undefined)return String(current)!==String(driveVersions[id]);
    // Fichier envoyé par une version précédente de l'appli (numéro de version inconnu) :
    // on compare son contenu avec ce que cet appareil y a envoyé en dernier.
    const rec=await driveDownloadJson(fileId);
    if(rec&&await hashOf(rec)===driveHashes[id]){driveVersions[id]=current;return false}
    return true;
  }

  // Duplique une fiche sous un nouvel identifiant, marquée comme copie de conflit, pour que
  // les deux versions divergentes restent disponibles (rien n'est perdu ; l'agent choisit).
  async function conflictCopy(r,origine){
    const copy=JSON.parse(JSON.stringify(r));
    copy.id=r.id+'_conflit_'+Date.now().toString(36)+Math.random().toString(36).slice(2,5);
    copy.conflict={originalId:r.id,origine,detectedAt:new Date().toISOString()};
    if(copy.lifecycle&&copy.lifecycle.integrityHash&&typeof integrityPayload==='function'){
      try{
        const validBefore=r.lifecycle.integrityHash===await sha256(integrityPayload(r));
        if(validBefore)copy.lifecycle.integrityHash=await sha256(integrityPayload(copy));
      }catch(e){}
    }
    return copy;
  }

  // ---------- orchestration ----------
  function notifyChange(){
    if(debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(performSync, DEBOUNCE_MS);
  }

  async function performSync(){
    if(syncing){syncAgainAfter = true; return}
    syncing = true;
    try{
      // Jamais de synchronisation avant la fin du chargement des fiches (IndexedDB) :
      // l'index et les fichiers seraient calculés sur une liste incomplète.
      await (window.OEGRecordsReady||Promise.resolve());
      const items = await collectItems();
      if(localFolderHandle) await syncLocalFolder(items);
      if(driveCfg.connected) await syncDrive(items);
      renderLocalStatus();
    } finally {
      syncing = false;
      window.dispatchEvent(new Event('oeg:sync-done'));
      if(syncAgainAfter){syncAgainAfter = false; notifyChange()}
    }
  }

  async function manualSyncNow(){
    await (window.OEGRecordsReady||Promise.resolve());
    const items = await collectItems();
    const r1 = localFolderHandle ? await syncLocalFolder(items) : {ok:true, written:0};
    const r2 = driveCfg.connected ? await syncDrive(items) : {ok:true, written:0};
    renderLocalStatus();
    window.dispatchEvent(new Event('oeg:sync-done'));
    if(typeof toast==='function'){
      const total = (r1.written||0) + (r2.written||0);
      if(r1.ok && r2.ok) toast(total ? `Synchronisation effectuée (${total} fichier${total>1?'s':''} mis à jour) ✓` : 'Déjà à jour ✓');
      else toast('Synchronisation partielle — nouvelle tentative au prochain enregistrement.');
    }
  }

  window.addEventListener('online', ()=>{
    if(driveCfg.connected) notifyChange();
  });

  // ---------- UI ----------
  function renderLocalStatus(customMsg){
    const el = $('localFileStatus');
    const forgetBtn = $('forgetLocalFileBtn');
    if(!el) return;
    if(customMsg){el.textContent = customMsg; return}
    if(!localFolderSupported()){
      el.textContent = "Fonction non disponible sur ce navigateur/tablette : utilisez l'export JSON manuel ci-dessus.";
      if(forgetBtn) forgetBtn.style.display = 'none';
      return;
    }
    if(!localFolderHandle){
      el.textContent = 'Aucun dossier local configuré.';
      if(forgetBtn) forgetBtn.style.display = 'none';
      return;
    }
    if(forgetBtn) forgetBtn.style.display = '';
    const last = localStorage.getItem('oeg_sync_local_last');
    const count = Object.keys(localHashes).length;
    localPermissionState().then(p=>{
      const name = localFolderHandle.name || 'dossier sélectionné';
      if(p === 'granted'){
        el.textContent = `Dossier configuré : ${name} — ${count} fichier(s) à jour` + (last ? `, dernière écriture : ${new Date(last).toLocaleString('fr-FR')}` : '') + '.';
        window.dispatchEvent(new Event('oeg:sync-done'));
      }else{
        el.textContent = `Dossier configuré : ${name} — autorisation à renouveler (touchez "Choisir le dossier de sauvegarde").`;
      }
    });
  }

  function renderDriveStatus(customMsg){
    const el = $('driveStatus');
    const connectBtn = $('connectDriveBtn');
    const disconnectBtn = $('disconnectDriveBtn');
    if(!el) return;
    if($('driveClientId') && driveCfg.clientId) $('driveClientId').value = driveCfg.clientId;
    if(customMsg){el.textContent = customMsg; return}
    if(!driveCfg.connected){
      el.textContent = 'Google Drive non connecté.';
      if(connectBtn) connectBtn.style.display = '';
      if(disconnectBtn) disconnectBtn.style.display = 'none';
      return;
    }
    if(connectBtn) connectBtn.style.display = 'none';
    if(disconnectBtn) disconnectBtn.style.display = '';
    const last = localStorage.getItem('oeg_sync_drive_last');
    const count = Object.keys(driveHashes).length;
    el.textContent = `Google Drive connecté (dossier "${DRIVE_FOLDER_NAME}") — ${count} fichier(s) à jour` + (last ? `, dernière synchronisation : ${new Date(last).toLocaleString('fr-FR')}` : '') + '.';
  }

  function wireButtons(){
    const chooseBtn = $('chooseLocalFileBtn');
    const forgetBtn = $('forgetLocalFileBtn');
    const connectBtn = $('connectDriveBtn');
    const disconnectBtn = $('disconnectDriveBtn');
    const syncBtn = $('syncNowBtn');
    const pullBtn = $('pullDriveBtn');
    if(chooseBtn) chooseBtn.onclick = async ()=>{
      if(localFolderHandle){ await reauthorizeLocalFolder(); }
      else { await chooseLocalFolder(); }
    };
    if(forgetBtn) forgetBtn.onclick = forgetLocalFolder;
    if(connectBtn) connectBtn.onclick = connectDrive;
    if(disconnectBtn) disconnectBtn.onclick = disconnectDrive;
    if(syncBtn) syncBtn.onclick = manualSyncNow;
    if(pullBtn) pullBtn.onclick = pullFromDrive;
  }

  async function init(){
    wireButtons();
    await tryReacquireLocalFolder();
    renderDriveStatus();
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', init);
  }else{
    init();
  }

  async function isBackedUp(recordId){
    const rec=records.find(r=>r.id===recordId);
    if(!rec)return false;
    try{
      const hash=await hashOf(rec);
      const localOk=!!(localFolderHandle && localHashes[recordId]===hash);
      const driveOk=!!(driveCfg.connected && driveHashes[recordId]===hash);
      return localOk||driveOk;
    }catch(e){return false}
  }

  // Après un allégement local (photos/dessin retirés de "records" pour libérer de la place —
  // voir lightenStorage() dans app-core.js), le contenu du navigateur ne correspond plus au
  // fichier déjà écrit sur le dossier local / Drive (c'est voulu : le fichier garde tout).
  // Sans cet appel, la prochaine synchronisation verrait un "changement" et écraserait le bon
  // fichier avec la version allégée. On aligne donc les empreintes suivies sur l'état actuel
  // (allégé) SANS rien réécrire, pour que la synchronisation laisse les fichiers tranquilles.
  async function adoptCurrentHash(recordId){
    const rec=records.find(r=>r.id===recordId);
    if(!rec)return;
    const hash=await hashOf(rec);
    if(localFolderHandle){localHashes[recordId]=hash;saveLocalHashes()}
    if(driveCfg.connected){driveHashes[recordId]=hash;saveDriveHashes()}
  }

  // État des sauvegardes, pour l'indicateur toujours visible (js/terrain.js) : une fiche est
  // "sauvegardée" quand sa version actuelle est déjà écrite dans le dossier local OU sur Drive.
  async function backupStatus(){
    await (window.OEGRecordsReady||Promise.resolve());
    const localOk = !!localFolderHandle && (await localPermissionState()) === 'granted';
    const drive = !!driveCfg.connected;
    let pending = 0;
    if(localOk || drive){
      for(const r of records){
        const h = await hashOf(r);
        if(!((localOk && localHashes[r.id]===h) || (drive && driveHashes[r.id]===h))) pending++;
      }
    }
    return {configured: localOk || drive, local: localOk, localNeedsPermission: !!localFolderHandle && !localOk, drive, pending, total: records.length};
  }

  window.OEGSync = {
    backupStatus,
    notifyChange,
    chooseLocalFolder,
    forgetLocalFolder,
    connectDrive,
    disconnectDrive,
    manualSyncNow,
    pullFromDrive,
    isBackedUp,
    adoptCurrentHash
  };
})();
