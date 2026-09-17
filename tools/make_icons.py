#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""PWAアイコン生成（依存なし・swing-app/tools/make_icons.py と同型）。紺背景＋橙のピン＋白い店舗マーク。"""
import math
import struct
import zlib
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "docs" / "icons"

BG = (27, 42, 65)        # 紺
PIN = (255, 140, 66)     # 橙
PIN_DARK = (200, 95, 30)
WHITE = (245, 247, 250)


def make(size, path):
    s = size
    px = bytearray()
    cx, cy = 0.5 * s, 0.42 * s
    r = 0.26 * s            # ピン頭の半径
    tip_y = 0.88 * s        # ピン先端
    for y in range(s):
        row = bytearray([0])
        for x in range(s):
            c = BG
            # ピン本体: 円＋下向き三角
            d = math.hypot(x - cx, y - cy)
            in_circle = d < r
            in_tri = False
            if cy < y < tip_y:
                half = r * (tip_y - y) / (tip_y - cy) * 0.92
                in_tri = abs(x - cx) < half
            if in_circle or in_tri:
                edge = max(0.0, min(1.0, (r - d) / (0.06 * s))) if in_circle else 0.6
                c = tuple(int(PIN_DARK[i] + (PIN[i] - PIN_DARK[i]) * edge) for i in range(3))
            # 店舗マーク（白い家型）: ピン頭の中
            hx, hy = cx, cy + 0.02 * s
            hw, hh = 0.13 * s, 0.10 * s
            roof = (y >= hy - hh * 0.9) and (abs(x - hx) <= hw * (y - (hy - hh * 0.9)) / (hh * 0.9)) and (y < hy)
            body = (hy <= y <= hy + hh) and (abs(x - hx) <= hw * 0.78)
            door = (hy + hh * 0.45 <= y <= hy + hh) and (abs(x - hx) <= hw * 0.18)
            if (roof or body) and not door:
                c = WHITE
            row += bytes(c)
        px += row

    def chunk(tag, data):
        raw = tag + data
        return struct.pack(">I", len(data)) + raw + struct.pack(">I", zlib.crc32(raw))

    ihdr = struct.pack(">IIBBBBB", s, s, 8, 2, 0, 0, 0)
    png = (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr)
           + chunk(b"IDAT", zlib.compress(bytes(px), 9)) + chunk(b"IEND", b""))
    path.write_bytes(png)
    print(f"{path.name}: {len(png):,} bytes")


OUT.mkdir(parents=True, exist_ok=True)
make(192, OUT / "icon-192.png")
make(512, OUT / "icon-512.png")
