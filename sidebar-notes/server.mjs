import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { createFeedService } from './feed.mjs';
import { createBilibiliAccount } from './bilibili-account.mjs';
import { createPlaybackService } from './playback.mjs';
import { parseSource } from './web/player.mjs';
import { createCredentialStore } from './credential-store.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
export const APP_ID = 'sidebar-notes-local-v1';
export const DEFAULT_PORT = 17329;
const files = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
  ['/app.mjs', ['app.mjs', 'text/javascript; charset=utf-8']],
  ['/player.mjs', ['player.mjs', 'text/javascript; charset=utf-8']],
  ['/icon.svg', ['icon.svg', 'image/svg+xml']]
]);

export async function startServer(port = DEFAULT_PORT, { account = createBilibiliAccount() } = {}) {
  const token = randomBytes(24).toString('hex');
  const feed = createFeedService();
  const playback = createPlaybackService({ account });
  let origin;
  const server = http.createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    response.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; media-src 'self' blob:; frame-src https://player.bilibili.com; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
    response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), fullscreen=(), picture-in-picture=()');
    if (request.headers.host !== new URL(origin).host) { response.writeHead(403).end('Forbidden host'); return; }
    const url = new URL(request.url, origin);
    const json = (code, data) => { response.writeHead(code, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(data)); };
    const sameOrigin = request.headers['sec-fetch-site'] !== 'cross-site' && (!request.headers.origin || request.headers.origin === origin);
    const authorized = sameOrigin && request.headers['x-session-token'] === token;
    if (url.pathname === '/api/health' && request.method === 'GET') { json(200, { app: APP_ID }); return; }
    if (url.pathname === '/api/playback' && request.method === 'GET') {
      if (!authorized) { json(403, { error: '请刷新页面后重试。' }); return; }
      let video;
      try { video = parseSource(url.searchParams.get('source') || ''); }
      catch (error) { json(400, { error: error.message }); return; }
      try { json(200, await playback.prepare(video, Number(url.searchParams.get('quality') || 80))); }
      catch (error) { json(error.status || 502, { error: error.message }); }
      return;
    }
    if (url.pathname.startsWith('/api/media/')) {
      if (!authorized) { json(403, { error: '请刷新页面后重试。' }); return; }
      const match = /^\/api\/media\/([a-f\d]{40})\/(manifest\.mpd|video\.m4s|audio\.m4s)$/.exec(url.pathname);
      if (!match || request.method !== 'GET') { json(404, { error: 'Not found' }); return; }
      try { await playback.serve(match[1], match[2], request, response); }
      catch (error) { if (!response.headersSent) json(error.status || 502, { error: error.message }); }
      return;
    }
    if (url.pathname === '/api/feed' && request.method === 'GET') {
      if (!authorized) { json(403, { error: '请刷新页面后重试。' }); return; }
      const type = url.searchParams.get('type') || 'personal';
      const page = Number(url.searchParams.get('page') || 1);
      try { json(200, type === 'personal' ? await account.recommendations(page) : await feed(type, page)); }
      catch (error) { json(error.status || 502, { error: error.name === 'TimeoutError' ? '连接B站超时，请稍后重试。' : error.message }); }
      return;
    }
    if (url.pathname.startsWith('/api/auth/')) {
      if (!authorized || (request.method === 'POST' && request.headers.origin !== origin)) { json(403, { error: '请刷新页面后重试。' }); return; }
      try {
        if (url.pathname === '/api/auth/status' && request.method === 'GET') { json(200, await account.refreshStatus()); return; }
        if (request.method !== 'POST') { json(405, { error: 'Method not allowed' }); return; }
        if (url.pathname === '/api/auth/qr') { json(200, await account.createQR()); return; }
        if (url.pathname === '/api/auth/cancel') { json(200, account.cancelQR()); return; }
        if (url.pathname === '/api/auth/poll') {
          let input = '';
          for await (const chunk of request) {
            input += chunk;
            if (input.length > 1024) { json(413, { error: '请求过大。' }); return; }
          }
          let data;
          try { data = JSON.parse(input); } catch { json(400, { error: '请求格式错误。' }); return; }
          if (typeof data.id !== 'string' || !/^[a-f\d]{40}$/.test(data.id)) { json(400, { error: '二维码标识无效。' }); return; }
          json(200, await account.pollQR(data.id)); return;
        }
        json(404, { error: 'Not found' });
      } catch (error) { json(error.status || 502, { error: error.message }); }
      return;
    }
    if (url.pathname === '/api/session' && request.method === 'GET') {
      if (!sameOrigin) { json(403, { error: 'Forbidden' }); return; }
      json(200, { app: APP_ID, token }); return;
    }
    if (url.pathname === '/api/stop' && request.method === 'POST') {
      if (request.headers.origin !== origin || request.headers['x-session-token'] !== token) { json(403, { error: 'Forbidden' }); return; }
      json(200, { stopped: true });
      account.dispose();
      server.close();
      return;
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') { json(405, { error: 'Method not allowed' }); return; }
    if (url.pathname === '/dashjs.js') {
      const body = await readFile(path.join(root, 'node_modules/dashjs/dist/modern/umd/dash.mediaplayer.min.js'));
      response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Content-Length': body.length });
      response.end(request.method === 'HEAD' ? undefined : body); return;
    }
    const entry = files.get(url.pathname);
    if (!entry) { json(404, { error: 'Not found' }); return; }
    try {
      const body = await readFile(path.join(root, 'web', entry[0]));
      response.writeHead(200, { 'Content-Type': entry[1], 'Content-Length': body.length });
      response.end(request.method === 'HEAD' ? undefined : body);
    } catch { json(500, { error: 'Unable to read application file' }); }
  });
  server.on('close', () => { account.dispose(); playback.clear(); });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => { origin = `http://127.0.0.1:${server.address().port}`; resolve(); });
  });
  return { server, origin };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  startServer(DEFAULT_PORT, { account: createBilibiliAccount({ store: createCredentialStore() }) }).then(({ server, origin }) => {
    console.log(`Local: ${origin}`);
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close());
  }).catch(error => { console.error(error.message); process.exitCode = 1; });
}
