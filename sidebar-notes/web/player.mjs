const BV = /^BV[1-9A-HJ-NP-Za-km-z]{10}$/;
const AV = /^av([1-9]\d*)$/i;
const HOSTS = new Set(['bilibili.com', 'www.bilibili.com', 'm.bilibili.com', 'player.bilibili.com']);

export function parseSource(raw) {
  const input = String(raw).trim();
  if (!input) throw new Error('请粘贴完整视频链接或 BV 号。');
  if (BV.test(input)) return { bvid: input, p: 1, t: 0 };
  if (AV.test(input)) return { aid: input.match(AV)[1], p: 1, t: 0 };
  let url;
  try { url = new URL(input); } catch { throw new Error('未识别的链接，请使用 BV 号或 B 站完整视频链接。'); }
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('请使用 https:// 开头的 B 站视频链接。');
  if (url.hostname === 'b23.tv') throw new Error('请先打开短链接，再复制 bilibili.com/video/ 开头的完整地址。');
  if (!HOSTS.has(url.hostname) || (url.port && url.port !== '443')) throw new Error('仅接受 B 站官方域名的视频链接。');
  const videoPath = url.pathname.match(/^\/video\/(BV[1-9A-HJ-NP-Za-km-z]{10}|av[1-9]\d*)\/?$/);
  let id = videoPath?.[1];
  if (url.hostname === 'player.bilibili.com' && url.pathname === '/player.html') {
    id = url.searchParams.get('bvid') || (url.searchParams.get('aid') ? `av${url.searchParams.get('aid')}` : null);
  }
  if (!id || (!BV.test(id) && !AV.test(id))) throw new Error('这个地址不是支持的视频页，请使用 /video/BV… 链接。');
  const p = positiveInteger(url.searchParams.get('p'), 1, 9999);
  const t = positiveInteger(url.searchParams.get('t'), 0, 604800);
  return BV.test(id) ? { bvid: id, p, t } : { aid: id.match(AV)[1], p, t };
}

function positiveInteger(value, fallback, max) {
  if (value === null || value === '') return fallback;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < fallback || number > max) throw new Error('链接中的分 P 或起始时间无效。');
  return number;
}

export function embedUrl(video, { autoplay = false } = {}) {
  const url = new URL('https://player.bilibili.com/player.html');
  if (video.bvid) url.searchParams.set('bvid', video.bvid);
  else url.searchParams.set('aid', video.aid);
  url.searchParams.set('p', String(video.p));
  url.searchParams.set('t', String(video.t));
  url.searchParams.set('autoplay', autoplay ? '1' : '0');
  url.searchParams.set('muted', '1');
  url.searchParams.set('danmaku', '0');
  return url.href;
}

// Destroy the browsing context, rather than visually covering a still-playing video.
export function disposePlayer(mount) {
  for (const frame of mount.querySelectorAll('iframe')) {
    frame.src = 'about:blank';
    frame.remove();
  }
  mount.replaceChildren();
}
