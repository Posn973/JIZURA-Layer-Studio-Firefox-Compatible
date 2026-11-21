// JIZURA Layer Studio Firefox Compatible のサービスワーカー
//
// アプリのファイル（index.html・en/index.html など）をこの端末の中（Cache Storage）に保存して、
// 開くときはそこから読み込みます。インターネットにつながっていなくても起動できます。
// 書体（Google Fonts）は、一度読み込んだものを保存しておき、次からは端末から使います。
//
// GitHub に問い合わせるのは、次のときだけです。
//   ・はじめて開いたとき（version.json に書かれたファイルをすべて保存する）
//   ・更新の確認（version.json だけを読む）
//   ・新しい版に更新するとき（変わったファイルだけを読む。読み込みと入れ替えはページの側の処理が行う）
// ハッシュが合わないファイルは保存しません。
'use strict';

const CACHE = 'jizura-fc-app';          // アプリのファイル（ページの側の更新処理と同じ名前）
const FONTS = 'jizura-fc-fonts';        // 書体
const MANIFEST_KEY = '__manifest__';
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

const base = new URL('./', self.location).href;
const rel = url => url.startsWith(base) ? url.slice(base.length).split(/[?#]/)[0] : null;

async function sha256Hex(buf) {
  const h = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function installAll() {
  const cache = await caches.open(CACHE);
  if (await cache.match(base + MANIFEST_KEY)) return;     // すでに保存してある（入れ替えはページの側が行う）
  const res = await fetch(base + 'version.json', { cache: 'no-store' });
  if (!res.ok) throw new Error('version.json を読めませんでした');
  const text = await res.text();
  const man = JSON.parse(text);
  const got = await Promise.all(Object.entries(man.files).map(async ([path, hash]) => {
    const r = await fetch(base + path + '?h=' + hash.slice(0, 12), { cache: 'no-store' });
    if (!r.ok) throw new Error(path + ' を読めませんでした');
    const buf = await r.arrayBuffer();
    if (await sha256Hex(buf) !== hash) throw new Error(path + ' のハッシュが合いません');
    return [path, buf, r.headers.get('Content-Type') || ''];
  }));
  for (const [path, buf, type] of got) await cache.put(base + path, new Response(buf, { headers: { 'Content-Type': type } }));
  await cache.put(base + MANIFEST_KEY, new Response(text, { headers: { 'Content-Type': 'application/json' } }));   // 版の情報はいちばん最後
}

self.addEventListener('install', e => {
  e.waitUntil(installAll().catch(err => console.warn('アプリの保存に失敗しました（ネットから読み込みます）:', err)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

// 書体: 保存してあればそれを使い、なければネットから読んで保存する
async function fontResponse(req) {
  const cache = await caches.open(FONTS);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok || res.type === 'opaque') cache.put(req, res.clone()).catch(() => {});
  return res;
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (FONT_HOSTS.includes(url.hostname)) { e.respondWith(fontResponse(req)); return; }
  let path = rel(req.url);
  if (path === null) return;                                    // ほかのサイトはそのまま
  if (path === 'version.json' || path === 'sw.js') return;      // 更新の確認はいつもネットへ
  if (req.cache === 'no-store' || url.searchParams.has('h')) return;   // 新しい版の読み込み（?h=ハッシュ付き）もネットへ
  if (path === '' || path.endsWith('/')) path += 'index.html';
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(base + path);
    if (hit) return hit;
    return fetch(req);                                          // まだ保存していないとき
  })());
});
