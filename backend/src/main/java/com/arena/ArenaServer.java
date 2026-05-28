package com.arena;

import java.util.logging.*;

/**
 * Entry point.  Run with:  java -jar arena-server.jar [port]
 * Default port: 8080
 */
public class ArenaServer {

    public static void main(String[] args) throws Exception {
        // Configure logger format
        System.setProperty("java.util.logging.SimpleFormatter.format",
                "[%1$tT] [%4$s] %5$s%n");

        Logger root = Logger.getLogger("");
        root.setLevel(Level.INFO);
        for (Handler h : root.getHandlers()) h.setLevel(Level.INFO);

        int port = 8080;
        if (args.length > 0) {
            try { port = Integer.parseInt(args[0]); }
            catch (NumberFormatException e) {
                System.err.println("Invalid port '" + args[0] + "', using 8080");
            }
        }

        ArenaWebSocketServer server = new ArenaWebSocketServer(port);
        server.startEngine();   // start game loop first
        server.start();         // then open WebSocket port

        printBanner(port);

        // Graceful shutdown hook
        Runtime.getRuntime().addShutdownHook(new Thread(() -> {
            try {
                System.out.println("\nShutting down arena server...");
                server.stop(2000);
            } catch (Exception e) {
                System.err.println("Error during shutdown: " + e.getMessage());
            }
        }));

        // Keep main thread alive
        Thread.currentThread().join();
    }

    private static void printBanner(int port) {
        System.out.println("""
                
                ╔══════════════════════════════════════╗
                ║     🏟  ARENA BATTLE ONLINE  🏟      ║
                ║                                      ║
                ║  WebSocket: ws://localhost:%d       ║
                ║  Open frontend/index.html to play    ║
                ╚══════════════════════════════════════╝
                """.formatted(port));
    }
}
