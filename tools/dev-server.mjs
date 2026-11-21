// Local preview of the whole site, portal included: `npm run dev`, then open http://localhost:8787/portal/
// Serves the website files and runs the portal API against a local SQLite file (.dev-portal.db).
// Google sign-in is replaced by a local-only sign-in: /auth/dev?email=owner@example.com
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { pathToFileURL } from 'node:url';
import { localD1 } from './d1-local.mjs';
import { handle } from '../server/app.js';

const ROOT = new URL('..', import.meta.url).pathname;
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.webp': 'image/webp', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.txt': 'text/plain', '.webmanifest': 'application/manifest+json',
};
// Only the files the live site publishes (see tools/build.sh) are served.
const PUBLIC = /^\/(index\.html|styles\.css|app\.js|chat\.js|projects\.js|sw\.js|manifest\.webmanifest|(images|fonts|icons|portal)\/[\w.-]+)$/;

export async function startDevServer({ port = 8787, host = '127.0.0.1', dbPath = ':memory:', env = {} } = {}) {
  const fullEnv = { DB: localD1(dbPath), COOKIE_INSECURE: '1', DEV_LOGIN: '1', OWNER_EMAILS: 'owner@example.com', ...env };
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/')) {
        const chunks = [];
        for await (const c of req) chunks.push(c);
        const request = new Request(url, {
          method: req.method,
          headers: Object.entries(req.headers).flatMap(([k, v]) => (Array.isArray(v) ? v.map(x => [k, x]) : [[k, v]])),
          body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks),
        });
        const response = await handle(request, fullEnv);
        const headers = {};
        response.headers.forEach((v, k) => { if (k !== 'set-cookie') headers[k] = v; });
        const cookies = response.headers.getSetCookie();
        if (cookies.length) headers['set-cookie'] = cookies;
        res.writeHead(response.status, headers);
        res.end(Buffer.from(await response.arrayBuffer()));
        return;
      }
      let path = normalize(url.pathname);
      if (path === '/') path = '/index.html';
      if (path === '/portal' || path === '/portal/') path = '/portal/index.html';
      if (!PUBLIC.test(path)) throw new Error('not public');
      const body = await readFile(join(ROOT, path));
      res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'application/octet-stream', 'cache-control': 'no-store' });
      res.end(body);
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found');
    }
  });
  await new Promise(r => server.listen(port, host, r));
  return { server, env: fullEnv, url: `http://${host === '127.0.0.1' ? 'localhost' : host}:${server.address().port}` };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { url } = await startDevServer({ dbPath: join(ROOT, '.dev-portal.db'), port: Number(process.env.PORT) || 8787 });
  console.log(`Site:   ${url}/\nPortal: ${url}/portal/\nSign in as owner:  ${url}/auth/dev?email=owner@example.com&name=Owner\nSign in as member: ${url}/auth/dev?email=member@example.com&name=Member`);
}
