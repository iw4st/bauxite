import { Server, Socket } from "socket.io";
import { config } from "../config";
import { JwtPayload } from "../middleware/auth";

interface AuthSocket extends Socket {
  data: {
    user: JwtPayload;
  };
}

/**
 * In-memory map of call rooms → set of socket IDs.
 * Key format: "call:<channelId>"
 */
const callRooms = new Map<string, Set<string>>();

/**
 * Registers all WebRTC signaling Socket.io event handlers.
 */
export function registerWebRTCHandlers(io: Server, socket: AuthSocket): void {
  const user = socket.data.user;

  // ── Send ICE config to the client right after connection ───────
  socket.emit("ice-servers", config.iceServers);

  // ── join-room (voice/video/screen call room) ──────────────────
  socket.on("join-room", (channelId: string) => {
    const roomKey = `call:${channelId}`;

    if (!callRooms.has(roomKey)) {
      callRooms.set(roomKey, new Set());
    }
    const room = callRooms.get(roomKey)!;
    room.add(socket.id);
    socket.join(roomKey);

    // Notify all OTHER participants that a new peer joined
    socket.to(roomKey).emit("peer-joined", {
      socketId: socket.id,
      userId: user.userId,
      username: user.username,
    });

    // Send the new peer a list of existing participants (so it can create offers)
    const existingPeers = Array.from(room)
      .filter((id) => id !== socket.id)
      .map((id) => {
        const peerSocket = io.sockets.sockets.get(id);
        return {
          socketId: id,
          userId: peerSocket?.data?.user?.userId || "unknown",
          username: peerSocket?.data?.user?.username || "unknown",
        };
      });

    socket.emit("room-peers", {
      channelId,
      peers: existingPeers,
    });
  });

  // ── leave-room ────────────────────────────────────────────────
  socket.on("leave-room", (channelId: string) => {
    leaveCallRoom(io, socket, channelId);
  });

  // ── WebRTC offer ──────────────────────────────────────────────
  socket.on(
    "offer",
    (data: { targetSocketId: string; sdp: Record<string, unknown> }) => {
      io.to(data.targetSocketId).emit("offer", {
        sdp: data.sdp,
        fromSocketId: socket.id,
        userId: user.userId,
        username: user.username,
      });
    }
  );

  // ── WebRTC answer ─────────────────────────────────────────────
  socket.on(
    "answer",
    (data: { targetSocketId: string; sdp: Record<string, unknown> }) => {
      io.to(data.targetSocketId).emit("answer", {
        sdp: data.sdp,
        fromSocketId: socket.id,
        userId: user.userId,
        username: user.username,
      });
    }
  );

  // ── ICE candidate ────────────────────────────────────────────
  socket.on(
    "ice-candidate",
    (data: { targetSocketId: string; candidate: Record<string, unknown> }) => {
      io.to(data.targetSocketId).emit("ice-candidate", {
        candidate: data.candidate,
        fromSocketId: socket.id,
      });
    }
  );

  // ── Cleanup on disconnect ─────────────────────────────────────
  socket.on("disconnect", () => {
    // Leave all call rooms this socket was in
    for (const [roomKey, members] of callRooms.entries()) {
      if (members.has(socket.id)) {
        const channelId = roomKey.replace("call:", "");
        leaveCallRoom(io, socket, channelId);
      }
    }
  });
}

/**
 * Removes a socket from a call room and notifies remaining peers.
 */
function leaveCallRoom(io: Server, socket: AuthSocket, channelId: string): void {
  const roomKey = `call:${channelId}`;
  const room = callRooms.get(roomKey);

  if (room) {
    room.delete(socket.id);
    if (room.size === 0) {
      callRooms.delete(roomKey);
    }
  }

  socket.leave(roomKey);

  io.to(roomKey).emit("peer-left", {
    socketId: socket.id,
    userId: socket.data.user.userId,
    username: socket.data.user.username,
  });
}
