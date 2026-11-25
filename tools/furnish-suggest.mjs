#!/usr/bin/env node
/**
 * furnish-suggest.mjs —— 给户型补「示意布置」家具（床/沙发/餐桌/椅子…）
 *
 * ⚠️ 这些家具**不是这套房子的真实家具**。
 *    CubiCasa5K 只标注固定家具（嵌墙柜体、洁具、家电），活动家具在数据里不存在。
 *    所以本工具生成的一切都标记 suggested:true，应用里用虚线绘制、副标题注明"含示意布置 N 件"。
 *
 * 放置规则：先试长边墙、再试短边墙；要求家具四角 + 中心都在房间多边形内（L 形房间也能放）；
 *          与已有家具、已放置的示意家具都不重叠。
 *
 * 用法：
 *   node tools/furnish-suggest.mjs --dir=layouts [--dry] [--clear]
 *     --dry    只统计不写盘
 *     --clear  只移除已生成的示意家具，不重新生成（回退）
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const argv = process.argv.slice(2);
const arg = (k, d) => { const h = argv.find((a) => a.startsWith(`--${k}=`)); return h ? h.split('=')[1] : d; };
const DIR = arg('dir', 'layouts');
const DRY = argv.includes('--dry');
const CLEAR = argv.includes('--clear');
const GAP = 60;                                  // 家具离墙最小间隙（mm）
const SKIP_ROOM = /室外|桑拿|储物|衣帽|家政|设备|未定义|门斗|过道|阳台|车库|楼梯/;

if (!existsSync(join(DIR, 'index.json'))) { console.error(`找不到 ${DIR}/index.json`); process.exit(1); }

const mkItem = (type, name, cx, cy, w, d, rot) => ({
  type, name, cx: Math.round(cx), cy: Math.round(cy),
  w: Math.round(w), d: Math.round(d), rot, suggested: true,
});
const bboxOf = (poly) => {
  const xs = poly.map((p) => p[0]), ys = poly.map((p) => p[1]);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
};
const box = (cx, cy, w, d) => ({ x0: cx - w / 2, y0: cy - d / 2, x1: cx + w / 2, y1: cy + d / 2 });
const hit = (a, b) => !(a.x1 <= b.x0 || a.x0 >= b.x1 || a.y1 <= b.y0 || a.y0 >= b.y1);
const inPoly = ([px, py], poly) => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};
/** 家具（含旋转后的屏幕外框）四角 + 中心都在房间内 */
const fitsIn = (cx, cy, w, d, rot, poly) => {
  const [ew, eh] = rot === 90 ? [d, w] : [w, d];
  const b = box(cx, cy, ew, eh);
  return [[b.x0, b.y0], [b.x1, b.y0], [b.x1, b.y1], [b.x0, b.y1], [cx, cy]].every((p) => inPoly(p, poly));
};
/**
 * 沿墙面放一件家具。w = 沿墙长度，d = 垂直墙进深。
 * 返回 {cx, cy, w, d, rot} 或 null（放不下）
 */
function placeAlong(bb, w, d, wall, t = 0.5) {
  const { x0, y0, x1, y1 } = bb;
  const rw = x1 - x0 - 2 * GAP, rh = y1 - y0 - 2 * GAP;
  const clamp = (v) => Math.max(0, Math.min(1, v));
  if (wall === 'top' || wall === 'bottom') {
    if (w > rw || d > rh) return null;
    return {
      cx: x0 + GAP + w / 2 + clamp(t) * (rw - w),
      cy: wall === 'top' ? y0 + GAP + d / 2 : y1 - GAP - d / 2,
      w, d, rot: 0,
    };
  }
  if (d > rw || w > rh) return null;
  return {
    cx: wall === 'left' ? x0 + GAP + d / 2 : x1 - GAP - d / 2,
    cy: y0 + GAP + w / 2 + clamp(t) * (rh - w),
    w, d, rot: 90,                                // 旋转 90°：屏幕上是 d × w
  };
}

function suggestForRoom(room, existing) {
  const out = [];
  const poly = room.poly;
  const bb = bboxOf(poly);
  const rw = bb.x1 - bb.x0, rh = bb.y1 - bb.y0;
  const name = room.name || '';

  const roomBoxes = () => existing.concat(out).map((f) => {
    const [ew, eh] = f.rot % 180 === 0 ? [f.w, f.d] : [f.d, f.w];
    return box(f.cx, f.cy, ew, eh);
  });
  const has = (type) => existing.some((f) => f.type === type);

  /** 依次尝试四个朝向，取第一个「四角在房间内 + 不与其它家具重叠」的位置 */
  const tryPlace = (w, d, t = 0.5) => {
    const walls = rw >= rh ? ['top', 'bottom', 'left', 'right'] : ['left', 'right', 'top', 'bottom'];
    for (const wall of walls) {
      const r = placeAlong(bb, w, d, wall, t);
      if (!r) continue;
      if (!fitsIn(r.cx, r.cy, r.w, r.d, r.rot, poly)) continue;
      const [ew, eh] = r.rot === 90 ? [r.d, r.w] : [r.w, r.d];
      const b = box(r.cx, r.cy, ew, eh);
      if (roomBoxes().some((o) => hit(b, o))) continue;
      return r;
    }
    return null;
  };
  const put = (type, label, w, d, t = 0.5) => {
    if (has(type)) return null;
    const r = tryPlace(w, d, t);
    if (!r) return null;
    const item = mkItem(type, label, r.cx, r.cy, r.w, r.d, r.rot);
    out.push(item);
    return item;
  };

  if (/卧|房间/.test(name)) {
    const short = Math.min(rw, rh);
    const bedW = short >= 2900 ? 1500 : short >= 2400 ? 1200 : 1000;   // 按开间选床宽
    const bed = put('bed', bedW >= 1500 ? '双人床' : '单人床', bedW, 2000, 0.5);
    if (bed) {
      const along = bed.rot === 0;                    // 0=沿横墙（床头朝上/下）
      [-1, 1].forEach((s) => {
        const cx = along ? bed.cx + s * (bedW / 2 + 260) : bed.cx;
        const cy = along ? bed.cy : bed.cy + s * (bedW / 2 + 260);
        if (fitsIn(cx, cy, 450, 400, 0, poly) && !roomBoxes().some((o) => hit(box(cx, cy, 450, 400), o))) {
          out.push(mkItem('nightstand', '床头柜', cx, cy, 450, 400, 0));
        }
      });
    }
  } else if (/客厅/.test(name)) {
    const sofa = put('sofa', '三人沙发', 2400, 900, 0.5);
    if (sofa) put('coffeetable', '茶几', 1300, 650, 0.5);
    if (sofa) put('tvstand', '电视柜', 1800, 400, 0.5);
  } else if (/餐厅/.test(name)) {
    const t = put('table', '餐桌', 1400, 800, 0.5);
    if (t) {
      [[-1, 0], [1, 0], [0, -1], [0, 1]].forEach(([sx, sy]) => {
        const cx = t.cx + sx * 950, cy = t.cy + sy * 700;
        if (fitsIn(cx, cy, 450, 480, 0, poly) && !roomBoxes().some((o) => hit(box(cx, cy, 450, 480), o))) {
          out.push(mkItem('chair', '餐椅', cx, cy, 450, 480, 0));
        }
      });
    }
  } else if (/厨房/.test(name)) {
    put('counter', '橱柜台面', Math.max(1200, Math.min(2400, rw - 2 * GAP)), 600, 0.5);
  } else if (/卫生间/.test(name)) {
    put('vanity', '浴室柜', 800, 500, 0.2);
    put('toilet', '马桶', 400, 700, 0.6);
    if (Math.min(rw, rh) > 1100) put('shower', '淋浴房', 900, 900, 0.85);
  } else if (/玄关|门厅/.test(name)) {
    put('shoecab', '鞋柜', 1000, 350, 0.5);
  }
  return out;
}

const index = JSON.parse(readFileSync(join(DIR, 'index.json'), 'utf8'));
let plans = 0, added = 0, empty = 0, cleared = 0;
const byType = {};

for (const it of index.items) {
  const p = join(DIR, it.file);
  if (!existsSync(p)) continue;
  const L = JSON.parse(readFileSync(p, 'utf8'));
  if (!L.furniture) L.furniture = { items: [] };
  const before = (L.furniture.items || []).length;
  L.furniture.items = (L.furniture.items || []).filter((f) => !f.suggested);   // 幂等：先清旧示意
  cleared += before - L.furniture.items.length;

  if (!CLEAR) {
    for (const room of L.rooms) {
      if (room.counted === false || SKIP_ROOM.test(room.name || '')) continue;
      for (const f of suggestForRoom(room, L.furniture.items)) {
        L.furniture.items.push(f);
        byType[f.type] = (byType[f.type] || 0) + 1;
        added++;
      }
    }
    if (added) plans++;
    if (!L.furniture.items.some((f) => f.suggested)) empty++;
  }
  if (!DRY) writeFileSync(p, JSON.stringify(L), 'utf8');
}

console.log(`${CLEAR ? '清空' : '处理'} ${index.items.length} 套：移除旧示意 ${cleared} 件${CLEAR ? '' : `，新生成 ${added} 件（${plans} 套有示意家具，${empty} 套没有）`}${DRY ? '（--dry 未写盘）' : ''}`);
if (added) console.log('按类型:', Object.entries(byType).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}×${v}`).join('  '));
console.log('\n⚠️ 这些是**规则生成的示意布置**，不是该户型的真实家具；JSON 里标了 suggested:true。');
