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
  const precision = { name: 'interest_rounding_places', value: '2' };
  const rate = { name: 'interest_rate', value: '8', dispatchEvent() {} };
  const requests = [];
  const ctx = vm.createContext({
    workspaceUI: null,
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

test('daily interest field is fixed and profile restoration sends two places', () => {
  assert.ok(/<input[^>]*type="hidden"[^>]*name="interest_rounding_places"[^>]*value="2"/.test(html),
            'The fixed daily rounding field submits a hidden two-place value.');
  assert.doesNotMatch(html, /<select[^>]*name="interest_rounding_places"/);
  const { ctx, precision } = fixture();
  for (const values of [{ interest_rounding_places: '2' }, {},
                        { interest_rounding_places: '4' }, { interest_rounding_places: 4 }]) {
    ctx.applyFormValues(values);
    assert.equal(precision.value, '2');
    assert.equal(ctx.getFormValues().interest_rounding_places, '2');
  }
});

test('generation and checking normalize historical precision to two places', async () => {
  const { ctx, requests } = fixture();
  for (const places of ['2', '4']) {
    ctx.applyFormValues({ interest_rounding_places: places });
    await ctx.generateStatement();
    assert.equal(requests.at(-1).action, 'generate');
    assert.equal(requests.at(-1).body.interest_rounding_places, '2');
    await ctx.validateCurrentStatement();
    assert.equal(requests.at(-1).action, 'validate_statement');
    assert.equal(requests.at(-1).body.config.interest_rounding_places, '2');
    assert.equal(requests.at(-1).body.source_type, 'imported');
  }
});

test('import recheck explains the fixed half up rule and sends two places', async () => {
  const { ctx, requests } = fixture();
  ctx.applyFormValues({ interest_rounding_places: '4' });
  await ctx.requestImportedInterestRateAndRecheck();
  assert.match(ctx.promptMessage, /2 decimal places.*Half Up/);
  assert.match(ctx.promptMessage, /Balance.*Days.*Rate.*36500/);
  assert.match(ctx.promptMessage, /round once/);
  assert.match(ctx.promptMessage, /third digit.*5/);
  assert.doesNotMatch(ctx.promptMessage, /Round Up|switch precision|4 decimal/);
  assert.equal(requests.at(-1).body.config.interest_rounding_places, '2');
  assert.equal(requests.at(-1).body.config.interest_rate, '7');
});
