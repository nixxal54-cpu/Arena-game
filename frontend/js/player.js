/**
 * player.js  ─  Input capture (keyboard + mobile touch joystick)
 */
class PlayerInput {
    constructor(canvas) {
        this.canvas = canvas;
        this._keys = {};
        this.yaw   = 0;
        this.pitch = 0;
        this.shootPressed = false;
        this.jumpPressed  = false;
        this.isLocked  = false;
        this.sensitivity = 0.0022;

        // Mobile state
        this._moveTouch  = null;   // { id, startX, startY, curX, curY }
        this._lookTouch  = null;   // { id, startX, startY, curX, curY }
        this._mouseHeld  = false;
        this._isMobile   = ('ontouchstart' in window);

        this._bindEvents();
        if (this._isMobile) this._buildMobileHUD();
    }

    // ─── Mobile HUD ──────────────────────────────────────────────────────────

    _buildMobileHUD() {
        // Left joystick zone
        this._joystickZone = document.createElement('div');
        this._joystickZone.id = 'joy-zone';
        Object.assign(this._joystickZone.style, {
            position:'fixed', left:'0', bottom:'0',
            width:'50%', height:'50%',
            zIndex:'50', touchAction:'none'
        });

        this._joystickBase = document.createElement('div');
        this._joystickBase.id = 'joy-base';
        this._joystickBase.style.display = 'none';

        this._joystickThumb = document.createElement('div');
        this._joystickThumb.id = 'joy-thumb';

        this._joystickBase.appendChild(this._joystickThumb);
        this._joystickZone.appendChild(this._joystickBase);
        document.body.appendChild(this._joystickZone);

        // Right look zone
        this._lookZone = document.createElement('div');
        this._lookZone.id = 'look-zone';
        Object.assign(this._lookZone.style, {
            position:'fixed', right:'0', bottom:'0',
            width:'50%', height:'100%',
            zIndex:'50', touchAction:'none'
        });
        document.body.appendChild(this._lookZone);

        // Shoot button
        this._shootBtn = document.createElement('button');
        this._shootBtn.id = 'shoot-btn';
        this._shootBtn.innerHTML = '🔥';
        document.body.appendChild(this._shootBtn);

        // Jump button
        this._jumpBtn = document.createElement('button');
        this._jumpBtn.id = 'jump-btn';
        this._jumpBtn.innerHTML = '⬆';
        document.body.appendChild(this._jumpBtn);

        // Mobile CSS
        const style = document.createElement('style');
        style.textContent = `
            #joy-base {
                position:absolute;
                width:110px; height:110px;
                border-radius:50%;
                background:rgba(0,229,255,0.12);
                border:2px solid rgba(0,229,255,0.45);
                transform:translate(-50%,-50%);
                backdrop-filter:blur(2px);
                box-shadow:0 0 24px rgba(0,229,255,0.2);
            }
            #joy-thumb {
                position:absolute;
                width:46px; height:46px;
                border-radius:50%;
                background:radial-gradient(circle at 35% 35%, rgba(0,229,255,0.9), rgba(0,100,180,0.7));
                border:2px solid rgba(0,229,255,0.8);
                top:50%; left:50%;
                transform:translate(-50%,-50%);
                box-shadow:0 0 14px rgba(0,229,255,0.5);
                transition:transform 0.05s;
            }
            #shoot-btn {
                position:fixed;
                right:28px; bottom:120px;
                width:72px; height:72px;
                border-radius:50%;
                background:radial-gradient(circle, rgba(255,80,0,0.85), rgba(180,0,0,0.7));
                border:2px solid rgba(255,100,0,0.9);
                color:#fff; font-size:28px;
                z-index:60; touch-action:none;
                box-shadow:0 0 20px rgba(255,60,0,0.6);
                cursor:pointer;
                display:flex; align-items:center; justify-content:center;
                user-select:none;
                -webkit-tap-highlight-color:transparent;
            }
            #jump-btn {
                position:fixed;
                right:112px; bottom:120px;
                width:60px; height:60px;
                border-radius:50%;
                background:radial-gradient(circle, rgba(0,200,255,0.8), rgba(0,80,180,0.6));
                border:2px solid rgba(0,200,255,0.8);
                color:#fff; font-size:22px;
                z-index:60; touch-action:none;
                box-shadow:0 0 16px rgba(0,180,255,0.5);
                cursor:pointer;
                display:flex; align-items:center; justify-content:center;
                user-select:none;
                -webkit-tap-highlight-color:transparent;
            }
            #shoot-btn:active { transform:scale(0.92); }
            #jump-btn:active  { transform:scale(0.92); }
            /* Hide mouse crosshair on mobile */
            @media (pointer:coarse) {
                #crosshair, #crosshair-dot { display:none !important; }
                #controls-ref { display:none !important; }
                .lobby-hint { font-size:13px; }
            }
        `;
        document.head.appendChild(style);

        // Shoot / Jump button events
        this._shootBtn.addEventListener('touchstart', (e) => { e.preventDefault(); this.shootPressed = true; this._mouseHeld = true; }, {passive:false});
        this._shootBtn.addEventListener('touchend',   (e) => { e.preventDefault(); this._mouseHeld = false; }, {passive:false});
        this._jumpBtn.addEventListener('touchstart',  (e) => { e.preventDefault(); this.jumpPressed = true; }, {passive:false});
    }

    // ─── Event binding ────────────────────────────────────────────────────────

    _bindEvents() {
        // Keyboard
        document.addEventListener('keydown', (e) => {
            if (e.repeat) return;
            this._keys[e.code] = true;
            if (e.code === 'Space') { e.preventDefault(); this.jumpPressed = true; }
        });
        document.addEventListener('keyup', (e) => { this._keys[e.code] = false; });

        // Pointer lock (desktop)
        this.canvas.addEventListener('click', () => {
            if (!this._isMobile && !document.pointerLockElement) this.canvas.requestPointerLock();
        });
        document.addEventListener('pointerlockchange', () => {
            this.isLocked = document.pointerLockElement === this.canvas;
        });
        document.addEventListener('mousemove', (e) => {
            if (!this.isLocked) return;
            this.yaw   += e.movementX * this.sensitivity;
            this.pitch -= e.movementY * this.sensitivity;
            this.pitch  = Math.max(-Math.PI * 0.45, Math.min(Math.PI * 0.45, this.pitch));
        });
        document.addEventListener('mousedown', (e) => {
            if (e.button === 0 && this.isLocked) { this.shootPressed = true; this._mouseHeld = true; }
        });
        document.addEventListener('mouseup', (e) => { if (e.button === 0) this._mouseHeld = false; });

        // Touch: joystick zone (left half bottom)
        if (this._isMobile) {
            this._joystickZone.addEventListener('touchstart', (e) => {
                e.preventDefault();
                if (this._moveTouch) return;
                const t = e.changedTouches[0];
                this._moveTouch = { id: t.identifier, startX: t.clientX, startY: t.clientY, curX: t.clientX, curY: t.clientY };
                this._joystickBase.style.display = 'block';
                this._joystickBase.style.left = t.clientX + 'px';
                this._joystickBase.style.top  = t.clientY + 'px';
            }, {passive:false});

            this._joystickZone.addEventListener('touchmove', (e) => {
                e.preventDefault();
                for (const t of e.changedTouches) {
                    if (this._moveTouch && t.identifier === this._moveTouch.id) {
                        this._moveTouch.curX = t.clientX;
                        this._moveTouch.curY = t.clientY;
                        const dx = t.clientX - this._moveTouch.startX;
                        const dy = t.clientY - this._moveTouch.startY;
                        const dist = Math.min(Math.sqrt(dx*dx+dy*dy), 48);
                        const ang  = Math.atan2(dy, dx);
                        const tx   = Math.cos(ang) * dist;
                        const ty   = Math.sin(ang) * dist;
                        this._joystickThumb.style.transform = `translate(calc(-50% + ${tx}px), calc(-50% + ${ty}px))`;
                    }
                }
            }, {passive:false});

            const endMove = (e) => {
                for (const t of e.changedTouches) {
                    if (this._moveTouch && t.identifier === this._moveTouch.id) {
                        this._moveTouch = null;
                        this._joystickBase.style.display = 'none';
                        this._joystickThumb.style.transform = 'translate(-50%,-50%)';
                    }
                }
            };
            this._joystickZone.addEventListener('touchend',    endMove, {passive:false});
            this._joystickZone.addEventListener('touchcancel', endMove, {passive:false});

            // Look zone (right half)
            let lastLX = 0, lastLY = 0;
            this._lookZone.addEventListener('touchstart', (e) => {
                e.preventDefault();
                if (this._lookTouch) return;
                const t = e.changedTouches[0];
                this._lookTouch = { id: t.identifier };
                lastLX = t.clientX; lastLY = t.clientY;
            }, {passive:false});

            this._lookZone.addEventListener('touchmove', (e) => {
                e.preventDefault();
                for (const t of e.changedTouches) {
                    if (this._lookTouch && t.identifier === this._lookTouch.id) {
                        const dx = t.clientX - lastLX;
                        const dy = t.clientY - lastLY;
                        lastLX = t.clientX; lastLY = t.clientY;
                        this.yaw   += dx * 0.005;
                        this.pitch -= dy * 0.005;
                        this.pitch  = Math.max(-Math.PI * 0.45, Math.min(Math.PI * 0.45, this.pitch));
                    }
                }
            }, {passive:false});

            const endLook = (e) => {
                for (const t of e.changedTouches) {
                    if (this._lookTouch && t.identifier === this._lookTouch.id) {
                        this._lookTouch = null;
                    }
                }
            };
            this._lookZone.addEventListener('touchend',    endLook, {passive:false});
            this._lookZone.addEventListener('touchcancel', endLook, {passive:false});
        }
    }

    // ─── Snapshot ─────────────────────────────────────────────────────────────

    getSnapshot() {
        let moveX = 0, moveZ = 0;

        if (this._keys['KeyA'] || this._keys['ArrowLeft'])  moveX -= 1;
        if (this._keys['KeyD'] || this._keys['ArrowRight']) moveX += 1;
        if (this._keys['KeyW'] || this._keys['ArrowUp'])    moveZ += 1;
        if (this._keys['KeyS'] || this._keys['ArrowDown'])  moveZ -= 1;

        // Mobile joystick
        if (this._moveTouch) {
            const dx = this._moveTouch.curX - this._moveTouch.startX;
            const dy = this._moveTouch.curY - this._moveTouch.startY;
            const dist = Math.sqrt(dx*dx + dy*dy);
            if (dist > 8) {
                // Joystick: screen right = game +X, screen up = game +Z
                moveX += dx / 48;
                moveZ -= dy / 48;
            }
        }

        // Normalise diagonal
        const len = Math.sqrt(moveX*moveX + moveZ*moveZ);
        if (len > 1) { moveX /= len; moveZ /= len; }

        const shoot = this.shootPressed || this._mouseHeld;
        const jump  = this.jumpPressed;
        this.shootPressed = false;
        this.jumpPressed  = false;

        return { moveX, moveZ, yaw: this.yaw, pitch: this.pitch, shoot, jump };
    }

    forwardDir() {
        return {
            x:  Math.sin(this.yaw)  * Math.cos(this.pitch),
            y:  Math.sin(this.pitch),
            z:  Math.cos(this.yaw)  * Math.cos(this.pitch)
        };
    }
}
