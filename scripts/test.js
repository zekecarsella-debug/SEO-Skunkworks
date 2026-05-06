const assert = require("node:assert/strict");

const {
  parseCsv,
  parseXlsx,
  parseSitemap,
  extractUrlsFromRows,
  runBrokenLinks,
  formatBrokenLinkRowsForExport,
  runRedirects,
  formatRedirectRowsForPlatform,
  runKeywordResearch,
  runCanonicalFixes,
  formatCanonicalRowsForExport,
  runAltText,
  formatAltTextRowsForExport,
  isReviewed,
  aiCandidates,
  compactAiRow,
  applyAiPatches,
  signedToken,
  verifySignedToken,
  emailAllowed,
  validate,
  bestMatch,
  toolConfigs
} = require("../server");

const path = require("node:path");
const JSZip = require(path.join(
  process.env.NODE_REPL_NODE_MODULE_DIRS ||
    "C:\\Users\\Zeke\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\node\\node_modules",
  "jszip"
));

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

const client = {
  name: "National Positions",
  domain: "example.com",
  specialty: "industrial siding",
  homepageUrl: "https://example.com/"
};

const sitemap = [
  "https://example.com/",
  "https://example.com/products/cement-siding/",
  "https://example.com/blog/industrial-siding-maintenance/",
  "https://example.com/contact/"
];

test("CSV parser handles quoted cells and headers", () => {
  const rows = parseCsv('Source URL,Destination,Anchor\n"https://a.com/page","https://b.com/old,removed","Read more"\n');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].Destination, "https://b.com/old,removed");
});

test("sitemap parser extracts loc values", () => {
  const urls = parseSitemap("<urlset><url><loc>https://example.com/a/</loc></url><url><loc>https://example.com/b/</loc></url></urlset>");
  assert.deepEqual(urls, ["https://example.com/a/", "https://example.com/b/"]);
});

test("sitemap CSV/XLSX row extraction returns URL strings", () => {
  const urls = extractUrlsFromRows([
    { Loc: "https://example.com/brands/cornilleau/" },
    { Address: "https://example.com/products/pool-table/" },
    { Label: "not a url", Notes: "backup https://example.com/blog/" }
  ]);
  assert.deepEqual(urls, [
    "https://example.com/brands/cornilleau/",
    "https://example.com/products/pool-table/",
    "https://example.com/blog/"
  ]);
});

test("XLSX parser skips chart sheets and finds the table worksheet", async () => {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8"?>
    <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
      <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
      <Default Extension="xml" ContentType="application/xml"/>
      <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
      <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
      <Override PartName="/xl/chartsheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.chartsheet+xml"/>
    </Types>`);
  zip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8"?>
    <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
    </Relationships>`);
  zip.file("xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8"?>
    <workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
      <sheets>
        <sheet name="Chart" sheetId="1" r:id="rId1"/>
        <sheet name="Table" sheetId="2" r:id="rId2"/>
      </sheets>
    </workbook>`);
  zip.file("xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8"?>
    <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chartsheet" Target="chartsheets/sheet1.xml"/>
      <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
    </Relationships>`);
  zip.file("xl/chartsheets/sheet1.xml", `<chartsheet/>`);
  zip.file("xl/worksheets/sheet1.xml", `<?xml version="1.0" encoding="UTF-8"?>
    <worksheet>
      <sheetData>
        <row r="1"><c r="A1" t="inlineStr"><is><t>Chart title row</t></is></c></row>
        <row r="2">
          <c r="A2" t="inlineStr"><is><t>Submitted URL</t></is></c>
          <c r="B2" t="inlineStr"><is><t>Last crawled</t></is></c>
        </row>
        <row r="3">
          <c r="A3" t="inlineStr"><is><t>https://example.com/missing-page</t></is></c>
          <c r="B3" t="inlineStr"><is><t>2026-05-05</t></is></c>
        </row>
      </sheetData>
    </worksheet>`);
  const rows = await parseXlsx(await zip.generateAsync({ type: "nodebuffer" }), "redirects404");
  assert.equal(rows.length, 1);
  assert.equal(rows[0]["Submitted URL"], "https://example.com/missing-page");
});

test("additional keyword research XLSX parser prefers GSC Queries worksheet", async () => {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8"?>
    <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
      <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
      <Default Extension="xml" ContentType="application/xml"/>
      <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
      <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
      <Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
      <Override PartName="/xl/worksheets/sheet3.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
      <Override PartName="/xl/worksheets/sheet4.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
    </Types>`);
  zip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8"?>
    <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
    </Relationships>`);
  zip.file("xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8"?>
    <workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
      <sheets>
        <sheet name="Chart" sheetId="1" r:id="rId1"/>
        <sheet name="Queries" sheetId="2" r:id="rId2"/>
        <sheet name="Pages" sheetId="3" r:id="rId3"/>
        <sheet name="Countries" sheetId="4" r:id="rId4"/>
      </sheets>
    </workbook>`);
  zip.file("xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8"?>
    <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
      <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>
      <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet3.xml"/>
      <Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet4.xml"/>
    </Relationships>`);
  zip.file("xl/worksheets/sheet1.xml", `<?xml version="1.0" encoding="UTF-8"?>
    <worksheet><sheetData>
      <row r="1"><c r="A1" t="inlineStr"><is><t>Date</t></is></c><c r="B1" t="inlineStr"><is><t>Clicks</t></is></c><c r="C1" t="inlineStr"><is><t>Impressions</t></is></c><c r="D1" t="inlineStr"><is><t>CTR</t></is></c><c r="E1" t="inlineStr"><is><t>Position</t></is></c></row>
      <row r="2"><c r="A2" t="inlineStr"><is><t>2026-05-01</t></is></c><c r="B2"><v>10</v></c><c r="C2"><v>100</v></c><c r="D2"><v>0.1</v></c><c r="E2"><v>20</v></c></row>
    </sheetData></worksheet>`);
  zip.file("xl/worksheets/sheet2.xml", `<?xml version="1.0" encoding="UTF-8"?>
    <worksheet><sheetData>
      <row r="1"><c r="A1" t="inlineStr"><is><t>Top queries</t></is></c><c r="B1" t="inlineStr"><is><t>Clicks</t></is></c><c r="C1" t="inlineStr"><is><t>Impressions</t></is></c><c r="D1" t="inlineStr"><is><t>CTR</t></is></c><c r="E1" t="inlineStr"><is><t>Position</t></is></c></row>
      <row r="2"><c r="A2" t="inlineStr"><is><t>fiber cement siding</t></is></c><c r="B2"><v>171</v></c><c r="C2"><v>43719</v></c><c r="D2"><v>0.0039</v></c><c r="E2"><v>9.54</v></c></row>
    </sheetData></worksheet>`);
  zip.file("xl/worksheets/sheet3.xml", `<?xml version="1.0" encoding="UTF-8"?>
    <worksheet><sheetData>
      <row r="1"><c r="A1" t="inlineStr"><is><t>Top pages</t></is></c><c r="B1" t="inlineStr"><is><t>Clicks</t></is></c><c r="C1" t="inlineStr"><is><t>Impressions</t></is></c></row>
      <row r="2"><c r="A2" t="inlineStr"><is><t>https://example.com/</t></is></c><c r="B2"><v>1</v></c><c r="C2"><v>2</v></c></row>
    </sheetData></worksheet>`);
  zip.file("xl/worksheets/sheet4.xml", `<?xml version="1.0" encoding="UTF-8"?>
    <worksheet><sheetData>
      <row r="1"><c r="A1" t="inlineStr"><is><t>Country</t></is></c><c r="B1" t="inlineStr"><is><t>Clicks</t></is></c><c r="C1" t="inlineStr"><is><t>Impressions</t></is></c></row>
      <row r="2"><c r="A2" t="inlineStr"><is><t>United States</t></is></c><c r="B2"><v>1</v></c><c r="C2"><v>2</v></c></row>
    </sheetData></worksheet>`);

  const rows = await parseXlsx(await zip.generateAsync({ type: "nodebuffer" }), "keywordResearch", { workflow: "additional" });
  assert.equal(rows._worksheetName, "Queries");
  assert.equal(rows.length, 1);
  assert.equal(rows[0]["Top queries"], "fiber cement siding");
  assert.deepEqual(validate("keywordResearch", rows, [], { workflow: "additional" }).issues, []);
  const results = runKeywordResearch(rows, sitemap, client, "additional", []);
  assert.equal(results[0]["Keyword/Query"], "fiber cement siding");
});

test("bestMatch returns close sitemap URL", () => {
  const match = bestMatch("https://example.com/old/cement-siding.html", sitemap, client.homepageUrl);
  assert.equal(match.url, "https://example.com/products/cement-siding/");
  assert.ok(match.score > 0.2);
});

test("bestMatch strips simple pagination paths before fuzzy scoring", () => {
  const pool = [
    "https://weststatebilliards.com/",
    "https://weststatebilliards.com/brands/cornilleau/",
    "https://weststatebilliards.com/brands/olhausen/"
  ];
  const match = bestMatch("https://weststatebilliards.com/brands/cornilleau/page/2/", pool, "https://weststatebilliards.com/");
  assert.equal(match.url, "https://weststatebilliards.com/brands/cornilleau/");
  assert.ok(match.score > 0.9);
});

test("broken links produce replace and remove decisions", () => {
  const rows = [
    { "Source URL": "https://example.com/a", Destination: "https://example.com/old/cement-siding.html", Anchor: "cement siding" },
    { "Source URL": "https://example.com/b", Destination: "https://example.com/random-legacy-event", Anchor: "event" },
    { "Source URL": "https://example.com/c", Destination: "https://example.com/uploads/broken-image.jpg", Anchor: "image" }
  ];
  const results = runBrokenLinks(rows, sitemap, client);
  assert.equal(results[0]["Remove/Replace"], "Replace");
  assert.equal(results[0]["Replacement URL"], "https://example.com/products/cement-siding/");
  assert.equal(results[1]["Remove/Replace"], "Remove");
  assert.equal(results[1].Status, "Pending");
  assert.equal(results[2]["Remove/Replace"], "Check Source Page for Broken Images");
  assert.equal(results[2].Notes, "Check Source Page for Broken Images");
  assert.deepEqual(Object.keys(formatBrokenLinkRowsForExport(results)[0]), [
    "Source URL",
    "Destination",
    "Anchor",
    "Remove/Replace",
    "Replacement URL",
    "Status",
    "Notes"
  ]);
});

test("404 redirects use homepage fallback when needed", () => {
  const results = runRedirects([{ URL: "https://example.com/no-match-xyz" }], sitemap, client);
  assert.equal(results[0]["Redirect URL"], "https://example.com/");
  assert.equal(results[0].Confidence, "Low");
});

test("404 redirects exclude unsafe WordPress infrastructure paths", () => {
  const results = runRedirects([
    { URL: "https://example.com/wp-content/uploads/2024/old-image.jpg" },
    { URL: "https://example.com/wp-login.php" },
    { URL: "https://example.com/brands/cornilleau/page/2/" }
  ], ["https://example.com/", "https://example.com/brands/cornilleau/"], client);
  assert.equal(results[0].Status, "Excluded");
  assert.equal(results[1].Status, "Excluded");
  assert.equal(results[2]["Redirect URL"], "https://example.com/brands/cornilleau/");
});

test("blog URLs prefer product matches when slug keywords overlap", () => {
  const pool = [
    "https://example.com/",
    "https://example.com/blog/",
    "https://example.com/products/cornilleau-ping-pong-table/",
    "https://example.com/collections/table-tennis/"
  ];
  const results = runRedirects([{ URL: "https://example.com/blog/cornilleau-ping-pong-table-review/" }], pool, client);
  assert.equal(results[0]["Redirect URL"], "https://example.com/products/cornilleau-ping-pong-table/");
});

test("redirect export rows follow WordPress and Shopify platform schemas", () => {
  const rows = [{
    "Source URL": "https://example.com/old-page/",
    "Redirect URL": "https://example.com/new-page/",
    Status: "Pending"
  }, {
    "Source URL": "https://example.com/wp-content/uploads/file.jpg",
    "Redirect URL": "",
    Status: "Excluded"
  }];
  assert.deepEqual(formatRedirectRowsForPlatform(rows, "wordpress"), [{
    "source URL": "https://example.com/old-page/",
    "target URL": "https://example.com/new-page/",
    regex: "0",
    "http code": "301"
  }]);
  assert.deepEqual(formatRedirectRowsForPlatform(rows, "shopify"), [{
    "Redirect from": "/old-page/",
    "Redirect to": "/new-page/"
  }]);
});

test("keyword research classifies and sorts opportunities", () => {
  const rows = [
    { Keyword: "cement siding", Position: "11", Volume: "900", URL: "https://example.com/products/cement-siding/" },
    { Keyword: "how long does industrial siding last", Position: "35", Volume: "120" }
  ];
  const results = runKeywordResearch(rows, sitemap, client, "initial", []);
  assert.equal(results[0].Keyword, "cement siding");
  assert.equal(results[0].Type, "Primary");
  assert.equal(results[1].Type, "Secondary");
});

test("additional keyword research separates existing and new GSC queries", () => {
  const gsc = [
    { Query: "cement siding", Clicks: "1", Impressions: "300", CTR: "0.3%", Position: "14", Page: "https://example.com/products/cement-siding/" },
    { Query: "new industrial siding idea", Clicks: "0", Impressions: "120", CTR: "0%", Position: "24", Page: "https://example.com/blog/siding/" }
  ];
  const template = [
    { Keyword: "cement siding", Category: "Cement Siding", "Preferred Page": "https://example.com/products/cement-siding/" }
  ];
  const results = runKeywordResearch(gsc, sitemap, client, "additional", template);
  assert.equal(results[0].Sheet, "Expansion Needs Improvement");
  assert.equal(results[1].Sheet, "New Keywords to Add");
  assert.equal(results[0]["Current Expansion Status"], "Already in Keyword Expansion");
});

test("canonical fixes export only likely self-referencing fixes", () => {
  const rows = [
    {
      Address: "https://example.com/products/cement-siding/",
      "Canonical Link Element 1": "https://example.com/products/old-cement-siding/",
      "Status Code": "200"
    },
    {
      Address: "https://example.com/blog/page/2/",
      "Canonical Link Element 1": "https://example.com/blog/",
      "Status Code": "200"
    },
    {
      Address: "https://example.com/products/cement-siding/?sort=price",
      "Canonical Link Element 1": "https://example.com/products/cement-siding/",
      "Status Code": "200"
    }
  ];
  const results = runCanonicalFixes(rows);
  assert.equal(results[0].Decision, "Fix to self-referencing");
  assert.equal(results[0]["New Canonical"], "https://example.com/products/cement-siding/");
  assert.equal(results[1].Decision, "Do not change automatically");
  assert.equal(results[2].Decision, "Do not change automatically");
  assert.deepEqual(formatCanonicalRowsForExport(results), [{
    URL: "https://example.com/products/cement-siding/",
    Canonical: "https://example.com/products/old-cement-siding/",
    "New Canonical": "https://example.com/products/cement-siding/",
    "Status: ": "Pending"
  }]);
});

test("AI candidate selection sends only judgment-heavy rows", () => {
  const redirects = [
    { Status: "Pending", Confidence: "High", "Source URL": "https://example.com/a" },
    { Status: "Pending", Confidence: "Low", "Source URL": "https://example.com/b" },
    { Status: "Excluded", Confidence: "Low", "Source URL": "https://example.com/wp-login.php" }
  ];
  assert.deepEqual(aiCandidates("redirects404", redirects).map(item => item.index), [1]);
  const compact = compactAiRow("redirects404", redirects[1]);
  assert.deepEqual(Object.keys(compact), ["Source URL", "Confidence", "Status"]);
});

test("AI patches only update existing row fields", () => {
  const rows = [{ "Redirect URL": "https://example.com/old", Reason: "deterministic" }];
  applyAiPatches(rows, [{ index: 0, updates: { "Redirect URL": "https://example.com/new", MadeUp: "ignored" } }]);
  assert.equal(rows[0]["Redirect URL"], "https://example.com/new");
  assert.equal(rows[0].MadeUp, undefined);
  assert.equal(rows[0].AI, "Refined");
});

test("signed OAuth session tokens verify and reject tampering", () => {
  process.env.SESSION_SECRET = "test-secret";
  const token = signedToken({ email: "zeke@nationalpositions.com" });
  assert.equal(verifySignedToken(token).email, "zeke@nationalpositions.com");
  assert.equal(verifySignedToken(`${token}tampered`), null);
  assert.equal(emailAllowed("zeke@nationalpositions.com"), true);
  assert.equal(emailAllowed("person@example.com"), false);
});

test("alt text deduplicates image URLs", () => {
  const rows = [
    { "Image URL": "https://example.com/wp-content/uploads/cement-siding-panel.jpg", "Source URL": "https://example.com/a" },
    { "Image URL": "https://example.com/wp-content/uploads/cement-siding-panel.jpg", "Source URL": "https://example.com/b" },
    { "Image URL": "https://example.com/logo.png", "Source URL": "https://example.com/" }
  ];
  const results = runAltText(rows, sitemap, client);
  assert.equal(results.length, 2);
  assert.match(results[0]["Alt Text"], /Cement Siding Panel/);
  assert.equal(results[1]["Alt Text"], "National Positions logo");
  assert.match(results[0]["Source URLs"], /\/a.*\/b/);
  assert.equal(results[0].Status, "Needs Review");
  assert.equal(results[0].Preview, "https://example.com/wp-content/uploads/cement-siding-panel.jpg");
  assert.equal(results[0].Filename, "cement siding panel");
  assert.equal(results[0]["Source Context"], "A");
  assert.equal(results[0]["Duplicate Count"], 2);
  assert.equal(results[0]["Asset Type"], "Image");
});

test("alt text export omits preview-only column and requires review", () => {
  const rows = [{
    "Image URL": "https://example.com/image.jpg",
    Preview: "https://example.com/image.jpg",
    Filename: "image",
    "Source Context": "Source",
    "Alt Text": "Example image",
    "Source URLs": "https://example.com/source",
    Status: "Needs Review",
    Reviewed: "",
    Confidence: "Low",
    Reason: "Draft"
  }, {
    "Image URL": "https://example.com/reviewed.jpg",
    Preview: "https://example.com/reviewed.jpg",
    Filename: "reviewed",
    "Source Context": "Source",
    "Alt Text": "Reviewed image",
    "Source URLs": "https://example.com/source",
    Status: "Reviewed",
    Reviewed: "Yes",
    Confidence: "Low",
    Reason: "Draft"
  }];
  const exportRows = formatAltTextRowsForExport(rows);
  assert.equal(exportRows.length, 1);
  assert.equal(exportRows[0]["Image URL"], "https://example.com/reviewed.jpg");
  assert.deepEqual(Object.keys(exportRows[0]), [
    "Image URL",
    "Alt Text",
    "Source URLs",
    "Status",
    "Confidence",
    "Reason"
  ]);
  assert.equal(isReviewed({ Reviewed: "Yes" }), true);
  assert.equal(isReviewed({ Status: "Needs Review" }), false);
});

test("validation catches missing keyword column", () => {
  const report = validate("keywordResearch", [{ URL: "https://example.com" }], []);
  assert.ok(report.issues.some(issue => issue.includes("keyword")));
});

test("tool configs include export schemas", () => {
  assert.deepEqual(toolConfigs.brokenLinks.exportColumns.slice(0, 3), ["Source URL", "Destination", "Anchor"]);
});

let failures = 0;
async function run() {
for (const { name, fn } of tests) {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`not ok - ${name}`);
    console.error(error.stack || error);
  }
}

if (failures) {
  console.error(`${failures} test(s) failed.`);
  process.exit(1);
}

console.log(`${tests.length} tests passed.`);
}

run();
