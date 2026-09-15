const rootUrl = new URL("./", window.location.href);
const apiUrl = (action, params = null) => {
  const url = new URL(`api/${action}`, rootUrl);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && String(value) !== "") {
        url.searchParams.set(key, String(value));
      }
    }
  }
  return url.toString();
};

const profileStorageKey = "web-statement-generator-profile";
const authStorageKey = "web-statement-generator-auth";
const deviceStorageKey = "web-statement-generator-device";

const state = {
  generatedSeed: "",
  holidayView: "All",
  selectedHoliday: null,
  selectedPosting: null,
  selectedManagedUserId: "",
  selectedHistoryUserId: "",
  selectedDeviceId: "",
  templates: null,
  authToken: localStorage.getItem(authStorageKey) || "",
  currentUser: null,
  currentStatement: null,
  currentStatementId: null,
  currentStatementSource: "generated",
  users: [],
  devicesPayload: { devices: [], target_user_id: null, target_username: "" },
  statementEditMode: false,
  editableRows: [],
  postingRows: [],
  validationErrors: [],
  profileFormats: [],
  profileFormatEditorMode: "create",
  profileFormatEditOriginalName: "",
  templateEditorDetail: null,
  formatWorkspaceSelectedKey: "",
  formatWorkspaceAnchorKey: "",
  formatWorkspaceSelectedKeys: [],
  formatWorkspaceMergeRequest: null,
  formatWorkspaceRangeRequest: null,
  formatWorkspaceVirtualItem: null,
  formatInlineRange: null,
  formatUndoStack: [],
  formatWorkspaceOrientation: "portrait",
  formatWorkspaceZoom: 100,
  autoSaveTimer: null,
  suppressAutoProfileSave: false,
};

const form = document.getElementById("statement-form");
const previewBody = document.querySelector("#preview-table tbody");
const previewHeadRow = document.querySelector("#preview-table thead tr");
const holidayBody = document.querySelector("#holiday-table tbody");
const postingBody = document.querySelector("#posting-table tbody");
const statusLog = document.getElementById("status-log");
const holidaySummary = document.getElementById("holiday-summary");
const postingSummary = document.getElementById("posting-summary");
const historyBody = document.querySelector("#history-table tbody");
const countsBody = document.querySelector("#counts-table tbody");
const usersBody = document.querySelector("#users-table tbody");
const devicesBody = document.querySelector("#devices-table tbody");
const activitiesBody = document.querySelector("#activities-table tbody");
const loginOverlay = document.getElementById("login-overlay");
const loginError = document.getElementById("login-error");
const currentUserLabel = document.getElementById("current-user-label");
const logoutButton = document.getElementById("logout-btn");
const accessSummaryNote = document.getElementById("access-summary-note");
const profileFormatSelect = document.getElementById("profile-format-select");
const profileFormatEditor = document.getElementById("profile-format-editor");
const profileFormatNameInput = document.getElementById("profile-format-name-input");
const profileFormatEditorSaveButton = document.getElementById("profile-format-editor-save-btn");
const profileFormatEditorCancelButton = document.getElementById("profile-format-editor-cancel-btn");
const historyFilterLabel = document.getElementById("history-filter-label");
const historyTotalLabel = document.getElementById("history-total-label");
const deviceTargetLabel = document.getElementById("device-target-label");
const manageUserSelect = document.getElementById("manage-user-select");
const manageUserSearch = document.getElementById("manage-user-search");
const postingPeriodSelect = document.getElementById("posting-period-select");
const postingDateInput = document.getElementById("posting-date");
const previewEditNote = document.getElementById("preview-edit-note");
const statementRowMode = document.getElementById("statement-row-mode");
const statementRowCountField = document.getElementById("statement-row-count-field");
const prependStatementMode = document.getElementById("prepend-statement-mode");
const prependStartDateField = document.getElementById("prepend-start-date-field");
const prependAnchorDateField = document.getElementById("prepend-anchor-date-field");
const prependAnchorBalanceField = document.getElementById("prepend-anchor-balance-field");
const transactionCountModeInput = document.getElementById("transaction-count-mode");
const monthlyTransactionCountsInput = document.getElementById("monthly-transaction-counts");
const monthlyTransactionPanel = document.getElementById("monthly-transaction-panel");
const monthlyTransactionGrid = document.getElementById("monthly-transaction-grid");
const editStatementButton = document.getElementById("edit-statement-btn");
const updateStatementButton = document.getElementById("update-statement-btn");
const cancelEditButton = document.getElementById("cancel-edit-btn");
const importStatementButton = document.getElementById("import-statement-btn");
const importStatementInput = document.getElementById("import-statement-file");
const validateStatementButton = document.getElementById("validate-statement-btn");
const validationPanel = document.getElementById("validation-panel");
const validationErrorsNode = document.getElementById("validation-errors");
const templateEditorPanel = document.getElementById("template-editor-panel");
const templateScanSummary = document.getElementById("template-scan-summary");
const templateItemSelect = document.getElementById("template-item-select");
const templateItemText = document.getElementById("template-item-text");
const templateItemAlign = document.getElementById("template-item-align");
const templateItemVertical = document.getElementById("template-item-vertical");
const templateItemFontSize = document.getElementById("template-item-font-size");
const templateItemNumberFormat = document.getElementById("template-item-number-format");
const templateItemColor = document.getElementById("template-item-color");
const templateItemBg = document.getElementById("template-item-bg");
const templateItemBold = document.getElementById("template-item-bold");
const templateItemDecoration = document.getElementById("template-item-decoration");
const formatWorkspacePanel = document.getElementById("format-workspace-panel");
const formatWorkspaceTitle = document.getElementById("format-workspace-title");
const formatWorkspaceSummary = document.getElementById("format-workspace-summary");
const formatSheetHost = document.getElementById("format-sheet-host");
const formatObjectSelect = document.getElementById("format-object-select");
const formatFormulaInput = document.getElementById("format-formula-input");
const formatSelectedCell = document.getElementById("format-selected-cell");
const formatWorkspaceCloseButton = document.getElementById("format-workspace-close-btn");
const formatInsertObjectButton = document.getElementById("format-insert-object-btn");
const formatGeneratedPreviewButton = document.getElementById("format-generated-preview-btn");
const formatSaveCellButton = document.getElementById("format-save-cell-btn");
const formatSaveOriginalButton = document.getElementById("format-save-original-btn");
const formatSaveStatus = document.getElementById("format-save-status");
const formatFontFamily = document.getElementById("format-font-family");
const formatFontSize = document.getElementById("format-font-size");
const formatFontColor = document.getElementById("format-font-color");
const formatFillColor = document.getElementById("format-fill-color");
const formatVerticalAlign = document.getElementById("format-vertical-align");
const formatLineSpacing = document.getElementById("format-line-spacing");
const formatLeftTab = document.getElementById("format-left-tab");
const formatLeftIndent = document.getElementById("format-left-indent");
const formatFirstIndent = document.getElementById("format-first-indent");
const formatBorderStyle = document.getElementById("format-border-style");
const formatNumberFormat = document.getElementById("format-number-format");
const formatMergeCenterButton = document.getElementById("format-merge-center-btn");
const formatUnmergeButton = document.getElementById("format-unmerge-btn");
const formatFitWidthButton = document.getElementById("format-fit-width-btn");
const formatFullscreenButton = document.getElementById("format-fullscreen-btn");
const formatZoomRange = document.getElementById("format-zoom-range");
const formatZoomOutput = document.getElementById("format-zoom-output");
const formatWorkbookStatus = document.getElementById("format-workbook-status");
const formatZoomStatus = document.getElementById("format-zoom-status");
const loginPasswordInput = document.getElementById("login-password");
const loginPasswordToggle = document.getElementById("login-password-toggle");
const passwordModalOverlay = document.getElementById("password-modal-overlay");
const passwordModalTitle = document.getElementById("password-modal-title");
const passwordModalMessage = document.getElementById("password-modal-message");
const passwordModalInput = document.getElementById("password-modal-input");
const passwordModalToggle = document.getElementById("password-modal-toggle");
const passwordModalCancel = document.getElementById("password-modal-cancel");
const passwordModalConfirm = document.getElementById("password-modal-confirm");
const passwordModalError = document.getElementById("password-modal-error");

const summaryMap = {
  final_balance_text: document.getElementById("summary-final-balance"),
  issue_date: document.getElementById("summary-issue-date"),
  row_count: document.getElementById("summary-row-count"),
  target_gap_text: document.getElementById("summary-target-gap"),
  total_deposits_text: document.getElementById("summary-total-deposits"),
  total_withdrawals_text: document.getElementById("summary-total-withdrawals"),
  total_interest_text: document.getElementById("summary-total-interest"),
  total_tax_text: document.getElementById("summary-total-tax"),
  seed_used: document.getElementById("summary-seed-used"),
};

let pendingPasswordResolver = null;

function appendLog(message, type = "info") {
  const entry = document.createElement("div");
  entry.className = `status-entry${type === "error" ? " is-error" : type === "success" ? " is-success" : ""}`;
  const stamp = new Date().toLocaleTimeString();
  entry.textContent = `[${stamp}] ${message}`;
  statusLog.prepend(entry);
}

function showFormatSaveStatus(message, type = "success") {
  if (!formatSaveStatus) {
    return;
  }
  formatSaveStatus.textContent = message;
  formatSaveStatus.classList.toggle("is-success", Boolean(message) && type === "success");
  formatSaveStatus.classList.toggle("is-error", Boolean(message) && type === "error");
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...(options.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...(state.authToken ? { Authorization: `Bearer ${state.authToken}` } : {}),
      ...(options.headers || {}),
    },
  });

  let payload = {};
  try {
    payload = await response.json();
  } catch {
    payload = {};
  }
  if (!response.ok) {
    throw new Error(payload.error || "Request failed.");
  }
  return payload;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function cloneData(value) {
  return JSON.parse(JSON.stringify(value));
}

function parseMoneyInput(value) {
  const cleaned = String(value ?? "").replaceAll(",", "").trim();
  if (cleaned === "") {
    return 0;
  }
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : 0;
}

function moneyText(value) {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount) || Math.abs(amount) < 0.0001) {
    return "";
  }
  return amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function normalizeYesNo(value, fallback = true) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) {
    return fallback;
  }
  return !["no", "false", "0", "off"].includes(normalized);
}

const roundingDefaults = { 1000: 35, 500: 35, 100: 10, 50: 10, 10: 0, 5: 10 };

function loadRoundingPercentages(raw) {
  let values = roundingDefaults;
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) values = parsed;
  } catch (_) { /* Old profiles use the default percentages. */ }
  for (const input of document.querySelectorAll("[data-rounding-step]")) {
    input.value = values[input.dataset.roundingStep] ?? 0;
  }
  updateRoundingState();
}

function updateRoundingPercentagesValue() {
  const values = {};
  let total = 0;
  let valid = true;
  const custom = document.getElementById("amount-rounding-mode")?.value === "custom";
  for (const input of document.querySelectorAll("[data-rounding-step]")) {
    const value = Number(input.value);
    values[input.dataset.roundingStep] = input.value;
    valid = valid && input.value.trim() !== "" && Number.isFinite(value) && value >= 0 && value <= 100;
    total += Number.isFinite(value) ? value : 0;
  }
  const exact = valid && Math.abs(total - 100) < 0.000001;
  const field = document.getElementById("amount-rounding-percentages");
  if (field) field.value = JSON.stringify(values);
  const label = document.getElementById("rounding-percentage-total");
  if (label) {
    label.textContent = `Total: ${Number(total.toFixed(2))}%${exact ? "" : " — enter percentages totaling 100%."}`;
    label.classList.toggle("error-text", !exact);
  }
  for (const input of document.querySelectorAll("[data-rounding-step]")) {
    input.setCustomValidity(custom && !exact ? "Enter percentages from 0 to 100 that total 100%." : "");
  }
  return exact;
}

function updateRoundingState() {
  const mode = document.getElementById("amount-rounding-mode")?.value || "automatic";
  const panel = document.getElementById("rounding-custom-panel");
  if (panel) panel.hidden = mode !== "custom";
  for (const input of document.querySelectorAll("[data-rounding-step]")) input.disabled = mode !== "custom";
  const summary = document.getElementById("rounding-rule-summary");
  if (summary) summary.textContent = mode === "automatic"
    ? "Automatic: 70% in multiples of 1,000 or 500; 20% in multiples of 100 or 50; 10% in multiples of 5. Applied to debit and credit transactions combined, rounded to whole transaction counts."
    : mode === "custom"
      ? "Customize the percentage of transactions for each rounding figure below. The total must equal 100%."
      : "Amounts use the selected rounding figure or combination. Select Customized percentages to control the share of transactions for each figure.";
  updateRoundingPercentagesValue();
}

function getFormValues() {
  updateRoundingPercentagesValue();
  updateMonthlyTransactionCountsValue();
  const values = {};
  for (const element of form.querySelectorAll("[name]")) {
    values[element.name] = element.value;
  }
  return values;
}

function applyFormValues(values) {
  state.suppressAutoProfileSave = true;
  for (const element of form.querySelectorAll("[name]")) {
    if (Object.hasOwn(values, element.name)) {
      element.value = values[element.name];
    }
  }
  loadRoundingPercentages(values.amount_rounding_percentages);
  updateManualRateState();
  updateRowCountState();
  updatePrependStatementState();
  updateTransactionCountState();
  updatePreviewTableLayout();
  state.suppressAutoProfileSave = false;
}

function monthKeyToLabel(key) {
  const [year, month] = String(key || "").split("-").map((part) => Number(part));
  if (!year || !month) {
    return String(key || "");
  }
  const date = new Date(year, month - 1, 1);
  return `${year} ${date.toLocaleString(undefined, { month: "long" })}`;
}

function monthKeysInStatementRange() {
  const start = form.querySelector('[name="start_date"]')?.value;
  const end = form.querySelector('[name="end_date"]')?.value;
  if (!start || !end) {
    return [];
  }
  const startDate = new Date(`${start}T00:00:00`);
  const endDate = new Date(`${end}T00:00:00`);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime()) || startDate > endDate) {
    return [];
  }
  const keys = [];
  const cursor = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
  const last = new Date(endDate.getFullYear(), endDate.getMonth(), 1);
  while (cursor <= last && keys.length < 60) {
    keys.push(`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`);
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return keys;
}

function parsedMonthlyTransactionCounts() {
  try {
    const parsed = JSON.parse(monthlyTransactionCountsInput?.value || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function updateMonthlyTransactionCountsValue() {
  if (!monthlyTransactionCountsInput || !monthlyTransactionGrid) {
    return;
  }
  const counts = {};
  monthlyTransactionGrid.querySelectorAll("[data-month-key]").forEach((input) => {
    const key = input.dataset.monthKey || "";
    const value = Number(input.value || 0);
    if (key && Number.isFinite(value) && value > 0) {
      counts[key] = Math.max(0, Math.min(50, Math.round(value)));
    }
  });
  monthlyTransactionCountsInput.value = JSON.stringify(counts);
}

function renderMonthlyTransactionGrid() {
  if (!monthlyTransactionGrid || !monthlyTransactionCountsInput) {
    return;
  }
  const existing = parsedMonthlyTransactionCounts();
  const keys = monthKeysInStatementRange();
  monthlyTransactionGrid.innerHTML = "";
  for (const key of keys) {
    const label = document.createElement("label");
    label.className = "monthly-transaction-item";
    const span = document.createElement("span");
    span.textContent = monthKeyToLabel(key);
    const input = document.createElement("input");
    input.type = "number";
    input.min = "0";
    input.max = "50";
    input.step = "1";
    input.dataset.monthKey = key;
    input.value = String(existing[key] ?? 3);
    input.addEventListener("input", updateMonthlyTransactionCountsValue);
    label.append(span, input);
    monthlyTransactionGrid.append(label);
  }
  updateMonthlyTransactionCountsValue();
}

function setTransactionCountMode(mode) {
  const normalized = mode === "custom" ? "custom" : "auto";
  if (transactionCountModeInput) {
    transactionCountModeInput.value = normalized;
  }
  document.querySelectorAll("[data-transaction-mode]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.transactionMode === normalized);
  });
  if (monthlyTransactionPanel) {
    monthlyTransactionPanel.hidden = normalized !== "custom";
  }
  if (normalized === "custom") {
    renderMonthlyTransactionGrid();
  } else if (monthlyTransactionCountsInput) {
    monthlyTransactionCountsInput.value = "";
  }
}

function updateTransactionCountState() {
  setTransactionCountMode(transactionCountModeInput?.value === "custom" ? "custom" : "auto");
}

function renderSelectOptions(select, values, selectedValue) {
  if (!select) {
    return;
  }
  select.innerHTML = "";
  const entries = Array.isArray(values)
    ? values.map((value) => [value, value])
    : Object.entries(values || {}).map(([label, value]) => [value, label]);
  for (const [value, label] of entries) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    option.selected = value === selectedValue || label === selectedValue;
    select.append(option);
  }
}

function renderTemplateList(select, templates) {
  select.innerHTML = "";
  for (const template of templates) {
    const option = document.createElement("option");
    option.value = template.name;
    option.textContent = `${template.name} (${template.suffix})${template.source === "custom" ? " [Custom]" : ""}`;
    option.dataset.source = template.source || "bundled";
    option.dataset.editable = template.editable ? "true" : "false";
    select.append(option);
  }
  if (select.options.length > 0) {
    select.selectedIndex = 0;
  }
}

function renderProfileFormats(payload) {
  const formats = Array.isArray(payload?.formats) ? payload.formats : [];
  const previousValue = profileFormatSelect.value;
  state.profileFormats = formats;
  profileFormatSelect.innerHTML = '<option value="">Profile Format</option>';
  for (const row of formats) {
    const name = typeof row === "string" ? row : row?.name;
    if (!name) {
      continue;
    }
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name;
    profileFormatSelect.append(option);
  }
  const availableNames = formats
    .map((row) => (typeof row === "string" ? row : row?.name))
    .filter(Boolean);
  if (availableNames.includes(previousValue)) {
    profileFormatSelect.value = previousValue;
  } else if (availableNames.length > 0) {
    profileFormatSelect.value = availableNames[0];
  } else {
    profileFormatSelect.value = "";
  }
}

function renderSummary(summary) {
  for (const [key, node] of Object.entries(summaryMap)) {
    node.textContent = summary?.[key] ?? "-";
  }
}

function renderCurrentUser(user) {
  state.currentUser = user || null;
  document.body.classList.toggle("auth-locked", !user);
  logoutButton.hidden = !user;
  if (!user) {
    currentUserLabel.textContent = "Not logged in";
    if (accessSummaryNote) {
      accessSummaryNote.textContent = "";
    }
    applyRoleAccess(null);
    return;
  }
  const limitNote = ["limited", "monthly", "yearly"].includes(user.access_mode)
    ? ` | Remaining ${user.remaining_statements ?? 0}`
    : ["time", "monthly", "yearly"].includes(user.access_mode) && user.valid_until
      ? ` | Valid until ${user.valid_until}`
      : user.access_mode === "check_only"
        ? " | Statement Check Access"
        : "";
  currentUserLabel.textContent = `${user.username} (${user.role})${limitNote}`;
  renderAccessSummary(user);
  applyRoleAccess(user);
}

function isAdminUser(user) {
  return Boolean(user && (user.can_manage_users || user.is_admin || user.role === "admin"));
}

function canUseStatements(user) {
  return Boolean(user && user.can_use_statements !== false && user.role !== "admin");
}

function applyRoleAccess(user) {
  const statementAllowed = canUseStatements(user);
  const adminAllowed = isAdminUser(user);
  const statementPanelIds = ["account-panel", "statement-panel", "texts-panel", "holidays-panel", "export-panel"];
  for (const button of document.querySelectorAll(".tab-button")) {
    if (statementPanelIds.includes(button.dataset.target || "")) {
      button.hidden = Boolean(user) && !statementAllowed;
    } else if ((button.dataset.target || "") === "admin-panel") {
      button.hidden = Boolean(user) && !adminAllowed;
    }
  }
  for (const panelId of statementPanelIds) {
    const panel = document.getElementById(panelId);
    if (panel) {
      panel.hidden = Boolean(user) && !statementAllowed;
    }
  }
  const adminPanel = document.getElementById("admin-panel");
  if (adminPanel) {
    adminPanel.hidden = Boolean(user) && !adminAllowed;
  }
  const statementActionIds = [
    "save-profile-format-btn",
    "edit-profile-format-btn",
    "delete-profile-format-btn",
    "load-profile-format-btn",
    "selftest-btn",
    "create-stat-btn",
    "import-statement-btn",
    "validate-statement-btn",
    "edit-statement-btn",
    "update-statement-btn",
    "cancel-edit-btn",
  ];
  for (const id of statementActionIds) {
    const node = document.getElementById(id);
    if (node) {
      node.hidden = Boolean(user) && !statementAllowed;
    }
  }
  if (user && adminAllowed && !statementAllowed) {
    setTab("admin-panel");
  } else if (user && document.querySelector(".form-panel.is-active")?.hidden) {
    setTab("account-panel");
  }
}

function renderAccessSummary(user, liveRate = null) {
  if (!accessSummaryNote) {
    return;
  }
  if (!user) {
    accessSummaryNote.textContent = "";
    return;
  }
  const fragments = [];
  if (["limited", "monthly", "yearly"].includes(user.access_mode)) {
    fragments.push(`Remaining statements: ${user.remaining_statements ?? 0}`);
  }
  if (["time", "monthly", "yearly"].includes(user.access_mode) && user.valid_until) {
    fragments.push(`Account expires: ${user.valid_until}`);
  }
  if (user.access_mode === "check_only") {
    fragments.push("Access: Statement Check only");
  }
  if (liveRate?.rate && liveRate?.source_date) {
    fragments.push(`NRB sell rate: ${Number(liveRate.rate).toFixed(4)} on ${liveRate.source_date}`);
  }
  accessSummaryNote.textContent = fragments.join(" | ");
}

function renderActivities(payload) {
  if (!activitiesBody) {
    return;
  }
  activitiesBody.innerHTML = "";
  for (const row of payload?.activities || []) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(row.created_at || "")}</td>
      <td>${escapeHtml(row.username || "")}</td>
      <td>${escapeHtml(row.action || "")}</td>
      <td>${escapeHtml(row.details || "")}</td>
    `;
    activitiesBody.append(tr);
  }
}

function setPasswordInputVisibility(input, toggle) {
  if (!(input instanceof HTMLInputElement) || !(toggle instanceof HTMLButtonElement)) {
    return;
  }
  const nextType = input.type === "password" ? "text" : "password";
  input.type = nextType;
  toggle.textContent = nextType === "password" ? "Show" : "Hide";
}

function requestPassword(title, message) {
  return new Promise((resolve, reject) => {
    pendingPasswordResolver = { resolve, reject };
    passwordModalTitle.textContent = title;
    passwordModalMessage.textContent = message;
    passwordModalError.textContent = "";
    passwordModalInput.value = "";
    passwordModalInput.type = "password";
    passwordModalInput.placeholder = "";
    passwordModalToggle.hidden = false;
    passwordModalToggle.textContent = "Show";
    passwordModalOverlay.classList.add("is-visible");
    passwordModalInput.focus();
  });
}

function requestModalValue(title, message, options = {}) {
  return new Promise((resolve, reject) => {
    pendingPasswordResolver = { resolve, reject };
    passwordModalTitle.textContent = title;
    passwordModalMessage.textContent = message;
    passwordModalError.textContent = "";
    passwordModalInput.value = options.defaultValue ?? "";
    passwordModalInput.type = options.type || "text";
    passwordModalInput.placeholder = options.placeholder || "";
    passwordModalToggle.hidden = options.type !== "password";
    passwordModalToggle.textContent = "Show";
    passwordModalOverlay.classList.add("is-visible");
    passwordModalInput.focus();
    passwordModalInput.select();
  });
}

function closePasswordModal(cancelled = false) {
  if (pendingPasswordResolver) {
    const resolver = pendingPasswordResolver;
    pendingPasswordResolver = null;
    passwordModalOverlay.classList.remove("is-visible");
    const value = passwordModalInput.value;
    passwordModalInput.value = "";
    passwordModalInput.placeholder = "";
    passwordModalInput.type = "password";
    passwordModalToggle.hidden = false;
    passwordModalToggle.textContent = "Show";
    if (cancelled) {
      resolver.reject(new Error("Entry was cancelled."));
    } else {
      resolver.resolve(value);
    }
  } else {
    passwordModalOverlay.classList.remove("is-visible");
  }
}

function setLoginVisible(isVisible) {
  const shouldLock = Boolean(isVisible || !state.currentUser);
  document.body.classList.toggle("auth-locked", shouldLock);
  loginOverlay.classList.toggle("is-visible", shouldLock);
  if (shouldLock && window.location.hash === "#login-username") {
    document.getElementById("login-username")?.focus();
  }
}

function setTab(targetId) {
  for (const button of document.querySelectorAll(".tab-button")) {
    button.classList.toggle("is-active", button.dataset.target === targetId);
  }
  for (const panel of document.querySelectorAll(".form-panel")) {
    panel.classList.toggle("is-active", panel.id === targetId);
  }
}

function updateManualRateState() {
  const rateMode = form.querySelector('[name="rate_mode"]').value;
  const manualRate = form.querySelector('[name="manual_rate"]');
  manualRate.disabled = rateMode !== "Manual";
}

function updateRowCountState() {
  const mode = statementRowMode?.value || "auto";
  if (statementRowCountField) {
    statementRowCountField.hidden = mode !== "custom";
  }
}

function updatePrependStatementState() {
  const enabled = normalizeYesNo(prependStatementMode?.value, false);
  for (const field of [prependStartDateField, prependAnchorDateField, prependAnchorBalanceField]) {
    if (field) {
      field.hidden = !enabled;
    }
  }
}

function getProfileDraftValues() {
  updateMonthlyTransactionCountsValue();
  const values = {};
  for (const element of document.querySelectorAll("#account-panel [name], #statement-panel [name], #texts-panel [name]")) {
    values[element.name] = element.value;
  }
  return values;
}

function shouldShowChequeColumn() {
  return normalizeYesNo(form.querySelector('[name="include_cheque_column"]').value, true);
}

function statementDateColumnMode() {
  return form.querySelector('[name="date_column_mode"]')?.value === "txn_value" ? "txn_value" : "single";
}

function updatePreviewTableLayout() {
  const includeCheque = shouldShowChequeColumn();
  const dateHeaders = statementDateColumnMode() === "txn_value"
    ? "<th>TXN Date</th><th>Value Date</th>"
    : "<th>Date</th>";
  previewHeadRow.innerHTML = includeCheque
    ? `${dateHeaders}<th>Description</th><th>Cheque No.</th><th>Debit</th><th>Credit</th><th>Balance</th>`
    : `${dateHeaders}<th>Description</th><th>Debit</th><th>Credit</th><th>Balance</th>`;
  renderPreviewRows(currentPreviewRows());
}

function setHolidayView(view) {
  state.holidayView = view;
  for (const button of document.querySelectorAll(".view-button")) {
    button.classList.toggle("is-active", button.dataset.view === view);
  }
}

function clearCurrentStatement() {
  state.generatedSeed = "";
  state.currentStatement = null;
  state.currentStatementId = null;
  state.currentStatementSource = "generated";
  state.statementEditMode = false;
  state.editableRows = [];
  state.validationErrors = [];
  renderSummary({
    final_balance_text: "-",
    issue_date: "-",
    row_count: "-",
    target_gap_text: "-",
    total_deposits_text: "-",
    total_withdrawals_text: "-",
    total_interest_text: "-",
    total_tax_text: "-",
    seed_used: "-",
  });
  renderPreviewRows([]);
  renderValidationResults([]);
  updatePreviewControls();
}

function currentPreviewRows() {
  if (!state.currentStatement) {
    return [];
  }
  return state.statementEditMode ? state.editableRows : state.currentStatement.rows;
}

function updatePreviewControls() {
  const hasStatement = Boolean(state.currentStatement && Array.isArray(state.currentStatement.rows) && state.currentStatement.rows.length > 0);
  editStatementButton.disabled = !hasStatement || state.statementEditMode;
  updateStatementButton.disabled = !state.statementEditMode;
  cancelEditButton.disabled = !state.statementEditMode;
  previewEditNote.hidden = !state.statementEditMode;
  validateStatementButton.disabled = !hasStatement;
}

function renderPreviewRows(rows) {
  const includeCheque = shouldShowChequeColumn();
  const hasTwoDateColumns = statementDateColumnMode() === "txn_value";
  previewBody.innerHTML = "";
  const validationMap = new Map();
  const fieldValidationMap = new Map();
  for (const error of state.validationErrors) {
    const key = Number(error.row_index);
    if (!validationMap.has(key)) {
      validationMap.set(key, []);
    }
    validationMap.get(key).push(error.message);
    if (!fieldValidationMap.has(key)) {
      fieldValidationMap.set(key, new Set());
    }
    for (const field of error.fields || []) {
      fieldValidationMap.get(key).add(String(field));
    }
  }
  for (const [index, row] of rows.entries()) {
    const tr = document.createElement("tr");
    if (row.is_system) {
      tr.classList.add("system-row");
    }
    if (validationMap.has(index)) {
      tr.classList.add("has-error");
      tr.title = validationMap.get(index).join(" | ");
    }
    const editable = state.statementEditMode && !["interest", "tax"].includes(String(row.category || ""));
    const amountEditable = editable && ["deposit", "withdrawal"].includes(String(row.category || ""));
    const fieldErrors = fieldValidationMap.get(index) || new Set();
    const inputClass = (base, field) => fieldErrors.has(field) ? `${base} input-has-error` : base;
    const textClass = (field) => fieldErrors.has(field) ? "cell-error-text" : "";

    const dateCell = editable
      ? `<input type="date" class="${inputClass("table-input", "date")}" data-row-index="${index}" data-field="date" value="${escapeHtml(row.date || "")}">`
      : `<span class="${textClass("date")}">${escapeHtml(row.date || "")}</span>`;
    const valueDateCell = editable
      ? `<input type="date" class="${inputClass("table-input", "date")}" data-row-index="${index}" data-field="date" value="${escapeHtml(row.value_date || row.date || "")}">`
      : `<span class="${textClass("date")}">${escapeHtml(row.value_date || row.date || "")}</span>`;
    const dateCells = hasTwoDateColumns ? `<td>${dateCell}</td><td>${valueDateCell}</td>` : `<td>${dateCell}</td>`;
    const descriptionCell = editable
      ? `<input type="text" class="${inputClass("table-input", "description")}" data-row-index="${index}" data-field="description" value="${escapeHtml(row.description || "")}">`
      : `<span class="${textClass("description")}">${escapeHtml(row.description || "")}</span>`;
    const chequeCell = includeCheque
      ? (editable
          ? `<input type="text" class="${inputClass("table-input", "cheque_no")}" data-row-index="${index}" data-field="cheque_no" value="${escapeHtml(row.cheque_no || "")}">`
          : `<span class="${textClass("cheque_no")}">${escapeHtml(row.cheque_no || "")}</span>`)
      : "";
    const debitCell = amountEditable
      ? `<input type="number" step="0.01" class="${inputClass("table-money-input", "debit")}" data-row-index="${index}" data-field="debit" value="${Number(row.debit ?? 0).toFixed(2)}">`
      : `<span class="${textClass("debit")}">${escapeHtml(row.debit_text || "")}</span>`;
    const creditCell = amountEditable
      ? `<input type="number" step="0.01" class="${inputClass("table-money-input", "credit")}" data-row-index="${index}" data-field="credit" value="${Number(row.credit ?? 0).toFixed(2)}">`
      : `<span class="${textClass("credit")}">${escapeHtml(row.credit_text || "")}</span>`;
    const balanceCell = `<span class="${textClass("balance")}">${escapeHtml(row.balance_text || "")}</span>`;

    tr.innerHTML = includeCheque
      ? `${dateCells}<td>${descriptionCell}</td><td>${chequeCell}</td><td class="amount-cell">${debitCell}</td><td class="amount-cell">${creditCell}</td><td class="amount-cell">${balanceCell}</td>`
      : `${dateCells}<td>${descriptionCell}</td><td class="amount-cell">${debitCell}</td><td class="amount-cell">${creditCell}</td><td class="amount-cell">${balanceCell}</td>`;
    previewBody.append(tr);
  }
}

function renderValidationResults(errors) {
  state.validationErrors = Array.isArray(errors) ? errors : [];
  validationErrorsNode.innerHTML = "";
  if (!state.validationErrors.length) {
    validationPanel.hidden = true;
    renderPreviewRows(currentPreviewRows());
    return;
  }
  validationPanel.hidden = false;
  for (const error of state.validationErrors) {
    const row = document.createElement("div");
    row.className = "validation-entry";
    const rowLabel = `Row ${Number(error.row_index) + 1}`;
    row.textContent = `${rowLabel}: ${error.message}`;
    validationErrorsNode.append(row);
  }
  renderPreviewRows(currentPreviewRows());
}

function clearValidationResults() {
  state.validationErrors = [];
  validationErrorsNode.innerHTML = "";
  validationPanel.hidden = true;
  for (const row of previewBody.querySelectorAll("tr.has-error")) {
    row.classList.remove("has-error");
    row.removeAttribute("title");
  }
}

function setCurrentStatement(formValues, resultPayload, options = {}) {
  state.currentStatement = cloneData(resultPayload);
  state.currentStatementId = resultPayload.statement_id ?? null;
  state.currentStatementSource = resultPayload.source_type || "generated";
  state.generatedSeed = String(resultPayload.generated_seed ?? "");
  state.statementEditMode = false;
  state.editableRows = [];
  state.validationErrors = [];
  renderSummary(resultPayload.summary || {});
  if (options.syncForm !== false) {
    applyFormValues(formValues);
  }
  renderPreviewRows(resultPayload.rows || []);
  renderValidationResults([]);
  updatePreviewControls();
}

function enableStatementEditMode() {
  if (!state.currentStatement) {
    throw new Error("Generate, import, or load a statement first.");
  }
  state.statementEditMode = true;
  state.editableRows = cloneData(state.currentStatement.rows || []);
  state.validationErrors = [];
  renderPreviewRows(state.editableRows);
  renderValidationResults([]);
  updatePreviewControls();
}

function cancelStatementEditMode() {
  state.statementEditMode = false;
  state.editableRows = [];
  state.validationErrors = [];
  renderPreviewRows(state.currentStatement?.rows || []);
  renderValidationResults([]);
  updatePreviewControls();
}

function syncEditableField(index, field, value) {
  const row = state.editableRows[index];
  if (!row) {
    return false;
  }
  clearValidationResults();

  if (field === "debit" || field === "credit") {
    const amount = parseMoneyInput(value);
    const oppositeField = field === "debit" ? "credit" : "debit";
    const oppositeAmount = parseMoneyInput(row[oppositeField] ?? 0);
    if (amount > 0 && oppositeAmount > 0) {
      appendLog("A row can have only one amount. Clear the existing debit or credit first before switching that transaction type.", "error");
      return false;
    }
    row[field] = amount;
    row[`${field}_text`] = moneyText(amount);
    if (field === "debit" && amount > 0) {
      row.credit = 0;
      row.credit_text = "";
      row.category = "withdrawal";
    } else if (field === "credit" && amount > 0) {
      row.debit = 0;
      row.debit_text = "";
      row.category = "deposit";
    }
    if (amount <= 0 && row.debit <= 0 && row.credit <= 0) {
      row.debit = 0;
      row.credit = 0;
      row.debit_text = "";
      row.credit_text = "";
    }
    return true;
  }

  row[field] = value;
  return true;
}

function renderHolidayPayload(payload) {
  const rows = payload.rows || [];
  if (state.selectedHoliday && !rows.some((row) =>
    row.date === state.selectedHoliday.date && row.type === state.selectedHoliday.type)) {
    state.selectedHoliday = null;
  }
  const editable = state.selectedHoliday?.type === "Holiday";
  document.getElementById("holiday-update-btn").disabled = !editable;
  document.getElementById("holiday-delete-btn").disabled = !editable;
  const periodLabel = payload.period.start_date && payload.period.end_date
    ? `Period: ${payload.period.start_date} to ${payload.period.end_date}`
    : "Enter a valid statement period to show weekends.";
  holidaySummary.textContent =
    `${periodLabel} | Holidays: ${payload.counts.holidays} | Sundays: ${payload.counts.sundays ?? 0} | Active Saturdays: ${payload.counts.saturdays} | Showing: ${payload.counts.showing}`;

  holidayBody.innerHTML = "";
  for (const row of payload.rows || []) {
    const tr = document.createElement("tr");
    if (state.selectedHoliday && state.selectedHoliday.date === row.date && state.selectedHoliday.type === row.type) {
      tr.classList.add("is-selected");
    }
    tr.innerHTML = `<td>${escapeHtml(row.date)}</td><td>${escapeHtml(row.type)}</td>`;
    tr.addEventListener("click", () => {
      state.selectedHoliday = { date: row.date, type: row.type };
      document.getElementById("holiday-date").value = row.date;
      document.getElementById("holiday-type").value = "Holiday";
      renderHolidayPayload(payload);
    });
    holidayBody.append(tr);
  }
}

function openProfileFormatEditor(mode = "create") {
  state.profileFormatEditorMode = mode;
  state.profileFormatEditOriginalName = profileFormatSelect.value || "";
  profileFormatEditor.dataset.mode = mode;
  profileFormatEditor.dataset.originalName = state.profileFormatEditOriginalName;
  if (mode === "edit") {
    if (!state.profileFormatEditOriginalName) {
      throw new Error("Select a saved profile format first.");
    }
    profileFormatNameInput.value = state.profileFormatEditOriginalName;
  } else {
    profileFormatNameInput.value = profileFormatSelect.value || "";
  }
  profileFormatEditor.hidden = false;
  profileFormatNameInput.focus();
  profileFormatNameInput.select();
}

function closeProfileFormatEditor() {
  profileFormatEditor.hidden = true;
  profileFormatNameInput.value = "";
  state.profileFormatEditorMode = "create";
  state.profileFormatEditOriginalName = "";
  profileFormatEditor.dataset.mode = "create";
  profileFormatEditor.dataset.originalName = "";
}

function renderPostingPayload(payload) {
  const rows = payload?.rows || [];
  state.postingRows = rows;
  postingSummary.textContent = rows.length > 0
    ? `Quarter posting dates loaded: ${rows.length}. Default rows follow built-in rules unless you create a custom date.`
    : "Enter a valid statement period to load interest and tax posting dates.";

  postingBody.innerHTML = "";
  postingPeriodSelect.innerHTML = "";
  for (const option of payload?.period_options || []) {
    const node = document.createElement("option");
    node.value = option.period_key;
    node.textContent = option.label;
    postingPeriodSelect.append(node);
  }

  const selectedPeriodKey = state.selectedPosting?.period_key
    || payload?.selected_period_key
    || payload?.period_options?.[0]?.period_key
    || "";
  if (selectedPeriodKey !== "") {
    postingPeriodSelect.value = selectedPeriodKey;
  }

  rows.forEach((row) => {
    const tr = document.createElement("tr");
    if (state.selectedPosting && state.selectedPosting.period_key === row.period_key) {
      tr.classList.add("is-selected");
    }
    tr.innerHTML = `<td>${escapeHtml(row.label)}</td><td>${escapeHtml(row.date)}</td><td>${escapeHtml(row.source)}</td>`;
    tr.addEventListener("click", () => {
      state.selectedPosting = row;
      postingPeriodSelect.value = row.period_key;
      postingDateInput.value = row.date;
      renderPostingPayload(payload);
    });
    postingBody.append(tr);
  });

  if (!state.selectedPosting && rows.length > 0) {
    state.selectedPosting = rows[0];
    postingPeriodSelect.value = rows[0].period_key;
    postingDateInput.value = rows[0].date;
  } else if (state.selectedPosting) {
    postingDateInput.value = state.selectedPosting.date;
  } else {
    postingDateInput.value = "";
  }
}

function renderHistoryPanel(payload) {
  const history = payload?.history || [];
  const counts = payload?.counts || [];
  const selectedUsername = payload?.selected_username || "";
  state.selectedHistoryUserId = payload?.selected_user_id ? String(payload.selected_user_id) : "";

  historyBody.innerHTML = "";
  for (const row of history) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${row.id}</td>
      <td>${escapeHtml(row.username || "")}</td>
      <td>${escapeHtml(row.customer_name || "")}</td>
      <td>${escapeHtml(`${row.start_date} to ${row.end_date}`)}</td>
      <td>${escapeHtml(row.issue_date || "")}</td>
      <td>${row.row_count}</td>
      <td>${escapeHtml(row.final_balance_text || "")}</td>
      <td>${escapeHtml(String(row.seed ?? ""))}</td>
      <td>${escapeHtml(row.updated_at || row.created_at || "")}</td>
      <td>
        <button type="button" class="ghost-button compact-button table-action-button" data-history-action="load" data-history-id="${row.id}">Load & Edit</button>
        <button type="button" class="ghost-button compact-button table-action-button" data-history-action="delete" data-history-id="${row.id}">Delete</button>
      </td>
    `;
    historyBody.append(tr);
  }

  countsBody.innerHTML = "";
  for (const row of counts) {
    const tr = document.createElement("tr");
    const remaining = row.remaining_statements === null || row.remaining_statements === undefined ? "-" : row.remaining_statements;
    tr.innerHTML = `<td>${escapeHtml(row.username)}</td><td>${row.statement_count}</td><td>${escapeHtml(row.access_mode || "")}</td><td>${remaining}</td>`;
    countsBody.append(tr);
  }

  historyFilterLabel.textContent = selectedUsername
    ? `Showing statement history for ${selectedUsername}.`
    : isAdminUser(state.currentUser)
      ? "Showing statement history for all users."
      : "Showing statement history for your account.";
  historyTotalLabel.textContent = history.length > 0
    ? `${payload.total_statements || history.length} saved statement record(s) in this view.`
    : "No saved statements are in this view yet.";
}

function populateManagedUserFields(user) {
  if (!user) {
    document.getElementById("manage-user-access-mode").value = "unlimited";
    document.getElementById("manage-user-remaining-statements").value = "";
    document.getElementById("manage-user-valid-until").value = "";
    return;
  }
  document.getElementById("manage-user-access-mode").value = user.access_mode || "unlimited";
  document.getElementById("manage-user-remaining-statements").value = user.remaining_statements ?? "";
  document.getElementById("manage-user-valid-until").value = user.valid_until || "";
}

function managedUserSearchText() {
  return String(manageUserSearch?.value || "").trim().toLowerCase();
}

function userMatchesManagedSearch(user, query = managedUserSearchText()) {
  if (!query) {
    return true;
  }
  return [
    user.username,
    user.full_name,
    user.mobile_number,
    user.email,
    user.role,
    user.access_mode,
  ].some((value) => String(value || "").toLowerCase().includes(query));
}

function filteredManagedUsers(users) {
  const query = managedUserSearchText();
  if (!query) {
    return users || [];
  }
  return (users || []).filter((user) => userMatchesManagedSearch(user, query));
}

function renderUsers(users) {
  usersBody.innerHTML = "";
  const createCard = document.getElementById("admin-create-card");
  const manageCard = document.getElementById("admin-manage-card");
  const usersCard = document.getElementById("admin-users-card");
  const canManageUsers = isAdminUser(state.currentUser);
  createCard.style.display = canManageUsers ? "" : "none";
  manageCard.style.display = canManageUsers ? "" : "none";
  usersCard.style.display = canManageUsers ? "" : "none";

  state.users = users || [];
  const selectedUser = state.users.find((user) => String(user.id) === state.selectedManagedUserId) || null;
  const visibleUsers = filteredManagedUsers(state.users);
  renderManageUserSelect(state.users);
  populateManagedUserFields(selectedUser);

  for (const user of visibleUsers) {
    const tr = document.createElement("tr");
    tr.dataset.userId = String(user.id);
    if (state.selectedManagedUserId === String(user.id)) {
      tr.classList.add("is-selected");
    }
    const remaining = user.remaining_statements ?? "-";
    tr.innerHTML = `
      <td>${escapeHtml(user.username)}</td>
      <td>${escapeHtml(user.full_name || "")}</td>
      <td>${escapeHtml(user.mobile_number || "")}</td>
      <td>${escapeHtml(user.role)}</td>
      <td>${escapeHtml(user.access_mode || "unlimited")}</td>
      <td>${escapeHtml(String(remaining))}</td>
      <td>${escapeHtml(user.valid_until || "-")}</td>
      <td>${escapeHtml(String(user.active_device_count ?? 0))}/${escapeHtml(String(user.device_limit ?? 2))}</td>
      <td>${escapeHtml(user.created_at || "")}</td>
    `;
    tr.addEventListener("click", () => {
      state.selectedManagedUserId = String(user.id);
      manageUserSelect.value = state.selectedManagedUserId;
      renderUsers(state.users);
      refreshDevices(state.selectedManagedUserId).catch(showAsyncError);
    });
    usersBody.append(tr);
  }
}

function renderManageUserSelect(users) {
  manageUserSelect.innerHTML = "";
  const visibleUsers = filteredManagedUsers(users);
  const selectedUser = (users || []).find((user) => String(user.id) === state.selectedManagedUserId) || null;
  const optionUsers = selectedUser && !visibleUsers.some((user) => String(user.id) === String(selectedUser.id))
    ? [selectedUser, ...visibleUsers]
    : visibleUsers;
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = managedUserSearchText()
    ? `Select a user (${visibleUsers.length} found)`
    : "Select a user";
  manageUserSelect.append(placeholder);
  for (const user of optionUsers) {
    const option = document.createElement("option");
    option.value = String(user.id);
    option.textContent = `${user.username}${user.full_name ? ` - ${user.full_name}` : ""} (${user.role})`;
    option.selected = state.selectedManagedUserId === String(user.id);
    manageUserSelect.append(option);
  }
  if (state.selectedManagedUserId === "") {
    manageUserSelect.value = "";
  }
}

function selectedManagedUser() {
  const selectedId = manageUserSelect.value || state.selectedManagedUserId;
  if (!selectedId) {
    throw new Error("Select a user first.");
  }
  const user = state.users.find((item) => String(item.id) === String(selectedId));
  if (!user) {
    throw new Error("Select a valid user first.");
  }
  return user;
}

function renderDevices(payload) {
  state.devicesPayload = payload || { devices: [], target_user_id: null, target_username: "" };
  devicesBody.innerHTML = "";
  state.selectedDeviceId = "";

  const targetName = payload?.target_username || state.currentUser?.username || "current user";
  deviceTargetLabel.textContent = `Saved device serials for ${targetName}. Remove an old device to free a login slot on another device.`;

  for (const device of payload?.devices || []) {
    const tr = document.createElement("tr");
    tr.dataset.deviceId = device.device_id;
    if (state.selectedDeviceId === device.device_id) {
      tr.classList.add("is-selected");
    }
    tr.innerHTML = `
      <td>${escapeHtml(device.device_id)}</td>
      <td>${escapeHtml(device.device_label || "")}</td>
      <td>${escapeHtml(device.created_at || "")}</td>
      <td>${escapeHtml(device.last_login_at || "")}</td>
    `;
    tr.addEventListener("click", () => {
      state.selectedDeviceId = device.device_id;
      renderDevices(payload);
      state.selectedDeviceId = device.device_id;
      const selectedRow = [...devicesBody.querySelectorAll("tr")].find((row) => row.dataset.deviceId === device.device_id);
      if (selectedRow) {
        selectedRow.classList.add("is-selected");
      }
    });
    devicesBody.append(tr);
  }
}

async function refreshHolidayRows(view = state.holidayView) {
  setHolidayView(view);
  const values = getFormValues();
  const payload = await fetchJson(apiUrl("holidays", {
    start_date: values.start_date,
    end_date: values.end_date,
    view,
  }), { method: "GET" });
  renderHolidayPayload(payload);
}

async function refreshPostingDates() {
  const values = getFormValues();
  const payload = await fetchJson(apiUrl("posting_dates", {
    start_date: values.start_date,
    end_date: values.end_date,
  }), { method: "GET" });
  renderPostingPayload(payload);
}

async function autoRefreshInternetData() {
  const values = getFormValues();
  const payload = await fetchJson(apiUrl("auto_refresh", {
    start_date: values.start_date,
    end_date: values.end_date,
  }), { method: "GET" });
  if (payload.current_user) {
    renderCurrentUser(payload.current_user);
  }
  renderAccessSummary(payload.current_user || state.currentUser, payload.live_rate || null);
  if (payload.holidays) {
    renderHolidayPayload(payload.holidays);
  }
  if (payload.posting_dates) {
    renderPostingPayload(payload.posting_dates);
  }
  appendLog(
    payload.refresh?.skipped
      ? "Using cached posting dates and NRB exchange rate."
      : "Posting dates and NRB exchange rate refresh completed."
  );
}

async function refreshDevices(targetUserId = null) {
  const effectiveTarget = isAdminUser(state.currentUser)
    ? (targetUserId || state.selectedManagedUserId || state.currentUser?.id || "")
    : (state.currentUser?.id || "");
  const payload = await fetchJson(apiUrl("devices", effectiveTarget ? { user_id: effectiveTarget } : null), { method: "GET" });
  renderDevices(payload);
}

async function refreshActivities(targetUserId = null) {
  if (!isAdminUser(state.currentUser)) {
    renderActivities({ activities: [] });
    return;
  }
  const effectiveTarget = targetUserId || state.selectedHistoryUserId || state.selectedManagedUserId || "";
  const payload = await fetchJson(apiUrl("activities", effectiveTarget ? { user_id: effectiveTarget } : null), { method: "GET" });
  renderActivities(payload);
}

async function handleHolidayAction(action) {
  const values = getFormValues();
  const holidayDate = document.getElementById("holiday-date").value;
  const holidayType = document.getElementById("holiday-type").value;
  if ((action === "update" || action === "delete") && state.selectedHoliday?.type !== "Holiday") {
    throw new Error("Select a manual holiday. Recurring Saturdays and Sundays cannot be changed.");
  }
  if (action !== "delete" && !holidayDate) {
    throw new Error("Choose a holiday date first.");
  }
  const password = await requestPassword("Holiday Update", "Enter your account password to change manual holidays.");
  if (!password) {
    throw new Error("Holiday change was cancelled.");
  }
  const payload = {
    action,
    date: holidayDate,
    type: holidayType,
    view: state.holidayView,
    start_date: values.start_date,
    end_date: values.end_date,
    password,
  };

  if (action === "update" || action === "delete") {
    if (!state.selectedHoliday) {
      throw new Error("Select a manual holiday first.");
    }
    payload.original_date = state.selectedHoliday.date;
    payload.original_type = state.selectedHoliday.type;
    if (action === "delete") {
      payload.date = state.selectedHoliday.date;
      payload.type = state.selectedHoliday.type;
    }
  }

  const result = await fetchJson(apiUrl("holidays"), {
    method: "POST",
    body: JSON.stringify(payload),
  });
  if (action === "add" || action === "update") {
    state.selectedHoliday = { date: holidayDate, type: "Holiday" };
  }
  if (action === "delete") {
    state.selectedHoliday = null;
    document.getElementById("holiday-date").value = "";
    document.getElementById("holiday-type").value = "Holiday";
  }
  closeInlinePrintPreview();
  renderHolidayPayload(result);
}

async function handlePostingDateAction(action) {
  const values = getFormValues();
  const password = await requestPassword("Interest & Tax Date Update", "Enter your account password to change interest and tax dates.");
  if (!password) {
    throw new Error("Interest and tax date change was cancelled.");
  }
  const selectedPeriodKey = postingPeriodSelect.value || state.selectedPosting?.period_key || "";
  if (!selectedPeriodKey) {
    throw new Error("Select a quarter period first.");
  }
  const payload = {
    action,
    period_key: selectedPeriodKey,
    date: postingDateInput.value,
    start_date: values.start_date,
    end_date: values.end_date,
    password,
  };
  const result = await fetchJson(apiUrl("posting_dates"), {
    method: "POST",
    body: JSON.stringify(payload),
  });
  const selectedRow = (result.rows || []).find((row) => row.period_key === selectedPeriodKey) || result.rows?.[0] || null;
  state.selectedPosting = selectedRow;
  renderPostingPayload(result);
}

async function syncPostingDatesFromHamroPatro() {
  const values = getFormValues();
  const password = await requestPassword("Interest & Tax Auto Update", "Enter your account password to update interest and tax dates automatically.");
  if (!password) {
    throw new Error("Interest and tax date auto update was cancelled.");
  }
  const result = await fetchJson(apiUrl("posting_dates_sync"), {
    method: "POST",
    body: JSON.stringify({
      start_date: values.start_date,
      end_date: values.end_date,
      password,
    }),
  });
  renderPostingPayload(result);
  appendLog("Interest and tax dates were refreshed automatically from Hamro Patro month-end dates.");
}

async function refreshTemplates() {
  const payload = await fetchJson(apiUrl("templates"), {
    method: "POST",
    body: JSON.stringify({}),
  });
  state.templates = payload;
  renderTemplateList(document.getElementById("statement-template-list"), payload.statement_templates || []);
  renderTemplateList(document.getElementById("certificate-template-list"), payload.certificate_templates || []);
  appendLog(
    `Loaded ${payload.statement_templates.length} statement templates and ${payload.certificate_templates.length} certificate templates from ${payload.template_dir}.`
  );
}

async function uploadTemplateFormat() {
  const kind = document.getElementById("template-manage-kind").value;
  const name = document.getElementById("template-manage-name").value.trim();
  const fileInput = document.getElementById("template-manage-file");
  const file = fileInput.files?.[0];
  if (!file) {
    throw new Error("Select a format file first.");
  }
  const body = new FormData();
  body.append("kind", kind);
  body.append("name", name);
  body.append("template_file", file);
  body.append("profile_json", JSON.stringify(getFormValues()));
  const payload = await fetchJson(apiUrl("template_upload"), {
    method: "POST",
    body,
    headers: {},
  });
  state.templates = payload.templates;
  renderTemplateList(document.getElementById("statement-template-list"), payload.templates.statement_templates || []);
  renderTemplateList(document.getElementById("certificate-template-list"), payload.templates.certificate_templates || []);
  const uploadedList = kind === "statement"
    ? document.getElementById("statement-template-list")
    : document.getElementById("certificate-template-list");
  uploadedList.value = payload.saved_template.name;
  document.getElementById("template-manage-name").value = "";
  fileInput.value = "";
  appendLog(`Saved custom ${payload.saved_template.kind} format ${payload.saved_template.name}.`);
  await loadTemplateDetail(true);
}

function selectedTemplateOption(kind) {
  const select = kind === "statement"
    ? document.getElementById("statement-template-list")
    : document.getElementById("certificate-template-list");
  return select.options[select.selectedIndex] || null;
}

async function deleteSelectedTemplate() {
  const kind = document.getElementById("template-manage-kind").value;
  const option = selectedTemplateOption(kind);
  if (!option) {
    throw new Error("Select a format first.");
  }
  const sourceLabel = option.dataset.source === "custom" ? "custom" : "default";
  const confirmed = window.confirm(`Delete the ${sourceLabel} format ${option.value}?`);
  if (!confirmed) {
    throw new Error("Format delete was cancelled.");
  }
  const values = getFormValues();
  const payload = await fetchJson(apiUrl("template_delete"), {
    method: "POST",
    body: JSON.stringify({ kind, name: option.value, template_dir: values.template_dir }),
  });
  state.templates = payload.templates;
  renderTemplateList(document.getElementById("statement-template-list"), payload.templates.statement_templates || []);
  renderTemplateList(document.getElementById("certificate-template-list"), payload.templates.certificate_templates || []);
  appendLog(`Deleted ${payload.source || sourceLabel} ${kind} format ${option.value}.`);
}

function selectedTemplateNameAndKind() {
  const kind = document.getElementById("template-manage-kind").value;
  const option = selectedTemplateOption(kind);
  if (!option) {
    throw new Error("Select a format first.");
  }
  return { kind, name: option.value, option };
}

async function loadTemplateDetail(openEditor = true) {
  const { kind, name } = selectedTemplateNameAndKind();
  const values = getFormValues();
  const detail = await fetchJson(apiUrl("template_detail"), {
    method: "POST",
    body: JSON.stringify({ kind, name, template_dir: values.template_dir }),
  });
  state.templateEditorDetail = detail;
  renderTemplateEditor(detail);
  renderVisualFormatWorkspace(detail);
  if (openEditor && formatWorkspacePanel) {
    formatWorkspacePanel.hidden = false;
    formatWorkspacePanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
    if (templateEditorPanel) {
      templateEditorPanel.hidden = true;
    }
  }
  return detail;
}

function applyTemplateProfile(detail) {
  if (!detail?.profile || typeof detail.profile !== "object" || Object.keys(detail.profile).length === 0) {
    return false;
  }
  applyFormValues(detail.profile);
  saveDraftProfile(true).catch(() => {});
  appendLog(`Loaded account, rules, texts, and names saved with ${detail.name}.`);
  return true;
}

function renderTemplateEditor(detail) {
  if (!templateEditorPanel || !templateScanSummary || !templateItemSelect) {
    return;
  }
  const scan = detail?.scan || {};
  const summary = scan.summary || {};
  const items = Array.isArray(scan.items) ? scan.items : [];
  templateScanSummary.textContent = [
    `${detail?.name || "Selected format"} (${detail?.suffix || ""})`,
    `${summary.active_cell_count ?? 0} active cells`,
    `${summary.text_block_count ?? 0} text blocks`,
    detail?.editable ? "custom editable format" : "read-only format",
    summary.warning || "",
  ].filter(Boolean).join(" | ");
  templateItemSelect.innerHTML = "";
  for (const item of items) {
    const option = document.createElement("option");
    option.value = item.key;
    const text = String(item.text || "").replace(/\s+/g, " ").slice(0, 90);
    option.textContent = `${item.label || item.address || item.key}: ${text || "(blank)"}`;
    templateItemSelect.append(option);
  }
  if (templateItemSelect.options.length > 0) {
    templateItemSelect.selectedIndex = 0;
    fillTemplateItemControls(items[0]);
  } else {
    fillTemplateItemControls(null);
  }
  const saveButton = document.getElementById("template-item-save-btn");
  if (saveButton) {
    saveButton.disabled = !detail?.editable || items.length === 0;
  }
}

function selectedTemplateEditorItem() {
  const detail = state.templateEditorDetail;
  const items = Array.isArray(detail?.scan?.items) ? detail.scan.items : [];
  const key = templateItemSelect?.value || "";
  return items.find((item) => item.key === key) || (state.formatWorkspaceVirtualItem?.key === key ? state.formatWorkspaceVirtualItem : null);
}

function fillTemplateItemControls(item) {
  const style = item?.style || {};
  if (templateItemText) {
    templateItemText.value = item?.text || "";
  }
  if (templateItemAlign) {
    templateItemAlign.value = normalizeHorizontalAlign(style.horizontal || style.alignment || style["text-align"] || "");
  }
  if (templateItemVertical) {
    templateItemVertical.value = normalizeVerticalAlign(style.vertical || style["vertical-align"] || "");
  }
  if (templateItemFontSize) {
    templateItemFontSize.value = style.font_size || "";
  }
  if (templateItemNumberFormat) {
    templateItemNumberFormat.value = style.number_format || "";
  }
  if (templateItemBold) {
    templateItemBold.value = style.bold === true ? "true" : style.bold === false ? "false" : "";
  }
  if (templateItemDecoration) {
    templateItemDecoration.value = style.italic ? "italic" : style.underline ? "underline" : "";
  }
  setColorControl(templateItemColor, colorToInputValue(style.font_color, "#16324a"));
  setColorControl(templateItemBg, colorToInputValue(style.fill_color, "#ffffff"));
}

function colorToInputValue(value, fallback) {
  const text = String(value || "").replace(/^FF/i, "#").replace(/^#?([0-9a-f]{6})$/i, "#$1");
  return /^#[0-9a-f]{6}$/i.test(text) ? text : fallback;
}

function setColorControl(input, value) {
  if (!input) {
    return;
  }
  const normalized = /^#[0-9a-f]{6}$/i.test(String(value || "")) ? value : input.value;
  input.value = normalized;
  input.dataset.originalValue = normalized;
}

const formatObjectOptions = [
  ["", "Other Custom Text / Formula"],
  ["bank_name", "Bank Name"],
  ["branch_name", "Branch"],
  ["reference_no", "Ref No."],
  ["issue_date_slash", "Date"],
  ["customer_name", "Customer Name"],
  ["customer_address", "Customer Address"],
  ["account_number", "Account Number"],
  ["account_type", "Account Type"],
  ["member_id", "Member ID"],
  ["currency", "Currency"],
  ["period_label_iso", "Statement Period"],
  ["issue_date_iso", "Issue Date"],
  ["interest_rate", "Interest Rate"],
  ["tax_rate", "Tax Rate"],
  ["total_debit", "Total Debit"],
  ["total_credit", "Total Credit"],
  ["final_balance", "Closing Balance"],
  ["total_balance_npr_text", "Total Balance"],
  ["balance_words_npr", "Balance In Words"],
  ["usd_npr_text", "Exchange Rate"],
  ["equivalent_usd_text", "Equivalent in USD Balance"],
  ["balance_words_usd", "USD Balance in Word"],
  ["authorization_details", "Authorization Details"],
];

function ensureFormatObjectOptions() {
  if (!formatObjectSelect || formatObjectSelect.options.length > 0) {
    return;
  }
  for (const [value, label] of formatObjectOptions) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    formatObjectSelect.append(option);
  }
}

function updateFormatWorkspaceStatus() {
  if (formatWorkbookStatus) {
    const detail = state.templateEditorDetail;
    const selectionCount = state.formatWorkspaceSelectedKeys.length;
    const selection = selectionCount > 1
      ? `${selectionCount} cells selected`
      : (state.formatWorkspaceSelectedKey || "Ready");
    const access = detail?.editable ? "Editable" : "View only";
    formatWorkbookStatus.textContent = `${access} | ${selection}`;
  }
  if (formatZoomStatus) {
    formatZoomStatus.textContent = `${state.formatWorkspaceZoom}%`;
  }
}

function applyFormatWorkspaceView() {
  const orientation = state.formatWorkspaceOrientation === "landscape" ? "landscape" : "portrait";
  const zoom = Math.max(50, Math.min(160, Number(state.formatWorkspaceZoom || 100)));
  state.formatWorkspaceOrientation = orientation;
  state.formatWorkspaceZoom = zoom;
  formatSheetHost?.classList.toggle("is-landscape", orientation === "landscape");
  formatSheetHost?.classList.toggle("is-portrait", orientation === "portrait");
  const canvas = formatSheetHost?.firstElementChild;
  if (canvas) {
    canvas.style.zoom = String(zoom / 100);
  }
  document.querySelectorAll("[data-format-orientation]").forEach((button) => {
    const active = button.dataset.formatOrientation === orientation;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
  });
  if (formatZoomRange) {
    formatZoomRange.value = String(zoom);
  }
  if (formatZoomOutput) {
    formatZoomOutput.textContent = `${zoom}%`;
  }
  updateFormatWorkspaceStatus();
}

function setFormatWorkspaceZoom(value) {
  state.formatWorkspaceZoom = Math.max(50, Math.min(160, Math.round(Number(value || 100) / 10) * 10));
  applyFormatWorkspaceView();
}

function fitFormatWorkspaceWidth() {
  const canvas = formatSheetHost?.firstElementChild;
  if (!canvas || !formatSheetHost) {
    return;
  }
  const currentScale = Math.max(0.5, state.formatWorkspaceZoom / 100);
  const contentWidth = Math.max(1, canvas.getBoundingClientRect().width / currentScale);
  const availableWidth = Math.max(1, formatSheetHost.clientWidth - 24);
  setFormatWorkspaceZoom((availableWidth / contentWidth) * 100);
}

function toggleFormatWorkspaceExpanded(force = null) {
  if (!formatWorkspacePanel) {
    return;
  }
  const expanded = force === null ? !formatWorkspacePanel.classList.contains("is-expanded") : Boolean(force);
  formatWorkspacePanel.classList.toggle("is-expanded", expanded);
  document.body.classList.toggle("format-workspace-expanded", expanded);
  if (formatFullscreenButton) {
    formatFullscreenButton.textContent = expanded ? "Exit Full Screen" : "Full Screen";
  }
  requestAnimationFrame(() => applyFormatWorkspaceView());
}

function compactFormatRibbon() {
  const ribbon = document.getElementById("format-ribbon");
  if (!ribbon || ribbon.dataset.compacted === "true") {
    return;
  }
  const makeMenu = (group, icon, title, selectors, extraNodes = []) => {
    const details = document.createElement("details");
    details.className = "ribbon-menu";
    details.title = title;
    const summary = document.createElement("summary");
    summary.textContent = icon;
    summary.setAttribute("aria-label", title);
    const panel = document.createElement("div");
    panel.className = "ribbon-menu-panel";
    for (const selector of selectors) {
      const node = ribbon.querySelector(selector);
      if (node) {
        panel.append(node);
      }
    }
    for (const node of extraNodes) {
      panel.append(node);
    }
    details.append(summary, panel);
    group.append(details);
  };
  const groups = ribbon.querySelectorAll(".ribbon-group");
  const makeButton = (id, title, text) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ribbon-button";
    button.id = id;
    button.title = title;
    button.textContent = text;
    return button;
  };
  const addParagraphButton = document.createElement("button");
  addParagraphButton.type = "button";
  addParagraphButton.className = "ribbon-button";
  addParagraphButton.id = "format-add-paragraph-btn";
  addParagraphButton.title = "Add paragraph";
  addParagraphButton.textContent = "P+";
  const insertRowButton = makeButton("format-insert-row-btn", "Insert row above selected Excel row", "+R");
  const insertColumnButton = makeButton("format-insert-column-btn", "Insert column before selected Excel column", "+C");
  const headerButton = makeButton("format-add-header-btn", "Add or replace Excel header text", "H");
  const footerButton = makeButton("format-add-footer-btn", "Add or replace Excel footer text", "F");
  makeMenu(groups[0], "A", "More font tools", [
    '[data-format-command="fontGrow"]',
    '[data-format-command="fontShrink"]',
    '[data-format-command="changeCase"]',
    '[data-format-command="clear"]',
    '[data-format-command="strike"]',
    '[data-format-command="subscript"]',
    '[data-format-command="superscript"]',
  ]);
  makeMenu(groups[1], "P", "Paragraph tools", [
    '[data-format-command="bullet"]',
    '[data-format-command="numbering"]',
    '[data-format-command="outdent"]',
    '[data-format-command="indent"]',
    '[data-format-command="wrap"]',
    "#format-line-spacing",
    '[data-format-command="sortText"]',
    '[data-format-command="showMarks"]',
  ], [addParagraphButton]);
  makeMenu(groups[2], "#", "Cell and number tools", [
    "#format-border-style",
    "#format-number-format",
    '[data-format-command="currency"]',
    '[data-format-command="percent"]',
    '[data-format-command="comma"]',
    '[data-format-command="decimalIncrease"]',
    '[data-format-command="decimalDecrease"]',
  ], [insertRowButton, insertColumnButton, headerButton, footerButton]);
  ribbon.dataset.compacted = "true";
}

function templateEditorItems(detail = state.templateEditorDetail) {
  if (Array.isArray(detail?.scan?.items)) {
    return detail.scan.items;
  }
  if (Array.isArray(detail?.items)) {
    return detail.items;
  }
  return [];
}

function templateEditorSummary(detail = state.templateEditorDetail) {
  return detail?.scan?.summary || detail?.summary || {};
}

function selectedTemplateEditorItemByKey(key) {
  return templateEditorItems().find((item) => item.key === key) || (state.formatWorkspaceVirtualItem?.key === key ? state.formatWorkspaceVirtualItem : null);
}

function columnName(index) {
  let name = "";
  let value = Math.max(1, Number(index || 1));
  while (value > 0) {
    const remainder = (value - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    value = Math.floor((value - 1) / 26);
  }
  return name;
}

function addressToRowCol(address) {
  const match = String(address || "").match(/([A-Z]+)(\d+)$/i);
  if (!match) {
    return null;
  }
  let column = 0;
  for (const letter of match[1].toUpperCase()) {
    column = column * 26 + letter.charCodeAt(0) - 64;
  }
  return { row: Number(match[2]), col: column };
}

function buildFormatPositionContext(items) {
  const context = {
    maxTopRow: 4,
    maxHeaderCol: 6,
    maxTxnRow: 55,
    fallbackCols: 6,
  };
  for (const item of items) {
    const key = String(item.key || "");
    let match = key.match(/^top-(\d+)-(\d+)$/);
    if (match) {
      context.maxTopRow = Math.max(context.maxTopRow, Number(match[1]));
      context.maxHeaderCol = Math.max(context.maxHeaderCol, Number(match[2]));
      continue;
    }
    match = key.match(/^head-(\d+)$/);
    if (match) {
      context.maxHeaderCol = Math.max(context.maxHeaderCol, Number(match[1]));
      continue;
    }
    match = key.match(/^txn-(\d+)-(\d+)$/);
    if (match) {
      context.maxTxnRow = Math.max(context.maxTxnRow, Number(match[1]));
      context.maxHeaderCol = Math.max(context.maxHeaderCol, Number(match[2]));
    }
  }
  context.headerRow = context.maxTopRow + 2;
  context.fallbackCols = Math.max(6, context.maxHeaderCol);
  return context;
}

function itemGridPosition(item, index, context) {
  const directAddress = addressToRowCol(item?.address) || addressToRowCol(String(item?.key || "").split("!").pop());
  if (directAddress) {
    return directAddress;
  }
  const key = String(item?.key || "");
  let match = key.match(/^r(\d+)c(\d+)$/i);
  if (match) {
    return { row: Number(match[1]), col: Number(match[2]) };
  }
  if (key === "title") {
    return { row: 1, col: 1 };
  }
  match = key.match(/^top-(\d+)-(\d+)$/);
  if (match) {
    return { row: Number(match[1]) + 1, col: Number(match[2]) };
  }
  match = key.match(/^head-(\d+)$/);
  if (match) {
    return { row: context.headerRow, col: Number(match[1]) };
  }
  match = key.match(/^txn-(\d+)-(\d+)$/);
  if (match) {
    return { row: context.headerRow + Number(match[1]), col: Number(match[2]) };
  }
  const totalRow = context.headerRow + context.maxTxnRow + 1;
  const specialPositions = {
    "total-label": [totalRow, 1],
    "total-debit": [totalRow, 4],
    "total-credit": [totalRow, 5],
    "total-balance": [totalRow, 6],
    "summary-title": [totalRow + 2, 1],
    "summary-debit": [totalRow + 3, 2],
    "summary-credit": [totalRow + 3, 4],
    "summary-closing": [totalRow + 3, 6],
    "words-label": [totalRow + 5, 1],
    "words-value": [totalRow + 5, 2],
    notice: [totalRow + 6, 1],
  };
  if (specialPositions[key]) {
    return { row: specialPositions[key][0], col: specialPositions[key][1] };
  }
  return {
    row: Math.floor(index / context.fallbackCols) + 1,
    col: (index % context.fallbackCols) + 1,
  };
}

function formatColorToCss(value) {
  const text = String(value || "").trim();
  if (/^#[0-9a-f]{6}$/i.test(text)) {
    return text;
  }
  if (/^[0-9a-f]{8}$/i.test(text)) {
    return `#${text.slice(2)}`;
  }
  if (/^[0-9a-f]{6}$/i.test(text)) {
    return `#${text}`;
  }
  return "";
}

function normalizeHorizontalAlign(value) {
  const text = String(value || "").trim().toLowerCase();
  if (!text) {
    return "";
  }
  if (text.includes("center") || text === "middle") {
    return "center";
  }
  if (text.includes("right") || text === "end") {
    return "right";
  }
  if (text.includes("justify") || text.includes("both")) {
    return "justify";
  }
  if (text.includes("left") || text === "start") {
    return "left";
  }
  return "";
}

function normalizeVerticalAlign(value) {
  const text = String(value || "").trim().toLowerCase();
  if (!text) {
    return "";
  }
  if (text.includes("center") || text.includes("middle")) {
    return "middle";
  }
  if (text.includes("bottom")) {
    return "bottom";
  }
  if (text.includes("top")) {
    return "top";
  }
  if (text.includes("sub")) {
    return "sub";
  }
  if (text.includes("super")) {
    return "super";
  }
  return "";
}

function cssLengthToPx(value, numericUnit = 18) {
  const text = String(value || "").trim().toLowerCase();
  if (!text) {
    return 0;
  }
  if (text.endsWith("px")) {
    return parseFloat(text) || 0;
  }
  if (text.endsWith("pt")) {
    return (parseFloat(text) || 0) * 4 / 3;
  }
  if (/^-?\d+(\.\d+)?$/.test(text)) {
    return Number(text) * numericUnit;
  }
  return parseFloat(text) || 0;
}

function syncRulerMarkers() {
  const ruler = document.getElementById("format-ruler");
  if (!ruler) {
    return;
  }
  const max = Number(formatLeftIndent?.max || 144) || 144;
  const asPercent = (value) => `${Math.max(0, Math.min(100, (Number(value || 0) / max) * 100))}%`;
  ruler.style.setProperty("--left-tab", asPercent(formatLeftTab?.value || 0));
  ruler.style.setProperty("--left-indent", asPercent(formatLeftIndent?.value || 0));
  ruler.style.setProperty("--first-indent", asPercent(formatFirstIndent?.value || 0));
}

function borderCssForOption(value) {
  const thin = "1px solid #16324a";
  const medium = "2px solid #16324a";
  const border = value === "medium" ? medium : thin;
  if (value === "none") {
    return { border: "none", borderTop: "none", borderRight: "none", borderBottom: "none", borderLeft: "none" };
  }
  if (value === "thin" || value === "medium") {
    return { border };
  }
  if (value === "outside") {
    return { border };
  }
  if (["top", "right", "bottom", "left"].includes(value)) {
    const property = `border${value.charAt(0).toUpperCase()}${value.slice(1)}`;
    return { [property]: thin };
  }
  return {};
}

function applyFormatItemStyle(node, item) {
  const style = item?.raw_style || item?.style || {};
  const horizontal = normalizeHorizontalAlign(style["text-align"] || style.horizontal || style.alignment || "");
  const vertical = normalizeVerticalAlign(style["vertical-align"] || style.vertical || "");
  if (horizontal) {
    node.style.textAlign = horizontal;
  }
  if (vertical) {
    node.style.verticalAlign = vertical;
  }
  if (style["font-family"] || style.font_name) {
    node.style.fontFamily = style["font-family"] || style.font_name;
  }
  const fontSize = style["font-size"] || style.font_size || "";
  if (fontSize) {
    node.style.fontSize = /^\d+(\.\d+)?$/.test(String(fontSize)) ? `${fontSize}pt` : String(fontSize);
  }
  const fontColor = formatColorToCss(style.color || style.font_color || "");
  const fillColor = formatColorToCss(style["background-color"] || style.fill_color || "");
  if (fontColor) {
    node.style.color = fontColor;
  }
  if (fillColor && fillColor.toLowerCase() !== "#000000") {
    node.style.backgroundColor = fillColor;
  }
  if (style["font-weight"] || style.bold) {
    node.style.fontWeight = style["font-weight"] || (style.bold ? "700" : "");
  }
  if (style["font-style"] === "italic" || style.italic) {
    node.style.fontStyle = "italic";
  }
  if (style["text-decoration"] === "underline" || style.underline) {
    node.style.textDecoration = "underline";
  }
  if (style["white-space"] || style.wrap_text) {
    node.style.whiteSpace = style["white-space"] || (style.wrap_text ? "pre-wrap" : "");
  }
  if (style["line-height"] || style.line_spacing) {
    node.style.lineHeight = style["line-height"] || style.line_spacing;
  }
  if (style["padding-left"] || style.left_indent || style.indent) {
    const rawIndent = style["padding-left"] || style.left_indent || style.indent;
    node.style.paddingLeft = /^\d+(\.\d+)?$/.test(String(rawIndent)) ? `${Number(rawIndent) * 18}px` : String(rawIndent);
  }
  if (style["text-indent"] || style.first_line_indent) {
    const rawFirstIndent = style["text-indent"] || style.first_line_indent;
    node.style.textIndent = /^\-?\d+(\.\d+)?$/.test(String(rawFirstIndent)) ? `${Number(rawFirstIndent) * 18}px` : String(rawFirstIndent);
  }
  if (style.border) {
    node.style.border = style.border;
  }
  for (const property of ["borderTop", "borderRight", "borderBottom", "borderLeft"]) {
    const styleKey = property.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`);
    const legacyKey = styleKey.replaceAll("-", "_");
    if (style[styleKey] || style[legacyKey]) {
      node.style[property] = style[styleKey] || style[legacyKey];
    }
  }
  const numberFormat = style["mso-number-format"] || style.number_format || "";
  if (numberFormat) {
    node.title = `Format: ${numberFormat}`;
  }
}

function activeFormatButton(command) {
  return document.querySelector(`[data-format-command="${command}"]`)?.classList.contains("is-active") || false;
}

function setActiveFormatButton(command, active) {
  const button = document.querySelector(`[data-format-command="${command}"]`);
  if (!button) {
    return;
  }
  button.classList.toggle("is-active", Boolean(active));
  button.setAttribute("aria-pressed", active ? "true" : "false");
}

function selectedFormatNodes() {
  if (!formatSheetHost) {
    return [];
  }
  const keys = state.formatWorkspaceSelectedKeys.length ? state.formatWorkspaceSelectedKeys : [state.formatWorkspaceSelectedKey].filter(Boolean);
  return keys.map((key) => findFormatWorkspaceNode(key)).filter(Boolean);
}

function selectedPrimaryFormatNode() {
  return findFormatWorkspaceNode(state.formatWorkspaceSelectedKey);
}

function applyCssToSelectedNodes(style) {
  for (const node of selectedFormatNodes()) {
    Object.assign(node.style, style);
  }
}

function editableContentNode(node = selectedPrimaryFormatNode()) {
  return node?.querySelector?.(".word-edit-text") || node;
}

function inlineRunStyle(run) {
  const styles = [];
  if (run.vert_align === "subscript") {
    styles.push("vertical-align:sub", "font-size:80%");
  } else if (run.vert_align === "superscript") {
    styles.push("vertical-align:super", "font-size:80%");
  }
  if (run.bold === true) styles.push("font-weight:700");
  if (run.italic === true) styles.push("font-style:italic");
  if (run.underline === true) styles.push("text-decoration:underline");
  if (run.strike === true) styles.push("text-decoration:line-through");
  if (run.font_name) styles.push(`font-family:${String(run.font_name).replaceAll('"', "")}`);
  if (run.font_size) styles.push(`font-size:${/^\d+(\.\d+)?$/.test(String(run.font_size)) ? `${run.font_size}pt` : run.font_size}`);
  const color = formatColorToCss(run.font_color || run.color || "");
  if (color) styles.push(`color:${color}`);
  return styles.join(";");
}

function inlineRunsToHtml(runs, fallbackText = "") {
  if (!Array.isArray(runs) || !runs.length) {
    return escapeHtml(fallbackText);
  }
  return runs.map((run) => {
    const text = escapeHtml(run.text || "");
    const style = inlineRunStyle(run);
    return style ? `<span data-format-inline="true" style="${style}">${text}</span>` : text;
  }).join("");
}

function collectInlineRunsFromNode(root) {
  const runs = [];
  const pushRun = (text, style) => {
    if (!text) {
      return;
    }
    const run = { text };
    if (style.vert_align) run.vert_align = style.vert_align;
    if (style.bold) run.bold = true;
    if (style.italic) run.italic = true;
    if (style.underline) run.underline = true;
    if (style.strike) run.strike = true;
    if (style.font_name) run.font_name = style.font_name;
    if (style.font_size) run.font_size = style.font_size;
    if (style.font_color) run.font_color = style.font_color;
    const previous = runs[runs.length - 1];
    const comparableKeys = ["vert_align", "bold", "italic", "underline", "strike", "font_name", "font_size", "font_color"];
    if (previous && comparableKeys.every((key) => (previous[key] || "") === (run[key] || ""))) {
      previous.text += text;
    } else {
      runs.push(run);
    }
  };
  const walk = (node, inherited = {}) => {
    if (!node) {
      return;
    }
    if (node.nodeType === 3) {
      pushRun(node.nodeValue || "", inherited);
      return;
    }
    if (node.nodeType !== 1) {
      return;
    }
    const element = node;
    const tag = element.tagName?.toLowerCase?.() || "";
    const style = element.style || {};
    const next = { ...inherited };
    const vertical = normalizeVerticalAlign(style.verticalAlign || (tag === "sub" ? "sub" : tag === "sup" ? "super" : ""));
    if (vertical === "sub") {
      next.vert_align = "subscript";
    } else if (vertical === "super") {
      next.vert_align = "superscript";
    }
    const fontWeight = String(style.fontWeight || "").toLowerCase();
    if (tag === "b" || tag === "strong" || fontWeight === "bold" || fontWeight === "700") next.bold = true;
    if (tag === "i" || tag === "em" || style.fontStyle === "italic") next.italic = true;
    const decoration = String(style.textDecoration || "").toLowerCase();
    if (tag === "u" || decoration.includes("underline")) next.underline = true;
    if (tag === "s" || tag === "strike" || decoration.includes("line-through")) next.strike = true;
    if (style.fontFamily) next.font_name = style.fontFamily.replaceAll('"', "");
    if (style.fontSize && !["80%", "smaller"].includes(style.fontSize)) next.font_size = style.fontSize;
    if (style.color) next.font_color = style.color;
    node.childNodes.forEach((child) => walk(child, next));
  };
  walk(root);
  return runs;
}

function richRunsForKey(key = state.formatWorkspaceSelectedKey) {
  const node = editableContentNode(findFormatWorkspaceNode(key));
  if (!node) {
    return [];
  }
  const runs = collectInlineRunsFromNode(node);
  return runs.some((run) => run.vert_align || run.bold || run.italic || run.underline || run.strike || run.font_name || run.font_size || run.font_color)
    ? runs
    : [];
}

function selectionInsideNode(node) {
  const selection = window.getSelection?.();
  if (!node) {
    return null;
  }
  if (selection && selection.rangeCount > 0 && !selection.isCollapsed) {
    const range = selection.getRangeAt(0);
    if (node.contains(range.commonAncestorContainer)) {
      state.formatInlineRange = range.cloneRange();
      return range;
    }
  }
  const savedRange = state.formatInlineRange;
  return savedRange && node.contains(savedRange.commonAncestorContainer) ? savedRange : null;
}

function rememberFormatInlineSelection() {
  const selection = window.getSelection?.();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return;
  }
  const range = selection.getRangeAt(0);
  const selectedElement = range.commonAncestorContainer.nodeType === 1
    ? range.commonAncestorContainer
    : range.commonAncestorContainer.parentElement;
  const host = selectedElement?.closest?.("[data-format-key]");
  if (host && formatSheetHost?.contains(host)) {
    state.formatInlineRange = range.cloneRange();
  }
}

function syncInlineWorkspaceText(node) {
  const text = node?.textContent || "";
  if (templateItemText) {
    templateItemText.value = text;
  }
  if (formatFormulaInput) {
    formatFormulaInput.value = text;
  }
}

function applyInlineVerticalScript(command) {
  const host = editableContentNode();
  const range = selectionInsideNode(host);
  if (!range) {
    throw new Error("Select only the text you want to format, then click superscript or subscript.");
  }
  const wrapper = document.createElement("span");
  wrapper.dataset.formatInline = command;
  wrapper.style.verticalAlign = command === "subscript" ? "sub" : "super";
  wrapper.style.fontSize = "80%";
  const activeRange = range.cloneRange();
  wrapper.append(activeRange.extractContents());
  activeRange.insertNode(wrapper);
  const selection = window.getSelection?.();
  selection?.removeAllRanges();
  const nextRange = document.createRange();
  nextRange.selectNodeContents(wrapper);
  selection?.addRange(nextRange);
  setActiveFormatButton("subscript", false);
  setActiveFormatButton("superscript", false);
  syncInlineWorkspaceText(host);
}

function selectedNodeText() {
  const node = selectedPrimaryFormatNode();
  const wordTextNode = node?.querySelector?.(".word-edit-text");
  return wordTextNode?.textContent ?? node?.textContent ?? "";
}

function workspaceTextForKey(key) {
  const node = findFormatWorkspaceNode(key);
  const wordTextNode = node?.querySelector?.(".word-edit-text");
  return wordTextNode?.textContent ?? node?.textContent ?? "";
}

function pushFormatUndoSnapshot(label = "Edit") {
  if (!formatSheetHost || formatWorkspacePanel?.hidden) {
    return;
  }
  const html = formatSheetHost.innerHTML;
  if (!html.trim()) {
    return;
  }
  const previous = state.formatUndoStack[state.formatUndoStack.length - 1];
  if (previous?.html === html) {
    return;
  }
  state.formatUndoStack.push({
    html,
    label,
    selectedKey: state.formatWorkspaceSelectedKey,
    selectedKeys: [...state.formatWorkspaceSelectedKeys],
    formula: formatFormulaInput?.value || "",
  });
  if (state.formatUndoStack.length > 50) {
    state.formatUndoStack.shift();
  }
}

function bindRestoredFormatWorkspaceEvents(root = formatSheetHost) {
  root?.querySelectorAll("[data-format-key]").forEach((node) => {
    if (node.dataset.undoBound === "true") {
      return;
    }
    node.dataset.undoBound = "true";
    const key = node.dataset.formatKey || "";
    node.addEventListener("click", (event) => {
      event.stopPropagation();
      if (event.ctrlKey || event.metaKey) {
        toggleFormatWorkspaceSelection(key, node);
        return;
      }
      if (event.shiftKey && state.formatWorkspaceAnchorKey && selectFormatRange(state.formatWorkspaceAnchorKey, key)) {
        return;
      }
      selectFormatWorkspaceItem(key, node, { shiftKey: event.shiftKey });
    });
    node.addEventListener("input", () => {
      selectFormatWorkspaceItem(key, node);
      syncWorkspaceText(node.querySelector?.(".word-edit-text")?.textContent ?? node.textContent ?? "");
    });
    const textNode = node.querySelector?.(".word-edit-text");
    if (textNode && textNode.dataset.undoBound !== "true") {
      textNode.dataset.undoBound = "true";
      textNode.addEventListener("input", () => {
        selectFormatWorkspaceItem(key, node);
        syncWorkspaceText(textNode.textContent || "");
      });
    }
  });
}

function undoFormatWorkspace() {
  const snapshot = state.formatUndoStack.pop();
  if (!snapshot || !formatSheetHost) {
    showFormatSaveStatus("Nothing to undo.", "error");
    return;
  }
  formatSheetHost.innerHTML = snapshot.html;
  state.formatWorkspaceSelectedKey = snapshot.selectedKey || "";
  state.formatWorkspaceSelectedKeys = Array.isArray(snapshot.selectedKeys) ? snapshot.selectedKeys : [snapshot.selectedKey].filter(Boolean);
  state.formatInlineRange = null;
  bindRestoredFormatWorkspaceEvents();
  if (state.formatWorkspaceSelectedKey) {
    selectFormatWorkspaceItem(
      state.formatWorkspaceSelectedKey,
      findFormatWorkspaceNode(state.formatWorkspaceSelectedKey),
      { keepRange: state.formatWorkspaceSelectedKeys.length > 1 }
    );
  } else {
    if (formatFormulaInput) {
      formatFormulaInput.value = snapshot.formula || "";
      formatFormulaInput.disabled = true;
    }
    if (formatSelectedCell) {
      formatSelectedCell.textContent = "No cell selected.";
    }
  }
  showFormatSaveStatus(`Undo: ${snapshot.label || "previous edit"}.`, "success");
}

function replaceSelectedNodeText(text) {
  if (formatFormulaInput) {
    formatFormulaInput.value = text;
  }
  syncWorkspaceText(text);
}

function currentFontSize() {
  const value = Number(formatFontSize?.value || templateItemFontSize?.value || 11);
  return Number.isFinite(value) && value > 0 ? value : 11;
}

function setNumberFormat(value) {
  if (formatNumberFormat) {
    formatNumberFormat.value = value;
  }
  if (templateItemNumberFormat) {
    templateItemNumberFormat.value = value;
  }
}

function decorateSelectedNode() {
  const decorations = [];
  if (activeFormatButton("underline")) {
    decorations.push("underline");
  }
  if (activeFormatButton("strike")) {
    decorations.push("line-through");
  }
  applyCssToSelectedNodes({ textDecoration: decorations.join(" ") || "none" });
}

function toggleFormatButton(command) {
  setActiveFormatButton(command, !activeFormatButton(command));
}

function updateToolbarFromItem(item) {
  const style = item?.raw_style || item?.style || {};
  if (formatFontFamily) {
    formatFontFamily.value = style["font-family"] || style.font_name || "";
  }
  if (formatFontSize) {
    const size = String(style["font-size"] || style.font_size || "").replace(/[^\d.]/g, "");
    formatFontSize.value = size || "";
  }
  setColorControl(formatFontColor, colorToInputValue(style.color || style.font_color, "#16324a"));
  setColorControl(formatFillColor, colorToInputValue(style["background-color"] || style.fill_color, "#ffffff"));
  if (templateItemAlign) {
    templateItemAlign.value = normalizeHorizontalAlign(style["text-align"] || style.horizontal || style.alignment || "");
  }
  if (templateItemVertical) {
    templateItemVertical.value = normalizeVerticalAlign(style["vertical-align"] || style.vertical || "");
  }
  if (formatVerticalAlign) {
    formatVerticalAlign.value = normalizeVerticalAlign(style["vertical-align"] || style.vertical || "");
  }
  if (formatLineSpacing) {
    formatLineSpacing.value = style["line-height"] || "";
  }
  if (formatLeftTab) {
    const rawTab = style["--left-tab"] || style.left_tab || "";
    formatLeftTab.value = String(Math.max(0, Math.min(144, Math.round(cssLengthToPx(rawTab, 18) || 0))));
  }
  if (formatLeftIndent) {
    const rawIndent = style["padding-left"] || style.left_indent || style.indent || "";
    const indentPx = cssLengthToPx(rawIndent, 18);
    formatLeftIndent.value = String(Math.max(0, Math.min(144, Math.round(indentPx || 0))));
  }
  if (formatFirstIndent) {
    const rawFirstIndent = style["text-indent"] || style.first_line_indent || "";
    const indentPx = cssLengthToPx(rawFirstIndent, 18);
    formatFirstIndent.value = String(Math.max(-72, Math.min(144, Math.round(indentPx || 0))));
  }
  if (formatBorderStyle) {
    formatBorderStyle.value = "";
  }
  if (formatNumberFormat) {
    formatNumberFormat.value = String(style["mso-number-format"] || style.number_format || "").replace(/^"(.*)"$/, "$1");
  }
  const weight = String(style["font-weight"] || "");
  setActiveFormatButton("bold", style.bold === true || weight === "700" || weight.toLowerCase() === "bold");
  setActiveFormatButton("italic", style.italic === true || style["font-style"] === "italic");
  setActiveFormatButton("underline", style.underline === true || String(style["text-decoration"] || "").includes("underline"));
  setActiveFormatButton("strike", style.strike === true || String(style["text-decoration"] || "").includes("line-through"));
  setActiveFormatButton("subscript", style.subscript === true || style.vert_align === "subscript" || style["vertical-align"] === "sub");
  setActiveFormatButton("superscript", style.superscript === true || style.vert_align === "superscript" || style["vertical-align"] === "super");
  setActiveFormatButton("wrap", style.wrap_text === true || style["white-space"] === "pre-wrap");
  syncRulerMarkers();
}

function applyFormatCommand(command) {
  const node = selectedPrimaryFormatNode();
  if (!node) {
    throw new Error("Click a cell or Word paragraph first.");
  }
  pushFormatUndoSnapshot(command || "Format change");
  if (["bold", "italic", "underline", "strike", "wrap"].includes(command)) {
    toggleFormatButton(command);
  }
  if (command === "bold") {
    applyCssToSelectedNodes({ fontWeight: activeFormatButton("bold") ? "700" : "400" });
  } else if (command === "italic") {
    applyCssToSelectedNodes({ fontStyle: activeFormatButton("italic") ? "italic" : "normal" });
  } else if (command === "underline" || command === "strike") {
    decorateSelectedNode();
  } else if (command === "subscript") {
    applyInlineVerticalScript("subscript");
  } else if (command === "superscript") {
    applyInlineVerticalScript("superscript");
  } else if (command === "fontGrow" || command === "fontShrink") {
    const next = Math.max(6, Math.min(72, currentFontSize() + (command === "fontGrow" ? 1 : -1)));
    formatFontSize.value = String(next);
    templateItemFontSize.value = String(next);
    applyCssToSelectedNodes({ fontSize: `${next}pt` });
  } else if (command === "changeCase") {
    const text = selectedNodeText();
    const next = text === text.toUpperCase()
      ? text.toLowerCase()
      : text.replace(/\w\S*/g, (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());
    replaceSelectedNodeText(next);
  } else if (command === "clear") {
    setActiveFormatButton("bold", false);
    setActiveFormatButton("italic", false);
    setActiveFormatButton("underline", false);
    setActiveFormatButton("strike", false);
    setActiveFormatButton("subscript", false);
    setActiveFormatButton("superscript", false);
    setActiveFormatButton("wrap", false);
    if (formatFontFamily) formatFontFamily.value = "";
    if (formatFontSize) formatFontSize.value = "";
    if (formatNumberFormat) formatNumberFormat.value = "";
    if (formatLineSpacing) formatLineSpacing.value = "";
    if (formatLeftTab) formatLeftTab.value = "0";
    if (formatLeftIndent) formatLeftIndent.value = "0";
    if (formatFirstIndent) formatFirstIndent.value = "0";
    applyCssToSelectedNodes({ fontWeight: "", fontStyle: "", textDecoration: "", color: "", backgroundColor: "", textAlign: "", verticalAlign: "", fontSize: "", fontFamily: "", whiteSpace: "", lineHeight: "", border: "", paddingLeft: "", textIndent: "" });
    syncRulerMarkers();
  } else if (command.startsWith("align")) {
    const align = command.replace("align", "").toLowerCase();
    const value = align === "justify" ? "justify" : align;
    templateItemAlign.value = value;
    applyCssToSelectedNodes({ textAlign: value });
  } else if (command === "bullet") {
    replaceSelectedNodeText(selectedNodeText().split(/\r?\n/).map((line) => line.trim().startsWith("- ") ? line : `- ${line}`).join("\n"));
  } else if (command === "numbering") {
    replaceSelectedNodeText(selectedNodeText().split(/\r?\n/).map((line, index) => /^\d+\.\s/.test(line.trim()) ? line : `${index + 1}. ${line}`).join("\n"));
  } else if (command === "indent" || command === "outdent") {
    const current = parseInt(node.style.paddingLeft || "0", 10) || 0;
    const next = Math.max(0, current + (command === "indent" ? 18 : -18));
    if (formatLeftIndent) {
      formatLeftIndent.value = String(next);
    }
    applyCssToSelectedNodes({ paddingLeft: `${next}px` });
    syncRulerMarkers();
  } else if (command === "wrap") {
    applyCssToSelectedNodes({ whiteSpace: activeFormatButton("wrap") ? "pre-wrap" : "normal" });
  } else if (command === "sortText") {
    replaceSelectedNodeText(selectedNodeText().split(/\r?\n/).sort((a, b) => a.localeCompare(b)).join("\n"));
  } else if (command === "showMarks") {
    formatSheetHost?.classList.toggle("show-format-marks");
  } else if (command === "currency") {
    setNumberFormat("$#,##0.00");
  } else if (command === "percent") {
    setNumberFormat("0.00%");
  } else if (command === "comma") {
    setNumberFormat("#,##0.00");
  } else if (command === "decimalIncrease") {
    setNumberFormat("#,##0.000");
  } else if (command === "decimalDecrease") {
    setNumberFormat("#,##0.0");
  }
}

function findFormatWorkspaceNode(key) {
  if (!formatSheetHost) {
    return null;
  }
  return Array.from(formatSheetHost.querySelectorAll("[data-format-key]"))
    .find((node) => node.dataset.formatKey === key) || null;
}

function selectFormatWorkspaceItem(key, node = null, options = {}) {
  const selectedNode = node || findFormatWorkspaceNode(key);
  let item = selectedTemplateEditorItemByKey(key);
  if (!item && selectedNode) {
    item = {
      key,
      address: selectedNode.dataset.address || "",
      label: selectedNode.dataset.address || key,
      text: selectedNode.textContent || "",
      style: {},
    };
    state.formatWorkspaceVirtualItem = item;
    if (templateItemSelect && !Array.from(templateItemSelect.options).some((option) => option.value === key)) {
      const option = document.createElement("option");
      option.value = key;
      option.textContent = `${item.label}: (new cell)`;
      templateItemSelect.append(option);
    }
  }
  state.formatWorkspaceSelectedKey = key || "";
  if (!options.keepRange) {
    state.formatWorkspaceSelectedKeys = [key].filter(Boolean);
    state.formatWorkspaceMergeRequest = null;
    state.formatWorkspaceRangeRequest = null;
    state.formatInlineRange = null;
    state.formatWorkspaceAnchorKey = options.shiftKey ? state.formatWorkspaceAnchorKey : key;
  }
  formatSheetHost?.querySelectorAll(".is-selected,.is-range-selected").forEach((element) => element.classList.remove("is-selected", "is-range-selected"));
  for (const selectedKey of state.formatWorkspaceSelectedKeys) {
    findFormatWorkspaceNode(selectedKey)?.classList.add(selectedKey === key ? "is-selected" : "is-range-selected");
  }
  selectedNode?.classList.add("is-selected");
  if (templateItemSelect && item) {
    templateItemSelect.value = item.key;
  }
  if (item) {
    fillTemplateItemControls(item);
    updateToolbarFromItem(item);
  }
  const label = item?.label || item?.address || item?.key || key || "No cell selected";
  const selectedTextNode = selectedNode?.querySelector?.(".word-edit-text");
  const text = selectedTextNode?.textContent ?? selectedNode?.textContent ?? item?.text ?? "";
  if (formatSelectedCell) {
    const rangeText = state.formatWorkspaceSelectedKeys.length > 1 ? ` (${state.formatWorkspaceSelectedKeys.length} cells selected)` : "";
    formatSelectedCell.textContent = key ? `Selected: ${label}${rangeText}` : "No cell selected.";
  }
  if (formatFormulaInput) {
    formatFormulaInput.value = text;
    formatFormulaInput.disabled = !key;
  }
  if (formatSaveCellButton) {
    formatSaveCellButton.disabled = !key || !state.templateEditorDetail?.editable;
  }
  if (formatSaveOriginalButton) {
    formatSaveOriginalButton.disabled = !key || !state.templateEditorDetail?.editable;
  }
  updateFormatWorkspaceStatus();
}

function syncWorkspaceText(value) {
  const key = state.formatWorkspaceSelectedKey;
  if (!key) {
    return;
  }
  const node = findFormatWorkspaceNode(key);
  const wordTextNode = node?.querySelector?.(".word-edit-text");
  if (wordTextNode && wordTextNode.textContent !== value) {
    wordTextNode.textContent = value;
  } else if (node && !wordTextNode && node.textContent !== value) {
    node.textContent = value;
  }
  if (templateItemText) {
    templateItemText.value = value;
  }
}

function nodeGridPosition(node) {
  if (!node) {
    return null;
  }
  const row = Number(node.dataset.row || "");
  const col = Number(node.dataset.col || "");
  if (row > 0 && col > 0) {
    return { row, col };
  }
  const keyMatch = String(node.dataset.formatKey || "").match(/^r(\d+)c(\d+)$/i);
  if (keyMatch) {
    return { row: Number(keyMatch[1]), col: Number(keyMatch[2]) };
  }
  return addressToRowCol(node.dataset.address || String(node.dataset.formatKey || "").split("!").pop());
}

function selectFormatRange(fromKey, toKey) {
  const fromNode = findFormatWorkspaceNode(fromKey);
  const toNode = findFormatWorkspaceNode(toKey);
  const from = nodeGridPosition(fromNode);
  const to = nodeGridPosition(toNode);
  if (!from || !to) {
    return false;
  }
  const top = Math.min(from.row, to.row);
  const bottom = Math.max(from.row, to.row);
  const left = Math.min(from.col, to.col);
  const right = Math.max(from.col, to.col);
  const keys = [];
  formatSheetHost?.querySelectorAll("[data-format-key]").forEach((node) => {
    const pos = nodeGridPosition(node);
    if (pos && pos.row >= top && pos.row <= bottom && pos.col >= left && pos.col <= right) {
      keys.push(node.dataset.formatKey);
    }
  });
  state.formatWorkspaceSelectedKeys = keys;
  const primaryNode = Array.from(formatSheetHost?.querySelectorAll("[data-format-key]") || [])
    .find((node) => {
      const pos = nodeGridPosition(node);
      return pos && pos.row === top && pos.col === left;
    });
  const primaryKey = primaryNode?.dataset.formatKey || fromKey;
  const addressA = `${columnName(left)}${top}`;
  const addressB = `${columnName(right)}${bottom}`;
  state.formatWorkspaceRangeRequest = {
    range: `${addressA}:${addressB}`,
    colspan: right - left + 1,
    rowspan: bottom - top + 1,
    covered_keys: keys.filter((key) => key !== primaryKey),
    primary_key: primaryKey,
  };
  state.formatWorkspaceMergeRequest = null;
  selectFormatWorkspaceItem(fromKey, fromNode, { keepRange: true });
  return true;
}

function refreshFormatSelectionClasses(primaryKey = state.formatWorkspaceSelectedKey) {
  formatSheetHost?.querySelectorAll(".is-selected,.is-range-selected").forEach((element) => element.classList.remove("is-selected", "is-range-selected"));
  for (const selectedKey of state.formatWorkspaceSelectedKeys) {
    findFormatWorkspaceNode(selectedKey)?.classList.add(selectedKey === primaryKey ? "is-selected" : "is-range-selected");
  }
}

function toggleFormatWorkspaceSelection(key, node = null) {
  if (!key) {
    return;
  }
  const selected = new Set(state.formatWorkspaceSelectedKeys);
  if (selected.has(key) && selected.size > 1) {
    selected.delete(key);
  } else {
    selected.add(key);
  }
  state.formatWorkspaceSelectedKeys = Array.from(selected);
  state.formatWorkspaceSelectedKey = key;
  state.formatWorkspaceAnchorKey ||= key;
  state.formatWorkspaceMergeRequest = null;
  state.formatWorkspaceRangeRequest = buildMergeRequestFromSelectedKeys();
  const item = selectedTemplateEditorItemByKey(key);
  if (item) {
    fillTemplateItemControls(item);
    updateToolbarFromItem(item);
    if (templateItemSelect) {
      templateItemSelect.value = item.key;
    }
  }
  const activeNode = node || findFormatWorkspaceNode(key);
  const text = activeNode?.querySelector?.(".word-edit-text")?.textContent ?? activeNode?.textContent ?? "";
  if (formatFormulaInput) {
    formatFormulaInput.value = text;
    formatFormulaInput.disabled = false;
  }
  refreshFormatSelectionClasses(key);
  if (formatSelectedCell) {
    formatSelectedCell.textContent = `Selected: ${item?.label || item?.address || key} (${state.formatWorkspaceSelectedKeys.length} cells selected)`;
  }
  updateFormatWorkspaceStatus();
}

function buildMergeRequestFromSelectedKeys() {
  const nodes = state.formatWorkspaceSelectedKeys.map((key) => findFormatWorkspaceNode(key)).filter(Boolean);
  const positions = nodes
    .map((node) => ({ node, pos: nodeGridPosition(node) }))
    .filter((entry) => entry.pos);
  if (positions.length < 2) {
    return null;
  }
  const top = Math.min(...positions.map((entry) => entry.pos.row));
  const bottom = Math.max(...positions.map((entry) => entry.pos.row));
  const left = Math.min(...positions.map((entry) => entry.pos.col));
  const right = Math.max(...positions.map((entry) => entry.pos.col));
  const keys = [];
  formatSheetHost?.querySelectorAll("[data-format-key]").forEach((node) => {
    const pos = nodeGridPosition(node);
    if (pos && pos.row >= top && pos.row <= bottom && pos.col >= left && pos.col <= right) {
      keys.push(node.dataset.formatKey);
    }
  });
  const primaryNode = positions.find((entry) => entry.pos.row === top && entry.pos.col === left)?.node || positions[0].node;
  const primaryKey = primaryNode.dataset.formatKey || state.formatWorkspaceSelectedKey;
  return {
    range: `${columnName(left)}${top}:${columnName(right)}${bottom}`,
    colspan: right - left + 1,
    rowspan: bottom - top + 1,
    covered_keys: keys.filter((selectedKey) => selectedKey !== primaryKey),
    primary_key: primaryKey,
  };
}

function moveFormatSelectionByTab(event) {
  if (!state.formatWorkspaceSelectedKey) {
    return;
  }
  const node = selectedPrimaryFormatNode();
  if (!node) {
    return;
  }
  if (!node.matches("td, th, .visual-cell")) {
    document.execCommand?.("insertText", false, "    ");
    event.preventDefault();
    return;
  }
  const pos = nodeGridPosition(node);
  if (!pos) {
    return;
  }
  const nextCol = Math.max(1, pos.col + (event.shiftKey ? -1 : 1));
  const rowSelector = `[data-row="${pos.row}"][data-col="${nextCol}"]`;
  const nextNode = formatSheetHost?.querySelector(rowSelector);
  if (nextNode?.dataset.formatKey) {
    event.preventDefault();
    selectFormatWorkspaceItem(nextNode.dataset.formatKey, nextNode);
    nextNode.focus();
  }
}

function buildFormatSheetModel(detail) {
  const items = templateEditorItems(detail);
  const context = buildFormatPositionContext(items);
  const cellMap = new Map();
  const covered = new Set();
  let maxRow = 0;
  let maxCol = 0;
  items.forEach((item, index) => {
    const position = itemGridPosition(item, index, context);
    if (!position) {
      return;
    }
    const colspan = Math.max(1, Number(item.colspan || 1));
    const rowspan = Math.max(1, Number(item.rowspan || 1));
    cellMap.set(`${position.row}:${position.col}`, { item, colspan, rowspan });
    for (let row = position.row; row < position.row + rowspan; row++) {
      for (let col = position.col; col < position.col + colspan; col++) {
        if (row !== position.row || col !== position.col) {
          covered.add(`${row}:${col}`);
        }
      }
    }
    maxRow = Math.max(maxRow, position.row + rowspan - 1);
    maxCol = Math.max(maxCol, position.col + colspan - 1);
  });
  const summary = templateEditorSummary(detail);
  const firstSheet = Array.isArray(summary.sheets) ? summary.sheets[0] : null;
  maxRow = Math.max(maxRow, Number(firstSheet?.max_row || 0), 24);
  maxCol = Math.max(maxCol, Number(firstSheet?.max_column || 0), 1);
  return {
    cellMap,
    covered,
    sheetName: firstSheet?.name || templateEditorItems(detail)[0]?.sheet || "Statement",
    maxRow: Math.min(maxRow, 600),
    maxCol: Math.min(maxCol, 120),
    columnWidths: firstSheet?.column_widths || {},
    rowHeights: firstSheet?.row_heights || {},
  };
}

function renderHtmlPreviewFormat(detail) {
  const shell = document.createElement("div");
  shell.className = detail?.kind === "certificate" ? "word-page html-template-preview" : "html-template-preview";
  shell.innerHTML = String(detail?.html_preview || "");
  shell.querySelectorAll("table").forEach((table) => {
    Array.from(table.rows).forEach((rowNode, rowIndex) => {
      Array.from(rowNode.cells).forEach((cellNode, colIndex) => {
        cellNode.dataset.row = String(rowIndex + 1);
        cellNode.dataset.col = String(colIndex + 1);
        cellNode.dataset.address = cellNode.dataset.address || `${columnName(colIndex + 1)}${rowIndex + 1}`;
      });
    });
  });
  shell.querySelectorAll("[data-template-key]").forEach((node) => {
    const key = node.getAttribute("data-template-key") || "";
    node.dataset.formatKey = key;
    node.contentEditable = detail?.editable ? "true" : "false";
    if (node.matches("td, th")) {
      node.classList.add("visual-cell");
    } else {
      node.classList.add("word-block");
    }
    node.addEventListener("click", (event) => {
      event.stopPropagation();
      if (event.ctrlKey || event.metaKey) {
        toggleFormatWorkspaceSelection(key, node);
        return;
      }
      if (event.shiftKey && state.formatWorkspaceAnchorKey && selectFormatRange(state.formatWorkspaceAnchorKey, key)) {
        return;
      }
      selectFormatWorkspaceItem(key, node, { shiftKey: event.shiftKey });
    });
    node.addEventListener("input", () => {
      selectFormatWorkspaceItem(key, node);
      syncWorkspaceText(node.textContent || "");
    });
  });
  formatSheetHost.replaceChildren(shell);
}

function renderFormatSheet(detail) {
  const model = buildFormatSheetModel(detail);
  const table = document.createElement("table");
  table.className = "visual-sheet";
  const colgroup = document.createElement("colgroup");
  colgroup.append(document.createElement("col"));
  for (let col = 1; col <= model.maxCol; col++) {
    const colNode = document.createElement("col");
    const width = Number(model.columnWidths[columnName(col)] || model.columnWidths[col] || 0);
    if (width > 0) {
      colNode.style.width = `${Math.max(46, Math.round(width * 7 + 12))}px`;
    }
    colgroup.append(colNode);
  }
  table.append(colgroup);
  const thead = document.createElement("thead");
  const headerRow = document.createElement("tr");
  headerRow.append(document.createElement("th"));
  for (let col = 1; col <= model.maxCol; col++) {
    const th = document.createElement("th");
    th.textContent = columnName(col);
    headerRow.append(th);
  }
  thead.append(headerRow);
  table.append(thead);
  const tbody = document.createElement("tbody");
  for (let row = 1; row <= model.maxRow; row++) {
    const tr = document.createElement("tr");
    const rowHeight = Number(model.rowHeights[row] || 0);
    if (rowHeight > 0) {
      tr.style.height = `${Math.max(20, Math.round(rowHeight * 4 / 3))}px`;
    }
    const rowHead = document.createElement("th");
    rowHead.className = "row-head";
    rowHead.textContent = String(row);
    tr.append(rowHead);
    for (let col = 1; col <= model.maxCol; col++) {
      if (model.covered.has(`${row}:${col}`)) {
        continue;
      }
      const td = document.createElement("td");
      td.className = "visual-cell";
      td.dataset.row = String(row);
      td.dataset.col = String(col);
      const entry = model.cellMap.get(`${row}:${col}`);
      if (entry) {
        const { item, colspan, rowspan } = entry;
        td.dataset.formatKey = item.key;
        td.dataset.address = item.address || `${columnName(col)}${row}`;
        td.contentEditable = detail?.editable ? "true" : "false";
        td.innerHTML = inlineRunsToHtml(item.runs, item.text || "");
        if (colspan > 1) {
          td.colSpan = colspan;
        }
        if (rowspan > 1) {
          td.rowSpan = rowspan;
        }
        applyFormatItemStyle(td, item);
        td.addEventListener("click", (event) => {
          if (event.ctrlKey || event.metaKey) {
            toggleFormatWorkspaceSelection(item.key, td);
            return;
          }
          if (event.shiftKey && state.formatWorkspaceAnchorKey && selectFormatRange(state.formatWorkspaceAnchorKey, item.key)) {
            return;
          }
          selectFormatWorkspaceItem(item.key, td, { shiftKey: event.shiftKey });
        });
        td.addEventListener("input", () => {
          selectFormatWorkspaceItem(item.key, td);
          syncWorkspaceText(td.textContent || "");
        });
      } else {
        const virtualKey = `${model.sheetName}!${columnName(col)}${row}`;
        td.dataset.formatKey = virtualKey;
        td.dataset.address = `${columnName(col)}${row}`;
        td.contentEditable = detail?.editable ? "true" : "false";
        if (!detail?.editable) {
          td.classList.add("is-readonly");
        }
        td.addEventListener("click", (event) => {
          if (event.ctrlKey || event.metaKey) {
            toggleFormatWorkspaceSelection(virtualKey, td);
            return;
          }
          if (event.shiftKey && state.formatWorkspaceAnchorKey && selectFormatRange(state.formatWorkspaceAnchorKey, virtualKey)) {
            return;
          }
          selectFormatWorkspaceItem(virtualKey, td, { shiftKey: event.shiftKey });
        });
        td.addEventListener("input", () => {
          selectFormatWorkspaceItem(virtualKey, td);
          syncWorkspaceText(td.textContent || "");
        });
      }
      tr.append(td);
    }
    tbody.append(tr);
  }
  table.append(tbody);
  formatSheetHost.replaceChildren(table);
}

function renderFormatDocument(detail) {
  const page = document.createElement("div");
  page.className = "word-page";
  const items = templateEditorItems(detail);
  for (const item of items) {
    const block = document.createElement("div");
    block.className = "word-block";
    block.dataset.formatKey = item.key;
    block.contentEditable = "false";
    const label = document.createElement("span");
    label.className = "word-block-label";
    label.textContent = item.label || item.address || item.key;
    const text = document.createElement("div");
    text.className = "word-edit-text";
    text.contentEditable = detail?.editable ? "true" : "false";
    text.innerHTML = inlineRunsToHtml(item.runs, item.text || "");
    block.append(label, text);
    applyFormatItemStyle(block, item);
    block.addEventListener("click", () => selectFormatWorkspaceItem(item.key, block));
    text.addEventListener("input", () => {
      selectFormatWorkspaceItem(item.key, block);
      syncWorkspaceText(text.textContent || "");
    });
    page.append(block);
  }
  formatSheetHost.replaceChildren(page);
}

function renderVisualFormatWorkspace(detail, selectedKey = "") {
  if (!formatWorkspacePanel || !formatSheetHost) {
    return;
  }
  ensureFormatObjectOptions();
  const items = templateEditorItems(detail);
  const summary = templateEditorSummary(detail);
  const kind = detail?.kind === "certificate" ? "Word Certificate" : "Excel Statement";
  formatWorkspaceTitle.textContent = `${kind}: ${detail?.name || "Selected Format"}`;
  formatWorkspaceSummary.textContent = [
    `${items.length} editable cells/text blocks loaded`,
    summary.file || summary.source_extension || detail?.suffix || detail?.source_extension || "",
    detail?.editable ? "custom format can be saved" : "bundled format is view-only",
  ].filter(Boolean).join(" | ");
  state.formatWorkspaceSelectedKey = "";
  state.formatWorkspaceSelectedKeys = [];
  state.formatWorkspaceMergeRequest = null;
  state.formatWorkspaceRangeRequest = null;
  state.formatUndoStack = [];
  formatFormulaInput.value = "";
  formatFormulaInput.disabled = true;
  formatSelectedCell.textContent = "No cell selected.";
  showFormatSaveStatus("");
  if (detail?.html_preview) {
    renderHtmlPreviewFormat(detail);
  } else if (detail?.kind === "certificate") {
    renderFormatDocument(detail);
  } else {
    renderFormatSheet(detail);
  }
  const nextKey = selectedKey || items[0]?.key || "";
  if (nextKey) {
    selectFormatWorkspaceItem(nextKey);
  }
  applyFormatWorkspaceView();
}

async function saveSelectedWorkspaceItem() {
  const key = state.formatWorkspaceSelectedKey;
  if (!key) {
    throw new Error("Click a cell or Word text block first.");
  }
  const style = collectTemplateStyleChanges();
  const keys = state.formatWorkspaceMergeRequest ? [key] : (state.formatWorkspaceSelectedKeys.length ? state.formatWorkspaceSelectedKeys : [key]);
  if (keys.length > 1) {
    const values = getFormValues();
    for (const selectedKey of keys) {
      await fetchJson(apiUrl("template_update"), {
        method: "POST",
        body: JSON.stringify({
          kind: state.templateEditorDetail.kind,
          name: state.templateEditorDetail.name,
          template_dir: values.template_dir,
          key: selectedKey,
          text: workspaceTextForKey(selectedKey),
          style,
        }),
      });
    }
    await refreshTemplates();
    await loadTemplateDetail(false);
    appendLog(`Saved successfully: formatting applied to ${keys.length} selected cells.`, "success");
    showFormatSaveStatus(`Saved ${keys.length} selected cells to the stored format.`, "success");
    return;
  }
  if (templateItemSelect) {
    templateItemSelect.value = key;
  }
  const liveText = workspaceTextForKey(key);
  if (formatFormulaInput && formatFormulaInput.value !== liveText && document.activeElement === formatFormulaInput) {
    syncWorkspaceText(formatFormulaInput.value);
  } else {
    if (formatFormulaInput) {
      formatFormulaInput.value = liveText;
    }
    if (richRunsForKey(key).length) {
      if (templateItemText) {
        templateItemText.value = liveText;
      }
    } else {
      syncWorkspaceText(liveText);
    }
  }
  await saveTemplateItemEdit();
}

function insertObjectIntoSelectedWorkspaceCell() {
  const token = formatObjectSelect?.value || "";
  if (!token) {
    return;
  }
  if (!state.formatWorkspaceSelectedKey) {
    throw new Error("Click a cell or Word text block before inserting an object.");
  }
  const value = `{{${token}}}`;
  if (formatFormulaInput) {
    formatFormulaInput.value = value;
  }
  syncWorkspaceText(value);
}

async function createStatementFormatInWorkspace() {
  const name = (await requestModalValue("Create Statement Format", "Enter the new statement format name. It will open immediately as an editable worksheet.", {
    defaultValue: "Custom Statement Format",
    placeholder: "Format name",
  })).trim();
  if (!name) {
    throw new Error("Enter a new statement format name first.");
  }
  document.getElementById("builder-format-name").value = name;
  await saveCreatedStatementFormat();
}

async function addParagraphToWordFormat() {
  const detail = state.templateEditorDetail;
  if (!detail || detail.kind !== "certificate") {
    throw new Error("Open a Word certificate format before adding a paragraph.");
  }
  if (!detail.editable) {
    throw new Error("Bundled formats are read-only. Upload a custom .docx format first.");
  }
  const text = (await requestModalValue("Add Paragraph", "Enter the new paragraph text.", {
    defaultValue: "New paragraph",
    placeholder: "Paragraph text",
  })).trim() || "New paragraph";
  const values = getFormValues();
  await fetchJson(apiUrl("template_update"), {
    method: "POST",
    body: JSON.stringify({
      kind: detail.kind,
      name: detail.name,
      template_dir: values.template_dir,
      key: "__append_paragraph__",
      text,
      style: collectTemplateStyleChanges(),
    }),
  });
  await refreshTemplates();
  await loadTemplateDetail(false);
  appendLog(`Saved successfully: added a new paragraph to ${detail.name}.`, "success");
  showFormatSaveStatus("Saved new paragraph to the Word format.", "success");
}

async function updateExcelStructure(action) {
  const detail = state.templateEditorDetail;
  if (!detail || detail.kind !== "statement") {
    throw new Error("Open an Excel statement format before using row, column, header, or footer tools.");
  }
  if (!detail.editable) {
    throw new Error("Bundled formats are read-only. Upload a custom .xlsx format first.");
  }
  const values = getFormValues();
  let text = "";
  let message = "";
  if (action === "__add_header__" || action === "__add_footer__") {
    text = await requestModalValue(action === "__add_header__" ? "Excel Header" : "Excel Footer", "Enter the header/footer text to save inside this format.", {
      defaultValue: action === "__add_header__" ? "{{bank_name}} - Statement" : "Page &P of &N",
      placeholder: "Header/footer text",
    });
    message = action === "__add_header__" ? "Saved Excel header to the format." : "Saved Excel footer to the format.";
  } else if (!state.formatWorkspaceSelectedKey) {
    throw new Error("Click a cell first, then insert a row or column.");
  } else {
    message = action === "__insert_row__" ? "Inserted a new Excel row into the format." : "Inserted a new Excel column into the format.";
  }
  await fetchJson(apiUrl("template_update"), {
    method: "POST",
    body: JSON.stringify({
      kind: detail.kind,
      name: detail.name,
      template_dir: values.template_dir,
      key: action,
      text,
      style: { target_key: state.formatWorkspaceSelectedKey },
    }),
  });
  await refreshTemplates();
  const refreshed = await loadTemplateDetail(false);
  renderTemplateEditor(refreshed);
  renderVisualFormatWorkspace(refreshed, state.formatWorkspaceSelectedKey);
  appendLog(message, "success");
  showFormatSaveStatus(message, "success");
}

async function unmergeSelectedExcelCells() {
  const detail = state.templateEditorDetail;
  if (!detail || detail.kind !== "statement") {
    throw new Error("Open an Excel statement format before unmerging cells.");
  }
  if (!detail.editable) {
    throw new Error("Bundled formats are read-only. Upload a custom .xlsx format first.");
  }
  const key = state.formatWorkspaceSelectedKey;
  const item = selectedTemplateEditorItemByKey(key);
  const range = item?.merge_range || item?.style?.merge_range || "";
  if (!key || !range) {
    throw new Error("Select the top-left cell of an existing merged range first.");
  }
  const values = getFormValues();
  await fetchJson(apiUrl("template_update"), {
    method: "POST",
    body: JSON.stringify({
      kind: detail.kind,
      name: detail.name,
      template_dir: values.template_dir,
      key,
      text: workspaceTextForKey(key),
      style: { unmerge_range: range },
    }),
  });
  await refreshTemplates();
  const refreshed = await loadTemplateDetail(false);
  renderTemplateEditor(refreshed);
  renderVisualFormatWorkspace(refreshed, key);
  appendLog(`Unmerged ${range}.`, "success");
  showFormatSaveStatus(`Unmerged ${range} in the stored format.`, "success");
}

function collectTemplateStyleChanges() {
  const style = {};
  if (formatFontFamily?.value) {
    style.font_name = formatFontFamily.value;
  }
  if (formatFontSize?.value.trim()) {
    style.font_size = formatFontSize.value.trim();
  } else if (templateItemFontSize?.value.trim()) {
    style.font_size = templateItemFontSize.value.trim();
  }
  if (templateItemAlign?.value) {
    style.horizontal = templateItemAlign.value;
  }
  if (formatVerticalAlign?.value) {
    style.vertical = formatVerticalAlign.value;
  } else if (templateItemVertical?.value) {
    style.vertical = templateItemVertical.value;
  }
  if (formatNumberFormat?.value.trim()) {
    style.number_format = formatNumberFormat.value.trim();
  } else if (templateItemNumberFormat?.value.trim()) {
    style.number_format = templateItemNumberFormat.value.trim();
  }
  if (activeFormatButton("bold")) {
    style.bold = true;
  } else if (templateItemBold?.value === "false") {
    style.bold = false;
  }
  if (activeFormatButton("italic")) {
    style.italic = true;
  }
  if (activeFormatButton("underline")) {
    style.underline = true;
  }
  if (activeFormatButton("strike")) {
    style.strike = true;
  }
  if (activeFormatButton("wrap")) {
    style.wrap_text = true;
  }
  if (formatLineSpacing?.value) {
    style.line_spacing = formatLineSpacing.value;
  }
  if (formatLeftTab?.value) {
    style.left_tab = `${Number(formatLeftTab.value || 0)}px`;
  }
  if (formatLeftIndent?.value) {
    style.indent = Math.max(0, Math.round(Number(formatLeftIndent.value || 0) / 18));
    style.left_indent = `${Number(formatLeftIndent.value || 0)}px`;
  }
  if (formatFirstIndent?.value) {
    style.first_line_indent = `${Number(formatFirstIndent.value || 0)}px`;
  }
  if (formatBorderStyle?.value) {
    style.border_style = formatBorderStyle.value;
  }
  if (formatFontColor && formatFontColor.value !== formatFontColor.dataset.originalValue) {
    style.font_color = formatFontColor.value;
  } else if (templateItemColor && templateItemColor.value !== templateItemColor.dataset.originalValue) {
    style.font_color = templateItemColor.value;
  }
  if (formatFillColor && formatFillColor.value !== formatFillColor.dataset.originalValue) {
    style.fill_color = formatFillColor.value;
  } else if (templateItemBg && templateItemBg.value !== templateItemBg.dataset.originalValue) {
    style.fill_color = templateItemBg.value;
  }
  const selectedNode = selectedPrimaryFormatNode();
  const selectedNodeStyle = selectedNode ? window.getComputedStyle(selectedNode) : null;
  const liveAlign = normalizeHorizontalAlign(selectedNode?.style.textAlign || selectedNodeStyle?.textAlign || "");
  const liveVertical = normalizeVerticalAlign(selectedNode?.style.verticalAlign || selectedNodeStyle?.verticalAlign || "");
  if (liveAlign) {
    style.horizontal = liveAlign;
  }
  if (liveVertical) {
    style.vertical = liveVertical;
  }
  if (selectedNode?.style.paddingLeft) {
    style.indent = Math.max(0, Math.round((parseInt(selectedNode.style.paddingLeft, 10) || 0) / 18));
    style.left_indent = selectedNode.style.paddingLeft;
  }
  if (selectedNode?.style.textIndent) {
    style.first_line_indent = selectedNode.style.textIndent;
  }
  if (state.formatWorkspaceMergeRequest) {
    style.merge_range = state.formatWorkspaceMergeRequest.range;
  }
  const richRuns = state.formatWorkspaceSelectedKeys.length <= 1 ? richRunsForKey() : [];
  if (richRuns.length) {
    style.rich_runs = richRuns;
  }
  return style;
}

async function saveTemplateItemEdit() {
  const detail = state.templateEditorDetail;
  const item = selectedTemplateEditorItem();
  if (!detail || !item) {
    throw new Error("Select a scanned format item first.");
  }
  if (!detail.editable) {
    throw new Error("Bundled or legacy formats are read-only. Upload a custom .xlsx or .docx format first.");
  }
  const values = getFormValues();
  await fetchJson(apiUrl("template_update"), {
    method: "POST",
    body: JSON.stringify({
      kind: detail.kind,
      name: detail.name,
      template_dir: values.template_dir,
      key: item.key,
      text: templateItemText.value,
      style: collectTemplateStyleChanges(),
    }),
  });
  await refreshTemplates();
  const activeList = detail.kind === "statement"
    ? document.getElementById("statement-template-list")
    : document.getElementById("certificate-template-list");
  if (activeList) {
    activeList.value = detail.name;
  }
  const refreshed = await loadTemplateDetail(false);
  renderTemplateEditor(refreshed);
  renderVisualFormatWorkspace(refreshed, item.key);
  templateItemSelect.value = item.key;
  fillTemplateItemControls(selectedTemplateEditorItem());
  appendLog(`Saved successfully: ${item.label || item.key} in ${detail.name}.`, "success");
  showFormatSaveStatus(`Saved to original custom format: ${detail.name}.`, "success");
}

function builderDefinition() {
  return {
    headers: document.getElementById("builder-headers").value
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean),
    transaction_rows: Number(document.getElementById("builder-transaction-rows").value || 55),
    include_total: document.getElementById("builder-include-total").value === "yes",
    include_summary: document.getElementById("builder-include-summary").value === "yes",
  };
}

async function saveCreatedStatementFormat() {
  const name = document.getElementById("builder-format-name").value.trim();
  if (!name) {
    throw new Error("Enter a new statement format name first.");
  }
  const values = getFormValues();
  const payload = await fetchJson(apiUrl("template_create_statement"), {
    method: "POST",
    body: JSON.stringify({
      name,
      definition: builderDefinition(),
      profile: values,
      template_dir: values.template_dir,
    }),
  });
  state.templates = payload.templates;
  renderTemplateList(document.getElementById("statement-template-list"), payload.templates.statement_templates || []);
  renderTemplateList(document.getElementById("certificate-template-list"), payload.templates.certificate_templates || []);
  document.getElementById("statement-template-list").value = payload.saved_template.name;
  appendLog(`Created statement format ${payload.saved_template.name}.`);
  document.getElementById("statement-format-builder-panel").hidden = true;
  await loadTemplateDetail(true);
}

async function saveCurrentDetailsToSelectedTemplate() {
  const { kind, name, option } = selectedTemplateNameAndKind();
  if (option.dataset.editable !== "true" || option.dataset.source !== "custom") {
    throw new Error("Only your custom uploaded or created formats can save account/rule/text details.");
  }
  const values = getFormValues();
  await fetchJson(apiUrl("template_profile_update"), {
    method: "POST",
    body: JSON.stringify({ kind, name, template_dir: values.template_dir, profile: values }),
  });
  appendLog(`Saved current account, rules, texts, and names to ${name}.`);
  await loadTemplateDetail(false);
}

async function restoreSelectedUserDates() {
  const userId = manageUserSelect.value;
  if (!userId) {
    throw new Error("Select a user first.");
  }
  const password = await requestPassword("Restore Date Rules", "Enter your admin password to restore this user's saved date rules.");
  if (!password) {
    throw new Error("Date restore was cancelled.");
  }
  const values = getFormValues();
  const payload = await fetchJson(apiUrl("state_restore"), {
    method: "POST",
    body: JSON.stringify({
      user_id: userId,
      part: document.getElementById("restore-date-part").value,
      start_date: values.start_date,
      end_date: values.end_date,
      password,
    }),
  });
  renderHolidayPayload(payload.holidays);
  renderPostingPayload(payload.posting_dates);
  appendLog(`Restored ${payload.part} date rules for the selected user.`);
}

async function generateStatement() {
  if (document.getElementById("amount-rounding-mode")?.value === "custom" && !updateRoundingPercentagesValue()) {
    throw new Error("Enter rounding percentages from 0 to 100 that total 100%.");
  }
  const payload = getFormValues();
  const result = await fetchJson(apiUrl("generate"), {
    method: "POST",
    body: JSON.stringify(payload),
  });
  if (result.current_user) {
    renderCurrentUser(result.current_user);
  }
  setCurrentStatement(payload, result);
  renderHolidayPayload(result.holidays);
  if (result.history) {
    renderHistoryPanel(result.history);
  }
  appendLog(`Generated ${result.summary.row_count} rows. Final balance ${result.summary.final_balance_text}. Issue date ${result.summary.issue_date}.`);
}

function buildExportPayload(exportKind, exportMode, templateName = "") {
  if (!state.currentStatement) {
    throw new Error("Generate, import, or load a statement before exporting.");
  }
  const values = getFormValues();
  return {
    export_kind: exportKind,
    export_mode: exportMode,
    template_name: templateName,
    template_dir: values.template_dir,
    rate_mode: values.rate_mode,
    rate_type: values.rate_type,
    manual_rate: values.manual_rate,
    generated_seed: state.generatedSeed,
    statement_id: state.currentStatementId,
    source_type: state.currentStatementSource,
    config: values,
    result_payload: state.currentStatement,
  };
}

async function requestDownload(payload, logLabel) {
  const response = await fetch(apiUrl("export"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(state.authToken ? { Authorization: `Bearer ${state.authToken}` } : {}),
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    let data = {};
    try {
      data = await response.json();
    } catch {
      data = {};
    }
    if (data.requires_manual_rate && payload.rate_mode !== "Manual") {
      const rateText = await requestModalValue(
        "Manual USD/NPR Rate Required",
        `${data.error || "Automatic NRB exchange-rate lookup failed."} Enter the USD/NPR rate manually to continue this export.`,
        {
          type: "number",
          placeholder: "Example: 142.50",
          defaultValue: form.querySelector('[name="manual_rate"]')?.value || "",
        }
      );
      const manualRate = Number(String(rateText).replace(/,/g, ""));
      if (!Number.isFinite(manualRate) || manualRate <= 0) {
        throw new Error("Enter a valid manual USD/NPR exchange rate before exporting.");
      }
      const rateModeInput = form.querySelector('[name="rate_mode"]');
      const manualRateInput = form.querySelector('[name="manual_rate"]');
      if (rateModeInput) {
        rateModeInput.value = "Manual";
      }
      if (manualRateInput) {
        manualRateInput.value = String(manualRate);
      }
      updateManualRateState();
      saveDraftProfile(true).catch(() => {});
      appendLog("NRB auto rate was unavailable, so this export is continuing with the manual USD/NPR rate.", "error");
      return requestDownload({ ...payload, rate_mode: "Manual", manual_rate: String(manualRate) }, logLabel);
    }
    throw new Error(data.error || "Export failed.");
  }
  const blob = await response.blob();
  const header = response.headers.get("Content-Disposition") || "";
  const match = /filename="([^"]+)"/i.exec(header);
  const fileName = match ? match[1] : "statement-output";
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
  appendLog(`${logLabel} exported successfully as ${fileName}.`);
}

async function requestExportBlobForPrint(payload) {
  const response = await fetch(apiUrl("export"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(state.authToken ? { Authorization: `Bearer ${state.authToken}` } : {}),
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    let data = {};
    try {
      data = await response.json();
    } catch {
      data = {};
    }
    if (data.requires_manual_rate && payload.rate_mode !== "Manual") {
      const rateText = await requestModalValue(
        "Manual USD/NPR Rate Required",
        `${data.error || "Automatic NRB exchange-rate lookup failed."} Enter the USD/NPR rate manually to continue this print.`,
        {
          type: "number",
          placeholder: "Example: 142.50",
          defaultValue: form.querySelector('[name="manual_rate"]')?.value || "",
        }
      );
      const manualRate = Number(String(rateText).replace(/,/g, ""));
      if (!Number.isFinite(manualRate) || manualRate <= 0) {
        throw new Error("Enter a valid manual USD/NPR exchange rate before printing.");
      }
      const rateModeInput = form.querySelector('[name="rate_mode"]');
      const manualRateInput = form.querySelector('[name="manual_rate"]');
      if (rateModeInput) {
        rateModeInput.value = "Manual";
      }
      if (manualRateInput) {
        manualRateInput.value = String(manualRate);
      }
      updateManualRateState();
      saveDraftProfile(true).catch(() => {});
      appendLog("NRB auto rate was unavailable, so this print is continuing with the manual USD/NPR rate.", "error");
      return requestExportBlobForPrint({ ...payload, rate_mode: "Manual", manual_rate: String(manualRate) });
    }
    throw new Error(data.error || "Print export failed.");
  }
  return response.blob();
}

function buildPrintHtml(sourceHtml, kind, autoPrint) {
  const title = kind === "certificate" ? "Balance Certificate" : "Statement";
  const toolbar = `
<div class="print-toolbar">
  <strong>${escapeHtml(title)} Print Preview</strong>
  <button type="button" onclick="window.print()">Print</button>
</div>`;
  const printStyles = `
<style>
@page { size: A4; margin: 12mm; }
html, body { background: #f4f7f9; }
.print-toolbar {
  position: sticky;
  top: 0;
  z-index: 9999;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  border-bottom: 1px solid #d7e0e7;
  background: #ffffff;
  color: #16324a;
  font-family: Arial, sans-serif;
}
.print-toolbar button {
  border: 0;
  border-radius: 8px;
  padding: 8px 14px;
  background: #0f6c78;
  color: #ffffff;
  font-weight: 700;
  cursor: pointer;
}
.date-cell, .statement-date-cell { white-space: nowrap !important; }
@media print {
  html, body { background: #ffffff !important; }
  .print-toolbar { display: none !important; }
}
</style>`;
  const printScript = autoPrint
    ? `<script>window.addEventListener("load", function () { setTimeout(function () { window.focus(); window.print(); }, 350); });</script>`
    : "";
  let html = String(sourceHtml || "");
  if (/<\/head>/i.test(html)) {
    html = html.replace(/<\/head>/i, `${printStyles}</head>`);
  } else {
    html = `${printStyles}${html}`;
  }
  if (/<body[^>]*>/i.test(html)) {
    html = html.replace(/<body[^>]*>/i, (match) => `${match}${toolbar}`);
  } else {
    html = `${toolbar}${html}`;
  }
  if (/<\/body>/i.test(html)) {
    html = html.replace(/<\/body>/i, `${printScript}</body>`);
  } else {
    html = `${html}${printScript}`;
  }
  return html;
}

function slashDateText(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : String(value || "");
}

function formatPreviewValueMap() {
  const values = getFormValues();
  const statement = state.currentStatement || {};
  const summary = statement.summary || {};
  const rows = currentPreviewRows();
  const lastRow = rows[rows.length - 1] || {};
  const finalBalance = Number(statement.final_balance ?? lastRow.balance ?? values.target_closing_balance ?? 0);
  const finalBalanceText = summary.final_balance_text || (Number.isFinite(finalBalance) ? `Rs. ${moneyText(finalBalance)}` : "");
  const issueDate = statement.issue_date || summary.issue_date || values.issue_date || "";
  const lastDate = statement.last_transaction_date || lastRow.date || values.end_date || "";
  return {
    ...values,
    name: values.customer_name || "",
    address: values.customer_address || "",
    ref_no: values.reference_no || "",
    reference_no: values.reference_no || "",
    date: slashDateText(issueDate),
    issue_date: issueDate,
    issue_date_iso: issueDate,
    issue_date_slash: slashDateText(issueDate),
    opening_date_iso: values.opening_date || "",
    opening_date_slash: slashDateText(values.opening_date || ""),
    start_date_iso: values.start_date || "",
    end_date_iso: lastDate,
    period_label_iso: `${values.start_date || ""} to ${lastDate || values.end_date || ""}`.trim(),
    period_label_slash: `${slashDateText(values.start_date || "")} to ${slashDateText(lastDate || values.end_date || "")}`.trim(),
    final_balance: Number.isFinite(finalBalance) ? moneyText(finalBalance) : "",
    final_balance_text: finalBalanceText,
    total_balance_npr_text: finalBalanceText,
    total_balance: finalBalanceText,
    total_debit: summary.total_withdrawals_text || "",
    total_credit: summary.total_deposits_text || "",
    total_deposits_text: summary.total_deposits_text || "",
    total_withdrawals_text: summary.total_withdrawals_text || "",
    total_interest_text: summary.total_interest_text || "",
    total_tax_text: summary.total_tax_text || "",
    row_count: String(summary.row_count ?? rows.length),
    seed_used: summary.seed_used || "",
    usd_npr_text: values.manual_rate || "",
    equivalent_usd_text: "",
    balance_words_npr: "",
    balance_words_usd: "",
    authorization_details: "Authorized Signature",
  };
}

function replaceTemplateTokens(root, valueMap) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const textNodes = [];
  while (walker.nextNode()) {
    textNodes.push(walker.currentNode);
  }
  for (const node of textNodes) {
    node.nodeValue = String(node.nodeValue || "").replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (match, key) => (
      Object.hasOwn(valueMap, key) ? String(valueMap[key] ?? "") : match
    ));
  }
}

function statementColumnKey(text) {
  const value = String(text || "").toLowerCase().replace(/\s+/g, " ").trim();
  if (!value) {
    return "";
  }
  if (value === "value date") {
    return "value_date";
  }
  if (value === "transaction date" || value === "txn date") {
    return "txn_date";
  }
  if (value === "date" || value.includes("miti")) {
    return "date";
  }
  if (value.includes("description") || value.includes("particular") || value.includes("details")) {
    return "description";
  }
  if (value.includes("cheque") || value.includes("chq")) {
    return "cheque";
  }
  if (value.includes("debit") || value.includes("withdraw")) {
    return "debit";
  }
  if (value.includes("credit") || value.includes("deposit")) {
    return "credit";
  }
  if (value.includes("balance")) {
    return "balance";
  }
  return "";
}

function findStatementPreviewTable(root) {
  for (const table of root.querySelectorAll("table")) {
    const rows = Array.from(table.rows);
    for (const [rowIndex, row] of rows.entries()) {
      const columnMap = {};
      Array.from(row.cells).forEach((cell, cellIndex) => {
        const key = statementColumnKey(cell.textContent || "");
        if (key && columnMap[key] === undefined) {
          columnMap[key] = cellIndex;
        }
      });
      if (columnMap.date === undefined) {
        columnMap.date = columnMap.txn_date ?? columnMap.value_date;
      }
      if (columnMap.date !== undefined && columnMap.description !== undefined && columnMap.debit !== undefined && columnMap.credit !== undefined && columnMap.balance !== undefined) {
        return { table, headerRowIndex: rowIndex, columnMap };
      }
    }
  }
  return null;
}

function previewSummaryLikeRow(row, columnMap = {}) {
  const text = String(row?.textContent || "").toLowerCase().replace(/\s+/g, " ").trim();
  const dateCell = row?.cells?.[columnMap.date ?? columnMap.txn_date ?? columnMap.value_date];
  const dateText = String(dateCell?.textContent || "").trim();
  if (/^\d{4}[-/]\d{1,2}[-/]\d{1,2}$/.test(dateText)) {
    return false;
  }
  return /\b(total|summary|closing balance|balance in word|balance in words|transaction summary|notice)\b/.test(text);
}

function setPreviewCellText(cell, value) {
  if (!cell) {
    return;
  }
  cell.textContent = value ?? "";
}

function appendPreviewCellStyle(cell, rule) {
  if (!cell || !rule) {
    return;
  }
  const current = String(cell.getAttribute("style") || "").trim();
  cell.setAttribute("style", current ? `${current.replace(/;*$/, "")};${rule}` : rule);
}

function clearPreviewDataRow(row) {
  Array.from(row?.cells || []).forEach((cell) => {
    cell.textContent = "";
  });
}

function fillStatementRowsInPreview(root) {
  const match = findStatementPreviewTable(root);
  const rowsData = currentPreviewRows();
  if (!match || rowsData.length === 0) {
    return false;
  }
  const { table, headerRowIndex, columnMap } = match;
  const startIndex = headerRowIndex + 1;
  let endIndex = startIndex;
  while (endIndex < table.rows.length && !previewSummaryLikeRow(table.rows[endIndex], columnMap)) {
    endIndex += 1;
  }
  const parent = table.tBodies[0] || table.rows[startIndex]?.parentNode || table;
  const insertBefore = table.rows[endIndex] || null;
  const templateRow = table.rows[Math.max(startIndex, Math.min(endIndex - 1, table.rows.length - 1))] || table.rows[headerRowIndex];
  const capacity = Math.max(0, endIndex - startIndex);
  for (let index = capacity; index < rowsData.length; index++) {
    const clone = templateRow.cloneNode(true);
    clone.dataset.generatedTransactionRow = "true";
    clearPreviewDataRow(clone);
    parent.insertBefore(clone, insertBefore);
  }
  rowsData.forEach((row, index) => {
    const targetRow = table.rows[startIndex + index];
    if (!targetRow) {
      return;
    }
    const cells = Array.from(targetRow.cells);
    const usedDateColumns = new Set();
    for (const dateColumnKey of ["txn_date", "value_date", "date"]) {
      const dateColumnIndex = columnMap[dateColumnKey];
      if (dateColumnIndex === undefined || usedDateColumns.has(dateColumnIndex)) {
        continue;
      }
      usedDateColumns.add(dateColumnIndex);
      const dateValue = dateColumnKey === "value_date" ? (row.value_date || row.date || "") : (row.txn_date || row.date || "");
      setPreviewCellText(cells[dateColumnIndex], dateValue);
      appendPreviewCellStyle(cells[dateColumnIndex], "white-space:nowrap;");
    }
    setPreviewCellText(cells[columnMap.description], row.description || "");
    if (columnMap.cheque !== undefined) {
      setPreviewCellText(cells[columnMap.cheque], row.cheque_no || "");
    }
    setPreviewCellText(cells[columnMap.debit], row.debit_text || moneyText(row.debit));
    setPreviewCellText(cells[columnMap.credit], row.credit_text || moneyText(row.credit));
    setPreviewCellText(cells[columnMap.balance], row.balance_text || moneyText(row.balance));
  });
  for (let rowIndex = startIndex + rowsData.length; rowIndex < table.rows.length; rowIndex++) {
    const row = table.rows[rowIndex];
    if (previewSummaryLikeRow(row, columnMap)) {
      break;
    }
    clearPreviewDataRow(row);
  }
  return true;
}

function cleanGeneratedFormatClone(clone) {
  clone.querySelectorAll("[contenteditable]").forEach((node) => node.removeAttribute("contenteditable"));
  clone.querySelectorAll(".is-selected,.is-range-selected").forEach((node) => node.classList.remove("is-selected", "is-range-selected"));
  clone.querySelectorAll(".word-block-label").forEach((node) => node.remove());
  clone.querySelectorAll("table.visual-sheet").forEach((table) => {
    table.querySelector("thead")?.remove();
    table.querySelectorAll("tr").forEach((row) => row.querySelector(".row-head")?.remove());
    table.querySelector("colgroup col")?.remove();
  });
  return clone;
}

function buildGeneratedFormatPreviewHtml(detail) {
  if (!state.currentStatement) {
    throw new Error("Generate or load a statement before showing the generated format.");
  }
  if (!formatSheetHost || !formatSheetHost.children.length) {
    throw new Error("Open or scan a format before showing the generated format.");
  }
  const clone = cleanGeneratedFormatClone(formatSheetHost.cloneNode(true));
  replaceTemplateTokens(clone, formatPreviewValueMap());
  if (detail?.kind !== "certificate") {
    fillStatementRowsInPreview(clone);
  }
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
@page { size: A4; margin: 12mm; }
html, body { margin: 0; background: #eef3f6; color: #16324a; font-family: Calibri, Arial, sans-serif; }
.generated-format-page { width: 210mm; min-height: 297mm; margin: 0 auto; padding: 10mm; box-sizing: border-box; background: #fff; }
.format-sheet-host { overflow: visible; }
.visual-sheet, .html-template-preview table { border-collapse: collapse; table-layout: fixed; width: 100%; }
.visual-sheet td, .visual-sheet th, .html-template-preview td, .html-template-preview th { min-width: 28px; padding: 4px 6px; vertical-align: middle; white-space: pre-wrap; }
.date-cell, .statement-date-cell { white-space: nowrap !important; }
.word-page { width: 100%; min-height: 260mm; background: #fff; box-shadow: none; padding: 0; }
.word-block { margin: 0 0 8px; }
@media print { html, body { background: #fff; } .generated-format-page { width: auto; min-height: auto; margin: 0; padding: 0; } }
</style>
</head>
<body><main class="generated-format-page">${clone.innerHTML}</main></body>
</html>`;
}

async function ensureWorkingTransactionDates() {
  if (!state.currentStatement) {
    throw new Error("Generate, import, or load a statement before previewing.");
  }
  const payload = await fetchJson(apiUrl("validate_statement"), {
    method: "POST",
    body: JSON.stringify({
      config: getFormValues(),
      edited_rows: currentPreviewRows(),
      statement_id: state.currentStatementId,
      source_type: state.currentStatementSource,
      dates_only: true,
    }),
  });
  const errors = payload.errors || [];
  if (errors.length) {
    renderValidationResults(errors);
    throw new Error("Correct the blocked transaction dates before printing or previewing this statement.");
  }
}

async function showGeneratedFormatPreview(autoPrint = false) {
  await ensureWorkingTransactionDates();
  const detail = state.templateEditorDetail || await loadTemplateDetail(true);
  const html = buildGeneratedFormatPreviewHtml(detail);
  const kind = detail?.kind === "certificate" ? "certificate" : "statement";
  renderInlinePrintPreview(buildPrintHtml(html, kind, autoPrint), kind, autoPrint);
  appendLog(`${kind === "certificate" ? "Word certificate" : "Excel statement"} generated format preview opened.`, "success");
}

function closeInlinePrintPreview() {
  document.getElementById("inline-print-preview")?.remove();
}

function renderInlinePrintPreview(printHtml, kind, autoPrint = false) {
  closeInlinePrintPreview();
  const title = kind === "certificate" ? "Balance Certificate" : "Statement";
  const overlay = document.createElement("div");
  overlay.id = "inline-print-preview";
  overlay.style.cssText = [
    "position:fixed",
    "inset:0",
    "z-index:10000",
    "display:grid",
    "grid-template-rows:auto 1fr",
    "background:rgba(22,50,74,0.24)",
  ].join(";");
  const toolbar = document.createElement("div");
  toolbar.style.cssText = [
    "display:flex",
    "align-items:center",
    "justify-content:space-between",
    "gap:12px",
    "padding:10px 14px",
    "background:#ffffff",
    "border-bottom:1px solid #d7e0e7",
    "font-family:Arial,sans-serif",
    "color:#16324a",
  ].join(";");
  const label = document.createElement("strong");
  label.textContent = `${title} Print Preview`;
  const actions = document.createElement("div");
  actions.style.cssText = "display:flex;gap:8px;align-items:center;";
  const printButton = document.createElement("button");
  printButton.type = "button";
  printButton.textContent = "Print";
  printButton.style.cssText = "border:0;border-radius:8px;padding:8px 14px;background:#0f6c78;color:#fff;font-weight:700;cursor:pointer;";
  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.textContent = "Close";
  closeButton.style.cssText = "border:1px solid #d7e0e7;border-radius:8px;padding:8px 14px;background:#fff;color:#16324a;font-weight:700;cursor:pointer;";
  const frame = document.createElement("iframe");
  frame.title = `${title} print preview`;
  frame.style.cssText = "width:min(100%, 1120px);height:calc(100vh - 58px);justify-self:center;border:0;background:#fff;box-shadow:0 18px 60px rgba(22,50,74,0.22);";
  frame.srcdoc = printHtml;
  printButton.addEventListener("click", () => frame.contentWindow?.print());
  closeButton.addEventListener("click", closeInlinePrintPreview);
  actions.append(printButton, closeButton);
  toolbar.append(label, actions);
  overlay.append(toolbar, frame);
  document.body.append(overlay);
  if (autoPrint) {
    frame.addEventListener("load", () => setTimeout(() => frame.contentWindow?.print(), 350), { once: true });
  }
}

async function openPrintDocument(kind, autoPrint = false) {
  if (!state.currentStatement) {
    throw new Error("Generate, import, or load a statement before printing.");
  }
  const templateList = document.getElementById(kind === "certificate" ? "certificate-template-list" : "statement-template-list");
  const templateName = templateList?.value || "";
  const printFormatMode = document.getElementById("print-format-mode")?.value || "custom";
  if (printFormatMode === "custom" && !templateName) {
    throw new Error(`Select a ${kind === "certificate" ? "certificate" : "statement"} format first, or choose Normal Form for printing.`);
  }
  const payload = printFormatMode === "custom"
    ? { ...buildExportPayload(kind, "template", templateName), print_preview_html: true }
    : { ...buildExportPayload(kind, "normal"), print_preview_html: true };
  const printWindow = window.open("", "_blank", "width=1100,height=800");
  if (printWindow) {
    printWindow.document.open();
    printWindow.document.write("<!doctype html><title>Preparing Print</title><p style=\"font-family:Arial,sans-serif;padding:24px;\">Preparing print preview...</p>");
    printWindow.document.close();
  }
  const blob = await requestExportBlobForPrint(payload);
  const html = await blob.text();
  const printHtml = buildPrintHtml(html, kind, autoPrint);
  if (printWindow) {
    printWindow.document.open();
    printWindow.document.write(printHtml);
    printWindow.document.close();
  } else {
    renderInlinePrintPreview(printHtml, kind, autoPrint);
  }
  appendLog(`${kind === "certificate" ? "Balance certificate" : "Statement"} ${printFormatMode === "custom" ? "customized format" : "normal form"} print ${autoPrint ? "sent to browser print" : "preview opened"}.`);
}

function getDeviceRegistration() {
  const raw = localStorage.getItem(deviceStorageKey);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed?.device_id && parsed?.device_label) {
        return parsed;
      }
    } catch {
      // ignore broken local cache
    }
  }
  const device = {
    device_id: (globalThis.crypto?.randomUUID?.() || `device-${Date.now()}-${Math.random().toString(16).slice(2)}`).slice(0, 120),
    device_label: `${navigator.platform || "Web"} | ${navigator.userAgent || "Browser"}`.slice(0, 255),
  };
  localStorage.setItem(deviceStorageKey, JSON.stringify(device));
  return device;
}

async function saveDraftProfile(silent = true) {
  const profile = getProfileDraftValues();
  localStorage.setItem(profileStorageKey, JSON.stringify(profile));
  await fetchJson(apiUrl("profile"), {
    method: "POST",
    body: JSON.stringify({ profile }),
  });
  if (!silent) {
    appendLog("Saved the current working draft automatically.");
  }
}

function scheduleAutoProfileSave() {
  if (state.suppressAutoProfileSave) {
    return;
  }
  if (state.autoSaveTimer) {
    clearTimeout(state.autoSaveTimer);
  }
  state.autoSaveTimer = setTimeout(() => {
    saveDraftProfile(true).catch((error) => appendLog(error.message, "error"));
  }, 700);
}

async function saveProfileFormat(nameOverride = "") {
  const editorMode = profileFormatEditor.dataset.mode || state.profileFormatEditorMode || "create";
  const originalName = String(profileFormatEditor.dataset.originalName || state.profileFormatEditOriginalName || "").trim();
  const typedName = String(nameOverride || profileFormatNameInput.value || "").trim();
  const fallbackName = editorMode === "edit" ? originalName : profileFormatSelect.value;
  const name = typedName || String(fallbackName || "").trim();
  if (!name) {
    throw new Error("Enter a profile format name first.");
  }
  const profile = getProfileDraftValues();
  let password = "";
  if (editorMode === "edit" && originalName) {
    password = await requestPassword("Edit Profile Format", "Enter your account password to edit this saved profile format.");
    if (!password) {
      throw new Error("Profile format update was cancelled.");
    }
  }
  const payload = await fetchJson(apiUrl("profile_formats"), {
    method: "POST",
    body: JSON.stringify({
      action: "save",
      name,
      profile,
      original_name: editorMode === "edit" ? originalName : "",
      password,
    }),
  });
  renderProfileFormats(payload);
  const savedName = payload.name || payload.profile_name || name;
  profileFormatSelect.value = savedName;
  closeProfileFormatEditor();
  appendLog(`${editorMode === "edit" ? "Updated" : "Saved"} profile format ${savedName}.`);
}

async function deleteProfileFormat() {
  const name = String(profileFormatEditor.dataset.originalName || profileFormatSelect.value || "").trim();
  if (!name) {
    throw new Error("Select a saved profile format first.");
  }
  const password = await requestPassword("Delete Profile Format", "Enter your account password to delete this saved profile format.");
  if (!password) {
    throw new Error("Profile format delete was cancelled.");
  }
  const payload = await fetchJson(apiUrl("profile_formats"), {
    method: "POST",
    body: JSON.stringify({
      action: "delete",
      name,
      password,
    }),
  });
  renderProfileFormats(payload);
  closeProfileFormatEditor();
  appendLog(`Deleted profile format ${payload.name || name}.`);
}

async function loadProfileFormat() {
  const name = profileFormatSelect.value;
  if (!name) {
    throw new Error("Select a saved profile format first.");
  }
  const payload = await fetchJson(apiUrl("profile_formats", { name }), { method: "GET" });
  applyFormValues(payload.profile || {});
  await saveDraftProfile(true);
  await refreshTemplates();
  await refreshHolidayRows(state.holidayView);
  await refreshPostingDates();
  appendLog(`Loaded profile format ${payload.name || payload.profile_name || name}.`);
}

async function runSelfTests() {
  const payload = await fetchJson(apiUrl("selftest"), {
    method: "POST",
    body: JSON.stringify({}),
  });
  appendLog(`Self tests completed. Ran ${payload.tests_run} tests. Failures: ${payload.failures}. Errors: ${payload.errors}.`);
}

async function login() {
  const username = document.getElementById("login-username").value.trim();
  const password = document.getElementById("login-password").value;
  const device = getDeviceRegistration();
  const payload = await fetchJson(apiUrl("login"), {
    method: "POST",
    body: JSON.stringify({ username, password, device_id: device.device_id, device_label: device.device_label }),
  });
  state.authToken = payload.token;
  localStorage.setItem(authStorageKey, payload.token);
  renderCurrentUser(payload.user);
  loginError.textContent = "";
  document.getElementById("login-password").value = "";
  setLoginVisible(false);
  await bootstrap();
  appendLog(`Logged in as ${payload.user.username}.`);
}

async function logout() {
  try {
    if (state.authToken) {
      await fetchJson(apiUrl("logout"), {
        method: "POST",
        body: JSON.stringify({}),
      });
    }
  } finally {
    state.authToken = "";
    state.currentUser = null;
    state.users = [];
    state.selectedManagedUserId = "";
    state.selectedHistoryUserId = "";
    state.selectedHoliday = null;
    state.selectedPosting = null;
    state.selectedDeviceId = "";
    localStorage.removeItem(authStorageKey);
    renderCurrentUser(null);
    renderActivities({ activities: [] });
    clearCurrentStatement();
    setLoginVisible(true);
  }
}

async function refreshHistory(selectedUserId = state.selectedHistoryUserId) {
  const payload = await fetchJson(apiUrl("history", selectedUserId ? { user_id: selectedUserId } : null), {
    method: "GET",
  });
  renderHistoryPanel(payload);
}

async function loadStatementDetail(statementId) {
  const payload = await fetchJson(apiUrl("statement_detail", { id: statementId }), {
    method: "GET",
  });
  setCurrentStatement(payload.config, { ...payload.result, statement_id: payload.id, source_type: payload.source_type || "generated" });
  await refreshHolidayRows(state.holidayView);
  await refreshPostingDates();
  setTab("statement-panel");
  document.querySelector(".preview-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
  appendLog(`Loaded saved statement #${payload.id} for edit without refreshing the page.`);
}

async function deleteStatementRecord(statementId) {
  const confirmed = window.confirm(`Delete saved statement #${statementId}?`);
  if (!confirmed) {
    throw new Error("Saved statement delete was cancelled.");
  }
  const payload = await fetchJson(apiUrl("delete_statement"), {
    method: "POST",
    body: JSON.stringify({ statement_id: statementId }),
  });
  renderHistoryPanel(payload.history || {});
  if (state.currentStatementId === statementId) {
    clearCurrentStatement();
    appendLog(`Deleted saved statement #${statementId} and cleared it from the editor.`);
  } else {
    appendLog(`Deleted saved statement #${statementId}.`);
  }
}

async function createUser() {
  const payload = await fetchJson(apiUrl("users"), {
    method: "POST",
    body: JSON.stringify({
      username: document.getElementById("new-user-username").value.trim(),
      password: document.getElementById("new-user-password").value,
      full_name: document.getElementById("new-user-full-name").value.trim(),
      address: document.getElementById("new-user-address").value.trim(),
      mobile_number: document.getElementById("new-user-mobile").value.trim(),
      email: document.getElementById("new-user-email").value.trim(),
      gender: document.getElementById("new-user-gender").value,
      role: document.getElementById("new-user-role").value,
      access_mode: document.getElementById("new-user-access-mode").value,
      remaining_statements: document.getElementById("new-user-remaining-statements").value,
      valid_until: document.getElementById("new-user-valid-until").value,
    }),
  });
  state.selectedManagedUserId = String(payload.created_user.id);
  renderUsers(payload.users || []);
  document.getElementById("new-user-username").value = "";
  document.getElementById("new-user-password").value = "";
  document.getElementById("new-user-full-name").value = "";
  document.getElementById("new-user-address").value = "";
  document.getElementById("new-user-mobile").value = "";
  document.getElementById("new-user-email").value = "";
  document.getElementById("new-user-gender").value = "";
  document.getElementById("new-user-remaining-statements").value = "";
  document.getElementById("new-user-valid-until").value = "";
  appendLog(`Created user ${payload.created_user.username} with ${payload.created_user.access_mode} access.`);
  await refreshDevices(state.selectedManagedUserId);
  await refreshActivities();
}

async function changeSelectedUserPassword() {
  const user = selectedManagedUser();
  const newPassword = document.getElementById("manage-user-password").value;
  if (!newPassword) {
    throw new Error("Enter a new password first.");
  }
  const adminPassword = await requestPassword("Change User Password", "Enter your admin password to change this user's password.");
  if (!adminPassword) {
    throw new Error("Password change was cancelled.");
  }
  const payload = await fetchJson(apiUrl("change_user_password"), {
    method: "POST",
    body: JSON.stringify({
      user_id: user.id,
      new_password: newPassword,
      admin_password: adminPassword,
    }),
  });
  renderUsers(payload.users || []);
  document.getElementById("manage-user-password").value = "";
  appendLog(`Changed password for ${payload.updated_user.username}.`);
  await refreshActivities();
}

async function updateSelectedUserAccess() {
  const user = selectedManagedUser();
  const adminPassword = await requestPassword("Update User Access", "Enter your admin password to update this user's access.");
  if (!adminPassword) {
    throw new Error("User access update was cancelled.");
  }
  const payload = await fetchJson(apiUrl("update_user_access"), {
    method: "POST",
    body: JSON.stringify({
      user_id: user.id,
      access_mode: document.getElementById("manage-user-access-mode").value,
      remaining_statements: document.getElementById("manage-user-remaining-statements").value,
      valid_until: document.getElementById("manage-user-valid-until").value,
      admin_password: adminPassword,
    }),
  });
  renderUsers(payload.users || []);
  appendLog(`Updated statement access for ${payload.updated_user.username}.`);
  renderCurrentUser(payload.updated_user.id === state.currentUser?.id ? payload.updated_user : state.currentUser);
  await refreshActivities();
}

async function deleteSelectedUser() {
  const user = selectedManagedUser();
  const confirmed = window.confirm(`Delete ${user.username} and remove that user's saved statements?`);
  if (!confirmed) {
    throw new Error("User delete was cancelled.");
  }
  const adminPassword = await requestPassword("Delete User", "Enter your admin password to delete this user.");
  if (!adminPassword) {
    throw new Error("User delete was cancelled.");
  }
  const payload = await fetchJson(apiUrl("delete_user"), {
    method: "POST",
    body: JSON.stringify({
      user_id: user.id,
      admin_password: adminPassword,
    }),
  });
  if (state.selectedHistoryUserId === String(user.id)) {
    state.selectedHistoryUserId = "";
  }
  state.selectedManagedUserId = "";
  renderUsers(payload.users || []);
  renderHistoryPanel(payload.history || {});
  renderDevices({ devices: [], target_user_id: null, target_username: "" });
  appendLog(`Deleted user ${payload.deleted_user.username} and removed that user's saved statement history.`);
  await refreshActivities();
}

async function viewStatementsForSelectedUser() {
  const user = selectedManagedUser();
  state.selectedHistoryUserId = String(user.id);
  await refreshHistory(state.selectedHistoryUserId);
  await refreshDevices(state.selectedHistoryUserId);
  await refreshActivities(state.selectedHistoryUserId);
  appendLog(`Showing saved statement history for ${user.username}.`);
}

async function removeSelectedDevice() {
  if (!state.selectedDeviceId) {
    throw new Error("Select a device first.");
  }
  const password = await requestPassword("Remove Device", "Enter your current account password to remove this device.");
  if (!password) {
    throw new Error("Device removal was cancelled.");
  }
  const targetUserId = state.devicesPayload.target_user_id || state.currentUser?.id || "";
  const payload = await fetchJson(apiUrl("devices"), {
    method: "POST",
    body: JSON.stringify({
      user_id: targetUserId,
      device_id: state.selectedDeviceId,
      password,
    }),
  });
  renderDevices(payload);
  appendLog("Removed the selected device serial.");
  await refreshActivities();
}

async function recalculateEditedStatement() {
  if (!state.statementEditMode) {
    throw new Error("Enable statement edit mode first.");
  }
  const values = getFormValues();
  const payload = await fetchJson(apiUrl("recalculate_statement"), {
    method: "POST",
    body: JSON.stringify({
      config: values,
      edited_rows: state.editableRows,
      statement_id: state.currentStatementId,
      source_type: state.currentStatementSource,
    }),
  });
  setCurrentStatement(values, payload, { syncForm: false });
  renderHolidayPayload(payload.holidays);
  if (payload.history) {
    renderHistoryPanel(payload.history);
  }
  renderValidationResults([]);
  appendLog(`Updated statement after edit. New final balance ${payload.summary.final_balance_text}, issue date ${payload.summary.issue_date}.`);
}

async function importStatementFile(file) {
  if (!file) {
    throw new Error("Select an Excel statement file first.");
  }
  const body = new FormData();
  body.append("statement_file", file);
  body.append("config", JSON.stringify(getFormValues()));
  const payload = await fetchJson(apiUrl("import_statement"), {
    method: "POST",
    body,
    headers: {},
  });
  if (payload.current_user) {
    renderCurrentUser(payload.current_user);
  }
  setCurrentStatement(payload.config || getFormValues(), payload);
  renderHolidayPayload(payload.holidays);
  if (payload.history) {
    renderHistoryPanel(payload.history);
  }
  renderValidationResults(payload.validation_errors || []);
  const report = payload.import_report || {};
  const issueCount = (payload.validation_errors || []).length;
  appendLog(`Imported ${report.row_count || 0} rows. ${issueCount ? `Found ${issueCount} issue(s) for review.` : "No row errors were found."}`, issueCount ? "error" : "info");
  await requestImportedInterestRateAndRecheck();
}

async function requestImportedInterestRateAndRecheck() {
  if (!state.currentStatement || state.currentStatementSource !== "imported") {
    return;
  }
  let rateText = "";
  try {
    rateText = await requestModalValue(
      "Imported Statement Interest Rate",
      "Enter the interest rate used by this imported statement before checking interest and tax rows.",
      {
        type: "number",
        defaultValue: form.elements.interest_rate?.value || "",
        placeholder: "Example: 8",
      },
    );
  } catch (error) {
    appendLog("Interest rate entry was cancelled. Statement is imported, but interest/tax checking still uses the current rate.", "error");
    return;
  }
  const parsedRate = Number(rateText);
  if (!Number.isFinite(parsedRate) || parsedRate < 0 || parsedRate > 100) {
    appendLog("Invalid interest rate. Enter a value between 0 and 100, then click Check Statement again.", "error");
    return;
  }
  if (form.elements.interest_rate) {
    form.elements.interest_rate.value = String(parsedRate);
    form.elements.interest_rate.dispatchEvent(new Event("input", { bubbles: true }));
    form.elements.interest_rate.dispatchEvent(new Event("change", { bubbles: true }));
  }
  await validateCurrentStatement();
  appendLog(`Imported statement checked with ${parsedRate}% interest rate.`);
}

async function validateCurrentStatement() {
  if (!state.currentStatement) {
    throw new Error("Generate, import, or load a statement first.");
  }
  const values = getFormValues();
  const rows = state.statementEditMode ? state.editableRows : (state.currentStatement.rows || []);
  const payload = await fetchJson(apiUrl("validate_statement"), {
    method: "POST",
    body: JSON.stringify({
      config: values,
      edited_rows: rows,
      statement_id: state.currentStatementId,
      source_type: state.currentStatementSource,
    }),
  });
  renderValidationResults(payload.errors || []);
  if (payload.config) {
    applyFormValues(payload.config);
  }
  if ((payload.errors || []).length === 0) {
    appendLog(`Statement check completed. No row errors were found in ${payload.checked_rows || rows.length} rows.`);
  } else {
    appendLog(`Statement check found ${(payload.errors || []).length} issue(s). See the red error list below the preview table.`, "error");
  }
}

async function bootstrap() {
  const payload = await fetchJson(apiUrl("bootstrap"), { method: "GET" });

  renderSelectOptions(document.getElementById("deposit-mode"), payload.description_modes, payload.defaults.deposit_mode);
  renderSelectOptions(document.getElementById("withdrawal-mode"), payload.description_modes, payload.defaults.withdrawal_mode);
  renderSelectOptions(document.getElementById("amount-rounding-mode"), payload.amount_rounding_modes, payload.defaults.amount_rounding_mode);
  renderSelectOptions(document.getElementById("rate-mode"), payload.rate_modes, payload.defaults.rate_mode);
  renderSelectOptions(document.getElementById("rate-type"), payload.rate_types, payload.defaults.rate_type);
  document.getElementById("nrb-page-link").href = payload.rate_sources.page;
  document.getElementById("nrb-docs-link").href = payload.rate_sources.docs;

  applyFormValues(payload.defaults);
  state.templates = payload.templates;
  renderProfileFormats(payload.profile_formats || { formats: [] });
  state.selectedManagedUserId = "";
  state.selectedHistoryUserId = "";
  state.selectedHoliday = null;
  state.selectedPosting = null;
  state.selectedDeviceId = "";
  renderCurrentUser(payload.current_user);
  renderAccessSummary(payload.current_user, payload.live_rate || null);
  renderTemplateList(document.getElementById("statement-template-list"), payload.templates.statement_templates || []);
  renderTemplateList(document.getElementById("certificate-template-list"), payload.templates.certificate_templates || []);
  renderHolidayPayload(payload.holidays);
  renderPostingPayload(payload.posting_dates);
  renderUsers(payload.users || []);
  renderDevices(payload.devices || { devices: [], target_user_id: null, target_username: "" });
  renderHistoryPanel(payload.history || {});
  renderActivities(payload.activities || { activities: [] });
  clearCurrentStatement();
  closeProfileFormatEditor();
  setLoginVisible(false);
  appendLog("Ready. Generate, import, edit, and export statements from the same screen.");
  globalThis.setTimeout(() => {
    autoRefreshInternetData().catch((error) => appendLog(error.message, "error"));
  }, 0);
}

function showAsyncError(error) {
  appendLog(error.message || String(error), "error");
}

function bindEvents() {
  document.getElementById("amount-rounding-mode")?.addEventListener("change", updateRoundingState);
  for (const input of document.querySelectorAll("[data-rounding-step]")) {
    input.addEventListener("input", () => {
      updateRoundingPercentagesValue();
      scheduleAutoProfileSave();
    });
  }
  document.getElementById("login-btn").addEventListener("click", async () => {
    try {
      await login();
    } catch (error) {
      loginError.textContent = error.message;
      appendLog(error.message, "error");
    }
  });

  document.getElementById("logout-btn").addEventListener("click", async () => {
    await logout();
  });

  loginPasswordToggle?.addEventListener("click", () => setPasswordInputVisibility(loginPasswordInput, loginPasswordToggle));
  passwordModalToggle?.addEventListener("click", () => setPasswordInputVisibility(passwordModalInput, passwordModalToggle));
  passwordModalCancel?.addEventListener("click", () => closePasswordModal(true));
  passwordModalConfirm?.addEventListener("click", () => {
    if (!passwordModalInput.value.trim()) {
      passwordModalError.textContent = "Enter your password first.";
      return;
    }
    closePasswordModal(false);
  });
  passwordModalInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      passwordModalConfirm.click();
    }
    if (event.key === "Escape") {
      event.preventDefault();
      closePasswordModal(true);
    }
  });

  for (const button of document.querySelectorAll(".tab-button")) {
    button.addEventListener("click", () => setTab(button.dataset.target));
  }

  document.getElementById("create-stat-btn").addEventListener("click", async () => {
    try {
      await generateStatement();
    } catch (error) {
      appendLog(error.message, "error");
      alert(error.message);
    }
  });

  importStatementButton.addEventListener("click", () => importStatementInput.click());
  importStatementInput.addEventListener("change", async () => {
    try {
      const file = importStatementInput.files?.[0];
      await importStatementFile(file);
    } catch (error) {
      appendLog(error.message, "error");
      alert(error.message);
    } finally {
      importStatementInput.value = "";
    }
  });

  validateStatementButton.addEventListener("click", async () => {
    try {
      await validateCurrentStatement();
    } catch (error) {
      appendLog(error.message, "error");
      alert(error.message);
    }
  });

  editStatementButton.addEventListener("click", () => {
    try {
      enableStatementEditMode();
      appendLog("Statement edit mode is active. Change dates, description, cheque, debit, or credit fields, then click Update & Recalculate.");
    } catch (error) {
      appendLog(error.message, "error");
      alert(error.message);
    }
  });

  updateStatementButton.addEventListener("click", async () => {
    try {
      await recalculateEditedStatement();
    } catch (error) {
      appendLog(error.message, "error");
      alert(error.message);
    }
  });

  cancelEditButton.addEventListener("click", () => {
    cancelStatementEditMode();
    appendLog("Statement edit mode was cancelled.");
  });

  previewBody.addEventListener("input", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) {
      return;
    }
    const rowIndex = Number(target.dataset.rowIndex);
    const field = target.dataset.field;
    if (field) {
      const accepted = syncEditableField(rowIndex, field, target.value);
      if (accepted === false && (field === "debit" || field === "credit")) {
        target.value = Number(state.editableRows[rowIndex]?.[field] ?? 0).toFixed(2);
      }
    }
  });

  document.getElementById("template-refresh-btn").addEventListener("click", async () => {
    try {
      await refreshTemplates();
    } catch (error) {
      appendLog(error.message, "error");
      alert(error.message);
    }
  });

  document.getElementById("template-upload-btn").addEventListener("click", async () => {
    try {
      await uploadTemplateFormat();
    } catch (error) {
      appendLog(error.message, "error");
      alert(error.message);
    }
  });

  document.getElementById("template-delete-btn").addEventListener("click", async () => {
    try {
      await deleteSelectedTemplate();
    } catch (error) {
      appendLog(error.message, "error");
      alert(error.message);
    }
  });

  document.getElementById("template-scan-btn")?.addEventListener("click", async () => {
    try {
      await loadTemplateDetail(true);
    } catch (error) {
      appendLog(error.message, "error");
      alert(error.message);
    }
  });

  document.getElementById("template-edit-btn")?.addEventListener("click", async () => {
    try {
      await loadTemplateDetail(true);
    } catch (error) {
      appendLog(error.message, "error");
      alert(error.message);
    }
  });

  document.getElementById("template-edit-excel-btn")?.addEventListener("click", async () => {
    try {
      document.getElementById("template-manage-kind").value = "statement";
      await loadTemplateDetail(true);
    } catch (error) {
      appendLog(error.message, "error");
      alert(error.message);
    }
  });

  document.getElementById("template-edit-word-btn")?.addEventListener("click", async () => {
    try {
      document.getElementById("template-manage-kind").value = "certificate";
      await loadTemplateDetail(true);
    } catch (error) {
      appendLog(error.message, "error");
      alert(error.message);
    }
  });

  document.getElementById("template-save-profile-btn")?.addEventListener("click", async () => {
    try {
      await saveCurrentDetailsToSelectedTemplate();
    } catch (error) {
      appendLog(error.message, "error");
      alert(error.message);
    }
  });

  document.getElementById("template-editor-close-btn")?.addEventListener("click", () => {
    templateEditorPanel.hidden = true;
  });

  formatWorkspaceCloseButton?.addEventListener("click", () => {
    toggleFormatWorkspaceExpanded(false);
    formatWorkspacePanel.hidden = true;
  });

  compactFormatRibbon();

  document.querySelectorAll("[data-format-orientation]").forEach((button) => {
    button.addEventListener("click", () => {
      state.formatWorkspaceOrientation = button.dataset.formatOrientation === "landscape" ? "landscape" : "portrait";
      applyFormatWorkspaceView();
    });
  });
  formatZoomRange?.addEventListener("input", () => setFormatWorkspaceZoom(formatZoomRange.value));
  formatFitWidthButton?.addEventListener("click", fitFormatWorkspaceWidth);
  formatFullscreenButton?.addEventListener("click", () => toggleFormatWorkspaceExpanded());

  formatFormulaInput?.addEventListener("beforeinput", () => {
    pushFormatUndoSnapshot("Formula edit");
  });
  formatFormulaInput?.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z" && !event.shiftKey) {
      event.preventDefault();
      undoFormatWorkspace();
    }
  });
  formatFormulaInput?.addEventListener("input", () => {
    syncWorkspaceText(formatFormulaInput.value);
  });

  formatSheetHost?.addEventListener("beforeinput", (event) => {
    if (!String(event.inputType || "").startsWith("history")) {
      pushFormatUndoSnapshot("Text edit");
    }
  });
  formatSheetHost?.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z" && !event.shiftKey) {
      event.preventDefault();
      undoFormatWorkspace();
      return;
    }
    if (event.key === "Tab") {
      moveFormatSelectionByTab(event);
    }
  });
  formatSheetHost?.addEventListener("mouseup", rememberFormatInlineSelection);
  formatSheetHost?.addEventListener("keyup", rememberFormatInlineSelection);

  [
    formatFontFamily,
    formatFontSize,
    formatFontColor,
    formatFillColor,
    formatVerticalAlign,
    formatLineSpacing,
    formatLeftTab,
    formatLeftIndent,
    formatFirstIndent,
    formatBorderStyle,
    formatNumberFormat,
  ].forEach((control) => {
    control?.addEventListener("focus", () => pushFormatUndoSnapshot("Control edit"));
  });

  document.querySelectorAll("[data-format-command]").forEach((button) => {
    button.addEventListener("click", () => {
      try {
        applyFormatCommand(button.dataset.formatCommand);
      } catch (error) {
        appendLog(error.message, "error");
        alert(error.message);
      }
    });
  });

  document.getElementById("format-add-paragraph-btn")?.addEventListener("click", async () => {
    try {
      await addParagraphToWordFormat();
    } catch (error) {
      appendLog(error.message, "error");
      alert(error.message);
    }
  });

  document.getElementById("format-insert-row-btn")?.addEventListener("click", async () => {
    try {
      await updateExcelStructure("__insert_row__");
    } catch (error) {
      appendLog(error.message, "error");
      showFormatSaveStatus(error.message, "error");
      alert(error.message);
    }
  });

  document.getElementById("format-insert-column-btn")?.addEventListener("click", async () => {
    try {
      await updateExcelStructure("__insert_column__");
    } catch (error) {
      appendLog(error.message, "error");
      showFormatSaveStatus(error.message, "error");
      alert(error.message);
    }
  });

  document.getElementById("format-add-header-btn")?.addEventListener("click", async () => {
    try {
      await updateExcelStructure("__add_header__");
    } catch (error) {
      appendLog(error.message, "error");
      showFormatSaveStatus(error.message, "error");
      alert(error.message);
    }
  });

  document.getElementById("format-add-footer-btn")?.addEventListener("click", async () => {
    try {
      await updateExcelStructure("__add_footer__");
    } catch (error) {
      appendLog(error.message, "error");
      showFormatSaveStatus(error.message, "error");
      alert(error.message);
    }
  });

  formatFontFamily?.addEventListener("change", () => {
    applyCssToSelectedNodes({ fontFamily: formatFontFamily.value || "" });
  });
  formatFontSize?.addEventListener("input", () => {
    if (formatFontSize.value) {
      templateItemFontSize.value = formatFontSize.value;
      applyCssToSelectedNodes({ fontSize: `${formatFontSize.value}pt` });
    }
  });
  formatFontColor?.addEventListener("input", () => {
    applyCssToSelectedNodes({ color: formatFontColor.value });
  });
  formatFillColor?.addEventListener("input", () => {
    applyCssToSelectedNodes({ backgroundColor: formatFillColor.value });
  });
  formatVerticalAlign?.addEventListener("change", () => {
    templateItemVertical.value = formatVerticalAlign.value;
    applyCssToSelectedNodes({ verticalAlign: formatVerticalAlign.value === "center" ? "middle" : formatVerticalAlign.value });
  });
  formatLineSpacing?.addEventListener("change", () => {
    applyCssToSelectedNodes({ lineHeight: formatLineSpacing.value || "" });
  });
  formatLeftTab?.addEventListener("input", () => {
    syncRulerMarkers();
  });
  formatLeftIndent?.addEventListener("input", () => {
    applyCssToSelectedNodes({ paddingLeft: `${Number(formatLeftIndent.value || 0)}px` });
    syncRulerMarkers();
  });
  formatFirstIndent?.addEventListener("input", () => {
    applyCssToSelectedNodes({ textIndent: `${Number(formatFirstIndent.value || 0)}px` });
    syncRulerMarkers();
  });
  formatBorderStyle?.addEventListener("change", () => {
    const borderStyle = borderCssForOption(formatBorderStyle.value);
    if (Object.keys(borderStyle).length) {
      applyCssToSelectedNodes(borderStyle);
    }
  });
  formatNumberFormat?.addEventListener("change", () => {
    if (formatNumberFormat.value) {
      templateItemNumberFormat.value = formatNumberFormat.value;
    }
  });
  formatMergeCenterButton?.addEventListener("click", async () => {
    try {
      pushFormatUndoSnapshot("Merge cells");
      const request = state.formatWorkspaceRangeRequest || buildMergeRequestFromSelectedKeys();
      if (!request || state.formatWorkspaceSelectedKeys.length < 2) {
        throw new Error("Select cells with Shift-click or Ctrl-click, then click merge.");
      }
      state.formatWorkspaceMergeRequest = request;
      if (request.primary_key && request.primary_key !== state.formatWorkspaceSelectedKey) {
        state.formatWorkspaceSelectedKey = request.primary_key;
        state.formatWorkspaceSelectedKeys = Array.from(new Set([request.primary_key, ...state.formatWorkspaceSelectedKeys]));
        refreshFormatSelectionClasses(request.primary_key);
      }
      applyCssToSelectedNodes({ textAlign: "center", verticalAlign: "middle" });
      templateItemAlign.value = "center";
      showFormatSaveStatus(`Saving merged range ${state.formatWorkspaceMergeRequest.range}...`);
      await saveSelectedWorkspaceItem();
    } catch (error) {
      appendLog(error.message, "error");
      alert(error.message);
    }
  });

  formatUnmergeButton?.addEventListener("click", async () => {
    try {
      await unmergeSelectedExcelCells();
    } catch (error) {
      appendLog(error.message, "error");
      showFormatSaveStatus(error.message, "error");
      alert(error.message);
    }
  });

  formatInsertObjectButton?.addEventListener("click", () => {
    try {
      pushFormatUndoSnapshot("Insert object");
      insertObjectIntoSelectedWorkspaceCell();
    } catch (error) {
      appendLog(error.message, "error");
      alert(error.message);
    }
  });

  formatGeneratedPreviewButton?.addEventListener("click", async () => {
    try {
      await showGeneratedFormatPreview(false);
    } catch (error) {
      appendLog(error.message, "error");
      showFormatSaveStatus(error.message, "error");
      alert(error.message);
    }
  });

  formatSaveCellButton?.addEventListener("click", async () => {
    try {
      await saveSelectedWorkspaceItem();
    } catch (error) {
      appendLog(error.message, "error");
      showFormatSaveStatus(error.message, "error");
      alert(error.message);
    }
  });

  formatSaveOriginalButton?.addEventListener("click", async () => {
    try {
      await saveSelectedWorkspaceItem();
      showFormatSaveStatus("Saved to original custom template format and refreshed from disk.", "success");
    } catch (error) {
      appendLog(error.message, "error");
      showFormatSaveStatus(error.message, "error");
      alert(error.message);
    }
  });

  document.getElementById("template-item-rescan-btn")?.addEventListener("click", async () => {
    try {
      await loadTemplateDetail(true);
    } catch (error) {
      appendLog(error.message, "error");
      alert(error.message);
    }
  });

  document.getElementById("template-item-save-btn")?.addEventListener("click", async () => {
    try {
      await saveTemplateItemEdit();
    } catch (error) {
      appendLog(error.message, "error");
      alert(error.message);
    }
  });

  templateItemSelect?.addEventListener("change", () => {
    const item = selectedTemplateEditorItem();
    fillTemplateItemControls(item);
    if (item?.key) {
      selectFormatWorkspaceItem(item.key);
    }
  });

  document.getElementById("statement-format-builder-open-btn")?.addEventListener("click", async () => {
    try {
      await createStatementFormatInWorkspace();
    } catch (error) {
      appendLog(error.message, "error");
      alert(error.message);
    }
  });

  document.getElementById("statement-format-builder-close-btn")?.addEventListener("click", () => {
    document.getElementById("statement-format-builder-panel").hidden = true;
  });

  document.getElementById("statement-format-builder-save-btn")?.addEventListener("click", async () => {
    try {
      await saveCreatedStatementFormat();
    } catch (error) {
      appendLog(error.message, "error");
      alert(error.message);
    }
  });

  for (const selectId of ["statement-template-list", "certificate-template-list"]) {
    document.getElementById(selectId)?.addEventListener("change", async () => {
      try {
        document.getElementById("template-manage-kind").value = selectId === "statement-template-list" ? "statement" : "certificate";
        const detail = await loadTemplateDetail(false);
        applyTemplateProfile(detail);
      } catch (error) {
        appendLog(error.message, "error");
      }
    });
  }

  document.getElementById("save-profile-format-btn").addEventListener("click", () => {
    try {
      openProfileFormatEditor("create");
    } catch (error) {
      appendLog(error.message, "error");
      alert(error.message);
    }
  });

  document.getElementById("edit-profile-format-btn").addEventListener("click", () => {
    try {
      openProfileFormatEditor("edit");
    } catch (error) {
      appendLog(error.message, "error");
      alert(error.message);
    }
  });

  document.getElementById("delete-profile-format-btn").addEventListener("click", async () => {
    try {
      await deleteProfileFormat();
    } catch (error) {
      appendLog(error.message, "error");
      alert(error.message);
    }
  });

  profileFormatEditorSaveButton.addEventListener("click", async () => {
    try {
      await saveProfileFormat();
    } catch (error) {
      appendLog(error.message, "error");
      alert(error.message);
    }
  });

  profileFormatEditorCancelButton.addEventListener("click", () => {
    closeProfileFormatEditor();
  });

  profileFormatNameInput?.addEventListener("keydown", async (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      try {
        await saveProfileFormat();
      } catch (error) {
        appendLog(error.message, "error");
        alert(error.message);
      }
    }
    if (event.key === "Escape") {
      event.preventDefault();
      closeProfileFormatEditor();
    }
  });

  document.getElementById("load-profile-format-btn").addEventListener("click", async () => {
    try {
      await loadProfileFormat();
    } catch (error) {
      appendLog(error.message, "error");
      alert(error.message);
    }
  });

  document.getElementById("selftest-btn").addEventListener("click", async () => {
    try {
      await runSelfTests();
    } catch (error) {
      appendLog(error.message, "error");
      alert(error.message);
    }
  });

  form.querySelector('[name="rate_mode"]').addEventListener("change", updateManualRateState);
  form.querySelector('[name="include_cheque_column"]').addEventListener("change", updatePreviewTableLayout);
  form.querySelector('[name="date_column_mode"]')?.addEventListener("change", updatePreviewTableLayout);
  form.querySelector('[name="start_date"]').addEventListener("change", async () => {
    try {
      if (transactionCountModeInput?.value === "custom") {
        renderMonthlyTransactionGrid();
      }
      await Promise.all([refreshHolidayRows(state.holidayView), refreshPostingDates()]);
    } catch (error) {
      showAsyncError(error);
    }
  });
  form.querySelector('[name="end_date"]').addEventListener("change", async () => {
    try {
      if (transactionCountModeInput?.value === "custom") {
        renderMonthlyTransactionGrid();
      }
      await Promise.all([refreshHolidayRows(state.holidayView), refreshPostingDates()]);
    } catch (error) {
      showAsyncError(error);
    }
  });

  for (const button of document.querySelectorAll(".view-button")) {
    button.addEventListener("click", () => {
      refreshHolidayRows(button.dataset.view).catch(showAsyncError);
    });
  }

  document.getElementById("holiday-add-btn").addEventListener("click", async () => {
    try {
      await handleHolidayAction("add");
      appendLog(`Added blocked date ${document.getElementById("holiday-date").value} as ${document.getElementById("holiday-type").value}.`);
    } catch (error) {
      appendLog(error.message, "error");
      alert(error.message);
    }
  });

  document.getElementById("holiday-update-btn").addEventListener("click", async () => {
    try {
      await handleHolidayAction("update");
      appendLog(`Modified blocked date to ${document.getElementById("holiday-date").value} as ${document.getElementById("holiday-type").value}.`);
    } catch (error) {
      appendLog(error.message, "error");
      alert(error.message);
    }
  });

  document.getElementById("holiday-delete-btn").addEventListener("click", async () => {
    try {
      await handleHolidayAction("delete");
      appendLog("Deleted the selected blocked date rule.");
    } catch (error) {
      appendLog(error.message, "error");
      alert(error.message);
    }
  });

  postingPeriodSelect.addEventListener("change", () => {
    const selectedRow = state.postingRows.find((row) => row.period_key === postingPeriodSelect.value) || null;
    if (selectedRow) {
      state.selectedPosting = selectedRow;
      postingDateInput.value = selectedRow.date;
      renderPostingPayload({
        rows: state.postingRows,
        period_options: state.postingRows.map((row) => ({ period_key: row.period_key, label: row.label })),
        selected_period_key: selectedRow.period_key,
      });
    }
  });

  document.getElementById("posting-add-btn").addEventListener("click", async () => {
    try {
      await handlePostingDateAction("add");
      appendLog(`Added custom interest and tax posting date for ${postingPeriodSelect.value}.`);
    } catch (error) {
      appendLog(error.message, "error");
      alert(error.message);
    }
  });

  document.getElementById("posting-update-btn").addEventListener("click", async () => {
    try {
      await handlePostingDateAction("update");
      appendLog(`Modified interest and tax posting date for ${postingPeriodSelect.value}.`);
    } catch (error) {
      appendLog(error.message, "error");
      alert(error.message);
    }
  });

  document.getElementById("posting-delete-btn").addEventListener("click", async () => {
    try {
      await handlePostingDateAction("delete");
      appendLog(`Removed the custom interest and tax posting date for ${postingPeriodSelect.value}.`);
    } catch (error) {
      appendLog(error.message, "error");
      alert(error.message);
    }
  });

  document.getElementById("posting-sync-btn")?.addEventListener("click", async () => {
    try {
      await syncPostingDatesFromHamroPatro();
    } catch (error) {
      appendLog(error.message, "error");
      alert(error.message);
    }
  });

  document.getElementById("export-statement-template-btn").addEventListener("click", async () => {
    try {
      const templateName = document.getElementById("statement-template-list").value;
      if (!templateName) {
        throw new Error("Select a statement template first.");
      }
      await requestDownload(buildExportPayload("statement", "template", templateName), "Statement");
    } catch (error) {
      appendLog(error.message, "error");
      alert(error.message);
    }
  });

  document.getElementById("export-certificate-template-btn").addEventListener("click", async () => {
    try {
      const templateName = document.getElementById("certificate-template-list").value;
      if (!templateName) {
        throw new Error("Select a certificate template first.");
      }
      await requestDownload(buildExportPayload("certificate", "template", templateName), "Balance certificate");
    } catch (error) {
      appendLog(error.message, "error");
      alert(error.message);
    }
  });

  document.getElementById("export-normal-statement-btn").addEventListener("click", async () => {
    try {
      await requestDownload(buildExportPayload("statement", "normal"), "Normal statement");
    } catch (error) {
      appendLog(error.message, "error");
      alert(error.message);
    }
  });

  document.getElementById("export-normal-certificate-btn").addEventListener("click", async () => {
    try {
      await requestDownload(buildExportPayload("certificate", "normal"), "Normal balance certificate");
    } catch (error) {
      appendLog(error.message, "error");
      alert(error.message);
    }
  });

  document.getElementById("print-preview-btn")?.addEventListener("click", async () => {
    try {
      const kind = document.getElementById("print-document-kind")?.value || "statement";
      await openPrintDocument(kind, false);
    } catch (error) {
      appendLog(error.message, "error");
      alert(error.message);
    }
  });

  document.getElementById("print-current-btn")?.addEventListener("click", async () => {
    try {
      const kind = document.getElementById("print-document-kind")?.value || "statement";
      await openPrintDocument(kind, true);
    } catch (error) {
      appendLog(error.message, "error");
      alert(error.message);
    }
  });

  document.getElementById("create-user-btn").addEventListener("click", async () => {
    try {
      await createUser();
      await refreshHistory();
    } catch (error) {
      appendLog(error.message, "error");
      alert(error.message);
    }
  });

  manageUserSearch?.addEventListener("input", () => {
    renderUsers(state.users);
  });

  manageUserSelect.addEventListener("change", () => {
    state.selectedManagedUserId = manageUserSelect.value;
    const user = state.users.find((item) => String(item.id) === String(state.selectedManagedUserId)) || null;
    populateManagedUserFields(user);
    renderUsers(state.users);
    refreshDevices(state.selectedManagedUserId).catch(showAsyncError);
  });

  document.getElementById("view-user-history-btn").addEventListener("click", async () => {
    try {
      await viewStatementsForSelectedUser();
    } catch (error) {
      appendLog(error.message, "error");
      alert(error.message);
    }
  });

  document.getElementById("view-all-history-btn").addEventListener("click", async () => {
    try {
      state.selectedHistoryUserId = "";
      await refreshHistory("");
      await refreshDevices(state.currentUser?.id || "");
      await refreshActivities("");
      appendLog("Showing saved statement history for all available users.");
    } catch (error) {
      appendLog(error.message, "error");
      alert(error.message);
    }
  });

  document.getElementById("change-user-password-btn").addEventListener("click", async () => {
    try {
      await changeSelectedUserPassword();
    } catch (error) {
      appendLog(error.message, "error");
      alert(error.message);
    }
  });

  document.getElementById("update-user-access-btn").addEventListener("click", async () => {
    try {
      await updateSelectedUserAccess();
    } catch (error) {
      appendLog(error.message, "error");
      alert(error.message);
    }
  });

  document.getElementById("delete-user-btn").addEventListener("click", async () => {
    try {
      await deleteSelectedUser();
    } catch (error) {
      appendLog(error.message, "error");
      alert(error.message);
    }
  });

  document.getElementById("restore-user-dates-btn")?.addEventListener("click", async () => {
    try {
      await restoreSelectedUserDates();
    } catch (error) {
      appendLog(error.message, "error");
      alert(error.message);
    }
  });

  document.getElementById("refresh-history-btn").addEventListener("click", async () => {
    try {
      await refreshHistory();
      appendLog("Refreshed saved statement history.");
    } catch (error) {
      appendLog(error.message, "error");
      alert(error.message);
    }
  });

  document.getElementById("refresh-devices-btn").addEventListener("click", async () => {
    try {
      await refreshDevices();
      appendLog("Refreshed saved device list.");
    } catch (error) {
      appendLog(error.message, "error");
      alert(error.message);
    }
  });

  document.getElementById("refresh-activities-btn")?.addEventListener("click", async () => {
    try {
      await refreshActivities();
      appendLog("Refreshed user activity log.");
    } catch (error) {
      appendLog(error.message, "error");
      alert(error.message);
    }
  });

  document.getElementById("remove-device-btn").addEventListener("click", async () => {
    try {
      await removeSelectedDevice();
    } catch (error) {
      appendLog(error.message, "error");
      alert(error.message);
    }
  });

  historyBody.addEventListener("click", async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement) || !target.dataset.historyId) {
      return;
    }
    try {
      if (target.dataset.historyAction === "delete") {
        await deleteStatementRecord(Number(target.dataset.historyId));
      } else {
        await loadStatementDetail(Number(target.dataset.historyId));
      }
    } catch (error) {
      appendLog(error.message, "error");
      alert(error.message);
    }
  });

  statementRowMode?.addEventListener("change", () => {
    updateRowCountState();
    scheduleAutoProfileSave();
  });

  prependStatementMode?.addEventListener("change", () => {
    updatePrependStatementState();
    scheduleAutoProfileSave();
  });

  document.querySelectorAll("[data-transaction-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      setTransactionCountMode(button.dataset.transactionMode || "auto");
      scheduleAutoProfileSave();
    });
  });

  for (const element of document.querySelectorAll("#account-panel [name], #statement-panel [name], #texts-panel [name]")) {
    element.addEventListener("change", scheduleAutoProfileSave);
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      element.addEventListener("input", scheduleAutoProfileSave);
    }
  }
}

bindEvents();
if (state.authToken) {
  bootstrap().catch(async (error) => {
    appendLog(error.message, "error");
    await logout();
  });
} else {
  setLoginVisible(true);
}
