/**
 * racer/racersound.js — All audio for the racer, via the Star Audio SDK.
 *
 *  - Background music: shuffled playlist of the 22 uploaded tracks,
 *    lazy-loaded one at a time, auto-advances when a track ends.
 *  - SFX:
 *      engine   — file-based loop, pitch follows speed / boost
 *      screech  — file-based loop while drifting, volume follows speed
 *      crash    — file-based one-shot on wall impacts
 *      crunch   — file-based one-shot landing thud
 *      boost    — file-based one-shot rising whoosh
 *      tierup   — file-based blip on drift charge tier crossing
 *      confirm  — menu OK / select blip
 *      deny     — menu cancel / unavailable blip
 *      select   — menu item-highlight tick
 *
 * Volume plumbing:
 *   _sfxVol / _musicVol are local multipliers 0..1.
 *   Every per-frame loop volume and one-shot {volume} is scaled by _sfxVol.
 *   Music volume is applied via SDK setMusicVolume.
 *   Both volumes persist via data/autosave.js.
 */
import { audio } from "../engine/sdk-audio.js";
import { TUNE } from "./vehicle.js";
import { assetUrl } from "../engine/asseturls.js";

// Nested asset paths (Git layout); assetUrl() maps each to the flat CDN URL.
const MUSIC_TRACKS = [
  "assets/audio/soundtrack/1._collector.mp3",
  "assets/audio/soundtrack/2._hoarder.mp3",
  "assets/audio/soundtrack/3._ahura.mp3",
  "assets/audio/soundtrack/4._lost_triplet.mp3",
  "assets/audio/soundtrack/5._neon_static.mp3",
  "assets/audio/soundtrack/6._piston_pusher.mp3",
  "assets/audio/soundtrack/7._incline.mp3",
  "assets/audio/soundtrack/8._octane.mp3",
  "assets/audio/soundtrack/9._untitled.mp3",
  "assets/audio/soundtrack/10._hairpin.mp3",
  "assets/audio/soundtrack/11._liquid.mp3",
  "assets/audio/soundtrack/12._chrome_coil.mp3",
  "assets/audio/soundtrack/13._satin_fuse.mp3",
  "assets/audio/soundtrack/14._spline_force.mp3",
  "assets/audio/soundtrack/15._redline.mp3",
  "assets/audio/soundtrack/16._whitewall.mp3",
  "assets/audio/soundtrack/17._paper_boats.mp3",
  "assets/audio/soundtrack/18._acid_rain.mp3",
  "assets/audio/soundtrack/19._pavement.mp3",
  "assets/audio/soundtrack/20._rollcage.mp3",
  "assets/audio/soundtrack/21._close_shave.mp3",
  "assets/audio/soundtrack/22._u-turn.mp3",
].map(f => assetUrl(f));

// The menu theme — 22. U-Turn, the last entry — loops at the main menu.
// Races keep the full shuffled playlist; the menu song never re-enters it.
const MENU_TRACK_IDX = MUSIC_TRACKS.length - 1;

// SFX definitions: file-based across the board.
const SFX = {
  engine: {
    src: assetUrl("assets/audio/sounds/sfx_engine_loop.mp3"),
    group: "sfx",
  },
  screech: {
    src: assetUrl("assets/audio/sounds/sfx_screech_loop.mp3"),
    group: "sfx",
  },
  crash: {
    src: assetUrl("assets/audio/sounds/sfx_crash.mp3"),
    group: "sfx",
  },
  crunch: {
    src: assetUrl("assets/audio/sounds/sfx_crunch.mp3"),
    group: "sfx",
  },
  boost: {
    src: assetUrl("assets/audio/sounds/sfx_boost.mp3"),
    group: "sfx",
  },
  tierup: {
    src: assetUrl("assets/audio/sounds/sfx_tierup.mp3"),
    group: "sfx",
  },
      confirm: {
        src: assetUrl("assets/audio/sounds/sfx_menu_confirm.mp3"),
        group: "sfx",
      },
      deny: {
        src: assetUrl("assets/audio/sounds/sfx_menu_deny.mp3"),
        group: "sfx",
      },
      select: {
        src: assetUrl("assets/audio/sounds/sfx_menu_select.mp3"),
        group: "sfx",
      },
    };

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Set playback rate on a live loop handle (SDK handle wraps a Howler sound). */
function setRate(handle, rate) {
  try {
    handle._howl.rate(rate, handle._soundId);
  } catch (_) { /* rate is best-effort */ }
}

/** Resume a loop handle that the SDK paused (e.g. tab was hidden). */
function ensurePlaying(handle) {
  try {
    if (!handle.playing) handle._howl.play(handle._soundId);
  } catch (_) { /* best-effort */ }
}

class RacerSound {
  constructor() {
    this._ready = audio.preload(SFX);

    // Loops — one pair per player (split-screen), [0] = P1, [1] = P2. In
    // single-player only slot 0 is created/updated, so the pair stays silent.
    this._engine = [null, null];
    this._screech = [null, null];
    this._engineRate = [0.6, 0.6];
    this._screechVol = [0, 0];

    // Per-player one-shot edge detection (wall/land/boost/tier).
    this._evt = [
      { wall: 0, land: 0, boost: 0, tier: -1 },
      { wall: 0, land: 0, boost: 0, tier: -1 },
    ];

    // Volume multipliers (0..1). Every SFX volume is scaled by _sfxVol.
    // Defaults are used; autosave.js applySnapshot() will restore saved values.
    this._sfxVol = 0.9;
    this._musicVol = 0.8;

    // Music fade multiplier (0..1) — separate from the user's _musicVol so
    // fades never clobber the stored preference. setMusicVol still writes the
    // raw preference; the SDK gets preference × fade.
    this._musicFade = 1;
    this._musicFadeTimer = null;

    // Music playlist
    this._order = shuffle(MUSIC_TRACKS);
    this._trackIdx = -1;
    this._musicHandle = null;
    this._musicOn = false;
    this._advancing = false;
    this._stalledChecks = 0;

    // Watchdog: advance the playlist when the current track ends.
    setInterval(() => this._musicWatchdog(), 1500);
  }

  // ---- Volume API (called from pause-menu sliders) --------------------------
  getVolumes() {
    return { sfx: this._sfxVol, music: this._musicVol };
  }

  setSfxVol(v) {
    this._sfxVol = Math.max(0, Math.min(1, v));
  }

  /** Push the current preference × fade into the SDK music gain. */
  _applyMusicVol() {
    audio.setMusicVolume(this._musicVol * this._musicFade);
  }

  /** Write the user's raw music preference (called from volume sliders). */
  setMusicVol(v) {
    this._musicVol = Math.max(0, Math.min(1, v));
    this._applyMusicVol();
  }

  /** Ramp the music fade multiplier from its current value to `to` (0..1)
   *  over `ms`. One interval animates the fade; a new call replaces any
   *  in-flight fade. */
  fadeMusic(to, ms) {
    if (this._musicFadeTimer) { clearInterval(this._musicFadeTimer); this._musicFadeTimer = null; }
    const from = this._musicFade;
    if (to === from) return;
    const steps = Math.max(1, Math.round(ms / 50));
    const stepMs = ms / steps;
    let i = 0;
    this._musicFadeTimer = setInterval(() => {
      i++;
      this._musicFade = from + (to - from) * Math.min(1, i / steps);
      this._applyMusicVol();
      if (i >= steps) { clearInterval(this._musicFadeTimer); this._musicFadeTimer = null; }
    }, stepMs);
  }

  /** Fade the music down to nothing (level teardown / quit to menu). */
  fadeOutMusic(ms) { this.fadeMusic(0, ms); }

  /** One-shot engine rev — played when START is pressed on the title screen.
   *  Plays for 1s, then fades out over ~0.4s and stops. */
  async rev() {
    await this._ready;
    const v0 = 0.75 * this._sfxVol;
    const h = audio.play("engine", { volume: v0, rate: 1.45 });
    if (!h) return;
    setTimeout(() => {
      const steps = 12, ms = 400 / steps;
      let i = 0;
      const iv = setInterval(() => {
        i++;
        try { h.setVolume(v0 * Math.max(0, 1 - i / steps)); } catch (_) {}
        if (i >= steps) { clearInterval(iv); try { h.stop(); } catch (_) {} }
      }, ms);
    }, 1000);
  }

  /** Menu OK / select blip. */
  async menuConfirm() {
    await this._ready;
    audio.play("confirm", { volume: this._sfxVol });
  }

  /** Menu cancel / deny blip (back out, unavailable mode, cancelled capture). */
  async menuDeny() {
    await this._ready;
    audio.play("deny", { volume: this._sfxVol });
  }

  /** Menu tick — played when the highlighted item moves. */
  async menuSelect() {
    await this._ready;
    audio.play("select", { volume: this._sfxVol });
  }

  /** Call on the first transition into RACE (after a user gesture). Idempotent;
   *  `multi` ensures a second engine/screech pair for P2, or retires a stale
   *  pair when switching back to single-player. */
  async startRace(multi) {
    await this._ready;
    if (!this._engine[0]) {
      this._engine[0] = audio.play("engine", { loop: true, volume: 0 });
      this._screech[0] = audio.play("screech", { loop: true, volume: 0 });
    }
    if (multi) {
      if (!this._engine[1]) {
        this._engine[1] = audio.play("engine", { loop: true, volume: 0 });
        this._screech[1] = audio.play("screech", { loop: true, volume: 0 });
      }
    } else {
      if (this._engine[1]) this._engine[1].stop();
      if (this._screech[1]) this._screech[1].stop();
      this._engine[1] = null;
      this._screech[1] = null;
      this._screechVol[1] = 0;
    }
    if (!this._musicOn) {
      this._musicOn = true;
      this._nextTrack();
    }
    // Bring the music back up after a teardown fade-out.
    this.fadeMusic(1, 500);
  }

  /** Play the menu theme (22. U-Turn) looping, replacing whatever was on.
   *  Menu mode owns the music — the race shuffle watchdog is disabled until
   *  startRace() hands control back. Safe to call on every MENU entry; a
   *  fresh loop starts each time the menu is (re)entered. */
  async playMenuMusic() {
    this._musicOn = false;
    this._stopMusic();
    const id = "music.menu";
    await this._ready;
    await audio.preload({ [id]: { src: MUSIC_TRACKS[MENU_TRACK_IDX], group: "music" } });
    const h = audio.play(id, { loop: true });
    if (h) { this._musicHandle = h; this._stalledChecks = 0; }
    this.fadeMusic(1, 400);
  }

  /** Per fixed step (60 Hz) while racing. `idx` picks the player's loop pair
   *  and one-shot event state: 0 = P1, 1 = P2 (split-screen). */
  update(v, controls, idx = 0) {
    const sv = this._sfxVol;
    const engine = this._engine[idx];
    const screech = this._screech[idx];
    const e = this._evt[idx];

    // --- Engine: pitch from speed, volume from throttle -----------------
    const spd = Math.min(1, Math.abs(v.speedF) / Math.max(0.01, TUNE.topSpeed));
    const boosting = v.boostT > 0;
    const targetRate = 0.55 + spd * 2.1 + (boosting ? 0.5 : 0);
    this._engineRate[idx] += (targetRate - this._engineRate[idx]) * 0.08; // smooth revs
    const targetVol = v.respawnT > 0
      ? 0
      : (0.10 + spd * 0.16 + (controls && controls.throttle ? 0.08 : 0) + (boosting ? 0.06 : 0)) * sv;
    if (engine) {
      ensurePlaying(engine);
      setRate(engine, this._engineRate[idx]);
      engine.setVolume(targetVol);
    }

    // --- Tire screech while drifting -------------------------------------
    const screeching = v.drifting && v.grounded && v.respawnT === 0;
    const screechTarget = screeching ? (0.10 + spd * 0.22) * sv : 0;
    this._screechVol[idx] += (screechTarget - this._screechVol[idx]) * 0.2;
    if (screech) {
      ensurePlaying(screech);
      setRate(screech, 0.9 + spd * 0.35 + (v.tier + 1) * 0.06);
      screech.setVolume(this._screechVol[idx]);
    }

    // --- One-shot events (edge-detected off this player's vehicle timers) --
    if (v.wallHitT > e.wall) {
      audio.play("crash", { volume: (0.35 + spd * 0.35) * sv });
    }
    if (v.landT > e.land) {
      audio.play("crunch", { volume: (0.25 + spd * 0.3) * sv });
    }
    if (v.boostT > e.boost + 1) {
      audio.play("boost", { volume: sv });
    }
    if (v.drifting && v.tier > e.tier && v.tier >= 0) {
      audio.play("tierup", { rate: 1 + v.tier * 0.2, volume: sv });
    }
    e.wall = v.wallHitT;
    e.land = v.landT;
    e.boost = v.boostT;
    e.tier = v.drifting ? v.tier : -1;
  }

  /** Silence the loops instantly (pause menu / leaving RACE). */
  duck() {
    for (const h of this._engine) if (h) h.setVolume(0);
    for (const h of this._screech) if (h) h.setVolume(0);
    this._screechVol = [0, 0];
  }

  // --- Music playlist ------------------------------------------------------
  /** Halt the current music handle (a looping menu theme or a one-shot race
   *  track) if any, so overlapping songs never play on a hand-off. */
  _stopMusic() {
    if (this._musicHandle) {
      try { this._musicHandle.stop(); } catch (_) {}
      this._musicHandle = null;
    }
  }

  async _nextTrack() {
    if (this._advancing || !this._musicOn) return;
    this._advancing = true;
    try {
      // A looping menu theme must die before the shuffle track starts.
      this._stopMusic();
      // Try tracks in shuffled order; skip any that fail to load.
      for (let attempts = 0; attempts < this._order.length; attempts++) {
        this._trackIdx = (this._trackIdx + 1) % this._order.length;
        if (this._trackIdx === 0) this._order = shuffle(this._order);
        const src = this._order[this._trackIdx];
        const id = "music." + src; // "music." prefix → SDK music volume group
        await audio.preload({ [id]: { src, group: "music" } });
        const h = audio.play(id, { loop: false });
        if (h) {
          this._musicHandle = h;
          this._stalledChecks = 0;
          return;
        }
      }
      this._musicHandle = null; // nothing loadable; watchdog will retry
    } finally {
      this._advancing = false;
    }
  }

  _musicWatchdog() {
    if (!this._musicOn || this._advancing || document.hidden) return;
    const h = this._musicHandle;
    if (!h || !h.playing) {
      // A couple of grace checks so slow starts aren't mistaken for track end.
      if (++this._stalledChecks >= 2) {
        this._stalledChecks = 0;
        this._nextTrack();
      }
    } else {
      this._stalledChecks = 0;
    }
  }
}

export const racerSound = new RacerSound();
