#!/usr/bin/env node
/**
 * render-layout.mjs — 把 layout JSON 画成 PNG，用于肉眼核对转换结果
 *
 * 用法：node tools/render-layout.mjs docs/samples/r2v/plan-a.json --out=docs/samples/r2v/plan-a.png
 *
 * 不依赖任何第三方库：自己扫描线填充 + 自带 PNG 编码（zlib + CRC32）。
 * 颜色约定与应用 2D 平面一致：房间浅色、墙体深色、门洞橙色。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const argv = process.argv.slice(2);
const inPath = argv.find((a) => !a.startsWith('--'));
if (!inPath) { console.error('用法: node tools/render-layout.mjs <layout.json> [--out=path] [--px=1200]'); process.exit(2); }
const arg = (k, d) => { const h = argv.find((a) => a.startsWith(`--${k}=`)); return h ? h.split('=')[1] : d; };
const OUT = arg('out', inPath.replace(/\.json$/, '.png'));
const MAXPX = +arg('px', 1200);
const ISO = argv.includes('--iso');
const WALL_H = +arg('wall-height', 2800);
const L = JSON.parse(readFileSync(inPath, 'utf8'));

// ---------- 等轴测 3D 预览（--iso）----------
// 与应用的 Three.js 场景使用同一份数据：墙拉伸到层高、房间铺地、窗户做玻璃条。
if (ISO) {
  const COS = Math.cos(Math.PI / 6), SIN = Math.sin(Math.PI / 6);
  const MG = 40;                                          // 自成一体，不依赖后面才声明的常量
  const MATC_I = { wood: '#f0dfc4', walnut: '#e3cdb4', tile800: '#eae6de', tile600: '#e2e7e5', marble: '#f2efe9', antislip: '#dde3df', terrazzo: '#e9e2d6', carpet: '#ded9e6' };
  const hexI = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const proj = (x, y, z) => [(x - y) * COS, (x + y) * SIN - z];
  const faces = [];                                     // {pts:[[sx,sy]...], color, depth}
  const shade = (c, k) => c.map((v) => Math.max(0, Math.min(255, Math.round(v * k))));

  // 房间地面
  for (const r of L.rooms) {
    const col = hexI(MATC_I[r.mat] || '#eeeeee');
    const pts = r.poly.map(([x, y]) => proj(x, y, 0));
    const depth = r.poly.reduce((a, [x, y]) => a + x + y, 0) / r.poly.length;
    faces.push({ pts, color: shade(col, 0.82), depth: depth + 0.1, kind: 'floor' });
  }
  // 墙体：顶面 + 朝向相机的两个侧面
  for (const w of L.walls) {
    const [x0, y0, x1, y1] = [w.x0, w.y0, w.x1, w.y1];
    const h = WALL_H;
    faces.push({ pts: [proj(x0, y0, h), proj(x1, y0, h), proj(x1, y1, h), proj(x0, y1, h)],
      color: [214, 210, 202], depth: (x0 + x1 + y0 + y1) / 4 + (x1 - x0 + y1 - y0) * 0.5 });
    faces.push({ pts: [proj(x1, y0, 0), proj(x1, y1, 0), proj(x1, y1, h), proj(x1, y0, h)],
      color: [196, 191, 182], depth: (x1 + y0 + y1) / 3 });
    faces.push({ pts: [proj(x0, y1, 0), proj(x1, y1, 0), proj(x1, y1, h), proj(x0, y1, h)],
      color: [172, 167, 159], depth: (x0 + x1 + y1 * 2) / 4 });
  }
  // 窗：玻璃条（900–2400mm），画在墙上显得通透
  for (const win of L.wins || []) {
    const [x0, y0, x1, y1] = win;
    const z0 = 900, z1 = 2400;
    const col = [150, 200, 226];
    faces.push({ pts: [proj(x1, y0, z0), proj(x1, y1, z0), proj(x1, y1, z1), proj(x1, y0, z1)], color: col, depth: (x1 + y0 + y1) / 3 + 5 });
    faces.push({ pts: [proj(x0, y1, z0), proj(x1, y1, z0), proj(x1, y1, z1), proj(x0, y1, z1)], color: shade(col, 0.86), depth: (x0 + x1 + y1 * 2) / 4 + 5 });
  }

  // 求投影包围盒
  let sx0 = Infinity, sy0 = Infinity, sx1 = -Infinity, sy1 = -Infinity;
  for (const f of faces) for (const [px, py] of f.pts) {
    sx0 = Math.min(sx0, px); sx1 = Math.max(sx1, px);
    sy0 = Math.min(sy0, py); sy1 = Math.max(sy1, py);
  }
  const sc = (MAXPX - MG * 2) / Math.max(sx1 - sx0, sy1 - sy0);
  const Wpx = Math.ceil((sx1 - sx0) * sc) + MG * 2, Hpx = Math.ceil((sy1 - sy0) * sc) + MG * 2;
  const iso = Buffer.alloc(Wpx * Hpx * 3, 0xf7);
  const putI = (x, y, c) => {
    const i = (Math.round(y) * Wpx + Math.round(x)) * 3;
    if (i < 0 || i + 2 >= iso.length) return;
    iso[i] = c[0]; iso[i + 1] = c[1]; iso[i + 2] = c[2];
  };
  const fillPolyI = (pts, color) => {
    const P2 = pts.map(([px, py]) => [MG + (px - sx0) * sc, MG + (py - sy0) * sc]);
    const ys = P2.map((p) => p[1]);
    for (let y = Math.max(0, Math.floor(Math.min(...ys))); y <= Math.min(Hpx - 1, Math.ceil(Math.max(...ys))); y++) {
      const xs = [];
      for (let i = 0; i < P2.length; i++) {
        const a = P2[i], b = P2[(i + 1) % P2.length];
        if ((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y)) xs.push(a[0] + (y - a[1]) / (b[1] - a[1]) * (b[0] - a[0]));
      }
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        for (let x = Math.ceil(xs[k]); x <= Math.floor(xs[k + 1]); x++) putI(x, y, color);
      }
    }
  };
  // 画家算法：远（x+y 小）先画
  faces.sort((a, b) => a.depth - b.depth).forEach((f) => fillPolyI(f.pts, f.color));

  const crcT = (() => {
    const t = new Int32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; }
    return t;
  })();
  const crc = (b) => { let c = -1; for (const v of b) c = crcT[(c ^ v) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; };
  const chunk2 = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const cb = Buffer.alloc(4); cb.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, cb]);
  };
  const ih = Buffer.alloc(13);
  ih.writeUInt32BE(Wpx, 0); ih.writeUInt32BE(Hpx, 4); ih[8] = 8; ih[9] = 2;
  const raw2 = Buffer.alloc((Wpx * 3 + 1) * Hpx);
  for (let y = 0; y < Hpx; y++) {
    raw2[y * (Wpx * 3 + 1)] = 0;
    iso.copy(raw2, y * (Wpx * 3 + 1) + 1, y * Wpx * 3, (y + 1) * Wpx * 3);
  }
  writeFileSync(OUT, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk2('IHDR', ih), chunk2('IDAT', deflateSync(raw2, { level: 9 })), chunk2('IEND', Buffer.alloc(0)),
  ]));
  console.log(`${OUT}  ${Wpx}×${Hpx}px  ISO  walls=${L.walls.length} wins=${(L.wins || []).length} rooms=${L.rooms.length}`);
  process.exit(0);
}

// ---------- 画布 ----------
const MARGIN = 40;
let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
const grow = (x, y) => { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); };
L.rooms.forEach((r) => r.poly.forEach(([x, y]) => grow(x, y)));
L.walls.forEach((w) => { grow(w.x0, w.y0); grow(w.x1, w.y1); });
const spanX = maxX - minX || 1, spanY = maxY - minY || 1;
const s = (MAXPX - MARGIN * 2) / Math.max(spanX, spanY);
const Wpx = Math.ceil(spanX * s) + MARGIN * 2, Hpx = Math.ceil(spanY * s) + MARGIN * 2;
const P = (x, y) => [MARGIN + (x - minX) * s, MARGIN + (y - minY) * s];

const buf = Buffer.alloc(Wpx * Hpx * 3, 0xf7);              // 米白底
const put = (x, y, [r, g, b]) => {
  const i = (Math.round(y) * Wpx + Math.round(x)) * 3;
  if (i < 0 || i + 2 >= buf.length) return;
  buf[i] = r; buf[i + 1] = g; buf[i + 2] = b;
};
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

// 扫描线填充多边形
function fillPoly(poly, color) {
  const pts = poly.map(([x, y]) => P(x, y));
  const ys = pts.map((p) => p[1]);
  const y0 = Math.max(0, Math.floor(Math.min(...ys))), y1 = Math.min(Hpx - 1, Math.ceil(Math.max(...ys)));
  for (let y = y0; y <= y1; y++) {
    const xs = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      if ((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y)) {
        xs.push(a[0] + (y - a[1]) / (b[1] - a[1]) * (b[0] - a[0]));
      }
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      for (let x = Math.ceil(xs[k]); x <= Math.floor(xs[k + 1]); x++) put(x, y, color);
    }
  }
}
function fillRect(r, color) {
  const [x0, y0, x1, y1] = r;
  const [px0, py0] = P(x0, y0), [px1, py1] = P(x1, y1);
  for (let y = Math.floor(py0); y < Math.ceil(py1); y++) for (let x = Math.floor(px0); x < Math.ceil(px1); x++) put(x, y, color);
}

// ---------- 绘制 ----------
const MATC = { wood: '#f0dfc4', walnut: '#e3cdb4', tile800: '#eae6de', tile600: '#e2e7e5', marble: '#f2efe9', antislip: '#dde3df', terrazzo: '#e9e2d6', carpet: '#ded9e6' };
for (const r of L.rooms) fillPoly(r.poly, hex(MATC[r.mat] || '#eeeeee'));
for (const r of L.rooms) {                                   // 房间轮廓
  const pts = r.poly.map(([x, y]) => P(x, y));
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const n = Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]));
    for (let t = 0; t <= n; t++) { const k = n ? t / n : 0; put(a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, [150, 143, 132]); }
  }
}
// 家具（rot 多为 0/90，按长宽互换处理）；示意布置用虚线描边区分
for (const f of (L.furniture && L.furniture.items) || []) {
  const w = f.rot % 180 === 0 ? f.w : f.d, d = f.rot % 180 === 0 ? f.d : f.w;
  const x0 = f.cx - w / 2, y0 = f.cy - d / 2;
  const sug = !!f.suggested;
  fillRect([x0, y0, x0 + w, y0 + d], sug ? [234, 229, 220] : [205, 196, 182]);
  const [px0, py0] = P(x0, y0), [px1, py1] = P(x0 + w, y0 + d);
  for (let t = 0; t <= Math.max(px1 - px0, py1 - py0); t++) {
    if (sug && Math.floor(t / 5) % 2) continue;             // 虚线段
    const kx = (px1 - px0) ? t / (px1 - px0) : 0, ky = (py1 - py0) ? t / (py1 - py0) : 0;
    if (kx <= 1) { put(px0 + t, py0, [150, 140, 126]); put(px0 + t, py1, [150, 140, 126]); }
    if (ky <= 1) { put(px0, py0 + t, [150, 140, 126]); put(px1, py0 + t, [150, 140, 126]); }
  }
}

for (const w of L.wins || []) fillRect([w[0], w[1], w[2], w[3]], [150, 196, 222]);   // 窗：浅蓝
for (const d of L.doors || []) fillRect(d.rect, [200, 110, 60]);                     // 门洞：橙
for (const w of L.walls) fillRect([w.x0, w.y0, w.x1, w.y1], [38, 36, 32]);  // 墙压在最上层

// ---------- PNG 编码 ----------
const crcTable = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; }
  return t;
})();
const crc32 = (b) => { let c = -1; for (const v of b) c = crcTable[(c ^ v) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; };
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(Wpx, 0); ihdr.writeUInt32BE(Hpx, 4);
ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
const raw = Buffer.alloc((Wpx * 3 + 1) * Hpx);
for (let y = 0; y < Hpx; y++) {
  raw[y * (Wpx * 3 + 1)] = 0;
  buf.copy(raw, y * (Wpx * 3 + 1) + 1, y * Wpx * 3, (y + 1) * Wpx * 3);
}
writeFileSync(OUT, Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
]));
console.log(`${OUT}  ${Wpx}×${Hpx}px  ${(s).toFixed(4)} px/mm  rooms=${L.rooms.length} walls=${L.walls.length} doors=${(L.doors || []).length}`);
