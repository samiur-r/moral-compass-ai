import { Redis } from "@upstash/redis";

// Cost configuration - approximate costs in USD
export const COST_CONFIG = {
  // OpenAI API costs (approximate, may need adjustment based on actual pricing)
  GPT_4_1_NANO: {
    INPUT_PER_1K_TOKENS: 0.00015, // $0.15 per 1M tokens
    OUTPUT_PER_1K_TOKENS: 0.0006, // $0.60 per 1M tokens
  },
  TEXT_EMBEDDING_3_SMALL: {
    PER_1K_TOKENS: 0.00002, // $0.02 per 1M tokens
  },
  MODERATION: {
    PER_1K_TOKENS: 0.00002, // $0.02 per 1M tokens
  },
  
  // Pinecone costs (approximate)
  PINECONE_QUERY: 0.0001, // $0.0001 per query
  
  // Default limits per user per day (in USD)
  DEFAULT_DAILY_LIMIT: 5.00,
  DEFAULT_HOURLY_LIMIT: 1.00,
  DEFAULT_MONTHLY_LIMIT: 50.00,
} as const;

interface CostEstimate {
  total: number;
  breakdown: {
    gptCalls: number;
    embeddings: number;
    moderation: number;
    pinecone: number;
  };
  estimatedTokens: {
    input: number;
    output: number;
  };
}

interface UserCostData {
  daily: number;
  hourly: number;
  monthly: number;
  lastReset: {
    daily: string; // ISO date
    hourly: string; // ISO datetime
    monthly: string; // ISO month (YYYY-MM)
  };
}

// Redis client (reuse from rateLimit)
function makeRedis() {
  const url =
    process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL ?? "";
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN ?? "";
  if (!url || !token) return null;
  return new Redis({ url, token });
}

const redis = makeRedis();

/**
 * Estimate tokens from text length (rough approximation)
 */
function estimateTokens(text: string): number {
  // Rough estimate: 1 token ≈ 0.75 words ≈ 4 characters
  return Math.ceil(text.length / 4);
}

/**
 * Estimate cost for a decision request
 */
export function estimateRequestCost(
  userInput: string,
  agentCount: number = 8,
  includesPdf: boolean = false
): CostEstimate {
  const inputTokens = estimateTokens(userInput);
  
  // Estimate total tokens for the request
  const moderationTokens = inputTokens;
  const embeddingTokens = includesPdf ? inputTokens : 0; // Only aiRisk uses embeddings
  
  // Each agent gets system prompt + user input + generates output
  const avgSystemPromptTokens = 100;
  const avgOutputTokens = 200; // Based on 250 max with some variance
  
  const totalInputTokens = agentCount * (inputTokens + avgSystemPromptTokens);
  const totalOutputTokens = agentCount * avgOutputTokens;
  
  // Calculate costs
  const gptInputCost = (totalInputTokens / 1000) * COST_CONFIG.GPT_4_1_NANO.INPUT_PER_1K_TOKENS;
  const gptOutputCost = (totalOutputTokens / 1000) * COST_CONFIG.GPT_4_1_NANO.OUTPUT_PER_1K_TOKENS;
  const embeddingCost = (embeddingTokens / 1000) * COST_CONFIG.TEXT_EMBEDDING_3_SMALL.PER_1K_TOKENS;
  const moderationCost = (moderationTokens / 1000) * COST_CONFIG.MODERATION.PER_1K_TOKENS;
  const pineconeCost = includesPdf ? COST_CONFIG.PINECONE_QUERY : 0;
  
  const gptTotal = gptInputCost + gptOutputCost;
  const total = gptTotal + embeddingCost + moderationCost + pineconeCost;
  
  return {
    total,
    breakdown: {
      gptCalls: gptTotal,
      embeddings: embeddingCost,
      moderation: moderationCost,
      pinecone: pineconeCost,
    },
    estimatedTokens: {
      input: totalInputTokens,
      output: totalOutputTokens,
    },
  };
}

/**
 * Get user cost data from Redis
 */
async function getUserCostData(clientId: string): Promise<UserCostData> {
  if (!redis) {
    // Fallback for local development
    return {
      daily: 0,
      hourly: 0,
      monthly: 0,
      lastReset: {
        daily: new Date().toISOString().split('T')[0],
        hourly: new Date().toISOString(),
        monthly: new Date().toISOString().slice(0, 7),
      },
    };
  }
  
  const key = `cost:${clientId}`;
  const data = await redis.hgetall(key);
  
  if (!data || Object.keys(data).length === 0) {
    const now = new Date();
    return {
      daily: 0,
      hourly: 0,
      monthly: 0,
      lastReset: {
        daily: now.toISOString().split('T')[0],
        hourly: now.toISOString(),
        monthly: now.toISOString().slice(0, 7),
      },
    };
  }
  
  return {
    daily: parseFloat(data.daily as string) || 0,
    hourly: parseFloat(data.hourly as string) || 0,
    monthly: parseFloat(data.monthly as string) || 0,
    lastReset: {
      daily: data.lastResetDaily as string || new Date().toISOString().split('T')[0],
      hourly: data.lastResetHourly as string || new Date().toISOString(),
      monthly: data.lastResetMonthly as string || new Date().toISOString().slice(0, 7),
    },
  };
}

/**
 * Reset cost counters if time periods have elapsed
 */
async function resetExpiredCounters(clientId: string, costData: UserCostData): Promise<UserCostData> {
  const now = new Date();
  const currentDay = now.toISOString().split('T')[0];
  const currentHour = now.toISOString().slice(0, 13) + ':00:00.000Z'; // Round to hour
  const currentMonth = now.toISOString().slice(0, 7);
  
  let updated = false;
  const newData = { ...costData };
  
  // Reset daily counter
  if (currentDay > costData.lastReset.daily) {
    newData.daily = 0;
    newData.lastReset.daily = currentDay;
    updated = true;
  }
  
  // Reset hourly counter
  if (currentHour > costData.lastReset.hourly) {
    newData.hourly = 0;
    newData.lastReset.hourly = currentHour;
    updated = true;
  }
  
  // Reset monthly counter
  if (currentMonth > costData.lastReset.monthly) {
    newData.monthly = 0;
    newData.lastReset.monthly = currentMonth;
    updated = true;
  }
  
  if (updated && redis) {
    const key = `cost:${clientId}`;
    await redis.hset(key, {
      daily: newData.daily,
      hourly: newData.hourly,
      monthly: newData.monthly,
      lastResetDaily: newData.lastReset.daily,
      lastResetHourly: newData.lastReset.hourly,
      lastResetMonthly: newData.lastReset.monthly,
    });
    
    // Set TTL to 35 days to auto-cleanup old entries
    await redis.expire(key, 35 * 24 * 60 * 60);
  }
  
  return newData;
}

/**
 * Check if user is within cost limits
 */
export interface CostLimitResult {
  allowed: boolean;
  reason?: string;
  currentUsage: {
    daily: number;
    hourly: number;
    monthly: number;
  };
  limits: {
    daily: number;
    hourly: number;
    monthly: number;
  };
  estimatedCost: number;
}

export async function checkCostLimits(
  clientId: string,
  estimatedCost: number
): Promise<CostLimitResult> {
  // Get custom limits from environment or use defaults
  const dailyLimit = parseFloat(process.env.DAILY_COST_LIMIT || String(COST_CONFIG.DEFAULT_DAILY_LIMIT));
  const hourlyLimit = parseFloat(process.env.HOURLY_COST_LIMIT || String(COST_CONFIG.DEFAULT_HOURLY_LIMIT));
  const monthlyLimit = parseFloat(process.env.MONTHLY_COST_LIMIT || String(COST_CONFIG.DEFAULT_MONTHLY_LIMIT));
  
  let costData = await getUserCostData(clientId);
  costData = await resetExpiredCounters(clientId, costData);
  
  // Check if adding this cost would exceed limits
  const projectedDaily = costData.daily + estimatedCost;
  const projectedHourly = costData.hourly + estimatedCost;
  const projectedMonthly = costData.monthly + estimatedCost;
  
  if (projectedDaily > dailyLimit) {
    return {
      allowed: false,
      reason: `Daily cost limit exceeded. Current: $${costData.daily.toFixed(4)}, Limit: $${dailyLimit.toFixed(2)}`,
      currentUsage: {
        daily: costData.daily,
        hourly: costData.hourly,
        monthly: costData.monthly,
      },
      limits: {
        daily: dailyLimit,
        hourly: hourlyLimit,
        monthly: monthlyLimit,
      },
      estimatedCost,
    };
  }
  
  if (projectedHourly > hourlyLimit) {
    return {
      allowed: false,
      reason: `Hourly cost limit exceeded. Current: $${costData.hourly.toFixed(4)}, Limit: $${hourlyLimit.toFixed(2)}`,
      currentUsage: {
        daily: costData.daily,
        hourly: costData.hourly,
        monthly: costData.monthly,
      },
      limits: {
        daily: dailyLimit,
        hourly: hourlyLimit,
        monthly: monthlyLimit,
      },
      estimatedCost,
    };
  }
  
  if (projectedMonthly > monthlyLimit) {
    return {
      allowed: false,
      reason: `Monthly cost limit exceeded. Current: $${costData.monthly.toFixed(2)}, Limit: $${monthlyLimit.toFixed(2)}`,
      currentUsage: {
        daily: costData.daily,
        hourly: costData.hourly,
        monthly: costData.monthly,
      },
      limits: {
        daily: dailyLimit,
        hourly: hourlyLimit,
        monthly: monthlyLimit,
      },
      estimatedCost,
    };
  }
  
  return {
    allowed: true,
    currentUsage: {
      daily: costData.daily,
      hourly: costData.hourly,
      monthly: costData.monthly,
    },
    limits: {
      daily: dailyLimit,
      hourly: hourlyLimit,
      monthly: monthlyLimit,
    },
    estimatedCost,
  };
}

/**
 * Record actual cost incurred by a request
 */
export async function recordCost(clientId: string, actualCost: number): Promise<void> {
  if (!redis) return; // Skip in local development
  
  let costData = await getUserCostData(clientId);
  costData = await resetExpiredCounters(clientId, costData);
  
  // Add the cost to all time periods
  costData.daily += actualCost;
  costData.hourly += actualCost;
  costData.monthly += actualCost;
  
  const key = `cost:${clientId}`;
  await redis.hset(key, {
    daily: costData.daily,
    hourly: costData.hourly,
    monthly: costData.monthly,
    lastResetDaily: costData.lastReset.daily,
    lastResetHourly: costData.lastReset.hourly,
    lastResetMonthly: costData.lastReset.monthly,
  });
  
  // Set TTL to 35 days
  await redis.expire(key, 35 * 24 * 60 * 60);
}

/**
 * Get cost usage summary for a user
 */
export async function getCostUsage(clientId: string): Promise<{
  current: UserCostData;
  limits: { daily: number; hourly: number; monthly: number };
  percentUsed: { daily: number; hourly: number; monthly: number };
}> {
  const dailyLimit = parseFloat(process.env.DAILY_COST_LIMIT || String(COST_CONFIG.DEFAULT_DAILY_LIMIT));
  const hourlyLimit = parseFloat(process.env.HOURLY_COST_LIMIT || String(COST_CONFIG.DEFAULT_HOURLY_LIMIT));
  const monthlyLimit = parseFloat(process.env.MONTHLY_COST_LIMIT || String(COST_CONFIG.DEFAULT_MONTHLY_LIMIT));
  
  let costData = await getUserCostData(clientId);
  costData = await resetExpiredCounters(clientId, costData);
  
  return {
    current: costData,
    limits: {
      daily: dailyLimit,
      hourly: hourlyLimit,
      monthly: monthlyLimit,
    },
    percentUsed: {
      daily: (costData.daily / dailyLimit) * 100,
      hourly: (costData.hourly / hourlyLimit) * 100,
      monthly: (costData.monthly / monthlyLimit) * 100,
    },
  };
}