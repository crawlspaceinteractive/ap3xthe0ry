/**
 * input.js — Hybrid Gamepad + Keyboard input mapped to Froyo INPUT FLAGS.
 *
 * Resolution model (per spec Section V):
 *   raw input → bitwise inputMask → consumed by state.js
 *
 * Returns each frame:
 *   { mask, prevMask, axisX, axisY }
 *
 * Pressed = (mask & flag), JustPressed = (mask & ~prevMask & flag).
 */
import { GamepadManager, BTN, AXIS } from "./gamepad.js";

export const BTN_FLAGS = {
  A:     0b0000000000000001,
  B:     0b0000000000000010,
  X:     0b0000000000000100,
  Y:     0b0000000000001000,
  RT:    0b0000000000010000,
  LT:    0b0000000000100000,
  START: 0b0000000001000000,
  SEL:   0b0000000010000000,
  // Shoulder buttons reserved for free-cam orbit (separate from LT/RT).
  LB:    0b0000000100000000,
  RB:    0b0000001000000000,
};

// Fixed keyboard mapping (always active, on top of the rebindable bindings).
// Confirm: Space (A). X: J. B: K. Y: L. RT (alt handbrake): Ctrl.
// Start: Enter. Select: Tab. Escape is NOT mapped here — it is the universal
// BACK key (menus) handled explicitly by the menu controller via
// keyJustPressed("Escape"), so it never double-fires as a confirm/START.
const FIXED_KEY_MAP = {
  Space:        BTN_FLAGS.A,
  KeyJ:         BTN_FLAGS.X,
  KeyK:         BTN_FLAGS.B,
  KeyL:         BTN_FLAGS.Y,
  ControlLeft:  BTN_FLAGS.RT,
  ControlRight: BTN_FLAGS.RT,
  Enter:        BTN_FLAGS.START,
  Tab:          BTN_FLAGS.SEL,
};

// Rebindable actions (Options → Key Bindings). up/down/left/right feed the
// movement axes; the rest map to button flags.
export const DEFAULT_BINDINGS = {
  up:    "KeyW",
  down:  "KeyS",
  left:  "KeyA",
  right: "KeyD",
  drift: "ShiftLeft",
  rear:  "KeyR",
  reset: "KeyT",
  pause: "Enter",
};
const BINDING_FLAGS = {
  drift: BTN_FLAGS.LT,
  rear:  BTN_FLAGS.Y,
  reset: BTN_FLAGS.SEL,
  pause: BTN_FLAGS.START,
};
const BINDINGS_KEY = "ap3x_bindings";

function loadBindings() {
  const b = { ...DEFAULT_BINDINGS };
  try {
    const saved = JSON.parse(localStorage.getItem(BINDINGS_KEY) || "{}");
    for (const k in DEFAULT_BINDINGS) {
      if (typeof saved[k] === "string") b[k] = saved[k];
    }
  } catch (_) { /* fresh defaults */ }
  return b;
}

export class InputController {
  constructor() {
    this.mask = 0;
    this.prevMask = 0;
    this.axisX = 0;
    this.axisY = 0;
    // Camera-orbit axis: Q/E keyboard or right-stick X on gamepad.
    // Positive = orbit right, negative = orbit left.
    this.orbitX = 0;
    // Camera pitch axis: right-stick Y on gamepad. Positive = look down,
    // negative = look up (matches stick convention; game.js inverts if desired).
    this.orbitY = 0;

    this._keyboardMask = 0;
    this._kbAxisX = 0;
    this._kbAxisY = 0;
    this._kbOrbitX = 0;

    this.bindings = loadBindings();
    this._keyMap = {};
    this._rebuildKeyMap();

    this._keys = new Set();
    // Pulse set: keys that received a keydown this frame, persisted until sample() consumes them.
    // Lets us catch sub-frame taps that would otherwise be missed by mask diffing.
    this._keyPulses = new Set();

    this._onKeyDown = this._onKeyDown.bind(this);
    this._onKeyUp = this._onKeyUp.bind(this);
    this._onBlur = this._onBlur.bind(this);

    this.gp = new GamepadManager({ deadzone: 0.18 });
    this.gp.start();

    // Track pads so we can read sticks; use first connected
    this._activePadIndex = null;
    this.gp.on("connected", (pad) => {
      if (this._activePadIndex === null) this._activePadIndex = pad.index;
    });
    this.gp.on("disconnected", (pad) => {
      if (this._activePadIndex === pad.index) this._activePadIndex = null;
    });

    if (typeof window !== "undefined") {
      window.addEventListener("keydown", this._onKeyDown);
      window.addEventListener("keyup", this._onKeyUp);
      window.addEventListener("blur", this._onBlur);
    }
  }

  destroy() {
    if (typeof window !== "undefined") {
      window.removeEventListener("keydown", this._onKeyDown);
      window.removeEventListener("keyup", this._onKeyUp);
      window.removeEventListener("blur", this._onBlur);
    }
    this.gp.destroy();
  }

  _onKeyDown(e) {
    // Avoid scrolling on game keys
    if (
      e.code === "Space" || e.code === "Tab" || e.code === "Escape" ||
      e.code === "ArrowUp" || e.code === "ArrowDown" ||
      e.code === "ArrowLeft" || e.code === "ArrowRight"
    ) e.preventDefault();
    if (!this._keys.has(e.code)) this._keyPulses.add(e.code);
    this._keys.add(e.code);
    this._recomputeKb();
  }
  _onKeyUp(e) {
    this._keys.delete(e.code);
    this._recomputeKb();
  }
  _onBlur() {
    this._keys.clear();
    this._recomputeKb();
  }

  // ---- Rebindable key API (Options → Key Bindings) --------------------------
  _rebuildKeyMap() {
    const m = { ...FIXED_KEY_MAP };
    for (const action in BINDING_FLAGS) {
      const code = this.bindings[action];
      if (code) m[code] = (m[code] || 0) | BINDING_FLAGS[action];
    }
    this._keyMap = m;
  }

  getBindings() { return { ...this.bindings }; }

  setBinding(action, code) {
    if (!(action in DEFAULT_BINDINGS) || !code) return;
    this.bindings[action] = code;
    this._rebuildKeyMap();
    this._recomputeKb();
    try { localStorage.setItem(BINDINGS_KEY, JSON.stringify(this.bindings)); } catch (_) {}
  }

  resetBindings() {
    this.bindings = { ...DEFAULT_BINDINGS };
    this._rebuildKeyMap();
    this._recomputeKb();
    try { localStorage.removeItem(BINDINGS_KEY); } catch (_) {}
  }

  /** First raw key that went down this frame (for rebind capture), or null. */
  firstPulse() {
    return this.rawPulses ? (this.rawPulses.values().next().value || null) : null;
  }

  _recomputeKb() {
    let m = 0;
    for (const k of this._keys) if (this._keyMap[k]) m |= this._keyMap[k];
    this._keyboardMask = m;

    const b = this.bindings;
    let x = 0, y = 0;
    if (this._keys.has(b.left) || this._keys.has("ArrowLeft")) x -= 1;
    if (this._keys.has(b.right) || this._keys.has("ArrowRight")) x += 1;
    if (this._keys.has(b.up) || this._keys.has("ArrowUp")) y -= 1;
    if (this._keys.has(b.down) || this._keys.has("ArrowDown")) y += 1;
    this._kbAxisX = x;
    this._kbAxisY = y;

    // Camera orbit: Q (left) / E (right).
    let ox = 0;
    if (this._keys.has("KeyQ")) ox -= 1;
    if (this._keys.has("KeyE")) ox += 1;
    this._kbOrbitX = ox;
  }

  /**
   * Sample input for the current frame. Call once per game tick.
   */
  sample() {
    this.prevMask = this.mask;

    // Gamepad
    let gpMask = 0;
    let gpX = 0, gpY = 0;
    let gpOrbitX = 0;
    let gpOrbitY = 0;
    const padIndex = this._activePadIndex;
    if (padIndex !== null) {
      const gp = this.gp;
      if (gp.isPressed(padIndex, BTN.A))     gpMask |= BTN_FLAGS.A;
      if (gp.isPressed(padIndex, BTN.B))     gpMask |= BTN_FLAGS.B;
      if (gp.isPressed(padIndex, BTN.X))     gpMask |= BTN_FLAGS.X;
      if (gp.isPressed(padIndex, BTN.Y))     gpMask |= BTN_FLAGS.Y;
      if (gp.isPressed(padIndex, BTN.LT)) gpMask |= BTN_FLAGS.LT;
      if (gp.isPressed(padIndex, BTN.RT)) gpMask |= BTN_FLAGS.RT;
      if (gp.isPressed(padIndex, BTN.LB)) gpMask |= BTN_FLAGS.LB;
      if (gp.isPressed(padIndex, BTN.RB)) gpMask |= BTN_FLAGS.RB;
      if (gp.isPressed(padIndex, BTN.START)) gpMask |= BTN_FLAGS.START;
      if (gp.isPressed(padIndex, BTN.SELECT)) gpMask |= BTN_FLAGS.SEL;

      // D-pad fallback for axes
      let dx = 0, dy = 0;
      if (gp.isPressed(padIndex, BTN.LEFT)) dx -= 1;
      if (gp.isPressed(padIndex, BTN.RIGHT)) dx += 1;
      if (gp.isPressed(padIndex, BTN.UP)) dy -= 1;
      if (gp.isPressed(padIndex, BTN.DOWN)) dy += 1;
      const stick = gp.getStick(padIndex, AXIS.LEFT_X, AXIS.LEFT_Y);
      gpX = stick.x !== 0 || stick.y !== 0 ? stick.x : dx;
      gpY = stick.x !== 0 || stick.y !== 0 ? stick.y : dy;

      // Right stick X → camera orbit yaw, Y → pitch
      const rStick = gp.getStick(padIndex, AXIS.RIGHT_X, AXIS.RIGHT_Y);
      gpOrbitX = rStick.x;
      gpOrbitY = rStick.y;
    }

    this.mask = gpMask | this._keyboardMask;

    // Merge sub-frame keyboard taps into `mask` so justPressed always detects them
    // even if keyup arrives in the same animation frame.
    // Snapshot raw pulses first so keyJustPressed() works for unmapped keys
    // (debug flycam toggle, editor hotkeys) this frame.
    this.rawPulses = this._keyPulses.size > 0 ? new Set(this._keyPulses) : null;
    if (this._keyPulses.size > 0) {
      for (const k of this._keyPulses) {
        const flag = this._keyMap[k];
        if (flag) this.mask |= flag;
      }
      this._keyPulses.clear();
    }

    // Combine axis: prefer non-zero source
    const kbHas = this._kbAxisX !== 0 || this._kbAxisY !== 0;
    const gpHas = gpX !== 0 || gpY !== 0;
    if (kbHas) {
      this.axisX = this._kbAxisX;
      this.axisY = this._kbAxisY;
    } else if (gpHas) {
      this.axisX = gpX;
      this.axisY = gpY;
    } else {
      this.axisX = 0;
      this.axisY = 0;
    }

    // Camera orbit: keyboard Q/E or gamepad right-stick X (kb takes precedence if set)
    this.orbitX = this._kbOrbitX !== 0 ? this._kbOrbitX : gpOrbitX;
    // Pitch axis: gamepad right-stick Y only (no kb mapping by default).
    this.orbitY = gpOrbitY;
  }

  isDown(flag) { return (this.mask & flag) !== 0; }
  /** Raw key state by KeyboardEvent.code — for debug/editor hotkeys. */
  isKeyDown(code) { return this._keys.has(code); }
  /** True on the frame a raw key first went down (edge-triggered). */
  keyJustPressed(code) { return this.rawPulses ? this.rawPulses.has(code) : false; }
  justPressed(flag) {
    return (this.mask & flag) !== 0 && (this.prevMask & flag) === 0;
  }
  justReleased(flag) {
    return (this.mask & flag) === 0 && (this.prevMask & flag) !== 0;
  }
  isGamepadConnected() { return this._activePadIndex !== null; }

  rumble(opts) {
    if (this._activePadIndex !== null) this.gp.vibrate(this._activePadIndex, opts);
  }
}
