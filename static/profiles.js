const FORMAT = "statement-generator-profile";
const MAX_FILE_SIZE = 1024 * 1024;

export function parseProfileFile(text, fields, fallbackName = "") {
  let data;
  try {
    data = JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch {
    throw new Error("Choose a valid JSON statement profile file.");
  }
  if (!data || Array.isArray(data) || typeof data !== "object") {
    throw new Error("The file must contain one statement profile.");
  }
  if (data.format && (data.format !== FORMAT || data.version !== 1)) {
    throw new Error("This profile file format or version is not supported.");
  }
  const source = data.profile ?? data.config ?? data;
  if (!source || Array.isArray(source) || typeof source !== "object") {
    throw new Error("The file does not contain profile details.");
  }
  const profile = {};
  for (const key of fields) {
    if (!Object.hasOwn(source, key)) continue;
    const value = source[key];
    if (value !== null && !["string", "number", "boolean"].includes(typeof value)) {
      throw new Error(`The profile field ${key.replaceAll("_", " ")} must contain text or a number.`);
    }
    profile[key] = value === null ? "" : String(value);
  }
  if (!Object.keys(profile).length) {
    throw new Error("No recognized statement profile details were found.");
  }
  const name = typeof (data.name ?? data.profile_name) === "string" ? (data.name ?? data.profile_name) : fallbackName;
  return {name: name.trim().replace(/\s+/g, " "), profile};
}

export function profileFile(name, profile) {
  return JSON.stringify({format: FORMAT, version: 1, name, profile}, null, 2) + "\n";
}

export function setupStatementProfiles(h) {
  const $ = id => document.getElementById(id);
  const form = $("statement-form");
  const panel = $("profiles-panel");
  const actions = panel.querySelector(".profile-workspace-actions");
  const nameEditor = $("profile-format-editor");
  const nameInput = $("profile-format-name-input");
  let snapshot = null;
  let previousSelection = "";
  let active = false;
  let saving = false;
  let exporting = false;
  const sections = ["account-panel", "statement-panel", "texts-panel"].map($);
  const exchangeFields = ["rate_mode", "manual_rate", "rate_type"].map(name => form.elements[name]?.closest("label")).filter(Boolean);
  const moved = [...sections, ...exchangeFields].map(node => {
    const anchor = document.createComment("Profile field position");
    node.before(anchor);
    return {node, anchor};
  });

  actions.insertAdjacentHTML("afterbegin", '<button type="button" class="primary-button" id="new-statement-profile-btn">Create New Statement Profile</button>');
  actions.insertAdjacentHTML("beforeend", '<button type="button" class="ghost-button" id="export-statement-profile-btn">Export Profile</button><button type="button" class="ghost-button" id="import-statement-profile-btn">Import Profile</button><input type="file" id="import-statement-profile-file" accept=".json,application/json" hidden>');
  const status = document.createElement("p");
  status.id = "statement-profile-status";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  actions.after(status);
  status.insertAdjacentHTML("afterend", '<p class="muted" id="profile-download-help">Your browser controls the save folder. To choose a folder for each export, enable the option to ask where to save downloads in your browser settings.</p>');
  $("export-statement-profile-btn").setAttribute("aria-describedby", "profile-download-help");
  const editor = document.createElement("div");
  editor.id = "statement-profile-details";
  editor.hidden = true;
  editor.innerHTML = '<h3 id="statement-profile-editor-title">Create statement profile</h3><p class="muted">Review all account details, statement rules, descriptions and names before saving.</p><div id="statement-profile-fields"></div><section class="profile-output-settings"><h3>Exchange rate and Excel format</h3><div class="field-grid two-col" id="profile-exchange-fields"></div><label class="field"><span>Saved Excel statement format</span><select id="profile-statement-template"><option value="">Choose during export</option></select></label><p class="muted">Profile files contain settings. Upload Excel or Word formats separately in Format Manager when using another device.</p></section><div class="split-actions"><button type="button" class="primary-button" id="statement-profile-save-btn">Save Statement Profile</button><button type="button" class="ghost-button" id="statement-profile-cancel-btn">Cancel</button></div>';
  panel.append(editor);
  editor.querySelector("p").after(nameEditor);
  const details = $("statement-profile-fields");
  const template = $("profile-statement-template");

  function close(saved = false) {
    if (!active) return;
    for (const {node, anchor} of moved) anchor.after(node);
    active = false;
    editor.hidden = true;
    nameEditor.hidden = true;
    actions.hidden = false;
    if (saved && $("statement-template-list")) $("statement-template-list").value = template.value;
    if (!saved && snapshot) {
      h.applyValues(snapshot);
      $("profile-format-select").value = previousSelection;
    }
    snapshot = null;
    status.textContent = saved ? "Statement profile saved successfully." : "Profile editing cancelled.";
  }

  async function open(mode = "create", imported = null) {
    if (saving) return;
    const selected = $("profile-format-select").value;
    if (mode === "edit" && !selected) throw new Error("Select a saved statement profile first.");
    if (!h.showProfiles()) return;
    let loaded = null;
    if (mode === "edit") {
      const owner = h.state.currentUser?.id;
      h.pending?.(1);
      try {
        loaded = await h.fetchJson(h.apiUrl("profile_formats", {name: selected}), {method: "GET"});
      } finally {
        h.pending?.(-1);
      }
      if (owner !== h.state.currentUser?.id) return;
    }
    close();
    snapshot = h.getProfileValues();
    previousSelection = $("profile-format-select").value;
    const clean = {...h.defaults(), statement_template_name: ""};
    for (const key of ["bank_name", "branch_name", "customer_name", "customer_address", "account_number", "member_id", "reference_no", "opening_date"]) clean[key] = "";
    const values = mode === "new" ? clean : mode === "import" ? {...clean, ...imported.profile} : mode === "edit" ? {...clean, ...loaded.profile} : snapshot;
    active = true;
    for (const section of sections) details.append(section);
    for (const field of exchangeFields) $("profile-exchange-fields").append(field);
    h.state.profileFormatEditorMode = mode === "edit" ? "edit" : "create";
    h.state.profileFormatEditOriginalName = mode === "edit" ? selected : "";
    nameEditor.dataset.mode = h.state.profileFormatEditorMode;
    nameEditor.dataset.originalName = h.state.profileFormatEditOriginalName;
    nameInput.value = mode === "edit" ? selected : mode === "import" ? imported.name : "";
    template.replaceChildren(new Option("Choose during export", ""));
    for (const row of h.state.templates?.statement_templates || []) template.add(new Option(row.name, row.name));
    const formatName = values.statement_template_name || "";
    if (formatName && !Array.from(template.options).some(option => option.value === formatName)) {
      template.add(new Option(formatName + " (upload this format in Format Manager)", formatName));
    }
    template.value = formatName;
    h.applyValues(values);
    actions.hidden = true;
    editor.hidden = false;
    nameEditor.hidden = false;
    $("statement-profile-editor-title").textContent = mode === "edit" ? "Edit statement profile" : mode === "import" ? "Review imported statement profile" : "Create statement profile";
    status.textContent = mode === "import" ? "Profile loaded from file. Review the details and save to add it to your account." : "";
    nameInput.focus();
    editor.scrollIntoView({block: "start", behavior: "smooth"});
  }

  async function run(task) {
    try { await task(); }
    catch (error) {
      if (error.name === "AbortError") return;
      status.textContent = error.message;
      h.log(error.message, "error");
    }
  }
  $("new-statement-profile-btn").onclick = () => run(() => open("new"));
  $("statement-profile-save-btn").onclick = () => run(() => h.saveProfile());
  $("statement-profile-cancel-btn").onclick = () => h.cancelProfile();
  form.addEventListener("submit", event => {
    if (!active) return;
    event.preventDefault();
    run(() => h.saveProfile());
  });
  $("import-statement-profile-btn").onclick = () => $("import-statement-profile-file").click();
  $("import-statement-profile-file").onchange = event => run(async () => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > MAX_FILE_SIZE) throw new Error("Choose a statement profile JSON file up to 1 MB.");
    const imported = parseProfileFile(await file.text(), Object.keys(h.getProfileValues()), file.name.replace(/\.json$/i, ""));
    await open("import", imported);
  });
  $("export-statement-profile-btn").onclick = () => run(async () => {
    if (exporting) return;
    const owner = h.state.currentUser?.id;
    const name = $("profile-format-select").value;
    if (!name) throw new Error("Select a saved statement profile to export.");
    const filename = name.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_") + ".json";
    exporting = true;
    $("export-statement-profile-btn").disabled = true;
    status.textContent = "Preparing the JSON profile file…";
    try {
      const saved = await h.fetchJson(h.apiUrl("profile_formats", {name}), {method: "GET"});
      if (owner !== h.state.currentUser?.id) throw new Error("Your signed-in account changed. Export the profile again.");
      const profile = parseProfileFile(JSON.stringify(saved), Object.keys(h.getProfileValues()), name);
      const text = profileFile(name, profile.profile);
      const url = URL.createObjectURL(new Blob([text], {type: "application/json"}));
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      status.textContent = `JSON download requested for ${filename}. Select the destination in your browser's Save As dialog, or check Downloads.`;
    } finally {
      exporting = false;
      $("export-statement-profile-btn").disabled = false;
    }
  });
  return {
    open, close,
    isOpen: () => active,
    templateName: () => active ? template.value : $("statement-template-list")?.value || "",
    setSaving(value) {
      saving = value;
      editor.inert = value;
      for (const id of ["profile-format-editor-save-btn", "statement-profile-save-btn"]) $(id).disabled = value;
    },
    reset() { close(); status.textContent = ""; },
  };
}
