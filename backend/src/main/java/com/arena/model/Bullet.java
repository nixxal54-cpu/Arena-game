package com.arena.model;

import java.util.concurrent.atomic.AtomicLong;

/**
 * A projectile in flight.
 * Managed exclusively by the game-loop thread — no synchronization needed.
 */
public class Bullet {

    private static final AtomicLong COUNTER = new AtomicLong(0);

    // ── Constants ─────────────────────────────────────────────────────────────
    public static final double SPEED_PER_SEC  = 55.0;   // units / second
    public static final long   LIFETIME_MS    = 1800;   // ms before auto-expire
    public static final int    DAMAGE         = 20;     // HP per hit
    public static final double HIT_RADIUS     = 1.0;   // collision sphere radius

    // ── Identity ─────────────────────────────────────────────────────────────
    public final String id;
    public final String ownerId;

    // ── Position (updated each tick by CombatSystem) ─────────────────────────
    public double x, y, z;

    // ── Velocity (direction × speed, units/sec) ──────────────────────────────
    public final double vx, vy, vz;

    // ── Lifecycle ─────────────────────────────────────────────────────────────
    public final long createdAtMs;
    public boolean    active = true;

    // ── Constructor ──────────────────────────────────────────────────────────
    public Bullet(String ownerId,
                  double startX, double startY, double startZ,
                  double dirX,   double dirY,   double dirZ) {
        this.id       = "b" + COUNTER.incrementAndGet();
        this.ownerId  = ownerId;
        this.x        = startX;
        this.y        = startY;
        this.z        = startZ;

        // Normalise direction, then scale to speed
        double len = Math.sqrt(dirX * dirX + dirY * dirY + dirZ * dirZ);
        if (len < 1e-6) { len = 1; }
        this.vx = (dirX / len) * SPEED_PER_SEC;
        this.vy = (dirY / len) * SPEED_PER_SEC;
        this.vz = (dirZ / len) * SPEED_PER_SEC;

        this.createdAtMs = System.currentTimeMillis();
    }

    /** Returns true when this bullet has exceeded its lifetime. */
    public boolean isExpired(long nowMs) {
        return nowMs - createdAtMs > LIFETIME_MS;
    }
}
