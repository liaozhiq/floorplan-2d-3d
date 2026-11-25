#!/usr/bin/env node
/**
 * cubicasa-stats.mjs —— 统计 / 建索引
 *
 * 用法：
 *   node tools/cubicasa-stats.mjs .cache/cubicasa5k                    # 快速分布（只扫类名，几秒）
 *   node tools/cubicasa-stats.mjs .cache/cubicasa5k --convert --out=layouts/index.json
 *                                                                     # 额外真转换算面积并写索引
 *
 * 输出：卧室/卫生间/厅/房间数的分布、卧×卫交叉表、房间类型词表，以及可选的全量索引。
 */
import { readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { convertCubCasa } from './cubicasa-to-layout.mjs';

const argv = process.argv.slice(2);
const root = argv.find((a) => !a.startsWith('--'));
if (!root) { console.error('用法: node tools/cubicasa-stats.mjs <root> [--convert] [--out=path]'); process.exit(2); }
const arg = (k, d) => { const h = argv.find((a) => a.startsWith(`--${k}=`)); return h ? h.split('=')[1] : d; };
const DO_CONVERT = argv.includes('--convert');
const OUT = arg('out', '');

function walk(dir, out = []) {
  let names;
  try { names = readdirSync(dir); } catch { return out; }
  for (const name of names) {
    const p = join(dir, name);
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) walk(p, out);
    else if (/^model\.svg$/i.test(name)) out.push(p);
  }
  return out;
}

const HALL = ['LivingRoom', 'Dining', 'Lounge', 'SunRoom', 'EatingArea'];
const files = walk(root);
process.stdout.write(`扫描 ${files.length} 个 model.svg…\n`);

const bedsHist = new Map(), bathsHist = new Map(), hallsHist = new Map(), roomsHist = new Map();
const crossTab = new Map();                    // "beds-baths" → count
const vocab = new Map();
const rows = [];
let noRoom = 0, withFloorGroup = 0, multiFloor = 0;

for (const f of files) {
  let txt;
  try { txt = readFileSync(f, 'utf8'); } catch { continue; }
  // 只看房间最多的那一层（多层住宅不能把两层加在一起）
  const marks = [...txt.matchAll(/<g id="(Floor-\d+)"/g)].map((m) => m.index);
  if (marks.length) withFloorGroup++;
  if (marks.length > 1) multiFloor++;
  const chunks = marks.length > 1
    ? marks.map((at, k) => txt.slice(at, k + 1 < marks.length ? marks[k + 1] : txt.length))
    : [txt];
  let best = null;
  for (const seg of chunks) {
    const sp = [...seg.matchAll(/class="Space\s+([^"]+)"/g)].map((m) => m[1].trim());
    if (!sp.length) continue;
    const types = sp.map((s) => s.split(/\s+/)[0]);
    const rec = {
      rooms: sp.length,
      beds: types.filter((t) => t === 'Bedroom').length,
      baths: types.filter((t) => t === 'Bath').length,
      halls: types.filter((t) => HALL.includes(t)).length,
      kitchens: types.filter((t) => t === 'Kitchen').length,
      types,
    };
    if (!best || rec.rooms > best.rooms) best = rec;
  }
  if (!best) { noRoom++; continue; }
  for (const t of best.types) vocab.set(t, (vocab.get(t) || 0) + 1);
  const inc = (m, k) => m.set(k, (m.get(k) || 0) + 1);
  inc(bedsHist, best.beds); inc(bathsHist, best.baths);
  inc(hallsHist, best.halls); inc(roomsHist, best.rooms);
  const key = `${best.beds}-${best.baths}`;
  inc(crossTab, key);
  rows.push({
    id: f.slice(root.length).replace(/^[\\/]/, '').replace(/[\\/]model\.svg$/i, '').replace(/[\\/]/g, '/'),
    file: f, beds: best.beds, baths: best.baths, halls: best.halls,
    kitchens: best.kitchens, rooms: best.rooms,
  });
}

const show = (title, m, unit = '') => {
  const keys = [...m.keys()].sort((a, b) => a - b);
  process.stdout.write(`\n${title}：\n`);
  for (const k of keys) {
    const n = m.get(k), pct = (n / rows.length * 100).toFixed(1);
    process.stdout.write(`  ${String(k).padStart(2)}${unit}  ${String(n).padStart(5)} 套  ${pct.padStart(5)}%  ${'█'.repeat(Math.round(pct / 2))}\n`);
  }
};

process.stdout.write(`\n总计 ${files.length} 套；有房间标注 ${rows.length}；无房间 ${noRoom}；用 Floor-N 分组 ${withFloorGroup}（其中多层 ${multiFloor}）\n`);
show('卧室数分布', bedsHist, '室');
show('卫生间数分布（Bath）', bathsHist, '卫');
show('厅数分布（LivingRoom+Dining+Lounge…）', hallsHist, '厅');
show('单层房间总数分布', roomsHist, '间');

process.stdout.write('\n卧室 × 卫生间 交叉表（行=卧室，列=卫生间）：\n');
const maxB = Math.max(...bedsHist.keys()), maxBa = Math.max(...bathsHist.keys());
process.stdout.write('      ' + Array.from({ length: Math.min(maxBa, 6) + 1 }, (_, i) => String(i).padStart(6)).join('') + '\n');
for (let b = 0; b <= Math.max(maxB, 0); b++) {
  if (!bedsHist.has(b)) continue;
  let line = `${String(b).padStart(3)}室 `;
  for (let ba = 0; ba <= Math.min(maxBa, 6); ba++) {
    const n = crossTab.get(`${b}-${ba}`) || 0;
    line += String(n || '·').padStart(6);
  }
  process.stdout.write(line + '\n');
}

process.stdout.write(`\n房间类型词表（${vocab.size} 种，前 25）：\n`);
[...vocab.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25)
  .forEach(([k, v]) => process.stdout.write(`  ${k.padEnd(24)} ${v}\n`));

if (DO_CONVERT) {
  process.stdout.write('\n开始真转换算面积（较慢）…\n');
  let done = 0, fail = 0;
  const t0 = Date.now();
  for (const r of rows) {
    try {
      const { stats } = convertCubCasa(readFileSync(r.file, 'utf8'), { rooms: 'annotated', name: r.id });
      r.area = +stats.netArea.toFixed(2);
      r.walls = stats.walls; r.doors = stats.doors; r.wins = stats.wins;
      r.floors = stats.floors.length || 1;
      r.mmPerPx = +stats.mmPerPx.toFixed(3);
    } catch { fail++; }
    if (++done % 200 === 0) process.stdout.write(`  ${done}/${rows.length}  ${((Date.now() - t0) / 1000).toFixed(0)}s\n`);
  }
  const ok = rows.filter((r) => r.area);
  process.stdout.write(`转换成功 ${ok.length}，失败 ${fail}，用时 ${((Date.now() - t0) / 1000).toFixed(0)}s\n`);
  const areas = ok.map((r) => r.area).sort((a, b) => a - b);
  const q = (p) => areas[Math.floor(areas.length * p)] ?? 0;
  process.stdout.write(`套内面积分位：p10 ${q(0.1).toFixed(0)} · p25 ${q(0.25).toFixed(0)} · 中位 ${q(0.5).toFixed(0)} · p75 ${q(0.75).toFixed(0)} · p90 ${q(0.9).toFixed(0)} m²\n`);
  if (OUT) {
    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(OUT, JSON.stringify({
      source: 'CubiCasa5K (CC BY-NC-SA 4.0)',
      generatedAt: new Date().toISOString(),
      unit: 'mm',
      items: ok.map(({ file, ...rest }) => rest),
    }, null, 0), 'utf8');
    process.stdout.write(`写出索引 ${OUT}（${ok.length} 条，${(JSON.stringify(ok).length / 1024).toFixed(0)} KB）\n`);
  }
}
