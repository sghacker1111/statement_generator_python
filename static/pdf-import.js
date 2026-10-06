import {extractPage,mergePages,validateRows,statementWorkbook,ROW_KEYS,needsOcr,reconcileTextAndOcr,recoverDates} from './pdf-table.js';

const asset = name => new URL(`./vendor/pdf-ocr/${name}`, import.meta.url).href;
const cancelled = () => new DOMException('PDF import cancelled.', 'AbortError');

export async function readStatementPdf(file,{dateOrder='dmy',forceOcr=false,onProgress=()=>{},signal}={}) {
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
  const abortPromise=new Promise((_,reject)=>{rejectAbort=reject;});
  const stop=()=>{terminated=true;rejectAbort(cancelled());void worker?.terminate().catch(()=>{});void task.destroy().catch(()=>{});};
  signal?.addEventListener('abort',stop,{once:true});
  const checkAbort=()=>{if(signal?.aborted)throw cancelled();};
  const abortable=promise=>Promise.race([promise,abortPromise]);
  async function recognize(page,rotation=0,headerContrast=false,region=null) {
    checkAbort();
    if(!worker) {
      const {default:Tesseract}=await import('./vendor/pdf-ocr/tesseract.esm.min.js');
      worker=await abortable(Tesseract.createWorker('eng',1,{workerPath:asset('worker.min.js'),workerBlobURL:false,corePath:asset(''),langPath:asset('').replace(/\/$/,''),cacheMethod:'none',
        logger:m=>{if(!signal?.aborted)onProgress(`Page ${activePage}/${doc.numPages}: ${m.status}${m.progress==null?'':` ${Math.round(m.progress*100)}%`}`);}}).then(created=>{if(signal?.aborted){void created.terminate();throw cancelled();}return created;}));
      await worker.setParameters({tessedit_pageseg_mode:'11',preserve_interword_spaces:'1',user_defined_dpi:'240'});
    }
    checkAbort();
    const base=page.getViewport({scale:1,rotation:(page.rotate+rotation)%360});
    const scale=Math.min(240/72,Math.sqrt(12000000/(base.width*base.height)));
    const viewport=page.getViewport({scale,rotation:(page.rotate+rotation)%360});
    const canvas=document.createElement('canvas');canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
    try {
      await abortable(page.render({canvasContext:canvas.getContext('2d'),viewport,background:'#ffffff'}).promise);
      checkAbort();
      if(headerContrast) {
        // Used only to locate shaded/halftone headings. Read transaction values
        // from the original image, whose fine digits can be lost by thresholding.
        const context=canvas.getContext('2d'),pixels=context.getImageData(0,0,canvas.width,canvas.height),data=pixels.data;
        for(let i=0;i<data.length;i+=4){const value=(data[i]*0.299+data[i+1]*0.587+data[i+2]*0.114)>135?255:0;data[i]=data[i+1]=data[i+2]=value;}
        context.putImageData(pixels,0,0);
      }
      await worker.setParameters({tessedit_pageseg_mode:region?'6':'11'});
      const options=region?{rectangle:{left:Math.max(0,Math.floor(region.x*scale)),top:Math.max(0,Math.floor(region.y*scale)),width:Math.min(canvas.width-Math.max(0,Math.floor(region.x*scale)),Math.ceil(region.width*scale)),height:Math.min(canvas.height-Math.max(0,Math.floor(region.y*scale)),Math.ceil(region.height*scale))}}:{};
      let timer;
      const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{void worker?.terminate();worker=null;reject(new Error(`OCR timed out on page ${activePage}. Try a clearer or smaller scan.`));},120000);});
      let data;
      try {({data}=await abortable(Promise.race([worker.recognize(canvas,options, {text:true,tsv:true}),timeout])));}
      finally {clearTimeout(timer);}
      checkAbort();
      const words=[];
      for(const line of (data.tsv||'').split('\n').slice(1)) {
        const parts=line.split('\t');if(parts.length<12||parts[0]!=='5')continue;
        const text=parts.slice(11).join('\t').trim();if(!text)continue;
        const [left,top,width,height,confidence]=parts.slice(6,11).map(Number);
        words.push({text,x0:left/scale,x1:(left+width)/scale,y0:top/scale,y1:(top+height)/scale,confidence});
      }
      return words;
    } finally {canvas.width=0;canvas.height=0;}
  }
  try {
    doc=await abortable(task.promise);
    if(doc.numPages>50)throw new Error('Import up to 50 PDF pages at a time. Split this document into smaller statements.');
    const pages=[],report=[];let columns=null,ocrPages=0;
    for(let number=1;number<=doc.numPages;number++) {
      checkAbort();activePage=number;onProgress(`Reading page ${number}/${doc.numPages}…`);
      const page=await abortable(doc.getPage(number)),viewport=page.getViewport({scale:1});
      let words=[],usedOcr=false;
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
      // A letterhead text layer alone must not suppress OCR of the scanned transaction table.
      if(forceOcr || needsOcr(result,dateOrder) || !words.length) {
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
          for(const rotation of [90,180,270]) {
            onProgress(`Page ${number}/${doc.numPages}: checking scan orientation…`);
            const rotated=await recognize(page,rotation);
            const candidate=extractPage(rotated,number,null,dateOrder);
            if(candidate.headerFound && candidate.rows.length){result=candidate;break;}
          }
        }
        if(result.rows.length && validateRows(result.rows,dateOrder).some(issue=>issue.fields.includes('date'))) {
          const dateColumn=result.columns.findIndex(c=>c.key==='date'),col=result.columns[dateColumn],next=result.columns[dateColumn+1];
          if(next) {
            const x=Math.max(0,col.x0-60),right=(col.x1+next.x0)/2,y=Math.max(0,result.rows[0].y-18),bottom=result.rows.at(-1).y+18;
            onProgress(`Page ${number}/${doc.numPages}: reading unclear dates…`);
            result=recoverDates(result,await recognize(page,0,false,{x,y,width:right-x,height:bottom-y}),dateOrder);
          }
        }
        if(!forceOcr)result=reconcileTextAndOcr(textResult,result,dateOrder);
        result.headerFound ||= textResult.headerFound;
      }
      if(result.columns)columns=result.columns;
      if(!result.rows.length)result.issues.push({page:number,fields:[],message:`Page ${number}: no transaction table rows were found. Review this page for missed rows.`});
      else if(!result.headerFound)result.issues.push({page:number,fields:[],message:`Page ${number}: continued using the previous page's columns. Verify the alignment.`});
      pages.push(result);report.push({page:number,rows:result.rows.length,method:usedOcr?'OCR':'PDF text'});
      if(pages.reduce((sum,p)=>sum+p.rows.length,0)>5000)throw new Error('Import up to 5,000 statement rows at a time.');
      page.cleanup();
    }
    const result=mergePages(pages);
    if(!result.rows.length)throw new Error('No statement table was detected. The PDF must show Date, Description/Particulars, Debit, Credit and Balance headings. Try a clearer scan or Force OCR.');
    return {...result,pages:report,ocrPages,includeCheque:pages.some(p=>p.columns?.some(c=>c.key==='cheque_no'))};
  } catch(error) {
    if(signal?.aborted)throw cancelled();
    if(error.name==='PasswordException')throw new Error('This PDF is password protected. Unlock a copy before importing it.');
    throw error;
  } finally {
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
  let extraction=null,filename='',originalUrl='',controller=null,busy=false,revision=0;
  const status=text=>{$('pdf-progress').textContent=text;};
  function setBusy(value) {busy=value;for(const id of ['pdf-choose','pdf-import-check','pdf-download','pdf-date-order','pdf-force-ocr'])$(id).disabled=value;}
  function issues(items) {
    $('pdf-issues').replaceChildren();
    for(const issue of items.slice(0,100)) {const li=document.createElement('li');li.textContent=(issue.row_index==null?'':`Row ${issue.row_index+1}: `)+issue.message;$('pdf-issues').append(li);}
    if(items.length>100){const li=document.createElement('li');li.textContent=`${items.length-100} more cells need review.`;$('pdf-issues').append(li);}
  }
  function renderRows() {
    $('pdf-rows').replaceChildren();
    extraction.rows.forEach((row,index)=>{
      const tr=document.createElement('tr'),page=document.createElement('td');page.textContent=row.page;tr.append(page);
      for(const key of ROW_KEYS) {
        const td=document.createElement('td'),input=document.createElement('input');input.value=row[key]??'';input.setAttribute('aria-label',`PDF row ${index+1} ${key}`);input.dataset.field=key;
        input.oninput=()=>{row[key]=input.value;input.removeAttribute('aria-invalid');};td.append(input);tr.append(td);
      }
      const td=document.createElement('td'),insert=document.createElement('button'),remove=document.createElement('button');
      insert.type='button';insert.textContent='Insert above';insert.className='ghost-button';insert.onclick=()=>{extraction.rows.splice(index,0,{...Object.fromEntries(ROW_KEYS.map(key=>[key,''])),page:row.page});renderRows();};
      remove.type='button';remove.textContent='Remove';remove.className='ghost-button';remove.onclick=()=>{extraction.rows.splice(index,1);renderRows();};td.append(insert,remove);tr.append(td);$('pdf-rows').append(tr);
    });
  }
  async function workbook() {
    const invalid=validateRows(extraction?.rows||[],$('pdf-date-order').value);
    if(invalid.length) {issues(invalid);for(const issue of invalid)for(const field of issue.fields)$('pdf-rows').children[issue.row_index]?.querySelector(`[data-field="${field}"]`)?.setAttribute('aria-invalid','true');throw new Error('Correct the highlighted PDF cells before continuing.');}
    return new File([await statementWorkbook(extraction.rows,$('pdf-date-order').value,extraction.includeCheque)],filename.replace(/\.pdf$/i,'')+'-extracted.xlsx',{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
  }
  $('pdf-choose').onclick=()=>{if(!busy)$('pdf-file').click();};
  $('pdf-cancel').onclick=()=>{controller?.abort();status('Cancelling scan…');};
  $('pdf-file').onchange=async()=>{
    const file=$('pdf-file').files[0];$('pdf-file').value='';if(!file||busy)return;
    const scanRevision=++revision;
    setBusy(true);h.pending(1);$('pdf-review').hidden=true;$('pdf-cancel').hidden=false;controller=new AbortController();
    try {
      const result=await readStatementPdf(file,{dateOrder:$('pdf-date-order').value,forceOcr:$('pdf-force-ocr').checked,onProgress:text=>{if(scanRevision===revision)status(text);},signal:controller.signal});
      if(scanRevision!==revision)return;
      extraction=result;
      filename=file.name;if(originalUrl)URL.revokeObjectURL(originalUrl);originalUrl=URL.createObjectURL(file);$('pdf-original').href=originalUrl;
      $('pdf-summary').textContent=`${extraction.rows.length} rows from ${extraction.pages.length} pages (${extraction.ocrPages} scanned with OCR). `+extraction.pages.map(p=>`Page ${p.page}: ${p.rows} rows, ${p.method}`).join('; ');
      renderRows();issues(extraction.issues);$('pdf-review').hidden=false;status('Ready. Review the table, then import and check.');
    } catch(error) {if(scanRevision===revision){status(error.name==='AbortError'?'PDF scan cancelled.':error.message);h.log(error.message,'error');}}
    finally {controller=null;setBusy(false);h.pending(-1);$('pdf-cancel').hidden=true;}
  };
  $('pdf-import-check').onclick=async()=>{
    if(busy)return;setBusy(true);
    try {const file=await workbook();await h.importStatement(file);status(`Imported ${extraction.rows.length} PDF rows. Review errors in the statement checker below.`);}
    catch(error){status(error.message);h.log(error.message,'error');}
    finally{setBusy(false);}
  };
  $('pdf-download').onclick=async()=>{
    try {const file=await workbook(),url=URL.createObjectURL(file),link=document.createElement('a');link.href=url;link.download=file.name;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);status('Extracted Excel download started.');}
    catch(error){status(error.message);}
  };
  return {open(){panel.hidden=false;panel.scrollIntoView({behavior:'smooth',block:'start'});},reset(){revision++;controller?.abort();extraction=null;if(originalUrl)URL.revokeObjectURL(originalUrl);originalUrl='';filename='';$('pdf-original').removeAttribute('href');$('pdf-rows').replaceChildren();$('pdf-issues').replaceChildren();$('pdf-summary').textContent='';status('');$('pdf-review').hidden=true;panel.hidden=true;}};
}
