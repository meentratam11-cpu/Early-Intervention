/**
 * Early Intervention booking — backend (Google Apps Script + Google Sheets + Google Drive)
 *
 * Deploy: Extensions › Apps Script › Deploy › New deployment › Web app
 *         Execute as: Me    Who has access: Anyone
 * Script properties (Project Settings › Script properties):
 *   STAFF_PASSWORD   password staff type to open the staff pages (required)
 *   ALLOWED_ORIGIN   optional, e.g. https://meentratam11-cpu.github.io (informational)
 *
 * Data model: a small document store. Every document has a path "collection/id"
 * (even number of segments) and a JSON body, kept in the sheet "docs".
 * Uploaded files go to a Drive folder and are listed in the sheet "assets".
 */

const DOC_SHEET = 'docs';
const ASSET_SHEET = 'assets';
const CHUNK = 45000;          // a Sheets cell holds at most 50,000 characters
const MAX_CHUNKS = 6;         // so one document can be up to ~270 KB of JSON
const TOKEN_HOURS = 12;

/* Who may read / write where. The longest matching path wins.
   view / interact = anyone using the website, admin = signed-in staff,
   {self} = the visitor's own document (its id equals the visitor id). */
const RULES = [
  ['',                'view',     'admin'],
  ['taken',           'view',     'interact'],
  ['acks',            'view',     'interact'],
  ['feedback',        'admin',    'admin'],
  ['feedback/{self}', 'interact', 'interact'],
  ['tickets',         'admin',    'admin'],
  ['tickets/{self}',  'interact', 'interact'],
  ['bookings',        'admin',    'admin'],
  ['bookings/{self}', 'interact', 'interact'],
  ['families',        'admin',    'admin'],
  ['reports',         'admin',    'admin'],
  ['staffonly',       'admin',    'admin'],
];

/* ---------------- entry points ---------------- */
function doGet(e) { return respond_(e && e.parameter ? e.parameter : {}); }
function doPost(e) {
  let p = {};
  try { p = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (err) { p = {}; }
  return respond_(p);
}
function respond_(p) {
  let body;
  try { body = Object.assign({ ok: true }, route_(p)); }
  catch (err) { body = { ok: false, code: err.code || 'error', message: String(err.message || err) }; }
  return ContentService.createTextOutput(JSON.stringify(body)).setMimeType(ContentService.MimeType.JSON);
}
function fail_(code, message) { const e = new Error(message || code); e.code = code; throw e; }

function route_(p) {
  const ctx = { uid: cleanUid_(p.uid), staff: checkToken_(p.token) };
  switch (p.a) {
    case 'ping':   return { rev: rev_(), staff: ctx.staff };
    case 'rev':    return { rev: rev_() };
    case 'login':  return login_(p.password);
    case 'get':    return { doc: readDoc_(ctx, p.path) };
    case 'list':   return { docs: listCol_(ctx, p.path) };
    case 'many':   return many_(ctx, p.reqs || []);
    case 'set':    return write_(ctx, [{ op: 'set', path: p.path, data: p.data }]);
    case 'update': return write_(ctx, [{ op: 'update', path: p.path, data: p.data }]);
    case 'delete': return write_(ctx, [{ op: 'delete', path: p.path }]);
    case 'batch':  return write_(ctx, p.writes || []);
    case 'acquire':return acquire_(ctx, p.path, p.holder, p.ttl);
    case 'assets': return { assets: assetList_() };
    case 'file':   return file_(p.id);
    case 'upload': return upload_(ctx, p);
    case 'deleteAsset': return deleteAsset_(ctx, p.id);
    default: fail_('bad_request', 'unknown action');
  }
}

/* ---------------- auth ---------------- */
function props_() { return PropertiesService.getScriptProperties(); }
function secret_() {
  const pr = props_();
  let s = pr.getProperty('TOKEN_SECRET');
  if (!s) { s = Utilities.getUuid() + Utilities.getUuid(); pr.setProperty('TOKEN_SECRET', s); }
  return s;
}
function sign_(text) {
  return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(text, secret_()));
}
function login_(password) {
  const real = props_().getProperty('STAFF_PASSWORD');
  if (!real) fail_('not_configured', 'ยังไม่ได้ตั้ง STAFF_PASSWORD ใน Script properties');
  const cache = CacheService.getScriptCache();
  const fails = Number(cache.get('login_fails') || 0);
  if (fails >= 10) fail_('rate_limited', 'ใส่รหัสผิดหลายครั้ง กรุณารอ 10 นาที');
  if (String(password || '') !== real) {
    cache.put('login_fails', String(fails + 1), 600);
    Utilities.sleep(800);
    fail_('auth', 'รหัสผ่านไม่ถูกต้อง');
  }
  const exp = Date.now() + TOKEN_HOURS * 3600 * 1000;
  return { token: exp + '.' + sign_(String(exp)), exp: exp };
}
function checkToken_(token) {
  if (!token || typeof token !== 'string') return false;
  const i = token.indexOf('.'); if (i < 0) return false;
  const exp = token.slice(0, i);
  return Number(exp) > Date.now() && sign_(exp) === token.slice(i + 1);
}
function cleanUid_(u) { return /^[A-Za-z0-9_-]{8,64}$/.test(String(u || '')) ? String(u) : ''; }

/* ---------------- access rules ---------------- */
function segs_(path) { return String(path || '').split('/').filter(Boolean); }
function validDocPath_(path) {
  const s = segs_(path);
  if (!s.length || s.length % 2 || s.some(x => !/^[A-Za-z0-9_.~:@+-]{1,200}$/.test(x))) fail_('bad_request', 'bad document path');
  return s.join('/');
}
function rulesFor_(path) {
  const s = segs_(path);
  let best = RULES[0], bestLen = -1, selfRule = null;
  RULES.forEach(r => {
    const rs = segs_(r[0]);
    if (rs.length && rs[rs.length - 1] === '{self}') {
      const prefix = rs.slice(0, -1);
      if (s.length > prefix.length && prefix.every((x, i) => x === s[i])) selfRule = { r: r, owner: s[prefix.length] };
      return;
    }
    if (rs.length <= s.length && rs.every((x, i) => x === s[i]) && rs.length > bestLen) { best = r; bestLen = rs.length; }
  });
  return { base: best, self: selfRule };
}
function allowed_(ctx, path, mode) {             // mode 1 = read, 2 = write
  const ok = level => level === 'view' || (level === 'interact') || (level === 'admin' && ctx.staff);
  const r = rulesFor_(path);
  if (ok(r.base[mode])) return true;
  if (r.self && ctx.uid && r.self.owner === ctx.uid && ok(r.self.r[mode])) return true;
  return ctx.staff && r.base[mode] === 'admin';
}

/* ---------------- storage ---------------- */
function sheet_(name, header) {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(name);
  if (!sh) { sh = ss.insertSheet(name); sh.appendRow(header); sh.setFrozenRows(1); }
  return sh;
}
function docSheet_() { return sheet_(DOC_SHEET, ['path', 'version', 'updated', 'json1', 'json2', 'json3', 'json4', 'json5', 'json6']); }
function loadAll_() {
  const sh = docSheet_(), n = sh.getLastRow();
  const map = {};
  if (n < 2) return { sh: sh, map: map };
  const vals = sh.getRange(2, 1, n - 1, 3 + MAX_CHUNKS).getValues();
  vals.forEach((row, i) => {
    if (!row[0]) return;
    let data = null;
    try { data = JSON.parse(row.slice(3).join('')); } catch (e) { data = null; }
    map[row[0]] = { row: i + 2, version: Number(row[1]) || 1, data: data };
  });
  return { sh: sh, map: map };
}
function toRow_(path, version, data) {
  const json = JSON.stringify(data);
  if (json.length > CHUNK * MAX_CHUNKS) fail_('too_large', 'ข้อมูลเอกสารนี้ใหญ่เกินไป');
  const parts = [];
  for (let i = 0; i < MAX_CHUNKS; i++) parts.push(json.slice(i * CHUNK, (i + 1) * CHUNK));
  return [path, version, new Date()].concat(parts);
}
function rev_() { return Number(props_().getProperty('REV') || 0); }
function bump_() { const r = rev_() + 1; props_().setProperty('REV', String(r)); return r; }

function readDoc_(ctx, path) {
  path = validDocPath_(path);
  if (!allowed_(ctx, path, 1)) return null;           // hidden reads look like missing documents
  const d = loadAll_().map[path];
  return d ? { id: segs_(path).pop(), data: d.data, version: d.version } : null;
}
function listCol_(ctx, col, all) {
  const cs = segs_(col);
  if (!cs.length || cs.length % 2 === 0) fail_('bad_request', 'bad collection path');
  all = all || loadAll_().map;
  const out = [];
  Object.keys(all).forEach(p => {
    const s = segs_(p);
    if (s.length !== cs.length + 1 || !cs.every((x, i) => x === s[i])) return;
    if (!allowed_(ctx, p, 1)) return;
    out.push({ id: s[s.length - 1], data: all[p].data, version: all[p].version });
  });
  out.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  return out;
}
function many_(ctx, reqs) {
  const all = loadAll_().map;
  const res = reqs.slice(0, 80).map(q => {
    try {
      if (q.t === 'doc') {
        const path = validDocPath_(q.path);
        if (!allowed_(ctx, path, 1) || !all[path]) return { doc: null };
        return { doc: { id: segs_(path).pop(), data: all[path].data, version: all[path].version } };
      }
      return { docs: listCol_(ctx, q.path, all) };
    } catch (e) { return { error: e.code || 'error', message: String(e.message || e) }; }
  });
  return { rev: rev_(), res: res };
}
function merge_(base, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return patch;
  const out = (base && typeof base === 'object' && !Array.isArray(base)) ? Object.assign({}, base) : {};
  Object.keys(patch).forEach(k => {
    const v = patch[k];
    out[k] = (v && typeof v === 'object' && !Array.isArray(v)) ? merge_(out[k], v) : v;
  });
  return out;
}
function write_(ctx, writes) {
  if (!writes.length) return { rev: rev_() };
  if (writes.length > 60) fail_('bad_request', 'too many writes');
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const st = loadAll_(), sh = st.sh, map = st.map, versions = {};
    const plan = writes.map(w => {
      const path = validDocPath_(w.path);
      if (!allowed_(ctx, path, 2)) fail_('permission', 'ไม่มีสิทธิ์แก้ไขข้อมูลนี้');
      if ((w.op === 'set' || w.op === 'update') && (!w.data || typeof w.data !== 'object' || Array.isArray(w.data))) fail_('bad_request', 'data must be an object');
      if (w.op === 'update' && !map[path]) fail_('invalid_argument', 'document does not exist');
      return { op: w.op, path: path, data: w.data };
    });
    plan.forEach(w => {
      const cur = map[w.path];
      if (w.op === 'delete') {
        if (cur) { sh.getRange(cur.row, 1, 1, 3 + MAX_CHUNKS).clearContent(); delete map[w.path]; }
        return;
      }
      const data = w.op === 'update' ? merge_(cur.data, w.data) : w.data;
      const version = cur ? cur.version + 1 : 1;
      const row = toRow_(w.path, version, data);
      if (cur) sh.getRange(cur.row, 1, 1, row.length).setValues([row]);
      else { sh.appendRow(row); }
      map[w.path] = { row: cur ? cur.row : sh.getLastRow(), version: version, data: data };
      versions[w.path] = version;
    });
    return { rev: bump_(), versions: versions };
  } finally { lock.releaseLock(); }
}
/* short lease used to hand out booking seats one at a time */
function acquire_(ctx, path, holder, ttl) {
  path = validDocPath_(path);
  if (!allowed_(ctx, path, 2)) fail_('permission', 'ไม่มีสิทธิ์');
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const cache = CacheService.getScriptCache(), key = 'lease:' + path, cur = cache.get(key);
    if (cur && cur !== String(holder)) return { acquired: false };
    const secs = Math.max(1, Math.min(600, Math.round((Number(ttl) || 30000) / 1000)));
    cache.put(key, String(holder), secs);
    return { acquired: true };
  } finally { lock.releaseLock(); }
}

/* ---------------- files ---------------- */
function folder_() {
  const pr = props_(); const id = pr.getProperty('FOLDER_ID');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) {} }
  const f = DriveApp.createFolder('Early Intervention – ไฟล์อัปโหลด');
  pr.setProperty('FOLDER_ID', f.getId());
  return f;
}
function assetSheet_() { return sheet_(ASSET_SHEET, ['id', 'driveId', 'type', 'name', 'size', 'created']); }
function assetRows_() {
  const sh = assetSheet_(), n = sh.getLastRow();
  return n < 2 ? [] : sh.getRange(2, 1, n - 1, 6).getValues().filter(r => r[0]);
}
function assetList_() { return assetRows_().map(r => ({ id: r[0], type: r[2], name: r[3], size: r[4] })); }
function file_(id) {
  const row = assetRows_().find(r => r[0] === id);
  if (!row) fail_('not_found', 'ไม่พบไฟล์');
  const blob = DriveApp.getFileById(row[1]).getBlob();
  return { type: row[2], b64: Utilities.base64Encode(blob.getBytes()) };
}
function upload_(ctx, p) {
  if (!ctx.staff) fail_('permission', 'อัปโหลดได้เฉพาะเจ้าหน้าที่');
  const ok = /^(image\/(png|jpe?g|webp|gif)|application\/pdf)$/.test(String(p.type || ''));
  if (!ok) fail_('bad_request', 'รองรับเฉพาะ PDF หรือรูปภาพ');
  const bytes = Utilities.base64Decode(String(p.b64 || ''));
  if (bytes.length > 20 * 1024 * 1024) fail_('too_large', 'ไฟล์ใหญ่เกิน 20 MB');
  const id = Utilities.getUuid().replace(/-/g, '');
  const file = folder_().createFile(Utilities.newBlob(bytes, p.type, String(p.name || id)));
  assetSheet_().appendRow([id, file.getId(), p.type, String(p.name || ''), bytes.length, new Date()]);
  bump_();
  return { id: id, size: bytes.length, type: p.type };
}
function deleteAsset_(ctx, id) {
  if (!ctx.staff) fail_('permission', 'ลบได้เฉพาะเจ้าหน้าที่');
  const sh = assetSheet_(), rows = assetRows_();
  const i = rows.findIndex(r => r[0] === id);
  if (i < 0) return { deleted: false };
  try { DriveApp.getFileById(rows[i][1]).setTrashed(true); } catch (e) {}
  sh.getRange(i + 2, 1, 1, 6).clearContent();
  bump_();
  return { deleted: true };
}

/* Run once from the editor to grant permissions and create the sheets/folder. */
function setup() {
  docSheet_(); assetSheet_(); folder_(); secret_();
  if (!props_().getProperty('STAFF_PASSWORD')) Logger.log('อย่าลืมตั้ง STAFF_PASSWORD ใน Project Settings › Script properties');
  Logger.log('ตั้งค่าเรียบร้อย');
}
