const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {test} = require('node:test');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, fs.existsSync(path.join(root,'assets/app.js')) ? 'assets/app.js' : 'static/app.js'), 'utf8');
function load(name, context) {
  const match = source.match(new RegExp(`^function ${name}\\([^]*?(?=^(?:async )?function |$(?![^]))`, 'm'));
  assert.ok(match, name);
  vm.runInContext(match[0],context);
}
test('focused Office text can be read without replacing its formatted content', () => {
  const node = {textContent:'Two  spaces',innerHTML:'<b>Two</b>  spaces',querySelector(){return null},contains(){return false}};
  const context = vm.createContext({OfficeWorkspace:{text:n=>n.textContent},selectedPrimaryFormatNode:()=>node,findFormatWorkspaceNode:()=>node,document:{activeElement:node},templateItemText:{value:''},state:{formatWorkspaceSelectedKey:'p:0'}});
  for (const name of ['selectedNodeText','workspaceTextForKey','syncWorkspaceText']) load(name,context);
  assert.equal(context.selectedNodeText(),'Two  spaces');
  assert.equal(context.workspaceTextForKey('p:0'),'Two  spaces');
  context.syncWorkspaceText('Two  spaces');
  assert.equal(node.innerHTML,'<b>Two</b>  spaces');
  assert.equal(context.templateItemText.value,'Two  spaces');
});
test('worksheet selection prevents cells from another sheet replacing the active sheet', () => {
  const detail={active_sheet:'Second',scan:{items:[{key:'First!A1',sheet:'First',row:1,col:1,text:'Wrong'},{key:'Second!A1',sheet:'Second',row:1,col:1,text:'Correct'}],summary:{sheets:[{name:'First',column_widths:{A:10}},{name:'Second',column_widths:{A:32}}]}}};
  const context=vm.createContext({templateEditorItems:d=>d.scan.items,templateEditorSummary:d=>d.scan.summary,buildFormatPositionContext:()=>({}),itemGridPosition:item=>({row:item.row,col:item.col})});
  load('buildFormatSheetModel',context);
  const result=context.buildFormatSheetModel(detail);
  assert.equal(result.sheetName,'Second');
  assert.equal(result.cellMap.get('1:1').item.text,'Correct');
  assert.equal(result.columnWidths.A,32);
});
