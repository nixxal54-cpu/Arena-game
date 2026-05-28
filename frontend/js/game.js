/**
 * game.js  ─  Main game orchestrator
 *
 * Boot sequence:
 *  1. Initialise Renderer, UI, PlayerInput, Network
 *  2. Register network event handlers
 *  3. Start input-send loop (30 Hz)
 *  4. Start render loop (RAF)
 *
 * State machine:
 *  LOBBY  →  IN_GAME  →  DEAD / WIN  →  IN_GAME (on reset)
 */

// ── Config ────────────────────────────────────────────────────────────────────
const WS_URL = 'wss://arena-game-lbsl.onrender.com';
const INPUT_HZ  = 30;

// ── Module instances (populated in init()) ────────────────────────────────────
let renderer, ui, input, network;

// ── Local game state ──────────────────────────────────────────────────────────
const state = {
    localId      : null,
    localName    : null,
    joined       : false,
    dead         : false,
    gameState    : null,   // latest server state packet
    matchState   : 'WAITING',
};

// ── Boot ──────────────────────────────────────────────────────────────────────

function init() {
    const canvas = document.getElementById('game-canvas');

    renderer = new Renderer(canvas);
    ui       = new UI();
    input    = new PlayerInput(canvas);
    network  = new Network(WS_URL);

    _bindNetworkEvents();
    _bindUIEvents();
    _startInputLoop();
    _startRenderLoop();

    console.log('[Game] Initialised');
}

// ── Network event handlers ────────────────────────────────────────────────────

function _bindNetworkEvents() {

    network.on('connected', () => {
        ui.addKillFeedEntry('🔌 Connected to server', false);
    });

    network.on('disconnected', () => {
        ui.addKillFeedEntry('⚠  Disconnected — reconnecting…', false);
    });

    // Server sends this immediately on connection
    network.on('welcome', () => {
        // Show lobby – handled by default UI state
    });

    // Confirmed our own join
    network.on('joined', (msg) => {
        state.localId    = msg.playerId;
        state.localName  = msg.playerName;
        state.joined     = true;
        state.dead       = false;
        state.matchState = msg.matchState;

        ui.hideLobby();
        ui.addKillFeedEntry(`✅ Joined as ${msg.playerName}`, false);
        console.log('[Game] Joined as', msg.playerName, 'id=', msg.playerId);
    });

    // Another player joined
    network.on('playerJoined', (msg) => {
        ui.addKillFeedEntry(`➕ ${msg.playerName} joined (${msg.playerCount} players)`, false);
    });

    // A player disconnected
    network.on('playerLeft', (msg) => {
        ui.addKillFeedEntry(`➖ ${msg.playerName} left`, false);
    });

    // Match started
    network.on('matchStart', (msg) => {
        state.matchState = 'RUNNING';
        state.dead       = false;
        ui.showMatchStart(msg.playerCount);
        ui.hideWinScreen();
        ui.hideDeathScreen();
        console.log('[Game] Match started');
    });

    // Match reset (new round)
    network.on('matchReset', () => {
        state.matchState = 'RUNNING';
        state.dead       = false;
        ui.showMatchReset();
        console.log('[Game] Match reset — new round');
    });

    // Full authoritative state (30 Hz)
    network.on('state', (msg) => {
        state.gameState  = msg;
        state.matchState = msg.matchState;
        _processStateUpdate(msg);
    });

    // Hit event (someone was shot)
    network.on('hit', (msg) => {
        // Visual feedback for local player being hit
        if (msg.targetId === state.localId) {
            ui.showHitFlash();
            ui.setHealth(msg.remainingHealth);
        }
    });

    // Elimination event
    network.on('eliminated', (msg) => {
        const isLocal = msg.playerId === state.localId;
        const entry   = msg.killerId
            ? `💀 ${msg.playerName} eliminated by ${msg.killerName}`
            : `💀 ${msg.playerName} eliminated by the zone`;

        ui.addKillFeedEntry(entry, isLocal || msg.killerId === state.localId);

        if (isLocal) {
            state.dead = true;
            ui.showDeathScreen(msg.killerName || null);
        }
    });

    // Winner declared
    network.on('winner', (msg) => {
        state.matchState = 'ENDED';
        const isLocal = msg.winnerId === state.localId;
        ui.showWinScreen(msg.winnerName, isLocal);
        ui.addKillFeedEntry(`🏆 ${msg.winnerName} wins the match!`, isLocal);
        console.log('[Game] Winner:', msg.winnerName);
    });
}

// ── UI event handlers ─────────────────────────────────────────────────────────

function _bindUIEvents() {
    const joinBtn  = document.getElementById('join-btn');
    const nameInput = document.getElementById('name-input');

    joinBtn.addEventListener('click', () => {
        const name = nameInput.value.trim() || 'Player';
        state.localName = name;
        if (network.connected) {
            network.join(name);
        } else {
            ui.addKillFeedEntry('⚠  Not connected yet — try again', false);
        }
    });

    nameInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') joinBtn.click();
    });

    // Respawn / continue watching after death screen
    const respawnBtn = document.getElementById('respawn-btn');
    if (respawnBtn) {
        respawnBtn.addEventListener('click', () => {
            ui.hideDeathScreen();
            // Continue spectating; server will auto-reset
        });
    }
}

// ── State processing ──────────────────────────────────────────────────────────

function _processStateUpdate(msg) {
    if (!state.joined || !state.localId) return;

    // Find local player data
    const localPlayer = (msg.players || []).find(p => p.id === state.localId);

    if (localPlayer) {
        ui.setHealth(localPlayer.health);

        // Outside zone check
        if (msg.zone) {
            const dx   = localPlayer.x - msg.zone.x;
            const dz   = localPlayer.z - msg.zone.z;
            const dist = Math.sqrt(dx * dx + dz * dz);
            ui.setOutsideZone(dist > msg.zone.radius);
        }
    }

    // Player counts
    const alivePlayers = (msg.players || []).filter(p => p.alive).length;
    const totalPlayers = (msg.players || []).length;
    ui.setPlayerCount(alivePlayers, totalPlayers);

    // Zone timer
    if (msg.zone && msg.zone.nextShrinkMs < Number.MAX_SAFE_INTEGER) {
        ui.setZoneTimer(msg.zone.nextShrinkMs);
    }
}

// ── Input loop (30 Hz) ────────────────────────────────────────────────────────

function _startInputLoop() {
    setInterval(() => {
        if (!state.joined || !network.connected) return;
        if (state.dead) {
            // Still send zero input while dead (keeps connection alive)
            network.sendInput({ moveX: 0, moveZ: 0, yaw: input.yaw, pitch: input.pitch, shoot: false, jump: false });
            return;
        }

        const snap = input.getSnapshot();
        network.sendInput(snap);
    }, 1000 / INPUT_HZ);
}

// ── Render loop (RAF) ─────────────────────────────────────────────────────────

function _startRenderLoop() {
    function frame() {
        requestAnimationFrame(frame);
        renderer.updateFromState(state.gameState, state.localId, input);
        renderer.render();
    }
    requestAnimationFrame(frame);
}

// ── Start on DOM ready ────────────────────────────────────────────────────────

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
