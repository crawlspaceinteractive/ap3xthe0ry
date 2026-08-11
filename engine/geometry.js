/**
 * geometry.js — GLB loader + mesh-to-tris converter
 *
 * Three.js is used ONLY for parsing GLB files (player model).
 * ALL procedural world geometry (cubes, trapezoids, prisms, planks)
 * is handled by the pure-JS builders in renderer.js — no Three.js needed.
 *
 * Exports:
 *   threeReady()           — Promise; resolves when THREE + GLTFLoader available.
 *   isThreeReady()         — Synchronous; true once resolved.
 *   loadGLBMesh(url)       — Async. Parse a .glb → { vertices, normals, indices, colors }.
 *   buildMeshTris(...)     — GLB meshData → painter's-algo triangle records.
 *   extractMeshData()      — Low-level typed-array extractor from a BufferGeometry.
 *   syncThreeCamera(cam)   — No-op kept for API compatibility.
 *
 * Projection pipeline (v0.3):
 *   Uses the same engine-native toCameraSpace + projectCS math as renderer.js.
 *   Three.js is only used for loading/parsing the GLB file, NOT for projection.
 *   This guarantees the model renders exactly where the player sprite would be.
 */

// ─── Engine LUT imports (must be at top of module) ────────────────────────────
import { SCREEN_W, SCREEN_H, HALF_W, HALF_H, scaleAtX, scaleAtY, sinDeg, cosDeg } from "./luts.js";

// ─── Three.js CDN ──────────────────────────────────────────────────────────
// We use the ES-module build via an importmap-aware URL so bare specifiers
// ("three") resolve correctly.  The trick: load three.module.js first and
// stash it on window.THREE, then load the GLTFLoader addon which also uses
// the module build but resolves its own 'three' bare-specifier via the same
// CDN path.
//
// Strategy: use the esm.sh CDN which re-exports everything with proper
// relative paths — no bare specifiers, no importmap required.
const THREE_URL = "https://esm.sh/three@0.165.0";
const GLTF_URL  = "https://esm.sh/three@0.165.0/examples/jsm/loaders/GLTFLoader.js";

let _THREE      = null;
let _GLTFLoader = null;
let _readyProm  = null;
let _ready      = false;

// Internal Three.js camera — created once after THREE is loaded.
// Synced each frame via syncThreeCamera() before buildMeshTris is called.
let _threeCamera = null;
let _vec3        = null;   // reusable THREE.Vector3
let _mat4        = null;   // reusable THREE.Matrix4 for camera rebuild

// ─── Screen constants (imported from luts.js — must match renderer.js) ────────

// Vertical FOV derived from focal length: FOV_y = 2*atan(HALF_H/FOCAL_Y)
// FOCAL_Y = 143 → FOV_y ≈ 80°.  Aspect = 320/240 = 4:3 (output 640x480).
const CAM_FOV    = 80;          // degrees vertical
const CAM_ASPECT = SCREEN_W / SCREEN_H; // 4:3
const CAM_NEAR   = 0.4;
const CAM_FAR    = 1000.0;

// ─── Near-plane constant (must match renderer.js NEAR_Z) ─────────────────────
const NEAR_Z = 0.4;
const SCREEN_GUARD = 8192;

// ─── Directional light (matches renderer shading) ───────────────────────────
const LX = -0.4, LY = 0.8, LZ = -0.3;
const _lLen = Math.sqrt(LX*LX + LY*LY + LZ*LZ);
const LNX = LX/_lLen, LNY = LY/_lLen, LNZ = LZ/_lLen;


// Default island palette used when a game layer does not provide biome colors.
// Colors use the engine's packed RGBA form: 0xAABBGGRR.
const DEFAULT_ISLAND_PALETTE = {
  top:  0xff5b8d3a,
  side: 0xff5a3a2a,
};

function _validPackedColor(value, fallback) {
  return (typeof value === "number" && Number.isFinite(value)) ? (value >>> 0) : fallback;
}

function _resolveIslandPalette(palette) {
  return {
    top:  _validPackedColor(palette?.top,  DEFAULT_ISLAND_PALETTE.top),
    side: _validPackedColor(palette?.side, DEFAULT_ISLAND_PALETTE.side),
    biome: palette?.biome || "default",
    textureTop: palette?.textureTop || null,
    textureSide: palette?.textureSide || null,
    textureUnder: palette?.textureUnder || null,
    textureScale: (typeof palette?.textureScale === "number" && Number.isFinite(palette.textureScale)) ? palette.textureScale : 0.08,
  };
}

function zoneFromNormal(ny) {
  if (ny > 0.55) return "top";
  if (ny < -0.55) return "under";
  return "side";
}

function _setTerrainUVsForTri(cs0, cs1, cs2, wx0, wy0, wz0, wx1, wy1, wz1, wx2, wy2, wz2, nx, ny, nz, uvScale) {
  // PS1-style first pass: affine planar projection by surface orientation.
  // Top/under use XZ. Steep faces use the dominant horizontal axis plus Y.
  const any = Math.abs(ny);
  if (any > 0.55) {
    cs0.u = wx0 * uvScale; cs0.v = wz0 * uvScale;
    cs1.u = wx1 * uvScale; cs1.v = wz1 * uvScale;
    cs2.u = wx2 * uvScale; cs2.v = wz2 * uvScale;
    return;
  }

  if (Math.abs(nx) > Math.abs(nz)) {
    cs0.u = wz0 * uvScale; cs0.v = wy0 * uvScale;
    cs1.u = wz1 * uvScale; cs1.v = wy1 * uvScale;
    cs2.u = wz2 * uvScale; cs2.v = wy2 * uvScale;
  } else {
    cs0.u = wx0 * uvScale; cs0.v = wy0 * uvScale;
    cs1.u = wx1 * uvScale; cs1.v = wy1 * uvScale;
    cs2.u = wx2 * uvScale; cs2.v = wy2 * uvScale;
  }
}


// ─── Embedded GLB texture → CPU sampler ─────────────────────────────────────
// Converts a Three.js texture image (ImageBitmap / HTMLImageElement from the
// GLTFLoader) into the engine's CPU texture format ({width,height,data}) so
// the software rasterizer's drawTexturedTriangle can sample it.
// glTF UVs use a top-left origin (GLTFLoader sets flipY=false), which matches
// ImageData row order directly — no V flip needed.
function _cpuTextureFromImage(image) {
  try {
    const w = image.width || image.naturalWidth || 0;
    const h = image.height || image.naturalHeight || 0;
    if (!w || !h) return null;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(image, 0, 0);
    const data = ctx.getImageData(0, 0, w, h).data;
    return { width: w, height: h, data, wrap: true, nearest: true };
  } catch (err) {
    console.warn("[geometry] embedded texture extraction failed:", err);
    return null;
  }
}

// Per-mesh material textures → CPU samplers (deduped by source image).
// Returns an array aligned with `meshes`; entries are null for untextured
// meshes. A multi-mesh GLB commonly has a DIFFERENT texture per mesh, so a
// single "first texture found" is not enough — each mesh keeps its own.
function _extractGLBTexturesPerMesh(meshes) {
  const cache = new Map(); // image object → CPU texture (dedupe shared maps)
  return meshes.map((mesh) => {
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      if (m && m.map && m.map.image) {
        const img = m.map.image;
        if (cache.has(img)) {
          const cached = cache.get(img);
          if (cached) return cached;
          continue; // extraction failed before; try next material
        }
        const tex = _cpuTextureFromImage(img);
        cache.set(img, tex);
        if (tex) return tex;
      }
    }
    return null;
  });
}

// Expand per-mesh textures into a per-triangle lookup aligned with the merged
// index buffer (segments are concatenated in mesh order). Returns null when
// no mesh has a texture.
function _buildTriTextures(meshTextures, idxSegs) {
  if (!meshTextures.some((t) => t)) return null;
  let totalTris = 0;
  for (const seg of idxSegs) totalTris += (seg.length / 3) | 0;
  const triTextures = new Array(totalTris);
  let tOff = 0;
  for (let k = 0; k < idxSegs.length; k++) {
    const segTris = (idxSegs[k].length / 3) | 0;
    const tex = meshTextures[k] || null;
    for (let s = 0; s < segTris; s++) triTextures[tOff + s] = tex;
    tOff += segTris;
  }
  return triTextures;
}

// Recompute smooth per-vertex normals from triangle geometry.
// Used for baked animation frames where the rest-pose normal attribute no
// longer matches the deformed vertices.
function _computeVertexNormals(vertices, indices) {
  const normals = new Float32Array(vertices.length);
  for (let t = 0; t < indices.length; t += 3) {
    const i0 = indices[t] * 3, i1 = indices[t + 1] * 3, i2 = indices[t + 2] * 3;
    const ax = vertices[i1]   - vertices[i0];
    const ay = vertices[i1+1] - vertices[i0+1];
    const az = vertices[i1+2] - vertices[i0+2];
    const bx = vertices[i2]   - vertices[i0];
    const by = vertices[i2+1] - vertices[i0+1];
    const bz = vertices[i2+2] - vertices[i0+2];
    const nx = ay * bz - az * by;
    const ny = az * bx - ax * bz;
    const nz = ax * by - ay * bx;
    normals[i0] += nx; normals[i0+1] += ny; normals[i0+2] += nz;
    normals[i1] += nx; normals[i1+1] += ny; normals[i1+2] += nz;
    normals[i2] += nx; normals[i2+1] += ny; normals[i2+2] += nz;
  }
  for (let i = 0; i < normals.length; i += 3) {
    const len = Math.sqrt(normals[i]*normals[i] + normals[i+1]*normals[i+1] + normals[i+2]*normals[i+2]);
    if (len > 1e-8) {
      normals[i]   /= len;
      normals[i+1] /= len;
      normals[i+2] /= len;
    } else {
      normals[i+1] = 1;
    }
  }
  return normals;
}

function _shadePackedColor(packed, lit, mul = 1.0) {
  const r0 = packed & 0xff;
  const g0 = (packed >>> 8) & 0xff;
  const b0 = (packed >>> 16) & 0xff;
  const shade = lit * mul;
  const r = Math.max(0, Math.min(255, (r0 * shade) | 0));
  const g = Math.max(0, Math.min(255, (g0 * shade) | 0));
  const b = Math.max(0, Math.min(255, (b0 * shade) | 0));
  return ((0xff << 24) | (b << 16) | (g << 8) | r) >>> 0;
}

// ─── Public: threeReady / isThreeReady ───────────────────────────────────────

/**
 * Kick off Three.js + GLTFLoader import. Safe to call multiple times.
 * Only needed for GLB loading — world geometry no longer requires this.
 */
export function threeReady() {
  if (_readyProm) return _readyProm;
  _readyProm = (async () => {
    _THREE = await import(THREE_URL);
    const gltfMod = await import(GLTF_URL);
    _GLTFLoader = gltfMod.GLTFLoader;

    // Build the persistent Three.js perspective camera that mirrors the engine camera.
    _threeCamera = new _THREE.PerspectiveCamera(CAM_FOV, CAM_ASPECT, CAM_NEAR, CAM_FAR);
    _vec3 = new _THREE.Vector3();
    _mat4 = new _THREE.Matrix4();

    _ready = true;
    return { THREE: _THREE, GLTFLoader: _GLTFLoader };
  })();
  return _readyProm;
}

/** True once threeReady() has fully resolved. */
export function isThreeReady() { return _ready; }

// ─── syncThreeCamera ─────────────────────────────────────────────────────────
//
// Call this once per frame (before buildMeshTris) to push the engine camera's
// position, yaw, pitch and fovMul into _threeCamera's matrices.
// Three.js's view matrix is:  V = R_pitch * R_yaw * T(-pos)
// We rebuild it manually here so we match the engine's convention exactly.
//
export function syncThreeCamera(engineCamera) {
  if (!_threeCamera || !_THREE) return;
  const cam = _threeCamera;

  // Apply fovMul: narrower fov = zoom in.  Three.js uses vertical fov in degrees.
  const fov = CAM_FOV / (engineCamera.fovMul || 1.0);
  if (Math.abs(cam.fov - fov) > 0.01) {
    cam.fov = fov;
    cam.updateProjectionMatrix();
  }

  // Position
  cam.position.set(engineCamera.x, engineCamera.y, engineCamera.z);

  // Orientation: engine uses (yaw degrees CW around Y, pitch degrees around X).
  // Three.js default camera looks down -Z.
  // Rotation order: first yaw (Y), then pitch (X) — Euler 'YXZ'.
  cam.rotation.order = 'YXZ';
  // Engine yaw: positive = CW when viewed from above → negative in Three.js (right-hand).
  cam.rotation.y = (-engineCamera.yaw * Math.PI) / 180;
  // Engine pitch: positive = look down → in Three.js the camera pitches forward = negative X.
  cam.rotation.x = (-(engineCamera.pitch || 0) * Math.PI) / 180;
  cam.rotation.z = 0;

  cam.updateMatrixWorld(true);
}

// ─── Project a world-space point using the Three.js camera ──────────────────
//
// Returns { sx, sy, cz, visible } compatible with the engine's drawTriangle.
//   sx, sy  — integer screen-pixel coordinates
//   cz      — camera-space Z (depth for depth buffer)
//   visible — false if behind the near plane
//
function _projectTHREE(wx, wy, wz) {
  _vec3.set(wx, wy, wz);
  _vec3.project(_threeCamera); // NDC: x,y,z each in -1..+1

  // Depth: project() sets _vec3.z to NDC-Z.  We need camera-space Z for the
  // depth buffer.  Recover it from the view matrix (row 2, column 3 gives the
  // camera-space Z of the point).
  // Faster: dot the view matrix's Z-row with the world position.
  const mw = _threeCamera.matrixWorldInverse.elements;
  // camera-space Z = mw[2]*wx + mw[6]*wy + mw[10]*wz + mw[14]
  const camZ = mw[2]*wx + mw[6]*wy + mw[10]*wz + mw[14];

  if (camZ < NEAR_Z) return { sx: 0, sy: 0, cz: camZ, visible: false };

  let sx = _vec3.x *  HALF_W + HALF_W;
  let sy = _vec3.y * -HALF_H + HALF_H;
  if (!Number.isFinite(sx) || !Number.isFinite(sy)) {
    return { sx: 0, sy: 0, cz: camZ, visible: false };
  }
  if (sx < -SCREEN_GUARD) sx = -SCREEN_GUARD;
  else if (sx > SCREEN_GUARD) sx = SCREEN_GUARD;
  if (sy < -SCREEN_GUARD) sy = -SCREEN_GUARD;
  else if (sy > SCREEN_GUARD) sy = SCREEN_GUARD;
  return { sx: sx | 0, sy: sy | 0, cz: camZ, visible: true };
}

// ─── Near-plane clip (camera-space Sutherland-Hodgman, Z > NEAR_Z) ──────────
// Points are camera-space objects { cx, cy, cz } — same as before.
function _clipNear(pts) {
  const out = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const aIn = a.cz >= NEAR_Z;
    const bIn = b.cz >= NEAR_Z;
    if (aIn) out.push(a);
    if (aIn !== bIn) {
      const t = (NEAR_Z - a.cz) / (b.cz - a.cz);
      out.push({
        wx: a.wx + t * (b.wx - a.wx),
        wy: a.wy + t * (b.wy - a.wy),
        wz: a.wz + t * (b.wz - a.wz),
        cz: NEAR_Z,
      });
    }
  }
  return out;
}

function _emitClipped(worldPts, color, avgZ) {
  if (worldPts.length < 3) return [];
  const tris = [];
  const v0 = _projectTHREE(worldPts[0].wx, worldPts[0].wy, worldPts[0].wz);
  if (!v0.visible) return [];
  for (let i = 1; i + 1 < worldPts.length; i++) {
    const va = _projectTHREE(worldPts[i].wx,   worldPts[i].wy,   worldPts[i].wz);
    const vb = _projectTHREE(worldPts[i+1].wx, worldPts[i+1].wy, worldPts[i+1].wz);
    if (!va.visible || !vb.visible) continue;
    tris.push({ verts: [v0, va, vb], color, avgZ });
  }
  return tris;
}

// ─── Camera-space Z from the Three.js view matrix ─────────────────────────
// Used for per-vertex cz during clipping (before _projectTHREE is called).
function _camZ(wx, wy, wz) {
  const m = _threeCamera.matrixWorldInverse.elements;
  return m[2]*wx + m[6]*wy + m[10]*wz + m[14];
}

// ─── GLB mesh data extractor ─────────────────────────────────────────────────

export function extractMeshData(geo, matrixWorld = null, material = null) {
  const THREE = _THREE;
  if (!THREE) throw new Error("Call threeReady() and await it before extractMeshData()");

  const posAttr = geo.attributes.position;
  const nrmAttr = geo.attributes.normal;
  const colAttr = geo.attributes.color || geo.attributes.COLOR_0 || null;
  const uvAttr  = geo.attributes.uv || geo.attributes.TEXCOORD_0 || null;

  const count = posAttr.count;
  const vertices = new Float32Array(count * 3);
  const normals  = new Float32Array(count * 3);

  const vTmp = new THREE.Vector3();
  const nTmp = new THREE.Vector3();
  const normalMatrix = matrixWorld ? new THREE.Matrix3().getNormalMatrix(matrixWorld) : null;

  for (let i = 0; i < count; i++) {
    vTmp.fromBufferAttribute(posAttr, i);
    if (matrixWorld) vTmp.applyMatrix4(matrixWorld);
    vertices[i*3]   = vTmp.x;
    vertices[i*3+1] = vTmp.y;
    vertices[i*3+2] = vTmp.z;

    if (nrmAttr) {
      nTmp.fromBufferAttribute(nrmAttr, i);
      if (normalMatrix) nTmp.applyMatrix3(normalMatrix).normalize();
      normals[i*3]   = nTmp.x;
      normals[i*3+1] = nTmp.y;
      normals[i*3+2] = nTmp.z;
    }
  }

  let uvs = null;
  if (uvAttr) {
    uvs = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) {
      uvs[i*2] = uvAttr.getX(i);
      uvs[i*2+1] = uvAttr.getY(i);
    }
  }

  let colors = null;
  if (colAttr) {
    colors = new Float32Array(count * 4);
    const itemSize = colAttr.itemSize;
    for (let i = 0; i < count; i++) {
      colors[i*4]   = colAttr.getX(i);
      colors[i*4+1] = colAttr.getY(i);
      colors[i*4+2] = colAttr.getZ(i);
      colors[i*4+3] = itemSize >= 4 ? colAttr.getW(i) : 1.0;
    }
  } else if (material && material.color) {
    const mc = material.color;
    colors = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      colors[i*4]   = mc.r;
      colors[i*4+1] = mc.g;
      colors[i*4+2] = mc.b;
      colors[i*4+3] = 1.0;
    }
  }

  let indices;
  if (geo.index) {
    const src = geo.index.array;
    indices = src instanceof Uint32Array ? src : new Uint32Array(src);
  } else {
    indices = new Uint32Array(count);
    for (let i = 0; i < count; i++) indices[i] = i;
  }

  return { vertices, normals, indices, colors, uvs };
}

// ─── GLB loader ──────────────────────────────────────────────────────────────

export async function loadGLBMeshIfAvailable(url, name = "GLB model", required = false, opts = {}) {
  const label = `${name} @ ${url}`;
  // Directly attempt to load — avoid a preflight HEAD check that can fail on
  // API routes that don't support HEAD (returning non-405 error codes).
  // The GLTFLoader error callback handles genuine 404s cleanly.
  try {
    const mesh = await loadGLBMesh(url, opts);
    return mesh;
  } catch (err) {
    const msg = `[geometry] ${label} failed to load`;
    if (required) throw new Error(`${msg}: ${err.message}`);
    console.warn(msg, err);
    return null;
  }
}

// opts.applyNodeTransforms: bake each mesh node's matrixWorld into the
// vertices. Use this when the CALLER owns the full orientation transform
// (e.g. the racer's buildVehicleTris) so rotations/scales the creator baked
// into the GLB's scene nodes are respected. Leave off for the buildMeshTris
// path, which assumes local geometry space (see comment below).
export async function loadGLBMesh(url, opts = {}) {
  const applyNodeTransforms = !!opts.applyNodeTransforms;
  const { THREE, GLTFLoader } = await threeReady();

  return new Promise((resolve, reject) => {
    const loader = new GLTFLoader();
    loader.load(url, (gltf) => {
      const meshes = [];
      gltf.scene.traverse((node) => {
        if (node.isMesh && node.geometry) {
          node.updateMatrixWorld(true);
          meshes.push(node);
        }
      });

      if (meshes.length === 0) {
        reject(new Error("GLB contains no Mesh nodes"));
        return;
      }

      const allVerts   = [];
      const allNormals = [];
      const allColors  = [];
      const allUVs     = [];
      const allIndices = [];
      let indexOffset  = 0;
      let hasAnyColors = false;
      let hasAnyUVs    = false;

      for (const mesh of meshes) {
        const mat  = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
        // Default: pass null for matrixWorld so vertices stay in local
        // (geometry) space — buildMeshTris handles orientation via yawDeg +
        // worldX/Y/Z translation, and baking matrixWorld would double-rotate.
        // With opts.applyNodeTransforms, bake matrixWorld so creator-authored
        // node rotations/scales in the GLB are respected.
        const data = extractMeshData(
          mesh.geometry,
          applyNodeTransforms ? mesh.matrixWorld : null,
          mat || null
        );
        allVerts.push(data.vertices);
        allNormals.push(data.normals);
        allColors.push(data.colors);
        allUVs.push(data.uvs);
        if (data.colors) hasAnyColors = true;
        if (data.uvs) hasAnyUVs = true;

        const shiftedIdx = new Uint32Array(data.indices.length);
        for (let i = 0; i < data.indices.length; i++) {
          shiftedIdx[i] = data.indices[i] + indexOffset;
        }
        allIndices.push(shiftedIdx);
        indexOffset += data.vertices.length / 3;
      }

      const totalV     = allVerts.reduce((s, a) => s + a.length, 0);
      const totalI     = allIndices.reduce((s, a) => s + a.length, 0);
      const vertices   = new Float32Array(totalV);
      const normals    = new Float32Array(totalV);
      const indices    = new Uint32Array(totalI);
      const totalVerts = totalV / 3;
      const colors     = hasAnyColors ? new Float32Array(totalVerts * 4) : null;
      const uvs        = hasAnyUVs ? new Float32Array(totalVerts * 2) : null;

      let vOff = 0, cOff = 0, uvOff = 0, iOff = 0;
      for (let k = 0; k < allVerts.length; k++) {
        vertices.set(allVerts[k], vOff);
        normals.set(allNormals[k], vOff);

        const segVerts = allVerts[k].length / 3;
        if (colors) {
          if (allColors[k]) {
            colors.set(allColors[k], cOff);
          } else {
            for (let s = 0; s < segVerts; s++) {
              colors[cOff + s*4]   = 1.0;
              colors[cOff + s*4+1] = 1.0;
              colors[cOff + s*4+2] = 1.0;
              colors[cOff + s*4+3] = 1.0;
            }
          }
          cOff += segVerts * 4;
        }
        if (uvs) {
          if (allUVs[k]) {
            uvs.set(allUVs[k], uvOff);
          } else {
            for (let s = 0; s < segVerts; s++) {
              uvs[uvOff + s*2] = 0;
              uvs[uvOff + s*2+1] = 0;
            }
          }
          uvOff += segVerts * 2;
        }
        vOff += allVerts[k].length;
      }
      for (let k = 0; k < allIndices.length; k++) {
        indices.set(allIndices[k], iOff);
        iOff += allIndices[k].length;
      }

      // Embedded hand-painted textures → CPU samplers for the rasterizer.
      // Each mesh keeps its OWN texture (per-triangle lookup); `texture` stays
      // as "first found" so callers can truthiness-check texturedness.
      const meshTextures = _extractGLBTexturesPerMesh(meshes);
      const triTextures  = _buildTriTextures(meshTextures, allIndices);
      const texture      = meshTextures.find((t) => t) || null;

      resolve({ vertices, normals, indices, colors, uvs, texture, triTextures });
    }, undefined, reject);
  });
}

// ─── GLB animation baker ─────────────────────────────────────────────────────
//
// Loads a GLB whose first animation clip drives the mesh (skinned or rigid),
// samples the clip at a fixed fps, and bakes each pose into a flipbook frame
// with the SAME shape as a loadGLBMesh result:
//   { vertices, normals, indices, colors, uvs, texture }
// so every frame can be passed straight to buildMeshTris.
//
// NOTE: unlike loadGLBMesh (which deliberately ignores matrixWorld so
// buildMeshTris owns orientation), the baker MUST apply matrixWorld —
// the animated pose lives in the node/bone transforms.
//
// Returns { frames, frameCount, duration, texture, animated }.
export async function loadGLBAnimation(url, name = "GLB anim", { fps = 12, maxFrames = 24 } = {}) {
  const { THREE, GLTFLoader } = await threeReady();
  const gltf = await new Promise((resolve, reject) => {
    new GLTFLoader().load(url, resolve, undefined, reject);
  });

  const meshes = [];
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse((node) => {
    if (node.isMesh && node.geometry) meshes.push(node);
  });
  if (meshes.length === 0) throw new Error(`${name}: GLB contains no Mesh nodes`);

  // ── Shared topology (pose-independent): indices, uvs, colors ──────────────
  const segCounts = meshes.map((m) => m.geometry.attributes.position.count);
  const totalVerts = segCounts.reduce((s, c) => s + c, 0);

  let totalIdx = 0;
  const idxSegs = [];
  {
    let offset = 0;
    for (let k = 0; k < meshes.length; k++) {
      const geo = meshes[k].geometry;
      let seg;
      if (geo.index) {
        const src = geo.index.array;
        seg = new Uint32Array(src.length);
        for (let i = 0; i < src.length; i++) seg[i] = src[i] + offset;
      } else {
        seg = new Uint32Array(segCounts[k]);
        for (let i = 0; i < segCounts[k]; i++) seg[i] = i + offset;
      }
      idxSegs.push(seg);
      totalIdx += seg.length;
      offset += segCounts[k];
    }
  }
  const indices = new Uint32Array(totalIdx);
  {
    let o = 0;
    for (const s of idxSegs) { indices.set(s, o); o += s.length; }
  }

  let hasAnyUVs = false, hasAnyColors = false;
  for (const mesh of meshes) {
    const attrs = mesh.geometry.attributes;
    if (attrs.uv || attrs.TEXCOORD_0) hasAnyUVs = true;
    if (attrs.color || attrs.COLOR_0) hasAnyColors = true;
  }

  let uvs = null;
  if (hasAnyUVs) {
    uvs = new Float32Array(totalVerts * 2); // zero-filled for segments without UVs
    let vo = 0;
    for (let k = 0; k < meshes.length; k++) {
      const attrs = meshes[k].geometry.attributes;
      const uvAttr = attrs.uv || attrs.TEXCOORD_0 || null;
      if (uvAttr) {
        for (let i = 0; i < segCounts[k]; i++) {
          uvs[(vo + i) * 2]     = uvAttr.getX(i);
          uvs[(vo + i) * 2 + 1] = uvAttr.getY(i);
        }
      }
      vo += segCounts[k];
    }
  }

  let colors = null;
  if (hasAnyColors) {
    colors = new Float32Array(totalVerts * 4);
    let vo = 0;
    for (let k = 0; k < meshes.length; k++) {
      const attrs = meshes[k].geometry.attributes;
      const colAttr = attrs.color || attrs.COLOR_0 || null;
      for (let i = 0; i < segCounts[k]; i++) {
        const b = (vo + i) * 4;
        if (colAttr) {
          colors[b]     = colAttr.getX(i);
          colors[b + 1] = colAttr.getY(i);
          colors[b + 2] = colAttr.getZ(i);
          colors[b + 3] = colAttr.itemSize >= 4 ? colAttr.getW(i) : 1.0;
        } else {
          colors[b] = colors[b + 1] = colors[b + 2] = colors[b + 3] = 1.0;
        }
      }
      vo += segCounts[k];
    }
  }

  const meshTextures = _extractGLBTexturesPerMesh(meshes);
  const triTextures  = _buildTriTextures(meshTextures, idxSegs);
  const texture      = meshTextures.find((t) => t) || null;

  // ── Bake the clip into flipbook frames ────────────────────────────────────
  const clip = (gltf.animations && gltf.animations.length) ? gltf.animations[0] : null;
  const clipDur = clip ? (clip.duration || 0) : 0;
  const frameCount = (clip && clipDur > 0)
    ? Math.max(2, Math.min(maxFrames, Math.round(clipDur * fps)))
    : 1;

  let mixer = null;
  if (clip) {
    mixer = new THREE.AnimationMixer(gltf.scene);
    mixer.clipAction(clip).play();
  }

  const vTmp = new THREE.Vector3();
  const frames = [];
  for (let f = 0; f < frameCount; f++) {
    if (mixer) {
      mixer.setTime(clipDur * f / frameCount);
      gltf.scene.updateMatrixWorld(true);
    }
    const vertices = new Float32Array(totalVerts * 3);
    let vo = 0;
    for (let k = 0; k < meshes.length; k++) {
      const mesh = meshes[k];
      const pos = mesh.geometry.attributes.position;
      const skinned = mesh.isSkinnedMesh && typeof mesh.boneTransform === "function";
      for (let i = 0; i < segCounts[k]; i++) {
        if (skinned) {
          mesh.boneTransform(i, vTmp); // deformed pos in the SkinnedMesh's local space
        } else {
          vTmp.fromBufferAttribute(pos, i);
        }
        vTmp.applyMatrix4(mesh.matrixWorld);
        const b = (vo + i) * 3;
        vertices[b]     = vTmp.x;
        vertices[b + 1] = vTmp.y;
        vertices[b + 2] = vTmp.z;
      }
      vo += segCounts[k];
    }
    // Rest-pose normals no longer match the deformed verts — rebuild.
    const normals = _computeVertexNormals(vertices, indices);
    frames.push({ vertices, normals, indices, colors, uvs, texture, triTextures });
  }

  return {
    frames,
    frameCount,
    duration: clipDur || frameCount / fps,
    texture,
    triTextures,
    animated: !!clip,
  };
}

// ─── Engine-native camera helpers ─────────────────────────────────────────────
// Mirrors renderer.js toCameraSpace / projectCS exactly, using the same
// LUT-based trig so GLB vertices project identically to all other geometry.

function _engToCameraSpace(wx, wy, wz, cam) {
  const dx = wx - cam.x;
  const dy = wy - cam.y;
  const dz = wz - cam.z;
  const cy = cosDeg(-cam.yaw);
  const sy = sinDeg(-cam.yaw);
  let cx  =  dx * cy + dz * sy;
  let cz  = -dx * sy + dz * cy;
  let cyy = dy;
  const pitch = cam.pitch || 0;
  if (pitch !== 0) {
    const cp = cosDeg(pitch);
    const sp = sinDeg(pitch);
    const cyy2 = cyy * cp + cz * sp;
    const cz2  = -cyy * sp + cz * cp;
    cyy = cyy2;
    cz  = cz2;
  }
  return { cx, cy: cyy, cz };
}

function _engProjectCS(cs, cam) {
  if (cs.cz < NEAR_Z) return { sx: 0, sy: 0, cz: cs.cz, visible: false };
  const fovMul = cam.fovMul || 1.0;
  let sx = HALF_W + cs.cx * scaleAtX(cs.cz) * fovMul;
  let sy = HALF_H - cs.cy * scaleAtY(cs.cz) * fovMul;
  if (!Number.isFinite(sx) || !Number.isFinite(sy)) {
    return { sx: 0, sy: 0, cz: cs.cz, visible: false };
  }
  if (sx < -SCREEN_GUARD) sx = -SCREEN_GUARD;
  else if (sx > SCREEN_GUARD) sx = SCREEN_GUARD;
  if (sy < -SCREEN_GUARD) sy = -SCREEN_GUARD;
  else if (sy > SCREEN_GUARD) sy = SCREEN_GUARD;
  return { sx: sx | 0, sy: sy | 0, cz: cs.cz, u: cs.u ?? 0, v: cs.v ?? 0, visible: true };
}

function _engClipNear(pts) {
  const out = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const aIn = a.cz >= NEAR_Z;
    const bIn = b.cz >= NEAR_Z;
    if (aIn) out.push(a);
    if (aIn !== bIn) {
      const t = (NEAR_Z - a.cz) / (b.cz - a.cz);
      out.push({
        cx: a.cx + t * (b.cx - a.cx),
        cy: a.cy + t * (b.cy - a.cy),
        cz: NEAR_Z,
        u: (a.u ?? 0) + t * ((b.u ?? 0) - (a.u ?? 0)),
        v: (a.v ?? 0) + t * ((b.v ?? 0) - (a.v ?? 0)),
      });
    }
  }
  return out;
}

function _engEmitClipped(csPts, color, avgZ, cam, texture = null, zone = null, biome = null) {
  if (csPts.length < 3) return [];
  const tris = [];
  const v0 = _engProjectCS(csPts[0], cam);
  if (!v0.visible) return [];
  for (let i = 1; i + 1 < csPts.length; i++) {
    const va = _engProjectCS(csPts[i], cam);
    const vb = _engProjectCS(csPts[i+1], cam);
    if (!va.visible || !vb.visible) continue;
    tris.push({ verts: [v0, va, vb], color, avgZ, texture, zone, biome });
  }
  return tris;
}

// ─── GLB → painter's tris  (engine-native projection path) ───────────────────
//
// Transforms GLB vertex data through the same toCameraSpace + projectCS math
// used by ALL other geometry in renderer.js. This guarantees the model lands
// exactly where the player sprite sits — no Three.js camera mismatch.
//
// syncThreeCamera() is no longer needed for projection but kept for any
// other callers that may reference it.
//
// colorMode options:
//   undefined / false     — default: use vertex colors or baseColor with lighting
//   "froyo"               — bottom half orange, top uses vertex/base color
//   "flatRed"             — force solid red (255,30,30) on every triangle (cherry)
//   "sprinkleGradient"    — vertical magenta→cyan gradient, self-lit (sprinkle gems)
//   "flatYellow"          — force flat yellow (255,210,0) on every triangle (sun)
//   "flatBrown"           — force flat brown on every triangle (bridge)
//   "sunZone"             — yellow on triangles within the primary sphere radius,
//                           black on ray/spike geometry outside that radius
//   "island"              — biome palette flat top faces, gradient sides/bottom
//   "skyDome"             — old sky gradient or game-provided level palette
//   "skyRing"             — old purple ring or game-provided level palette
//   "textured"            — sample the GLB's embedded texture via its own UVs
//                           (also auto-enables in default mode when the mesh
//                           carries an embedded texture + UVs)
export function buildMeshTris(meshData, worldX, worldY, worldZ, baseColor, camera, _unusedProjectFn, scale = 1, yawDeg = 0, colorMode = false, islandPalette = null) {
  if (!camera) return [];

  // Legacy boolean support: tintBottomOrange=true maps to "froyo"
  if (colorMode === true) colorMode = "froyo";

  const { vertices, normals, indices, colors, uvs } = meshData;
  const tris = [];

  const br = (baseColor)        & 0xff;
  const bg = (baseColor >>> 8)  & 0xff;
  const bb = (baseColor >>> 16) & 0xff;
  const islandPal = _resolveIslandPalette(islandPalette);

  const rad  = (yawDeg * Math.PI) / 180;
  const cosY = Math.cos(rad);
  const sinY = Math.sin(rad);
  const triCount = (indices.length / 3) | 0;

  // Local-space center offset: subtract before rotating so the model spins
  // around its own geometric center instead of the geometry origin.
  const lcx = meshData.localCX ?? 0;
  const lcy = meshData.localCY ?? 0;
  const lcz = meshData.localCZ ?? 0;

  // For sunZone mode: compute the primary sphere radius from the bounding box.
  // The sun model is roughly a sphere with rays/spikes sticking out.
  // We use half the model's Y extent as the sphere radius — rays extend beyond it.
  let sunSphereR = 0;
  if (colorMode === "sunZone" && meshData._sunSphereR !== undefined) {
    sunSphereR = meshData._sunSphereR;
  } else if (colorMode === "sunZone") {
    // Estimate: measure max Y-axis extent (sphere diameter ≈ half the total height).
    // The sun GLB typically has a big central sphere and thin spike rays.
    // We'll compute the tight bounding sphere radius from vertex distances.
    let maxR = 0;
    for (let i = 0; i < vertices.length; i += 3) {
      const dx = vertices[i]   - lcx;
      const dy = vertices[i+1] - lcy;
      const dz = vertices[i+2] - lcz;
      const r  = Math.sqrt(dx*dx + dy*dy + dz*dz);
      if (r > maxR) maxR = r;
    }
    // Primary sphere = ~55% of the max radius (rays stick out further)
    sunSphereR = maxR * 0.55;
    meshData._sunSphereR = sunSphereR; // cache on mesh object
  }

  for (let t = 0; t < triCount; t++) {
    const i0 = indices[t*3], i1 = indices[t*3+1], i2 = indices[t*3+2];

    // Step 1: subtract bounding-box center (pivot at model center)
    const lx0 = vertices[i0*3] - lcx, ly0 = vertices[i0*3+1] - lcy, lz0 = vertices[i0*3+2] - lcz;
    const lx1 = vertices[i1*3] - lcx, ly1 = vertices[i1*3+1] - lcy, lz1 = vertices[i1*3+2] - lcz;
    const lx2 = vertices[i2*3] - lcx, ly2 = vertices[i2*3+1] - lcy, lz2 = vertices[i2*3+2] - lcz;

    // Step 2: scale + yaw rotation + world translation
    const wx0 = (lx0*cosY + lz0*sinY)*scale + worldX;
    const wy0 = ly0*scale + worldY;
    const wz0 = (-lx0*sinY + lz0*cosY)*scale + worldZ;

    const wx1 = (lx1*cosY + lz1*sinY)*scale + worldX;
    const wy1 = ly1*scale + worldY;
    const wz1 = (-lx1*sinY + lz1*cosY)*scale + worldZ;

    const wx2 = (lx2*cosY + lz2*sinY)*scale + worldX;
    const wy2 = ly2*scale + worldY;
    const wz2 = (-lx2*sinY + lz2*cosY)*scale + worldZ;

    // Step 3: world → camera space using the engine's own transform
    const cs0 = _engToCameraSpace(wx0, wy0, wz0, camera);
    const cs1 = _engToCameraSpace(wx1, wy1, wz1, camera);
    const cs2 = _engToCameraSpace(wx2, wy2, wz2, camera);

    // Discard if all three vertices are behind the near plane
    if (cs0.cz < NEAR_Z && cs1.cz < NEAR_Z && cs2.cz < NEAR_Z) continue;

    // Flat-shaded lighting (averaged face normal rotated by yaw)
    const rn0x = normals[i0*3]*cosY + normals[i0*3+2]*sinY;
    const rn0y = normals[i0*3+1];
    const rn0z = -normals[i0*3]*sinY + normals[i0*3+2]*cosY;
    const rn1x = normals[i1*3]*cosY + normals[i1*3+2]*sinY;
    const rn1y = normals[i1*3+1];
    const rn1z = -normals[i1*3]*sinY + normals[i1*3+2]*cosY;
    const rn2x = normals[i2*3]*cosY + normals[i2*3+2]*sinY;
    const rn2y = normals[i2*3+1];
    const rn2z = -normals[i2*3]*sinY + normals[i2*3+2]*cosY;

    const nx2 = (rn0x+rn1x+rn2x)/3;
    const ny2 = (rn0y+rn1y+rn2y)/3;
    const nz2 = (rn0z+rn1z+rn2z)/3;

    const dot = nx2*LNX + ny2*LNY + nz2*LNZ;
    const lit = 0.30 + 0.70 * Math.max(0, dot);

    // Average local position of the three verts (center-relative)
    const avgLocalX = (lx0 + lx1 + lx2) / 3;
    const avgLocalY = (ly0 + ly1 + ly2) / 3;
    const avgLocalZ = (lz0 + lz1 + lz2) / 3;
    const avgLocalR = Math.sqrt(avgLocalX*avgLocalX + avgLocalY*avgLocalY + avgLocalZ*avgLocalZ);

    // Orange for bottom half: RGB(255, 140, 0)
    const ORANGE_R = 255, ORANGE_G = 140, ORANGE_B = 0;

    let color;
    let texture = null;
    let zone = null;
    let biome = null;
    if (colorMode === "skyDome") {
      // Biome-aware sky gradient. The game layer may pass a level/sky palette;
      // if it does not, this preserves the old warm purple-orange style.
      if (!meshData._skyYMin) {
        let mn = Infinity, mx = -Infinity;
        for (let vi = 0; vi < vertices.length; vi += 3) {
          const yy = vertices[vi+1] - (meshData.localCY || 0);
          if (yy < mn) mn = yy; if (yy > mx) mx = yy;
        }
        meshData._skyYMin = mn; meshData._skyYMax = mx;
      }
      const ySpan = meshData._skyYMax - meshData._skyYMin || 1;
      const t = Math.max(0, Math.min(1, (avgLocalY - meshData._skyYMin) / ySpan));
      if (islandPalette) {
        const lo = islandPal.side; // horizon / lower sky
        const hi = islandPal.top;  // upper sky
        const lr = lo & 255, lg = (lo >>> 8) & 255, lb = (lo >>> 16) & 255;
        const hr = hi & 255, hg = (hi >>> 8) & 255, hb = (hi >>> 16) & 255;
        const r = Math.min(255, (lr + (hr - lr) * t) | 0);
        const g = Math.min(255, (lg + (hg - lg) * t) | 0);
        const b = Math.min(255, (lb + (hb - lb) * t) | 0);
        color = (0xff << 24) | (b << 16) | (g << 8) | r;
      } else {
        // t=0 → bottom/orange (255,120,40), t=1 → top/purple (160,60,220)
        const pr = Math.min(255, (255 + (160 - 255) * t) | 0);
        const pg = Math.min(255, (120 + ( 60 - 120) * t) | 0);
        const pb = Math.min(255, ( 40 + (220 -  40) * t) | 0);
        color = (0xff << 24) | (pb << 16) | (pg << 8) | pr;
      }
    } else if (colorMode === "skyRing") {
      // Biome-aware sky ring. Geometry only classifies the surface zone;
      // the game-provided sky palette/atlas decides what each zone means.
      zone = zoneFromNormal(ny2);
      biome = islandPal.biome;

      const ringBase = islandPalette
        ? (zone === "top" ? islandPal.top : islandPal.side)
        : 0xffdc3ca0;

      color = _shadePackedColor(ringBase, lit, 1.0);

      texture = islandPalette
        ? (zone === "top"
            ? islandPal.textureTop
            : zone === "under"
              ? (islandPal.textureUnder || islandPal.textureSide)
              : islandPal.textureSide)
        : null;

      if (texture) {
        _setTerrainUVsForTri(
          cs0, cs1, cs2,
          wx0, wy0, wz0, wx1, wy1, wz1, wx2, wy2, wz2,
          nx2, ny2, nz2,
          islandPal.textureScale || 0.035
        );
      }
    } else if (colorMode === "flatRed") {
      // Cherry: force solid red on every triangle
      const r  = Math.min(255, (220 * lit) | 0);
      const g  = Math.min(255, (30  * lit) | 0);
      const b2 = Math.min(255, (30  * lit) | 0);
      color = (0xff << 24) | (b2 << 16) | (g << 8) | r;
    } else if (colorMode === "sprinkleGradient") {
      // Sprinkle gem: vivid vertical gradient (hot magenta base → bright cyan tip).
      // Mostly self-lit (high ambient floor) so gems pop against terrain shading.
      if (meshData._sprinkleYMin === undefined) {
        let mn = Infinity, mx = -Infinity;
        for (let vi = 0; vi < vertices.length; vi += 3) {
          const yy = vertices[vi+1] - lcy;
          if (yy < mn) mn = yy; if (yy > mx) mx = yy;
        }
        meshData._sprinkleYMin = mn; meshData._sprinkleYMax = mx;
      }
      const ySpan = meshData._sprinkleYMax - meshData._sprinkleYMin || 1;
      const tt = Math.max(0, Math.min(1, (avgLocalY - meshData._sprinkleYMin) / ySpan));
      const glit = 0.72 + 0.28 * Math.max(0, dot); // self-lit floor
      // bottom (255,50,190) magenta → top (90,240,255) cyan
      const gr = 255 + (90  - 255) * tt;
      const gg = 50  + (240 -  50) * tt;
      const gb = 190 + (255 - 190) * tt;
      const r  = Math.min(255, (gr * glit) | 0);
      const g  = Math.min(255, (gg * glit) | 0);
      const b2 = Math.min(255, (gb * glit) | 0);
      color = (0xff << 24) | (b2 << 16) | (g << 8) | r;
    } else if (colorMode === "sunVertex") {
      // Sun with sunglasses: use the GLB's own vertex colors so the sunglasses
      // (dark triangles in the model) stay dark, while the yellow sun body stays yellow.
      // If no vertex colors present, fall back to flat yellow.
      if (colors) {
        const cr = (colors[i0*4]   + colors[i1*4]   + colors[i2*4])   / 3;
        const cg = (colors[i0*4+1] + colors[i1*4+1] + colors[i2*4+1]) / 3;
        const cb = (colors[i0*4+2] + colors[i1*4+2] + colors[i2*4+2]) / 3;
        // Boost yellow: if the vertex color is already yellowish (r>0.6, g>0.5, b<0.3)
        // push it toward the bright sun yellow. Dark triangles (sunglasses) stay dark.
        const brightness = (cr + cg + cb) / 3;
        let fr, fg, fb;
        if (brightness > 0.35) {
          // Bright region — blend toward vivid yellow (1.0, 0.82, 0.0)
          const blend = Math.min(1, brightness * 1.4);
          fr = cr + (1.00 - cr) * blend * 0.7;
          fg = cg + (0.82 - cg) * blend * 0.7;
          fb = cb * (1 - blend * 0.9);
        } else {
          // Dark region (sunglasses, pupils) — preserve the darkness
          fr = cr * 0.8;
          fg = cg * 0.8;
          fb = cb * 0.8;
        }
        const r  = Math.min(255, (fr * 255 * lit) | 0);
        const g  = Math.min(255, (fg * 255 * lit) | 0);
        const b2 = Math.min(255, (fb * 255 * lit) | 0);
        color = (0xff << 24) | (b2 << 16) | (g << 8) | r;
      } else {
        // No vertex colors — flat yellow
        const r  = Math.min(255, (255 * lit) | 0);
        const g  = Math.min(255, (210 * lit) | 0);
        const b2 = 0;
        color = (0xff << 24) | (b2 << 16) | (g << 8) | r;
      }
    } else if (colorMode === "flatYellow") {
      // Sun: force flat yellow (255,210,0) on every triangle
      const r  = Math.min(255, (255 * lit) | 0);
      const g  = Math.min(255, (210 * lit) | 0);
      const b2 = 0;
      color = (0xff << 24) | (b2 << 16) | (g << 8) | r;
    } else if (colorMode === "flatBrown") {
      // Bridge: warm brown (160,100,50)
      const r  = Math.min(255, (160 * lit) | 0);
      const g  = Math.min(255, (100 * lit) | 0);
      const b2 = Math.min(255, ( 50 * lit) | 0);
      color = (0xff << 24) | (b2 << 16) | (g << 8) | r;
    } else if (colorMode === "island") {
      // Islands inherit their top/side colors from the game biome palette.
      // Classify by face normal Y component: flat-top (ny > 0.55) = top zone,
      // otherwise side/underside gets a height-darkened version of the side color.
      const rn0y2 = normals[i0*3+1], rn1y2 = normals[i1*3+1], rn2y2 = normals[i2*3+1];
      const faceNY = (rn0y2 + rn1y2 + rn2y2) / 3;
      if (faceNY > 0.55) {
        color = _shadePackedColor(islandPal.top, lit);
        texture = islandPal.textureTop || null;
      } else {
        // Cache island Y extent for gradient
        if (meshData._islandYMin === undefined) {
          let mn = Infinity, mx = -Infinity;
          for (let vi = 0; vi < vertices.length; vi += 3) {
            const yy = vertices[vi+1];
            if (yy < mn) mn = yy; if (yy > mx) mx = yy;
          }
          meshData._islandYMin = mn; meshData._islandYMax = mx;
        }
        const ySpan = meshData._islandYMax - meshData._islandYMin || 1;
        // t=0 bottom → darker side color, t=1 top → full side color.
        const rawY = vertices[i0*3+1] + vertices[i1*3+1] + vertices[i2*3+1];
        const tt = Math.max(0, Math.min(1, (rawY / 3 - meshData._islandYMin) / ySpan));
        const sideMul = 0.55 + tt * 0.45;
        color = _shadePackedColor(islandPal.side, lit, sideMul);
        texture = (faceNY < -0.35 ? islandPal.textureUnder : islandPal.textureSide) || null;
      }

      if (texture) {
        _setTerrainUVsForTri(
          cs0, cs1, cs2,
          wx0, wy0, wz0, wx1, wy1, wz1, wx2, wy2, wz2,
          nx2, faceNY, nz2,
          islandPal.textureScale
        );
      }
    } else if (colorMode === "sunZone") {
      // Sun: yellow core sphere, black on spikes/rays outside sphere
      const inSphere = avgLocalR <= sunSphereR;
      if (inSphere) {
        // Bright yellow
        const r  = Math.min(255, (255 * lit) | 0);
        const g  = Math.min(255, (210 * lit) | 0);
        const b2 = 0;
        color = (0xff << 24) | (b2 << 16) | (g << 8) | r;
      } else {
        // Pure black for spikes/rays
        const dark = (lit * 30) | 0;
        color = (0xff << 24) | (dark << 16) | (dark << 8) | dark;
      }
    } else if (colorMode === "froyo") {
      const isBottom = avgLocalY < 0;
      if (isBottom) {
        // Froyo player model: bottom half forced orange
        const r  = Math.min(255, (ORANGE_R * lit) | 0);
        const g  = Math.min(255, (ORANGE_G * lit) | 0);
        const b2 = Math.min(255, (ORANGE_B * lit) | 0);
        color = (0xff << 24) | (b2 << 16) | (g << 8) | r;
      } else if (colors) {
        const cr = (colors[i0*4]   + colors[i1*4]   + colors[i2*4])   / 3;
        const cg = (colors[i0*4+1] + colors[i1*4+1] + colors[i2*4+1]) / 3;
        const cb = (colors[i0*4+2] + colors[i1*4+2] + colors[i2*4+2]) / 3;
        const r  = Math.min(255, (cr*255*lit) | 0);
        const g  = Math.min(255, (cg*255*lit) | 0);
        const b2 = Math.min(255, (cb*255*lit) | 0);
        color = (0xff << 24) | (b2 << 16) | (g << 8) | r;
      } else {
        const r  = Math.min(255, (br*lit) | 0);
        const g  = Math.min(255, (bg*lit) | 0);
        const b2 = Math.min(255, (bb*lit) | 0);
        color = (0xff << 24) | (b2 << 16) | (g << 8) | r;
      }
    } else if ((colorMode === "textured" || !colorMode) && meshData.texture && uvs) {
      // Embedded hand-painted textures: sample the GLB's own UVs and let the
      // rasterizer tint texels by the lit base color (pass white for pure
      // texture). Multi-mesh GLBs carry a per-triangle texture lookup
      // (triTextures) so EACH mesh samples its own painted map — not just the
      // first one found. Auto-enables for any default-mode model with an
      // embedded texture; terrain modes ("island"/"skyRing") keep palettes.
      texture = meshData.triTextures ? (meshData.triTextures[t] || null) : meshData.texture;
      if (texture) {
        cs0.u = uvs[i0*2]; cs0.v = uvs[i0*2+1];
        cs1.u = uvs[i1*2]; cs1.v = uvs[i1*2+1];
        cs2.u = uvs[i2*2]; cs2.v = uvs[i2*2+1];
        const r  = Math.min(255, (br*lit) | 0);
        const g  = Math.min(255, (bg*lit) | 0);
        const b2 = Math.min(255, (bb*lit) | 0);
        color = (0xff << 24) | (b2 << 16) | (g << 8) | r;
      } else if (colors) {
        // This mesh segment has no texture — fall back to its vertex colors.
        const cr = (colors[i0*4]   + colors[i1*4]   + colors[i2*4])   / 3;
        const cg = (colors[i0*4+1] + colors[i1*4+1] + colors[i2*4+1]) / 3;
        const cb = (colors[i0*4+2] + colors[i1*4+2] + colors[i2*4+2]) / 3;
        const r  = Math.min(255, (cr*255*lit) | 0);
        const g  = Math.min(255, (cg*255*lit) | 0);
        const b2 = Math.min(255, (cb*255*lit) | 0);
        color = (0xff << 24) | (b2 << 16) | (g << 8) | r;
      } else {
        const r  = Math.min(255, (br*lit) | 0);
        const g  = Math.min(255, (bg*lit) | 0);
        const b2 = Math.min(255, (bb*lit) | 0);
        color = (0xff << 24) | (b2 << 16) | (g << 8) | r;
      }
    } else if (colors) {
      // Use vertex colors from the GLB
      const cr = (colors[i0*4]   + colors[i1*4]   + colors[i2*4])   / 3;
      const cg = (colors[i0*4+1] + colors[i1*4+1] + colors[i2*4+1]) / 3;
      const cb = (colors[i0*4+2] + colors[i1*4+2] + colors[i2*4+2]) / 3;
      const r  = Math.min(255, (cr*255*lit) | 0);
      const g  = Math.min(255, (cg*255*lit) | 0);
      const b2 = Math.min(255, (cb*255*lit) | 0);
      color = (0xff << 24) | (b2 << 16) | (g << 8) | r;
    } else {
      // No vertex colors — use baseColor
      const r  = Math.min(255, (br*lit) | 0);
      const g  = Math.min(255, (bg*lit) | 0);
      const b2 = Math.min(255, (bb*lit) | 0);
      color = (0xff << 24) | (b2 << 16) | (g << 8) | r;
    }

    const avgZ = (cs0.cz + cs1.cz + cs2.cz) / 3;

    // Near-plane clip in camera space, then project
    const clipped = _engClipNear([cs0, cs1, cs2]);
    const emitted = _engEmitClipped(clipped, color, avgZ, camera, texture, zone, biome);
    for (const tri of emitted) tris.push(tri);
  }

  return tris;
}

// ─── Island geometry precache ─────────────────────────────────────────────────
//
// For non-moving (static) islands, we pre-compute color decisions per triangle
// (colorMode="island": green top, gradient brown sides/bottom) and cache
// pre-rotated/scaled local coords so per-frame rendering only does cam-space
// transform + clip, skipping all per-tri colorMode branches.
//
// Cache: Float32Array of 9 floats per tri (rotated/scaled local coords) +
// parallel colorBuf. When the palette carries biome terrain textures the
// cache ALSO bakes per-tri zone/uvMode/local UVs + the resolved textures, so
// buildMeshTrisFromCache emits textured zone tris (top/side/under).
//   rx/ry/rz = scale+yaw-rotated local coords (no world translation yet)

export function precacheIslandColors(meshData, scale = 1, yawDeg = 0, islandPalette = null) {
  const { vertices, normals, indices } = meshData;
  const rad  = (yawDeg * Math.PI) / 180;
  const cosY = Math.cos(rad);
  const sinY = Math.sin(rad);
  const triCount = (indices.length / 3) | 0;
  const islandPal = _resolveIslandPalette(islandPalette);

  const lcx = meshData.localCX ?? 0;
  const lcy = meshData.localCY ?? 0;
  const lcz = meshData.localCZ ?? 0;

  // Pre-build Y extent for island gradient
  if (meshData._islandYMin === undefined) {
    let mn = Infinity, mx = -Infinity;
    for (let vi = 0; vi < vertices.length; vi += 3) {
      const yy = vertices[vi+1];
      if (yy < mn) mn = yy; if (yy > mx) mx = yy;
    }
    meshData._islandYMin = mn; meshData._islandYMax = mx;
  }
  const yMin = meshData._islandYMin;
  const ySpan = (meshData._islandYMax - yMin) || 1;

  const buf = new Float32Array(triCount * 9);
  const colorBuf = new Uint32Array(triCount);

  // Biome terrain textures (carried over from the legacy platformer): when
  // the palette supplies textureTop/Side/Under, bake per-tri zone + UV mode +
  // local planar UVs (already × textureScale) so buildMeshTrisFromCache can
  // emit textured tris with only a cheap world-offset add per instance.
  const texTop = islandPal.textureTop || null;
  const texSide = islandPal.textureSide || null;
  const texUnder = islandPal.textureUnder || null;
  const hasTextures = !!(texTop || texSide || texUnder);
  const uvScale = islandPal.textureScale;
  let zone = null, uvMode = null, uvBuf = null;
  if (hasTextures) {
    zone = new Uint8Array(triCount);
    uvMode = new Uint8Array(triCount);
    uvBuf = new Float32Array(triCount * 6);
  }

  for (let t = 0; t < triCount; t++) {
    const i0 = indices[t*3], i1 = indices[t*3+1], i2 = indices[t*3+2];

    const lx0 = vertices[i0*3] - lcx, ly0 = vertices[i0*3+1] - lcy, lz0 = vertices[i0*3+2] - lcz;
    const lx1 = vertices[i1*3] - lcx, ly1 = vertices[i1*3+1] - lcy, lz1 = vertices[i1*3+2] - lcz;
    const lx2 = vertices[i2*3] - lcx, ly2 = vertices[i2*3+1] - lcy, lz2 = vertices[i2*3+2] - lcz;

    const rx0 = (lx0*cosY + lz0*sinY)*scale, ry0 = ly0*scale, rz0 = (-lx0*sinY + lz0*cosY)*scale;
    const rx1 = (lx1*cosY + lz1*sinY)*scale, ry1 = ly1*scale, rz1 = (-lx1*sinY + lz1*cosY)*scale;
    const rx2 = (lx2*cosY + lz2*sinY)*scale, ry2 = ly2*scale, rz2 = (-lx2*sinY + lz2*cosY)*scale;

    // Rotated normals for lighting
    const rn0x = normals[i0*3]*cosY + normals[i0*3+2]*sinY;
    const rn0z = -normals[i0*3]*sinY + normals[i0*3+2]*cosY;
    const rn1x = normals[i1*3]*cosY + normals[i1*3+2]*sinY;
    const rn2x = normals[i2*3]*cosY + normals[i2*3+2]*sinY;
    const rn1z = -normals[i1*3]*sinY + normals[i1*3+2]*cosY;
    const rn2z = -normals[i2*3]*sinY + normals[i2*3+2]*cosY;
    const nx2 = (rn0x + rn1x + rn2x) / 3;
    const ny2 = (normals[i0*3+1] + normals[i1*3+1] + normals[i2*3+1]) / 3;
    const nz2 = (rn0z + rn1z + rn2z) / 3;
    const dot = nx2*LNX + ny2*LNY + nz2*LNZ;
    const lit = 0.30 + 0.70 * Math.max(0, dot);

    const faceNY = ny2;
    let colorBits;
    if (faceNY > 0.55) {
      colorBits = _shadePackedColor(islandPal.top, lit);
    } else {
      const rawY = (vertices[i0*3+1] + vertices[i1*3+1] + vertices[i2*3+1]) / 3;
      const tt = Math.max(0, Math.min(1, (rawY - yMin) / ySpan));
      const sideMul = 0.55 + tt * 0.45;
      colorBits = _shadePackedColor(islandPal.side, lit, sideMul);
    }

    if (zone) {
      // Zone mirrors buildMeshTris colorMode="island": top ny>0.55, under
      // ny<-0.35, otherwise side. UV mode mirrors _setTerrainUVsForTri: faces
      // with |ny|>0.55 (top OR under) project on XZ, steep faces on the
      // dominant horizontal axis + Y.
      let z;
      if (faceNY > 0.55) z = 0;
      else if (faceNY < -0.35) z = 2;
      else z = 1;
      let m;
      if (Math.abs(faceNY) > 0.55) m = 0;
      else m = Math.abs(nx2) > Math.abs(nz2) ? 1 : 2;
      zone[t] = z; uvMode[t] = m;
      const uv = t * 6;
      if (m === 0) {
        uvBuf[uv]   = rx0 * uvScale; uvBuf[uv+1] = rz0 * uvScale;
        uvBuf[uv+2] = rx1 * uvScale; uvBuf[uv+3] = rz1 * uvScale;
        uvBuf[uv+4] = rx2 * uvScale; uvBuf[uv+5] = rz2 * uvScale;
      } else if (m === 1) {
        uvBuf[uv]   = rz0 * uvScale; uvBuf[uv+1] = ry0 * uvScale;
        uvBuf[uv+2] = rz1 * uvScale; uvBuf[uv+3] = ry1 * uvScale;
        uvBuf[uv+4] = rz2 * uvScale; uvBuf[uv+5] = ry2 * uvScale;
      } else {
        uvBuf[uv]   = rx0 * uvScale; uvBuf[uv+1] = ry0 * uvScale;
        uvBuf[uv+2] = rx1 * uvScale; uvBuf[uv+3] = ry1 * uvScale;
        uvBuf[uv+4] = rx2 * uvScale; uvBuf[uv+5] = ry2 * uvScale;
      }
    }

    const base = t * 9;
    buf[base]   = rx0; buf[base+1] = ry0; buf[base+2] = rz0;
    buf[base+3] = rx1; buf[base+4] = ry1; buf[base+5] = rz1;
    buf[base+6] = rx2; buf[base+7] = ry2; buf[base+8] = rz2;
    colorBuf[t] = colorBits;
  }

  return {
    buf, colorBuf, triCount,
    textures: hasTextures ? [texTop, texSide, texUnder] : null,
    uvScale: hasTextures ? uvScale : 0,
    zone, uvMode, uvBuf,
  };
}

// Build tris from a precached island buffer each frame.
export function buildMeshTrisFromCache(cache, worldX, worldY, worldZ, camera) {
  if (!camera || !cache) return [];
  const { buf, colorBuf, triCount } = cache;
  const zone = cache.zone || null;
  const uvMode = cache.uvMode || null;
  const uvBuf = cache.uvBuf || null;
  const textures = cache.textures || null;
  const uvScale = cache.uvScale || 0;
  const hasUV = !!(zone && uvMode && uvBuf && textures);
  const tris = [];

  for (let t = 0; t < triCount; t++) {
    const base = t * 9;
    const wx0 = buf[base]   + worldX, wy0 = buf[base+1] + worldY, wz0 = buf[base+2] + worldZ;
    const wx1 = buf[base+3] + worldX, wy1 = buf[base+4] + worldY, wz1 = buf[base+5] + worldZ;
    const wx2 = buf[base+6] + worldX, wy2 = buf[base+7] + worldY, wz2 = buf[base+8] + worldZ;

    const cs0 = _engToCameraSpace(wx0, wy0, wz0, camera);
    const cs1 = _engToCameraSpace(wx1, wy1, wz1, camera);
    const cs2 = _engToCameraSpace(wx2, wy2, wz2, camera);
    if (cs0.cz < NEAR_Z && cs1.cz < NEAR_Z && cs2.cz < NEAR_Z) continue;

    const colorBits = colorBuf ? colorBuf[t] : (buf[base+9] >>> 0);
    const avgZ = (cs0.cz + cs1.cz + cs2.cz) / 3;

    // Textured zones: pick the zone texture and add the world-origin offset to
    // the baked local planar UVs (u/v live on the cam-space verts so the near
    // clip path interpolates them correctly).
    let texture = null, zoneName = null;
    if (hasUV) {
      const z = zone[t];
      texture = textures[z] || null;
      if (texture) {
        const m = uvMode[t];
        let aU, aV;
        if (m === 0) { aU = worldX * uvScale; aV = worldZ * uvScale; }
        else if (m === 1) { aU = worldZ * uvScale; aV = worldY * uvScale; }
        else { aU = worldX * uvScale; aV = worldY * uvScale; }
        const b = t * 6;
        cs0.u = uvBuf[b] + aU; cs0.v = uvBuf[b+1] + aV;
        cs1.u = uvBuf[b+2] + aU; cs1.v = uvBuf[b+3] + aV;
        cs2.u = uvBuf[b+4] + aU; cs2.v = uvBuf[b+5] + aV;
        zoneName = z === 0 ? "top" : z === 1 ? "side" : "under";
      }
    }

    const clipped = _engClipNear([cs0, cs1, cs2]);
    const emitted = _engEmitClipped(clipped, colorBits, avgZ, camera, texture, zoneName);
    for (const tri of emitted) tris.push(tri);
  }

  return tris;
}
