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
  function node() {
    return { value: '', disabled: false, children: [], listeners: {}, classList: { add() {} },
      set innerHTML(value) { this.html = value; this.children = []; },
      append(child) { this.children.push(child); }, addEventListener(name, fn) { this.listeners[name] = fn; } };
  }
  function element(id) { if (!elements.has(id)) elements.set(id, node()); return elements.get(id); }
  const ctx = {
    state: { selectedHoliday: null, holidayView: 'All', currentStatement: { rows: [] }, editableRows: [], statementEditMode: false },
    document: { getElementById: element, createElement: node }, holidayBody: node(), holidaySummary: node(),
    getFormValues: () => ({ start_date: '2026-01-01', end_date: '2026-12-31' }),
    escapeHtml: String, apiUrl: (action) => action, requests: [], passwords: 0, closed: 0, previews: 0,
    requestPassword: async () => { ctx.passwords++; return 'test-password'; },
    fetchJson: async (url, options) => { ctx.requests.push({ url, payload: JSON.parse(options.body) }); return ctx.response; },
    closeInlinePrintPreview: () => { ctx.closed++; }, renderValidationResults: (errors) => { ctx.errors = errors; },
    loadTemplateDetail: async () => ({}), buildGeneratedFormatPreviewHtml: () => '<html></html>',
    buildPrintHtml: (html) => html, renderInlinePrintPreview: () => { ctx.previews++; }, appendLog() {},
  };
  element('holiday-type').value = 'Holiday';
  vm.createContext(ctx);
  for (const name of ['renderHolidayPayload', 'handleHolidayAction', 'currentPreviewRows', 'ensureWorkingTransactionDates', 'showGeneratedFormatPreview']) {
    const match = source.match(new RegExp(`^(?:async )?function ${name}\\([^]*?(?=^(?:async )?function |$(?![^]))`, 'm'));
    assert.ok(match, `Missing ${name}`);
    vm.runInContext(match[0], ctx);
  }
  return { ctx, element, source };
}

const payload = (rows) => ({ rows, period: { start_date: '2026-01-01', end_date: '2026-12-31' }, counts: { holidays: 1, saturdays: 1, sundays: 1, showing: rows.length } });

for (const root of roots) {
  const label = path.basename(root);
  test(`${label}: recurring rows cannot be edited and stale selection is cleared`, async () => {
    const { ctx, element } = fixture(root);
    for (const type of ['Saturday', 'Sunday']) {
      const row = { date: '2026-09-12', type };
      ctx.state.selectedHoliday = row;
      ctx.renderHolidayPayload(payload([row]));
      assert.equal(element('holiday-update-btn').disabled, true);
      assert.equal(element('holiday-delete-btn').disabled, true);
      await assert.rejects(ctx.handleHolidayAction('delete'), /Recurring/);
      await assert.rejects(ctx.handleHolidayAction('update'), /Recurring/);
    }
    assert.equal(ctx.passwords, 0);
    assert.equal(ctx.requests.length, 0);
    ctx.state.selectedHoliday = { date: '2026-09-08', type: 'Holiday' };
    ctx.renderHolidayPayload(payload([]));
    assert.equal(ctx.state.selectedHoliday, null);
    assert.equal(element('holiday-delete-btn').disabled, true);
  });

  test(`${label}: manual add, modify, delete preserve API payload and selection`, async () => {
    const { ctx, element } = fixture(root);
    element('holiday-date').value = '2026-09-08';
    ctx.response = payload([{ date: '2026-09-08', type: 'Holiday' }]);
    await ctx.handleHolidayAction('add');
    assert.equal(ctx.requests[0].payload.type, 'Holiday');
    assert.equal(ctx.state.selectedHoliday.date, '2026-09-08');
    assert.equal(element('holiday-update-btn').disabled, false);
    element('holiday-date').value = '2026-09-09';
    ctx.response = payload([{ date: '2026-09-09', type: 'Holiday' }]);
    await ctx.handleHolidayAction('update');
    assert.equal(ctx.requests[1].payload.original_date, '2026-09-08');
    assert.equal(ctx.state.selectedHoliday.date, '2026-09-09');
    ctx.response = payload([]);
    await ctx.handleHolidayAction('delete');
    assert.equal(ctx.requests[2].payload.date, '2026-09-09');
    assert.equal(ctx.state.selectedHoliday, null);
    assert.equal(ctx.closed, 3);
    assert.equal(element('holiday-delete-btn').disabled, true);
  });

  test(`${label}: empty holiday date does not prompt for a password`, async () => {
    const { ctx } = fixture(root);
    await assert.rejects(ctx.handleHolidayAction('add'), /Choose a holiday date/);
    assert.equal(ctx.passwords, 0);
  });

  test(`${label}: local print validates unsaved rows and stops on blocked dates`, async () => {
    const { ctx } = fixture(root);
    ctx.state.statementEditMode = true;
    ctx.state.editableRows = [{ date: '2026-09-12', credit: 100, category: 'deposit' }];
    ctx.response = { errors: [{ row_index: 0, fields: ['date'], message: 'Blocked date' }] };
    await assert.rejects(ctx.showGeneratedFormatPreview(), /Correct the blocked transaction dates/);
    assert.equal(ctx.requests[0].url, 'validate_statement');
    assert.equal(ctx.requests[0].payload.dates_only, true);
    assert.equal(ctx.requests[0].payload.edited_rows[0].date, '2026-09-12');
    assert.equal(ctx.previews, 0);
    assert.equal(ctx.errors.length, 1);
    ctx.response = { errors: [] };
    await ctx.showGeneratedFormatPreview();
    assert.equal(ctx.previews, 1);
  });

  test(`${label}: removed holiday sync and Saturday restore controls have no bindings`, () => {
    const { source } = fixture(root);
    const page = readFileSync(path.join(root, existsSync(path.join(root, 'index.php')) ? 'index.php' : 'templates/index.html'), 'utf8');
    for (const removed of ['holiday-sync-btn', 'holiday-restore-btn', 'syncHolidayDatesFromHamroPatro', 'holidays_sync']) {
      assert.equal(source.includes(removed), false);
      assert.equal(page.includes(removed), false);
    }
    assert.match(page, /id="holiday-type" value="Holiday"/);
  });
}
