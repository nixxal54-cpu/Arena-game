/**
 * ui.js  ─  HUD & overlay management
 *
 * Manages all DOM-based UI elements:
 *  ─ Health bar
 *  ─ Zone timer & warning
 *  ─ Player / alive count
 *  ─ Kill feed (scrolling events)
 *  ─ Crosshair
 *  ─ Overlay screens (lobby, win, death)
 *  ─ Outside-zone red vignette
 */
class UI {
    constructor() {
        // Cache all DOM element references once
        this.healthFill      = document.getElementById('health-fill');
        this.healthText      = document.getElementById('health-text');
        this.playerCount     = document.getElementById('player-count');
        this.zoneTimer       = document.getElementById('zone-timer');
        this.zoneWarning     = document.getElementById('zone-warning');
        this.killFeed        = document.getElementById('kill-feed');
        this.vignette        = document.getElementById('vignette');
        this.crosshair       = document.getElementById('crosshair');
        this.hitFlash        = document.getElementById('hit-flash');
        this.damageIndicator = document.getElementById('damage-indicator');

        // Screens
        this.lobbyScreen  = document.getElementById('lobby-screen');
        this.winScreen    = document.getElementById('win-screen');
        this.deathScreen  = document.getElementById('death-screen');
        this.winText      = document.getElementById('win-text');
        this.deathText    = document.getElementById('death-text');

        this._killFeedQueue  = [];
        this._hitFlashTimer  = null;
        this._lastZoneWarn   = 0;

        this.showLobby();
    }

    // ── Health ────────────────────────────────────────────────────────────────

    setHealth(hp) {
        const pct = Math.max(0, Math.min(100, hp));
        this.healthFill.style.width = pct + '%';
        this.healthText.textContent = hp;

        // Colour shift: green → yellow → red
        if (pct > 60)       this.healthFill.style.background = 'linear-gradient(90deg, #00e676, #69f0ae)';
        else if (pct > 30)  this.healthFill.style.background = 'linear-gradient(90deg, #ffea00, #ffca28)';
        else                this.healthFill.style.background = 'linear-gradient(90deg, #ff1744, #ff6d00)';
    }

    // ── Player count ──────────────────────────────────────────────────────────

    setPlayerCount(alive, total) {
        this.playerCount.textContent = `👥 ${alive} / ${total}`;
    }

    // ── Zone timer ────────────────────────────────────────────────────────────

    setZoneTimer(msRemaining) {
        const sec = Math.ceil(msRemaining / 1000);
        this.zoneTimer.textContent = `⭕ Zone: ${sec}s`;

        if (msRemaining < 10_000) {
            this.zoneTimer.style.color = '#ff5252';
        } else if (msRemaining < 20_000) {
            this.zoneTimer.style.color = '#ffca28';
        } else {
            this.zoneTimer.style.color = '#e0e0e0';
        }
    }

    // ── Zone vignette (called each frame) ────────────────────────────────────

    setOutsideZone(isOutside) {
        this.vignette.style.opacity = isOutside ? '0.55' : '0';

        const now = Date.now();
        if (isOutside && now - this._lastZoneWarn > 2500) {
            this._lastZoneWarn = now;
            this.showZoneWarning();
        }
    }

    showZoneWarning() {
        this.zoneWarning.style.opacity = '1';
        clearTimeout(this._zoneWarnTimer);
        this._zoneWarnTimer = setTimeout(() => {
            this.zoneWarning.style.opacity = '0';
        }, 2000);
    }

    // ── Kill feed ─────────────────────────────────────────────────────────────

    addKillFeedEntry(text, isLocalInvolved) {
        const el = document.createElement('div');
        el.className = 'kill-entry' + (isLocalInvolved ? ' local' : '');
        el.textContent = text;
        this.killFeed.prepend(el);

        // Auto-remove after 5 s
        setTimeout(() => {
            el.style.opacity = '0';
            setTimeout(() => el.remove(), 600);
        }, 5000);

        // Cap feed at 6 entries
        while (this.killFeed.children.length > 6) {
            this.killFeed.lastChild.remove();
        }
    }

    // ── Hit flash (when local player takes damage) ────────────────────────────

    showHitFlash() {
        this.hitFlash.style.opacity = '0.45';
        clearTimeout(this._hitFlashTimer);
        this._hitFlashTimer = setTimeout(() => {
            this.hitFlash.style.opacity = '0';
        }, 180);
    }

    // ── Screens ───────────────────────────────────────────────────────────────

    showLobby() {
        this.lobbyScreen.style.display  = 'flex';
        this.winScreen.style.display    = 'none';
        this.deathScreen.style.display  = 'none';
        this.crosshair.style.display    = 'none';
    }

    hideLobby() {
        this.lobbyScreen.style.display = 'none';
        this.crosshair.style.display   = 'block';
    }

    showWinScreen(winnerName, isLocal) {
        this.winScreen.style.display = 'flex';
        this.winText.textContent     = isLocal
            ? '🏆 VICTORY ROYALE!'
            : `🏆 ${winnerName} wins!`;
        this.crosshair.style.display = 'none';
    }

    hideWinScreen() {
        this.winScreen.style.display = 'none';
        this.crosshair.style.display = 'block';
    }

    showDeathScreen(killerName) {
        this.deathScreen.style.display = 'flex';
        this.deathText.textContent = killerName
            ? `Eliminated by ${killerName}`
            : 'Eliminated by the zone';
        this.crosshair.style.display = 'none';
    }

    hideDeathScreen() {
        this.deathScreen.style.display = 'none';
        this.crosshair.style.display   = 'block';
    }

    // ── Match events ──────────────────────────────────────────────────────────

    showMatchStart(playerCount) {
        this.addKillFeedEntry(`⚔  Match started — ${playerCount} players`, false);
    }

    showMatchReset() {
        this.hideWinScreen();
        this.hideDeathScreen();
        this.crosshair.style.display = 'block';
        this.addKillFeedEntry('🔄 New round!', false);
    }
}
