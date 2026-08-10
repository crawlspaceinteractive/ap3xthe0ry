// engine/textureloader.js
// CPU-side image texture loader/sampler for the software renderer.
// Engine-only: callers provide fully resolved URLs.
import { decodeGIF, frameAtTime } from "./gifdecode.js";
export { frameAtTime };

const _textureCache = new Map();
const _animCache = new Map();

export async function loadTexture(url, opts = {}) {
  if (!url) return null;
  const key = `${url}|${opts.wrap !== false ? "wrap" : "clamp"}${opts.cropToContent ? "|crop" : ""}`;
  if (_textureCache.has(key)) return _textureCache.get(key);

  const promise = loadImageBitmapTexture(url, opts).catch(err => {
    console.warn("[texture] failed to load", url, err);
    return null;
  });
  _textureCache.set(key, promise);
  return promise;
}

async function loadImageBitmapTexture(url, opts = {}) {
  const img = await loadImage(url);
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth || img.width;
  canvas.height = img.naturalHeight || img.height;

  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, 0, 0);

  let imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  let width = canvas.width;
  let height = canvas.height;

  // cropToContent: trim transparent margins so wrap-tiling repeats the
  // artwork edge-to-edge with no empty gaps between tiles. Scans the alpha
  // channel for the opaque bounding box and re-extracts just that sub-rect.
  if (opts.cropToContent) {
    const rect = alphaBounds(imageData, opts.alphaThreshold ?? 8);
    if (rect && (rect.w < width || rect.h < height)) {
      imageData = ctx.getImageData(rect.x, rect.y, rect.w, rect.h);
      width = rect.w;
      height = rect.h;
    }
  }

  return {
    url,
    width,
    height,
    data: imageData.data,
    wrap: opts.wrap !== false,
    nearest: true,
  };
}

// Opaque-content bounding box of an ImageData (alpha > threshold).
// Returns null if the image is fully transparent (caller keeps full rect).
function alphaBounds(imageData, threshold) {
  const { width: w, height: h, data } = imageData;
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    const row = y * w * 4;
    for (let x = 0; x < w; x++) {
      if (data[row + x * 4 + 3] > threshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    // crossOrigin must be set before src to allow getImageData on external CDN images
    // (Supabase, etc.) without tainting the canvas.
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Image load failed: ${url}`));
    img.src = url;
  });
}

// Pack many textures into ONE shared CPU buffer (Phase 2.2).
// Shelf-packs all images into a single canvas, does a single getImageData,
// and returns Map<url, textureView>. Each view shares the atlas `data` and
// carries { ox, oy, stride } so sampleTextureNearest reads its sub-rect.
// Wrap-tiling still works: x/y are wrapped in LOCAL texture space first,
// then offset into the atlas. Views are seeded into the loadTexture cache
// so later loadTexture(url) calls reuse them.
export async function packTextureAtlas(urls, opts = {}) {
  const unique = [...new Set((urls || []).filter(Boolean))];
  if (!unique.length) return new Map();

  const loaded = await Promise.all(unique.map(url =>
    loadImage(url).then(img => ({ url, img })).catch(err => {
      console.warn("[atlas] image failed, skipping:", url, err);
      return null;
    })
  ));
  const entries = loaded.filter(Boolean);
  if (!entries.length) throw new Error("atlas: no images loaded");

  // Near-square power-of-two atlas width, at least as wide as the widest image.
  let area = 0, maxW = 1;
  for (const e of entries) {
    const w = e.img.naturalWidth || e.img.width;
    const h = e.img.naturalHeight || e.img.height;
    area += w * h;
    if (w > maxW) maxW = w;
  }
  let atlasW = 1 << Math.ceil(Math.log2(Math.sqrt(area)));
  if (atlasW < maxW) atlasW = 1 << Math.ceil(Math.log2(maxW));

  // Shelf packing: tallest first, rows left-to-right.
  entries.sort((a, b) =>
    (b.img.naturalHeight || b.img.height) - (a.img.naturalHeight || a.img.height));
  let shelfX = 0, shelfY = 0, shelfH = 0;
  const places = [];
  for (const e of entries) {
    const w = e.img.naturalWidth || e.img.width;
    const h = e.img.naturalHeight || e.img.height;
    if (shelfX + w > atlasW) { shelfY += shelfH; shelfX = 0; shelfH = 0; }
    places.push({ url: e.url, img: e.img, w, h, x: shelfX, y: shelfY });
    shelfX += w;
    if (h > shelfH) shelfH = h;
  }
  const atlasH = shelfY + shelfH;

  const canvas = document.createElement("canvas");
  canvas.width = atlasW;
  canvas.height = atlasH;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingEnabled = false;
  for (const p of places) ctx.drawImage(p.img, p.x, p.y);
  const data = ctx.getImageData(0, 0, atlasW, atlasH).data;

  const wrap = opts.wrap !== false;
  const map = new Map();
  for (const p of places) {
    const view = {
      url: p.url, width: p.w, height: p.h, data,
      wrap, nearest: true, ox: p.x, oy: p.y, stride: atlasW,
    };
    map.set(p.url, view);
    _textureCache.set(`${p.url}|${wrap ? "wrap" : "clamp"}`, Promise.resolve(view));
  }
  console.log(`[atlas] packed ${places.length} textures into ${atlasW}x${atlasH}`);
  return map;
}

export function sampleTextureNearest(tex, u, v) {
  if (!tex || !tex.data || tex.width <= 0 || tex.height <= 0) return 0xffffffff;

  let x = Math.floor(u * tex.width);
  let y = Math.floor(v * tex.height);

  if (tex.wrap) {
    x = ((x % tex.width) + tex.width) % tex.width;
    y = ((y % tex.height) + tex.height) % tex.height;
  } else {
    x = x < 0 ? 0 : x >= tex.width ? tex.width - 1 : x;
    y = y < 0 ? 0 : y >= tex.height ? tex.height - 1 : y;
  }

  // Atlas sub-rect support: ox/oy/stride default to 0/0/width for standalone
  // textures, so the plain path costs only two adds.
  const i = (((tex.oy || 0) + y) * (tex.stride || tex.width) + (tex.ox || 0) + x) * 4;
  const r = tex.data[i];
  const g = tex.data[i + 1];
  const b = tex.data[i + 2];
  const a = tex.data[i + 3];
  return (a << 24) | (b << 16) | (g << 8) | r;
}

export function tintTexelRGBA(texel, tint) {
  const tr = tint & 255;
  const tg = (tint >>> 8) & 255;
  const tb = (tint >>> 16) & 255;

  const r = texel & 255;
  const g = (texel >>> 8) & 255;
  const b = (texel >>> 16) & 255;
  const a = (texel >>> 24) & 255;

  return (
    (a << 24) |
    ((((b * tb) / 255) | 0) << 16) |
    ((((g * tg) / 255) | 0) << 8) |
    (((r * tr) / 255) | 0)
  ) >>> 0;
}

// Loads a GIF as a real multi-frame animation (all frames + their delays),
// unlike loadTexture()'s canvas-snapshot approach which only ever captures
// whichever single frame the <img> happened to land on. Each returned frame
// is shaped { width, height, data } — a drop-in texture for drawSpriteFit /
// drawSpriteFit-style blits. Use engine/gifdecode.js's frameAtTime(anim, ms)
// to pick the frame for the current time.
// opts.maxSize: nearest-neighbour downsample (see gifdecode.js) — worth
// setting when the source art is much bigger than its on-screen size.
export async function loadAnimatedTexture(url, opts = {}) {
  if (!url) return null;
  const key = `${url}|anim${opts.maxSize ? "|max" + opts.maxSize : ""}`;
  if (_animCache.has(key)) return _animCache.get(key);

  const promise = fetchAndDecodeGIF(url, opts).catch(err => {
    console.warn("[texture] failed to load animated gif", url, err);
    return null;
  });
  _animCache.set(key, promise);
  return promise;
}

async function fetchAndDecodeGIF(url, opts) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GIF fetch failed (${res.status}): ${url}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const gif = decodeGIF(bytes, opts);
  const frames = gif.frames.map(f => ({
    width: gif.width,
    height: gif.height,
    data: f.data,
    delay: f.delay,
  }));
  const totalDelay = frames.reduce((s, f) => s + f.delay, 0);
  return { url, width: gif.width, height: gif.height, frames, totalDelay, loopCount: gif.loopCount };
}

export function clearTextureCache() {
  _textureCache.clear();
  _animCache.clear();
}
