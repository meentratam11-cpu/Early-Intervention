/*
 * Connects the booking page to the Google Apps Script backend.
 * The page was first written for claude.ai and calls `claude.use("db" | "user" | "assets" | "downloads")`;
 * this file provides the same calls on top of the Apps Script web app set in config.js.
 */
(function () {
  "use strict";
  const CFG = window.EI_CONFIG || {};
  const API = (CFG.API_URL || "").trim();
  const STATIC = window.EI_STATIC_ASSETS || {};         // id -> file under ./files/
  const POLL_MS = CFG.POLL_MS || 20000;
  // Public, non-personal collections are kept on the device so a return visit shows them at once.
  // Nothing personal (bookings, reports, families, tickets, feedback) is ever stored this way.
  const DEVICE_CACHE = ["config", "holidays", "library", "hwlib", "taken", "acks"];

  /* ---------- small helpers ---------- */
  const store = {
    get(k){ try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v){ try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} }
  };
  function randomId(n){ const a = new Uint8Array(n); crypto.getRandomValues(a); return Array.from(a, b => "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"[b % 62]).join(""); }
  let uid = store.get("ei_uid"); if (!uid) { uid = "u_" + randomId(22); store.set("ei_uid", uid); }
  function token(){ const t = store.get("ei_staff_token") || ""; const exp = Number(t.split(".")[0]); return exp > Date.now() ? t : ""; }
  const isStaff = () => !!token();
  const err = (code, message) => Object.assign(new Error(message || code), { code });

  async function call(body){
    if (!API) throw err("not_configured", "ยังไม่ได้ตั้งค่า API_URL ใน config.js");
    let res;
    try {
      res = await fetch(API, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(Object.assign({ uid, token: token() }, body)) });
    } catch (e) { throw err("unavailable", "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้"); }
    let j; try { j = await res.json(); } catch { throw err("unavailable", "เซิร์ฟเวอร์ตอบกลับไม่ถูกต้อง"); }
    if (!j.ok) throw err(j.code || "error", j.message);
    return j;
  }

  /* ---------- document store (same shape as the claude.ai db capability) ---------- */
  const segs = p => String(p).split("/").filter(Boolean);
  function docSnap(path, doc){
    const data = doc ? doc.data : undefined;
    return { id: segs(path).pop(), exists: !!doc, data: () => data === undefined ? undefined : JSON.parse(JSON.stringify(data)),
      metadata: { fromCache: false, hasPendingWrites: false } };
  }
  function cmp(a, op, b){
    switch (op) {
      case "==": return a === b; case "!=": return a !== b; case "<": return a < b; case "<=": return a <= b;
      case ">": return a > b; case ">=": return a >= b; case "in": return Array.isArray(b) && b.includes(a);
      case "not-in": return Array.isArray(b) && !b.includes(a); case "array-contains": return Array.isArray(a) && a.includes(b);
    } return false;
  }
  function applyQuery(docs, q){
    let out = docs.filter(d => q.where.every(([f, op, v]) => cmp((d.data || {})[f], op, v)));
    if (q.order) { const [f, dir] = q.order; out.sort((a, b) => { const x = (a.data || {})[f], y = (b.data || {})[f]; return (x < y ? -1 : x > y ? 1 : 0) * (dir === "desc" ? -1 : 1); }); }
    if (q.limit) out = out.slice(0, q.limit);
    return out;
  }
  function querySnap(path, docs, prev){
    const snaps = docs.map(d => docSnap(path + "/" + d.id, d));
    const before = new Map((prev || []).map(d => [d.id, JSON.stringify(d.data)]));
    return { docs: snaps, size: snaps.length, empty: !snaps.length, metadata: { fromCache: false, hasPendingWrites: false },
      docChanges(){ return snaps.map((s, i) => ({ type: !before.has(s.id) ? "added" : before.get(s.id) !== JSON.stringify(docs[i].data) ? "modified" : "added", doc: s, oldIndex: -1, newIndex: i })); } };
  }

  const subs = new Set();
  let lastRev = -1, refreshTimer = null, refreshing = null;
  const cacheKey = s => DEVICE_CACHE.includes(segs(s.path)[0]) ? "ei_c:" + s.kind + ":" + s.path : "";
  function remember(s, raw){ const k = cacheKey(s); if (k) store.set(k, JSON.stringify(raw)); }
  /* hand the subscriber a new raw result (doc or doc list) if it differs from what it last saw */
  function deliver(s, raw){
    if (s.kind === "doc") {
      const key = JSON.stringify(raw === undefined ? null : raw);
      if (key !== s.last) { s.last = key; s.raw = raw || null; safe(() => s.next(docSnap(s.path, raw || null))); }
    } else {
      s.raw = raw || [];
      const docs = applyQuery(s.raw, s.q), key = JSON.stringify(docs);
      if (key !== s.last) { const prev = s.prevDocs; s.last = key; s.prevDocs = docs; safe(() => s.next(querySnap(s.path, docs, prev))); }
    }
  }
  function safe(fn){ try { fn(); } catch (e) { console.error(e); } }
  function subscribe(s){
    subs.add(s);
    const k = cacheKey(s), saved = k && store.get(k);
    if (saved) setTimeout(() => { if (subs.has(s) && s.last === undefined) { try { deliver(s, JSON.parse(saved)); } catch {} } }, 0);
    scheduleRefresh();
    return () => subs.delete(s);
  }
  /* apply a write to what subscribers already hold, so the screen changes before the server answers */
  function mergeDeep(base, patch){
    if (!patch || typeof patch !== "object" || Array.isArray(patch)) return patch;
    const out = (base && typeof base === "object" && !Array.isArray(base)) ? Object.assign({}, base) : {};
    Object.keys(patch).forEach(k => { const v = patch[k]; out[k] = (v && typeof v === "object" && !Array.isArray(v)) ? mergeDeep(out[k], v) : v; });
    return out;
  }
  /* Writes the server may not have included yet. A server answer only counts a write once that write
     had finished before the answer was asked for; until then the write is laid over every answer. */
  let clock = 0;
  const overlay = [];
  function withOverlay(s, raw, sentAt){
    overlay.forEach(o => { if (!o.doneAt || o.doneAt > sentAt) raw = applyTo(s, raw, o.writes).raw; });
    return raw;
  }
  function applyLocal(writes){
    subs.forEach(s => { if (s.raw === undefined) return; const r = applyTo(s, s.raw, writes); if (r.touched) deliver(s, r.raw); });
  }
  function applyTo(s, raw0, writes){
    let raw = s.kind === "doc" ? (raw0 ? JSON.parse(JSON.stringify(raw0)) : null) : (raw0 || []).map(d => Object.assign({}, d));
    let touched = false;
    writes.forEach(w => {
      const ws = segs(w.path), id = ws[ws.length - 1];
      if (s.kind === "doc") {
        if (w.path !== s.path) return; touched = true;
        if (w.op === "delete") raw = null;
        else if (w.op === "set") raw = { id, data: w.data };
        else raw = { id, data: mergeDeep(raw ? raw.data : {}, w.data) };
      } else {
        if (ws.slice(0, -1).join("/") !== segs(s.path).join("/")) return; touched = true;
        const i = raw.findIndex(d => d.id === id);
        if (w.op === "delete") { if (i >= 0) raw.splice(i, 1); return; }
        const data = w.op === "set" ? w.data : mergeDeep(i >= 0 ? raw[i].data : {}, w.data);
        if (i >= 0) raw[i] = Object.assign({}, raw[i], { data }); else { raw.push({ id, data }); raw.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0); }
      }
    });
    return { raw, touched };
  }
  function scheduleRefresh(delay){ clearTimeout(refreshTimer); refreshTimer = setTimeout(refresh, delay == null ? 40 : delay); }
  async function refresh(){
    if (refreshing) { scheduleRefresh(300); return; }
    const list = [...subs]; if (!list.length) return;
    refreshing = (async () => {
      try {
        const sentAt = clock;
        const r = await call({ a: "many", reqs: list.map(s => s.kind === "doc" ? { t: "doc", path: s.path } : { t: "col", path: s.path }) });
        for (let i = overlay.length - 1; i >= 0; i--) if (overlay[i].doneAt && overlay[i].doneAt <= sentAt) overlay.splice(i, 1);
        lastRev = r.rev; window.EI.dataAt = window.EI.dataAt || Date.now();
        list.forEach((s, i) => {
          const out = r.res[i] || {};
          if (out.error) { s.error && s.error(err(out.error, out.message)); return; }
          const raw = s.kind === "doc" ? (out.doc || null) : (out.docs || []);
          remember(s, raw); deliver(s, withOverlay(s, raw, sentAt));
        });
      } catch (e) { list.forEach(s => s.error && s.error(e)); }
    })();
    await refreshing; refreshing = null;
  }
  async function poll(){
    if (document.visibilityState === "visible" && subs.size) {
      try { const r = await call({ a: "rev" }); if (r.rev !== lastRev) await refresh(); } catch {}
    }
    setTimeout(poll, isStaff() ? Math.min(POLL_MS, 10000) : POLL_MS);
  }
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && subs.size) scheduleRefresh(0); });
  async function write(writes){
    const o = { writes, doneAt: 0 }; overlay.push(o);
    applyLocal(writes);
    try { const r = await call({ a: "batch", writes }); o.doneAt = ++clock; lastRev = r.rev; scheduleRefresh(150); return r; }
    catch (e) { overlay.splice(overlay.indexOf(o), 1); scheduleRefresh(0); throw e; }   // put the screen back to what the server holds
  }

  function docRef(path){
    return {
      id: segs(path).pop(), path,
      async get(){ const r = await call({ a: "get", path }); return docSnap(path, r.doc); },
      set(data){ return write([{ op: "set", path, data }]).then(() => undefined); },
      update(data){ return write([{ op: "update", path, data }]).then(() => undefined); },
      delete(){ return write([{ op: "delete", path }]).then(() => undefined); },
      async acquire(o){ const r = await call({ a: "acquire", path, holder: o.holder, ttl: o.ttlMs }); return { acquired: r.acquired, holder: r.acquired ? o.holder : undefined }; },
      onSnapshot(next, error){ return subscribe({ kind: "doc", path, next, error, last: undefined }); },
      collection(sub){ return colRef(path + "/" + sub); }
    };
  }
  function makeQuery(path, q){
    return {
      where(f, op, v){ return makeQuery(path, Object.assign({}, q, { where: q.where.concat([[f, op, v]]) })); },
      orderBy(f, dir){ return makeQuery(path, Object.assign({}, q, { order: [f, dir || "asc"] })); },
      limit(n){ return makeQuery(path, Object.assign({}, q, { limit: n })); },
      async get(){ const r = await call({ a: "list", path }); return querySnap(path, applyQuery(r.docs || [], q)); },
      onSnapshot(next, error){ return subscribe({ kind: "col", path, q, next, error, last: undefined }); }
    };
  }
  function colRef(path){
    return Object.assign(makeQuery(path, { where: [], order: null, limit: 0 }), {
      path,
      doc(id){ return docRef(path + "/" + (id || randomId(20))); },
      async add(data){ const ref = docRef(path + "/" + randomId(20)); await ref.set(data); return ref; }
    });
  }
  const db = { doc: docRef, collection: colRef };

  /* ---------- files: "/_blob/<id>" urls used by the page ---------- */
  const blobCache = new Map();
  function blobUrl(id){
    if (STATIC[id]) return Promise.resolve(STATIC[id]);
    if (!blobCache.has(id)) blobCache.set(id, call({ a: "file", id }).then(r => {
      const bin = atob(r.b64), bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return URL.createObjectURL(new Blob([bytes], { type: r.type }));
    }).catch(e => { blobCache.delete(id); throw e; }));
    return blobCache.get(id);
  }
  const BLOB_RE = /^\/_blob\/([0-9a-f]{32})$/;
  const origFetch = window.fetch.bind(window);
  window.fetch = function (input, init){
    const m = typeof input === "string" && input.match(BLOB_RE);
    if (m) return blobUrl(m[1]).then(u => origFetch(u, init));
    return origFetch(input, init);
  };
  // <img src="/_blob/..."> written in HTML or set from script
  const srcDesc = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "src");
  Object.defineProperty(HTMLImageElement.prototype, "src", {
    configurable: true, enumerable: srcDesc.enumerable, get(){ return srcDesc.get.call(this); },
    set(v){ const m = String(v).match(BLOB_RE); if (!m) return srcDesc.set.call(this, v);
      const el = this; blobUrl(m[1]).then(u => srcDesc.set.call(el, u)).catch(() => {}); }
  });
  function fixImg(img){ const v = img.getAttribute("src"); const m = v && v.match(BLOB_RE); if (m) { img.removeAttribute("src"); blobUrl(m[1]).then(u => srcDesc.set.call(img, u)).catch(() => {}); } }
  new MutationObserver(list => list.forEach(r => {
    if (r.type === "attributes" && r.target.tagName === "IMG") fixImg(r.target);
    r.addedNodes && r.addedNodes.forEach(n => { if (n.nodeType !== 1) return; if (n.tagName === "IMG") fixImg(n); n.querySelectorAll && n.querySelectorAll("img[src^='/_blob/']").forEach(fixImg); });
  })).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ["src"] });

  const assets = {
    async upload(blob){
      const b64 = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(",")[1]); fr.onerror = rej; fr.readAsDataURL(blob); });
      const r = await call({ a: "upload", type: blob.type || "application/octet-stream", name: blob.name || "", b64 });
      return { id: r.id, url: "/_blob/" + r.id, sizeBytes: r.size, contentType: r.type };
    },
    async list(){ const r = await call({ a: "assets" }); return { assets: r.assets, usage: {} }; },
    async delete(id){ const r = await call({ a: "deleteAsset", id }); return r; }
  };

  /* ---------- downloads, user ---------- */
  const downloads = {
    async save({ filename, data }){
      const blob = data instanceof Blob ? data : new Blob([data]);
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = filename || "file";
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      return { saved: true };
    }
  };
  const user = {
    async id(){ return uid; }, async me(){ return { id: uid, name: "", email: null }; },
    async isOwner(){ return isStaff(); }, async canEdit(){ return isStaff(); },
    async can(name){ return name === "data.write" ? true : isStaff(); },
    async profiles(){ return {}; }, async search(){ return []; }
  };

  window.claude = {
    use(name){
      if (!API && name === "db") return Promise.resolve(null);
      if (name === "db") { if (!poll.started) { poll.started = true; setTimeout(poll, POLL_MS); } return Promise.resolve(db); }
      if (name === "user") return Promise.resolve(user);
      if (name === "downloads") return Promise.resolve(downloads);
      if (name === "assets") return Promise.resolve(isStaff() ? assets : null);
      return Promise.resolve(null);
    }
  };

  /* ---------- staff sign-in (server password) ---------- */
  function modal(html){
    const wrap = document.createElement("div"); wrap.className = "rate-overlay"; wrap.innerHTML = `<div class="rate-card" role="dialog" aria-modal="true">${html}</div>`;
    document.body.appendChild(wrap); return wrap;
  }
  window.EI = {
    staffLogin(){
      const m = modal(`<h2>เข้าสู่ระบบเจ้าหน้าที่</h2><p class="muted small" style="margin:0">ใช้รหัสผ่านเจ้าหน้าที่ของศูนย์</p>
        <form class="list" id="eiLogin"><input type="password" id="eiPw" autocomplete="current-password" placeholder="รหัสผ่าน" required>
        <div id="eiMsg" class="note err small" hidden></div>
        <div class="row end"><button type="button" class="btn ghost" id="eiCancel">ยกเลิก</button><button class="btn">เข้าสู่ระบบ</button></div></form>`);
      setTimeout(() => m.querySelector("#eiPw").focus(), 0);
      m.querySelector("#eiCancel").onclick = () => m.remove();
      m.querySelector("#eiLogin").onsubmit = async e => {
        e.preventDefault(); const b = e.target.querySelector("button:last-child"); b.disabled = true;
        try { const r = await call({ a: "login", password: m.querySelector("#eiPw").value }); store.set("ei_staff_token", r.token); location.reload(); }
        catch (x) { const box = m.querySelector("#eiMsg"); box.textContent = x.message || "เข้าสู่ระบบไม่สำเร็จ"; box.hidden = false; b.disabled = false; }
      };
    },
    staffLogout(){ store.set("ei_staff_token", null); location.reload(); },
    isStaff,
    /* several writes in one trip to the server (ops: set, update, merge = update or create, delete) */
    batch(writes){ return write(writes); },
    /* take the first free seat of a slot and save the booking in the same trip; "$TAKEN" in `then` becomes the seat id */
    async claim(date, slot, owner, bid, then){
      const r = await call({ a: "claim", date, slot, owner, bid, then: then || [] });
      if (r.takenId) {
        // show the new seat and booking straight away, as the server saved them
        const fill = v => typeof v === "string" ? (v === "$TAKEN" ? r.takenId : v)
          : Array.isArray(v) ? v.map(fill) : (v && typeof v === "object") ? Object.keys(v).reduce((o, k) => (o[k] = fill(v[k]), o), {}) : v;
        const writes = [{ op: "set", path: "taken/" + r.takenId, data: { date, slot, owner, bid } }]
          .concat((then || []).map(w => ({ op: w.op, path: w.path, data: fill(w.data) })));
        overlay.push({ writes, doneAt: ++clock }); applyLocal(writes);
        lastRev = r.rev; scheduleRefresh(0);
      }
      return r.takenId || null;
    },
    /* first-time setup: copy the starter content from seed.json into the new spreadsheet */
    async offerSeed(){
      if (!isStaff() || !API) return;
      try { const r = await call({ a: "get", path: "config/main" }); if (r.doc) return; } catch { return; }
      const bar = document.createElement("div"); bar.className = "soon"; bar.style.margin = "12px auto"; bar.style.maxWidth = "900px"; bar.style.position = "relative"; bar.style.zIndex = 5;
      bar.innerHTML = `<div><b>ระบบยังว่าง</b><div class="small">นำเข้าข้อมูลตั้งต้น: การตั้งค่า วันหยุด คลังกิจกรรม ใบงาน และใบความรู้</div></div><button class="btn" type="button">นำเข้าข้อมูลตั้งต้น</button>`;
      document.querySelector(".wrap").prepend(bar);
      bar.querySelector("button").onclick = async ev => {
        const b = ev.target; b.disabled = true; b.textContent = "กำลังนำเข้า…";
        try {
          const seed = await (await origFetch("seed.json")).json();
          const writes = seed.map(d => ({ op: "set", path: d.path, data: d.data }));
          for (let i = 0; i < writes.length; i += 40) await call({ a: "batch", writes: writes.slice(i, i + 40) });
          location.reload();
        } catch (x) { b.disabled = false; b.textContent = "ลองอีกครั้ง"; alert("นำเข้าไม่สำเร็จ: " + (x.message || x)); }
      };
    }
  };
})();
