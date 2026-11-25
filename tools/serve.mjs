#!/usr/bin/env node
/**
 * serve.mjs —— 零依赖静态服务器（给"户型库"用：浏览器必须走 http 才能读 layouts/）
 *
 * 用法：
 *   node tools/serve.mjs              # 默认 127.0.0.1:8080
 *   node tools/serve.mjs 8123         # 指定端口
 *   node tools/serve.mjs 8080 0.0.0.0 # 指定端口 + 允许局域网访问
 *
 * 为什么不用 python -m http.server：
 *   1) 有的机器 8000 被 Windows 保留，直接 PermissionError(WinError 10013)；
 *   2) 这里显式报"端口被占"并提示换一个，不吐一屏 traceback。
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, resolve, normalize, sep } from 'node:path';

const PORT = Number(process.argv[2]) || 8080;
const HOST = process.argv[3] || '127.0.0.1';
const ROOT = resolve('.');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    let p = decodeURIComponent(url.pathname);
    if (p.endsWith('/')) p += 'index.html';
    // 目录穿越防护：解析后必须仍在 ROOT 之内
    const abs = resolve(join(ROOT, normalize(p)));
    if (abs !== ROOT && !abs.startsWith(ROOT + sep)) {
      res.writeHead(403).end('forbidden');
      return;
    }
    const st = await stat(abs).catch(() => null);
    if (!st || !st.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('404 ' + p);
      return;
    }
    const body = await readFile(abs);
    res.writeHead(200, {
      'Content-Type': MIME[extname(abs).toLowerCase()] || 'application/octet-stream',
      'Content-Length': body.length,
      'Cache-Control': 'no-cache',
    }).end(body);
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' }).end('500 ' + e.message);
  }
});

server.on('error', (e) => {
  if (e.code === 'EACCES' || e.code === 'EADDRINUSE') {
    console.error(`端口 ${PORT} 不可用（${e.code}）。换一个，例如：node tools/serve.mjs ${PORT + 1}`);
  } else {
    console.error('启动失败：', e.message);
  }
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  console.log(`静态服务器已启动：http://${HOST}:${PORT}`);
  console.log(`根目录：${ROOT}`);
  console.log(`户型库：http://${HOST}:${PORT}/  →  文件 ▾ → 户型库…`);
  console.log('按 Ctrl+C 停止');
});
