const state = {
  configs: {},
  clients: [],
  activeClientId: "",
  activeTool: "brokenLinks",
  results: [],
  exportRows: [],
  exportColumns: [],
  columns: [],
  history: JSON.parse(localStorage.getItem("seo-mvp-history") || "[]"),
  brand: JSON.parse(localStorage.getItem("seo-mvp-brand") || "null") || {
    agencyName: "National Positions",
    productName: "SEO Solutions",
    primaryColor: "#004b8d",
    secondaryColor: "#17a2a4"
  }
};

const toolList = document.querySelector("#toolList");
const toolTitle = document.querySelector("#toolTitle");
const toolPrompt = document.querySelector("#toolPrompt");
const runForm = document.querySelector("#runForm");
const sitemapBox = document.querySelector("#sitemapBox");
const mainHelp = document.querySelector("#mainHelp");
const message = document.querySelector("#message");
const resultsTable = document.querySelector("#resultsTable");
const rowCount = document.querySelector("#rowCount");
const exportButton = document.querySelector("#exportButton");
const tableFilter = document.querySelector("#tableFilter");
const confidenceFilter = document.querySelector("#confidenceFilter");
const statusFilter = document.querySelector("#statusFilter");
const markVisibleReviewed = document.querySelector("#markVisibleReviewed");
const historyList = document.querySelector("#historyList");
const clientSelect = document.querySelector("#clientSelect");
const clientSummary = document.querySelector("#clientSummary");
const clientDialog = document.querySelector("#clientDialog");
const clientForm = document.querySelector("#clientForm");
const exportPanel = document.querySelector("#exportPanel");
const manualDownloadLink = document.querySelector("#manualDownloadLink");
const copyCsvButton = document.querySelector("#copyCsvButton");
const csvPreview = document.querySelector("#csvPreview");

async function init() {
  applyBrand();
  const [configResponse, clientsResponse] = await Promise.all([
    fetch("/api/config"),
    fetch("/api/clients")
  ]);
  state.configs = await configResponse.json();
  state.clients = await clientsResponse.json();
  renderTools();
  renderClients();
  selectTool(state.activeTool);
  renderHistory();
}

function applyBrand() {
  document.documentElement.style.setProperty("--primary", state.brand.primaryColor);
  document.documentElement.style.setProperty("--secondary", state.brand.secondaryColor);
  document.querySelector("#brandTitle").textContent = `${state.brand.agencyName} ${state.brand.productName}`;
  document.title = `${state.brand.agencyName} ${state.brand.productName}`;
}

function renderTools() {
  toolList.innerHTML = "";
  Object.entries(state.configs).forEach(([key, config]) => {
    const button = document.createElement("button");
    button.className = "tool-card";
    button.type = "button";
    button.dataset.tool = key;
    button.innerHTML = `<strong>${escapeHtml(config.title)}</strong><span>${escapeHtml(config.requiredFiles.join(" + "))}</span>`;
    button.addEventListener("click", () => selectTool(key));
    toolList.appendChild(button);
  });
}

function selectTool(key) {
  state.activeTool = key;
  const config = state.configs[key];
  document.querySelectorAll(".tool-card").forEach(card => card.classList.toggle("active", card.dataset.tool === key));
  toolTitle.textContent = config.title;
  toolPrompt.textContent = config.prompt;
  mainHelp.textContent = config.requiredFiles[0];
  sitemapBox.style.display = key === "brokenLinks" || key === "redirects404" ? "grid" : "none";
  sitemapBox.querySelector("input").required = key === "brokenLinks" || key === "redirects404";
  state.results = [];
  state.exportRows = [];
  state.exportColumns = [];
  state.columns = [];
  clearExportPanel();
  renderTable();
  setMessage("");
}

function renderClients() {
  clientSelect.innerHTML = `<option value="">New or unsaved client</option>` + state.clients
    .map(client => `<option value="${escapeHtml(client.id)}">${escapeHtml(client.name || "Unnamed client")}</option>`)
    .join("");
  clientSelect.value = state.activeClientId;
  renderClientSummary();
}

function activeClient() {
  return state.clients.find(client => client.id === state.activeClientId);
}

function renderClientSummary() {
  const client = activeClient();
  if (!client) {
    clientSummary.innerHTML = `<span>Choose or save a client to reuse site links, campaign templates, branding, and notes.</span>`;
    return;
  }
  const links = [
    client.websiteUrl && `<a href="${escapeAttr(client.websiteUrl)}" target="_blank">Website</a>`,
    client.campaignStrategyUrl && `<a href="${escapeAttr(client.campaignStrategyUrl)}" target="_blank">Campaign Strategy Template</a>`,
    client.driveFolderUrl && `<a href="${escapeAttr(client.driveFolderUrl)}" target="_blank">Client Folder</a>`
  ].filter(Boolean).join(" ");
  clientSummary.innerHTML = `
    ${client.logo?.url ? `<img src="${escapeAttr(client.logo.url)}" alt="${escapeAttr(client.name)} logo" />` : ""}
    <strong>${escapeHtml(client.name)}</strong>
    <span>${escapeHtml([client.domain, client.specialty, cmsLabel(client.cmsPlatform)].filter(Boolean).join(" - ") || "No domain or specialty saved yet.")}</span>
    ${links ? `<div>${links}</div>` : ""}
    ${client.assets?.length ? `<span>${client.assets.length} helpful file${client.assets.length === 1 ? "" : "s"} stored.</span>` : ""}
  `;
}

function applyClientToRunForm(client) {
  runForm.elements.clientName.value = client?.name || "";
  runForm.elements.clientDomain.value = client?.domain || "";
  runForm.elements.clientSpecialty.value = client?.specialty || "";
  runForm.elements.cmsPlatform.value = client?.cmsPlatform || "other";
  runForm.elements.homepageUrl.value = client?.homepageUrl || client?.websiteUrl || "";
}

clientSelect.addEventListener("change", () => {
  state.activeClientId = clientSelect.value;
  const client = activeClient();
  applyClientToRunForm(client);
  renderClientSummary();
});

document.querySelector("#clientDialogButton").addEventListener("click", () => {
  const client = activeClient();
  clientForm.reset();
  document.querySelector("#clientId").value = client?.id || "";
  document.querySelector("#profileName").value = client?.name || runForm.elements.clientName.value || "";
  document.querySelector("#profileDomain").value = client?.domain || runForm.elements.clientDomain.value || "";
  document.querySelector("#profileSpecialty").value = client?.specialty || runForm.elements.clientSpecialty.value || "";
  document.querySelector("#profileCms").value = client?.cmsPlatform || runForm.elements.cmsPlatform.value || "other";
  document.querySelector("#profileHomepage").value = client?.homepageUrl || runForm.elements.homepageUrl.value || "";
  document.querySelector("#profileWebsite").value = client?.websiteUrl || client?.homepageUrl || "";
  document.querySelector("#profileCampaign").value = client?.campaignStrategyUrl || "";
  document.querySelector("#profileDrive").value = client?.driveFolderUrl || "";
  document.querySelector("#profilePrimary").value = client?.primaryColor || state.brand.primaryColor;
  document.querySelector("#profileSecondary").value = client?.secondaryColor || state.brand.secondaryColor;
  document.querySelector("#profileNotes").value = client?.notes || "";
  clientDialog.showModal();
});

document.querySelector("#cancelClient").addEventListener("click", () => clientDialog.close());

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
  renderClients();
  clientDialog.close();
  setMessage(`Saved client profile for ${client.name}.`);
});

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
    .map(row => `${row["Source URL"] || row.Source || row.URL} -> ${row["Redirect URL"] || row["Replacement URL"] || row["Preferred Page"] || ""}`)
    .filter(Boolean);
  const parts = [`Generated ${included.length.toLocaleString()} export-ready recommendations for ${payload.client.name || "this client"}.`];
  if (excluded.length) parts.push(`${excluded.length.toLocaleString()} unsafe infrastructure/asset rows were excluded from export.`);
  if (preview.length) parts.push(`Sanity preview: ${preview.join(" | ")}`);
  return parts.join(" ");
}

function renderTable() {
  const filter = tableFilter.value.trim().toLowerCase();
  const confidence = confidenceFilter.value;
  const rows = visibleResultIndexes().map(index => state.results[index]);
  rowCount.textContent = state.results.length ? `${rows.length} of ${state.results.length} rows` : "No run yet";
  exportButton.disabled = !state.results.length;
  if (!state.columns.length) {
    resultsTable.innerHTML = `<tbody><tr><td>Upload exports to generate editable recommendations.</td></tr></tbody>`;
    return;
  }
  const thead = `<thead><tr>${state.columns.map(column => `<th>${escapeHtml(column)}</th>`).join("")}</tr></thead>`;
  const tbody = rows.map((row, rowIndex) => `
    <tr>
      ${state.columns.map(column => renderCell(row, rowIndex, column)).join("")}
    </tr>
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
  const filename = `${state.configs[state.activeTool].title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${new Date().toISOString().slice(0, 10)}.csv`;
  downloadCsv(exportColumns, exportRows, filename);
});

async function downloadCsv(columns, rows, filename) {
  try {
    exportButton.disabled = true;
    const response = await fetch("/api/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ columns, rows, filename })
    });
    if (!response.ok) throw new Error("The server could not prepare the CSV.");
    const blob = await response.blob();
    const csvText = await blob.text();
    const a = document.createElement("a");
    const downloadBlob = new Blob([csvText], { type: "text/csv;charset=utf-8" });
    const objectUrl = URL.createObjectURL(downloadBlob);
    a.href = objectUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    showExportPanel(csvText, objectUrl, filename);
    setMessage(`CSV download prepared: ${filename}. If no file appeared, use the visible Download CSV link or copy the preview below.`);
  } catch (error) {
    setMessage(error.message, true);
  } finally {
    exportButton.disabled = !state.results.length;
  }
}

function showExportPanel(csvText, objectUrl, filename) {
  if (manualDownloadLink.dataset.objectUrl) URL.revokeObjectURL(manualDownloadLink.dataset.objectUrl);
  manualDownloadLink.href = objectUrl;
  manualDownloadLink.download = filename;
  manualDownloadLink.dataset.objectUrl = objectUrl;
  csvPreview.value = csvText;
  exportPanel.hidden = false;
}

function clearExportPanel() {
  if (manualDownloadLink.dataset.objectUrl) URL.revokeObjectURL(manualDownloadLink.dataset.objectUrl);
  manualDownloadLink.removeAttribute("href");
  manualDownloadLink.removeAttribute("download");
  delete manualDownloadLink.dataset.objectUrl;
  csvPreview.value = "";
  exportPanel.hidden = true;
}

copyCsvButton.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(csvPreview.value);
    setMessage("CSV copied to clipboard.");
  } catch {
    csvPreview.select();
    document.execCommand("copy");
    setMessage("CSV selected and copied.");
  }
});

function csvCell(value) {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function saveHistory(payload) {
  const item = {
    id: crypto.randomUUID(),
    tool: state.activeTool,
    toolTitle: payload.config.title,
    client: payload.client.name || "Unnamed client",
    generatedAt: payload.generatedAt,
    rows: payload.results.length,
    results: payload.results,
    exportRows: payload.exportRows,
    exportColumns: payload.exportColumns
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
    <button type="button" data-id="${item.id}">
      <strong>${escapeHtml(item.client)}</strong><br />
      ${escapeHtml(item.toolTitle)} - ${item.rows} rows
    </button>
  `).join("");
}

historyList.addEventListener("click", event => {
  const button = event.target.closest("button[data-id]");
  if (!button) return;
  const item = state.history.find(run => run.id === button.dataset.id);
  if (!item) return;
  selectTool(item.tool);
  state.results = item.results;
  state.exportRows = item.exportRows || item.results;
  state.exportColumns = item.exportColumns || Object.keys(state.exportRows[0] || {});
  state.columns = Object.keys(state.results[0] || {});
  renderTable();
  setMessage(`Loaded ${item.rows} saved recommendations for ${item.client}.`);
});

function setMessage(text, isError = false) {
  message.hidden = !text;
  message.textContent = text;
  message.classList.toggle("error", isError);
}

document.querySelector("#settingsButton").addEventListener("click", () => {
  document.querySelector("#agencyName").value = state.brand.agencyName;
  document.querySelector("#productName").value = state.brand.productName;
  document.querySelector("#primaryColor").value = state.brand.primaryColor;
  document.querySelector("#secondaryColor").value = state.brand.secondaryColor;
  document.querySelector("#settingsDialog").showModal();
});

document.querySelector("#saveBrand").addEventListener("click", () => {
  state.brand = {
    agencyName: document.querySelector("#agencyName").value || "National Positions",
    productName: document.querySelector("#productName").value || "SEO Solutions",
    primaryColor: document.querySelector("#primaryColor").value,
    secondaryColor: document.querySelector("#secondaryColor").value
  };
  localStorage.setItem("seo-mvp-brand", JSON.stringify(state.brand));
  applyBrand();
});

function escapeHtml(value) {
  return String(value)
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
