/**
 * racer/titleintro.js — Boot cinematic: warning card → animated title → PRESS
 * START → orange loading bar. Runs entirely in 2D (no 3D scene behind it).
 *
 * Sequence (all timings in 60Hz fixed steps):
 *   WARN   warning card (WARNING.png background fitted to the display frame,
 *          with the bigfont safety text overlaid) hold 3s then fade to black
 *   SWOOP  "AP3X" squashed at top-left, stretches while swooping to just above
 *          mid-screen; blinks during the swoop; the motion repeats 3×
 *   SLIDE  "THE0RY" slides in from the right (left edge lands under AP3X's
 *          center) leaving white after-images
 *   WAIT   1s beat
 *   PRESS  "PRESS START" blinks until START — game plays the rev noise
 *   CRAWL  holding phase handed to RacerGame, which plays the pre-menu
 *          crawlcard screen (spinning save device + autosave notice) here,
 *          then calls beginLoad() to resume
 *   LOAD   orange loading bar fills (waits for assets), then done → MENU
 */
import { drawRect, drawText, rgba } from "../engine/renderer.js";
import { SCREEN_W, SCREEN_H } from "../engine/luts.js";
import { assetUrl } from "../engine/asseturls.js";
import {
  drawBigText, drawBigTextX, measureBigText,
  drawBodyText, measureBodyText,
} from "./hudfont.js";
import { drawLoadingBar } from "./loading.js";

const ORANGE = rgba(255, 128, 8);
const BLACK  = rgba(0, 0, 0);
const WHITE  = rgba(255, 255, 255);
const GHOSTS = [rgba(90, 90, 95), rgba(160, 160, 168), rgba(235, 235, 240)];

// Warning-screen background art (2x the software frame, 4:3) — downscaled
// once to the 320x240 frame on load, then blitted each WARN frame.
const WARNING_URL = assetUrl("assets/2D/ui/intro/WARNING.png");

const WARN_HOLD = 180;   // 3s
const WARN_FADE = 45;
const SWOOP_T   = 20;   // 1s total
const SWOOPS    = 3;
const SLIDE_T   = 60;   // 1s
const WAIT_T    = 120;    // 2s
const LOAD_T    = 100;

const TITLE_H = 44;
const SQUASH0 = 0.0;    // starting horizontal squash of AP3X

const easeOut = (p) => 1 - (1 - p) * (1 - p);

export class TitleIntro {
  constructor() {
    this.phase = "WARN";
    this.t = 0;
    this.fade = 0;        // passed to present() — warning fade-to-black
    this.finished = false;
    this._layout = null;
    this._warningPixels = null;  // WARNING.png scaled into the 320x240 frame

    // Load the warning background. The reel (racer/intro.js) runs for seconds
    // before the WARN card shows, so this is almost always ready by then; the
    // WARN phase falls back to the solid orange card until it lands.
    const im = new Image();
    im.onload = () => {
      try {
        const c = document.createElement("canvas");
        c.width = SCREEN_W;
        c.height = SCREEN_H;
        const g = c.getContext("2d", { willReadFrequently: true });
        g.imageSmoothingEnabled = false;
        // Fit to the display frame: the art is 2x the software frame at the
        // same 4:3, so a straight scale to SCREEN_W x SCREEN_H is a perfect
        // cover with no cropping.
        g.drawImage(im, 0, 0, SCREEN_W, SCREEN_H);
        this._warningPixels = new Uint32Array(
          g.getImageData(0, 0, SCREEN_W, SCREEN_H).data.buffer
        );
      } catch (err) {
        console.warn("[titleintro] warning bg failed", err);
      }
    };
    im.src = WARNING_URL;
  }

  // Final composition: AP3X above-center-left, THE0RY tucked underneath with
  // its left edge on AP3X's horizontal center. Shrinks to fit the screen.
  _getLayout(fonts) {
    if (this._layout && this._layout.hasFonts === !!(fonts && fonts.big)) return this._layout;
    const hasFonts = !!(fonts && fonts.big && fonts.body);
    let h = TITLE_H;
    const measure = (str, th) => hasFonts
      ? measureBigText(fonts, str, th, 2)
      : str.length * (5 * Math.max(1, Math.round(th / 5)) + 2);
    let apxW = measure("AP3X", h);
    let theoW = measure("THE0RY", h);
    let groupW = apxW / 2 + theoW;
    if (groupW > SCREEN_W - 12) {
      h = Math.max(16, (h * (SCREEN_W - 12)) / groupW | 0);
      apxW = measure("AP3X", h);
      theoW = measure("THE0RY", h);
      groupW = apxW / 2 + theoW;
    }
    const apxX = (SCREEN_W - groupW) >> 1;
    const apxY = (SCREEN_H >> 1) - h - 10;       // just above middle screen
    this._layout = {
      hasFonts, h, apxW, theoW,
      apxX, apxY,
      theoX: apxX + apxW / 2,                    // left edge = center of AP3X
      theoY: apxY + h + 4,
    };
    return this._layout;
  }

  /**
   * START/A pressed this frame. Returns "start" exactly once — when the press
   * lands on the PRESS phase (game plays the rev noise). Earlier presses skip
   * the animation forward to PRESS.
   */
  pressStart() {
    if (this.phase === "SWOOP" || this.phase === "SLIDE" || this.phase === "WAIT") {
      this.phase = "PRESS";
      this.t = 0;
      return null;
    }
    if (this.phase === "PRESS") {
      this.phase = "CRAWL";
      this.t = 0;
      return "start";
    }
    return null;
  }

  /** Resume from the CRAWL phase (the crawlcard screen has finished) into the
   *  LOAD phase so the loading bar fills, then the intro finishes → MENU. */
  beginLoad() {
    if (this.phase === "CRAWL") {
      this.phase = "LOAD";
      this.t = 0;
      return true;
    }
    return false;
  }

  /** One 60Hz step. */
  step(assetsReady) {
    this.t++;
    const t = this.t;
    switch (this.phase) {
      case "WARN":
        this.fade = t <= WARN_HOLD ? 0 : Math.min(1, (t - WARN_HOLD) / WARN_FADE);
        if (t >= WARN_HOLD + WARN_FADE) { this.phase = "SWOOP"; this.t = 0; this.fade = 0; }
        break;
      case "SWOOP":
        if (t >= SWOOP_T * SWOOPS) { this.phase = "SLIDE"; this.t = 0; }
        break;
      case "SLIDE":
        if (t >= SLIDE_T) { this.phase = "WAIT"; this.t = 0; }
        break;
      case "WAIT":
        if (t >= WAIT_T) { this.phase = "PRESS"; this.t = 0; }
        break;
      case "PRESS":
        break; // waits for pressStart()
      case "CRAWL":
        break; // holds while RacerGame plays the crawlcard screen (beginLoad())
      case "LOAD":
        if (t >= LOAD_T && assetsReady) this.finished = true;
        break;
    }
  }

  // ---- Drawing ---------------------------------------------------------------
  _drawBig(rd, L, fonts, str, x, y, scaleX = 1, color = null) {
    if (L.hasFonts) {
      if (scaleX === 1) drawBigText(rd, fonts, str, Math.round(x), Math.round(y), L.h, color, 2);
      else drawBigTextX(rd, fonts, str, Math.round(x), Math.round(y), L.h, scaleX, color, 2);
    } else {
      const s = Math.max(1, Math.round(L.h / 5));
      drawText(rd, str, Math.round(x), Math.round(y), color === null ? rgba(255, 210, 70) : color, s);
    }
  }

  _drawBody(rd, L, fonts, str, y, size, color) {
    if (L.hasFonts) {
      const w = measureBodyText(fonts, str, size, 1);
      drawBodyText(rd, fonts, str, (SCREEN_W - w) >> 1, y, size, color, 1);
    } else {
      const s = Math.max(1, Math.round(size / 8));
      drawText(rd, str, (SCREEN_W - str.length * 5 * s) >> 1, y, color === null ? 0xffffffff : color, s);
    }
  }

  render(rd, fonts, frame, assetsReady) {
    const L = this._getLayout(fonts);
    const t = this.t;

    if (this.phase === "WARN") {
      // Background: WARNING.png fitted to the frame, falling back to the solid
      // orange card until the image is in. The safety text sits on top.
      if (this._warningPixels) {
        rd.buf32.set(this._warningPixels);
      } else {
        drawRect(rd, 0, 0, SCREEN_W, SCREEN_H, ORANGE);
      }
      // Warning text in the bigfont, auto-fit to the widest line.
      const lines = ["THIS IS A GAME,", "NOT REAL LIFE,", "DO NOT TRY THIS", "AT HOME."];
      let wh = 18;
      if (L.hasFonts) {
        let maxW = 0;
        for (const line of lines) maxW = Math.max(maxW, measureBigText(fonts, line, wh, 2));
        if (maxW > SCREEN_W - 16) wh = Math.max(10, (wh * (SCREEN_W - 16)) / maxW | 0);
      }
      const lineStep = wh + 6;
      let y = (SCREEN_H - lines.length * lineStep + 6) >> 1;
      for (const line of lines) {
        if (L.hasFonts) {
          const w = measureBigText(fonts, line, wh, 2);
          drawBigText(rd, fonts, line, (SCREEN_W - w) >> 1, y, wh, BLACK, 2);
        } else {
          const s = Math.max(1, Math.round(wh / 5));
          drawText(rd, line, (SCREEN_W - line.length * 5 * s) >> 1, y, BLACK, s);
        }
        y += lineStep;
      }
      return;
    }

    // Every later phase sits on black.
    drawRect(rd, 0, 0, SCREEN_W, SCREEN_H, BLACK);

    if (this.phase === "SWOOP") {
      // Squashed AP3X swoops from off-screen top-left, stretching as it goes.
      // The blink is synced to the arc: the word rides the whole swoop, blinks
      // out at the end of the arc, and reappears at the top when the motion
      // restarts. The final pass stays lit so the title lands in place.
      const raw = Math.min(1, (t % SWOOP_T) / (SWOOP_T - 1));
      const p = easeOut(raw);
      const lastPass = (t / SWOOP_T) | 0;
      const visible = lastPass >= SWOOPS - 1 || raw < 0.8;
      const scaleX = SQUASH0 + (1 - SQUASH0) * p;
      const x0 = -L.apxW * SQUASH0 - 20, y0 = -L.h;         // off-screen top-left
      const x = x0 + (L.apxX - x0) * p;
      const y = y0 + (L.apxY - y0) * p;
      if (visible) this._drawBig(rd, L, fonts, "AP3X", x, y, scaleX);
      return;
    }

    // SLIDE / WAIT / PRESS / CRAWL / LOAD all show AP3X locked in place.
    if (this.phase !== "LOAD") this._drawBig(rd, L, fonts, "AP3X", L.apxX, L.apxY);

    if (this.phase === "SLIDE") {
      const p = easeOut(Math.min(1, t / (SLIDE_T - 1)));
      const x0 = SCREEN_W + 12;
      const x = x0 + (L.theoX - x0) * p;
      // Motion-blur trail: velocity-driven, collapsing as the word settles.
      const vel = 1 - p; // ~speed proxy (easeOut derivative falls linearly)
      if (vel > 0.02) {
        // Smear pass — a horizontally stretched ghost anchored at the word's
        // left edge, streaking back toward the travel direction (right).
        if (L.hasFonts) {
          drawBigTextX(rd, fonts, "THE0RY", Math.round(x), L.theoY, L.h, 1 + vel * 0.8, GHOSTS[0], 2);
        }
        // Shifted after-images — SAME size as the text, offset rightward,
        // brightest nearest the word.
        const shift = vel * 46 + 3;
        for (let k = 0; k < GHOSTS.length; k++) {
          this._drawBig(rd, L, fonts, "THE0RY", x + shift * (GHOSTS.length - k), L.theoY, 1, GHOSTS[k]);
        }
      }
      this._drawBig(rd, L, fonts, "THE0RY", x, L.theoY);
      return;
    }

    if (this.phase === "WAIT" || this.phase === "PRESS" || this.phase === "CRAWL") {
      this._drawBig(rd, L, fonts, "THE0RY", L.theoX, L.theoY);
      if (this.phase === "PRESS" && (frame & 32)) {
        this._drawBody(rd, L, fonts, "PRESS START", L.theoY + L.h + 26, 18, null);
      }
      return;
    }

// LOAD — orange progress bar (holds near-full until assets are in).
    if (this.phase === "LOAD") {
      const raw = Math.min(1, t / LOAD_T);
      const p = assetsReady ? raw : Math.min(raw, 0.92);
      drawLoadingBar(rd, fonts, p);
    }
  }
}
