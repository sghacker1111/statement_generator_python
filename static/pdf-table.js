// Geometry-based statement extraction shared by the PHP and Python editions.
const REQUIRED = ['date', 'description', 'debit', 'credit', 'balance'];
const KEYS = ['date', 'description', 'cheque_no', 'debit', 'credit', 'balance'];
const blankMoney = /^(?:|[-–—]|nil)$/i;
const carryText = /\b(?:balance\s*(?:[bc]\s*\/\s*f|brought|carried)|(?:brought|carried)\s*forward|opening balance|closing balance)\b/i;
export const ROW_KEYS = KEYS;

export function parseDate(value, order = 'dmy') {
  const text = String(value || '').trim().replace(/\s*([/.-])\s*/g, '$1');
  let year, month, day, match;
  if ((match = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/))) [, year, month, day] = match;
  else if ((match = text.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2}|\d{4})$/))) {
    [, day, month, year] = match;
    if (order === 'mdy') [month, day] = [day, month];
  } else if ((match = text.match(/^(\d{1,2})[-\s]([A-Za-z]{3,9})[-,\s]+(\d{2}|\d{4})$/))) {
    [, day, month, year] = match;
    month = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].indexOf(month.slice(0,3).toLowerCase()) + 1;
  } else return '';
  year = Number(year); month = Number(month); day = Number(day);
  if (year < 100) year += year < 70 ? 2000 : 1900;
  const date = new Date(Date.UTC(year, month - 1, day));
  return year >= 1900 && year <= 2100 && month >= 1 && month <= 12 && date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}` : '';
}

export function parseAmount(value) {
  let text = String(value ?? '').trim();
  if (blankMoney.test(text)) return '';
  text = text.replace(/^(?:NPR|Rs\.?|\$)\s*/i, '').replace(/\s*(?:CR|DR)$/i, '').trim();
  const negative = /^\(.*\)$/.test(text) || /^-/.test(text) || /DR\s*$/i.test(String(value));
  text = text.replace(/^\((.*)\)$/, '$1').replace(/^-/, '').replace(/\s+/g, '');
  // Accept Western and South Asian comma groups, never guess letters or missing decimal points.
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+|\d{1,2}(?:,\d{2})*,\d{3})(?:\.\d{1,2})?$/.test(text)) return null;
  const number = Number(text.replaceAll(',', '')) * (negative ? -1 : 1);
  return Number.isFinite(number) && Math.abs(number) < 1e13 ? number.toFixed(2) : null;
}

export function groupLines(words) {
  const lines = [];
  for (const word of [...words].filter(w => w.text?.trim()).sort((a,b) => a.y0-b.y0 || a.x0-b.x0)) {
    const center = (word.y0 + word.y1) / 2, height = word.y1-word.y0;
    let line = lines.slice(-4).find(l => Math.abs(l.center-center) <= Math.max(2, Math.min(l.height,height)*0.55));
    if (!line) { line = {words:[],center,height,y0:word.y0,y1:word.y1}; lines.push(line); }
    line.words.push(word); line.y0=Math.min(line.y0,word.y0);line.y1=Math.max(line.y1,word.y1);
  }
  return lines.sort((a,b)=>a.y0-b.y0).map(line=>({...line,words:line.words.sort((a,b)=>a.x0-b.x0)}));
}

function headerKey(text) {
  const s=text.toLowerCase().replace(/[^a-z]/g,'');
  if (['date','transactiondate','txndate'].includes(s)) return 'date';
  if (/^(description|particulars?|narration)$/.test(s)) return 'description';
  if (/^(cheque|chequeno|chq|chqno|cho|chono|chg|chgno|checkno)$/.test(s)) return 'cheque_no';
  if (/^(debit|debt|withdrawals?|withdrawn|dr)$/.test(s)) return 'debit';
  if (/^(credit|deposits?|cr)$/.test(s)) return 'credit';
  if (/^(balance|runningbalance)$/.test(s)) return 'balance';
  return '';
}

export function findHeaders(lines) {
  const headers=[];
  for(let index=0;index<lines.length;index++) {
    const cells={}; let end=index;
    for(let j=index;j<Math.min(lines.length,index+3);j++) {
      if (lines[j].y0-lines[index].y0 > Math.max(28,lines[index].height*3)) break;
      for(const word of lines[j].words) {
        const key=headerKey(word.text);
        if (key && !cells[key]) cells[key]=word;
      }
      if(REQUIRED.every(key=>cells[key])) {end=j;break;}
    }
    if(!REQUIRED.every(key=>cells[key])) continue;
    const columns=Object.entries(cells).map(([key,w])=>({key,x0:w.x0,x1:w.x1,center:(w.x0+w.x1)/2})).sort((a,b)=>a.x0-b.x0);
    // Genuine table headers must span the page in separate columns.
    if(columns.some((c,i)=>i && c.x0<columns[i-1].x1-2)) continue;
    headers.push({index,end,y1:lines[end].y1,columns}); index=end;
  }
  return headers;
}

function cellsFor(line, columns) {
  const result=Object.fromEntries(KEYS.map(key=>[key,[]]));
  for(const word of line.words) {
    const center=(word.x0+word.x1)/2;
    // Description headings are often centred over a wide column. Its right edge
    // is close to the next heading, not halfway across that otherwise empty gap.
    let index=columns.findIndex((c,i)=>i<columns.length-1 && center<(c.key==='description'?columns[i+1].x0-6:(c.x1+columns[i+1].x0)/2));
    if(index<0)index=columns.length-1;
    result[columns[index].key].push(word);
  }
  return result;
}
const cellText=words=>words.map(w=>w.text).join(' ').trim();

export function extractPage(words, page, previousColumns=null, dateOrder='dmy') {
  const lines=groupLines(words), headers=findHeaders(lines), rows=[], issues=[];
  let columns=headers[0]?.columns || previousColumns, active=Boolean(columns), lastY=-Infinity;
  if(!columns)return {rows,issues,columns:null,headerFound:false};
  let start=headers[0]?.end+1 || 0;
  if(!headers.length) {
    start=lines.findIndex(line=>{
      const cells=cellsFor(line,columns),date=cellText(cells.date),balance=cellText(cells.balance);
      return (parseDate(date,dateOrder)||/\d.*[-/.]/.test(date)||(!date&&cellText(cells.description))) && balance!=='' && parseAmount(balance)!==null;
    });
    if(start<0)return {rows,issues,columns,headerFound:false};
  }
  for(let i=start;i<lines.length;i++) {
    const header=headers.find(h=>h.index===i);
    if(header) {columns=header.columns;i=header.end;active=true;lastY=-Infinity;continue;}
    if(!active)continue;
    const line=lines[i], cells=cellsFor(line,columns), texts=Object.fromEntries(KEYS.map(key=>[key,cellText(cells[key])]));
    const full=line.words.map(w=>w.text).join(' ');
    if (/^(?:grand\s+total|total(?:s|\s+(?:debit|credit|withdrawals?|deposits?))?|summary|authorized|authorised|signature|page\s+\d)/i.test(full.trim()) || /\bdebit\s+and\s+credit\s+total\b/i.test(full)) {active=false;continue;}
    const date=parseDate(texts.date,dateOrder), hasAmounts=['debit','credit','balance'].some(k=>texts[k]&&!blankMoney.test(texts[k]));
    const looksDate=/\d.*[-/.]/.test(texts.date) || /^\d{1,2}\s+[A-Za-z]{3}/.test(texts.date);
    if((date || looksDate || (texts.description && texts.balance && parseAmount(texts.balance)!==null)) && hasAmounts) {
      const row={...texts,date:date||texts.date,page,y:line.center,height:line.height,confidence:Math.min(...line.words.map(w=>w.confidence??100))};
      if(!date)issues.push({row_index:rows.length,fields:['date'],message:`Page ${page}: review unreadable date "${texts.date}".`});
      for(const key of ['debit','credit','balance']) {
        const amount=parseAmount(texts[key]);
        if(amount===null || (key==='balance' && amount===''))issues.push({row_index:rows.length,fields:[key],message:`Page ${page}: review ${key} "${texts[key]}".`});
        else row[key]=amount;
      }
      if(row.confidence<75)issues.push({row_index:rows.length,fields:KEYS.filter(k=>cells[k].some(w=>(w.confidence??100)<75)),message:`Page ${page}: OCR confidence is low; compare this row with the PDF.`});
      rows.push(row);lastY=line.y1;
    } else if(!texts.date && !hasAmounts && texts.description && !texts.cheque_no && rows.length && line.y0-lastY<Math.max(18,line.height*2)) {
      rows.at(-1).description+=' '+texts.description;lastY=line.y1;
    } else if(hasAmounts && (texts.description || texts.date) && !/^(?:page|total|summary)\b/i.test(full)) {
      // Do not silently lose a transaction whose date was missed by OCR.
      issues.push({page,fields:['date'],message:`Page ${page}: a possible row has no readable date: ${full.slice(0,180)}. Check the PDF before importing.`});
    }
  }
  return {rows,issues,columns,headerFound:headers.length>0};
}

export function needsOcr(result,dateOrder='dmy') {
  return !result.rows.length || validateRows(result.rows,dateOrder).length>0;
}

export function recoverDates(result,words,dateOrder='dmy') {
  const dates=groupLines(words).map(line=>({date:parseDate(cellText(line.words),dateOrder),y:line.center})).filter(item=>item.date);
  const rows=result.rows.map(row=>({...row})),issues=[...result.issues];
  rows.forEach((row,index)=>{
    const match=dates.map(item=>({...item,distance:Math.abs(item.y-row.y)})).filter(item=>item.distance<=Math.max(12,row.height||0)).sort((a,b)=>a.distance-b.distance)[0];
    if(!match || match.date===row.date)return;
    if(!parseDate(row.date,dateOrder)) {
      row.date=match.date;
      issues.push({row_index:index,fields:['date'],message:`Page ${row.page}: date recovered by scanning its column separately. Verify against the PDF.`});
    } else issues.push({row_index:index,fields:['date'],message:`Page ${row.page}: date OCR disagrees (${match.date}). Original reading retained; verify against the PDF.`});
  });
  return {...result,rows,issues};
}

export function reconcileTextAndOcr(text,ocr,dateOrder='dmy') {
  if(!text.rows.length)return ocr;
  const rows=text.rows.map(row=>({...row})),issues=[],used=new Set();
  const valid=(key,value)=>key==='date'?Boolean(parseDate(value,dateOrder)):['debit','credit','balance'].includes(key)?parseAmount(value)!==null&&(key!=='balance'||parseAmount(value)!==''):Boolean(String(value||'').trim());
  rows.forEach((row,index)=>{
    const candidates=ocr.rows.map((other,i)=>({other,i,distance:Math.abs(other.y-row.y)})).filter(c=>!used.has(c.i)&&c.distance<=Math.max(12,row.height||0)).sort((a,b)=>a.distance-b.distance);
    const candidate=candidates[0];if(!candidate)return;used.add(candidate.i);
    for(const key of KEYS) {
      const before=row[key],after=candidate.other[key];
      if(String(before)===String(after)||!valid(key,after))continue;
      if(!valid(key,before)) {
        row[key]=after;
        issues.push({row_index:index,fields:[key],message:`Page ${row.page}: ${key} recovered with OCR; compare with the original PDF.`});
      } else {
        issues.push({row_index:index,fields:[key],message:`Page ${row.page}: PDF text and OCR disagree for ${key} (OCR reads "${after}"). Original text retained; compare with the PDF.`});
      }
    }
  });
  // Keep a reviewable row when OCR finds a transaction missing from the text layer.
  ocr.rows.forEach((row,i)=>{if(!used.has(i)) {rows.push({...row});issues.push({row_index:rows.length-1,fields:KEYS,message:`Page ${row.page}: additional OCR row; verify its position and contents.`});}});
  const tagged=rows.map((row,i)=>({row,index:i})).sort((a,b)=>a.row.y-b.row.y);
  const positions=new Map(tagged.map((item,i)=>[item.index,i]));
  const ordered=tagged.map(item=>item.row);
  return {...text,rows:ordered,issues:[...validateRows(ordered,dateOrder),...issues.map(issue=>({...issue,row_index:positions.get(issue.row_index)}))]};
}

export function mergePages(pages) {
  const rows=[],issues=[];
  for(const page of pages) {
    let incoming=page.rows.map(row=>({...row}));
    const previous=rows.at(-1), first=incoming[0];
    // Remove only an explicit carried balance at a page boundary; repeated transactions stay.
    const noMovement=row=>parseAmount(row.debit)===''||Number(row.debit)===0;
    const isCarry=row=>row && carryText.test(row.description) && noMovement(row) && (parseAmount(row.credit)===''||Number(row.credit)===0);
    if(previous && first && previous.date===first.date && String(previous.balance)===String(first.balance) && isCarry(first)) {
      if(isCarry(previous))rows.pop();
      incoming.shift();
    }
    const offset=rows.length;
    for(const issue of page.issues)issues.push({...issue,row_index:issue.row_index==null?null:offset+Math.max(0,issue.row_index-(page.rows.length-incoming.length))});
    rows.push(...incoming);
  }
  return {rows,issues};
}

export function validateRows(rows,dateOrder='dmy') {
  const issues=[];
  if(!rows.length)return [{row_index:null,fields:[],message:'No statement rows were found.'}];
  rows.forEach((row,index)=>{
    if(!parseDate(row.date,dateOrder))issues.push({row_index:index,fields:['date'],message:'Enter a valid transaction date.'});
    if(!row.description.trim())issues.push({row_index:index,fields:['description'],message:'Enter the row description.'});
    for(const key of ['debit','credit','balance']) {
      const amount=parseAmount(row[key]);
      if(amount===null || key==='balance'&&amount==='' || key!=='balance'&&Number(amount)<0)issues.push({row_index:index,fields:[key],message:`Enter a valid ${key} amount.`});
    }
  });
  return issues;
}

export async function statementWorkbook(rows,dateOrder='dmy',includeCheque=true) {
  if(validateRows(rows,dateOrder).length)throw new Error('Correct the highlighted PDF rows before importing or downloading Excel.');
  const {zipSync,strToU8}=await import('./vendor/pdf-ocr/fflate.mjs');
  const keys=KEYS.filter(k=>includeCheque||k!=='cheque_no');
  const labels={date:'Date',description:'Description',cheque_no:'Cheque No.',debit:'Debit',credit:'Credit',balance:'Balance'};
  const escape=text=>String(text).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
  const grid=[keys.map(key=>labels[key]),...rows.map(row=>keys.map(key=>key==='date'?parseDate(row[key],dateOrder):['debit','credit','balance'].includes(key)?parseAmount(row[key]):row[key]))];
  const xml='<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols>'+keys.map((key,i)=>`<col min="${i+1}" max="${i+1}" width="${key==='description'?58:20}" customWidth="1"/>`).join('')+'</cols><sheetData>'+grid.map((cells,i)=>`<row r="${i+1}">`+cells.map((text,j)=>`<c r="${String.fromCharCode(65+j)}${i+1}" t="inlineStr"><is><t xml:space="preserve">${escape(text)}</t></is></c>`).join('')+'</row>').join('')+'</sheetData></worksheet>';
  const files={
    '[Content_Types].xml':'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
    '_rels/.rels':'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    'xl/workbook.xml':'<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Imported Statement" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels':'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml':xml,
  };
  return zipSync(Object.fromEntries(Object.entries(files).map(([key,value])=>[key,strToU8(value)])),{level:6});
}
