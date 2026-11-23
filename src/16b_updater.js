/* ============================================================
   JIZURA改 — この端末への保存と更新の確認（VideoEditing と同じ方式）
   ・アプリのファイルは端末の中（Cache Storage）に保存し、開くときはそこから読む（sw.js）。
     ネットがなくても起動できる。書体（Google Fonts）も一度使ったものは保存する。
   ・更新の確認では version.json（ファイルごとの SHA-256 の一覧）だけを読む。
       自動：アプリを開くたびに 1 回（起動を遅くしないよう 2〜5 秒たってから裏で）。ネットがなければ何も出さない。
       手動：「更新の確認」。続けて押したときのために 1 分だけ間をあける。
   ・新しい版があれば「今すぐ更新 / 後で更新」。今すぐ更新は、変わったファイルだけを読み、
     ハッシュが合うことを確かめてから入れ替えて開き直す。1 つでも合わなければ何も入れ替えない。
   ============================================================ */
(() => {
'use strict';
const CACHE = 'jizura-fc-app';            // sw.js と同じ名前（同じサイトの VideoEditing と分ける）
const MANIFEST_KEY = '__manifest__';
const COOL_DOWN = 60 * 1000;
const LS_LAST = 'jizura.update.lastCheck', LS_PENDING = 'jizura.update.pending', LS_RESULT = 'jizura.update.lastResult';
const tr = (ja, en) => (window.J && J.layerText ? J.layerText(ja, en) : ja);
// 英語版は en/ の中にあるので、アプリの一番上は 1 つ上
const root = new URL(document.documentElement.lang === 'en' ? '../' : './', location.href).href;
const supported = 'serviceWorker' in navigator && 'caches' in self && self.isSecureContext && location.protocol !== 'file:';
let current = null, busy = false;

const lsGet = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const lsSet = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) {} };
const toast = m => (window.J && J.uiApi && J.uiApi.toast ? J.uiApi.toast(m) : alert(m));
const fmtClock = ms => { const d = new Date(ms); return d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0'); };

async function sha256Hex(buf) {
  const h = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('');
}
async function readCurrent() {
  try { const c = await caches.open(CACHE); const r = await c.match(root + MANIFEST_KEY); current = r ? JSON.parse(await r.text()) : null; }
  catch (e) { current = null; }
  return current;
}
async function fetchManifest() {
  const r = await fetch(root + 'version.json', { cache: 'no-cache' });   // 印は付けない（配信の拠点の写しで答えてもらう）。JIZURA改: ブラウザが覚えた古い写しは使わず、毎回変わっていないか問い合わせる
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const text = await r.text();
  return { text, man: JSON.parse(text) };
}
const sameVersion = (a, b) => a && b && JSON.stringify(a.files) === JSON.stringify(b.files);

function refreshUI() {
  const v = current ? current.version : null;
  document.querySelectorAll('.upd-version').forEach(n => {
    n.textContent = !supported ? tr('（直接開いているため更新の仕組みは使いません）', '(opened directly: updates unavailable)')
      : v ? tr('版 ', 'Build ') + v : tr('（この端末への保存の準備中）', '(saving to this device…)');
  });
  const last = +(lsGet(LS_LAST) || 0);
  document.querySelectorAll('.upd-check').forEach(b => {
    b.title = !supported ? tr('GitHub のページから開いたときに使えます', 'Available when opened from the GitHub page')
      : tr('新しい版があるか確かめます', 'Check for a newer version') + (last ? tr('（前の確認：', ' (last: ') + fmtClock(last) + tr('）', ')') : '');
  });
}

// ---- お知らせ（今すぐ更新 / 後で更新） ----
let banner = null;
function ensureBanner() {
  if (banner) return banner;
  banner = document.createElement('div'); banner.className = 'upd-banner'; banner.hidden = true; banner.setAttribute('role', 'status');
  banner.innerHTML = '<span class="upd-text"></span><button type="button" class="upd-now"></button><button type="button" class="ghost upd-later"></button>';
  banner.querySelector('.upd-now').textContent = tr('今すぐ更新', 'Update now');
  banner.querySelector('.upd-later').textContent = tr('後で更新', 'Later');
  banner.querySelector('.upd-now').addEventListener('click', updateNow);
  banner.querySelector('.upd-later').addEventListener('click', () => { if (!busy) { banner.hidden = true; banner.querySelector('.upd-later').textContent = tr('後で更新', 'Later'); } });
  document.body.append(banner);
  return banner;
}
function showBanner(version) {
  const b = ensureBanner();
  b.querySelector('.upd-text').textContent = tr('新しい版があります（版 ', 'A new version is available (build ') + version + tr('）', ')');
  b.querySelector('.upd-now').disabled = b.querySelector('.upd-later').disabled = false;
  b.hidden = false;
}
function hideBanner() { if (banner) banner.hidden = true; }

async function check(manual) {
  if (!supported) { if (manual) toast(tr('GitHub のページから開いたときに使えます', 'Available when opened from the GitHub page')); return; }
  if (busy) return;
  const now = Date.now(), last = +(lsGet(LS_LAST) || 0);
  if (manual && now - last < COOL_DOWN) {
    const r = lsGet(LS_RESULT);
    if (r && r !== 'latest' && current && r !== current.version) showBanner(r);
    else toast(tr('最新版です', 'You have the latest version'));
    return;
  }
  busy = true;
  try {
    if (!current) await readCurrent();
    const { man } = await fetchManifest();
    lsSet(LS_LAST, String(Date.now()));
    if (!current) { if (manual) toast(tr('準備中です。少し待ってから開き直してください', 'Still saving. Reopen in a moment')); return; }
    if (sameVersion(man, current)) {
      lsSet(LS_PENDING, null); lsSet(LS_RESULT, 'latest'); hideBanner();
      if (manual) toast(tr('最新版です', 'You have the latest version'));
      return;
    }
    lsSet(LS_PENDING, man.version); lsSet(LS_RESULT, man.version);
    showBanner(man.version);
  } catch (e) {
    if (manual) toast(tr('確認できませんでした（インターネットにつながっていません）', 'Could not check (offline)'));
    else console.warn('更新の確認に失敗しました:', e);
  } finally { busy = false; refreshUI(); }
}

async function downloadChanged(man, old, cache, onProgress) {
  const todo = [];
  for (const path of Object.keys(man.files)) {
    if (old.files[path] === man.files[path] && await cache.match(root + path)) continue;   // 変わっていないファイルは読まない
    todo.push(path);
  }
  const got = []; let done = 0, next = 0;
  const worker = async () => {
    while (next < todo.length) {
      const path = todo[next++], hash = man.files[path];
      const r = await fetch(root + path + '?h=' + hash.slice(0, 12), { cache: 'no-store' });
      if (!r.ok) throw new Error(path + tr(' を読めませんでした（HTTP ', ' could not be read (HTTP ') + r.status + ')');
      const buf = await r.arrayBuffer();
      if (await sha256Hex(buf) !== hash) throw new Error(path + tr(' の中身が版の情報と合いません（配信の切り替わり中かもしれません）', ' does not match the version info (the site may still be updating)'));
      got.push([path, buf, r.headers.get('Content-Type') || '']);
      if (onProgress) onProgress(++done, todo.length);
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  return got;
}
async function commit(cache, got, man, text, old) {
  for (const [path, buf, type] of got) await cache.put(root + path, new Response(buf, { headers: { 'Content-Type': type } }));
  for (const path of Object.keys(old.files)) if (!(path in man.files)) await cache.delete(root + path);
  await cache.put(root + MANIFEST_KEY, new Response(text, { headers: { 'Content-Type': 'application/json' } }));   // 版の情報はいちばん最後
}
async function installMissing() {
  if (busy || current) return;
  busy = true;
  try {
    const { text, man } = await fetchManifest();
    const cache = await caches.open(CACHE);
    const got = await downloadChanged(man, { files: {} }, cache);
    await commit(cache, got, man, text, { files: {} });
    await readCurrent();
    if (!lsGet(LS_LAST)) lsSet(LS_LAST, String(Date.now()));
  } catch (e) { console.warn('この端末への保存に失敗しました（次に開いたときにもう一度試します）:', e); }
  finally { busy = false; refreshUI(); }
}

async function updateNow() {
  if (busy) return;
  if (window.J && J.ui && (J.ui.exporting || J.ui.tap)) { alert(tr('書き出し中・タップ同期中は更新できません。終わってから「今すぐ更新」を押してください。', 'Cannot update while exporting or tap syncing. Press "Update now" afterwards.')); return; }
  const b = ensureBanner(), txt = b.querySelector('.upd-text');
  busy = true;
  b.querySelector('.upd-now').disabled = b.querySelector('.upd-later').disabled = true;
  try {
    if (window.J && J.uiApi && J.uiApi.flushSave) J.uiApi.flushSave();       // 作業中のプロジェクトはブラウザに保存してから
    txt.textContent = tr('新しい版を読み込んでいます…', 'Downloading the new version…');
    const { text, man } = await fetchManifest();
    const cache = await caches.open(CACHE);
    const old = current || { files: {} };
    const got = await downloadChanged(man, old, cache, (n, all) => { txt.textContent = tr('新しい版を読み込んでいます…（', 'Downloading the new version… (') + n + ' / ' + all + tr('）', ')'); });
    await commit(cache, got, man, text, old);
    lsSet(LS_PENDING, null); lsSet(LS_RESULT, 'latest'); lsSet(LS_LAST, String(Date.now()));
    txt.textContent = tr('版 ', 'Updated to build ') + man.version + tr(' に更新しました。開き直します…', '. Reloading…');
    setTimeout(() => location.reload(), 600);
  } catch (e) {
    txt.textContent = tr('更新できませんでした。今の版のまま使えます。時間をおいてもう一度お試しください。（', 'Update failed. You can keep using this version; try again later. (') + e.message + tr('）', ')');
    b.querySelector('.upd-later').disabled = false;
    b.querySelector('.upd-later').textContent = tr('閉じる', 'Close');
    busy = false;
  }
}

async function init() {
  document.addEventListener('click', e => { const b = e.target.closest('.upd-check'); if (b) { e.preventDefault(); check(true); } });
  refreshUI();
  if (!supported) return;
  try { await navigator.serviceWorker.register(root + 'sw.js', { scope: root, updateViaCache: 'all' }); }
  catch (e) { console.warn('サービスワーカーを登録できませんでした:', e); }
  await readCurrent();
  if (!current) {
    // はじめて開いたとき：sw.js が保存し終わるのを待つ。15 秒たっても終わらなければページの側で保存し直す
    navigator.serviceWorker.ready.then(async () => {
      for (let k = 0; k < 15 && !current; k++) { await new Promise(r => setTimeout(r, 1000)); await readCurrent(); }
      if (!current && navigator.onLine !== false) await installMissing();
      if (current && !lsGet(LS_LAST)) lsSet(LS_LAST, String(Date.now()));   // 保存したばかりなので、すぐには確認しない
      refreshUI();
    });
  }
  refreshUI();
  const pending = lsGet(LS_PENDING);
  if (pending && current && pending !== current.version) showBanner(pending);   // 「後で更新」にした版をもう一度お知らせ
  else if (pending && current && pending === current.version) lsSet(LS_PENDING, null);
  if (current && navigator.onLine !== false) setTimeout(() => check(false), 2000 + Math.random() * 3000);
}
// ---- アプリとしてインストール（任意）----
// Chrome が自動で出すインストールの案内は止める（押し売りにしない）。
// インストールは「︙」メニューか、「設定」の「アプリとしてインストール」を押したときだけ。
let installEvt = null;
function refreshInstall() { document.querySelectorAll('.upd-install').forEach(b => { b.hidden = !installEvt; }); }
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; refreshInstall(); });
window.addEventListener('appinstalled', () => { installEvt = null; refreshInstall(); toast(tr('アプリとしてインストールしました', 'Installed as an app')); });
document.addEventListener('click', async e => {
  const b = e.target.closest('.upd-install'); if (!b || !installEvt) return;
  e.preventDefault();
  const ev = installEvt;
  try { await ev.prompt(); const r = await ev.userChoice; if (r && r.outcome === 'accepted') installEvt = null; }
  catch (err) { console.warn('インストールの画面を出せませんでした:', err); }
  refreshInstall();
});
window.JUpdater = { check, refreshUI, refreshInstall, get supported() { return supported; }, get version() { return current && current.version; } };
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
