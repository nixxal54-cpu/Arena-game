package com.arena;

import com.arena.model.*;
import com.google.gson.*;
import org.java_websocket.WebSocket;
import org.java_websocket.handshake.ClientHandshake;
import org.java_websocket.server.WebSocketServer;

import java.net.InetSocketAddress;
import java.util.logging.Logger;

/**
 * Accepts WebSocket connections and routes messages to the game systems.
 *
 * Protocol:
 *  Client → Server   {"type":"join","name":"Hero"}
 *  Client → Server   {"type":"input","move":{"x":0,"z":1},"look":{"yaw":1.2,"pitch":0},"shoot":false,"jump":false}
 *  Server → Client   (state broadcast, events) – see GameStateEngine for formats
 */
public class ArenaWebSocketServer extends WebSocketServer {

    private static final Logger LOG = Logger.getLogger(ArenaWebSocketServer.class.getName());

    private final PlayerSessionManager sessions;
    private final GameRoomManager      room;
    private final GameStateEngine      engine;
    private final Gson                 gson = new GsonBuilder().create();

    public ArenaWebSocketServer(int port) {
        super(new InetSocketAddress("0.0.0.0", port));
        this.sessions = new PlayerSessionManager();
        this.room     = new GameRoomManager(sessions);
        this.engine   = new GameStateEngine(room);
    }

    /** Starts the game loop thread. Call before {@link #start()}. */
    public void startEngine() {
        Thread t = new Thread(engine, "GameLoop");
        t.setDaemon(true);
        t.start();
        LOG.info("Game engine started");
    }

    // ── WebSocket callbacks ───────────────────────────────────────────────────

    @Override
    public void onOpen(WebSocket conn, ClientHandshake handshake) {
        LOG.info("Connection opened: " + conn.getRemoteSocketAddress());

        // Send a welcome prompt
        JsonObject welcome = new JsonObject();
        welcome.addProperty("type",    "welcome");
        welcome.addProperty("message", "Send {\"type\":\"join\",\"name\":\"YourName\"} to enter the arena.");
        conn.send(welcome.toString());
    }

    @Override
    public void onClose(WebSocket conn, int code, String reason, boolean remote) {
        Player p = sessions.deregister(conn);
        if (p != null) {
            LOG.info("Player disconnected: " + p.name + " [" + p.id + "]");
            engine.queueLeave(p.id);
        }
    }

    @Override
    public void onMessage(WebSocket conn, String rawJson) {
        try {
            JsonObject json = JsonParser.parseString(rawJson).getAsJsonObject();
            String type = json.has("type") ? json.get("type").getAsString() : "";

            switch (type) {
                case "join"  -> handleJoin(conn, json);
                case "input" -> handleInput(conn, json);
                default      -> LOG.fine("Unknown message type: " + type);
            }
        } catch (JsonSyntaxException e) {
            LOG.warning("Malformed JSON from " + conn.getRemoteSocketAddress() + ": " + e.getMessage());
        } catch (Exception e) {
            LOG.warning("Error handling message: " + e.getMessage());
        }
    }

    @Override
    public void onError(WebSocket conn, Exception ex) {
        String addr = conn != null ? String.valueOf(conn.getRemoteSocketAddress()) : "unknown";
        LOG.warning("WebSocket error from " + addr + ": " + ex.getMessage());
    }

    @Override
    public void onStart() {
        LOG.info("WebSocket server listening on port " + getPort());
        setConnectionLostTimeout(60);
    }

    // ── Message handlers ──────────────────────────────────────────────────────

    private void handleJoin(WebSocket conn, JsonObject json) {
        // Ignore if already registered
        if (sessions.playerFor(conn) != null) return;

        String name = json.has("name") ? json.get("name").getAsString() : "Player";
        Player p    = sessions.register(conn, name);

        // Tell this client their own ID before they start receiving state
        JsonObject joined = new JsonObject();
        joined.addProperty("type",       "joined");
        joined.addProperty("playerId",   p.id);
        joined.addProperty("playerName", p.name);
        joined.addProperty("matchState", engine.getMatchState());
        conn.send(joined.toString());

        // Enqueue join to be processed on the game loop thread
        engine.queueJoin(p);
        LOG.info("Join queued: " + p.name + " [" + p.id + "]");
    }

    private void handleInput(WebSocket conn, JsonObject json) {
        Player p = sessions.playerFor(conn);
        if (p == null) return;   // client sent input before joining

        InputMessage input = gson.fromJson(json, InputMessage.class);
        engine.queueInput(p.id, input);
    }
}
