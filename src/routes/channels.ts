import { Router, Response } from "express";
import prisma from "../prisma";
import { authMiddleware, AuthenticatedRequest } from "../middleware/auth";

const router = Router();

// All channel routes require authentication
router.use(authMiddleware);

// ── GET /api/channels ──────────────────────────────────────────
// Returns channels the authenticated user is a member of.
router.get("/", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const channels = await prisma.channel.findMany({
      where: { members: { some: { userId: req.user!.userId } } },
      include: {
        members: {
          include: { user: { select: { id: true, username: true, avatarUrl: true } } },
        },
        _count: { select: { messages: true } },
      },
      orderBy: { updatedAt: "desc" },
    });

    res.json({ channels });
  } catch (err) {
    console.error("List channels error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /api/channels ─────────────────────────────────────────
// Create a new channel and auto-join the creator.
router.post("/", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { name, type } = req.body;

    if (!name) {
      res.status(400).json({ error: "Channel name is required" });
      return;
    }

    const channelType = type === "DM" ? "DM" : type === "VOICE" ? "VOICE" : "TEXT";

    const channel = await prisma.channel.create({
      data: {
        name,
        type: channelType,
        members: {
          create: { userId: req.user!.userId },
        },
      },
      include: {
        members: {
          include: { user: { select: { id: true, username: true, avatarUrl: true } } },
        },
      },
    });

    res.status(201).json({ channel });
  } catch (err) {
    console.error("Create channel error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /api/channels/:id ───────────────────────────────────────
router.get("/:id", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const channel = await prisma.channel.findUnique({
      where: { id: req.params.id },
      include: {
        members: {
          include: { user: { select: { id: true, username: true, avatarUrl: true } } },
        },
      },
    });

    if (!channel) {
      res.status(404).json({ error: "Channel not found" });
      return;
    }

    res.json({ channel });
  } catch (err) {
    console.error("Get channel error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /api/channels/:id/join ────────────────────────────────
// Join an existing channel.
router.post("/:id/join", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const channelId = req.params.id;
    const userId = req.user!.userId;

    const channel = await prisma.channel.findUnique({ where: { id: channelId } });
    if (!channel) {
      res.status(404).json({ error: "Channel not found" });
      return;
    }

    const existingMember = await prisma.channelMember.findUnique({
      where: { userId_channelId: { userId, channelId } },
    });

    if (existingMember) {
      res.json({ message: "Already a member" });
      return;
    }

    await prisma.channelMember.create({
      data: { userId, channelId },
    });

    res.status(201).json({ message: "Joined channel" });
  } catch (err) {
    console.error("Join channel error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /api/channels/all/list ──────────────────────────────────
// Returns ALL channels (for discovery / browsing).
router.get("/all/list", async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const channels = await prisma.channel.findMany({
      include: {
        _count: { select: { members: true, messages: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    res.json({ channels });
  } catch (err) {
    console.error("List all channels error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
