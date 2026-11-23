/* ============================================================
   JIZURA改 — H.264 with x264 (WebAssembly), GPL-2.0-or-later
   Firefox's own H.264 encoder puts a key frame every second and lets the
   frames between them lose detail, so the picture goes soft and sharp again
   once a second. x264 keeps the quality constant (CRF) instead.
   The encoder runs in a Worker. When the page is cross-origin isolated
   (sw.js adds the headers), x264 uses threads (one Worker per thread);
   otherwise one thread. Source: vendor/x264/ (x264 + patch + build.sh).
   ============================================================ */
(() => {
'use strict';
const WASM = window.JZ_X264_WASM || null;   // { st, mt } base64, embedded by build.py

/* ---------- the Worker (one source for the encoder and its threads) ---------- */
function workerMain() {
  const ENOSYS = 52, dec = new TextDecoder();
  const wasi = (getMem, spawn) => {
    const w = {
      fd_write(fd, iovs, n, nwritten) {
        const dv = new DataView(getMem().buffer); let s = '', t = 0;
        for (let i = 0; i < n; i++) { const p = dv.getUint32(iovs + i * 8, true), l = dv.getUint32(iovs + i * 8 + 4, true); s += dec.decode(new Uint8Array(getMem().buffer, p, l).slice()); t += l; }
        dv.setUint32(nwritten, t, true); if (s.trim()) console.warn('x264:', s.trim()); return 0;
      },
      clock_time_get(id, prec, out) { new DataView(getMem().buffer).setBigUint64(out, BigInt(Math.round(performance.now() * 1e6)), true); return 0; },
      sched_yield() { return 0; },
      proc_exit(c) { throw new Error('x264 exit ' + c); },
    };
    for (const k of ['fd_close', 'fd_fdstat_get', 'fd_fdstat_set_flags', 'fd_filestat_get', 'fd_prestat_get', 'fd_prestat_dir_name', 'fd_read', 'fd_seek', 'path_open', 'path_rename'])
      w[k] = () => (k === 'fd_prestat_get' ? 8 : ENOSYS);
    const imp = { wasi_snapshot_preview1: w };
    if (spawn) imp.wasi = { 'thread-spawn': spawn };
    return imp;
  };

  /* a thread of x264: instantiated ahead of time, started when x264 asks for a thread */
  let threadReady = null;
  let e = null, memory = null, pool = [], threadUrl = '', W = 0, H = 0, chain = Promise.resolve();
  const send = (msg, transfer) => self.postMessage(msg, transfer || []);
  const take = (n, list) => {
    if (n <= 0) return;
    const data = new Uint8Array(memory.buffer, e.xw_out(), n).slice();
    list.push({ data, pts: e.xw_out_pts(), dts: e.xw_out_dts(), key: e.xw_out_key() });
  };
  const str = s => { const b = new TextEncoder().encode(s + '\0'), p = e.xw_malloc(b.length); new Uint8Array(memory.buffer, p, b.length).set(b); return p; };

  async function open(m) {
    W = m.width; H = m.height; threadUrl = m.threadUrl;
    if (m.mt) {
      memory = new WebAssembly.Memory({ initial: 2048, maximum: 32768, shared: true });
      // start the thread Workers first: a Worker that has not started cannot run a thread
      const n = m.threads + 4;
      const ready = [];
      for (let i = 0; i < n; i++) {
        const t = new Worker(threadUrl);
        ready.push(new Promise((res, rej) => { t.onmessage = ev => ev.data && ev.data.ready ? res() : null; t.onerror = ev => rej(new Error(ev.message || 'thread worker failed')); }));
        t.postMessage({ cmd: 'thread', module: m.module, memory });
        pool.push(t);
      }
      await Promise.all(ready);
      let tid = 1;
      const spawn = arg => { const t = pool.shift(); if (!t) return -1; const id = tid++; t.postMessage({ cmd: 'start', tid: id, arg }); return id; };
      const inst = await WebAssembly.instantiate(m.module, Object.assign(wasi(() => memory, spawn), { env: { memory } }));
      e = inst.exports;
    } else {
      let inst;
      inst = await WebAssembly.instantiate(m.module, wasi(() => inst.exports.memory));
      e = inst.exports; memory = e.memory;
    }
    e._initialize();
    const r = e.xw_open(W, H, m.fpsNum, m.fpsDen, m.crf, str(m.preset), str(m.tune || ''), m.keyint, m.threads);
    if (r) throw new Error('x264 を開けませんでした (' + r + ')');
    e.xw_rgba();
    const headers = new Uint8Array(memory.buffer, e.xw_headers(), e.xw_headers_len()).slice();
    send({ ev: 'opened', headers });
  }
  function frame(m) {
    const rgba = new Uint8Array(m.rgba);
    new Uint8Array(memory.buffer, e.xw_rgba(), W * H * 4).set(rgba);
    e.xw_convert();
    const list = [];
    take(e.xw_encode(m.pts, m.key ? 1 : 0), list);
    send({ ev: 'frame', list, rgba: m.rgba }, [m.rgba, ...list.map(p => p.data.buffer)]);
  }
  function flush() {
    const list = []; let n;
    while ((n = e.xw_flush()) >= 0) take(n, list);
    send({ ev: 'flushed', list }, list.map(p => p.data.buffer));
  }
  function close() {
    try { if (e) e.xw_close(); } catch (_) {}
    for (const t of pool) t.terminate();
    pool = [];
  }
  self.onmessage = ev => {
    const m = ev.data;
    if (m.cmd === 'thread') {
      threadReady = WebAssembly.instantiate(m.module, Object.assign(wasi(() => m.memory, () => -1), { env: { memory: m.memory } }));
      threadReady.then(() => self.postMessage({ ready: true }), err => self.postMessage({ ready: false, error: String(err) }));
      return;
    }
    if (m.cmd === 'start') { threadReady.then(inst => { inst.exports.wasi_thread_start(m.tid, m.arg); self.close(); }); return; }
    // the encoder: one message at a time, in order
    chain = chain.then(async () => {
      try {
        if (m.cmd === 'open') await open(m);
        else if (m.cmd === 'frame') frame(m);
        else if (m.cmd === 'flush') flush();
        else if (m.cmd === 'close') { close(); self.close(); }
      } catch (err) { send({ ev: 'error', message: (err && err.message) || String(err) }); }
    });
  };
}

let workerUrl = null;
const getWorkerUrl = () => workerUrl || (workerUrl = URL.createObjectURL(new Blob(['(' + workerMain.toString() + ')();'], { type: 'text/javascript' })));
const b64 = s => { const bin = atob(s), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; };
const modules = {};
const getModule = kind => modules[kind] || (modules[kind] = WebAssembly.compile(b64(WASM[kind])));

J.x264Threads = () => (self.crossOriginIsolated && typeof SharedArrayBuffer !== 'undefined') ? Math.max(2, Math.min(16, navigator.hardwareConcurrency || 4)) : 1;
J.x264Available = () => !!(WASM && WASM.st && typeof WebAssembly !== 'undefined' && typeof Worker !== 'undefined');
J.isFirefox = () => typeof navigator !== 'undefined' && /firefox/i.test(navigator.userAgent || '');
/* which browsers use x264 for H.264: Firefox (its own encoder blurs once a second); Chrome / Edge keep WebCodecs */
J.useX264 = () => J.x264Available() && J.isFirefox();
// CRF: smaller = better. 高 / 標準 / 軽量
J.x264Crf = quality => { const q = J.normalizeQuality(quality); return q === 'high' ? 16 : q === 'light' ? 23 : 19; };

/* SPS / PPS (4-byte length prefixed NAL units) → avcC + codec string */
function avcConfig(headers, w, h) {
  const sps = [], pps = [];
  for (let o = 0; o + 4 <= headers.length;) {
    const n = ((headers[o] << 24) | (headers[o + 1] << 16) | (headers[o + 2] << 8) | headers[o + 3]) >>> 0;
    const nal = headers.subarray(o + 4, o + 4 + n); o += 4 + n;
    if ((nal[0] & 31) === 7) sps.push(nal.slice()); else if ((nal[0] & 31) === 8) pps.push(nal.slice());
  }
  if (!sps.length || !pps.length) throw new Error('x264: SPS / PPS がありません');
  const hex = x => x.toString(16).padStart(2, '0');
  return { codec: 'avc1.' + hex(sps[0][1]) + hex(sps[0][2]) + hex(sps[0][3]), codedWidth: w, codedHeight: h, description: J.buildAvcC(sps, pps, 4) };
}

/* the same shape as the WebCodecs path in J.openVideoEncoder: encode(canvas, i), encodeQueueSize, flush(), close() */
class X264Encoder {
  constructor({ output, error }) { this.output = output; this.error = error; this.pending = 0; this.state = 'unconfigured'; this.x264 = true; this.spare = []; this.sentConfig = false; }
  get encodeQueueSize() { return this.pending; }
  async open({ width, height, fps, quality }) {
    if (width % 2 || height % 2) throw new Error('x264: 幅と高さは偶数にしてください');
    this.w = width; this.h = height; this.fps = fps;
    const threads = J.x264Threads(), mt = threads > 1 && WASM.mt;
    const module = await getModule(mt ? 'mt' : 'st');
    const url = getWorkerUrl();
    this.worker = new Worker(url);
    const opened = new Promise((res, rej) => { this.onOpen = res; this.onOpenFail = rej; });
    this.worker.onmessage = ev => this.message(ev.data);
    this.worker.onerror = ev => this.fail(new Error(ev.message || 'x264 worker error'));
    const fpsNum = Math.round(fps * 1000), fpsDen = 1000;
    this.worker.postMessage({ cmd: 'open', module, mt: !!mt, threadUrl: url, threads: mt ? threads : 1, width, height, fpsNum, fpsDen,
      crf: J.x264Crf(quality), preset: mt ? 'fast' : 'veryfast', tune: '', keyint: Math.round(fps * 5) });
    const headers = await opened;
    this.config = avcConfig(headers, width, height);
    this.state = 'configured';
    this.label = 'H.264 (x264, ' + (mt ? threads + ' threads' : '1 thread') + ')';
    return this;
  }
  fail(err) {
    if (this.state === 'closed') return;
    this.state = 'closed';
    if (this.onOpenFail) this.onOpenFail(err);
    if (this.onFlushFail) this.onFlushFail(err);
    this.error?.(err);
    try { this.worker?.terminate(); } catch (_) {}
  }
  message(m) {
    if (m.ev === 'error') { this.fail(new Error('x264: ' + m.message)); return; }
    if (m.ev === 'opened') { const f = this.onOpen; this.onOpen = this.onOpenFail = null; f(m.headers); return; }
    if (m.ev === 'frame' || m.ev === 'flushed') {
      for (const p of m.list) this.emit(p);
      if (m.ev === 'frame') { this.pending--; if (this.spare.length < 3) this.spare.push(m.rgba); }
      else { const f = this.onFlush; this.onFlush = this.onFlushFail = null; f && f(); }
    }
  }
  emit(p) {
    const ts = t => Math.round(t * 1e6 / this.fps);
    const chunk = { data: p.data, type: p.key ? 'key' : 'delta', timestamp: ts(p.pts), duration: ts(p.pts + 1) - ts(p.pts) };
    const meta = this.sentConfig ? undefined : { decoderConfig: this.config };
    this.sentConfig = true;
    try { this.output(chunk, meta); } catch (err) { this.fail(err); }
  }
  /* source: a 2D canvas of width × height */
  encode(source, i) {
    if (this.state !== 'configured') throw new Error('x264: エンコーダーが停止しています');
    const ctx = source.getContext('2d');
    const img = ctx.getImageData(0, 0, this.w, this.h);
    let buf = this.spare.pop();
    if (buf && buf.byteLength === img.data.byteLength) new Uint8Array(buf).set(img.data); else buf = img.data.buffer;
    this.pending++;
    this.worker.postMessage({ cmd: 'frame', rgba: buf, pts: i, key: i === 0 }, [buf]);
  }
  flush() {
    if (this.state !== 'configured') return Promise.reject(new Error('x264: エンコーダーが停止しています'));
    return new Promise((res, rej) => { this.onFlush = res; this.onFlushFail = rej; this.worker.postMessage({ cmd: 'flush' }); });
  }
  close() {
    if (this.state === 'closed') return;
    this.state = 'closed';
    try { this.worker.postMessage({ cmd: 'close' }); } catch (_) {}
    const w = this.worker; setTimeout(() => { try { w.terminate(); } catch (_) {} }, 2000);
  }
}

/* one encoder for every export: x264 (vc.x264) or the browser's WebCodecs encoder.
   enc.encode(canvas, frameIndex) — the canvas is read (x264) or wrapped in a VideoFrame (WebCodecs) at once. */
J.openVideoEncoder = async (vc, { width, height, fps, quality, output, error }) => {
  if (vc.x264) return new X264Encoder({ output, error }).open({ width, height, fps, quality });
  const enc = new VideoEncoder({ output, error });
  enc.configure(Object.assign({}, vc.cfg, { latencyMode: 'quality' }));
  return {
    x264: false,
    get state() { return enc.state; },
    get encodeQueueSize() { return enc.encodeQueueSize; },
    encode(source, i) {
      const t = Math.round(i * 1e6 / fps), vf = new VideoFrame(source, { timestamp: t, duration: Math.round((i + 1) * 1e6 / fps) - t });
      try { enc.encode(vf, { keyFrame: i % (fps * 2) === 0 }); } finally { vf.close(); }
    },
    flush: () => enc.flush(),
    close() { try { if (enc.state !== 'closed') enc.close(); } catch (_) {} },
  };
};
J.x264Label = () => { const t = J.x264Threads(); return 'H.264 (x264' + (t > 1 && WASM && WASM.mt ? ', ' + t + ' threads' : ', 1 thread') + ')'; };
J.x264Attempt = (w, h, fps) => J.useX264() ? { codec: 'x264', mux: 'avc', label: 'H.264 (x264)', x264: true, hw: 'x264', cfg: { width: w, height: h, framerate: fps } } : null;
})();
