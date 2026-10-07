const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {test} = require('node:test');
const root = path.resolve(__dirname, '..');
const assets = fs.existsSync(path.join(root, 'assets')) ? 'assets' : 'static';
const code = fs.readFileSync(path.join(root, assets, 'preview-workspace.js'), 'utf8');
const api = vm.createContext({});
vm.runInContext(code.replaceAll('export ', ''), api);
test('checker-only generation is unavailable regardless of role or stale capability flags', () => {
  for (const role of ['user', 'admin', 'super_admin']) {
    assert.equal(api.canGenerateStatements({role, access_mode:'check_only', can_generate_statements:true}), false);
    assert.equal(api.canGenerateStatements({role, access_mode:'unlimited'}), true);
  }
  assert.equal(api.canGenerateStatements(null), false);
  assert.equal(api.canGenerateStatements({access_mode:'unlimited', can_use_statements:false}), false);
});
test('exports use a saved imported statement for checker users and require edits to be saved', () => {
  const state = {currentUser:{access_mode:'check_only'}, currentStatement:{rows:[{}]}, currentStatementSource:'imported',currentStatementId:123};
  assert.equal(api.previewActionState(state).canExport, true);
  for(const change of [{currentStatement:null},{currentStatementId:null},{currentStatementSource:'generated'},{statementEditMode:true}]) {
    assert.equal(api.previewActionState({...state,...change}).canExport, false);
  }
  assert.equal(api.previewActionState({...state,currentUser:{access_mode:'unlimited'},currentStatementSource:'generated'}).canExport,true);
});
