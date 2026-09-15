const assert = require('node:assert/strict');
const { readFileSync, existsSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const base = path.resolve(__dirname, '..');
const roots = [base, path.join(base, 'Statement Generator PHP'), path.join(base, 'Web Statement Generator Python')]
  .filter((root) => existsSync(path.join(root, 'assets/app.js')) || existsSync(path.join(root, 'static/app.js')));

function fixture(root) {
  const source = readFileSync(path.join(root, existsSync(path.join(root, 'assets/app.js')) ? 'assets/app.js' : 'static/app.js'), 'utf8');
  const elements = new Map();
  function element(id) {
    if (!elements.has(id)) elements.set(id, { value: '', textContent: '', hidden: false, classList: { toggle() {} } });
    return elements.get(id);
  }
  const inputs = [1000, 500, 100, 50, 10, 5].map((step) => {
    let raw = '';
    return { dataset: { roundingStep: String(step) },
      get value() { return raw; }, set value(value) { raw = String(value); },
      setCustomValidity(message) { this.error = message; } };
  });
  const ctx = { document: { getElementById: element, querySelectorAll: () => inputs } };
  vm.createContext(ctx);
  vm.runInContext(source.match(/^const roundingDefaults = .*;$/m)[0], ctx);
  for (const name of ['loadRoundingPercentages', 'updateRoundingPercentagesValue', 'updateRoundingState']) {
    const match = source.match(new RegExp(`^function ${name}\\([^]*?(?=^function |$(?![^]))`, 'm'));
    assert.ok(match, `Missing ${name}`);
    vm.runInContext(match[0], ctx);
  }
  element('amount-rounding-mode').value = 'automatic';
  return { ctx, inputs, element };
}

for (const root of roots) {
  const label = path.basename(root);
  test(`${label}: automatic and custom controls describe one combined transaction quota`, () => {
    const { ctx, inputs, element } = fixture(root);
    ctx.loadRoundingPercentages();
    assert.equal(element('rounding-custom-panel').hidden, true);
    assert.match(element('rounding-rule-summary').textContent, /70%.*20%.*10%.*combined/);
    element('amount-rounding-mode').value = 'custom';
    ctx.updateRoundingState();
    assert.equal(element('rounding-custom-panel').hidden, false);
    assert.equal(element('rounding-percentage-total').textContent, 'Total: 100%');
    assert.ok(inputs.every((input) => input.error === ''));
  });

  test(`${label}: custom percentages round-trip and old profiles restore defaults`, () => {
    const { ctx, element } = fixture(root);
    element('amount-rounding-mode').value = 'custom';
    const mix = { 1000: 33.33, 500: 33.33, 100: 0, 50: 0, 10: 0, 5: 33.34 };
    ctx.loadRoundingPercentages(JSON.stringify(mix));
    let stored = JSON.parse(element('amount-rounding-percentages').value);
    assert.deepEqual(Object.fromEntries(Object.entries(stored).map(([key, value]) => [key, Number(value)])), mix);
    assert.equal(ctx.updateRoundingPercentagesValue(), true);
    ctx.loadRoundingPercentages();
    stored = JSON.parse(element('amount-rounding-percentages').value);
    assert.equal(Number(stored['1000']), 35);
    assert.equal(Number(stored['5']), 10);
  });

  test(`${label}: invalid percentages block custom mode and clear when automatic is selected`, () => {
    const { ctx, inputs, element } = fixture(root);
    element('amount-rounding-mode').value = 'custom';
    for (const invalid of ['', '-5', '105', 'NaN', '34']) {
      ctx.loadRoundingPercentages();
      inputs[0].value = invalid;
      assert.equal(ctx.updateRoundingPercentagesValue(), false);
      assert.ok(inputs.every((input) => input.error.length > 0));
    }
    element('amount-rounding-mode').value = 'automatic';
    ctx.updateRoundingState();
    assert.ok(inputs.every((input) => input.error === ''));
    assert.equal(element('rounding-custom-panel').hidden, true);
  });
}
