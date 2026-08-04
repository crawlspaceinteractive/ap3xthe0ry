/**
 * racer/sky.js — Parallax wrapping sky layers for the racer.
 *
 * Three Fuji mountain silhouette layers scroll at different rates based on
 * camera yaw, creating a layered parallax effect. Each layer is a pre-scaled
 * horizontal strip blitted directly into the software framebuffer.
 *
 * Renderer: 320×240 software framebuffer (rd.buf32 Uint32Array, ABGR packed),
 * 2× upscaled to 640×480 at present. The sky is drawn AFTER clearSky (gradient + stars + clouds) and BEFORE
 * the 3D track tris — it sits on top of the gradient but behind all geometry.
 *
 * Yaw continuity: camera yaw is not monotonic (the chase cam derives it from
 * atan2 → [-180,180], and heading wraps 359°→0°). Computing the scroll offset
 * directly from yaw would make the sky FLIP a full screen width at those
 * boundaries. Instead we accumulate the smallest signed angular delta each
 * frame, so the sky scrolls smoothly through the wrap.
 */
import { loadTexture } from "../engine/textureloader.js";
import { SCREEN_W, SCREEN_H, HALF_H, FOCAL_X, FOCAL_Y } from "../engine/luts.js";

// Strip heights scale with the render resolution (fractions of SCREEN_H) so
// the layers keep the same angular coverage; the 2× upscale doubles them on
// screen (back 144→288, middle 120→240, front 100→200).
const LAYER_DEFS = [
  { url: "assets/2D/textures/fuji_sky_layer_back.png",   targetH: (SCREEN_H * 0.60) | 0, parallax: 0.7  },
  { url: "assets/2D/textures/fuji_sky_layer_middle.png", targetH: (SCREEN_H * 0.50) | 0, parallax: 1.3  },
  { url: "assets/2D/textures/fuji_sky_layer_front.png",  targetH: (SCREEN_H * 0.42) | 0, parallax: 2.34 },
];

// pxPerDeg: how many screen pixels one degree of yaw scrolls at 1:1 scale.
// FOCAL_X ≈ 134 → pxPerDeg ≈ 2.34
const PX_PER_DEG = FOCAL_X * Math.PI / 180;

// Seam blend width (px): crossfade the strip's first/last columns so the
// wrap-tiling seam is invisible even for non-seamless source panoramas.
const SEAM_BLEND = 4;

class SkyLayers {
  constructor() {
    this._layers = [];
    this._ready = false;
    this._lastYaw = null;   // previous frame's yaw (for delta accumulation)
    this._offsets = [];     // accumulated scroll px per layer (continuous)
  }

  async load() {
    const loaded = await Promise.all(
      LAYER_DEFS.map(async (def) => {
        const tex = await loadTexture(def.url);
        if (!tex) return null;
        return this._prescale(tex, def.targetH, def.parallax);
      })
    );
    this._layers = loaded.filter(Boolean);
    this._ready = this._layers.length > 0;
    this._offsets = this._layers.map(() => 0);
    this._lastYaw = null;
    if (this._layers.length) {
      console.log(`[sky] loaded ${this._layers.length} parallax layers`);
    }
  }

  /**
   * Pre-scale a texture to a target height strip using an offscreen canvas.
   * The strip keeps the FULL source width (entire 1024px panorama) — only the
   * height is scaled — so the sky uses all of the source and the tile period
   * matches the full 360° panorama.
   * Returns { data: Uint32Array, w, h, parallax } for fast per-frame blitting.
   */
  _prescale(tex, targetH, parallax) {
    const w = tex.width;
    const h = targetH;

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.imageSmoothingEnabled = false;

    // Draw the source texture scaled to fit the strip
    const srcCanvas = document.createElement("canvas");
    srcCanvas.width = tex.width;
    srcCanvas.height = tex.height;
    const srcCtx = srcCanvas.getContext("2d");
    srcCtx.putImageData(new ImageData(new Uint8ClampedArray(tex.data.buffer || tex.data), tex.width, tex.height), 0, 0);
    ctx.drawImage(srcCanvas, 0, 0, w, h);

    const imageData = ctx.getImageData(0, 0, w, h);

    // Seam blend: crossfade the first/last SEAM_BLEND columns so wrap-tiling
    // matches edge-to-edge (source panoramas have small left/right mismatches).
    if (w > SEAM_BLEND * 4) {
      const px = imageData.data;
      for (let y = 0; y < h; y++) {
        const row = y * w * 4;
        for (let i = 0; i < SEAM_BLEND; i++) {
          // f: 0 at the outermost column (full crossfade to the opposite edge)
          //    → 1 at the innermost column (source pixels left untouched)
          const f = i / (SEAM_BLEND - 1);
          const out = 0.5 * (1 - f);
          const lc = row + i * 4;
          const rc = row + (w - 1 - i) * 4;
          for (let c = 0; c < 4; c++) {
            const a = px[lc + c];
            const b = px[rc + c];
            px[lc + c] = (a * (1 - out) + b * out) | 0;
            px[rc + c] = (b * (1 - out) + a * out) | 0;
          }
        }
      }
    }

    // Copy into Uint32Array for direct buf32 writes (little-endian ABGR)
    const data = new Uint32Array(imageData.data.buffer);

    return { data, w, h, parallax };
  }

  /**
   * Blit all sky layers into the framebuffer.
   * Called after clearSky (gradient + stars + clouds) and before 3D tris.
   *
   * @param {object} rd   - renderer { buf32, depth, ... }
   * @param {number} yaw  - camera yaw in degrees (may wrap 360° / ±180°)
   * @param {number} pitch - camera pitch in degrees (positive = look up)
   */
  blit(rd, yaw, pitch) {
    if (!this._ready) return;

    const { buf32 } = rd;

    // Accumulate the smallest signed angular change; handles yaw wrapping
    // (359°→0°, and atan2's +180°→-180°) without flipping the sky.
    let delta = 0;
    if (this._lastYaw !== null) {
      delta = yaw - this._lastYaw;
      while (delta > 180) delta -= 360;
      while (delta < -180) delta += 360;
    }
    this._lastYaw = yaw;

    // Horizon row: base at screen midpoint, shifted down by pitch.
    // FOCAL_Y ≈ 143 → ~2.5 px per degree of pitch at 320×240 (5.0 at 640×480
    // output). Clamp keeps the horizon between ~20% and ~25% below screen
    // center (same relative band as the old 320×200 render).
    const horizon = Math.max(
      (HALF_H - SCREEN_H * 0.20) | 0,
      Math.min((HALF_H + SCREEN_H * 0.25) | 0, (HALF_H + pitch * (FOCAL_Y * Math.PI / 180)) | 0)
    );

    for (let i = 0; i < this._layers.length; i++) {
      const layer = this._layers[i];
      const { data, w, h, parallax } = layer;
      const stripTop = horizon - h;

      // Skip if the entire strip is off-screen
      if (stripTop >= SCREEN_H || stripTop + h <= 0) continue;

      // Continuous scroll: accumulate per-degree motion; xoff never jumps
      // even when the incoming yaw wraps.
      this._offsets[i] += delta * PX_PER_DEG * parallax;
      const xoff = ((Math.round(this._offsets[i]) % w) + w) % w;

      // Clamp draw range to visible screen area
      const yStart = Math.max(0, stripTop);
      const yEnd = Math.min(SCREEN_H, stripTop + h);

      for (let y = yStart; y < yEnd; y++) {
        const row = y * SCREEN_W;
        // v: 0 at strip top → 1 at strip bottom
        const v = y - stripTop;

        for (let sx = 0; sx < SCREEN_W; sx++) {
          const u = ((sx + xoff) % w + w) % w;
          const texel = data[v * w + u];
          // Alpha cutout: skip transparent texels (let gradient show through)
          if ((texel >>> 24) >= 128) {
            buf32[row + sx] = texel;
          }
        }
      }
    }
  }
}

export function createSkyLayers() {
  return new SkyLayers();
}
