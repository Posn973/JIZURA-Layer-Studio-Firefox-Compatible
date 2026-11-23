/* ============================================================
   JIZURA改 — MP4 writer on Mediabunny (replaces mp4-muxer)
   mp4-muxer rejects chunks whose timestamps go backwards, which is
   what an H.264 encoder that uses B-frames returns (Firefox does).
   Mediabunny's EncodedVideoPacketSource reorders B-frames itself.
   The encoder callbacks stay synchronous: packets are queued in order
   and written one after another; finalize() waits for the queue.
   ============================================================ */
(() => {
'use strict';
const MB = () => {
  if (typeof Mediabunny === 'undefined') throw new Error('Mediabunny が読み込まれていません');
  return Mediabunny;
};
/* codecs that may be copied into an MP4 without re-encoding (widely playable ones only) */
J.MP4_COPY_AUDIO = ['aac', 'opus', 'mp3'];

J.Mp4Writer = class {
  /* target: 'buffer' | { onWrite(data, position) } | FileSystemWritableFileStream
     video: { codec: 'avc'|'vp9'|'av1', width, height, frameRate }
     audio: { codec: 'aac'|'opus'|'mp3', encode?: true, bitrate? } (optional; encode = PCM in, encoded by Mediabunny) 
     fastStart: false | 'in-memory' */
  constructor({ target = 'buffer', video, audio = null, fastStart = 'in-memory' }) {
    const M = MB();
    if (target === 'buffer') { this.buffer = new M.BufferTarget(); this.target = this.buffer; }
    else if (typeof target.onWrite === 'function') {
      this.target = new M.StreamTarget(new WritableStream({ write: c => target.onWrite(c.data, c.position) }), { chunked: true, chunkSize: 8 * 1048576 });
    } else {
      // a FileSystemWritableFileStream stays ours (the caller closes or truncates it); Mediabunny writes through a wrapper
      this.target = new M.StreamTarget(new WritableStream({ write: c => target.write({ type: 'write', position: c.position, data: c.data }) }), { chunked: true, chunkSize: 8 * 1048576 });
    }
    this.output = new M.Output({ format: new M.Mp4OutputFormat({ fastStart }), target: this.target });
    this.video = new M.EncodedVideoPacketSource(video.codec);
    this.output.addVideoTrack(this.video, video.frameRate ? { frameRate: video.frameRate } : undefined);
    if (audio && audio.encode) { this.audioEnc = new M.AudioBufferSource({ codec: audio.codec, bitrate: audio.bitrate || 192000 }); this.output.addAudioTrack(this.audioEnc); }
    else if (audio) { this.audio = new M.EncodedAudioPacketSource(audio.codec); this.output.addAudioTrack(this.audio); }
    this.error = null; this.queued = 0; this.firstVideo = null; this.firstAudio = null;
    this.chain = this.output.start().catch(e => { this.error = this.error || e; });
  }
  push(fn) {
    this.queued++;
    this.chain = this.chain.then(async () => {
      try { if (!this.error) await fn(); } catch (e) { this.error = this.error || e; } finally { this.queued--; }
    });
  }
  /* timestamps are moved so that each track starts at 0 (like mp4-muxer's firstTimestampBehavior: 'offset') */
  shift(packet, key) {
    if (this[key] === null) this[key] = packet.timestamp;
    const t = packet.timestamp - this[key];
    return t === packet.timestamp ? packet : packet.clone({ timestamp: t });
  }
  /* chunk: an EncodedVideoChunk from WebCodecs, or { data, type, timestamp, duration } (µs) from x264 */
  addVideoChunk(chunk, meta) {
    if (this.error) throw this.error;
    const M = MB();
    const raw = chunk.data instanceof Uint8Array ? new M.EncodedPacket(chunk.data, chunk.type, chunk.timestamp / 1e6, (chunk.duration || 0) / 1e6) : M.EncodedPacket.fromEncodedChunk(chunk);
    const packet = this.shift(raw, 'firstVideo');
    const desc = meta?.decoderConfig?.description;
    if (desc && /^avc[13]/.test(meta.decoderConfig.codec || '')) {
      const fixed = J.repairAvcC(desc, packet.data);
      if (fixed) meta = { ...meta, decoderConfig: { ...meta.decoderConfig, description: fixed } };
    }
    this.push(() => this.video.add(packet, meta));
  }
  addAudioChunk(chunk, meta) {
    if (this.error) throw this.error;
    const packet = this.shift(MB().EncodedPacket.fromEncodedChunk(chunk), 'firstAudio');
    this.push(() => this.audio.add(packet, meta));
  }
  /* PCM (an AudioBuffer) for the audio track opened with { encode: true }; pieces follow each other in time */
  addAudioBuffer(buffer) {
    if (this.error) throw this.error;
    this.push(() => this.audioEnc.add(buffer));
  }
  /* an already encoded packet (audio copied from the source file); its timestamp is used as is */
  addAudioPacket(packet, meta) {
    if (this.error) throw this.error;
    this.push(() => this.audio.add(packet, meta));
  }
  /* let the writer catch up when it falls far behind the encoder */
  async settle(limit = 48) {
    if (this.queued > limit) await this.chain;
    if (this.error) throw this.error;
  }
  async finalize() {
    await this.chain;
    if (this.error) { await this.cancel(); throw this.error; }
    await this.output.finalize();
    return this.buffer ? J.fixMp4CompositionOffsets(this.buffer.buffer) : null;
  }
  async cancel() { try { if (this.output.state !== 'finalized' && this.output.state !== 'canceled') await this.output.cancel(); } catch (e) {} }
};

/* ---------- H.264 decoder config (avcC) check ----------
   Firefox (Windows) hands out an avcC whose SPS/PPS start with the NAL header byte twice
   (67 67 64 00 28… / 68 68 …). VLC / MPC recover from the SPS/PPS inside the frames, but
   Windows (Explorer thumbnails, Films & TV) reads the broken avcC and gives up.
   Returns a repaired avcC (Uint8Array), or null when the given one is fine. */
const readParamSets = (a) => {
  const sps = [], pps = []; let o = 6;
  const nSps = a[5] & 31;
  for (let i = 0; i < nSps; i++) { const n = (a[o] << 8) | a[o + 1]; sps.push(a.subarray(o + 2, o + 2 + n)); o += 2 + n; }
  const nPps = a[o++];
  for (let i = 0; i < nPps; i++) { const n = (a[o] << 8) | a[o + 1]; pps.push(a.subarray(o + 2, o + 2 + n)); o += 2 + n; }
  if (o > a.length || !sps.length || !pps.length) throw new Error('short avcC');
  return { sps, pps };
};
const buildAvcC = (sps, pps, lengthSize) => {
  const s = sps[0], high = [100, 110, 122, 244, 44, 83, 86, 118, 128, 138, 139, 134, 135].includes(s[1]);
  const size = 7 + sps.reduce((t, x) => t + 2 + x.length, 0) + pps.reduce((t, x) => t + 2 + x.length, 0) + (high ? 4 : 0);
  const a = new Uint8Array(size); let o = 0;
  a[o++] = 1; a[o++] = s[1]; a[o++] = s[2]; a[o++] = s[3]; a[o++] = 0xfc | (lengthSize - 1); a[o++] = 0xe0 | sps.length;
  for (const x of sps) { a[o++] = x.length >> 8; a[o++] = x.length & 255; a.set(x, o); o += x.length; }
  a[o++] = pps.length;
  for (const x of pps) { a[o++] = x.length >> 8; a[o++] = x.length & 255; a.set(x, o); o += x.length; }
  if (high) { a[o++] = 0xfd; a[o++] = 0xf8; a[o++] = 0xf8; a[o++] = 0; }   // 4:2:0, 8-bit, no SPS extensions
  return a;
};
J.buildAvcC = buildAvcC;

/* JIZURA改: AAC encoding — the browser's own (WebCodecs, Chrome / Edge) or, where there is none (Firefox),
   FFmpeg's AAC encoder through @mediabunny/aac-encoder. 'native' | 'mediabunny' | 'none' */
let aacRegistered = false;
J.aacEncodeMode = async (sampleRate = 48000, channels = 2) => {
  try {
    if (typeof AudioEncoder !== 'undefined' && (await AudioEncoder.isConfigSupported({ codec: 'mp4a.40.2', sampleRate, numberOfChannels: channels, bitrate: 192000 })).supported) return 'native';
  } catch (e) {}
  if (typeof MediabunnyAacEncoder === 'undefined' || typeof Mediabunny === 'undefined') return 'none';
  try { if (!aacRegistered) { MediabunnyAacEncoder.registerAacEncoder(); aacRegistered = true; } return 'mediabunny'; }
  catch (e) { console.warn('AAC encoder not available', e); return 'none'; }
};
J.repairAvcC = (description, sample) => {
  try {
    const a = description instanceof Uint8Array ? description : ArrayBuffer.isView(description)
      ? new Uint8Array(description.buffer, description.byteOffset, description.byteLength) : new Uint8Array(description);
    if (a.length < 7 || a[0] !== 1) return null;
    const lengthSize = (a[4] & 3) + 1, { sps, pps } = readParamSets(a);
    const good = sps.every(s => (s[0] & 31) === 7 && s[1] === a[1] && s[3] === a[3]) && pps.every(p => (p[0] & 31) === 8 && p[1] !== p[0]);
    if (good) return null;
    // 1) best: the SPS / PPS the encoder put inside the key frame
    const inSps = [], inPps = [];
    if (sample) for (let o = 0; o + lengthSize <= sample.length;) {
      let n = 0; for (let k = 0; k < lengthSize; k++) n = n * 256 + sample[o + k];
      const nal = sample.subarray(o + lengthSize, o + lengthSize + n); o += lengthSize + n;
      if (!n || o > sample.length) break;
      if ((nal[0] & 31) === 7) inSps.push(nal.slice()); else if ((nal[0] & 31) === 8) inPps.push(nal.slice());
    }
    if (inSps.length && inPps.length) return buildAvcC(inSps, inPps, lengthSize);
    // 2) otherwise drop the doubled NAL header byte
    const strip = x => (x.length > 1 && x[0] === x[1]) ? x.subarray(1) : x;
    return buildAvcC(sps.map(strip), pps.map(strip), lengthSize);
  } catch (e) { console.warn('avcC check skipped', e); return null; }
};

/* ---------- B-frame timing in the form Windows understands ----------
   With B-frames Mediabunny writes 'ctts' version 1 (negative composition offsets) plus 'cslg'.
   Windows Media Foundation (Explorer thumbnails, Films & TV) does not read that form, so the file
   plays in VLC / MPC but gets no thumbnail. Rewrite it the way ffmpeg does: 'ctts' version 0 with
   all offsets shifted up by S, and an edit list ('edts/elst', media_time = S) that hides the shift.
   Works on a whole file in memory; chunk offsets are patched when 'moov' sits before 'mdat'. */
const CONTAINERS = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'edts', 'dinf', 'udta', 'mvex']);
const str4 = (u, o) => String.fromCharCode(u[o], u[o + 1], u[o + 2], u[o + 3]);
function parseBoxes(u, start, end) {
  const out = [];
  for (let o = start; o + 8 <= end;) {
    const dv = new DataView(u.buffer, u.byteOffset + o);
    let size = dv.getUint32(0), head = 8;
    const type = str4(u, o + 4);
    if (size === 1) { size = Number(dv.getBigUint64(8)); head = 16; } else if (size === 0) size = end - o;
    if (size < head || o + size > end) throw new Error('bad box ' + type);
    const box = { type, start: o, size, head };
    if (CONTAINERS.has(type)) box.children = parseBoxes(u, o + head, o + size);
    else box.data = u.subarray(o + head, o + size);
    out.push(box); o += size;
  }
  return out;
}
const boxBytes = (type, payload) => {
  const b = new Uint8Array(8 + payload.length), dv = new DataView(b.buffer);
  dv.setUint32(0, b.length); for (let i = 0; i < 4; i++) b[4 + i] = type.charCodeAt(i);
  b.set(payload, 8); return b;
};
function serialize(box) {
  if (!box.children) return box.raw || boxBytes(box.type, box.data);
  const parts = box.children.map(serialize), len = parts.reduce((s, p) => s + p.length, 0);
  const payload = new Uint8Array(len); let o = 0; for (const p of parts) { payload.set(p, o); o += p.length; }
  return boxBytes(box.type, payload);
}
const child = (box, type) => box.children?.find(c => c.type === type);
J.fixMp4CompositionOffsets = (input) => {
  const u = input instanceof Uint8Array ? input : new Uint8Array(input);
  try {
    const top = parseBoxes(u, 0, u.length), moov = top.find(b => b.type === 'moov'), mdat = top.find(b => b.type === 'mdat');
    if (!moov) return input;
    let changed = false;
    for (const trak of moov.children.filter(b => b.type === 'trak')) {
      const mdia = child(trak, 'mdia'), stbl = child(child(mdia, 'minf'), 'stbl');
      const ctts = stbl && child(stbl, 'ctts');
      if (!ctts || ctts.data[0] !== 1) continue;
      const dv = new DataView(ctts.data.buffer, ctts.data.byteOffset, ctts.data.length), n = dv.getUint32(4);
      let min = 0;
      for (let i = 0; i < n; i++) min = Math.min(min, dv.getInt32(8 + i * 8 + 4));
      const shift = -min;
      const data = new Uint8Array(ctts.data); const w = new DataView(data.buffer);
      w.setUint32(0, 0);                                         // version 0, flags 0
      for (let i = 0; i < n; i++) w.setUint32(8 + i * 8 + 4, dv.getInt32(8 + i * 8 + 4) + shift);
      ctts.data = data;
      stbl.children = stbl.children.filter(b => b.type !== 'cslg');
      if (shift) {
        // presentation length in the movie timescale, from tkhd
        const tk = child(trak, 'tkhd').data, tv = new DataView(tk.buffer, tk.byteOffset, tk.length);
        const duration = tk[0] === 1 ? Number(tv.getBigUint64(4 + 8 + 8 + 4 + 4)) : tv.getUint32(4 + 4 + 4 + 4 + 4);
        let edts = child(trak, 'edts');
        if (edts) {                                             // keep existing edits, move their media start by the shift
          for (const elst of edts.children.filter(b => b.type === 'elst')) {
            const e = new Uint8Array(elst.data), ev = new DataView(e.buffer), v = e[0], count = ev.getUint32(4), step = v === 1 ? 20 : 12;
            for (let i = 0; i < count; i++) {
              const at = 8 + i * step + (v === 1 ? 8 : 4);
              if (v === 1) { const t = ev.getBigInt64(at); if (t >= 0n) ev.setBigInt64(at, t + BigInt(shift)); }
              else { const t = ev.getInt32(at); if (t >= 0) ev.setInt32(at, t + shift); }
            }
            elst.data = e;
          }
        } else {
          const e = new Uint8Array(4 + 4 + 12), ev = new DataView(e.buffer);
          ev.setUint32(4, 1); ev.setUint32(8, duration); ev.setInt32(12, shift); ev.setUint16(16, 1); ev.setUint16(18, 0);
          edts = { type: 'edts', children: [{ type: 'elst', data: e }] };
          const at = trak.children.findIndex(b => b.type === 'mdia');
          trak.children.splice(at, 0, edts);                   // edts goes before mdia, as ffmpeg writes it
        }
      }
      changed = true;
    }
    if (!changed) return input;
    const newMoov = serialize(moov), delta = newMoov.length - moov.size;
    if (delta && mdat && moov.start < mdat.start) {             // fast start: sample data moved by delta
      const walk = box => {
        if (box.children) return box.children.forEach(walk);
        if (box.type === 'stco' || box.type === 'co64') {
          const d = new Uint8Array(box.data), v = new DataView(d.buffer), count = v.getUint32(4);
          for (let i = 0; i < count; i++) {
            if (box.type === 'stco') v.setUint32(8 + i * 4, v.getUint32(8 + i * 4) + delta);
            else v.setBigUint64(8 + i * 8, v.getBigUint64(8 + i * 8) + BigInt(delta));
          }
          box.data = d;
        }
      };
      walk(moov);
    }
    const finalMoov = serialize(moov);
    const out = new Uint8Array(u.length - moov.size + finalMoov.length);
    out.set(u.subarray(0, moov.start), 0);
    out.set(finalMoov, moov.start);
    out.set(u.subarray(moov.start + moov.size), moov.start + finalMoov.length);
    return out.buffer;
  } catch (e) {
    console.warn('MP4 timing rewrite skipped', e);
    return input;
  }
};

/* ---------- audio copied from the loaded music file (no re-encoding) ----------
   Works in every browser, including those without an AAC encoder (Firefox).
   Returns null when the file's audio can't be copied into an MP4. */
J.openAudioCopy = async (file) => {
  if (!file || typeof Mediabunny === 'undefined') return null;
  const M = Mediabunny;
  let input = null;
  try {
    input = new M.Input({ source: new M.BlobSource(file), formats: M.ALL_FORMATS });
    const track = await input.getPrimaryAudioTrack();
    if (!track || !J.MP4_COPY_AUDIO.includes(track.codec)) { input.dispose?.(); return null; }
    const config = await track.getDecoderConfig();
    if (!config) { input.dispose?.(); return null; }
    return {
      codec: track.codec, config, channels: track.numberOfChannels, sampleRate: track.sampleRate,
      /* writes the packets for the timeline span [t0, t0 + dur) shifted to start at 0; returns the copied seconds */
      async copyTo(writer, t0, dur, signal) {
        const sink = new M.EncodedPacketSink(track), end = t0 + dur;
        let first = true, last = 0, n = 0;
        for await (const p of sink.packets()) {
          if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
          if (p.timestamp < t0 - 1e-6) continue;          // before the span (also drops encoder priming at a negative time)
          if (p.timestamp >= end - 1e-6) break;
          const q = p.clone({ timestamp: p.timestamp - t0 });
          writer.addAudioPacket(q, first ? { decoderConfig: config } : undefined);
          first = false; last = q.timestamp + q.duration; n++;
          if (n % 200 === 0) await writer.settle();
        }
        return n ? last : 0;
      },
      dispose() { try { input.dispose?.(); } catch (e) {} },
    };
  } catch (e) {
    console.warn('audio copy unavailable', e);
    try { input?.dispose?.(); } catch (_) {}
    return null;
  }
};
})();
