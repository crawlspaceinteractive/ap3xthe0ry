/**
 * racer/loading.js — Shared loading screen compositor.
 *
 * Single draw for the orange "LOADING" progress bar (white-outline frame +
 * orange fill) used by:
 *   - the boot cinematic's LOAD phase (racer/titleintro.js)
 *   - main-menu transitions from a course (racer/racergame.js), where the
 *     just-left track's sky is rendered behind it
 *
 * Keeping the drawing here means every loading screen is pixel-identical — one
 * source of truth for the transition visual.
 */
import { drawRect, drawText, rgba } from "../engine/renderer.js";
import { SCREEN_W, SCREEN_H } from "../engine/luts.js";
import { drawBodyText, measureBodyText } from "./hudfont.js";

const ORANGE = rgba(255, 128, 8);
const WHITE  = rgba(255, 255, 255);

/**
 * Draws the "LOADING" label + orange progress bar centered on screen.
 * p: 0..1 fill fraction. Fonts optional (title may not have them yet); when
 * fonts.body is present the text uses the smallfont, otherwise the fallback
 * bitmap font — matches the intro's LOAD-phase rendering exactly.
 */
export function drawLoadingBar(rd, fonts, p) {
  const label = "LOADING";
  const size = 16;
  const ly = (SCREEN_H >> 1) - 24;
  if (fonts && fonts.body) {
    const w = measureBodyText(fonts, label, size, 1);
    drawBodyText(rd, fonts, label, (SCREEN_W - w) >> 1, ly, size, null);
  } else {
    const s = Math.max(1, Math.round(size / 8));
    drawText(rd, label, (SCREEN_W - label.length * 5 * s) >> 1, ly, 0xffffffff, s);
  }
  const bw = 200, bh = 12;
  const bx = (SCREEN_W - bw) >> 1, by = SCREEN_H >> 1;
  drawRect(rd, bx - 2, by - 2, bw + 4, bh + 4, WHITE, false);
  drawRect(rd, bx, by, Math.max(2, (bw * p) | 0), bh, ORANGE);
}