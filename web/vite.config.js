import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

const WEB_ROOT = path.dirname(fileURLToPath(import.meta.url));

/**
 * Serves web/api/*.js handlers seamlessly during local `vite dev` as well as Vercel serverless production.
 */
function localVercelApiPlugin() {
  return {
    name: 'local-vercel-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url || !req.url.startsWith('/api/')) return next();
        const route = req.url.split('?')[0].replace(/^\/api\//, '').replace(/[^a-zA-Z0-9_-]/g, '');
        if (!route) return next();
        try {
          const modUrl = pathToFileURL(path.join(WEB_ROOT, 'api', `${route}.js`)).href + `?t=${Date.now()}`;
          const mod = await import(/* @vite-ignore */ modUrl);
          const handler = mod.default;
          if (typeof handler !== 'function') return next();
          const chunks = [];
          for await (const ch of req) chunks.push(ch);
          const rawBuf = Buffer.concat(chunks);
          const ct = String(req.headers['content-type'] || '');
          let body = rawBuf;
          if (ct.includes('application/json')) {
            try { body = rawBuf.length ? JSON.parse(rawBuf.toString('utf8')) : {}; } catch { body = {}; }
          }
          const fakeReq = {
            method: req.method,
            url: req.url,
            headers: req.headers,
            body,
            rawBody: rawBuf,
          };
          const fakeRes = {
            statusCode: 200,
            headers: {},
            setHeader(k, v) { res.setHeader(k, v); },
            status(code) { res.statusCode = code; return this; },
            json(obj) {
              if (!res.headersSent) res.setHeader('Content-Type', 'application/json; charset=utf-8');
              res.end(JSON.stringify(obj));
            },
            send(txt) {
              res.end(typeof txt === 'string' || Buffer.isBuffer(txt) ? txt : JSON.stringify(txt));
            },
          };
          await handler(fakeReq, fakeRes);
        } catch (err) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ error: err?.message || String(err) }));
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [svelte(), localVercelApiPlugin()],
  server: {
    port: 5174,
    strictPort: true,
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'credentialless',
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    rollupOptions: {
      external: ['/vendor/vision_bundle.mjs'],
    },
  },
});
