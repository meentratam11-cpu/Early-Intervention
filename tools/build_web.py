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

static = json.load(open(os.path.join(ROOT, "docs", "files", "index.json"), encoding="utf-8"))
head = f'''<!doctype html>
<html lang="th"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="description" content="จองคิว เช็คคิว รายงานพัฒนาการ และความรู้ส่งเสริมพัฒนาการเด็ก">
<style>:root{{color-scheme:light;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}}body{{margin:0}}img{{max-width:100%}}[hidden]{{display:none!important}}</style>
<script src="js/config.js"></script>
<script>window.EI_STATIC_ASSETS = {json.dumps({k: "files/" + v for k, v in static.items()})};</script>
<script src="js/shim.js"></script>
</head><body>
'''
open(os.path.join(ROOT, "docs", "index.html"), "w", encoding="utf-8").write(head + src + "\n</body></html>\n")
print("docs/index.html written")
