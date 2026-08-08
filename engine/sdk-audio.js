/**
 * engine/sdk-audio.js — Local replacement for Star SDK audio module.
 *
 * Provides synth-generated and file-based audio via the Web Audio API.
 * API-compatible with the Star SDK's audio.preload / audio.play /
 * audio.setMusicVolume / audio.setSfxVolume surface.
 *
 * Synth sounds: oscillator bursts rendered into AudioBuffers offline.
 * File sounds:  fetched + decoded into AudioBuffers.
 * All playback uses AudioBufferSourceNode + GainNode (no Howler dependency).
 */

let _ctx = null;
function getCtx() {
  if (!_ctx) {
    try { _ctx = new (window.AudioContext || window.webkitAudioContext)(); }
    catch (e) { console.warn("[sdk-audio] Web Audio not available:", e); return null; }
  }
  if (_ctx.state === "suspended") _ctx.resume();
  return _ctx;
}

// ---- Internal buffer cache ---------------------------------------------------
const _bufCache = new Map(); // id → AudioBuffer

async function _renderSynth(def) {
  const ctx = getCtx();
  if (!ctx) return null;
  const dur = def.duration || 0.3;
  const off = new OfflineAudioContext(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate);
  const osc = off.createOscillator();
  const env = off.createGain();
  osc.connect(env);
  env.connect(off.destination);
  osc.type = def.waveform || "sine";
  const freq = Array.isArray(def.frequency) ? def.frequency : [def.frequency || 440];
  const step = dur / Math.max(1, freq.length);
  for (let i = 0; i < freq.length; i++) {
    osc.frequency.setValueAtTime(freq[i], i * step);
  }
  const vol = def.volume ?? 0.5;
  env.gain.setValueAtTime(0, 0);
  if (def.envelope === "sustained") {
    env.gain.linearRampToValueAtTime(vol, 0.01);
    env.gain.setValueAtTime(vol, dur - 0.02);
    env.gain.linearRampToValueAtTime(0, dur);
  } else {
    env.gain.linearRampToValueAtTime(vol, 0.005);
    env.gain.exponentialRampToValueAtTime(0.001, dur);
  }
  osc.start(0);
  osc.stop(dur + 0.01);
  return off.startRendering();
}

async function _loadFile(url) {
  const ctx = getCtx();
  if (!ctx) return null;
  try {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(resp.status);
    const data = await resp.arrayBuffer();
    return await ctx.decodeAudioData(data);
  } catch (e) {
    console.warn("[sdk-audio] file load failed:", url, e);
    return null;
  }
}

// ---- Handle wrapper (Howler-compat) -----------------------------------------
function _makeHandle(source, gainNode, id) {
  const h = {
    playing: true,
    _soundId: 0,
    _source: source,
    _gain: gainNode,
    _id: id,
    setVolume(v) {
      gainNode.gain.setTargetAtTime(v, getCtx()?.currentTime ?? 0, 0.01);
    },
    stop() {
      try { source.stop(); } catch (_) {}
      h.playing = false;
    },
    // Howler-compat: ._howl.rate() and ._howl.play()
    _howl: {
      rate(r, _sid) {
        try { source.playbackRate.setTargetAtTime(r, getCtx()?.currentTime ?? 0, 0.01); } catch (_) {}
      },
      play(_sid) {
        // Replay from start (simplified — full Howler re-play not needed)
      },
    },
  };
  source.onended = () => { h.playing = false; };
  return h;
}

// ---- AudioEngine class ------------------------------------------------------
class AudioEngine {
  constructor() {
    this._musicVol = 0.8;
    this._sfxVol = 0.9;
    this._musicGain = null;
    this._sfxGain = null;
    this._initGains();
  }

  _initGains() {
    const ctx = getCtx();
    if (!ctx) return;
    this._musicGain = ctx.createGain();
    this._musicGain.gain.value = this._musicVol;
    this._musicGain.connect(ctx.destination);
    this._sfxGain = ctx.createGain();
    this._sfxGain.gain.value = this._sfxVol;
    this._sfxGain.connect(ctx.destination);
  }

  /**
   * Preload sound definitions.
   * @param {object} defs — { id: synthDef | fileDef | presetName }
   */
  async preload(defs) {
    const ctx = getCtx();
    if (!ctx) return;
    // Ensure gain nodes exist (first call after user gesture)
    if (!this._musicGain) this._initGains();

    const entries = Object.entries(defs);
    await Promise.all(entries.map(async ([id, def]) => {
      if (_bufCache.has(id)) return;
      let buf = null;
      if (def && typeof def === "object" && def.synth) {
        buf = await _renderSynth(def.synth);
      } else if (def && typeof def === "object" && def.src) {
        buf = await _loadFile(def.src);
      } else if (typeof def === "string" && def.startsWith("assets/")) {
        buf = await _loadFile(def);
      }
      if (buf) _bufCache.set(id, buf);
    }));
  }

  /**
   * Play a preloaded sound.
   * @param {string} id
   * @param {object} [opts] — { loop, volume, rate }
   * @returns {object|null} handle
   */
  play(id, opts = {}) {
    const ctx = getCtx();
    const buf = _bufCache.get(id);
    if (!ctx || !buf) return null;

    const source = ctx.createBufferSource();
    source.buffer = buf;
    source.loop = !!opts.loop;
    if (opts.rate) source.playbackRate.value = opts.rate;

    const gain = ctx.createGain();
    gain.gain.value = opts.volume ?? 0.5;

    // Route through group gain node
    const groupDef = this._getGroup(id);
    const dest = groupDef === "music" ? this._musicGain : this._sfxGain;
    source.connect(gain);
    gain.connect(dest);

    source.start(0);
    return _makeHandle(source, gain, id);
  }

  /** Internal: look up group for an id from the original preload defs. */
  _getGroup(id) {
    // Music tracks are preloaded with group:"music", everything else is "sfx"
    if (id.startsWith("music.")) return "music";
    return "sfx";
  }

  setMusicVolume(v) {
    this._musicVol = Math.max(0, Math.min(1, v));
    if (this._musicGain) this._musicGain.gain.value = this._musicVol;
  }

  setSfxVolume(v) {
    this._sfxVol = Math.max(0, Math.min(1, v));
    if (this._sfxGain) this._sfxGain.gain.value = this._sfxVol;
  }

  /**
   * Unlock the AudioContext after the first user gesture.
   * Browsers suspend the context until a user gesture (autoplay policy), so a
   * `play()` call before the first gesture schedules the sound but stays
   * SILENT until the context resumes — making the sound surface much later
   * than it was triggered (e.g. the boot-intro crash heard again on the title
   * screen). Call this on the first gesture to start the context immediately.
   * @returns {Promise<boolean>} true once the context is running.
   */
  unlock() {
    const ctx = getCtx();
    if (!ctx) return Promise.resolve(false);
    if (ctx.state === "running") return Promise.resolve(true);
    return ctx.resume().then(() => true).catch(() => false);
  }

  getMusicVolume() { return this._musicVol; }
  getSfxVolume() { return this._sfxVol; }
}

export const audio = new AudioEngine();
