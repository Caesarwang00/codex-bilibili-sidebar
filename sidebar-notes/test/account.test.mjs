import test from 'node:test';
import assert from 'node:assert/strict';
import { createBilibiliAccount, cookiesFromHeaders, signWbi } from '../bilibili-account.mjs';

const img = '7cd084941338484aae1ad9425b84077c';
const sub = '4932caff0ff746eab6f01bf08b70ac45';
const qrKey = 'a'.repeat(32);
const qr = { code: 0, data: { url: `https://passport.bilibili.com/h5-app/passport/login/scan?qrcode_key=${qrKey}`, qrcode_key: qrKey } };
function reply(body, cookies = []) {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  for (const cookie of cookies) headers.append('Set-Cookie', cookie);
  return new Response(JSON.stringify(body), { headers });
}
function fixture({ store = null } = {}) {
  let now = 1_000_000;
  let pollCode = 86101;
  let navCode = 0;
  const calls = [];
  const account = createBilibiliAccount({
    store,
    clock: () => now,
    qrEncoder: async () => 'data:image/png;base64,test',
    fetchImpl: async (url, options) => {
      calls.push({ url, cookie: options.headers.Cookie });
      const path = new URL(url).pathname;
      if (path.endsWith('/generate')) return reply(qr);
      if (path.endsWith('/poll')) return reply({ code: 0, data: { code: pollCode, refresh_token: 'synthetic-refresh-secret', url: 'https://passport.biligame.com/?SESSDATA=synthetic-session' } }, pollCode === 0 ? ['SESSDATA=synthetic-session; HttpOnly; Secure', 'DedeUserID=10086; Secure', 'bili_jct=synthetic-csrf'] : []);
      if (path.endsWith('/nav')) return reply({ code: navCode, data: navCode === 0 ? { isLogin: true, mid: 10086, uname: '测试账号', wbi_img: { img_url: `https://i0.hdslb.com/bfs/wbi/${img}.png`, sub_url: `https://i0.hdslb.com/bfs/wbi/${sub}.png` } } : null });
      if (path.endsWith('/rcmd')) return reply({ code: 0, data: { item: [
        { goto: 'av', bvid: 'BV1B7411m7LV', title: '个人推荐测试', owner: { name: 'UP主' }, duration: 60 },
        { goto: 'ad', bvid: 'BV1XSxT6GEwQ', title: '广告' }
      ] } });
      throw new Error('Unexpected endpoint');
    }
  });
  return { account, calls, setCode: code => { pollCode = code; now += 2300; }, setNav: code => { navCode = code; }, advance: ms => { now += ms; } };
}

function savedStore() {
  let value = null;
  return { load: async () => structuredClone(value), save: async data => { value = structuredClone(data); }, clear: async () => { value = null; } };
}
async function login(f) {
  const qr = await f.account.createQR();
  f.setCode(0);
  return f.account.pollQR(qr.id);
}
test('confirmed login is saved, survives shutdown and revalidates before automatic restoration', async () => {
  const store = savedStore();
  const first = fixture({ store });
  assert.equal((await login(first)).persistence, 'encrypted');
  first.account.dispose();
  assert.equal(first.account.status().loggedIn, false);
  const second = fixture({ store });
  assert.equal(second.account.status().loggedIn, false);
  const status = await second.account.refreshStatus();
  assert.equal(status.loggedIn, true);
  assert.equal(status.persistence, 'encrypted');
  assert.equal(JSON.stringify(status).includes('synthetic-session'), false);
  assert.equal(second.calls.filter(call => call.url.includes('/nav')).length, 1);
  assert.equal(second.calls.some(call => call.url.includes('/qrcode/')), false);
  assert.equal((await second.account.recommendations(1)).personalized, true);
});
test('invalid saved sessions are removed but temporary upstream failures preserve them for retry', async () => {
  const store = savedStore();
  await login(fixture({ store }));
  const next = fixture({ store });
  next.setNav(-503);
  await assert.rejects(next.account.refreshStatus());
  assert.ok(await store.load());
  next.setNav(0);
  assert.equal((await next.account.refreshStatus()).loggedIn, true);
  const expired = fixture({ store });
  expired.setNav(-101);
  assert.equal((await expired.account.refreshStatus()).loggedIn, false);
  assert.equal(await store.load(), null);
  await store.save({ version: 1, cookies: [['SESSDATA', 'synthetic']], expiresAt: 1 });
  const pastExpiry = fixture({ store });
  assert.equal((await pastExpiry.account.refreshStatus()).loggedIn, false);
  assert.equal(pastExpiry.calls.length, 0);
  assert.equal(await store.load(), null);
});
test('storage failure leaves a usable login with an explicit unsaved notice', async () => {
  const store = { load: async () => null, save: async () => { throw new Error('synthetic failure'); }, clear: async () => {} };
  const status = await login(fixture({ store }));
  assert.equal(status.loggedIn, true);
  assert.equal(status.persistence, 'memory');
  assert.match(status.persistenceNotice, /保存失败/);
});

test('WBI signing matches a known independent vector', () => {
  assert.equal(signWbi({ foo: '114', bar: '514', zab: 1919810 }, img, sub, 1702204169), 'bar=514&foo=114&wts=1702204169&zab=1919810&w_rid=8f6f2b5b3d485fe1886cec6a0be8c5d4');
});
test('only expected cookie names and valid values enter the credential jar', () => {
  const headers = new Headers();
  headers.append('Set-Cookie', 'SESSDATA=percent%2Fencoded; HttpOnly; Secure');
  headers.append('Set-Cookie', 'unknown=discard; Secure');
  assert.deepEqual([...cookiesFromHeaders(headers)], [['SESSDATA', 'percent%2Fencoded']]);
});
test('accepts the current official account QR page and rejects a foreign page', async () => {
  let url = `https://account.bilibili.com/h5/account-h5/auth/scan-web?qrcode_key=${qrKey}`;
  const account = createBilibiliAccount({ qrEncoder: async () => 'data:image/png;base64,test', fetchImpl: async () => reply({ code: 0, data: { url, qrcode_key: qrKey } }) });
  assert.match((await account.createQR()).image, /^data:image\/png/);
  url = `https://evil.test/h5/account-h5/auth/scan-web?qrcode_key=${qrKey}`;
  await assert.rejects(account.createQR(), /地址校验失败/);
});
test('scan confirmation verifies account, keeps secrets server-side and sends signed personal requests', async () => {
  const { account, calls, setCode } = fixture();
  await assert.rejects(account.recommendations(1), { status: 401 });
  const generated = await account.createQR();
  assert.equal(JSON.stringify(generated).includes(qrKey), false);
  assert.deepEqual(await account.pollQR(generated.id), { state: 'waiting' });
  setCode(86090);
  assert.deepEqual(await account.pollQR(generated.id), { state: 'scanned' });
  setCode(0);
  const connected = await account.pollQR(generated.id);
  assert.equal(connected.loggedIn, true);
  assert.equal(connected.user.name, '测试账号');
  assert.equal(/synthetic-session|synthetic-refresh-secret|bili_jct/.test(JSON.stringify(connected)), false);
  const personal = await account.recommendations(1);
  assert.equal(personal.personalized, true);
  assert.equal(personal.videos.length, 1);
  const request = calls.find(call => call.url.includes('/rcmd'));
  assert.match(request.cookie, /SESSDATA=synthetic-session/);
  assert.match(request.url, /w_rid=[a-f\d]{32}/);
  assert.equal(calls.some(call => call.url.includes('/popular')), false);
  account.logout();
  assert.equal(account.status().loggedIn, false);
  await assert.rejects(account.recommendations(1), { status: 401 });
});
test('expired and cancelled QR sessions cannot complete authentication', async () => {
  const { account, advance } = fixture();
  const expired = await account.createQR();
  advance(180_001);
  assert.equal((await account.pollQR(expired.id)).state, 'expired');
  const cancelled = await account.createQR();
  account.cancelQR();
  await assert.rejects(account.pollQR(cancelled.id), { status: 410 });
  assert.equal(account.status().loggedIn, false);
});
test('logout while a confirmation request is in flight cannot restore the session', async () => {
  let release;
  const account = createBilibiliAccount({
    qrEncoder: async () => 'data:image/png;base64,test',
    fetchImpl: async url => {
      if (url.endsWith('/generate')) return reply(qr);
      return new Promise(resolve => { release = () => resolve(reply({ code: 0, data: { code: 0 } }, ['SESSDATA=synthetic-session'])); });
    }
  });
  const generated = await account.createQR();
  const polling = account.pollQR(generated.id);
  account.logout(); release();
  await assert.rejects(polling, { status: 409 });
  assert.equal(account.status().loggedIn, false);
});
