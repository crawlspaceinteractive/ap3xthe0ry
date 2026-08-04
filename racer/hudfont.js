// racer/hudfont.js — Sprite fonts for HUD numerals.
// Loads the digit PNGs under assets/2D/ui/fonts/numbers/{speedometer,position}/,
// the big title letters under assets/2D/ui/fonts/bigfont/, and the body glyphs
// under assets/2D/ui/fonts/smallfont/, then blits them into the software
// framebuffer (HUD-space: no depth, no fog) with nearest-neighbour scaling +
// alpha cutout. Text can be drawn in the glyph's baked colors (color = null) or
// repainted flat with an ABGR color.
import { loadTexture } from "../engine/textureloader.js";
import { drawSpriteFit } from "../engine/spritesheet.js";
import { drawText } from "../engine/renderer.js";
import { SCREEN_W, SCREEN_H } from "../engine/luts.js";

const SPEED_DIR = "assets/2D/ui/fonts/numbers/speedometer/";
const POS_DIR   = "assets/2D/ui/fonts/numbers/position/";
const BIG_DIR   = "assets/2D/ui/fonts/bigfont/";
const BODY_DIR  = "assets/2D/ui/fonts/smallfont/";
const DIGITS = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];
const SUFFIXES = ["1st", "2nd", "3rd"];
const UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const LOWER = "abcdefghijklmnopqrstuvwxyz";
const PUNCT = ["!", '"', "'", ")", "+", ",", "-", ".", ":", ";", "?", "{"];
const BIG_CHARS = UPPER.split("");
const BODY_CHARS = [...UPPER.split(""), ...LOWER.split(""), ...PUNCT];
const SPACE_RATIO = 0.5;
// Smallfont glyph filenames are the char + ".png", except the period which
// lives as "period.png" (a bare ".png" filename is a hidden dotfile and keeps
// getting skipped by tooling/servers).
const BODY_FILES = { ".": "period" , 
                        ",": "comma" ,
                        ";": "semicolon" ,
                        ":": "colon" , 
                        "!": "exclamation" , 
                        "?": "question" ,
                        "+": "plus" ,
                        "-": "dash" ,
                        "'": "tick" };
const bodyGlyphFile = ch => `${BODY_DIR}${BODY_FILES[ch] || ch}.png`;

// Wraps a loaded sprite with per-glyph advance metrics (content width), so text
// tracks tight to the visible stroke instead of the full cell width.
function withMetrics(tex) {
  if (!tex || !tex.data) return null;
  let minX = tex.width, maxX = -1;
  const { data, width } = tex;
  for (let y = 0; y < tex.height; y++) {
    const row = y * width * 4;
    for (let x = 0; x < width; x++) {
      if (data[row + x * 4 + 3] > 128) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
      }
    }
  }
  if (maxX < minX) { minX = 0; maxX = width - 1; }
  return { s: tex, minX, adv: maxX - minX + 1 };
}

// Loads the bigfont title letters (A-Z, per-file PNGs) and the smallfont body
// glyphs (uppercase + lowercase + punctuation, split per-character PNGs).
// Returns { big, body } maps keyed by character, values are metric-wrapped
// sprites. Digits are NOT part of the smallfont set — loadHudFonts merges the
// speedometer digits into `body` afterwards.
export async function loadBodyFonts() {
  const files = [
    ...BIG_CHARS.map(ch => `${BIG_DIR}${ch}.png`),
    ...BODY_CHARS.map(ch => bodyGlyphFile(ch)),
  ];
  const texs = await Promise.all(files.map(f => loadTexture(f)));
  const big = {}, body = {};
  for (let i = 0; i < BIG_CHARS.length; i++) {
    const g = withMetrics(texs[i]);
    if (g) big[BIG_CHARS[i]] = g;
    else console.warn("[hudfont] bigfont glyph missing:", BIG_CHARS[i]);
  }
  for (let i = 0; i < BODY_CHARS.length; i++) {
    const g = withMetrics(texs[BIG_CHARS.length + i]);
    if (g) body[BODY_CHARS[i]] = g;
    else console.warn("[hudfont] smallfont glyph missing:", BODY_CHARS[i]);
  }
  return { big, body };
}

// Loads speedometer digits (0-9), position digits (0-9), the 1st/2nd/3rd
// ordinal sprites, plus the big/body font maps (bigfont + smallfont). The
// speedometer digits are merged into `body` so body text can render digits.
// Returns { speed, pos, suffix, big, body }; maps hold metric-wrapped sprites.
export async function loadHudFonts() {
  const files = [
    ...DIGITS.map(n => `${SPEED_DIR}${n}.png`),
    ...DIGITS.map(n => `${POS_DIR}${n}.png`),
    ...SUFFIXES.map(n => `${POS_DIR}${n}.png`),
  ];
  const [texs, bodyFonts] = await Promise.all([
    Promise.all(files.map(f => loadTexture(f))),
    loadBodyFonts(),
  ]);
  const speed = {}, pos = {}, suffix = {};
  for (let i = 0; i < DIGITS.length; i++) {
    speed[DIGITS[i]] = texs[i];
    pos[DIGITS[i]] = texs[i + DIGITS.length];
  }
  for (let i = 0; i < SUFFIXES.length; i++) {
    suffix[SUFFIXES[i]] = texs[i + DIGITS.length * 2];
  }
  for (const d of DIGITS) {
    if (speed[d]) bodyFonts.body[d] = { s: speed[d], minX: 0, adv: speed[d].width };
  }
  return { speed, pos, suffix, big: bodyFonts.big, body: bodyFonts.body };
}

// Scaled glyph width (same formula drawSpriteFit uses internally).
function glyphWidth(sprite, targetH) {
  if (!sprite) return 0;
  return Math.max(1, Math.round((sprite.width * targetH) / sprite.height));
}

// Draws a string of glyphs left-to-right (gap px between glyphs) and returns
// the total width drawn. Used for the speedometer digits.
export function drawNumber(rd, glyphs, str, x, y, targetH, gap = 0) {
  if (!glyphs || !str) return 0;
  const widths = [];
  let total = 0;
  for (const ch of str) {
    const w = glyphWidth(glyphs[ch], targetH);
    widths.push(w);
    total += w;
  }
  total += gap * (widths.length - 1);
  let cx = x;
  for (let i = 0; i < str.length; i++) {
    drawSpriteFit(rd, glyphs[str[i]], cx, y, targetH);
    cx += widths[i] + gap;
  }
  return total;
}

// Draws a race position (place): for 1st/2nd/3rd the combined ordinal sprite
// is used; other places fall back to plain digit sprites (no "th" art yet).
// Returns the width drawn.
export function drawPlace(rd, fonts, place, x, y, targetH, gap = 2) {
  if (!fonts || !fonts.pos) return 0;
  let glyphs = [];
  const sfx = fonts.suffix[`${place}${ordinalSuffix(place)}`];
  if (sfx) {
    glyphs = [sfx];
  } else {
    for (const ch of String(place)) {
      const g = fonts.pos[ch];
      if (g) glyphs.push(g);
    }
  }
  if (!glyphs.length) return 0;

  const widths = glyphs.map(g => glyphWidth(g, targetH));
  const total = widths.reduce((a, b) => a + b, 0) + gap * (glyphs.length - 1);
  let cx = x;
  for (let i = 0; i < glyphs.length; i++) {
    drawSpriteFit(rd, glyphs[i], cx, y, targetH);
    cx += widths[i] + gap;
  }
  return total;
}

function ordinalSuffix(n) {
  const t = n % 100;
  if (t >= 11 && t <= 13) return "th";
  switch (n % 10) {
    case 1: return "st";
    case 2: return "nd";
    case 3: return "rd";
    default: return "th";
  }
}

// ---- Glyph-string rendering (bigfont + smallfont maps) ----------------------
// Glyph map entries are { s, minX, adv } (see withMetrics). A glyph is blitted
// full-cell at (dx - minX * scale) so its content starts exactly at dx and the
// advance (content width) drives spacing — tight, consistent baselines.
function blitGlyph(rd, g, dx, dy, targetH, color) {
  const s = g.s;
  if (!s || !s.data) return;
  const scale = targetH / s.height;
  const targetW = Math.max(1, Math.round(s.width * scale));
  const { buf32 } = rd;
  const { data, width, height } = s;
  const x0 = Math.round(dx);
  const tint = color === null || color === undefined ? -1 : color;
  for (let y = 0; y < targetH; y++) {
    const py = dy + y;
    if (py < 0 || py >= SCREEN_H) continue;
    const sy = Math.min(height - 1, (y / scale) | 0);
    for (let x = 0; x < targetW; x++) {
      const px = x0 + x;
      if (px < 0 || px >= SCREEN_W) continue;
      const sx = Math.min(width - 1, (x / scale) | 0);
      const si = (sy * width + sx) * 4;
      if (data[si + 3] < 128) continue;
      buf32[py * SCREEN_W + px] = tint === -1
        ? ((255 << 24) | (data[si + 2] << 16) | (data[si + 1] << 8) | data[si])
        : tint;
    }
  }
}

function fallbackScale(targetH) {
  return Math.max(1, Math.round(targetH / 5));
}

// Draws a string using a glyph map. Missing glyphs fall back to the built-in
// bitmap font (5*scale px wide, scale = round(targetH/5)); spaces and unknown
// glyphs use a fixed space width. `alt` is a secondary map consulted before the
// bitmap fallback (used to route missing bigfont letters to the smallfont).
// color = null keeps the glyphs' baked colors; otherwise text is repainted flat
// with that ABGR color. Returns the total width drawn.
export function drawGlyphText(rd, glyphs, str, x, y, targetH, color = null, gap = 1, alt = null) {
  if (!glyphs) return 0;
  const fb = fallbackScale(targetH);
  let cx = x;
  let n = 0;
  for (const ch of String(str)) {
    const g = glyphs[ch] || (alt && alt[ch]);
    if (g) {
      blitGlyph(rd, g, cx - g.minX * (targetH / g.s.height), y, targetH, color);
      cx += g.adv * (targetH / g.s.height) + gap;
    } else if (ch === " ") {
      cx += Math.round(targetH * SPACE_RATIO) + gap;
    } else {
      drawText(rd, ch, Math.round(cx), y, color === null ? 0xffffffff : color, fb);
      cx += 5 * fb + gap;
    }
    n++;
  }
  return Math.max(0, cx - x - (n ? gap : 0));
}

// Width of a glyph-map string using the same advance rules as drawGlyphText.
export function measureGlyphs(glyphs, str, targetH, gap = 1, alt = null) {
  if (!glyphs || !str) return 0;
  const fb = fallbackScale(targetH);
  let cx = 0;
  for (const ch of String(str)) {
    const g = glyphs[ch] || (alt && alt[ch]);
    if (g) cx += g.adv * (targetH / g.s.height) + gap;
    else cx += (ch === " " ? Math.round(targetH * SPACE_RATIO) : 5 * fb) + gap;
  }
  return Math.max(0, cx - (str.length ? gap : 0));
}

// Bigfont (menu titles/headers). Text is uppercased; missing letters fall back
// to the smallfont glyph (alt map) before the bitmap font. Returns width.
export function drawBigText(rd, fonts, str, x, y, targetH, color = null, gap = 2) {
  if (!fonts || !fonts.big) return 0;
  return drawGlyphText(rd, fonts.big, String(str).toUpperCase(), x, y, targetH, color, gap, fonts.body);
}

export function measureBigText(fonts, str, targetH, gap = 2) {
  if (!fonts || !fonts.big) return 0;
  return measureGlyphs(fonts.big, String(str).toUpperCase(), targetH, gap, fonts.body);
}

// Body font (smallfont letters/punct + speedometer digits). Returns width.
export function drawBodyText(rd, fonts, str, x, y, targetH, color = null, gap = 1) {
  if (!fonts || !fonts.body) return 0;
  return drawGlyphText(rd, fonts.body, str, x, y, targetH, color, gap);
}

export function measureBodyText(fonts, str, targetH, gap = 1) {
  if (!fonts || !fonts.body) return 0;
  return measureGlyphs(fonts.body, str, targetH, gap);
}
