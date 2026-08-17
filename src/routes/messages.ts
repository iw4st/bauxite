import { Router, Response } from "express";
import prisma from "../prisma";
import { authMiddleware, AuthenticatedRequest } from "../middleware/auth";

const router = Router();

router.use(authMiddleware);

// ── GET /api/channels/:channelId/messages ──────────────────────
// Paginated messages for a channel (newest first).
router.get(
  "/channels/:channelId/messages",
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { channelId } = req.params;
      const cursor = req.query.cursor as string | undefined;
      const limit = Math.min(parseInt((req.query.limit as string) || "50", 10), 100);

      const messages = await prisma.message.findMany({
        where: { channelId },
        take: limit,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        orderBy: { createdAt: "desc" },
        include: {
          user: { select: { id: true, username: true, avatarUrl: true } },
          reactions: {
            include: {
              user: { select: { id: true, username: true } },
            },
          },
        },
      });

      res.json({
        messages: messages.reverse(), // return in chronological order
        nextCursor: messages.length === limit ? messages[0]?.id : null,
      });
    } catch (err) {
      console.error("List messages error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

// ── POST /api/channels/:channelId/messages ─────────────────────
router.post(
  "/channels/:channelId/messages",
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { channelId } = req.params;
      const { content } = req.body;

      if (!content || !content.trim()) {
        res.status(400).json({ error: "Message content is required" });
        return;
      }

      const message = await prisma.message.create({
        data: {
          content: content.trim(),
          userId: req.user!.userId,
          channelId,
        },
        include: {
          user: { select: { id: true, username: true, avatarUrl: true } },
          reactions: true,
        },
      });

      res.status(201).json({ message });
    } catch (err) {
      console.error("Create message error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

// ── DELETE /api/messages/:id ───────────────────────────────────
router.delete("/messages/:id", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const message = await prisma.message.findUnique({
      where: { id: req.params.id },
    });

    if (!message) {
      res.status(404).json({ error: "Message not found" });
      return;
    }

    if (message.userId !== req.user!.userId) {
      res.status(403).json({ error: "You can only delete your own messages" });
      return;
    }

    await prisma.message.delete({ where: { id: req.params.id } });

    res.json({ deleted: true, messageId: req.params.id, channelId: message.channelId });
  } catch (err) {
    console.error("Delete message error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /api/messages/:id/reactions ───────────────────────────
router.post(
  "/messages/:id/reactions",
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { emoji } = req.body;
      if (!emoji) {
        res.status(400).json({ error: "emoji is required" });
        return;
      }

      const message = await prisma.message.findUnique({
        where: { id: req.params.id },
      });
      if (!message) {
        res.status(404).json({ error: "Message not found" });
        return;
      }

      // Toggle: if reaction exists → remove it, otherwise → create it
      const existing = await prisma.reaction.findUnique({
        where: {
          userId_messageId_emoji: {
            userId: req.user!.userId,
            messageId: req.params.id,
            emoji,
          },
        },
      });

      if (existing) {
        await prisma.reaction.delete({ where: { id: existing.id } });
        res.json({ action: "removed", reaction: existing, channelId: message.channelId });
      } else {
        const reaction = await prisma.reaction.create({
          data: {
            emoji,
            userId: req.user!.userId,
            messageId: req.params.id,
          },
          include: {
            user: { select: { id: true, username: true } },
          },
        });
        res.status(201).json({ action: "added", reaction, channelId: message.channelId });
      }
    } catch (err) {
      console.error("Toggle reaction error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

export default router;
