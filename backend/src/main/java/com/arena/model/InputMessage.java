package com.arena.model;

/**
 * Deserialised from client JSON: {"type":"input","move":{"x":0,"z":0},"look":{"yaw":0,"pitch":0},"shoot":false,"jump":false}
 * Fields are intentionally nullable so Gson can deserialise partial messages.
 */
public class InputMessage {

    public String type;          // "input" | "join"
    public String name;          // used on "join"

    // Movement input (local-space, range −1..1)
    public MoveInput  move;
    public LookInput  look;

    public boolean shoot = false;
    public boolean jump  = false;

    public static class MoveInput {
        public double x = 0;   // strafe
        public double z = 0;   // forward / back
    }

    public static class LookInput {
        public double yaw   = 0;
        public double pitch = 0;
    }
}
