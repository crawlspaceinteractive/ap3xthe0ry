/**
 * hotreload.js — dev-time level hot-reload (Phase 2.1)
 *
 * Polls a same-origin level JSON file and re-loads the world in-place when
 * the file changes — no page refresh, no menu round-trip. Point any level
 * producer (scene editor save, external export) at a file the dev server
 * serves (e.g. maps/dev-level.json), keep the game open with
 *   index.html?hotreload=maps/dev-level.json
 * and every re-save appears in-game within ~1.5s.
 *
 * Same-origin fetch only (platform CSP blocks third-party hosts).
 */
import { validateLevel } from "./levelformat.js";

export function startHotReload(game, url = "maps/dev-level.json", opts = {}) {
  const intervalMs  = opts.intervalMs ?? 1500;
  const loadInitial = opts.loadInitial ?? true;

  let lastText = null;
  let inflight = false;
  let missingLogged = false;

  const apply = (text) => {
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      console.warn("[hotreload] level JSON parse failed:", e);
      game.showNotice?.("HOT-RELOAD: BAD JSON");
      return;
    }
    const v = validateLevel(data);
    for (const w of v.warnings) console.warn("[hotreload]", w);
    if (!v.ok) {
      console.warn("[hotreload] level invalid:", v.errors);
      game.showNotice?.("HOT-RELOAD: INVALID LEVEL");
      return;
    }
    const ok = game.loadWorldFromSceneData(data);
    game.showNotice?.(ok ? "LEVEL RELOADED" : "LEVEL RELOAD FAILED");
    console.log("[hotreload] level applied from", url);
  };

  const poll = async () => {
    if (inflight) return;
    inflight = true;
    try {
      const sep = url.includes("?") ? "&" : "?";
      const res = await fetch(url + sep + "t=" + Date.now(), { cache: "no-store" });
      if (!res.ok) {
        if (!missingLogged) {
          console.warn(`[hotreload] ${url} → HTTP ${res.status} (will keep polling)`);
          missingLogged = true;
        }
        return;
      }
      missingLogged = false;
      const text = await res.text();
      if (lastText === null) {
        lastText = text;
        if (loadInitial) apply(text);
      } else if (text !== lastText) {
        lastText = text;
        apply(text);
      }
    } catch (e) {
      /* transient network error — keep polling silently */
    } finally {
      inflight = false;
    }
  };

  const timer = setInterval(poll, intervalMs);
  poll();
  console.log(`[hotreload] watching ${url} every ${intervalMs}ms`);
  return { stop() { clearInterval(timer); }, pollNow: poll };
}
