/**
 * racer/trackglobe.js — Placeholder "globe" panel for COURSES track select.
 *
 * Replaces the old per-track wireframe hologram (trackpreview.js) with a
 * plain shaded sphere. It doesn't read any track data — it's a static ball.
 * The globe itself does not rotate or animate; call drawGlobePlaceholder()
 * with no frame argument.
 *
 * drawGlobeCrosshair() draws a small reticle fixed at the center of the same
 * rect, pulsing its alpha in/out over time (frame-driven) — a locator-style
 * blink, FIFA: Road to World Cup 98-ish, meant to sell "the globe is
 * targeting a spot" without actually spinning the globe geometry. The rest
 * of that illusion (marker sweep-in, etc.) is handled elsewhere.
 *
 * Usage (see racergame.js _render, MENU/COURSES branch):
 *   drawGlobePlaceholder(rd, x, y, w, h);       // static, no frame
 *   drawGlobeCrosshair(rd, x, y, w, h, frame);  // blinks with frame
 */
import { drawCircle, drawLine, rgba } from "../engine/renderer.js";

const SPHERE_BASE = rgba(35, 80, 190);
const SPHERE_MID  = rgba(70, 130, 235);
const SPHERE_LIT  = rgba(150, 195, 255);
const SPHERE_RIM  = rgba(12, 30, 80);
const CROSSHAIR   = rgba(255, 170, 60); // matches the menu's orange accent
const BLINK_SPEED = 0.05;               // radians/frame — crosshair pulse rate

/**
 * Draw a plain shaded blue sphere centered in the (x, y, w, h) rect. Fully
 * static — the highlight sits at a fixed spot; no frame/time input at all.
 */
export function drawGlobePlaceholder(rd, x, y, w, h) {
  const cx = x + w / 2, cy = y + h / 2;
  const r = Math.max(4, Math.min(w, h) * 0.42) | 0;

  // Fixed highlight offset (up-left of center) — no animation.
  const hlx = cx - r * 0.32;
  const hly = cy - r * 0.12 - r * 0.12;

  // Base disc, then two smaller offset discs faked toward the highlight to
  // read as a lit sphere without a real lighting model.
  drawCircle(rd, cx, cy, r, SPHERE_BASE, true);
  drawCircle(rd, hlx, hly, r * 0.72, SPHERE_MID, true);
  drawCircle(rd, hlx - r * 0.14, hly - r * 0.14, r * 0.34, SPHERE_LIT, true);
  // Rim shadow — darker ring just inside the silhouette, opposite the highlight.
  drawCircle(rd, cx - (hlx - cx) * 0.3, cy - (hly - cy) * 0.3, r - 1, SPHERE_RIM, false);
}

/**
 * Draw a small reticle fixed at the center of the (x, y, w, h) rect, alpha-
 * pulsing in and out with `frame` (a slow sine breathing blink, 0 → full →
 * 0). Purely cosmetic — doesn't read or affect the globe's rotation state.
 */
export function drawGlobeCrosshair(rd, x, y, w, h, frame) {
  const cx = x + w / 2, cy = y + h / 2;
  const size = Math.max(5, Math.min(w, h) * 0.16);
  const gap = size * 0.35;
  const f = frame || 0;
  const alpha = Math.max(0, Math.min(255, ((Math.sin(f * BLINK_SPEED) + 1) * 0.5 * 255) | 0));
  if (alpha <= 2) return; // fully invisible this frame — skip the draw

  drawLine(rd, cx - size, cy, cx - gap, cy, CROSSHAIR, alpha);
  drawLine(rd, cx + gap, cy, cx + size, cy, CROSSHAIR, alpha);
  drawLine(rd, cx, cy - size, cx, cy - gap, CROSSHAIR, alpha);
  drawLine(rd, cx, cy + gap, cx, cy + size, CROSSHAIR, alpha);
  drawCircle(rd, cx, cy, gap * 0.9, CROSSHAIR, false, alpha);
}
