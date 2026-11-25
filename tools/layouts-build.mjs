#!/usr/bin/env node
/**
 * layouts-build.mjs —— 按"几室"生成应用内户型库（layouts/index.json + 每个户型一个 JSON）
 *
 * 用法：
 *   node tools/layouts-build.mjs 4                 # 默认：四室（推荐）
 *   node tools/layouts-build.mjs 3 --area=70-140   # 三室，只要 70–140 m²
 *   node tools/layouts-build.mjs 0 --top=200       # 0 室有 1500+ 套，只取前 200 套
 *   node tools/layouts-build.mjs 5
 *
 * 每次运行会**重建** layouts/ 下的索引与几何文件（用 --clean 先清掉旧文件）。
 * 应用侧只需读 layouts/index.json，所以"想看几室"就重新生成一次即可。
 */
import { readdirSync, readFileSync, statSync, writeFileSync, mkdirSync, unlinkSync, existsSync } from 'node:fs';
import { join, basename, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { convertCubCasa } from './cubicasa-to-layout.mjs';

const argv = process.argv.slice(2);
const N = Number(argv.find((a) => /^\d$/.test(a)));
if (!Number.isInteger(N) || N < 0 || N > 9) {
  console.error('用法: node tools/layouts-build.mjs <0-9> [--area=min-max] [--top=N] [--clean] [--root=dir] [--out=dir]');
  process.exit(2);
}
const arg = (k, d) => { const h = argv.find((a) => a.startsWith(`--${k}=`)); return h ? h.split('=')[1] : d; };
const ROOT = arg('root', '.cache/cubicasa5k');
const OUT = arg('out', 'layouts');
const [AMIN, AMAX] = (arg('area', '0-1000')).split('-').map(Number);
const TOP = +arg('top', 0);
const CLEAN = argv.includes('--clean');
const DOOR = +arg('door', 800);

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

const HALL = ['LivingRoom', 'Dining', 'Lounge', 'SunRoom', 'EatingArea'];
const files = walk(ROOT);
if (!files.length) { console.error(`在 ${ROOT} 下没找到 model.svg`); process.exit(1); }
process.stdout.write(`扫描 ${files.length} 个 model.svg，筛 ${N} 室…\n`);

// 第一级：正则粗筛（按"房间最多的那一层"判断，避免多层住宅两层相加）
const pass = [];
for (const f of files) {
  let txt;
  try { txt = readFileSync(f, 'utf8'); } catch { continue; }
  const marks = [...txt.matchAll(/<g id="Floor-\d+"/g)].map((m) => m.index);
  const chunks = marks.length > 1
    ? marks.map((at, k) => txt.slice(at, k + 1 < marks.length ? marks[k + 1] : txt.length))
    : [txt];
  let best = null;
  for (const seg of chunks) {
    const sp = [...seg.matchAll(/class="Space\s+([^"]+)"/g)].map((m) => m[1].trim().split(/\s+/)[0]);
    if (!sp.length) continue;
    if (!best || sp.length > best.rooms) {
      best = {
        rooms: sp.length,
        beds: sp.filter((t) => t === 'Bedroom').length,
        baths: sp.filter((t) => t === 'Bath').length,
        halls: sp.filter((t) => HALL.includes(t)).length,
      };
    }
  }
  if (best && best.beds === N) pass.push(f);
}
process.stdout.write(`粗筛命中 ${pass.length} 套\n`);

// 第二级：真转换（顺便按面积过滤）
const items = [];
let fail = 0;
const t0 = Date.now();
for (const f of pass) {
  try {
    const { layout, stats } = convertCubCasa(readFileSync(f, 'utf8'), { doorMM: DOOR, rooms: 'annotated', name: 'x' });
    if (stats.netArea < AMIN || stats.netArea > AMAX) continue;
    items.push({ f, layout, stats });
  } catch { fail++; }
}
items.sort((a, b) => a.stats.netArea - b.stats.netArea);
const picked = TOP > 0 ? items.slice(0, TOP) : items;
process.stdout.write(`面积 ${AMIN}–${AMAX} m² 内 ${items.length} 套，本次写出 ${picked.length} 套（转换失败 ${fail}）\n`);

// 写盘
const marker = join(OUT, 'index.json');
const existingJson = existsSync(OUT) ? readdirSync(OUT).filter((n) => /\.json$/i.test(n)) : [];
// 防呆：把解析后的绝对输出目录打出来，--clean 前能一眼看出是不是目标目录
process.stdout.write(`输出目录 : ${resolve(OUT)}${CLEAN ? `（--clean：将删除其中 ${existingJson.length} 个 json）` : ''}\n`);
if (CLEAN && existingJson.length > 50 && basename(OUT) !== 'layouts') {
  console.error(`拒绝清理 ${resolve(OUT)}：目录里有 ${existingJson.length} 个 json，但目录名不是 layouts。确认无误请加 --force-out。`);
  if (!argv.includes('--force-out')) process.exit(1);
}
if (CLEAN) {
  // 安全守卫：只清"看起来是我们生成的"目录 —— basename 是 layouts、或含 index.json、或目录里还没有 json
  const safe = basename(OUT) === 'layouts' || existsSync(marker) || existingJson.length === 0;
  if (!safe) {
    console.error(`拒绝清理 ${OUT}：它既不是 layouts 目录、也不含 index.json，却已有 ${existingJson.length} 个 json 文件。`);
    process.exit(1);
  }
}
mkdirSync(OUT, { recursive: true });
if (CLEAN) for (const n of existingJson) unlinkSync(join(OUT, n));
const index = [];
let bytes = 0;
for (const it of picked) {
  const rel = it.f.slice(ROOT.length).replace(/^[\\/]/, '').replace(/[\\/]/g, '_').replace(/\.svg$/i, '');
  const file = `${rel}.json`;
  const txt = JSON.stringify(it.layout);              // 紧凑写，体积约省一半
  writeFileSync(join(OUT, file), txt, 'utf8');
  bytes += Buffer.byteLength(txt);
  index.push({
    file, beds: it.stats.bedrooms, baths: it.stats.baths, halls: it.stats.halls,
    rooms: it.stats.rooms, area: +it.stats.netArea.toFixed(2),
    walls: it.stats.walls, doors: it.stats.doors, wins: it.stats.wins,
    mmPerPx: +it.stats.mmPerPx.toFixed(2),
  });
}
const idxTxt = JSON.stringify({
  source: 'CubiCasa5K (CC BY-NC-SA 4.0，仅非商业用途)',
  bedrooms: N, generatedAt: new Date().toISOString(),
  unit: 'mm', items: index,
});
writeFileSync(join(OUT, 'index.json'), idxTxt, 'utf8');

const mb = (bytes / 1024 / 1024).toFixed(1);
process.stdout.write(`\n完成：${picked.length} 套 → ${OUT}/  （几何 ${mb} MB + 索引 ${(Buffer.byteLength(idxTxt) / 1024).toFixed(0)} KB）\n`);
process.stdout.write(`用时 ${((Date.now() - t0) / 1000).toFixed(0)}s\n`);
if (index.length) {
  const a = index.map((o) => o.area);
  process.stdout.write(`面积范围 ${Math.min(...a).toFixed(1)} – ${Math.max(...a).toFixed(1)} m²\n`);

  // 可选：补「示意布置」家具（床/沙发/餐桌…），全部标 suggested:true，应用里虚线显示
  if (argv.includes('--suggest')) {
    try {
      execFileSync(process.execPath, [join(process.cwd(), 'tools', 'furnish-suggest.mjs'), `--dir=${OUT}`],
        { stdio: 'inherit', timeout: 900000 });
    } catch (e) {
      process.stdout.write(`⚠ 示意布置生成失败：${e.message.split('\n')[0]}\n`);
    }
  }

  // 顺手生成缩略图（重建索引会丢掉 thumb 字段，所以这一步必须跟着做）
  try {
    execFileSync(process.execPath, [join(process.cwd(), 'tools', 'layouts-thumbs.mjs'), `--dir=${OUT}`],
      { stdio: 'inherit', timeout: 600000 });
  } catch (e) {
    process.stdout.write(`⚠ 缩略图生成失败（可手动跑 node tools/layouts-thumbs.mjs --dir=${OUT}）：${e.message.split('\n')[0]}\n`);
  }

  process.stdout.write(`启动应用：cd 项目目录 && node tools/serve.mjs 8123 → 打开 http://127.0.0.1:8123 → 文件 ▾ → 户型库…\n`);
}
