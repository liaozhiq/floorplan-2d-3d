#!/usr/bin/env node
/**
 * fpcad-probe.mjs —— 探 FloorPlanCAD 的类别表与「尺度可验证性」
 *
 * 用法：node tools/fpcad-probe.mjs
 *
 * 它做两件事：
 *   1. 从 HF 镜像 Voxel51/FloorPlanCAD 的 samples.json 里统计所有标注类别
 *      （用于确认有没有「承重墙 / structural」这类；结论：没有）
 *   2. 用三类几何探针反推 mm/px，检验数据集卡片声称的「20m×20m 图块 = 20mm/px」
 *      （结论：三类探针互相矛盾，说明镜像里的是区域级掩码，不能当图元几何用 → 无法验证）
 *
 * 只读远程、按 Range 取几 MB，不落盘。
 */
const UA = 'Mozilla/5.0';
const URL = 'https://huggingface.co/datasets/Voxel51/FloorPlanCAD/resolve/main/samples.json';
const W = 1000, H = 1000;               // 镜像里的 PNG 实测为 1000×1000

async function rangeGet(a, b) {
  const r = await fetch(URL, { headers: { 'User-Agent': UA, Range: `bytes=${a}-${b}` }, signal: AbortSignal.timeout(90000) });
  if (r.status !== 206 && r.status !== 200) throw new Error('HTTP ' + r.status);
  return Buffer.from(await r.arrayBuffer());
}

const chunks = [];
for (const [a, b] of [[1000000, 3999999], [8000000, 11999999], [20000000, 23999999], [36000000, 39999999]]) {
  try { chunks.push(await rangeGet(a, b)); } catch (e) { console.log('chunk 失败:', e.message); }
}
const text = Buffer.concat(chunks).toString('latin1');
console.log(`抓取 ${(text.length / 1048576).toFixed(1)} MB 标注文本\n`);

const re = /"label":\s*"([a-zA-Z_]+)",\s*"bounding_box":\s*\[\s*([0-9.eE+-]+),\s*([0-9.eE+-]+),\s*([0-9.eE+-]+),\s*([0-9.eE+-]+)\s*\]/g;
const byLabel = {};
let m;
while ((m = re.exec(text))) {
  const w = +m[4] * W, h = +m[5] * H;
  if (w > 0 && h > 0) (byLabel[m[1]] ||= []).push([w, h]);
}
console.log('=== 1. 类别表 ===');
const labels = Object.keys(byLabel).sort();
console.log(`${labels.length} 种：${labels.join(', ')}`);
const structural = labels.filter((k) => /bearing|structural|load|shear|column|beam|柱|梁|承重/i.test(k));
console.log(`结构类标签：${structural.length ? structural.join(', ') : '无 —— 没有承重墙/结构墙类别'}`);

const q = (arr, p) => arr[Math.floor(arr.length * p)] ?? NaN;
const stat = (label, pick, filter) => {
  const arr = (byLabel[label] || []).filter(filter || (() => true)).map(pick).filter((v) => v > 0).sort((a, b) => a - b);
  return arr.length >= 5 ? { n: arr.length, p50: q(arr, .5) } : null;
};
const aspect = ([w, h]) => Math.max(w, h) / Math.min(w, h);

console.log('\n=== 2. 尺度可验证性（三类探针）===');
const probes = [
  ['细长墙段短边（当墙厚 200mm）', stat('wall', ([w, h]) => Math.min(w, h), ([w, h]) => aspect([w, h]) > 4), 200],
  ['窗短边（当墙厚 200mm）', stat('window', ([w, h]) => Math.min(w, h), ([w, h]) => aspect([w, h]) > 2), 200],
  ['单开门 bbox 平均边长（当门长 850mm）', stat('single_door', ([w, h]) => (w + h) / 2), 850],
];
const fits = [];
for (const [name, s, assumeMM] of probes) {
  if (!s) { console.log(`${name}: 样本不足`); continue; }
  const fit = assumeMM / s.p50;
  fits.push(fit);
  console.log(`${name}  n=${s.n}  p50=${s.p50.toFixed(1)}px  → 反推 ${fit.toFixed(2)} mm/px`);
}
const mean = fits.reduce((a, b) => a + b, 0) / fits.length;
const spread = Math.max(...fits) / Math.min(...fits);
console.log(`\n三者均值 ${mean.toFixed(2)} mm/px，最大/最小相差 ${spread.toFixed(0)} 倍`);
console.log(spread > 5
  ? '结论：探针互相矛盾（差一个数量级）→ 镜像里是区域级掩码，不能当图元几何量 → 20mm/px 无法验证\n'
  : `结论：探针大致收敛到 ${mean.toFixed(1)} mm/px，可作为参考\n`);
console.log('要真正确定单位，需要一份原始 SVG（看 width/height/viewBox 是否为 mm 量级的数值）。');
console.log('官方下载在 Google Drive，需要手动获取；本镜像不含 SVG。');
