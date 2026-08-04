import { game } from '/star-sdk/v1/dom.js';
import { createMultiplayer } from '/star-sdk/v1/multiplayer.js';
import { PHYS, applyFriction, applyGravity } from './physics.js';

const mp = createMultiplayer();

// ─── Constants ───────────────────────────────────────────────────────────────
const W = 800, H = 450;

// Physics module drives gravity via PHYS.GRAVITY (per-tick units).
// JUMP_IMPULSE is tuned for the new system: vy is in px/tick, jumpY tracks
// height above the platform surface.  A value of ~12 gives roughly the same
// arc as the old -420 px/s impulse at 60 fps.
const JUMP_IMPULSE    = 12;      // px/tick — initial upward vy on jump
const MOVE_SPEED      = 3.8;     // px/tick — horizontal speed on ground
const DASH_SPEED      = 9.5;     // px/tick — dash horizontal speed
const DASH_TICKS      = 11;      // ticks for a dash
const ATTACK_TICKS    = 15;      // ticks the attack hitbox is active
const ATTACK_CD_TICKS = 21;      // ticks between attacks
const KNOCKBACK       = 10;      // base knockback impulse (scaled by damage)
const MAX_STOCKS      = 3;
const RESPAWN_TICKS   = 150;     // ~2.5 s at 60 fps
const BLAST_ZONE      = 120;     // px outside canvas before KO

const PLAYER_COLORS = ['#f87171', '#60a5fa', '#4ade80', '#facc15'];
const PLAYER_NAMES  = ['Red', 'Blue', 'Green', 'Yellow'];
const PLAYER_SPAWN  = [
  { x: 160, y: 200 },
  { x: 640, y: 200 },
  { x: 280, y: 120 },
  { x: 520, y: 120 },
];

// ─── Platforms ────────────────────────────────────────────────────────────────
const PLATFORMS = [
  { x: 0,   y: 380, w: 800, h: 70 }, // ground
  { x: 280, y: 280, w: 240, h: 16 }, // center mid
  { x: 80,  y: 220, w: 160, h: 14 }, // left
  { x: 560, y: 220, w: 160, h: 14 }, // right
  { x: 340, y: 170, w: 120, h: 12 }, // top center
];

// ─── State ────────────────────────────────────────────────────────────────────
let state = {
  players: {},
  particles: [],
  gamePhase: 'lobby', // lobby | playing | gameover
  winner: null,
  tick: 0,
};

// Local input tracking
const keys = {};
// jumpHeld is needed for variable-height jump (passed to applyGravity)
const inputState = { left: false, right: false, jump: false, attack: false, dash: false };
let prevInput = { ...inputState };
let gameCtx = null;

function initPlayer(id, idx) {
  const sp = PLAYER_SPAWN[idx % 4];
  return {
    id,
    idx,
    x:    sp.x,
    y:    sp.y,
    vx:   0,
    vy:   0,
    vz:   0,          // required by applyFriction (2-D game, always 0)
    jumpY: 0,         // height above floor surface (owned by physics module)
    // onGround is derived: jumpY <= 0
    facing:       idx < 2 ? 1 : -1,
    stocks:       MAX_STOCKS,
    damage:       0,
    attackTimer:  0,
    attackCD:     0,
    dashTimer:    0,
    dashDir:      0,
    respawnTimer: 0,
    dead:         false,
    hitFlash:     0,
    animFrame:    0,
    animTimer:    0,
    jumpHeld:     false, // tracks whether jump button is still held this jump
  };
}

// ─── Deterministic particle system (tick-based, no Math.random) ──────────────
// We use a simple LCG seeded from tick + entity id hash for determinism.
let _seed = 1;
function lcgNext() {
  _seed = (_seed * 1664525 + 1013904223) & 0xffffffff;
  return (_seed >>> 0) / 0xffffffff;
}
function seedFrom(tick, x, y) {
  _seed = (tick * 6271 + (x | 0) * 997 + (y | 0) * 317) & 0x7fffffff || 1;
}

function spawnParticle(x, y, color, count, tick) {
  seedFrom(tick, x, y);
  for (let i = 0; i < count; i++) {
    const angle = (Math.PI * 2 * i) / count + lcgNext() * 0.5;
    const speed = 1.2 + lcgNext() * 2.4;  // px/tick
    state.particles.push({
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life:    30 + (lcgNext() * 18 | 0), // ticks
      maxLife: 30 + (lcgNext() * 18 | 0),
      color,
      r: 3 + lcgNext() * 4,
    });
  }
}

// ─── Platform collision ───────────────────────────────────────────────────────
// Maps the physics module's jumpY model back onto screen-space y.
// jumpY == 0  → player is standing on a platform; y = platform top − half-height
// jumpY  > 0  → player is in the air above that platform
//
// We find the highest platform the player is "on" or airborne over and use it
// as the floor reference for the physics module.
const PLAYER_HALF_H = 20; // half-height of the player hitbox (feet to mid)

function resolvePlatform(p) {
  // The screen y of the player's feet
  const feetY = p.y + PLAYER_HALF_H;

  let bestFloor = null; // highest (lowest y-value) platform that can hold the player

  for (const plat of PLATFORMS) {
    const inX   = p.x > plat.x - 14 && p.x < plat.x + plat.w + 14;
    // Only consider platforms at or below feet (player fell onto it)
    const above = feetY <= plat.y + plat.h + 8;
    const below = feetY >= plat.y - 4;
    if (inX && above && below && p.vy >= 0) {
      if (bestFloor === null || plat.y < bestFloor.y) {
        bestFloor = plat;
      }
    }
  }

  if (bestFloor) {
    // Snap to platform surface and reset jumpY to 0
    p.y    = bestFloor.y - PLAYER_HALF_H;
    p.vy   = 0;
    p.jumpY = 0;
  }
  // jumpY > 0 → player is above the floor, physics module handles ascent/descent
}

// ─── Movement input application ───────────────────────────────────────────────
function applyInput(p, input) {
  if (p.dead) return;

  const airborne   = p.jumpY > 0 || p.vy > 0;
  const dashing    = p.dashTimer > 0;
  const speedMult  = airborne ? PHYS.AIR_CONTROL : 1.0;

  if (!dashing) {
    if (input.left) {
      p.vx = -MOVE_SPEED * speedMult;
      p.facing = -1;
    } else if (input.right) {
      p.vx = MOVE_SPEED * speedMult;
      p.facing = 1;
    }
    // Friction is now handled by applyFriction() in tickPhysics
  }
}

// ─── Host physics tick (fixed-step, deterministic) ────────────────────────────
function tickPhysics(/* dt unused — all values are px/tick */) {
  state.tick++;

  for (const p of Object.values(state.players)) {
    if (p.dead) {
      p.respawnTimer--;
      if (p.respawnTimer <= 0) {
        const sp = PLAYER_SPAWN[p.idx % 4];
        p.x = sp.x; p.y = sp.y;
        p.vx = 0; p.vy = 0; p.jumpY = 0;
        p.dead = false;
        p.damage = 0;
        p.attackTimer = 0;
        spawnParticle(p.x, p.y, PLAYER_COLORS[p.idx % 4], 12, state.tick);
      }
      continue;
    }

    // Countdown timers (tick-based)
    if (p.attackTimer  > 0) p.attackTimer--;
    if (p.attackCD     > 0) p.attackCD--;
    if (p.dashTimer    > 0) p.dashTimer--;
    if (p.hitFlash     > 0) p.hitFlash--;

    // Dash overrides vx
    if (p.dashTimer > 0) {
      p.vx = p.dashDir * DASH_SPEED;
    }

    // --- Physics module integration ---
    // 1. Friction (ground only — air control preserved)
    applyFriction(p);

    // 2. Gravity with variable jump height
    applyGravity(p, p.jumpHeld);

    // 3. Integrate horizontal position
    p.x += p.vx;

    // 4. Integrate vertical position from jumpY (physics module owns vy/jumpY)
    //    jumpY is height above floor; screen y is floor_y - jumpY - PLAYER_HALF_H.
    //    For free-fall (no platform beneath), we integrate y directly when jumpY==0.
    if (p.jumpY > 0) {
      // Convert jumpY height to screen y: anchor is the last known floor y.
      // We store that anchor in p.floorY (set on landing).
      p.y = (p.floorY || (H - 70 - PLAYER_HALF_H)) - p.jumpY;
    } else {
      // Grounded or free-falling: use raw screen-space integration
      p.vy += PHYS.GRAVITY; // keep gravity for the falling-off-edge case
      p.y  += p.vy;
      resolvePlatform(p);

      // If we just landed, record the floor y anchor
      if (p.vy === 0) {
        p.floorY = p.y + PLAYER_HALF_H;
        p.vy = 0;
      }
    }

    // Animation
    p.animTimer++;
    if (p.animTimer >= 7) {
      p.animTimer = 0;
      p.animFrame = (p.animFrame + 1) % 4;
    }

    // Blast zone KO
    if (p.x < -BLAST_ZONE || p.x > W + BLAST_ZONE || p.y < -BLAST_ZONE || p.y > H + BLAST_ZONE) {
      p.stocks--;
      spawnParticle(
        Math.max(0, Math.min(W, p.x)),
        Math.max(0, Math.min(H, p.y)),
        PLAYER_COLORS[p.idx % 4], 20, state.tick
      );
      if (p.stocks <= 0) {
        p.dead = true;
        p.stocks = 0;
        const withStocks = Object.values(state.players).filter(q => q.stocks > 0);
        if (withStocks.length === 1) {
          state.gamePhase = 'gameover';
          state.winner = withStocks[0].idx;
        } else if (withStocks.length === 0) {
          state.gamePhase = 'gameover';
          state.winner = -1;
        }
      } else {
        p.dead = true;
        p.respawnTimer = RESPAWN_TICKS;
        p.x = -200; p.y = -200;
      }
    }
  }

  // ── Attack hit detection (host only) ────────────────────────────────────
  for (const attacker of Object.values(state.players)) {
    if (attacker.attackTimer <= 0 || attacker.dead) continue;
    if (attacker.attackTimer < ATTACK_TICKS - 5) continue; // first 5 ticks only

    const ax = attacker.x + attacker.facing * 28;
    const ay = attacker.y - 8;

    for (const target of Object.values(state.players)) {
      if (target.id === attacker.id || target.dead) continue;
      const dist = Math.hypot(target.x - ax, target.y - ay);
      if (dist < 36) {
        if (!attacker._hitThisSwing) attacker._hitThisSwing = new Set();
        if (attacker._hitThisSwing.has(target.id)) continue;
        attacker._hitThisSwing.add(target.id);

        const dmgMult = 1 + target.damage / 100;
        target.vx     = attacker.facing * KNOCKBACK * dmgMult;
        // Launch target upward by boosting jumpY
        target.vy     = KNOCKBACK * 0.55 * dmgMult;
        target.jumpY  = Math.max(target.jumpY, 1); // enter jump arc
        target.damage    += 12;
        target.hitFlash   = 12;
        spawnParticle(target.x, target.y - 8, '#fff', 6, state.tick);
      }
    }

    if (attacker.attackTimer <= 0) attacker._hitThisSwing = null;
  }

  // ── Particles (tick-based) ──────────────────────────────────────────────
  state.particles = state.particles.filter(pt => {
    pt.x   += pt.vx;
    pt.y   += pt.vy;
    pt.vy  += 0.05; // micro gravity on particles
    pt.life--;
    return pt.life > 0;
  });
}

// ─── Draw ─────────────────────────────────────────────────────────────────────
function drawBackground(ctx) {
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, '#0d0221');
  grad.addColorStop(1, '#1a0533');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  ctx.strokeStyle = 'rgba(99,50,180,0.15)';
  ctx.lineWidth = 1;
  for (let x = 0; x < W; x += 40) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
  }
  for (let y = 0; y < H; y += 40) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
  }
}

function drawPlatforms(ctx) {
  for (let i = 0; i < PLATFORMS.length; i++) {
    const p = PLATFORMS[i];
    const isGround = i === 0;
    const grad = ctx.createLinearGradient(p.x, p.y, p.x, p.y + p.h);
    grad.addColorStop(0, isGround ? '#2d1b69' : '#3b1f8a');
    grad.addColorStop(1, isGround ? '#1a0d3e' : '#1e0f4a');
    ctx.fillStyle = grad;
    ctx.fillRect(p.x, p.y, p.w, p.h);

    ctx.strokeStyle = isGround ? '#a78bfa' : '#c4b5fd';
    ctx.lineWidth   = isGround ? 3 : 2;
    ctx.shadowColor = isGround ? '#7c3aed' : '#8b5cf6';
    ctx.shadowBlur  = isGround ? 8 : 6;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + p.w, p.y);
    ctx.stroke();
    ctx.shadowBlur = 0;

    if (!isGround) {
      ctx.fillStyle = '#c4b5fd';
      ctx.fillRect(p.x, p.y - 2, 6, 4);
      ctx.fillRect(p.x + p.w - 6, p.y - 2, 6, 4);
    }
  }
}

function drawPlayer(ctx, p) {
  if (p.dead) return;

  const x = Math.round(p.x);
  const y = Math.round(p.y);
  const color      = PLAYER_COLORS[p.idx % 4];
  const isAttacking = p.attackTimer > 0;
  const isDashing   = p.dashTimer > 0;
  const isHit       = p.hitFlash > 0;
  const onGround    = p.jumpY <= 0;

  ctx.save();
  ctx.translate(x, y);
  ctx.scale(p.facing, 1);

  // Hit flash: alternate opacity
  ctx.globalAlpha = isHit ? (p.hitFlash % 4 < 2 ? 0.4 : 1.0) : 1;

  // Ground shadow
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath();
  ctx.ellipse(0, 20, 14, 5, 0, 0, Math.PI * 2);
  ctx.fill();

  if (isAttacking) {
    ctx.shadowColor = color;
    ctx.shadowBlur  = 15;
  }

  // Legs (animated when walking on ground)
  const legAnim = onGround && (p.vx !== 0) ? Math.sin(p.animFrame * 1.5) * 8 : 0;
  ctx.fillStyle = '#1a1a2e';
  ctx.fillRect(-8, 4, 7, 14 + legAnim);
  ctx.fillRect(1,  4, 7, 14 - legAnim);

  ctx.fillStyle = color;
  ctx.fillRect(-10, 16 + legAnim, 9, 4);
  ctx.fillRect(1,   16 - legAnim, 9, 4);

  // Body
  const bodyGrad = ctx.createLinearGradient(-12, -20, 12, 10);
  bodyGrad.addColorStop(0, color);
  bodyGrad.addColorStop(1, shadeColor(color, -40));
  ctx.fillStyle = bodyGrad;
  roundRect(ctx, -12, -20, 24, 28, 4);
  ctx.fill();

  ctx.fillStyle = 'rgba(255,255,255,0.2)';
  ctx.fillRect(-4, -16, 8, 10);

  // Arms
  if (isAttacking) {
    ctx.fillStyle = color;
    ctx.fillRect(10, -14, 20, 8);
    ctx.fillStyle = shadeColor(color, 20);
    ctx.beginPath(); ctx.arc(30, -10, 8, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(38, -10, 12, -0.5, 0.5); ctx.stroke();
  } else {
    const armBob = onGround ? Math.sin(p.animFrame * 1.5) * 4 : 0;
    ctx.fillStyle = color;
    ctx.fillRect( 8, -14 + armBob, 12, 7);
    ctx.fillRect(-20, -14 - armBob, 12, 7);
  }

  // Head
  ctx.fillStyle = shadeColor(color, 20);
  ctx.beginPath(); ctx.arc(0, -28, 12, 0, Math.PI * 2); ctx.fill();

  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.arc(5, -30, 4, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#1a1a2e';
  ctx.beginPath(); ctx.arc(6, -29, 2.5, 0, Math.PI * 2); ctx.fill();

  if (isAttacking) {
    ctx.strokeStyle = '#1a1a2e'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(2, -36); ctx.lineTo(10, -33); ctx.stroke();
  }

  // Dash trail
  if (isDashing) {
    for (let t = 1; t <= 3; t++) {
      ctx.globalAlpha = 0.1 * (4 - t);
      ctx.fillStyle = color;
      roundRect(ctx, -12 - t * 8 * p.dashDir * p.facing, -20, 24, 28, 4);
      ctx.fill();
    }
  }

  ctx.shadowBlur  = 0;
  ctx.globalAlpha = 1;
  ctx.restore();
}

function drawHUD(ctx, players, localId) {
  const sorted = Object.values(players).sort((a, b) => a.idx - b.idx);
  const total  = sorted.length;
  const panelW = 160, panelH = 54, gap = 12;
  const totalW = total * panelW + (total - 1) * gap;
  const startX = (W - totalW) / 2;

  for (let i = 0; i < sorted.length; i++) {
    const p      = sorted[i];
    const px     = startX + i * (panelW + gap);
    const py     = 10;
    const color  = PLAYER_COLORS[p.idx % 4];
    const isLocal = p.id === localId;

    ctx.fillStyle = isLocal ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.4)';
    roundRect(ctx, px, py, panelW, panelH, 8); ctx.fill();

    ctx.strokeStyle = isLocal ? color : 'rgba(255,255,255,0.15)';
    ctx.lineWidth   = isLocal ? 2 : 1;
    roundRect(ctx, px, py, panelW, panelH, 8); ctx.stroke();

    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(px + 22, py + 20, 10, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#1a1a2e';
    ctx.beginPath(); ctx.arc(px + 24, py + 18, 4, 0, Math.PI * 2); ctx.fill();

    ctx.fillStyle = '#fff';
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(PLAYER_NAMES[p.idx % 4] + (isLocal ? ' (you)' : ''), px + 38, py + 16);

    const dmgColor = p.damage < 50 ? '#4ade80' : p.damage < 100 ? '#facc15' : '#f87171';
    ctx.fillStyle = dmgColor;
    ctx.font = 'bold 18px monospace';
    ctx.fillText(p.dead ? '💀' : p.damage + '%', px + 38, py + 36);

    for (let s = 0; s < MAX_STOCKS; s++) {
      ctx.fillStyle  = s < p.stocks ? color : 'rgba(255,255,255,0.1)';
      ctx.shadowColor = s < p.stocks ? color : 'transparent';
      ctx.shadowBlur  = s < p.stocks ? 6 : 0;
      ctx.beginPath();
      ctx.arc(px + panelW - 16 - (MAX_STOCKS - 1 - s) * 16, py + panelH - 14, 5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.shadowBlur = 0;
  }
}

function drawParticles(ctx) {
  for (const p of state.particles) {
    const t = p.life / p.maxLife;
    ctx.globalAlpha = t;
    ctx.fillStyle   = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, Math.max(0.5, p.r * t), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function shadeColor(hex, amount) {
  const num = parseInt(hex.slice(1), 16);
  const r   = Math.max(0, Math.min(255, (num >> 16)        + amount));
  const g   = Math.max(0, Math.min(255, ((num >> 8) & 0xff) + amount));
  const b   = Math.max(0, Math.min(255, (num & 0xff)        + amount));
  return `rgb(${r},${g},${b})`;
}

// ─── Controls UI ──────────────────────────────────────────────────────────────
function buildControlsHTML() {
  return `
    <div style="position:absolute;bottom:8px;left:50%;transform:translateX(-50%);display:flex;gap:6px;align-items:center;pointer-events:none;z-index:10;">
      <div style="display:flex;gap:3px;align-items:center;">
        <div id="btn-left"  style="width:34px;height:34px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.2);border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:16px;color:#fff;cursor:pointer;pointer-events:all;user-select:none;-webkit-user-select:none;">◀</div>
        <div id="btn-down"  style="width:34px;height:34px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.2);border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:16px;color:#fff;cursor:pointer;pointer-events:all;user-select:none;-webkit-user-select:none;">▼</div>
        <div id="btn-right" style="width:34px;height:34px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.2);border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:16px;color:#fff;cursor:pointer;pointer-events:all;user-select:none;-webkit-user-select:none;">▶</div>
      </div>
      <div style="display:flex;gap:3px;">
        <div id="btn-jump"   style="width:38px;height:34px;background:rgba(100,210,255,0.15);border:1px solid rgba(100,210,255,0.4);border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:bold;color:#67e8f9;cursor:pointer;pointer-events:all;user-select:none;-webkit-user-select:none;">JUMP</div>
        <div id="btn-attack" style="width:38px;height:34px;background:rgba(255,100,100,0.15);border:1px solid rgba(255,100,100,0.4);border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:bold;color:#f87171;cursor:pointer;pointer-events:all;user-select:none;-webkit-user-select:none;">ATK</div>
        <div id="btn-dash"   style="width:38px;height:34px;background:rgba(180,100,255,0.15);border:1px solid rgba(180,100,255,0.4);border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:bold;color:#c084fc;cursor:pointer;pointer-events:all;user-select:none;-webkit-user-select:none;">DASH</div>
      </div>
    </div>
  `;
}

// ─── Main game() ──────────────────────────────────────────────────────────────
game(async (g) => {
  const { ctx, width, height, loop, ui, on } = g;
  gameCtx = ctx;

  ui.render(`
    <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(10,2,20,0.85);z-index:100;">
      <div style="text-align:center;color:#fff;">
        <div style="font-size:32px;font-weight:900;letter-spacing:4px;color:#a78bfa;margin-bottom:8px;">BRAWL.IO</div>
        <div style="font-size:14px;color:#888;animation:pulse 1s infinite;">Connecting to server...</div>
      </div>
    </div>
    <style>@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}</style>
  `);

  // ── Multiplayer setup ────────────────────────────────────────────────────────
  await mp.start({ maxPlayers: 4, allowSoloStart: true, minPlayersToStart: 1 });

  const myIdx = mp.players.findIndex(p => p.id === mp.localPlayerId);
  state.players[mp.localPlayerId] = initPlayer(mp.localPlayerId, Math.max(0, myIdx));

  mp.onPlayerJoin((player) => {
    const idx = mp.players.findIndex(p => p.id === player.id);
    if (!state.players[player.id]) {
      state.players[player.id] = initPlayer(player.id, Math.max(0, idx));
    }
  });

  mp.onPlayerLeave((player) => {
    delete state.players[player.id];
  });

  // Host: process inputs
  mp.onInput((playerId, input) => {
    if (!state.players[playerId]) {
      const idx = mp.players.findIndex(p => p.id === playerId);
      state.players[playerId] = initPlayer(playerId, Math.max(0, idx));
    }
    const p = state.players[playerId];
    if (p && !p.dead) {
      applyInput(p, input);
      p.jumpHeld = !!input.jump; // track hold for variable-height jump
    }
  });

  // Host: process discrete events
  mp.onEvent((playerId, type, data) => {
    const p = state.players[playerId];
    if (!p || p.dead) return;

    if (type === 'jump' && p.jumpY <= 0 && p.vy === 0) {
      p.vy     = JUMP_IMPULSE;
      p.jumpY  = 1; // enter the air
      p.jumpHeld = true;
    }
    if (type === 'jumpRelease') {
      p.jumpHeld = false;
    }
    if (type === 'attack' && p.attackCD <= 0) {
      p.attackTimer = ATTACK_TICKS;
      p.attackCD    = ATTACK_CD_TICKS;
      p._hitThisSwing = null;
    }
    if (type === 'dash' && p.dashTimer <= 0) {
      p.dashDir   = data.dir;
      p.dashTimer = DASH_TICKS;
    }
  });

  // Client: receive authoritative state
  mp.onState((s) => {
    for (const [id, incoming] of Object.entries(s.players || {})) {
      if (id !== mp.localPlayerId) {
        state.players[id] = incoming;
      }
    }
    state.particles  = s.particles  || state.particles;
    state.gamePhase  = s.gamePhase  || state.gamePhase;
    state.winner     = s.winner     ?? state.winner;
  });

  mp.onHost((isHost) => {
    if (isHost) console.log('[BRAWL] Became host');
  });

  // ── Keyboard input ──────────────────────────────────────────────────────────
  window.addEventListener('keydown', (e) => {
    const prev = keys[e.code];
    keys[e.code] = true;
    if (e.code === 'ArrowLeft' || e.code === 'ArrowRight' ||
        e.code === 'ArrowUp'   || e.code === 'Space'      ||
        e.code === 'KeyA'      || e.code === 'KeyD'       ||
        e.code === 'KeyW'      || e.code === 'KeyZ'       ||
        e.code === 'KeyX'      || e.code === 'KeyC'       ||
        e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
      e.preventDefault();
    }
  });
  window.addEventListener('keyup', (e) => {
    keys[e.code] = false;
    // Signal jump release for variable-height
    if (e.code === 'ArrowUp' || e.code === 'KeyW' || e.code === 'Space') {
      if (state.gamePhase === 'playing') mp.event('jumpRelease', {});
      const lp = state.players[mp.localPlayerId];
      if (lp) lp.jumpHeld = false;
    }
  });

  // ── Touch controls ──────────────────────────────────────────────────────────
  function setupTouchBtn(id, key, onRelease) {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('touchstart', e => { e.preventDefault(); keys[key] = true; }, { passive: false });
    el.addEventListener('touchend',   e => {
      e.preventDefault(); keys[key] = false;
      if (onRelease) onRelease();
    }, { passive: false });
    el.addEventListener('mousedown', () => { keys[key] = true; });
    el.addEventListener('mouseup',   () => { keys[key] = false; if (onRelease) onRelease(); });
  }

  // ── UI ──────────────────────────────────────────────────────────────────────
  function renderUI() {
    if (state.gamePhase === 'playing') {
      ui.render(`
        <div style="position:absolute;top:6px;right:10px;color:rgba(180,160,255,0.5);font-size:10px;font-family:monospace;">
          ${mp.isHost ? '👑 HOST' : '🎮 ' + mp.players.length + 'P'} · Room: ${mp.roomCode || '—'}
        </div>
        ${buildControlsHTML()}
      `);
      setupTouchBtn('btn-left',   'ArrowLeft');
      setupTouchBtn('btn-right',  'ArrowRight');
      setupTouchBtn('btn-down',   'ArrowDown');
      setupTouchBtn('btn-jump',   'Space', () => {
        if (state.gamePhase === 'playing') mp.event('jumpRelease', {});
        const lp = state.players[mp.localPlayerId];
        if (lp) lp.jumpHeld = false;
      });
      setupTouchBtn('btn-attack', 'KeyZ');
      setupTouchBtn('btn-dash',   'KeyC');
    } else if (state.gamePhase === 'gameover') {
      const winColor = state.winner >= 0 ? PLAYER_COLORS[state.winner % 4] : '#aaa';
      const winName  = state.winner >= 0 ? PLAYER_NAMES[state.winner % 4]  : 'Nobody';
      ui.render(`
        <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none;">
          <div style="text-align:center;">
            <div style="font-size:13px;color:#888;letter-spacing:3px;margin-bottom:4px;">WINNER</div>
            <div style="font-size:48px;font-weight:900;color:${winColor};text-shadow:0 0 30px ${winColor};">${winName}</div>
            <div style="font-size:13px;color:#888;margin-top:8px;">Returning to lobby...</div>
          </div>
        </div>
      `);
    } else {
      ui.render(`
        <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(10,2,20,0.85);">
          <div style="text-align:center;color:#fff;">
            <div style="font-size:40px;font-weight:900;letter-spacing:5px;color:#a78bfa;margin-bottom:4px;text-shadow:0 0 30px #7c3aed;">BRAWL.IO</div>
            <div style="font-size:13px;color:#888;margin-bottom:20px;">4-Player Platform Brawler</div>
            <div style="font-size:12px;color:#a78bfa;">Waiting for players...</div>
            <div style="font-size:11px;color:#555;margin-top:6px;">Room: ${mp.roomCode || '—'} · ${mp.players.length}/4 players</div>
            <div style="margin-top:20px;font-size:11px;color:#666;line-height:1.8;">
              <span style="color:#aaa;">Move:</span> A/D or ←/→ &nbsp;|&nbsp;
              <span style="color:#aaa;">Jump:</span> W / Space &nbsp;|&nbsp;
              <span style="color:#aaa;">Attack:</span> Z/X &nbsp;|&nbsp;
              <span style="color:#aaa;">Dash:</span> C/Shift
            </div>
          </div>
        </div>
      `);
    }
  }

  // ── Game loop ───────────────────────────────────────────────────────────────
  let uiPhasePrev  = '';
  let gameoverTick = 0;
  let lobbyTick    = 0;

  // Fixed-timestep accumulator (~60 ticks/s)
  const TICK_MS   = 1000 / 60;
  let   accumMs   = 0;

  loop((dt) => {
    // Gather local input
    const myInput = {
      left:   !!(keys['ArrowLeft']  || keys['KeyA']),
      right:  !!(keys['ArrowRight'] || keys['KeyD']),
      jump:   !!(keys['ArrowUp']    || keys['KeyW']  || keys['Space']),
      attack: !!(keys['KeyZ']       || keys['KeyJ']  || keys['KeyX']),
      dash:   !!(keys['KeyC']       || keys['ShiftLeft'] || keys['ShiftRight']),
    };

    if (state.gamePhase === 'playing') {
      mp.input({ left: myInput.left, right: myInput.right, jump: myInput.jump });

      // Discrete events (edge-triggered)
      if (myInput.jump && !prevInput.jump) {
        mp.event('jump', {});
        // Local prediction
        const lp = state.players[mp.localPlayerId];
        if (lp && lp.jumpY <= 0 && lp.vy === 0 && !lp.dead) {
          lp.vy     = JUMP_IMPULSE;
          lp.jumpY  = 1;
          lp.jumpHeld = true;
        }
      }
      if (myInput.attack && !prevInput.attack) {
        mp.event('attack', {});
        const lp = state.players[mp.localPlayerId];
        if (lp && !lp.dead && lp.attackCD <= 0) {
          lp.attackTimer = ATTACK_TICKS;
          lp.attackCD    = ATTACK_CD_TICKS;
        }
      }
      if (myInput.dash && !prevInput.dash) {
        const dir = myInput.left ? -1 : 1;
        mp.event('dash', { dir });
        const lp = state.players[mp.localPlayerId];
        if (lp && !lp.dead && lp.dashTimer <= 0) {
          lp.dashDir   = dir;
          lp.dashTimer = DASH_TICKS;
        }
      }

      // Apply local movement prediction
      const lp = state.players[mp.localPlayerId];
      if (lp) {
        applyInput(lp, myInput);
        lp.jumpHeld = myInput.jump;
      }
    }

    prevInput = { ...myInput };

    // ── Fixed-timestep physics (host only) ──────────────────────────────────
    accumMs += dt * 1000;
    const maxTicks = 3; // prevent spiral of death
    let ticks = 0;

    if (state.gamePhase === 'playing') {
      mp.hostTick(dt, () => {
        while (accumMs >= TICK_MS && ticks < maxTicks) {
          tickPhysics();
          accumMs -= TICK_MS;
          ticks++;
        }
        if (state.gamePhase === 'gameover') gameoverTick++;
        return {
          players:   state.players,
          gamePhase: state.gamePhase,
          winner:    state.winner,
          ...(state.tick % 6 === 0 ? { particles: state.particles.slice(0, 40) } : {}),
        };
      });
    } else if (state.gamePhase === 'lobby') {
      mp.hostTick(dt, () => {
        if (mp.players.length >= 1) {
          lobbyTick++;
          if (lobbyTick > 120) { // 2s at 60fps
            state.gamePhase = 'playing';
            lobbyTick = 0;
            for (const [i, player] of mp.players.entries()) {
              state.players[player.id] = initPlayer(player.id, i);
            }
          }
        }
        return { players: state.players, gamePhase: state.gamePhase, winner: state.winner };
      });
    } else if (state.gamePhase === 'gameover') {
      mp.hostTick(dt, () => {
        gameoverTick++;
        if (gameoverTick > 240) { // 4s at 60fps
          gameoverTick = 0;
          state.gamePhase = 'lobby';
          state.winner    = null;
          state.particles = [];
          for (const [i, player] of mp.players.entries()) {
            state.players[player.id] = initPlayer(player.id, i);
          }
        }
        return { players: state.players, gamePhase: state.gamePhase, winner: state.winner };
      });
    }

    // Client-side local prediction (non-host)
    if (!mp.isHost && state.gamePhase === 'playing') {
      const lp = state.players[mp.localPlayerId];
      if (lp && !lp.dead) {
        accumMs += 0; // accumulator already advanced above
        applyFriction(lp);
        applyGravity(lp, lp.jumpHeld);
        if (lp.dashTimer > 0) { lp.dashTimer--; lp.vx = lp.dashDir * DASH_SPEED; }
        if (lp.attackTimer > 0) lp.attackTimer--;
        if (lp.attackCD    > 0) lp.attackCD--;
        if (lp.hitFlash    > 0) lp.hitFlash--;

        if (lp.jumpY > 0) {
          lp.y = (lp.floorY || (H - 70 - PLAYER_HALF_H)) - lp.jumpY;
        } else {
          lp.vy += PHYS.GRAVITY;
          lp.y  += lp.vy;
          resolvePlatform(lp);
          if (lp.vy === 0) lp.floorY = lp.y + PLAYER_HALF_H;
        }
        lp.x += lp.vx;

        lp.animTimer++;
        if (lp.animTimer >= 7) { lp.animTimer = 0; lp.animFrame = (lp.animFrame + 1) % 4; }
      }

      state.particles = state.particles.filter(pt => {
        pt.x += pt.vx; pt.y += pt.vy; pt.vy += 0.05; pt.life--;
        return pt.life > 0;
      });
    }

    // ── Draw ─────────────────────────────────────────────────────────────────
    drawBackground(ctx);
    drawPlatforms(ctx);
    drawParticles(ctx);

    for (const p of Object.values(state.players)) {
      drawPlayer(ctx, p);
    }

    if (state.gamePhase === 'playing') {
      drawHUD(ctx, state.players, mp.localPlayerId);
    }

    if (state.gamePhase === 'gameover') {
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(0, 0, W, H);
    }

    // Lobby countdown
    if (state.gamePhase === 'lobby' && lobbyTick > 0) {
      const remaining = Math.max(0, 120 - lobbyTick);
      ctx.fillStyle  = 'rgba(167,139,250,0.9)';
      ctx.font       = 'bold 64px sans-serif';
      ctx.textAlign  = 'center';
      ctx.fillText(remaining > 0 ? Math.ceil(remaining / 60) : 'GO!', W / 2, H / 2 + 80);
      ctx.textAlign = 'left';
    }

    // Refresh UI on phase change
    if (state.gamePhase !== uiPhasePrev || state.gamePhase === 'lobby') {
      uiPhasePrev = state.gamePhase;
      renderUI();
    }
  });

  renderUI();

}, { width: W, height: H, preset: 'landscape' });
