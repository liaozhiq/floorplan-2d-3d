#!/usr/bin/env node
/**
 * validate-layout.mjs — 校验户型数据文件的自洽性
 *
 * 用法：node tools/validate-layout.mjs docs/layout-4br-2lr-2ba.json
 *
 * 检查项：
 *   1. 字段与数值合法性（墙是轴对齐矩形、类型码合法）
 *   2. 房间多边形是轴对齐矩形、面积为正、位于外包络内
 *   3. 房间之间互不重叠
 *   4. 房间内部不被墙体 / 窗 / 门洞占用
 *   5. 每条房间边都被「墙 ∪ 窗 ∪ 门洞 ∪ 推拉门」完整覆盖（不允许漏缝）
 *   6. 门洞：长边 = len、铰点在洞口角上、c/o 是互相垂直的轴向单位向量、不被墙体压住
 *   7. 推拉门：朝向与 v 一致、不被墙体压住
 *   8. 尺寸链各段之和 = 声明总长 = 外包络对应边长
 *   9. 家具：type 存在于 index.html 的 LIB，中心点落在某个房间内（仅提示）
 *
 * 退出码 0 = 全部通过；1 = 有错误。
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const scriptPath = process.argv.slice(2).find((a) => !a.startsWith('--')) || 'docs/layout-4br-2lr-2ba.json';
const POLY = process.argv.includes('--polygons');
// --open-edges=warn：把「房间边没墙」降级为警告。真实标注里开放通道（客厅↔餐厅、
// 室内↔阳台）本来就是通的，要求每条边都有墙会在 CubiCasa 这类数据上误报。
const OPEN_WARN = process.argv.includes('--open-edges=warn');
let openEdges = 0, openLen = 0;
// --overlaps=warn：房间多边形互相重叠也降级（CubiCasa 的标注并不保证互斥）
const OVER_WARN = process.argv.includes('--overlaps=warn');
let overPairs = 0, overArea = 0;
const EPS = 1;
const WTYPES = new Set(['b', 'e', 'n', 'low']);

const rectOfRoom = (poly) => {
  const xs = poly.map((p) => p[0]);
  const ys = poly.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
};
const areaRect = ([x0, y0, x1, y1]) => Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
const overlapArea = (a, b) => {
  const w = Math.min(a[2], b[2]) - Math.max(a[0], b[0]);
  const h = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
  return w > 0 && h > 0 ? w * h : 0;
};
const isAxisAlignedRect = (poly) => {
  if (!Array.isArray(poly) || poly.length !== 4) return false;
  for (let i = 0; i < 4; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % 4];
    if (!Array.isArray(a) || a.length !== 2) return false;
    if (a[0] !== b[0] && a[1] !== b[1]) return false;
  }
  const [x0, y0, x1, y1] = rectOfRoom(poly);
  return poly.every(([x, y]) => (x === x0 || x === x1) && (y === y0 || y === y1));
};
const pointInPoly = ([px, py], poly) => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};
const unitAxis = (v) => Array.isArray(v) && v.length === 2 && Number.isInteger(v[0]) && Number.isInteger(v[1]) && Math.abs(v[0]) + Math.abs(v[1]) === 1;
// 多边形房间用：鞋带面积、逐边（轴对齐）、按 20mm 栅格化的重叠判定
const areaPoly = (poly) => {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return Math.abs(a) / 2;
};
const polyEdges = (poly) => poly.map((p, i) => {
  const q = poly[(i + 1) % poly.length];
  const horiz = Math.abs(p[1] - q[1]) < 0.5;
  return { axis: horiz ? 'h' : 'v', at: horiz ? p[1] : p[0], a: horiz ? Math.min(p[0], q[0]) : Math.min(p[1], q[1]),
           b: horiz ? Math.max(p[0], q[0]) : Math.max(p[1], q[1]) };
}).filter((e) => e.b - e.a > 0);
const CELL = 20;
const raster = (poly) => {
  const [x0, y0, x1, y1] = rectOfRoom(poly);
  const out = new Set();
  for (let y = y0; y < y1; y += CELL) {
    for (let x = x0; x < x1; x += CELL) {
      if (pointInPoly([x + CELL / 2, y + CELL / 2], poly)) out.add(`${x},${y}`);
    }
  }
  return out;
};
const rasterOverlap = (a, b) => {
  const small = a.size < b.size ? a : b, big = a.size < b.size ? b : a;
  let n = 0;
  for (const k of small) if (big.has(k)) n++;
  return n * CELL * CELL;
};
const unionLen = (intervals, a, b) => {
  const iv = intervals
    .map(([s, e]) => [Math.max(s, a), Math.min(e, b)])
    .filter(([s, e]) => e - s > 0)
    .sort((p, q) => p[0] - q[0]);
  let total = 0;
  let cur = null;
  for (const seg of iv) {
    if (!cur) cur = seg.slice();
    else if (seg[0] <= cur[1]) cur[1] = Math.max(cur[1], seg[1]);
    else {
      total += cur[1] - cur[0];
      cur = seg.slice();
    }
  }
  if (cur) total += cur[1] - cur[0];
  return total;
};

function main() {
  const raw = readFileSync(resolve(process.cwd(), scriptPath), 'utf8');
  const L = JSON.parse(raw);

  const errors = [];
  const warnings = [];
  const err = (m) => errors.push(m);
  const warn = (m) => warnings.push(m);

  // ---------- 1. 基本字段 ----------
  const env = L.envelope;
  if (!env || !(env.w > 0) || !(env.h > 0)) err('envelope.w / envelope.h 缺失或非正数');
  for (const k of ['walls', 'wins', 'doors', 'slides', 'rooms', 'dimChains']) {
    if (!Array.isArray(L[k])) err(`缺少数组字段 ${k}`);
  }

  const roomRects = [];
  const cover = [];
  const libTypes = new Set();

  if (!errors.length) {
    L.walls.forEach((w, i) => {
      if (![w.x0, w.y0, w.x1, w.y1].every(Number.isFinite)) return err(`walls[${i}] 坐标非数值`);
      if (w.x1 <= w.x0 || w.y1 <= w.y0) err(`walls[${i}] 不是正矩形: ${JSON.stringify(w)}`);
      if (!WTYPES.has(w.t)) err(`walls[${i}] 类型码 "${w.t}" 非法（只能是 b/e/n/low）`);
    });

    cover.push(
      ...L.walls.map((w) => [w.x0, w.y0, w.x1, w.y1]),
      ...L.wins.map((w) => [w[0], w[1], w[2], w[3]]),
      ...L.doors.map((d) => d.rect),
      ...L.slides.map((s) => s.rect)
    );

    // ---------- 2/3/4. 房间 ----------
    L.rooms.forEach((r, i) => {
      if (!r.id || !r.name) err(`rooms[${i}] 缺少 id 或 name`);
      if (!Array.isArray(r.poly) || r.poly.length < 3) return err(`rooms[${i}] (${r.id}) poly 非法`);
      if (!POLY && !isAxisAlignedRect(r.poly)) err(`rooms[${i}] (${r.id}) poly 不是轴对齐矩形（加 --polygons 可放宽为任意正交多边形）`);
      const R = rectOfRoom(r.poly);
      const area = POLY ? areaPoly(r.poly) : areaRect(R);
      if (area <= 0) err(`rooms[${i}] (${r.id}) 面积为 0`);
      roomRects.push({ id: r.id, name: r.name, R, poly: r.poly, area, raster: POLY ? raster(r.poly) : null });
      if (R[0] < -300 || R[1] < -300 || R[2] > env.w + 300 || R[3] > env.h + 300) {
        err(`rooms[${i}] (${r.id}) 超出外包络 ${JSON.stringify(R)}`);
      }
      if (r.at && !pointInPoly(r.at, r.poly)) warn(`rooms[${i}] (${r.id}) 的 at 标签点不在房间多边形内`);
      if (!POLY) {
        cover.forEach((c) => {
          const ov = overlapArea(R, c);
          if (ov > EPS) err(`rooms[${i}] (${r.id}) 与几何 ${JSON.stringify(c)} 重叠 ${ov} mm^2`);
        });
      } else {
        // 多边形模式：用栅格化判断，避免用外接矩形误判 L 形房间
        const rs = roomRects[roomRects.length - 1].raster;
        cover.forEach((c) => {
          const ov = rasterOverlap(rs, raster([[c[0], c[1]], [c[2], c[1]], [c[2], c[3]], [c[0], c[3]]]));
          if (ov > CELL * CELL) err(`rooms[${i}] (${r.id}) 与几何 ${JSON.stringify(c)} 重叠 ${ov} mm^2`);
        });
      }
    });
    for (let i = 0; i < roomRects.length; i++) {
      for (let j = i + 1; j < roomRects.length; j++) {
        const ov = POLY
          ? rasterOverlap(roomRects[i].raster, roomRects[j].raster)
          : overlapArea(roomRects[i].R, roomRects[j].R);
        if (ov > (POLY ? CELL * CELL : EPS)) {
          if (OVER_WARN) { overPairs++; overArea += ov; }
          else err(`房间重叠: ${roomRects[i].id} 与 ${roomRects[j].id} 重叠 ${ov} mm^2`);
        }
      }
    }

    // ---------- 5. 每条房间边必须被完整覆盖 ----------
    roomRects.forEach(({ id, R, poly }) => {
      const [x0, y0, x1, y1] = R;
      const edges = POLY ? polyEdges(poly).map((e, k) => ({ ...e, name: `#${k}` })) : [
        { name: 'N', axis: 'h', at: y0, a: x0, b: x1 },
        { name: 'S', axis: 'h', at: y1, a: x0, b: x1 },
        { name: 'W', axis: 'v', at: x0, a: y0, b: y1 },
        { name: 'E', axis: 'v', at: x1, a: y0, b: y1 },
      ];
      edges.forEach((e) => {
        const iv = cover
          .filter((c) => (e.axis === 'h' ? c[1] <= e.at && e.at <= c[3] : c[0] <= e.at && e.at <= c[2]))
          .map((c) => (e.axis === 'h' ? [c[0], c[2]] : [c[1], c[3]]));
        const need = e.b - e.a;
        const covered = unionLen(iv, e.a, e.b);
        if (need - covered > EPS) {
          const gap = Math.round(need - covered);
          if (OPEN_WARN) { openEdges++; openLen += gap; }
          else err(`房间 ${id} 的 ${e.name} 边有 ${gap} mm 未被墙/窗/门覆盖（漏缝）`);
        }
      });
    });

    // ---------- 6/7. 门与推拉门 ----------
    const wallHit = (rect) => L.walls.filter((w) => overlapArea(rect, [w.x0, w.y0, w.x1, w.y1]) > EPS);

    L.doors.forEach((d, i) => {
      const tag = `doors[${i}] ${d.name || ''}`.trim();
      const rect = d.rect;
      if (!Array.isArray(rect) || rect.length !== 4) return err(`${tag} rect 非法`);
      const [x0, y0, x1, y1] = rect;
      const w = x1 - x0;
      const h = y1 - y0;
      const long = Math.max(w, h);
      const short = Math.min(w, h);
      if (long <= 0 || short <= 0) return err(`${tag} 洞口尺寸非法 ${w}x${h}`);
      if (short > 400) err(`${tag} 洞口过厚（${short}mm），应贴着墙厚`);
      if (Math.abs(long - d.len) > EPS) err(`${tag} len=${d.len} 与洞口长边 ${long} 不符`);
      if (!unitAxis(d.c)) err(`${tag} c 必须是轴向单位向量 [±1,0] 或 [0,±1]`);
      if (!unitAxis(d.o)) err(`${tag} o 必须是轴向单位向量 [±1,0] 或 [0,±1]`);
      if (unitAxis(d.c) && unitAxis(d.o) && d.c[0] * d.o[0] + d.c[1] * d.o[1] !== 0) err(`${tag} c 与 o 必须互相垂直`);
      const corners = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
      if (Array.isArray(d.h) && !corners.some((c) => c[0] === d.h[0] && c[1] === d.h[1])) {
        err(`${tag} 铰点 h=${JSON.stringify(d.h)} 不在洞口四角上`);
      }
      const hits = wallHit(rect);
      if (hits.length) err(`${tag} 被墙体压住: ${JSON.stringify(hits.map((w) => [w.x0, w.y0, w.x1, w.y1]))}`);
    });

    L.slides.forEach((s, i) => {
      const tag = `slides[${i}]`;
      const rect = s.rect;
      if (!Array.isArray(rect) || rect.length !== 4) return err(`${tag} rect 非法`);
      if (typeof s.v !== 'boolean') err(`${tag} v 必须是 true（竖向）/ false（横向）`);
      const [x0, y0, x1, y1] = rect;
      if (x1 - x0 <= 0 || y1 - y0 <= 0) return err(`${tag} 洞口尺寸非法`);
      const vertical = y1 - y0 > x1 - x0;
      if (vertical !== s.v) err(`${tag} v=${s.v} 与实际朝向（竖向=${vertical}）不符`);
      const hits = wallHit(rect);
      if (hits.length) err(`${tag} 被墙体压住: ${JSON.stringify(hits.map((w) => [w.x0, w.y0, w.x1, w.y1]))}`);
    });

    // ---------- 8. 尺寸链 ----------
    L.dimChains.forEach((c, i) => {
      if (!Array.isArray(c.segs) || !c.segs.length) return err(`dimChains[${i}] segs 非法`);
      if (!['h', 'v'].includes(c.dir)) err(`dimChains[${i}] dir 必须是 'h' 或 'v'`);
      const sum = c.segs.reduce((a, b) => a + b, 0);
      const dim = c.dir === 'h' ? env.w : env.h;
      if (Math.abs(sum - dim) > EPS) err(`dimChains[${i}] ${c.dir} 链段之和 ${sum} ≠ 包络 ${dim}`);
      if (c.total !== undefined && Math.abs(c.total - sum) > EPS) err(`dimChains[${i}] total=${c.total} ≠ 链段之和 ${sum}`);
    });

    // ---------- 9. 家具（可选） ----------
    const idxHtml = resolve(here, '..', 'index.html');
    if (existsSync(idxHtml)) {
      const html = readFileSync(idxHtml, 'utf8');
      const m = html.match(/const LIB = \[([\s\S]*?)\n\];/);
      if (m) for (const t of m[1].matchAll(/'([a-z]+)',\s*'/g)) libTypes.add(t[1]);
    }
    const items = (L.furniture && L.furniture.items) || [];
    items.forEach((f, i) => {
      if (!f.type) return err(`furniture.items[${i}] 缺少 type`);
      if (libTypes.size && !libTypes.has(f.type)) err(`furniture.items[${i}] type "${f.type}" 不在 index.html 的 LIB 里`);
      if (!(f.w > 0) || !(f.d > 0)) err(`furniture.items[${i}] 宽深必须为正`);
      if (!roomRects.some((r) => pointInPoly([f.cx, f.cy], r.poly))) {
        warn(`furniture.items[${i}] (${f.type}) 中心点不在任何房间内，可能压在墙上`);
      }
    });
  }

  // ---------- 输出 ----------
  const bedCount = roomRects.filter((r) => /卧|房/.test(r.name || '') && !/衣帽|书|厨房|房卫/.test(r.name || '')).length;
  const total = roomRects.reduce((a, r) => a + r.area / 1e6, 0);
  console.log(`file            : ${scriptPath}`);
  console.log(`rooms           : ${roomRects.length}  (卧室类 ${bedCount})`);
  console.log(`net area        : ${total.toFixed(2)} m2`);
  for (const r of roomRects) console.log(`  - ${r.id.padEnd(9)} ${(r.area / 1e6).toFixed(2).padStart(7)} m2`);
  console.log(`walls/wins/doors: ${L.walls.length} / ${L.wins.length} / ${L.doors.length}`);
  console.log(`lib types known : ${libTypes.size || '(index.html 未找到，跳过家具类型校验)'}`);
  console.log(`errors          : ${errors.length}`);
  for (const e of errors) console.log(`  ERROR ${e}`);
  console.log(`warnings        : ${warnings.length}`);
  for (const w of warnings) console.log(`  WARN  ${w}`);
  if (OPEN_WARN && openEdges) console.log(`open passages   : ${openEdges} 段 / 共 ${(openLen / 1000).toFixed(1)} m（已按开放通道降级，不算错误）`);
  if (OVER_WARN && overPairs) console.log(`room overlaps   : ${overPairs} 对 / 共 ${(overArea / 1e6).toFixed(2)} m2（标注本身重叠，已降级）`);
  process.exit(errors.length ? 1 : 0);
}

main();
