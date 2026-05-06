const state = {
  configs: {},
  clients: [],
  activeClientId: "",
  activeTool: "brokenLinks",
  view: localStorage.getItem("seo-mvp-entered") ? "dashboard" : "welcome",
  results: [],
  exportRows: [],
  exportColumns: [],
  exportSheets: null,
  columns: [],
  history: JSON.parse(localStorage.getItem("seo-mvp-history") || "[]"),
  user: JSON.parse(localStorage.getItem("seo-mvp-user") || "null") || null
};

const views = {
  welcome: document.querySelector("#welcomeView"),
  login: document.querySelector("#loginView"),
  dashboard: document.querySelector("#dashboardView"),
  client: document.querySelector("#clientView"),
  tool: document.querySelector("#toolView")
};

const clientCards = document.querySelector("#clientCards");
const clientSearch = document.querySelector("#clientSearch");
const podFilter = document.querySelector("#podFilter");
const podOptions = document.querySelector("#podOptions");
const clientMetric = document.querySelector("#clientMetric");
const podMetric = document.querySelector("#podMetric");
const historyList = document.querySelector("#historyList");
const clientPageTitle = document.querySelector("#clientPageTitle");
const clientDetailSummary = document.querySelector("#clientDetailSummary");
const clientToolCards = document.querySelector("#clientToolCards");
const clientDialog = document.querySelector("#clientDialog");
const clientForm = document.querySelector("#clientForm");
const toolTitle = document.querySelector("#toolTitle");
const toolPrompt = document.querySelector("#toolPrompt");
const runForm = document.querySelector("#runForm");
const sitemapBox = document.querySelector("#sitemapBox");
const templateBox = document.querySelector("#templateBox");
const workflowField = document.querySelector("#workflowField");
const keywordWorkflow = document.querySelector('select[name="keywordWorkflow"]');
const mainUploadLabel = document.querySelector("#mainUploadLabel");
const mainHelp = document.querySelector("#mainHelp");
const message = document.querySelector("#message");
const resultsTable = document.querySelector("#resultsTable");
const rowCount = document.querySelector("#rowCount");
const exportButton = document.querySelector("#exportButton");
const tableFilter = document.querySelector("#tableFilter");
const confidenceFilter = document.querySelector("#confidenceFilter");
const statusFilter = document.querySelector("#statusFilter");
const markVisibleReviewed = document.querySelector("#markVisibleReviewed");
const exportPanel = document.querySelector("#exportPanel");
const manualDownloadLink = document.querySelector("#manualDownloadLink");
const copyCsvButton = document.querySelector("#copyCsvButton");
const csvPreview = document.querySelector("#csvPreview");

async function init() {
  const [configResponse, clientsResponse] = await Promise.all([
    fetch("/api/config"),
    fetch("/api/clients")
  ]);
  state.configs = await configResponse.json();
  state.clients = await clientsResponse.json();
  renderAll();
  showView(state.view);
}

function renderAll() {
  renderUser();
  renderDashboard();
  renderClientDetail();
  renderClientTools();
  renderHistory();
  selectTool(state.activeTool);
}

function showView(view) {
  state.view = view;
  Object.entries(views).forEach(([key, element]) => {
    element.hidden = key !== view;
  });
  if (view === "dashboard") {
    localStorage.setItem("seo-mvp-entered", "true");
    renderDashboard();
  }
  if (view === "client") renderClientDetail();
  if (view === "tool") {
    applyClientToRunForm(activeClient());
    selectTool(state.activeTool);
  }
}

function renderUser() {
  const user = state.user || { name: "National Positions User" };
  document.querySelector("#userLabel").textContent = user.name;
  document.querySelector("#userInitials").textContent = initials(user.name);
}

document.querySelector("#enterAppButton").addEventListener("click", () => showView("login"));
document.querySelector("#googleLoginButton").addEventListener("click", () => {
  state.user = { name: "National Positions User", provider: "google-ui" };
  localStorage.setItem("seo-mvp-user", JSON.stringify(state.user));
  renderUser();
  showView("dashboard");
});
document.querySelector("#backToDashboard").addEventListener("click", () => showView("dashboard"));
document.querySelector("#backToClient").addEventListener("click", () => showView(activeClient() ? "client" : "dashboard"));
document.querySelector("#addClientDashboard").addEventListener("click", () => openClientDialog(null));
document.querySelector("#editClientButton").addEventListener("click", () => openClientDialog(activeClient()));
document.querySelector("#cancelClient").addEventListener("click", () => clientDialog.close());

clientSearch.addEventListener("input", renderDashboard);
podFilter.addEventListener("change", renderDashboard);
keywordWorkflow.addEventListener("change", updateUploadLabels);

function pods() {
  return [...new Set(state.clients.map(client => client.pod || "Unassigned"))].sort((a, b) => a.localeCompare(b));
}

function renderDashboard() {
  const allPods = pods();
  const existingValue = podFilter.value;
  podFilter.innerHTML = `<option value="">All Pods</option>` + allPods
    .map(pod => `<option value="${escapeAttr(pod)}">${escapeHtml(pod)}</option>`)
    .join("");
  podFilter.value = allPods.includes(existingValue) ? existingValue : "";
  podOptions.innerHTML = allPods.map(pod => `<option value="${escapeAttr(pod)}"></option>`).join("");

  const query = clientSearch.value.trim().toLowerCase();
  const selectedPod = podFilter.value;
  const filtered = state.clients.filter(client => {
    const clientPod = client.pod || "Unassigned";
    const haystack = [client.name, client.domain, client.specialty, clientPod, client.cmsPlatform].join(" ").toLowerCase();
    return (!selectedPod || clientPod === selectedPod) && (!query || haystack.includes(query));
  });

  clientMetric.textContent = state.clients.length.toLocaleString();
  podMetric.textContent = allPods.length.toLocaleString();

  if (!filtered.length) {
    clientCards.innerHTML = `<div class="empty-state">No clients match this search or Pod filter yet.</div>`;
    return;
  }

  clientCards.innerHTML = filtered.map(client => `
    <button class="client-card" type="button" data-client-id="${escapeAttr(client.id)}">
      <div class="client-card-top">
        ${client.logo?.url ? `<img class="client-logo" src="${escapeAttr(client.logo.url)}" alt="${escapeAttr(client.name)} logo" />` : `<span class="client-avatar">${escapeHtml(initials(client.name || client.domain || "NP"))}</span>`}
        <span class="pod-pill">${escapeHtml(client.pod || "Unassigned")}</span>
      </div>
      <div>
        <h3>${escapeHtml(client.name || "Unnamed client")}</h3>
        <p>${escapeHtml([client.domain, cmsLabel(client.cmsPlatform)].filter(Boolean).join(" - ") || "No domain saved")}</p>
      </div>
      <span class="meta-line">${escapeHtml(client.specialty || "No specialty saved yet")}</span>
    </button>
  `).join("");
}

clientCards.addEventListener("click", event => {
  const card = event.target.closest("[data-client-id]");
  if (!card) return;
  state.activeClientId = card.dataset.clientId;
  showView("client");
});

function activeClient() {
  return state.clients.find(client => client.id === state.activeClientId);
}

function renderClientDetail() {
  const client = activeClient();
  if (!client) {
    clientPageTitle.textContent = "Client";
    clientDetailSummary.innerHTML = `<p class="client-detail-text">Choose a client from the dashboard to view profile details and tools.</p>`;
    return;
  }
  clientPageTitle.textContent = client.name || "Unnamed client";
  const links = [
    client.websiteUrl && `<a href="${escapeAttr(client.websiteUrl)}" target="_blank">Website</a>`,
    client.campaignStrategyUrl && `<a href="${escapeAttr(client.campaignStrategyUrl)}" target="_blank">Campaign Strategy Template</a>`,
    client.driveFolderUrl && `<a href="${escapeAttr(client.driveFolderUrl)}" target="_blank">Client Folder</a>`
  ].filter(Boolean).join("");
  clientDetailSummary.innerHTML = `
    ${client.logo?.url ? `<img class="client-detail-logo" src="${escapeAttr(client.logo.url)}" alt="${escapeAttr(client.name)} logo" />` : ""}
    <span class="pod-pill">${escapeHtml(client.pod || "Unassigned")}</span>
    <h2>${escapeHtml(client.name || "Unnamed client")}</h2>
    <p class="client-detail-text">${escapeHtml([client.domain, client.specialty, cmsLabel(client.cmsPlatform)].filter(Boolean).join(" - ") || "No domain, specialty, or CMS saved yet.")}</p>
    <div class="detail-list">
      ${client.homepageUrl ? `<span><strong>Homepage:</strong> ${escapeHtml(client.homepageUrl)}</span>` : ""}
      ${links ? `<span><strong>Links:</strong> ${links}</span>` : ""}
      ${client.assets?.length ? `<span><strong>Helpful files:</strong> ${client.assets.length}</span>` : ""}
      ${client.notes ? `<span><strong>Notes:</strong> ${escapeHtml(client.notes)}</span>` : ""}
    </div>
  `;
  renderClientTools();
}

function renderClientTools() {
  clientToolCards.innerHTML = Object.entries(state.configs).map(([key, config]) => `
    <button class="tool-card" type="button" data-tool="${escapeAttr(key)}">
      <div class="tool-card-top">
        <span class="tool-icon">${escapeHtml(toolInitial(config.title))}</span>
      </div>
      <div>
        <h3>${escapeHtml(config.title)}</h3>
        <p>${escapeHtml(config.requiredFiles.join(" + "))}</p>
      </div>
    </button>
  `).join("");
}

clientToolCards.addEventListener("click", event => {
  const card = event.target.closest("[data-tool]");
  if (!card) return;
  selectTool(card.dataset.tool);
  showView("tool");
});

function openClientDialog(client) {
  clientForm.reset();
  document.querySelector("#clientId").value = client?.id || "";
  document.querySelector("#profileName").value = client?.name || "";
  document.querySelector("#profilePod").value = client?.pod || "";
  document.querySelector("#profileDomain").value = client?.domain || "";
  document.querySelector("#profileSpecialty").value = client?.specialty || "";
  document.querySelector("#profileCms").value = client?.cmsPlatform || "other";
  document.querySelector("#profileHomepage").value = client?.homepageUrl || "";
  document.querySelector("#profileWebsite").value = client?.websiteUrl || client?.homepageUrl || "";
  document.querySelector("#profileCampaign").value = client?.campaignStrategyUrl || "";
  document.querySelector("#profileDrive").value = client?.driveFolderUrl || "";
  document.querySelector("#profilePrimary").value = client?.primaryColor || "#003a5d";
  document.querySelector("#profileSecondary").value = client?.secondaryColor || "#ed1c24";
  document.querySelector("#profileNotes").value = client?.notes || "";
  clientDialog.showModal();
}

clientForm.addEventListener("submit", async event => {
  event.preventDefault();
  const formData = new FormData(clientForm);
  const response = await fetch("/api/clients", { method: "POST", body: formData });
  const client = await response.json();
  if (!response.ok) {
    setMessage(client.error || "Could not save client.", true);
    return;
  }
  const index = state.clients.findIndex(item => item.id === client.id);
  if (index >= 0) state.clients[index] = client;
  else state.clients.unshift(client);
  state.activeClientId = client.id;
  applyClientToRunForm(client);
  clientDialog.close();
  renderDashboard();
  renderClientDetail();
  showView("client");
});

function applyClientToRunForm(client) {
  runForm.elements.clientName.value = client?.name || "";
  runForm.elements.clientDomain.value = client?.domain || "";
  runForm.elements.clientSpecialty.value = client?.specialty || "";
  runForm.elements.cmsPlatform.value = client?.cmsPlatform || "other";
  runForm.elements.homepageUrl.value = client?.homepageUrl || client?.websiteUrl || "";
}

function selectTool(key) {
  state.activeTool = key;
  const config = state.configs[key] || {};
  toolTitle.textContent = config.title || "Choose a Tool";
  toolPrompt.textContent = config.prompt || "";
  updateUploadLabels();
  sitemapBox.style.display = key === "brokenLinks" || key === "redirects404" ? "grid" : "none";
  sitemapBox.querySelector("input").required = key === "brokenLinks" || key === "redirects404";
  templateBox.style.display = key === "keywordResearch" ? "grid" : "none";
  workflowField.style.display = key === "keywordResearch" ? "grid" : "none";
  state.results = [];
  state.exportRows = [];
  state.exportColumns = [];
  state.exportSheets = null;
  state.columns = [];
  clearExportPanel();
  renderTable();
  setMessage("");
}

function updateUploadLabels() {
  if (state.activeTool !== "keywordResearch") {
    mainUploadLabel.textContent = "Main Export";
    mainHelp.textContent = state.configs[state.activeTool]?.requiredFiles?.[0] || "Upload the workflow export.";
    return;
  }
  if (keywordWorkflow.value === "additional") {
    mainUploadLabel.textContent = "GSC CSV/XLSX";
    mainHelp.textContent = "Upload the Google Search Console Queries export from the last 3 months.";
    templateBox.querySelector("span").textContent = "Campaign Strategy Template";
    templateBox.querySelector("small").textContent = "Upload the template with the existing Keyword Expansion worksheet.";
  } else {
    mainUploadLabel.textContent = "Semrush Keyword Gap";
    mainHelp.textContent = "Upload the Semrush Keyword Gap export for the client and competitors.";
    templateBox.querySelector("span").textContent = "Campaign Strategy Template";
    templateBox.querySelector("small").textContent = "Upload the client's current campaign strategy template.";
  }
}

runForm.addEventListener("submit", async event => {
  event.preventDefault();
  setMessage("Parsing uploads and generating recommendations...");
  exportButton.disabled = true;
  const formData = new FormData(runForm);
  formData.set("tool", state.activeTool);
  try {
    const response = await fetch("/api/run", { method: "POST", body: formData });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error + (payload.validation?.issues?.length ? ` ${payload.validation.issues.join(" ")}` : ""));
    state.results = payload.results;
    state.exportRows = payload.exportRows || payload.results;
    state.exportColumns = payload.exportColumns?.length ? payload.exportColumns : Object.keys(state.exportRows[0] || {});
    state.exportSheets = payload.exportSheets || null;
    state.columns = Object.keys(state.results[0] || {});
    saveHistory(payload);
    renderTable();
    renderHistory();
    setMessage(runSummary(payload));
  } catch (error) {
    setMessage(error.message, true);
  }
});

function runSummary(payload) {
  const excluded = payload.results.filter(row => row.Status === "Excluded");
  const included = payload.results.filter(row => row.Status !== "Excluded");
  if (payload.tool === "brokenLinks") {
    const replacements = payload.results.filter(row => row["Remove/Replace"] === "Replace").length;
    const removals = payload.results.filter(row => row["Remove/Replace"] === "Remove").length;
    const reviews = payload.results.filter(row => /^check source/i.test(row["Remove/Replace"] || "")).length;
    return `Generated ${payload.results.length.toLocaleString()} broken-link rows: ${replacements} replacements, ${removals} removals, ${reviews} file/image review items.`;
  }
  const preview = included.slice(0, payload.config.previewCount || 0)
    .map(row => `${row["Source URL"] || row.Source || row.URL || row["Keyword/Query"] || row.Keyword} -> ${row["Redirect URL"] || row["Replacement URL"] || row["Preferred Page"] || ""}`)
    .filter(Boolean);
  const parts = [`Generated ${included.length.toLocaleString()} export-ready recommendations for ${payload.client.name || "this client"}.`];
  if (excluded.length) parts.push(`${excluded.length.toLocaleString()} unsafe infrastructure/asset rows were excluded from export.`);
  if (preview.length) parts.push(`Sanity preview: ${preview.join(" | ")}`);
  return parts.join(" ");
}

function renderTable() {
  const rows = visibleResultIndexes().map(index => state.results[index]);
  rowCount.textContent = state.results.length ? `${rows.length} of ${state.results.length} rows` : "No run yet";
  exportButton.disabled = !state.results.length;
  if (!state.columns.length) {
    resultsTable.innerHTML = `<tbody><tr><td>Upload exports to generate editable recommendations.</td></tr></tbody>`;
    return;
  }
  const thead = `<thead><tr>${state.columns.map(column => `<th>${escapeHtml(column)}</th>`).join("")}</tr></thead>`;
  const tbody = rows.map((row, rowIndex) => `
    <tr>${state.columns.map(column => renderCell(row, rowIndex, column)).join("")}</tr>
  `).join("");
  resultsTable.innerHTML = `${thead}<tbody>${tbody}</tbody>`;
}

function renderCell(row, rowIndex, column) {
  const value = row[column] ?? "";
  if (column === "Preview" && /^https?:\/\//i.test(value)) {
    return `<td data-index="${rowIndex}" data-column="${escapeHtml(column)}"><img class="image-preview" src="${escapeAttr(value)}" alt="Image preview" loading="lazy" /></td>`;
  }
  if (column === "Reviewed") {
    const checked = /yes|true|reviewed|approved|done/i.test(String(value));
    return `<td data-index="${rowIndex}" data-column="${escapeHtml(column)}"><label class="review-check"><input type="checkbox" ${checked ? "checked" : ""} />Reviewed</label></td>`;
  }
  return `<td contenteditable="true" data-index="${rowIndex}" data-column="${escapeHtml(column)}">${escapeHtml(value)}</td>`;
}

resultsTable.addEventListener("input", event => {
  const cell = event.target.closest("td[data-column]");
  if (!cell) return;
  const actualIndex = actualRowIndex(cell.parentElement);
  if (actualIndex === -1) return;
  state.results[actualIndex][cell.dataset.column] = cell.textContent.trim();
  if (state.activeTool === "altText" && cell.dataset.column === "Alt Text") refreshAltTextExportRows();
});

resultsTable.addEventListener("change", event => {
  const checkbox = event.target.closest('td[data-column="Reviewed"] input[type="checkbox"]');
  if (!checkbox) return;
  const cell = checkbox.closest("td[data-column]");
  const actualIndex = actualRowIndex(cell.parentElement);
  if (actualIndex === -1) return;
  state.results[actualIndex].Reviewed = checkbox.checked ? "Yes" : "";
  if (state.activeTool === "altText") {
    state.results[actualIndex].Status = checkbox.checked ? "Reviewed" : "Needs Review";
    refreshAltTextExportRows();
    renderTable();
  }
});

function actualRowIndex(rowElement) {
  const visibleRows = [...resultsTable.querySelectorAll("tbody tr")];
  const visibleIndex = visibleRows.indexOf(rowElement);
  return visibleResultIndexes()[visibleIndex] ?? -1;
}

function visibleResultIndexes() {
  const filter = tableFilter.value.trim().toLowerCase();
  const confidence = confidenceFilter.value;
  const status = statusFilter.value;
  return state.results
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => {
      const haystack = Object.values(row).join(" ").toLowerCase();
      return (!filter || haystack.includes(filter)) &&
        (!confidence || row.Confidence === confidence) &&
        (!status || row.Status === status);
    })
    .map(item => item.index);
}

function refreshAltTextExportRows() {
  state.exportRows = state.results.filter(row => /yes|reviewed|approved|done/i.test(`${row.Reviewed} ${row.Status}`)).map(row => ({
    "Image URL": row["Image URL"],
    "Alt Text": row["Alt Text"],
    "Source URLs": row["Source URLs"],
    Status: row.Status,
    Confidence: row.Confidence,
    Reason: row.Reason
  }));
  state.exportColumns = state.exportRows.length ? Object.keys(state.exportRows[0]) : ["Image URL", "Alt Text", "Source URLs", "Status", "Confidence", "Reason"];
}

tableFilter.addEventListener("input", renderTable);
confidenceFilter.addEventListener("change", renderTable);
statusFilter.addEventListener("change", renderTable);
markVisibleReviewed.addEventListener("click", () => {
  if (state.activeTool !== "altText") {
    setMessage("Bulk review is only available for Image Missing Alt Text.");
    return;
  }
  visibleResultIndexes().forEach(index => {
    state.results[index].Reviewed = "Yes";
    state.results[index].Status = "Reviewed";
  });
  refreshAltTextExportRows();
  renderTable();
  setMessage("Visible alt text rows marked reviewed.");
});

exportButton.addEventListener("click", () => {
  const exportRows = state.exportRows.length ? state.exportRows : state.results.filter(row => row.Status !== "Excluded");
  const exportColumns = state.exportColumns.length ? state.exportColumns : state.columns;
  if (!exportRows.length) {
    setMessage("There are no exportable rows. Excluded rows are intentionally omitted.", true);
    return;
  }
  const format = state.activeTool === "brokenLinks" || state.activeTool === "keywordResearch" ? "xls" : "csv";
  const filename = `${state.configs[state.activeTool].title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${new Date().toISOString().slice(0, 10)}.${format}`;
  downloadExport(exportColumns, exportRows, filename, format, state.exportSheets || null);
});

async function downloadExport(columns, rows, filename, format, sheets = null) {
  try {
    exportButton.disabled = true;
    const response = await fetch("/api/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ columns, rows, filename, format, sheets })
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "The server could not prepare the export.");
    const a = document.createElement("a");
    a.href = payload.url;
    a.download = payload.filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    showExportPanel(payload.content, payload.url, payload.filename);
    setMessage(`${format === "xls" ? "Excel" : "CSV"} download prepared: ${payload.filename}. If no file appeared, use the visible Download link or copy the preview below.`);
  } catch (error) {
    setMessage(error.message, true);
  } finally {
    exportButton.disabled = !state.results.length;
  }
}

function showExportPanel(csvText, objectUrl, filename) {
  manualDownloadLink.href = objectUrl;
  manualDownloadLink.download = filename;
  csvPreview.value = csvText;
  exportPanel.hidden = false;
}

function clearExportPanel() {
  manualDownloadLink.removeAttribute("href");
  manualDownloadLink.removeAttribute("download");
  csvPreview.value = "";
  exportPanel.hidden = true;
}

copyCsvButton.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(csvPreview.value);
    setMessage("Export preview copied to clipboard.");
  } catch {
    csvPreview.select();
    document.execCommand("copy");
    setMessage("Export preview selected and copied.");
  }
});

function saveHistory(payload) {
  const item = {
    id: crypto.randomUUID(),
    tool: state.activeTool,
    toolTitle: payload.config.title,
    client: payload.client.name || "Unnamed client",
    clientId: state.activeClientId,
    pod: activeClient()?.pod || "Unassigned",
    generatedAt: payload.generatedAt,
    rows: payload.results.length,
    results: payload.results,
    exportRows: payload.exportRows,
    exportColumns: payload.exportColumns,
    exportSheets: payload.exportSheets
  };
  state.history = [item, ...state.history].slice(0, 12);
  localStorage.setItem("seo-mvp-history", JSON.stringify(state.history));
}

function renderHistory() {
  if (!state.history.length) {
    historyList.innerHTML = `<span>No saved runs yet.</span>`;
    return;
  }
  historyList.innerHTML = state.history.map(item => `
    <button type="button" data-id="${escapeAttr(item.id)}">
      <strong>${escapeHtml(item.client)}</strong><br />
      ${escapeHtml(item.toolTitle)} - ${item.rows} rows<br />
      <span>${escapeHtml(item.pod || "Unassigned")}</span>
    </button>
  `).join("");
}

historyList.addEventListener("click", event => {
  const button = event.target.closest("button[data-id]");
  if (!button) return;
  const item = state.history.find(run => run.id === button.dataset.id);
  if (!item) return;
  state.activeClientId = item.clientId || state.activeClientId;
  selectTool(item.tool);
  state.results = item.results;
  state.exportRows = item.exportRows || item.results;
  state.exportColumns = item.exportColumns || Object.keys(state.exportRows[0] || {});
  state.exportSheets = item.exportSheets || null;
  state.columns = Object.keys(state.results[0] || {});
  showView("tool");
  renderTable();
  setMessage(`Loaded ${item.rows} saved recommendations for ${item.client}.`);
});

function setMessage(text, isError = false) {
  message.hidden = !text;
  message.textContent = text;
  message.classList.toggle("error", isError);
}

function initials(text) {
  const parts = String(text || "NP").trim().split(/\s+/).filter(Boolean);
  return (parts[0]?.[0] || "N") + (parts[1]?.[0] || parts[0]?.[1] || "P");
}

function toolInitial(title) {
  return String(title || "?").split(/\s+/).map(word => word[0]).join("").slice(0, 2).toUpperCase();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function cmsLabel(value) {
  if (value === "wordpress") return "WordPress";
  if (value === "shopify") return "Shopify";
  if (value === "other") return "Other CMS";
  return "";
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/'/g, "&#39;");
}

init();
