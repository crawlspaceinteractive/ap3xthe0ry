/**
 * racer/racerhud.js — HUD overlay: speed, drift charge meter, boost flash,
 * respawn/title/pause screens. Draws straight into the framebuffer after
 * the 3D pass (no depth).
 *
 * v0.2: reworked for the 640×480 framebuffer — all layout doubles the old
 * 320×200 coordinates, and the bottom-right speed readout gains a procedural
 * analog gauge drawn behind the digital number. A mileage ticker sits at
 * center top.
 *
 * v0.3: speed/mileage numerals use the sprite fonts from
 * assets/2D/ui/fonts/numbers (speedometer for speed + mileage, position for
 * the placeholder place indicator at top-left). Fonts arrive via
 * racer/hudfont.js and are optional — bitmap text is the fallback.
 *
 * v0.4: re-tuned for the 320×240 internal framebuffer — every fixed pixel
 * size is halved so the 2× upscale in renderer.present() lands on the same
 * 640×480 output sizes as before (gauge R 28→56, speed digits 21→42, etc.).
 *
 * v0.5: track minimap (top-right, panel-less) — the closed spline overview drawn
 * from track.samples with a dot + heading nub for the driver (v.x/v.z/v.yaw) and a
 * gold start/finish tick at track.spawnIdx. Requires `track` as the last arg.
 *
 * v0.6: body text uses the smallfont glyph set and menu titles/headers use the
 * bigfont set (both via racer/hudfont.js) when the fonts are loaded; the 5x4
 * bitmap drawText remains the fallback for every screen.
 *
 * v0.7: 200% UI-text pass — title/pause/loading/alerts plus the speed and
 * position numerals all render at double size. Alerts render in the smallfont
 * (BOOST! in the boost tier color, FLIP!/RESPAWNING in red). The mileage
 * ticker keeps its original pre-v0.6 layout (only the MI letters swap to the
 * smallfont).
 *
 * v0.8: lap-time counter below the mileage ticker — the current lap counts up
 * and the fastest-lap line above turns red once a record exists. Time numerals
 * use the speedometer sprite font (same baked steel digits as speed/mileage);
 * the BEST letters and : . separators come from the smallfont.
 * Also: speedometer dial doubled to R 56 and rendered half-opaque
 * (GAUGE_ALPHA=128, via the renderer's new alpha-aware primitives), BOOST!
 * moved down 40px, and the drift meter padded to 4px off the bottom edge.
 */
import { drawText, drawRect, drawLine, drawThickLine, drawCircle, rgba } from "../engine/renderer.js";
import { SCREEN_W, SCREEN_H, sinDeg, cosDeg } from "../engine/luts.js";
import { tierCharges } from "./vehicle.js";
import { formatLapTime } from "./laptimer.js";
import {
  drawNumber, drawPlace, drawBigText, drawBodyText,
  measureBigText, measureBodyText,
} from "./hudfont.js";

const TIER_COLORS = [rgba(80, 165, 255), rgba(255, 150, 50), rgba(200, 90, 255)];
const ALERT_RED = rgba(255, 60, 60);
const BAR_X = 110, BAR_Y = 229, BAR_W = 100, BAR_H = 6;

// ---- Analog speedometer (bottom-right, behind the digital readout) ----------
const GAUGE_CX   = SCREEN_W - 60;
const GAUGE_CY   = SCREEN_H - 60;
const GAUGE_R    = 56;
const GAUGE_ALPHA = 128;    // half-opaque: the road shows through the dial
const GAUGE_SWEEP = 270;   // degrees of needle travel (3/4 circle)
const GAUGE_START = 135;   // degrees at 0 km/h (bottom-left)
const GAUGE_MAX   = 300;   // km/h at full deflection
const GAUGE_TICK_STEP = 25;

const GAUGE_FACE = rgba(14, 10, 26);
const GAUGE_RIM  = rgba(210, 215, 230);
const GAUGE_TICK = rgba(230, 230, 240);
const GAUGE_RED  = rgba(255, 90, 70);
const GAUGE_HUB  = rgba(60, 60, 80);
const GAUGE_NEEDLE = rgba(255, 210, 70);

function gaugePoint(frac, radius) {
  const rad = ((GAUGE_START + frac * GAUGE_SWEEP) * Math.PI) / 180;
  return {
    x: (GAUGE_CX + Math.cos(rad) * radius) | 0,
    y: (GAUGE_CY + Math.sin(rad) * radius) | 0,
  };
}

function drawSpeedo(rd, kmh) {
  // Rim + face (rim drawn first, face fills in on top) — blended so the dial
  // is half-opaque and the scene behind shows through.
  drawCircle(rd, GAUGE_CX, GAUGE_CY, GAUGE_R + 3, GAUGE_RIM, false, GAUGE_ALPHA);
  drawCircle(rd, GAUGE_CX, GAUGE_CY, GAUGE_R - 2, GAUGE_FACE, true, GAUGE_ALPHA);
  drawCircle(rd, GAUGE_CX, GAUGE_CY, GAUGE_R - 2, GAUGE_RIM, false, GAUGE_ALPHA);

  // Tick marks — major every 50 km/h, minor every 25; redline past 250
  for (let k = 0; k <= GAUGE_MAX; k += GAUGE_TICK_STEP) {
    const major = (k % 50) === 0;
    const r1 = GAUGE_R - (major ? 4 : 2);
    const r2 = GAUGE_R - (major ? 8 : 6);
    const col = k >= 250 ? GAUGE_RED : GAUGE_TICK;
    const a = gaugePoint(k / GAUGE_MAX, r1);
    const b = gaugePoint(k / GAUGE_MAX, r2);
    drawLine(rd, a.x, a.y, b.x, b.y, col, GAUGE_ALPHA);
  }

  // Needle — 3px thick along the deflection direction
  const frac = Math.max(0, Math.min(1, kmh / GAUGE_MAX));
  const tip = gaugePoint(frac, GAUGE_R - 8);
  const nx = tip.x - GAUGE_CX, ny = tip.y - GAUGE_CY;
  const len = Math.hypot(nx, ny) || 1;
  const ox = -ny / len, oy = nx / len;
  for (let off = -1; off <= 1; off++) {
    drawLine(rd, GAUGE_CX + ox * off, GAUGE_CY + oy * off, tip.x + ox * off, tip.y + oy * off, GAUGE_NEEDLE, GAUGE_ALPHA);
  }

  // Center hub
  drawCircle(rd, GAUGE_CX, GAUGE_CY, 2, GAUGE_HUB, true, GAUGE_ALPHA);
  drawCircle(rd, GAUGE_CX, GAUGE_CY, 2, GAUGE_RIM, false, GAUGE_ALPHA);
}

// ---- Mileage ticker (center top) ---------------------------------------------
const MILE_TARGET_H = 10;          // half native speedometer size (crisp 0.5×)
const MILE_GAP = 1;

function drawMileage(rd, v, fonts) {
  const km = (v.odometer || 0) / 1000;
  const str = km.toFixed(2).padStart(7, "0");
  const label = "MI";
  const hasBody = !!(fonts && fonts.body);

  const labelScale = 1;
  const labelW = label.length * 5 * labelScale;

  let numW, numH;
  if (fonts && fonts.speed) {
    const g0 = fonts.speed["0"];
    const digitW = g0 ? Math.max(1, Math.round((g0.width * MILE_TARGET_H) / g0.height)) : 8;
    numW = str.length * digitW + (str.length - 1) * MILE_GAP;
    numH = MILE_TARGET_H;
  } else {
    numW = str.length * 5 * labelScale;
    numH = 5 * labelScale;
  }

  const panelW = labelW + 6 + numW + 8;
  const panelH = numH + 4;
  const px = (SCREEN_W - panelW) >> 1;
  const py = 3;
  drawRect(rd, px, py, panelW, panelH, rgba(14, 10, 26));
  drawRect(rd, px, py, panelW, panelH, rgba(120, 200, 255), false);
  if (hasBody) drawBodyText(rd, fonts, label, px + 2, py + 3, 5, rgba(120, 200, 255), 0);
  else drawText(rd, label, px + 2, py + 3, rgba(120, 200, 255), labelScale);
  if (fonts && fonts.speed) {
    drawNumber(rd, fonts.speed, str, px + labelW + 5, py + 2, MILE_TARGET_H, MILE_GAP);
  } else {
    drawText(rd, str, px + panelW - numW - 2, py + 2, 0xffffffff, labelScale);
  }
}

// ---- Track minimap (top-right, no panel — just the spline + markers) ---------
const MM_MARGIN = 8;
const MM_SIZE = 84;
const MM_X = SCREEN_W - MM_MARGIN - MM_SIZE;
const MM_Y = MM_MARGIN;
const MM_RANGE = 140;               // half the world span mapped (track r ≤ ~126)
const MM_S = MM_SIZE / (MM_RANGE * 2);

function mapToMini(x, z) {
  return {
    mx: (MM_X + (x + MM_RANGE) * MM_S) | 0,
    my: (MM_Y + (z + MM_RANGE) * MM_S) | 0,
  };
}

function drawMinimap(rd, v, track) {
  // Track overview — drawn twice for the outlined look: a 6px steel base with a
  // 4px white spline on top (decimated — each sample ≈ 1-2 map px is plenty).
  const s = track.samples, n = track.count;
  const step = Math.max(1, (n / 120) | 0);
  const trace = (thick, col) => {
    let prev = mapToMini(s[0].x, s[0].z);
    for (let i = step; i <= n; i += step) {
      const cur = mapToMini(s[i % n].x, s[i % n].z);
      drawThickLine(rd, prev.mx, prev.my, cur.mx, cur.my, col, thick);
      prev = cur;
    }
  };
  trace(6, rgba(95, 120, 155));
  trace(4, rgba(255, 255, 255));

  // Start/finish tick
  const st = mapToMini(s[track.spawnIdx].x, s[track.spawnIdx].z);
  drawRect(rd, st.mx - 1, st.my - 1, 3, 3, rgba(255, 210, 70), true);

  // Driver dot + short heading nub pointing the way the car faces
  const p = mapToMini(v.x, v.z);
  const fx = sinDeg(v.yaw), fz = cosDeg(v.yaw);
  const tip = {
    mx: (p.mx + fx * MM_S * 8) | 0,
    my: (p.my + fz * MM_S * 8) | 0,
  };
  drawLine(rd, p.mx, p.my, tip.mx, tip.my, rgba(120, 240, 200));
  drawCircle(rd, p.mx, p.my, 3, rgba(120, 240, 200), true);
  drawCircle(rd, p.mx, p.my, 3, rgba(255, 255, 255), false);
}

// ---- Lap timer (directly below the mileage ticker) ---------------------------
// The fastest-lap line ("BEST m:ss.cc") renders white until a lap is completed,
// then the BEST letters and separators turn red for the standing record. Time
// numerals always use the speedometer sprite font — the same baked-steel digits
// as the speed and mileage readouts — while letters/punctuation use the
// smallfont (drawBodyText).
const LAP_BEST_SIZE = 6;
const LAP_TIME_SIZE = 8;
const LAP_GAP = 1;
const LAP_PY = 20;

// Composed lap-string renderer: digits are blitted with the speed sprite font
// (baked colors, no tint), letter/punct runs with the smallfont (tinted `color`).
// Mirrors measureLapString exactly, so a measured width can be re-used.
function drawLapString(rd, fonts, str, x, y, targetH, color) {
  let cx = x, i = 0;
  while (i < str.length) {
    const digit = str[i] >= "0" && str[i] <= "9";
    let j = i;
    while (j < str.length && (str[j] >= "0" && str[j] <= "9") === digit) j++;
    const part = str.slice(i, j);
    cx += digit
      ? drawNumber(rd, fonts.speed, part, cx, y, targetH, LAP_GAP)
      : drawBodyText(rd, fonts, part, cx, y, targetH, color, LAP_GAP);
    i = j;
  }
  return cx - x;
}

function measureLapString(fonts, str, targetH) {
  let total = 0, i = 0;
  while (i < str.length) {
    const digit = str[i] >= "0" && str[i] <= "9";
    let j = i;
    while (j < str.length && (str[j] >= "0" && str[j] <= "9") === digit) j++;
    const part = str.slice(i, j);
    if (digit) {
      let w = 0;
      for (let k = 0; k < part.length; k++) {
        const g = fonts.speed[part[k]];
        w += g ? Math.max(1, Math.round((g.width * targetH) / g.height)) : 0;
      }
      total += w + LAP_GAP * (part.length - 1);
    } else {
      total += measureBodyText(fonts, part, targetH, LAP_GAP);
    }
    i = j;
  }
  return total;
}

function drawLapTimer(rd, lt, fonts) {
  if (!lt) return;
  const composed = !!(fonts && fonts.speed && fonts.body);
  const bestStr = "BEST " + (lt.bestMs > 0 ? formatLapTime(lt.bestMs) : "--:--.--");
  const curStr = formatLapTime(lt.curMs);
  const bestColor = lt.bestMs > 0 ? ALERT_RED : 0xffffffff;

  // Once a best lap exists the WHOLE line — numbers included — renders red:
  // route it through the smallfont/body path (digits are merged into the body
  // map) so blitGlyph tints the numerals instead of blitting baked steel.
  const bestRed = lt.bestMs > 0;

  let bestW, curW, bestH, curH;
  if (composed) {
    bestW = bestRed
      ? measureBodyText(fonts, bestStr, LAP_BEST_SIZE, LAP_GAP)
      : measureLapString(fonts, bestStr, LAP_BEST_SIZE);
    curW = measureLapString(fonts, curStr, LAP_TIME_SIZE);
    bestH = LAP_BEST_SIZE;
    curH = LAP_TIME_SIZE;
  } else {
    const bs = Math.max(1, Math.round(LAP_BEST_SIZE / 5));
    const cs = Math.max(1, Math.round(LAP_TIME_SIZE / 5));
    bestW = bestStr.length * 5 * bs;
    curW = curStr.length * 5 * cs;
    bestH = 5 * bs;
    curH = 5 * cs;
  }

  const panelW = Math.max(bestW, curW) + 8;
  const panelH = 3 + bestH + 3 + curH + 3;
  const px = (SCREEN_W - panelW) >> 1;
  const py = LAP_PY;
  drawRect(rd, px, py, panelW, panelH, rgba(14, 10, 26));
  drawRect(rd, px, py, panelW, panelH, rgba(120, 200, 255), false);

  const bestX = px + ((panelW - bestW) >> 1);
  const curY = py + 3 + bestH + 3;
  const curX = px + ((panelW - curW) >> 1);
  if (composed) {
    if (bestRed) drawBodyText(rd, fonts, bestStr, bestX, py + 3, LAP_BEST_SIZE, bestColor, LAP_GAP);
    else drawLapString(rd, fonts, bestStr, bestX, py + 3, LAP_BEST_SIZE, bestColor);
    drawLapString(rd, fonts, curStr, curX, curY, LAP_TIME_SIZE, 0xffffffff);
  } else {
    drawText(rd, bestStr, bestX, py + 3, bestColor, Math.max(1, Math.round(LAP_BEST_SIZE / 5)));
    drawText(rd, curStr, curX, curY, 0xffffffff, Math.max(1, Math.round(LAP_TIME_SIZE / 5)));
  }
}

export function drawRacerHUD(rd, v, frame, fonts, place, track, lt) {
  // ---- Mileage ticker ---------------------------------------------------------
  drawMileage(rd, v, fonts);

  // ---- Lap timer (below the mileage ticker) ------------------------------------
  drawLapTimer(rd, lt, fonts);

  // ---- Position (placeholder — driven by a future race system) ----------------
  if (fonts && place) {
    const targetH = 82;            // native position-font size (2× of 41)
    drawPlace(rd, fonts, place, 8, 6, targetH);
  }

  // ---- Track minimap -----------------------------------------------------------
  if (track) drawMinimap(rd, v, track);

  // ---- Speed ------------------------------------------------------------------
  const kmh = Math.round(Math.abs(v.speedF) * 216);
  drawSpeedo(rd, kmh);                                       // analog behind
  if (fonts && fonts.speed) {
    const num = `${kmh}`;
    const g0 = fonts.speed["0"];
    const digitW = g0 ? Math.max(1, Math.round((g0.width * 42) / g0.height)) : 16;
    const numW = num.length * digitW;
    drawNumber(rd, fonts.speed, num, GAUGE_CX - (numW >> 1), GAUGE_CY - 16, 42);
    if (fonts.body) drawBodyText(rd, fonts, "KMH", GAUGE_CX - 16, 150, 12, 0xffb0b0c0, 1);
    else drawText(rd, "KMH", GAUGE_CX - 16, 150, 0xffb0b0c0, 2);
  } else {
    const numStr = `${kmh}`;
    const numW = numStr.length * 20;
    drawText(rd, numStr, GAUGE_CX - (numW >> 1), GAUGE_CY - 16, 0xffffffff, 4);
    drawText(rd, "KMH", GAUGE_CX - 16, 150, 0xffb0b0c0, 2);
  }

  // ---- Drift charge meter --------------------------------------------------------
  const tc = tierCharges();
  const maxCharge = tc[tc.length - 1];
  const pct = Math.min(1, v.charge / maxCharge);
  drawRect(rd, BAR_X - 1, BAR_Y - 1, BAR_W + 2, BAR_H + 2, rgba(20, 20, 30), true);
  if (pct > 0) {
    const col = v.tier >= 0 ? TIER_COLORS[v.tier] : rgba(120, 130, 150);
    drawRect(rd, BAR_X, BAR_Y, (BAR_W * pct) | 0, BAR_H, col, true);
  }
  // Tier tick marks
  for (const c of tc) {
    const tx = BAR_X + ((BAR_W * c) / maxCharge) | 0;
    drawRect(rd, tx, BAR_Y - 1, 1, BAR_H + 2, rgba(230, 230, 240), true);
  }
  if (v.drifting && v.tier >= 0) {
    if (fonts && fonts.body) drawBodyText(rd, fonts, "DRIFT", BAR_X + 34, BAR_Y - 14, 12, TIER_COLORS[v.tier], 1);
    else drawText(rd, "DRIFT", BAR_X + 34, BAR_Y - 14, TIER_COLORS[v.tier], 2);
  }

  // ---- Boost flash ------------------------------------------------------------
  if (v.boostT > 0 && (frame & 4)) {
    const col = TIER_COLORS[Math.min(2, v.boostTier)];
    if (fonts && fonts.body) {
      const w = measureBodyText(fonts, "BOOST!", 36, 2);
      drawBodyText(rd, fonts, "BOOST!", (SCREEN_W - w) >> 1, 80, 36, col, 2);
    } else {
      drawText(rd, "BOOST!", (SCREEN_W >> 1) - 42, 84, col, 2);
    }
  }

  // ---- Respawn ------------------------------------------------------------------
  if (v.respawnT > 0) {
    if (fonts && fonts.body) {
      const w = measureBodyText(fonts, "RESPAWNING", 30, 2);
      drawBodyText(rd, fonts, "RESPAWNING", (SCREEN_W - w) >> 1, 128, 30, ALERT_RED, 2);
    } else {
      drawText(rd, "RESPAWNING", (SCREEN_W >> 1) - 100, 128, ALERT_RED, 4);
    }
  }

  // ---- Flips counter ---------------------------------------------------------------
  if (!v.grounded && Math.abs(v.flipAccum) > 90) {
    if (fonts && fonts.body) {
      const w = measureBodyText(fonts, "FLIP!", 36, 2);
      drawBodyText(rd, fonts, "FLIP!", (SCREEN_W - w) >> 1, 84, 36, ALERT_RED, 2);
    } else {
      drawText(rd, "FLIP!", (SCREEN_W >> 1) - 24, 88, ALERT_RED, 2);
    }
  }
}

export function drawTitle(rd, frame, fonts) {
  drawRect(rd, 0, 0, SCREEN_W, SCREEN_H, 0x66000000 | 0, true);
  const useSprite = !!(fonts && fonts.big && fonts.body);
  if (useSprite) {
    // Fit the title/subtitle to the screen width (shrink targetH if needed).
    const TITLE = "AP3X THE0RY";
    let th = 68;
    let tw = measureBigText(fonts, TITLE, th, 2);
    if (tw > SCREEN_W - 8) { th = Math.max(16, (th * (SCREEN_W - 8) / tw) | 0); tw = measureBigText(fonts, TITLE, th, 2); }
    drawBigText(rd, fonts, TITLE, (SCREEN_W - tw) >> 1, 14 + ((68 - th) >> 1), th, null, 2);

    const sub = "PS1 Faithful ARCADE RACER";
    let sh = 22;
    let sw = measureBodyText(fonts, sub, sh, 1);
    if (sw > SCREEN_W - 8) { sh = Math.max(8, (sh * (SCREEN_W - 8) / sw) | 0); sw = measureBodyText(fonts, sub, sh, 1); }
    drawBodyText(rd, fonts, sub, (SCREEN_W - sw) >> 1, 86 + ((22 - sh) >> 1), sh, null, 1);

    if (frame & 32) {
      const p = "PRESS ENTER / A TO RACE";
      const pw = measureBodyText(fonts, p, 16, 1);
      drawBodyText(rd, fonts, p, (SCREEN_W - pw) >> 1, 112, 16, null, 1);
    }

    const lines = [
      "WASD: DRIVE",
      "SHIFT: DRIFT",
      "S: BRAKE  R: REARVIEW",
      "T: RESET",
      "HOLD DRIFT + STEER,",
      "RELEASE TO BOOST",
    ];
    let y = 132;
    for (const t of lines) {
      const w = measureBodyText(fonts, t, 16, 1);
      drawBodyText(rd, fonts, t, (SCREEN_W - w) >> 1, y, 16, null, 1);
      y += 17;
    }
  } else {
    drawText(rd, "AP3X THE0RY", (SCREEN_W >> 1) - 120, 26, rgba(255, 210, 70), 6);
    drawText(rd, "PS1 Faithful ARCADE RACER", (SCREEN_W >> 1) - 75, 84, 0xffc0c0d0, 2);

    if (frame & 32) {
      drawText(rd, "PRESS ENTER / A TO RACE", (SCREEN_W >> 1) - 100, 108, 0xffffffff, 2);
    }
    const lines = [
      "WASD: DRIVE",
      "SHIFT: DRIFT",
      "S: BRAKE  R: REARVIEW",
      "T: RESET",
      "HOLD DRIFT + STEER,",
      "RELEASE TO BOOST",
    ];
    let y = 128;
    for (const t of lines) {
      const w = t.length * 10;
      drawText(rd, t, (SCREEN_W - w) >> 1, y, 0xff90a0b0, 2);
      y += 16;
    }
  }
}

export function drawPause(rd, pauseRow, sfxVol, musicVol, fonts) {
  const W = 280, H = 190;
  const px = (SCREEN_W - W) >> 1;
  const py = (SCREEN_H - H) >> 1;

  const PANEL  = rgba(20, 14, 36);
  const ACCENT = rgba(255, 110, 180);
  const WHITE  = rgba(255, 255, 255);
  const DIM    = rgba(140, 120, 160);
  const SEL    = rgba(120, 240, 200);
  const SLIDER_BG  = rgba(50, 40, 70);
  const SLIDER_FILL = rgba(100, 220, 180);
  const SLIDER_DIM  = rgba(60, 150, 120);

  drawRect(rd, px, py, W, H, PANEL);
  drawRect(rd, px, py, W, H, ACCENT, false);

  const useSprite = !!(fonts && fonts.big && fonts.body);
  const TITLE = "PAUSED";
  if (useSprite) {
    const tw = measureBigText(fonts, TITLE, 26, 2);
    drawBigText(rd, fonts, TITLE, px + ((W - tw) >> 1), py + 3, 26, ACCENT, 2);
  } else {
    const titleW = TITLE.length * 10;
    drawText(rd, TITLE, px + ((W - titleW) >> 1), py + 5, ACCENT, 2);
  }

  const items = [
    { label: "RESUME" },
    { label: "SFX VOL",  val: sfxVol  },
    { label: "MUSIC VOL", val: musicVol },
  ];

  const SX = px + 12;
  const SW = 180;
  let ry = py + 38;
  for (let i = 0; i < items.length; i++) {
    const s = i === pauseRow;
    const lc = s ? SEL : WHITE;
    if (s) drawText(rd, ">", px + 3, ry, SEL, 2);
    if (useSprite) drawBodyText(rd, fonts, items[i].label, px + 10, ry, 16, s ? lc : DIM, 1);
    else drawText(rd, items[i].label, px + 10, ry, s ? lc : DIM, 2);

    if (items[i].val !== undefined) {
      const sy = ry + 17;
      const sh = 8;
      drawRect(rd, SX, sy, SW, sh, SLIDER_BG);
      const fillW = Math.max(2, Math.round(items[i].val * SW));
      drawRect(rd, SX, sy, fillW, sh, s ? SLIDER_FILL : SLIDER_DIM);
      drawRect(rd, SX, sy, SW, sh, s ? SEL : DIM, false);
      const pct = Math.round(items[i].val * 100);
      const pctStr = String(pct).padStart(3, " ") + "%";
      if (useSprite) drawBodyText(rd, fonts, pctStr, SX + SW + 4, sy, 14, s ? SEL : DIM, 0);
      else drawText(rd, pctStr, SX + SW + 4, sy, s ? SEL : DIM, 2);
      ry += 40;
    } else {
      ry += 40;
    }
  }

  const hint = "W/S:SEL  A/D:ADJ  SPC:BACK";
  if (useSprite) {
    const hw = measureBodyText(fonts, hint, 12, 1);
    drawBodyText(rd, fonts, hint, px + ((W - hw) >> 1), py + H - 15, 12, DIM, 1);
  } else {
    const hw = hint.length * 10;
    drawText(rd, hint, px + ((W - hw) >> 1), py + H - 15, DIM, 2);
  }
}

export function drawLoading(rd, frame, fonts) {
  const dots = ".".repeat(1 + ((frame >> 4) % 3));
  const str = "LOADING" + dots;
  if (fonts && fonts.body) {
    const w = measureBodyText(fonts, str, 22, 1);
    drawBodyText(rd, fonts, str, (SCREEN_W - w) >> 1, 84, 22, null, 1);
  } else {
    drawText(rd, str, (SCREEN_W >> 1) - 60, 88, 0xffffffff, 2);
  }
}
