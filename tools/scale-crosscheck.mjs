#!/usr/bin/env node
/**
 * scale-crosscheck.mjs —— 用「墙厚」这个独立先验交叉验证「门宽」先验
 *
 * 原理：门宽先验（800mm）只要错了，就会同时把墙厚算错。
 * 墙的厚度在像素里可以直接量（细长矩形的厚度 ≈ 2×面积/周长），
 * 用门宽推定的 mm/px 换算出来，应当落在住宅墙厚的常识区间（隔墙 70–120、外墙 200–300）。
 *
 * 用法：node tools/scale-crosscheck.mjs .cache/cubicasa5k [--sample=800] [--door=800]
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const argv = process.argv.slice(2);
const root = argv.find((a) => !a.startsWith('--'));
if (!root) { console.error('用法: node tools/scale-crosscheck.mjs <cubicasak-root> [--sample=N] [--door=800]'); process.exit(2); }
const arg = (k, d) => { const h = argv.find((a) => a.startsWith(`--${k}=`)); return h ? h.split('=')[1] : d; };
const SAMPLE = +arg('sample', 800);
const DOOR_MM = +arg('door', 800);

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

const pts = (s) => {
  const nums = s.trim().split(/[\s,]+/).map(Number).filter(Number.isFinite);
  const out = [];
  for (let i = 0; i + 1 < nums.length; i += 2) out.push([nums[i], nums[i + 1]]);
  return out;
};
const areaOf = (p) => { let a = 0; for (let i = 0; i < p.length; i++) { const q = p[i], r = p[(i + 1) % p.length]; a += q[0] * r[1] - r[0] * q[1]; } return Math.abs(a) / 2; };
const perimOf = (p) => { let s = 0; for (let i = 0; i < p.length; i++) { const q = p[i], r = p[(i + 1) % p.length]; s += Math.hypot(r[0] - q[0], r[1] - q[1]); } return s; };
const bboxOf = (p) => {
  const xs = p.map((v) => v[0]), ys = p.map((v) => v[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
};
const q = (arr, p) => arr[Math.floor(arr.length * p)] ?? NaN;

// 取多边形：<g id="X" ...> 之后最近的 <polygon points="...">
function polysOf(txt, ids) {
  const out = [];
  for (const id of ids) {
    const re = new RegExp(`<g id="${id}"[^>]*>[\\s\\S]{0,400}?<polygon points="([^"]+)"`, 'g');
    let m;
    while ((m = re.exec(txt))) { const p = pts(m[1]); if (p.length >= 3) out.push(p); }
  }
  return out;
}

const files = walk(root);
process.stdout.write(`数据集共 ${files.length} 套，抽样 ${Math.min(SAMPLE, files.length)} 套\n`);
const step = Math.max(1, Math.floor(files.length / SAMPLE));

const rows = [];
for (let i = 0; i < files.length; i += step) {
  let txt;
  try { txt = readFileSync(files[i], 'utf8'); } catch { continue; }
  const walls = polysOf(txt, ['Wall', 'Panel']);
  const doors = polysOf(txt, ['Door']);
  if (walls.length < 3 || doors.length < 1) continue;

  // 墙厚：细长多边形的厚度 ≈ 2×面积/周长（对 L×t 的矩形，等于 t）
  const thick = walls.map((p) => {
    const a = areaOf(p), per = perimOf(p);
    return per > 0 ? (2 * a) / per : 0;
  }).filter((t) => t > 0.2 && t < 200).sort((a, b) => a - b);
  if (thick.length < 3) continue;

  // 门宽：门洞多边形的长边
  const dw = doors.map((p) => { const [x0, y0, x1, y1] = bboxOf(p); return Math.max(x1 - x0, y1 - y0); })
    .filter((v) => v > 1).sort((a, b) => a - b);
  if (!dw.length) continue;

  const doorQ25 = q(dw, 0.25);
  const mmPerPx = DOOR_MM / doorQ25;
  const wallMedPx = q(thick, 0.5);
  rows.push({
    file: files[i], doorQ25, mmPerPx, wallMedPx,
    wallMM: wallMedPx * mmPerPx,
    planW: (() => { const all = walls.flat(); const xs = all.map((v) => v[0]); return Math.max(...xs) - Math.min(...xs); })() * mmPerPx,
  });
}

const mmPP = rows.map((r) => r.mmPerPx).sort((a, b) => a - b);
const wallMM = rows.map((r) => r.wallMM).sort((a, b) => a - b);
const planW = rows.map((r) => r.planW).sort((a, b) => a - b);

console.log(`\n有效样本 ${rows.length} 套`);
console.log('\n=== 门宽先验推出的 mm/px ===');
console.log(`  p10=${q(mmPP, .1).toFixed(2)}  中位=${q(mmPP, .5).toFixed(2)}  p90=${q(mmPP, .9).toFixed(2)}`);

console.log('\n=== 用它换算出的墙厚（独立先验，应落在 70–300mm）===');
console.log(`  p10=${q(wallMM, .1).toFixed(0)}mm  中位=${q(wallMM, .5).toFixed(0)}mm  p90=${q(wallMM, .9).toFixed(0)}mm`);
const inRange = wallMM.filter((v) => v >= 70 && v <= 300).length / wallMM.length;
const inLoose = wallMM.filter((v) => v >= 50 && v <= 500).length / wallMM.length;
console.log(`  落在 70–300mm 的比例：${(inRange * 100).toFixed(1)}%   （放宽到 50–500mm：${(inLoose * 100).toFixed(1)}%）`);

console.log('\n=== 换算出的户型面宽（应落在 4–20m）===');
console.log(`  p10=${(q(planW, .1) / 1000).toFixed(1)}m  中位=${(q(planW, .5) / 1000).toFixed(1)}m  p90=${(q(planW, .9) / 1000).toFixed(1)}m`);

console.log('\n=== 结论 ===');
if (inRange > 0.6) {
  console.log('  门宽先验与墙厚先验**互相吻合**（多数墙厚落在住宅常识区间）→ 尺度估计可用，但仍属"推定"');
  console.log(`  建议误差范围：墙厚 p10–p90 = ${q(wallMM, .1).toFixed(0)}–${q(wallMM, .9).toFixed(0)}mm，对应尺度不确定度约 ±${(((q(wallMM, .9) - q(wallMM, .1)) / 2 / q(wallMM, .5)) * 100).toFixed(0)}%`);
} else {
  console.log(`  两个先验**不吻合**（只有 ${(inRange * 100).toFixed(0)}% 的墙厚在常识区间）→ 门宽 ${DOOR_MM}mm 的先验不可靠，需要换基准`);
}
