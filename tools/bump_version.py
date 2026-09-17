#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""docs/app.js の APP_VERSION と docs/sw.js の VERSION を同じ日付版に同時更新する。
引数なし: 今日の日付 vYYYY-MM-DD.N（同日なら N+1）。引数あり: その文字列（例 v2026-09-20.3）。"""
import re
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
APP = ROOT / "docs" / "app.js"
SW = ROOT / "docs" / "sw.js"

app = APP.read_text(encoding="utf-8")
sw = SW.read_text(encoding="utf-8")
cur = re.search(r"const APP_VERSION = '(v[^']+)'", app).group(1)

if len(sys.argv) > 1:
    new = sys.argv[1]
else:
    today = date.today().isoformat()
    n = 1
    m = re.match(rf"v{today}\.(\d+)$", cur)
    if m:
        n = int(m.group(1)) + 1
    new = f"v{today}.{n}"

app2 = re.sub(r"const APP_VERSION = 'v[^']+'", f"const APP_VERSION = '{new}'", app, count=1)
sw2 = re.sub(r"const VERSION = 'shop-visit-v[^']+'", f"const VERSION = 'shop-visit-{new}'", sw, count=1)
if app2 == app or sw2 == sw:
    sys.exit("置換に失敗（パターン不一致）")
APP.write_text(app2, encoding="utf-8")
SW.write_text(sw2, encoding="utf-8")
print(f"{cur} -> {new}  (app.js / sw.js)")
