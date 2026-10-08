// Geometry-based statement extraction shared by the PHP and Python editions.
const REQUIRED = ['date', 'description', 'debit', 'credit', 'balance'];
const KEYS = ['date', 'description', 'cheque_no', 'debit', 'credit', 'balance'];
const blankMoney = /^(?:|[-–—]|nil)$/i;
const carryText = /\b(?:balance\s*(?:[bc]\s*\/\s*f|brought|carried)|(?:brought|carried)\s*forward|opening balance|closing balance)\b/i;
export const ROW_KEYS = KEYS;
const months = ['january','february','march','april','may','june','july','august','september','october','november','december'];
const monthNumber = text => months.findIndex(name => name === text || name.slice(0,3) === text || name === 'september' && text === 'sept') + 1;

export function parseDate(value, order = 'dmy') {
  const text = String(value || '').trim().replace(/[\u2010-\u2014]/g,'-').replace(/\s*([/.-])\s*/g, '$1');
  let year, month, day, match;
  if ((match = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/))) {
    [, year, month, day] = match;
    if(order === 'ydm') [month,day] = [day,month];
  } else if ((match = text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/))) {
    [, day, month, year] = match;
    if (order === 'mdy') [month, day] = [day, month];
  } else if ((match = text.match(/^(\d{1,2})[-/\s]+([A-Za-z]{3,9})[-/,\s]+(\d{2}|\d{4})$/))) {
    [, day, month, year] = match;
    month = monthNumber(month.toLowerCase());
  } else return '';
  year = Number(year); month = Number(month); day = Number(day);
  if (year < 100) year += year < 70 ? 2000 : 1900;
  const date = new Date(Date.UTC(year, month - 1, day));
  return year >= 1900 && year <= 2100 && month >= 1 && month <= 12 && date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}` : '';
}

// Restrict OCR substitutions to known month tokens in the date cell. Never
// substitute letters in amounts, names or descriptions, or invent a month.
export function readDate(value, order='dmy') {
  const raw=String(value||'').trim(), direct=parseDate(raw,order);
  if(direct)return {date:direct,corrected:false};
  const match=raw.replace(/[\u2010-\u2014]/g,'-').match(/^(\d{1,2})\s*[-/\s]\s*([A-Za-z0-9]{3,9})\s*[-/,\s]\s*(\d{2}|\d{4})$/);
  if(!match)return {date:'',corrected:false};
  const aliases={'0ct':'oct','0tc':'oct','otc':'oct','0ctober':'october','se9':'sep','5ep':'sep','5ept':'sept','5eptember':'september','n0v':'nov','n0vember':'november','ju1':'jul','ju1y':'july'};
  const month=aliases[match[2].toLowerCase()];
  const date=month?parseDate(`${match[1]}-${month}-${match[3]}`,order):'';
  return {date,corrected:Boolean(date)};
}
const rowDate=(row,order)=>parseDate(row.date,row.date_normalized?'ymd':order);
function recordReading(row,key,value,source) {
  row.readings={...row.readings,[key]:[...(row.readings?.[key]||[]).filter(r=>r.source!==source),{value,source}]};
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
      return balance!=='' && (readDate(date,dateOrder).date||/\d.*[-/.]/.test(date)||(!date&&cellText(cells.description)&&parseAmount(balance)!==null));
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
    const reading=readDate(texts.date,dateOrder),date=reading.date, hasAmounts=['debit','credit','balance'].some(k=>texts[k]&&!blankMoney.test(texts[k]));
    const looksDate=/\d.*[-/.]/.test(texts.date) || /^\d{1,2}\s+[A-Za-z]{3}/.test(texts.date);
    if((date || looksDate || (texts.description && texts.balance)) && hasAmounts) {
      const row={...texts,date:date||texts.date,date_normalized:Boolean(date),raw_date:texts.date,page,y:line.center,y0:line.y0,y1:line.y1,height:line.y1-line.y0,confidence:Math.min(...line.words.map(w=>w.confidence??100)),cell_bounds:Object.fromEntries(KEYS.filter(k=>cells[k].length).map(k=>[k,{x0:Math.min(...cells[k].map(w=>w.x0)),x1:Math.max(...cells[k].map(w=>w.x1))}]))};
      if(!date)issues.push({row_index:rows.length,fields:['date'],message:`Page ${page}: review unreadable date "${texts.date}".`});
      if(reading.corrected)issues.push({row_index:rows.length,fields:['date'],message:`Page ${page}: OCR month "${texts.date}" interpreted as ${date}. Verify against the PDF.`});
      for(const key of ['debit','credit','balance']) {
        const amount=parseAmount(texts[key]);
        if(amount===null || (key==='balance' && amount===''))issues.push({row_index:rows.length,fields:[key],message:`Page ${page}: review ${key} "${texts[key]}".`});
        else row[key]=amount;
      }
      if(row.confidence<75)issues.push({row_index:rows.length,fields:KEYS.filter(k=>cells[k].some(w=>(w.confidence??100)<75)),message:`Page ${page}: OCR confidence is low; compare this row with the PDF.`});
      rows.push(row);lastY=line.y1;
    } else if(!texts.date && !hasAmounts && texts.description && !texts.cheque_no && rows.length && line.y0-lastY<Math.max(18,line.height*2)) {
      rows.at(-1).description+=' '+texts.description;rows.at(-1).y1=line.y1;lastY=line.y1;
    } else if(hasAmounts && (texts.description || texts.date) && !/^(?:page|total|summary)\b/i.test(full)) {
      // Do not silently lose a transaction whose date was missed by OCR.
      issues.push({page,fields:['date'],message:`Page ${page}: a possible row has no readable date: ${full.slice(0,180)}. Check the PDF before importing.`});
    }
  }
  return {rows,issues,columns,headerFound:headers.length>0};
}

export function needsOcr(result,dateOrder='dmy') {
  return !result.rows.length || result.issues?.length>0 || validateRows(result.rows,dateOrder).length>0 || reviewRows(result.rows,{},dateOrder).length>0;
}

export function recoverDates(result,words,dateOrder='dmy') {
  const dates=groupLines(words).map(line=>({date:parseDate(cellText(line.words),dateOrder),y:line.center})).filter(item=>item.date);
  const rows=result.rows.map(row=>({...row})),issues=[...result.issues];
  rows.forEach((row,index)=>{
    const match=dates.map(item=>({...item,distance:Math.abs(item.y-row.y)})).filter(item=>item.distance<=Math.max(12,row.height||0)).sort((a,b)=>a.distance-b.distance)[0];
    if(!match || match.date===row.date)return;
    if(!rowDate(row,dateOrder)) {
      row.date=match.date;row.date_normalized=true;
      issues.push({row_index:index,fields:['date'],message:`Page ${row.page}: date recovered by scanning its column separately. Verify against the PDF.`});
    } else issues.push({row_index:index,fields:['date'],message:`Page ${row.page}: date OCR disagrees (${match.date}). Original reading retained; verify against the PDF.`});
  });
  return {...result,rows,issues};
}

export function reconcileTextAndOcr(text,ocr,dateOrder='dmy',primarySource='PDF text',secondarySource='OCR') {
  if(!text.rows.length)return ocr;
  const rows=text.rows.map(row=>({...row})),issues=[...(text.issues||[])],used=new Set(),ocrPositions=new Map();
  const valid=(key,value)=>key==='date'?Boolean(parseDate(value,dateOrder)):['debit','credit','balance'].includes(key)?parseAmount(value)!==null&&(key!=='balance'||parseAmount(value)!==''):Boolean(String(value||'').trim());
  rows.forEach((row,index)=>{
    const candidates=ocr.rows.map((other,i)=>({other,i,distance:Math.abs(other.y-row.y)})).filter(c=>!used.has(c.i)&&c.distance<=Math.max(12,row.height||0)).sort((a,b)=>a.distance-b.distance);
    const candidate=candidates[0];if(!candidate)return;used.add(candidate.i);ocrPositions.set(candidate.i,index);
    for(const key of KEYS) {
      const before=row[key],after=candidate.other[key];
      if(!row.readings?.[key])recordReading(row,key,before,primarySource);
      for(const reading of candidate.other.readings?.[key]||[])recordReading(row,key,reading.value,reading.source);
      recordReading(row,key,after,secondarySource);
      if(String(before)===String(after)||!(key==='date'?rowDate(candidate.other,dateOrder):valid(key,after)))continue;
      if(!(key==='date'?rowDate(row,dateOrder):valid(key,before))) {
        row[key]=after;
        if(key==='date')row.date_normalized=candidate.other.date_normalized??true;
        issues.push({row_index:index,fields:[key],message:`Page ${row.page}: ${key} recovered with ${secondarySource}; compare with the original PDF.`});
      } else {
        issues.push({row_index:index,fields:[key],suggestion:{key,value:after},message:`Page ${row.page}: ${primarySource} and ${secondarySource} disagree for ${key} (${secondarySource} reads "${after}"). ${primarySource} retained; compare with the PDF.`});
      }
    }
  });
  // Keep a reviewable row when OCR finds a transaction missing from the text layer.
  ocr.rows.forEach((row,i)=>{if(!used.has(i)) {ocrPositions.set(i,rows.length);rows.push({...row});issues.push({row_index:rows.length-1,fields:KEYS,message:`Page ${row.page}: additional OCR row; verify its position and contents.`});}});
  for(const issue of ocr.issues||[])issues.push({...issue,row_index:issue.row_index==null?null:ocrPositions.get(issue.row_index)});
  const tagged=rows.map((row,i)=>({row,index:i})).sort((a,b)=>a.row.y-b.row.y);
  const positions=new Map(tagged.map((item,i)=>[item.index,i]));
  const ordered=tagged.map(item=>item.row);
  return {...text,rows:ordered,issues:[...validateRows(ordered,dateOrder),...issues.map(issue=>({...issue,row_index:issue.row_index==null?null:positions.get(issue.row_index)}))]};
}

export function columnRegions(result, width, height) {
  if(!result.rows.length)return [];
  const columns=result.columns;
  const edges=columns.slice(0,-1).map((column,i)=>{
    const next=columns[i+1];
    const right=Math.max(column.x1,...result.rows.map(r=>r.cell_bounds?.[column.key]?.x1??column.x1));
    const left=Math.min(next.x0,...result.rows.map(r=>r.cell_bounds?.[next.key]?.x0??next.x0));
    return right<left?(right+left)/2:column.key==='description'?next.x0-6:(column.x1+next.x0)/2;
  });
  const first=result.rows[0],last=result.rows.at(-1);
  const y=Math.max(0,(first.y0??first.y-first.height/2)-6),bottom=Math.min(height,(last.y1??last.y+last.height/2)+6);
  return columns.map((column,i)=>{const x=i?edges[i-1]:Math.max(0,Math.min(column.x0,...result.rows.map(r=>r.cell_bounds?.[column.key]?.x0??column.x0))-8);return {key:column.key,x,y,width:(edges[i]??width)-x,height:bottom-y};}).filter(r=>r.width>0&&r.height>0);
}

// Bound every cell by its own column and the space between adjacent rows.
// Include ascenders/descenders and wrapped descriptions instead of clipping a
// fixed number of pixels around a line's first recognized word.
export function cellRegion(rows,index,region) {
  const row=rows[index],previous=rows[index-1],next=rows[index+1];
  const top=r=>r.y0??r.y-(r.height||10)/2;
  const bottom=r=>r.y1??r.y+(r.height||10)/2;
  const y=Math.max(region.y,previous?(bottom(previous)+top(row))/2:top(row)-6);
  const end=Math.min(region.y+region.height,next?(bottom(row)+top(next))/2:bottom(row)+6);
  return {...region,y,height:Math.max(1,end-y),singleLine:bottom(row)-top(row)<(row.height||10)*1.6};
}

export function refineCell(result,index,key,words,dateOrder='dmy',source='cell OCR') {
  const row=result.rows[index];
  if(!row||!words.length)return result;
  const lines=groupLines(words),raw=lines.map(line=>cellText(line.words)).join(' ');
  // Treat the crop as one cell, including wrapped text. Never borrow words from
  // a neighbouring row to satisfy an expected description or running balance.
  const height=row.height||10;
  const synthetic=[{text:raw,x0:0,x1:1,y0:row.y-height/2,y1:row.y+height/2,confidence:Math.min(...words.map(w=>w.confidence??100))}];
  const refined=refineColumn({...result,rows:[row],issues:[]},key,synthetic,dateOrder,source);
  const rows=[...result.rows];rows[index]=refined.rows[0];
  return {...result,rows,issues:[...result.issues,...refined.issues.map(issue=>({...issue,row_index:index}))]};
}

export function refineColumn(result,key,words,dateOrder='dmy',source='column OCR') {
  const rows=result.rows.map(row=>({...row})),issues=[...result.issues],lines=groupLines(words),used=new Set();
  rows.forEach((row,index)=>{
    const candidates=lines.map((line,i)=>({line,i,distance:Math.abs(line.center-row.y)})).filter(c=>!used.has(c.i)&&c.distance<=Math.max(8,(row.height||10)*0.85)).sort((a,b)=>a.distance-b.distance);
    const match=candidates[0];if(!match)return;used.add(match.i);
    const selected=[match.line];
    if(key==='description')for(let i=match.i+1;i<lines.length;i++) {
      const line=lines[i],next=rows[index+1];
      if(used.has(i)||line.y0-selected.at(-1).y1>18||next&&line.center>=next.y-Math.max(5,(next.height||10)/2))break;
      selected.push(line);used.add(i);
    }
    const raw=selected.map(l=>cellText(l.words)).join(' '),date=key==='date'?readDate(raw,dateOrder):null;
    const after=key==='date'?date.date:['debit','credit','balance'].includes(key)?parseAmount(raw):raw;
    if(after==null||after==='')return;
    if(!row.readings?.[key])recordReading(row,key,row[key],'page OCR');
    recordReading(row,key,after,source);
    if(String(row[key])===after)return;
    const beforeValid=key==='date'?rowDate(row,dateOrder):['debit','credit','balance'].includes(key)?parseAmount(row[key])!==null&&parseAmount(row[key])!=='':Boolean(row[key]);
    if(!beforeValid) {
      row[key]=after;if(key==='date')row.date_normalized=true;
      issues.push({row_index:index,fields:[key],message:`Page ${row.page}: ${key} recovered by reading its column separately (${raw}). Verify against the PDF.`});
    } else issues.push({row_index:index,fields:[key],suggestion:{key,value:after},message:`Page ${row.page}: focused ${key} reading is "${after}"; current reading is "${row[key]}". Compare with the PDF before choosing.`});
  });
  return {...result,rows,issues};
}

export function resolveReadings(result) {
  const rows=result.rows.map(row=>({...row}));let issues=[...result.issues];
  rows.forEach((row,index)=>{
    for(const key of KEYS) {
      // Repeated OCR passes can share the same digit error. Never vote away a
      // readable amount or cheque number; retain both readings for human review.
      if(['debit','credit','balance','cheque_no'].includes(key))continue;
      const groups=new Map();
      for(const reading of row.readings?.[key]||[]) {
        const value=String(reading.value??'');
        // Invalid and empty readings never win a vote. Amounts and dates are
        // already normalized by extraction, not inferred from a target balance.
        if(!value||key==='date'&&!parseDate(value)||['debit','credit','balance'].includes(key)&&parseAmount(value)===null)continue;
        const group=groups.get(value)||new Set();group.add(reading.source);groups.set(value,group);
      }
      const ranked=[...groups].sort((a,b)=>b[1].size-a[1].size),best=ranked[0];
      if(!best||best[1].size<2||ranked[1]&&ranked[1][1].size===best[1].size||best[0]===String(row[key]))continue;
      // Table borders and stamp fragments can agree across OCR passes too.
      // Newly introduced symbol-only runs need a human choice, not a vote.
      if(key==='description'&&/(?:^|\s)[~|={}]{2,}(?:\s|$)/.test(best[0])&&!/(?:^|\s)[~|={}]{2,}(?:\s|$)/.test(String(row[key])))continue;
      const before=row[key];row[key]=best[0];if(key==='date')row.date_normalized=true;
      issues=issues.filter(issue=>!(issue.row_index===index&&issue.suggestion?.key===key&&issue.suggestion.value===best[0]));
      issues.push({row_index:index,fields:[key],message:`Page ${row.page}: independent readings agree on ${key} "${best[0]}"; used this instead of "${before}". Verify against the PDF.`});
    }
  });
  issues=issues.filter(issue=>!issue.suggestion||String(rows[issue.row_index]?.[issue.suggestion.key])!==String(issue.suggestion.value));
  return {...result,rows,issues};
}

// These are review warnings, not repairs. The normal server-side checker still
// applies dates, interest, tax and profile rules after importing the workbook.
export function reviewRows(rows,labels={},dateOrder='dmy') {
  const issues=[],money=value=>{const parsed=parseAmount(value);return parsed===null?null:Math.round(Number(parsed)*100);};
  const normalize=text=>String(text||'').trim().replace(/\s+/g,' ');
  const pattern=label=>new RegExp(`(?<![\\p{L}\\p{N}_])${normalize(label).replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}(?![\\p{L}\\p{N}_])`,'gu');
  const contains=(text,label)=>Boolean(normalize(label))&&pattern(label).test(normalize(text));
  rows.forEach((row,index)=>{
    const warn=(fields,message)=>issues.push({row_index:index,fields,message});
    const debit=money(row.debit),credit=money(row.credit),balance=money(row.balance),previous=index?rows[index-1]:null;
    if(debit>0&&credit>0)warn(['debit','credit'],'Both debit and credit contain an amount. Verify the column positions.');
    if(previous&&[debit,credit,balance,money(previous.balance)].every(v=>v!==null)&&balance!==money(previous.balance)+credit-debit)warn(['debit','credit','balance'],'Running balance does not match the previous balance + credit − debit. Check for a missed row, digit or misplaced amount.');
    if(previous&&rowDate(row,dateOrder)&&rowDate(previous,dateOrder)&&rowDate(row,dateOrder)<rowDate(previous,dateOrder))warn(['date'],'This date is before the preceding row. Check the scan and selected date order.');
    if(!(debit>0||credit>0))return;
    const description=normalize(row.description);
    const interest=normalize(labels.interest_text),tax=normalize(labels.tax_text);
    const special=[interest,tax].filter(Boolean).find(label=>description.trim().toLowerCase()===label.toLowerCase());
    if(special) {
      if(description.trim()!==special)warn(['description'],`Description must match "${special}" exactly, including upper/lower case.`);
      if(special===interest&&!(credit>0)||special===tax&&!(debit>0))warn(['description','debit','credit'],'Interest belongs in credit and tax belongs in debit. Check the description and column.');
      return;
    }
    const expected=credit>0?labels.deposit_text:labels.withdrawal_text,opposite=credit>0?labels.withdrawal_text:labels.deposit_text;
    if(expected&&!contains(description,expected))warn(['description'],`Expected ${credit>0?'deposit':'withdrawal'} text "${expected}" (case-sensitive). Names can differ.`);
    const remaining=expected?description.replace(pattern(expected),' '):description;
    if(opposite&&opposite!==expected&&contains(remaining,opposite))warn(['description',credit>0?'credit':'debit'],`The description contains ${credit>0?'withdrawal':'deposit'} text on the wrong amount side.`);
  });
  return issues;
}

export function mergePages(pages) {
  const rows=[],issues=[];
  for(const page of pages) {
    let incoming=page.rows.map(row=>({...row}));
    let skipped=0;
    const previous=rows.at(-1), first=incoming[0];
    // Remove only an explicit carried balance at a page boundary; repeated transactions stay.
    const noMovement=row=>parseAmount(row.debit)===''||Number(row.debit)===0;
    const isCarry=row=>row && carryText.test(row.description) && noMovement(row) && (parseAmount(row.credit)===''||Number(row.credit)===0);
    if(previous && first && previous.date===first.date && String(previous.balance)===String(first.balance) && isCarry(first)) {
      if(isCarry(previous)) {
        const removed=rows.length-1;rows.pop();
        for(let i=issues.length-1;i>=0;i--)if(issues[i].row_index===removed)issues.splice(i,1);
      }
      incoming.shift();skipped=1;
    }
    const offset=rows.length;
    for(const issue of page.issues)if(issue.row_index==null||issue.row_index>=skipped)issues.push({...issue,row_index:issue.row_index==null?null:offset+issue.row_index-skipped});
    rows.push(...incoming);
  }
  return {rows,issues};
}

export function validateRows(rows,dateOrder='dmy') {
  const issues=[];
  if(!rows.length)return [{row_index:null,fields:[],message:'No statement rows were found.'}];
  rows.forEach((row,index)=>{
    if(!rowDate(row,dateOrder))issues.push({row_index:index,fields:['date'],message:'Enter a valid transaction date.'});
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
  const grid=[keys.map(key=>labels[key]),...rows.map(row=>keys.map(key=>key==='date'?rowDate(row,dateOrder):['debit','credit','balance'].includes(key)?parseAmount(row[key]):row[key]))];
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
