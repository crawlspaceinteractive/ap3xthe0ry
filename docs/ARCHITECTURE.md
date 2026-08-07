# ap3xthe0ry — Architecture

## Concept

A PS1-inspired arcade racer with a CPU software renderer, fixed-step physics,
track spline collision, and retro HUD styling.

## File Map

| File | Role |
|---|---|
| `index.html` | HTML shell and root container for the canvas. |
| `main.js` | Boots the `RacerGame`, creates the canvas, and starts the game loop. |
| `engine/renderer.js` | 320×240 software renderer, depth buffer, textured triangles, billboards, draw primitives, upscale + dither. |
| `engine/luts.js` | Precomputed trig, scale, and viewport lookup tables used by renderer and physics. |
| `engine/input.js` | Keyboard and gamepad input handling, button flags, axis sampling. |
| `engine/touch.js` | Optional mobile touch overlay for on-screen controls. |
| `engine/textureloader.js` | Image loading and texture sampling support for the renderer. |
| `engine/geometry.js` | GLB parsing and mesh preparation for the optional vehicle model. |
| `engine/ps1fx.js` | Color helpers, 15-bit quantization, shading, tinting, and palette utilities. |
| `engine/sdk-audio.js` | Local Star Audio SDK replacement used by the racer sound system. |
| `racer/racergame.js` | Main race orchestrator: loading, title, race, pause, fixed-step simulation, render loop. |
| `racer/track.js` | Catmull-Rom track spline and sample array used for physics and rendering. |
| `racer/vehicle.js` | Vehicle physics: drift, boost, wall bounce, jump ramp, respawn. |
| `racer/vehiclemesh.js` | Vehicle model preparation and fallback procedural kart renderer. |
| `racer/racerhud.js` | HUD rendering: speedometer, mileage, lap timer, status alerts, minimap, pause/title screens. |
| `racer/racersound.js` | Race audio: music, SFX, volume controls, start/pause ducking. |
| `racer/sky.js` | Parallax sky layers and horizon rendering. |
| `racer/scenery.js` | Environmental scenery objects along the track edges. |
| `tools/levelformat.js` | Level format validator and scene JSON schema for editor workflows. |
| `tools/hotreload.js` | Dev-time hot-reload helper for polling level JSON. |
| `tools/scene-editor.html` | Scene editor UI for authoring track and world data. |

## Render Pipeline

1. `clearSky()` fills the framebuffer with the sky gradient.
2. The race scene is built using track geometry, vehicle triangles, scenery, and particle effects.
3. `drawTriangle()` / `drawTexturedTriangle()` rasterize the scene into the depth buffer.
4. Particle and HUD draw passes are applied.
5. `present()` upsamples from 320×240 to 640×480 with nearest-neighbor scaling, Bayer dither, and 15-bit output quantization.

## Physics & Track

- The track is represented as a closed Catmull-Rom spline sampled into evenly spaced points.
- Each sample includes center position, forward tangent, right perpendicular, half-width, and arc distance.
- Vehicle physics map the car to the nearest track sample for ground height, lateral offset, and ramp detection.
- A jump ramp is built from a west-straight anchor point with an ease-in rise and steep drop-off.

## Vehicle System

- `racer/vehicle.js` decomposes velocity into forward and lateral components relative to the car heading.
- Drift engages when the player holds the handbrake while steering on the ground.
- Drift charge builds boost tiers and releases speed bursts for faster lap times.
- Wall collisions use the track boundary and apply bounce plus sticky drag to discourage wall-riding.

## HUD & UI

- HUD elements are drawn directly into the framebuffer after the 3D pass.
- The analog speedometer, mileage ticker, lap timer, minimap, and alerts are all rendered in software.
- The pause menu supports volume sliders and resume controls.

## Audio

- Race audio is driven by `racer/racersound.js` using the local SDK audio helper.
- Music and SFX volumes are adjustable from the pause menu.

## Notes

- The current active project is the racer build under `main.js` and `racer/`.
- The `game/` folder and the older legacy engine code remain in the repo as historical material but are not used by the current racer entrypoint.
