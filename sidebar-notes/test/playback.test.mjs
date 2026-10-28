import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mediaUrl, createPlaybackService } from '../playback.mjs';

const stream = (id = 80, audio = false) => ({ id, baseUrl: `https://upos-test.bilivideo.com/upgcxcode/test/${audio ? 'audio' : id}.m4s?signature=synthetic`, bandwidth: 100000, codecs: audio ? 'mp4a.40.2' : 'avc1.640028', width: audio ? 0 : 1920, height: audio ? 0 : 1080, SegmentBase: { Initialization: '0-999', indexRange: '1000-1999' } });
function fixture(extra = {}) {
  const account = { status: () => ({ loggedIn: true }), playback: async () => ({ dash: { duration: 60, video: [stream(16), stream(80), stream(112)], audio: [stream(30280, true)] } }) };
  return { account, service: createPlaybackService({ account, ...extra }) };
}
test('media URLs are restricted to HTTPS official CDNs and prefer safe backups', () => {
  for (const baseUrl of ['http://upos.bilivideo.com/upgcxcode/a.m4s', 'https://bilivideo.com.evil.test/upgcxcode/a.m4s', 'https://127.0.0.1/upgcxcode/a.m4s', 'https://u:p@upos.bilivideo.com/upgcxcode/a.m4s', 'https://upos.bilivideo.com:4483/upgcxcode/a.m4s', 'https://upos.bilivideo.com/api/auth']) assert.throws(() => mediaUrl({ baseUrl }));
  assert.equal(mediaUrl({ baseUrl: 'https://evil.test/a.m4s', backupUrl: [stream().baseUrl] }), stream().baseUrl);
});
test('manifest uses only returned permitted qualities, hides upstream URLs and expires', async t => {
  let now = 1000;
  let requests = 0;
  const { account, service } = fixture({ clock: () => now, fetchImpl: async (url, options) => {
    requests++;
    assert.equal(options.headers.Cookie, undefined);
    assert.equal(options.headers['X-Session-Token'], undefined);
    assert.equal(options.headers.Range, 'bytes=0-3');
    assert.equal(options.redirect, 'error');
    return new Response(new Uint8Array([1, 2, 3, 4]), { status: 206, headers: { 'Content-Range': 'bytes 0-3/10000' } });
  } });
  const prepared = await service.prepare({ bvid: 'BV1B7411m7LV', p: 1 }, 80);
  assert.equal(prepared.quality, 80);
  assert.deepEqual(prepared.qualities.map(x => x.id), [80, 16]);
  assert.equal(JSON.stringify(prepared).includes('signature'), false);
  const server = http.createServer(async (req, res) => {
    const [, , , id, kind] = req.url.split('/');
    try { await service.serve(id, kind, req, res); }
    catch (error) { res.writeHead(error.status || 500).end(error.message); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const manifest = await fetch(origin + prepared.manifest).then(r => r.text());
  assert.match(manifest, /width="1920" height="1080"/);
  assert.match(manifest, /audio\/mp4/);
  assert.equal(manifest.includes('bilivideo'), false);
  const url = origin + prepared.manifest.replace('manifest.mpd', 'video.m4s');
  assert.equal((await fetch(url)).status, 416);
  assert.equal((await fetch(url, { headers: { Range: 'bytes=0-40000000' } })).status, 416);
  assert.equal(requests, 0);
  const response = await fetch(url, { headers: { Range: 'bytes=0-3' } });
  assert.equal(response.status, 206);
  assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [1, 2, 3, 4]);
  account.status = () => ({ loggedIn: false });
  assert.equal((await fetch(origin + prepared.manifest)).status, 401);
  now += 91 * 60_000;
  assert.equal((await fetch(origin + prepared.manifest)).status, 410);
});
