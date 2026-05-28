# 🏟 Arena Battle Online

Real-time 3D multiplayer arena shooter — Java WebSocket back-end + Three.js front-end.

---

## Project Structure

```
arena-game/
├── backend/                          Java / Maven server
│   ├── pom.xml
│   └── src/main/java/com/arena/
│       ├── ArenaServer.java          ← Entry point  (main)
│       ├── ArenaWebSocketServer.java ← WS handler, message router
│       ├── GameRoomManager.java      ← Broadcast layer
│       ├── PlayerSessionManager.java ← conn ↔ Player map
│       ├── GameStateEngine.java      ← 30 Hz authoritative game loop
│       ├── CombatSystem.java         ← Bullet physics + hit detection
│       ├── ZoneSystem.java           ← Shrinking safe zone
│       └── model/
│           ├── Player.java
│           ├── Bullet.java
│           └── InputMessage.java
└── frontend/                         Browser client
    ├── index.html                    ← Single-page entry point
    └── js/
        ├── network.js                ← WebSocket layer (reconnect, events)
        ├── ui.js                     ← HUD, overlays, kill feed
        ├── player.js                 ← Keyboard / mouse input
        ├── renderer.js               ← Three.js scene
        └── game.js                   ← Main orchestrator
```

---

## Requirements

| Tool | Version |
|------|---------|
| Java | 17 LTS or later |
| Maven | 3.8+ |
| A modern browser | Chrome 90+, Firefox 90+, Edge 90+ |
| Python *(optional)* | 3.x – only needed to serve the frontend |

---

## Quick Start

### 1  Build & run the Java server

```bash
cd backend
mvn package -q
java -jar target/arena-server.jar
# Default port: 8080
# Custom port:  java -jar target/arena-server.jar 9090
```

Expected output:
```
╔══════════════════════════════════════╗
║     🏟  ARENA BATTLE ONLINE  🏟      ║
║                                      ║
║  WebSocket: ws://localhost:8080      ║
║  Open frontend/index.html to play    ║
╚══════════════════════════════════════╝
```

### 2  Serve the frontend

The browser requires HTTP (not `file://`) for WebSockets and CDN assets to work correctly.

**Option A — Python (simplest)**
```bash
cd frontend
python3 -m http.server 3000
# Open http://localhost:3000
```

**Option B — Node `serve`**
```bash
npx serve frontend -l 3000
# Open http://localhost:3000
```

**Option C — VS Code Live Server**  
Right-click `frontend/index.html` → *Open with Live Server*.

### 3  Test multiplayer locally

Open **two or more** browser tabs/windows pointing to `http://localhost:3000`.  
Each tab is a separate player. The match starts automatically once ≥ 2 players join.

---

## Controls

| Input | Action |
|-------|--------|
| `W A S D` | Move |
| Mouse | Look (FPS) |
| Left click (hold) | Shoot |
| `Space` | Jump |
| `Esc` | Release mouse cursor |

> **Tip:** Click the game window first to capture the mouse cursor (Pointer Lock).

---

## Network Protocol

### Client → Server

```jsonc
// Join the arena
{ "type": "join", "name": "YourName" }

// Send input every ~33ms
{
  "type":  "input",
  "move":  { "x": 0.0, "z": 1.0 },   // local-space strafe / forward
  "look":  { "yaw": 1.57, "pitch": 0.1 },
  "shoot": false,
  "jump":  false
}
```

### Server → Client (events)

```jsonc
{ "type": "welcome" }
{ "type": "joined",      "playerId": "p1a2b3c4", "playerName": "Hero", "matchState": "WAITING" }
{ "type": "playerJoined","playerId": "...", "playerName": "...", "playerCount": 2 }
{ "type": "playerLeft",  "playerId": "...", "playerName": "..." }
{ "type": "matchStart",  "playerCount": 2 }
{ "type": "hit",         "shooterId": "...", "targetId": "...", "damage": 20, "remainingHealth": 80 }
{ "type": "eliminated",  "playerId": "...", "playerName": "...", "killerId": "...", "killerName": "..." }
{ "type": "winner",      "winnerId": "...", "winnerName": "Hero" }
{ "type": "matchReset" }
```

### Server → Client (state broadcast, 30 Hz)

```jsonc
{
  "type":       "state",
  "matchState": "RUNNING",
  "tick":       1234,
  "players": [
    { "id": "p1a2b3c4", "name": "Hero", "x": 12.5, "y": 0.0, "z": -8.3,
      "yaw": 1.57, "pitch": 0.0, "health": 100, "alive": true, "kills": 2 }
  ],
  "bullets": [
    { "id": "b42", "x": 14.1, "y": 1.6, "z": -7.0, "vx": 0, "vy": 0, "vz": 55 }
  ],
  "zone": { "x": 0, "z": 0, "radius": 35.0, "nextShrinkMs": 32000 }
}
```

---

## Game Rules

| Rule | Value |
|------|-------|
| Max players per room | 12 |
| Min players to start | 2 |
| Player health | 100 HP |
| Damage per bullet | 20 HP |
| Shots to eliminate | 5 |
| Fire rate | 150 ms cooldown |
| Bullet speed | 55 units / sec |
| Player move speed | 10 units / sec |
| Arena radius | 50 units |
| Zone damage | 5 HP / sec outside zone |
| Zone shrink stages | 50 → 35 → 20 → 10 → 5 (every 45 s) |
| Post-match delay | 10 s before auto-reset |

---

## Architecture — Key Design Decisions

### Server-authoritative game loop
The `GameStateEngine` runs a **single-threaded 30 Hz loop**.  
All game state (positions, health, bullets, zone) lives exclusively in this thread.  
WebSocket threads only write to lock-free `ConcurrentLinkedQueue` inboxes; the loop drains them at the start of each tick.

### Client rendering vs. server state
Clients send raw input (move vector + look angles) and receive full game state.  
Remote player meshes are **lerped** toward server positions (0.35 factor per frame at 60 fps) for smooth interpolation between 30 Hz ticks.

### Bullet model
Bullets are real server-side projectiles (position + velocity), moved each tick and tested for sphere-capsule collision.  
No client-side hit detection — the server is the only authority for damage.

### Zone
The shrinking zone is a simple cylinder. `ZoneSystem` maintains a `currentRadius` that smoothly lerps toward `targetRadius` at 1.5 units/sec. Players outside the radius lose 5 HP/sec.

---

## Extending the MVP

| Feature | Where to add |
|---------|-------------|
| Multiple rooms/lobbies | Add room ID to `GameRoomManager`; route sessions per room |
| Leaderboard / scoreboard | Track `kills` on `Player`; broadcast on match end |
| Different weapons | Add weapon type to `InputMessage`; extend `CombatSystem` |
| Map collision (cover blocks) | Add AABB list to `GameStateEngine.simulatePhysics` |
| Server-side anti-cheat | Add speed-cap validation in `simulatePhysics` |
| TLS / WSS | Wrap `ArenaWebSocketServer` with a Java `SSLContext` |
| Mobile joystick | Replace keyboard listener in `player.js` with a touch joystick |
