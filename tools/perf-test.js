/* Speed check against the local mock backend.
   1) MOCK_LATENCY=900 node tools/mock-server.js     (fresh start, every backend call waits 0.9 s like Apps Script)
   2) EI_EXTRA_CONNECT=http://localhost:8787 python3 tools/build_web.py
   3) node tools/perf-test.js
   Prints seconds and backend calls for: first visit, return visit, booking, rating, staff edit. */
const { chromium } = require("playwright");
const WEB = "http://localhost:8788/", API = "http://localhost:8787/";
const calls = async () => (await (await fetch(API + "__calls")).json()).calls;

async function timed(label, fn){
  const c0 = await calls(), t0 = Date.now();
  await fn();
  const s = ((Date.now() - t0) / 1000).toFixed(1), n = (await calls()) - c0;
  console.log(`${label.padEnd(34)} ${s.padStart(5)} s   ${String(n).padStart(2)} backend calls`);
}

(async () => {
  const b = await chromium.launch();
  const block = p => p.route(/cdnjs\.cloudflare\.com/, r => r.abort());
  // staff: sign in and load the starter data once
  const s = await (await b.newContext({ viewport: { width: 1200, height: 900 } })).newPage(); await block(s);
  await s.goto(WEB); await s.click("#adminTab"); await s.fill("#eiPw", "test1234"); await s.click("#eiLogin button:last-child");
  await s.waitForSelector(".soon button, #clinicName", { timeout: 20000 });
  const seed = await s.$(".soon button"); if (seed) { await seed.click(); await s.waitForLoadState(); }
  await s.waitForTimeout(2500);

  const ctx = await b.newContext({ viewport: { width: 420, height: 900 } }); const p = await ctx.newPage(); await block(p);
  // "ready" = the calendar is drawn and the first answer from the backend has arrived
  const ready = async () => { await p.waitForSelector(".day.open", { timeout: 30000 }); await p.waitForFunction(() => window.EI && window.EI.dataAt, null, { timeout: 30000 }); };
  await timed("parent: first visit until calendar", async () => { await p.goto(WEB); await ready(); });
  await timed("parent: return visit until calendar", async () => { await p.reload(); await ready(); });

  await p.click("#services .chip"); await p.click(".day.open"); await p.click(".slot:not([disabled])");
  for (const id of await p.$$eval("#formFields [id^=fld_]", els => els.map(e => e.id))) {
    const kind = await p.$eval("#" + id, e => e.tagName + "|" + e.type);
    if (kind.startsWith("SELECT")) await p.selectOption("#" + id, { index: 1 });
    else if (kind.endsWith("date")) await p.fill("#" + id, "2024-05-01");
    else await p.fill("#" + id, id === "fld_phone" ? "0812345678" : "ทดสอบ");
  }
  await p.fill("#famCode", "246810"); await p.check("#pdpa");
  await timed("parent: book until confirmed", async () => {
    await p.click("#submitBtn");
    await p.waitForFunction(() => /จองสำเร็จ|ไม่สำเร็จ|เต็ม/.test(document.getElementById("formMsg").textContent), null, { timeout: 60000 });
  });
  console.log("   message:", (await p.textContent("#formMsg")).slice(0, 40));
  await timed("parent: send rating until closed", async () => {
    await p.click('.face[data-v="5"]'); await p.click("#rateSend");
    await p.waitForFunction(() => document.getElementById("rateModal").hidden, null, { timeout: 60000 });
  });

  // staff adds a 3-day closure and waits for it to show in the list
  await timed("staff: add 3-day holiday until saved", async () => {
    await s.evaluate(() => { const v = (id, x) => document.getElementById(id).value = x;
      v("hFrom", "2031-01-15"); v("hTo", "2031-01-17"); v("hName", "ทดสอบความเร็ว"); document.getElementById("holForm").requestSubmit(); });
    await s.waitForFunction(() => (document.getElementById("holList").textContent.match(/ทดสอบความเร็ว/g) || []).length === 3, null, { timeout: 60000 });
    const shown = Date.now();
    await s.waitForFunction(() => /เพิ่ม 3 วันแล้ว/.test(document.getElementById("holMsg").textContent), null, { timeout: 60000 });
    console.log(`   (the list changed ${((Date.now() - shown) / 1000).toFixed(1)} s before the server confirmed)`);
  });
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
