import http from 'node:http';
import path from 'node:path';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { root, sqlite } from './storage.mjs';
import api from './api.mjs';
const port = Number(process.env.PORT || 5197);
const host = process.env.HOST || '127.0.0.1';
const dist = path.join(root, 'dist');
const development = process.env.HADIR_DEV === '1';
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error('PORT harus berupa angka antara 1 dan 65535.');
if (!['127.0.0.1', '0.0.0.0'].includes(host))
  throw new Error('HOST harus 127.0.0.1 (lokal) atau 0.0.0.0 (server hosting).');

// Public HTTPS origin is supplied explicitly by the deployment operator.
// Never trust client-provided X-Forwarded-Host or X-Forwarded-Proto headers.
const publicOriginText = process.env.HADIR_PUBLIC_ORIGIN;
let publicOrigin;
if (publicOriginText) {
  try {
    publicOrigin = new URL(publicOriginText);
  } catch {
    throw new Error('HADIR_PUBLIC_ORIGIN harus berupa URL HTTPS yang valid.');
  }
  const hostname = publicOrigin.hostname;
  if (
    publicOrigin.protocol !== 'https:' ||
    !hostname.includes('.') ||
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    publicOrigin.username ||
    publicOrigin.password ||
    publicOrigin.pathname !== '/' ||
    publicOrigin.search ||
    publicOrigin.hash ||
    publicOrigin.port
  ) {
    throw new Error('HADIR_PUBLIC_ORIGIN harus origin HTTPS publik, contoh: https://hadir.example.org');
  }
}
if (host === '0.0.0.0' && !publicOrigin)
  throw new Error('HOST=0.0.0.0 memerlukan HADIR_PUBLIC_ORIGIN HTTPS.');
if (publicOrigin && (!process.env.HADIR_SETUP_TOKEN || process.env.HADIR_SETUP_TOKEN.length < 32))
  throw new Error('Akses publik memerlukan HADIR_SETUP_TOKEN acak minimal 32 karakter.');
const localHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
const allowedHosts = new Set(host === '0.0.0.0' ? [] : localHosts);
if (publicOrigin) allowedHosts.add(publicOrigin.host);
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
    // Allow local health probes only; do not expose login over plain HTTP.
    const localHealth = req.url === '/health' && localHosts.has(req.headers.host);
    if (!allowedHosts.has(req.headers.host) && !localHealth) {
      res.writeHead(403);
      res.end('Host tidak diizinkan.');
      return;
    }
    const requestOrigin =
      publicOrigin && req.headers.host === publicOrigin.host
        ? publicOrigin.origin
        : `http://${req.headers.host}`;
    const url = new URL(req.url, requestOrigin);
    if (url.origin !== requestOrigin) {
      res.writeHead(403, headers);
      res.end('Origin tidak diizinkan.');
      return;
    }
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
server.listen(port, host, () =>
  console.log(
    `Hadir aktif: ${publicOrigin?.origin || `http://127.0.0.1:${port}`} (listen ${host}:${port})\n${development ? 'Mode pengembangan: perubahan tampilan diperbarui otomatis.' : 'Login mandiri.'} Data: ${process.env.HADIR_DATA_DIR || path.join(root, 'data')}\nTekan Ctrl+C untuk berhenti.`,
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
