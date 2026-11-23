/* JIZURA改 x264 wrapper for WebAssembly (GPL-2.0-or-later, same as x264) */
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include "x264.h"
#define EXPORT(n) __attribute__((export_name(#n)))
static x264_t *enc; static x264_picture_t pin, pout; static int W, H;
static uint8_t *inbuf, *outbuf, *hdrbuf, *rgbabuf; static int outcap, outlen, hdrlen;
static int64_t o_pts, o_dts; static int o_key;
EXPORT(xw_open) int xw_open(int w, int h, int fpsn, int fpsd, float crf, const char *preset, const char *tune, int keyint, int threads) {
  x264_param_t p; W = w; H = h;
  if (x264_param_default_preset(&p, preset, tune && *tune ? tune : NULL) < 0) return -1;
  p.i_width = w; p.i_height = h; p.i_csp = X264_CSP_I420;
  p.i_fps_num = fpsn; p.i_fps_den = fpsd; p.i_timebase_num = fpsd; p.i_timebase_den = fpsn;
  p.b_vfr_input = 0; p.i_threads = threads; p.i_lookahead_threads = 1; p.i_log_level = X264_LOG_WARNING;
  p.rc.i_rc_method = X264_RC_CRF; p.rc.f_rf_constant = crf;
  if (keyint > 0) p.i_keyint_max = keyint;
  p.b_annexb = 0; p.b_repeat_headers = 0;
  p.vui.i_colorprim = 1; p.vui.i_transfer = 1; p.vui.i_colmatrix = 1; p.vui.b_fullrange = 0;
  if (x264_param_apply_profile(&p, "high") < 0) return -2;
  enc = x264_encoder_open(&p); if (!enc) return -3;
  x264_picture_init(&pin); pin.img.i_csp = X264_CSP_I420; pin.img.i_plane = 3;
  inbuf = malloc((size_t)w * h * 3 / 2);
  pin.img.plane[0] = inbuf; pin.img.plane[1] = inbuf + w * h; pin.img.plane[2] = inbuf + w * h + (w / 2) * (h / 2);
  pin.img.i_stride[0] = w; pin.img.i_stride[1] = w / 2; pin.img.i_stride[2] = w / 2;
  x264_nal_t *nal; int n; int sz = x264_encoder_headers(enc, &nal, &n);
  hdrbuf = malloc(sz > 0 ? sz : 1); hdrlen = 0;
  for (int i = 0; i < n; i++) { memcpy(hdrbuf + hdrlen, nal[i].p_payload, nal[i].i_payload); hdrlen += nal[i].i_payload; }
  return 0;
}
EXPORT(xw_input) uint8_t *xw_input(void) { return inbuf; }
/* an RGBA buffer (w*h*4) the page writes canvas pixels into */
EXPORT(xw_rgba) uint8_t *xw_rgba(void) { if (!rgbabuf) rgbabuf = malloc((size_t)W * H * 4); return rgbabuf; }
/* RGBA (straight alpha; transparent parts become black, like a canvas frame) -> I420, BT.709 limited range */
static inline void px(const uint8_t *p, int *r, int *g, int *b) {
  int a = p[3]; if (a == 255) { *r = p[0]; *g = p[1]; *b = p[2]; }
  else { *r = (p[0] * a + 127) / 255; *g = (p[1] * a + 127) / 255; *b = (p[2] * a + 127) / 255; }
}
EXPORT(xw_convert) void xw_convert(void) {
  uint8_t *Y = inbuf, *U = inbuf + W * H, *V = U + (W / 2) * (H / 2);
  for (int y = 0; y < H; y += 2) {
    const uint8_t *s0 = rgbabuf + (size_t)y * W * 4, *s1 = s0 + W * 4;
    uint8_t *y0 = Y + (size_t)y * W, *y1 = y0 + W, *u = U + (size_t)(y / 2) * (W / 2), *v = V + (size_t)(y / 2) * (W / 2);
    for (int x = 0; x < W; x += 2) {
      int r[4], g[4], b[4];
      px(s0 + x * 4, &r[0], &g[0], &b[0]); px(s0 + x * 4 + 4, &r[1], &g[1], &b[1]);
      px(s1 + x * 4, &r[2], &g[2], &b[2]); px(s1 + x * 4 + 4, &r[3], &g[3], &b[3]);
      y0[x]     = (uint8_t)(((47 * r[0] + 157 * g[0] + 16 * b[0] + 128) >> 8) + 16);
      y0[x + 1] = (uint8_t)(((47 * r[1] + 157 * g[1] + 16 * b[1] + 128) >> 8) + 16);
      y1[x]     = (uint8_t)(((47 * r[2] + 157 * g[2] + 16 * b[2] + 128) >> 8) + 16);
      y1[x + 1] = (uint8_t)(((47 * r[3] + 157 * g[3] + 16 * b[3] + 128) >> 8) + 16);
      int R = r[0] + r[1] + r[2] + r[3], G = g[0] + g[1] + g[2] + g[3], B = b[0] + b[1] + b[2] + b[3];
      u[x / 2] = (uint8_t)(((-26 * R - 86 * G + 112 * B + 512) >> 10) + 128);
      v[x / 2] = (uint8_t)(((112 * R - 102 * G - 10 * B + 512) >> 10) + 128);
    }
  }
}
EXPORT(xw_headers) uint8_t *xw_headers(void) { return hdrbuf; }
EXPORT(xw_headers_len) int xw_headers_len(void) { return hdrlen; }
static int take(int sz, x264_nal_t *nal, int n) {
  if (sz <= 0) return sz;
  if (sz > outcap) { free(outbuf); outcap = sz * 2; outbuf = malloc(outcap); }
  outlen = 0; for (int i = 0; i < n; i++) { memcpy(outbuf + outlen, nal[i].p_payload, nal[i].i_payload); outlen += nal[i].i_payload; }
  o_pts = pout.i_pts; o_dts = pout.i_dts; o_key = pout.b_keyframe; return outlen;
}
/* encode the frame in xw_input() with pts; force_key=1 forces an IDR. returns bytes out (0 = none yet) */
EXPORT(xw_encode) int xw_encode(int pts, int force_key) {
  x264_nal_t *nal; int n; pin.i_pts = pts; pin.i_type = force_key ? X264_TYPE_IDR : X264_TYPE_AUTO;
  return take(x264_encoder_encode(enc, &nal, &n, &pin, &pout), nal, n);
}
EXPORT(xw_flush) int xw_flush(void) {
  if (!x264_encoder_delayed_frames(enc)) return -1;
  x264_nal_t *nal; int n; return take(x264_encoder_encode(enc, &nal, &n, NULL, &pout), nal, n);
}
EXPORT(xw_out) uint8_t *xw_out(void) { return outbuf; }
EXPORT(xw_out_pts) int xw_out_pts(void) { return (int)o_pts; }
EXPORT(xw_out_dts) int xw_out_dts(void) { return (int)o_dts; }
EXPORT(xw_out_key) int xw_out_key(void) { return o_key; }
EXPORT(xw_close) void xw_close(void) { if (enc) x264_encoder_close(enc); enc = NULL; free(inbuf); free(outbuf); free(hdrbuf); free(rgbabuf); inbuf = outbuf = hdrbuf = rgbabuf = NULL; outcap = 0; }
EXPORT(xw_malloc) void *xw_malloc(int n) { return malloc(n); }
EXPORT(xw_free) void xw_free(void *p) { free(p); }
