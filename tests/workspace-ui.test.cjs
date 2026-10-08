const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {test} = require('node:test');
const root=path.resolve(__dirname,'..');
const assets=fs.existsSync(path.join(root,'assets'))?'assets':'static';
const source=fs.readFileSync(path.join(root,assets,'workspace.js'),'utf8');
const ctx=vm.createContext({Date,JSON});
vm.runInContext(source.replace(/^import .*;\r?\n/gm,'').replaceAll('export ','')+'\nthis.api={descriptionParts,dashboardSeries,checkingValues};',ctx);
test('checking description options persist in check requests and never affect generation',()=>{
  for(const scope of ['labels','labels_extra']){
    const values=ctx.api.checkingValues({deposit_text:'Deposit',description_extra_text:'Reference'},true,'profile','Existing',scope);
    assert.equal(values.description_check_scope,scope);
    assert.equal(values.check_profile_name,'Existing');
    assert.equal(values.description_extra_text,'Reference');
    const generated=ctx.api.checkingValues({...values,description_check_mode:'profile'},false,'profile','Existing',scope);
    for(const key of ['description_check_scope','statement_check_mode','check_profile_name','description_check_mode'])assert.ok(!(key in generated));
    assert.equal(generated.deposit_text,'Deposit');
    assert.equal(values.description_check_scope,scope); // Do not mutate the checking draft.
  }
});
test('legacy description ordering and explicit slot combinations stay distinct',()=>{
  assert.equal(JSON.stringify(ctx.api.descriptionParts('', 'extra_name')),'["extra","name"]');
  assert.equal(JSON.stringify(ctx.api.descriptionParts('["name","label","none"]','label_plus_name')),'["name","label","none"]');
  assert.equal(JSON.stringify(ctx.api.descriptionParts('', 'name_plus_label')),'["name","label"]');
});
test('dashboard counts creation dates rather than edit dates and excludes imported rows',()=>{
  const now=new Date(2026,9,6,12);
  const rows=[{created_at:'2026-10-06T08:00:00',source_type:'generated'},
    {created_at:'2026-10-06T08:00:00',source_type:'imported'},
    {created_at:'2026-09-30T08:00:00',updated_at:'2026-10-06T08:00:00',source_type:'generated'},
    {created_at:'2026-08-01T08:00:00',updated_at:'2026-10-06T08:00:00',source_type:'generated'}];
  const week=ctx.api.dashboardSeries(rows,'weekly',now);
  assert.equal(week.length,7);assert.equal(week.reduce((n,row)=>n+row.count,0),2);assert.equal(week.at(-1).count,1);
  const months=ctx.api.dashboardSeries(rows,'monthly',now);assert.equal(months.length,12);assert.equal(months.at(-1).count,1);
});
test('empty and invalid history gives a zero chart',()=>{
  assert.ok(ctx.api.dashboardSeries([{created_at:'invalid'}],'weekly').every(row=>row.count===0));
});

const app=fs.readFileSync(path.join(root,assets,'app.js'),'utf8');
test('quick generation profile loading applies existing settings and refreshes dependent choices',async()=>{
  const calls=[];
  const profile={customer_name:'Sample customer',deposit_text:'CASH DEPOSIT',interest_text:'Quarterly Return',tax_text:'Withholding'};
  const context=vm.createContext({workspaceUI:{isChecking:()=>false},profileFormatSelect:{value:'Existing profile'},
    apiUrl:(action,params)=>{assert.equal(action,'profile_formats');assert.equal(params.name,'Existing profile');return action;},
    fetchJson:async(_url,options)=>{assert.equal(options.method,'GET');return {profile,name:'Existing profile'};},
    applyFormValues:value=>calls.push(['apply',value]),saveDraftProfile:async()=>calls.push(['draft']),
    refreshTemplates:async()=>calls.push(['templates']),refreshHolidayRows:async()=>calls.push(['holidays']),
    refreshPostingDates:async()=>calls.push(['posting-dates']),state:{holidayView:2026},appendLog:()=>{}});
  const match=app.match(/^async function loadProfileFormat\([^]*?(?=^(?:async )?function )/m);
  vm.runInContext(match[0],context);await context.loadProfileFormat();
  assert.equal(calls[0][1],profile);
  assert.deepEqual(calls.slice(1),[['draft'],['templates'],['holidays'],['posting-dates']]);
  context.profileFormatSelect.value='';await assert.rejects(context.loadProfileFormat(),/Select a saved profile/);
});
test('import captures checking context and interest before sending the file',async()=>{
  const calls=[];
  class Body {append(name,value){calls.push(['field',name,value]);}}
  const context=vm.createContext({FormData:Body,workspaceUI:{prepareImport(){calls.push(['check-context']);}},
    requestImportedInterestRateAndRecheck:async before=>calls.push(['rate',before]),
    getFormValues:()=>({statement_check_mode:'profile',check_profile_name:'Existing',interest_rate:'7'}),
    apiUrl:a=>a,fetchJson:async(_url,options)=>{calls.push(['request']);return {config:{},rows:[],import_report:{row_count:0}};},
    renderCurrentUser(){},setCurrentStatement(){},renderHolidayPayload(){},renderHistoryPanel(){},renderValidationResults(){},appendLog(){}});
  const match=app.match(/^async function importStatementFile\([^]*?(?=^(?:async )?function )/m);
  vm.runInContext(match[0],context);await context.importStatementFile({name:'sample.xlsx'});
  assert.deepEqual(calls.slice(0,2),[['check-context'],['rate',true]]);
  assert.ok(calls.find(row=>row[0]==='field'&&row[1]==='config')[2].includes('Existing'));
  const automated=calls.length;
  await context.importStatementFile({name:'converted.xlsx'},{useCurrentRate:true});
  assert.equal(calls.slice(automated).some(row=>row[0]==='rate'),false,'PDF auto import uses the visible checking rate without a second prompt');
  context.getFormValues=()=>({interest_rate:'invalid'});
  const invalid=calls.length;
  await assert.rejects(context.importStatementFile({name:'invalid.xlsx'},{useCurrentRate:true}),/interest rate/);
  assert.equal(calls.slice(invalid).some(row=>row[0]==='request'),false);
  const before=calls.length;context.requestImportedInterestRateAndRecheck=async()=>{throw new Error('cancelled');};
  await assert.rejects(context.importStatementFile({name:'cancelled.xlsx'}),/cancelled/);
  assert.equal(calls.length,before+1);
});
