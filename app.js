(() => {
  'use strict';
  const VERSION = '0.1.7';
  // On conserve volontairement la même clé que v0.1.0 afin de garder les données existantes.
  const KEY = 'djinn-v0100-state';
  const seedTasks = [
    {id:'t1',name:'Lancer une lessive',duration:6,importance:2,urgency:3,effort:1,place:'Buanderie',repeatValue:0,repeatUnit:'none',consequence:'Le panier risque de déborder et tu pourrais manquer de vêtements propres dans 1–2 jours.'},
    {id:'t2',name:'Ranger le plan de travail',duration:8,importance:2,urgency:2,effort:1,place:'Cuisine',repeatValue:0,repeatUnit:'none',consequence:'Le désordre risque de rendre la préparation du prochain repas moins agréable.'},
    {id:'t3',name:'Repasser le linge',duration:35,importance:1,urgency:1,effort:2,place:'Dressing',repeatValue:0,repeatUnit:'none',consequence:'Peu de conséquence immédiate : cette tâche peut attendre.'},
    {id:'t4',name:'Trier le courrier',duration:12,importance:3,urgency:2,effort:1,place:'Bureau',repeatValue:0,repeatUnit:'none',consequence:'Un document important pourrait rester sans réponse trop longtemps.'},
    {id:'t5',name:'Arroser les plantes',duration:7,importance:2,urgency:2,effort:1,place:'Maison',repeatValue:7,repeatUnit:'days',consequence:'Certaines plantes pourraient commencer à manquer d’eau.'},
    {id:'t6',name:'Ranger le bureau',duration:25,importance:1,urgency:1,effort:2,place:'Bureau',repeatValue:0,repeatUnit:'none',consequence:'Le désordre peut s’accumuler, mais rien n’impose de le faire maintenant.'}
  ];
  let state = load();
  let currentSuggestionId = null;
  let excludedThisRound = new Set();
  let returnToTaskId = null;

  const $ = id => document.getElementById(id);
  const views = [...document.querySelectorAll('.view')];
  const navButtons = [...document.querySelectorAll('.nav-btn')];

  function cloneSeed(){ return JSON.parse(JSON.stringify(seedTasks)); }
  function defaultState(){return {tasks:cloneSeed(),history:[],refusals:{},context:{time:20,energy:2},smartMemory:{places:[]},lastTransferAction:'Aucun export/import'};}
  function normalizeTask(t){return {place:'',repeatValue:0,repeatUnit:'none',blockedUntil:null,lastDoneAt:null,done:false,...t};}
  function load(){
    try{
      const raw=localStorage.getItem(KEY); if(!raw) return defaultState();
      const parsed=JSON.parse(raw);
      const merged={...defaultState(),...parsed};
      merged.tasks=Array.isArray(parsed.tasks)?parsed.tasks.map(normalizeTask):cloneSeed();
      if(!merged.lastTransferAction) merged.lastTransferAction='Aucun export/import';
      merged.smartMemory={places:[],...(parsed.smartMemory||{})};
      merged.tasks.forEach(t=>rememberSmart('places',t.place,merged));
      return merged;
    }catch(e){return defaultState();}
  }
  function save(){localStorage.setItem(KEY,JSON.stringify(state));renderHeader();renderStats();renderBackupInfo();}
  function nowLabel(){return new Date().toLocaleString('fr-FR',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});}
  function renderHeader(){$('lastAction').textContent=`Dernière action : ${state.lastTransferAction||'Aucun export/import'}`;}
  function renderBackupInfo(){$('backupInfo').textContent=`Dernière action : ${state.lastTransferAction||'Aucun export/import'}`;}
  function toast(msg){const el=$('toast');el.textContent=msg;el.classList.add('show');clearTimeout(toast.t);toast.t=setTimeout(()=>el.classList.remove('show'),2600);}
  function escapeHtml(s){return String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}
  function urgencyLabel(v){return v===3?'urgent':v===2?'bientôt':'peut attendre';}
  function formatDate(iso){return new Date(iso).toLocaleDateString('fr-FR',{day:'2-digit',month:'2-digit',year:'numeric'});}
  function hasTemporalite(t){return Number(t.repeatValue)>0 && t.repeatUnit && t.repeatUnit!=='none';}
  function isWaiting(t){return !!(t.blockedUntil && new Date(t.blockedUntil).getTime()>Date.now());}
  function isAvailable(t){return !t.done && !isWaiting(t);}
  function addPeriod(from,value,unit){const d=new Date(from);const n=Math.max(0,Number(value)||0);if(unit==='days')d.setDate(d.getDate()+n);else if(unit==='weeks')d.setDate(d.getDate()+n*7);else if(unit==='months')d.setMonth(d.getMonth()+n);else if(unit==='years')d.setFullYear(d.getFullYear()+n);return d;}
  function temporaliteLabel(t){if(!hasTemporalite(t))return 'Aucune';const labels={days:'jour(s)',weeks:'semaine(s)',months:'mois',years:'année(s)'};return `${t.repeatValue} ${labels[t.repeatUnit]}`;}
  const temporalUnits={days:'jour(s)',weeks:'semaine(s)',months:'mois',years:'année(s)'};
  let previousRepeatUnit='none';
  function updateTemporalSummary(){const unit=$('taskRepeatUnit').value,value=Math.max(0,Number($('taskRepeatValue').value)||0);$('temporalSummary').textContent=(unit!=='none'&&value)?`${value} ${temporalUnits[unit]}`:'Aucune temporalité';}
  function openTemporalPrompt(unit){if(unit==='none'){ $('taskRepeatValue').value='0'; previousRepeatUnit='none'; updateTemporalSummary(); return; } const existing=previousRepeatUnit===unit?Math.max(1,Number($('taskRepeatValue').value)||1):1;$('temporalNumber').value=existing;$('temporalTitle').textContent=`À reproposer après — ${temporalUnits[unit]}`;$('temporalModal').classList.remove('hidden');setTimeout(()=>{$('temporalNumber').focus();$('temporalNumber').select();},0);}
  function closeTemporalPrompt(revert=false){if(revert){$('taskRepeatUnit').value=previousRepeatUnit;}$('temporalModal').classList.add('hidden');updateTemporalSummary();}
  function saveTemporalPrompt(){const n=Math.max(1,Math.min(999,Number($('temporalNumber').value)||1));$('taskRepeatValue').value=String(n);previousRepeatUnit=$('taskRepeatUnit').value;$('temporalModal').classList.add('hidden');updateTemporalSummary();}

  function scoreTask(t,time,energy){
    if(excludedThisRound.has(t.id)) return -9999;
    if(!isAvailable(t)) return -9999;
    if(t.duration>time && time<999) return -500-(t.duration-time);
    const refusalPenalty=(state.refusals[t.id]||0)*1.3;
    const energyFit=t.effort<=energy?3:-(t.effort-energy)*3.5;
    const timeFit=time===999?1:Math.max(0,4-Math.abs(time-t.duration)/8);
    return t.importance*4+t.urgency*4+energyFit+timeFit-refusalPenalty;
  }
  function reasonFor(t,time,energy){
    const bits=[];
    if(t.urgency===3)bits.push('elle mérite ton attention assez vite');else if(t.importance===3)bits.push('elle compte davantage que plusieurs autres tâches');else bits.push('elle est utile sans être énorme');
    if(time===999||t.duration<=time)bits.push(`elle tient dans les ≈ ${t.duration} minutes prévues`);
    if(t.effort<=energy)bits.push('son effort paraît compatible avec ton énergie actuelle');
    if(t.place)bits.push(`elle se fait à ${t.place}`);
    return `Je te la propose parce que ${bits.join(', et ')}.`;
  }
  function candidateList(time,energy){return state.tasks.filter(isAvailable).map(t=>({t,score:scoreTask(t,time,energy)})).sort((a,b)=>b.score-a.score||a.t.name.localeCompare(b.t.name,'fr',{sensitivity:'base'}));}
  function chooseSuggestion(){
    const time=Number($('timeAvailable').value),energy=Number($('energy').value);state.context={time,energy};save();
    const available=state.tasks.filter(isAvailable);
    if(!available.length){
      currentSuggestionId=null;$('suggestionTitle').textContent='Rien ne presse';$('suggestionDuration').textContent='⏱ —';$('suggestionEffort').textContent='◉ —';$('suggestionPlace').classList.add('hidden');$('suggestionReason').textContent='Aucune tâche n’est actuellement proposable. Certaines peuvent être en période de repos.';$('consequenceText').textContent='Aucune conséquence importante détectée.';$('keepInMind').innerHTML=waitingSummary();return;
    }
    let candidates=candidateList(time,energy);
    // Après avoir parcouru toute la liste avec « Autre chose », on recommence au début.
    if(!candidates.length || candidates[0].score<=-9000){excludedThisRound.clear();candidates=candidateList(time,energy);}
    if(candidates[0].score<-400){candidates=available.filter(t=>!excludedThisRound.has(t.id)).map(t=>({t,score:(t.importance*4+t.urgency*4)-(t.duration/30)})).sort((a,b)=>b.score-a.score||a.t.name.localeCompare(b.t.name,'fr',{sensitivity:'base'}));if(!candidates.length){excludedThisRound.clear();return chooseSuggestion();}}
    const t=candidates[0].t;currentSuggestionId=t.id;
    $('suggestionTitle').textContent=t.name;$('suggestionDuration').textContent=`⏱ ≈ ${t.duration} min`;$('suggestionEffort').textContent=`◉ Effort ${['','facile','moyen','demandant'][t.effort]}`;
    if(t.place){$('suggestionPlace').textContent=`📍 ${t.place}`;$('suggestionPlace').classList.remove('hidden');}else $('suggestionPlace').classList.add('hidden');
    $('suggestionReason').textContent=reasonFor(t,time,energy);$('consequenceText').textContent=t.consequence||'Pas de conséquence renseignée.';
    const others=state.tasks.filter(x=>isAvailable(x)&&x.id!==t.id).map(x=>({t:x,score:scoreTask(x,time,energy)})).sort((a,b)=>b.score-a.score||a.t.name.localeCompare(b.t.name,'fr',{sensitivity:'base'})).slice(0,3);
    $('keepInMind').innerHTML=others.length?others.map(x=>`<button class="mini-item clickable" data-task-id="${x.t.id}"><strong>${escapeHtml(x.t.name)}</strong><span>≈ ${x.t.duration} min${x.t.place?' · '+escapeHtml(x.t.place):''} · ${urgencyLabel(x.t.urgency)}</span></button>`).join(''):waitingSummary();
    $('keepInMind').querySelectorAll('[data-task-id]').forEach(b=>b.onclick=()=>openTaskFromMind(b.dataset.taskId));
  }
  function waitingSummary(){const waiting=state.tasks.filter(isWaiting).sort((a,b)=>new Date(a.blockedUntil)-new Date(b.blockedUntil)).slice(0,3);if(!waiting.length)return '<div class="mini-item"><strong>Tout va bien</strong><span>Tu peux ajouter une nouvelle tâche quand elle apparaît.</span></div>';return waiting.map(t=>`<button class="mini-item clickable" data-task-id="${t.id}"><strong>${escapeHtml(t.name)}</strong><span>À reproposer après le ${formatDate(t.blockedUntil)}</span></button>`).join('');}
  function currentTask(){return state.tasks.find(t=>t.id===currentSuggestionId);}

  function markTaskDone(t,source='done'){
    const now=new Date();t.lastDoneAt=now.toISOString();
    if(hasTemporalite(t)){t.done=false;t.blockedUntil=addPeriod(now,t.repeatValue,t.repeatUnit).toISOString();}
    else{t.done=true;t.doneAt=now.toISOString();t.blockedUntil=null;}
    state.history.unshift({type:'done',taskId:t.id,name:t.name,at:now.toISOString(),context:{...state.context},nextEligibleAt:t.blockedUntil||null});
    if(source==='accepted'&&t.blockedUntil)toast(`Fait. Je ne te le reproposerai pas avant le ${formatDate(t.blockedUntil)}.`);else if(source==='accepted')toast('Fait — enregistré, sans points ni série à conserver.');
  }
  function accepted(){const t=currentTask();if(!t)return;markTaskDone(t,'accepted');excludedThisRound.clear();save();renderTasks();renderLearning();chooseSuggestion();}
  function refused(){const t=currentTask();if(!t)return;state.refusals[t.id]=(state.refusals[t.id]||0)+1;state.history.unshift({type:'refused',taskId:t.id,name:t.name,at:new Date().toISOString(),context:{...state.context}});excludedThisRound.add(t.id);save();toast('Compris. Djinn en tient compte et cherche autre chose.');renderLearning();chooseSuggestion();}
  function another(){const t=currentTask();if(t)excludedThisRound.add(t.id);chooseSuggestion();toast('Je cherche une autre proposition.');}
  function why(){const t=currentTask();if(!t)return;alert(`${t.name}\n\n${reasonFor(t,state.context.time,state.context.energy)}\n\nSi tu attends : ${t.consequence||'aucune conséquence renseignée.'}`);}

  function taskStatus(t){if(t.done)return 'done';if(isWaiting(t))return 'waiting';return 'available';}
  function filteredTasks(){
    const q=$('taskSearch').value.trim().toLocaleLowerCase('fr');const status=$('taskStatusFilter').value;const place=$('taskPlaceFilter').value;
    return [...state.tasks].filter(t=>{const hay=`${t.name} ${t.consequence||''} ${t.place||''}`.toLocaleLowerCase('fr');return (!q||hay.includes(q))&&(status==='all'||taskStatus(t)===status)&&(place==='all'||(t.place||'')===place);}).sort((a,b)=>a.name.localeCompare(b.name,'fr',{sensitivity:'base'}));
  }
  function renderTasks(){
    refreshSmartLists();const box=$('taskList');const tasks=filteredTasks();if(!tasks.length){box.innerHTML='<div class="card">Aucune tâche ne correspond au filtre.</div>';return;}
    box.innerHTML=tasks.map(t=>{
      const status=taskStatus(t);const statusText=status==='waiting'?`À reproposer après le ${formatDate(t.blockedUntil)}`:status==='done'?'Terminée':'Proposable maintenant';
      return `<article class="task-card ${status}" data-id="${t.id}"><div><h3>${t.done?'✓ ':''}${escapeHtml(t.name)}</h3><div class="task-meta"><span>≈ ${t.duration} min</span><span>Importance ${t.importance}/3</span><span>Urgence ${t.urgency}/3</span><span>Effort ${t.effort}/3</span>${t.place?`<span>📍 ${escapeHtml(t.place)}</span>`:''}${hasTemporalite(t)?`<span>↻ ${escapeHtml(temporaliteLabel(t))}</span>`:''}</div><div class="task-status">${statusText}</div><p class="muted">${escapeHtml(t.consequence||'Aucune conséquence renseignée.')}</p></div><div class="task-actions"><button class="icon-btn edit-task">Modifier</button><button class="icon-btn toggle-task">${status==='waiting'?'Réactiver maintenant':t.done?'Réactiver':'Fait'}</button><button class="icon-btn delete-task">Supprimer</button></div></article>`;
    }).join('');
    box.querySelectorAll('.edit-task').forEach(b=>b.onclick=()=>editTask(b.closest('.task-card').dataset.id));box.querySelectorAll('.toggle-task').forEach(b=>b.onclick=()=>toggleTask(b.closest('.task-card').dataset.id));box.querySelectorAll('.delete-task').forEach(b=>b.onclick=()=>deleteTask(b.closest('.task-card').dataset.id));
  }
  function alphaSort(a,b){return a.localeCompare(b,'fr',{sensitivity:'base'});}
  function rememberSmart(kind,value,targetState=state){const v=String(value||'').trim();if(!v)return;targetState.smartMemory=targetState.smartMemory||{};targetState.smartMemory[kind]=targetState.smartMemory[kind]||[];if(!targetState.smartMemory[kind].some(x=>x.localeCompare(v,'fr',{sensitivity:'base'})===0))targetState.smartMemory[kind].push(v);targetState.smartMemory[kind].sort(alphaSort);}
  function smartValues(kind){const hist=[...((state.smartMemory&&state.smartMemory[kind])||[])].sort(alphaSort);let active=[];if(kind==='places')active=[...new Set(state.tasks.map(t=>t.place).filter(Boolean))].sort(alphaSort);return {active,hist};}
  function refreshSmartLists(){
    const names=[...new Set(state.tasks.map(t=>t.name).filter(Boolean))].sort(alphaSort);$('taskNameSuggestions').innerHTML=names.map(x=>`<option value="${escapeHtml(x)}"></option>`).join('');
    const placeFilter=$('taskPlaceFilter');
    const selectedPlace=placeFilter.value||'all';
    const {active}=smartValues('places');
    placeFilter.innerHTML='<option value="all">Tous les lieux</option>'+active.map(p=>`<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`).join('');
    if(selectedPlace==='all'||active.includes(selectedPlace)) placeFilter.value=selectedPlace;
    else placeFilter.value='all';
  }
  function renderPlaceMenu(query='',openedByToggle=false){const menu=$('placeMenu');const {active,hist}=smartValues('places');const q=query.trim().toLocaleLowerCase('fr');let vals;if(q){vals=hist.filter(v=>v.toLocaleLowerCase('fr').includes(q));}else{vals=active;}vals=[...new Set(vals)].sort(alphaSort);menu.innerHTML=(vals.length?vals.map(v=>`<button type="button" class="smart-option" data-value="${escapeHtml(v)}">${escapeHtml(v)}</button>`).join(''):'<div class="smart-empty">Aucune valeur active</div>')+`<button type="button" class="smart-option other" data-other="1">… Autre</button>`;menu.classList.remove('hidden');menu.querySelectorAll('[data-value]').forEach(b=>b.onclick=()=>{$('taskPlace').value=b.dataset.value;menu.classList.add('hidden');});menu.querySelector('[data-other]').onclick=()=>{$('taskPlace').value='';menu.classList.add('hidden');$('taskPlace').focus();toast('Saisis le nouveau lieu : Djinn le gardera en mémoire.');};}
  function openForm(clear=true){$('taskForm').classList.remove('hidden');if(clear){returnToTaskId=null;$('formTitle').textContent='Ajouter une tâche';$('taskId').value='';$('taskName').value='';$('taskDuration').value=10;$('taskPlace').value='';$('taskImportance').value=2;$('taskUrgency').value=2;$('taskEffort').value=2;$('taskRepeatValue').value='0';$('taskRepeatUnit').value='none';previousRepeatUnit='none';updateTemporalSummary();$('taskConsequence').value='';}$('taskName').focus();}
  function closeForm(){$('taskForm').classList.add('hidden');returnToTaskId=null;}
  function editTask(id){const t=state.tasks.find(x=>x.id===id);if(!t)return;returnToTaskId=id;openForm(false);$('formTitle').textContent='Modifier la tâche';$('taskId').value=t.id;$('taskName').value=t.name;$('taskDuration').value=String(Math.min(60,Math.max(5,Math.round((Number(t.duration)||10)/5)*5)));$('taskPlace').value=t.place||'';$('taskImportance').value=t.importance;$('taskUrgency').value=t.urgency;$('taskEffort').value=t.effort;$('taskRepeatValue').value=t.repeatValue||'0';$('taskRepeatUnit').value=t.repeatUnit||'none';previousRepeatUnit=$('taskRepeatUnit').value;updateTemporalSummary();$('taskConsequence').value=t.consequence||'';$('taskForm').scrollIntoView({behavior:'smooth',block:'start'});}
  function saveTask(){
    const name=$('taskName').value.trim();if(!name){toast('Donne un nom à la tâche.');return;}
    let repeatValue=Math.max(0,Number($('taskRepeatValue').value)||0),repeatUnit=$('taskRepeatUnit').value;if(!repeatValue)repeatUnit='none';
    const data={name,duration:Math.max(1,Number($('taskDuration').value)||10),place:$('taskPlace').value.trim(),importance:Number($('taskImportance').value),urgency:Number($('taskUrgency').value),effort:Number($('taskEffort').value),repeatValue,repeatUnit,consequence:$('taskConsequence').value.trim()};
    rememberSmart('places',data.place);const id=$('taskId').value;const targetId=id||('t'+Date.now());if(id){Object.assign(state.tasks.find(x=>x.id===id),data);}else state.tasks.push(normalizeTask({id:targetId,...data}));
    save();$('taskForm').classList.add('hidden');excludedThisRound.clear();renderTasks();chooseSuggestion();
    const backId=returnToTaskId||targetId;returnToTaskId=null;requestAnimationFrame(()=>{const el=document.querySelector(`.task-card[data-id="${backId}"]`);if(el){el.scrollIntoView({behavior:'smooth',block:'center'});el.classList.add('flash');setTimeout(()=>el.classList.remove('flash'),1600);}});
  }
  function toggleTask(id){const t=state.tasks.find(x=>x.id===id);if(!t)return;if(isWaiting(t)){t.blockedUntil=null;t.done=false;toast('Cette tâche est de nouveau proposable maintenant.');}else if(t.done){t.done=false;delete t.doneAt;toast('Tâche réactivée.');}else{markTaskDone(t,'manual');if(t.blockedUntil)toast(`Fait. À reproposer après le ${formatDate(t.blockedUntil)}.`);else toast('Tâche marquée comme faite.');}save();excludedThisRound.clear();renderTasks();chooseSuggestion();}
  function deleteTask(id){const t=state.tasks.find(x=>x.id===id);if(!t)return;if(!confirm(`Supprimer « ${t.name} » ?`))return;state.tasks=state.tasks.filter(x=>x.id!==id);save();excludedThisRound.clear();renderTasks();chooseSuggestion();}
  let detailTaskId=null;
  function openTaskFromMind(id){const t=state.tasks.find(x=>x.id===id);if(!t)return;detailTaskId=id;const status=taskStatus(t);const statusText=status==='waiting'?`À reproposer après le ${formatDate(t.blockedUntil)}`:status==='done'?'Terminée':'Proposable maintenant';$('detailTitle').textContent=t.name;$('taskDetailBody').innerHTML=`<div class="detail-meta"><span>≈ ${t.duration} min</span><span>Importance ${t.importance}/3</span><span>Urgence ${t.urgency}/3</span><span>Effort ${t.effort}/3</span>${t.place?`<span>📍 ${escapeHtml(t.place)}</span>`:''}${hasTemporalite(t)?`<span>↻ ${escapeHtml(temporaliteLabel(t))}</span>`:''}</div><div class="detail-status">${statusText}</div><p>${escapeHtml(t.consequence||'Aucune conséquence renseignée.')}</p>`;$('detailDone').textContent=status==='waiting'?'Réactiver maintenant':t.done?'Réactiver':'✓ Fait';$('taskDetailModal').classList.remove('hidden');}
  function closeTaskDetail(){$('taskDetailModal').classList.add('hidden');detailTaskId=null;}
  function detailToggle(){if(!detailTaskId)return;toggleTask(detailTaskId);closeTaskDetail();}


  function renderLearning(){const refusals=Object.entries(state.refusals).filter(([,n])=>n>0).sort((a,b)=>b[1]-a[1]);const recent=state.history.slice(0,8);let html='<h3>Premiers signaux</h3>';if(!refusals.length)html+='<p class="muted">Djinn n’a pas encore observé de refus. Utilise « Pas envie » quand une proposition tombe mal.</p>';else html+=refusals.map(([id,n])=>{const t=state.tasks.find(x=>x.id===id);return `<div class="learning-row"><strong>${escapeHtml(t?.name||'Tâche supprimée')}</strong><div>${n} refus enregistré${n>1?'s':''}. Djinn réduit légèrement sa priorité dans les mêmes conditions.</div></div>`}).join('');html+='<h3 style="margin-top:20px">Historique récent</h3>';html+=recent.length?recent.map(h=>`<div class="learning-row"><strong>${h.type==='done'?'✓ Fait':'☹ Pas envie'} — ${escapeHtml(h.name)}</strong><div class="muted">${new Date(h.at).toLocaleString('fr-FR')} · ${h.context?.time===999?'temps libre':(h.context?.time||'?')+' min'} · énergie ${h.context?.energy||'?'}/3${h.nextEligibleAt?' · reproposable le '+formatDate(h.nextEligibleAt):''}</div></div>`).join(''):'<p class="muted">Aucun apprentissage enregistré pour l’instant.</p>';$('learningList').innerHTML=html;}
  function renderStats(){const done=state.history.filter(h=>h.type==='done').length;const refus=state.history.filter(h=>h.type==='refused').length;$('taskCount').textContent=state.tasks.filter(isAvailable).length;$('doneCount').textContent=done;$('refusalCount').textContent=refus;}
  function setView(id){views.forEach(v=>v.classList.toggle('active',v.id===id));navButtons.forEach(b=>b.classList.toggle('active',b.dataset.view===id));window.scrollTo({top:0,behavior:'smooth'});if(id==='tasks')renderTasks();if(id==='learning')renderLearning();}

  function exportData(){const payload={app:'Djinn',version:VERSION,exportedAt:new Date().toISOString(),state};const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);const stamp=new Date().toISOString().replace(/[:T]/g,'-').slice(0,16);a.download=`Djinn_${stamp}.djinnbak`;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove();},500);state.lastTransferAction=`Export ${a.download} · ${nowLabel()}`;save();toast('Sauvegarde exportée.');}
  function importData(file){if(!file)return;const reader=new FileReader();reader.onload=()=>{try{const parsed=JSON.parse(reader.result);const incoming=parsed.state||parsed;if(!incoming||!Array.isArray(incoming.tasks))throw new Error('format');if(!confirm(`Importer « ${file.name} » et remplacer les données locales actuelles ?`))return;state={...defaultState(),...incoming,tasks:incoming.tasks.map(normalizeTask),smartMemory:{places:[],...(incoming.smartMemory||{})}};state.tasks.forEach(t=>rememberSmart('places',t.place));state.lastTransferAction=`Import ${file.name} · ${nowLabel()}`;excludedThisRound.clear();save();renderTasks();renderLearning();chooseSuggestion();toast('Sauvegarde importée.');}catch(e){alert('Ce fichier ne semble pas être une sauvegarde Djinn valide.');}finally{$('importFile').value='';}};reader.readAsText(file);}

  navButtons.forEach(b=>b.addEventListener('click',()=>setView(b.dataset.view)));
  $('timeAvailable').value=String(state.context.time||20);$('energy').value=String(state.context.energy||2);
  $('timeAvailable').addEventListener('change',()=>{excludedThisRound.clear();chooseSuggestion();});$('energy').addEventListener('change',()=>{excludedThisRound.clear();chooseSuggestion();});
  $('doIt').onclick=accepted;$('notNow').onclick=refused;$('another').onclick=another;$('whyTop').onclick=why;
  $('openTaskForm').onclick=()=>openForm(true);$('cancelTask').onclick=closeForm;$('saveTask').onclick=saveTask;
  ['taskSearch','taskStatusFilter','taskPlaceFilter'].forEach(id=>$(id).addEventListener(id==='taskSearch'?'input':'change',renderTasks));
  $('photoDemo').onclick=()=>toast('La photo sera activée dans une prochaine version.');$('voiceDemo').onclick=()=>toast('La voix viendra plus tard.');$('writeDemo').onclick=()=>{setView('tasks');openForm(true);toast('Pour l’instant, écris la situation comme une tâche.');};
  $('exportData').onclick=exportData;$('importData').onclick=()=>$('importFile').click();$('importFile').addEventListener('change',e=>importData(e.target.files?.[0]));
  $('placeToggle').onclick=()=>renderPlaceMenu('',true);$('taskPlace').addEventListener('input',e=>renderPlaceMenu(e.target.value));$('taskPlace').addEventListener('focus',e=>renderPlaceMenu(e.target.value));document.addEventListener('click',e=>{if(!$('placeSmartField').contains(e.target))$('placeMenu').classList.add('hidden');});
  $('taskRepeatUnit').addEventListener('focus',()=>{previousRepeatUnit=$('taskRepeatUnit').value;});$('taskRepeatUnit').addEventListener('change',e=>openTemporalPrompt(e.target.value));$('saveTemporal').onclick=saveTemporalPrompt;$('cancelTemporal').onclick=()=>closeTemporalPrompt(true);$('closeTemporal').onclick=()=>closeTemporalPrompt(true);$('temporalModal').addEventListener('click',e=>{if(e.target===$('temporalModal'))closeTemporalPrompt(true);});$('temporalNumber').addEventListener('keydown',e=>{if(e.key==='Enter')saveTemporalPrompt();});
  $('closeTaskDetail').onclick=closeTaskDetail;$('detailClose').onclick=closeTaskDetail;$('detailDone').onclick=detailToggle;$('taskDetailModal').addEventListener('click',e=>{if(e.target===$('taskDetailModal'))closeTaskDetail();});
  $('resetDemo').onclick=()=>{if(!confirm('Réinitialiser toutes les données locales de Djinn ?'))return;state=defaultState();excludedThisRound.clear();save();renderTasks();renderLearning();chooseSuggestion();toast('Données de démonstration réinitialisées.');};

  renderHeader();renderBackupInfo();refreshSmartLists();renderTasks();renderLearning();renderStats();chooseSuggestion();
  if('serviceWorker' in navigator){window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}));}
})();
