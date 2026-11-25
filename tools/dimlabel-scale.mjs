#!/usr/bin/env node
/**
 * dimlabel-scale.mjs —— 用 SVG 里的房间尺寸标注反解真实 mm/px（v2：按 DOM 归属匹配）
 *
 * 关键发现：DimensionMeasureLabel 是**房间组（g.Space X）的子元素**，
 * 所以不需要做坐标匹配 —— 标签在哪个房间里，就是哪个房间的尺寸。
 *
 * mm/px = sqrt( (W_mm × D_mm) / (W_px × D_px) )，并用长宽比做一次校验。
 *
 * 用法：node tools/dimlabel-scale.mjs .cache/cubicasa5k [样本数]
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = process.argv[2] || '.cache/cubicasa5k';
const SAMPLE = Number(process.argv[3]) || 60;

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
const bbox = (p) => {
  const xs = p.map((v) => v[0]), ys = p.map((v) => v[1]);
  const x0 = Math.min(...xs), y0 = Math.min(...ys);
  return { w: Math.max(...xs) - x0, h: Math.max(...ys) - y0 };
};
const ftIn = (ft, inch) => (+ft) * 304.8 + (+inch) * 25.4;
const DIM_RE = /(\d+)\s*'\s*(\d+(?:\.\d+)?)?\s*"?\s*[x×]\s*(\d+)\s*'\s*(\d+(?:\.\d+)?)?/i;

/** 解析一套 SVG：返回每个房间组的 {poly, dimMM} */
function roomsWithDims(txt) {
  const tagRe = /<\/?([A-Za-z:]+)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>|([^<]+)/g;
  const stack = [];            // 每组 {isSpace, poly, dim}
  const spaceIdx = [];         // 指向 stack 里 Space 组的下标
  const out = [];
  let m;
  while ((m = tagRe.exec(txt))) {
    if (m[4] !== undefined) {                       // 文本节点
      const text = m[4].trim();
      if (!text || !spaceIdx.length) continue;
      const cur = stack[spaceIdx[spaceIdx.length - 1]];
      if (!cur.dim) { const t = text.match(DIM_RE); if (t) cur.dim = [ftIn(t[1], t[2] || 0), ftIn(t[3], t[4] || 0)]; }
      continue;
    }
    const raw = m[0], name = m[1].toLowerCase(), selfClose = m[3] === '/';
    if (raw.startsWith('</')) {
      // 比较的是「下标」，不是对象（之前写成 stack[...] === stack.length-1 永远为 false）
      const wasSpace = spaceIdx.length > 0 && spaceIdx[spaceIdx.length - 1] === stack.length - 1;
      const popped = stack.pop();
      if (wasSpace && spaceIdx.length) { spaceIdx.pop(); if (popped && popped.poly && popped.dim) out.push(popped); }
      continue;
    }
    const attrs = {};
    for (const a of m[2].matchAll(/([:\w-]+)\s*=\s*"([^"]*)"/g)) attrs[a[1]] = a[2];
    if (name === 'polygon' && attrs.points && spaceIdx.length) {
      const cur = stack[spaceIdx[spaceIdx.length - 1]];
      if (!cur.poly) cur.poly = pts(attrs.points);
      continue;
    }
    if (selfClose) continue;                        // 自闭合标签不压栈
    // 注意：必须压所有非自闭合标签（包括 <text>），否则它的 </text> 会把父级提前弹出、栈错位
    const isSpace = name === 'g' && /^Space\s/.test(attrs.class || '');
    stack.push({ isSpace, poly: null, dim: null, type: (attrs.class || '').replace(/^Space\s+/, '') });
    if (isSpace) spaceIdx.push(stack.length - 1);
  }
  return out;
}

const files = walk(root);
const step = Math.max(1, Math.floor(files.length / SAMPLE));
let plans = 0, solved = 0, matched = 0, aspectFail = 0;
const perPlan = [], ratios = [];

for (let i = 0; i < files.length; i += step) {
  let txt;
  try { txt = readFileSync(files[i], 'utf8'); } catch { continue; }
  plans++;
  const rooms = roomsWithDims(txt);
  const doors = [...txt.matchAll(/<g id="Door"[^>]*>[\s\S]{0,400}?<polygon points="([^"]+)"/g)]
    .map((mm) => { const b = bbox(pts(mm[1])); return Math.max(b.w, b.h); }).filter((v) => v > 1).sort((a, b) => a - b);
  const doorPrior = doors.length ? 800 / doors[Math.floor(doors.length * 0.25)] : NaN;

  const scales = [];
  for (const r of rooms) {
    const b = bbox(r.poly);
    if (b.w < 5 || b.h < 5) continue;
    const ratioPx = b.w / b.h, ratioMM = r.dim[0] / r.dim[1];
    const okAspect = Math.abs(ratioPx / ratioMM - 1) < 0.3 || Math.abs(ratioPx * ratioMM - 1) < 0.3;
    if (!okAspect) { aspectFail++; continue; }
    const s = Math.sqrt((r.dim[0] * r.dim[1]) / (b.w * b.h));
    if (s > 1 && s < 100) { scales.push(s); matched++; }
  }
  if (scales.length) {
    scales.sort((a, b) => a - b);
    const med = scales[Math.floor(scales.length / 2)];
    solved++;
    perPlan.push({ med, n: scales.length, doorPrior, spread: scales[scales.length - 1] / scales[0] });
    if (Number.isFinite(doorPrior)) ratios.push(med / doorPrior);
  }
}

const q = (arr, p) => arr[Math.floor(arr.length * p)] ?? NaN;
console.log(`抽样 ${plans} 套`);
console.log(`能算出尺度的：${solved} 套（${((solved / plans) * 100).toFixed(0)}%）`);
console.log(`匹配成功 ${matched} 个标注，长宽比不符被丢弃 ${aspectFail} 个`);

const mm = perPlan.map((p) => p.med).sort((a, b) => a - b);
const sp = perPlan.map((p) => p.spread).sort((a, b) => a - b);
if (mm.length) {
  console.log(`\n=== 由标注反解的 mm/px ===`);
  console.log(`  p10=${q(mm, .1).toFixed(2)}  中位=${q(mm, .5).toFixed(2)}  p90=${q(mm, .9).toFixed(2)}`);
  console.log(`  同一套内多个房间解的一致性（max/min）：中位 ${q(sp, .5).toFixed(2)}×`);
}
const r = ratios.slice().sort((a, b) => a - b);
if (r.length) {
  console.log(`\n=== 标注口径 ÷ 门宽先验（理想 1.0）===`);
  console.log(`  p10=${q(r, .1).toFixed(2)}  中位=${q(r, .5).toFixed(2)}  p90=${q(r, .9).toFixed(2)}`);
  const within10 = r.filter((v) => Math.abs(v - 1) < 0.1).length / r.length;
  const within25 = r.filter((v) => Math.abs(v - 1) < 0.25).length / r.length;
  console.log(`  偏差 ±10% 内：${(within10 * 100).toFixed(0)}%   ±25% 内：${(within25 * 100).toFixed(0)}%`);
  console.log('\n=== 结论 ===');
  if (Math.abs(q(r, .5) - 1) < 0.1) {
    console.log('  门宽先验与标注口径一致 → 先验得到独立证实；且标注口径可直接用作 A 档尺度');
  } else if (Math.abs(q(r, .5) - 1) < 0.3) {
    console.log(`  两者大致一致（系统偏差 $${(q(r, .5) * 100 - 100).toFixed(0)}%）→ 应改用标注口径`);
  } else {
    console.log('  两者不一致 → 标注口径为准，门宽先验弃用');
  }
}
