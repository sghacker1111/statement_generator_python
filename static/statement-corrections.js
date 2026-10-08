// Explicit, reviewable text corrections. Financial values never come from a profile.
const normalize=value=>String(value||'').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
function distance(a,b) {
  let previous=Array.from({length:b.length+1},(_,i)=>i);
  for(let i=1;i<=a.length;i++) {
    const current=[i];
    for(let j=1;j<=b.length;j++)current[j]=Math.min(current[j-1]+1,previous[j]+1,previous[j-1]+(a[i-1]===b[j-1]?0:1));
    previous=current;
  }
  return previous[b.length];
}
function labelRange(text,label) {
  const words=[...text.matchAll(/\S+/g)],count=String(label).trim().split(/\s+/).length,target=normalize(label);
  if(!target)return null;
  const candidates=[];
  for(let i=0;i+count<=words.length;i++) {
    const start=words[i].index,end=words[i+count-1].index+words[i+count-1][0].length;
    const actual=normalize(text.slice(start,end)),score=distance(actual,target);
    if(score<=Math.min(2,Math.floor(target.length*.18)))candidates.push({start,end,score});
  }
  candidates.sort((a,b)=>a.score-b.score);
  return candidates.length&&(!candidates[1]||candidates[0].score<candidates[1].score)?candidates[0]:null;
}
export function descriptionCorrections(rows,values={}) {
  const proposals=[];
  rows.forEach((row,index)=>{
    const before=String(row.description||''),debit=Number(row.debit||0),credit=Number(row.credit||0);
    let expected='',opposite='',whole=false;
    if(credit>0&&debit>0)return;
    const special=credit>0?values.interest_text:debit>0?values.tax_text:'';
    if(special&&distance(normalize(before),normalize(special))<=Math.min(2,Math.floor(normalize(special).length*.2))) {expected=special;whole=true;}
    else if(credit>0){expected=values.deposit_text;opposite=values.withdrawal_text;}
    else if(debit>0){expected=values.withdrawal_text;opposite=values.deposit_text;}
    else if(values.statement_check_mode==='profile') {
      if(index===0){expected=values.first_date_description;whole=true;}
      else if(index===rows.length-1){expected=values.last_date_description;whole=true;}
    }
    expected=String(expected||'').trim();if(!expected)return;
    const range=whole?{start:0,end:before.length}:labelRange(before,expected)||labelRange(before,opposite);
    if(!range)return; // Unknown wording or a missing label needs a human edit.
    const after=before.slice(0,range.start)+expected+before.slice(range.end);
    if(after!==before)proposals.push({index,before,after,source:JSON.stringify(row)});
  });
  return proposals;
}
export function applyDescriptionCorrections(rows,proposals) {
  const result=rows.map(row=>({...row}));
  for(const proposal of proposals) {
    if(!result[proposal.index]||JSON.stringify(result[proposal.index])!==proposal.source)throw new Error('The statement changed. Review corrections again before applying them.');
    result[proposal.index].description=proposal.after;
  }
  return result;
}

export function setupStatementCorrections(h) {
  const button=document.createElement('button');button.type='button';button.className='ghost-button';button.id='correct-statement-btn';button.textContent='Correct statement';
  document.querySelector('.preview-actions').append(button);
  const panel=document.createElement('section');panel.className='inset-panel statement-corrections';panel.hidden=true;
  const heading=document.createElement('h3');heading.textContent='Correct using checking details';
  const note=document.createElement('p'),list=document.createElement('div'),status=document.createElement('p');status.setAttribute('role','status');
  const actions=document.createElement('div');actions.className='workspace-shortcuts';
  const apply=document.createElement('button'),edit=document.createElement('button'),close=document.createElement('button');
  for(const b of [apply,edit,close]){b.type='button';b.className='ghost-button';}
  apply.textContent='Apply selected text corrections';edit.textContent='Edit other statement fields';close.textContent='Close corrections';
  actions.append(apply,edit,close);panel.append(heading,note,list,actions,status);document.querySelector('.preview-panel').append(panel);
  let proposals=[],snapshot=null,context='',busy=false,revision=0;
  const rows=()=>h.state.statementEditMode?h.state.editableRows:h.state.currentStatement?.rows||[];
  const currentContext=()=>JSON.stringify([rows(),h.getValues()]);
  function refresh(){button.disabled=busy||h.state.currentStatementSource!=='imported'||!rows().length;if(snapshot!==h.state.currentStatement)panel.hidden=true;}
  button.onclick=async()=>{
    if(button.disabled)return;busy=true;refresh();h.pending(1);
    const requestRevision=revision,statement=h.state.currentStatement,checkedRows=JSON.stringify(rows());
    try {
      await h.validateStatement(); // Show errors before offering any changes.
      if(requestRevision!==revision||statement!==h.state.currentStatement||checkedRows!==JSON.stringify(rows()))throw new Error('The statement changed. Review corrections again before applying them.');
      proposals=descriptionCorrections(rows(),h.getValues());snapshot=h.state.currentStatement;
      context=currentContext();
      const values=h.getValues();
      note.textContent=`Checking against ${values.statement_check_mode==='profile'?`saved profile "${values.check_profile_name}"`:'the current checking details'}. ${h.state.validationErrors.length} checker issue(s). Review each proposed description change. Names and extra text remain in place. Dates, cheque numbers and amounts require an edit against the original. Save with Update & Recalculate, then check again.`;
      list.replaceChildren();status.textContent='';
      for(const proposal of proposals) {
        const label=document.createElement('label');label.className='correction-choice';
        const check=document.createElement('input');check.type='checkbox';check.dataset.index=proposal.index;check.setAttribute('aria-label',`Apply description correction to row ${proposal.index+1}`);
        const text=document.createElement('span');text.textContent=`Row ${proposal.index+1}: ${proposal.before} → ${proposal.after}`;label.append(check,text);list.append(label);
      }
      if(!proposals.length)status.textContent='No unambiguous text corrections are available. Use Edit other statement fields, or review the PDF cells for unreadable amounts and dates.';
      apply.disabled=!proposals.length;panel.hidden=false;panel.scrollIntoView({block:'nearest'});
    } catch(error){h.log(error.message,'error');}
    finally{busy=false;h.pending(-1);refresh();}
  };
  apply.onclick=()=>{
    try {
      if(snapshot!==h.state.currentStatement||context!==currentContext())throw new Error('The statement or checking details changed. Review corrections again before applying them.');
      const selected=new Set([...list.querySelectorAll('input:checked')].map(input=>Number(input.dataset.index)));
      if(!selected.size){status.textContent='Select the corrections you want to apply.';return;}
      const corrected=applyDescriptionCorrections(rows(),proposals.filter(p=>selected.has(p.index)));
      h.beginCorrectionEdit();h.state.editableRows=corrected;h.renderStatement();
      status.textContent=`Applied ${selected.size} text correction(s) to the edit draft. Review and use Update & Recalculate to save, or Cancel Edit to discard.`;apply.disabled=true;
    } catch(error){status.textContent=error.message;}
  };
  edit.onclick=()=>{h.beginCorrectionEdit();h.renderStatement();document.querySelector('.preview-head').scrollIntoView({block:'start'});};
  close.onclick=()=>{panel.hidden=true;};
  refresh();return {refresh,reset(){revision++;panel.hidden=true;proposals=[];snapshot=null;context='';refresh();}};
}
