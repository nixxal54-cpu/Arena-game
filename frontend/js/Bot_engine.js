/**
 * bot_engine.js  ─  Full offline game simulation
 *
 * Replaces the WebSocket server entirely for solo play.
 * Implements:
 *   - Physics (movement, gravity, jumping, collisions)
 *   - Bullet simulation
 *   - Zone shrink (battle royale)
 *   - Bot AI (roam → chase → shoot, dodge)
 *   - Match lifecycle (start, elimination, winner, reset)
 *   - Same event interface as Network so game.js is untouched
 */

// ── Constants (must match feel of Java server) ────────────────────────────────
const SIM_HZ         = 30;
const ARENA_RADIUS   = 50;
const PLAYER_SPEED   = 8.5;
const BULLET_SPEED   = 28;
const BULLET_TTL     = 2.2;      // seconds
const BULLET_DMG     = 22;
const JUMP_VEL       = 7.5;
const GRAVITY        = 18;
const PLAYER_HEIGHT  = 1.8;
const PLAYER_RADIUS  = 0.55;
const START_HP       = 100;
const BOT_COUNT      = 7;

// Zone schedule: [radiusAfterShrink, shrinkDuration_s, waitBeforeShrink_s]
const ZONE_STAGES = [
    { radius: 50, wait: 20 },
    { radius: 35, wait: 18 },
    { radius: 24, wait: 15 },
    { radius: 16, wait: 12 },
    { radius: 10, wait: 10 },
    { radius:  5, wait:  8 },
    { radius:  2, wait:  5 },
];
const ZONE_DAMAGE_PER_SEC = 8;

// Cover obstacle AABB list (matches renderer cover positions)
const OBSTACLES = [
    { x: 14, z:  8, hw: 2,   hd: 2   },
    { x:-14, z:  8, hw: 2,   hd: 2   },
    { x:  8, z:-14, hw: 2,   hd: 2   },
    { x: -8, z:-14, hw: 2,   hd: 2   },
    { x: 28, z:  2, hw: 2.5, hd: 1.5 },
    { x:-28, z:  2, hw: 2.5, hd: 1.5 },
    { x:  2, z: 28, hw: 1.5, hd: 2.5 },
    { x:  2, z:-28, hw: 1.5, hd: 2.5 },
    // Central keep
    { x: 0,  z:  0, hw: 4,   hd: 4   },
];

// ── Unique ID helper ──────────────────────────────────────────────────────────
let _uid = 0;
function uid(prefix) { return `${prefix}_${++_uid}`; }

// ── Vec2 helpers ──────────────────────────────────────────────────────────────
function dist2D(ax, az, bx, bz) {
    const dx = ax - bx, dz = az - bz;
    return Math.sqrt(dx * dx + dz * dz);
}
function normalize2D(dx, dz) {
    const len = Math.sqrt(dx * dx + dz * dz) || 1;
    return { x: dx / len, z: dz / len };
}

// ── Bot names ─────────────────────────────────────────────────────────────────
const BOT_NAMES = [
    'Viper', 'Ghost', 'Blaze', 'Storm', 'Reaper',
    'Titan', 'Nova',  'Shade', 'Cobra', 'Rogue',
    'Drift', 'Banshee','Specter','Havoc','Onyx'
];

// =============================================================================
//  LocalServer  ─  drop-in replacement for Network
// =============================================================================
class LocalServer {
    constructor() {
        this._handlers  = {};
        this.connected  = true;       // always "connected"
        this._sim       = null;
        this._inputTick = null;
        this._latestInput = { moveX: 0, moveZ: 0, yaw: 0, pitch: 0, shoot: false, jump: false };
    }

    // ── Network-compatible API ────────────────────────────────────────────────

    on(type, fn) {
        if (!this._handlers[type]) this._handlers[type] = [];
        this._handlers[type].push(fn);
    }
    off(type, fn) {
        if (!this._handlers[type]) return;
        this._handlers[type] = this._handlers[type].filter(h => h !== fn);
    }
    _emit(type, data) {
        const hs = this._handlers[type];
        if (!hs) return;
        for (const fn of hs) { try { fn(data); } catch(e) { console.error(e); } }
    }

    join(name) {
        // Start simulation
        this._sim = new GameSim(name, (event, data) => this._emit(event, data));
        this._sim.start();
    }

    sendInput(state) {
        // Forward to sim
        if (this._sim) this._sim.setPlayerInput(state);
    }
}

// =============================================================================
//  GameSim  ─  full authoritative simulation
// =============================================================================
class GameSim {
    constructor(playerName, emit) {
        this._emit  = emit;
        this._name  = playerName;
        this._dt    = 1 / SIM_HZ;
        this._timer = null;

        // Entity stores
        this._players = new Map();   // id → PlayerState
        this._bullets = new Map();   // id → BulletState
        this._bots    = new Map();   // id → BotAI

        // Match state
        this._matchState  = 'WAITING';
        this._localId     = null;

        // Zone
        this._zone = {
            x: 0, z: 0,
            radius: ZONE_STAGES[0].radius,
            targetRadius: ZONE_STAGES[0].radius,
            stageIdx: 0,
            shrinking: false,
            shrinkSpeed: 0,
            waitMs: ZONE_STAGES[0].wait * 1000,
            nextShrinkMs: ZONE_STAGES[0].wait * 1000,
        };

        // Input buffer
        this._input = { moveX:0, moveZ:0, yaw:0, pitch:0, shoot:false, jump:false };
        this._shootCooldown = 0;
    }

    // ── Boot ──────────────────────────────────────────────────────────────────

    start() {
        // Emit connected + welcome immediately
        this._emit('connected', {});

        // Create local player
        const spawn = this._safeSpawn();
        const localId = uid('player');
        this._localId = localId;
        this._players.set(localId, {
            id: localId, name: this._name,
            x: spawn.x, y: 0, z: spawn.z,
            vy: 0, onGround: true,
            yaw: 0, pitch: 0,
            health: START_HP, alive: true,
            isBot: false,
            shootCd: 0,
        });

        // Spawn bots
        for (let i = 0; i < BOT_COUNT; i++) {
            const bspawn = this._safeSpawn();
            const botId  = uid('bot');
            const bname  = BOT_NAMES[i % BOT_NAMES.length];
            const bp = {
                id: botId, name: bname,
                x: bspawn.x, y: 0, z: bspawn.z,
                vy: 0, onGround: true,
                yaw: Math.random() * Math.PI * 2, pitch: 0,
                health: START_HP, alive: true,
                isBot: true,
                shootCd: 0,
            };
            this._players.set(botId, bp);
            this._bots.set(botId, new BotAI(botId, bname));
        }

        // Emit joined
        this._emit('joined', {
            playerId: localId,
            playerName: this._name,
            matchState: 'RUNNING',
        });

        // Emit matchStart
        this._matchState = 'RUNNING';
        this._emit('matchStart', { playerCount: this._players.size });

        // Start tick loop
        this._timer = setInterval(() => this._tick(), this._dt * 1000);
    }

    setPlayerInput(inp) { this._input = inp; }

    // ── Main tick ─────────────────────────────────────────────────────────────

    _tick() {
        const dt = this._dt;

        // Update bots
        this._bots.forEach((bot, id) => {
            const bp = this._players.get(id);
            if (!bp || !bp.alive) return;
            const inp = bot.think(bp, this._players, this._zone, dt);
            this._applyInput(bp, inp, dt);
        });

        // Apply local player input
        const lp = this._players.get(this._localId);
        if (lp && lp.alive) {
            this._applyInput(lp, this._input, dt);
        }

        // Update bullets
        const deadBullets = [];
        this._bullets.forEach((b, id) => {
            b.x += b.dx * dt;
            b.y += b.dy * dt;
            b.z += b.dz * dt;
            b.ttl -= dt;

            if (b.ttl <= 0) { deadBullets.push(id); return; }

            // Hit detection
            this._players.forEach((p) => {
                if (!p.alive || p.id === b.ownerId) return;
                const dx = p.x - b.x, dz = p.z - b.z;
                const dy = (p.y + PLAYER_HEIGHT / 2) - b.y;
                if (Math.sqrt(dx*dx + dz*dz) < PLAYER_RADIUS && Math.abs(dy) < PLAYER_HEIGHT) {
                    p.health -= BULLET_DMG;
                    deadBullets.push(id);

                    if (p.id === this._localId) {
                        this._emit('hit', { targetId: p.id, remainingHealth: Math.max(0, p.health) });
                    }

                    if (p.health <= 0) {
                        this._eliminate(p, b.ownerId);
                    }
                }
            });
        });
        deadBullets.forEach(id => this._bullets.delete(id));

        // Zone tick
        this._tickZone(dt);

        // Zone damage
        this._players.forEach(p => {
            if (!p.alive) return;
            const d = dist2D(p.x, p.z, this._zone.x, this._zone.z);
            if (d > this._zone.radius) {
                p.health -= ZONE_DAMAGE_PER_SEC * dt;
                if (p.id === this._localId) {
                    this._emit('hit', { targetId: p.id, remainingHealth: Math.max(0, p.health) });
                }
                if (p.health <= 0) this._eliminate(p, null);
            }
        });

        // Emit authoritative state
        this._emit('state', this._buildStatePacket());
    }

    // ── Physics & input application ───────────────────────────────────────────

    _applyInput(p, inp, dt) {
        if (!p.alive) return;

        // Look
        p.yaw   = inp.yaw   ?? p.yaw;
        p.pitch = inp.pitch ?? p.pitch;

        // Move (yaw-relative)
        const sinY = Math.sin(p.yaw), cosY = Math.cos(p.yaw);
        // inp.moveZ = forward/back, inp.moveX = strafe
        const worldX = inp.moveX * cosY + inp.moveZ * sinY;
        const worldZ = -inp.moveX * sinY + inp.moveZ * cosY;

        p.x += worldX * PLAYER_SPEED * dt;
        p.z += worldZ * PLAYER_SPEED * dt;

        // Gravity & jump
        if (inp.jump && p.onGround) { p.vy = JUMP_VEL; p.onGround = false; }
        p.vy -= GRAVITY * dt;
        p.y  += p.vy * dt;
        if (p.y <= 0) { p.y = 0; p.vy = 0; p.onGround = true; }

        // Arena boundary
        const r = dist2D(p.x, p.z, 0, 0);
        if (r > ARENA_RADIUS - 0.5) {
            const n = normalize2D(p.x, p.z);
            p.x = n.x * (ARENA_RADIUS - 0.5);
            p.z = n.z * (ARENA_RADIUS - 0.5);
        }

        // Simple obstacle push-out
        OBSTACLES.forEach(ob => {
            const dx = p.x - ob.x, dz = p.z - ob.z;
            const px = ob.hw + PLAYER_RADIUS - Math.abs(dx);
            const pz = ob.hd + PLAYER_RADIUS - Math.abs(dz);
            if (px > 0 && pz > 0) {
                if (px < pz) p.x += dx > 0 ? px : -px;
                else         p.z += dz > 0 ? pz : -pz;
            }
        });

        // Shoot
        p.shootCd = Math.max(0, p.shootCd - dt);
        if (inp.shoot && p.shootCd <= 0) {
            this._fireBullet(p);
            p.shootCd = 0.18;   // ~5.5 rps
        }
    }

    _fireBullet(p) {
        const id  = uid('b');
        const spd = BULLET_SPEED;
        const cp  = Math.cos(p.pitch), sp = Math.sin(p.pitch);
        const sy  = Math.sin(p.yaw),   cy = Math.cos(p.yaw);
        this._bullets.set(id, {
            id,
            ownerId: p.id,
            x: p.x + sy * 0.6,
            y: p.y + PLAYER_HEIGHT * 0.85,
            z: p.z + cy * 0.6,
            dx: sy * cp * spd,
            dy: sp * spd,
            dz: cy * cp * spd,
            ttl: BULLET_TTL,
        });
    }

    // ── Zone ──────────────────────────────────────────────────────────────────

    _tickZone(dt) {
        const z = this._zone;
        if (z.shrinking) {
            z.radius -= z.shrinkSpeed * dt;
            if (z.radius <= z.targetRadius) {
                z.radius   = z.targetRadius;
                z.shrinking = false;
                // Advance to next stage
                const next = z.stageIdx + 1;
                if (next < ZONE_STAGES.length) {
                    z.stageIdx    = next;
                    z.waitMs      = ZONE_STAGES[next].wait * 1000;
                    z.nextShrinkMs = z.waitMs;
                }
            }
        } else {
            z.nextShrinkMs -= dt * 1000;
            if (z.nextShrinkMs <= 0) {
                const next = z.stageIdx + 1;
                if (next < ZONE_STAGES.length) {
                    z.targetRadius = ZONE_STAGES[next].radius;
                    const shrinkAmt = z.radius - z.targetRadius;
                    // Shrink over ~8 seconds
                    z.shrinkSpeed = shrinkAmt / 8;
                    z.shrinking   = true;
                }
            }
        }
    }

    // ── Elimination ───────────────────────────────────────────────────────────

    _eliminate(p, killerId) {
        if (!p.alive) return;
        p.alive  = false;
        p.health = 0;

        const killer = killerId ? this._players.get(killerId) : null;
        this._emit('eliminated', {
            playerId:   p.id,
            playerName: p.name,
            killerId:   killer?.id   ?? null,
            killerName: killer?.name ?? null,
        });

        // Respawn bots after 4 s so the game stays populated
        if (p.isBot) {
            setTimeout(() => this._respawnBot(p), 4000);
        }

        this._checkWin();
    }

    _respawnBot(p) {
        if (this._matchState !== 'RUNNING') return;
        const sp = this._safeSpawn();
        p.x = sp.x; p.z = sp.z; p.y = 0;
        p.health = START_HP;
        p.alive  = true;
        p.vy     = 0;
        p.onGround = true;
        p.shootCd  = 1 + Math.random();
        // Reset bot brain
        const bot = this._bots.get(p.id);
        if (bot) bot.reset();
        this._emit('playerJoined', { playerName: p.name, playerCount: this._alivePlayers().length });
    }

    _checkWin() {
        // Win = local player is last human alive (bots respawn so never truly gone)
        const lp = this._players.get(this._localId);
        if (!lp || !lp.alive) {
            // Player died — no win check
            return;
        }
        // Count alive humans vs alive total
        const aliveBots = [...this._players.values()].filter(p => p.isBot && p.alive).length;
        // Announce a "wave cleared" milestone every time bots are all temporarily down
        if (aliveBots === 0) {
            this._emit('winner', {
                winnerId:   this._localId,
                winnerName: this._name,
            });
            // Auto-reset after 5 s to next wave
            setTimeout(() => this._nextWave(), 6000);
        }
    }

    _nextWave() {
        // Reset zone and re-scatter bots
        this._zone = {
            x: 0, z: 0,
            radius: ZONE_STAGES[0].radius,
            targetRadius: ZONE_STAGES[0].radius,
            stageIdx: 0, shrinking: false, shrinkSpeed: 0,
            waitMs: ZONE_STAGES[0].wait * 1000,
            nextShrinkMs: ZONE_STAGES[0].wait * 1000,
        };
        this._bullets.clear();

        // Restore local player
        const lp = this._players.get(this._localId);
        if (lp) {
            const sp = this._safeSpawn();
            lp.x = sp.x; lp.z = sp.z; lp.y = 0;
            lp.health = START_HP; lp.alive = true; lp.vy = 0;
        }

        // Respawn all bots immediately
        this._players.forEach(p => {
            if (p.isBot) {
                const sp = this._safeSpawn();
                p.x = sp.x; p.z = sp.z; p.y = 0;
                p.health = START_HP; p.alive = true; p.vy = 0;
                p.onGround = true; p.shootCd = 1 + Math.random();
                const bot = this._bots.get(p.id);
                if (bot) bot.reset();
            }
        });

        this._matchState = 'RUNNING';
        this._emit('matchReset', {});
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    _safeSpawn() {
        for (let i = 0; i < 20; i++) {
            const angle = Math.random() * Math.PI * 2;
            const r     = 10 + Math.random() * 32;
            const x     = Math.sin(angle) * r;
            const z     = Math.cos(angle) * r;
            // Check not inside an obstacle
            const clear = OBSTACLES.every(ob =>
                Math.abs(x - ob.x) > ob.hw + 1.5 || Math.abs(z - ob.z) > ob.hd + 1.5
            );
            if (clear) return { x, z };
        }
        return { x: (Math.random()-0.5)*30, z: (Math.random()-0.5)*30 };
    }

    _alivePlayers() {
        return [...this._players.values()].filter(p => p.alive);
    }

    _buildStatePacket() {
        const players = [];
        this._players.forEach(p => {
            players.push({
                id: p.id, name: p.name,
                x: p.x, y: p.y, z: p.z,
                yaw: p.yaw, pitch: p.pitch,
                health: p.health, alive: p.alive,
            });
        });

        const bullets = [];
        this._bullets.forEach(b => {
            bullets.push({ id: b.id, x: b.x, y: b.y, z: b.z });
        });

        return {
            type: 'state',
            matchState: this._matchState,
            players,
            bullets,
            zone: { ...this._zone },
        };
    }
}

// =============================================================================
//  BotAI  ─  simple but fun behaviour tree
// =============================================================================
class BotAI {
    constructor(id, name) {
        this.id   = id;
        this.name = name;
        this.reset();
    }

    reset() {
        this._state      = 'roam';    // roam | chase | strafe | retreat
        this._targetId   = null;
        this._wanderYaw  = Math.random() * Math.PI * 2;
        this._wanderTimer = 0;
        this._strafeDir  = Math.random() > 0.5 ? 1 : -1;
        this._strafeTimer = 0;
        this._jumpTimer   = 0;
    }

    /**
     * @param {Object} self   Own PlayerState
     * @param {Map}    players All PlayerState map
     * @param {Object} zone
     * @param {number} dt
     * @returns input snapshot
     */
    think(self, players, zone, dt) {
        // Find nearest visible alive enemy
        let nearest = null, nearestDist = Infinity;
        players.forEach(p => {
            if (p.id === self.id || !p.alive) return;
            const d = dist2D(self.x, self.z, p.x, p.z);
            if (d < nearestDist) { nearestDist = d; nearest = p; }
        });

        this._wanderTimer  -= dt;
        this._strafeTimer  -= dt;
        this._jumpTimer    -= dt;

        // ── State transitions ──────────────────────────────────────────────────
        if (nearest && nearestDist < 36) {
            this._state    = nearestDist < 6 ? 'retreat' : 'chase';
            this._targetId = nearest.id;
        } else {
            this._state    = 'roam';
            this._targetId = null;
        }

        // Zone flee: if outside zone, run toward center
        const distToZone = dist2D(self.x, self.z, zone.x, zone.z);
        const inZone     = distToZone < zone.radius - 2;

        let moveX = 0, moveZ = 0, shoot = false, jump = false;
        let targetYaw = self.yaw;

        if (!inZone) {
            // Run to zone center
            const dx = zone.x - self.x, dz = zone.z - self.z;
            targetYaw = Math.atan2(dx, dz);
            moveZ = 1;
        } else if (this._state === 'roam') {
            // Random wander
            if (this._wanderTimer <= 0) {
                this._wanderYaw   = self.yaw + (Math.random() - 0.5) * Math.PI;
                this._wanderTimer = 1.5 + Math.random() * 2;
            }
            targetYaw = this._wanderYaw;
            moveZ = 0.6;
        } else if (this._state === 'chase' || this._state === 'retreat') {
            const dx = nearest.x - self.x, dz = nearest.z - self.z;
            targetYaw = Math.atan2(dx, dz);

            if (this._state === 'retreat') {
                // Back away + strafe
                moveZ = -0.8;
            } else {
                // Approach until ~12 units, then strafe
                if (nearestDist > 12) {
                    moveZ = 1;
                } else {
                    // Strafe sideways
                    if (this._strafeTimer <= 0) {
                        this._strafeDir   = -this._strafeDir;
                        this._strafeTimer  = 0.8 + Math.random();
                    }
                    moveX = this._strafeDir * 0.9;
                    moveZ = 0.2;
                }
                shoot = nearestDist < 30;
            }

            // Pitch toward target (vertical)
            const dy = (nearest.y + 0.9) - (self.y + 1.4);
            const horiz = Math.sqrt(dx*dx + dz*dz);
            // pitch stored in yaw of output — we pass via yaw field
        }

        // Smooth yaw toward target
        let dyaw = targetYaw - self.yaw;
        while (dyaw >  Math.PI) dyaw -= Math.PI * 2;
        while (dyaw < -Math.PI) dyaw += Math.PI * 2;
        self.yaw += dyaw * Math.min(1, dt * 4.5);

        // Aim pitch at target
        let pitch = 0;
        if (nearest && (this._state === 'chase' || this._state === 'retreat')) {
            const dx = nearest.x - self.x, dz = nearest.z - self.z;
            const dy = (nearest.y + 0.9) - (self.y + 1.4);
            pitch = Math.atan2(dy, Math.sqrt(dx*dx + dz*dz));
        }

        // Occasional jump
        if (this._jumpTimer <= 0 && Math.random() < 0.008) {
            jump = true;
            this._jumpTimer = 3 + Math.random() * 4;
        }

        // Add noise so bots aren't perfect aimers
        if (shoot) {
            self.yaw   += (Math.random() - 0.5) * 0.12;
            pitch       += (Math.random() - 0.5) * 0.08;
        }

        return {
            moveX, moveZ,
            yaw: self.yaw, pitch,
            shoot, jump,
        };
    }
}
