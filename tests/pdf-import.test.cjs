const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs');
const {pathToFileURL}=require('node:url');
const root=path.resolve(__dirname,'..'),assets=fs.existsSync(path.join(root,'assets'))?'assets':'static';
const api=import(pathToFileURL(path.join(root,assets,'pdf-table.js')).href);
const word=(text,x,y,width=text.length*5,confidence=99)=>({text,x0:x,x1:x+width,y0:y,y1:y+10,confidence});
const header=y=>[word('Date',30,y),word('Particulars',120,y),word('CHQ.',310,y),word('DEBIT',380,y),word('CREDIT',450,y),word('BALANCE',530,y)];
const row=(date,text,debit,credit,balance,y)=>[word(date,30,y),word(text,120,y,140),word(debit,380,y),word(credit,450,y),word(balance,530,y)].filter(w=>w.text);
test('PDF import rejects oversized, non-PDF and cancelled inputs before loading an engine',async()=>{
 const {readStatementPdf}=await import(pathToFileURL(path.join(root,assets,'pdf-import.js')).href);
 await assert.rejects(readStatementPdf({name:'large.pdf',size:26*1024*1024}),/25 MB/);
 await assert.rejects(readStatementPdf({name:'notes.txt',size:20}),/Select a PDF/);
 await assert.rejects(readStatementPdf({name:'fake.pdf',size:10,arrayBuffer:async()=>new TextEncoder().encode('not a PDF')}),/not a readable PDF/);
 const controller=new AbortController();controller.abort();
 await assert.rejects(readStatementPdf({name:'cancel.pdf',size:10,arrayBuffer:async()=>new TextEncoder().encode('%PDF-1.7')},{signal:controller.signal}),{name:'AbortError'});
});
test('PDF headers isolate table rows and preserve case, blank sides, descriptions and balances',async()=>{
 const {extractPage}=await api;
 const words=[word('SAMPLE BANK',30,15),...header(60),...row('01-Oct-2024','Balance B/F:','','','365,000.00',85),...row('17-Oct-2024','Transfer In BY: Samir','','10,000.00','375,000.00',110),word('Branch Ref',120,123),...row('17-Oct-2024','Transfer Out','4,000.00','','371,000.00',145),word('Total',30,170),word('999.00',530,170),word('SIGNATURE AND STAMP',120,190)];
 const result=extractPage(words,1);
 assert.equal(result.rows.length,3);assert.equal(result.rows[1].description,'Transfer In BY: Samir Branch Ref');
 assert.equal(result.rows[1].credit,'10000.00');assert.equal(result.rows[1].debit,'');assert.equal(result.rows[2].debit,'4000.00');
 assert.equal(result.rows[0].date,'2024-10-01');assert.equal(result.issues.length,0);
});
test('PDF continuation pages remove explicit carry rows without removing identical transactions',async()=>{
 const {extractPage,mergePages}=await api;
 const one=extractPage([...header(30),...row('01/10/2024','Balance B/F','','','365000',55),...row('17/10/2024','Transfer In','','10000','375000',80),...row('17/10/2024','Balance C/F','','','375000',105)],1);
 const two=extractPage([...header(30),...row('17/10/2024','Balance B/F','','','375000',55),...row('17/10/2024','Transfer In','','10000','385000',80),...row('17/10/2024','Transfer In','','10000','395000',105)],2);
 const merged=mergePages([one,two]);assert.equal(merged.rows.length,4);assert.equal(merged.rows.filter(r=>r.description==='Transfer In').length,3);
 const continued=extractPage(row('18/10/2024','Transfer Out','500','','394500',25),3,two.columns);
 assert.equal(continued.rows.length,1);assert.equal(continued.headerFound,false);
});
test('PDF numeric parsing never turns unreadable amounts into zero and supports explicit date order',async()=>{
 const {parseAmount,parseDate,extractPage,validateRows}=await api;
 assert.equal(parseAmount('1,78,943.63'),'178943.63');assert.equal(parseAmount('(1,234.50)'),'-1234.50');
 for(const text of ['1O,000.00','1,234.567','NaN','1.2.3','1,2'])assert.equal(parseAmount(text),null);
 assert.equal(parseDate('03/04/2025'),'2025-04-03');assert.equal(parseDate('03/04/2025','mdy'),'2025-03-04');assert.equal(parseDate('31/02/2025'),'');
 const result=extractPage([...header(30),...row('17/10/2024','Cash Deposit','','1O,000.00','375000',55)],1);
 assert.equal(result.rows[0].credit,'1O,000.00');assert.ok(validateRows(result.rows).some(i=>i.fields.includes('credit')));
 const missed=extractPage([...header(30),...row('','Cash Deposit','','10000','375000',55)],1);
 assert.equal(missed.rows.length,1);assert.ok(validateRows(missed.rows).some(i=>i.fields.includes('date')));
});
test('PDF-generated workbook is a complete Excel package, with descriptions stored as text',async()=>{
 const {statementWorkbook}=await api;
 const {unzipSync,strFromU8}=await import(pathToFileURL(path.join(root,assets,'vendor/pdf-ocr/fflate.mjs')).href);
 const bytes=await statementWorkbook([{date:'01/10/2024',description:'=1+1 & SAMPLE',cheque_no:'001234',debit:'',credit:'',balance:'365000'}]);
 const files=unzipSync(bytes),xml=strFromU8(files['xl/worksheets/sheet1.xml']);
 assert.ok(files['[Content_Types].xml']);assert.ok(files['xl/workbook.xml']);assert.match(xml,/001234/);assert.match(xml,/=1\+1 &amp; SAMPLE/);assert.doesNotMatch(xml,/<f[ >]/);
 await assert.rejects(statementWorkbook([{date:'bad',description:'Sample',debit:'',credit:'',balance:'0'}]),/Correct/);
});

test('headerless continuation ignores letterhead and stops at debit and credit totals',async()=>{
 const {extractPage}=await api;
 const first=extractPage([...header(30),...row('01/10/2024','Balance B/F','','','365000',55)],1);
 const next=extractPage([word('Company address',120,10),word('Phone:',450,10),word('01-5160000',530,10),...row('02/10/2024','Deposit','','10000','375000',80),word('Debit and Credit Total:',310,105,100),word('10000.00',450,105),word('!',530,105),word('Date of issue',120,130),word('04-Oct-2024',530,130)],2,first.columns);
 assert.equal(next.rows.length,1);assert.equal(next.rows[0].description,'Deposit');assert.equal(next.issues.length,0);
});

test('long names stay in the description before the cheque column',async()=>{
 const {extractPage}=await api;
 const result=extractPage([...header(30),...row('01/10/2024','Withdrawn By: A Very Long','500','','364500',55),word('Surname',275,55,30),word('001234',312,55,30)],1);
 assert.equal(result.rows[0].cheque_no,'001234');assert.equal(result.rows[0].description,'Withdrawn By: A Very Long Surname');
});

test('unreadable embedded dates request fresh OCR instead of silently accepting the text layer',async()=>{
 const {needsOcr}=await api;
 assert.equal(typeof needsOcr,'function');
 assert.equal(needsOcr({rows:[{date:'7-0ct-2025',description:'Deposit',debit:'',credit:'1000',balance:'5000'}],issues:[]}),true);
 assert.equal(needsOcr({rows:[{date:'07-Oct-2025',description:'Deposit',debit:'',credit:'1000',balance:'5000'}],issues:[]}),false);
});

test('OCR repairs unreadable text-layer dates without replacing readable amounts',async()=>{
 const {reconcileTextAndOcr}=await api;
 assert.equal(typeof reconcileTextAndOcr,'function');
 const row={date:'7-0ct-2025',description:'Interest:',debit:'',credit:'32953.75',balance:'2012397.38',cheque_no:'',y:100,page:1};
 const result=reconcileTextAndOcr({rows:[row],issues:[],columns:[]},{rows:[{...row,date:'2025-10-07',credit:'32853.75',y:102}],issues:[],columns:[]});
 assert.equal(result.rows[0].date,'2025-10-07');assert.equal(result.rows[0].credit,'32953.75');
 assert.ok(result.issues.some(i=>i.fields.includes('credit')));assert.ok(result.issues.some(i=>i.fields.includes('date')));
});

test('recognises common scan substitutions in debit and cheque headings',async()=>{
 const {extractPage}=await api;
 const headings=header(30).map(w=>({...w,text:w.text==='DEBIT'?'DEBT':w.text==='CHQ.'?'CHG.':w.text}));
 const result=extractPage([...headings,...row('01/10/2024','Withdrawn By: Sample','500','','364500',55),word('001234',312,55,30)],1);
 assert.equal(result.rows.length,1);assert.equal(result.rows[0].cheque_no,'001234');assert.equal(result.rows[0].debit,'500.00');
});

test('a damaged scan date keeps its transaction available for focused date recovery',async()=>{
 const {extractPage,recoverDates}=await api;
 const result=extractPage([...header(30),...row('W-fug-','Withdrawn By: Sample','500','','364500',55)],1);
 assert.equal(result.rows.length,1);
 assert.equal(typeof recoverDates,'function');
 const repaired=recoverDates(result,[word('18-Aug-2026',30,55)]);
 assert.equal(repaired.rows[0].date,'2026-08-18');assert.equal(repaired.rows[0].debit,'500.00');
});

test('all month names and supported numeric date orders are strict, including OCR month aliases',async()=>{
 const {parseDate,readDate,extractPage,statementWorkbook}=await api;
 const months=['January','February','March','April','May','June','July','August','September','October','November','December'];
 months.forEach((month,i)=>{for(const spelling of [month,month.slice(0,3)])assert.equal(parseDate(`07-${spelling}-2026`),`2026-${String(i+1).padStart(2,'0')}-07`);});
 for(const value of ['2026-10-07','2026/10/07','07/10/26','07-Oct-2026','07-October-2026','07.10.2026'])assert.equal(parseDate(value),'2026-10-07');
 for(const value of ['2026/07/10','2026-07-10'])assert.equal(parseDate(value,'ydm'),'2026-10-07');
 for(const month of ['Octopus','Junk','Janu','XYZ'])assert.equal(parseDate(`07-${month}-2026`),'');
 for(const month of ['0ct','0tc','Otc','0ctober'])assert.deepEqual(readDate(`07-${month}-2026`),{date:'2026-10-07',corrected:true});
 assert.equal(readDate('07-Se9-2026').date,'2026-09-07');assert.equal(readDate('31-0tc-2026').date,'2026-10-31');assert.equal(readDate('32-0tc-2026').date,'');
 const result=extractPage([...header(30),...row('2026/07/10','Opening','','','1000',55),...row('08-0tc-2026','Deposit','','500','1500',80)],1,null,'ydm');
 assert.equal(result.rows[0].date,'2026-10-07');assert.equal(result.rows[1].date,'2026-10-08');assert.ok(result.issues.some(i=>i.message.includes('OCR month')));
 const {unzipSync,strFromU8}=await import(pathToFileURL(path.join(root,assets,'vendor/pdf-ocr/fflate.mjs')).href);
 const xml=strFromU8(unzipSync(await statementWorkbook(result.rows,'ydm'))['xl/worksheets/sheet1.xml']);assert.match(xml,/2026-10-07/);assert.doesNotMatch(xml,/2026-07-10/);
});

test('focused columns recover unreadable fields and leave conflicting readable money for review',async()=>{
 const {extractPage,columnRegions,refineColumn}=await api;
 let result=extractPage([...header(30),...row('??','Deposlted By: Sample','','1O00','2O00',55),...row('08-Oct-2026','Deposit','','500','2500',80)],1);
 assert.equal(result.rows.length,2,'Keep rows even when both date and balance are unreadable');
 const regions=columnRegions(result,600,800);assert.equal(regions.length,6);assert.ok(regions.every(r=>r.width>0&&r.height>0));
 result=refineColumn(result,'date',[word('07-0tc-2026',30,55),word('08-Oct-2026',30,80)]);
 result=refineColumn(result,'credit',[word('1000.00',450,55),word('600.00',450,80)]);
 result=refineColumn(result,'description',[word('Deposited By: Sample',120,55)]);
 assert.equal(result.rows[0].date,'2026-10-07');assert.equal(result.rows[0].credit,'1000.00');assert.equal(result.rows[1].credit,'500.00');
 assert.equal(result.rows[0].description,'Deposlted By: Sample','Do not silently replace text to match a rule');
 assert.ok(result.issues.some(i=>i.suggestion?.value==='600.00'));assert.ok(result.issues.some(i=>i.suggestion?.value==='Deposited By: Sample'));
});

test('OCR review detects wrong-side and case-sensitive labels without comparing people names',async()=>{
 const {reviewRows}=await api;
 const labels={deposit_text:'Deposited By:',withdrawal_text:'Withdrawn By:',interest_text:'Interest:',tax_text:'Tax:'};
 const rows=[{date:'2026-10-07',description:'Opening',debit:'',credit:'',balance:'1000'},
 {date:'2026-10-08',description:'Extra Deposited By: Person A',debit:'',credit:'500',balance:'1500'},
 {date:'2026-10-09',description:'Withdrawn By: Someone Else',debit:'100',credit:'',balance:'1400'},
 {date:'2026-10-10',description:'Interest:',debit:'',credit:'10',balance:'1410'},
 {date:'2026-10-10',description:'Tax:',debit:'0.6',credit:'',balance:'1409.40'}];
 assert.deepEqual(reviewRows(rows,labels),[]);
 const caseWrong=rows.map(r=>({...r}));caseWrong[1].description='Extra deposited By: New Name';assert.ok(reviewRows(caseWrong,labels).some(i=>i.row_index===1&&i.fields.includes('description')));
 const wrongSide=rows.map(r=>({...r}));wrongSide[2].description='Deposited By: New Name';assert.ok(reviewRows(wrongSide,labels).some(i=>i.message.includes('wrong amount side')));
 const bad=rows.map(r=>({...r}));bad[1].credit='50';bad[3].description='interest:';assert.ok(reviewRows(bad,labels).some(i=>i.fields.includes('balance')));assert.ok(reviewRows(bad,labels).some(i=>i.row_index===3&&i.fields.includes('description')));
 assert.equal(rows[1].credit,'500','Review never rewrites amounts');
});

test('scanned page detection checks image coverage and restores graphics transforms',async()=>{
 const {hasScanImage}=await import(pathToFileURL(path.join(root,assets,'pdf-import.js')).href);
 const ops={save:1,restore:2,transform:3,paintImageXObject:4,paintInlineImageXObject:5};
 assert.equal(hasScanImage({fnArray:[1,3,4,2],argsArray:[[],[600,0,0,800,0,0],[],[]]},ops,600*800),true);
 assert.equal(hasScanImage({fnArray:[1,3,4,2,4],argsArray:[[],[50,0,0,50,0,0],[],[],[]]},ops,600*800),false);
});

test('reconciliation preserves confidence warnings and does not reverse normalized year/day/month dates',async()=>{
 const {reconcileTextAndOcr}=await api;
 const row={date:'2026-10-07',date_normalized:true,description:'Deposit',debit:'',credit:'500',balance:'1500',y:100,page:1};
 const result=reconcileTextAndOcr({rows:[row],issues:[{row_index:0,fields:['date'],message:'Verify corrected month'}]}, {rows:[row],issues:[{row_index:0,fields:['description'],message:'Low confidence'}]},'ydm');
 assert.equal(result.rows.length,1);assert.equal(result.rows[0].date,'2026-10-07');assert.equal(result.issues.length,2);
});

test('OCR agreement improves text but keeps readable financial values for review',async()=>{
 const {refineColumn,reconcileTextAndOcr,resolveReadings}=await api;
 const row={date:'2026-10-07',date_normalized:true,description:'Withdrawn By Sample',debit:'1977.43',credit:'',balance:'2000',y:60,page:1,height:10};
 let result={rows:[row],issues:[]};
 result=refineColumn(result,'description',[word('Withdrawn By: Sample',120,55)]);
 result=refineColumn(result,'debit',[word('1977.23',380,55)]);
 assert.equal(resolveReadings(result).rows[0].debit,'1977.43','A disagreement alone does not change readable money');
 result=reconcileTextAndOcr(result,{rows:[{...row,description:'Withdrawn By: Sample',debit:'1977.23'}],issues:[]},'dmy','page OCR','embedded PDF text');
 result=resolveReadings(result);
 assert.equal(result.rows[0].debit,'1977.43');assert.equal(result.rows[0].description,'Withdrawn By: Sample');
 assert.equal(result.rows[0].balance,'2000','Does not rewrite a balance to reconcile an amount');
 assert.ok(result.issues.some(i=>i.message.includes('independent readings agree')));
 assert.ok(result.issues.some(i=>i.suggestion?.value==='1977.23'));
 const cheque={rows:[{...row,cheque_no:'100947',readings:{cheque_no:[{source:'page',value:'100947'},{source:'column',value:'100547'},{source:'line',value:'100547'}]}}],issues:[]};
 assert.equal(resolveReadings(cheque).rows[0].cheque_no,'100947','Repeated resampling errors must not overwrite a readable cheque number');
 const tie={rows:[{...row,readings:{debit:[{source:'page',value:'100'},{source:'column',value:'100'},{source:'text',value:'200'},{source:'line',value:'200'}]}}],issues:[]};
 assert.equal(resolveReadings(tie).rows[0].debit,'1977.43');
 const noise={rows:[{...row,readings:{description:[{source:'page',value:row.description},{source:'column',value:'Withdrawn By ~~ Sample'},{source:'line',value:'Withdrawn By ~~ Sample'}]}}],issues:[]};
 assert.equal(resolveReadings(noise).rows[0].description,row.description,'Repeated border noise is not automatically inserted');
});

test('OCR label checks require whole labels and allow an opposite label inside the correct label',async()=>{
 const {reviewRows}=await api;
 const row={date:'2026-10-07',description:'Deposited By: Sample',credit:'500',debit:'',balance:'1500'};
 assert.equal(reviewRows([row],{deposit_text:'Deposit'}).length,1);
 assert.equal(reviewRows([row],{deposit_text:'Deposited By:',withdrawal_text:'By:'}).length,0);
 assert.equal(reviewRows([{...row,description:'Deposited   By: Sample'}],{deposit_text:'Deposited By:'}).length,0);
});

test('page merge keeps review warnings on their actual transaction after removing carry rows',async()=>{
 const {mergePages}=await api;
 const carry={date:'2026-10-07',description:'Balance C/F',debit:'',credit:'',balance:'1000'};
 const merged=mergePages([{rows:[{...carry,description:'Opening'},carry],issues:[{row_index:1,fields:['description'],message:'Carry warning'}]},
 {rows:[{...carry,description:'Balance B/F'},{...carry,date:'2026-10-08',description:'Deposit',credit:'500',balance:'1500'}],issues:[{row_index:0,fields:['description'],message:'Repeated carry warning'},{row_index:1,fields:['credit'],message:'Real transaction warning'}]}]);
 assert.equal(merged.rows.length,2);assert.deepEqual(merged.issues,[{row_index:1,fields:['credit'],message:'Real transaction warning'}]);
});
