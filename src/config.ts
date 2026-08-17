import dotenv from "dotenv";
dotenv.config();

function required(key: string): string {
  const val = process.env[key];
  if (!val) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return val;
}

function optional(key: string, fallback: string): string {
  return process.env[key] || fallback;
}

export interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

function parseIceServers(): IceServer[] {
  const raw = process.env.STUN_TURN_CONFIG;
  if (raw) {
    try {
      return JSON.parse(raw) as IceServer[];
    } catch {
      console.warn("⚠ Failed to parse STUN_TURN_CONFIG, using defaults");
    }
  }
  return [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ];
}

export const config = {
  port: parseInt(optional("PORT", "4000"), 10),
  jwtSecret: required("JWT_SECRET"),
  corsOrigins: optional("CORS_ORIGIN", "http://localhost:3000")
    .split(",")
    .map((s) => s.trim()),
  iceServers: parseIceServers(),
} as const;
