(() => {
  'use strict';
  const VERSION = '0.1.0';
  const KEY = 'djinn-v0100-state';
  const seedTasks = [
    {id:'t1',name:'Lancer une lessive',duration:6,importance:2,urgency:3,effort:1,consequence:'Le panier risque de déborder et tu pourrais manquer de vêtements propres dans 1–2 jours.'},
    {id:'t2',name:'Ranger le plan de travail',duration:8,importance:2,urgency:2,effort:1,consequence:'Le désordre risque de rendre la préparation du prochain repas moins agréable.'},
    {id:'t3',name:'Repasser le linge',duration:35,importance:1,urgency:1,effort:2,consequence:'Peu de conséquence immédiate : cette tâche peut attendre.'},
    {id:'t4',name:'Trier le courrier',duration:12,importance:3,urgency:2,effort:1,consequence:'Un document important pourrait rester sans réponse trop longtemps.'},
    {id:'t5',name:'Arroser les plantes',duration:7,importance:2,urgency:2,effort:1,consequence:'Certaines plantes pourraient commencer à manquer d’eau.'},
    {id:'t6',name:'Ranger le bureau',duration:25,importance:1,urgency:1,effort:2,consequence:'Le désordre peut s’accumuler, mais rien n’impose de le faire maintenant.'}
  ];
  let state = load();
  let currentSuggestionId = null;
  let excludedThisRound = new Set();

  const $ = id => document.getElementById(id);
  const views = [...document.querySelectorAll('.view')];
  const navButtons = [...document.querySelectorAll('.nav-btn')];

  function defaultState(){
    return {tasks:structuredClone(seedTasks),history:[],refusals:{},context:{time:20,energy:2},lastAction:'Première visite'};
  }
  function load(){
    try{
      const raw=localStorage.getItem(KEY); if(!raw) return defaultState();
      const parsed=JSON.parse(raw);
      return {...defaultState(),...parsed,tasks:Array.isArray(parsed.tasks)?parsed.tasks:structuredClone(seedTasks)};
    }catch(e){return defaultState();}
  }
  function save(){localStorage.setItem(KEY,JSON.stringify(state));renderHeader();renderStats();}
  function nowLabel(){return new Date().toLocaleString('fr-FR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});}
  function setLastAction(text){state.lastAction=`${text} · ${nowLabel()}`;save();}
  function renderHeader(){$('lastAction').textContent=`Dernière action : ${state.lastAction||'—'}`;}
  function toast(msg){const el=$('toast');el.textContent=msg;el.classList.add('show');clearTimeout(toast.t);toast.t=setTimeout(()=>el.classList.remove('show'),2400);}

  function scoreTask(t,time,energy){
    if(excludedThisRound.has(t.id)) return -9999;
    if(t.duration>time && time<999) return -500 - (t.duration-time);
    const refusalPenalty=(state.refusals[t.id]||0)*1.3;
    const energyFit = t.effort<=energy ? 3 : -(t.effort-energy)*3.5;
    const timeFit = time===999 ? 1 : Math.max(0,4-Math.abs(time-t.duration)/8);
    return t.importance*4 + t.urgency*4 + energyFit + timeFit - refusalPenalty;
  }
  function reasonFor(t,time,energy){
    const bits=[];
    if(t.urgency===3) bits.push('elle mérite ton attention assez vite');
    else if(t.importance===3) bits.push('elle compte davantage que plusieurs autres tâches');
    else bits.push('elle est utile sans être énorme');
    if(time===999 || t.duration<=time) bits.push(`elle tient dans les ≈ ${t.duration} minutes prévues`);
    if(t.effort<=energy) bits.push('son effort paraît compatible avec ton énergie actuelle');
    return `Je te la propose parce que ${bits.join(', et ')}.`;
  }
  function chooseSuggestion(){
    const time=Number($('timeAvailable').value), energy=Number($('energy').value);
    state.context={time,energy};save();
    const active=state.tasks.filter(t=>!t.done);
    if(!active.length){
      currentSuggestionId=null;
      $('suggestionTitle').textContent='Rien ne presse';
      $('suggestionDuration').textContent='⏱ —'; $('suggestionEffort').textContent='◉ —';
      $('suggestionReason').textContent='Toutes les tâches actives ont été faites. Profite du calme.';
      $('consequenceText').textContent='Aucune conséquence importante détectée.';
      $('keepInMind').innerHTML='<div class="mini-item"><strong>Tout va bien</strong><span>Tu peux ajouter une nouvelle tâche quand elle apparaît.</span></div>';
      return;
    }
    let candidates=active.map(t=>({t,score:scoreTask(t,time,energy)})).sort((a,b)=>b.score-a.score);
    if(candidates[0].score<-400){
      candidates=active.map(t=>({t,score:(t.importance*4+t.urgency*4)-(t.duration/30)})).sort((a,b)=>b.score-a.score);
    }
    const t=candidates[0].t; currentSuggestionId=t.id;
    $('suggestionTitle').textContent=t.name;
    $('suggestionDuration').textContent=`⏱ ≈ ${t.duration} min`;
    $('suggestionEffort').textContent=`◉ Effort ${['','facile','moyen','demandant'][t.effort]}`;
    $('suggestionReason').textContent=reasonFor(t,time,energy);
    $('consequenceText').textContent=t.consequence||'Pas de conséquence renseignée.';
    $('keepInMind').innerHTML=candidates.slice(1,4).map(x=>`<div class="mini-item"><strong>${escapeHtml(x.t.name)}</strong><span>≈ ${x.t.duration} min · ${urgencyLabel(x.t.urgency)}</span></div>`).join('') || '<div class="mini-item"><span>Pas d’autre tâche active.</span></div>';
  }
  function urgencyLabel(v){return v===3?'urgent':v===2?'bientôt':'peut attendre';}
  function escapeHtml(s){return String(s).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}
  function currentTask(){return state.tasks.find(t=>t.id===currentSuggestionId);}

  function accepted(){
    const t=currentTask(); if(!t) return;
    t.done=true;t.doneAt=new Date().toISOString();
    state.history.unshift({type:'done',taskId:t.id,name:t.name,at:new Date().toISOString(),context:{...state.context}});
    excludedThisRound.clear();setLastAction(`Fait : ${t.name}`);toast('Bravo — enregistré, sans points ni série à conserver.');renderTasks();renderLearning();chooseSuggestion();
  }
  function refused(){
    const t=currentTask(); if(!t) return;
    state.refusals[t.id]=(state.refusals[t.id]||0)+1;
    state.history.unshift({type:'refused',taskId:t.id,name:t.name,at:new Date().toISOString(),context:{...state.context}});
    excludedThisRound.add(t.id);setLastAction(`Pas envie : ${t.name}`);toast('Compris. Djinn en tient compte et cherche autre chose.');renderLearning();chooseSuggestion();
  }
  function another(){const t=currentTask();if(t)excludedThisRound.add(t.id);chooseSuggestion();toast('Je cherche une autre proposition.');}
  function why(){const t=currentTask();if(!t)return;alert(`${t.name}\n\n${reasonFor(t,state.context.time,state.context.energy)}\n\nSi tu attends : ${t.consequence||'aucune conséquence renseignée.'}`);}

  function renderTasks(){
    const box=$('taskList');
    if(!state.tasks.length){box.innerHTML='<div class="card">Aucune tâche enregistrée.</div>';return;}
    box.innerHTML=state.tasks.map(t=>`<article class="task-card" data-id="${t.id}"><div><h3>${t.done?'✓ ':''}${escapeHtml(t.name)}</h3><div class="task-meta"><span>≈ ${t.duration} min</span><span>Importance ${t.importance}/3</span><span>Urgence ${t.urgency}/3</span><span>Effort ${t.effort}/3</span></div><p class="muted">${escapeHtml(t.consequence||'Aucune conséquence renseignée.')}</p></div><div class="task-actions"><button class="icon-btn edit-task">Modifier</button><button class="icon-btn toggle-task">${t.done?'Réactiver':'Fait'}</button><button class="icon-btn delete-task">Supprimer</button></div></article>`).join('');
    box.querySelectorAll('.edit-task').forEach(b=>b.onclick=()=>editTask(b.closest('.task-card').dataset.id));
    box.querySelectorAll('.toggle-task').forEach(b=>b.onclick=()=>toggleTask(b.closest('.task-card').dataset.id));
    box.querySelectorAll('.delete-task').forEach(b=>b.onclick=()=>deleteTask(b.closest('.task-card').dataset.id));
  }
  function openForm(clear=true){$('taskForm').classList.remove('hidden');if(clear){$('formTitle').textContent='Ajouter une tâche';$('taskId').value='';$('taskName').value='';$('taskDuration').value=10;$('taskImportance').value=2;$('taskUrgency').value=2;$('taskEffort').value=2;$('taskConsequence').value='';}$('taskName').focus();}
  function closeForm(){$('taskForm').classList.add('hidden');}
  function editTask(id){const t=state.tasks.find(x=>x.id===id);if(!t)return;openForm(false);$('formTitle').textContent='Modifier la tâche';$('taskId').value=t.id;$('taskName').value=t.name;$('taskDuration').value=t.duration;$('taskImportance').value=t.importance;$('taskUrgency').value=t.urgency;$('taskEffort').value=t.effort;$('taskConsequence').value=t.consequence||'';window.scrollTo({top:0,behavior:'smooth'});}
  function saveTask(){const name=$('taskName').value.trim();if(!name){toast('Donne un nom à la tâche.');return;}const data={name,duration:Math.max(1,Number($('taskDuration').value)||10),importance:Number($('taskImportance').value),urgency:Number($('taskUrgency').value),effort:Number($('taskEffort').value),consequence:$('taskConsequence').value.trim()};const id=$('taskId').value;if(id){Object.assign(state.tasks.find(x=>x.id===id),data);setLastAction(`Tâche modifiée : ${name}`);}else{state.tasks.push({id:'t'+Date.now(),...data,done:false});setLastAction(`Tâche ajoutée : ${name}`);}closeForm();excludedThisRound.clear();renderTasks();chooseSuggestion();}
  function toggleTask(id){const t=state.tasks.find(x=>x.id===id);if(!t)return;t.done=!t.done;if(!t.done)delete t.doneAt;setLastAction(`${t.done?'Fait':'Réactivé'} : ${t.name}`);excludedThisRound.clear();renderTasks();chooseSuggestion();}
  function deleteTask(id){const t=state.tasks.find(x=>x.id===id);if(!t)return;if(!confirm(`Supprimer « ${t.name} » ?`))return;state.tasks=state.tasks.filter(x=>x.id!==id);setLastAction(`Tâche supprimée : ${t.name}`);excludedThisRound.clear();renderTasks();chooseSuggestion();}

  function renderLearning(){
    const refusals=Object.entries(state.refusals).filter(([,n])=>n>0).sort((a,b)=>b[1]-a[1]);
    const recent=state.history.slice(0,8);
    let html='<h3>Premiers signaux</h3>';
    if(!refusals.length) html+='<p class="muted">Djinn n’a pas encore observé de refus. Utilise « Pas envie » quand une proposition tombe mal.</p>';
    else html+=refusals.map(([id,n])=>{const t=state.tasks.find(x=>x.id===id);return `<div class="learning-row"><strong>${escapeHtml(t?.name||'Tâche supprimée')}</strong><div>${n} refus enregistré${n>1?'s':''}. Djinn réduit légèrement sa priorité dans les mêmes conditions.</div></div>`}).join('');
    html+='<h3 style="margin-top:20px">Historique récent</h3>';
    html+=recent.length?recent.map(h=>`<div class="learning-row"><strong>${h.type==='done'?'✓ Fait':'☹ Pas envie'} — ${escapeHtml(h.name)}</strong><div class="muted">${new Date(h.at).toLocaleString('fr-FR')} · ${h.context.time===999?'temps libre':h.context.time+' min'} · énergie ${h.context.energy}/3</div></div>`).join(''):'<p class="muted">Aucun apprentissage enregistré pour l’instant.</p>';
    $('learningList').innerHTML=html;
  }
  function renderStats(){const done=state.history.filter(h=>h.type==='done').length;const refus=state.history.filter(h=>h.type==='refused').length;$('taskCount').textContent=state.tasks.filter(t=>!t.done).length;$('doneCount').textContent=done;$('refusalCount').textContent=refus;}
  function setView(id){views.forEach(v=>v.classList.toggle('active',v.id===id));navButtons.forEach(b=>b.classList.toggle('active',b.dataset.view===id));window.scrollTo({top:0,behavior:'smooth'});}

  navButtons.forEach(b=>b.addEventListener('click',()=>setView(b.dataset.view)));
  $('timeAvailable').value=String(state.context.time||20);$('energy').value=String(state.context.energy||2);
  $('timeAvailable').addEventListener('change',()=>{excludedThisRound.clear();chooseSuggestion();setLastAction('Temps disponible modifié');});
  $('energy').addEventListener('change',()=>{excludedThisRound.clear();chooseSuggestion();setLastAction('Énergie modifiée');});
  $('doIt').onclick=accepted;$('notNow').onclick=refused;$('another').onclick=another;$('why').onclick=why;$('whyTop').onclick=why;
  $('openTaskForm').onclick=()=>openForm(true);$('cancelTask').onclick=closeForm;$('saveTask').onclick=saveTask;
  $('photoDemo').onclick=()=>toast('La photo sera activée dans une prochaine version.');$('voiceDemo').onclick=()=>toast('La voix viendra plus tard.');$('writeDemo').onclick=()=>{setView('tasks');openForm(true);toast('Pour l’instant, écris la situation comme une tâche.');};
  $('resetDemo').onclick=()=>{if(!confirm('Réinitialiser toutes les données locales de Djinn ?'))return;state=defaultState();excludedThisRound.clear();save();renderTasks();renderLearning();chooseSuggestion();toast('Données de démonstration réinitialisées.');};

  renderHeader();renderTasks();renderLearning();renderStats();chooseSuggestion();

  if('serviceWorker' in navigator){window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}));}
})();
