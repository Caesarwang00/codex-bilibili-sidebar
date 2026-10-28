const BILI_API = 'https://api.bilibili.com';
const VALID_BV = /^BV[1-9A-HJ-NP-Za-km-z]{10}$/;

export function normalizeVideos(items) {
  if (!Array.isArray(items)) return [];
  const seen = new Set();
  return items.filter(item => {
    if (!VALID_BV.test(item?.bvid) || typeof item.title !== 'string' || seen.has(item.bvid)) return false;
    seen.add(item.bvid);
    return true;
  }).slice(0, 100).map(item => ({
    bvid: item.bvid,
    title: item.title.slice(0, 200),
    author: typeof item.owner?.name === 'string' ? item.owner.name.slice(0, 80) : '',
    duration: Number.isFinite(item.duration) ? Math.max(0, Math.floor(item.duration)) : 0
  }));
}

export function createFeedService(fetchJson = requestJson) {
  const cache = new Map();
  const pending = new Map();
  async function load(type, page) {
    let data;
    let label;
    if (type === 'popular') {
      data = await fetchJson(`${BILI_API}/x/web-interface/popular?ps=20&pn=${page}`);
      label = '综合热门';
    } else {
      const index = await fetchJson(`${BILI_API}/x/web-interface/popular/series/list`);
      const issue = index?.list?.find(item => Number.isSafeInteger(item.number) && item.number > 0);
      if (!issue) throw new Error('B站暂未返回每周必看列表。');
      data = await fetchJson(`${BILI_API}/x/web-interface/popular/series/one?number=${issue.number}`);
      label = typeof issue.name === 'string' ? issue.name.slice(0, 100) : '每周必看';
    }
    const videos = normalizeVideos(data?.list);
    if (!videos.length) throw new Error('暂时没有更多视频，可以换个栏目或稍后重试。');
    return { type, page, label, videos, hasMore: type === 'popular' && page < 100 && data.no_more !== true };
  }
  return async (type, page) => {
    if (!['popular', 'weekly'].includes(type) || !Number.isInteger(page) || page < 1 || page > 100 || (type === 'weekly' && page !== 1)) {
      const error = new Error('不支持的栏目或页码。'); error.status = 400; throw error;
    }
    const key = `${type}:${page}`;
    if (cache.get(key)?.expires > Date.now()) return cache.get(key).data;
    if (pending.has(key)) return pending.get(key);
    const result = load(type, page).then(data => {
      if (cache.size >= 24) cache.delete(cache.keys().next().value);
      cache.set(key, { data, expires: Date.now() + 120_000 });
      return data;
    }).finally(() => pending.delete(key));
    pending.set(key, result);
    return result;
  };
}

async function requestJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000), redirect: 'error' });
  if (!response.ok) throw new Error(`B站暂时不可用（HTTP ${response.status}），请稍后重试。`);
  const body = await response.json();
  if (body.code !== 0) throw new Error('B站暂未提供列表，请稍后重试。');
  return body.data;
}
