import http from 'node:http';
import path from 'node:path';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { root, sqlite } from './storage.mjs';
import api from './api.mjs';
const port = Number(process.env.PORT || 5197),
  dist = path.join(root, 'dist'),
  development = process.env.HADIR_DEV === '1';
const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
let vite;
if (!development && !existsSync(path.join(dist, 'index.html')))
  throw new Error('Aplikasi belum dibangun. Jalankan npm run build.');
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
};
const headers = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(self), microphone=(), geolocation=()',
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
};
const developmentHeaders = {
  ...headers,
  'Cache-Control': 'no-store',
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' ${socketOrigins}; font-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'".replace(
      '${socketOrigins}',
      `ws://127.0.0.1:${port} ws://localhost:${port}`,
    ),
};
const server = http.createServer(async (req, res) => {
  try {
    if (!allowedHosts.has(req.headers.host)) {
      res.writeHead(403);
      res.end('Host tidak diizinkan.');
      return;
    }
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json', ...headers });
      res.end('{"status":"ok"}');
      return;
    }
    if (url.pathname === '/api/app') {
      const chunks = [];
      let total = 0;
      for await (const chunk of req) {
        total += chunk.length;
        if (total > 2600000) {
          res.writeHead(413, headers);
          res.end('Foto terlalu besar.');
          return;
        }
        chunks.push(chunk);
      }
      const request = new Request(url, {
        method: req.method,
        headers: req.headers,
        ...(!['GET', 'HEAD'].includes(req.method) ? { body: Buffer.concat(chunks) } : {}),
      });
      const result = await api(request);
      res.writeHead(result.status, { ...headers, ...Object.fromEntries(result.headers.entries()) });
      res.end(Buffer.from(await result.arrayBuffer()));
      return;
    }
    if (!['GET', 'HEAD'].includes(req.method)) {
      res.writeHead(405, headers);
      res.end();
      return;
    }
    if (development) {
      for (const [name, value] of Object.entries(developmentHeaders)) res.setHeader(name, value);
      vite.middlewares(req, res);
      return;
    }
    let relative;
    try {
      relative = decodeURIComponent(url.pathname);
    } catch {
      res.writeHead(400);
      res.end();
      return;
    }
    let target = path.resolve(dist, '.' + relative);
    if (!target.startsWith(dist + path.sep) && target !== dist) {
      res.writeHead(403);
      res.end();
      return;
    }
    if (!existsSync(target) || statSync(target).isDirectory()) {
      if (path.extname(relative)) {
        res.writeHead(404);
        res.end();
        return;
      }
      target = path.join(dist, 'index.html');
    }
    res.writeHead(200, {
      'Content-Type': mime[path.extname(target)] || 'application/octet-stream',
      'Cache-Control': path.extname(target) === '.html' ? 'no-cache' : 'public, max-age=3600',
      ...headers,
    });
    res.end(req.method === 'HEAD' ? undefined : readFileSync(target));
  } catch (e) {
    console.error('Permintaan gagal:', e.message);
    if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json', ...headers });
    res.end('{"error":"Terjadi kesalahan pada aplikasi lokal."}');
  }
});
if (development) {
  const { createServer } = await import('vite');
  vite = await createServer({
    root,
    server: {
      middlewareMode: true,
      hmr: { server },
      watch: { ignored: ['**/data/**', '**/server/**'] },
    },
    appType: 'spa',
  });
}
server.on('error', (e) => {
  console.error(
    e.code === 'EADDRINUSE'
      ? `Port ${port} sudah dipakai. Buka http://127.0.0.1:${port} atau tutup aplikasi lama.`
      : e.message,
  );
  process.exitCode = 1;
});
server.listen(port, '127.0.0.1', () =>
  console.log(
    `Hadir aktif: http://127.0.0.1:${port}\n${development ? 'Mode pengembangan: perubahan tampilan diperbarui otomatis.' : 'Login mandiri.'} Data: ${path.join(root, 'data')}\nTekan Ctrl+C untuk berhenti.`,
  ),
);
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, async () => {
    if (vite) await vite.close();
    server.close(() => {
      sqlite.close();
      process.exit(0);
    });
  });
