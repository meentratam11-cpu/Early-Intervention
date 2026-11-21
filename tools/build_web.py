#!/usr/bin/env python3
"""Build the public website (docs/index.html) from src/app.html.

src/app.html is the claude.ai version of the page. This script wraps it in a full
HTML document, loads the Apps Script connector (docs/js/shim.js) and swaps the
claude.ai-specific wording and staff sign-in for the public-website ones.
Run:  python3 tools/build_web.py
"""
import json, os, sys
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
src = open(os.path.join(ROOT, "src", "app.html"), encoding="utf-8").read()

def rep(a, b):
    global src
    if src.count(a) != 1:
        sys.exit(f"build_web: expected exactly one match for: {a[:70]!r} (found {src.count(a)})")
    src = src.replace(a, b)

# wording that only made sense on claude.ai
rep('"มุมมองนี้ดาวน์โหลดไฟล์ไม่ได้ เปิดหน้านี้ใน claude.ai แล้วลองอีกครั้ง"', '"เบราว์เซอร์นี้ดาวน์โหลดไฟล์ไม่ได้ ลองเปิดด้วย Chrome หรือ Safari"')
rep('"เชื่อมต่อระบบไม่ได้ ต้องเปิดหน้านี้ใน claude.ai และเข้าสู่ระบบก่อนจองคิว"', '"เชื่อมต่อระบบไม่ได้ ตรวจสอบอินเทอร์เน็ตแล้วรีเฟรชหน้า"')
rep('"ดูตารางได้ แต่ยังจองไม่ได้: กรุณาเข้าสู่ระบบ claude.ai ก่อนจองคิว"', '"ระบบยังไม่พร้อมใช้งาน (ยังไม่ได้ตั้งค่าการเชื่อมต่อ) กรุณาติดต่อศูนย์"')
rep('"ยังเชื่อมต่อระบบไม่ได้ กรุณาเข้าสู่ระบบ claude.ai"', '"ยังเชื่อมต่อระบบไม่ได้ ลองรีเฟรชหน้า"')
rep('"มุมมองนี้บันทึกไฟล์ไม่ได้ ลองเปิดหน้านี้ใน claude.ai บนเว็บเบราว์เซอร์"', '"เบราว์เซอร์นี้บันทึกไฟล์ไม่ได้ ลองเปิดด้วย Chrome หรือ Safari"')
rep('"ต้องเข้าสู่ระบบ claude.ai ก่อนจึงจะส่งเรื่องได้ หรือโทรหาศูนย์ตามเบอร์ด้านบน"', '"ส่งเรื่องไม่ได้ในขณะนี้ กรุณาโทรหาศูนย์ตามเบอร์ด้านบน"')
rep('<h3 style="margin-top:8px">นัดที่จองจากบัญชีนี้</h3>', '<h3 style="margin-top:8px">นัดที่จองจากเครื่องนี้</h3>')

# staff: the lock button always shows; signed-out visitors get the password box
rep('$("adminTab").addEventListener("click", () => showTab("admin"));',
    '$("adminTab").addEventListener("click", () => (S.isAdmin ? showTab("admin") : window.EI.staffLogin()));')
rep('if(S.isAdmin){ $("adminTab").hidden=false; resetDraft(); adminBoot(); }',
    '$("adminTab").hidden=false;\n  if(S.isAdmin){ resetDraft(); adminBoot(); window.EI.offerSeed(); }')
rep('<button type="button" class="btn ghost" id="lockBtn">ล็อก</button>',
    '<button type="button" class="btn ghost" id="lockBtn">ล็อก</button><button type="button" class="btn ghost" onclick="EI.staffLogout()">ออกจากระบบ</button>')

# PDPA: parents agree to how their data is used before booking
rep('      <div id="formCal" class="row" hidden></div>',
    '      <label class="consent" for="pdpa"><input type="checkbox" id="pdpa"> <span><b>ยินยอมให้เก็บข้อมูล (จำเป็น)</b><br>ข้าพเจ้ายินยอมให้ศูนย์เก็บและใช้ข้อมูลของข้าพเจ้าและบุตร เฉพาะเพื่อการนัดหมาย การประเมิน และการดูแลพัฒนาการเด็กเท่านั้น ศูนย์จะไม่เปิดเผยข้อมูลแก่บุคคลอื่นโดยไม่ได้รับความยินยอม และขอให้ลบข้อมูลได้โดยติดต่อศูนย์</span></label>\n      <div id="formCal" class="row" hidden></div>')
rep('const code = $("famCode").value.trim(); if(!/^\\d{6}$/.test(code)) errs.push("ตั้งรหัสเช็คคิวเป็นตัวเลข 6 หลัก");',
    'const code = $("famCode").value.trim(); if(!/^\\d{6}$/.test(code)) errs.push("ตั้งรหัสเช็คคิวเป็นตัวเลข 6 หลัก");\n  if(!(S.isAdmin && $("staffMode").checked) && !$("pdpa").checked) errs.push("กรุณาอ่านและกดยินยอมการเก็บข้อมูลก่อนจอง");')

# ---- speed ----
# The Excel library (~900 KB) is only needed when staff export, so load it then instead of on every visit.
rep('<script src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"></script>\n', '')
rep('  if(typeof XLSX==="undefined"){ msg("xMsg","โหลดตัวสร้างไฟล์ Excel ไม่สำเร็จ ลองรีเฟรชหน้า","err"); return; }',
    '  if(typeof XLSX==="undefined"){ msg("xMsg","กำลังเตรียมไฟล์ Excel…");\n'
    '    try{ await loadScript("https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"); }catch(e){ msg("xMsg","โหลดตัวสร้างไฟล์ Excel ไม่สำเร็จ ตรวจสอบอินเทอร์เน็ตแล้วลองอีกครั้ง","err"); return; }\n'
    '    msg("xMsg"); }')

# Booking: the server picks the seat and saves the booking in one trip (was 5-6 trips one after another).
rep("""    const takenId = await claimSeat(S.date, S.slot, owner, bid);
    if(!takenId){ msg("formMsg","ช่วงเวลานี้เพิ่งเต็ม กรุณาเลือกเวลาอื่น","err"); return; }
    const rec = { ...out, id:bid, date:S.date, slot:S.slot, service:S.service, status:"confirmed", famCode:code,
      createdAt:new Date().toISOString(), channel: staff ? "เจ้าหน้าที่บันทึก" : "ออนไลน์", takenId, needsRating: !staff };
    const ref = S.db.doc("bookings/"+owner);
    const snap = await ref.get();
    if(snap.exists) await ref.update({items:{[bid]:rec}, updatedAt:rec.createdAt});
    else await ref.set({items:{[bid]:rec}, updatedAt:rec.createdAt});""",
"""    const rec = { ...out, id:bid, date:S.date, slot:S.slot, service:S.service, status:"confirmed", famCode:code,
      createdAt:new Date().toISOString(), channel: staff ? "เจ้าหน้าที่บันทึก" : "ออนไลน์", takenId:"$TAKEN", needsRating: !staff };
    const takenId = await window.EI.claim(S.date, slotKey(S.slot), owner, bid,
      [{op:"merge", path:"bookings/"+owner, data:{items:{[bid]:rec}, updatedAt:rec.createdAt}}]);
    if(!takenId){ msg("formMsg","ช่วงเวลานี้เพิ่งเต็ม กรุณาเลือกเวลาอื่น","err"); return; }
    rec.takenId = takenId;""")
rep("""  if(active && (moved || !wasActive)){
    const t = await claimSeat(next.date, next.slot, owner, rec.id);
    if(!t){ const e = new Error("full"); e.code="full"; throw e; }
    next.takenId = t; release = wasActive;
  }
  if(!active){ next.takenId = ""; next.cancelledAt = rec.cancelledAt || now; release = wasActive; }
  await S.db.doc("bookings/"+owner).update({items:{[rec.id]:next}, updatedAt:now});
  if(release && rec.takenId) await S.db.doc("taken/"+rec.takenId).delete();""",
"""  if(active && (moved || !wasActive)){
    const then = [{op:"update", path:"bookings/"+owner, data:{items:{[rec.id]:{...next, takenId:"$TAKEN"}}, updatedAt:now}}];
    if(wasActive && rec.takenId) then.push({op:"delete", path:"taken/"+rec.takenId});
    const t = await window.EI.claim(next.date, slotKey(next.slot), owner, rec.id, then);
    if(!t){ const e = new Error("full"); e.code="full"; throw e; }
    return;
  }
  if(!active){ next.takenId = ""; next.cancelledAt = rec.cancelledAt || now; release = wasActive; }
  const writes = [{op:"update", path:"bookings/"+owner, data:{items:{[rec.id]:next}, updatedAt:now}}];
  if(release && rec.takenId) writes.push({op:"delete", path:"taken/"+rec.takenId});
  await window.EI.batch(writes);""")

# Rating: one trip instead of three.
rep("""    const fref = S.db.doc("feedback/"+owner), fsnap = await fref.get();
    if(fsnap.exists) await fref.update({items:{[rec.id]:entry}}); else await fref.set({items:{[rec.id]:entry}});
    await S.db.doc("bookings/"+owner).update({items:{[rec.id]:{rated:true}}});""",
"""    await window.EI.batch([{op:"merge", path:"feedback/"+owner, data:{items:{[rec.id]:entry}}},
      {op:"update", path:"bookings/"+owner, data:{items:{[rec.id]:{rated:true}}}}]);""")

# Holidays: a range of days is saved in one trip instead of one trip per day.
rep('    for(const d of days) await S.db.doc("holidays/"+d).set({date:d, name});',
    '    await window.EI.batch(days.map(d=>({op:"set", path:"holidays/"+d, data:{date:d, name}})));')

# Open the connection to the backend while the page is still loading.
rep('<link rel="preconnect" href="https://fonts.googleapis.com">',
    '<link rel="preconnect" href="https://script.google.com" crossorigin>\n<link rel="preconnect" href="https://script.googleusercontent.com" crossorigin>\n'
    '<link rel="preconnect" href="https://fonts.googleapis.com">\n<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>')

# ---- booking button: always pressable; say what is still missing instead of staying grey ----
rep('  $("submitBtn").disabled = !ok || !S.db || S.readOnly;', '  $("submitBtn").disabled = !S.db || S.readOnly;')
rep('  const {out, errs} = readFields(S.cfg.fields.filter(f=>f.on), "fld_");',
    '  const {out, errs} = readFields(S.cfg.fields.filter(f=>f.on), "fld_");\n'
    '  const miss = [!S.service && "บริการ", !S.date && "วันที่", !S.slot && "เวลา"].filter(Boolean);\n'
    '  if(miss.length){ msg("formMsg", "ยังไม่ได้เลือก: " + miss.join(" · ") + " (เลือกที่ด้านบน ช่วงเวลาที่ขึ้นว่า \\"เต็มแล้ว\\" เลือกไม่ได้)", "err");\n'
    '    (S.service ? (S.date ? $("slots") : $("cal")) : $("services")).scrollIntoView({behavior:"smooth", block:"center"}); return; }')

# Content-Security-Policy: the page may only talk to itself and to the Apps Script backend
extra = os.environ.get("EI_EXTRA_CONNECT", "")   # tests only, e.g. http://localhost:8787
CSP = ("default-src 'self'; "
       "script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com; "
       "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
       "font-src https://fonts.gstatic.com data:; "
       "img-src 'self' data: blob:; "
       f"connect-src 'self' blob: data: https://script.google.com https://script.googleusercontent.com {extra}".rstrip() + "; "
       "worker-src 'self' blob:; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'")


# Clearer controls on phones: solid colour for what is chosen, white boxes with real borders, big tick box.
MOBILE_CSS = """<style>
/* tick boxes were styled like text boxes and shrank to a dot on phones */
input[type=checkbox],input[type=radio]{width:24px;height:24px;min-width:24px;padding:0;margin:0;flex:none;accent-color:var(--accent);cursor:pointer}
input:not([type=checkbox]):not([type=radio]):not([type=range]),select,textarea{background:#fff;border:2px solid #cbbfe0;min-height:48px;font-size:16px}
textarea{min-height:90px}
input:focus,select:focus,textarea:focus{border-color:var(--accent);background:#fff;box-shadow:0 0 0 3px var(--accent-soft)}
input::placeholder,textarea::placeholder{color:#8a8ca3}
label.f{font-size:.95rem;font-weight:600}
/* consent box */
.consent{display:flex;gap:12px;align-items:flex-start;padding:14px 16px;border:2px solid #e3a3b2;border-radius:16px;background:#fff6f8;font-size:.9rem;line-height:1.55;cursor:pointer;margin-top:6px}
.consent input{width:28px;height:28px;min-width:28px;margin-top:2px;outline:2px solid #d98a9c;outline-offset:1px;border-radius:6px}
.consent:has(input:checked) input{outline-color:var(--leaf)}
.consent b{font-size:1rem;color:var(--ink)}
.consent:has(input:checked){border-color:var(--leaf);background:#f1f8ec}
/* tabs */
.tabs button{color:var(--ink);font-weight:600;min-height:44px}
.tabs button[aria-selected="true"]{background:var(--accent);color:#fff;box-shadow:none}
/* services */
.chip{border:2px solid var(--c);background:#fff;font-weight:600;min-height:48px;padding:10px 18px;box-shadow:0 3px 0 -1px color-mix(in srgb,var(--c) 45%,transparent)}
.chip[aria-pressed="true"]{background:var(--accent);border-color:var(--accent);color:#fff;box-shadow:0 3px 0 -1px color-mix(in srgb,var(--accent) 55%,transparent)}
.chip[aria-pressed="true"]::before{content:"✓ "}
/* days you can book */
.day.open{background:#fff;border:2px solid color-mix(in srgb,var(--leaf) 60%,#fff)}
.day .t{font-size:.7rem}
.day.sel,.day.open.sel{background:var(--accent);border:2px solid var(--accent);color:#fff}
.day.sel .t{color:#fff}
/* time slots */
.slot{border:2px solid color-mix(in srgb,var(--leaf) 60%,#fff);background:#fff;min-height:58px;font-weight:600}
.slot[aria-pressed="true"]{background:var(--accent);border-color:var(--accent);color:#fff}
.slot[aria-pressed="true"] small{color:#fff}
.slot{position:relative}
.slot[aria-pressed="true"]::after{content:"✓";position:absolute;bottom:10px;right:14px;font-size:1.3rem;line-height:1}
.slot:disabled{background:var(--sunk);border-color:transparent;opacity:.6}
/* buttons */
.btn{min-height:46px}
#submitBtn{min-height:56px;font-size:1.1rem;padding:12px 32px}
@media (max-width:600px){
  #submitBtn{width:100%}
  #form .row.end{justify-content:stretch}
  .tabs button{padding:8px 14px}
}
</style>"""

static = json.load(open(os.path.join(ROOT, "docs", "files", "index.json"), encoding="utf-8"))
head = f'''<!doctype html>
<html lang="th"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="description" content="จองคิว เช็คคิว รายงานพัฒนาการ และความรู้ส่งเสริมพัฒนาการเด็ก">
<meta http-equiv="Content-Security-Policy" content="{CSP}">
<meta name="referrer" content="no-referrer">
<style>:root{{color-scheme:light;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}}body{{margin:0}}img{{max-width:100%}}[hidden]{{display:none!important}}</style>
<script src="js/config.js"></script>
<script>window.EI_STATIC_ASSETS = {json.dumps({k: "files/" + v for k, v in static.items()})};</script>
<script src="js/shim.js"></script>
</head><body>
'''
open(os.path.join(ROOT, "docs", "index.html"), "w", encoding="utf-8").write(head + src + "\n" + MOBILE_CSS + "\n</body></html>\n")
print("docs/index.html written")
