(() => {
  'use strict';
  const VERSION = '0.2.3';
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
  function todayKey(date=new Date()){return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;}
  function eventId(){return 'e'+Date.now().toString(36)+Math.random().toString(36).slice(2,8);}
  function normalizeTodayProgram(st=state){
    if(!st.todayProgram)st.todayProgram={date:todayKey(),entries:[]};
    if(Array.isArray(st.todayProgram.taskIds)&&!Array.isArray(st.todayProgram.entries)){st.todayProgram.entries=st.todayProgram.taskIds.map(taskId=>({taskId,status:'active',origin:'legacy',addedAt:new Date().toISOString()}));delete st.todayProgram.taskIds;}
    if(!Array.isArray(st.todayProgram.entries))st.todayProgram.entries=[];
    st.todayProgram.entries=st.todayProgram.entries.filter(e=>e&&st.tasks.some(t=>t.id===e.taskId)).map(e=>({status:'active',origin:'unknown',addedAt:new Date().toISOString(),...e}));
    if(!st.todayProgram.date)st.todayProgram.date=todayKey();
  }
  function defaultState(){return {tasks:cloneSeed(),history:[],refusals:{},context:{time:20,energy:2},smartMemory:{places:[]},todayProgram:{date:todayKey(),entries:[]},lastTransferAction:'Aucun export/import'};}
  function normalizeTask(t){return {place:'',repeatValue:0,repeatUnit:'none',blockedUntil:null,lastDoneAt:null,done:false,events:[],...t,events:Array.isArray(t.events)?t.events:[]};}
  function load(){
    try{
      const raw=localStorage.getItem(KEY); if(!raw) return defaultState();
      const parsed=JSON.parse(raw);
      const merged={...defaultState(),...parsed};
      merged.tasks=Array.isArray(parsed.tasks)?parsed.tasks.map(normalizeTask):cloneSeed();
      if(!merged.lastTransferAction) merged.lastTransferAction='Aucun export/import';
      merged.smartMemory={places:[],...(parsed.smartMemory||{})};
      merged.tasks.forEach(t=>rememberSmart('places',t.place,merged));
      normalizeTodayProgram(merged);
      // Migration douce : l'ancien historique devient aussi consultable dans chaque tâche.
      (merged.history||[]).forEach(h=>{if(!h.id)h.id=eventId();const t=merged.tasks.find(x=>x.id===h.taskId);if(t){const existing=t.events.find(e=>(e.id&&e.id===h.id)||(!e.id&&e.at===h.at&&e.type===h.type));if(existing){if(!existing.id)existing.id=h.id;if(existing.cancelled==null)existing.cancelled=!!h.cancelled;}else t.events.push({...h});}});
      merged.tasks.forEach(t=>(t.events||[]).forEach(e=>{if(!e.id)e.id=eventId();if(e.cancelled==null)e.cancelled=false;}));
      return merged;
    }catch(e){return defaultState();}
  }
  function save(){rolloverTodayProgram();normalizeTodayProgram();localStorage.setItem(KEY,JSON.stringify(state));renderHeader();renderStats();renderBackupInfo();renderTodayProgram();}
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

  function timeBand(minutes){if(minutes===999)return 'libre';if(minutes<=10)return 'court';if(minutes<=30)return 'moyen';return 'long';}
  function dayPart(date=new Date()){const h=date.getHours();if(h<11)return 'matin';if(h<14)return 'midi';if(h<18)return 'après-midi';return 'soir';}
  function contextualHistoryCount(t,time,energy,type){
    const band=timeBand(time), part=dayPart();
    return state.history.filter(h=>!h.cancelled&&h.type===type&&h.taskId===t.id).reduce((n,h)=>{
      const c=h.context||{}; let match=0;
      if(Number(c.energy)===Number(energy))match+=2;
      if(timeBand(Number(c.time))===band)match+=2;
      if(c.dayPart===part)match+=1;
      if((h.place||'')===(t.place||''))match+=1;
      return n+(match>=4?1:0);
    },0);
  }
  function contextualRefusals(t,time,energy){return contextualHistoryCount(t,time,energy,'refused');}
  function contextualAcceptances(t,time,energy){return contextualHistoryCount(t,time,energy,'accepted');}
  function scoreTask(t,time,energy){
    if(excludedThisRound.has(t.id)) return -9999;
    if(!isAvailable(t)) return -9999;
    if(t.duration>time && time<999) return -500-(t.duration-time);
    // v0.2.0 : un refus ne pénalise plus la tâche partout. Il compte surtout si le contexte ressemble au refus observé.
    const refusalPenalty=Math.min(8,contextualRefusals(t,time,energy)*2.2);
    // v0.2.1 : une acceptation dans un contexte proche devient un signal positif, sans écraser urgence/importance.
    const acceptanceBonus=Math.min(6,contextualAcceptances(t,time,energy)*1.8);
    const energyFit=t.effort<=energy?3:-(t.effort-energy)*3.5;
    const timeFit=time===999?1:Math.max(0,4-Math.abs(time-t.duration)/8);
    return t.importance*4+t.urgency*4+energyFit+timeFit+acceptanceBonus-refusalPenalty;
  }
  function reasonFor(t,time,energy){
    const bits=[];
    if(t.urgency===3)bits.push('elle mérite ton attention assez vite');else if(t.importance===3)bits.push('elle compte davantage que plusieurs autres tâches');else bits.push('elle est utile sans être énorme');
    if(time===999||t.duration<=time)bits.push(`elle tient dans les ≈ ${t.duration} minutes prévues`);
    if(t.effort<=energy)bits.push('son effort paraît compatible avec ton énergie actuelle');
    if(t.place)bits.push(`elle se fait à ${t.place}`);
    return `Je te la propose parce que ${bits.join(', et ')}.`;
  }
  function candidateList(time,energy){return state.tasks.filter(t=>isAvailable(t)&&!inTodayProgram(t.id)).map(t=>({t,score:scoreTask(t,time,energy)})).sort((a,b)=>b.score-a.score||a.t.name.localeCompare(b.t.name,'fr',{sensitivity:'base'}));}
  function chooseSuggestion(){
    const time=Number($('timeAvailable').value),energy=Number($('energy').value);state.context={time,energy};save();
    const available=state.tasks.filter(t=>isAvailable(t)&&!inTodayProgram(t.id));
    if(!available.length){
      currentSuggestionId=null;$('suggestionTitle').textContent='Rien ne presse';$('suggestionDuration').textContent='⏱ —';$('suggestionEffort').textContent='◉ —';$('suggestionPlace').classList.add('hidden');$('suggestionReason').textContent='Aucune autre tâche n’est actuellement à proposer. Les tâches disponibles sont peut-être déjà dans ton programme ou en période de repos.';$('consequenceText').textContent='Aucune conséquence importante détectée.';$('keepInMind').innerHTML=waitingSummary();return;
    }
    let candidates=candidateList(time,energy);
    // Après avoir parcouru toute la liste avec « Autre chose », on recommence au début.
    if(!candidates.length || candidates[0].score<=-9000){excludedThisRound.clear();candidates=candidateList(time,energy);}
    if(candidates[0].score<-400){candidates=available.filter(t=>!excludedThisRound.has(t.id)).map(t=>({t,score:(t.importance*4+t.urgency*4)-(t.duration/30)})).sort((a,b)=>b.score-a.score||a.t.name.localeCompare(b.t.name,'fr',{sensitivity:'base'}));if(!candidates.length){excludedThisRound.clear();return chooseSuggestion();}}
    const t=candidates[0].t;currentSuggestionId=t.id;
    $('suggestionTitle').textContent=t.name;$('suggestionDuration').textContent=`⏱ ≈ ${t.duration} min`;$('suggestionEffort').textContent=`◉ Effort ${['','facile','moyen','demandant'][t.effort]}`;
    if(t.place){$('suggestionPlace').textContent=`📍 ${t.place}`;$('suggestionPlace').classList.remove('hidden');}else $('suggestionPlace').classList.add('hidden');
    $('suggestionReason').textContent=reasonFor(t,time,energy);$('consequenceText').textContent=t.consequence||'Pas de conséquence renseignée.';
    const others=state.tasks.filter(x=>isAvailable(x)&&!inTodayProgram(x.id)&&x.id!==t.id).map(x=>({t:x,score:scoreTask(x,time,energy)})).sort((a,b)=>b.score-a.score||a.t.name.localeCompare(b.t.name,'fr',{sensitivity:'base'})).slice(0,3);
    $('keepInMind').innerHTML=others.length?others.map(x=>`<button class="mini-item clickable" data-task-id="${x.t.id}"><strong>${escapeHtml(x.t.name)}</strong><span>≈ ${x.t.duration} min${x.t.place?' · '+escapeHtml(x.t.place):''} · ${urgencyLabel(x.t.urgency)}</span></button>`).join(''):waitingSummary();
    $('keepInMind').querySelectorAll('[data-task-id]').forEach(b=>b.onclick=()=>openTaskFromMind(b.dataset.taskId));
  }
  function waitingSummary(){const waiting=state.tasks.filter(isWaiting).sort((a,b)=>new Date(a.blockedUntil)-new Date(b.blockedUntil)).slice(0,3);if(!waiting.length)return '<div class="mini-item"><strong>Tout va bien</strong><span>Tu peux ajouter une nouvelle tâche quand elle apparaît.</span></div>';return waiting.map(t=>`<button class="mini-item clickable" data-task-id="${t.id}"><strong>${escapeHtml(t.name)}</strong><span>À reproposer après le ${formatDate(t.blockedUntil)}</span></button>`).join('');}
  function currentTask(){return state.tasks.find(t=>t.id===currentSuggestionId);}

  function eventContext(now=new Date()){return {...state.context,dayPart:dayPart(now)};}
  function recordTaskEvent(t,type,extra={}){const now=extra.at?new Date(extra.at):new Date();const ev={id:eventId(),type,taskId:t.id,name:t.name,at:now.toISOString(),context:eventContext(now),place:t.place||'',cancelled:false,...extra};t.events=Array.isArray(t.events)?t.events:[];t.events.unshift(ev);state.history.unshift({...ev});return ev;}
  function programEntry(id){normalizeTodayProgram();return state.todayProgram.entries.find(e=>e.taskId===id);}
  function inTodayProgram(id){const e=programEntry(id);return !!e&&e.status!=='postponed';}
  function addToTodayProgram(t,origin){rolloverTodayProgram();normalizeTodayProgram();let e=programEntry(t.id);if(!e){e={taskId:t.id,status:'active',origin,addedAt:new Date().toISOString()};state.todayProgram.entries.push(e);}else{e.status='active';e.origin=origin;e.addedAt=new Date().toISOString();delete e.doneEventId;delete e.postponedEventId;}recordTaskEvent(t,origin==='personal'?'personal':'accepted',{origin});}
  function dayEndIso(key){const [y,m,d]=String(key).split('-').map(Number);return new Date(y,m-1,d,23,59,59,999).toISOString();}
  function rolloverTodayProgram(){normalizeTodayProgram();const nowKey=todayKey();if(state.todayProgram.date===nowKey)return false;const oldDate=state.todayProgram.date;state.todayProgram.entries.forEach(e=>{if(e.status!=='active')return;const t=state.tasks.find(x=>x.id===e.taskId);if(t)recordTaskEvent(t,'non_realized',{at:dayEndIso(oldDate),programDate:oldDate,automatic:true});});state.todayProgram={date:nowKey,entries:[]};return true;}
  function setEventCancelled(t,eventIdValue,cancelled=true){const te=(t.events||[]).find(e=>e.id===eventIdValue);if(te)te.cancelled=cancelled;const he=(state.history||[]).find(e=>e.id===eventIdValue);if(he)he.cancelled=cancelled;}
  function recomputeTaskCompletion(t){const doneEvents=(t.events||[]).filter(e=>e.type==='done'&&!e.cancelled).sort((a,b)=>new Date(b.at)-new Date(a.at));const latest=doneEvents[0];if(!latest){t.done=false;t.blockedUntil=null;t.lastDoneAt=null;delete t.doneAt;return;}const when=new Date(latest.at);t.lastDoneAt=when.toISOString();if(hasTemporalite(t)){t.done=false;t.blockedUntil=addPeriod(when,t.repeatValue,t.repeatUnit).toISOString();if(new Date(t.blockedUntil)<=new Date())t.blockedUntil=null;}else{t.done=true;t.doneAt=when.toISOString();t.blockedUntil=null;}}

  function markTaskDone(t,source='program',at=null){
    const now=at?new Date(at):new Date();const before={done:!!t.done,blockedUntil:t.blockedUntil||null,lastDoneAt:t.lastDoneAt||null,doneAt:t.doneAt||null};t.lastDoneAt=now.toISOString();
    if(hasTemporalite(t)){t.done=false;t.blockedUntil=addPeriod(now,t.repeatValue,t.repeatUnit).toISOString();delete t.doneAt;}
    else{t.done=true;t.doneAt=now.toISOString();t.blockedUntil=null;}
    return recordTaskEvent(t,'done',{at:now.toISOString(),nextEligibleAt:t.blockedUntil||null,source,before});
  }
  function undoProgramDone(t,e){if(!e||e.status!=='done')return;const doneEvent=(t.events||[]).find(ev=>ev.id===e.doneEventId);if(doneEvent)setEventCancelled(t,doneEvent.id,true);recomputeTaskCompletion(t);recordTaskEvent(t,'cancelled',{targetType:'done',targetEventId:e.doneEventId,source:'program'});e.status='active';delete e.doneEventId;}
  function accepted(){const t=currentTask();if(!t)return;if(!inTodayProgram(t.id))addToTodayProgram(t,'suggestion');excludedThisRound.add(t.id);save();toast('Ajouté à « Mon programme pour aujourd’hui ».');renderLearning();chooseSuggestion();}
  function refused(){const t=currentTask();if(!t)return;state.refusals[t.id]=(state.refusals[t.id]||0)+1;recordTaskEvent(t,'refused');excludedThisRound.add(t.id);save();toast('Compris. Je retiens surtout le contexte de ce refus.');renderLearning();chooseSuggestion();}
  function another(){const t=currentTask();if(t)excludedThisRound.add(t.id);chooseSuggestion();toast('Je cherche une autre proposition.');}
  function why(){const t=currentTask();if(!t)return;alert(`${t.name}\n\n${reasonFor(t,state.context.time,state.context.energy)}\n\nSi tu attends : ${t.consequence||'aucune conséquence renseignée.'}`);}

  function renderTodayProgram(){
    const box=$('todayProgram');if(!box)return;rolloverTodayProgram();normalizeTodayProgram();
    const items=state.todayProgram.entries.map(e=>({e,t:state.tasks.find(t=>t.id===e.taskId)})).filter(x=>x.t);
    box.innerHTML=items.length?items.map(({e,t})=>{const done=e.status==='done',post=e.status==='postponed';return `<article class="program-item ${done?'program-done-state':''} ${post?'program-postponed-state':''}" data-id="${t.id}"><div><strong>${escapeHtml(t.name)}</strong><span>≈ ${t.duration} min${t.place?' · 📍 '+escapeHtml(t.place):''}${done?' · Fait':post?' · Repoussé':''}</span></div><div class="program-actions">${done?'<button class="secondary small program-undo">↶ Annuler</button>':post?'<span class="program-state-label">Repoussé</span>':'<button class="primary small program-done">✓ Fait</button><button class="secondary small program-postpone">Repousser</button>'}</div></article>`;}).join(''):'<p class="muted program-empty">Rien de choisi pour l’instant. Tu peux accepter une suggestion ou faire un « Choix personnel ».</p>';
    box.querySelectorAll('.program-done').forEach(b=>b.onclick=()=>{const row=b.closest('.program-item'),t=state.tasks.find(x=>x.id===row.dataset.id),e=programEntry(row.dataset.id);if(!t||!e)return;const ev=markTaskDone(t,'program');e.status='done';e.doneEventId=ev.id;save();excludedThisRound.clear();renderTasks();renderLearning();chooseSuggestion();toast(t.blockedUntil?`Fait. À reproposer après le ${formatDate(t.blockedUntil)}.`:'Fait. La durée était-elle à peu près juste ? Sinon, modifie-la dans la tâche.');});
    box.querySelectorAll('.program-undo').forEach(b=>b.onclick=()=>{const row=b.closest('.program-item'),t=state.tasks.find(x=>x.id===row.dataset.id),e=programEntry(row.dataset.id);if(!t||!e)return;undoProgramDone(t,e);save();excludedThisRound.clear();renderTasks();renderLearning();chooseSuggestion();toast('« Fait » annulé. La tâche reste dans ton programme.');});
    box.querySelectorAll('.program-postpone').forEach(b=>b.onclick=()=>{const row=b.closest('.program-item'),t=state.tasks.find(x=>x.id===row.dataset.id),e=programEntry(row.dataset.id);if(!t||!e)return;const ev=recordTaskEvent(t,'postponed',{source:'program'});e.status='postponed';e.postponedEventId=ev.id;save();excludedThisRound.clear();renderLearning();chooseSuggestion();toast('Repoussé. Je garde aussi cette décision en mémoire.');});
  }
  function renderPersonalChoiceResults(){const q=$('personalChoiceSearch').value.trim().toLocaleLowerCase('fr');const box=$('personalChoiceResults');let tasks=state.tasks.filter(t=>isAvailable(t)&&!inTodayProgram(t.id));if(q)tasks=tasks.filter(t=>t.name.toLocaleLowerCase('fr').includes(q));tasks.sort((a,b)=>a.name.localeCompare(b.name,'fr',{sensitivity:'base'}));if(!q){box.innerHTML='<div class="smart-empty">Commence à écrire le nom d’une tâche.</div>';return;}box.innerHTML=tasks.length?tasks.slice(0,8).map(t=>`<button class="choice-result" data-id="${t.id}"><strong>${escapeHtml(t.name)}</strong><span>≈ ${t.duration} min${t.place?' · '+escapeHtml(t.place):''}</span></button>`).join(''):'<div class="smart-empty">Aucune tâche correspondante disponible.</div>';box.querySelectorAll('[data-id]').forEach(b=>b.onclick=()=>{const t=state.tasks.find(x=>x.id===b.dataset.id);if(!t)return;addToTodayProgram(t,'personal');save();$('personalChoiceSearch').value='';$('personalChoicePanel').classList.add('hidden');renderLearning();chooseSuggestion();toast(`« ${t.name} » ajouté à ton programme.`);});}
  function togglePersonalChoice(){const panel=$('personalChoicePanel');panel.classList.toggle('hidden');if(!panel.classList.contains('hidden')){renderPersonalChoiceResults();setTimeout(()=>$('personalChoiceSearch').focus(),0);}}

  function taskStatus(t){if(t.done)return 'done';if(isWaiting(t))return 'waiting';return 'available';}
  function filteredTasks(){
    const q=$('taskSearch').value.trim().toLocaleLowerCase('fr');const status=$('taskStatusFilter').value;const place=$('taskPlaceFilter').value;
    return [...state.tasks].filter(t=>{const hay=`${t.name} ${t.consequence||''} ${t.place||''}`.toLocaleLowerCase('fr');return (!q||hay.includes(q))&&(status==='all'||taskStatus(t)===status)&&(place==='all'||(t.place||'')===place);}).sort((a,b)=>a.name.localeCompare(b.name,'fr',{sensitivity:'base'}));
  }
  function renderTasks(){
    refreshSmartLists();const box=$('taskList');const tasks=filteredTasks();if(!tasks.length){box.innerHTML='<div class="card">Aucune tâche ne correspond au filtre.</div>';return;}
    box.innerHTML=tasks.map(t=>{
      const status=taskStatus(t);const statusText=status==='waiting'?`À reproposer après le ${formatDate(t.blockedUntil)}`:status==='done'?'Terminée':'Proposable maintenant';
      return `<article class="task-card ${status}" data-id="${t.id}"><div><h3>${t.done?'✓ ':''}${escapeHtml(t.name)}</h3><div class="task-meta"><span>≈ ${t.duration} min</span><span>Importance ${t.importance}/3</span><span>Urgence ${t.urgency}/3</span><span>Effort ${t.effort}/3</span>${t.place?`<span>📍 ${escapeHtml(t.place)}</span>`:''}${hasTemporalite(t)?`<span>↻ ${escapeHtml(temporaliteLabel(t))}</span>`:''}</div><div class="task-status">${statusText}</div><p class="muted">${escapeHtml(t.consequence||'Aucune conséquence renseignée.')}</p></div><div class="task-actions"><button class="icon-btn history-task">Historique</button><button class="icon-btn edit-task">Modifier</button><button class="icon-btn delete-task">Supprimer</button></div></article>`;
    }).join('');
    box.querySelectorAll('.history-task').forEach(b=>b.onclick=()=>openTaskFromMind(b.closest('.task-card').dataset.id));box.querySelectorAll('.edit-task').forEach(b=>b.onclick=()=>editTask(b.closest('.task-card').dataset.id));box.querySelectorAll('.delete-task').forEach(b=>b.onclick=()=>deleteTask(b.closest('.task-card').dataset.id));
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
  function deleteTask(id){const t=state.tasks.find(x=>x.id===id);if(!t)return;if(!confirm(`Supprimer « ${t.name} » ?`))return;state.tasks=state.tasks.filter(x=>x.id!==id);save();excludedThisRound.clear();renderTasks();chooseSuggestion();}
  let detailTaskId=null;
  const eventLabels={done:'✓ Fait',accepted:'👍 Je m’y mets',refused:'☹ Pas envie',personal:'👤 Choix personnel',postponed:'↪ Repoussé',cancelled:'↶ Annulé',non_realized:'○ Non réalisé'};
  function localInputValue(date=new Date()){const off=date.getTimezoneOffset()*60000;return new Date(date.getTime()-off).toISOString().slice(0,16);}
  function cancelHistoryEvent(t,eventIdValue){const ev=(t.events||[]).find(e=>e.id===eventIdValue);if(!ev||ev.cancelled)return;setEventCancelled(t,eventIdValue,true);recordTaskEvent(t,'cancelled',{targetType:ev.type,targetEventId:eventIdValue,source:'history_correction'});if(ev.type==='done')recomputeTaskCompletion(t);save();renderLearning();renderTasks();openTaskFromMind(t.id);toast('Action annulée dans l’historique.');}
  function addHistoryCorrection(t){const type=$('historyCorrectionType')?.value;const raw=$('historyCorrectionAt')?.value;if(!type||!raw)return;const at=new Date(raw);if(Number.isNaN(at.getTime())){toast('Choisis une date valide.');return;}if(type==='done'){(t.events||[]).filter(e=>e.type==='non_realized'&&!e.cancelled&&todayKey(new Date(e.at))===todayKey(at)).forEach(e=>setEventCancelled(t,e.id,true));markTaskDone(t,'history_correction',at.toISOString());}else recordTaskEvent(t,type,{at:at.toISOString(),source:'history_correction',manual:true});recomputeTaskCompletion(t);save();renderLearning();renderTasks();openTaskFromMind(t.id);toast('Correction ajoutée à l’historique.');}
  function openTaskFromMind(id){
    const t=state.tasks.find(x=>x.id===id);if(!t)return;detailTaskId=id;const status=taskStatus(t);const statusText=status==='waiting'?`À reproposer après le ${formatDate(t.blockedUntil)}`:status==='done'?'Terminée':'Proposable maintenant';
    const hist=(t.events||[]).slice().sort((a,b)=>new Date(b.at)-new Date(a.at));
    const histHtml=hist.length?hist.map(e=>`<div class="task-history-row ${e.cancelled?'history-cancelled':''}"><div><strong>${eventLabels[e.type]||escapeHtml(e.type)}${e.cancelled?' — annulé':''}</strong>${e.source==='history_correction'?'<small>Correction manuelle</small>':''}</div><div class="history-row-right"><span>${new Date(e.at).toLocaleString('fr-FR')}</span>${!e.cancelled&&e.type!=='cancelled'?`<button class="history-cancel-btn" data-event-id="${e.id}">Annuler</button>`:''}</div></div>`).join(''):'<p class="muted">Aucune action enregistrée pour cette tâche.</p>';
    $('detailTitle').textContent=t.name;$('taskDetailBody').innerHTML=`<div class="detail-meta"><span>≈ ${t.duration} min</span><span>Importance ${t.importance}/3</span><span>Urgence ${t.urgency}/3</span><span>Effort ${t.effort}/3</span>${t.place?`<span>📍 ${escapeHtml(t.place)}</span>`:''}${hasTemporalite(t)?`<span>↻ ${escapeHtml(temporaliteLabel(t))}</span>`:''}</div><div class="detail-status">${statusText}</div><p>${escapeHtml(t.consequence||'Aucune conséquence renseignée.')}</p><h3 class="history-title">Historique de cette tâche</h3><div class="task-history">${histHtml}</div><div class="history-correction"><h3>Corriger / compléter l’historique</h3><p class="muted">Utile si tu as oublié hier de noter une action. 😉</p><div class="history-correction-grid"><label>Action<select id="historyCorrectionType"><option value="done">Fait</option><option value="postponed">Repoussé</option><option value="refused">Pas envie</option><option value="accepted">Je m’y mets</option><option value="personal">Choix personnel</option><option value="non_realized">Non réalisé</option></select></label><label>Date et heure<input id="historyCorrectionAt" type="datetime-local" value="${localInputValue()}"></label></div><button id="addHistoryCorrection" class="secondary small">Ajouter la correction</button></div>`;
    $('taskDetailBody').querySelectorAll('.history-cancel-btn').forEach(b=>b.onclick=()=>cancelHistoryEvent(t,b.dataset.eventId));$('addHistoryCorrection').onclick=()=>addHistoryCorrection(t);$('taskDetailModal').classList.remove('hidden');
  }
  function closeTaskDetail(){$('taskDetailModal').classList.add('hidden');detailTaskId=null;}


  function renderLearning(){
    const refused=state.history.filter(h=>!h.cancelled&&h.type==='refused');
    const accepted=state.history.filter(h=>!h.cancelled&&h.type==='accepted');
    const recent=state.history.filter(h=>!h.cancelled).slice(0,12);
    function groupedSignals(items){
      const groups={};
      items.forEach(h=>{const c=h.context||{};const key=[h.taskId,c.energy||'?',timeBand(Number(c.time)),c.dayPart||'moment inconnu',h.place||''].join('|');if(!groups[key])groups[key]={h,n:0};groups[key].n++;});
      return Object.values(groups).filter(g=>g.n>=2).sort((a,b)=>b.n-a.n);
    }
    const acceptanceSignals=groupedSignals(accepted), refusalSignals=groupedSignals(refused);
    const contextLine=g=>{const h=g.h,c=h.context||{};const temps=c.time===999?'temps libre':(c.time||'?')+' min';return `${escapeHtml(c.dayPart||'moment ?')} · ${temps} · énergie ${c.energy||'?'}/3${h.place?' · '+escapeHtml(h.place):''}`;};
    let html='<h3>Ce que je commence à comprendre</h3>';
    html+='<div class="learning-subtitle"><strong>👍 Contextes qui te conviennent</strong></div>';
    if(!accepted.length)html+='<p class="muted">Aucune acceptation observée pour l’instant. « D’accord, je m’y mets » mémorise maintenant le contexte sans marquer la tâche comme faite.</p>';
    else if(!acceptanceSignals.length)html+='<p class="muted">J’ai enregistré des acceptations, mais pas encore assez de répétitions dans un même contexte pour en tirer une habitude.</p>';
    else html+=acceptanceSignals.slice(0,6).map(g=>`<div class="learning-row"><strong>${escapeHtml(g.h.name)}</strong><div>${g.n} acceptations dans un contexte proche · ${contextLine(g)}. <span class="muted">Djinn favorisera légèrement cette proposition dans un contexte semblable.</span></div></div>`).join('');
    html+='<div class="learning-subtitle" style="margin-top:14px"><strong>☹ Contextes à éviter</strong></div>';
    if(!refused.length)html+='<p class="muted">Aucun refus observé pour l’instant.</p>';
    else if(!refusalSignals.length)html+='<p class="muted">J’ai enregistré des refus, mais pas encore assez de répétitions dans un même contexte pour en tirer une habitude.</p>';
    else html+=refusalSignals.slice(0,6).map(g=>`<div class="learning-row"><strong>${escapeHtml(g.h.name)}</strong><div>${g.n} refus dans un contexte proche · ${contextLine(g)}. <span class="muted">Djinn évitera davantage cette proposition dans ce contexte, pas dans les autres.</span></div></div>`).join('');
    html+='<h3 style="margin-top:16px">Observations récentes</h3>';
    const label={done:'✓ Fait',accepted:'👍 Je m’y mets',refused:'☹ Pas envie',personal:'👤 Choix personnel',postponed:'↪ Repoussé',cancelled:'↶ Annulé',non_realized:'○ Non réalisé'};
    html+=recent.length?recent.map(h=>`<div class="learning-row"><strong>${label[h.type]||'• Observation'} — ${escapeHtml(h.name)}</strong><div class="muted">${new Date(h.at).toLocaleString('fr-FR')} · ${h.context?.dayPart||dayPart(new Date(h.at))} · ${h.context?.time===999?'temps libre':(h.context?.time||'?')+' min'} · énergie ${h.context?.energy||'?'}/3${h.place?' · '+escapeHtml(h.place):''}${h.nextEligibleAt?' · reproposable le '+formatDate(h.nextEligibleAt):''}</div></div>`).join(''):'<p class="muted">Aucune observation enregistrée pour l’instant.</p>';
    $('learningList').innerHTML=html;
  }

  function renderStats(){const done=state.history.filter(h=>!h.cancelled&&h.type==='done').length;const refus=state.history.filter(h=>!h.cancelled&&h.type==='refused').length;$('taskCount').textContent=state.tasks.filter(isAvailable).length;$('doneCount').textContent=done;$('refusalCount').textContent=refus;}
  function setView(id){views.forEach(v=>v.classList.toggle('active',v.id===id));navButtons.forEach(b=>b.classList.toggle('active',b.dataset.view===id));window.scrollTo({top:0,behavior:'smooth'});if(id==='tasks')renderTasks();if(id==='learning')renderLearning();}

  function exportData(){const payload={app:'Djinn',version:VERSION,exportedAt:new Date().toISOString(),state};const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);const stamp=new Date().toISOString().replace(/[:T]/g,'-').slice(0,16);a.download=`Djinn_${stamp}.djinnbak`;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove();},500);state.lastTransferAction=`Export ${a.download} · ${nowLabel()}`;save();toast('Sauvegarde exportée.');}
  function importData(file){if(!file)return;const reader=new FileReader();reader.onload=()=>{try{const parsed=JSON.parse(reader.result);const incoming=parsed.state||parsed;if(!incoming||!Array.isArray(incoming.tasks))throw new Error('format');if(!confirm(`Importer « ${file.name} » et remplacer les données locales actuelles ?`))return;state={...defaultState(),...incoming,tasks:incoming.tasks.map(normalizeTask),smartMemory:{places:[],...(incoming.smartMemory||{})}};state.tasks.forEach(t=>rememberSmart('places',t.place));normalizeTodayProgram();(state.history||[]).forEach(h=>{if(!h.id)h.id=eventId();const t=state.tasks.find(x=>x.id===h.taskId);if(t&&!t.events.some(e=>(e.id&&e.id===h.id)||(!e.id&&e.at===h.at&&e.type===h.type)))t.events.push({...h});});state.tasks.forEach(t=>(t.events||[]).forEach(e=>{if(!e.id)e.id=eventId();if(e.cancelled==null)e.cancelled=false;}));rolloverTodayProgram();state.lastTransferAction=`Import ${file.name} · ${nowLabel()}`;excludedThisRound.clear();save();renderTasks();renderLearning();chooseSuggestion();toast('Sauvegarde importée.');}catch(e){alert('Ce fichier ne semble pas être une sauvegarde Djinn valide.');}finally{$('importFile').value='';}};reader.readAsText(file);}

  navButtons.forEach(b=>b.addEventListener('click',()=>setView(b.dataset.view)));
  $('timeAvailable').value=String(state.context.time||20);$('energy').value=String(state.context.energy||2);
  $('timeAvailable').addEventListener('change',()=>{excludedThisRound.clear();chooseSuggestion();});$('energy').addEventListener('change',()=>{excludedThisRound.clear();chooseSuggestion();});
  $('doIt').onclick=accepted;$('notNow').onclick=refused;$('another').onclick=another;$('whyTop').onclick=why;$('personalChoice').onclick=togglePersonalChoice;$('personalChoiceSearch').addEventListener('input',renderPersonalChoiceResults);
  $('openTaskForm').onclick=()=>openForm(true);$('cancelTask').onclick=closeForm;$('saveTask').onclick=saveTask;
  ['taskSearch','taskStatusFilter','taskPlaceFilter'].forEach(id=>$(id).addEventListener(id==='taskSearch'?'input':'change',renderTasks));
  $('photoDemo').onclick=()=>toast('La photo sera activée dans une prochaine version.');$('voiceDemo').onclick=()=>toast('La voix viendra plus tard.');$('writeDemo').onclick=()=>{setView('tasks');openForm(true);toast('Pour l’instant, écris la situation comme une tâche.');};
  $('exportData').onclick=exportData;$('importData').onclick=()=>$('importFile').click();$('importFile').addEventListener('change',e=>importData(e.target.files?.[0]));
  $('placeToggle').onclick=()=>renderPlaceMenu('',true);$('taskPlace').addEventListener('input',e=>renderPlaceMenu(e.target.value));$('taskPlace').addEventListener('focus',e=>renderPlaceMenu(e.target.value));document.addEventListener('click',e=>{if(!$('placeSmartField').contains(e.target))$('placeMenu').classList.add('hidden');});
  $('taskRepeatUnit').addEventListener('focus',()=>{previousRepeatUnit=$('taskRepeatUnit').value;});$('taskRepeatUnit').addEventListener('change',e=>openTemporalPrompt(e.target.value));$('saveTemporal').onclick=saveTemporalPrompt;$('cancelTemporal').onclick=()=>closeTemporalPrompt(true);$('closeTemporal').onclick=()=>closeTemporalPrompt(true);$('temporalModal').addEventListener('click',e=>{if(e.target===$('temporalModal'))closeTemporalPrompt(true);});$('temporalNumber').addEventListener('keydown',e=>{if(e.key==='Enter')saveTemporalPrompt();});
  $('closeTaskDetail').onclick=closeTaskDetail;$('detailClose').onclick=closeTaskDetail;$('taskDetailModal').addEventListener('click',e=>{if(e.target===$('taskDetailModal'))closeTaskDetail();});
  $('resetDemo').onclick=()=>{if(!confirm('Réinitialiser toutes les données locales de Djinn ?'))return;state=defaultState();excludedThisRound.clear();save();renderTasks();renderLearning();chooseSuggestion();toast('Données de démonstration réinitialisées.');};

  const rolled=rolloverTodayProgram();if(rolled)localStorage.setItem(KEY,JSON.stringify(state));renderHeader();renderBackupInfo();refreshSmartLists();renderTasks();renderLearning();renderStats();renderTodayProgram();chooseSuggestion();
  if('serviceWorker' in navigator){window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}));}
})();
