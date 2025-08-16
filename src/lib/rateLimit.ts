import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { createHash } from "crypto";

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

// ---- enhanced rate limiting policies ----
// Basic chat limits - stricter than before
export const limitChatBasic = createLimiter(5, "1 m", "chat-basic"); // 5 per minute
export const limitChatBurst = createLimiter(20, "1 h", "chat-burst"); // 20 per hour
export const limitChatDaily = createLimiter(100, "1 d", "chat-daily"); // 100 per day

// Specialized limits
export const limitPdf = createLimiter(3, "1 m", "pdf"); // Reduced from 5 to 3
export const limitPinecone = createLimiter(10, "1 m", "pinecone"); // RAG queries
export const limitExpensive = createLimiter(2, "1 m", "expensive"); // Complex operations

// Legacy compatibility - keeping original function name but with new limits
export const limitChat = limitChatBasic;

type RequestWithIp = Request & { ip?: string | null };

// ---- enhanced client identification ----
function generateFingerprint(req: RequestWithIp): string {
  const ua = req.headers.get("user-agent") ?? "";
  const acceptLang = req.headers.get("accept-language") ?? "";
  const acceptEnc = req.headers.get("accept-encoding") ?? "";
  
  // Create a hash of multiple request properties for better identification
  const fingerprintData = `${ua}:${acceptLang}:${acceptEnc}`;
  return createHash("sha256").update(fingerprintData).digest("hex").slice(0, 16);
}

export function getClientId(req: RequestWithIp): string {
  // Primary: Use IP address from headers
  const xf = req.headers.get("x-forwarded-for");
  const clientIp = xf ? xf.split(",")[0].trim() : req.ip;
  
  if (clientIp && clientIp !== "unknown") {
    return clientIp;
  }
  
  // Fallback: Generate fingerprint from request headers
  const fingerprint = generateFingerprint(req);
  return `fp:${fingerprint}`;
}

export function getEnhancedClientId(req: RequestWithIp): string {
  const baseId = getClientId(req);
  const fingerprint = generateFingerprint(req);
  
  // Combine IP and fingerprint for more robust identification
  return `${baseId}:${fingerprint}`;
}

export function rateHeaders(info: LimitResult) {
  const h = new Headers();
  h.set("RateLimit-Limit", String(info.limit));
  h.set("RateLimit-Remaining", String(info.remaining));
  h.set("RateLimit-Reset", String(info.reset)); // unix seconds
  if (!info.success) {
    h.set(
      "Retry-After",
      String(Math.max(1, info.reset - Math.floor(Date.now() / 1000)))
    );
  }
  return h;
}

// ---- multi-tier rate limiting ----
export interface MultiTierLimitResult {
  success: boolean;
  limit: number;
  remaining: number;
  reset: number;
  tier: "basic" | "burst" | "daily";
  message?: string;
}

export async function checkMultiTierLimits(
  clientId: string
): Promise<MultiTierLimitResult> {
  // Check all tiers in order of strictness
  const [basicResult, burstResult, dailyResult] = await Promise.all([
    limitChatBasic(clientId),
    limitChatBurst(clientId),
    limitChatDaily(clientId),
  ]);

  // Return the most restrictive failing limit
  if (!basicResult.success) {
    return {
      ...basicResult,
      tier: "basic",
      message: "Too many requests per minute. Please slow down.",
    };
  }

  if (!burstResult.success) {
    return {
      ...burstResult,
      tier: "burst",
      message: "Hourly limit exceeded. Please try again later.",
    };
  }

  if (!dailyResult.success) {
    return {
      ...dailyResult,
      tier: "daily",
      message: "Daily limit exceeded. Please try again tomorrow.",
    };
  }

  // All limits passed - return the most restrictive remaining count
  const mostRestrictive = [basicResult, burstResult, dailyResult].reduce(
    (min, current) => (current.remaining < min.remaining ? current : min)
  );

  return {
    ...mostRestrictive,
    tier: "basic",
  };
}
