import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSource, embedUrl } from '../web/player.mjs';

test('accepts video IDs, links, multi-part videos and start offsets', () => {
  assert.deepEqual(parseSource(' BV1B7411m7LV '), { bvid: 'BV1B7411m7LV', p: 1, t: 0 });
  assert.deepEqual(parseSource('https://www.bilibili.com/video/BV1B7411m7LV/?p=2&t=90&share_source=copy'), { bvid: 'BV1B7411m7LV', p: 2, t: 90 });
  assert.deepEqual(parseSource('av170001'), { aid: '170001', p: 1, t: 0 });
  assert.deepEqual(parseSource('https://player.bilibili.com/player.html?aid=170001&p=3'), { aid: '170001', p: 3, t: 0 });
});

test('rejects foreign domains, disguised URLs, script input and invalid pages', () => {
  for (const value of [
    '', 'javascript:alert(1)', 'https://bilibili.com.evil.test/video/BV1B7411m7LV',
    'https://bilibili.com@evil.test/video/BV1B7411m7LV', 'https://evil.test/?bvid=BV1B7411m7LV',
    '<iframe src="https://evil.test"></iframe>', 'http://www.bilibili.com/video/BV1B7411m7LV/',
    'https://www.bilibili.com:8080/video/BV1B7411m7LV/', 'https://www.bilibili.com/',
    'https://www.bilibili.com/video/BV1B7411m7LV/?p=-1', 'https://www.bilibili.com/video/BV1B7411m7LV/?t=NaN'
  ]) assert.throws(() => parseSource(value), value);
  assert.throws(() => parseSource('https://b23.tv/example'), /短链接/);
});

test('only creates the official embed and never carries unwanted query parameters', () => {
  const url = new URL(embedUrl(parseSource('https://www.bilibili.com/video/BV1B7411m7LV/?autoplay=1&muted=0&foo=bar')));
  assert.equal(url.origin, 'https://player.bilibili.com');
  assert.equal(url.pathname, '/player.html');
  assert.equal(url.searchParams.get('autoplay'), '0');
  assert.equal(url.searchParams.get('muted'), '1');
  assert.equal(url.searchParams.get('danmaku'), '0');
  assert.equal(url.searchParams.has('foo'), false);
  const next = new URL(embedUrl(parseSource('BV1B7411m7LV'), { autoplay: true }));
  assert.equal(next.searchParams.get('autoplay'), '1');
  assert.equal(next.searchParams.get('muted'), '1');
});
