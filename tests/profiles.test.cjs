const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const vm = require("node:vm");
const {test} = require("node:test");
const {JSDOM} = require("jsdom");
const assets = fs.existsSync(path.join(__dirname, "../assets")) ? "assets" : "static";
const source = fs.readFileSync(path.join(__dirname, "..", assets, "profiles.js"), "utf8").replaceAll("export ", "");

function fixture() {
  const dom = new JSDOM(`<form id="statement-form">
    <section id="account-panel"><input name="bank_name" value="Draft bank"><input name="customer_name" value="Draft customer"></section>
    <section id="statement-panel"><input name="interest_rate" value="9"><input name="amount_rounding_percentages" value='{"500":70,"50":20,"5":10}'></section>
    <section id="texts-panel"><input name="deposit_text" value="Cash Deposited"><textarea name="deposit_names">First Name\nSecond Name</textarea></section>
    <section id="export-panel"><label><input name="manual_rate" value="150"></label><label><select name="rate_mode"><option>Manual</option><option>Auto (NRB)</option></select></label><label><input name="rate_type" value="sell"></label></section>
    <select id="statement-template-list"><option>Layout</option></select>
    <section id="profiles-panel"><div class="profile-workspace-actions">
      <select id="profile-format-select"><option>Existing</option></select>
      <div id="profile-format-editor" hidden><input id="profile-format-name-input"><button type="button" id="profile-format-editor-save-btn"></button></div>
    </div></section></form>`);
  const document = dom.window.document;
  dom.window.HTMLElement.prototype.scrollIntoView = function() {};
  const downloads = [];
  dom.window.HTMLAnchorElement.prototype.click = function() { downloads.push(this.download); };
  let blob;
  const timers = [];
  const revoked = [];
  const context = vm.createContext({
    document, window: dom.window, Option: dom.window.Option, Blob,
    URL: {createObjectURL(value) {blob = value; return "blob:profile";}, revokeObjectURL(url) {revoked.push(url);}},
    setTimeout(callback, delay) {timers.push({callback, delay});},
  });
  vm.runInContext(source, context);
  let manager;
  const saved = {name: "Existing", profile: {bank_name: "Saved bank", customer_name: "A Different Name", interest_rate: "7", deposit_text: "Cash Deposited", deposit_names: "First\nSecond", statement_template_name: "Layout"}};
  const h = {
    state: {profileFormats: [{name: "Existing"}], templates: {statement_templates: [{name: "Layout"}]}},
    defaults: () => ({bank_name: "Default bank", customer_name: "Default customer", interest_rate: "5", deposit_text: "Default label", deposit_names: "Self", rate_mode: "Auto (NRB)", manual_rate: "", rate_type: "sell"}),
    showProfiles: () => true, apiUrl: (_action, params) => params.name,
    fetchJson: async () => saved,
    getProfileValues() {
      const values = Object.fromEntries(Array.from(document.querySelectorAll("[name]"), node => [node.name, node.value]));
      return {...values, statement_template_name: manager?.templateName() || "Layout"};
    },
    applyValues(values) {
      for (const node of document.querySelectorAll("[name]")) if (Object.hasOwn(values, node.name)) node.value = values[node.name];
    },
    log() {}, saveProfile: async () => {h.saveCalls++;}, saveCalls: 0,
    cancelProfile: () => manager.close(),
  };
  manager = context.setupStatementProfiles(h);
  return {dom, document, context, h, manager, saved, downloads, timers, revoked, blob: () => blob};
}

test("portable profiles retain descriptions, names, rules and leading zeros while excluding unknown fields", () => {
  const {context} = fixture();
  const profile = {account_number: "00001234", deposit_text: "Cash Deposited BY:", deposit_names: "Āshā\nSecond Name", amount_rounding_percentages: '{"500":70,"50":20,"5":10}', manual_rate: "150.25"};
  const text = context.profileFile("Portable", profile);
  const parsed = context.parseProfileFile(text, Object.keys(profile));
  assert.equal(JSON.stringify(parsed.profile), JSON.stringify(profile));
  const legacy = context.parseProfileFile(JSON.stringify({...profile, password: "not a profile field"}), Object.keys(profile), "Older file");
  assert.equal(legacy.name, "Older file");
  assert.ok(!Object.hasOwn(legacy.profile, "password"));
  assert.equal(context.parseProfileFile("\uFEFF" + text, Object.keys(profile)).name, "Portable");
  for (const invalid of ["<html>wrong file</html>", "[]", '{"profile":[]}', '{"format":"statement-generator-profile","version":2,"profile":{"account_number":"0"}}', '{"profile":{"account_number":[]}}']) {
    assert.throws(() => context.parseProfileFile(invalid, Object.keys(profile)));
  }
});

test("new profile shows the existing full form controls and cancel restores the draft and their positions", async () => {
  const {document, manager} = fixture();
  const account = document.getElementById("account-panel");
  await manager.open("new");
  assert.equal(document.querySelector("#statement-profile-fields #account-panel"), account);
  assert.equal(document.querySelectorAll("#statement-profile-fields > section").length, 3);
  assert.equal(document.querySelector('[name="bank_name"]').value, "");
  assert.equal(document.querySelector('[name="interest_rate"]').value, "5");
  assert.equal(document.getElementById("profile-format-name-input").value, "");
  assert.equal(document.getElementById("statement-profile-details").hidden, false);
  manager.close();
  assert.equal(account.parentNode.id, "statement-form");
  assert.equal(document.querySelector('[name="bank_name"]').value, "Draft bank");
  assert.equal(document.querySelector('[name="rate_mode"]').value, "Manual");
  assert.equal(document.getElementById("statement-profile-details").hidden, true);
});

test("import opens every profile setting for review and saves only after the Save button is clicked", async () => {
  const {document, h, manager} = fixture();
  const imported = {format: "statement-generator-profile", version: 1, name: "From USB", profile: {
    bank_name: "Imported bank", customer_name: "Imported Name", interest_rate: "8.5", deposit_names: "One\nTwo", statement_template_name: "Other format",
  }};
  const file = {name: "profile.json", size: 100, text: async () => JSON.stringify(imported)};
  await document.getElementById("import-statement-profile-file").onchange({target: {files: [file], value: "profile.json"}});
  assert.equal(document.querySelector('[name="bank_name"]').value, "Imported bank");
  assert.equal(document.querySelector('[name="deposit_names"]').value, "One\nTwo");
  assert.equal(document.getElementById("profile-format-name-input").value, "From USB");
  assert.equal(manager.templateName(), "Other format");
  assert.equal(h.saveCalls, 0);
  await document.getElementById("statement-profile-save-btn").onclick();
  assert.equal(h.saveCalls, 1);
  manager.setSaving(true);
  assert.equal(document.getElementById("statement-profile-save-btn").disabled, true);
  manager.setSaving(false);
  manager.close(true);
  assert.match(document.getElementById("statement-profile-status").textContent, /saved successfully/);
});

test("edit reloads the saved details and export downloads saved data instead of the working draft", async () => {
  const {document, manager, downloads, blob} = fixture();
  await manager.open("edit");
  assert.equal(document.querySelector('[name="bank_name"]').value, "Saved bank");
  assert.equal(document.getElementById("profile-format-editor").dataset.originalName, "Existing");
  manager.close();
  await document.getElementById("export-statement-profile-btn").onclick();
  assert.deepEqual(downloads, ["Existing.json"]);
  const file = JSON.parse(await blob().text());
  assert.equal(file.profile.bank_name, "Saved bank");
  assert.equal(file.profile.deposit_names, "First\nSecond");
  assert.equal(file.profile.statement_template_name, "Layout");
});

test("profile save sends create-only protection and releases the form after a server error", async () => {
  const app = fs.readFileSync(path.join(__dirname, "..", assets, "app.js"), "utf8");
  const match = app.match(/^async function saveProfileFormat\([^]*?(?=^(?:async )?function )/m);
  let sent;
  const busy = [];
  const context = vm.createContext({
    state: {}, profileFormatEditor: {dataset: {mode: "create", originalName: ""}},
    profileFormatNameInput: {value: "Existing"}, profileFormatSelect: {value: "Existing"},
    workspaceUI: {profileSaving: value => busy.push(value)},
    getProfileDraftValues: () => ({bank_name: "New bank"}), apiUrl: () => "profiles",
    fetchJson: async (_url, options) => {sent = JSON.parse(options.body); throw new Error("Already exists");},
  });
  vm.runInContext(match[0], context);
  await assert.rejects(context.saveProfileFormat(), /Already exists/);
  assert.equal(sent.create_only, true);
  assert.equal(sent.original_name, "");
  assert.equal(context.state.profileFormatSaving, false);
  assert.deepEqual(busy, [true, false]);
});

test("profile download supports changed destination folders without invoking the cancelling picker", async t => {
  const {dom, document, h, saved, downloads, context, timers, revoked, blob} = fixture();
  let pickerCalls = 0;
  dom.window.showSaveFilePicker = async () => {
    pickerCalls++;
    throw Object.assign(new Error("Changing the folder was rejected"), {name: "AbortError"});
  };
  saved.profile.customer_name = "Āshā गुरुङ";
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "statement-profile-folders-"));
  const folders = [path.join(directory, "First Folder"), path.join(directory, "Another Folder")];
  for (const folder of folders) fs.mkdirSync(folder);
  t.after(() => {
    for (const folder of folders) {
      const file = path.join(folder, "Saved profile.json");
      if (fs.existsSync(file)) fs.unlinkSync(file);
      fs.rmdirSync(folder);
    }
    fs.rmdirSync(directory);
  });
  for (const folder of folders) {
    await document.getElementById("export-statement-profile-btn").onclick();
    const destination = path.join(folder, "Saved profile.json");
    const text = await blob().text();
    fs.writeFileSync(destination, text, "utf8");
    const imported = context.parseProfileFile(fs.readFileSync(destination, "utf8"), Object.keys(h.getProfileValues()));
    assert.equal(imported.profile.customer_name, "Āshā गुरुङ");
    assert.equal(imported.profile.deposit_names, "First\nSecond");
    assert.equal(imported.profile.bank_name, "Saved bank");
    assert.match(document.getElementById("statement-profile-status").textContent, /download requested/);
    assert.doesNotMatch(document.getElementById("statement-profile-status").textContent, /cancelled|saved successfully/);
    assert.equal(document.getElementById("export-statement-profile-btn").disabled, false);
  }
  assert.equal(pickerCalls, 0);
  assert.deepEqual(downloads, ["Existing.json", "Existing.json"]);
  assert.equal(revoked.length, 0);
  assert.ok(timers.every(timer => timer.delay >= 60000));
  for (const timer of timers) timer.callback();
  assert.deepEqual(revoked, ["blob:profile", "blob:profile"]);
  assert.match(document.getElementById("profile-download-help").textContent, /choose a folder for each export/);
});

test("failed profile loading creates no download and remains retryable", async () => {
  const {document, h, saved, downloads} = fixture();
  h.fetchJson = async () => {throw new Error("Profile request failed");};
  await document.getElementById("export-statement-profile-btn").onclick();
  assert.deepEqual(downloads, []);
  assert.match(document.getElementById("statement-profile-status").textContent, /request failed/);
  assert.equal(document.getElementById("export-statement-profile-btn").disabled, false);
  h.fetchJson = async () => saved;
  await document.getElementById("export-statement-profile-btn").onclick();
  assert.deepEqual(downloads, ["Existing.json"]);
});

test("exports reject an account change and prevent duplicate download requests", async () => {
  const {document, h, saved, downloads} = fixture();
  h.state.currentUser = {id: 1};
  h.fetchJson = async () => {h.state.currentUser = {id: 2}; return saved;};
  await document.getElementById("export-statement-profile-btn").onclick();
  assert.deepEqual(downloads, []);
  assert.match(document.getElementById("statement-profile-status").textContent, /account changed/);
  let finish;
  h.fetchJson = () => new Promise(resolve => {finish = resolve;});
  const first = document.getElementById("export-statement-profile-btn").onclick();
  assert.equal(document.getElementById("export-statement-profile-btn").disabled, true);
  await document.getElementById("export-statement-profile-btn").onclick();
  finish(saved);
  await first;
  assert.deepEqual(downloads, ["Existing.json"]);
  assert.equal(document.getElementById("export-statement-profile-btn").disabled, false);
});
