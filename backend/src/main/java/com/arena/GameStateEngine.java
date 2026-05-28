package com.arena;

import com.arena.model.*;
import com.google.gson.*;

import java.util.*;
import java.util.concurrent.*;
import java.util.logging.Logger;
import java.util.stream.Collectors;

/**
 * The authoritative game loop.
 *
 * Runs on its own thread at TARGET_TPS ticks per second.
 * All game state is owned and mutated exclusively by this thread.
 * WebSocket threads submit inputs via the thread-safe {@code inputQueue}.
 */
public class GameStateEngine implements Runnable {

    private static final Logger LOG = Logger.getLogger(GameStateEngine.class.getName());

    // ── Tick rate ─────────────────────────────────────────────────────────────
    private static final int    TARGET_TPS   = 30;
    private static final long   TICK_MS      = 1000L / TARGET_TPS;

    // ── Physics constants ─────────────────────────────────────────────────────
    private static final double PLAYER_SPEED  = 10.0;   // units/s
    private static final double GRAVITY       = -22.0;  // units/s²
    private static final double JUMP_VEL      =  9.0;   // units/s initial
    private static final double GROUND_Y      =  0.0;
    private static final double ARENA_RADIUS  = 50.0;

    // ── Match config ──────────────────────────────────────────────────────────
    private static final int  MIN_PLAYERS_TO_START = 2;
    private static final long POST_MATCH_DELAY_MS  = 10_000L;

    // ── Sub-systems (game-loop-thread-only access) ────────────────────────────
    private final Map<String, Player> players     = new LinkedHashMap<>();
    private final List<Bullet>        bullets     = new ArrayList<>();
    private final ZoneSystem          zone        = new ZoneSystem();
    private final CombatSystem        combat      = new CombatSystem();
    private final GameRoomManager     room;
    private final Gson                gson        = new GsonBuilder().create();

    // ── Cross-thread input queue ──────────────────────────────────────────────
    private record InputEvent(String playerId, InputMessage input) {}
    private final ConcurrentLinkedQueue<InputEvent> inputQueue = new ConcurrentLinkedQueue<>();

    // ── Cross-thread join / leave queues ─────────────────────────────────────
    private record JoinEvent(Player player) {}
    private final ConcurrentLinkedQueue<JoinEvent>  joinQueue  = new ConcurrentLinkedQueue<>();
    private final ConcurrentLinkedQueue<String>     leaveQueue = new ConcurrentLinkedQueue<>();

    // ── Match state (read safely by WS thread via getMatchState()) ───────────
    private volatile String matchState = "WAITING";  // WAITING | RUNNING | ENDED
    private volatile String winnerId   = null;

    private long tickCount = 0;

    // ─────────────────────────────────────────────────────────────────────────

    public GameStateEngine(GameRoomManager room) {
        this.room = room;
    }

    // ── Public API (called from WebSocket threads) ────────────────────────────

    public void queueJoin(Player player) {
        joinQueue.offer(new JoinEvent(player));
    }

    public void queueLeave(String playerId) {
        leaveQueue.offer(playerId);
    }

    public void queueInput(String playerId, InputMessage input) {
        inputQueue.offer(new InputEvent(playerId, input));
    }

    public String getMatchState() { return matchState; }

    // ── Game loop ─────────────────────────────────────────────────────────────

    @Override
    public void run() {
        LOG.info("Game loop started at " + TARGET_TPS + " TPS");
        long lastNs = System.nanoTime();

        while (!Thread.currentThread().isInterrupted()) {
            long nowNs   = System.nanoTime();
            long elapsedMs = (nowNs - lastNs) / 1_000_000L;

            if (elapsedMs >= TICK_MS) {
                double deltaSec = Math.min(elapsedMs / 1000.0, 0.1); // cap at 100 ms
                lastNs = nowNs;
                tick(deltaSec);
            } else {
                try { Thread.sleep(1); }
                catch (InterruptedException e) { Thread.currentThread().interrupt(); break; }
            }
        }
        LOG.info("Game loop stopped");
    }

    // ─────────────────────────────────────────────────────────────────────────

    private void tick(double dt) {
        tickCount++;

        // 1. Process join / leave events
        processJoins();
        processLeaves();

        // 2. Apply inputs
        processInputs();

        // 3. Simulation step (only while match is RUNNING)
        if ("RUNNING".equals(matchState)) {
            simulatePhysics(dt);
            processShots();
            processBulletsAndHits(dt);
            zone.update(dt);
            applyZoneDamage(dt);
            checkWinCondition();
        }

        // 4. Broadcast full state to all clients
        broadcastState();
    }

    // ── Join / Leave ──────────────────────────────────────────────────────────

    private void processJoins() {
        JoinEvent ev;
        while ((ev = joinQueue.poll()) != null) {
            Player p = ev.player();
            spawnPlayer(p);
            players.put(p.id, p);
            LOG.info("Player joined: " + p.name + " [" + p.id + "] total=" + players.size());

            // Notify everyone of the new player
            JsonObject msg = new JsonObject();
            msg.addProperty("type",        "playerJoined");
            msg.addProperty("playerId",    p.id);
            msg.addProperty("playerName",  p.name);
            msg.addProperty("playerCount", players.size());
            room.broadcast(msg.toString());

            tryStartMatch();
        }
    }

    private void processLeaves() {
        String id;
        while ((id = leaveQueue.poll()) != null) {
            Player p = players.remove(id);
            if (p != null) {
                LOG.info("Player left: " + p.name + " [" + p.id + "]");
                JsonObject msg = new JsonObject();
                msg.addProperty("type",        "playerLeft");
                msg.addProperty("playerId",    id);
                msg.addProperty("playerName",  p.name);
                msg.addProperty("playerCount", players.size());
                room.broadcast(msg.toString());
            }

            // If running, check if only 1 remains
            if ("RUNNING".equals(matchState)) checkWinCondition();

            // If no players left, reset to WAITING
            if (players.isEmpty()) {
                matchState = "WAITING";
                zone.reset();
                bullets.clear();
            }
        }
    }

    // ── Inputs ────────────────────────────────────────────────────────────────

    private void processInputs() {
        InputEvent ev;
        while ((ev = inputQueue.poll()) != null) {
            Player p = players.get(ev.playerId());
            if (p == null || !p.alive) continue;
            InputMessage m = ev.input();

            if (m.move  != null) {
                p.inputMoveX = clamp(m.move.x, -1, 1);
                p.inputMoveZ = clamp(m.move.z, -1, 1);
            }
            if (m.look != null) {
                p.yaw        = m.look.yaw;
                p.pitch      = clamp(m.look.pitch, -Math.PI / 2.0, Math.PI / 2.0);
                p.inputYaw   = p.yaw;
                p.inputPitch = p.pitch;
            }
            p.inputShoot = m.shoot;
            p.inputJump  = m.jump;
        }
    }

    // ── Physics ───────────────────────────────────────────────────────────────

    private void simulatePhysics(double dt) {
        for (Player p : players.values()) {
            if (!p.alive) continue;

            // World-space movement from local-space input + yaw
            double sinYaw = Math.sin(p.yaw);
            double cosYaw = Math.cos(p.yaw);

            double wdx = p.inputMoveX * cosYaw + p.inputMoveZ * sinYaw;
            double wdz = -p.inputMoveX * sinYaw + p.inputMoveZ * cosYaw;

            // Normalise diagonal movement
            double hLen = Math.sqrt(wdx * wdx + wdz * wdz);
            if (hLen > 1.0) { wdx /= hLen; wdz /= hLen; }

            p.velX = wdx * PLAYER_SPEED;
            p.velZ = wdz * PLAYER_SPEED;

            // Jump
            if (p.onGround && p.inputJump) {
                p.velY    = JUMP_VEL;
                p.onGround = false;
                p.inputJump = false;
            }

            // Gravity
            if (!p.onGround) {
                p.velY += GRAVITY * dt;
            }

            // Integrate position
            p.x += p.velX * dt;
            p.y += p.velY * dt;
            p.z += p.velZ * dt;

            // Ground collision
            if (p.y <= GROUND_Y) {
                p.y        = GROUND_Y;
                p.velY     = 0;
                p.onGround = true;
            }

            // Arena boundary (hard wall)
            double dist = Math.sqrt(p.x * p.x + p.z * p.z);
            if (dist > ARENA_RADIUS) {
                double scale = (ARENA_RADIUS - 0.01) / dist;
                p.x *= scale;
                p.z *= scale;
            }
        }
    }

    // ── Shooting ──────────────────────────────────────────────────────────────

    private void processShots() {
        long now = System.currentTimeMillis();
        for (Player p : players.values()) {
            if (!p.alive || !p.inputShoot) continue;
            if (!p.canShoot(now)) continue;

            p.lastShootTimeMs = now;
            p.inputShoot = false;
            bullets.add(combat.createBullet(p));

            // Notify shooter of their own shot for visual feedback
            JsonObject shotMsg = new JsonObject();
            shotMsg.addProperty("type",     "shot");
            shotMsg.addProperty("shooterId", p.id);
            room.broadcast(shotMsg.toString());
        }
    }

    private void processBulletsAndHits(double dt) {
        List<CombatSystem.HitResult> hits = combat.processBullets(bullets, players, dt);
        for (CombatSystem.HitResult hr : hits) {
            // Broadcast hit event
            JsonObject msg = new JsonObject();
            msg.addProperty("type",            "hit");
            msg.addProperty("shooterId",       hr.shooterId);
            msg.addProperty("targetId",        hr.targetId);
            msg.addProperty("damage",          hr.damage);
            msg.addProperty("remainingHealth", hr.remainingHealth);
            room.broadcast(msg.toString());

            if (hr.eliminated) {
                broadcastElimination(hr.targetId, hr.shooterId);
            }
        }
    }

    // ── Zone damage ───────────────────────────────────────────────────────────

    private void applyZoneDamage(double dt) {
        for (Player p : players.values()) {
            if (!p.alive) continue;
            if (!zone.isInside(p.x, p.z)) {
                // Accumulate fractional damage; deal integer HP each tick
                int dmg = (int) Math.round(ZoneSystem.ZONE_DAMAGE_PER_SEC * dt);
                if (dmg > 0) {
                    p.takeDamage(dmg);
                    if (!p.alive) {
                        broadcastElimination(p.id, null);
                    }
                }
            }
        }
    }

    // ── Match lifecycle ───────────────────────────────────────────────────────

    private void tryStartMatch() {
        if ("WAITING".equals(matchState) && players.size() >= MIN_PLAYERS_TO_START) {
            matchState = "RUNNING";
            zone.start();
            winnerId = null;
            LOG.info("Match started with " + players.size() + " players");

            JsonObject msg = new JsonObject();
            msg.addProperty("type",        "matchStart");
            msg.addProperty("playerCount", players.size());
            room.broadcast(msg.toString());
        }
    }

    private void checkWinCondition() {
        if (!"RUNNING".equals(matchState)) return;

        List<Player> alive = players.values().stream()
                .filter(p -> p.alive)
                .collect(Collectors.toList());

        if (alive.size() <= 1) {
            matchState = "ENDED";
            winnerId   = alive.isEmpty() ? null : alive.get(0).id;

            JsonObject msg = new JsonObject();
            msg.addProperty("type", "winner");
            if (winnerId != null) {
                Player w = players.get(winnerId);
                msg.addProperty("winnerId",   winnerId);
                msg.addProperty("winnerName", w != null ? w.name : "Unknown");
            } else {
                msg.addProperty("winnerId",   "");
                msg.addProperty("winnerName", "Nobody");
            }
            room.broadcast(msg.toString());
            LOG.info("Match ended. Winner: " + winnerId);

            // Schedule reset
            Thread resetThread = new Thread(() -> {
                try { Thread.sleep(POST_MATCH_DELAY_MS); } catch (InterruptedException ignored) {}
                scheduleReset();
            }, "MatchReset");
            resetThread.setDaemon(true);
            resetThread.start();
        }
    }

    private void scheduleReset() {
        // Reset player health and positions
        for (Player p : players.values()) {
            spawnPlayer(p);
            p.health = 100;
            p.alive  = true;
        }
        bullets.clear();
        zone.reset();
        winnerId = null;

        if (players.size() >= MIN_PLAYERS_TO_START) {
            matchState = "RUNNING";
            zone.start();
            JsonObject msg = new JsonObject();
            msg.addProperty("type", "matchReset");
            room.broadcast(msg.toString());
            LOG.info("Match reset. New round starting.");
        } else {
            matchState = "WAITING";
        }
    }

    // ── State broadcast ───────────────────────────────────────────────────────

    private void broadcastState() {
        JsonObject root = new JsonObject();
        root.addProperty("type",       "state");
        root.addProperty("matchState", matchState);
        root.addProperty("tick",       tickCount);
        if (winnerId != null) root.addProperty("winnerId", winnerId);

        // Players
        JsonArray pa = new JsonArray();
        for (Player p : players.values()) {
            JsonObject po = new JsonObject();
            po.addProperty("id",     p.id);
            po.addProperty("name",   p.name);
            po.addProperty("x",      round(p.x));
            po.addProperty("y",      round(p.y));
            po.addProperty("z",      round(p.z));
            po.addProperty("yaw",    round(p.yaw));
            po.addProperty("pitch",  round(p.pitch));
            po.addProperty("health", p.health);
            po.addProperty("alive",  p.alive);
            po.addProperty("kills",  p.kills);
            pa.add(po);
        }
        root.add("players", pa);

        // Bullets
        JsonArray ba = new JsonArray();
        for (Bullet b : bullets) {
            if (!b.active) continue;
            JsonObject bo = new JsonObject();
            bo.addProperty("id", b.id);
            bo.addProperty("x",  round(b.x));
            bo.addProperty("y",  round(b.y));
            bo.addProperty("z",  round(b.z));
            bo.addProperty("vx", round(b.vx));
            bo.addProperty("vy", round(b.vy));
            bo.addProperty("vz", round(b.vz));
            ba.add(bo);
        }
        root.add("bullets", ba);

        // Zone
        JsonObject zo = new JsonObject();
        zo.addProperty("x",      zone.centerX);
        zo.addProperty("z",      zone.centerZ);
        zo.addProperty("radius", round(zone.currentRadius));
        zo.addProperty("nextShrinkMs", zone.msUntilNextShrink());
        root.add("zone", zo);

        room.broadcast(root.toString());
    }

    private void broadcastElimination(String eliminatedId, String killerId) {
        Player elim   = players.get(eliminatedId);
        Player killer = killerId != null ? players.get(killerId) : null;

        JsonObject msg = new JsonObject();
        msg.addProperty("type",         "eliminated");
        msg.addProperty("playerId",     eliminatedId);
        msg.addProperty("playerName",   elim   != null ? elim.name   : "?");
        if (killer != null) {
            msg.addProperty("killerId",   killerId);
            msg.addProperty("killerName", killer.name);
        }
        room.broadcast(msg.toString());
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private void spawnPlayer(Player p) {
        double angle  = Math.random() * Math.PI * 2;
        double radius = 15 + Math.random() * 20;
        p.x     = Math.cos(angle) * radius;
        p.z     = Math.sin(angle) * radius;
        p.y     = GROUND_Y;
        p.velX  = 0;  p.velY = 0;  p.velZ = 0;
        p.onGround = true;
        p.yaw   = (Math.random() * Math.PI * 2);
    }

    private static double clamp(double v, double lo, double hi) {
        return Math.max(lo, Math.min(hi, v));
    }

    /** Truncate to 3 decimal places to keep JSON small. */
    private static double round(double v) {
        return Math.round(v * 1000.0) / 1000.0;
    }
}
