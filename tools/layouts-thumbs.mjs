#!/usr/bin/env node
/**
 * layouts-thumbs.mjs —— 给户型库批量生成平面图缩略图，并写回 index.json
 *
 * 用法：
 *   node tools/layouts-thumbs.mjs                 # 默认 layouts/，边长 360px
 *   node tools/layouts-thumbs.mjs --px=420        # 换尺寸
 *   node tools/layouts-thumbs.mjs --force         # 已存在的也重画
 *
 * 产物：layouts/thumb/<同名>.png，并在 index.json 每条里加 thumb 字段。
 * 缩略图使用 render-layout.mjs 的平面图渲染（与本项目 2D 视图同一套配色）。
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { execFileSync } from 'node:child_process';

const argv = process.argv.slice(2);
const arg = (k, d) => { const h = argv.find((a) => a.startsWith(`--${k}=`)); return h ? h.split('=')[1] : d; };
const DIR = arg('dir', 'layouts');
const PX = +arg('px', 360);
const FORCE = argv.includes('--force');

const IDX = join(DIR, 'index.json');
if (!existsSync(IDX)) { console.error(`找不到 ${IDX}`); process.exit(1); }
const index = JSON.parse(readFileSync(IDX, 'utf8'));
if (!Array.isArray(index.items) || !index.items.length) { console.error('index.json 里没有 items'); process.exit(1); }

const THUMB_DIR = join(DIR, 'thumb');
mkdirSync(THUMB_DIR, { recursive: true });

const render = join(process.cwd(), 'tools', 'render-layout.mjs');
let made = 0, skipped = 0, failed = 0;
const t0 = Date.now();

index.items.forEach((it, i) => {
  const base = it.file.replace(/\.json$/i, '');
  const out = join(THUMB_DIR, `${base}.png`);
  it.thumb = `thumb/${base}.png`;
  if (!FORCE && existsSync(out)) { skipped++; return; }
  try {
    execFileSync(process.execPath, [render, join(DIR, it.file), `--out=${out}`, `--px=${PX}`], { stdio: 'ignore', timeout: 60000 });
    made++;
  } catch { failed++; }
  if ((made + failed) % 40 === 0) process.stdout.write(`  ${i + 1}/${index.items.length}\n`);
});

// 清理孤儿缩略图（对应 json 已不存在的）
const keep = new Set(index.items.map((it) => basename(it.thumb)));
let orphans = 0;
for (const f of readdirSync(THUMB_DIR)) {
  if (/\.png$/i.test(f) && !keep.has(f)) { unlinkSync(join(THUMB_DIR, f)); orphans++; }
}

writeFileSync(IDX, JSON.stringify(index), 'utf8');
const bytes = readdirSync(THUMB_DIR).reduce((a, f) => a + (f.endsWith('.png') ? readFileSync(join(THUMB_DIR, f)).length : 0), 0);
console.log(`缩略图：新建 ${made}，已存在跳过 ${skipped}，失败 ${failed}，清理孤儿 ${orphans}`);
console.log(`目录 ${THUMB_DIR}（${(bytes / 1024).toFixed(0)} KB），索引已写入 thumb 字段`);
console.log(`用时 ${((Date.now() - t0) / 1000).toFixed(0)}s`);
