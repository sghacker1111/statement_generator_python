const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {JSDOM}=require('jsdom');
const root=path.resolve(__dirname,'..'),assets=fs.existsSync(path.join(root,'assets'))?'assets':'static';
const source=fs.readFileSync(path.join(root,assets,'office-selection.js'),'utf8');
function editor(kind='statement',html='<table><tr><td data-format-key="a" data-address="A1" data-row="1" data-col="1">Alpha beta</td><td data-format-key="b" data-address="B1" data-row="1" data-col="2">Second</td></tr><tr><td data-format-key="c" data-address="A2" data-row="2" data-col="1">Third</td><td data-format-key="d" data-address="B2" data-row="2" data-col="2">Fourth</td></tr></table>'){
  const dom=new JSDOM('<div id="host">'+html+'</div>'),{window}=dom,document=window.document,host=document.getElementById('host');
  window.HTMLElement.prototype.scrollIntoView=function(){};
  const state={templateEditorDetail:{kind},formatWorkspaceSelectedKeys:[]},messages=[];
  const ctx=vm.createContext({window,document,NodeFilter:window.NodeFilter});
  vm.runInContext(source.replaceAll('export ',''),ctx);
  const selectItem=(key,node,options={})=>{state.formatWorkspaceSelectedKey=key;if(!options.keepRange){state.formatWorkspaceSelectedKeys=[key];state.formatWorkspaceAnchorKey=key;}};
  const selectRange=(from,to)=>{state.formatWorkspaceSelectedKeys=ctx.rangeCellKeys([...host.querySelectorAll('[data-format-key]')],host.querySelector(`[data-format-key="${from}"]`),host.querySelector(`[data-format-key="${to}"]`));};
  const selection=ctx.createOfficeSelection({host,state,selectItem,selectRange,toggleItem:key=>{state.formatWorkspaceSelectedKeys=[...new Set([...state.formatWorkspaceSelectedKeys,key])];},refreshSelection(){},pushUndo(){},status:message=>messages.push(message)});
  selection.reset();
  const event=(target,type,options={})=>target.dispatchEvent(new window.MouseEvent(type,{bubbles:true,cancelable:true,button:0,...options}));
  return {dom,window,document,host,state,selection,event,ctx,messages};
}
test('drag selects a rectangle and the following click does not clear it',()=>{
  const e=editor(),a=e.host.querySelector('[data-format-key=a]'),d=e.host.querySelector('[data-format-key=d]');
  e.event(a,'pointerdown');e.event(d,'pointermove');e.event(d,'pointerup');e.event(d,'click');
  assert.deepEqual(Array.from(e.state.formatWorkspaceSelectedKeys),['a','b','c','d']);
  e.dom.window.close();
});
test('Shift-click, Ctrl-click, range field and select all keep multiple cells',()=>{
  const e=editor(),a=e.host.querySelector('[data-format-key=a]'),d=e.host.querySelector('[data-format-key=d]');
  e.event(a,'pointerdown');e.event(a,'pointerup');e.event(d,'pointerdown',{shiftKey:true});
  assert.equal(e.state.formatWorkspaceSelectedKeys.length,4);
  e.event(a,'pointerdown');e.event(d,'pointerdown',{ctrlKey:true});assert.deepEqual(Array.from(e.state.formatWorkspaceSelectedKeys),['a','d']);
  e.document.querySelector('.office-selection-tools input').value='A1:B2';e.document.querySelector('[data-select-range]').click();assert.equal(e.state.formatWorkspaceSelectedKeys.length,4);
  e.document.querySelector('[data-select-all]').click();assert.equal(e.state.formatWorkspaceSelectedKeys.length,4);
  e.dom.window.close();
});
test('ranges include merged cells that intersect the selected rectangle',()=>{
  const e=editor();const nodes=[{dataset:{row:'1',col:'1',formatKey:'merge'},rowSpan:2,colSpan:2},{dataset:{row:'2',col:'3',formatKey:'end'}}];
  assert.deepEqual(Array.from(e.ctx.rangeCellKeys(nodes,nodes[0],nodes[1])),['merge','end']);e.dom.window.close();
});
test('selected Excel words keep their range after toolbar focus and format only those words',()=>{
  const e=editor(),cell=e.host.querySelector('[data-format-key=a]'),text=cell.firstChild,r=e.document.createRange();
  r.setStart(text,6);r.setEnd(text,10);e.window.getSelection().addRange(r);e.selection.remember();
  e.window.getSelection().removeAllRanges();
  assert.equal(e.selection.applyTextStyle({fontWeight:'700',color:'#ff0000'}),true);
  assert.equal(cell.firstChild.nodeValue,'Alpha ');assert.equal(cell.querySelector('span').textContent,'beta');assert.equal(cell.querySelector('span').style.fontWeight,'700');assert.equal(cell.style.fontWeight,'');
  assert.equal(e.selection.applyTextStyle({fontStyle:'italic'}),true);assert.equal(cell.textContent,'Alpha beta');e.dom.window.close();
});
test('Word selection across paragraphs preserves paragraph layout and untouched text',()=>{
  const e=editor('certificate','<p data-format-key="p1" style="margin-left:36pt;text-indent:-18pt">First <b>words</b></p><p data-format-key="p2" style="text-align:right">Second words</p><p data-format-key="p3">Untouched</p>');
  const first=e.host.querySelector('[data-format-key=p1]'),second=e.host.querySelector('[data-format-key=p2]'),r=e.document.createRange();r.setStart(first.querySelector('b').firstChild,0);r.setEnd(second.firstChild,6);e.window.getSelection().addRange(r);
  assert.equal(e.selection.applyTextStyle({fontWeight:'400'}),true);
  assert.equal(first.style.textIndent,'-18pt');assert.equal(second.style.textAlign,'right');assert.equal(e.host.querySelector('[data-format-key=p3]').innerHTML,'Untouched');
  assert.equal(first.querySelector('span').style.fontWeight,'400');assert.equal(second.querySelector('span').textContent,'Second');e.dom.window.close();
});
test('saved rich runs keep normal text inside bold text, colours, and line breaks',()=>{
  const e=editor('certificate','<p data-format-key="p1" style="font-weight:700">Bold <span style="font-weight:400;color:rgb(255, 0, 0)">normal</span><br>after</p>');
  const app=fs.readFileSync(path.join(root,assets,'app.js'),'utf8');
  for(const name of ['formatColorToCss','normalizeVerticalAlign','collectInlineRunsFromNode']){
    const match=app.match(new RegExp('^function '+name+'\\([^]*?(?=^(?:async )?function )','m'));vm.runInContext(match[0],e.ctx);
  }
  const runs=e.ctx.collectInlineRunsFromNode(e.host.querySelector('p'));
  assert.equal(runs[0].bold,true);assert.equal(runs[1].bold,false);assert.equal(runs[1].font_color,'#ff0000');
  assert.equal(runs.map(r=>r.text).join(''),'Bold normal\nafter');e.dom.window.close();
});
