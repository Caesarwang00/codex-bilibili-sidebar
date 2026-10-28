import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startServer, APP_ID } from '../server.mjs';

test('serves only application assets on loopback and protects shutdown', async t => {
  const { server, origin } = await startServer(0);
  t.after(() => { server.closeAllConnections(); server.close(); });
  assert.equal(server.address().address, '127.0.0.1');
  const page = await fetch(origin);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /<title>便笺<\/title>/);
  assert.match(page.headers.get('content-security-policy'), /frame-src https:\/\/player.bilibili.com/);
  assert.equal((await fetch(`${origin}/server.mjs`)).status, 404);
  assert.equal((await fetch(`${origin}/.git/config`)).status, 404);
  assert.equal((await fetch(`${origin}/api/health`).then(r => r.json())).app, APP_ID);
  assert.equal((await fetch(`${origin}/api/stop`, { method: 'POST' })).status, 403);
  assert.equal((await fetch(`${origin}/api/feed?type=personal&page=1`)).status, 403);
  assert.equal((await fetch(`${origin}/api/auth/status`)).status, 403);
  assert.equal((await fetch(`${origin}/api/playback?source=BV1B7411m7LV`)).status, 403);
  assert.equal((await fetch(`${origin}/api/media/${'a'.repeat(40)}/manifest.mpd`)).status, 403);
  const badHost = await new Promise((resolve, reject) => {
    const request = http.get(origin, { headers: { Host: 'evil.test' } }, response => { response.resume(); resolve(response.statusCode); });
    request.on('error', reject);
  });
  assert.equal(badHost, 403);
  const session = await fetch(`${origin}/api/session`).then(r => r.json());
  const auth = await fetch(`${origin}/api/auth/status`, { headers: { 'X-Session-Token': session.token } }).then(r => r.json());
  assert.equal(auth.loggedIn, false);
  assert.equal((await fetch(`${origin}/api/playback?source=BV1B7411m7LV`, { headers: { 'X-Session-Token': session.token } })).status, 401);
  assert.equal((await fetch(`${origin}/api/playback?source=https://evil.test`, { headers: { 'X-Session-Token': session.token } })).status, 400);
  assert.equal((await fetch(`${origin}/api/feed?type=personal&page=1`, { headers: { 'X-Session-Token': session.token } })).status, 401);
  assert.equal((await fetch(`${origin}/api/auth/qr`, { method: 'POST', headers: { Origin: 'https://evil.test', 'X-Session-Token': session.token } })).status, 403);
  assert.equal((await fetch(`${origin}/api/session`, { headers: { Origin: 'https://evil.test' } })).status, 403);
  const stopped = await fetch(`${origin}/api/stop`, { method: 'POST', headers: { Origin: origin, 'X-Session-Token': session.token } });
  assert.equal(stopped.status, 200);
});
