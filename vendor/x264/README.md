# x264 for JIZURA Layer Studio Firefox Compatible

x264.wasm (one thread) and x264-mt.wasm (threads) are x264, built for WebAssembly, with a small wrapper (x264w.c).
They are embedded in index.html / en/index.html by build.py and used for H.264 MP4 export in Firefox.

- x264: https://code.videolan.org/videolan/x264 (mirror: https://github.com/mirror/x264), commit c24e06c2e184345ceb33eb20a15d1024d9fd3497
- Source of that commit: x264-src-c24e06c2e184.tar.gz
- Changes for WebAssembly: x264-wasi.patch (thread stack size, CPU count)
- Wrapper: x264w.c (open / RGBA→I420 / encode / flush)
- Build: build.sh (wasi-sdk 25; configure with --disable-asm)
- License: GNU General Public License version 2 or later (COPYING). Because of x264, the whole app is distributed under GPL-2.0-or-later.

Steps to rebuild:

    tar xzf x264-src-c24e06c2e184.tar.gz
    cp -r x264-c24e06c2e184345ceb33eb20a15d1024d9fd3497 x264-st && cp -r x264-c24e06c2e184345ceb33eb20a15d1024d9fd3497 x264-mt
    (cd x264-st && patch -p1 < ../x264-wasi.patch) && (cd x264-mt && patch -p1 < ../x264-wasi.patch)
    WASI=/path/to/wasi-sdk-25.0-x86_64-linux ./build.sh
