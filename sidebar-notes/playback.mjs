import { randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { accountError } from './bilibili-account.mjs';

const LABELS = { 16: '360P', 32: '480P', 64: '720P', 74: '720P 60帧', 80: '1080P' };
const MAX_RANGE = 32 * 1024 * 1024;
const xml = value => String(value).replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]);

export function mediaUrl(stream) {
  const values = [stream.baseUrl, stream.base_url, ...(stream.backupUrl || stream.backup_url || [])];
  for (const value of values) {
    try {
      const url = new URL(value);
      if (url.protocol === 'https:' && !url.username && !url.password && !url.port &&
          ['bilivideo.com', 'bilivideo.cn', 'bilivideo.net'].some(host => url.hostname.endsWith(`.${host}`)) &&
          /^\/(upgcxcode|neoxcode)\/.+\.m4s$/.test(url.pathname)) return url.href;
    } catch {}
  }
  throw accountError('没有可用的官方视频线路。');
}
function streamInfo(stream, type) {
  const segment = stream.SegmentBase || stream.segment_base;
  const init = segment?.Initialization || segment?.initialization;
  const index = segment?.indexRange || segment?.index_range;
  const codecs = stream.codecs;
  if (!/^\d+-\d+$/.test(init) || !/^\d+-\d+$/.test(index) || !/^[a-zA-Z\d.]+$/.test(codecs) ||
      !Number.isSafeInteger(stream.bandwidth) || stream.bandwidth <= 0) throw accountError('视频流信息不完整。');
  if (type === 'video' && (!Number.isSafeInteger(stream.width) || !Number.isSafeInteger(stream.height) || stream.width <= 0 || stream.height <= 0)) throw accountError('视频尺寸无效。');
  return { url: mediaUrl(stream), init, index, codecs, bandwidth: stream.bandwidth, width: stream.width, height: stream.height };
}
export function buildManifest(id, duration, video, audio) {
  const adaptation = (stream, type) => `<AdaptationSet contentType="${type}" mimeType="${type}/mp4" segmentAlignment="true" startWithSAP="1"><Representation id="${type}" bandwidth="${stream.bandwidth}" codecs="${xml(stream.codecs)}"${type === 'video' ? ` width="${stream.width}" height="${stream.height}"` : ''}><BaseURL>/api/media/${id}/${type}.m4s</BaseURL><SegmentBase indexRange="${stream.index}" indexRangeExact="true"><Initialization range="${stream.init}"/></SegmentBase></Representation></AdaptationSet>`;
  return `<?xml version="1.0" encoding="utf-8"?><MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static" profiles="urn:mpeg:dash:profile:isoff-on-demand:2011" mediaPresentationDuration="PT${duration}S" minBufferTime="PT1.5S"><Period duration="PT${duration}S">${adaptation(video, 'video')}${audio ? adaptation(audio, 'audio') : ''}</Period></MPD>`;
}

export function createPlaybackService({ account, fetchImpl = fetch, clock = Date.now }) {
  const sessions = new Map();
  async function prepare(video, quality = 80) {
    if (!Object.hasOwn(LABELS, quality)) throw accountError('不支持的画质。', 400);
    const data = await account.playback(video);
    const available = data.dash.video.filter(item => Object.hasOwn(LABELS, item.id) && /^avc1\./.test(item.codecs));
    available.sort((a, b) => b.id - a.id);
    const selected = available.find(item => item.id <= quality) || available.at(-1);
    if (!selected) throw accountError('当前账号没有可用的视频流，请使用外链播放。');
    const audios = (data.dash.audio || []).filter(item => /^mp4a\./.test(item.codecs)).sort((a, b) => b.bandwidth - a.bandwidth);
    if (data.dash.audio?.length && !audios.length) throw accountError('暂不支持这个视频的音频格式。');
    const duration = Number(data.dash.duration || data.timelength / 1000);
    if (!Number.isFinite(duration) || duration <= 0) throw accountError('视频时长无效。');
    const streams = { video: streamInfo(selected, 'video'), audio: audios[0] ? streamInfo(audios[0], 'audio') : null };
    const id = randomBytes(20).toString('hex');
    for (const [key, value] of sessions) if (value.expiresAt < clock()) sessions.delete(key);
    if (sessions.size >= 24) sessions.delete(sessions.keys().next().value);
    sessions.set(id, { ...streams, expiresAt: clock() + 90 * 60_000, manifest: buildManifest(id, duration, streams.video, streams.audio) });
    return { manifest: `/api/media/${id}/manifest.mpd`, quality: selected.id, label: LABELS[selected.id], width: selected.width, height: selected.height, qualities: [...new Set(available.map(item => item.id))].map(id => ({ id, label: LABELS[id] })) };
  }
  async function serve(id, kind, request, response) {
    const item = sessions.get(id);
    if (!item || item.expiresAt <= clock()) throw accountError('播放地址已过期，请重新载入。', 410);
    if (!account.status().loggedIn) throw accountError('登录已失效，请重新扫码。', 401);
    if (kind === 'manifest.mpd') {
      response.writeHead(200, { 'Content-Type': 'application/dash+xml' }); response.end(item.manifest); return;
    }
    const type = kind === 'video.m4s' ? 'video' : kind === 'audio.m4s' ? 'audio' : null;
    if (!type || !item[type]) throw accountError('没有这个媒体流。', 404);
    const range = request.headers.range;
    const match = /^bytes=(\d+)-(\d+)$/.exec(range || '');
    const start = Number(match?.[1]), end = Number(match?.[2]);
    if (!match || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end < start || end - start >= MAX_RANGE) throw accountError('无效的视频片段请求。', 416);
    const controller = new AbortController();
    const abort = () => controller.abort();
    response.on('close', abort);
    try {
      // Only the authorized stream's fixed URL is used; auth cookies stay on api.bilibili.com.
      const upstream = await fetchImpl(item[type].url, { headers: { Range: range, Referer: 'https://www.bilibili.com/', 'User-Agent': 'Mozilla/5.0', 'Accept-Encoding': 'identity' }, redirect: 'error', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(45_000)]) });
      if (upstream.status !== 206) { await upstream.body?.cancel(); throw accountError('视频线路暂时不可用，请重新载入。', 502); }
      const contentRange = upstream.headers.get('content-range');
      const returned = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(contentRange || '');
      if (!returned || Number(returned[1]) !== start || Number(returned[2]) > end) { await upstream.body?.cancel(); throw accountError('视频线路返回了无效片段。'); }
      response.writeHead(206, { 'Content-Type': `${type}/mp4`, 'Content-Range': contentRange, 'Content-Length': Number(returned[2]) - start + 1, 'Accept-Ranges': 'bytes' });
      await pipeline(Readable.fromWeb(upstream.body), response, { signal: controller.signal });
    } catch (error) {
      if (response.headersSent || response.destroyed) { response.destroy(); return; }
      throw accountError(error.status ? error.message : '视频线路连接失败，请重新载入。', error.status || 502);
    } finally { response.off('close', abort); }
  }
  return { prepare, serve, clear: () => sessions.clear() };
}
