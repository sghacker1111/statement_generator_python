const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {pathToFileURL}=require('node:url');
const root=path.resolve(__dirname,'..'),assets=fs.existsSync(path.join(root,'assets'))?'assets':'static';
const api=import(pathToFileURL(path.join(root,assets,'statement-corrections.js')).href);
const labels={deposit_text:'Deposited By:',withdrawal_text:'Withdrawn By:',interest_text:'Interest:',tax_text:'Tax:'};
const rows=[{date:'2026-10-01',description:'Balance B/F:',debit:0,credit:0,balance:1000},
 {date:'2026-10-02',description:'Reference deposited Bv: Alice',credit:500,debit:0,balance:1500,cheque_no:'001'},
 {date:'2026-10-03',description:'Deposited By: Bob',debit:100,credit:0,balance:1400,cheque_no:'002'},
 {date:'2026-10-04',description:'interest:',credit:10,debit:0,balance:1410}];
test('correction proposals preserve names, extra text and all financial fields until selected',async()=>{
 const {descriptionCorrections,applyDescriptionCorrections}=await api;
 const proposals=descriptionCorrections(rows,labels);
 assert.equal(proposals.length,3);assert.equal(proposals[0].after,'Reference Deposited By: Alice');assert.equal(proposals[1].after,'Withdrawn By: Bob');assert.equal(proposals[2].after,'Interest:');
 const corrected=applyDescriptionCorrections(rows,[proposals[0]]);
 assert.equal(rows[1].description,'Reference deposited Bv: Alice');
 assert.equal(corrected[2].description,rows[2].description);
 for(let i=0;i<rows.length;i++)for(const key of Object.keys(rows[i]).filter(k=>k!=='description'))assert.equal(corrected[i][key],rows[i][key]);
 assert.throws(()=>applyDescriptionCorrections(corrected,[proposals[0]]),/changed/);
 const changed=rows.map(row=>({...row}));changed[1].credit=0;changed[1].debit=500;
 assert.throws(()=>applyDescriptionCorrections(changed,[proposals[0]]),/changed/,'A credit correction must not apply after switching the transaction to debit');
});

function correctionHarness(setup) {
 const elements=[];
 const make=tag=>{const el={tag,children:[],dataset:{},hidden:false,disabled:false,
   append(...items){this.children.push(...items);},setAttribute(){},replaceChildren(...items){this.children=items;},scrollIntoView(){},
   querySelectorAll(){return this.children.flatMap(label=>label.children||[]).filter(input=>input.tag==='input'&&input.checked);}};elements.push(el);return el;};
 const actions=make('actions'),preview=make('preview');
 global.document={createElement:make,querySelector:selector=>selector==='.preview-actions'?actions:preview};
 const state={currentStatement:{rows:rows.map(row=>({...row}))},currentStatementSource:'imported',validationErrors:[]};
 let values={...labels},validate=async()=>{},rendered=0;
 const h={state,getValues:()=>values,validateStatement:()=>validate(),pending(){},log(message){h.error=message;},
   beginCorrectionEdit(){state.statementEditMode=true;state.editableRows=state.currentStatement.rows.map(row=>({...row}));},renderStatement(){rendered++;}};
 const control=setup(h);
 return {state,h,elements,control,button:actions.children[0],panel:preview.children[0],
   setValues:next=>{values=next;},setValidate:next=>{validate=next;},rendered:()=>rendered,
   select(){elements.find(el=>el.tag==='input').checked=true;},apply(){elements.find(el=>el.textContent==='Apply selected text corrections').onclick();}};
}
test('reviewed corrections reject changed checking details and late validation from another statement',async()=>{
 const {setupStatementCorrections}=await api;
 try {
  const ui=correctionHarness(setupStatementCorrections);await ui.button.onclick();ui.select();
  ui.setValues({...labels,deposit_text:'TRANSFER IN'});ui.apply();
  assert.equal(ui.rendered(),0);assert.equal(ui.state.statementEditMode,undefined);
  assert.match(ui.panel.children.at(-1).textContent,/changed/);
  const next=correctionHarness(setupStatementCorrections);let finish;
  next.setValidate(()=>new Promise(resolve=>finish=resolve));const pending=next.button.onclick();
  next.state.currentStatement={rows:rows.map(row=>({...row}))};finish();await pending;
  assert.equal(next.panel.hidden,true);assert.match(next.h.error,/changed/);
 }finally{delete global.document;}
});
test('correct descriptions and unfamiliar wording are not replaced with generated names or amounts',async()=>{
 const {descriptionCorrections}=await api;
 assert.deepEqual(descriptionCorrections([{...rows[1],description:'Deposited By: New Name'},{...rows[1],description:'Completely unrelated words'},{...rows[2],credit:500}],labels),[]);
 const profile={...labels,statement_check_mode:'profile',first_date_description:'Opening Balance'};
 assert.equal(descriptionCorrections(rows,profile)[0].after,'Opening Balance');
 assert.equal(descriptionCorrections(rows,labels).some(p=>p.index===0),false);
});
