package com.arena.model;

import java.util.UUID;

/**
 * Server-side representation of a player.
 * All mutable state is managed exclusively by the GameStateEngine game loop thread.
 * Input fields are volatile because they are written by WebSocket threads and read by the game loop.
 */
public class Player {

    // ── Identity ─────────────────────────────────────────────────────────────
    public final String id;
    public final String name;

    // ── World position & orientation ─────────────────────────────────────────
    public double x = 0, y = 0, z = 0;
    public double yaw   = 0;   // horizontal look angle (radians)
    public double pitch = 0;   // vertical look angle  (radians, clamped ±PI/2)

    // ── Physics velocity ─────────────────────────────────────────────────────
    public double velX = 0, velY = 0, velZ = 0;
    public boolean onGround = true;

    // ── Combat stats ─────────────────────────────────────────────────────────
    public int  health = 100;
    public boolean alive  = true;
    public int  kills  = 0;

    // ── Input state (volatile: written by WS thread, read by game loop) ──────
    public volatile double  inputMoveX  = 0;   // strafe:   -1 (left)  … +1 (right)
    public volatile double  inputMoveZ  = 0;   // forward:  -1 (back)  … +1 (fwd)
    public volatile double  inputYaw    = 0;
    public volatile double  inputPitch  = 0;
    public volatile boolean inputShoot  = false;
    public volatile boolean inputJump   = false;

    // ── Cooldowns ─────────────────────────────────────────────────────────────
    public long lastShootTimeMs = 0;
    public static final long SHOOT_COOLDOWN_MS = 150; // ms between shots

    // ── Constructor ──────────────────────────────────────────────────────────
    public Player(String id, String name) {
        this.id   = id;
        this.name = name;
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    public void takeDamage(int damage) {
        health = Math.max(0, health - damage);
        if (health <= 0) {
            alive = false;
        }
    }

    public boolean canShoot(long nowMs) {
        return nowMs - lastShootTimeMs >= SHOOT_COOLDOWN_MS;
    }

    /** Reset for a new round. */
    public void reset(double spawnX, double spawnZ) {
        x = spawnX;  y = 0;  z = spawnZ;
        velX = 0;  velY = 0;  velZ = 0;
        health = 100;
        alive  = true;
        onGround = true;
        inputMoveX = 0;  inputMoveZ = 0;
        inputShoot = false;  inputJump = false;
    }
}
