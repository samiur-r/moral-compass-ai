import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

// ---- create Redis client from either UPSTASH_* or KV_* envs ----
function makeRedis() {
  const url =
    process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL ?? "";
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN ?? "";
  if (!url || !token) return null;
  return new Redis({ url, token });
}

const redis = makeRedis();

// ---- tiny in-memory fallback for local dev if envs missing ----
type LimitResult = {
  success: boolean;
  limit: number;
  remaining: number;
  reset: number;
};
type LimiterFn = (key: string) => Promise<LimitResult>;

function memoryLimiter(limit: number, windowMs: number): LimiterFn {
  const map = new Map<string, { count: number; resetAt: number }>();
  return async (key) => {
    const now = Date.now();
    const rec = map.get(key);
    if (!rec || now >= rec.resetAt) {
      const resetAt = now + windowMs;
      map.set(key, { count: 1, resetAt });
      return {
        success: true,
        limit,
        remaining: limit - 1,
        reset: Math.ceil(resetAt / 1000),
      };
    }
    if (rec.count >= limit) {
      return {
        success: false,
        limit,
        remaining: 0,
        reset: Math.ceil(rec.resetAt / 1000),
      };
    }
    rec.count++;
    return {
      success: true,
      limit,
      remaining: limit - rec.count,
      reset: Math.ceil(rec.resetAt / 1000),
    };
  };
}

// ---- factory that returns a limiter using Upstash when available ----
function createLimiter(
  limit: number,
  window: `${number} ${"s" | "m" | "h" | "d"}`,
  prefix: string
): LimiterFn {
  if (redis) {
    const rl = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(limit, window),
      analytics: true,
      prefix: `ratelimit:${prefix}`,
    });
    return async (key) => {
      const r = await rl.limit(key);
      return {
        success: r.success,
        limit: r.limit,
        remaining: r.remaining,
        reset: r.reset,
      };
    };
  }
  // fallback: fixed window in memory (dev only)
  const sec = Number(window.split(" ")[0]);
  return memoryLimiter(limit, sec * 1000);
}

// ---- policies (very restrictive for test app) ----
export const limitChat = createLimiter(3, "10 m", "chat"); // 3 / 10min per client  
export const limitChatDaily = createLimiter(5, "1 d", "chat-daily"); // 5 / day per client
export const limitPdf = createLimiter(1, "1 m", "pdf"); // 1 / 1min per client
export const limitPdfDaily = createLimiter(2, "1 d", "pdf-daily"); // 2 / day per client

type RequestWithIp = Request & { ip?: string | null };

// ---- utilities ----
export function getClientId(req: RequestWithIp) {
  // Primary: Use X-Forwarded-For header (most reliable in production)
  const xf = req.headers.get("x-forwarded-for");
  if (xf) {
    const primaryIp = xf.split(",")[0].trim();
    return `ip:${primaryIp}`;
  }

  // Secondary: Use direct IP 
  const ip = req.ip as string | undefined;
  if (ip) return `ip:${ip}`;

  // Fallback: Create fingerprint from headers (for better identification)
  const ua = req.headers.get("user-agent") ?? "unknown";
  const acceptLang = req.headers.get("accept-language") ?? "";
  const acceptEnc = req.headers.get("accept-encoding") ?? "";
  
  // Create a simple hash-like identifier from headers
  const fingerprint = Buffer.from(`${ua}:${acceptLang}:${acceptEnc}`)
    .toString("base64")
    .slice(0, 16);
  
  return `fp:${fingerprint}`;
}

export interface MultiLimitResult {
  success: boolean;
  limits: {
    shortTerm: LimitResult;
    daily: LimitResult;
  };
  restrictiveLimit: LimitResult; // The most restrictive one
}

/** Check multiple rate limits and return the most restrictive */
export async function checkMultipleLimits(
  clientId: string,
  type: "chat" | "pdf"
): Promise<MultiLimitResult> {
  const [shortTerm, daily] = await Promise.all([
    type === "chat" ? limitChat(clientId) : limitPdf(clientId),
    type === "chat" ? limitChatDaily(clientId) : limitPdfDaily(clientId),
  ]);

  // Both must succeed for overall success
  const success = shortTerm.success && daily.success;
  
  // Find the most restrictive limit (least remaining time)
  const restrictiveLimit = daily.remaining < shortTerm.remaining ? daily : shortTerm;

  return {
    success,
    limits: { shortTerm, daily },
    restrictiveLimit,
  };
}

export function rateHeaders(info: LimitResult | MultiLimitResult) {
  const h = new Headers();
  
  // Use restrictive limit for headers if MultiLimitResult
  const limit = "restrictiveLimit" in info ? info.restrictiveLimit : info;
  
  h.set("RateLimit-Limit", String(limit.limit));
  h.set("RateLimit-Remaining", String(limit.remaining));
  h.set("RateLimit-Reset", String(limit.reset)); // unix seconds
  
  if (!limit.success) {
    h.set(
      "Retry-After",
      String(Math.max(1, limit.reset - Math.floor(Date.now() / 1000)))
    );
  }
  
  // Add additional context for multi-limit
  if ("limits" in info) {
    h.set("RateLimit-Policy", "multi-tier");
  }
  
  return h;
}
