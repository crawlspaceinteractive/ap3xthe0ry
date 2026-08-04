/**
 * enemyai.js — Enemy AI: waypoint patrol, LOS chase, contact + ranged attacks
 *
 * Enemy types:
 *   Regular enemy (boss:false) — player-scale, 2 HP, single shot
 *   Boss enemy   (boss:true)  — larger, 6 HP, telegraphed pattern attacks:
 *                               3-shot spread (ATTACK1) and, below half HP,
 *                               an 8-shot radial ring (ATTACK2). Attack rate
 *                               speeds up as HP drops (damage phases).
 *
 * Enemy behaviour:
 *   PATROL  → walks between 3-4 lazily-generated waypoints on its home island
 *   CHASE   → line-of-sight aggro (dist2D < aggro AND |dy| < 12); clamped to
 *             home island so enemies never walk off the edge
 *   CONTACT → touching a live enemy hurts the player (knockback + hit-stun)
 *   FROZEN  → ice breath freezes; player touch or a second breath hit while
 *             frozen SHATTERS the enemy (hp-1). Natural thaw costs NO hp.
 *             After a shatter the enemy gets i-frames (_hurtT) and cannot be
 *             instantly re-frozen.
 *
 * This module OWNS enemy timers (frozenT, bobPhase, spawnT, _shatterFxT) —
 * breath.js must not tick them (double-tick bug fixed v0.3.x).
 */

const AGGRO_RADIUS      = 30;   // was 60 — enemies aggroed from way too far
const BOSS_AGGRO_RADIUS = 45;
const AGGRO_MAX_DY      = 12;   // vertical line-of-sight gate
const CHASE_SPEED       = 0.06;
const BOSS_CHASE_SPEED  = 0.035;
const PATROL_SPEED      = 0.03;
const BOSS_PATROL_SPEED = 0.018;
const ATTACK_RANGE      = 28;
const BOSS_ATTACK_RANGE = 40;
const ATTACK_COOLDOWN   = 140;
const PROJ_SPEED        = 0.12;
const BOSS_PROJ_SPEED   = 0.09;
const PROJ_LIFE         = 180;
const PROJ_HIT_RADIUS   = 2.5;
const BOSS_PROJ_HIT_RADIUS = 4.0;
const PROJ_GRAVITY      = 0.004;
const BOB_SPEED         = 0.055;
const BOSS_BOB_SPEED    = 0.03;
const DEATH_FRAMES      = 45;
const CONTACT_PAD       = 0.9;  // added to e.hitRadius for touch damage
const TELEGRAPH_FRAMES  = 30;   // boss attack tell
const SHATTER_IFRAMES   = 40;   // post-shatter invulnerability (blocks re-freeze)
const SHATTER_FX_FRAMES = 20;

export const projectiles = []; // global list, cleared on world reset

export function resetProjectiles() {
  projectiles.length = 0;
}

/**
 * shatterEnemy — a frozen enemy takes a hit (breath or player touch).
 * HP-based: never instant-kills (fixes the boss instant-kill bug).
 * Returns true if the enemy died.
 */
export function shatterEnemy(e) {
  if (e.dead || !e.frozen) return false;
  e.frozen = false;
  e.frozenT = 0;
  if (e.hp !== undefined) e.hp--;
  e._shatterFxT = SHATTER_FX_FRAMES;
  if (e.hp !== undefined && e.hp <= 0) {
    e.dead = true;
    e.deathT = e.boss ? DEATH_FRAMES : 30;
    return true;
  }
  e._hurtT = SHATTER_IFRAMES; // i-frames: cannot be re-frozen immediately
  return false;
}

const enemyAIInstances = new WeakMap();

class EnemyAIBase {
  constructor(enemy) {
    this.e = enemy;
    this.e._attackCooldown = this.e._attackCooldown || 0;
  }

  get isBoss()        { return !!this.e.boss; }
  get bobSpeed()      { return this.isBoss ? BOSS_BOB_SPEED : BOB_SPEED; }
  get patrolSpeed()   { return this.isBoss ? BOSS_PATROL_SPEED : PATROL_SPEED; }
  get chaseSpeed()    { return this.isBoss ? BOSS_CHASE_SPEED : CHASE_SPEED; }
  get aggroRadius()   { return this.isBoss ? BOSS_AGGRO_RADIUS : AGGRO_RADIUS; }
  get attackRange()   { return this.isBoss ? BOSS_ATTACK_RANGE : ATTACK_RANGE; }
  get projSpeed()     { return this.isBoss ? BOSS_PROJ_SPEED : PROJ_SPEED; }

  step(player, platforms, frame, hud, flashFn) {
    const e = this.e;

    // FX timers — owned here, ticked exactly once per frame
    if (e.spawnT > 0) e.spawnT--;
    if (e._shatterFxT > 0) e._shatterFxT--;

    if (e.dead) {
      if (e.deathT > 0) e.deathT--;
      return;
    }

    e.bobPhase = (e.bobPhase + this.bobSpeed) % (Math.PI * 2);

    if (e.frozen) {
      this.stepFrozen(player);
      return;
    }

    if (e._hurtT > 0) e._hurtT--;
    if (e.spawnT > 0) return; // still materializing — no AI yet

    const dx = player.x - e.x;
    const dz = player.z - e.z;
    const dist2D = Math.sqrt(dx * dx + dz * dz);
    const dy = player.y - e.y;

    // Line-of-sight aggro: close horizontally AND roughly same height
    const aggroed = dist2D < this.aggroRadius && Math.abs(dy) < AGGRO_MAX_DY;

    if (!aggroed) {
      this.patrol(platforms);
    } else {
      this.chase(dx, dz, dist2D);
      _clampToIsland(e, platforms); // never chase off the island edge
      this.combat(player, dist2D, dy, hud, flashFn);
      this.contactAttack(player, dist2D, dy, hud, flashFn);
    }

    _groundEnemy(e, platforms);
  }

  stepFrozen(player) {
    const e = this.e;
    e.frozenT--;
    if (e.frozenT <= 0) {
      // Natural thaw — NO hp loss; brief i-frames so beam spam can't chain-freeze
      e.frozen = false;
      e.frozenT = 0;
      e._hurtT = this.isBoss ? 30 : 18;
      return;
    }
    // Player touching a frozen enemy shatters it
    const dx = player.x - e.x, dy = player.y - e.y, dz = player.z - e.z;
    const r = (e.hitRadius ?? 2.0) + CONTACT_PAD;
    if (dx * dx + dy * dy + dz * dz < r * r) {
      shatterEnemy(e);
    }
  }

  // Waypoint patrol: 3-4 points generated lazily inside home island bounds
  patrol(platforms) {
    const e = this.e;
    _findHomeIsland(e, platforms);
    const h = e._homeIsland;

    if (!e._waypoints) {
      if (!h) {
        // No island found — fall back to gentle random walk
        if (!e._patrolAngle || Math.random() < 0.01) {
          e._patrolAngle = Math.random() * Math.PI * 2;
        }
        e.x += Math.sin(e._patrolAngle) * this.patrolSpeed;
        e.z += Math.cos(e._patrolAngle) * this.patrolSpeed;
        return;
      }
      const margin = 2.5;
      const hw = Math.max(0.5, h.sx - margin);
      const hd = Math.max(0.5, h.sz - margin);
      const count = 3 + ((Math.random() * 2) | 0);
      e._waypoints = [];
      for (let i = 0; i < count; i++) {
        // Ring-ish spread so waypoints don't cluster in the middle
        const a = (i / count) * Math.PI * 2 + Math.random() * 1.2;
        e._waypoints.push({
          x: h.x + Math.sin(a) * hw * (0.35 + Math.random() * 0.55),
          z: h.z + Math.cos(a) * hd * (0.35 + Math.random() * 0.55),
        });
      }
      e._wpIndex = 0;
    }

    const wp = e._waypoints[e._wpIndex];
    const dx = wp.x - e.x, dz = wp.z - e.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d < 1.0) {
      e._wpIndex = (e._wpIndex + 1) % e._waypoints.length;
    } else {
      e.x += (dx / d) * this.patrolSpeed;
      e.z += (dz / d) * this.patrolSpeed;
      e._patrolAngle = Math.atan2(dx / d, dz / d);
    }
    _clampToIsland(e, platforms); // safety
  }

  chase(dx, dz, dist2D) {
    const e = this.e;
    if (dist2D > 0.5) {
      const nx = dx / dist2D;
      const nz = dz / dist2D;
      e.x += nx * this.chaseSpeed;
      e.z += nz * this.chaseSpeed;
      e._patrolAngle = Math.atan2(nx, nz);
    }
  }

  // Touch damage — same recipe as a projectile hit
  contactAttack(player, dist2D, dy, hud, flashFn) {
    const e = this.e;
    const r = (e.hitRadius ?? 2.0) + CONTACT_PAD;
    const d3sq = dist2D * dist2D + dy * dy;
    if (d3sq >= r * r) return;
    if (player.hitT <= 0 && !(player.invulnT > 0) && !(player.state & 0x80)) {
      player.hitT = 45;
      player.vy = 0.15;
      const norm = dist2D + 0.001;
      const kb = this.isBoss ? 0.22 : 0.14;
      player.vx += ((player.x - e.x) / norm) * kb;
      player.vz += ((player.z - e.z) / norm) * kb;
      flashFn(hud, "OUCH!", 40);
    }
  }

  // Ranged attack (regular enemies) — boss overrides with a state machine
  combat(player, dist2D, dy, hud, flashFn) {
    const e = this.e;
    if (dist2D >= this.attackRange) return;
    if (!e._attackCooldown) e._attackCooldown = Math.floor(Math.random() * ATTACK_COOLDOWN);
    e._attackCooldown--;
    if (e._attackCooldown <= 0) {
      e._attackCooldown = ATTACK_COOLDOWN;
      _fireProjectile(e, player, dist2D, dy, this.projSpeed, 0);
    }
  }
}

class RegularEnemyAI extends EnemyAIBase {
}

/**
 * Boss state machine: COOLDOWN → TELEGRAPH (30f flashing tell, boss stops
 * moving) → fire ATTACK1 (3-spread) or ATTACK2 (8-shot radial ring, unlocked
 * at hp<=4) → COOLDOWN. Cooldown shrinks with hp (damage phases).
 */
class BossEnemyAI extends EnemyAIBase {
  chase(dx, dz, dist2D) {
    // Boss holds still while telegraphing an attack
    if (this.e._telegraphT > 0) return;
    super.chase(dx, dz, dist2D);
  }

  combat(player, dist2D, dy, hud, flashFn) {
    const e = this.e;

    if (e._telegraphT > 0) {
      e._telegraphT--;
      if (e._telegraphT <= 0) {
        if (e._nextAttack === 2) {
          // ATTACK2: radial ring of 8 shots
          for (let i = 0; i < 8; i++) {
            const a = (i / 8) * Math.PI * 2;
            _fireProjectileDir(e, Math.sin(a), 0.02, Math.cos(a), this.projSpeed);
          }
        } else {
          // ATTACK1: 3-shot aimed spread
          _fireProjectile(e, player, dist2D, dy, this.projSpeed, -0.12);
          _fireProjectile(e, player, dist2D, dy, this.projSpeed,  0.00);
          _fireProjectile(e, player, dist2D, dy, this.projSpeed,  0.12);
        }
        e._cooldownT = this._phaseCooldown();
      }
      return;
    }

    if (e._cooldownT === undefined) e._cooldownT = this._phaseCooldown();
    if (e._cooldownT > 0) { e._cooldownT--; return; }

    if (dist2D < this.attackRange) {
      // Choose attack: radial unlocked below half HP, then 50/50
      e._nextAttack = (e.hp <= 4 && Math.random() < 0.5) ? 2 : 1;
      e._telegraphT = TELEGRAPH_FRAMES;
    }
  }

  _phaseCooldown() {
    const hp = this.e.hp ?? 6;
    if (hp > 4) return 130; // phase 1: slow
    if (hp > 2) return 90;  // phase 2: mid
    return 55;              // phase 3: enraged
  }
}

function getEnemyAI(enemy) {
  let ai = enemyAIInstances.get(enemy);
  if (!ai) {
    ai = enemy.boss ? new BossEnemyAI(enemy) : new RegularEnemyAI(enemy);
    enemyAIInstances.set(enemy, ai);
  }
  return ai;
}

/**
 * stepEnemyAI — advance all enemies + projectiles for one frame.
 */
export function stepEnemyAI(enemies, player, platforms, frame, hud, flashFn) {
  for (const e of enemies) {
    getEnemyAI(e).step(player, platforms, frame, hud, flashFn);
  }

  // Step projectiles
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const proj = projectiles[i];
    proj.x += proj.vx;
    proj.y += proj.vy;
    proj.z += proj.vz;
    proj.vy -= PROJ_GRAVITY;
    proj.life--;

    const pdx = player.x - proj.x;
    const pdy = player.y - proj.y;
    const pdz = player.z - proj.z;
    const hitR = proj.boss ? BOSS_PROJ_HIT_RADIUS : PROJ_HIT_RADIUS;
    if (Math.sqrt(pdx*pdx + pdy*pdy + pdz*pdz) < hitR) {
      if (player.hitT <= 0 && !(player.invulnT > 0) && !(player.state & 0x80)) {
        player.hitT = 45;
        player.vy = 0.15;
        const norm = Math.sqrt(pdx*pdx + pdz*pdz) + 0.001;
        const knockback = proj.boss ? 0.20 : 0.12;
        player.vx -= (pdx / norm) * knockback;
        player.vz -= (pdz / norm) * knockback;
        flashFn(hud, proj.boss ? "BOSS HIT!" : "OUCH!", 40);
      }
      projectiles.splice(i, 1);
      continue;
    }

    if (proj.life <= 0) {
      projectiles.splice(i, 1);
    }
  }
}

function _fireProjectile(e, player, dist2D, dy, speed, sideOffset) {
  const dx = player.x - e.x;
  const dz = player.z - e.z;
  const dist3 = Math.sqrt(dx*dx + dy*dy + dz*dz) + 0.001;
  const nx = dx / dist3, nz = dz / dist3;
  const px = -nz, pz = nx; // perpendicular for spread
  projectiles.push({
    x: e.x,
    y: e.y + (e.boss ? 3.0 : 1.5),
    z: e.z,
    vx: nx * speed + px * sideOffset,
    vy: (dy / dist3) * speed + 0.05,
    vz: nz * speed + pz * sideOffset,
    life: PROJ_LIFE,
    boss: !!e.boss,
  });
}

// Fire along an explicit direction (radial ring attack)
function _fireProjectileDir(e, nx, ny, nz, speed) {
  projectiles.push({
    x: e.x,
    y: e.y + (e.boss ? 3.0 : 1.5),
    z: e.z,
    vx: nx * speed,
    vy: ny + 0.05,
    vz: nz * speed,
    life: PROJ_LIFE,
    boss: !!e.boss,
  });
}

function _findHomeIsland(e, platforms) {
  if (e._homeIsland) return;
  let best = null, bestD = Infinity;
  for (const p of platforms) {
    if (p.type !== "island" && p.type !== "island_block") continue;
    const dx = e.x - p.x, dz = e.z - p.z;
    const d = dx*dx + dz*dz;
    if (d < bestD) { bestD = d; best = p; }
  }
  e._homeIsland = best;
}

function _clampToIsland(e, platforms) {
  _findHomeIsland(e, platforms);
  if (!e._homeIsland) return;
  const h = e._homeIsland;
  const margin = 2.0;
  if (e.x < h.x - h.sx + margin) e.x = h.x - h.sx + margin;
  if (e.x > h.x + h.sx - margin) e.x = h.x + h.sx - margin;
  if (e.z < h.z - h.sz + margin) e.z = h.z - h.sz + margin;
  if (e.z > h.z + h.sz - margin) e.z = h.z + h.sz - margin;
}

function _groundEnemy(e, platforms) {
  let bestY = e.y - 5;
  for (const p of platforms) {
    const dx = e.x - p.x;
    const dz = e.z - p.z;
    if (Math.abs(dx) > p.sx + 1 || Math.abs(dz) > p.sz + 1) continue;
    if (p.y <= e.y + 0.5 && p.y > bestY) {
      bestY = p.y;
    }
  }
  if (bestY > e.y - 5) {
    // Boss sits higher above platform to account for larger visual
    e.y = bestY + (e.boss ? 1.2 : 0.7) * 8;
  }
}
