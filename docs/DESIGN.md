# ap3xthe0ry — Design Document

## Concept

A PS1-inspired arcade racer with retro physics, drift mechanics, and a programmable
track. The game emphasizes flow, boost management, and expressive vehicle control
inside a stylized low-resolution renderer.

## Core Mechanic

Players steer a kart along a closed track, balancing speed and drift to maintain
momentum. Boost is earned by holding drift and released for a burst of acceleration.
A single jump ramp provides a risk/reward moment where the car can launch off the
road and recover through careful throttle and steering.

## Art Style

- Internal rendering at 320×240, upscaled to 640×480 with pixelated output.
- Bayer 4×4 dither and 15-bit color quantization on the final output.
- The track uses clean, bright colors with a stylized horizon and parallax sky.
- Vehicle and scenery visuals are rendered in software using triangles, billboards,
  and textured sprites.

## Rendering Architecture

- The renderer writes directly into a `ImageData` buffer at 320×240.
- `engine/renderer.js` performs camera-space transforms, triangle rasterization,
  depth buffering, and texture sampling.
- The output is then nearest-neighbor scaled 2× to 640×480 and dithered.
- This design keeps the visual pipeline simple, deterministic, and free of WebGL.

## Track Design

- `racer/track.js` defines a closed Catmull-Rom spline using control points.
- The spline is sampled into a set of track samples with position, tangent, and
  perpendicular data.
- Track collision, ground height, and rendering all derive from the same sample
  array, ensuring consistent behavior.
- A ramp segment is defined explicitly on the west straight and adds vertical
  gameplay without requiring a separate physics system.

## Vehicle Physics

- The vehicle is modeled in heading space: forward velocity, lateral slip, and
  rotation are computed relative to the car's current yaw.
- Drift is a deliberate, controllable state with separate lateral grip values
  for normal driving, drifting, and air control.
- Boost charge accumulates while drifting and can be released in three tiers.
- Wall collisions apply a bounce impulse and additional drag to slow the car if it
  scrapes the boundary.
- Respawn occurs after a hard fall or reset input, placing the car back on track.

## Vehicle Presentation

- `racer/vehiclemesh.js` loads an optional GLB vehicle model when available.
- The model is fitted to a target length and transformed to match the engine's
  coordinate conventions.
- If the GLB model is unavailable, the system falls back to a procedural kart
  built from boxes.
- Headlight anchors and visual yaw/pitch/roll are derived from the prepared mesh.

## HUD & Feedback

- The HUD is rendered by `racer/racerhud.js` and includes:
  - Analog speedometer with half-transparent dial.
  - Speed and mileage numerals.
  - Lap timer with current and best lap display.
  - Top-right minimap showing the track and car heading.
  - Pause and title screens with bitmap text and menu sliders.
- Visual feedback is designed to be readable at low resolution and to remain
  consistent with the retro visual style.

## Audio Design

- `racer/racersound.js` manages music and sound effects with volume control.
- A local audio SDK proxy keeps audio self-contained and avoids external service
  dependencies.
- The pause menu ducks the race music and preserves SFX state while settings are
  adjusted.

## Tunables

- Live tuning is supported via `engine/tunable.js`.
- Vehicle physics values, model fit parameters, and audio settings can be
  adjusted without restarting the game.
- This enables quick iteration on game feel and balance.

## Project Scope

- The current project is focused on a single-player arcade racer experience.
- The racer build is the active path; legacy platformer engine systems in
  `game/` are kept for reference but not used by `main.js`.
- Tools in `tools/` support level editing and hot-reload workflows for development.
