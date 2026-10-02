const assert = require('node:assert/strict');
const { readFileSync, existsSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const base = path.resolve(__dirname, '..');
const roots = [base, path.join(base, 'Statement Generator PHP'), path.join(base, 'Web Statement Generator Python')]
  .filter(root => existsSync(path.join(root, 'assets/app.js')) || existsSync(path.join(root, 'static/app.js')));

function fixture(root) {
  const source = readFileSync(path.join(root, existsSync(path.join(root, 'assets/app.js')) ? 'assets/app.js' : 'static/app.js'), 'utf8');
  const elements = new Map();
  function element(id) {
    if (!elements.has(id)) {
      let value = '';
      elements.set(id, { get value() { return value; }, set value(raw) { value = String(raw); },
        textContent: '', hidden: false, disabled: false, classList: { toggle() {} },
        setCustomValidity(message) { this.error = message; } });
    }
    return elements.get(id);
  }
  const ctx = { document: { getElementById: element, querySelectorAll: selector => [element(selector)] } };
  vm.createContext(ctx);
  for (const name of ['loadTransactionRunRules', 'updateTransactionRunState', 'renderTransactionRunSummary']) {
    const match = source.match(new RegExp(`^function ${name}\\([^]*?(?=^function |$(?![^]))`, 'm'));
    assert.ok(match, `Missing ${name}`);
    vm.runInContext(match[0], ctx);
  }
  return { ctx, element };
}

for (const root of roots) {
  const label = path.basename(root);
  test(`${label}: manual groups and percentages restore; legacy profiles return to automatic`, () => {
    const { ctx, element } = fixture(root);
    ctx.loadTransactionRunRules({ debit_run_mode: 'count', debit_run_2: '3', debit_run_3: '2',
      credit_run_mode: 'percentage', credit_run_2: '20', credit_run_3: '30', credit_run_4: '40' });
    assert.equal(element('debit-run-fields').hidden, false);
    assert.equal(element('credit-run-fields').hidden, false);
    assert.equal(element('debit-run-3').value, '2');
    assert.equal(element('credit-run-4').value, '40');
    assert.equal(element('debit-run-2').step, '1');
    assert.equal(element('credit-run-2').step, 'any');
    assert.match(element('credit-run-summary').textContent, /90%/);
    assert.equal(ctx.updateTransactionRunState(), true);
    ctx.loadTransactionRunRules({});
    assert.equal(element('debit-run-mode').value, 'automatic');
    assert.equal(element('credit-run-fields').hidden, true);
    assert.equal(element('credit-run-4').disabled, true);
    assert.equal(element('credit-run-4').value, '0');
  });

  test(`${label}: invalid numbers and percentage totals are blocked, automatic clears errors`, () => {
    const { ctx, element } = fixture(root);
    for (const value of ['-1', '1.5', '2001', '', 'NaN']) {
      ctx.loadTransactionRunRules({ debit_run_mode: 'count', debit_run_2: value });
      assert.equal(ctx.updateTransactionRunState(), false);
      assert.ok(element('debit-run-2').error);
    }
    ctx.loadTransactionRunRules({ credit_run_mode: 'percentage', credit_run_2: '60', credit_run_4: '41' });
    assert.equal(ctx.updateTransactionRunState(), false);
    element('credit-run-mode').value = 'automatic';
    assert.equal(ctx.updateTransactionRunState(), true);
    assert.equal(element('credit-run-4').error, '');
    ctx.loadTransactionRunRules({ credit_run_mode: 'percentage', credit_run_2: '20.5', credit_run_4: '30.5' });
    assert.equal(ctx.updateTransactionRunState(), true);
  });

  test(`${label}: result summary counts actual customer groups and excludes system rows`, () => {
    const { ctx, element } = fixture(root);
    const rows = [
      { category: 'withdrawal' }, { category: 'withdrawal' },
      { category: 'interest', is_system: true }, { category: 'tax', is_system: true },
      { category: 'withdrawal' }, ...Array.from({ length: 4 }, () => ({ category: 'deposit' })),
      { category: 'withdrawal' }, { category: 'deposit' },
    ];
    ctx.renderTransactionRunSummary(rows);
    assert.equal(element('summary-transaction-runs').textContent,
      'Debit: 1 singles, 1 groups of 3 | Credit: 1 singles, 1 groups of 4. Customer transactions only.');
    ctx.renderTransactionRunSummary([]);
    assert.equal(element('summary-transaction-runs').textContent, '');
  });
}
