/**
 * player.js  ─  Input capture and local camera control
 *
 * Captures:
 *  ─ WASD / arrow keys  → movement
 *  ─ Space              → jump
 *  ─ Left-click / LMB   → shoot (handled in game.js via pointerdown)
 *  ─ Mouse delta        → yaw / pitch (requires Pointer Lock)
 *
 * Coordinate convention (matches server):
 *  ─ yaw = 0     → facing +Z
 *  ─ yaw increases CW (when viewed from above)
 *  ─ pitch positive → looking up
 */
class PlayerInput {
    constructor(canvas) {
        this.canvas = canvas;

        // ── Raw key state ─────────────────────────────────────────────────────
        this._keys = {};

        // ── Look angles ───────────────────────────────────────────────────────
        this.yaw   = 0;
        this.pitch = 0;

        // ── One-frame consume flags ───────────────────────────────────────────
        this.shootPressed = false;
        this.jumpPressed  = false;

        // ── Pointer lock state ────────────────────────────────────────────────
        this.isLocked  = false;
        this.sensitivity = 0.0022;   // radians per pixel

        this._bindEvents();
    }

    // ── Event binding ─────────────────────────────────────────────────────────

    _bindEvents() {
        // Keyboard
        document.addEventListener('keydown', (e) => {
            if (e.repeat) return;
            this._keys[e.code] = true;
            if (e.code === 'Space') { e.preventDefault(); this.jumpPressed = true; }
        });

        document.addEventListener('keyup', (e) => {
            this._keys[e.code] = false;
        });

        // Pointer Lock acquisition on canvas click
        this.canvas.addEventListener('click', () => {
            if (!document.pointerLockElement) {
                this.canvas.requestPointerLock();
            }
        });

        document.addEventListener('pointerlockchange', () => {
            this.isLocked = document.pointerLockElement === this.canvas;
        });

        // Mouse movement (look)
        document.addEventListener('mousemove', (e) => {
            if (!this.isLocked) return;
            this.yaw   += e.movementX * this.sensitivity;
            this.pitch -= e.movementY * this.sensitivity;
            // Clamp pitch to avoid gimbal flipping
            this.pitch = Math.max(-Math.PI * 0.45, Math.min(Math.PI * 0.45, this.pitch));
        });

        // Shoot on left mouse button while locked
        document.addEventListener('mousedown', (e) => {
            if (e.button === 0 && this.isLocked) {
                this.shootPressed = true;
            }
        });

        // Also allow holding for auto-fire
        this._mouseHeld = false;
        document.addEventListener('mousedown', (e) => { if (e.button === 0) this._mouseHeld = true; });
        document.addEventListener('mouseup',   (e) => { if (e.button === 0) this._mouseHeld = false; });
    }

    // ── Input snapshot ────────────────────────────────────────────────────────

    /**
     * Returns the current input state and resets one-frame flags.
     * Call once per network tick (30 Hz).
     */
    getSnapshot() {
        let moveX = 0, moveZ = 0;

        if (this._keys['KeyA']        || this._keys['ArrowLeft'])  moveX -= 1;
        if (this._keys['KeyD']        || this._keys['ArrowRight']) moveX += 1;
        if (this._keys['KeyW']        || this._keys['ArrowUp'])    moveZ += 1;
        if (this._keys['KeyS']        || this._keys['ArrowDown'])  moveZ -= 1;

        // Normalise diagonal
        const len = Math.sqrt(moveX * moveX + moveZ * moveZ);
        if (len > 1) { moveX /= len; moveZ /= len; }

        const shoot = this.shootPressed || this._mouseHeld;
        const jump  = this.jumpPressed;

        // Consume one-frame flags
        this.shootPressed = false;
        this.jumpPressed  = false;

        return {
            moveX,
            moveZ,
            yaw:   this.yaw,
            pitch: this.pitch,
            shoot,
            jump
        };
    }

    /** Camera forward direction as a THREE.Vector3-compatible object. */
    forwardDir() {
        return {
            x:  Math.sin(this.yaw) * Math.cos(this.pitch),
            y:  Math.sin(this.pitch),
            z:  Math.cos(this.yaw) * Math.cos(this.pitch)
        };
    }
}
