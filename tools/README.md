# Asset Viewer

A plug-and-play visual debugging tool for **Star Platform / Claude Games** modules. Drop it into any project to instantly browse, inspect, and preview 3D models, sprites, textures, effects, and data catalogs from your JavaScript modules.

---

## Features

- **Semi-Auto-discovery** — 'node scan-modules.js ./' Scans your project for `.js` modules (via `modules.json` or directory listing)
- **Multi-tab interface** — Visual preview + Source code viewer
- **3D Model Viewer** — Three.js powered with orbit controls, auto-thumbnails
- **Sprite/Texture Gallery** — Pixel-perfect rendering with thumbnails
- **Effect Preview** — Canvas-based effect visualization
- **Data Catalog** — Browse exported objects, arrays, numbers, strings
- **Source Code Browser** — Syntax-highlighted module source with searchable palette
- **Zero config** — Works out of the box with Star Platform conventions

---

## Quick Start

### 1. Place the files

Copy these files into your project (e.g., `tools/asset-viewer/`):

```
asset-viewer.html
scan-modules.js
modules.json (generated)
```

### 2. Generate module index

```bash
node scan-modules.js [path/to/modules]
# Outputs modules.json in the same directory
```

### 3. Open in browser

Serve the directory with any static server:

```bash
npx serve .
# or
python3 -m http.server 8080
```

Then open `http://localhost:8080/asset-viewer.html`

---

## Usage

### Query Parameters

| Parameter | Description |
|-----------|-------------|
| `?root=./modules` | Override module root path |
| `?root=./src/game` | Point to any directory with `.js` files |

### Keyboard Shortcuts (Visual Tab)

| Key | Action |
|-----|--------|
| `LMB` + drag | Orbit camera |
| `RMB` + drag | Pan camera |
| `Scroll` | Zoom |
| `R` | Reset view |

### Module Detection

The viewer auto-detects exports from your modules:

| Export Pattern | Detected As |
|----------------|-------------|
| `buildXxx(...)` returning `{ grp }` | **3D Model** (Three.js) |
| `buildXxx(...)` returning `Array<{verts, color, avgZ}>` | **Software Model** (triangles) |
| `fn()` returning `HTMLCanvasElement` | **Texture** |
| `obj.sprite(ctx, ...)` or `obj.draw(ctx, ...)` | **Sprite** |
| `fn(ctx, ...)` where first param = `ctx/c/canvas/g/gfx` | **Sprite/Effect** |
| Exported objects/arrays/numbers/strings | **Data Catalog** |

---

## Project Structure

```
your-project/
├── modules/                 # Your game modules
│   ├── entities/
│   │   ├── player.js
│   │   └── enemy.js
│   ├── effects/
│   │   └── particles.js
│   └── ui/
│       └── hud.js
├── tools/
│   └── asset-viewer/
│       ├── asset-viewer.html
│       ├── scan-modules.js
│       └── modules.json     # Generated
└── package.json
```

---

## Integration with Star Platform

### For Claude Games / Star SDK projects

The viewer understands Star Platform conventions:

- **Physics modules** — Exports `PHYS`, `applyFriction`, `applyGravity`
- **Entity modules** — Export builder functions compatible with the physics contract
- **Render modules** — Export sprite drawers with `(ctx, ...)` signatures
- **Data modules** — Export catalogs (items, stats, config)

### Example: Adding to a Star game

```bash
# In your game repo
mkdir -p tools/asset-viewer
cp /path/to/asset-viewer/* tools/asset-viewer/
cd tools/asset-viewer
node scan-modules.js ../../modules  # or wherever your modules live
npx serve .
```

---

## Development

### Adding Custom Detectors

Edit the `loadJSFile()` function in `asset-viewer.html` to add detection for your patterns:

```javascript
// Example: Detect custom "animator" exports
for (const key of Object.keys(exports)) {
  if (typeof exports[key] === 'object' && exports[key].animate) {
    loadedAnimators[filename + ':' + key] = { animator: exports[key] };
    populateAnimatorList();
  }
}
```

### Styling

The UI uses CSS custom properties (lines 13-35 in `asset-viewer.html`). Override via:

```html
<style>
  :root {
    --bg: #1a1a2e;
    --face: #16213e;
    --text-sel: #eaeaea;
    /* ... */
  }
</style>
```

---

## Requirements

- **Browser** with ES6 modules, `fetch`, `WebGL`
- **Three.js r128** (loaded from CDN)
- **Static file server** (for module loading via `fetch`)

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| "No modules found" | Run `scan-modules.js` or enable directory listing on your server |
| Models not appearing | Ensure builder functions are named `build*` and return `{ grp }` |
| Sprites not detected | First parameter of draw function must be `ctx`, `c`, `canvas`, `g`, `gfx`, `gc`, `rd`, `renderCtx`, or `drawCtx` |
| CORS errors | Serve via HTTP(S), not `file://` protocol |

---

## License

MIT — Use freely in Star Platform / Claude Games projects.
