package com.arena;

import com.arena.model.Player;
import org.java_websocket.WebSocket;

import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Bi-directional map of WebSocket ↔ Player.
 * Thread-safe: called from WebSocket I/O threads and the game-loop thread.
 */
public class PlayerSessionManager {

    private final Map<WebSocket, Player> connToPlayer = new ConcurrentHashMap<>();
    private final Map<String,    WebSocket> idToConn  = new ConcurrentHashMap<>();

    // ── Session lifecycle ─────────────────────────────────────────────────────

    /**
     * Registers a new session and returns the freshly created {@link Player}.
     */
    public Player register(WebSocket conn, String displayName) {
        String safeId   = "p" + UUID.randomUUID().toString().replace("-", "").substring(0, 8);
        String safeName = sanitiseName(displayName);
        Player player   = new Player(safeId, safeName);

        connToPlayer.put(conn, player);
        idToConn.put(safeId, conn);
        return player;
    }

    /**
     * Removes the session for the given connection and returns the Player that
     * was associated with it (or {@code null} if none).
     */
    public Player deregister(WebSocket conn) {
        Player p = connToPlayer.remove(conn);
        if (p != null) idToConn.remove(p.id);
        return p;
    }

    // ── Lookups ───────────────────────────────────────────────────────────────

    public Player playerFor(WebSocket conn)  { return connToPlayer.get(conn); }
    public WebSocket connFor(String playerId) { return idToConn.get(playerId); }

    public int sessionCount() { return connToPlayer.size(); }

    /** Snapshot of all currently open connections. */
    public Collection<WebSocket> allConnections() {
        return Collections.unmodifiableCollection(connToPlayer.keySet());
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private static String sanitiseName(String raw) {
        if (raw == null || raw.isBlank()) return "Player";
        // Strip non-printable characters, cap at 16 chars
        return raw.replaceAll("[^\\x20-\\x7E]", "").strip().substring(0, Math.min(raw.length(), 16));
    }
}
