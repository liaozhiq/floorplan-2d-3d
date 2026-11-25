#!/usr/bin/env node
/**
 * cubicasa-dupcheck.mjs —— 检查 CubiCasa5K 里的重复 / 近似重复户型
 *
 * 用法：node tools/cubicasa-dupcheck.mjs .cache/cubicasa5k
 *
 * 三种判据：
 *  1. 同名 id 出现在多个风格目录（high_quality / high_quality_architectural / colorful）
 *  2. 几何指纹相同：墙体外接框排序后取哈希（完全同一张图）
 *  3. 房间构成指纹相近：房型 + 面积占比（量化到 1%）排序 —— 抓"布局几乎一样"的
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const root = process.argv[2];
if (!root) { console.error('用法: node tools/cubicasa-dupcheck.mjs <root>'); process.exit(2); }

function walk(dir, out = []) {
  let names;
  try { names = readdirSync(dir); } catch { return out; }
  for (const n of names) {
    const p = join(dir, n);
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) walk(p, out);
    else if (/^model\.svg$/i.test(n)) out.push(p);
  }
  return out;
}
const parsePts = (s) => {
  const nums = s.trim().split(/[\s,]+/).map(Number).filter(Number.isFinite);
  const out = [];
  for (let i = 0; i + 1 < nums.length; i += 2) out.push([nums[i], nums[i + 1]]);
  return out;
};
const shoelace = (pts) => {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return Math.abs(a) / 2;
};
const HALL = ['LivingRoom', 'Dining', 'Lounge', 'SunRoom', 'EatingArea'];

const files = walk(root);
process.stdout.write(`扫描 ${files.length} 个 model.svg…\n`);

const rows = [];
for (const f of files) {
  let txt;
  try { txt = readFileSync(f, 'utf8'); } catch { continue; }
  const rel = f.slice(root.length).replace(/^[\\/]/, '').replace(/[\\/]/g, '/');
  // 风格目录 + 样本编号
  const m = rel.match(/^([^/]+)\/(\d+)\/model\.svg$/i);
  const style = m ? m[1] : '?';
  const numId = m ? m[2] : '?';

  // 多层：取房间最多的那层
  const marks = [...txt.matchAll(/<g id="(Floor-\d+)"/g)].map((x) => x.index);
  const chunks = marks.length > 1
    ? marks.map((at, k) => txt.slice(at, k + 1 < marks.length ? marks[k + 1] : txt.length))
    : [txt];
  let best = null;
  for (const seg of chunks) {
    const rooms = [...seg.matchAll(/class="Space\s+([^"]+)"[\s\S]{0,400}?<polygon points="([^"]+)"/g)]
      .map((mm) => ({ type: mm[1].trim().split(/\s+/)[0], area: shoelace(parsePts(mm[2])) }))
      .filter((r) => r.area > 0);
    if (!rooms.length) continue;
    const total = rooms.reduce((a, r) => a + r.area, 0);
    if (!best || rooms.length > best.rooms.length) best = { rooms, total, seg };
  }
  if (!best) continue;

  const types = best.rooms.map((r) => r.type);
  const beds = types.filter((t) => t === 'Bedroom').length;
  const baths = types.filter((t) => t === 'Bath').length;
  const halls = types.filter((t) => HALL.includes(t)).length;

  // 房间构成指纹：房型 + 面积占比（1% 量化）
  const compo = best.rooms
    .map((r) => `${r.type}:${Math.round(r.area / best.total * 100)}`)
    .sort().join('|');
  // 墙体指纹：所有墙体多边形的整体外接框 + 数量（粗，但足以抓完全相同的图）
  const wallPolys = [...best.seg.matchAll(/id="(Wall|Panel)"[\s\S]{0,300}?<polygon points="([^"]+)"/g)]
    .map((mm) => parsePts(mm[2]));
  const wb = wallPolys.flat();
  const wallSig = wallPolys.length + '|' + (wb.length
    ? [Math.min(...wb.map((p) => p[0])), Math.min(...wb.map((p) => p[1])),
       Math.max(...wb.map((p) => p[0])), Math.max(...wb.map((p) => p[1]))].map((v) => Math.round(v)).join(',')
    : '');

  rows.push({
    rel, style, numId, beds, baths, halls, rooms: best.rooms.length,
    total: Math.round(best.total),
    compo: createHash('sha1').update(compo).digest('hex').slice(0, 12),
    wallSig: createHash('sha1').update(wallSig).digest('hex').slice(0, 12),
  });
}

process.stdout.write(`解析成功 ${rows.length}\n\n`);

// 1) 跨风格目录的同编号
const byNum = new Map();
for (const r of rows) {
  if (r.numId === '?') continue;
  if (!byNum.has(r.numId)) byNum.set(r.numId, new Set());
  byNum.get(r.numId).add(r.style);
}
const multiStyle = [...byNum.entries()].filter(([, s]) => s.size > 1);
process.stdout.write(`① 同一编号出现在多个风格目录：${multiStyle.length} 个编号\n`);
const styleCount = new Map();
for (const r of rows) styleCount.set(r.style, (styleCount.get(r.style) || 0) + 1);
process.stdout.write(`   各风格样本数：${[...styleCount.entries()].map(([k, v]) => `${k} ${v}`).join(' · ')}\n`);
if (multiStyle.length) {
  process.stdout.write(`   示例：${multiStyle.slice(0, 6).map(([n, s]) => `${n}(${[...s].join('/')})`).join(', ')}\n`);
}

// 2) 几何指纹相同
const byWall = new Map();
for (const r of rows) {
  if (!byWall.has(r.wallSig)) byWall.set(r.wallSig, []);
  byWall.get(r.wallSig).push(r);
}
const wallDup = [...byWall.values()].filter((g) => g.length > 1);
process.stdout.write(`\n② 墙体几何完全相同的组：${wallDup.length} 组，涉及 ${wallDup.reduce((a, g) => a + g.length, 0)} 套\n`);
wallDup.slice(0, 5).forEach((g) => process.stdout.write(`   ${g.length} 套：${g.slice(0, 4).map((r) => r.rel).join('  ')}\n`));

// 3) 房间构成指纹相同
const byCompo = new Map();
for (const r of rows) {
  if (!byCompo.has(r.compo)) byCompo.set(r.compo, []);
  byCompo.get(r.compo).push(r);
}
const compoDup = [...byCompo.values()].filter((g) => g.length > 1);
process.stdout.write(`\n③ 房间构成相同（房型+面积占比）的组：${compoDup.length} 组，涉及 ${compoDup.reduce((a, g) => a + g.length, 0)} 套\n`);
compoDup.sort((a, b) => b.length - a.length).slice(0, 5).forEach((g) => {
  process.stdout.write(`   ${g.length} 套（${g[0].beds}卧${g[0].baths}卫${g[0].halls}厅，${g[0].rooms}间）：${g.slice(0, 4).map((r) => r.rel.split('/').slice(0, 2).join('/')).join('  ')}\n`);
});

// 四室子集的重复情况
const four = rows.filter((r) => r.beds >= 4);
const fourWall = new Map();
for (const r of four) {
  if (!fourWall.has(r.wallSig)) fourWall.set(r.wallSig, []);
  fourWall.get(r.wallSig).push(r);
}
const fourDup = [...fourWall.values()].filter((g) => g.length > 1);
process.stdout.write(`\n④ 四室及以上 ${four.length} 套里，墙体几何重复的：${fourDup.reduce((a, g) => a + g.length, 0)} 套（${fourDup.length} 组）\n`);
