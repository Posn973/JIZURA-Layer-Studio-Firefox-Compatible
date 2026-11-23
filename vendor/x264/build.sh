#!/bin/sh
# Builds vendor/x264.wasm (one thread) and vendor/x264-mt.wasm (threads) for JIZURA改.
# Needs wasi-sdk 25 (https://github.com/WebAssembly/wasi-sdk) and x264 at the commit in X264_COMMIT,
# with x264-wasi.patch applied. GPL-2.0-or-later, like x264.
set -e
WASI=${WASI:-$HOME/wasi-sdk-25.0-x86_64-linux}
CLANG="$WASI/bin/clang"; SYS="$WASI/share/wasi-sysroot"
build_lib() { # $1 = dir, $2 = target, $3 = thread flag
  ( cd "$1"
    CC="$CLANG --target=$2 --sysroot=$SYS $4" AR="$WASI/bin/llvm-ar" RANLIB="$WASI/bin/llvm-ranlib" ./configure --host=i686-pc-linux-gnu \
      --disable-asm $3 --disable-cli --enable-static --disable-opencl --disable-avs --disable-swscale --disable-lavf --disable-ffms \
      --disable-gpac --disable-lsmash --bit-depth=8 --chroma-format=420 --extra-cflags="-O3 -msimd128 -D_WASI_EMULATED_SIGNAL"
    sed -i 's/ -m32 / /; s/^LDFLAGS=-m32 /LDFLAGS=/; s/-fno-tree-vectorize//' config.mak
    sed -i 's/#define HAVE_MALLOC_H 1/#define HAVE_MALLOC_H 0/; s/#define HAVE_THP 1/#define HAVE_THP 0/' config.h
    make -j8 lib-static )
}
build_lib x264-st wasm32-wasip1 --disable-thread ""
build_lib x264-mt wasm32-wasip1-threads "" -pthread
"$CLANG" --target=wasm32-wasip1 --sysroot="$SYS" -O3 -msimd128 -mexec-model=reactor -Ix264-st x264w.c x264-st/libx264.a -lm \
  -Wl,--strip-all -Wl,-z,stack-size=4194304 -Wl,--initial-memory=67108864 -Wl,--max-memory=4294967296 -o x264.wasm
"$CLANG" --target=wasm32-wasip1-threads --sysroot="$SYS" -pthread -O3 -msimd128 -mexec-model=reactor -Ix264-mt x264w.c x264-mt/libx264.a -lm -lwasi-emulated-signal \
  -Wl,--strip-all -Wl,-z,stack-size=4194304 -Wl,--import-memory,--shared-memory,--max-memory=4294967296,--initial-memory=134217728 \
  -Wl,--export=wasi_thread_start -o x264-mt.wasm
