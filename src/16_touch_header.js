/* ============================================================
   JIZURA改 — スマホ・タブレットの画面上部
   スマホ画面:     [タブレット] [設定]
   タブレット画面: [かんたん | 詳細] [スマホ] [設定]（PC と同じ3列の画面。はじめは「かんたん」）
   設定: 言語 / プロジェクト初期化 / 利用ガイド / 更新の確認（版）
   PC（マウス操作の大きい画面）は今のまま。更新の確認だけ利用ガイドの隣に置く。
   ============================================================ */
(() => {
'use strict';
const $ = id => document.getElementById(id);
const tr = (ja, en) => (window.J && J.layerText ? J.layerText(ja, en) : ja);
const touchQuery = window.matchMedia ? window.matchMedia('(pointer: coarse), (max-width: 900px)') : null;
// スマホかタブレットかは画面の短い方の辺で見分ける（スマホは約 360〜430、タブレットは 600 以上）
const isPhoneDevice = () => Math.min(screen.width || 9999, screen.height || 9999) < 600;
function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

// 更新の確認ボタンと版の表示（16b_updater.js が中身を動かす）
function updateControls() {
  const box = el('span', 'upd-box');
  const btn = el('button', 'ghost upd-check', tr('更新の確認', 'Check for updates')); btn.type = 'button';
  const ver = el('span', 'upd-version muted mono');
  box.append(btn, ver);
  return box;
}

let built = false;
const places = [];   // { node, mark（PC の場所）, target（設定の中） }
function placeItems(touch) { for (const p of places) (touch ? p.target : p.mark.parentNode).insertBefore(p.node, touch ? null : p.mark); }
function build() {
  if (built) return; built = true;
  const app = $('app'), bar = document.querySelector('.bar');
  if (!app || !bar) return;
  // スマホ / タブレットの切り替えと設定
  const btns = el('div', 'th-btns');
  const toTablet = el('button', 'th-btn th-tablet', tr('タブレット', 'Tablet')); toTablet.type = 'button';
  const toPhone = el('button', 'th-btn th-phone', tr('スマホ', 'Phone')); toPhone.type = 'button';
  const settings = el('button', 'th-btn th-settings', tr('設定', 'Settings')); settings.type = 'button';
  settings.setAttribute('aria-expanded', 'false');
  toTablet.addEventListener('click', () => { closePanel(); $('modeEasy') && $('modeEasy').click(); window.scrollTo({ top: 0 }); });   // タブレットは「かんたん」から
  toPhone.addEventListener('click', () => { closePanel(); $('modeMobile') && $('modeMobile').click(); window.scrollTo({ top: 0 }); });
  settings.addEventListener('click', () => {
    const on = !app.classList.contains('th-open');
    app.classList.toggle('th-open', on); settings.setAttribute('aria-expanded', String(on));
  });
  btns.append(toTablet, toPhone, settings);
  bar.append(btns);
  // 設定の中身（言語・初期化・利用ガイドは、PC 用の場所に目印を残して移す）
  const panel = el('div', 'th-panel'); panel.id = 'thSettings';
  const langRow = el('div', 'th-row th-lang'); langRow.append(el('span', 'th-label', tr('言語', 'Language')));
  const row2 = el('div', 'th-row th-actions');
  const row3 = el('div', 'th-row'); row3.append(updateControls());
  panel.append(langRow, row2, row3);
  bar.append(panel);
  for (const [node, target] of [[bar.querySelector('.lang-switch'), langRow], [$('btnReset'), row2], [$('btnGuide'), row2]]) {
    if (!node) continue;
    const mark = document.createComment('th'); node.before(mark);
    places.push({ node, mark, target });
  }
  // 設定の外を押したら閉じる
  document.addEventListener('click', e => {
    if (!app.classList.contains('th-open')) return;
    if (e.target.closest('.th-panel, .th-settings')) return;
    closePanel();
  });
}
function closePanel() { const a = $('app'); if (a) a.classList.remove('th-open'); const s = document.querySelector('.th-settings'); if (s) s.setAttribute('aria-expanded', 'false'); }

// PC: 更新の確認を利用ガイドの隣へ
let pcBuilt = false;
function buildPC() {
  if (pcBuilt) return; pcBuilt = true;
  const guide = $('btnGuide'), acts = document.querySelector('.bar .acts');
  const box = updateControls(); box.classList.add('upd-pc');
  if (guide && guide.parentNode === acts) guide.after(box); else if (acts) acts.append(box);
}

// タブレット画面: 端末の幅が 1280 より狭いときは、ページを幅 1280 として描いて画面に縮小して収める
// （PC の3列の表示は幅 1181 以上が条件のため。横向きで使う前提）
const VIEWPORT_DEFAULT = 'width=device-width, initial-scale=1, viewport-fit=cover';
const TABLET_WIDTH = 1280;
function fitTablet() {
  const app = $('app'), meta = document.querySelector('meta[name="viewport"]');
  if (!app || !meta) return;
  const tablet = app.classList.contains('touch-ui') && !app.classList.contains('is-mobile');
  const deviceW = Math.min(screen.width || 0, screen.height || 0) && Math.max(screen.width, screen.height) ? (window.matchMedia('(orientation: portrait)').matches ? Math.min(screen.width, screen.height) : Math.max(screen.width, screen.height)) : window.innerWidth;
  const want = tablet && !isPhoneDevice() && deviceW < TABLET_WIDTH ? 'width=' + TABLET_WIDTH + ', viewport-fit=cover' : VIEWPORT_DEFAULT;
  if (meta.getAttribute('content') !== want) meta.setAttribute('content', want);
}
function apply() {
  const app = $('app'); if (!app) return;
  const touch = !!(touchQuery && touchQuery.matches);
  app.classList.toggle('touch-ui', touch);
  const phone = touch && isPhoneDevice();
  app.classList.toggle('phone-device', phone);   // スマホでは「タブレット」ボタンを出さない
  if (touch) build();
  // スマホがタブレット画面のまま保存されていたら、スマホ画面に戻す（小さすぎて戻れなくなるのを防ぐ）
  if (phone && !app.classList.contains('is-mobile')) $('modeMobile') && $('modeMobile').click();
  buildPC();
  placeItems(touch);
  if (!touch) closePanel();
  if (window.JUpdater) JUpdater.refreshUI();
}
function boot() {
  apply();
  fitTablet();
  new MutationObserver(fitTablet).observe($('app'), { attributes: true, attributeFilter: ['class'] });
  window.addEventListener('orientationchange', () => setTimeout(fitTablet, 300));
  if (touchQuery && touchQuery.addEventListener) touchQuery.addEventListener('change', apply);
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
