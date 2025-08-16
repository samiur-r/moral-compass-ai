import { embed } from "ai";
import { openai } from "@ai-sdk/openai";
import { Pinecone } from "@pinecone-database/pinecone";
import { getExactCache, setExactCache, CACHE_CONFIG } from "./caching";
import { queueVectorOperation } from "./requestQueue";
import { createHash } from "crypto";

const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY! });
const index = pc
  .index(process.env.PINECONE_INDEX || "moral-compass-ai")
  .namespace("__default__");

type DocMetadata = {
  text: string;
  url?: string;
  doc_id?: string;
  domain?: string;
};

export interface EvidenceResult {
  id: string;
  text: string;
  source?: string;
  score?: number;
}

export interface CachedPineconeResult {
  results: EvidenceResult[];
  cached: boolean;
  cacheKey?: string;
  queryTime: number;
  source: "cache" | "pinecone";
}

/**
 * Generate cache key for Pinecone queries
 */
function generatePineconeKey(query: string, topK: number, domain?: string): string {
  const keyData = `${query}:${topK}:${domain || "default"}`;
  return `${CACHE_CONFIG.PREFIXES.PINECONE}${createHash("sha256").update(keyData).digest("hex")}`;
}

/**
 * Enhanced retrieveEvidence with caching and queue management
 */
export async function retrieveEvidence(
  query: string, 
  topK = 5, 
  domain = "aiRisk",
  clientId?: string
): Promise<CachedPineconeResult> {
  const startTime = Date.now();
  
  // Generate cache key
  const cacheKey = generatePineconeKey(query, topK, domain);
  
  // Try cache first
  const cached = await getExactCache<EvidenceResult[]>(query, { topK, domain });
  
  if (cached.hit && cached.data) {
    console.log(`[PINECONE] Cache hit for query: ${query.slice(0, 50)}...`);
    return {
      results: cached.data,
      cached: true,
      cacheKey,
      queryTime: Date.now() - startTime,
      source: "cache",
    };
  }
  
  // Queue the Pinecone operation to prevent overload
  const queueResult = await queueVectorOperation(async () => {
    console.log(`[PINECONE] Cache miss, querying Pinecone: ${query.slice(0, 50)}...`);
    
    // Generate embedding
    const embeddingStart = Date.now();
    const { embedding } = await embed({
      model: openai.embedding("text-embedding-3-small"),
      value: query,
    });
    console.log(`[PINECONE] Embedding generated in ${Date.now() - embeddingStart}ms`);
    
    // Query Pinecone
    const queryStart = Date.now();
    const res = await index.query({
      vector: embedding,
      topK,
      includeMetadata: true,
      filter: { domain },
    });
    console.log(`[PINECONE] Query completed in ${Date.now() - queryStart}ms`);
    
    // Process results
    const results: EvidenceResult[] = (res.matches ?? []).map((m, i) => {
      const md = (m.metadata ?? {}) as Partial<DocMetadata>;
      return {
        id: `[#${i + 1}]`,
        text: md.text as string,
        source: md.url || md.doc_id,
        score: m.score,
      };
    });
    
    return results;
  }, clientId);
  
  if (!queueResult.success) {
    throw new Error(`Pinecone query failed: ${queueResult.error}`);
  }
  
  const results = queueResult.data!;
  
  // Cache the results
  await setExactCache(query, results, { topK, domain });
  
  const totalTime = Date.now() - startTime;
  console.log(`[PINECONE] Query completed and cached in ${totalTime}ms`);
  
  return {
    results,
    cached: false,
    cacheKey,
    queryTime: totalTime,
    source: "pinecone",
  };
}

/**
 * Batch retrieve evidence for multiple queries
 */
export async function batchRetrieveEvidence(
  queries: string[],
  topK = 5,
  domain = "aiRisk",
  clientId?: string
): Promise<Map<string, CachedPineconeResult>> {
  const results = new Map<string, CachedPineconeResult>();
  
  // Process queries in parallel but with queue management
  const promises = queries.map(async (query) => {
    try {
      const result = await retrieveEvidence(query, topK, domain, clientId);
      results.set(query, result);
    } catch (error) {
      console.error(`[PINECONE] Batch query failed for: ${query}`, error);
      // Return empty result for failed queries
      results.set(query, {
        results: [],
        cached: false,
        queryTime: 0,
        source: "pinecone",
      });
    }
  });
  
  await Promise.all(promises);
  return results;
}

/**
 * Smart query optimization - combines similar queries
 */
export async function optimizedRetrieveEvidence(
  query: string,
  topK = 5,
  domain = "aiRisk",
  clientId?: string
): Promise<CachedPineconeResult> {
  // First, try to find semantically similar cached queries
  const variations = generateQueryVariations(query);
  
  for (const variation of variations) {
    const cached = await getExactCache<EvidenceResult[]>(variation, { topK, domain });
    if (cached.hit && cached.data) {
      console.log(`[PINECONE] Found similar cached query: ${variation.slice(0, 50)}...`);
      return {
        results: cached.data,
        cached: true,
        queryTime: 0,
        source: "cache",
      };
    }
  }
  
  // If no similar queries found, proceed with normal retrieval
  return retrieveEvidence(query, topK, domain, clientId);
}

/**
 * Generate query variations for better cache hits
 */
function generateQueryVariations(query: string): string[] {
  const variations: string[] = [];
  
  // Normalize the query
  const normalized = query.toLowerCase().trim();
  variations.push(normalized);
  
  // Remove common stop words
  const stopWords = ['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by'];
  const withoutStopWords = normalized
    .split(' ')
    .filter(word => !stopWords.includes(word))
    .join(' ');
  variations.push(withoutStopWords);
  
  // Extract key terms (simple keyword extraction)
  const keyTerms = extractKeyTerms(normalized);
  if (keyTerms.length > 0) {
    variations.push(keyTerms.join(' '));
  }
  
  return [...new Set(variations)]; // Remove duplicates
}

/**
 * Simple keyword extraction
 */
function extractKeyTerms(text: string): string[] {
  // Simple implementation - in practice, you might use NLP libraries
  const words = text.split(' ').filter(word => word.length > 3);
  
  // Score words by frequency and position
  const wordScores = new Map<string, number>();
  words.forEach((word, index) => {
    const positionScore = 1 / (index + 1); // Earlier words get higher scores
    const lengthScore = word.length / 10; // Longer words get higher scores
    wordScores.set(word, (wordScores.get(word) || 0) + positionScore + lengthScore);
  });
  
  // Return top-scored words
  return Array.from(wordScores.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([word]) => word);
}

/**
 * Preload common queries into cache
 */
export async function preloadEvidenceCache(
  commonQueries: { query: string; topK?: number; domain?: string }[],
  clientId?: string
): Promise<void> {
  console.log(`[PINECONE] Preloading ${commonQueries.length} common queries into cache`);
  
  for (const { query, topK = 5, domain = "aiRisk" } of commonQueries) {
    try {
      // Check if already cached
      const cached = await getExactCache<EvidenceResult[]>(query, { topK, domain });
      if (!cached.hit) {
        // Retrieve and cache
        await retrieveEvidence(query, topK, domain, clientId);
        console.log(`[PINECONE] Preloaded: ${query.slice(0, 50)}...`);
      } else {
        console.log(`[PINECONE] Already cached: ${query.slice(0, 50)}...`);
      }
    } catch (error) {
      console.warn(`[PINECONE] Preload failed for: ${query}`, error);
    }
  }
  
  console.log(`[PINECONE] Preload completed`);
}

/**
 * Get Pinecone cache statistics
 */
export interface PineconeCacheStats {
  totalQueries: number;
  cacheHits: number;
  cacheMisses: number;
  hitRate: number;
  averageQueryTime: number;
  averageCacheTime: number;
  totalCostSaved: number;
}

export async function getPineconeCacheStats(): Promise<PineconeCacheStats> {
  // This would require implementing detailed metrics tracking
  // For now, return placeholder values
  
  return {
    totalQueries: 0,
    cacheHits: 0,
    cacheMisses: 0,
    hitRate: 0,
    averageQueryTime: 0,
    averageCacheTime: 0,
    totalCostSaved: 0,
  };
}

/**
 * Common AI risk queries for cache warming
 */
export const COMMON_AI_RISK_QUERIES = [
  "GDPR compliance for AI systems",
  "EU AI Act requirements",
  "algorithmic bias detection",
  "AI transparency requirements",
  "automated decision making regulations",
  "machine learning fairness",
  "AI risk assessment framework",
  "ethical AI guidelines",
  "AI accountability measures",
  "data protection in AI",
  "AI governance principles",
  "responsible AI development",
  "AI safety standards",
  "AI explainability requirements",
  "AI audit procedures",
].map(query => ({ query, topK: 5, domain: "aiRisk" }));

/**
 * Warm up Pinecone cache with common queries
 */
export async function warmupPineconeCache(clientId?: string): Promise<void> {
  await preloadEvidenceCache(COMMON_AI_RISK_QUERIES, clientId);
}

/**
 * Clear Pinecone cache
 */
export async function clearPineconeCache(): Promise<void> {
  // This would require implementing cache key pattern matching
  console.log("[PINECONE] Cache clear requested - would clear all Pinecone cache entries");
  
  // In practice, you would:
  // 1. Get all keys matching CACHE_CONFIG.PREFIXES.PINECONE pattern
  // 2. Delete them from Redis
  // 3. Update metrics
}