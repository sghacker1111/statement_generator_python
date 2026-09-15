/* Shared PHP/Python editor and A4 sample-document controls. */
export function createOfficeWorkspace({apiUrl,fetchJson,state,formatSheetHost,getFormValues,richRunsForKey,showFormatSaveStatus,refreshTemplates,loadTemplateDetail,appendLog,escapeHtml}) {
  const scriptRoot = new URL('.', import.meta.url);
  let letterheadRequest = 0;
  const text = node => (node?.querySelector('.word-edit-text') || node)?.innerText ?? node?.textContent ?? '';
  function scope() {
    const kind = document.getElementById('print-document-kind')?.value || 'statement';
    const custom = document.getElementById('print-format-mode')?.value === 'custom';
    const name = custom ? document.getElementById(`${kind}-template-list`)?.value : 'normal';
    if (!name) throw new Error('Select a format first.');
    return {kind, name};
  }
  async function loadLetterhead(kind, name) {
    const url = new URL(apiUrl('letterhead'), location.href);
    url.searchParams.set('kind', kind);
    url.searchParams.set('name', name);
    return (await fetchJson(url.toString())).letterhead || {};
  }
  async function refreshLetterhead() {
    const request = ++letterheadRequest;
    try {
      const selected = scope();
      const value = await loadLetterhead(selected.kind, selected.name);
      if (request !== letterheadRequest) return;
      document.getElementById('letterhead-status').textContent = `${selected.name}: ${value.image ? 'saved A4 letterhead' : 'no letterhead'}`;
      for (const [key, fallback] of Object.entries({top:35,right:12,bottom:20,left:12})) document.getElementById(`letterhead-${key}`).value = value[key] ?? fallback;
      const preview = document.getElementById('letterhead-thumbnail');
      preview.hidden = !value.image;
      if (value.image) preview.src = value.image;
    } catch (error) { document.getElementById('letterhead-status').textContent = error.message; }
  }
  async function saveLetterhead(remove = false) {
    const payload = {...scope(), remove};
    if (!remove) {
      const file = document.getElementById('letterhead-file').files[0];
      if (file) {
        if (!['image/png','image/jpeg'].includes(file.type) || file.size > 6_000_000) throw new Error('Choose a PNG or JPEG letterhead up to 6 MB.');
        payload.image = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file); });
        const image = new Image(); image.src = payload.image; await image.decode();
      }
      for (const key of ['top','right','bottom','left']) payload[key] = Number(document.getElementById(`letterhead-${key}`).value);
    }
    await fetchJson(apiUrl('letterhead'), {method:'POST', body:JSON.stringify(payload)});
    document.getElementById('letterhead-file').value = '';
    await refreshLetterhead();
    appendLog(remove ? 'Letterhead removed from this format.' : 'A4 letterhead saved for this format.', 'success');
  }
  async function forPrint(kind, name) {
    return document.getElementById('letterhead-enabled')?.checked ? loadLetterhead(kind, name || 'normal') : {};
  }
  function buildPrintHtml(html, kind, autoPrint, letterhead = {}) {
    const parsed = new DOMParser().parseFromString(String(html), 'text/html');
    parsed.querySelectorAll('script,iframe,object,embed,xml,link,base,meta[http-equiv]').forEach(node => node.remove());
    parsed.querySelectorAll('*').forEach(node => Array.from(node.attributes).forEach(attr => {
      if (/^on/i.test(attr.name) || /^(?:javascript|vbscript):/i.test(attr.value.trim())) node.removeAttribute(attr.name);
    }));
    parsed.querySelectorAll('p,div,tr').forEach(node => { if (/^SAMPLE\s*[—-]\s*NOT A BANK-ISSUED DOCUMENT$/.test(node.textContent.trim())) node.remove(); });
    const margins = letterhead.image ? ['top','right','bottom','left'].map(k => `${Number(letterhead[k]) || 12}mm`).join(' ') : '16mm 12mm';
    const settings = escapeHtml(JSON.stringify({autoPrint, letterhead}));
    const styles = Array.from(parsed.querySelectorAll('style'), node => node.outerHTML).join('');
    parsed.querySelectorAll('style').forEach(node => node.remove());
    return `<!doctype html><html><head><meta charset="utf-8"><title>SAMPLE ${escapeHtml(kind)}</title>${styles}<style>
@page {size:A4 portrait;margin:${margins};@bottom-center{content:"SAMPLE - NOT A BANK-ISSUED DOCUMENT";font: bold 9pt Arial;color:#a40000}}
html,body{margin:0;padding:0;background:#e8ebee;color:#000}
#print-content{background:#fff}.office-document{width:auto!important;padding:0!important;box-sizing:border-box}
table{max-width:100%}tr{break-inside:avoid}thead{display:table-header-group}
.pagedjs_page{position:relative;margin:12px auto;background:white;box-shadow:0 1px 7px #999}
.pagedjs_page_content{position:relative;z-index:2}.sample-letterhead{position:absolute;inset:0;width:210mm;height:297mm;object-fit:fill;z-index:0;pointer-events:none}
.pagedjs_sheet{background:transparent!important;position:relative;z-index:1}
.sample-watermark{position:absolute;inset:0;display:flex;justify-content:center;align-items:center;transform:rotate(-32deg);font:bold 76pt Arial;color:rgba(164,0,0,.23);z-index:4;pointer-events:none}
@media print {html,body{background:white}.pagedjs_page{margin:0;box-shadow:none;break-after:page}.sample-watermark,.sample-letterhead{print-color-adjust:exact;-webkit-print-color-adjust:exact}}
</style><script src="${new URL('print-layout.js',scriptRoot)}"></script><script src="${new URL('vendor/paged.polyfill.min.js',scriptRoot)}"></script></head><body data-print-config="${settings}"><main id="print-content"><p style="color:#a40000;font:bold 12pt Arial;text-align:center">SAMPLE — NOT A BANK-ISSUED DOCUMENT</p>${parsed.body.innerHTML}</main></body></html>`;
  }
  function scopePreviewStyles(shell) {
    for (const element of shell.querySelectorAll('style')) {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(element.textContent);
      const render = rule => {
        if (rule.selectorText) {
          const selectors = rule.selectorText.split(',').map(selector => {
            selector = selector.trim().replace(/\b(?:html|body)(?=[.#:\s>+~]|$)/g, '.html-template-preview');
            return selector.includes('.html-template-preview') ? selector : '.html-template-preview ' + selector;
          });
          return selectors.join(',') + '{' + rule.style.cssText + '}';
        }
        if (rule.type === CSSRule.MEDIA_RULE) return '@media ' + rule.conditionText + '{' + Array.from(rule.cssRules,render).join('') + '}';
        return rule.type === CSSRule.FONT_FACE_RULE ? rule.cssText : '';
      };
      element.textContent = Array.from(sheet.cssRules, render).join('\n');
    }
  }
  function sheetPicker(detail, render) {
    let picker = document.getElementById('format-sheet-selector');
    if (!picker) {
      picker = document.createElement('select'); picker.id = 'format-sheet-selector'; picker.setAttribute('aria-label','Worksheet');
      formatSheetHost.before(picker);
    }
    const sheets = detail?.scan?.summary?.sheets || [];
    picker.hidden = detail?.kind !== 'statement' || sheets.length < 2;
    if (picker.hidden) return;
    picker.replaceChildren(...sheets.map(sheet => { const option = document.createElement('option'); option.value=sheet.name; option.textContent=sheet.name; return option; }));
    picker.value = detail.active_sheet || sheets[0].name;
    picker.onchange = () => {
      const dirty = Array.from(formatSheetHost.querySelectorAll('[data-format-key]')).some(node => state.officeBaseline?.get(node.dataset.formatKey) !== node.innerHTML + '|' + node.getAttribute('style'));
      if (dirty) { picker.value=detail.active_sheet || sheets[0].name; showFormatSaveStatus('Save your format changes before switching worksheets.', 'error'); return; }
      detail.active_sheet=picker.value; render(detail);
    };
  }
  function rememberWorkspace() {
    const detail = state.templateEditorDetail;
    if (!detail) return;
    state.officeBaseline = new Map(Array.from(formatSheetHost?.querySelectorAll('[data-format-key]') || [], node => [node.dataset.formatKey, node.innerHTML + '|' + node.getAttribute('style')]));
  }
  async function saveWorkspace() {
    const detail = state.templateEditorDetail;
    if (!detail?.editable) throw new Error('Open an editable format first.');
    const edits = [];
    for (const node of formatSheetHost.querySelectorAll('[data-format-key]')) {
      const key = node.dataset.formatKey;
      if (state.officeBaseline?.get(key) === node.innerHTML + '|' + node.getAttribute('style')) continue;
      const style = {};
      const css = node.style;
      for (const [key,prop] of Object.entries({font_name:'fontFamily',font_size:'fontSize',font_color:'color',fill_color:'backgroundColor',horizontal:'textAlign',vertical:'verticalAlign',left_indent:'paddingLeft',first_line_indent:'textIndent'})) if (css[prop]) style[key] = css[prop];
      for (const key of ['font_color','fill_color']) {
        const rgb = /^rgba?\(\s*(\d+)[, ]+\s*(\d+)[, ]+\s*(\d+)/i.exec(style[key] || '');
        if (rgb) style[key] = '#' + rgb.slice(1).map(value => Number(value).toString(16).padStart(2,'0')).join('');
      }
      if (style.font_name) style.font_name = style.font_name.split(',')[0].replace(/["']/g,'').trim();
      if (css.fontWeight) style.bold = ['bold','700'].includes(css.fontWeight);
      if (css.fontStyle) style.italic = css.fontStyle === 'italic';
      if (state.formatWorkspaceMergeRequest && key === state.formatWorkspaceSelectedKey) style.merge_range = state.formatWorkspaceMergeRequest.range;
      const runs = richRunsForKey(key);
      if (runs.length) style.rich_runs = runs;
      const paragraphs = Array.from(node.children).filter(child => child.tagName === "P");
      if (paragraphs.length) style.paragraphs = paragraphs.map(p => ({text:text(p)}));
      edits.push({key, text:text(node), style});
    }
    if (!edits.length) { showFormatSaveStatus('No unsaved changes.','success'); return; }
    await fetchJson(apiUrl('template_update_batch'), {method:'POST',body:JSON.stringify({kind:detail.kind,name:detail.name,template_dir:getFormValues().template_dir,edits})});
    await refreshTemplates();
    document.getElementById(`${detail.kind}-template-list`).value = detail.name;
    await loadTemplateDetail(false);
    showFormatSaveStatus(`Saved ${edits.length} changed items for future use.`, 'success');
  }
  window.addEventListener('DOMContentLoaded', () => {
    const parent = document.getElementById('print-format-mode')?.closest('.toolbar') || document.getElementById('print-format-mode')?.parentElement;
    if (!parent) return;
    const panel = document.createElement('fieldset');
    panel.className = 'letterhead-panel';
    panel.innerHTML = `<legend>A4 sample letterhead — saved separately for each format</legend><label><input id="letterhead-enabled" type="checkbox" checked> Include saved letterhead</label> <input id="letterhead-file" type="file" accept="image/png,image/jpeg"><div>Content margins (mm): ${['top','right','bottom','left'].map(k=>`<label>${k} <input id="letterhead-${k}" type="number" min="0" max="90" step="1" style="width:65px"></label>`).join(' ')}</div><button type="button" id="letterhead-save">Save letterhead</button> <button type="button" id="letterhead-remove">Remove letterhead</button><span id="letterhead-status"></span><img id="letterhead-thumbnail" hidden alt="Saved A4 letterhead" style="display:block;max-width:100px;max-height:142px">`;
    parent.after(panel);
    const handle = action => () => action().catch(error => appendLog(error.message, 'error'));
    document.getElementById('letterhead-save').addEventListener('click',handle(()=>saveLetterhead()));
    document.getElementById('letterhead-remove').addEventListener('click',handle(()=>saveLetterhead(true)));
    for (const id of ['print-document-kind','print-format-mode','statement-template-list','certificate-template-list']) document.getElementById(id)?.addEventListener('change',refreshLetterhead);
    refreshLetterhead();
  });
  return {buildPrintHtml,forPrint,rememberWorkspace,saveWorkspace,text,refreshLetterhead,scopePreviewStyles,sheetPicker};
}
