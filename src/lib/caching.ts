import { embed } from "ai";
import { openai } from "@ai-sdk/openai";
import { Redis } from "@upstash/redis";
import { createHash } from "crypto";

// Cache configuration
export const CACHE_CONFIG = {
  // TTL values in seconds
  TTL: {
    EXACT_MATCH: 24 * 60 * 60,      // 24 hours
    SEMANTIC: 7 * 24 * 60 * 60,     // 7 days
    PARTIAL_CONTEXT: 30 * 24 * 60 * 60, // 30 days
    PINECONE_RESULTS: 60 * 60,      // 1 hour
  },
  
  // Similarity thresholds
  SIMILARITY: {
    HIGH: 0.95,      // Nearly identical
    MEDIUM: 0.85,    // Very similar
    LOW: 0.75,       // Somewhat similar
  },
  
  // Cache key prefixes
  PREFIXES: {
    EXACT: "cache:exact:",
    SEMANTIC: "cache:semantic:",
    PARTIAL: "cache:partial:",
    PINECONE: "cache:pinecone:",
    EMBEDDING: "cache:embedding:",
    METRICS: "cache:metrics:",
  },
  
  // Performance settings
  MAX_CACHE_ENTRIES: 10000,
  CLEANUP_BATCH_SIZE: 100,
  EMBEDDING_CACHE_SIZE: 1000,
} as const;

// Redis client (reuse from existing setup)
function makeRedis() {
  const url =
    process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL ?? "";
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN ?? "";
  if (!url || !token) return null;
  return new Redis({ url, token });
}

const redis = makeRedis();

// Types
export interface CacheEntry<T = unknown> {
  data: T;
  timestamp: number;
  ttl: number;
  hits: number;
  embedding?: number[];
  metadata?: Record<string, unknown>;
}

export interface SemanticCacheResult<T = unknown> {
  hit: boolean;
  data?: T;
  similarity?: number;
  cacheKey?: string;
  source: "exact" | "semantic" | "partial" | "miss";
}

export interface CacheStats {
  totalHits: number;
  totalMisses: number;
  hitRate: number;
  exactHits: number;
  semanticHits: number;
  partialHits: number;
  averageSimilarity: number;
  cacheSize: number;
  oldestEntry: number;
  newestEntry: number;
}

/**
 * Generate hash for exact match caching
 */
function generateExactHash(input: string, context?: Record<string, unknown>): string {
  const contextStr = context ? JSON.stringify(context) : "";
  return createHash("sha256").update(`${input}:${contextStr}`).digest("hex");
}

/**
 * Generate embedding with caching
 */
async function getCachedEmbedding(text: string): Promise<number[]> {
  if (!redis) {
    // Fallback: generate embedding without caching
    const { embedding } = await embed({
      model: openai.embedding("text-embedding-3-small"),
      value: text,
    });
    return embedding;
  }
  
  const hash = createHash("sha256").update(text).digest("hex").slice(0, 16);
  const cacheKey = `${CACHE_CONFIG.PREFIXES.EMBEDDING}${hash}`;
  
  try {
    // Try to get from cache
    const cached = await redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached as string);
    }
    
    // Generate new embedding
    const { embedding } = await embed({
      model: openai.embedding("text-embedding-3-small"),
      value: text,
    });
    
    // Cache the embedding
    await redis.setex(cacheKey, CACHE_CONFIG.TTL.SEMANTIC, JSON.stringify(embedding));
    
    return embedding;
  } catch (error) {
    console.warn("[CACHE] Embedding cache error:", error);
    // Fallback to direct generation
    const { embedding } = await embed({
      model: openai.embedding("text-embedding-3-small"),
      value: text,
    });
    return embedding;
  }
}

/**
 * Calculate cosine similarity between two vectors
 */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Store cache entry with metadata
 */
async function storeCacheEntry<T>(
  key: string,
  data: T,
  ttl: number,
  embedding?: number[],
  metadata?: Record<string, unknown>
): Promise<void> {
  if (!redis) return;
  
  const entry: CacheEntry<T> = {
    data,
    timestamp: Date.now(),
    ttl,
    hits: 0,
    embedding,
    metadata,
  };
  
  try {
    await redis.setex(key, ttl, JSON.stringify(entry));
    await updateCacheMetrics("store");
  } catch (error) {
    console.warn("[CACHE] Store error:", error);
  }
}

/**
 * Retrieve and update cache entry
 */
async function getCacheEntry<T>(key: string): Promise<CacheEntry<T> | null> {
  if (!redis) return null;
  
  try {
    const cached = await redis.get(key);
    if (!cached) return null;
    
    const entry: CacheEntry<T> = JSON.parse(cached as string);
    
    // Update hit count
    entry.hits++;
    await redis.setex(key, entry.ttl, JSON.stringify(entry));
    
    return entry;
  } catch (error) {
    console.warn("[CACHE] Retrieve error:", error);
    return null;
  }
}

/**
 * Level 1: Exact Match Cache
 */
export async function getExactCache<T>(
  input: string,
  context?: Record<string, unknown>
): Promise<SemanticCacheResult<T>> {
  const hash = generateExactHash(input, context);
  const cacheKey = `${CACHE_CONFIG.PREFIXES.EXACT}${hash}`;
  
  const entry = await getCacheEntry<T>(cacheKey);
  if (entry) {
    await updateCacheMetrics("hit", "exact");
    return {
      hit: true,
      data: entry.data,
      similarity: 1.0,
      cacheKey,
      source: "exact",
    };
  }
  
  await updateCacheMetrics("miss");
  return { hit: false, source: "miss" };
}

/**
 * Store exact match cache
 */
export async function setExactCache<T>(
  input: string,
  data: T,
  context?: Record<string, unknown>
): Promise<void> {
  const hash = generateExactHash(input, context);
  const cacheKey = `${CACHE_CONFIG.PREFIXES.EXACT}${hash}`;
  
  await storeCacheEntry(cacheKey, data, CACHE_CONFIG.TTL.EXACT_MATCH, undefined, {
    type: "exact",
    inputLength: input.length,
    contextKeys: context ? Object.keys(context) : [],
  });
}

/**
 * Level 2: Semantic Similarity Cache
 */
export async function getSemanticCache<T>(
  input: string,
  threshold: number = CACHE_CONFIG.SIMILARITY.MEDIUM
): Promise<SemanticCacheResult<T>> {
  if (!redis) return { hit: false, source: "miss" };
  
  try {
    // Get input embedding
    const inputEmbedding = await getCachedEmbedding(input);
    
    // Search for similar entries
    const pattern = `${CACHE_CONFIG.PREFIXES.SEMANTIC}*`;
    const keys = await redis.keys(pattern);
    
    let bestMatch: { key: string; similarity: number; entry: CacheEntry<T> } | null = null;
    
    for (const key of keys.slice(0, 100)) { // Limit search to recent entries
      try {
        const entry = await getCacheEntry<T>(key);
        if (!entry?.embedding) continue;
        
        const similarity = cosineSimilarity(inputEmbedding, entry.embedding);
        
        if (similarity >= threshold && (!bestMatch || similarity > bestMatch.similarity)) {
          bestMatch = { key, similarity, entry };
        }
      } catch (error) {
        console.warn("[CACHE] Semantic search error for key:", key, error);
      }
    }
    
    if (bestMatch) {
      await updateCacheMetrics("hit", "semantic", bestMatch.similarity);
      return {
        hit: true,
        data: bestMatch.entry.data,
        similarity: bestMatch.similarity,
        cacheKey: bestMatch.key,
        source: "semantic",
      };
    }
    
    await updateCacheMetrics("miss");
    return { hit: false, source: "miss" };
  } catch (error) {
    console.warn("[CACHE] Semantic cache error:", error);
    return { hit: false, source: "miss" };
  }
}

/**
 * Store semantic cache with embedding
 */
export async function setSemanticCache<T>(
  input: string,
  data: T,
  metadata?: Record<string, unknown>
): Promise<void> {
  try {
    const embedding = await getCachedEmbedding(input);
    const hash = createHash("sha256").update(input).digest("hex").slice(0, 16);
    const cacheKey = `${CACHE_CONFIG.PREFIXES.SEMANTIC}${hash}`;
    
    await storeCacheEntry(cacheKey, data, CACHE_CONFIG.TTL.SEMANTIC, embedding, {
      type: "semantic",
      inputLength: input.length,
      ...metadata,
    });
  } catch (error) {
    console.warn("[CACHE] Semantic cache store error:", error);
  }
}

/**
 * Level 3: Partial Context Cache for common patterns
 */
export async function getPartialCache<T>(
  pattern: string,
  context: Record<string, unknown>
): Promise<SemanticCacheResult<T>> {
  const contextHash = createHash("sha256").update(JSON.stringify(context)).digest("hex").slice(0, 8);
  const cacheKey = `${CACHE_CONFIG.PREFIXES.PARTIAL}${pattern}:${contextHash}`;
  
  const entry = await getCacheEntry<T>(cacheKey);
  if (entry) {
    await updateCacheMetrics("hit", "partial");
    return {
      hit: true,
      data: entry.data,
      cacheKey,
      source: "partial",
    };
  }
  
  return { hit: false, source: "miss" };
}

/**
 * Store partial context cache
 */
export async function setPartialCache<T>(
  pattern: string,
  context: Record<string, unknown>,
  data: T
): Promise<void> {
  const contextHash = createHash("sha256").update(JSON.stringify(context)).digest("hex").slice(0, 8);
  const cacheKey = `${CACHE_CONFIG.PREFIXES.PARTIAL}${pattern}:${contextHash}`;
  
  await storeCacheEntry(cacheKey, data, CACHE_CONFIG.TTL.PARTIAL_CONTEXT, undefined, {
    type: "partial",
    pattern,
    contextSize: Object.keys(context).length,
  });
}

/**
 * Hierarchical cache lookup
 */
export async function getHierarchicalCache<T>(
  input: string,
  context?: Record<string, unknown>,
  pattern?: string
): Promise<SemanticCacheResult<T>> {
  // Level 1: Exact match
  const exactResult = await getExactCache<T>(input, context);
  if (exactResult.hit) return exactResult;
  
  // Level 2: Semantic similarity
  const semanticResult = await getSemanticCache<T>(input, CACHE_CONFIG.SIMILARITY.MEDIUM);
  if (semanticResult.hit) return semanticResult;
  
  // Level 3: Partial context (if pattern provided)
  if (pattern && context) {
    const partialResult = await getPartialCache<T>(pattern, context);
    if (partialResult.hit) return partialResult;
  }
  
  return { hit: false, source: "miss" };
}

/**
 * Store in appropriate cache level
 */
export async function setHierarchicalCache<T>(
  input: string,
  data: T,
  context?: Record<string, unknown>,
  pattern?: string
): Promise<void> {
  // Always store in exact and semantic caches
  await Promise.all([
    setExactCache(input, data, context),
    setSemanticCache(input, data, { hasContext: !!context }),
  ]);
  
  // Store in partial cache if pattern provided
  if (pattern && context) {
    await setPartialCache(pattern, context, data);
  }
}

/**
 * Update cache metrics
 */
async function updateCacheMetrics(
  operation: "hit" | "miss" | "store",
  cacheType?: "exact" | "semantic" | "partial",
  similarity?: number
): Promise<void> {
  if (!redis) return;
  
  try {
    const metricsKey = `${CACHE_CONFIG.PREFIXES.METRICS}daily:${new Date().toISOString().slice(0, 10)}`;
    
    const updates: Record<string, number> = {};
    
    if (operation === "hit") {
      updates.totalHits = 1;
      if (cacheType) updates[`${cacheType}Hits`] = 1;
      if (similarity) updates.totalSimilarity = similarity;
    } else if (operation === "miss") {
      updates.totalMisses = 1;
    } else if (operation === "store") {
      updates.totalStores = 1;
    }
    
    // Increment counters
    for (const [field, value] of Object.entries(updates)) {
      await redis.hincrby(metricsKey, field, value);
    }
    
    // Set TTL for metrics (keep for 30 days)
    await redis.expire(metricsKey, 30 * 24 * 60 * 60);
  } catch (error) {
    console.warn("[CACHE] Metrics update error:", error);
  }
}

/**
 * Get cache statistics
 */
export async function getCacheStats(): Promise<CacheStats> {
  if (!redis) {
    return {
      totalHits: 0,
      totalMisses: 0,
      hitRate: 0,
      exactHits: 0,
      semanticHits: 0,
      partialHits: 0,
      averageSimilarity: 0,
      cacheSize: 0,
      oldestEntry: 0,
      newestEntry: 0,
    };
  }
  
  try {
    const today = new Date().toISOString().slice(0, 10);
    const metricsKey = `${CACHE_CONFIG.PREFIXES.METRICS}daily:${today}`;
    
    const metrics = await redis.hgetall(metricsKey);
    
    const totalHits = parseInt(metrics.totalHits as string) || 0;
    const totalMisses = parseInt(metrics.totalMisses as string) || 0;
    const exactHits = parseInt(metrics.exactHits as string) || 0;
    const semanticHits = parseInt(metrics.semanticHits as string) || 0;
    const partialHits = parseInt(metrics.partialHits as string) || 0;
    const totalSimilarity = parseFloat(metrics.totalSimilarity as string) || 0;
    
    const total = totalHits + totalMisses;
    const hitRate = total > 0 ? totalHits / total : 0;
    const averageSimilarity = semanticHits > 0 ? totalSimilarity / semanticHits : 0;
    
    // Get cache size (approximate)
    const allKeys = await redis.keys("cache:*");
    const cacheSize = allKeys.length;
    
    return {
      totalHits,
      totalMisses,
      hitRate,
      exactHits,
      semanticHits,
      partialHits,
      averageSimilarity,
      cacheSize,
      oldestEntry: 0, // Would need more complex tracking
      newestEntry: Date.now(),
    };
  } catch (error) {
    console.warn("[CACHE] Stats error:", error);
    return {
      totalHits: 0,
      totalMisses: 0,
      hitRate: 0,
      exactHits: 0,
      semanticHits: 0,
      partialHits: 0,
      averageSimilarity: 0,
      cacheSize: 0,
      oldestEntry: 0,
      newestEntry: 0,
    };
  }
}

/**
 * Cache cleanup and maintenance
 */
export async function cleanupCache(): Promise<{ deleted: number; errors: number }> {
  if (!redis) return { deleted: 0, errors: 0 };
  
  let deleted = 0;
  let errors = 0;
  
  try {
    // Get all cache keys
    const patterns = [
      `${CACHE_CONFIG.PREFIXES.EXACT}*`,
      `${CACHE_CONFIG.PREFIXES.SEMANTIC}*`,
      `${CACHE_CONFIG.PREFIXES.PARTIAL}*`,
    ];
    
    for (const pattern of patterns) {
      const keys = await redis.keys(pattern);
      
      for (let i = 0; i < keys.length; i += CACHE_CONFIG.CLEANUP_BATCH_SIZE) {
        const batch = keys.slice(i, i + CACHE_CONFIG.CLEANUP_BATCH_SIZE);
        
        for (const key of batch) {
          try {
            const entry = await redis.get(key);
            if (!entry) continue;
            
            const parsed: CacheEntry = JSON.parse(entry as string);
            const age = Date.now() - parsed.timestamp;
            
            // Delete if expired or too old
            if (age > parsed.ttl * 1000) {
              await redis.del(key);
              deleted++;
            }
          } catch (error) {
            console.warn("[CACHE] Cleanup error for key:", key, error);
            errors++;
          }
        }
      }
    }
    
    console.log(`[CACHE] Cleanup completed: ${deleted} deleted, ${errors} errors`);
    return { deleted, errors };
  } catch (error) {
    console.error("[CACHE] Cleanup failed:", error);
    return { deleted, errors: errors + 1 };
  }
}

/**
 * Clear all cache entries (emergency use)
 */
export async function clearAllCache(): Promise<void> {
  if (!redis) return;
  
  try {
    const patterns = [
      `${CACHE_CONFIG.PREFIXES.EXACT}*`,
      `${CACHE_CONFIG.PREFIXES.SEMANTIC}*`,
      `${CACHE_CONFIG.PREFIXES.PARTIAL}*`,
      `${CACHE_CONFIG.PREFIXES.EMBEDDING}*`,
    ];
    
    for (const pattern of patterns) {
      const keys = await redis.keys(pattern);
      if (keys.length > 0) {
        await redis.del(...keys);
      }
    }
    
    console.log("[CACHE] All cache entries cleared");
  } catch (error) {
    console.error("[CACHE] Clear cache failed:", error);
  }
}