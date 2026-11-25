#!/usr/bin/env node
/**
 * cubicasa-to-layout.mjs — 把 CubiCasa5K 的 model.svg 转成 layout JSON
 *
 * 用法：
 *   node tools/cubicasa-to-layout.mjs <sample-dir> --out=out.json
 *   node tools/cubicasa-to-layout.mjs <sample-dir>/model.svg --out=out.json --door=800 --window-mm=1500
 *
 * 数据来源与许可：CubiCasa5K（SCIA 2019），CC BY-NC-SA 4.0 —— 仅限非商业用途。
 *
 * SVG 语法（见官方 floortrans/loaders/svg_utils.py）：
 *   <g id="Wall"><polygon points="x,y ..."/></g>
 *   <g id="Window"><polygon .../></g>         ← 有窗，这一点比 R2V 强
 *   <g id="Door"><polygon .../></g>
 *   <g class="Space Bedroom"><polygon .../></g>  ← 房间是完整多边形，不用恢复
 *   <g class="FixedFurniture Bed"><g class="BoundaryPolygon"><polygon .../></g></g>
 * 坐标就是标准的 "x,y"（官方代码里 `y, x = split` 的变量名起反了，但后面 polygon(X,Y) 又换了回来）。
 *
 * 与 R2V 一样，**没有毫米尺度**：用「单开门宽」先验反推 mm/px（取门宽 25 分位）。
 */
import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// ---------- 房间词表 ----------
// 房间名的处理原则：**忠实翻译原始标签**，不做有损归并。
// 官方的 room_name_map 是为 12 类分割任务压缩过的（Office→Room、Outdoor Balcony→Outdoor），
// 那会丢掉数据里本来有的信息，所以这里不用它，而是逐个标签翻译。
// 翻不出来的标签**保持英文原样** —— 宁可显示数据原值，也不猜一个中文名安上去。
const ROOM_ZH = {
  Undefined: '未定义空间', UserDefined: '自定义空间', Room: '房间',
  Bedroom: '卧室', LivingRoom: '客厅', Dining: '餐厅', Kitchen: '厨房',
  Bath: '卫生间', Bathroom: '卫生间', Sauna: '桑拿房',
  Entry: '门厅', Hall: '厅', HallWay: '过道', Corridor: '过道', DraughtLobby: '门斗', Lobby: '门厅',
  Closet: '衣帽间', DressingRoom: '更衣室', Wardrobe: '衣柜间', Storage: '储物间', Pantry: '食品储藏间',
  Utility: '家政间', ServiceRoom: '杂务间', TechnicalRoom: '设备间', Laundry: '洗衣间',
  Outdoor: '室外', Balcony: '阳台', Terrace: '露台', Porch: '门廊',
  Garage: '车库', CarPort: '车棚', StairWell: '楼梯间', Stairs: '楼梯',
  Office: '办公间', Study: '书房', Library: '书房', Den: '小起居室',
  Alcove: '壁龛', Attic: '阁楼', Loft: '阁楼', Basement: '地下室', Conservatory: '阳光房',
  SunRoom: '日光房', Lounge: '休息厅', Nook: '凹室', EatingArea: '餐区',
  RecreationRoom: '娱乐室', ExerciseRoom: '健身房', MediaRoom: '影音室', Theatre: '影厅',
  MeetingRoom: '会议室', ConferenceRoom: '会议室', Reception: '接待室', Ballroom: '宴会厅',
  Bar: '吧台', Counter: '操作台', Elevator: '电梯', Elevated: '挑高空间', Garbage: '垃圾间',
  HotTub: '热水池', SwimmingPool: '泳池', Church: '礼拜堂', Museum: '展厅', Sanctuary: '圣所',
  RetailSpace: '商业空间', ServingArea: '备餐区', Skylights: '天窗下空间', Stable: '马厩',
  Stage: '舞台', Below150cm: '净高不足区', Fireplace: '壁炉区',
};
// 子类型后缀（官方标签里有 "Bath Shower"、"Closet WalkIn" 这种两段式）
const ROOM_PAIR_ZH = {
  'Entry Lobby': '门厅', 'Kitchen Kitchenette': '小厨房', 'Bath Shower': '淋浴卫生间',
  'Closet WalkIn': '步入式衣帽间', 'Utility Laundry': '洗衣家政间', 'Den Fireplace': '带壁炉小起居室',
  'TechnicalRoom Boiler': '锅炉房', 'Outdoor Terrace': '室外露台', 'Outdoor Balcony': '室外阳台',
  'Outdoor Porch': '室外门廊', 'Outdoor Pergola': '室外凉亭', 'Outdoor Balcony Glazed': '封闭阳台',
  'Outdoor CoveredArea': '有顶室外区',
};
const ROOM_SUB_ZH = { Balcony: '阳台', Terrace: '露台', Porch: '门廊', WalkIn: '步入式', Shower: '淋浴',
  Kitchenette: '小厨房', Fireplace: '壁炉', Boiler: '锅炉', Laundry: '洗衣', Lobby: '门厅',
  Glazed: '封闭', CoveredArea: '有顶区', Pergola: '凉亭' };

// 标签 → 中文名：优先整串匹配，其次「主类型 + 子类型」，最后退回原始标签（不猜）
function translateRoom(label){
  if (ROOM_PAIR_ZH[label]) return ROOM_PAIR_ZH[label];
  const parts = String(label).trim().split(/\s+/);
  const main = ROOM_ZH[parts[0]];
  if (!main) return label;                                  // 未收录 → 原样显示
  const sub = parts[1] ? ROOM_SUB_ZH[parts[1]] : '';
  return sub ? main + sub : main;
}
// 地面材料：只按"湿区/室外/起居"这类**可从标签判断**的类别给，判不出的用木地板
function matFor(label){
  const s = String(label);
  if (/^Outdoor|Garage|CarPort/.test(s)) return 'tile600';
  if (/^Bath|Sauna|Shower|Laundry/.test(s)) return 'antislip';
  if (/^Kitchen/.test(s)) return 'tile600';
  if (/^LivingRoom|Living|Dining|Lounge|Entry|Hall/.test(s)) return 'tile800';
  return 'wood';
}
const SKIP_ROOM = new Set(['Wall', 'Railing', 'Background', 'OpenToBelow']);
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

// ---------- 尺度：从 SVG 自带的房间尺寸标注反解 ----------
// CubiCasa5K 的 SVG 里，每个房间组（g.Space X）内都嵌着原图纸印刷的房间真实尺寸
// （DimensionMeasureLabel，文本形如 13'6" x 20'4"）。用「真实面积 / 像素面积」即可反解比例。
// 实测 313 套 / 706+ 个标注：p1–p99 = 9.95–10.02 mm/单位 → **SVG 用户单位 = 10mm**。
// 这是数据集自带的固定比例，不是假设。
const DIM_RE = /(\d+)\s*'\s*(\d+(?:\.\d+)?)?\s*"?\s*[x×]\s*(\d+)\s*'\s*(\d+(?:\.\d+)?)?/i;
const ftIn2mm = (ft, inch) => (+ft) * 304.8 + (+inch) * 25.4;
const polyPts = (s) => {
  const nums = s.trim().split(/[\s,]+/).map(Number).filter(Number.isFinite);
  const out = [];
  for (let i = 0; i + 1 < nums.length; i += 2) out.push([nums[i], nums[i + 1]]);
  return out;
};
const bboxWH = (p) => {
  const xs = p.map((v) => v[0]), ys = p.map((v) => v[1]);
  return [Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
};

export function scaleFromLabels(txt) {
  const tagRe = /<\/?([A-Za-z:]+)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>|([^<]+)/g;
  const stack = []; const spaceIdx = []; const pairs = [];
  let m;
  while ((m = tagRe.exec(txt))) {
    if (m[4] !== undefined) {
      const text = m[4].trim();
      if (!text || !spaceIdx.length) continue;
      const cur = stack[spaceIdx[spaceIdx.length - 1]];
      if (!cur.dim) { const t = text.match(DIM_RE); if (t) cur.dim = [ftIn2mm(t[1], t[2] || 0), ftIn2mm(t[3], t[4] || 0)]; }
      continue;
    }
    const raw = m[0], name = m[1].toLowerCase(), selfClose = m[3] === '/';
    if (raw.startsWith('</')) {
      // 比较下标而不是对象
      const wasSpace = spaceIdx.length > 0 && spaceIdx[spaceIdx.length - 1] === stack.length - 1;
      const popped = stack.pop();
      if (wasSpace && spaceIdx.length) { spaceIdx.pop(); if (popped && popped.poly && popped.dim) pairs.push(popped); }
      continue;
    }
    const attrs = {};
    for (const a of m[2].matchAll(/([:\w-]+)\s*=\s*"([^"]*)"/g)) attrs[a[1]] = a[2];
    if (name === 'polygon' && attrs.points && spaceIdx.length) {
      const cur = stack[spaceIdx[spaceIdx.length - 1]];
      if (!cur.poly) cur.poly = polyPts(attrs.points);
      continue;
    }
    if (selfClose) continue;
    const isSpace = name === 'g' && /^Space\s/.test(attrs.class || '');
    stack.push({ isSpace, poly: null, dim: null });
    if (isSpace) spaceIdx.push(stack.length - 1);
  }
  const scales = [];
  for (const r of pairs) {
    const [w, h] = bboxWH(r.poly);
    if (w < 5 || h < 5) continue;
    const rp = w / h, rm = r.dim[0] / r.dim[1];
    if (!(Math.abs(rp / rm - 1) < 0.3 || Math.abs(rp * rm - 1) < 0.3)) continue;   // 长宽比校验
    const s = Math.sqrt((r.dim[0] * r.dim[1]) / (w * h));
    if (s > 1 && s < 100) scales.push(s);
  }
  if (!scales.length) return null;
  scales.sort((a, b) => a - b);
  return { median: scales[Math.floor(scales.length / 2)], n: scales.length, min: scales[0], max: scales[scales.length - 1] };
}

// ---------- 家具：CubiCasa 的 FixedFurniture 标注 ----------
// 重要限制：这批标注只有**固定家具**（橱柜/水槽/马桶/淋浴/家电/桑拿凳/壁炉…共 54 类），
// **没有床、沙发、餐桌、椅子**（活动家具不标注）。所以卧室/客厅仍会是空的。
// 只映射能对上的类别；对不上的**跳过并如实报告**，不硬凑成某个家具。
const FURN_MAP = {
  Closet: ['wardrobe', '衣柜'], CoatCloset: ['wardrobe', '衣柜'], WallCabinet: ['cabinet', '吊柜'],
  BaseCabinet: ['counter', '橱柜'], Housing: ['cabinet', '柜体'],
  Sink: ['ksink', '水槽'], RoundSink: ['ksink', '水槽'], DoubleSink: ['ksink', '双盆水槽'],
  DoubleSinkRight: ['ksink', '双盆水槽'],
  Toilet: ['toilet', '马桶'], Shower: ['shower', '淋浴房'], ShowerScreen: ['shower', '淋浴隔断'],
  Bathtub: ['bathtub', '浴缸'],
  'ElectricalAppliance Refrigerator': ['fridge', '冰箱'],
  'ElectricalAppliance WashingMachine': ['washer', '洗衣机'],
  'ElectricalAppliance TumbleDryer': ['dryer', '烘干机'],
  'ElectricalAppliance Dishwasher': ['dishwasher', '洗碗机'],
  'ElectricalAppliance IntegratedFridge': ['fridge', '嵌入式冰箱'],
};
// 明确不映射（项目里没有对应 3D 模型，或属装饰件）：SaunaBench* / Fireplace* / Chimney /
// ElectricalAppliance SaunaStove / Heater / SpaceForAppliance / CoatRack / Misc

// ---------- 极简 XML 扫描器（够用即可：只需要 g 的属性 + 后代元素里的坐标）----------
function parseSvg(text) {
  const els = [];
  const stack = [];
  const tagRe = /<\/?([A-Za-z:]+)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;
  let m;
  while ((m = tagRe.exec(text))) {
    const raw = m[0], name = m[1].toLowerCase(), selfClose = m[3] === '/';
    if (raw.startsWith('</')) { stack.pop(); continue; }
    const attrs = {};
    for (const a of m[2].matchAll(/([:\w-]+)\s*=\s*"([^"]*)"/g)) attrs[a[1]] = a[2];
    const el = { tag: name, attrs, points: [], parent: stack.length ? stack[stack.length - 1] : null, children: [] };
    if (el.parent) el.parent.children.push(el);
    els.push(el);
    if (name === 'polygon' && attrs.points) el.points = parsePoints(attrs.points);
    if (name === 'rect') {
      const x = +(attrs.x || 0), y = +(attrs.y || 0), w = +(attrs.width || 0), h = +(attrs.height || 0);
      if (w > 0 && h > 0) el.points = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
    }
    if (!selfClose && !['polygon', 'rect', 'path', 'line', 'circle', 'ellipse', 'image'].includes(name)) stack.push(el);
  }
  return els;
}
function parsePoints(s) {
  const nums = s.trim().split(/[\s,]+/).map(Number).filter((v) => Number.isFinite(v));
  const pts = [];
  for (let i = 0; i + 1 < nums.length; i += 2) pts.push([nums[i], nums[i + 1]]);
  return pts;
}
// 收集一个元素（含后代）的所有多边形，取面积最大的那个作为它的形状
function shapeOf(el) {
  const rings = [];
  const walk = (e) => { if (e.points.length >= 3) rings.push(e.points); e.children.forEach(walk); };
  walk(el);
  if (!rings.length) return null;
  let best = rings[0], bestA = 0;
  for (const r of rings) {
    let a = 0;
    for (let i = 0; i < r.length; i++) { const p = r[i], q = r[(i + 1) % r.length]; a += p[0] * q[1] - q[0] * p[1]; }
    a = Math.abs(a) / 2;
    if (a > bestA) { bestA = a; best = r; }
  }
  return best;
}
const bboxOf = (pts) => {
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
};

export function convertCubCasa(svgText, opts = {}) {
  const DOOR_MM = opts.doorMM ?? 800;
  const WALL_MM = opts.wallMM ?? 200;
  const NAME = opts.name ?? 'cubicasa';

  const els = parseSvg(svgText);
  const item = (el) => ({ el, shape: shapeOf(el) });

  // ---------- 楼层：真实数据里多层住宅用 <g id="Floor-N"> 分组，必须只取一层 ----------
  const floorOf = (el) => {
    for (let p = el.parent; p; p = p.parent) {
      if (/^Floor-\d+$/.test(p.attrs.id || '')) return p.attrs.id;
    }
    return null;
  };
  const floorIds = [...new Set(els.filter((e) => e.tag === 'g' && /^Floor-\d+$/.test(e.attrs.id || '')).map((e) => e.attrs.id))];
  const floorInfo = floorIds.map((id) => {
    const rooms = els.filter((e) => e.tag === 'g' && floorOf(e) === id && /^Space\s+\S+/.test(e.attrs.class || ''));
    return {
      id, rooms: rooms.length,
      bedrooms: rooms.filter((e) => /^Space\s+Bedroom(\s|$)/.test(e.attrs.class || '')).length,
    };
  });
  // 不指定楼层时，取房间最多的那层（多层住宅的其它层会被丢弃并报告）
  let targetFloor = null;
  if (floorIds.length) {
    if (opts.floor) targetFloor = `Floor-${opts.floor}`;
    else targetFloor = floorInfo.slice().sort((a, b) => b.rooms - a.rooms)[0].id;
  }
  const inFloor = (e) => (floorIds.length && targetFloor ? floorOf(e) === targetFloor : true);

  // CubiCasa 的墙不只叫 Wall：Panel（墙板）和 Railing（栏杆）同样是实体边界；
  // 采光面除了 Window 还有 Glass。漏掉它们，房间边就会出现"漏缝"。
  const WALL_IDS = new Set(['Wall', 'Panel', 'Railing']);
  const WINDOW_IDS = new Set(['Window', 'Glass']);
  const wallEls = els.filter((e) => inFloor(e) && e.tag === 'g' && (WALL_IDS.has(e.attrs.id) || /(^|\s)Wall(\s|$)/.test(e.attrs.class || '')));
  const windowEls = els.filter((e) => inFloor(e) && e.tag === 'g' && (WINDOW_IDS.has(e.attrs.id) || /(^|\s)Window(\s|$)/.test(e.attrs.class || '')));
  const doorEls = els.filter((e) => inFloor(e) && e.tag === 'g' && (e.attrs.id === 'Door' || /(^|\s)Door(\s|$)/.test(e.attrs.class || '')));
  const roomEls = els.filter((e) => inFloor(e) && e.tag === 'g' && /^Space\s+(\S+)/.test(e.attrs.class || ''));

  const walls = wallEls.map(item).filter((o) => o.shape);
  const wins = windowEls.map(item).filter((o) => o.shape);
  const doors = doorEls.map(item).filter((o) => o.shape);
  const roomsRaw = roomEls.map((e) => {
    const type = (e.attrs.class.match(/^Space\s+(\S+)/) || [])[1];
    return { type, shape: shapeOf(e) };
  }).filter((o) => o.shape && o.type && !SKIP_ROOM.has(o.type));
  if (!walls.length) throw new Error('SVG 里没有 Wall 元素');

  // ---------- 尺度 ----------
  // 首选：本套 SVG 自带的房间尺寸标注（A 档，逐套实测）
  // 兜底：数据集常数 10mm/单位（由 313 套含标注样本实测：p1–p99 = 9.95–10.02）
  const MM_PER_UNIT = 10;
  const labelScale = scaleFromLabels(svgText);
  const mmPerPx = labelScale ? labelScale.median : MM_PER_UNIT;
  const toMM = (v) => Math.round(v * mmPerPx);

  // 诊断用：门宽先验（已知系统性偏高约 10%：真实门宽约 720mm，不是 800mm）
  const doorDims = doors.map((d) => {
    const [x0, y0, x1, y1] = bboxOf(d.shape);
    return Math.max(x1 - x0, y1 - y0);
  }).filter((v) => v > 1).sort((a, b) => a - b);
  const q25 = doorDims.length ? doorDims[Math.floor(doorDims.length * 0.25)] : 0;
  const doorPrior = q25 > 0 ? DOOR_MM / q25 : NaN;

  // ---------- 栅格化墙，抠掉门窗，再合并成矩形 ----------
  // 包围盒要包含房间：房间多边形可能伸到墙体之外（露台、挑出部分）
  const allPts = [...walls, ...wins, ...doors, ...roomsRaw].flatMap((o) => o.shape);
  const [minX, minY, maxX, maxY] = bboxOf(allPts);
  const pad = 2;
  const W = Math.ceil(maxX - minX) + pad * 2, H = Math.ceil(maxY - minY) + pad * 2;
  const gx = (x) => Math.round(x - minX) + pad, gy = (y) => Math.round(y - minY) + pad;
  const grid = new Uint8Array(W * H);
  const at = (x, y) => grid[y * W + x];
  const fillShape = (pts, val, target) => {
    const local = pts.map(([x, y]) => [gx(x), gy(y)]);
    const ys = local.map((p) => p[1]);
    for (let y = Math.max(0, Math.floor(Math.min(...ys))); y <= Math.min(H - 1, Math.ceil(Math.max(...ys))); y++) {
      const xs = [];
      for (let i = 0; i < local.length; i++) {
        const a = local[i], b = local[(i + 1) % local.length];
        if ((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y)) xs.push(a[0] + (y - a[1]) / (b[1] - a[1]) * (b[0] - a[0]));
      }
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        for (let x = Math.ceil(xs[k]); x <= Math.floor(xs[k + 1]); x++) {
          const idx = y * W + x;
          if (idx >= 0 && idx < target.length) target[idx] = val;
        }
      }
    }
  };
  for (const w of walls) fillShape(w.shape, 1, grid);

  // 分割专用网格：把门窗也当成实体填进去。
  // 否则房间会从门洞/窗洞漏成一片，而 CubiCasa 的标注并不保证房间多边形互不重叠。
  const segGrid = Uint8Array.from(grid);
  for (const d of doors) fillShape(d.shape, 1, segGrid);
  for (const w of wins) fillShape(w.shape, 1, segGrid);
  const atSeg = (x, y) => segGrid[y * W + x];

  // 门窗洞口：从墙网格里扣出来（我们的模型要求墙在洞口处断开）
  const openingCells = (list) => list.map((o) => {
    const mask = new Uint8Array(W * H);
    fillShape(o.shape, 1, mask);
    const cells = [];
    for (let i = 0; i < mask.length; i++) if (mask[i]) { cells.push(i); grid[i] = 0; }
    return cells;
  });
  const doorCells = openingCells(doors);
  const winCells = openingCells(wins);
  const atW = (x, y) => grid[y * W + x];

  const rectsOf = () => {
    const out = [];
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
      for (const [key, r] of open) if (!next.has(key)) out.push(r);
      for (const [key, r] of next) r.y1 = y;
      open = next;
    }
    for (const r of open.values()) out.push(r);
    return out;
  };
  const cellRectMM = (cells) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const i of cells) {
      const x = i % W, y = Math.floor(i / W);
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
    }
    return [toMM(x0), toMM(y0), toMM(x1 + 1 - 2 * pad + 2 * pad), toMM(y1 + 1)];  // 占位，下面统一减去 pad
  };
  // 网格坐标 → mm：先减 pad 回到原 SVG 单位，再乘比例
  const gxToMM = (x) => toMM(x - pad);
  const gyToMM = (y) => toMM(y - pad);

  // 外包络：用于判定"外墙"、生成尺寸链（原来在 layout 组装处才算，这里提前）
  const envW = gxToMM(W - pad), envH = gyToMM(H - pad);
  const EDGE_TOL = Math.max(WALL_MM, 40);
  const isOuter = (x0, y0, x1, y1) =>
    x0 <= EDGE_TOL || y0 <= EDGE_TOL || x1 >= envW - EDGE_TOL || y1 >= envH - EDGE_TOL;

  // 只做「外墙 / 内墙」的划分 —— 这是几何事实（是否贴着外包络），可可靠推导。
  // **不判定承重墙**：CubiCasa 只有一个 Wall 类，没有任何承重标注。宁可缺失，不臆造：
  // 内部墙一律 n（应用里可拆），并在 JSON 里用 bearingAnnotated:false 告知调用方。
  const wallRects = rectsOf().map((r) => {
    const x0 = gxToMM(r.s), y0 = gyToMM(r.y0), x1 = gxToMM(r.e + 1), y1 = gyToMM(r.y1 + 1);
    return { x0, y0, x1, y1, t: isOuter(x0, y0, x1, y1) ? 'e' : 'n' };
  });
  const doorsOut = doorCells.map((cells) => {
    if (!cells.length) return null;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const i of cells) {
      const x = i % W, y = Math.floor(i / W);
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
    }
    const rect = [gxToMM(x0), gyToMM(y0), gxToMM(x1 + 1), gyToMM(y1 + 1)];
    // 斜墙上的门：包围盒会明显偏厚（实测 669mm），收窄到 300mm 以免压住相邻阶梯墙体
    if (Math.min(rect[2] - rect[0], rect[3] - rect[1]) > 400) {
      const midX = (rect[0] + rect[2]) / 2, midY = (rect[1] + rect[3]) / 2;
      if (rect[2] - rect[0] >= rect[3] - rect[1]) { rect[1] = Math.round(midY - 150); rect[3] = Math.round(midY + 150); }
      else { rect[0] = Math.round(midX - 150); rect[2] = Math.round(midX + 150); }
    }
    const vertical = (rect[3] - rect[1]) > (rect[2] - rect[0]);
    return {
      name: '门', rect,
      h: vertical ? [rect[0], rect[3]] : [rect[0], rect[1]],
      c: vertical ? [0, -1] : [1, 0], o: vertical ? [1, 0] : [0, -1],
      len: Math.round(vertical ? rect[3] - rect[1] : rect[2] - rect[0]),
      entry: false,
    };
  }).filter(Boolean);
  const winsOut = winCells.map((cells) => {
    if (!cells.length) return null;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const i of cells) {
      const x = i % W, y = Math.floor(i / W);
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
    }
    return [gxToMM(x0), gyToMM(y0), gxToMM(x1 + 1), gyToMM(y1 + 1)];
  }).filter(Boolean);

  // ---------- 房间 ----------
  // 两种模式：
  //   derived（默认）：从「墙+门窗」的连通域推出房间 → 天然不重叠、天然水密，
  //                    再用官方 Space 多边形给房间打标签拿房型名称。
  //   annotated：直接吃官方房间多边形（形状最准，但可能重叠/漏缝）。
  const simplify = (pts) => {
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const p = pts[(i - 1 + pts.length) % pts.length], c = pts[i], n = pts[(i + 1) % pts.length];
      const cross = (c[0] - p[0]) * (n[1] - c[1]) - (c[1] - p[1]) * (n[0] - c[0]);
      if (Math.abs(cross) > 0.5) out.push(c);
    }
    return out.length >= 3 ? out : pts;
  };
  const areaPoly = (poly) => {
    let a = 0;
    for (let i = 0; i < poly.length; i++) { const p = poly[i], q = poly[(i + 1) % poly.length]; a += p[0] * q[1] - q[0] * p[1]; }
    return Math.abs(a) / 2 / 1e6;
  };
  // 有向边界串环（内部在左），返回最大闭环并去共线点
  const polygonOfCells = (cells) => {
    const set = new Set(cells.map(([x, y]) => x * 100000 + y));
    const inSet = (x, y) => set.has(x * 100000 + y);
    const edges = new Map();
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
    return best ? simplify(best) : null;
  };

  const rooms = [];
  const centerOf = (pts) => {
    const [x0, y0, x1, y1] = bboxOf(pts);
    return [(x0 + x1) / 2, (y0 + y1) / 2];
  };

  if (opts.rooms === 'annotated') {
    roomsRaw.forEach((r, i) => {
      const poly = simplify(r.shape.map(([x, y]) => [gxToMM(gx(x)), gyToMM(gy(y))]));
      const area = areaPoly(poly);
      if (area < 0.4) return;
      const [cx, cy] = centerOf(r.shape);
      rooms.push({
        id: `r${i}`, name: translateRoom(r.type), poly, mat: matFor(r.type),
        at: [gxToMM(gx(cx)), gyToMM(gy(cy))],
        counted: !/^Outdoor/.test(r.type), srcType: r.type, areaMM: area,
      });
    });
  } else {
    // 1) 连通域
    const comp = new Int32Array(W * H).fill(-1);
    const comps = [];
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (atSeg(x, y) || comp[y * W + x] >= 0) continue;
        const id = comps.length, cells = [];
        const stack = [[x, y]]; comp[y * W + x] = id;
        while (stack.length) {
          const [cx, cy] = stack.pop(); cells.push([cx, cy]);
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nx = cx + dx, ny = cy + dy;
            if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
            if (atSeg(nx, ny) || comp[ny * W + nx] >= 0) continue;
            comp[ny * W + nx] = id; stack.push([nx, ny]);
          }
        }
        comps.push(cells);
      }
    }
    // 2) 用官方 Space 多边形的中心点给连通域打标签（多个命中取面积最大的那个）
    const labelOf = new Array(comps.length).fill(null);
    for (const r of roomsRaw) {
      const [cx, cy] = centerOf(r.shape);
      const x = gx(cx), y = gy(cy);
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const id = comp[y * W + x];
      if (id < 0) continue;
      const a = Math.abs((r.shape[1][0] - r.shape[0][0]) * (r.shape[2][1] - r.shape[1][1]));
      if (!labelOf[id] || a > labelOf[id].area) labelOf[id] = { type: r.type, area: a };
    }
    // 3) 输出房间
    for (let id = 0; id < comps.length; id++) {
      const cells = comps[id];
      if (cells.length < 4) continue;
      const touchesBorder = cells.some(([x, y]) => x <= 0 || y <= 0 || x >= W - 1 || y >= H - 1);
      if (touchesBorder) continue;                        // 画布边界外 = 室外
      const area = (cells.length * mmPerPx * mmPerPx) / 1e6;
      if (area < 0.4) continue;
      const poly = polygonOfCells(cells);
      if (!poly || poly.length < 4) continue;
      const lab = labelOf[id];
      const type = lab ? lab.type : 'Undefined';
      const cx = cells.reduce((s, [x]) => s + x + 0.5, 0) / cells.length;
      const cy = cells.reduce((s, [, y]) => s + y + 0.5, 0) / cells.length;
      rooms.push({
        id: `c${id}`, name: translateRoom(type),
        poly: poly.map(([x, y]) => [gxToMM(x), gyToMM(y)]),
        mat: matFor(type),
        at: [gxToMM(cx), gyToMM(cy)],
        counted: !/^Outdoor/.test(type),
        srcType: type, areaMM: area,
      });
    }
  }

  // 尺寸链：CubiCasa 没有结构化尺寸标注（SVG 里只有 display:none 的英制文字，
  // 如 5'4" x 20'4"），所以按墙体外表面的断点自动生成。每边两条：明细链 + 总长链。
  const chainPoints = (dir, edge) => {
    const total = dir === 'h' ? envW : envH;
    // 用「墙体实际外沿」做基准，而不是距包络固定容差 —— 否则某一边采集不到墙，
    // 明细链会退化成一条总长（顶/底、左/右不对称）
    const lo = dir === 'h' ? Math.min(...wallRects.map((w) => w.y0)) : Math.min(...wallRects.map((w) => w.x0));
    const hi = dir === 'h' ? Math.max(...wallRects.map((w) => w.y1)) : Math.max(...wallRects.map((w) => w.x1));
    const pts = new Set([0, total]);
    for (const w of wallRects) {
      const touches = dir === 'h'
        ? (edge === 0 ? w.y0 <= lo + EDGE_TOL : w.y1 >= hi - EDGE_TOL)
        : (edge === 0 ? w.x0 <= lo + EDGE_TOL : w.x1 >= hi - EDGE_TOL);
      if (!touches) continue;
      if (dir === 'h') { pts.add(w.x0); pts.add(w.x1); } else { pts.add(w.y0); pts.add(w.y1); }
    }
    const arr = [...pts].filter((v) => v >= 0 && v <= total).sort((a, b) => a - b);
    const segs = [];
    for (let i = 1; i < arr.length; i++) { const d = Math.round(arr[i] - arr[i - 1]); if (d > 0) segs.push(d); }
    const sum = segs.reduce((a, b) => a + b, 0);
    if (segs.length && sum !== total) segs[segs.length - 1] += total - sum;   // 校验器要求总和精确等于总长
    return segs.length ? segs : [total];
  };
  const dimChains = [
    { dir: 'h', at: -700, start: 0, segs: chainPoints('h', 0) },
    { dir: 'h', at: -1250, start: 0, segs: [envW] },
    { dir: 'h', at: envH + 700, start: 0, segs: chainPoints('h', envH) },
    { dir: 'h', at: envH + 1250, start: 0, segs: [envW] },
    { dir: 'v', at: -700, start: 0, segs: chainPoints('v', 0) },
    { dir: 'v', at: -1250, start: 0, segs: [envH] },
    { dir: 'v', at: envW + 700, start: 0, segs: chainPoints('v', envW) },
    { dir: 'v', at: envW + 1250, start: 0, segs: [envH] },
  ];

  // ---------- 家具：把 FixedFurniture 标注转成 LIB 的家具条目 ----------
  // 注意：家具多边形的坐标是**组内局部坐标**，必须按祖先链上的 transform 矩阵复合后才是绝对坐标
  //（官方 svg_utils.get_icon 也是这么做的：套 element 的 matrix 再套 FixedFurnitureSet 的 matrix）
  const parseMatrix = (s) => {
    if (!s) return [1, 0, 0, 1, 0, 0];
    const m = s.match(/matrix\(\s*([-\d.eE]+)[,\s]+([-\d.eE]+)[,\s]+([-\d.eE]+)[,\s]+([-\d.eE]+)[,\s]+([-\d.eE]+)[,\s]+([-\d.eE]+)\s*\)/);
    if (m) return [+m[1], +m[2], +m[3], +m[4], +m[5], +m[6]];
    const t = s.match(/translate\(\s*([-\d.eE]+)(?:[,\s]+([-\d.eE]+))?\s*\)/);
    if (t) return [1, 0, 0, 1, +t[1], +(t[2] || 0)];
    return [1, 0, 0, 1, 0, 0];
  };
  // 复合：先 applied 再 then（SVG 语义：子元素的变换在父坐标系里）
  const matMul = (A, B) => [
    A[0] * B[0] + A[2] * B[1], A[1] * B[0] + A[3] * B[1],
    A[0] * B[2] + A[2] * B[3], A[1] * B[2] + A[3] * B[3],
    A[0] * B[4] + A[2] * B[5] + A[4], A[1] * B[4] + A[3] * B[5] + A[5],
  ];
  const applyMat = (M, [x, y]) => [M[0] * x + M[2] * y + M[4], M[1] * x + M[3] * y + M[5]];
  const absMatrixOf = (el) => {
    let M = [1, 0, 0, 1, 0, 0];
    for (let p = el; p; p = p.parent) {
      const t = p.attrs && p.attrs.transform;
      if (t) M = matMul(parseMatrix(t), M);
    }
    return M;
  };

  const furnEls = els.filter((e) => inFloor(e) && e.tag === 'g' && /^FixedFurniture\s+/.test(e.attrs.class || ''));
  const furnItems = [];
  const furnUnmapped = new Map();
  for (const el of furnEls) {
    const cls = (el.attrs.class.match(/^FixedFurniture\s+(.+)$/) || [])[1];
    const shape = shapeOf(el);
    if (!cls || !shape) continue;
    const M = absMatrixOf(el);                                  // 局部 → SVG 绝对坐标
    const world = shape.map((p) => applyMat(M, p));
    const [x0, y0, x1, y1] = bboxOf(world);
    const wPx = x1 - x0, hPx = y1 - y0;
    if (wPx < 2 || hPx < 2) continue;
    const map = FURN_MAP[cls];
    if (!map) { furnUnmapped.set(cls, (furnUnmapped.get(cls) || 0) + 1); continue; }
    const [type, name] = map;
    const rot = wPx >= hPx ? 0 : 90;                       // 全部轴对齐，长边方向即朝向
    furnItems.push({
      type, name,
      cx: gxToMM(gx((x0 + x1) / 2)), cy: gyToMM(gy((y0 + y1) / 2)),
      w: Math.max(80, toMM(rot === 0 ? wPx : hPx)),
      d: Math.max(80, toMM(rot === 0 ? hPx : wPx)),
      rot,
    });
  }

  const layout = {
    schemaVersion: 1, id: NAME, name: NAME, unit: 'mm',
    origin: '左上角（由 CubiCasa5K 的 SVG 像素坐标推定）',
    // 可靠性声明：尺度已由数据自带尺寸标注确定，不再是假设
    estimated: false,
    bearingAnnotated: false,
    scale: {
      basis: labelScale ? 'dimension-labels' : 'dataset-constant',
      mmPerPx: +mmPerPx.toFixed(4),
      unit: 'mm per SVG user unit',
      labelsUsed: labelScale ? labelScale.n : 0,
      note: labelScale
        ? `本套 SVG 内有 ${labelScale.n} 个房间尺寸标注，反解 ${mmPerPx.toFixed(3)} mm/单位（${labelScale.min.toFixed(2)}–${labelScale.max.toFixed(2)}）`
        : `本套无尺寸标注，采用数据集常数 10 mm/单位（由 313 套含标注样本实测：p1–p99 = 9.95–10.02）`,
      accuracy: '±1~2%（标注按英寸取整带来的残差）',
    },
    dimChainsSource: 'derived-from-wall-breakpoints',
    provenance: {
      walls: 'CubiCasa5K 标注（Wall / Panel / Railing）',
      openings: 'CubiCasa5K 标注（Door / Window / Glass）',
      rooms: 'CubiCasa5K 标注（Space 多边形）',
      outerWallFlag: '几何推导：是否贴外包络',
      dimensionChains: '几何推导：墙体外沿断点，非原图标注',
      bearingWalls: '缺失 —— 数据集无此标注，未推断',
      furniture: '缺失 —— 图标类别与 LIB 未映射',
    },
    note: `尺度来自 SVG 自带的房间尺寸标注（DimensionMeasureLabel）反解，实测单位常数 = 10mm/单位，误差 ±1~2%；原始标注无承重墙，也未提供分段尺寸链。数据许可 CC BY-NC-SA 4.0，仅限非商业。`,
    envelope: { w: envW, h: envH },
    defaults: { wallHeight: 2800, planScale: 60, extWall: WALL_MM, intWall: WALL_MM },
    bounds: { x: -1200, y: -1200, w: envW + 2400, h: envH + 2400 },
    walls: wallRects, wins: winsOut, doors: doorsOut, slides: [],
    rooms: rooms.map(({ id, name, poly, mat, at, counted }) => ({ id, name, poly, mat, at, counted })),
    mats: MATS,
    dimChains,
    furniture: {
      source: 'cubicasa-fixed-furniture',
      note: furnItems.length
        ? `来自 CubiCasa 的 FixedFurniture 标注（真实位置与尺寸）；只含固定家具（橱柜/水槽/马桶/淋浴/家电等），不含床/沙发/餐桌等活动家具`
        : '该套没有可映射的固定家具标注',
      items: furnItems,
    },
  };

  const bedrooms = rooms.filter((r) => /Bedroom/.test(r.srcType)).length;
  const baths = rooms.filter((r) => /^(Bath|Sauna)$/.test(r.srcType)).length;
  const halls = rooms.filter((r) => /^(LivingRoom|Dining|Lounge|SunRoom|EatingArea)$/.test(r.srcType)).length;
  const stats = {
    mmPerPx, q25, doorMM: DOOR_MM, wallMM: WALL_MM, envW, envH,
    scaleBasis: labelScale ? 'dimension-labels' : 'dataset-constant',
    labelsUsed: labelScale ? labelScale.n : 0,
    labelSpread: labelScale ? [labelScale.min, labelScale.max] : null,
    doorPrior: Number.isFinite(doorPrior) ? doorPrior : null,
    furnMapped: furnItems.length,
    furnUnmapped: [...furnUnmapped.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}×${v}`),
    floors: floorInfo, floor: targetFloor,
    srcWalls: walls.length, srcWins: wins.length, srcDoors: doors.length, srcRooms: roomsRaw.length,
    walls: layout.walls.length, wins: layout.wins.length, doors: layout.doors.length,
    rooms: rooms.length, bedrooms, baths, halls,
    netArea: rooms.filter((r) => r.counted !== false).reduce((a, r) => a + r.areaMM, 0),
    roomList: rooms,
  };
  return { layout, stats };
}

// ---------- CLI ----------
const isCli = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isCli) {
  const argv = process.argv.slice(2);
  const input = argv.find((a) => !a.startsWith('--'));
  if (!input) { console.error('用法: node tools/cubicasa-to-layout.mjs <sample-dir | model.svg> [--out=path] [--door=800]'); process.exit(2); }
  const arg = (k, d) => { const h = argv.find((a) => a.startsWith(`--${k}=`)); return h ? h.split('=')[1] : d; };
  let svgPath = input;
  try { if (statSync(input).isDirectory()) svgPath = join(input, 'model.svg'); } catch {}
  const txt = readFileSync(svgPath, 'utf8');
  const name = arg('name', svgPath.replace(/[\\/]model\.svg$/i, '').split(/[\\/]/).slice(-1)[0] || 'cubicasa');
  const { layout, stats } = convertCubCasa(txt, { doorMM: +arg('door', 800), wallMM: +arg('wall', 200), name, floor: +arg('floor', 0) || 0, rooms: arg('rooms', 'annotated') });
  const out = arg('out', '');
  if (out) writeFileSync(out, JSON.stringify(layout, null, 2), 'utf8');
  console.log(`input      : ${svgPath}`);
  console.log(`floors     : ${stats.floors.length ? stats.floors.map((f) => `${f.id}(房${f.rooms}/卧${f.bedrooms})`).join(' ') + ` → 用 ${stats.floor}` : '单层'}`);
  console.log(`source     : wall ${stats.srcWalls}, window ${stats.srcWins}, door ${stats.srcDoors}, room ${stats.srcRooms}`);
  console.log(`scale      : ${stats.mmPerPx.toFixed(3)} mm/单位  (${
    stats.scaleBasis === 'dimension-labels'
      ? `${stats.labelsUsed} 个房间尺寸标注实测，${stats.labelSpread[0].toFixed(2)}–${stats.labelSpread[1].toFixed(2)}`
      : '数据集常数 10mm/单位'})`);
  console.log(`envelope   : ${stats.envW} × ${stats.envH} mm`);
  console.log(`output     : walls ${stats.walls}, windows ${stats.wins}, doors ${stats.doors}, rooms ${stats.rooms}`);
  console.log(`room mix   : ${stats.bedrooms} 卧 / ${stats.halls} 厅 / ${stats.baths} 卫`);
  console.log(`net area   : ${stats.netArea.toFixed(2)} m2`);
  console.log(`furniture  : 映射 ${stats.furnMapped} 件` + (stats.furnUnmapped.length ? `；未映射 ${stats.furnUnmapped.slice(0, 6).join(', ')}…` : ''));
  for (const r of stats.roomList.slice().sort((a, b) => b.areaMM - a.areaMM)) {
    console.log(`  - ${String(r.srcType).padEnd(14)} ${r.name.padEnd(6)} ${r.areaMM.toFixed(2).padStart(7)} m2`);
  }
  if (out) console.log(`wrote ${out}`);
}
