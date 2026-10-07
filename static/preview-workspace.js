// Shared preview actions for generated and imported statements.
export function canGenerateStatements(user) {
  return Boolean(user && user.can_use_statements !== false && user.can_generate_statements !== false && user.access_mode !== 'check_only');
}

export function previewActionState(state) {
  const hasRows = Boolean(state.currentStatement?.rows?.length);
  const allowed = state.currentUser?.access_mode !== 'check_only' ||
    (state.currentStatementSource === 'imported' && Number(state.currentStatementId) > 0);
  return { hasRows, canExport: hasRows && allowed && !state.statementEditMode };
}

export function setupStatementPreview(h) {
  const $ = id => document.getElementById(id);
  const panel = document.querySelector('.preview-panel');
  document.querySelector('.controls-column').id = 'statement-setup-column';
  const tools = document.createElement('div');
  tools.className = 'statement-preview-tools';
  tools.innerHTML = `<div class="statement-output-actions" role="group" aria-label="Statement export and print">
    <button type="button" class="ghost-button" data-output="excel">Export as Excel</button>
    <button type="button" class="ghost-button" data-output="word">Export as Word</button>
    <button type="button" class="ghost-button" data-output="preview">Print preview</button>
    <button type="button" class="primary-button" data-output="print">Print</button>
    <button type="button" class="ghost-button" id="statement-view-toggle" aria-controls="statement-setup-column" aria-expanded="true">Full-width view</button>
  </div><div class="statement-format-actions">
    <label class="field"><span>Statement format for export / print</span><select id="preview-statement-format"><option value="">Normal statement</option></select></label>
    <button type="button" class="ghost-button" data-output="format">Export selected format</button>
    <label class="check-field"><input type="checkbox" id="preview-with-letterhead"> Include saved letterhead</label>
  </div><p id="preview-output-note" class="muted" role="status"></p>`;
  panel.querySelector('.preview-head').after(tools);
  const source = $('statement-template-list'), select = $('preview-statement-format');
  let selected = '', expanded = false, busy = false;
  function syncFormats() {
    const value = selected;
    select.replaceChildren(new Option('Normal statement', ''), ...[...source.options].map(o => new Option(o.textContent, o.value)));
    select.value = [...select.options].some(o => o.value === value) ? value : '';
    selected = select.value;
  }
  new MutationObserver(syncFormats).observe(source, {childList:true, subtree:true});
  source.addEventListener('change', () => {selected = source.value;syncFormats();});
  select.onchange = () => {selected = select.value;if(selected){source.value = selected;source.dispatchEvent(new Event('change', {bubbles:true}));}};
  syncFormats();
  const letterhead = $('export-with-letterhead');
  $('preview-with-letterhead').onchange = () => {letterhead.checked = $('preview-with-letterhead').checked;};
  letterhead.addEventListener('change', () => {$('preview-with-letterhead').checked = letterhead.checked;});
  function setExpanded(value, focus = false) {
    expanded = Boolean(value);
    document.body.classList.toggle('statement-expanded', expanded);
    const button = $('statement-view-toggle');
    button.textContent = expanded ? 'Show setup panel' : 'Full-width view';
    button.setAttribute('aria-expanded', String(!expanded));
    if(focus) button.focus();
  }
  $('statement-view-toggle').onclick = () => {setExpanded(!expanded);panel.scrollIntoView({block:'start'});};
  document.addEventListener('keydown', event => {if(event.key === 'Escape' && expanded){setExpanded(false, true);}});
  function refresh() {
    const {hasRows, canExport} = previewActionState(h.state);
    tools.querySelectorAll('[data-output]').forEach(button => button.disabled = busy || !canExport);
    $('preview-output-note').textContent = !hasRows ? 'Import, generate or load a statement to export or print it.' :
      h.state.statementEditMode ? 'Save your changes with Update & Recalculate before exporting or printing.' :
      !canExport ? 'Checker-only access can export imported statements. Import the statement to continue.' :
      'Excel and Word export the displayed statement. Choose a saved format for formatted export or A4 printing. Press Esc to leave full-width view.';
  }
  tools.addEventListener('click', async event => {
    const button = event.target.closest('[data-output]');
    if(!button || busy || !previewActionState(h.state).canExport) return;
    busy = true;h.pending(1);refresh();
    try {
      const action = button.dataset.output;
      if(action === 'preview' || action === 'print') await h.printStatement(select.value, action === 'print');
      else await h.exportStatement(action, action === 'format' ? select.value : '');
    } catch(error) {h.log(error.message, 'error');$('preview-output-note').textContent = error.message;}
    finally {busy = false;h.pending(-1);tools.querySelectorAll('[data-output]').forEach(b => b.disabled = !previewActionState(h.state).canExport);}
  });
  refresh();
  return {refresh, setExpanded};
}
