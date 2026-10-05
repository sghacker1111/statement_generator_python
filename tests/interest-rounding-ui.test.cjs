const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const root = path.resolve(__dirname, '..');
const php = fs.existsSync(path.join(root, 'assets/app.js'));
const source = fs.readFileSync(path.join(root, php ? 'assets/app.js' : 'static/app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, php ? 'index.php' : 'templates/index.html'), 'utf8');

function fixture() {
  const precision = { name: 'interest_rounding_places', value: '4' };
  const rate = { name: 'interest_rate', value: '8', dispatchEvent() {} };
  const requests = [];
  const ctx = vm.createContext({
    form: { elements: { interest_rounding_places: precision, interest_rate: rate }, querySelectorAll: () => [precision, rate] },
    state: { currentStatement: { rows: [{ date: '2025-04-18' }] }, currentStatementSource: 'imported' },
    document: { getElementById: () => ({ value: 'automatic' }) },
    updateRoundingPercentagesValue() {}, updateMonthlyTransactionCountsValue() {}, loadRoundingPercentages() {},
    loadTransactionRunRules() {}, updateManualRateState() {}, updateRowCountState() {}, updatePrependStatementState() {},
    updateTransactionCountState() {}, updatePreviewTableLayout() {}, updateTransactionRunState: () => true,
    apiUrl: action => action,
    fetchJson: async (action, options) => {
      requests.push({ action, body: JSON.parse(options.body) });
      return { summary: {}, errors: [], checked_rows: 1 };
    },
    setCurrentStatement() {}, renderHolidayPayload() {}, renderValidationResults() {}, appendLog() {},
    Event: class {}, requestModalValue: async (_title, message) => { ctx.promptMessage = message; return '7'; },
  });
  for (const name of ['getFormValues', 'applyFormValues', 'generateStatement', 'validateCurrentStatement', 'requestImportedInterestRateAndRecheck']) {
    const match = source.match(new RegExp(`^(?:async )?function ${name}\\([^]*?(?=^(?:async )?function |$(?![^]))`, 'm'));
    assert.ok(match, name);
    vm.runInContext(match[0], ctx);
  }
  return { ctx, precision, requests };
}

test('daily interest selector has two choices and legacy profiles reset to four places', () => {
  const select = html.match(/<select name="interest_rounding_places"[^]*?<\/select>/)[0];
  assert.deepEqual([...select.matchAll(/option value="(\d+)"/g)].map(match => match[1]), ['4', '2']);
  assert.match(select, /Round Up to 2 decimal places/);
  const { ctx, precision } = fixture();
  ctx.applyFormValues({ interest_rounding_places: '2' });
  assert.equal(ctx.getFormValues().interest_rounding_places, '2');
  ctx.applyFormValues({});
  assert.equal(precision.value, '4');
  ctx.applyFormValues({ interest_rounding_places: 2 });
  assert.equal(precision.value, '2');
});

test('generation and checking send the selected daily precision', async () => {
  const { ctx, requests } = fixture();
  for (const places of ['2', '4']) {
    ctx.applyFormValues({ interest_rounding_places: places });
    await ctx.generateStatement();
    assert.equal(requests.at(-1).action, 'generate');
    assert.equal(requests.at(-1).body.interest_rounding_places, places);
    await ctx.validateCurrentStatement();
    assert.equal(requests.at(-1).action, 'validate_statement');
    assert.equal(requests.at(-1).body.config.interest_rounding_places, places);
    assert.equal(requests.at(-1).body.source_type, 'imported');
  }
});

test('import recheck explains and keeps the selected daily precision', async () => {
  const { ctx, requests } = fixture();
  ctx.applyFormValues({ interest_rounding_places: '2' });
  await ctx.requestImportedInterestRateAndRecheck();
  assert.match(ctx.promptMessage, /Round Up to 2 decimal places/);
  assert.equal(requests.at(-1).body.config.interest_rounding_places, '2');
  assert.equal(requests.at(-1).body.config.interest_rate, '7');
});
