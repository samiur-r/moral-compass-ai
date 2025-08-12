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

// ---- policies ----
export const limitChat = createLimiter(20, "10 m", "chat"); // 20 / 10min per client
export const limitPdf = createLimiter(5, "1 m", "pdf"); // 5 / 1min per client

// ---- utilities ----
export function getClientId(req: Request) {
  const xf = req.headers.get("x-forwarded-for");
  if (xf) return xf.split(",")[0].trim();
  // NextRequest sometimes exposes .ip
  const ip = (req as any).ip as string | undefined;
  if (ip) return ip;
  const ua = req.headers.get("user-agent") ?? "unknown";
  return `anon:${ua.slice(0, 80)}`;
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
