package com.arena;

import org.java_websocket.WebSocket;

/**
 * Thin broadcast layer sitting on top of {@link PlayerSessionManager}.
 * The game engine talks to this; it doesn't need to know about WebSockets directly.
 */
public class GameRoomManager {

    private final PlayerSessionManager sessions;

    public GameRoomManager(PlayerSessionManager sessions) {
        this.sessions = sessions;
    }

    /** Send a message to every connected client. */
    public void broadcast(String json) {
        for (WebSocket ws : sessions.allConnections()) {
            try {
                if (ws != null && ws.isOpen()) {
                    ws.send(json);
                }
            } catch (Exception ignored) {
                // Individual send failures must not break the broadcast
            }
        }
    }

    /** Send a message to one specific player by id. */
    public void sendTo(String playerId, String json) {
        WebSocket ws = sessions.connFor(playerId);
        if (ws != null && ws.isOpen()) {
            try { ws.send(json); } catch (Exception ignored) {}
        }
    }

    public int connectedCount() {
        return sessions.sessionCount();
    }
}
