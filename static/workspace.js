// Shared web workspace for the PHP and Python editions.
export const DESCRIPTION_ORDERS = {
  label_plus_name: ['label','name'], name_plus_label: ['name','label'], name_only: ['name'],
  label_only: ['label'], extra_only: ['extra'], extra_name: ['extra','name'], name_extra: ['name','extra'],
  label_extra: ['label','extra'], extra_label: ['extra','label'], label_extra_name: ['label','extra','name'],
  label_name_extra: ['label','name','extra'], name_label_extra: ['name','label','extra'],
  name_extra_label: ['name','extra','label'], extra_label_name: ['extra','label','name'], extra_name_label: ['extra','name','label'],
};
export function descriptionParts(raw, mode) {
  if (raw) { try { const parts = JSON.parse(raw); if (Array.isArray(parts)) return parts; } catch {} }
  return DESCRIPTION_ORDERS[mode] || DESCRIPTION_ORDERS.label_plus_name;
}
export function dashboardSeries(history, period, today = new Date()) {
  const buckets = [];
  const key = d => period === 'monthly' ? `${d.getFullYear()}-${d.getMonth()}` : `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  for (let i = (period === 'monthly' ? 11 : 6); i >= 0; i--) {
    const d = period === 'monthly' ? new Date(today.getFullYear(), today.getMonth()-i, 1) : new Date(today.getFullYear(), today.getMonth(), today.getDate()-i);
    buckets.push({key:key(d), label:d.toLocaleDateString(undefined, period === 'monthly' ? {month:'short'} : {weekday:'short'}), count:0});
  }
  for (const row of history || []) {
    if (row.source_type === 'imported') continue;
    const d = new Date(row.created_at);
    if (Number.isNaN(d.getTime())) continue;
    const bucket = buckets.find(b => b.key === key(d));
    if (bucket) bucket.count++;
  }
  return buckets;
}

export function createWorkspace(h) {
  const $ = id => document.getElementById(id);
  const form = $('statement-form');
  const clone = value => JSON.parse(JSON.stringify(value));
  const stateKeys = ['generatedSeed','currentStatement','currentStatementId','currentStatementSource','statementEditMode','editableRows','validationErrors'];
  let context = 'generate', view = 'home', drafts = {}, defaults = {}, history = [], period = 'weekly', requestCount = 0;
  const navItems = [
    ['home','Home','Overview & recent activity'], ['generate','Statement Generation','Account, rules & descriptions'],
    ['profiles','Statement Profiles','Save and reuse your setup'], ['check','Statement Check','Import, edit & validate'],
    ['holidays','Holidays & Weekends','Local calendar & posting dates'], ['transfers','Export & Import','Excel, Word & A4 printing'],
    ['formats','Format Manager','Templates, editor & letterheads'], ['history','Saved Statements','History & previous work'],
    ['users','User Management','Details, access & status'], ['create-user','Create User','Add a new account'],
    ['devices','Devices & Activity','Sessions & account activity'],
  ];
  const adminViews = new Set(['users','create-user']);
  const titles = Object.fromEntries(navItems.map(([id,title])=>[id,title]));
  const section = (id, title, intro) => {
    const el=document.createElement('section'); el.id=id; el.className='form-panel';
    el.innerHTML=`<div class="section-head"><h2>${title}</h2><p>${intro}</p></div>`; form.append(el); return el;
  };
  const sidebar=document.createElement('aside'); sidebar.id='workspace-sidebar'; sidebar.className='workspace-sidebar';
  sidebar.innerHTML=`<a class="workspace-brand" href="#home"><span class="brand-mark">S</span><span>Statement Studio<small>YOUR WORKSPACE</small></span></a><p class="nav-label">WORKSPACE</p><nav aria-label="Main navigation">${navItems.map(([id,title,desc],i)=>`<button type="button" data-view="${id}"${adminViews.has(id)?' data-admin-nav':''}><span class="nav-symbol" aria-hidden="true">${['⌂','＋','▤','✓','▦','⇅','▧','◷','◎','＋','⚙'][i]}</span><span>${title}<small>${desc}</small></span></button>`).join('')}</nav><p class="sidebar-note">Your saved profiles, formats and statement history stay with your account.</p>`;
  document.body.prepend(sidebar);
  const topbar=document.querySelector('.topbar');
  const heading=document.createElement('div'); heading.className='workspace-heading';
  heading.innerHTML='<button type="button" id="sidebar-toggle" class="ghost-button" aria-label="Hide navigation" aria-controls="workspace-sidebar" aria-expanded="true">☰</button><div><p class="eyebrow">STATEMENT WORKSPACE</p><h1 id="workspace-title">Home</h1></div>';
  topbar.prepend(heading);
  const backdrop=document.createElement('button'); backdrop.type='button'; backdrop.className='sidebar-backdrop'; backdrop.setAttribute('aria-label','Close navigation'); document.body.append(backdrop);
  function toggleSidebar(collapsed) {
    document.body.classList.toggle('sidebar-collapsed',collapsed);
    $('sidebar-toggle').setAttribute('aria-expanded',String(!collapsed));
    $('sidebar-toggle').setAttribute('aria-label',collapsed?'Show navigation':'Hide navigation');
    sidebar.inert=collapsed;
    localStorage.setItem('statement-sidebar-collapsed',String(collapsed));
  }
  toggleSidebar(innerWidth<1000 || localStorage.getItem('statement-sidebar-collapsed')==='true');
  $('sidebar-toggle').onclick=()=>toggleSidebar(!document.body.classList.contains('sidebar-collapsed'));
  backdrop.onclick=()=>toggleSidebar(true);
  document.addEventListener('keydown',e=>{if(e.key==='Escape' && innerWidth<1000) toggleSidebar(true);});

  const home=section('home-panel','Welcome back','Your statement workspace, at a glance.');
  home.innerHTML+=`<div class="dashboard-cards"><article><span>Generated in the last 7 days</span><strong id="dashboard-week">0</strong></article><article><span>Generated this month</span><strong id="dashboard-month">0</strong></article><article><span>Saved statements in this view</span><strong id="dashboard-total">0</strong></article></div><div class="dashboard-chart-card"><div class="history-head"><h3>Generation activity</h3><select id="dashboard-period" aria-label="Chart period"><option value="weekly">Last 7 days</option><option value="monthly">Last 12 months</option></select></div><div id="dashboard-chart"></div><p class="muted">Counts reflect the saved history in this view (up to 50 recent records). Imported statements are excluded from generation counts.</p></div><div class="workspace-shortcuts"><button type="button" class="primary-button" data-go="generate">Create a statement</button><button type="button" class="ghost-button" data-go="check">Check an imported statement</button><button type="button" class="ghost-button" data-go="history">Open saved statements</button></div>`;
  const profiles=section('profiles-panel','Statement Profiles','Load a saved setup, edit Account, Statement Rules or Texts & Names, then save it here for further use.');
  const profileActions=document.createElement('div');profileActions.className='profile-workspace-actions';profiles.append(profileActions);
  for(const id of ['profile-format-select','load-profile-format-btn','save-profile-format-btn','edit-profile-format-btn','delete-profile-format-btn','profile-format-editor']) profileActions.append($(id));
  profiles.insertAdjacentHTML('beforeend','<div class="workspace-shortcuts"><button type="button" class="ghost-button" data-go="generate">Edit account and rules</button><button type="button" class="ghost-button" data-tab="texts-panel">Edit descriptions and names</button></div>');
  $('export-panel').insertAdjacentHTML('afterbegin','<label class="check-field export-letterhead-toggle"><input type="checkbox" id="export-with-letterhead"> Include the selected format’s saved A4 letterhead in Excel / Word export (.xlsx / .docx)</label>');
  const check=section('check-panel','Statement Check','Import an Excel statement, select its checking rules, then review or edit the rows. Your generation draft is kept separately.');
  check.innerHTML+=`<div class="field-grid two-col"><label class="field"><span>Checking mode</span><select id="statement-check-mode"><option value="new">New / normal statement</option><option value="profile">Saved statement profile</option></select></label><label class="field" id="check-profile-field" hidden><span>Saved profile</span><select id="check-profile-name"><option value="">Select a profile</option></select></label><label class="field"><span>Interest rate (%)</span><input id="check-interest-rate" type="number" min="0" max="100" step="0.0001" data-proxy="interest_rate"></label><label class="field"><span>Tax rate (%)</span><input id="check-tax-rate" type="number" min="0" max="100" step="0.0001" data-proxy="tax_rate"></label></div><p id="check-mode-note">Checks dates, balances, cheque numbers, interest and tax. Description wording is not restricted.</p><p class="muted">Interest: ROUND(Balance × Days × Rate / 36500, 2) per interval. Customer transactions may precede interest and tax on their posting date. An opening Balance B/F on that date carries the previous net balance.</p><div class="workspace-shortcuts"><button type="button" class="primary-button" data-click="import-statement-btn">Import Excel statement</button><button type="button" class="ghost-button" data-click="edit-statement-btn">Edit imported rows</button><button type="button" class="ghost-button" data-click="validate-statement-btn">Check statement</button><button type="button" class="ghost-button" data-tab="statement-panel">Review checking rules</button></div>`;
  const saved=section('history-panel','Saved Statements','Load a statement to review, edit, check or export it.');
  saved.append($('admin-counts-card'),$('history-table').closest('.inset-panel'));
  const devices=section('devices-panel','Devices & Activity','Review saved sessions and recent account activity.');
  devices.append($('devices-card'),$('activities-table').closest('.inset-panel'),$('selftest-btn'));
  const formats=section('formats-panel','Format Manager','Upload Excel or Word formats, open the editor, and save changes for future exports.');
  const choices=document.createElement('div'); choices.className='field-grid two-col'; formats.append(choices);
  for(const kind of ['statement','certificate']) {
    const label=document.createElement('label');label.className='field';
    label.innerHTML=`<span>${kind==='statement'?'Statement':'Certificate'} format</span><select id="format-choice-${kind}"></select>`;choices.append(label);
    const source=$(`${kind}-template-list`),target=$(`format-choice-${kind}`);
    const sync=()=>{target.replaceChildren(...[...source.options].map(option=>new Option(option.textContent,option.value,option.selected,option.selected)));};
    new MutationObserver(sync).observe(source,{childList:true});source.addEventListener('change',sync);
    target.onchange=()=>{source.value=target.value;source.dispatchEvent(new Event('change',{bubbles:true}));$('template-manage-kind').value=kind;};sync();
  }
  const manager=document.querySelector('#export-panel .normal-export:last-child'); if(manager) formats.append(manager);
  formats.insertAdjacentHTML('beforeend','<div class="workspace-shortcuts"><button type="button" class="ghost-button" data-go="transfers">Choose a format, export or set up its letterhead</button></div>');
  const adminDetails=document.createElement('div');adminDetails.className='inset-panel';adminDetails.id='user-details-editor';
  adminDetails.innerHTML=`<h3>User details & status</h3><p>Select a user above. Hiding keeps the account and files. Blocking stops login and ends existing sessions.</p><div class="field-grid two-col">${[['full_name','Full name'],['mobile_number','Mobile number'],['email','Email'],['address','Address'],['gender','Gender']].map(([key,label])=>`<label class="field"><span>${label}</span><input id="detail-${key}" maxlength="255"></label>`).join('')}<label class="check-field"><input id="detail-is_hidden" type="checkbox"> Hide from default user list</label><label class="check-field"><input id="detail-is_blocked" type="checkbox"> Block account</label></div><button type="button" class="primary-button" id="save-user-details">Save user details and status</button><p id="user-details-status" role="status"></p>`;
  $('admin-manage-card').append(adminDetails);
  $('admin-users-card').insertAdjacentHTML('afterbegin','<label class="check-field"><input type="checkbox" id="show-hidden-users"> Show hidden users</label>');
  $('show-hidden-users').onchange=()=>h.renderUsers(h.state.users);
  for(const id of ['view-user-history-btn','view-all-history-btn']) $(id).addEventListener('click',()=>navigate('history',true));
  $('save-user-details').onclick=async()=>{
    const button=$('save-user-details'); button.disabled=true;
    try {
      if(!h.state.selectedManagedUserId) throw new Error('Select a user first.');
      const admin_password=await h.requestPassword('Update user','Enter your admin password to save these details and account status.');
      if(!admin_password) return;
      const payload={user_id:Number(h.state.selectedManagedUserId),admin_password};
      for(const key of ['full_name','mobile_number','email','address','gender']) payload[key]=$(`detail-${key}`).value;
      for(const key of ['is_hidden','is_blocked']) payload[key]=$(`detail-${key}`).checked;
      const result=await h.fetchJson(h.apiUrl('update_user_details'),{method:'POST',body:JSON.stringify(payload)});
      h.renderUsers(result.users);$('user-details-status').textContent='Saved user details and status.';
    } catch(error) { $('user-details-status').textContent=error.message;h.log(error.message,'error'); }
    finally { button.disabled=false; }
  };

  for(const side of ['deposit','withdrawal']) {
    const panel=document.createElement('fieldset');panel.className='description-composer';
    panel.innerHTML=`<legend>${side==='deposit'?'Deposit':'Withdrawal'} description order</legend><p>Choose up to three parts, in the order they should appear.</p><div class="description-slots">${[0,1,2].map(i=>`<label class="field"><span>${['First','Second','Third'][i]}</span><select data-description-side="${side}" data-slot="${i}"><option value="none">None</option><option value="name">Name</option><option value="label">Label</option><option value="extra">Extra Text</option></select></label>`).join('')}</div><input type="hidden" name="${side}_description_parts"><input type="hidden" name="${side}_connector_enabled" value="legacy"><div class="connector-controls"><label class="check-field"><input type="checkbox" id="${side}-connector-check"> Add connector before a name following other text</label><label class="field"><span>Connector text</span><input name="${side}_connector_text" value="by" list="connector-words" maxlength="40"></label></div><p class="description-example" id="${side}-description-example" aria-live="polite"></p>`;
    $('texts-panel').append(panel);
    const selects=[...panel.querySelectorAll('select')];
    selects.forEach(select=>select.onchange=()=>{
      const parts=selects.map(s=>s.value);const chosen=parts.filter(p=>p!=='none');
      const valid=chosen.length>0 && new Set(chosen).size===chosen.length;
      selects.forEach(field=>field.setCustomValidity(valid?'':'Choose at least one part, without duplicates.'));
      form.elements[`${side}_description_parts`].value=JSON.stringify(parts);
      updateExample(side);h.scheduleSave();
    });
    $(`${side}-connector-check`).onchange=()=>{form.elements[`${side}_connector_enabled`].value=$(`${side}-connector-check`).checked?'yes':'no';updateExample(side);h.scheduleSave();};
    form.elements[`${side}_connector_text`].oninput=()=>{updateExample(side);h.scheduleSave();};
    $(`${side}-mode`).addEventListener('change',()=>{form.elements[`${side}_description_parts`].value='';syncDescriptions();h.scheduleSave();});
  }
  $('texts-panel').insertAdjacentHTML('beforeend','<datalist id="connector-words"><option value="by"><option value="BY"><option value="By"><option value="By:"></datalist>');
  function mode(side) { const el=$(`${side}-mode`);return el.selectedOptions[0]?.dataset.value || h.modes?.[el.value] || el.value; }
  // Preset dropdown values are the human-readable names supplied by both APIs.
  function orderMode(side) {
    const label=mode(side); const normalized=label.toLowerCase().replaceAll('text','').replaceAll(' ','');
    const labels={ 'label+name':'label_plus_name','name+label':'name_plus_label','nameonly':'name_only','labelonly':'label_only','extraonly':'extra_only' };
    return DESCRIPTION_ORDERS[label]?label:(labels[normalized] || normalized.replaceAll('+','_'));
  }
  function updateExample(side) {
    const preset=orderMode(side);const parts=descriptionParts(form.elements[`${side}_description_parts`].value,preset);
    const value={name:'Samir',label:form.elements[`${side}_text`]?.value || (side==='deposit'?'Cash Deposit':'Cheque Withdrawal'),extra:form.elements.description_extra_text?.value || ''};
    const enabled=form.elements[`${side}_connector_enabled`].value;
    const use=enabled==='legacy'?preset==='label_plus_name':enabled==='yes';
    const tokens=[]; for(const part of parts) { if(!value[part]) continue;if(part==='name'&&tokens.length&&use)tokens.push(form.elements[`${side}_connector_text`].value.trim());tokens.push(value[part]); }
    $(`${side}-description-example`).textContent=`Example: ${tokens.filter(Boolean).join(' ')}`;
  }
  function syncDescriptions() {
    for(const side of ['deposit','withdrawal']) {
      const parts=descriptionParts(form.elements[`${side}_description_parts`].value,orderMode(side));
      document.querySelectorAll(`[data-description-side="${side}"]`).forEach((select,i)=>{select.value=parts[i]||'none';select.setCustomValidity('');});
      const enabled=form.elements[`${side}_connector_enabled`].value;
      $(`${side}-connector-check`).checked=enabled==='legacy'?orderMode(side)==='label_plus_name':enabled==='yes';
      updateExample(side);
    }
  }
  $('texts-panel').addEventListener('input',()=>{updateExample('deposit');updateExample('withdrawal');});
  function syncCheck() {
    document.querySelectorAll('[data-proxy]').forEach(el=>{el.value=form.elements[el.dataset.proxy]?.value || '';});
    $('check-profile-field').hidden=$('statement-check-mode').value!=='profile';
    $('check-mode-note').textContent=$('statement-check-mode').value==='profile'?'Also checks the saved first and last descriptions, deposit and withdrawal order, connector, extra text, interest and tax wording.':'Checks dates, balances, cheque numbers, interest and tax. Description wording is not restricted.';
  }
  $('statement-check-mode').onchange=syncCheck;
  document.querySelectorAll('[data-proxy]').forEach(el=>el.oninput=()=>{if(form.elements[el.dataset.proxy])form.elements[el.dataset.proxy].value=el.value;});
  function switchContext(next) {
    if(context===next)return;
    if(h.state.autoSaveTimer) {clearTimeout(h.state.autoSaveTimer);h.state.autoSaveTimer=null;}
    if(context==='generate' && h.state.currentUser) h.saveDraft().catch(error=>h.log(error.message,'error'));
    drafts[context]={form:h.getValues(),state:Object.fromEntries(stateKeys.map(k=>[k,clone(h.state[k])]))};
    context=next;
    if(drafts[next]) {Object.assign(h.state,clone(drafts[next].state));h.applyValues(drafts[next].form);h.renderStatement();}
    else {h.clearStatement();h.applyValues(defaults);}
    syncCheck();
  }
  function navigate(next, force=false) {
    if(!force && requestCount>0) {h.log('Please wait for the current request to finish.');return false;}
    if(adminViews.has(next)&&!h.state.currentUser?.can_manage_users) next='home';
    if(['generate','profiles'].includes(next)) switchContext('generate');
    if(next==='check')switchContext('check');
    view=next;document.body.dataset.workspaceView=next;document.body.dataset.statementContext=context;
    $('workspace-title').textContent=titles[next]||'Statement workspace';
    const targets={home:'home-panel',generate:'account-panel',profiles:'profiles-panel',check:'check-panel',holidays:'holidays-panel',transfers:'export-panel',formats:'formats-panel',history:'history-panel',users:'admin-panel','create-user':'admin-panel',devices:'devices-panel'};
    h.setTab(targets[next]||'account-panel');
    $('admin-create-card').hidden=next!=='create-user';
    for(const id of ['admin-manage-card','admin-users-card','admin-restore-dates-card','admin-database-card'])if($(id))$(id).hidden=next!=='users';
    for(const button of sidebar.querySelectorAll('[data-view]')){const active=button.dataset.view===next;button.classList.toggle('is-active',active);if(active)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');}
    document.querySelector('.controls-column > .toolbar').hidden=!['generate','check'].includes(next);
    document.querySelector('.preview-column').hidden=!['generate','check','transfers','formats'].includes(next);
    $('create-stat-btn').hidden=context==='check'||h.state.currentUser?.access_mode==='check_only';
    if(innerWidth<1000)toggleSidebar(true);
    syncCheck(); return true;
  }
  sidebar.addEventListener('click',e=>{const b=e.target.closest('[data-view]');if(b)navigate(b.dataset.view);});
  sidebar.querySelector('a').onclick=e=>{e.preventDefault();navigate('home');};
  document.addEventListener('click',e=>{
    const go=e.target.closest('[data-go]');if(go)navigate(go.dataset.go);
    const tab=e.target.closest('[data-tab]');if(tab){if(view==='profiles')navigate('generate');h.setTab(tab.dataset.tab);}
    const click=e.target.closest('[data-click]');if(click)$(click.dataset.click)?.click();
  });
  $('dashboard-period').onchange=()=>{period=$('dashboard-period').value;renderDashboard();};
  function renderDashboard() {
    const weekly=dashboardSeries(history,'weekly'),monthly=dashboardSeries(history,'monthly');
    $('dashboard-week').textContent=weekly.reduce((n,r)=>n+r.count,0);
    $('dashboard-month').textContent=monthly.at(-1).count;$('dashboard-total').textContent=history.length;
    const data=period==='monthly'?monthly:weekly; const max=Math.max(1,...data.map(r=>r.count));
    const points=data.map((r,i)=>`${40+i*640/(data.length-1)},${180-r.count/max*140}`).join(' ');
    $('dashboard-chart').innerHTML=`<svg viewBox="0 0 720 220" role="img" aria-label="Generated statements ${period}: ${data.map(r=>`${r.label} ${r.count}`).join(', ')}"><line x1="40" y1="180" x2="680" y2="180" stroke="#d9e2ec"/><text x="8" y="45">${max}</text><text x="14" y="184">0</text><polyline points="${points}" fill="none" stroke="#176f62" stroke-width="3"/>${data.map((r,i)=>`<circle cx="${40+i*640/(data.length-1)}" cy="${180-r.count/max*140}" r="4" fill="#176f62"/><text x="${40+i*640/(data.length-1)}" y="209" text-anchor="middle">${r.label}</text>`).join('')}</svg>`;
  }
  return {
    navigate, isChecking:()=>context==='check', pending(delta){requestCount=Math.max(0,requestCount+delta);},
    values(values) { if(context==='check')return {...values,statement_check_mode:$('statement-check-mode').value,check_profile_name:$('check-profile-name').value};delete values.statement_check_mode;delete values.check_profile_name;delete values.description_check_mode;return values; },
    applied(values) {
      if (context === "check" && values.statement_check_mode) { $("statement-check-mode").value=values.statement_check_mode; $("check-profile-name").value=values.check_profile_name || ""; }
      for(const side of ['deposit','withdrawal']) for(const [field,fallback] of Object.entries({description_parts:'',connector_enabled:'legacy',connector_text:'by'})) form.elements[`${side}_${field}`].value=values[`${side}_${field}`]??fallback;
      syncDescriptions();syncCheck();
    },
    profiles(rows) {const selected=$('check-profile-name').value;$('check-profile-name').replaceChildren(new Option('Select a profile',''));for(const row of rows||[]){const name=typeof row==='string'?row:row.name;if(name)$('check-profile-name').add(new Option(name,name));}$('check-profile-name').value=selected;},
    history(payload){history=payload?.history||[];renderDashboard();},
    user(user){sidebar.querySelectorAll('[data-admin-nav]').forEach(el=>el.hidden=!user?.can_manage_users);},
    managedUser(user){for(const key of ['full_name','mobile_number','email','address','gender'])$(`detail-${key}`).value=user?.[key]||'';for(const key of ['is_hidden','is_blocked'])$(`detail-${key}`).checked=Boolean(user?.[key]);},
    reset(values={}) {drafts={};defaults=clone(values);context='generate';requestCount=0; $('statement-check-mode').value='new';$('check-profile-name').value='';syncDescriptions();renderDashboard();navigate('home',true);},
    prepareImport() {if(!navigate('check'))throw new Error('Wait for the current request before importing.');if($('statement-check-mode').value==='profile'&&!$('check-profile-name').value)throw new Error('Select a saved statement profile before importing.');},
  };
}
