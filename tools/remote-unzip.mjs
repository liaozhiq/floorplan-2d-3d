#!/usr/bin/env node
/**
 * remote-unzip.mjs — 通过 HTTP Range 请求，只从远程 zip 里取需要的文件（不下载整个 zip）
 *
 * 用法：
 *   node tools/remote-unzip.mjs <zip-url> <out-dir> [--match=model\\.svg$] [--limit=0] [--dry] [--concurrency=5]
 *   示例：
 *   node tools/remote-unzip.mjs "https://zenodo.org/records/2613548/files/cubicasa5k.zip?download=1" \
 *        .cache/cubicasa5k --match='model\.svg$'
 *
 * 动机：CubiCasa5K 的 zip 有 5.1 GB，其中绝大部分是 PNG 栅格；我们只需要 model.svg。
 * 只取 SVG 能把下载量降到几十~几百 MB。
 *
 * 实现：读 zip 尾部的 EOCD（含 Zip64）→ 拿中央目录 → 对每个命中条目发一次 Range 请求，
 *       把「本地文件头 + 压缩数据」一起取回 → inflate → 校验 CRC32 → 写盘。
 */
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { inflateRawSync } from 'node:zlib';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Accept': '*/*',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  'Accept-Encoding': 'identity',
  'Referer': 'https://zenodo.org/',
  'Sec-Fetch-Dest': 'empty', 'Sec-Fetch-Mode': 'cors', 'Sec-Fetch-Site': 'same-origin',
};

const argv = process.argv.slice(2);
const [zipUrl, outDir] = argv.filter((a) => !a.startsWith('--'));
if (!zipUrl || !outDir) {
  console.error('用法: node tools/remote-unzip.mjs <zip-url> <out-dir> [--match=regex] [--limit=N] [--dry] [--concurrency=5]');
  process.exit(2);
}
const arg = (k, d) => { const h = argv.find((a) => a.startsWith(`--${k}=`)); return h ? h.split('=').slice(1).join('=') : d; };
const MATCH = new RegExp(arg('match', 'model\\.svg$'), 'i');
const LIMIT = +arg('limit', 0);
const DRY = argv.includes('--dry');
const CONC = +arg('concurrency', 5);
const RETRY = +arg('retry', 3);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function range(url, start, end, attempt = 0) {
  try {
    const r = await fetch(url, { headers: { ...HEADERS, Range: `bytes=${start}-${end}` }, signal: AbortSignal.timeout(60000) });
    if (r.status !== 206 && r.status !== 200) throw new Error(`HTTP ${r.status}`);
    const buf = Buffer.from(await r.arrayBuffer());
    if (r.status === 200) return buf.subarray(start, end + 1);       // 服务器忽略 Range 时的兜底
    return buf;
  } catch (e) {
    if (attempt >= RETRY) throw e;
    await sleep(600 * (attempt + 1));
    return range(url, start, end, attempt + 1);
  }
}

// ---------- CRC32 ----------
const crcTable = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; }
  return t;
})();
const crc32 = (b) => { let c = -1; for (const v of b) c = crcTable[(c ^ v) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; };

// ---------- 1. 尾部 EOCD ----------
const TAIL = 70000;
let head = await fetch(zipUrl, { method: 'HEAD', headers: HEADERS, signal: AbortSignal.timeout(30000) });
if (!head.ok) throw new Error(`HEAD 失败: HTTP ${head.status}`);
const totalSize = +head.headers.get('content-length');
if (!totalSize) throw new Error('拿不到 content-length');
process.stdout.write(`远程 zip 大小: ${(totalSize / 2 ** 30).toFixed(2)} GiB\n`);

const tailStart = Math.max(0, totalSize - TAIL);
const tail = await range(zipUrl, tailStart, totalSize - 1);
let eocd = -1;
for (let i = tail.length - 22; i >= 0; i--) if (tail.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
if (eocd < 0) throw new Error('找不到 EOCD，可能不是标准 zip');
let entries = tail.readUInt16LE(eocd + 10);
let cdSize = tail.readUInt32LE(eocd + 12);
let cdOffset = tail.readUInt32LE(eocd + 16);

// ---------- Zip64 ----------
if (entries === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
  const locSigPos = eocd - 20;
  if (locSigPos >= 0 && tail.readUInt32LE(locSigPos) === 0x07064b50) {
    const z64Off = Number(tail.readBigUInt64LE(locSigPos + 8));
    const rec = await range(zipUrl, z64Off, z64Off + 56);
    if (rec.readUInt32LE(0) !== 0x06064b50) throw new Error('Zip64 EOCD 签名不符');
    entries = Number(rec.readBigUInt64LE(32));
    cdSize = Number(rec.readBigUInt64LE(40));
    cdOffset = Number(rec.readBigUInt64LE(48));
    process.stdout.write('检测到 Zip64\n');
  }
}
process.stdout.write(`中央目录: ${entries} 条目, ${(cdSize / 1024 / 1024).toFixed(2)} MiB @ ${cdOffset}\n`);

// ---------- 2. 中央目录 ----------
const CHUNK = 4 * 1024 * 1024;
const cd = Buffer.alloc(cdSize);
for (let off = 0; off < cdSize; off += CHUNK) {
  const end = Math.min(off + CHUNK, cdSize) - 1;
  const part = await range(zipUrl, cdOffset + off, cdOffset + end);
  part.copy(cd, off);
}

const all = [];
let p = 0;
while (p + 46 <= cd.length && cd.readUInt32LE(p) === 0x02014b50) {
  const method = cd.readUInt16LE(p + 10);
  const crc = cd.readUInt32LE(p + 16);
  let csize = cd.readUInt32LE(p + 20);
  let usize = cd.readUInt32LE(p + 24);
  const nameLen = cd.readUInt16LE(p + 28);
  const extraLen = cd.readUInt16LE(p + 30);
  const commentLen = cd.readUInt16LE(p + 32);
  let localOffset = cd.readUInt32LE(p + 42);
  const name = cd.subarray(p + 46, p + 46 + nameLen).toString('utf8');
  // Zip64 扩展字段
  if (usize === 0xffffffff || csize === 0xffffffff || localOffset === 0xffffffff) {
    let q = p + 46 + nameLen;
    const qEnd = q + extraLen;
    while (q + 4 <= qEnd) {
      const id = cd.readUInt16LE(q), len = cd.readUInt16LE(q + 2);
      if (id === 0x0001) {
        let r = q + 4;
        if (usize === 0xffffffff) { usize = Number(cd.readBigUInt64LE(r)); r += 8; }
        if (csize === 0xffffffff) { csize = Number(cd.readBigUInt64LE(r)); r += 8; }
        if (localOffset === 0xffffffff) { localOffset = Number(cd.readBigUInt64LE(r)); r += 8; }
        break;
      }
      q += 4 + len;
    }
  }
  all.push({ name, method, crc, csize, usize, localOffset });
  p += 46 + nameLen + extraLen + commentLen;
}

const targets = all.filter((e) => MATCH.test(e.name) && (e.usize > 0 || e.csize > 0));
// --inventory：只统计压缩包里有哪几类文件（用于确认数据集是否附带尺度信息）
if (argv.includes('--inventory')) {
  const bySuffix = new Map();
  for (const e of all) {
    const base = e.name.split('/').pop();
    const suffix = /\.[a-z0-9]+$/i.test(base) ? base.slice(base.lastIndexOf('.')).toLowerCase() : '(no ext)';
    if (!bySuffix.has(suffix)) bySuffix.set(suffix, { n: 0, bytes: 0, sample: e.name });
    const s = bySuffix.get(suffix);
    s.n++; s.bytes += e.csize;
  }
  process.stdout.write(`\n压缩包文件类型（共 ${all.length} 个条目）：\n`);
  for (const [k, v] of [...bySuffix.entries()].sort((a, b) => b[1].n - a[1].n)) {
    process.stdout.write(`  ${k.padEnd(10)} ${String(v.n).padStart(6)} 个  ${(v.bytes / 1024 / 1024).toFixed(1).padStart(8)} MiB  例：${v.sample}\n`);
  }
  process.exit(0);
}
const SKIP_EXISTING = argv.includes('--skip-existing');
const pending = SKIP_EXISTING ? targets.filter((e) => !existsSync(join(outDir, e.name))) : targets;
const limit = LIMIT > 0 ? Math.min(LIMIT, pending.length) : pending.length;
const picked = pending.slice(0, limit);
const bytesPlan = picked.reduce((a, e) => a + e.csize, 0);
process.stdout.write(`命中 ${targets.length} 个 / 全部 ${all.length} 个；本次取 ${picked.length} 个，压缩后 ${(bytesPlan / 1024 / 1024).toFixed(1)} MiB\n`);
if (DRY || !picked.length) {
  picked.slice(0, 10).forEach((e) => process.stdout.write(`  ${e.name}  ${e.usize} B\n`));
  process.stdout.write(DRY ? '(--dry：只列清单，不下载)\n' : '没有命中项\n');
  process.exit(0);
}

// ---------- 3. 并发取条目 ----------
mkdirSync(outDir, { recursive: true });
let done = 0, okCount = 0, failCount = 0, gotBytes = 0;
const t0 = Date.now();

async function fetchOne(e) {
  // 一次请求取「本地头 + 压缩数据」；多要 1024 字节覆盖变长的 name/extra
  const start = e.localOffset;
  const end = Math.min(e.localOffset + 30 + 1024 + e.csize, totalSize - 1);
  const buf = await range(zipUrl, start, end);
  if (buf.readUInt32LE(0) !== 0x04034b50) throw new Error('本地头签名不符');
  const nameLen = buf.readUInt16LE(26), extraLen = buf.readUInt16LE(28);
  const dataStart = 30 + nameLen + extraLen;
  const raw = buf.subarray(dataStart, dataStart + e.csize);
  if (raw.length !== e.csize) throw new Error(`数据不足 ${raw.length}/${e.csize}`);
  const data = e.method === 8 ? inflateRawSync(raw) : raw;
  if (data.length !== e.usize) throw new Error(`解压长度不符 ${data.length}/${e.usize}`);
  if (crc32(data) !== e.crc) throw new Error('CRC 校验失败');
  const dest = join(outDir, e.name);
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, data);
  gotBytes += e.csize;
}

async function worker(queue) {
  for (;;) {
    const e = queue.shift();
    if (!e) return;
    try { await fetchOne(e); okCount++; }
    catch (err) { failCount++; if (failCount <= 5) process.stdout.write(`  ! ${e.name}: ${err.message}\n`); }
    done++;
    if (done % 25 === 0 || done === picked.length) {
      const sec = (Date.now() - t0) / 1000;
      process.stdout.write(`  ${done}/${picked.length}  已取 ${(gotBytes / 1024 / 1024).toFixed(1)} MiB  ${(gotBytes / 1024 / Math.max(sec, 1)).toFixed(0)} KiB/s\n`);
    }
  }
}

const queue = picked.slice();
await Promise.all(Array.from({ length: Math.max(1, CONC) }, () => worker(queue)));
process.stdout.write(`完成：成功 ${okCount}，失败 ${failCount}，用时 ${((Date.now() - t0) / 1000).toFixed(0)}s → ${outDir}\n`);
if (failCount) process.exit(1);
