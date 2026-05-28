package com.arena;

import com.arena.model.Bullet;
import com.arena.model.Player;

import java.util.*;

/**
 * Stateless combat helper used exclusively by the game-loop thread.
 *
 * Responsibilities:
 *  1. Create a new bullet from a shooter's current state.
 *  2. Move all active bullets one tick and test collisions with players.
 */
public class CombatSystem {

    /**
     * Creates a bullet originating from the shooter's eye position, travelling
     * in the direction defined by the shooter's yaw / pitch.
     */
    public Bullet createBullet(Player shooter) {
        // Eye position (slightly ahead of body centre to avoid self-hit)
        double eyeY = shooter.y + 1.6;
        double offsetFwd = 0.6;

        // World-space forward direction from yaw & pitch
        double dirX =  Math.sin(shooter.yaw)  * Math.cos(shooter.pitch);
        double dirY = -Math.sin(shooter.pitch);
        double dirZ =  Math.cos(shooter.yaw)  * Math.cos(shooter.pitch);

        double spawnX = shooter.x + dirX * offsetFwd;
        double spawnY = eyeY       + dirY * offsetFwd;
        double spawnZ = shooter.z  + dirZ * offsetFwd;

        return new Bullet(shooter.id, spawnX, spawnY, spawnZ, dirX, dirY, dirZ);
    }

    /**
     * Advances all bullets by {@code deltaSec} seconds, tests collisions, and
     * removes expired / inactive bullets from the list.
     *
     * @return List of {@link HitResult} for every bullet-player collision this tick.
     */
    public List<HitResult> processBullets(List<Bullet> bullets,
                                          Map<String, Player> players,
                                          double deltaSec) {
        List<HitResult> hits       = new ArrayList<>();
        List<Bullet>    toRemove   = new ArrayList<>();
        long            nowMs      = System.currentTimeMillis();
        double          arenaLimit = 56.0; // slightly beyond arena radius

        for (Bullet b : bullets) {
            if (!b.active) { toRemove.add(b); continue; }
            if (b.isExpired(nowMs)) { b.active = false; toRemove.add(b); continue; }

            // Advance position
            b.x += b.vx * deltaSec;
            b.y += b.vy * deltaSec;
            b.z += b.vz * deltaSec;

            // Remove if outside arena or below ground
            double horizDist = Math.sqrt(b.x * b.x + b.z * b.z);
            if (horizDist > arenaLimit || b.y < -1.0 || b.y > 30.0) {
                b.active = false; toRemove.add(b); continue;
            }

            // Collision test against all alive players
            boolean hit = false;
            for (Player p : players.values()) {
                if (!p.alive)               continue;
                if (p.id.equals(b.ownerId)) continue;   // no self-damage

                double dx  = b.x - p.x;
                double dy  = b.y - (p.y + 1.0);   // centre of player body
                double dz  = b.z - p.z;
                double d2  = dx * dx + dy * dy + dz * dz;
                double r   = Bullet.HIT_RADIUS;

                if (d2 <= r * r) {
                    p.takeDamage(Bullet.DAMAGE);
                    b.active = false;
                    toRemove.add(b);
                    hits.add(new HitResult(b.ownerId, p.id, Bullet.DAMAGE,
                                           p.health, !p.alive));
                    if (!p.alive) {
                        // Award kill to shooter
                        Player shooter = players.get(b.ownerId);
                        if (shooter != null) shooter.kills++;
                    }
                    hit = true;
                    break;
                }
            }
        }

        bullets.removeAll(toRemove);
        return hits;
    }

    // ── Result DTO ────────────────────────────────────────────────────────────

    public static final class HitResult {
        public final String  shooterId;
        public final String  targetId;
        public final int     damage;
        public final int     remainingHealth;
        public final boolean eliminated;

        public HitResult(String shooterId, String targetId,
                         int damage, int remainingHealth, boolean eliminated) {
            this.shooterId       = shooterId;
            this.targetId        = targetId;
            this.damage          = damage;
            this.remainingHealth = remainingHealth;
            this.eliminated      = eliminated;
        }
    }
}
