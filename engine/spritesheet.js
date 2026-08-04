// engine/spritesheet.js — UI spritesheet slicing (Phase 2.2).
// Loads an icon sheet, slices it into individual sprites (auto-detected via
// transparent gutters, or a uniform cols×rows grid), and blits sprites into
// the software framebuffer (HUD-space: no depth, no fog).
import { SCREEN_W, SCREEN_H } from "./luts.js";

const ALPHA_GUTTER = 16; // alpha <= this counts as "empty" for gutter detection

export async function loadSpriteSheet(url, opts = {}) {
  const img = await new Promise((resolve, reject) => {
    const im = new Image();
    // crossOrigin before src — required for getImageData on CDN images.
    im.crossOrigin = "anonymous";
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error(`Spritesheet load failed: ${url}`));
    im.src = url;
  });

  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, w, h).data;

  let colSpans, rowSpans;
  if (opts.cols && opts.rows) {
    colSpans = uniformSpans(w, opts.cols);
    rowSpans = uniformSpans(h, opts.rows);
  } else {
    colSpans = findSpans(data, w, h, true);
    rowSpans = findSpans(data, w, h, false);
    if (!colSpans.length || !rowSpans.length) {
      colSpans = [[0, w - 1]];
      rowSpans = [[0, h - 1]];
    }
  }

  // Row-major slice; fully-empty cells are dropped.
  const sprites = [];
  for (const [y0, y1] of rowSpans) {
    for (const [x0, x1] of colSpans) {
      const sw = x1 - x0 + 1, sh = y1 - y0 + 1;
      const sdata = new Uint8ClampedArray(sw * sh * 4);
      let empty = true;
      for (let y = 0; y < sh; y++) {
        for (let x = 0; x < sw; x++) {
          const si = ((y0 + y) * w + (x0 + x)) * 4;
          const di = (y * sw + x) * 4;
          sdata[di] = data[si];
          sdata[di + 1] = data[si + 1];
          sdata[di + 2] = data[si + 2];
          sdata[di + 3] = data[si + 3];
          if (data[si + 3] > ALPHA_GUTTER) empty = false;
        }
      }
      if (!empty) sprites.push({ width: sw, height: sh, data: sdata });
    }
  }

  return { url, sprites, cols: colSpans.length, rows: rowSpans.length };
}

function uniformSpans(total, n) {
  const spans = [];
  const step = total / n;
  for (let i = 0; i < n; i++) {
    spans.push([Math.round(i * step), Math.round((i + 1) * step) - 1]);
  }
  return spans;
}

// Contiguous non-transparent column (vertical=true) or row spans, separated
// by fully-transparent gutters.
function findSpans(data, w, h, vertical) {
  const len = vertical ? w : h;
  const other = vertical ? h : w;
  const solid = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    for (let j = 0; j < other; j++) {
      const idx = vertical ? (j * w + i) : (i * w + j);
      if (data[idx * 4 + 3] > ALPHA_GUTTER) { solid[i] = 1; break; }
    }
  }
  const spans = [];
  let start = -1;
  for (let i = 0; i < len; i++) {
    if (solid[i] && start < 0) start = i;
    else if (!solid[i] && start >= 0) { spans.push([start, i - 1]); start = -1; }
  }
  if (start >= 0) spans.push([start, len - 1]);
  return spans;
}

// Nearest-neighbour blit scaled to targetH pixels tall (aspect kept).
// Transparent texels (alpha < 128) are skipped.
export function drawSpriteFit(rd, sprite, dx, dy, targetH) {
  if (!sprite || !sprite.data) return;
  const scale = targetH / sprite.height;
  const targetW = Math.max(1, Math.round(sprite.width * scale));
  const { buf32 } = rd;
  const { data, width, height } = sprite;
  for (let y = 0; y < targetH; y++) {
    const py = dy + y;
    if (py < 0 || py >= SCREEN_H) continue;
    const sy = Math.min(height - 1, (y / scale) | 0);
    for (let x = 0; x < targetW; x++) {
      const px = dx + x;
      if (px < 0 || px >= SCREEN_W) continue;
      const sx = Math.min(width - 1, (x / scale) | 0);
      const si = (sy * width + sx) * 4;
      if (data[si + 3] < 128) continue;
      buf32[py * SCREEN_W + px] =
        (255 << 24) | (data[si + 2] << 16) | (data[si + 1] << 8) | data[si];
    }
  }
}
