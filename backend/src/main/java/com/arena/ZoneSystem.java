package com.arena;

/**
 * Controls the shrinking safe zone.
 * Must be updated every game tick via {@link #update(double)}.
 *
 * Zone shrinks in stages:
 *   50 → 35 → 20 → 10 → 5   (every SHRINK_INTERVAL_MS milliseconds)
 *
 * Players outside {@link #currentRadius} take ZONE_DAMAGE_PER_SEC damage/second.
 */
public class ZoneSystem {

    // ── Zone geometry ─────────────────────────────────────────────────────────
    public double centerX = 0.0;
    public double centerZ = 0.0;

    /** Current displayed radius (smoothly lerps toward targetRadius). */
    public double currentRadius = INITIAL_RADIUS;

    /** The radius the zone is shrinking toward. */
    public double targetRadius  = INITIAL_RADIUS;

    // ── Stage configuration ───────────────────────────────────────────────────
    private static final double   INITIAL_RADIUS    = 50.0;
    private static final double[] STAGE_RADII       = { 50.0, 35.0, 20.0, 10.0, 5.0 };
    private static final long     SHRINK_INTERVAL_MS = 45_000L;   // 45 s between stages
    /** Units per second the current radius lerps toward the target. */
    private static final double   SHRINK_RATE        = 1.5;

    public static final int ZONE_DAMAGE_PER_SEC = 5;

    // ── Internal state ────────────────────────────────────────────────────────
    private int  stageIndex     = 0;
    private long lastShrinkTime = 0;
    private boolean started     = false;

    // ── Public API ────────────────────────────────────────────────────────────

    /** Call once when the match starts. */
    public void start() {
        stageIndex     = 0;
        currentRadius  = INITIAL_RADIUS;
        targetRadius   = INITIAL_RADIUS;
        lastShrinkTime = System.currentTimeMillis();
        started        = true;
    }

    /** Call every game tick. {@code deltaSec} is the elapsed seconds since last tick. */
    public void update(double deltaSec) {
        if (!started) return;

        long now = System.currentTimeMillis();

        // Advance to next stage?
        if (stageIndex < STAGE_RADII.length - 1
                && now - lastShrinkTime >= SHRINK_INTERVAL_MS) {
            stageIndex++;
            targetRadius   = STAGE_RADII[stageIndex];
            lastShrinkTime = now;
        }

        // Smoothly shrink current radius toward target
        if (currentRadius > targetRadius) {
            currentRadius = Math.max(targetRadius,
                    currentRadius - SHRINK_RATE * deltaSec);
        }
    }

    /** Returns true when the world-space point (x, z) lies inside the safe zone. */
    public boolean isInside(double x, double z) {
        double dx = x - centerX;
        double dz = z - centerZ;
        return (dx * dx + dz * dz) <= (currentRadius * currentRadius);
    }

    /** Milliseconds until the zone begins shrinking to the next stage (0 if already shrinking). */
    public long msUntilNextShrink() {
        if (!started || stageIndex >= STAGE_RADII.length - 1) return Long.MAX_VALUE;
        return Math.max(0L, SHRINK_INTERVAL_MS - (System.currentTimeMillis() - lastShrinkTime));
    }

    /** True once the zone has reached its final, smallest stage. */
    public boolean isFinalStage() {
        return stageIndex == STAGE_RADII.length - 1;
    }

    public void reset() {
        started        = false;
        stageIndex     = 0;
        currentRadius  = INITIAL_RADIUS;
        targetRadius   = INITIAL_RADIUS;
    }
}
