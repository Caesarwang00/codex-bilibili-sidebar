import { createHash, randomBytes } from 'node:crypto';
import QRCode from 'qrcode';
import { normalizeVideos } from './feed.mjs';

const API = 'https://api.bilibili.com';
const PASSPORT = 'https://passport.bilibili.com';
const COOKIE_NAMES = new Set(['SESSDATA', 'bili_jct', 'DedeUserID', 'DedeUserID__ckMd5', 'buvid3', 'buvid4', 'sid']);
const MIXIN = [46,47,18,2,53,8,23,32,15,50,10,31,58,3,45,35,27,43,5,49,33,9,42,19,29,28,14,39,12,38,41,13,37,48,7,16,24,55,40,61,26,17,0,1,60,51,30,4,22,25,54,21,56,59,6,63,57,62,11,36,20,34,44,52];

export function accountError(message, status = 502) {
  return Object.assign(new Error(message), { status });
}
export function cookiesFromHeaders(headers) {
  const jar = new Map();
  for (const line of headers.getSetCookie()) {
    const first = line.split(';', 1)[0];
    const divider = first.indexOf('=');
    const name = first.slice(0, divider).trim();
    const value = first.slice(divider + 1).trim();
    if (divider > 0 && COOKIE_NAMES.has(name) && value && /^[\x21-\x7e]+$/.test(value) && !/[;,\s]/.test(value)) jar.set(name, value);
  }
  return jar;
}
export function signWbi(params, imgKey, subKey, timestamp = Math.floor(Date.now() / 1000)) {
  if (!/^[a-f\d]{32}$/i.test(imgKey) || !/^[a-f\d]{32}$/i.test(subKey)) throw accountError('无法取得B站推荐接口的签名信息。');
  const raw = imgKey + subKey;
  const mixin = MIXIN.map(index => raw[index]).join('').slice(0, 32);
  const values = { ...params, wts: timestamp };
  const query = Object.keys(values).sort().map(key => `${encodeURIComponent(key)}=${encodeURIComponent(String(values[key]).replace(/[!'()*]/g, ''))}`).join('&');
  return `${query}&w_rid=${createHash('md5').update(query + mixin).digest('hex')}`;
}

export function createBilibiliAccount({ fetchImpl = fetch, clock = Date.now, qrEncoder = QRCode.toDataURL, store = null } = {}) {
  let jar = new Map();
  let user = null;
  let keys = null;
  let checkedAt = 0;
  let revision = 0;
  let pendingQR = null;
  let persistence = 'memory';
  let persistenceNotice = '';
  let restored = !store;
  let restoring = null;
  let storageWork = Promise.resolve();
  const recommendationCache = new Map();
  const pendingFeeds = new Map();

  function status() { return { loggedIn: Boolean(user), user: user ? { name: user.name } : null, persistence, persistenceNotice }; }
  function clear() {
    revision++;
    jar.clear(); user = null; keys = null; pendingQR = null; checkedAt = 0;
    recommendationCache.clear(); pendingFeeds.clear();
    restored = true; persistence = 'memory';
    return status();
  }
  function storageOperation(action) {
    const task = storageWork.then(action);
    storageWork = task.catch(() => {});
    return task;
  }
  async function forget() {
    clear();
    if (store) {
      try { await storageOperation(() => store.clear()); }
      catch { persistenceNotice = '无法清除已失效的本地登录记录，请重新扫码覆盖。'; }
    }
    return status();
  }
  async function restore() {
    if (restored) return;
    if (restoring) return restoring;
    const started = revision;
    restoring = (async () => {
      let saved;
      try { saved = await storageOperation(() => store.load()); }
      catch {
        if (revision === started) { restored = true; persistenceNotice = '无法读取已保存的登录，请重新扫码。'; }
        return;
      }
      if (revision !== started) return;
      if (!saved) { restored = true; return; }
      const validCookie = pair => Array.isArray(pair) && pair.length === 2 && COOKIE_NAMES.has(pair[0]) && typeof pair[1] === 'string' && pair[1].length <= 8192 && /^[\x21-\x7e]+$/.test(pair[1]) && !/[;,\s]/.test(pair[1]);
      if (saved.version !== 1 || !Array.isArray(saved.cookies) || saved.cookies.length > COOKIE_NAMES.size || !saved.cookies.every(validCookie) || (saved.expiresAt != null && (!Number.isFinite(saved.expiresAt) || saved.expiresAt <= clock()))) {
        await forget(); persistenceNotice = '已保存的登录已过期或不可用，请重新扫码。'; return;
      }
      const candidate = new Map(saved.cookies);
      if (!candidate.has('SESSDATA')) { await forget(); return; }
      try {
        const verified = await validate(candidate);
        if (revision !== started) return;
        jar = candidate; user = verified.user; keys = verified.keys; checkedAt = clock();
        restored = true; persistence = 'encrypted'; persistenceNotice = '';
      } catch (error) {
        if (revision !== started) return;
        if (error.status !== 401) throw error; // Keep the saved session on temporary network errors.
        await forget(); persistenceNotice = 'B站登录已失效，请重新扫码。';
      }
    })().finally(() => { restoring = null; });
    return restoring;
  }
  async function saveSession(headers, started) {
    if (!store) return;
    let expiresAt = null;
    const line = headers.getSetCookie().find(value => /^SESSDATA=/.test(value));
    const maxAge = line?.match(/;\s*Max-Age=(-?\d+)/i);
    const expires = line?.match(/;\s*Expires=([^;]+)/i);
    if (maxAge) expiresAt = clock() + Number(maxAge[1]) * 1000;
    else if (expires && Number.isFinite(Date.parse(expires[1]))) expiresAt = Date.parse(expires[1]);
    const saved = { version: 1, cookies: [...jar], expiresAt };
    try {
      await storageOperation(async () => { if (revision === started) await store.save(saved); });
      if (revision === started) { persistence = 'encrypted'; persistenceNotice = ''; }
    } catch {
      if (revision === started) { persistence = 'memory'; persistenceNotice = '当前登录可用，但加密保存失败；重启后需重新扫码。'; }
    }
  }
  async function request(url, cookieJar = new Map()) {
    const parsed = new URL(url);
    if (![API, PASSPORT].includes(parsed.origin)) throw accountError('不支持的请求地址。');
    const headers = { Accept: 'application/json', Referer: 'https://www.bilibili.com/' };
    if (cookieJar.size) headers.Cookie = [...cookieJar].map(([name, value]) => `${name}=${value}`).join('; ');
    let response;
    try { response = await fetchImpl(url, { headers, redirect: 'error', signal: AbortSignal.timeout(12_000) }); }
    catch { throw accountError('连接B站超时或网络不可用，请稍后重试。'); }
    if (!response.ok) throw accountError(`B站返回 HTTP ${response.status}，请稍后重试。`);
    let body;
    try { body = await response.json(); } catch { throw accountError('B站返回了无法识别的响应。'); }
    return { body, headers: response.headers };
  }
  function checkCode(body) {
    if (body.code === -101) throw accountError('登录已失效，请重新扫码。', 401);
    if (body.code !== 0 || body.data?.v_voucher) throw accountError('B站暂时拒绝了请求；若官方页面提示验证，请先在官网完成后再重试。');
    return body.data;
  }
  function keysFromNav(nav) {
    const extract = value => {
      try { return new URL(value).pathname.split('/').pop().split('.')[0]; } catch { return ''; }
    };
    return { img: extract(nav.wbi_img?.img_url), sub: extract(nav.wbi_img?.sub_url) };
  }
  async function validate(cookieJar) {
    const { body } = await request(`${API}/x/web-interface/nav`, cookieJar);
    const nav = checkCode(body);
    if (!nav?.isLogin || !nav.mid || typeof nav.uname !== 'string') throw accountError('未能确认登录状态，请重新扫码。', 401);
    if (cookieJar.has('DedeUserID') && cookieJar.get('DedeUserID') !== String(nav.mid)) throw accountError('登录账号校验失败，请重新扫码。', 401);
    return { user: { name: nav.uname.slice(0, 80) }, keys: keysFromNav(nav) };
  }
  async function refreshStatus() {
    await restore();
    if (!user || clock() - checkedAt < 300_000) return status();
    const started = revision;
    try {
      const validated = await validate(new Map(jar));
      if (revision !== started) return status();
      user = validated.user; keys = validated.keys; checkedAt = clock();
    } catch (error) {
      if (revision === started && error.status === 401) await forget();
      else throw error;
    }
    return status();
  }
  async function createQR() {
    await restore();
    if (user) throw accountError('当前已登录，无需重新扫码。', 409);
    const started = ++revision;
    pendingQR = null;
    const { body } = await request(`${PASSPORT}/x/passport-login/web/qrcode/generate`);
    const data = checkCode(body);
    let qrUrl;
    try { qrUrl = new URL(data.url); } catch { throw accountError('无法生成登录二维码。'); }
    const officialScanPage = (qrUrl.origin === PASSPORT && qrUrl.pathname === '/h5-app/passport/login/scan') || (qrUrl.origin === 'https://account.bilibili.com' && qrUrl.pathname === '/h5/account-h5/auth/scan-web');
    if (!officialScanPage || !/^[a-f\d]{32}$/i.test(data.qrcode_key) || qrUrl.searchParams.get('qrcode_key') !== data.qrcode_key) throw accountError('登录二维码地址校验失败。');
    const image = await qrEncoder(qrUrl.href, { width: 240, margin: 3, errorCorrectionLevel: 'M' });
    if (revision !== started) throw accountError('登录请求已取消。', 409);
    pendingQR = { id: randomBytes(20).toString('hex'), key: data.qrcode_key, expiresAt: clock() + 180_000, lastPoll: 0, lastState: 'waiting', polling: null };
    return { id: pendingQR.id, image, expiresAt: pendingQR.expiresAt };
  }
  async function finishQR(pending, started) {
    const result = await request(`${PASSPORT}/x/passport-login/web/qrcode/poll?qrcode_key=${encodeURIComponent(pending.key)}`);
    const data = checkCode(result.body);
    if (pendingQR !== pending || revision !== started) throw accountError('登录请求已取消。', 409);
    if (data.code === 86101) return { state: 'waiting' };
    if (data.code === 86090) return { state: 'scanned' };
    if (data.code === 86038) { pendingQR = null; return { state: 'expired' }; }
    if (data.code !== 0) throw accountError('B站暂未确认登录，请刷新二维码。');
    const candidate = cookiesFromHeaders(result.headers);
    if (!candidate.has('SESSDATA')) throw accountError('B站未返回有效登录凭据，请重新扫码。');
    const verified = await validate(candidate);
    if (pendingQR !== pending || revision !== started) throw accountError('登录请求已取消。', 409);
    // Only the Windows-encrypted credential store receives cookies; the browser never does.
    jar = candidate; user = verified.user; keys = verified.keys; checkedAt = clock();
    pendingQR = null; revision++; recommendationCache.clear(); pendingFeeds.clear();
    restored = true;
    const committed = revision;
    await saveSession(result.headers, committed);
    if (revision !== committed) throw accountError('登录状态已变化，请重新加载。', 409);
    return { state: 'connected', ...status() };
  }
  async function pollQR(id) {
    const pending = pendingQR;
    if (!pending || pending.id !== id) throw accountError('二维码已失效，请重新生成。', 410);
    if (clock() >= pending.expiresAt) { pendingQR = null; return { state: 'expired' }; }
    if (pending.polling) return pending.polling;
    if (clock() - pending.lastPoll < 1800) return { state: pending.lastState };
    pending.lastPoll = clock();
    pending.polling = finishQR(pending, revision).then(result => { pending.lastState = result.state; return result; }).finally(() => { pending.polling = null; });
    return pending.polling;
  }
  function cancelQR() { pendingQR = null; revision++; return { cancelled: true }; }
  async function loadRecommendations(page) {
    await refreshStatus();
    if (!user || !jar.has('SESSDATA')) throw accountError('请先扫码登录，再查看为你推荐。', 401);
    const started = revision;
    const cookieSnapshot = new Map(jar);
    if (!keys) {
      const verified = await validate(cookieSnapshot);
      if (revision !== started) throw accountError('账号状态已变化，请重新加载。', 409);
      keys = verified.keys;
    }
    const query = signWbi({ ps: 12, fresh_idx: page, fresh_idx_1h: page, brush: page, fresh_type: 4, version: 1, feed_version: 'V8', homepage_ver: 1, web_location: 1430650 }, keys.img, keys.sub);
    const { body } = await request(`${API}/x/web-interface/wbi/index/top/feed/rcmd?${query}`, cookieSnapshot);
    if (revision !== started) throw accountError('账号状态已变化，请重新加载。', 409);
    let data;
    try { data = checkCode(body); } catch (error) { if (error.status === 401) await forget(); throw error; }
    const items = Array.isArray(data?.item) ? data.item : data?.items;
    const filtered = Array.isArray(items) ? items.filter(item => item.goto === 'av' && !item.is_ad && !item.ad_info) : [];
    const videos = normalizeVideos(filtered);
    if (!videos.length) throw accountError('B站本次没有返回可播放的个人推荐，请点「换一批」重试。');
    return { type: 'personal', page, label: '为你推荐', videos, hasMore: page < 100, personalized: true };
  }
  async function recommendations(page) {
    if (!Number.isInteger(page) || page < 1 || page > 100) throw accountError('页码无效。', 400);
    await refreshStatus();
    if (!user) throw accountError('请先扫码登录，再查看为你推荐。', 401);
    const cacheKey = `${revision}:${page}`;
    if (recommendationCache.has(cacheKey)) return recommendationCache.get(cacheKey);
    if (pendingFeeds.has(cacheKey)) return pendingFeeds.get(cacheKey);
    const started = revision;
    const task = loadRecommendations(page).then(result => {
      if (revision === started) {
        if (recommendationCache.size >= 12) recommendationCache.delete(recommendationCache.keys().next().value);
        recommendationCache.set(cacheKey, result);
      }
      return result;
    }).finally(() => pendingFeeds.delete(cacheKey));
    pendingFeeds.set(cacheKey, task);
    return task;
  }
  async function playback(video) {
    await refreshStatus();
    if (!user || !jar.has('SESSDATA')) throw accountError('高清播放需要先扫码登录。', 401);
    const started = revision;
    const cookies = new Map(jar);
    const query = new URLSearchParams(video.bvid ? { bvid: video.bvid } : { aid: video.aid });
    const view = checkCode((await request(`${API}/x/web-interface/view?${query}`, cookies)).body);
    const part = view?.pages?.[video.p - 1];
    if (!Number.isSafeInteger(part?.cid) || part.cid <= 0) throw accountError('没有找到这个分 P 的视频。', 404);
    const signed = signWbi({ bvid: view.bvid, cid: part.cid, qn: 80, fnval: 16, fnver: 0, fourk: 0 }, keys.img, keys.sub);
    const data = checkCode((await request(`${API}/x/player/wbi/playurl?${signed}`, cookies)).body);
    if (revision !== started) throw accountError('账号状态已变化，请重新加载。', 409);
    // Only play streams granted by Bilibili to this account. No trial/DRM overrides.
    if (data?.is_preview || data?.drm_tech_type || !data?.dash) throw accountError('此视频暂不能在这里高清播放，请使用外链播放或官方页面。');
    return data;
  }
  return { status, refreshStatus, createQR, pollQR, cancelQR, logout: forget, dispose: clear, recommendations, playback };
}
