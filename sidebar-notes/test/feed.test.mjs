import test from 'node:test';
import assert from 'node:assert/strict';
import { createFeedService, normalizeVideos } from '../feed.mjs';

const sample = { bvid: 'BV1B7411m7LV', title: '示例', owner: { name: 'UP主' }, duration: 90 };
test('normalizes and deduplicates public items without exposing account data', () => {
  assert.deepEqual(normalizeVideos([sample, sample, { bvid: 'javascript:bad', title: 'bad' }, null]), [
    { bvid: sample.bvid, title: '示例', author: 'UP主', duration: 90 }
  ]);
});
test('public feed caches requests and rejects unsupported selectors', async () => {
  const calls = [];
  const service = createFeedService(async url => { calls.push(url); return { list: [sample], no_more: true }; });
  const first = await service('popular', 1);
  assert.equal(first, await service('popular', 1));
  assert.equal(first.hasMore, false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0], 'https://api.bilibili.com/x/web-interface/popular?ps=20&pn=1');
  await assert.rejects(service('https://evil.test', 1), /不支持/);
  await assert.rejects(service('popular', -1), /不支持/);
  await assert.rejects(service('weekly', 2), /不支持/);
});
test('weekly picks the current public issue and handles missing lists', async () => {
  const calls = [];
  const service = createFeedService(async url => {
    calls.push(url);
    return url.endsWith('/list') ? { list: [{ number: 396, name: '本周' }] } : { list: [sample] };
  });
  const result = await service('weekly', 1);
  assert.equal(result.label, '本周');
  assert.equal(result.hasMore, false);
  assert.equal(calls[1], 'https://api.bilibili.com/x/web-interface/popular/series/one?number=396');
  await assert.rejects(createFeedService(async () => ({ list: [] }))('popular', 1), /没有更多/);
});
