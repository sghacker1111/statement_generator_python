/* Selection is separate from document content and never replaces imported markup. */
export function cellBounds(node) {
  const row=Number(node?.dataset?.row), col=Number(node?.dataset?.col);
  return row>0 && col>0 ? {top:row,left:col,bottom:row+Math.max(1,Number(node.rowSpan)||1)-1,right:col+Math.max(1,Number(node.colSpan)||1)-1} : null;
}
export function rangeCellKeys(nodes, from, to) {
  const a=cellBounds(from),b=cellBounds(to);if(!a||!b)return [];
  const box={top:Math.min(a.top,b.top),left:Math.min(a.left,b.left),bottom:Math.max(a.bottom,b.bottom),right:Math.max(a.right,b.right)};
  let changed;
  do { changed=false;for(const node of nodes){const p=cellBounds(node);if(!p||p.bottom<box.top||p.top>box.bottom||p.right<box.left||p.left>box.right)continue;
    for(const side of ['top','left','bottom','right']){const v=(side==='top'||side==='left'?Math.min:Math.max)(box[side],p[side]);if(v!==box[side]){box[side]=v;changed=true;}}
  }}while(changed);
  return nodes.filter(n=>{const p=cellBounds(n);return p&&p.bottom>=box.top&&p.top<=box.bottom&&p.right>=box.left&&p.left<=box.right;}).map(n=>n.dataset.formatKey);
}
export function createOfficeSelection({host,state,selectItem,selectRange,toggleItem,refreshSelection,pushUndo,status}) {
  let mode='auto',drag=null,saved=null;
  const cells=()=>[...host.querySelectorAll('[data-format-key]')];
  const cellFor=target=>{const n=target?.closest?.('[data-format-key]');return n&&host.contains(n)?n:null;};
  const cellMode=()=>mode==='cells'||(mode==='auto'&&state.templateEditorDetail?.kind==='statement');
  const tools=document.createElement('div');tools.className='office-selection-tools';
  tools.innerHTML='<label>Selection <select aria-label="Editor selection mode"><option value="auto">Automatic</option><option value="cells">Cells / blocks</option><option value="text">Words / text</option></select></label><label>Cell range <input aria-label="Select cell range" placeholder="A1:D8" size="12"></label><button type="button" data-select-range>Select range</button><button type="button" data-select-all>Select all</button><span class="muted">Drag to select cells; Shift-click extends, Ctrl/Cmd-click adds cells. Double-click or F2 edits cell text. Choose Words / text to select words.</span>';
  host.before(tools);host.tabIndex=0;
  const choice=tools.querySelector('select');choice.onchange=()=>{mode=choice.value;saved=null;state.formatInlineRange=null;host.dataset.selectionMode=cellMode()?'cells':'text';};
  const setKeys=keys=>{if(!keys.length)return;state.formatWorkspaceSelectedKeys=keys;state.formatWorkspaceSelectedKey=keys[0];state.formatWorkspaceRangeRequest=null;state.formatWorkspaceMergeRequest=null;state.formatInlineRange=null;saved=null;selectItem(keys[0],cells().find(n=>n.dataset.formatKey===keys[0]),{keepRange:true});refreshSelection();};
  const all=()=>setKeys(cells().map(n=>n.dataset.formatKey));
  tools.querySelector('[data-select-all]').onclick=()=>{if(cellMode())all();else{const nodes=cells();if(!nodes.length)return;const r=document.createRange();r.setStartBefore(nodes[0]);r.setEndAfter(nodes.at(-1));const s=window.getSelection();s.removeAllRanges();s.addRange(r);remember();}};
  tools.querySelector('[data-select-range]').onclick=()=>{const value=tools.querySelector('input').value.trim().toUpperCase().replaceAll('$','');const m=/^([A-Z]+\d+)(?::([A-Z]+\d+))?$/.exec(value);if(!m){status('Enter a cell range such as A1:D8.','error');return;}
    const nodes=cells(),a=nodes.find(n=>n.dataset.address===m[1]),b=nodes.find(n=>n.dataset.address===(m[2]||m[1]));if(!a||!b){status('The range must be inside the displayed worksheet.','error');return;}mode='cells';choice.value=mode;setKeys(rangeCellKeys(nodes,a,b));};
  function remember() {
    const s=window.getSelection?.();if(!s||!s.rangeCount||s.isCollapsed)return;
    const r=s.getRangeAt(0);if(!host.contains(r.startContainer)||!host.contains(r.endContainer))return;
    saved=r.cloneRange();state.formatInlineRange=saved;
  }
  document.addEventListener('selectionchange',remember);
  host.addEventListener('pointerdown',event=>{
    const node=cellFor(event.target);if(!node||event.button!==0)return;
    if(!event.shiftKey){saved=null;state.formatInlineRange=null;}
    if(!cellMode()||node.dataset.textEditing==='true') {if(state.formatWorkspaceSelectedKey!==node.dataset.formatKey)selectItem(node.dataset.formatKey,node);return;}
    event.preventDefault();host.focus({preventScroll:true});window.getSelection?.()?.removeAllRanges();
    if(event.ctrlKey||event.metaKey){toggleItem(node.dataset.formatKey,node);drag=null;return;}
    if(event.shiftKey&&state.formatWorkspaceAnchorKey){selectRange(state.formatWorkspaceAnchorKey,node.dataset.formatKey);drag=null;return;}
    selectItem(node.dataset.formatKey,node);drag={start:node,last:node};
  },true);
  host.addEventListener('pointermove',event=>{if(!drag)return;const node=cellFor(event.target);if(!node||node===drag.last)return;drag.last=node;setKeys(rangeCellKeys(cells(),drag.start,node));node.scrollIntoView({block:'nearest',inline:'nearest'});event.preventDefault();});
  document.addEventListener('pointerup',()=>{drag=null;remember();});
  host.addEventListener('click',event=>{if(cellFor(event.target)){event.stopImmediatePropagation();remember();}},true);
  host.addEventListener('dblclick',event=>{const node=cellFor(event.target);if(node&&cellMode()){node.dataset.textEditing='true';node.focus();}},true);
  host.addEventListener('focusout',event=>{const node=cellFor(event.target);if(node)delete node.dataset.textEditing;});
  host.addEventListener('keydown',event=>{
    const node=cells().find(n=>n.dataset.formatKey===state.formatWorkspaceSelectedKey);
    if(event.key==='F2'&&node){event.preventDefault();node.dataset.textEditing='true';node.focus();return;}
    if(!cellMode()||node?.dataset.textEditing==='true')return;
    if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='a'){event.preventDefault();event.stopImmediatePropagation();all();return;}
    if(!node||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;
    const pos=cellBounds(drag?.last||node);if(!pos)return;
    const [dr,dc]={ArrowLeft:[0,-1],ArrowRight:[0,1],ArrowUp:[-1,0],ArrowDown:[1,0]}[event.key];
    const last=state.officeSelectionEnd?cells().find(n=>n.dataset.formatKey===state.officeSelectionEnd):node;
    const p=cellBounds(event.shiftKey?last:node)||pos;
    const nextRow=dr>0?p.bottom+dr:p.top+dr,nextCol=dc>0?p.right+dc:p.left+dc;
    const target=cells().find(n=>{const b=cellBounds(n);return b&&nextRow>=b.top&&nextRow<=b.bottom&&nextCol>=b.left&&nextCol<=b.right;});
    if(target){event.preventDefault();event.stopImmediatePropagation();if(event.shiftKey)selectRange(state.formatWorkspaceAnchorKey||node.dataset.formatKey,target.dataset.formatKey);else selectItem(target.dataset.formatKey,target);state.officeSelectionEnd=target.dataset.formatKey;target.scrollIntoView({block:'nearest',inline:'nearest'});}
  },true);
  function textRange(){remember();return saved&&host.contains(saved.commonAncestorContainer)&&!saved.collapsed?saved.cloneRange():null;}
  function applyTextStyle(style) {
    const range=textRange();if(!range)return false;
    const walker=document.createTreeWalker(host,NodeFilter.SHOW_TEXT),parts=[];let text;
    while((text=walker.nextNode())){if(!range.intersectsNode(text)||!cellFor(text.parentElement)||text.parentElement.closest('.word-block-label'))continue;const start=text===range.startContainer?range.startOffset:0,end=text===range.endContainer?range.endOffset:text.length;if(end>start)parts.push({text,start,end});}
    if(!parts.length)return false;
    pushUndo('Format selected text');const wrappers=[];
    for(const part of parts.reverse()){const selected=part.start?part.text.splitText(part.start):part.text;if(part.end-part.start<selected.length)selected.splitText(part.end-part.start);const span=document.createElement('span');span.dataset.formatInline='true';Object.assign(span.style,style);selected.parentNode.insertBefore(span,selected);span.append(selected);wrappers.unshift(span);}
    const r=document.createRange();r.setStart(wrappers[0].firstChild,0);r.setEnd(wrappers.at(-1).firstChild,wrappers.at(-1).firstChild.length);const selection=window.getSelection();selection.removeAllRanges();selection.addRange(r);saved=r.cloneRange();state.formatInlineRange=saved;return true;
  }
  return {applyTextStyle,remember,reset(){saved=null;drag=null;state.formatInlineRange=null;state.officeSelectionEnd=null;host.dataset.selectionMode=cellMode()?'cells':'text';}};
}
