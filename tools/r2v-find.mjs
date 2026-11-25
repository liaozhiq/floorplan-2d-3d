#!/usr/bin/env node
/**
 * r2v-find.mjs — 在一个 R2V 标注目录里批量转换，按卧室数筛选
 *
 * 用法：
 *   node tools/r2v-find.mjs <dir> [--bedrooms=4] [--convert=outdir] [--top=10] [--door=800]
 *
 * 典型流程（在你自己的机器上，网络不受限）：
 *   git clone --depth 1 https://github.com/art-programmer/FloorplanTransformation r2v
 *   node tools/r2v-find.mjs r2v/data/floorplan_representation --bedrooms=4 --convert=out/r2v-4br
 *
 * 输出一张按套内面积排序的表；--convert 会把命中项写成 layout JSON（已可直接过校验器）。
 */
import { readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { convertR2V } from './r2v-to-layout.mjs';

const argv = process.argv.slice(2);
const root = argv.find((a) => !a.startsWith('--'));
if (!root) { console.error('用法: node tools/r2v-find.mjs <dir> [--bedrooms=4] [--convert=outdir]'); process.exit(2); }
const arg = (k, d) => { const h = argv.find((a) => a.startsWith(`--${k}=`)); return h ? h.split('=')[1] : d; };
const MIN_BED = +arg('bedrooms', 4);
const TOP = +arg('top', 10);
const CONVERT_TO = arg('convert', '');
const DOOR_MM = +arg('door', 800);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.txt$/i.test(name)) out.push(p);
  }
  return out;
}

const files = walk(root);
process.stdout.write(`扫描 ${files.length} 个标注文件…\n`);

const hits = [];
const hist = new Map();                                    // 卧室数 → 方案数
let ok = 0, fail = 0;
for (const f of files) {
  let res;
  try { res = convertR2V(readFileSync(f, 'utf8'), { doorMM: DOOR_MM, name: f.split(/[\\/]/).slice(-2).join('-') }); }
  catch { fail++; continue; }
  ok++;
  const s = res.stats;
  hist.set(s.bedrooms, (hist.get(s.bedrooms) || 0) + 1);
  if (s.bedrooms >= MIN_BED && s.netArea > 3) hits.push({ file: f, layout: res.layout, s });
}

process.stdout.write(`转换成功 ${ok}，失败 ${fail}；卧室 ≥ ${MIN_BED} 的 ${hits.length} 个\n`);
process.stdout.write(`卧室数分布：${[...hist.keys()].sort((a, b) => a - b).map((k) => `${k}室 ${hist.get(k)}`).join(' · ')}\n\n`);
hits.sort((a, b) => b.s.netArea - a.s.netArea);

const shown = hits.slice(0, TOP);
const mix = (h) => {
  const c = (t) => h.s.roomList.filter((r) => r.srcType === t).length;
  const bed = c('bedroom');
  const bath = c('bathroom') + c('restroom');
  const hall = c('living_room') + c('dining_room');
  const parts = [`卧${bed}`];
  if (hall) parts.push(`厅${hall}`);
  else if (c('kitchen')) parts.push('LDK');
  parts.push(`卫${bath}`);
  return parts.join(' ');
};
if (shown.length) {
  process.stdout.write('卧室   套内 m²  房间  门   比例 mm/unit  构成        文件\n');
  for (const h of shown) {
    const rel = h.file.slice(root.length).replace(/^[\\/]/, '');
    process.stdout.write(`${String(h.s.bedrooms).padStart(4)}  ${h.s.netArea.toFixed(2).padStart(8)}  ${String(h.s.rooms).padStart(4)}  ${String(h.s.outDoors).padStart(4)}  ${h.s.mmPerUnit.toFixed(2).padStart(12)}  ${mix(h).padEnd(11)} ${rel}\n`);
  }
}

if (CONVERT_TO) {
  mkdirSync(CONVERT_TO, { recursive: true });
  for (const h of shown) {
    const safe = h.file.slice(root.length).replace(/^[\\/]/, '').replace(/[\\/]/g, '_').replace(/\.txt$/i, '');
    writeFileSync(join(CONVERT_TO, `${safe}.json`), JSON.stringify(h.layout, null, 2), 'utf8');
  }
  process.stdout.write(`\n已写出 ${shown.length} 个 JSON 到 ${CONVERT_TO}/\n后续校验：\n`);
  process.stdout.write(`  node tools/validate-layout.mjs ${CONVERT_TO}/<file>.json --polygons\n`);
  process.stdout.write(`  node tools/render-layout.mjs  ${CONVERT_TO}/<file>.json --out=<file>.png\n`);
}
