// engine/gifdecode.js
// Minimal, dependency-free animated GIF parser + LZW decoder. Decodes purely
// from bytes — no canvas/DOM needed — used by textureloader.js to load real
// multi-frame animations (loadTexture's canvas-snapshot approach only ever
// captures whichever single frame the <img> happened to be on).
//
// decodeGIF(bytes, opts) -> { width, height, loopCount,
//   frames: [{ data: Uint8ClampedArray(w*h*4), delay }] }
//
// opts.maxSize: if set, frames are nearest-neighbour downsampled so the
// larger dimension is at most this many px (aspect kept) — useful when the
// source art is much bigger than where it's actually displayed on screen.

export function decodeGIF(bytes, opts = {}) {
  const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let p = 0;
  function u8() { return buf[p++]; }
  function u16() { const v = buf[p] | (buf[p + 1] << 8); p += 2; return v; }

  const sig = String.fromCharCode(buf[0], buf[1], buf[2], buf[3], buf[4], buf[5]);
  if (sig !== "GIF87a" && sig !== "GIF89a") throw new Error("Not a GIF: bad signature " + sig);
  p = 6;

  const width = u16();
  const height = u16();

  // Optional downsample: most callers only ever show this at a tiny on-screen
  // size (HUD toast icons etc.), so retaining every frame at full source
  // resolution wastes memory for no visible benefit. Nearest-neighbour,
  // computed once — matches the engine's "nearest: true" pixelated sampling
  // used everywhere else.
  let outW = width, outH = height;
  if (opts.maxSize && Math.max(width, height) > opts.maxSize) {
    const scale = opts.maxSize / Math.max(width, height);
    outW = Math.max(1, Math.round(width * scale));
    outH = Math.max(1, Math.round(height * scale));
  }
  const needsDownsample = outW !== width || outH !== height;

  const packed = u8();
  const globalColorTableFlag = (packed & 0x80) !== 0;
  const globalColorTableSize = 2 << (packed & 0x07);
  u8(); // background color index
  u8(); // pixel aspect ratio

  function readColorTable(n) {
    const table = new Uint8Array(n * 3);
    for (let i = 0; i < n * 3; i++) table[i] = buf[p++];
    return table;
  }

  let globalColorTable = null;
  if (globalColorTableFlag) globalColorTable = readColorTable(globalColorTableSize);

  function readSubBlocks() {
    let size = 0;
    const blocks = [];
    let blockSize;
    while ((blockSize = u8()) !== 0) {
      blocks.push(buf.subarray(p, p + blockSize));
      p += blockSize;
      size += blockSize;
    }
    const out = new Uint8Array(size);
    let o = 0;
    for (const b of blocks) { out.set(b, o); o += b.length; }
    return out;
  }

  const frames = [];
  let loopCount = 0;

  // Graphic Control Extension state — applies to the NEXT image descriptor.
  let gceDisposal = 0;
  let gceTransparentFlag = false;
  let gceTransparentIndex = -1;
  let gceDelay = 0;

  // Full-canvas composite buffer, persists across frames per disposal rules.
  const canvas = new Uint8ClampedArray(width * height * 4);
  let prevCanvas = null;         // snapshot for disposal method 3 (restore to previous)
  let disposalPending = 0;       // disposal method of the PREVIOUSLY drawn frame
  let pendingRestoreRect = null; // that frame's rect, applied before the next draw

  for (;;) {
    if (p >= buf.length) break;
    const block = u8();
    if (block === 0x3B) break; // trailer
    if (block === 0x21) {
      const label = u8();
      if (label === 0xF9) {
        // Graphic Control Extension
        u8(); // block size (4)
        const flags = u8();
        gceDisposal = (flags >> 2) & 0x07;
        gceTransparentFlag = (flags & 0x01) !== 0;
        gceDelay = u16();
        gceTransparentIndex = u8();
        u8(); // terminator
      } else if (label === 0xFF) {
        // Application Extension (NETSCAPE2.0 loop count, etc.)
        const blockSize = u8();
        const appId = buf.subarray(p, p + blockSize);
        p += blockSize;
        const sub = readSubBlocks();
        let idStr = "";
        for (let i = 0; i < appId.length; i++) idStr += String.fromCharCode(appId[i]);
        if (idStr.indexOf("NETSCAPE2.0") === 0 && sub.length >= 3) {
          loopCount = sub[1] | (sub[2] << 8);
        }
      } else {
        // Comment / Plain Text / unknown — skip its sub-blocks.
        readSubBlocks();
      }
      continue;
    }
    if (block === 0x2C) {
      // Image Descriptor
      const left = u16();
      const top = u16();
      const w = u16();
      const h = u16();
      const flags = u8();
      const localColorTableFlag = (flags & 0x80) !== 0;
      const interlaced = (flags & 0x40) !== 0;
      const localColorTableSize = 2 << (flags & 0x07);
      let colorTable = globalColorTable;
      if (localColorTableFlag) colorTable = readColorTable(localColorTableSize);

      const minCodeSize = u8();
      const compressed = readSubBlocks();
      const indices = lzwDecode(minCodeSize, compressed, w * h);

      // Apply the PREVIOUS frame's disposal before drawing this one.
      if (disposalPending === 2 && pendingRestoreRect) {
        clearRect(canvas, width, pendingRestoreRect);
      } else if (disposalPending === 3 && prevCanvas) {
        canvas.set(prevCanvas);
      }
      if (gceDisposal === 3) {
        prevCanvas = canvas.slice(); // snapshot pre-draw, restored after this frame
      }

      blitIndices(
        canvas, width, height, indices, colorTable, w, h, left, top,
        interlaced, gceTransparentFlag ? gceTransparentIndex : -1
      );

      frames.push({
        data: needsDownsample
          ? downsampleNearest(canvas, width, height, outW, outH)
          : canvas.slice(),
        delay: Math.max(20, gceDelay * 10), // 1/100s -> ms; clamp tiny/zero delays like browsers do
      });

      disposalPending = gceDisposal;
      pendingRestoreRect = { left, top, w, h };
      gceDisposal = 0; gceTransparentFlag = false; gceTransparentIndex = -1; gceDelay = 0;
      continue;
    }
    break; // unknown block — bail rather than loop forever
  }

  return { width: outW, height: outH, loopCount, frames };
}

// Given a decoded animation and an elapsed-time value (ms, may exceed the
// loop length or be arbitrarily large — it's wrapped), returns the frame
// that should be showing right now.
export function frameAtTime(anim, ms) {
  const frames = anim && anim.frames;
  if (!frames || !frames.length) return null;
  const total = anim.totalDelay || frames.reduce((s, f) => s + f.delay, 0);
  if (total <= 0) return frames[0];
  let t = ((ms % total) + total) % total;
  for (let i = 0; i < frames.length; i++) {
    const d = frames[i].delay;
    if (t < d) return frames[i];
    t -= d;
  }
  return frames[frames.length - 1];
}

function downsampleNearest(src, srcW, srcH, dstW, dstH) {
  const dst = new Uint8ClampedArray(dstW * dstH * 4);
  for (let y = 0; y < dstH; y++) {
    const sy = Math.min(srcH - 1, (y * srcH / dstH) | 0);
    const srcRow = sy * srcW;
    const dstRow = y * dstW;
    for (let x = 0; x < dstW; x++) {
      const sx = Math.min(srcW - 1, (x * srcW / dstW) | 0);
      const si = (srcRow + sx) * 4;
      const di = (dstRow + x) * 4;
      dst[di] = src[si]; dst[di + 1] = src[si + 1]; dst[di + 2] = src[si + 2]; dst[di + 3] = src[si + 3];
    }
  }
  return dst;
}

function clearRect(canvas, canvasWidth, rect) {
  const { left, top, w, h } = rect;
  for (let y = 0; y < h; y++) {
    const row = (top + y) * canvasWidth;
    for (let x = 0; x < w; x++) {
      const i = (row + left + x) * 4;
      canvas[i] = 0; canvas[i + 1] = 0; canvas[i + 2] = 0; canvas[i + 3] = 0;
    }
  }
}

function blitIndices(canvas, canvasWidth, canvasHeight, indices, colorTable, w, h, left, top, interlaced, transparentIndex) {
  const rowOrder = interlaced ? interlaceRowOrder(h) : null;
  for (let row = 0; row < h; row++) {
    const srcRow = interlaced ? rowOrder[row] : row;
    const destY = top + row;
    if (destY < 0 || destY >= canvasHeight) continue;
    const destRowOff = destY * canvasWidth;
    const srcRowOff = srcRow * w;
    for (let x = 0; x < w; x++) {
      const destX = left + x;
      if (destX < 0 || destX >= canvasWidth) continue;
      const idx = indices[srcRowOff + x];
      if (idx === transparentIndex) continue;
      const ci = idx * 3;
      const di = (destRowOff + destX) * 4;
      canvas[di] = colorTable[ci];
      canvas[di + 1] = colorTable[ci + 1];
      canvas[di + 2] = colorTable[ci + 2];
      canvas[di + 3] = 255;
    }
  }
}

function interlaceRowOrder(h) {
  const order = new Array(h);
  let i = 0;
  for (let y = 0; y < h; y += 8) order[i++] = y;
  for (let y = 4; y < h; y += 8) order[i++] = y;
  for (let y = 2; y < h; y += 4) order[i++] = y;
  for (let y = 1; y < h; y += 2) order[i++] = y;
  return order;
}

// Variable-width LZW decompression as used by GIF. Dictionary entries are
// stored as a (prefix code, suffix byte) chain instead of literal arrays —
// expanding a code walks the chain into a scratch stack and reverses it —
// which avoids the O(n^2) array-concat cost of a naive dictionary.
function lzwDecode(minCodeSize, data, pixelCount) {
  const CLEAR = 1 << minCodeSize;
  const EOI = CLEAR + 1;
  const MAX_CODES = 4096;

  const prefix = new Int32Array(MAX_CODES);
  const suffix = new Uint8Array(MAX_CODES);
  const stack = new Uint8Array(MAX_CODES);

  let nextCode, codeSize;
  function resetDict() {
    for (let i = 0; i < CLEAR; i++) { prefix[i] = -1; suffix[i] = i; }
    nextCode = CLEAR + 2;
    codeSize = minCodeSize + 1;
  }
  resetDict();

  const out = new Uint8Array(pixelCount);
  let outPos = 0;

  let bitBuf = 0, bitLen = 0, bytePos = 0;
  function readCode() {
    while (bitLen < codeSize) {
      if (bytePos >= data.length) return EOI;
      bitBuf |= data[bytePos++] << bitLen;
      bitLen += 8;
    }
    const code = bitBuf & ((1 << codeSize) - 1);
    bitBuf >>= codeSize;
    bitLen -= codeSize;
    return code;
  }

  // Expands `code` into `out`, returns its first symbol (needed for both the
  // KwKwK special case and to build the next dictionary entry).
  function emitCode(code) {
    let sp = 0, c = code;
    for (;;) {
      stack[sp++] = suffix[c];
      if (prefix[c] === -1) break;
      c = prefix[c];
    }
    const first = stack[sp - 1];
    while (sp > 0 && outPos < pixelCount) out[outPos++] = stack[--sp];
    return first;
  }

  let prevCode = -1;
  while (outPos < pixelCount) {
    const code = readCode();
    if (code === CLEAR) { resetDict(); prevCode = -1; continue; }
    if (code === EOI) break;

    let first;
    if (code < nextCode) {
      first = emitCode(code);
    } else if (code === nextCode && prevCode !== -1) {
      first = emitCode(prevCode);
      if (outPos < pixelCount) out[outPos++] = first;
    } else {
      break; // corrupt stream
    }

    if (prevCode !== -1 && nextCode < MAX_CODES) {
      prefix[nextCode] = prevCode;
      suffix[nextCode] = first;
      nextCode++;
      if (nextCode === (1 << codeSize) && codeSize < 12) codeSize++;
    }
    prevCode = code;
  }

  return out;
}
