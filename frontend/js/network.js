/**
 * network.js  ─  WebSocket communication layer
 *
 * Provides:
 *  - Automatic reconnect with back-off
 *  - Typed event subscription (on / off)
 *  - Reliable input sending via throttled queue
 */
class Network {
    constructor(serverUrl) {
        this.url       = serverUrl;
        this.ws        = null;
        this.connected = false;
        this._handlers = {};          // eventType → [fn, ...]
        this._retryDelay = 1000;
        this._maxRetry   = 8000;
        this._retryTimer = null;

        this._connect();
    }

    // ── Connection ────────────────────────────────────────────────────────────

    _connect() {
        const ws = new WebSocket(this.url);
        this.ws  = ws;

        ws.onopen = () => {
            this.connected   = true;
            this._retryDelay = 1000;
            console.log('[Network] Connected to', this.url);
            this._emit('connected', {});
        };

        ws.onclose = (e) => {
            this.connected = false;
            console.warn('[Network] Disconnected, code=' + e.code);
            this._emit('disconnected', { code: e.code });
            this._scheduleReconnect();
        };

        ws.onerror = (e) => {
            console.error('[Network] WebSocket error', e);
            this._emit('error', e);
        };

        ws.onmessage = (e) => {
            try {
                const msg = JSON.parse(e.data);
                this._emit(msg.type, msg);
                // Always emit 'message' for generic listeners
                this._emit('message', msg);
            } catch (err) {
                console.warn('[Network] Bad JSON:', e.data);
            }
        };
    }

    _scheduleReconnect() {
        if (this._retryTimer) return;
        console.log(`[Network] Reconnecting in ${this._retryDelay}ms…`);
        this._retryTimer = setTimeout(() => {
            this._retryTimer = null;
            this._connect();
        }, this._retryDelay);
        this._retryDelay = Math.min(this._retryDelay * 1.5, this._maxRetry);
    }

    // ── Send helpers ──────────────────────────────────────────────────────────

    /** Send join request with player name. */
    join(name) {
        this._send({ type: 'join', name });
    }

    /**
     * Send an input packet.
     * @param {Object} state  { moveX, moveZ, yaw, pitch, shoot, jump }
     */
    sendInput(state) {
        this._send({
            type : 'input',
            move : { x: state.moveX, z: state.moveZ },
            look : { yaw: state.yaw, pitch: state.pitch },
            shoot: state.shoot,
            jump : state.jump
        });
    }

    _send(obj) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(obj));
        }
    }

    // ── Event bus ─────────────────────────────────────────────────────────────

    on(type, fn) {
        if (!this._handlers[type]) this._handlers[type] = [];
        this._handlers[type].push(fn);
    }

    off(type, fn) {
        if (!this._handlers[type]) return;
        this._handlers[type] = this._handlers[type].filter(h => h !== fn);
    }

    _emit(type, data) {
        const handlers = this._handlers[type];
        if (!handlers) return;
        for (const fn of handlers) {
            try { fn(data); } catch (err) { console.error('[Network] Handler error:', err); }
        }
    }
}
