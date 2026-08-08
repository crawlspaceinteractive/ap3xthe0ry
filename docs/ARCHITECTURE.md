# Crawlspace Engine — Architecture (AP3X THE0RY)

## Concept
A PS1-style software-rendered arcade racer built on the shared Crawlspace
engine. The racer lives in racer/; the engine in engine/; game/ holds the
retired Froyo platformer (still shipped, unloaded by the racer boot).

## File Map — racer (racer/)

| File | Role |
|---|---|
| racergame.js | Orchestrator: states INTRO > MENU > RACE <> PAUSE; fixed-step 60Hz sim, asset load, headlight FX, particles, render |
| menus.js | MenuController — MAIN / GAMEMODES / COURSES / CONTROLS / OPTIONS / BINDINGS / ABOUT and PAUSE |
| titleintro.js | Boot cinematic: warning card, AP3X swoop, THE0RY slide, PRESS START, loading bar |
| vehicle.js | Arcade physics: accel/steer, drift + tier charge to boost, wall bounce, ramp lips, flips, TUNE tunables |
| vehiclemesh.js | GLB car renderer: bakes mesh, full yaw/pitch/roll, headlight rig; procedural kart fallback |
| levels.js | Level list / course catalog (LEVELS); every map registers here |
| track.js | Closed Catmull-Rom spline + spatial queries (same samples for physics and render) |
| trackload.js | Parse/fetch spline-editor JSON into buildTrack defs |
| trackrender.js | Builds track triangles from the shared sample array |
| chasecam.js | Third-person chase cam: yaw lag, speed distance, drift offset, look-ahead FOV, rear-view hold |
| hudfont.js | Sprite numeral + smallfont glyphs, loadHudFonts, draw helpers |
| racerhud.js | HUD overlay: speed gauge, drift meter, boost flash, position, lap times |
| racersound.js | All audio: 22-track shuffle, engine/screech loops, one-shots, rev fade, ducking |
| laptimer.js | Pure lap timer (arc-distance seam wrap); Node-testable |
| sky.js | Parallax fuji sky layers |
| scenery.js | Track-side scenery / silhouettes |

## File Map — engine (engine/, shared)

| File | Role |
|---|---|
| renderer.js | Software rasterizer: projection, triangles, textured faces, sprite billboards, sky, fog, present |
| geometry.js | GLB parsing (Three.js only for decode), mesh tris, animations (legacy Froyo) |
| textureloader.js | Image loading + cropToContent alpha-bbox crop |
| asseturls.js | CDN registry: nested basename to flat bucket UUID, assetUrl() |
| input.js | Keyboard + gamepad InputController, BTN_FLAGS, rebindable actions |
| audio.js / sdk-audio.js | Web Audio / platform audio SDK wrappers |
| spritesheet.js | drawSpriteFit + atlas blitting |
| crt.js | CRT/canvas post effects (optional) |
| tunable.js | tunable() live-tweak registry |
| state/camera/frustum/gamepad/profiler/touch/ps1fx/luts | Supporting engine helpers |

## File Map — platform Froyo (game/) [legacy — keep]

game.js, physics.js, world.js, islandatlas.js, camera.js (orbit),
breath.js, portal.js, hud.js, enemyai.js, hazards.js, collectibles.js,
flycam.js, hubworld.js, skypalette(s).js, textureatlas.js, tunables.js.
These power the retired Froyo platformer and are NOT loaded by the racer.

**Keep policy:** `game/` stays in the repo on purpose. Mine systems from
it later, or port features back into the shared Crawlspace engine feature
list. Do not delete as "unused."

## Boot flow (main.js to racer)

main.js mounts a 640x480 canvas and starts RacerGame. Asset loading is
gated by a loading bar inside the title cinematic; the menu orbits the
track until PLAY.

## Key state shapes

vehicle: { x,y,z, vx,vy,vz, yaw,pitch,roll, speedF, boostT, drifting, tier,
           respawnT, grounded, landT, wallHitT, odometer, trackIdx }
track: { controlPoints[], samples[], totalLen, s[].x/y/z, hw, arc }
camera (chase): { x,y,z, yaw, pitch, dist, height, fovMul }

## Rules

- docs/CHANGELOG.md is APPEND-ONLY - append at bottom, never rewrite.
- racerhud.js legacy drawTitle / drawLoading / drawPause were removed
  (pause now draws via MenuController). Keep HUD minimal.
- PS1 renderer internals (affine, vertex snap, dither, fog) live in
  engine/renderer.js - do not re-add WebGL.
- The racer's corridor is the track sample array; never fork it between
  physics and render.

## Render pipeline (racer, per frame)

1. clearSky -> sky layers
2. build track tris + scenery + vehicle mesh (buildVehicleTris)
3. sort tris -> draw (textured vs flat)
4. headlight rays, particle sprites, headlight glare
5. HUD (drawRacerHUD), overlay menu (menu.draw if MENU/PAUSE)
6. present() + optional fade (respawn)
