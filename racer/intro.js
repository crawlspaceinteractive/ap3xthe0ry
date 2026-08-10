/**
 * racer/intro.js — Cold open: dev + platform cinematic that plays BEFORE the
 * boot warning screen.
 *
 * Flow: cinematic reel (dev logo smash → BUILT WITH ★ STAR → team logo card)
 * → reveal game menu underneath.
 *
 * The reel is an array of cinematics (`CINEMATICS`). Each receives a shared
 * { stage, audio, sleep, fadeOut, shake, mkImg } context and runs full-screen
 * on `stage`.
 *
 * NOT SKIPPABLE by design: the reel runs start to finish on a fixed clock so
 * the racer's assets (car GLB, textures, fonts, sky, sfx) can actually load
 * underneath (see `racer/racergame.js` warmup + main.js boot order) before the
 * reveal hands eye-over to the game.
 *
 * Assets:
 *   LIGHTRAY  the headlight beam sprite (assets/2D/sprites/fx/lightray.png)
 *   DEVLOGO   studio/dev logo (assets/2D/ui/intro/devLOGO.png)
 *   STARLOGO  platform logo (assets/2D/ui/intro/StarLogoWithTransparentBg512x512.png)
 *   TEAMLOGO  team/studio logo card, plays right after the platform beat
 *             (assets/2D/ui/intro/TeamLogo.png)
 *   BIGFONT   in-game title letters (assets/2D/ui/fonts/bigfont/A_.png…Z_.png);
 *             the "BUILT WITH" / "STAR" words are rendered from these sprites
 *             with the same advance metrics as racer/hudfont.js drawBigText.
 */
import { assetUrl } from "../engine/asseturls.js";

const LIGHTRAY_URL = assetUrl("assets/2D/sprites/fx/lightray.png");
const DEVLOGO_URL  = assetUrl("assets/2D/ui/intro/devLOGO.png");
const STARLOGO_URL = assetUrl("assets/2D/ui/intro/StarLogoWithTransparentBg512x512.png");
const TEAMLOGO_URL = assetUrl("assets/2D/ui/intro/TeamLogo.png");

// The crash impact buffer (same def racerSound preloads). Preloaded here too
// (idempotent — sdk-audio caches by id) so the intro can AWAIT its readiness
// instead of guessing a timed delay. This matters: the bigfont glyph fetches
// compete with the mp3 for browser connection slots, so a fixed sleep can miss.
const CRASH_URL = assetUrl("assets/audio/sounds/sfx_crash.mp3");

// Bigfont title letters (A-Z, per-file PNGs) — the same sprites the game's
// headers use (racer/hudfont.js loadBodyFonts). Each is a 32x64 cell with the
// glyph offset inside; we measure each glyph's content box (minX/adv, same
// rule as hudfont withMetrics) and blit them at that advance so the word
// tracks tight like the in-game titles.
const BIG_DIR = "assets/2D/ui/fonts/bigfont/";
const BIG_SPACE_RATIO = 0.5; // space = half the letter height (hudfont SPACE_RATIO)
const BIG_GAP = 2;           // gap between glyphs (hudfont drawBigText default)

async function loadBigGlyph(ch) {
  const src = assetUrl(`${BIG_DIR}${ch}_.png`);
  try {
    const im = new Image();
    im.crossOrigin = "anonymous"; // allows getImageData on the external CDN without tainting the canvas
    im.src = src;
    await im.decode();
    const c = document.createElement("canvas");
    c.width = im.width;
    c.height = im.height;
    const g = c.getContext("2d", { willReadFrequently: true });
    g.drawImage(im, 0, 0);
    const { data, width, height } = g.getImageData(0, 0, c.width, c.height);
    let minX = width, maxX = -1;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (data[(y * width + x) * 4 + 3] > 128) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
        }
      }
    }
    if (maxX < minX) { minX = 0; maxX = width - 1; }
    return { im, width, height, minX, adv: maxX - minX + 1 };
  } catch (err) {
    console.warn("[intro] bigfont glyph failed:", ch, err);
    return null;
  }
}

const bigGlyphCache = {};
async function getBigGlyph(ch) {
  if (!bigGlyphCache[ch]) bigGlyphCache[ch] = loadBigGlyph(ch);
  return bigGlyphCache[ch];
}

// Renders text with the in-game big font into a canvas (nearest-neighbour,
// glyphs advanced by their measured content width + 2px gap, same as
// drawBigText). Returns the canvas.
async function bigWordCanvas(text, targetH) {
  const chars = String(text).toUpperCase().split("");
  const gs = [];
  for (const ch of chars) {
    gs.push(ch === " " ? null : getBigGlyph(ch));
  }
  const glyphs = await Promise.all(gs);
  const scale = targetH / 64; // bigfont cells are 32x64
  const widths = [];
  let total = 0;
  for (const g of glyphs) {
    if (g) {
      const a = g.adv * scale;
      widths.push(a);
      total += a;
    } else {
      widths.push(null);
      // space or a missing glyph — pad with a half-letter gap
      total += Math.round(targetH * BIG_SPACE_RATIO);
    }
  }
  total += BIG_GAP * Math.max(0, glyphs.length - 1);
  const cv = document.createElement("canvas");
  cv.width = Math.max(1, Math.ceil(total));
  cv.height = Math.max(1, Math.ceil(targetH));
  const ctx = cv.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  let cx = 0;
  for (let i = 0; i < glyphs.length; i++) {
    const g = glyphs[i];
    if (g) {
      ctx.drawImage(g.im, Math.round(cx - g.minX * scale), 0,
        Math.ceil(g.width * scale), Math.ceil(targetH));
    }
    cx += widths[i] + BIG_GAP;
  }
  return cv;
}

async function bigWordImg(text, targetH) {
  const cv = await bigWordCanvas(text, targetH);
  const im = new Image();
  im.src = cv.toDataURL();
  return im;
}

export function runIntro({ root, audio, onReveal }) {
  // ---------- overlay + stage ----------
  const overlay = document.createElement('div');
  overlay.id = 'intro-overlay';
  overlay.style.cssText = 'position:absolute;inset:0;z-index:40;background:#000;overflow:hidden;';
  const style = document.createElement('style');
  style.textContent = '@keyframes introPulse{0%,100%{opacity:.25}50%{opacity:1}}';
  overlay.appendChild(style);
  const stage = document.createElement('div');
  stage.style.cssText = 'position:absolute;inset:0;';
  overlay.appendChild(stage);
  root.appendChild(overlay);

  // INVISIBLE AUDIO UNLOCK. Browsers suspend the AudioContext until the first
  // user gesture (autoplay policy). The reel here is intentionally NOT
  // skippable, so the crash impact would fire during the reel while the context
  // is still suspended — its sound is then queued inaudibly and surfaces much
  // later (the title screen / loading bar) the moment the player first presses
  // a key. That is the "plays way too late / in titleintro" bug.
  //
  // This traps the first gesture (key / mouse / touch) and resumes the context
  // so sounds actually sound WHEN they fire. `firstUnlock` resolves after that
  // gesture, and the reel AWAITS it (with a cap so it can never hang) before
  // the dev punch — restoring the "press to begin" audio guarantee the old
  // splash provided, without showing any UI or making the reel skippable.
  let unlocked = false;
  let firstUnlock = null;
  firstUnlock = new Promise(res => {
    const doUnlock = () => {
      if (unlocked) return;
      unlocked = true;
      audio.unlock();
      window.removeEventListener("keydown", doUnlock);
      window.removeEventListener("pointerdown", doUnlock);
      window.removeEventListener("touchstart", doUnlock);
      window.removeEventListener("mousedown", doUnlock);
      res(true);
    };
    window.addEventListener("keydown", doUnlock);
    window.addEventListener("pointerdown", doUnlock);
    window.addEventListener("touchstart", doUnlock);
    window.addEventListener("mousedown", doUnlock);
  });

  // warm the cinematic art cache (no loading bar — by design)
  for (const u of [LIGHTRAY_URL, DEVLOGO_URL, STARLOGO_URL, TEAMLOGO_URL]) { const im = new Image(); im.src = u; }

  // Kick the crash preload (idempotent with racerSound's warmup preload, same
  // id) and hold its promise so the impact below can await true readiness.
  const crashReady = audio.preload({ crash: { src: CRASH_URL, group: "sfx" } })
    .catch(err => { console.warn("[intro] crash preload failed:", err); });
  // prewarm the bigfont letters the reel uses ("BUILT WITH", "STAR")
  const WARM_WORD = "BUILT WITHSTAR";
  for (const ch of WARM_WORD) {
    if (ch === " " || bigGlyphCache[ch]) continue;
    getBigGlyph(ch);
  }

  // ---------- helpers ----------
  // rAF sleep; sleep(0) = exactly one frame. Never fast-forwarded.
  const sleep = ms => new Promise(res => {
    const t0 = performance.now();
    const tick = () => (performance.now() - t0 >= ms) ? res() : requestAnimationFrame(tick);
    requestAnimationFrame(tick);
  });

  const mkImg = (src, css) => {
    const im = new Image();
    im.src = src;
    im.draggable = false;
    im.style.cssText = css;
    return im;
  };

  async function fadeOut(el, ms) {
    el.style.transition = `opacity ${ms}ms ease`;
    el.style.opacity = '0';
    await sleep(ms + 60);
    el.style.transition = '';
  }

  function resetStage() {
    stage.innerHTML = '';
    stage.style.transition = '';
    stage.style.opacity = '1';
    stage.style.transform = '';
  }

  // decaying random screen shake on the whole stage
  async function shake(dur, mag) {
    const t0 = performance.now();
    while (true) {
      const k = (performance.now() - t0) / dur;
      if (k >= 1) break;
      const d = mag * (1 - k);
      stage.style.transform = `translate(${(Math.random() * 2 - 1) * d}px,${(Math.random() * 2 - 1) * d}px)`;
      await sleep(0);
    }
    stage.style.transform = '';
  }

  const ctx = { stage, audio, sleep, fadeOut, shake, mkImg, firstUnlock };

  // ---------- cinematic 1: DEV — lightray flicker, logo punches the screen ----------
  async function devCinematic({ stage, audio, sleep, fadeOut, shake, mkImg, firstUnlock }) {
    // Invisible audio-unlock hold: browsers keep the AudioContext suspended
    // until the FIRST user gesture. The crash must fire on top of a RUNNING
    // context or it's queued inaudibly and surfaces later (title screen).
    // Wait for that gesture (capped so a passive viewer can't hang the reel).
    await Promise.race([firstUnlock, sleep(3500)]);
    // A beat of black first: also covers the crash-sfx fetch (warmup kicked it
    // at boot). `crashReady` below then guarantees the buffer is decoded when
    // the punch lands.
    await sleep(1000);
    // The light is an overlay, so it continues to flicker across the punched-in logo.
    const ray = mkImg(LIGHTRAY_URL, 'position:absolute;inset:0;width:100%;height:100%;object-fit:contain;opacity:0;z-index:2;pointer-events:none');
    stage.appendChild(ray);
    // flicker a few times over ~1s (alternating on/off, irregular like a failing arc lamp)
    const pattern = [90, 70, 60, 110, 50, 80, 120, 100, 140, 90];
    for (let i = 0; i < pattern.length; i++) {
      ray.style.opacity = i % 2 === 0 ? String(0.45 + Math.random() * 0.55) : '0';
      await sleep(pattern[i]);
    }
    ray.style.opacity = '0.85';
    // logo punch: slams from way out of scale into the middle of the screen
    const logo = mkImg(DEVLOGO_URL, 'position:absolute;left:50%;top:50%;width:min(64vmin,520px);transform:translate(-50%,-50%) scale(6);opacity:0;z-index:1;pointer-events:none');
    stage.appendChild(logo);
    // GATE the punch on the crash buffer being decoded. warmup() kicked the
    // fetch at boot, so this usually resolves inside the 1s black beat — but
    // the bigfont glyph fetches queue in the same connection pool, so a fixed
    // delay can still miss. Waiting here guarantees audio.play('crash') below
    // lands exactly on the logo impact. The logo is invisible until then
    // (opacity 0, scale 6) so a late buffer just holds on the light.
    await crashReady;
    const t0 = performance.now(), D = 140;
    while (true) {
      const k = Math.min(1, (performance.now() - t0) / D);
      const e = k * k; // ease-in — the fist accelerates
      logo.style.opacity = String(Math.min(1, k * 2));
      logo.style.transform = `translate(-50%,-50%) scale(${6 - 5 * e})`;
      if (k >= 1) break;
      await sleep(0);
    }
    logo.style.opacity = '1';
    logo.style.transform = 'translate(-50%,-50%) scale(1)';
    // Let the impact land under full light, then shed the ray as the punch-in completes.
    ray.style.transition = 'opacity 360ms ease-out';
    ray.style.opacity = '0';
    audio.play('crash'); // impact — same buffer racerSound preloads
    await shake(520, 18);
    await sleep(950); // hold on the logo
    await fadeOut(stage, 600); // fade to black
  }

  // ---------- cinematic 2: PLATFORM — BUILT WITH ✦ STAR ----------
  async function platformCinematic({ stage, sleep, fadeOut }) {
    const builtH = Math.max(26, Math.round((window.innerHeight || 900) * 0.055));
    const starH = Math.max(18, Math.round((window.innerHeight || 900) * 0.035));
    const builtImg = await bigWordImg("BUILT WITH", builtH);
    const starImg = await bigWordImg("STAR", starH);
    stage.innerHTML = `
      <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:space-between;padding:8% 0">
        <img id="pc-built" src="${builtImg.src}" draggable="false" style="opacity:0;transition:opacity .7s ease">
        <img id="pc-logo" src="${STARLOGO_URL}" draggable="false" style="width:min(38vmin,300px);opacity:0;transition:opacity .7s ease">
        <img id="pc-star" src="${starImg.src}" draggable="false" style="opacity:0;transition:opacity .6s ease">
      </div>`;
    const built = stage.querySelector('#pc-built');
    const logo = stage.querySelector('#pc-logo');
    const star = stage.querySelector('#pc-star');
    await sleep(300);
    built.style.opacity = '1';
    await sleep(750);
    logo.style.opacity = '1';
    await sleep(750 + 1000); // fade in, hold 1s
    star.style.opacity = '1';
    await sleep(1000);
    await fadeOut(stage, 600); // to black
  }

  // ---------- cinematic 3: TEAM — team/studio logo card ----------
  // Plays right after the platform card (BUILT WITH ★ STAR) as its own extra
  // beat, same fade-in/hold/fade-out shape as platformCinematic.
  async function teamCinematic({ stage, sleep, fadeOut }) {
    // TeamLogo.png is authored at 640x480 — the same internal resolution as
    // the game framebuffer (main.js's #froyo-canvas, which fills its shell at
    // width:100%;height:100%). Match that exact sizing here instead of an
    // independent vmin box, so the card stretches identically to how the
    // canvas itself fills the screen (pixel-perfect at 4:3, same non-uniform
    // stretch as the game at any other window aspect).
    stage.innerHTML = `
      <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center">
        <img id="tc-logo" src="${TEAMLOGO_URL}" draggable="false" style="width:100%;height:100%;opacity:0;transition:opacity .7s ease">
      </div>`;
    const logo = stage.querySelector('#tc-logo');
    await sleep(300);
    logo.style.opacity = '1';
    await sleep(1600); // hold
    await fadeOut(stage, 600); // to black
  }

  // add future cinematics here — they run in order, back to back
  const CINEMATICS = [devCinematic, platformCinematic, teamCinematic];

  // ---------- run the reel ----------
  (async () => {
    for (const cin of CINEMATICS) {
      await cin(ctx);
      resetStage();
    }
    // reveal: the game (assets already loaded by warmup) starts rendering
    // underneath, then the black overlay lifts off it
    if (onReveal) onReveal();
    overlay.style.pointerEvents = 'none';
    await fadeOut(overlay, 800);
    overlay.remove();
  })();
}