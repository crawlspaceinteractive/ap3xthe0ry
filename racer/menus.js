/**
 * racer/menus.js — Main menu shown over the orbiting track cam after the
 * title cinematic.
 *
 *   MAIN      PLAY / CONTROLS / OPTIONS / ABOUT
 *   GAMEMODES the PLAY submenu: SINGLE RACE / TIME ATTACK / HEAD2HEAD.
 *             TIME ATTACK opens COURSES; SINGLE RACE + HEAD2HEAD drop into
 *             NOTICE ("not available in this demo").
 *   COURSES   scrollable course list from levels.js LEVELS; confirm returns
 *             "PLAY" and sets selectedLevelIdx for RacerGame.loadLevel.
 *   NOTICE    unavailable-mode message; back/confirm returns to GAMEMODES.
 *   CONTROLS  the old title screen's control listing
 *   OPTIONS   SFX + music sliders (same behavior as the pause menu),
 *             fullscreen toggle, key-bindings submenu
 *   BINDINGS  rebind the keyboard actions (press-any-key capture); the
 *             controller mapping is fixed and listed for reference
 *   ABOUT     README.md + CHANGELOG.md, scrollable
 *   PAUSE     in-race pause menu (enterPause()): resume, volume sliders,
 *             fullscreen, key bindings, quit to main menu. tick() returns
 *             "RESUME" or "QUIT" from this mode.
 */
import { drawRect, drawText, rgba } from "../engine/renderer.js";
import { SCREEN_W, SCREEN_H } from "../engine/luts.js";
import { BTN_FLAGS } from "../engine/input.js";
import { racerSound } from "./racersound.js";
import { LEVELS, levelCount } from "./levels.js";
import {
  drawBigText, measureBigText, drawBodyText, measureBodyText,
} from "./hudfont.js";

const PANEL  = rgba(20, 14, 36);
const ACCENT = rgba(255, 128, 8);
const WHITE  = rgba(255, 255, 255);
const DIM    = rgba(140, 120, 160);
const SEL    = rgba(120, 240, 200);
const SLIDER_BG   = rgba(50, 40, 70);
const SLIDER_FILL = rgba(100, 220, 180);
const SLIDER_DIM  = rgba(60, 150, 120);

const MAIN_ITEMS = ["PLAY", "CONTROLS", "OPTIONS", "ABOUT"];
const GAMEMODE_ITEMS = ["SINGLE RACE", "TIME ATTACK", "HEAD2HEAD"];
const UNAVAILABLE_TITLE = "THIS GAME MODE IS NOT";
const UNAVAILABLE_LINE = "AVAILABLE IN THIS DEMO.";
// Options rows: 0 SFX, 1 MUSIC, 2 FULLSCREEN, 3 KEY BINDINGS, 4 BACK
const OPT_ROWS = 5;
// Pause rows: 0 RESUME, 1 SFX, 2 MUSIC, 3 FULLSCREEN, 4 KEY BINDINGS, 5 QUIT
const PAUSE_ROWS = 6;
const BIND_ACTIONS = [
  { key: "up",    label: "THROTTLE" },
  { key: "down",  label: "BRAKE/REVERSE" },
  { key: "left",  label: "STEER LEFT" },
  { key: "right", label: "STEER RIGHT" },
  { key: "drift", label: "DRIFT" },
  { key: "rear",  label: "REARVIEW" },
  { key: "reset", label: "RESET CAR" },
  { key: "pause", label: "PAUSE" },
];
const BIND_ROWS = BIND_ACTIONS.length + 2; // + RESET DEFAULTS + BACK

const CONTROL_LINES = [
  "WASD: DRIVE",
  "SHIFT: DRIFT",
  "S: BRAKE  R: REARVIEW",
  "T: RESET",
  "HOLD DRIFT + STEER,",
  "RELEASE TO BOOST",
];

// KeyboardEvent.code → short display name.
function prettyKey(code) {
  if (!code) return "---";
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  if (code.startsWith("Arrow")) return code.slice(5).toUpperCase();
  return code
    .replace("Left", " L").replace("Right", " R")
    .replace("Control", "CTRL").replace("Shift", "SHIFT")
    .toUpperCase();
}

function wrapText(text, maxChars) {
  const out = [];
  for (const raw of text.split("\n")) {
    let line = raw.replace(/\t/g, "  ");
    if (!line.trim()) { out.push(""); continue; }
    while (line.length > maxChars) {
      let cut = line.lastIndexOf(" ", maxChars);
      if (cut < maxChars * 0.5) cut = maxChars;
      out.push(line.slice(0, cut));
      line = line.slice(cut).trimStart();
    }
    out.push(line);
  }
  return out;
}

export class MenuController {
  constructor() {
    this.mode = "MAIN";
    this.row = 0;
    this.gamemodeRow = 0;
    this.courseRow = 0;
    this.selectedLevelIdx = 0; // set when COURSES confirms → PLAY
    this.noticeMode = null;
    this.optRow = 0;
    this.bindRow = 0;
    this.pauseRow = 0;
    this._bindReturn = "OPTIONS"; // where BINDINGS backs out to
    this.capture = null;       // action key being rebound, or null
    this.aboutLines = null;    // wrapped README+CHANGELOG lines
    this.aboutScroll = 0;
    this._prevX = 0;
    this._prevY = 0;
    this._held = 0;            // slider auto-repeat
    this._scrollHeld = 0;      // about auto-repeat
  }

  reset() {
    this.mode = "MAIN";
    this.row = 0;
    this.gamemodeRow = 0;
    this.courseRow = Math.max(0, Math.min(levelCount() - 1, this.selectedLevelIdx | 0));
  }

  /** Enter course select, optionally seeding the highlight from the last race. */
  enterCourses(levelIdx) {
    const n = levelCount();
    const idx = levelIdx != null ? levelIdx | 0 : this.selectedLevelIdx | 0;
    this.mode = "COURSES";
    this.courseRow = Math.max(0, Math.min(Math.max(0, n - 1), idx));
  }

  /** Enter the in-race pause menu. Pass the InputController so axis
   *  edge-detection starts clean (no phantom first move). */
  enterPause(inp) {
    this.mode = "PAUSE";
    this.pauseRow = 0;
    this._held = 0;
    this.capture = null;
    if (inp) { this._prevX = inp.axisX; this._prevY = inp.axisY; }
  }

  _edges(inp) {
    const axX = inp.axisX, axY = inp.axisY;
    const e = {
      up:    axY < -0.4 && this._prevY >= -0.4,
      down:  axY >  0.4 && this._prevY <=  0.4,
      left:  axX < -0.4 && this._prevX >= -0.4,
      right: axX >  0.4 && this._prevX <=  0.4,
      confirm: inp.justPressed(BTN_FLAGS.A) || inp.justPressed(BTN_FLAGS.START),
      back:    inp.justPressed(BTN_FLAGS.B) || inp.keyJustPressed("Backspace") ||
               inp.keyJustPressed("Escape"),
      axX, axY,
    };
    this._prevX = axX;
    this._prevY = axY;
    return e;
  }

  /** Per display frame while in MENU state. Returns "PLAY" to start racing. */
  tick(inp) {
    this._inputRef = inp;
    // Key-capture mode swallows everything until a key lands.
    if (this.capture) {
      const code = inp.firstPulse();
      if (code) {
        if (code !== "Escape") inp.setBinding(this.capture, code);
        this.capture = null;
      }
      return null;
    }

    const e = this._edges(inp);

    if (this.mode === "MAIN") {
      if (e.down) this.row = (this.row + 1) % MAIN_ITEMS.length;
      if (e.up)   this.row = (this.row + MAIN_ITEMS.length - 1) % MAIN_ITEMS.length;
      if (e.confirm) {
        const item = MAIN_ITEMS[this.row];
        if (item === "PLAY") { this.mode = "GAMEMODES"; this.gamemodeRow = 0; }
        if (item === "CONTROLS") this.mode = "CONTROLS";
        if (item === "OPTIONS") { this.mode = "OPTIONS"; this.optRow = 0; }
        if (item === "ABOUT") { this.mode = "ABOUT"; this.aboutScroll = 0; this._loadAbout(); }
      }
      return null;
    }

    if (this.mode === "GAMEMODES") return this._tickGameModes(e);
    if (this.mode === "COURSES") return this._tickCourses(e);
    if (this.mode === "NOTICE") {
      if (e.back || e.confirm) this.mode = "GAMEMODES";
      return null;
    }

    if (this.mode === "CONTROLS") {
      if (e.back || e.confirm) this.mode = "MAIN";
      return null;
    }

    if (this.mode === "OPTIONS") return this._tickOptions(e, inp);
    if (this.mode === "BINDINGS") return this._tickBindings(e, inp);
    if (this.mode === "ABOUT") return this._tickAbout(e, inp);
    if (this.mode === "PAUSE") return this._tickPause(e);
    return null;
  }

  _tickOptions(e, inp) {
    if (e.down) this.optRow = (this.optRow + 1) % OPT_ROWS;
    if (e.up)   this.optRow = (this.optRow + OPT_ROWS - 1) % OPT_ROWS;
    if (e.back) { this.mode = "MAIN"; return null; }

    // Sliders (rows 0/1) — same auto-repeat behavior as the pause menu.
    const hDir = e.axX > 0.4 ? 1 : e.axX < -0.4 ? -1 : 0;
    hDir !== 0 ? this._held++ : (this._held = 0);
    const fire = (e.left || e.right) || this._held === 1 ||
                 (this._held > 20 && this._held % 5 === 0);
    if (fire && hDir !== 0 && this.optRow <= 1) {
      const v = racerSound.getVolumes();
      if (this.optRow === 0) racerSound.setSfxVol(Math.max(0, Math.min(1, v.sfx + hDir * 0.05)));
      else racerSound.setMusicVol(Math.max(0, Math.min(1, v.music + hDir * 0.05)));
    }

    if (this.optRow === 2 && (e.confirm || e.left || e.right)) this._toggleFullscreen();
    if (e.confirm && this.optRow === 3) { this.mode = "BINDINGS"; this.bindRow = 0; this._bindReturn = "OPTIONS"; }
    if (e.confirm && this.optRow === 4) this.mode = "MAIN";
    return null;
  }

  _tickGameModes(e) {
    if (e.down) this.gamemodeRow = (this.gamemodeRow + 1) % GAMEMODE_ITEMS.length;
    if (e.up)   this.gamemodeRow = (this.gamemodeRow + GAMEMODE_ITEMS.length - 1) % GAMEMODE_ITEMS.length;
    if (e.back) { this.mode = "MAIN"; return null; }
    if (e.confirm) {
      const item = GAMEMODE_ITEMS[this.gamemodeRow];
      if (item === "TIME ATTACK") {
        this.enterCourses(this.selectedLevelIdx);
        return null;
      }
      this.noticeMode = item;
      this.mode = "NOTICE";
    }
    return null;
  }

  _tickCourses(e) {
    const n = levelCount();
    if (n <= 0) { this.mode = "GAMEMODES"; return null; }
    if (e.down) this.courseRow = (this.courseRow + 1) % n;
    if (e.up)   this.courseRow = (this.courseRow + n - 1) % n;
    // Left/right also scroll so a long list feels like a course picker.
    if (e.right) this.courseRow = (this.courseRow + 1) % n;
    if (e.left)  this.courseRow = (this.courseRow + n - 1) % n;
    if (e.back) { this.mode = "GAMEMODES"; return null; }
    if (e.confirm) {
      this.selectedLevelIdx = this.courseRow;
      return "PLAY";
    }
    return null;
  }

  _tickPause(e) {
    // Back always resumes (B / Backspace). Enter/START is a plain confirm key
    // here too — it fires the selected row (row 0 = RESUME), not a hidden
    // toggle, keeping the whole interface on one confirm path.
    if (e.back) return "RESUME";

    if (e.down) this.pauseRow = (this.pauseRow + 1) % PAUSE_ROWS;
    if (e.up)   this.pauseRow = (this.pauseRow + PAUSE_ROWS - 1) % PAUSE_ROWS;

    // Sliders (rows 1/2) with auto-repeat.
    const hDir = e.axX > 0.4 ? 1 : e.axX < -0.4 ? -1 : 0;
    hDir !== 0 ? this._held++ : (this._held = 0);
    const fire = (e.left || e.right) || this._held === 1 ||
                 (this._held > 20 && this._held % 5 === 0);
    if (fire && hDir !== 0 && (this.pauseRow === 1 || this.pauseRow === 2)) {
      const v = racerSound.getVolumes();
      if (this.pauseRow === 1) racerSound.setSfxVol(Math.max(0, Math.min(1, v.sfx + hDir * 0.05)));
      else racerSound.setMusicVol(Math.max(0, Math.min(1, v.music + hDir * 0.05)));
    }

    if (this.pauseRow === 3 && (e.confirm || e.left || e.right)) this._toggleFullscreen();
    if (e.confirm) {
      if (this.pauseRow === 0) return "RESUME";
      if (this.pauseRow === 4) { this.mode = "BINDINGS"; this.bindRow = 0; this._bindReturn = "PAUSE"; }
      if (this.pauseRow === 5) return "QUIT";
    }
    return null;
  }

  _tickBindings(e, inp) {
    if (e.down) this.bindRow = (this.bindRow + 1) % BIND_ROWS;
    if (e.up)   this.bindRow = (this.bindRow + BIND_ROWS - 1) % BIND_ROWS;
    if (e.back) { this.mode = this._bindReturn; return null; }
    if (e.confirm) {
      if (this.bindRow < BIND_ACTIONS.length) this.capture = BIND_ACTIONS[this.bindRow].key;
      else if (this.bindRow === BIND_ACTIONS.length) inp.resetBindings();
      else this.mode = this._bindReturn;
    }
    return null;
  }

  _tickAbout(e) {
    if (e.back || e.confirm) { this.mode = "MAIN"; return null; }
    const dir = e.axY > 0.4 ? 1 : e.axY < -0.4 ? -1 : 0;
    dir !== 0 ? this._scrollHeld++ : (this._scrollHeld = 0);
    const fire = this._scrollHeld === 1 ||
                 (this._scrollHeld > 15 && this._scrollHeld % 3 === 0);
    if (fire && dir !== 0 && this.aboutLines) {
      const maxScroll = Math.max(0, this.aboutLines.length - 15);
      this.aboutScroll = Math.max(0, Math.min(maxScroll, this.aboutScroll + dir));
    }
    return null;
  }

  _toggleFullscreen() {
    const shell = document.getElementById("froyo-shell") || document.getElementById("game-root");
    if (!shell) return;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else if (shell.requestFullscreen) shell.requestFullscreen().catch(() => {});
  }

  async _loadAbout() {
    if (this.aboutLines || this._aboutLoading) return;
    this._aboutLoading = true;
    const grab = async (path) => {
      try {
        const r = await fetch(path);
        return r.ok ? await r.text() : "";
      } catch (_) { return ""; }
    };
    const [readme, changelog] = await Promise.all([grab("docs/README.md"), grab("docs/CHANGELOG.md")]);
    const text =
      "=== README ===\n\n" + (readme || "(readme unavailable)") +
      "\n\n=== CHANGELOG ===\n\n" + (changelog || "(changelog unavailable)");
    this.aboutLines = wrapText(text, 48);
  }

  // ---- Drawing ---------------------------------------------------------------
  draw(rd, fonts, frame) {
    drawRect(rd, 0, 0, SCREEN_W, SCREEN_H, rgba(0, 0, 0), true, 110);
    const useSprite = !!(fonts && fonts.big && fonts.body);

    if (this.mode === "MAIN") this._drawMain(rd, fonts, useSprite, frame);
    else if (this.mode === "GAMEMODES") this._drawGameModes(rd, fonts, useSprite);
    else if (this.mode === "COURSES") this._drawCourses(rd, fonts, useSprite);
    else if (this.mode === "NOTICE") this._drawNotice(rd, fonts, useSprite);
    else if (this.mode === "CONTROLS") this._drawControls(rd, fonts, useSprite);
    else if (this.mode === "OPTIONS") this._drawOptions(rd, fonts, useSprite);
    else if (this.mode === "BINDINGS") this._drawBindings(rd, fonts, useSprite);
    else if (this.mode === "ABOUT") this._drawAbout(rd, fonts, useSprite);
    else if (this.mode === "PAUSE") this._drawPause(rd, fonts, useSprite);
  }

  _title(rd, fonts, useSprite) {
    const TITLE = "AP3X THE0RY";
    if (useSprite) {
      let th = 34;
      let tw = measureBigText(fonts, TITLE, th, 2);
      if (tw > SCREEN_W - 8) { th = Math.max(14, (th * (SCREEN_W - 8) / tw) | 0); tw = measureBigText(fonts, TITLE, th, 2); }
      drawBigText(rd, fonts, TITLE, (SCREEN_W - tw) >> 1, 10, th, null, 2);
    } else {
      drawText(rd, TITLE, (SCREEN_W >> 1) - 110, 14, rgba(255, 210, 70), 4);
    }
  }

  _body(rd, fonts, useSprite, str, x, y, size, color) {
    if (useSprite) return drawBodyText(rd, fonts, str, x, y, size, color, 1);
    const s = Math.max(1, Math.round(size / 8));
    drawText(rd, str, x, y, color === null ? 0xffffffff : color, s);
    return str.length * 5 * s;
  }

  _bodyCentered(rd, fonts, useSprite, str, y, size, color) {
    const w = useSprite
      ? measureBodyText(fonts, str, size, 1)
      : str.length * 5 * Math.max(1, Math.round(size / 8));
    this._body(rd, fonts, useSprite, str, (SCREEN_W - w) >> 1, y, size, color);
  }

  _header(rd, fonts, useSprite, str) {
    if (useSprite) {
      const tw = measureBigText(fonts, str, 22, 2);
      drawBigText(rd, fonts, str, (SCREEN_W - tw) >> 1, 12, 22, ACCENT, 2);
    } else {
      drawText(rd, str, (SCREEN_W >> 1) - str.length * 5, 14, ACCENT, 2);
    }
  }

  _hint(rd, fonts, useSprite, str) {
    this._bodyCentered(rd, fonts, useSprite, str, SCREEN_H - 16, 11, DIM);
  }

  _drawMain(rd, fonts, useSprite, frame) {
    this._title(rd, fonts, useSprite);
    let y = 78;
    for (let i = 0; i < MAIN_ITEMS.length; i++) {
      const s = i === this.row;
      const w = useSprite ? measureBodyText(fonts, MAIN_ITEMS[i], 20, 1) : MAIN_ITEMS[i].length * 10;
      const x = (SCREEN_W - w) >> 1;
      if (s && (frame & 16)) drawText(rd, ">", x - 16, y + 4, SEL, 2);
      this._body(rd, fonts, useSprite, MAIN_ITEMS[i], x, y, 20, s ? SEL : WHITE);
      y += 30;
    }
    this._hint(rd, fonts, useSprite, "W/S:SEL  ENTER/SPC:OK");
  }

  _drawGameModes(rd, fonts, useSprite) {
    this._header(rd, fonts, useSprite, "PLAY");
    let y = 78;
    for (let i = 0; i < GAMEMODE_ITEMS.length; i++) {
      const s = i === this.gamemodeRow;
      const w = useSprite ? measureBodyText(fonts, GAMEMODE_ITEMS[i], 20, 1) : GAMEMODE_ITEMS[i].length * 10;
      const x = (SCREEN_W - w) >> 1;
      if (s && (performance.now() / 400 | 0) & 1) drawText(rd, ">", x - 16, y + 4, SEL, 2);
      this._body(rd, fonts, useSprite, GAMEMODE_ITEMS[i], x, y, 20, s ? SEL : WHITE);
      y += 30;
    }
    this._hint(rd, fonts, useSprite, "W/S:SEL  ENTER/SPC:OK  ESC:BACK");
  }

  _drawCourses(rd, fonts, useSprite) {
    this._header(rd, fonts, useSprite, "COURSE");
    const n = levelCount();
    if (n <= 0) {
      this._bodyCentered(rd, fonts, useSprite, "NO COURSES", 110, 16, DIM);
      this._hint(rd, fonts, useSprite, "ESC:BACK");
      return;
    }

    // Windowed list so many maps still fit the 240px framebuffer.
    const VISIBLE = 4;
    const rowH = 22;
    let start = Math.max(0, this.courseRow - ((VISIBLE / 2) | 0));
    if (start + VISIBLE > n) start = Math.max(0, n - VISIBLE);
    let y = 48;
    for (let i = start; i < Math.min(n, start + VISIBLE); i++) {
      const lev = LEVELS[i];
      const name = (lev && lev.name) || lev.id || ("COURSE " + (i + 1));
      const s = i === this.courseRow;
      const w = useSprite ? measureBodyText(fonts, name, 18, 1) : name.length * 9;
      const x = (SCREEN_W - w) >> 1;
      if (s && (performance.now() / 400 | 0) & 1) drawText(rd, ">", x - 16, y + 2, SEL, 2);
      this._body(rd, fonts, useSprite, name, x, y, 18, s ? SEL : WHITE);
      y += rowH;
    }

    // Desc under the list (selected course).
    const sel = LEVELS[this.courseRow];
    const desc = (sel && sel.desc) || "";
    if (desc) {
      const lines = wrapText(desc.toUpperCase(), 36).slice(0, 3);
      let dy = 48 + VISIBLE * rowH + 6;
      for (const line of lines) {
        this._bodyCentered(rd, fonts, useSprite, line, dy, 11, DIM);
        dy += 13;
      }
    }

    // Scroll chevrons when the window doesn't cover the full list.
    if (start > 0) drawText(rd, "^", SCREEN_W - 14, 48, SEL, 2);
    if (start + VISIBLE < n) drawText(rd, "v", SCREEN_W - 14, 48 + VISIBLE * rowH - 10, SEL, 2);

    const idxLabel = (this.courseRow + 1) + "/" + n;
    this._bodyCentered(rd, fonts, useSprite, idxLabel, SCREEN_H - 28, 10, DIM);
    this._hint(rd, fonts, useSprite, "W/S:SEL  ENTER:RACE  ESC:BACK");
  }

  _drawNotice(rd, fonts, useSprite) {
    this._header(rd, fonts, useSprite, (this.noticeMode || "PLAY") + " UNAVAILABLE");
    this._bodyCentered(rd, fonts, useSprite, UNAVAILABLE_TITLE, 108, 18, WHITE);
    this._bodyCentered(rd, fonts, useSprite, UNAVAILABLE_LINE, 132, 18, WHITE);
    this._hint(rd, fonts, useSprite, "ESC:BACK TO PLAY");
  }

  _drawControls(rd, fonts, useSprite) {
    this._header(rd, fonts, useSprite, "CONTROLS");
    let y = 52;
    for (const t of CONTROL_LINES) {
      this._bodyCentered(rd, fonts, useSprite, t, y, 16, null);
      y += 20;
    }
    this._hint(rd, fonts, useSprite, "ESC:BACK");
  }

  _drawOptions(rd, fonts, useSprite) {
    this._header(rd, fonts, useSprite, "OPTIONS");
    const vols = racerSound.getVolumes();
    const fs = !!document.fullscreenElement;
    const rows = [
      { label: "SFX VOL",   val: vols.sfx },
      { label: "MUSIC VOL", val: vols.music },
      { label: "FULLSCREEN", text: fs ? "ON" : "OFF" },
      { label: "KEY BINDINGS", text: ">" },
      { label: "BACK" },
    ];
    const px = 24, SW = 150;
    let y = 48;
    for (let i = 0; i < rows.length; i++) {
      const s = i === this.optRow;
      if (s) drawText(rd, ">", px - 14, y, SEL, 2);
      this._body(rd, fonts, useSprite, rows[i].label, px, y, 14, s ? SEL : DIM);
      if (rows[i].val !== undefined) {
        const sy = y + 16, sh = 7;
        drawRect(rd, px, sy, SW, sh, SLIDER_BG);
        drawRect(rd, px, sy, Math.max(2, Math.round(rows[i].val * SW)), sh, s ? SLIDER_FILL : SLIDER_DIM);
        drawRect(rd, px, sy, SW, sh, s ? SEL : DIM, false);
        const pct = String(Math.round(rows[i].val * 100)).padStart(3, " ") + "%";
        this._body(rd, fonts, useSprite, pct, px + SW + 6, sy, 12, s ? SEL : DIM);
        y += 36;
      } else {
        if (rows[i].text) this._body(rd, fonts, useSprite, rows[i].text, px + 150, y, 14, s ? WHITE : DIM);
        y += 24;
      }
    }
    this._hint(rd, fonts, useSprite, "W/S:SEL  A/D:ADJ  ESC:BACK");
  }

  _drawPause(rd, fonts, useSprite) {
    this._header(rd, fonts, useSprite, "PAUSED");
    const vols = racerSound.getVolumes();
    const fs = !!document.fullscreenElement;
    const rows = [
      { label: "RESUME" },
      { label: "SFX VOL",   val: vols.sfx },
      { label: "MUSIC VOL", val: vols.music },
      { label: "FULLSCREEN", text: fs ? "ON" : "OFF" },
      { label: "KEY BINDINGS", text: ">" },
      { label: "QUIT TO MENU" },
    ];
    const px = 24, SW = 150;
    let y = 44;
    for (let i = 0; i < rows.length; i++) {
      const s = i === this.pauseRow;
      if (s) drawText(rd, ">", px - 14, y, SEL, 2);
      this._body(rd, fonts, useSprite, rows[i].label, px, y, 14, s ? SEL : DIM);
      if (rows[i].val !== undefined) {
        const sy = y + 16, sh = 7;
        drawRect(rd, px, sy, SW, sh, SLIDER_BG);
        drawRect(rd, px, sy, Math.max(2, Math.round(rows[i].val * SW)), sh, s ? SLIDER_FILL : SLIDER_DIM);
        drawRect(rd, px, sy, SW, sh, s ? SEL : DIM, false);
        const pct = String(Math.round(rows[i].val * 100)).padStart(3, " ") + "%";
        this._body(rd, fonts, useSprite, pct, px + SW + 6, sy, 12, s ? SEL : DIM);
        y += 32;
      } else {
        if (rows[i].text) this._body(rd, fonts, useSprite, rows[i].text, px + 150, y, 14, s ? WHITE : DIM);
        y += 22;
      }
    }
    this._hint(rd, fonts, useSprite, "W/S:SEL  A/D:ADJ  ENTER:OK");
  }

  _drawBindings(rd, fonts, useSprite) {
    this._header(rd, fonts, useSprite, "KEY BINDINGS");
    const bindings = this._inputRef ? this._inputRef.getBindings() : null;
    const px = 30;
    let y = 44;
    for (let i = 0; i < BIND_ACTIONS.length; i++) {
      const s = i === this.bindRow;
      const a = BIND_ACTIONS[i];
      if (s) drawText(rd, ">", px - 14, y, SEL, 2);
      this._body(rd, fonts, useSprite, a.label, px, y, 12, s ? SEL : DIM);
      const val = this.capture === a.key
        ? ((performance.now() / 300 | 0) & 1 ? "PRESS A KEY" : "")
        : prettyKey(bindings ? bindings[a.key] : null);
      this._body(rd, fonts, useSprite, val, px + 140, y, 12, s ? WHITE : DIM);
      y += 16;
    }
    for (const [j, label] of [[BIND_ACTIONS.length, "RESET DEFAULTS"], [BIND_ACTIONS.length + 1, "BACK"]]) {
      const s = j === this.bindRow;
      if (s) drawText(rd, ">", px - 14, y, SEL, 2);
      this._body(rd, fonts, useSprite, label, px, y, 12, s ? SEL : DIM);
      y += 16;
    }
    this._hint(rd, fonts, useSprite, "GAMEPAD: FIXED LAYOUT  ESC:CANCEL");
  }

  _drawAbout(rd, fonts, useSprite) {
    this._header(rd, fonts, useSprite, "ABOUT");
    if (!this.aboutLines) {
      this._bodyCentered(rd, fonts, useSprite, "LOADING...", 110, 14, DIM);
    } else {
      const size = 10, lineH = 12, maxLines = 15;
      let y = 42;
      for (let i = this.aboutScroll; i < Math.min(this.aboutLines.length, this.aboutScroll + maxLines); i++) {
        if (this.aboutLines[i]) this._body(rd, fonts, useSprite, this.aboutLines[i], 12, y, size, WHITE);
        y += lineH;
      }
      // Scroll indicators
      if (this.aboutScroll > 0) drawText(rd, "^", SCREEN_W - 14, 42, SEL, 2);
      if (this.aboutScroll + maxLines < this.aboutLines.length) drawText(rd, "v", SCREEN_W - 14, SCREEN_H - 34, SEL, 2);
    }
    this._hint(rd, fonts, useSprite, "W/S:SCROLL  ESC:BACK");
  }
}
