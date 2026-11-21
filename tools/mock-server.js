/* Local test server: runs apps-script/Code.gs in Node with in-memory stand-ins for
   Sheets, Drive, Properties, Cache and Lock, and serves docs/ as the website.
   Usage: node tools/mock-server.js [apiPort=8787] [webPort=8788]   (staff password: test1234)
   MOCK_LATENCY=900 adds that many ms to every backend call, close to a real Apps Script round trip. */
const fs = require("fs"), path = require("path"), http = require("http"), crypto = require("crypto"), vm = require("vm");
const ROOT = path.join(__dirname, "..");
const API_PORT = +process.argv[2] || 8787, WEB_PORT = +process.argv[3] || 8788;
const LATENCY = +process.env.MOCK_LATENCY || 0;
let calls = 0;

function makeSheet(){ const rows = []; return {
  appendRow(r){ rows.push(r.slice()); }, getLastRow(){ return rows.length; }, setFrozenRows(){},
  getRange(r, c, nr = 1, nc = 1){ return {
    getValues(){ const out = []; for (let i = 0; i < nr; i++){ const row = rows[r - 1 + i] || []; const o = []; for (let j = 0; j < nc; j++) o.push(row[c - 1 + j] ?? ""); out.push(o); } return out; },
    setValues(v){ v.forEach((row, i) => { const t = rows[r - 1 + i] || (rows[r - 1 + i] = []); row.forEach((x, j) => t[c - 1 + j] = x); }); },
    clearContent(){ for (let i = 0; i < nr; i++){ const t = rows[r - 1 + i]; if (t) for (let j = 0; j < nc; j++) t[c - 1 + j] = ""; } } }; } }; }
const sheets = {}, props = {}, cache = {}, files = {};
const sandbox = {
  SpreadsheetApp: { flush(){}, getActive: () => ({ getSheetByName: n => sheets[n] || null, insertSheet: n => (sheets[n] = makeSheet()) }) },
  PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] ?? null, setProperty: (k, v) => { props[k] = String(v); } }) },
  CacheService: { getScriptCache: () => { const c = {
    get: k => (cache[k] && cache[k].exp > Date.now()) ? cache[k].v : null,
    put: (k, v, s) => { if (String(v).length > 100000) throw new Error("cache value too large"); cache[k] = { v: String(v), exp: Date.now() + (s || 600) * 1000 }; },
    getAll: ks => { const o = {}; ks.forEach(k => { const v = c.get(k); if (v != null) o[k] = v; }); return o; },
    putAll: (o, s) => Object.keys(o).forEach(k => c.put(k, o[k], s)),
    remove: k => { delete cache[k]; } }; return c; } },
  LockService: { getScriptLock: () => ({ waitLock(){}, releaseLock(){} }) },
  Utilities: {
    getUuid: () => crypto.randomUUID(), sleep(){},
    base64Encode: b => Buffer.from(b).toString("base64"), base64Decode: s => [...Buffer.from(s, "base64")],
    base64EncodeWebSafe: b => Buffer.from(b).toString("base64").replace(/\+/g, "-").replace(/\//g, "_"),
    computeHmacSha256Signature: (t, k) => [...crypto.createHmac("sha256", k).update(t).digest()],
    newBlob: (bytes, type, name) => ({ bytes, type, name })
  },
  DriveApp: {
    createFolder: () => ({ getId: () => "folder1", createFile: b => { const id = "f" + crypto.randomUUID(); files[id] = b; return { getId: () => id }; } }),
    getFolderById: () => sandbox.DriveApp.createFolder(),
    getFileById: id => ({ getBlob: () => ({ getBytes: () => files[id].bytes }), setTrashed(){ delete files[id]; } })
  },
  ContentService: { MimeType: { JSON: "json" }, createTextOutput: s => ({ s, setMimeType(){ return this; } }) },
  Logger: { log: (...a) => console.log("[gs]", ...a) }, console
};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(ROOT, "apps-script", "Code.gs"), "utf8"), sandbox);
props.STAFF_PASSWORD = "test1234";
sandbox.setup();

http.createServer((req, res) => {
  const cors = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };
  if (req.url.startsWith("/__calls")) { res.writeHead(200, cors); res.end(JSON.stringify({ calls })); return; }
  let body = ""; req.on("data", d => body += d); req.on("end", () => setTimeout(() => {
    calls++;
    const out = req.method === "POST" ? sandbox.doPost({ postData: { contents: body } }) : sandbox.doGet({ parameter: Object.fromEntries(new URL(req.url, "http://x").searchParams) });
    res.writeHead(200, cors); res.end(out.s);
  }, LATENCY));
}).listen(API_PORT, () => console.log("api on", API_PORT));

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json", ".pdf": "application/pdf", ".jpg": "image/jpeg", ".png": "image/png", ".css": "text/css" };
http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, "http://x").pathname); if (p.endsWith("/")) p += "index.html";
  if (p === "/js/config.js") { res.writeHead(200, { "Content-Type": TYPES[".js"] }); res.end(`window.EI_CONFIG={API_URL:"http://localhost:${API_PORT}/",POLL_MS:3000};`); return; }
  const f = path.join(ROOT, "docs", p);
  if (!f.startsWith(path.join(ROOT, "docs")) || !fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "Content-Type": TYPES[path.extname(f)] || "application/octet-stream" }); fs.createReadStream(f).pipe(res);
}).listen(WEB_PORT, () => console.log("web on", WEB_PORT));
