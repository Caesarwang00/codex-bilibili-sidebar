import { parseSource, embedUrl, disposePlayer } from './player.mjs';

const $ = id => document.getElementById(id);
let currentVideo = null;
let previewVisible = true;
const mount = $('frame-mount');
let videos = [];
let videoIndex = -1;
let feedPage = 1;
let hasMore = false;
let feedBusy = false;
let feedRequest = 0;
let previewRevision = 0;
let sessionToken = '';
let accountState = { loggedIn: false };
let loginAttempt = 0;
let qrTimer = null;
let pageReady = false;
let dashPlayer = null;
let playbackRequest = 0;
let playbackAbort = null;
const brightness = $('brightness');
const BRIGHTNESS_KEY = 'sidebar-notes.brightness.v1';
function setBrightness(value, save = true) {
  const numeric = Number(value);
  const level = Number.isFinite(numeric) ? Math.round(Math.min(160, Math.max(30, numeric)) / 5) * 5 : 100;
  brightness.value = String(level);
  $('brightness-value').value = `${level}%`;
  brightness.setAttribute('aria-valuetext', `${level}%`);
  mount.style.setProperty('--video-brightness', String(level / 100));
  if (save) { try { localStorage.setItem(BRIGHTNESS_KEY, String(level)); } catch {} }
}
try { setBrightness(localStorage.getItem(BRIGHTNESS_KEY) ?? 100, false); }
catch { setBrightness(100, false); }
brightness.addEventListener('input', () => setBrightness(brightness.value));
$('brightness-reset').addEventListener('click', () => setBrightness(100));

function hidePreview() {
  previewRevision++;
  previewVisible = false;
  $('preview-panel').hidden = true;
  $('preview-toggle').textContent = '资料';
  $('preview-toggle').setAttribute('aria-expanded', 'false');
  $('help-panel').hidden = true;
  $('help-button').setAttribute('aria-expanded', 'false');
  $('account-panel').hidden = true;
  $('account-button').setAttribute('aria-expanded', 'false');
  $('preview-toggle').focus({ preventScroll: true });
}

function showPreview() {
  previewVisible = true;
  $('preview-panel').hidden = false;
  $('preview-toggle').textContent = '资料';
  $('preview-toggle').setAttribute('aria-expanded', 'true');
  // Keep the existing iframe and playback state when merely collapsing the panel.
  $('player-placeholder').hidden = mount.childElementCount > 0;
  $('placeholder-title').textContent = currentVideo ? '预览已停止' : '留一点空间给自己';
  $('placeholder-detail').textContent = currentVideo ? '重新载入后，再手动开始播放。' : '点「开始浏览」，不必输入链接。';
  $('reload-button').hidden = !currentVideo;
}

function stopPlayer() {
  playbackRequest++;
  playbackAbort?.abort(); playbackAbort = null;
  if (dashPlayer) { dashPlayer.reset(); dashPlayer = null; }
  for (const media of mount.querySelectorAll('video')) { media.pause(); media.removeAttribute('src'); media.load(); }
  disposePlayer(mount);
}
function loadExternal(video, options = {}) {
  stopPlayer();
  currentVideo = video;
  const frame = document.createElement('iframe');
  frame.title = 'B站视频预览';
  frame.src = embedUrl(video, options);
  frame.referrerPolicy = 'strict-origin-when-cross-origin';
  // Keep playback inside the panel. No popups, top navigation, full screen or PiP.
  frame.setAttribute('sandbox', 'allow-scripts allow-same-origin');
  frame.setAttribute('allow', "autoplay https://player.bilibili.com; fullscreen 'none'; picture-in-picture 'none'");
  mount.append(frame);
  $('player-placeholder').hidden = true;
  $('error').hidden = true;
  $('quality-select').hidden = true;
  $('external-player').hidden = true;
  $('playback-status').textContent = '外链播放 · 画质由 B 站决定';
}
async function loadVideo(video, options = {}) {
  if (!accountState.loggedIn || options.external) { loadExternal(video, options); return; }
  stopPlayer();
  const request = playbackRequest;
  currentVideo = video;
  $('player-placeholder').hidden = false;
  $('placeholder-title').textContent = '正在准备高清播放';
  $('placeholder-detail').textContent = '使用当前账号可看的画质';
  $('reload-button').hidden = true;
  $('quality-select').hidden = true;
  $('external-player').hidden = false;
  $('playback-status').textContent = '正在获取画质…';
  $('error').hidden = true;
  playbackAbort = new AbortController();
  const source = new URL(`https://www.bilibili.com/video/${video.bvid || `av${video.aid}`}/`);
  source.searchParams.set('p', String(video.p));
  try {
    const result = await api(`/api/playback?source=${encodeURIComponent(source.href)}&quality=${options.quality || 80}`, { signal: playbackAbort.signal });
    if (request !== playbackRequest) return;
    const media = document.createElement('video');
    media.controls = true; media.playsInline = true; media.muted = options.muted ?? true;
    media.volume = options.volume ?? 1;
    media.disablePictureInPicture = true;
    media.setAttribute('controlsList', 'nodownload nofullscreen noremoteplayback');
    media.setAttribute('aria-label', '视频播放');
    mount.append(media);
    const player = window.dashjs.MediaPlayer().create();
    dashPlayer = player;
    player.updateSettings({ debug: { logLevel: 0 }, streaming: { abr: { autoSwitchBitrate: { video: false, audio: false } }, buffer: { bufferTimeDefault: 12, bufferTimeAtTopQuality: 20, bufferToKeep: 15 } } });
    player.addRequestInterceptor(request => {
      const url = new URL(request.url, location.href);
      if (url.origin !== location.origin || !url.pathname.startsWith('/api/media/')) return Promise.reject(new Error('Unexpected media destination'));
      request.headers = { ...request.headers, 'X-Session-Token': sessionToken };
      return Promise.resolve(request);
    });
    const fail = () => {
      if (request !== playbackRequest) return;
      $('playback-status').textContent = '高清播放失败，可点「外链播放」或重新载入。';
      $('player-placeholder').hidden = false;
      $('placeholder-title').textContent = '暂时无法播放';
      $('placeholder-detail').textContent = '可重新载入，或切换外链播放';
      $('reload-button').hidden = false;
    };
    player.on(window.dashjs.MediaPlayer.events.ERROR, fail);
    media.addEventListener('error', fail);
    media.addEventListener('playing', () => {
      if (request !== playbackRequest) return;
      $('player-placeholder').hidden = true;
      $('playback-status').textContent = `${result.label} · ${media.videoWidth} × ${media.videoHeight}`;
    });
    media.addEventListener('loadedmetadata', () => {
      if (request !== playbackRequest) return;
      const time = options.resumeTime ?? video.t;
      if (time > 0 && time < media.duration) media.currentTime = time;
      $('player-placeholder').hidden = true;
      $('playback-status').textContent = `${result.label} · ${media.videoWidth} × ${media.videoHeight}`;
    }, { once: true });
    $('quality-select').replaceChildren(...result.qualities.map(quality => new Option(quality.label, quality.id)));
    $('quality-select').value = String(result.quality);
    $('quality-select').hidden = false;
    $('playback-status').textContent = `${result.label} · 正在缓冲`;
    player.initialize(media, result.manifest, Boolean(options.autoplay));
  } catch (error) {
    if (request !== playbackRequest) return;
    $('placeholder-title').textContent = '高清播放暂不可用';
    $('placeholder-detail').textContent = error.message;
    $('playback-status').textContent = '可重新载入，或切换外链播放';
    $('reload-button').hidden = false;
  }
}
$('quality-select').addEventListener('change', () => {
  const media = mount.querySelector('video');
  if (currentVideo && media) loadVideo(currentVideo, { quality: Number($('quality-select').value), resumeTime: media.currentTime, autoplay: !media.paused, muted: media.muted, volume: media.volume });
});
$('external-player').addEventListener('click', () => { if (currentVideo) loadVideo(currentVideo, { external: true, autoplay: true }); });

$('source-form').addEventListener('submit', event => {
  event.preventDefault();
  try {
    loadVideo(parseSource($('video-source').value));
    $('current-title').textContent = '自选视频';
    $('current-meta').textContent = '点击下一条可返回推荐列表';
  }
  catch (error) { $('error').textContent = error.message; $('error').hidden = false; }
});
$('reload-button').addEventListener('click', () => {
  try { if (currentVideo) loadVideo(currentVideo); }
  catch (error) { $('error').textContent = error.message; $('error').hidden = false; }
});
$('preview-toggle').addEventListener('click', () => previewVisible ? hidePreview() : showPreview());
$('hide-button').addEventListener('click', hidePreview);
$('help-button').addEventListener('click', () => {
  const opened = $('help-panel').hidden;
  $('help-panel').hidden = !opened;
  $('help-button').setAttribute('aria-expanded', String(opened));
});
$('account-button').addEventListener('click', () => {
  const opened = $('account-panel').hidden;
  $('account-panel').hidden = !opened;
  $('account-button').setAttribute('aria-expanded', String(opened));
});

function updateFeedControls() {
  $('previous-video').disabled = feedBusy || videoIndex <= 0;
  $('next-video').disabled = feedBusy || !videos.length || (videoIndex >= videos.length - 1 && !hasMore);
  $('next-video').textContent = videoIndex < 0 ? '开始浏览' : '下一条';
  $('feed-retry').disabled = feedBusy || !pageReady || ($('feed-source').value === 'personal' && !accountState.loggedIn);
  $('queue-count').textContent = videos.length ? `· ${videos.length} 条` : '';
  for (const [index, item] of Array.from($('queue-list').children).entries()) {
    item.disabled = feedBusy;
    item.setAttribute('aria-current', String(index === videoIndex));
  }
}
function formatTime(seconds) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
function chooseVideo(index) {
  if (!previewVisible || !videos[index] || feedBusy) return;
  videoIndex = index;
  const selected = videos[index];
  loadVideo({ bvid: selected.bvid, p: 1, t: 0 }, { autoplay: true });
  $('current-title').textContent = selected.title;
  $('current-meta').textContent = [selected.author, formatTime(selected.duration), `${index + 1} / ${videos.length}`].filter(Boolean).join(' · ');
  $('queue-panel').open = false;
  updateFeedControls();
}
function renderQueue() {
  $('queue-list').replaceChildren();
  videos.forEach((video, index) => {
    const button = document.createElement('button');
    button.className = 'queue-item';
    button.textContent = `${index + 1}. ${video.title}`;
    button.addEventListener('click', () => chooseVideo(index));
    $('queue-list').append(button);
  });
}
async function fetchFeed({ append = false, fresh = false } = {}) {
  const request = ++feedRequest;
  const type = $('feed-source').value;
  if (!pageReady) return false;
  if (type === 'personal' && !accountState.loggedIn) {
    feedBusy = false;
    $('feed-message').textContent = '请先在「账号」里扫码登录，查看你的推荐。';
    $('current-meta').textContent = '等待连接账号';
    updateFeedControls();
    return false;
  }
  const targetPage = append || fresh ? feedPage + 1 : 1;
  feedBusy = true;
  $('feed-message').textContent = type === 'personal' ? '正在获取你的首页推荐…' : '正在获取 B 站公开列表…';
  updateFeedControls();
  try {
    const result = await api(`/api/feed?type=${encodeURIComponent(type)}&page=${targetPage}`);
    if (request !== feedRequest) return false;
    const existing = new Set(append ? videos.map(video => video.bvid) : []);
    const next = result.videos.filter(video => !existing.has(video.bvid));
    videos = append ? [...videos, ...next] : next;
    if (!append) videoIndex = -1;
    feedPage = targetPage;
    hasMore = result.hasMore && next.length > 0;
    $('feed-message').textContent = result.personalized ? '为你推荐 · 来自当前登录账号' : `${result.label} · 公开列表`;
    if (!currentVideo) $('current-meta').textContent = `${videos.length} 条待看`;
    renderQueue();
    return true;
  } catch (error) {
    if (request === feedRequest) {
      $('feed-message').textContent = `${error.message} 可点「换一批」重试，或粘贴链接。`;
      if (error.status === 401) { accountState = { loggedIn: false }; renderAccount(); resetFeed(); }
    }
    return false;
  } finally {
    if (request === feedRequest) { feedBusy = false; updateFeedControls(); }
  }
}
$('previous-video').addEventListener('click', () => chooseVideo(videoIndex - 1));
$('next-video').addEventListener('click', async () => {
  const revision = previewRevision;
  const targetIndex = videoIndex + 1;
  if (targetIndex >= videos.length && !await fetchFeed({ append: true })) return;
  // A pending list request must not start playback after the user has hidden it.
  if (revision === previewRevision) chooseVideo(targetIndex);
});
$('feed-retry').addEventListener('click', () => fetchFeed({ fresh: true }));
$('feed-source').addEventListener('change', () => { resetFeed(); fetchFeed(); });

async function api(path, { method = 'GET', body, signal } = {}) {
  const response = await fetch(path, { method, signal, headers: { 'X-Session-Token': sessionToken, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const result = await response.json();
  if (!response.ok) throw Object.assign(new Error(result.error || '请求失败，请稍后重试。'), { status: response.status });
  return result;
}
function resetFeed() {
  feedRequest++; previewRevision++;
  videos = []; videoIndex = -1; feedPage = 1; hasMore = false; feedBusy = false;
  stopPlayer(); currentVideo = null;
  $('quality-select').hidden = true;
  $('external-player').hidden = true;
  $('playback-status').textContent = accountState.loggedIn ? '优先 1080P · 按可用画质播放' : '登录后优先 1080P';
  $('player-placeholder').hidden = false;
  $('placeholder-title').textContent = '留一点空间给自己';
  $('placeholder-detail').textContent = '点「开始浏览」，不必输入链接。';
  $('reload-button').hidden = true;
  $('current-title').textContent = '挑一条，慢慢看';
  $('current-meta').textContent = '正在准备列表…';
  renderQueue(); updateFeedControls();
}
function renderAccount() {
  $('account-status').textContent = accountState.loggedIn ? `已连接 · ${accountState.user?.name || 'B站账号'}` : (accountState.persistenceNotice || '尚未连接账号。用手机 B 站 App 扫码即可。');
  $('login-persistence').textContent = accountState.persistenceNotice || (accountState.persistence === 'encrypted' ? '已记住登录，下次打开自动恢复。B站登录过期后需重新扫码。' : '登录后自动记住账号，下次打开时恢复；B站登录过期后需重新扫码。');
  $('login-actions').hidden = accountState.loggedIn;
  $('login-button').disabled = !pageReady;
  if (accountState.loggedIn) clearQR();
}
function clearQR() {
  clearTimeout(qrTimer); qrTimer = null;
  $('qr-container').hidden = true;
  $('qr-image').removeAttribute('src');
  $('cancel-login').hidden = true;
}
async function pollLogin(id, attempt) {
  if (attempt !== loginAttempt) return;
  try {
    const result = await api('/api/auth/poll', { method: 'POST', body: { id } });
    if (attempt !== loginAttempt) return;
    if (result.state === 'connected') {
      accountState = result; clearQR(); renderAccount();
      $('feed-source').value = 'personal'; resetFeed(); await fetchFeed(); return;
    }
    if (result.state === 'expired') { clearQR(); $('account-status').textContent = '二维码已过期，请重新扫码。'; $('login-button').textContent = '重新生成二维码'; return; }
    $('qr-status').textContent = result.state === 'scanned' ? '扫码成功，请在手机 B 站 App 中确认登录。' : '用手机 B 站 App 扫码，并在手机上确认。';
    qrTimer = setTimeout(() => pollLogin(id, attempt), 2200);
  } catch (error) {
    if (attempt !== loginAttempt) return;
    clearQR(); $('account-status').textContent = error.message; $('login-button').textContent = '重新生成二维码';
  }
}
$('login-button').addEventListener('click', async () => {
  const attempt = ++loginAttempt;
  clearQR(); $('login-button').disabled = true;
  $('account-status').textContent = '正在向 B 站申请二维码…';
  try {
    const result = await api('/api/auth/qr', { method: 'POST' });
    if (attempt !== loginAttempt) return;
    $('qr-image').src = result.image;
    $('qr-container').hidden = false;
    $('cancel-login').hidden = false;
    $('account-status').textContent = '请扫描下方二维码。';
    $('qr-status').textContent = '用手机 B 站 App 扫码，并在手机上确认。';
    $('login-button').textContent = '刷新二维码';
    qrTimer = setTimeout(() => pollLogin(result.id, attempt), 2200);
  } catch (error) { if (attempt === loginAttempt) $('account-status').textContent = error.message; }
  finally { if (attempt === loginAttempt) $('login-button').disabled = false; }
});
$('cancel-login').addEventListener('click', async () => {
  loginAttempt++; clearQR(); renderAccount();
  try { await api('/api/auth/cancel', { method: 'POST' }); } catch {}
});
async function initializeAccount() {
  try {
    const response = await fetch('/api/session', { cache: 'no-store' });
    if (!response.ok) throw new Error('无法连接本地服务，请刷新页面。');
    sessionToken = (await response.json()).token;
    accountState = await api('/api/auth/status');
    pageReady = true; renderAccount(); resetFeed(); await fetchFeed();
  } catch (error) {
    $('account-status').textContent = error.message;
    $('feed-message').textContent = error.message;
  }
}
initializeAccount();
document.addEventListener('keydown', event => {
  if ((event.key === 'F8' || event.key === 'Escape') && !event.isComposing) {
    event.preventDefault();
    hidePreview();
  }
}, true);
document.addEventListener('visibilitychange', () => { if (document.hidden) hidePreview(); });
window.addEventListener('pagehide', stopPlayer);

const notes = $('notes');
const STORAGE_KEY = 'sidebar-notes.text.v1';
try { notes.value = localStorage.getItem(STORAGE_KEY) || ''; }
catch { $('note-status').textContent = '仅保留在当前页面'; }
function updateCount() { $('char-count').textContent = `${Array.from(notes.value).length} 字`; }
function saveNotes() {
  updateCount();
  try { localStorage.setItem(STORAGE_KEY, notes.value); $('note-status').textContent = '已保存在本机'; }
  catch { $('note-status').textContent = '无法保存，请自行复制'; }
}
notes.addEventListener('input', saveNotes);
$('clear-notes').addEventListener('click', () => {
  if (!notes.value || confirm('清空这页便笺？此操作不能撤销。')) { notes.value = ''; saveNotes(); }
});
updateCount();

// The lower half is a working notebook, so scrolling naturally moves the preview away.
const draft = $('draft');
try { draft.value = localStorage.getItem('sidebar-notes.draft.v1') || ''; }
catch { $('draft-status').textContent = '仅保留在当前页面'; }
draft.addEventListener('input', () => {
  try { localStorage.setItem('sidebar-notes.draft.v1', draft.value); $('draft-status').textContent = '已保存在本机'; }
  catch { $('draft-status').textContent = '无法保存，请自行复制'; }
});
const taskRows = [1, 2, 3].map(index => ({ checked: $(`task-check-${index}`), text: $(`task-text-${index}`) }));
try {
  const saved = JSON.parse(localStorage.getItem('sidebar-notes.tasks.v1') || '[]');
  taskRows.forEach((row, index) => {
    row.text.value = typeof saved[index]?.text === 'string' ? saved[index].text.slice(0, 200) : '';
    row.checked.checked = saved[index]?.checked === true;
  });
} catch { $('tasks-status').textContent = '无法读取已保存的清单。'; }
function saveTasks() {
  try {
    localStorage.setItem('sidebar-notes.tasks.v1', JSON.stringify(taskRows.map(row => ({ text: row.text.value, checked: row.checked.checked }))));
    $('tasks-status').textContent = '已保存在本机。';
  } catch { $('tasks-status').textContent = '无法保存，请自行复制。'; }
}
taskRows.forEach(row => {
  row.text.addEventListener('input', saveTasks);
  row.checked.addEventListener('change', saveTasks);
});
