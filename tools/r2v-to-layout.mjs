#!/usr/bin/env node
/**
 * r2v-to-layout.mjs — 把 R2V / FloorplanTransformation 的矢量标注转成 layout JSON
 *
 * CLI：
 *   node tools/r2v-to-layout.mjs docs/samples/r2v/plan-b.txt --out=docs/samples/r2v/plan-b.json
 * 模块：
 *   import { convertR2V } from './r2v-to-layout.mjs';
 *   const { layout, stats } = convertR2V(txt, { doorMM: 800, wallMM: 200 });
 *
 * 输入每行：x0 y0 x1 y1 category d1 d2
 *   wall  = 中心线两端点
 *   door  = 门洞线段（叠在连续的墙上）
 *   其它  = 一个区域（房间种子 / 家具图标）
 *
 * 该数据的三处硬伤，也是这里的三处处理：
 *   1. 坐标没有尺度 → 用「单开门宽」先验反推 mm/unit（取门长 25 分位，避开宽洞）
 *   2. 墙是中心线 → 按墙厚膨胀成网格，再合并成互不重叠的矩形
 *   3. 房间只是种子点 → 非墙连通域 + 边界串环，得到正交多边形
 *   注：该数据集**没有窗**标注，输出的 wins 恒为空。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOM_TYPES = new Set(['bedroom', 'living_room', 'dining_room', 'kitchen', 'corridor', 'bathroom',
  'restroom', 'washing_room', 'balcony', 'closet', 'PS', 'entrance', 'storage', 'office',
  'laundry_room', 'stairs', 'dining', 'living']);
const ZH = {
  bedroom: '卧室', living_room: '客厅', living: '客厅', dining_room: '餐厅', dining: '餐厅',
  kitchen: '厨房', corridor: '过道', bathroom: '浴室', restroom: '卫生间', washing_room: '盥洗室',
  balcony: '阳台', closet: '衣帽间', PS: '管道井', entrance: '玄关', storage: '储物间',
  office: '书房', laundry_room: '洗衣房', stairs: '楼梯',
};
const MAT = (t) => (['bathroom', 'restroom', 'washing_room', 'balcony', 'PS'].includes(t) ? 'antislip'
  : ['kitchen', 'corridor', 'living_room', 'dining_room'].includes(t) ? 'tile800'
  : 'wood');

const MATS = {
  wood: { name: '橡木地板', price: 320, sw: '#d8b88a' },
  walnut: { name: '胡桃木地板', price: 380, sw: '#9b7250' },
  tile800: { name: '800 地砖', price: 220, sw: '#ebe6dc' },
  tile600: { name: '600 地砖', price: 160, sw: '#dfe3e1' },
  marble: { name: '大理石', price: 650, sw: '#f1eee8' },
  antislip: { name: '300 防滑砖', price: 140, sw: '#d3d8d4' },
  terrazzo: { name: '水磨石', price: 280, sw: '#e6dfd3' },
  carpet: { name: '满铺地毯', price: 200, sw: '#c9c3d3' },
};

export function convertR2V(text, opts = {}) {
  const DOOR_MM = opts.doorMM ?? 800;
  const WALL_MM = opts.wallMM ?? 200;
  const NAME = opts.name ?? 'r2v';

  // ---------- 解析 ----------
  const items = text.split(/\r?\n/).filter((l) => l.trim())
    .map((l) => { const c = l.trim().split(/\s+/); return { x0: +c[0], y0: +c[1], x1: +c[2], y1: +c[3], cat: c[4] }; })
    .filter((o) => [o.x0, o.y0, o.x1, o.y1].every(Number.isFinite) && o.cat);

  const walls = items.filter((o) => o.cat === 'wall');
  const doors = items.filter((o) => o.cat === 'door');
  const seeds = items.filter((o) => ROOM_TYPES.has(o.cat));
  if (!walls.length) throw new Error('输入里没有 wall 记录');

  // ---------- 1. 尺度推定：门长 25 分位 ----------
  const doorLen = doors.map((d) => Math.hypot(d.x1 - d.x0, d.y1 - d.y0)).filter((v) => v > 0).sort((a, b) => a - b);
  const q25 = doorLen.length ? doorLen[Math.floor(doorLen.length * 0.25)] : 0;
  const mmPerUnit = q25 > 0 ? DOOR_MM / q25 : 20;
  const toMM = (v) => Math.round(v * mmPerUnit);

  // ---------- 2. 墙：中心线膨胀 → 网格 ----------
  const pad = Math.ceil(WALL_MM / mmPerUnit);
  const minX = Math.min(...walls.flatMap((w) => [w.x0, w.x1])) - pad;
  const minY = Math.min(...walls.flatMap((w) => [w.y0, w.y1])) - pad;
  const maxX = Math.max(...walls.flatMap((w) => [w.x0, w.x1])) + pad;
  const maxY = Math.max(...walls.flatMap((w) => [w.y0, w.y1])) + pad;
  const W = Math.ceil(maxX - minX), H = Math.ceil(maxY - minY);
  const half = Math.max(1, Math.round(WALL_MM / mmPerUnit / 2));
  const grid = new Uint8Array(W * H);
  const at = (x, y) => grid[y * W + x];

  for (const w of walls) {
    const horiz = Math.abs(w.y1 - w.y0) <= Math.abs(w.x1 - w.x0);   // 近轴吸附
    const x0 = Math.round(Math.min(w.x0, w.x1) - minX), x1 = Math.round(Math.max(w.x0, w.x1) - minX);
    const y0 = Math.round(Math.min(w.y0, w.y1) - minY), y1 = Math.round(Math.max(w.y0, w.y1) - minY);
    for (let y = Math.max(0, y0 - half); y <= Math.min(H - 1, y1 + half); y++) {
      for (let x = Math.max(0, x0 - half); x <= Math.min(W - 1, x1 + half); x++) {
        if (horiz) { if (y >= y0 - half && y <= y0 + half) grid[y * W + x] = 1; }
        else { if (x >= x0 - half && x <= x0 + half) grid[y * W + x] = 1; }
      }
    }
  }

  // 房间分割用连续墙；输出墙体用扣掉门洞的副本（我们的模型要求墙在门处断开）
  const wgrid = Uint8Array.from(grid);
  const doorCells = doors.map((d) => {
    const vertical = Math.abs(d.x1 - d.x0) < Math.abs(d.y1 - d.y0);
    const x0 = Math.round(Math.min(d.x0, d.x1) - minX), x1 = Math.round(Math.max(d.x0, d.x1) - minX);
    const y0 = Math.round(Math.min(d.y0, d.y1) - minY), y1 = Math.round(Math.max(d.y0, d.y1) - minY);
    const cells = [];
    for (let y = Math.max(0, y0); y <= Math.min(H - 1, y1); y++) {
      for (let x = Math.max(0, x0 - half); x <= Math.min(W - 1, x0 + half); x++) {
        if (vertical ? (x >= x0 - half && x <= x0 + half) : (y >= y0 - half && y <= y0 + half)) cells.push([x, y]);
      }
    }
    for (const [x, y] of cells) wgrid[y * W + x] = 0;
    return cells;
  });
  const atW = (x, y) => wgrid[y * W + x];

  // 行内游程 + 跨行合并 → 互不重叠的墙矩形
  const wallRects = [];
  let open = new Map();
  for (let y = 0; y < H; y++) {
    const runs = [];
    let x = 0;
    while (x < W) {
      if (atW(x, y)) { const s = x; while (x < W && atW(x, y)) x++; runs.push([s, x - 1]); }
      else x++;
    }
    const next = new Map();
    for (const [s, e] of runs) {
      const key = `${s}:${e}`;
      if (open.has(key)) next.set(key, open.get(key));
      else next.set(key, { s, e, y0: y, y1: y });
    }
    for (const [key, r] of open) if (!next.has(key)) wallRects.push(r);
    for (const [key, r] of next) r.y1 = y;
    open = next;
  }
  for (const r of open.values()) wallRects.push(r);
  // 网格坐标 0 已经等于 minX，直接乘比例即可，不要再加 minX
  const toLRect = (r) => [toMM(r.s), toMM(r.y0), toMM(r.e + 1), toMM(r.y1 + 1)];

  // ---------- 3. 房间：非墙连通域 → 边界串环 ----------
  const comp = new Int32Array(W * H).fill(-1);
  const comps = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (at(x, y) || comp[y * W + x] >= 0) continue;
      const id = comps.length, cells = [];
      const stack = [[x, y]]; comp[y * W + x] = id;
      while (stack.length) {
        const [cx, cy] = stack.pop(); cells.push([cx, cy]);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = cx + dx, ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          if (at(nx, ny) || comp[ny * W + nx] >= 0) continue;
          comp[ny * W + nx] = id; stack.push([nx, ny]);
        }
      }
      comps.push(cells);
    }
  }

  function polygonOf(cells) {
    const set = new Set(cells.map(([x, y]) => x * 100000 + y));
    const inSet = (x, y) => set.has(x * 100000 + y);
    const edges = new Map();                               // "x,y" → [x,y]
    const push = (ax, ay, bx, by) => edges.set(`${ax},${ay}`, [bx, by]);
    for (const [x, y] of cells) {
      if (!inSet(x, y - 1)) push(x, y, x + 1, y);
      if (!inSet(x, y + 1)) push(x + 1, y + 1, x, y + 1);
      if (!inSet(x - 1, y)) push(x, y + 1, x, y);
      if (!inSet(x + 1, y)) push(x + 1, y, x + 1, y + 1);
    }
    const used = new Set();
    let best = null, bestArea = 0;
    for (const key of edges.keys()) {
      if (used.has(key)) continue;
      const loop = []; let cur = key;
      while (cur && !used.has(cur)) {
        used.add(cur);
        const [x, y] = cur.split(',').map(Number);
        loop.push([x, y]);
        const nxt = edges.get(cur);
        cur = nxt ? `${nxt[0]},${nxt[1]}` : null;
      }
      let a = 0;
      for (let i = 0; i < loop.length; i++) {
        const [x1, y1] = loop[i], [x2, y2] = loop[(i + 1) % loop.length];
        a += x1 * y2 - x2 * y1;
      }
      a = Math.abs(a) / 2;
      if (a > bestArea) { bestArea = a; best = loop; }
    }
    if (!best) return null;
    const out = [];
    for (let i = 0; i < best.length; i++) {
      const p = best[(i - 1 + best.length) % best.length], c = best[i], n = best[(i + 1) % best.length];
      if ((c[0] - p[0]) * (n[1] - c[1]) - (c[1] - p[1]) * (n[0] - c[0]) !== 0) out.push(c);
    }
    return out;
  }

  const rooms = [];
  for (let id = 0; id < comps.length; id++) {
    const cells = comps[id];
    if (cells.length < 4) continue;
    let type = null;
    for (const s of seeds) {
      const sx = Math.round((s.x0 + s.x1) / 2 - minX), sy = Math.round((s.y0 + s.y1) / 2 - minY);
      if (sx < 0 || sy < 0 || sx >= W || sy >= H) continue;
      if (comp[sy * W + sx] === id) { type = s.cat; break; }
    }
    const touchesBorder = cells.some(([x, y]) => x <= 0 || y <= 0 || x >= W - 1 || y >= H - 1);
    const areaAll = (cells.length * mmPerUnit * mmPerUnit) / 1e6;
    if (!type) {
      if (touchesBorder || areaAll < 0.5) continue;        // 无种子的封闭小空间也要保留，否则平面图留白
      type = '__unknown';
    }
    const poly = polygonOf(cells);
    if (!poly || poly.length < 4) continue;
    if (type !== '__unknown' && areaAll < 0.6) continue;
    const cx = cells.reduce((s, [x]) => s + x + 0.5, 0) / cells.length;
    const cy = cells.reduce((s, [, y]) => s + y + 0.5, 0) / cells.length;
    rooms.push({
      id: `${id}`,
      name: type === '__unknown' ? '未知空间' : (ZH[type] || type),
      poly: poly.map(([x, y]) => [toMM(x), toMM(y)]),
      mat: type === '__unknown' ? 'tile600' : MAT(type),
      at: [toMM(cx), toMM(cy)],
      counted: type !== 'PS' && type !== '__unknown',
      srcType: type,
      areaMM: areaAll,
    });
  }

  // ---------- 4. 门 ----------
  const doorsOut = doors.map((d, i) => {
    const cells = doorCells[i];
    if (!cells.length) return null;
    let gx0 = Infinity, gy0 = Infinity, gx1 = -Infinity, gy1 = -Infinity;
    for (const [x, y] of cells) {
      gx0 = Math.min(gx0, x); gy0 = Math.min(gy0, y);
      gx1 = Math.max(gx1, x); gy1 = Math.max(gy1, y);
    }
    const rect = [toMM(gx0), toMM(gy0), toMM(gx1 + 1), toMM(gy1 + 1)];
    const vertical = (rect[3] - rect[1]) > (rect[2] - rect[0]);
    const h = vertical ? [rect[0], rect[3]] : [rect[0], rect[1]];   // 铰点必须在洞口角上
    return {
      name: '门', rect,
      h, c: vertical ? [0, -1] : [1, 0], o: vertical ? [1, 0] : [0, -1],
      len: Math.round(vertical ? rect[3] - rect[1] : rect[2] - rect[0]),
      entry: false,
    };
  }).filter(Boolean);

  // ---------- 5. 组装 ----------
  const envW = toMM(maxX - minX), envH = toMM(maxY - minY);
  const layout = {
    schemaVersion: 1,
    id: NAME,
    name: NAME,
    unit: 'mm',
    origin: '左上角（由 R2V 标注推定，原点为墙体外接框左上角）',
    note: `尺度按单开门 ${DOOR_MM}mm 先验推定（${mmPerUnit.toFixed(3)} mm/unit，取门长 25 分位），墙厚按 ${WALL_MM}mm 膨胀。该数据集不含窗。`,
    envelope: { w: envW, h: envH },
    defaults: { wallHeight: 2800, planScale: 60, extWall: WALL_MM, intWall: WALL_MM },
    bounds: { x: -1200, y: -1200, w: envW + 2400, h: envH + 2400 },
    walls: wallRects.map((r) => { const [x0, y0, x1, y1] = toLRect(r); return { x0, y0, x1, y1, t: 'n' }; }),
    wins: [],
    doors: doorsOut,
    slides: [],
    rooms: rooms.map(({ id, name, poly, mat, at, counted }) => ({ id, name, poly, mat, at, counted })),
    mats: MATS,
    dimChains: [
      { dir: 'h', at: -700, start: 0, segs: [envW], total: envW },
      { dir: 'h', at: envH + 700, start: 0, segs: [envW], total: envW },
      { dir: 'v', at: -700, start: 0, segs: [envH], total: envH },
      { dir: 'v', at: envW + 700, start: 0, segs: [envH], total: envH },
    ],
    furniture: { note: '未转换（R2V 的图标类别与 LIB 的 type 没有一一对应）', items: [] },
  };

  const bedrooms = rooms.filter((r) => r.srcType === 'bedroom').length;
  const counted = rooms.filter((r) => r.counted !== false);
  const stats = {
    walls: walls.length, doors: doors.length, seeds: seeds.length,
    mmPerUnit, q25, doorMM: DOOR_MM, wallMM: WALL_MM,
    envW, envH, outWalls: layout.walls.length, outDoors: layout.doors.length,
    rooms: rooms.length, bedrooms,
    netArea: counted.reduce((a, r) => a + r.areaMM, 0),
    roomList: rooms,
  };
  return { layout, stats };
}

export function formatReport(stats, label) {
  const lines = [
    `input      : ${label}`,
    `records    : wall ${stats.walls}, door ${stats.doors}, seed ${stats.seeds}`,
    `scale      : ${stats.mmPerUnit.toFixed(3)} mm/unit  (door q25 = ${stats.q25.toFixed(1)} unit → ${stats.doorMM} mm)`,
    `envelope   : ${stats.envW} × ${stats.envH} mm`,
    `output     : walls ${stats.outWalls}, doors ${stats.outDoors}, rooms ${stats.rooms} (bedroom ${stats.bedrooms})`,
    `net area   : ${stats.netArea.toFixed(2)} m2`,
  ];
  for (const r of stats.roomList.slice().sort((a, b) => b.areaMM - a.areaMM)) {
    lines.push(`  - ${String(r.srcType).padEnd(14)} ${r.name.padEnd(6)} ${r.areaMM.toFixed(2).padStart(7)} m2`);
  }
  return lines.join('\n');
}

// ---------- CLI ----------
const isCli = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isCli) {
  const argv = process.argv.slice(2);
  const inPath = argv.find((a) => !a.startsWith('--'));
  if (!inPath) { console.error('用法: node tools/r2v-to-layout.mjs <input.txt> [--out=path] [--door=800] [--wall=200]'); process.exit(2); }
  const arg = (k, d) => { const h = argv.find((a) => a.startsWith(`--${k}=`)); return h ? h.split('=')[1] : d; };
  const OUT = arg('out', inPath.replace(/\.txt$/, '.json'));
  const NAME = arg('name', `r2v-${inPath.split(/[\\/]/).pop().replace(/\.txt$/, '')}`);
  const txt = readFileSync(inPath, 'utf8');
  const { layout, stats } = convertR2V(txt, { doorMM: +arg('door', 800), wallMM: +arg('wall', 200), name: NAME });
  writeFileSync(OUT, JSON.stringify(layout, null, 2), 'utf8');
  console.log(formatReport(stats, inPath));
  console.log(`wrote ${OUT}`);
}
