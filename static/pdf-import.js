import {extractPage,mergePages,validateRows,statementWorkbook,ROW_KEYS,needsOcr,reconcileTextAndOcr,columnRegions,cellRegion,refineCell,refineColumn,reviewRows,resolveReadings} from './pdf-table.js?v=20261008-detailed';

const asset = name => new URL(`./vendor/pdf-ocr/${name}`, import.meta.url).href;
const cancelled = () => new DOMException('PDF import cancelled.', 'AbortError');

export function detailedCore(validate=bytes=>WebAssembly.validate(bytes)) {
  // Minimal module returning i32x4.splat(0). Use ordinary SIMD when available,
  // but avoid the v7 relaxed-SIMD float-model abort (upstream issue #1080).
  const probe=new Uint8Array([0,97,115,109,1,0,0,0,1,5,1,96,0,1,123,3,2,1,0,10,8,1,6,0,65,0,253,17,11]);
  try {if(validate(probe))return 'tesseract-core-simd-lstm.wasm.js';}catch{}
  return 'tesseract-core-lstm.wasm.js';
}

export function hasScanImage(operators,ops,pageArea) {
  let matrix=[1,0,0,1,0,0];const stack=[];
  for(let i=0;i<operators.fnArray.length;i++) {
    const fn=operators.fnArray[i],args=operators.argsArray[i];
    if(fn===ops.save)stack.push([...matrix]);
    else if(fn===ops.restore)matrix=stack.pop()||[1,0,0,1,0,0];
    else if(fn===ops.transform) {
      const [a,b,c,d,e,f]=matrix,[g,h,j,k,l,m]=args;
      matrix=[a*g+c*h,b*g+d*h,a*j+c*k,b*j+d*k,a*l+c*m+e,b*l+d*m+f];
    } else if([ops.paintImageXObject,ops.paintInlineImageXObject].includes(fn)&&Math.abs(matrix[0]*matrix[3]-matrix[1]*matrix[2])>=pageArea*0.2)return true;
  }
  return false;
}

export async function readStatementPdf(file,{dateOrder='dmy',forceOcr=false,mode='standard',labels={},onProgress=()=>{},signal}={}) {
  if(!['standard','detailed'].includes(mode))throw new Error('Choose Standard or Detailed PDF recognition.');
  const detailed=mode==='detailed';
  if(file.size>25*1024*1024)throw new Error('Choose a PDF smaller than 25 MB. Split larger files into smaller statements.');
  if(!/\.pdf$/i.test(file.name))throw new Error('Select a PDF statement.');
  const bytes=new Uint8Array(await file.arrayBuffer());
  if(!new TextDecoder().decode(bytes.slice(0,1024)).includes('%PDF-'))throw new Error('This file is not a readable PDF.');
  if(signal?.aborted)throw cancelled();
  onProgress('Opening PDF…');
  const pdfjs=await import('./vendor/pdf-ocr/pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc=asset('pdf.worker.min.mjs');
  const task=pdfjs.getDocument({data:bytes,isEvalSupported:false,cMapUrl:asset('cmaps/'),cMapPacked:true,standardFontDataUrl:asset('standard_fonts/'),wasmUrl:asset('wasm/')});
  let doc,worker,activePage=0,terminated=false,rejectAbort;
  const renders=new Map();
  const clearRenders=()=>{for(const {canvas} of renders.values()){canvas.width=0;canvas.height=0;}renders.clear();};
  const abortPromise=new Promise((_,reject)=>{rejectAbort=reject;});
  const stop=()=>{terminated=true;rejectAbort(cancelled());void worker?.terminate().catch(()=>{});void task.destroy().catch(()=>{});};
  signal?.addEventListener('abort',stop,{once:true});
  const checkAbort=()=>{if(signal?.aborted)throw cancelled();};
  const abortable=promise=>Promise.race([promise,abortPromise]);
  async function recognize(page,rotation=0,headerContrast=false,region=null) {
    checkAbort();
    if(!worker) {
      const {default:Tesseract}=await import('./vendor/pdf-ocr/tesseract.esm.min.js');
      worker=await abortable(Tesseract.createWorker('eng',1,{workerPath:asset('worker.min.js'),workerBlobURL:false,corePath:asset(detailed?detailedCore():''),langPath:asset(detailed?'best/':'').replace(/\/$/,''),cacheMethod:'none',
        logger:m=>{if(!signal?.aborted)onProgress(`Page ${activePage}/${doc.numPages}: ${m.status}${m.progress==null?'':` ${Math.round(m.progress*100)}%`}`);}}).then(created=>{if(signal?.aborted){void created.terminate();throw cancelled();}return created;}));
      await worker.setParameters({tessedit_pageseg_mode:'11',preserve_interword_spaces:'1',user_defined_dpi:'300'});
    }
    checkAbort();
    const base=page.getViewport({scale:1,rotation:(page.rotate+rotation)%360});
    // Use a different sampling scale for the full page and the focused columns.
    // Enlarging every pass identically can reinforce the same resampling error.
    const dpi=region?300:240,pixels=region?16000000:12000000;
    const scale=Math.min(dpi/72,Math.sqrt(pixels/(base.width*base.height)));
    const viewport=page.getViewport({scale,rotation:(page.rotate+rotation)%360});
    const cacheKey=`${rotation}:${headerContrast}:${dpi}`;
    let cached=renders.get(cacheKey);
    if(!cached) {
      const canvas=document.createElement('canvas');canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
      try {await abortable(page.render({canvasContext:canvas.getContext('2d'),viewport,background:'#ffffff'}).promise);}
      catch(error){canvas.width=0;canvas.height=0;throw error;}
      cached={canvas};renders.set(cacheKey,cached);
      if(headerContrast) {
        const context=canvas.getContext('2d'),pixels=context.getImageData(0,0,canvas.width,canvas.height),data=pixels.data;
        for(let i=0;i<data.length;i+=4){const value=(data[i]*0.299+data[i+1]*0.587+data[i+2]*0.114)>135?255:0;data[i]=data[i+1]=data[i+2]=value;}
        context.putImageData(pixels,0,0);
      }
    }
    let canvas=cached.canvas,crop=null,offsetX=0,offsetY=0,padding=0;
    try {
      checkAbort();
      if(region) {
        offsetX=Math.max(0,Math.floor(region.x*scale));offsetY=Math.max(0,Math.floor(region.y*scale));padding=16;
        const width=Math.min(canvas.width-offsetX,Math.ceil(region.width*scale)),height=Math.min(canvas.height-offsetY,Math.ceil(region.height*scale));
        if(width<=0||height<=0)return [];
        crop=document.createElement('canvas');crop.width=width+padding*2;crop.height=height+padding*2;
        const context=crop.getContext('2d');context.fillStyle='#ffffff';context.fillRect(0,0,crop.width,crop.height);context.drawImage(canvas,offsetX,offsetY,width,height,padding,padding,width,height);canvas=crop;
      }
      await worker.setParameters({tessedit_pageseg_mode:region?.singleLine?'7':region?'6':'11',user_defined_dpi:String(dpi)});
      let timer;
      const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{void worker?.terminate();worker=null;reject(new Error(`OCR timed out on page ${activePage}. Try a clearer or smaller scan.`));},120000);});
      let data;
      try {({data}=await abortable(Promise.race([worker.recognize(canvas,{}, {text:true,tsv:true}),timeout])));}
      finally {clearTimeout(timer);}
      checkAbort();
      const words=[];
      for(const line of (data.tsv||'').split('\n').slice(1)) {
        const parts=line.split('\t');if(parts.length<12||parts[0]!=='5')continue;
        const text=parts.slice(11).join('\t').trim();if(!text)continue;
        const [left,top,width,height,confidence]=parts.slice(6,11).map(Number);
        words.push({text,x0:(left+offsetX-padding)/scale,x1:(left+width+offsetX-padding)/scale,y0:(top+offsetY-padding)/scale,y1:(top+height+offsetY-padding)/scale,confidence});
      }
      return words;
    } finally {if(crop){crop.width=0;crop.height=0;}}
  }
  try {
    doc=await abortable(task.promise);
    if(doc.numPages>50)throw new Error('Import up to 50 PDF pages at a time. Split this document into smaller statements.');
    const pages=[],report=[];let columns=null,ocrPages=0;
    for(let number=1;number<=doc.numPages;number++) {
      checkAbort();activePage=number;onProgress(`Reading page ${number}/${doc.numPages}…`);
      const page=await abortable(doc.getPage(number)),viewport=page.getViewport({scale:1});
      let words=[],usedOcr=false,rotation=0;
      {
        const content=await abortable(page.getTextContent());
        for(const item of content.items) {
          if(!item.str?.trim())continue;
          const transform=pdfjs.Util.transform(viewport.transform,item.transform),height=Math.hypot(transform[2],transform[3]);
          const segments=[...item.str.matchAll(/\S+/g)];
          for(const segment of segments)words.push({text:segment[0],x0:transform[4]+item.width*segment.index/item.str.length,x1:transform[4]+item.width*(segment.index+segment[0].length)/item.str.length,y0:transform[5]-height,y1:transform[5],confidence:100});
        }
      }
      let result=extractPage(words,number,columns,dateOrder);
      const scanned=hasScanImage(await abortable(page.getOperatorList()),pdfjs.OPS,viewport.width*viewport.height);
      // Scans often have a syntactically valid but inaccurate hidden OCR layer.
      // Read the actual page image even when that layer passes format validation.
      if(forceOcr || scanned || needsOcr(result,dateOrder) || reviewRows(result.rows,labels,dateOrder).length || !words.length) {
        const textResult=result;
        usedOcr=true;ocrPages++;
        words=await recognize(page);
        result=extractPage(words,number,textResult.columns||columns,dateOrder);
        if(!result.columns) {
          onProgress(`Page ${number}/${doc.numPages}: reading shaded table headings…`);
          const contrasted=extractPage(await recognize(page,0,true),number,null,dateOrder);
          if(contrasted.columns){result=extractPage(words,number,contrasted.columns,dateOrder);result.headerFound=contrasted.headerFound;}
        }
        if(!result.headerFound && !result.rows.length) {
          for(const angle of [90,180,270]) {
            onProgress(`Page ${number}/${doc.numPages}: checking scan orientation…`);
            const rotated=await recognize(page,angle);
            const candidate=extractPage(rotated,number,null,dateOrder);
            if(candidate.headerFound && candidate.rows.length){result=candidate;rotation=angle;break;}
          }
        }
        const oriented=page.getViewport({scale:1,rotation:(page.rotate+rotation)%360});
        const regions=columnRegions(result,oriented.width,oriented.height);
        for(const region of regions) {
          onProgress(`Page ${number}/${doc.numPages}: reading ${region.key.replace('_',' ')} line by line…`);
          try {result=refineColumn(result,region.key,await recognize(page,rotation,false,region),dateOrder);}
          catch(error) {
            if(error.name==='AbortError')throw error;
            result.issues.push({page:number,fields:[],message:`Page ${number}: focused reading could not finish. Review the original scan. ${error.message}`});break;
          }
        }
        if(!forceOcr&&!rotation)result=scanned?reconcileTextAndOcr(result,textResult,dateOrder,'page OCR','embedded PDF text'):reconcileTextAndOcr(textResult,result,dateOrder);
        result=resolveReadings(result);
        // Retry unresolved conflicts as individual cells. This is independent of
        // the configured labels and financial rules, so errors are not disguised.
        const conflicts=[...new Map(result.issues.filter(issue=>issue.suggestion&&issue.row_index!=null).map(issue=>[`${issue.row_index}:${issue.suggestion.key}`,{index:issue.row_index,key:issue.suggestion.key}])).values()];
        const candidates=detailed?result.rows.flatMap((row,index)=>regions.filter(region=>String(row[region.key]??'').trim()).map(region=>({index,key:region.key}))):conflicts;
        const limit=detailed?300:40;
        for(const {index,key} of candidates.slice(0,limit)) {
          const row=result.rows[index],region=regions.find(r=>r.key===key);
          if(!row||!region)continue;
          onProgress(`Page ${number}/${doc.numPages}: reading row ${index+1}/${result.rows.length}, ${key.replace('_',' ')}…`);
          try {
            const words=await recognize(page,rotation,false,cellRegion(result.rows,index,region));
            result=refineCell(result,index,key,words,dateOrder,'cell OCR');
          } catch(error) {if(error.name==='AbortError')throw error;result.issues.push({page:number,fields:[],message:`Page ${number}: cell reading stopped. Column readings were kept; review this page. ${error.message}`});break;}
        }
        if(candidates.length>limit)result.issues.push({page:number,fields:[],message:`Page ${number}: the first ${limit} cells received individual OCR. Remaining cells use page and column readings; review them before exporting.`});
        result=resolveReadings(result);
        result.headerFound ||= textResult.headerFound;
      }
      if(result.columns)columns=result.columns;
      if(!result.rows.length)result.issues.push({page:number,fields:[],message:`Page ${number}: no transaction table rows were found. Review this page for missed rows.`});
      else if(!result.headerFound)result.issues.push({page:number,fields:[],message:`Page ${number}: continued using the previous page's columns. Verify the alignment.`});
      pages.push(result);report.push({page:number,rows:result.rows.length,method:usedOcr?(detailed?'Detailed OCR':'OCR'):'PDF text'});
      if(pages.reduce((sum,p)=>sum+p.rows.length,0)>5000)throw new Error('Import up to 5,000 statement rows at a time.');
      clearRenders();page.cleanup();
    }
    const result=mergePages(pages);
    if(!result.rows.length)throw new Error('No statement table was detected. The PDF must show Date, Description/Particulars, Debit, Credit and Balance headings. Try a clearer scan or Force OCR.');
    return {...result,pages:report,ocrPages,dateOrder,mode,includeCheque:pages.some(p=>p.columns?.some(c=>c.key==='cheque_no'))};
  } catch(error) {
    if(signal?.aborted)throw cancelled();
    if(typeof error==='string')error=new Error(error);
    if(error.name==='PasswordException')throw new Error('This PDF is password protected. Unlock a copy before importing it.');
    throw error;
  } finally {
    clearRenders();
    signal?.removeEventListener('abort',stop);
    if(worker&&!terminated)await worker.terminate().catch(()=>{});
    await task.destroy().catch(()=>{});
  }
}

export function setupPdfImport(h) {
  const panel=document.createElement('section');panel.className='inset-panel pdf-import-panel';panel.id='pdf-import-panel';panel.hidden=true;
  panel.innerHTML='<h3>Import PDF Statement</h3><p>Read a text PDF or scan every page with OCR. Review the extracted table, then import it through the same checks as Excel. Letterheads, stamps and signatures are excluded where they fall outside the transaction table.</p><div class="field-grid two-col"><label class="field"><span>Numeric date order</span><select id="pdf-date-order"><option value="dmy">Day / Month / Year</option><option value="mdy">Month / Day / Year</option></select></label><label class="check-field"><input type="checkbox" id="pdf-force-ocr"> Force OCR (unreliable PDF text layer)</label></div><div class="workspace-shortcuts"><button type="button" class="ghost-button" id="pdf-choose">Choose PDF</button><button type="button" class="ghost-button" id="pdf-cancel" hidden>Cancel scan</button></div><input type="file" id="pdf-file" accept=".pdf,application/pdf" hidden><p id="pdf-progress" role="status" aria-live="polite"></p><div id="pdf-review" hidden><p id="pdf-summary"></p><p class="muted">OCR can misread digits and capitalisation. Compare dates, amounts and descriptions with your original PDF. Edit any incorrect cells below. Other statement errors appear in the usual checker after import.</p><ul id="pdf-issues"></ul><div class="table-shell"><table class="data-table"><thead><tr><th>Page</th><th>Date</th><th>Description / Particulars</th><th>Cheque No.</th><th>Debit</th><th>Credit</th><th>Balance</th><th></th></tr></thead><tbody id="pdf-rows"></tbody></table></div><div class="workspace-shortcuts"><button type="button" class="primary-button" id="pdf-import-check">Import and check statement</button><button type="button" class="ghost-button" id="pdf-download">Download extracted Excel</button><a id="pdf-original" target="_blank" rel="noopener">View original PDF</a></div></div>';
  document.getElementById('check-panel').append(panel);
  const $=id=>document.getElementById(id);
  $('pdf-date-order').closest('.field-grid').insertAdjacentHTML('beforebegin',`<label class="field"><span>PDF recognition</span><select id="pdf-recognition-mode"><option value="standard">Standard OCR</option><option value="detailed" selected>Detailed local recognition (slower)</option></select><small id="pdf-mode-help">Detailed recognition uses a larger English model, finds the statement headings, then reads columns and individual cells. All recognition runs on this device.</small></label><label class="check-field"><input type="checkbox" id="pdf-auto-import" checked> Convert to Excel and automatically open in Statement Check</label>`);
  $('pdf-date-order').options[0].textContent='Day / Month / Year (year first: Year / Month / Day)';
  $('pdf-date-order').options[1].textContent='Month / Day / Year (year first: Year / Month / Day)';
  $('pdf-date-order').add(new Option('Year / Day / Month (for example 2026/07/10 = 7 October)','ydm'));
  $('pdf-date-order').closest('.field-grid').insertAdjacentHTML('afterend','<p class="muted">Choose the numeric date order before scanning. Dates such as 2026/07/10 are ambiguous; the selected order applies to all pages. Extracted dates are shown as YYYY-MM-DD. Jan = January; Jun = June. Descriptions keep their original case and are checked against the Deposit, Withdraw, Interest and Tax text above.</p>');
  $('pdf-download').insertAdjacentHTML('afterend','<button type="button" class="ghost-button" id="pdf-recheck">Review current cells</button>');
  let extraction=null,filename='',originalUrl='',controller=null,busy=false,revision=0,noticeStatementId=null;
  const status=text=>{$('pdf-progress').textContent=text;};
  function setBusy(value) {busy=value;for(const id of ['pdf-choose','pdf-import-check','pdf-download','pdf-date-order','pdf-force-ocr','pdf-recheck','pdf-recognition-mode','pdf-auto-import'])$(id).disabled=value;$('pdf-rows').inert=value;}
  const labels=()=>h.getValues?.()||{};
  function issues(items) {
    $('pdf-issues').replaceChildren();
    for(const issue of items.slice(0,100)) {
      const li=document.createElement('li');li.textContent=(issue.row_index==null?'':`Row ${issue.row_index+1}: `)+issue.message;
      if(issue.suggestion&&issue.row_index!=null) {
        const button=document.createElement('button');button.type='button';button.className='ghost-button';button.textContent=`Use ${issue.suggestion.key}: ${issue.suggestion.value}`;
        button.onclick=()=>{if(busy)return;const row=extraction.rows[issue.row_index];row[issue.suggestion.key]=issue.suggestion.value;if(issue.suggestion.key==='date')row.date_normalized=true;renderRows();};li.append(' ',button);
      }
      $('pdf-issues').append(li);
    }
    if(items.length>100){const li=document.createElement('li');li.textContent=`${items.length-100} more cells need review.`;$('pdf-issues').append(li);}
  }
  function review() {
    if(!extraction)return;
    const scanIssues=extraction.issues.filter(issue=>!issue.row||extraction.rows.includes(issue.row)&&issue.fields.some(key=>issue.row[key]===issue.readings[key])).map(issue=>({...issue,row_index:issue.row?extraction.rows.indexOf(issue.row):null}));
    const all=[...validateRows(extraction.rows,extraction.dateOrder),...reviewRows(extraction.rows,labels(),extraction.dateOrder),...scanIssues];
    const unique=[...new Map(all.map(issue=>[`${issue.row_index}:${issue.message}`,issue])).values()];
    for(const input of $('pdf-rows').querySelectorAll('input'))input.removeAttribute('aria-invalid');
    for(const issue of unique)for(const key of issue.fields)$('pdf-rows').children[issue.row_index]?.querySelector(`[data-field="${key}"]`)?.setAttribute('aria-invalid','true');
    issues(unique);
  }
  function renderRows() {
    $('pdf-rows').replaceChildren();
    extraction.rows.forEach((row,index)=>{
      const tr=document.createElement('tr'),page=document.createElement('td');page.textContent=row.page;tr.append(page);
      for(const key of ROW_KEYS) {
        const td=document.createElement('td'),input=document.createElement('input');input.value=row[key]??'';input.setAttribute('aria-label',`PDF row ${index+1} ${key}`);input.dataset.field=key;
        if(key==='date'){input.title=`Date in PDF: ${row.raw_date||row.date}. Edit using YYYY-MM-DD.`;input.placeholder='YYYY-MM-DD';}
        input.oninput=()=>{row[key]=input.value;if(key==='date')row.date_normalized=/^\d{4}-\d{2}-\d{2}$/.test(input.value.trim());review();};td.append(input);tr.append(td);
      }
      const td=document.createElement('td'),insert=document.createElement('button'),remove=document.createElement('button');
      insert.type='button';insert.textContent='Insert above';insert.className='ghost-button';insert.onclick=()=>{extraction.rows.splice(index,0,{...Object.fromEntries(ROW_KEYS.map(key=>[key,''])),page:row.page});renderRows();};
      remove.type='button';remove.textContent='Remove';remove.className='ghost-button';remove.onclick=()=>{extraction.rows.splice(index,1);renderRows();};td.append(insert,remove);tr.append(td);$('pdf-rows').append(tr);
    });
    review();
  }
  async function workbook() {
    if(!extraction)throw new Error('Choose a PDF statement first.');
    if(extraction.dateOrder!==$('pdf-date-order').value)throw new Error('The numeric date order changed. Choose the PDF again to rescan it with the new order.');
    review();
    const invalid=validateRows(extraction.rows,extraction.dateOrder);
    if(invalid.length) {issues(invalid);for(const issue of invalid)for(const field of issue.fields)$('pdf-rows').children[issue.row_index]?.querySelector(`[data-field="${field}"]`)?.setAttribute('aria-invalid','true');throw new Error('Correct the highlighted PDF cells before continuing.');}
    return new File([await statementWorkbook(extraction.rows,extraction.dateOrder,extraction.includeCheque)],filename.replace(/\.pdf$/i,'')+'-extracted.xlsx',{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
  }
  $('pdf-recheck').onclick=()=>{review();status('Review updated using the current cells and description text. Interest, tax and all other rules are checked after import.');};
  $('pdf-date-order').onchange=()=>{if(extraction&&extraction.dateOrder!==$('pdf-date-order').value)status('Date order changed. Choose the PDF again to rescan all dates with this order.');};
  $('pdf-recognition-mode').onchange=()=>{if(extraction)status('Recognition mode changed. Choose the PDF again to convert it with this mode.');};
  $('pdf-choose').onclick=()=>{if(!busy)$('pdf-file').click();};
  $('pdf-cancel').onclick=()=>{controller?.abort();status('Cancelling scan…');};
  $('pdf-file').onchange=async()=>{
    const file=$('pdf-file').files[0];$('pdf-file').value='';if(!file||busy)return;
    const scanRevision=++revision;let autoImport=false;
    noticeStatementId=null;notice.hidden=true;
    setBusy(true);h.pending(1);$('pdf-review').hidden=true;$('pdf-cancel').hidden=false;controller=new AbortController();
    try {
      const result=await readStatementPdf(file,{dateOrder:$('pdf-date-order').value,forceOcr:$('pdf-force-ocr').checked,mode:$('pdf-recognition-mode').value,labels:labels(),onProgress:text=>{if(scanRevision===revision)status(text);},signal:controller.signal});
      if(scanRevision!==revision)return;
      extraction=result;
      extraction.issues=extraction.issues.map(issue=>({...issue,row:issue.row_index==null?null:extraction.rows[issue.row_index],readings:issue.row_index==null?{}:Object.fromEntries(issue.fields.map(key=>[key,extraction.rows[issue.row_index]?.[key]]))}));
      filename=file.name;if(originalUrl)URL.revokeObjectURL(originalUrl);originalUrl=URL.createObjectURL(file);$('pdf-original').href=originalUrl;
      $('pdf-summary').textContent=`${extraction.rows.length} rows from ${extraction.pages.length} pages (${extraction.ocrPages} scanned with OCR). `+extraction.pages.map(p=>`Page ${p.page}: ${p.rows} rows, ${p.method}`).join('; ');
      renderRows();$('pdf-review').hidden=false;status('Ready. Review highlighted cells and any alternative readings against the PDF, then import and check.');
      autoImport=$('pdf-auto-import').checked;
      if(autoImport&&validateRows(extraction.rows,extraction.dateOrder).length){autoImport=false;status('Conversion needs review: correct unreadable dates or amounts below, then click Import and check statement. No unreadable value has been replaced with zero.');}
    } catch(error) {if(scanRevision===revision){status(error.name==='AbortError'?'PDF scan cancelled.':error.message);h.log(error.message,'error');}}
    finally {controller=null;setBusy(false);h.pending(-1);$('pdf-cancel').hidden=true;}
    // Release the scan lock before the existing import flow changes workspace.
    if(autoImport&&scanRevision===revision)await importConverted();
  };
  async function importConverted() {
    if(busy)return;setBusy(true);
    const importRevision=revision;
    try {
      const file=await workbook();
      if(importRevision!==revision)return;
      await h.importStatement(file,{useCurrentRate:true});
      if(importRevision!==revision)return;
      status(`Imported ${extraction.rows.length} PDF rows. Errors are shown beside the statement. Use Correct statement to edit with the selected profile or current checking details.`);
      h.showStatement?.();
      noticeStatementId=h.state.currentStatementId;
      notice.hidden=false;noticeText.textContent='Imported from PDF. Review OCR warnings and compare highlighted cells with the original before correcting or exporting.';
    }
    catch(error){if(importRevision===revision){status(error.message);h.log(error.message,'error');}}
    finally{setBusy(false);}
  }
  $('pdf-import-check').onclick=importConverted;
  const notice=document.createElement('div');notice.className='inset-panel pdf-review-notice';notice.hidden=true;
  const noticeText=document.createElement('p'),reviewButton=document.createElement('button');reviewButton.type='button';reviewButton.className='ghost-button';reviewButton.textContent='Review PDF cells and original';
  reviewButton.onclick=()=>{h.showSetup?.();panel.hidden=false;panel.scrollIntoView({block:'start'});};notice.append(noticeText,reviewButton);document.querySelector('.preview-panel').prepend(notice);
  $('pdf-download').onclick=async()=>{
    try {const file=await workbook(),url=URL.createObjectURL(file),link=document.createElement('a');link.href=url;link.download=file.name;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);status('Extracted Excel download started.');}
    catch(error){status(error.message);}
  };
  return {refresh(){notice.hidden=!noticeStatementId||h.state.currentStatementId!==noticeStatementId||h.state.currentStatementSource!=='imported';},open(){panel.hidden=false;panel.scrollIntoView({behavior:'smooth',block:'start'});},reset(){revision++;controller?.abort();extraction=null;noticeStatementId=null;notice.hidden=true;if(originalUrl)URL.revokeObjectURL(originalUrl);originalUrl='';filename='';$('pdf-original').removeAttribute('href');$('pdf-rows').replaceChildren();$('pdf-issues').replaceChildren();$('pdf-summary').textContent='';status('');$('pdf-review').hidden=true;panel.hidden=true;}};
}
