/* ============================================================
   JIZURA改 — スマホ画面（スマホモードのときだけ）
   既存の部品をそのまま（イベントごと）タブへ移し、スマホモードを抜けたら元の位置へ戻す。
   上段: おまかせ / 詳細　下段: 1 歌詞 / 2 素材 / 3 同期 / 4 書き出し
   ============================================================ */
(() => {
'use strict';
const $ = id => document.getElementById(id);
const tr = (ja, en) => (window.J && J.layerText ? J.layerText(ja, en) : ja);
const VIEWS = [
  ['omakase', 'おまかせ', 'Auto'], ['pro', '詳細', 'Detail'],
  ['lyrics', '1 歌詞', '1 Lyrics'], ['media', '2 素材', '2 Media'], ['sync', '3 同期', '3 Sync'], ['out', '4 書き出し', '4 Export'],
];
const STAGE_VIEWS = new Set(['omakase', 'pro', 'sync']);   // プレビューを上に出す画面
let shell = null, moved = [], view = 'omakase', undoObs = null, alphaObs = null, labelRestore = [], created = [], repObs = null;
let rotState = 0, rotObs = null, tapObs = null;
function portrait() { const p = window.J && J.ui && J.ui.plan; return !!(p && p.H > p.W); }
// 回転中は、回したあとの見た目がプレビュー欄の幅いっぱいになるように canvas の大きさを決める
function applyRotate() {
  const vp = $('viewport'), c = $('view'), btn = $('mRotate');
  if (!vp || !c || !btn) return;
  if (!portrait()) rotState = 0;                       // 横長になったら元に戻す
  btn.hidden = !portrait();
  btn.textContent = rotState === 0 ? '⟲' : rotState === -90 ? '⟳' : '↺';
  btn.title = rotState === 0 ? tr('左に回して表示', 'Rotate left') : rotState === -90 ? tr('右に回して表示', 'Rotate right') : tr('元の向きに戻す', 'Back to upright');
  btn.setAttribute('aria-label', btn.title);
  // 同じ値なら書き換えない（canvas の変化を見て呼び直すので、何度呼ばれても止まるようにする）
  if (!rotState) {
    if (vp.classList.contains('m-rotated')) {
      vp.classList.remove('m-rotated'); vp.style.height = ''; c.style.transform = '';
      window.dispatchEvent(new Event('resize'));         // 元の大きさに計算し直してもらう
    }
    return;
  }
  const p = J.ui.plan, ar = p.W / p.H;                   // 縦長なので 1 未満
  const boxW = vp.clientWidth || 360;
  const cssH = boxW, cssW = boxW * ar;                   // 回すと 幅 boxW × 高さ boxW*ar に見える
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const pw = Math.round(Math.min(p.W, cssW * dpr)), ph = Math.round(pw / ar);
  const w = cssW.toFixed(2) + 'px', h = cssH.toFixed(2) + 'px', vh = Math.round(cssW) + 'px';
  const tf = 'translate(-50%, -50%) rotate(' + rotState + 'deg)';
  if (c.width !== pw || c.height !== ph) { c.width = pw; c.height = ph; }
  vp.classList.add('m-rotated');
  if (vp.style.height !== vh) vp.style.height = vh;
  if (c.style.width !== w) c.style.width = w;
  if (c.style.height !== h) c.style.height = h;
  if (c.style.transform !== tf) c.style.transform = tf;
  J.ui.need = true;
}
function ensureAlpha() {
  const sel = $('layerMode');
  if (!sel || !(window.J && J.ui && J.ui.project) || J.ui.project.layerMode === 'alpha') return;
  sel.value = 'alpha';
  sel.dispatchEvent(new Event('change', { bubbles: true }));   // 既存の処理で保存・表示を更新
}
try { view = localStorage.getItem('jizura.mview') || 'omakase'; } catch (e) {}
if (!VIEWS.some(v => v[0] === view)) view = 'omakase';

function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
// 移動した部品は、元の位置に目印を残して戻せるようにする
function move(node, target) {
  if (!node || !target) return;
  const mark = document.createComment('m-shell');
  node.parentNode.insertBefore(mark, node);
  moved.push([node, mark]);
  target.append(node);
}
function restore() {
  for (let i = moved.length - 1; i >= 0; i--) { const [node, mark] = moved[i]; if (mark.parentNode) { mark.parentNode.insertBefore(node, mark); mark.remove(); } }
  moved = [];
}

function build() {
  const app = $('app'), work = document.querySelector('main.work');
  shell = el('div', 'm-shell'); shell.id = 'mShell';
  const nav = el('nav', 'm-nav'); nav.setAttribute('aria-label', tr('スマホの画面切り替え', 'Phone screens'));
  const rowA = el('div', 'm-nav-a'), rowB = el('div', 'm-nav-b');
  for (const [key, ja, en] of VIEWS) {
    const b = el('button', 'm-nav-btn', tr(ja, en)); b.type = 'button'; b.dataset.mview = key;
    b.addEventListener('click', () => show(key, true));
    (key === 'omakase' || key === 'pro' ? rowA : rowB).append(b);
  }
  nav.append(rowA, rowB);
  const stage = el('div', 'm-stage');
  const views = {};
  for (const [key] of VIEWS) { views[key] = el('div', 'm-view'); views[key].dataset.mview = key; }
  shell.append(nav, stage, ...VIEWS.map(v => views[v[0]]));
  work.before(shell);
  // タブの中では見出しタップでの折りたたみをしない
  shell.addEventListener('click', e => { if (e.target.closest('.sec > .sec-h h2')) e.stopPropagation(); }, true);

  // プレビュー（再生バー・字幕ガチャ込み）
  move(document.querySelector('.col-stage'), stage);

  // 縦長のプレビューを横に回して大きく見る（表示だけ。書き出しは変わらない）
  const vp = $('viewport');
  if (vp) {
    const rot = el('button', 'm-rotate'); rot.type = 'button'; rot.id = 'mRotate';
    rot.addEventListener('click', () => { rotState = rotState === 0 ? -90 : rotState === -90 ? 90 : 0; applyRotate(); setTimeout(() => { measure(); updateRail(); }, 50); });
    vp.append(rot); created.push(rot);
    rotObs = new MutationObserver(() => applyRotate());
    rotObs.observe($('view'), { attributes: true, attributeFilter: ['style', 'width', 'height'] });
    applyRotate();
  }

  // 倍速の代わりにリピート（押すたびに ON / OFF。ON は曲全体の繰り返し）
  const speedSel = document.querySelector('.col-stage .preview-speed select');
  if (speedSel && speedSel.value !== '1') { speedSel.value = '1'; speedSel.dispatchEvent(new Event('change', { bubbles: true })); }
  const loopBtn = $('btnLoop');
  if (loopBtn) {
    const rep = el('button', 'm-repeat', tr('リピート', 'Repeat')); rep.type = 'button'; rep.id = 'mRepeat';
    const syncRep = () => { const on = !!(J.ui && J.ui.loop); rep.setAttribute('aria-pressed', String(on)); rep.textContent = on ? tr('リピート ON', 'Repeat ON') : tr('リピート OFF', 'Repeat OFF'); };
    rep.addEventListener('click', () => {
      if (J.ui && J.ui.loop) { for (let i = 0; i < 4 && J.ui.loop; i++) loopBtn.click(); }   // 行・カットループ中でも OFF へ
      else loopBtn.click();                                                                 // OFF → 曲全体のループ
      syncRep();
    });
    const sp = document.querySelector('.col-stage .preview-speed');
    (sp || loopBtn).after(rep); created.push(rep);
    repObs = new MutationObserver(syncRep); repObs.observe(loopBtn, { attributes: true, attributeFilter: ['aria-pressed', 'data-mode'] });
    syncRep();
  }

  // おまかせ: かんたんパネル（書き出し部分は 4 へ）
  const easy = $('easyPanel');
  const easyOut = $('eMP4') && $('eMP4').closest('.easy-sec');
  const easyMp4 = easy && easy.querySelector('.right-mp4');
  move(easy, views.omakase);

  // 詳細: 字幕ガチャ・モーションライブラリ（プレビューの下を狭くしないためここへ）、スタイル / 演出 / 手法 / 書き出し
  const extras = el('div', 'm-pro-extras'); views.pro.append(extras);
  move($('btnMotionLibrary'), extras);
  // 字幕ガチャはアコーディオンにまとめる（最初は閉じておく）。モーションライブラリは CSS で隠す
  const gacha = el('details', 'm-gacha');
  gacha.append(el('summary', 'm-gacha-sum', tr('字幕ガチャ', 'Cue gacha')));
  extras.append(gacha);
  move($('cueRollBar'), gacha);
  move(document.querySelector('.col-right .tabs'), views.pro);
  document.querySelectorAll('.col-right .tabpane').forEach(p => move(p, views.pro));

  // 1 歌詞: テキスト（.txt / .lrc）の読み込みと「元に戻す」
  const lyricBar = el('div', 'm-lyric-bar');
  const pick = el('label', 'file m-lyric-load', tr('歌詞・プロジェクトを開く', 'Open lyrics / project'));
  const pickInput = el('input'); pickInput.type = 'file'; pickInput.id = 'mLyricFile';
  pickInput.accept = '.txt,.lrc,.json,text/plain,application/json';
  pickInput.addEventListener('change', () => {
    const f = pickInput.files && pickInput.files[0]; if (!f) return;
    if (/\.json$/i.test(f.name)) openProjectFile(f);   // プロジェクト（.jizura.json）はメニューの「開く」と同じ処理へ
    else loadLyricFile(f);
    pickInput.value = '';
  });
  pick.append(pickInput);
  const undo = el('button', 'ghost m-lyric-undo', tr('元に戻す', 'Undo')); undo.type = 'button';
  undo.addEventListener('click', () => { if (J.uiApi && J.uiApi.edGo) J.uiApi.edGo(-1); });
  lyricBar.append(pick, undo);
  views.lyrics.append(lyricBar);
  const undoSrc = $('btnUndoEdit');
  const syncUndo = () => { undo.disabled = !!(undoSrc && undoSrc.disabled); };
  if (undoSrc) { undoObs = new MutationObserver(syncUndo); undoObs.observe(undoSrc, { attributes: true, attributeFilter: ['disabled'] }); }
  syncUndo();
  const lyricSec = $('lyrics') && $('lyrics').closest('.sec');
  move(lyricSec, views.lyrics);
  if (lyricSec) lyricSec.classList.remove('fold');
  // 「記法」→「編集終了」（入力を終えてキーボードを閉じる）。記法の説明は歌詞の下に常に表示
  const syn = $('btnSyntax');
  if (syn) {
    const old = syn.textContent; syn.textContent = tr('編集終了', 'Done');
    const stop = e => { e.stopImmediatePropagation(); e.preventDefault(); const a = document.activeElement; if (a && a.blur) a.blur(); $('lyrics') && $('lyrics').blur(); };
    syn.addEventListener('click', stop, true);
    labelRestore.push(() => { syn.textContent = old; syn.removeEventListener('click', stop, true); });
  }
  if ($('layerAudioSection')) $('layerAudioSection').classList.remove('fold');

  // 2 素材: 曲・作業用背景・不透明度・飾りの数字/時刻
  const audioSec = $('layerAudioSection');
  const bgRow = $('layerFile-background') && $('layerFile-background').closest('.layer-media');
  views.media.append(el('h2', 'm-h', tr('曲', 'Song')));
  move(audioSec, views.media);
  views.media.append(el('h2', 'm-h', tr('背景（画像・動画）', 'Background (image/video)')));
  move(bgRow, views.media);
  views.media.append(el('p', 'note m-note', tr('読み込んだ背景は、プレビューと書き出したMP4の両方に入ります。', 'The background appears in the preview and in the exported MP4.')));
  views.media.append(el('h2', 'm-h', tr('字幕の見え方', 'Subtitle look')));
  // スマホでは透明度モードを「半透明（グレーマット）」に固定（二値は使わない）。プロジェクトを開き直したときも戻す
  ensureAlpha();
  const opInput = $('layerBackgroundOpacity');
  if (opInput) { alphaObs = new MutationObserver(ensureAlpha); alphaObs.observe(opInput, { attributes: true, attributeFilter: ['disabled'] }); }
  const opacity = document.querySelector('.layer-background-opacity');
  move(opacity, views.media);
  move($('layerBackgroundOpacityHelp'), views.media);
  const hide = document.querySelector('.layer-hide-decorative');
  const hideNote = hide && hide.nextElementSibling;
  move(hide, views.media);
  if (hideNote && hideNote.tagName === 'P') move(hideNote, views.media);

  // 3 同期: タップで同期 Start・タップ中のボックス・行とカット
  const syncTop = el('div', 'm-sync-top');
  views.sync.append(syncTop);
  move($('btnTap'), syncTop);
  const noSong = el('p', 'note m-nosong', tr('曲が読み込まれていません（「2 素材」で読み込めます）', 'No song loaded (load one in "2 Media")'));
  noSong.id = 'mNoSong'; syncTop.append(noSong);
  move($('tapUnavailable'), syncTop);
  move($('tapPanel'), views.sync);
  const lines = $('lineList') && $('lineList').closest('.sec');
  move(lines, views.sync);
  if (lines) lines.classList.remove('fold');
  const rail = el('div', 'm-rail'); rail.id = 'mRail'; rail.setAttribute('aria-hidden', 'true');
  const thumb = el('div', 'm-rail-thumb'); rail.append(thumb); views.sync.append(rail);
  bindRail(rail, thumb, lines);

  // 4 書き出し（最後にプロジェクトの保存。メニューの「保存」と同じ）
  move(easyOut, views.out);
  if (window.J && J.canEncodeVideo && !J.canEncodeVideo()) {
    const ne = el('p', 'm-noenc', tr('このブラウザではMP4の書き出しができません。書き出すときは、AndroidならChromeで開いてください。編集とプロジェクトファイルの保存は、このブラウザでもできます。', 'This browser cannot export MP4. Open the app in Chrome on Android to export. Editing and saving the project file work here too.'));
    views.out.append(ne);
    shell.classList.add('m-noenc-on');   // ボタンの下に出る同じ文面は隠す
  }
  move(easyMp4, views.out);
  const saveBox = el('div', 'm-save-box');
  saveBox.append(el('h2', 'm-h', tr('プロジェクト', 'Project')));
  // タイトル名（メニューの「プロジェクト名」と同じ値。保存名・書き出したMP4の名前に使う）
  const titleLab = el('label', 'm-title-lab', tr('タイトル名', 'Title'));
  const titleIn = el('input'); titleIn.type = 'text'; titleIn.id = 'mTitle';
  titleIn.placeholder = tr('例：冬の始まり', 'e.g. Winter begins');
  titleIn.addEventListener('input', () => { const src = $('songTitle'); if (src) { src.value = titleIn.value; src.dispatchEvent(new Event('input', { bubbles: true })); } });
  titleLab.append(titleIn);
  const save = el('button', 'proj-save m-save', tr('プロジェクトファイルの保存', 'Save project file')); save.type = 'button';
  save.addEventListener('click', () => $('btnSave') && $('btnSave').click());
  saveBox.append(titleLab, save, el('p', 'note m-note', tr('歌詞・タイミング・演出・書き出し設定を .jizura.json に保存します。曲と背景の画像・動画は含まれないので、開き直したら「2 素材」で読み込み直してください。', 'Saves lyrics, timing, look and export settings as .jizura.json. The song and background are not included; load them again in "2 Media" after reopening.')));
  views.out.prepend(saveBox);   // 書き出しの上に置く

  // タップ同期中は TAP・終了する・回転・一覧のスクロール以外を押せなくする
  const tapBtn = $('btnTap');
  if (tapBtn) {
    const syncLock = () => app.classList.toggle('m-tapping', tapBtn.getAttribute('aria-pressed') === 'true');
    tapObs = new MutationObserver(syncLock); tapObs.observe(tapBtn, { attributes: true, attributeFilter: ['aria-pressed'] });
    syncLock();
  }

  // 上段の「おまかせ」ボタン（ヘッダー）はおまかせ画面の大きなボタンと重なるので隠す
  app.classList.add('m-shelled');
  show(view, false);
}

// 文字コード: BOM → UTF-8（厳密）→ だめなら Shift_JIS
function decodeText(buf) {
  const u8 = new Uint8Array(buf);
  if (u8[0] === 0xFF && u8[1] === 0xFE) return new TextDecoder('utf-16le').decode(u8);
  if (u8[0] === 0xFE && u8[1] === 0xFF) return new TextDecoder('utf-16be').decode(u8);
  try { return new TextDecoder('utf-8', { fatal: true }).decode(u8); }
  catch (e) {
    try { return new TextDecoder('shift_jis').decode(u8); } catch (e2) { return new TextDecoder('utf-8').decode(u8); }
  }
}
// .lrc: アプリが使わない情報（[length:] などのタグ、単語ごとの <00:12.34>）を外す。[ti:][ar:][al:][by:][offset:] と行の時間はそのまま
function cleanLrc(text) {
  return text.split('\n').map(line => {
    const t = line.trim();
    if (/^\[[a-z#]+:.*\]$/i.test(t) && !/^\[(ti|ar|al|by|offset):/i.test(t)) return null;
    return line.replace(/<\d+:\d+(?:[.:]\d+)?>/g, '').replace(/[ \t]+$/, '');
  }).filter(l => l !== null).join('\n');
}
function openProjectFile(file) {
  const target = $('fileProject');
  if (!target) return;
  if (J.ui && J.ui.exporting) { J.uiApi.toast(tr('書き出し中は開けません', 'Not available while exporting')); return; }
  try {
    const dt = new DataTransfer(); dt.items.add(file);
    target.files = dt.files;
    target.dispatchEvent(new Event('change', { bubbles: true }));
  } catch (e) { J.uiApi.toast(tr('このブラウザではここから開けません。メニューの「開く」を使ってください', 'Use "Open" in the menu in this browser')); }
}
async function loadLyricFile(file) {
  const toast = m => J.uiApi && J.uiApi.toast && J.uiApi.toast(m);
  if (J.ui && (J.ui.tap || J.ui.exporting)) { toast(tr('同期中・書き出し中は読み込めません', 'Not available while syncing or exporting')); return; }
  if (file.size > 2 * 1024 * 1024) { toast(tr('ファイルが大きすぎます（2MBまで）', 'File too large (2 MB max)')); return; }
  let text = decodeText(await file.arrayBuffer()).replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  if (/\.lrc$/i.test(file.name)) text = cleanLrc(text);
  text = text.replace(/\n+$/, '');
  if (J.uiApi.loadLyrics(text)) toast(tr('「' + file.name + '」を読み込みました（「元に戻す」で戻せます）', 'Loaded "' + file.name + '" (Undo to revert)'));
}

// 3 同期を開いたときの再生位置: 3 同期で最後に止めた位置から動いていなければそのまま、
// それ以外（起動直後・プロジェクトを開いた後・おまかせで位置が動いた後など）は 0 秒へ
let syncLeftT = null;
function syncEnter(prev) {
  if (!(window.J && J.ui && J.uiApi)) return;
  if (prev === 'sync') return;
  const keep = syncLeftT != null && Math.abs(J.ui.t - syncLeftT) < 0.002;
  if (keep || J.ui.tap) return;
  if (J.ui.playing) J.uiApi.pause();
  J.uiApi.seek(0);
}
function show(key, user) {
  const prev = shell && shell.dataset.mview;
  if (prev === 'sync' && key !== 'sync' && window.J && J.ui) syncLeftT = J.ui.playing ? null : J.ui.t;
  if (key === 'sync') syncEnter(prev);
  view = key;
  try { localStorage.setItem('jizura.mview', key); } catch (e) {}
  if (!shell) return;
  shell.dataset.mview = key;
  shell.querySelectorAll('.m-nav-btn').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mview === key)));
  shell.querySelectorAll('.m-view').forEach(v => { v.hidden = v.dataset.mview !== key; });
  const mt = $('mTitle'), st = $('songTitle');
  if (mt && st && document.activeElement !== mt) mt.value = st.value;   // プロジェクトを開いた後などの最新の名前を出す
  shell.querySelector('.m-stage').hidden = !STAGE_VIEWS.has(key);
  syncNoSong();
  measure();
  if (user) { window.scrollTo({ top: 0 }); window.dispatchEvent(new Event('resize')); }
  updateRail();
}

// ナビとプレビューを上に固定するための高さ
function measure() {
  if (!shell) return;
  const nav = shell.querySelector('.m-nav'), stage = shell.querySelector('.m-stage');
  shell.style.setProperty('--m-nav', nav.offsetHeight + 'px');
  shell.style.setProperty('--m-stage', stage.hidden ? '0px' : stage.offsetHeight + 'px');
}

function syncNoSong() {
  const n = $('mNoSong'); if (!n) return;
  const name = $('audioName');
  n.hidden = !!(window.J && J.ui && J.ui.audio) || !!(name && name.dataset && name.dataset.loaded);
}

// 右端のバー: 行の一覧を一気に上下へ移動する
let railState = null;
function bindRail(rail, thumb, list) {
  railState = { rail, thumb, list };
  const toScroll = clientY => {
    const r = rail.getBoundingClientRect(), { top, span } = listRange();
    if (span <= 0) return;
    const f = Math.min(1, Math.max(0, (clientY - r.top - thumb.offsetHeight / 2) / Math.max(1, r.height - thumb.offsetHeight)));
    window.scrollTo({ top: top + f * span });
  };
  rail.addEventListener('pointerdown', e => { e.preventDefault(); rail.setPointerCapture(e.pointerId); rail.classList.add('drag'); toScroll(e.clientY); });
  rail.addEventListener('pointermove', e => { if (rail.hasPointerCapture(e.pointerId)) toScroll(e.clientY); });
  const end = e => { rail.classList.remove('drag'); try { rail.releasePointerCapture(e.pointerId); } catch (err) {} };
  rail.addEventListener('pointerup', end); rail.addEventListener('pointercancel', end);
  window.addEventListener('scroll', updateRail, { passive: true });
  window.addEventListener('resize', () => { measure(); updateRail(); });
}
// 行の一覧がページのどこからどこまでスクロールするか
function listRange() {
  const { list } = railState; if (!list) return { top: 0, span: 0 };
  const fixedH = (parseFloat(getComputedStyle(shell).getPropertyValue('--m-nav')) || 0) + (parseFloat(getComputedStyle(shell).getPropertyValue('--m-stage')) || 0);
  const r = list.getBoundingClientRect(), top = r.top + window.scrollY - fixedH;
  const span = Math.max(0, r.height - (window.innerHeight - fixedH));
  return { top, span };
}
function updateRail() {
  if (!railState || !shell) return;
  const { rail, thumb } = railState;
  const on = view === 'sync';
  const { top, span } = on ? listRange() : { top: 0, span: 0 };
  rail.hidden = !on || span < 80;
  if (rail.hidden) return;
  const f = Math.min(1, Math.max(0, (window.scrollY - top) / span));
  thumb.style.top = (f * Math.max(0, rail.clientHeight - thumb.offsetHeight)) + 'px';
}

function teardown() {
  if (!shell) return;
  restore();
  if (undoObs) { undoObs.disconnect(); undoObs = null; }
  if (alphaObs) { alphaObs.disconnect(); alphaObs = null; }
  labelRestore.forEach(f => f()); labelRestore = [];
  if (repObs) { repObs.disconnect(); repObs = null; }
  if (rotObs) { rotObs.disconnect(); rotObs = null; }
  if (tapObs) { tapObs.disconnect(); tapObs = null; }
  $('app').classList.remove('m-tapping');
  if (rotState) { rotState = 0; const vp = $('viewport'), c = $('view'); if (vp) { vp.classList.remove('m-rotated'); vp.style.height = ''; } if (c) c.style.transform = ''; }
  created.forEach(n => n.remove()); created = [];
  shell.remove(); shell = null; railState = null;
  $('app').classList.remove('m-shelled');
}

function sync() {
  const mobile = $('app').classList.contains('is-mobile');
  if (mobile && !shell) build();
  else if (!mobile && shell) teardown();
}
function boot() {
  const app = $('app'); if (!app) return;
  new MutationObserver(sync).observe(app, { attributes: true, attributeFilter: ['class'] });
  sync();
  // 曲の読み込み状態は表示の文字が変わるので、それを見て注意書きを出し入れする
  // プロジェクトを開いたら、3 同期は頭から
  const fp = $('fileProject'); if (fp) fp.addEventListener('change', () => { syncLeftT = null; });
  const name = $('audioName');
  if (name) new MutationObserver(syncNoSong).observe(name, { childList: true, characterData: true, subtree: true });
  window.addEventListener('load', () => { measure(); updateRail(); });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
