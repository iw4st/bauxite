import { Server, Socket } from "socket.io";
import prisma from "../prisma";
import { JwtPayload } from "../middleware/auth";

/**
 * Authenticated socket — we attach user data during the connection handshake.
 */
interface AuthSocket extends Socket {
  data: {
    user: JwtPayload;
  };
}

/**
 * Registers all chat-related Socket.io event handlers.
 */
export function registerChatHandlers(io: Server, socket: AuthSocket): void {
  const user = socket.data.user;

  // ── join-channel ───────────────────────────────────────────────
  socket.on("join-channel", async (channelId: string) => {
    socket.join(`channel:${channelId}`);
    socket.to(`channel:${channelId}`).emit("user-joined", {
      channelId,
      userId: user.userId,
      username: user.username,
    });
  });

  // ── leave-channel ──────────────────────────────────────────────
  socket.on("leave-channel", (channelId: string) => {
    socket.leave(`channel:${channelId}`);
    socket.to(`channel:${channelId}`).emit("user-left", {
      channelId,
      userId: user.userId,
      username: user.username,
    });
  });

  // ── send-message ───────────────────────────────────────────────
  socket.on(
    "send-message",
    async (data: { channelId: string; content: string }, ack?: (res: unknown) => void) => {
      try {
        if (!data.content || !data.content.trim()) return;

        const message = await prisma.message.create({
          data: {
            content: data.content.trim(),
            userId: user.userId,
            channelId: data.channelId,
          },
          include: {
            user: { select: { id: true, username: true, avatarUrl: true } },
            reactions: true,
          },
        });

        // Broadcast to everyone in the channel (including sender)
        io.to(`channel:${data.channelId}`).emit("new-message", message);

        if (ack) ack({ ok: true, messageId: message.id });
      } catch (err) {
        console.error("send-message error:", err);
        if (ack) ack({ ok: false, error: "Failed to send message" });
      }
    }
  );

  // ── delete-message ─────────────────────────────────────────────
  socket.on(
    "delete-message",
    async (data: { messageId: string; channelId: string }, ack?: (res: unknown) => void) => {
      try {
        const message = await prisma.message.findUnique({
          where: { id: data.messageId },
        });

        if (!message || message.userId !== user.userId) {
          if (ack) ack({ ok: false, error: "Not allowed" });
          return;
        }

        await prisma.message.delete({ where: { id: data.messageId } });

        io.to(`channel:${data.channelId}`).emit("message-deleted", {
          messageId: data.messageId,
          channelId: data.channelId,
        });

        if (ack) ack({ ok: true });
      } catch (err) {
        console.error("delete-message error:", err);
        if (ack) ack({ ok: false, error: "Failed to delete message" });
      }
    }
  );

  // ── add-reaction ───────────────────────────────────────────────
  socket.on(
    "add-reaction",
    async (
      data: { messageId: string; channelId: string; emoji: string },
      ack?: (res: unknown) => void
    ) => {
      try {
        // Upsert: check if reaction already exists
        const existing = await prisma.reaction.findUnique({
          where: {
            userId_messageId_emoji: {
              userId: user.userId,
              messageId: data.messageId,
              emoji: data.emoji,
            },
          },
        });

        if (existing) {
          if (ack) ack({ ok: true, action: "already-exists" });
          return;
        }

        const reaction = await prisma.reaction.create({
          data: {
            emoji: data.emoji,
            userId: user.userId,
            messageId: data.messageId,
          },
          include: {
            user: { select: { id: true, username: true } },
          },
        });

        io.to(`channel:${data.channelId}`).emit("reaction-added", {
          ...reaction,
          messageId: data.messageId,
          channelId: data.channelId,
        });

        if (ack) ack({ ok: true, reaction });
      } catch (err) {
        console.error("add-reaction error:", err);
        if (ack) ack({ ok: false, error: "Failed to add reaction" });
      }
    }
  );

  // ── remove-reaction ────────────────────────────────────────────
  socket.on(
    "remove-reaction",
    async (
      data: { messageId: string; channelId: string; emoji: string },
      ack?: (res: unknown) => void
    ) => {
      try {
        const existing = await prisma.reaction.findUnique({
          where: {
            userId_messageId_emoji: {
              userId: user.userId,
              messageId: data.messageId,
              emoji: data.emoji,
            },
          },
        });

        if (!existing) {
          if (ack) ack({ ok: false, error: "Reaction not found" });
          return;
        }

        await prisma.reaction.delete({ where: { id: existing.id } });

        io.to(`channel:${data.channelId}`).emit("reaction-removed", {
          reactionId: existing.id,
          messageId: data.messageId,
          channelId: data.channelId,
          emoji: data.emoji,
          userId: user.userId,
        });

        if (ack) ack({ ok: true });
      } catch (err) {
        console.error("remove-reaction error:", err);
        if (ack) ack({ ok: false, error: "Failed to remove reaction" });
      }
    }
  );

  // ── typing ─────────────────────────────────────────────────────
  socket.on("typing", (channelId: string) => {
    socket.to(`channel:${channelId}`).emit("user-typing", {
      channelId,
      userId: user.userId,
      username: user.username,
    });
  });
}
