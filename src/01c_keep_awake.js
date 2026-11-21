/* ============================================================
   JIZURA改 — 画面を消さない（Screen Wake Lock）
   J.keepAwake() で保持を始め、返された関数を呼ぶと解除。複数の処理が同時に保持してもよい。
   別のアプリから戻ったときなど、ブラウザが自動で外した保持はかけ直す。
   ============================================================ */
(() => {
'use strict';
const holds = new Set();
let sentinel = null, pending = false;
async function acquire() {
  if (sentinel || pending || !holds.size || document.hidden || !(navigator.wakeLock && navigator.wakeLock.request)) return;
  pending = true;
  try {
    const s = await navigator.wakeLock.request('screen');
    s.addEventListener('release', () => { if (sentinel === s) sentinel = null; });
    if (holds.size) sentinel = s; else s.release().catch(() => {});
  } catch (e) { sentinel = null; }
  finally { pending = false; }
}
function drop() {
  const s = sentinel; sentinel = null;
  if (s) s.release().catch(() => {});
}
J.keepAwake = () => {
  const token = {};
  holds.add(token); acquire();
  return () => { if (holds.delete(token) && !holds.size) drop(); };
};
document.addEventListener('visibilitychange', () => { if (!document.hidden) acquire(); });
})();
