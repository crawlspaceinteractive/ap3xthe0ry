# Checkpoint — Documentation Updated

## Completed This Session

- Updated project docs to reflect the active arcade racer build.
- Clarified that `main.js` boots `RacerGame` and that `racer/` is the current game path.
- Noted that `game/` contains legacy parent-project code and is not used by the current entrypoint.
- Rewrote `docs/README.md`, `docs/ARCHITECTURE.md`, and `docs/DESIGN.md` to describe the racer project.

## Notes

- The current project is a PS1-style arcade racer with software rendering, track spline physics, and a retro HUD.
- `engine/` contains shared renderer and utility systems.
- `racer/` contains the active race logic, vehicle physics, HUD, track definition, scenery, and audio.
- `tools/` contains editor and hot-reload utilities for development.

## Legacy Content

- The repo retains legacy engine content from an earlier platformer/engine project in `game/` and other files.
- That content is not part of the active racer path but is preserved as historical reference.
