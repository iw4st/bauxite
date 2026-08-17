import http from "http";
import path from "path";
import express from "express";
import cors from "cors";
import { Server as SocketIOServer } from "socket.io";
import { config } from "./config";
import prisma from "./prisma";
import { verifyToken } from "./middleware/auth";
import authRoutes from "./routes/auth";
import channelRoutes from "./routes/channels";
import messageRoutes from "./routes/messages";
import { registerChatHandlers } from "./sockets/chat";
import { registerWebRTCHandlers } from "./sockets/webrtc";

// ── Express ────────────────────────────────────────────────────
const app = express();
const server = http.createServer(app);

// Body parsing
app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true }));

// CORS helper
function isOriginAllowed(origin: string | undefined): boolean {
  if (!origin) return true;
  if (config.corsOrigins.includes("*")) return true;
  if (config.corsOrigins.includes(origin)) return true;
  if (
    origin.startsWith("http://localhost") ||
    origin.startsWith("http://127.0.0.1") ||
    origin.includes("onrender.com") ||
    origin.includes("koyeb.app") ||
    origin.includes("vercel.app") ||
    origin.includes("netlify.app") ||
    origin.includes("pages.dev")
  ) {
    return true;
  }
  return false;
}

// CORS
app.use(
  cors({
    origin: (origin, cb) => {
      if (isOriginAllowed(origin)) return cb(null, true);
      cb(new Error(`CORS: origin ${origin} not allowed`));
    },
    credentials: true,
  })
);

// Serve test client
app.use(express.static(path.join(__dirname, "..", "public")));

// ── Health check (required by Koyeb) ───────────────────────────
app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// ── API Routes ─────────────────────────────────────────────────
app.use("/api/auth", authRoutes);
app.use("/api/channels", channelRoutes);
app.use("/api", messageRoutes);

// ── Socket.io ──────────────────────────────────────────────────
const io = new SocketIOServer(server, {
  cors: {
    origin: (origin, cb) => {
      if (isOriginAllowed(origin)) return cb(null, true);
      cb(new Error(`CORS: origin ${origin} not allowed`));
    },
    credentials: true,
  },
  pingInterval: 25000,
  pingTimeout: 20000,
});

// Socket.io authentication middleware
io.use((socket, next) => {
  const token = socket.handshake.auth?.token as string | undefined;
  if (!token) {
    return next(new Error("Authentication required"));
  }
  try {
    const payload = verifyToken(token);
    socket.data.user = payload;
    next();
  } catch {
    next(new Error("Invalid token"));
  }
});

// Socket.io connection handler
io.on("connection", (socket) => {
  console.log(
    `✔ Socket connected: ${socket.id} (user: ${socket.data.user.username})`
  );

  // Register all event handlers
  registerChatHandlers(io, socket as any);
  registerWebRTCHandlers(io, socket as any);

  // Update online status
  prisma.user
    .update({ where: { id: socket.data.user.userId }, data: { online: true } })
    .catch(() => {});

  socket.on("disconnect", () => {
    console.log(`✘ Socket disconnected: ${socket.id}`);
    prisma.user
      .update({ where: { id: socket.data.user.userId }, data: { online: false } })
      .catch(() => {});
  });
});

// ── Start ──────────────────────────────────────────────────────
async function main(): Promise<void> {
  // Verify DB connection
  await prisma.$connect();
  console.log("✔ Database connected");

  server.listen(config.port, () => {
    console.log(`🚀 Server running on port ${config.port}`);
    console.log(`   Health: http://localhost:${config.port}/health`);
    console.log(`   Client: http://localhost:${config.port}/`);
  });
}

main().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});

// Graceful shutdown
process.on("SIGTERM", async () => {
  console.log("SIGTERM received, shutting down...");
  await prisma.$disconnect();
  server.close();
  process.exit(0);
});
