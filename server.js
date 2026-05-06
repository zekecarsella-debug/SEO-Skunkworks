const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, "public");
const DATA_DIR = path.join(__dirname, "data");
const CLIENTS_FILE = path.join(DATA_DIR, "clients.json");
const CLIENT_ASSET_DIR = path.join(DATA_DIR, "client-assets");
const EXPORT_DIR = path.join(DATA_DIR, "exports");
const RUNTIME_NODE_MODULES =
  process.env.NODE_REPL_NODE_MODULE_DIRS ||
  "C:\\Users\\Zeke\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\node\\node_modules";

let JSZip;
try {
  JSZip = require(path.join(RUNTIME_NODE_MODULES, "jszip"));
} catch {
  JSZip = null;
}

const toolConfigs = {
  brokenLinks: {
    title: "Broken Link Fixer",
    prompt:
      "Replace broken internal or external destinations with close sitemap alternatives. Remove links when the best match is generic, homepage-only, or low confidence.",
    requiredFiles: ["Screaming Frog 4xx inlinks CSV/XLSX", "XML sitemap"],
    exportColumns: ["Source URL", "Destination", "Anchor", "Remove/Replace", "Replacement URL", "Status", "Notes"],
    previewCount: 3
  },
  redirects404: {
    title: "404 Redirect Mapper",
    prompt:
      "Map GSC 404 URLs to the closest live sitemap URL. Use the homepage only when no relevant match exists.",
    requiredFiles: ["GSC 404 export CSV/XLSX", "XML sitemap"],
    exportColumns: ["Source URL", "Redirect URL", "Status", "Confidence", "Reason"],
    platformExportColumns: {
      shopify: ["Redirect from", "Redirect to"],
      wordpress: ["source URL", "target URL", "regex", "http code"],
      other: ["Source URL", "Target URL"]
    },
    previewCount: 3,
    excludedPatternPolicy:
      "Unsafe wildcard, WordPress infrastructure, asset, plugin, theme, upload, and core PHP paths are excluded from redirect exports."
  },
  keywordResearch: {
    title: "Keyword Research",
    prompt:
      "Create keyword expansion recommendations from Semrush Keyword Gap or GSC query performance exports.",
    requiredFiles: ["Semrush Keyword Gap or GSC CSV/XLSX", "Campaign Strategy Template"],
    exportColumns: ["Keyword", "Type", "Category", "Position", "Volume", "Ranking URL", "Preferred Page", "Confidence", "Reason"],
    workflows: {
      initial: "Initial Keyword Research",
      additional: "Additional Keyword Research"
    }
  },
  altText: {
    title: "Image Missing Alt Text",
    prompt:
      "Write concise, unique image alt text from the image URL, filename, source page, and client context. Reuse one caption for duplicate image URLs.",
    requiredFiles: ["Screaming Frog images missing alt text inlinks CSV/XLSX"],
    exportColumns: ["Image URL", "Alt Text", "Source URLs", "Status", "Confidence", "Reason"]
  }
};

function sendJson(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload));
}

function sendCsv(res, filename, columns, rows) {
  const csv = toCsv(columns, rows);
  res.writeHead(200, {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="${filename.replace(/"/g, "")}"`
  });
  res.end(csv);
}

function sendExcelHtml(res, filename, columns, rows, sheets = null) {
  const html = sheets ? excelMultiSheetHtml(sheets) : excelWorkbookHtml(columns, rows);
  res.writeHead(200, {
    "Content-Type": "application/vnd.ms-excel; charset=utf-8",
    "Content-Disposition": `attachment; filename="${filename.replace(/"/g, "")}"`
  });
  res.end(html);
}

function excelWorkbookHtml(columns, rows) {
  return `<!doctype html><html><head><meta charset="utf-8" /></head><body><table>${[
    `<tr>${columns.map(column => `<th>${escapeHtmlText(column)}</th>`).join("")}</tr>`,
    ...rows.map(row => `<tr>${columns.map(column => `<td>${escapeHtmlText(row[column] ?? "")}</td>`).join("")}</tr>`)
  ].join("")}</table></body></html>`;
}

function excelMultiSheetHtml(sheets) {
  return `<!doctype html><html xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8" />` +
    `<xml><x:ExcelWorkbook><x:ExcelWorksheets>${sheets.map(sheet => `<x:ExcelWorksheet><x:Name>${escapeHtmlText(sheet.name)}</x:Name><x:WorksheetOptions /></x:ExcelWorksheet>`).join("")}</x:ExcelWorksheets></x:ExcelWorkbook></xml>` +
    `</head><body>${sheets.map(sheet => `<h2>${escapeHtmlText(sheet.name)}</h2><table>${[
      `<tr>${sheet.columns.map(column => `<th>${escapeHtmlText(column)}</th>`).join("")}</tr>`,
      ...sheet.rows.map(row => `<tr>${sheet.columns.map(column => `<td>${escapeHtmlText(row[column] ?? "")}</td>`).join("")}</tr>`)
    ].join("")}</table>`).join("<br />")}</body></html>`;
}

function escapeHtmlText(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function toCsv(columns, rows) {
  return [
    columns.map(csvCell).join(","),
    ...rows.map(row => columns.map(column => csvCell(row[column] ?? "")).join(","))
  ].join("\r\n");
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function ensureDataDirs() {
  fs.mkdirSync(CLIENT_ASSET_DIR, { recursive: true });
  fs.mkdirSync(EXPORT_DIR, { recursive: true });
  if (!fs.existsSync(CLIENTS_FILE)) fs.writeFileSync(CLIENTS_FILE, "[]");
}

function readClients() {
  ensureDataDirs();
  try {
    return JSON.parse(fs.readFileSync(CLIENTS_FILE, "utf8"));
  } catch {
    return [];
  }
}

function writeClients(clients) {
  ensureDataDirs();
  fs.writeFileSync(CLIENTS_FILE, JSON.stringify(clients, null, 2));
}

function safeFileName(filename) {
  const ext = path.extname(filename || "").toLowerCase();
  const base = path.basename(filename || "asset", ext).replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "");
  return `${Date.now()}-${base || "asset"}${ext}`;
}

function assetUrl(filename) {
  return `/client-assets/${encodeURIComponent(filename)}`;
}

function serveClientAsset(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const name = decodeURIComponent(url.pathname.replace(/^\/client-assets\//, ""));
  const target = path.normalize(path.join(CLIENT_ASSET_DIR, name));
  if (!target.startsWith(CLIENT_ASSET_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  fs.readFile(target, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    const ext = path.extname(target).toLowerCase();
    const type =
      ext === ".png" ? "image/png" :
      ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" :
      ext === ".webp" ? "image/webp" :
      ext === ".svg" ? "image/svg+xml" :
      "application/octet-stream";
    res.writeHead(200, { "Content-Type": type });
    res.end(data);
  });
}

function serveExport(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const name = decodeURIComponent(url.pathname.replace(/^\/exports\//, ""));
  const target = path.normalize(path.join(EXPORT_DIR, name));
  if (!target.startsWith(EXPORT_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  fs.readFile(target, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    const ext = path.extname(target).toLowerCase();
    const type = ext === ".xls" ? "application/vnd.ms-excel; charset=utf-8" : "text/csv; charset=utf-8";
    res.writeHead(200, {
      "Content-Type": type,
      "Content-Disposition": `attachment; filename="${path.basename(target)}"`
    });
    res.end(data);
  });
}

function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const target = path.normalize(path.join(PUBLIC_DIR, pathname));
  if (!target.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  fs.readFile(target, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    const ext = path.extname(target).toLowerCase();
    const type =
      ext === ".html" ? "text/html" :
      ext === ".css" ? "text/css" :
      ext === ".js" ? "text/javascript" :
      ext === ".png" ? "image/png" :
      ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" :
      ext === ".webp" ? "image/webp" :
      ext === ".svg" ? "image/svg+xml" :
      "application/octet-stream";
    res.writeHead(200, { "Content-Type": type });
    res.end(data);
  });
}

function collectBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", chunk => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function parseMultipart(buffer, contentType) {
  const boundaryMatch = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || "");
  if (!boundaryMatch) return { fields: {}, files: [] };
  const boundary = Buffer.from(`--${boundaryMatch[1] || boundaryMatch[2]}`);
  const fields = {};
  const files = [];
  let start = buffer.indexOf(boundary);
  while (start !== -1) {
    const next = buffer.indexOf(boundary, start + boundary.length);
    if (next === -1) break;
    let part = buffer.slice(start + boundary.length, next);
    start = next;
    if (part.slice(0, 2).toString() === "--") break;
    if (part.slice(0, 2).toString() === "\r\n") part = part.slice(2);
    const sep = part.indexOf(Buffer.from("\r\n\r\n"));
    if (sep === -1) continue;
    const rawHeaders = part.slice(0, sep).toString("utf8");
    let content = part.slice(sep + 4);
    if (content.slice(-2).toString() === "\r\n") content = content.slice(0, -2);
    const disposition = /content-disposition:\s*form-data;([^\r\n]+)/i.exec(rawHeaders);
    if (!disposition) continue;
    const name = /name="([^"]+)"/i.exec(disposition[1])?.[1];
    const filename = /filename="([^"]*)"/i.exec(disposition[1])?.[1];
    if (!name) continue;
    if (filename) {
      files.push({ field: name, filename, buffer: content });
    } else {
      fields[name] = content.toString("utf8");
    }
  }
  return { fields, files };
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (ch === '"' && inQuotes && next === '"') {
      cell += '"';
      i++;
    } else if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      row.push(cell);
      cell = "";
    } else if ((ch === "\n" || ch === "\r") && !inQuotes) {
      if (ch === "\r" && next === "\n") i++;
      row.push(cell);
      if (row.some(value => value.trim() !== "")) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += ch;
    }
  }
  row.push(cell);
  if (row.some(value => value.trim() !== "")) rows.push(row);
  if (!rows.length) return [];
  const headers = rows[0].map(cleanHeader);
  return rows.slice(1).map(values => {
    const record = {};
    headers.forEach((header, index) => {
      record[header || `column_${index + 1}`] = (values[index] || "").trim();
    });
    return record;
  });
}

async function parseXlsx(buffer, tool = "", context = {}) {
  if (!JSZip) throw new Error("XLSX parsing needs JSZip from the bundled Codex runtime.");
  const zip = await JSZip.loadAsync(buffer);
  const sharedXml = await zip.file("xl/sharedStrings.xml")?.async("string");
  const shared = sharedXml
    ? [...sharedXml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map(match =>
        decodeXml([...match[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(t => t[1]).join(""))
      )
    : [];
  const workbook = await zip.file("xl/workbook.xml")?.async("string");
  const rels = await zip.file("xl/_rels/workbook.xml.rels")?.async("string");
  const relMap = workbookRelationships(rels || "");
  const sheets = [...(workbook || "").matchAll(/<sheet\b([^>]*)\/?>/g)]
    .map((match, index) => {
      const attrs = match[1];
      const relId = /r:id="([^"]+)"/.exec(attrs)?.[1];
      const name = decodeXml(/name="([^"]+)"/.exec(attrs)?.[1] || `Sheet ${index + 1}`);
      const target = relMap[relId];
      const sheetPath = target ? `xl/${target.replace(/^\/?xl\//, "")}` : `xl/worksheets/sheet${index + 1}.xml`;
      return { name, sheetPath };
    })
    .filter(sheet => /xl\/worksheets\//.test(sheet.sheetPath));
  const candidates = [];
  for (const sheet of sheets.length ? sheets : [{ name: "Sheet 1", sheetPath: "xl/worksheets/sheet1.xml" }]) {
    const sheetXml = await zip.file(sheet.sheetPath)?.async("string");
    if (!sheetXml) continue;
    const parsed = parseWorksheetXml(sheetXml, shared, tool, context);
    if (parsed.rows.length) candidates.push({ ...sheet, ...parsed, score: parsed.score + worksheetPreferenceScore(sheet.name, tool, context) });
  }
  if (!candidates.length) return [];
  candidates.sort((a, b) => b.score - a.score);
  const rows = candidates[0].rows;
  rows._worksheetName = candidates[0].name;
  return rows;
}

function worksheetPreferenceScore(name, tool, context = {}) {
  const sheetName = normalize(name);
  if (tool !== "keywordResearch") return 0;
  if (context.source === "template" && /keywordexpansion/.test(sheetName)) return 10000;
  if (context.workflow === "additional") {
    if (sheetName === "queries" || sheetName.includes("query")) return 10000;
    if (["chart", "pages", "countries", "devices", "searchappearance", "filters"].includes(sheetName)) return -2000;
  }
  if (context.workflow === "initial") {
    if (/competitivekeywordanalysis|keywordgap|keyword/.test(sheetName)) return 5000;
    if (sheetName === "queries") return -1000;
  }
  return 0;
}

function workbookRelationships(rels) {
  const map = {};
  for (const match of rels.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    const attrs = match[1];
    const id = /Id="([^"]+)"/.exec(attrs)?.[1];
    const target = /Target="([^"]+)"/.exec(attrs)?.[1];
    if (id && target) map[id] = target;
  }
  return map;
}

function parseWorksheetXml(sheetXml, shared, tool, context = {}) {
  const rowMaps = [...sheetXml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)].map(rowMatch => {
    const row = {};
    for (const cellMatch of rowMatch[1].matchAll(/<c([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attrs = cellMatch[1];
      const body = cellMatch[2];
      const ref = /r="([A-Z]+)\d+"/.exec(attrs)?.[1];
      const col = columnIndex(ref || "A");
      const type = /t="([^"]+)"/.exec(attrs)?.[1];
      const raw = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1] || /<t[^>]*>([\s\S]*?)<\/t>/.exec(body)?.[1] || "";
      row[col] = type === "s" ? shared[Number(raw)] || "" : decodeXml(raw);
    }
    return row;
  });
  if (!rowMaps.length) return { rows: [], score: 0 };
  const maxCol = Math.max(...rowMaps.map(row => Math.max(0, ...Object.keys(row).map(Number))));
  const matrices = rowMaps.map(row => Array.from({ length: maxCol + 1 }, (_, i) => cleanHeader(row[i] || "")));
  const headerIndex = detectHeaderRow(matrices, tool, context);
  const header = matrices[headerIndex].map((cell, i) => cell || `column_${i + 1}`);
  const rows = rowMaps.slice(headerIndex + 1).map(row => {
    const record = {};
    header.forEach((key, i) => {
      record[key] = String(row[i] || "").trim();
    });
    return record;
  }).filter(record => Object.values(record).some(Boolean));
  return {
    rows,
    score: rowHeaderScore(header, tool, context) * 1000 + Math.min(rows.length, 500)
  };
}

function detectHeaderRow(rows, tool, context = {}) {
  let best = { index: 0, score: -1 };
  rows.slice(0, 30).forEach((row, index) => {
    const nonEmpty = row.filter(Boolean).length;
    const score = rowHeaderScore(row, tool, context) * 10 + Math.min(nonEmpty, 8);
    if (score > best.score) best = { index, score };
  });
  return best.index;
}

function rowHeaderScore(headers, tool, context = {}) {
  const joined = headers.map(normalize).join(" ");
  const candidates = {
    redirects404: ["url", "page", "address", "notfound", "submittedurl", "lastcrawled"],
    brokenLinks: ["source", "sourceurl", "destination", "linkurl", "anchor", "statuscode"],
    keywordResearch: context.source === "template"
      ? ["keyword", "primarykeyword", "secondarykeyword", "category", "preferredpage", "rankingurl"]
      : context.workflow === "additional"
        ? ["topqueries", "query", "queries", "clicks", "impressions", "ctr", "position", "averageposition"]
        : ["keyword", "searchterm", "query", "position", "volume", "searchvolume", "rankingurl", "intent"],
    altText: ["image", "imageurl", "source", "sourceurl", "alttext", "inlinks"]
  }[tool] || ["url", "keyword", "source", "destination", "image"];
  return candidates.reduce((score, candidate) => score + (joined.includes(normalize(candidate)) ? 1 : 0), 0);
}

function columnIndex(col) {
  return col.split("").reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
}

function decodeXml(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

async function parseUpload(file, tool = "", context = {}) {
  const ext = path.extname(file.filename).toLowerCase();
  if (ext === ".xlsx") return parseXlsx(file.buffer, tool, context);
  if (ext === ".xml") return parseSitemap(file.buffer.toString("utf8"));
  const rows = parseCsv(file.buffer.toString("utf8").replace(/^\uFEFF/, ""));
  rows._worksheetName = "CSV";
  return rows;
}

async function parseSitemapUpload(file) {
  const ext = path.extname(file.filename).toLowerCase();
  if (ext === ".xml") return parseSitemap(file.buffer.toString("utf8"));
  const rows = await parseUpload(file, "sitemap");
  return extractUrlsFromRows(rows);
}

function parseSitemap(xml) {
  return [...xml.matchAll(/<loc>\s*([\s\S]*?)\s*<\/loc>/gi)].map(match => decodeXml(match[1].trim()));
}

function extractUrlsFromRows(rows) {
  const urls = [];
  for (const row of rows) {
    if (typeof row === "string") {
      if (isHttpUrl(row)) urls.push(row.trim());
      continue;
    }
    const preferred = value(row, ["URL", "Loc", "Location", "Address", "Sitemap URL", "Destination", "Page"]);
    if (isHttpUrl(preferred)) {
      urls.push(preferred.trim());
      continue;
    }
    for (const cell of Object.values(row || {})) {
      const found = String(cell || "").match(/https?:\/\/[^\s"'<>]+/i)?.[0];
      if (found) {
        urls.push(found.trim());
        break;
      }
    }
  }
  return [...new Set(urls)];
}

function isHttpUrl(input) {
  return /^https?:\/\/[^\s"'<>]+$/i.test(String(input || "").trim());
}

function cleanHeader(header) {
  return String(header || "")
    .replace(/^\uFEFF/, "")
    .trim()
    .replace(/\s+/g, " ");
}

function value(row, candidates) {
  const keys = Object.keys(row || {});
  for (const candidate of candidates) {
    const exact = keys.find(k => normalize(k) === normalize(candidate));
    if (exact && row[exact]) return row[exact];
  }
  for (const candidate of candidates) {
    const fuzzy = keys.find(k => normalize(k).includes(normalize(candidate)) || normalize(candidate).includes(normalize(k)));
    if (fuzzy && row[fuzzy]) return row[fuzzy];
  }
  return "";
}

function normalize(text) {
  return String(text || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function normalizeUrl(input) {
  try {
    const parsed = new URL(input, "https://placeholder.local");
    return `${parsed.pathname.replace(/\/+$/, "") || "/"} ${parsed.search}`.trim().toLowerCase();
  } catch {
    return String(input || "").toLowerCase();
  }
}

function urlOrigin(input) {
  try {
    return new URL(input).origin;
  } catch {
    return "";
  }
}

function urlPath(input) {
  try {
    return new URL(input, "https://placeholder.local").pathname || "/";
  } catch {
    return String(input || "").split(/[?#]/)[0] || "/";
  }
}

function canonicalPath(input) {
  let pathname = urlPath(input).toLowerCase();
  pathname = pathname.replace(/\/index\.(html?|php|aspx?)$/i, "/");
  pathname = pathname.replace(/\.(html?|php|aspx?)$/i, "");
  pathname = pathname.replace(/\/(page|paged)\/\d+\/?$/i, "/");
  pathname = pathname.replace(/\/p\/\d+\/?$/i, "/");
  pathname = pathname.replace(/\/\d+\/?$/i, "/");
  pathname = pathname.replace(/\/+/g, "/").replace(/\/$/, "");
  return pathname || "/";
}

function canonicalUrl(input) {
  const origin = urlOrigin(input);
  const pathname = canonicalPath(input);
  return origin ? `${origin}${pathname === "/" ? "/" : pathname}/` : pathname;
}

function redirectCandidates(url) {
  const origin = urlOrigin(url);
  const pathOnly = canonicalPath(url);
  const parts = pathOnly.split("/").filter(Boolean);
  const candidates = new Set();
  const add = pathValue => {
    const normalized = (pathValue || "/").replace(/\/+/g, "/").replace(/\/$/, "") || "/";
    candidates.add(origin ? `${origin}${normalized === "/" ? "/" : normalized}/` : normalized);
  };
  add(pathOnly);
  if (/\/(page|paged)\/\d+\/?$/i.test(urlPath(url))) add(urlPath(url).replace(/\/(page|paged)\/\d+\/?$/i, "/"));
  if (parts.length > 1) add(`/${parts.slice(0, -1).join("/")}`);
  if (parts.length > 2) add(`/${parts.slice(0, -2).join("/")}`);
  return [...candidates];
}

function hasStructuralCleanup(input) {
  const pathname = urlPath(input);
  return /\/(page|paged)\/\d+\/?$/i.test(pathname) ||
    /\/p\/\d+\/?$/i.test(pathname) ||
    /\/index\.(html?|php|aspx?)$/i.test(pathname) ||
    /\.(html?|php|aspx?)$/i.test(pathname);
}

function tokens(input) {
  return canonicalPath(input)
    .replace(/\.[a-z0-9]{2,5}$/i, "")
    .split(/[^a-z0-9]+/i)
    .map(t => t.replace(/ies$/, "y").replace(/s$/, ""))
    .filter(t => t.length > 1 && !stopWords().has(t));
}

function stopWords() {
  return new Set([
    "www", "html", "php", "asp", "aspx", "page", "paged", "tag", "category", "blog", "post",
    "product", "products", "collection", "collections", "shop", "store", "news", "article",
    "articles", "the", "and", "for", "with", "from", "this", "that", "your", "our", "you"
  ]);
}

function uniqueTokens(input) {
  return [...new Set(tokens(input))];
}

function weightedTokenScore(source, candidate) {
  const sourceTokens = uniqueTokens(source);
  const candidateTokens = uniqueTokens(candidate);
  if (!sourceTokens.length || !candidateTokens.length) return 0;
  const sourceLast = sourceTokens[sourceTokens.length - 1];
  let score = 0;
  let possible = 0;
  sourceTokens.forEach((token, index) => {
    const weight = token === sourceLast ? 2.2 : index >= sourceTokens.length - 2 ? 1.5 : 1;
    possible += weight;
    if (candidateTokens.includes(token)) score += weight;
    else if (candidateTokens.some(candidateToken => candidateToken.includes(token) || token.includes(candidateToken))) score += weight * 0.55;
  });
  return score / possible;
}

function pageIntent(url) {
  const pathName = canonicalPath(url);
  if (/\/(product|products|shop)\//i.test(pathName)) return "product";
  if (/\/(collection|collections|category|categories|brands|brand)\//i.test(pathName)) return "collection";
  if (/\/(blog|blogs|news|article|articles|resources?)\//i.test(pathName)) return "blog";
  return "page";
}

function intentBonus(source, candidate) {
  const sourceIntent = pageIntent(source);
  const candidateIntent = pageIntent(candidate);
  if (sourceIntent === "blog" && candidateIntent === "product") return 0.18;
  if (sourceIntent === "blog" && candidateIntent === "collection") return 0.1;
  if (sourceIntent === candidateIntent) return 0.08;
  return 0;
}

function mainBlogPage(sitemap, homepage) {
  const candidates = sitemap.filter(url => /\/(blog|blogs|news|articles|resources?)\/?$/i.test(canonicalPath(url)));
  return candidates[0] || "";
}

function isUnsafeRedirectSource(input) {
  const raw = String(input || "").trim();
  const pathname = urlPath(raw).toLowerCase();
  if (!raw || raw === "/*" || pathname === "/*") return true;
  const unsafe = [
    /^\/wp-content(\/|$)/,
    /^\/wp-admin(\/|$)/,
    /^\/wp-includes(\/|$)/,
    /^\/wp-[^/]+\.php$/,
    /^\/xmlrpc\.php$/,
    /^\/wp-content\/plugins\/revslider\/public\/assets\/js\/?/,
    /^\/.*\/plugins?\//,
    /^\/.*\/themes?\//,
    /^\/.*\/uploads?\//,
    /^\/.*\.(css|js|map|json|xml|txt|ico|png|jpe?g|gif|webp|svg|woff2?|ttf|eot|otf|pdf|zip)$/i
  ];
  return unsafe.some(pattern => pattern.test(pathname));
}

function scoreUrl(source, candidate) {
  const a = tokens(source);
  const b = tokens(candidate);
  if (!a.length || !b.length) return 0;
  if (canonicalPath(source) === canonicalPath(candidate)) return 1;
  if (hasStructuralCleanup(source) && redirectCandidates(source).some(item => canonicalPath(item) === canonicalPath(candidate))) return 0.98;
  if (canonicalPath(source).startsWith(canonicalPath(candidate) + "/")) return 0.86;
  const overlap = a.filter(token => b.includes(token)).length;
  const ordered = b.filter(token => a.includes(token)).join(" ") === a.filter(token => b.includes(token)).join(" ") ? 0.08 : 0;
  const lastMatch = a[a.length - 1] && b.includes(a[a.length - 1]) ? 0.18 : 0;
  const parentBonus = a.slice(0, b.length).join("/") === b.join("/") ? 0.2 : 0;
  return Math.min(1, weightedTokenScore(source, candidate) * 0.72 + lastMatch + ordered + parentBonus + intentBonus(source, candidate));
}

function bestMatch(url, sitemap, homepage) {
  let best = { url: homepage || sitemap[0] || "", score: 0 };
  const exactCandidates = hasStructuralCleanup(url) ? redirectCandidates(url).map(canonicalPath) : [canonicalPath(url)];
  for (const candidate of sitemap) {
    if (exactCandidates.includes(canonicalPath(candidate))) {
      return { url: candidate, score: 0.98 };
    }
    const score = scoreUrl(url, candidate);
    if (score > best.score) best = { url: candidate, score };
  }
  if (best.score >= 0.18) return best;
  if (pageIntent(url) === "blog") {
    const blogPage = mainBlogPage(sitemap, homepage);
    if (blogPage) return { url: blogPage, score: 0.16 };
  }
  return { url: homepage || sitemap[0] || "", score: best.score };
}

function confidence(score) {
  if (score >= 0.62) return "High";
  if (score >= 0.32) return "Medium";
  return "Low";
}

function runBrokenLinks(rows, sitemap, client) {
  const decisions = new Map();
  return rows.map(row => {
    const source = value(row, ["Source", "Source URL", "From", "Address"]) || firstCell(row, 0);
    const destination = value(row, ["Destination", "Destination URL", "To", "Link URL"]) || firstCell(row, 1);
    const anchor = value(row, ["Anchor", "Anchor Text"]) || firstCell(row, 2);
    const key = normalizeUrl(destination);
    const decision = decisions.get(key) || brokenLinkDecision(destination, anchor, source, sitemap, client);
    decisions.set(key, decision);
    return {
      "Source URL": source,
      Destination: destination,
      Anchor: anchor,
      "Remove/Replace": decision.action,
      "Replacement URL": decision.replacement,
      Status: "Pending",
      Notes: decision.notes,
      Confidence: decision.confidence,
      Reason: decision.reason
    };
  });
}

function firstCell(row, index) {
  return String(Object.values(row || {})[index] || "").trim();
}

function brokenLinkDecision(destination, anchor, source, sitemap, client) {
  if (isFileOrImageUrl(destination)) {
    return {
      action: "Check Source Page for Broken Images",
      replacement: "",
      notes: "Check Source Page for Broken Images",
      confidence: "Review",
      reason: "Broken destination is an image or file URL; do not guess a redirect."
    };
  }
  const internal = isInternalUrl(destination, client, sitemap);
  const match = internal ? bestMatch(destination, sitemap, client.homepageUrl) : bestExternalReplacement(destination, anchor, source, sitemap, client);
  const generic = isGenericReplacement(match.url, client.homepageUrl);
  const weak = match.score < (internal ? 0.22 : 0.42);
  const action = weak || generic ? "Remove" : "Replace";
  return {
    action,
    replacement: action === "Replace" ? match.url : "",
    notes: "",
    confidence: confidence(match.score),
    reason: action === "Replace"
      ? `${internal ? "Internal" : "External"} broken link matched to a relevant replacement (${Math.round(match.score * 100)}%).`
      : `${internal ? "Internal" : "External"} broken link has no close non-generic replacement; remove rather than forcing a weak match.`
  };
}

function bestExternalReplacement(destination, anchor, source, sitemap, client) {
  const query = `${destination} ${anchor} ${source}`;
  const match = bestMatch(query, sitemap, client.homepageUrl);
  return match.score >= 0.42 ? match : { url: "", score: match.score };
}

function isInternalUrl(input, client, sitemap) {
  const origin = urlOrigin(input);
  const clientOrigin = urlOrigin(client.homepageUrl || client.domain || "");
  if (origin && clientOrigin && origin === clientOrigin) return true;
  return sitemap.some(url => urlOrigin(url) && origin && urlOrigin(url) === origin);
}

function isGenericReplacement(url, homepage) {
  if (!url) return true;
  if (isHomepage(url, homepage)) return true;
  const parts = canonicalPath(url).split("/").filter(Boolean);
  return parts.length <= 1 && /^(category|categories|collection|collections|products|shop|blog|brands|services)$/i.test(parts[0] || "");
}

function isFileOrImageUrl(input) {
  return /\.(jpe?g|png|gif|webp|svg|pdf|docx?|xlsx?|pptx?|zip)([?#]|$)/i.test(String(input || ""));
}

function formatBrokenLinkRowsForExport(rows) {
  return rows.map(row => ({
    "Source URL": row["Source URL"],
    Destination: row.Destination,
    Anchor: row.Anchor,
    "Remove/Replace": row["Remove/Replace"],
    "Replacement URL": row["Replacement URL"],
    Status: row.Status,
    Notes: row.Notes
  }));
}

function isHomepage(url, homepage) {
  if (!url || !homepage) return false;
  try {
    const a = new URL(url);
    const b = new URL(homepage);
    return a.origin === b.origin && (a.pathname === "/" || a.pathname === "") && (b.pathname === "/" || b.pathname === "");
  } catch {
    return normalizeUrl(url) === normalizeUrl(homepage);
  }
}

function runRedirects(rows, sitemap, client) {
  return rows.map(row => {
    const source = value(row, ["URL", "Source URL", "Address", "Page", "404 URL"]);
    if (isUnsafeRedirectSource(source)) {
      return {
        "Source URL": source,
        "Redirect URL": "",
        Status: "Excluded",
        Confidence: "Excluded",
        Reason: "Unsafe wildcard, WordPress infrastructure, asset, plugin, theme, upload, or core PHP path. Excluded from redirect export."
      };
    }
    const match = bestMatch(source, sitemap, client.homepageUrl);
    return {
      "Source URL": source,
      "Redirect URL": match.url,
      Status: "Pending",
      Confidence: confidence(match.score),
      Reason: match.score >= 0.18
        ? `Closest sitemap URL by slug similarity (${Math.round(match.score * 100)}%).`
        : "No close sitemap match found; homepage fallback used."
    };
  });
}

function formatRedirectRowsForPlatform(rows, platform = "other") {
  const cleanRows = rows.filter(row => row.Status !== "Excluded");
  if (platform === "wordpress") {
    return cleanRows.map(row => ({
      "source URL": row["Source URL"],
      "target URL": row["Redirect URL"],
      regex: "0",
      "http code": "301"
    }));
  }
  if (platform === "shopify") {
    return cleanRows.map(row => ({
      "Redirect from": pathForPlatform(row["Source URL"]),
      "Redirect to": pathForPlatform(row["Redirect URL"])
    }));
  }
  return cleanRows.map(row => ({
    "Source URL": row["Source URL"],
    "Target URL": row["Redirect URL"]
  }));
}

function pathForPlatform(input) {
  try {
    const parsed = new URL(input);
    return `${parsed.pathname}${parsed.search}` || "/";
  } catch {
    return input || "";
  }
}

function runKeywordResearch(rows, _sitemap, client, workflow = "initial", templateRows = []) {
  return workflow === "additional"
    ? runAdditionalKeywordResearch(rows, templateRows, client)
    : runInitialKeywordResearch(rows, templateRows, client);
}

function runInitialKeywordResearch(rows, templateRows, client) {
  const expansionPages = preferredPagesFromTemplate(templateRows);
  return rows
    .map(row => {
      const keyword = value(row, ["Keyword", "Search Term", "Query"]);
      const position = parseNumber(value(row, ["Position", "Pos.", "Organic Position", "Ranking", "Client Position"]));
      const volume = parseNumber(value(row, ["Volume", "Search Volume", "Avg. Search Volume", "Search Volume (Avg)"]));
      const kd = parseNumber(value(row, ["KD", "Keyword Difficulty", "Competition", "Comp."]));
      const rankingUrl = value(row, ["URL", "Ranking URL", "Landing Page", "Current URL"]);
      const intent = value(row, ["Intent", "Search Intent"]);
      const type = classifyKeyword(keyword, intent);
      const category = categoryFromKeyword(keyword, client.specialty);
      const preferredPage = rankingUrl || bestPreferredPage(keyword, expansionPages) || suggestPage(keyword, client.domain, client.homepageUrl);
      const opportunity = keywordOpportunityScore(keyword, volume, position, kd, client);
      return {
        Keyword: keyword,
        Type: type,
        Category: category,
        "Google Search Ranking": Number.isFinite(position) ? position : "",
        "Average Search Volume": volume || "",
        "Ranking URL": rankingUrl,
        "Preferred Page": preferredPage,
        Intent: intent,
        KD: Number.isFinite(kd) ? kd : "",
        Priority: priorityFromScore(opportunity),
        Confidence: keyword ? "Medium" : "Low",
        Reason: keyword ? "Prioritized by business relevance, volume, ranking opportunity, and page fit." : "Missing keyword.",
        _opportunity: opportunity
      };
    })
    .filter(row => row.Keyword && !isLikelyIrrelevantKeyword(row.Keyword, client))
    .sort((a, b) => b._opportunity - a._opportunity)
    .slice(0, 400)
    .map(({ _opportunity, ...row }) => row);
}

function runAdditionalKeywordResearch(rows, templateRows, client) {
  const expansion = expansionKeywordMap(templateRows);
  return rows.map(row => {
    const keyword = value(row, ["Top queries", "Query", "Queries", "Keyword", "Search Term"]);
    const clicks = parseNumber(value(row, ["Clicks"]));
    const impressions = parseNumber(value(row, ["Impressions"]));
    const ctr = value(row, ["CTR", "Click Through Rate"]);
    const position = parseNumber(value(row, ["Position", "Average Position", "Avg. Position"]));
    const page = value(row, ["Page", "URL", "Landing Page"]);
    const existing = expansion.get(normalizeKeyword(keyword));
    const category = existing?.category || categoryFromKeyword(keyword, client.specialty);
    const preferredPage = existing?.preferredPage || page || suggestPage(keyword, client.domain, client.homepageUrl);
    const issue = keywordIssue(clicks, impressions, ctr, position, Boolean(existing));
    const sheet = existing
      ? issue === "Strong current performer" ? "Improved Keywords" : "Expansion Needs Improvement"
      : "New Keywords to Add";
    return {
      Sheet: sheet,
      "Keyword/Query": keyword,
      "Current Expansion Status": existing ? "Already in Keyword Expansion" : "Not in Keyword Expansion",
      Clicks: Number.isFinite(clicks) ? clicks : "",
      Impressions: Number.isFinite(impressions) ? impressions : "",
      CTR: ctr,
      "Average Position": Number.isFinite(position) ? position : "",
      "Ranking Page / GSC Page": page,
      "Matching Keyword Expansion Page": existing?.preferredPage || "",
      "Recommended Preferred Page": preferredPage,
      Category: category,
      "Issue / Opportunity": issue,
      Priority: keywordPriority(clicks, impressions, position, Boolean(existing)),
      "Recommended Action": recommendedKeywordAction(issue, Boolean(existing)),
      Confidence: keyword ? "Medium" : "Low",
      Reason: existing ? "Compared against uploaded Keyword Expansion rows." : "GSC query not found in uploaded Keyword Expansion rows."
    };
  }).filter(row => row["Keyword/Query"] && !isLikelyIrrelevantKeyword(row["Keyword/Query"], client));
}

function formatKeywordRowsForExport(rows, workflow = "initial") {
  if (workflow === "additional") return rows.map(({ Sheet, Confidence, Reason, ...row }) => row);
  return rows.map(row => ({
    Keyword: row.Keyword,
    Type: row.Type,
    "Google Search Ranking": row["Google Search Ranking"],
    "Average Search Volume": row["Average Search Volume"],
    Category: row.Category,
    "Ranking URL": row["Ranking URL"],
    "Preferred Page": row["Preferred Page"],
    Intent: row.Intent,
    KD: row.KD,
    Priority: row.Priority
  }));
}

function keywordAdditionalSheets(rows) {
  const columns = ["Keyword/Query", "Current Expansion Status", "Clicks", "Impressions", "CTR", "Average Position", "Ranking Page / GSC Page", "Matching Keyword Expansion Page", "Recommended Preferred Page", "Category", "Issue / Opportunity", "Priority", "Recommended Action"];
  return ["Expansion Needs Improvement", "New Keywords to Add", "Improved Keywords"].map(name => ({
    name,
    columns,
    rows: rows.filter(row => row.Sheet === name).map(row => {
      const record = {};
      columns.forEach(column => record[column] = row[column] || "");
      return record;
    })
  }));
}

function categoryFromKeyword(keyword, specialty) {
  const words = tokens(keyword).filter(word => !["near", "best", "service", "services", "company", "companies"].includes(word));
  if (words.length >= 2) return titleCase(words.slice(0, 2).join(" "));
  return specialty ? titleCase(specialty) : "General";
}

function parseNumber(value) {
  const cleaned = String(value || "").replace(/[%,$,\s]/g, "");
  const number = Number(cleaned);
  return Number.isFinite(number) ? number : NaN;
}

function classifyKeyword(keyword, intent = "") {
  return /^(how|what|why|when|where|can|does|do|is|are)\b/i.test(keyword) ||
    String(keyword || "").split(/\s+/).filter(Boolean).length >= 5 ||
    /informational|question/i.test(intent)
    ? "Secondary"
    : "Primary";
}

function keywordOpportunityScore(keyword, volume, position, kd, client) {
  const relevance = isLikelyIrrelevantKeyword(keyword, client) ? 0.1 : 1;
  const volumeScore = Math.log10((Number.isFinite(volume) ? volume : 0) + 10);
  const positionScore = Number.isFinite(position) ? Math.max(0.2, 1 / Math.max(position, 1) * 12) : 0.7;
  const difficultyPenalty = Number.isFinite(kd) ? Math.max(0.35, 1 - kd / 140) : 0.8;
  return relevance * volumeScore * positionScore * difficultyPenalty;
}

function priorityFromScore(score) {
  if (score >= 2.6) return "High";
  if (score >= 1.2) return "Medium";
  return "Low";
}

function normalizeKeyword(keyword) {
  return String(keyword || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function isLikelyIrrelevantKeyword(keyword, client) {
  const text = normalizeKeyword(keyword);
  if (!text) return true;
  if (/\b(free|jobs?|salary|definition|meaning|template|pdf download)\b/.test(text)) return false;
  const competitorish = /\b(amazon|walmart|lowes|home depot|facebook|youtube|reddit)\b/.test(text);
  const clientName = normalizeKeyword(client.name);
  return competitorish && clientName && !text.includes(clientName);
}

function expansionKeywordMap(rows) {
  const map = new Map();
  for (const row of rows) {
    const keyword = value(row, ["Keyword", "Primary Keyword", "Secondary Keyword", "Query", "Search Term"]);
    if (!keyword) continue;
    map.set(normalizeKeyword(keyword), {
      keyword,
      preferredPage: value(row, ["Preferred Page", "Preferred URL", "Target Page", "URL", "Ranking URL"]),
      category: value(row, ["Category", "Topic", "Keyword Category"])
    });
  }
  return map;
}

function preferredPagesFromTemplate(rows) {
  return [...new Set(rows.map(row => value(row, ["Preferred Page", "Preferred URL", "Target Page", "URL", "Ranking URL"])).filter(Boolean))];
}

function bestPreferredPage(keyword, pages) {
  if (!pages.length) return "";
  let best = { page: "", score: 0 };
  for (const page of pages) {
    const score = weightedTokenScore(keyword, page);
    if (score > best.score) best = { page, score };
  }
  return best.score > 0.2 ? best.page : "";
}

function keywordIssue(clicks, impressions, ctr, position, exists) {
  const ctrNumber = parseNumber(ctr);
  if (exists && Number.isFinite(position) && position <= 10 && (clicks || 0) > 0) return "Strong current performer";
  if ((impressions || 0) >= 100 && (clicks || 0) <= 3) return "High impressions with limited clicks";
  if (Number.isFinite(position) && position > 10 && position <= 30) return "Ranking opportunity on page two or three";
  if (Number.isFinite(ctrNumber) && ctrNumber < 1 && (impressions || 0) >= 50) return "Low CTR opportunity";
  return exists ? "Monitor and optimize where relevant" : "Relevant query candidate";
}

function keywordPriority(clicks, impressions, position, exists) {
  if ((impressions || 0) >= 250 && (!Number.isFinite(position) || position <= 30)) return "High";
  if ((impressions || 0) >= 50 || (clicks || 0) >= 5 || exists) return "Medium";
  return "Low";
}

function recommendedKeywordAction(issue, exists) {
  if (issue === "Strong current performer") return "Keep and consider reinforcing content/internal links.";
  if (exists) return "Optimize current mapped page for query intent and CTR.";
  return "Review for addition to Keyword Expansion and map to the best-fit page.";
}

function suggestPage(keyword, domain, homepage) {
  if (!domain && homepage) return homepage;
  const slug = tokens(keyword).slice(0, 5).join("-");
  const base = homepage || (domain ? `https://${domain.replace(/^https?:\/\//, "").replace(/\/.*$/, "")}` : "");
  return base ? `${base.replace(/\/$/, "")}/${slug}/` : "";
}

function runAltText(rows, _sitemap, client) {
  const map = new Map();
  for (const row of rows) {
    const image = value(row, ["Image", "Image URL", "Destination", "Destination URL", "Address"]);
    const source = value(row, ["Source", "Source URL", "From", "Inlinks", "Page URL"]);
    if (!image) continue;
    const key = image.trim();
    const existing = map.get(key) || { image: key, sources: new Set() };
    if (source) existing.sources.add(source);
    map.set(key, existing);
  }
  return [...map.values()].map(item => {
    const sources = [...item.sources];
    const primarySource = sources[0] || "";
    const meta = imageMeta(item.image, primarySource, client);
    const alt = makeAltText(item.image, primarySource, client);
    return {
      "Image URL": item.image,
      Preview: item.image,
      Filename: meta.filename,
      "Asset Type": meta.assetType,
      "Source Context": meta.sourceContext,
      "Page Category": meta.pageCategory,
      "Brand Terms": meta.brandTerms,
      "Duplicate Count": sources.length,
      "Alt Text": alt,
      "Source URLs": sources.join(" | "),
      Status: "Needs Review",
      Reviewed: "",
      Confidence: meta.assetType === "Logo" || meta.assetType === "Icon" ? "Medium" : "Low",
      Reason: meta.reason
    };
  });
}

function formatAltTextRowsForExport(rows) {
  return rows.filter(row => isReviewed(row)).map(row => ({
    "Image URL": row["Image URL"],
    "Alt Text": row["Alt Text"],
    "Source URLs": row["Source URLs"],
    Status: row.Status,
    Confidence: row.Confidence,
    Reason: row.Reason
  }));
}

function isReviewed(row) {
  return /^yes|true|reviewed|approved|done$/i.test(String(row.Reviewed || "").trim()) ||
    /^reviewed|approved|done$/i.test(String(row.Status || "").trim());
}

function makeAltText(imageUrl, sourceUrl, client) {
  const meta = imageMeta(imageUrl, sourceUrl, client);
  const filename = meta.usableFilename ? meta.filename : "";
  const sourceTokens = tokens(sourceUrl).slice(-3).join(" ");
  const specialty = client.specialty || client.name || "";
  const base = filename || sourceTokens || specialty || "website image";
  const isLogo = /\blogo\b/i.test(`${filename} ${imageUrl}`);
  const isIcon = /\b(icon|svg|sprite)\b/i.test(`${filename} ${imageUrl}`);
  if (isLogo) return cleanAlt(`${client.name || specialty} logo`);
  if (isIcon) return cleanAlt(`${titleCase(base)} icon`);
  return cleanAlt(`${titleCase(base)}${specialty && !base.toLowerCase().includes(specialty.toLowerCase()) ? ` for ${specialty}` : ""}`);
}

function imageFileName(imageUrl) {
  return decodeURIComponent((String(imageUrl || "").split(/[?#]/)[0].split("/").pop() || "image"))
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\d{2,}\b/g, "")
    .trim();
}

function sourceContext(sourceUrl) {
  const parts = canonicalPath(sourceUrl).split("/").filter(Boolean);
  return titleCase(parts.slice(-3).join(" "));
}

function imageMeta(imageUrl, sourceUrl, client) {
  const filename = imageFileName(imageUrl);
  const assetType = assetTypeForImage(imageUrl, filename);
  const usableFilename = !isUselessFilename(filename);
  const category = pageCategory(sourceUrl);
  const brandTerms = [client.name, client.specialty].filter(Boolean).join(" | ");
  const reasonParts = [];
  if (!usableFilename) reasonParts.push("Filename is generic or unhelpful.");
  if (assetType !== "Image") reasonParts.push(`Likely ${assetType.toLowerCase()} asset.`);
  if (category) reasonParts.push(`Source page context: ${category}.`);
  if (brandTerms) reasonParts.push(`Client terms available: ${brandTerms}.`);
  reasonParts.push("Review image preview before implementation.");
  return {
    filename,
    usableFilename,
    assetType,
    sourceContext: sourceContext(sourceUrl),
    pageCategory: category,
    brandTerms,
    reason: reasonParts.join(" ")
  };
}

function isUselessFilename(filename) {
  const normalized = normalize(filename);
  return !normalized ||
    /^(image|img|photo|pic|picture|screenshot|screen|hero|banner|header|thumbnail|thumb|logo|icon|untitled|copy|final|new|old)\d*$/i.test(normalized) ||
    /^[a-f0-9]{8,}$/i.test(normalized);
}

function assetTypeForImage(imageUrl, filename) {
  const haystack = `${filename} ${imageUrl}`.toLowerCase();
  if (/\blogo\b/.test(haystack)) return "Logo";
  if (/\b(icon|sprite|favicon)\b/.test(haystack) || /\.svg([?#]|$)/i.test(imageUrl)) return "Icon";
  if (/\b(hero|banner|header)\b/.test(haystack)) return "Banner";
  if (/\b(product|sku|item)\b/.test(haystack)) return "Product";
  return "Image";
}

function pageCategory(sourceUrl) {
  const parts = canonicalPath(sourceUrl).split("/").filter(Boolean);
  const known = ["products", "product", "collections", "collection", "brands", "brand", "blog", "blogs", "services", "service", "category", "categories"];
  const index = parts.findIndex(part => known.includes(part));
  if (index >= 0) return titleCase(parts.slice(index, index + 2).join(" "));
  return titleCase(parts.slice(0, 2).join(" "));
}

function cleanAlt(text) {
  return text.replace(/[^\x20-\x7E]/g, "").replace(/\s+/g, " ").trim().slice(0, 140);
}

function titleCase(text) {
  return String(text || "")
    .split(/\s+/)
    .filter(Boolean)
    .map(word => word[0]?.toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

function validate(tool, rows, sitemap, context = {}) {
  const sample = rows[0] || {};
  const headers = Object.keys(sample);
  const issues = [];
  const worksheet = rows._worksheetName ? ` Parsed worksheet: ${rows._worksheetName}.` : "";
  const needsSitemap = tool === "brokenLinks" || tool === "redirects404";
  if (!rows.length) issues.push("No spreadsheet rows were parsed.");
  if (needsSitemap && !sitemap.length) issues.push("No sitemap URLs were parsed.");
  if (tool === "redirects404" && !headers.some(h => /url|address|page|submitted/i.test(h))) issues.push("Could not identify a 404 URL column.");
  if (tool === "brokenLinks" && !headers.some(h => /destination|link|url|address/i.test(h))) issues.push("Could not identify a broken destination URL column.");
  if (tool === "altText" && !headers.some(h => /image|destination|address/i.test(h))) issues.push("Could not identify an image URL column.");
  if (tool === "keywordResearch") {
    const hasKeywordColumn = headers.some(h => /keyword|query|queries|search|top queries/i.test(h));
    const hasGscMetrics = headers.some(h => /^clicks$/i.test(h)) && headers.some(h => /^impressions$/i.test(h));
    if (context.workflow === "additional" && (!hasKeywordColumn || !hasGscMetrics)) {
      issues.push(`Could not identify a GSC Queries worksheet with query, clicks, and impressions columns.${worksheet}`);
    } else if (context.workflow !== "additional" && !hasKeywordColumn) {
      issues.push(`Could not identify a keyword/query column.${worksheet}`);
    }
  }
  return { headers, issues };
}

async function handleRun(req, res) {
  try {
    const body = await collectBody(req);
    const { fields, files } = parseMultipart(body, req.headers["content-type"]);
    const tool = fields.tool;
    if (!toolConfigs[tool]) return sendJson(res, 400, { error: "Unknown tool." });
    const client = {
      name: fields.clientName || "",
      domain: fields.clientDomain || "",
      specialty: fields.clientSpecialty || "",
      homepageUrl: fields.homepageUrl || "",
      cmsPlatform: fields.cmsPlatform || "other"
    };
    const sheetFile = files.find(file => !/sitemap|template/i.test(file.field) && !/\.xml$/i.test(file.filename));
    const sitemapFile = files.find(file => /sitemap/i.test(file.field) || /\.xml$/i.test(file.filename));
    const templateFile = files.find(file => /template/i.test(file.field));
    if (!sheetFile) return sendJson(res, 400, { error: "Upload a CSV or XLSX export first." });
    const keywordWorkflow = fields.keywordWorkflow || "initial";
    const rows = await parseUpload(sheetFile, tool, tool === "keywordResearch" ? { workflow: keywordWorkflow } : {});
    const sitemap = sitemapFile ? await parseSitemapUpload(sitemapFile) : [];
    const templateRows = templateFile ? await parseUpload(templateFile, "keywordResearch", { source: "template", workflow: keywordWorkflow }) : [];
    const validation = validate(tool, rows, sitemap, tool === "keywordResearch" ? { workflow: keywordWorkflow } : {});
    if (validation.issues.length) return sendJson(res, 422, { error: "Input validation failed.", validation });
    const results =
      tool === "brokenLinks" ? runBrokenLinks(rows, sitemap, client) :
      tool === "redirects404" ? runRedirects(rows, sitemap, client) :
      tool === "keywordResearch" ? runKeywordResearch(rows, sitemap, client, keywordWorkflow, templateRows) :
      runAltText(rows, sitemap, client);
    const exportRows =
      tool === "redirects404" ? formatRedirectRowsForPlatform(results, client.cmsPlatform) :
      tool === "brokenLinks" ? formatBrokenLinkRowsForExport(results) :
      tool === "keywordResearch" ? formatKeywordRowsForExport(results, keywordWorkflow) :
      tool === "altText" ? formatAltTextRowsForExport(results) :
      results;
    const exportSheets = tool === "keywordResearch" && keywordWorkflow === "additional"
      ? keywordAdditionalSheets(results)
      : null;
    sendJson(res, 200, {
      tool,
      config: toolConfigs[tool],
      client,
      validation,
      results,
      exportRows,
      exportColumns: Object.keys(exportRows[0] || {}),
      exportSheets,
      exportFormat: tool === "keywordResearch" ? "xls" : undefined,
      generatedAt: new Date().toISOString()
    });
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Unexpected server error." });
  }
}

async function handleClientSave(req, res) {
  try {
    const body = await collectBody(req);
    const { fields, files } = parseMultipart(body, req.headers["content-type"]);
    const clients = readClients();
    const id = fields.clientId || `client-${Date.now()}`;
    const existing = clients.find(client => client.id === id);
    const logoFile = files.find(file => file.field === "logoFile" && file.filename);
    const supportFiles = files.filter(file => file.field === "supportFiles" && file.filename);
    let logo = existing?.logo || null;
    if (logoFile) {
      const filename = safeFileName(logoFile.filename);
      fs.writeFileSync(path.join(CLIENT_ASSET_DIR, filename), logoFile.buffer);
      logo = { name: logoFile.filename, filename, url: assetUrl(filename) };
    }
    const newAssets = supportFiles.map(file => {
      const filename = safeFileName(file.filename);
      fs.writeFileSync(path.join(CLIENT_ASSET_DIR, filename), file.buffer);
      return { name: file.filename, filename, url: assetUrl(filename), uploadedAt: new Date().toISOString() };
    });
    const client = {
      id,
      name: fields.name || "",
      pod: fields.pod || existing?.pod || "",
      domain: fields.domain || "",
      specialty: fields.specialty || "",
      cmsPlatform: fields.cmsPlatform || "other",
      homepageUrl: fields.homepageUrl || "",
      websiteUrl: fields.websiteUrl || fields.homepageUrl || "",
      campaignStrategyUrl: fields.campaignStrategyUrl || "",
      driveFolderUrl: fields.driveFolderUrl || "",
      notes: fields.notes || "",
      primaryColor: fields.primaryColor || "",
      secondaryColor: fields.secondaryColor || "",
      logo,
      assets: [...(existing?.assets || []), ...newAssets],
      updatedAt: new Date().toISOString(),
      createdAt: existing?.createdAt || new Date().toISOString()
    };
    const next = existing ? clients.map(item => item.id === id ? client : item) : [client, ...clients];
    writeClients(next);
    sendJson(res, 200, client);
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Could not save client." });
  }
}

async function handleExport(req, res) {
  try {
    const body = await collectBody(req);
    const payload = JSON.parse(body.toString("utf8") || "{}");
    const rows = Array.isArray(payload.rows) ? payload.rows : [];
    const columns = Array.isArray(payload.columns) && payload.columns.length ? payload.columns : Object.keys(rows[0] || {});
    const format = payload.format === "xls" ? "xls" : "csv";
    const fallbackName = `seo-export-${new Date().toISOString().slice(0, 10)}.${format}`;
    const filename = safeDownloadName(payload.filename || fallbackName, format);
    const sheets = Array.isArray(payload.sheets) ? payload.sheets : null;
    const content = format === "xls" && sheets ? excelMultiSheetHtml(sheets) : format === "xls" ? excelWorkbookHtml(columns, rows) : toCsv(columns, rows);
    ensureDataDirs();
    fs.writeFileSync(path.join(EXPORT_DIR, filename), content, "utf8");
    sendJson(res, 200, {
      filename,
      url: `/exports/${encodeURIComponent(filename)}`,
      content,
      contentType: format === "xls" ? "application/vnd.ms-excel" : "text/csv"
    });
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Could not export CSV." });
  }
}

function safeDownloadName(filename, format) {
  const ext = `.${format}`;
  const cleaned = String(filename || `export${ext}`)
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\.(csv|xls|xlsx)$/i, "")
    .trim() || "export";
  return `${cleaned}${ext}`;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (req.method === "GET" && url.pathname.startsWith("/client-assets/")) return serveClientAsset(req, res);
  if (req.method === "GET" && url.pathname.startsWith("/exports/")) return serveExport(req, res);
  if (req.method === "GET" && url.pathname === "/api/config") return sendJson(res, 200, toolConfigs);
  if (req.method === "GET" && url.pathname === "/api/clients") return sendJson(res, 200, readClients());
  if (req.method === "POST" && url.pathname === "/api/clients") return handleClientSave(req, res);
  if (req.method === "POST" && url.pathname === "/api/export") return handleExport(req, res);
  if (req.method === "POST" && url.pathname === "/api/run") return handleRun(req, res);
  return serveStatic(req, res);
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`National Positions SEO Automation MVP running at http://localhost:${PORT}`);
  });
}

module.exports = {
  parseCsv,
  parseXlsx,
  parseSitemap,
  parseSitemapUpload,
  extractUrlsFromRows,
  runBrokenLinks,
  formatBrokenLinkRowsForExport,
  runRedirects,
  formatRedirectRowsForPlatform,
  runKeywordResearch,
  runAltText,
  formatAltTextRowsForExport,
  isReviewed,
  validate,
  bestMatch,
  toolConfigs
};
