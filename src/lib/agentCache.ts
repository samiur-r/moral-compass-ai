import { 
  getHierarchicalCache, 
  setHierarchicalCache, 
  SemanticCacheResult,
  CACHE_CONFIG 
} from "./caching";
import { estimateRequestCost } from "./costTracking";

// Agent-specific cache utilities
export interface AgentCacheKey {
  decision: string;
  agentType: string;
  context?: {
    industry?: string;
    urgency?: "low" | "medium" | "high";
    companySize?: "startup" | "small" | "medium" | "large";
    geography?: string;
  };
}

export interface CachedAgentResponse {
  response: string;
  agentType: string;
  timestamp: number;
  costSaved: number;
  confidence: number;
  metadata: {
    tokenCount: number;
    processingTime: number;
    cacheSource: "exact" | "semantic" | "partial";
  };
}

/**
 * Generate cache pattern for agent responses
 */
function generateAgentPattern(agentType: string, context?: AgentCacheKey["context"]): string {
  const parts = [agentType];
  
  if (context?.industry) parts.push(`industry:${context.industry}`);
  if (context?.urgency) parts.push(`urgency:${context.urgency}`);
  if (context?.companySize) parts.push(`size:${context.companySize}`);
  if (context?.geography) parts.push(`geo:${context.geography}`);
  
  return parts.join("|");
}

/**
 * Get cached agent response
 */
export async function getCachedAgentResponse(
  cacheKey: AgentCacheKey
): Promise<SemanticCacheResult<CachedAgentResponse>> {
  const pattern = generateAgentPattern(cacheKey.agentType, cacheKey.context);
  
  const result = await getHierarchicalCache<CachedAgentResponse>(
    cacheKey.decision,
    {
      agentType: cacheKey.agentType,
      ...cacheKey.context,
    },
    pattern
  );
  
  // If we have a cache hit, log the cost savings
  if (result.hit && result.data) {
    console.log(`[CACHE] Agent cache hit for ${cacheKey.agentType}`, {
      source: result.source,
      similarity: result.similarity,
      costSaved: result.data.costSaved,
    });
  }
  
  return result;
}

/**
 * Store agent response in cache
 */
export async function setCachedAgentResponse(
  cacheKey: AgentCacheKey,
  response: string,
  processingTime: number
): Promise<void> {
  // Estimate the cost that would have been incurred
  const costEstimate = estimateRequestCost(cacheKey.decision, 1, false);
  
  const cachedResponse: CachedAgentResponse = {
    response,
    agentType: cacheKey.agentType,
    timestamp: Date.now(),
    costSaved: costEstimate.total,
    confidence: 0.9, // High confidence for direct responses
    metadata: {
      tokenCount: Math.ceil(response.length / 4), // Rough token estimate
      processingTime,
      cacheSource: "exact", // Will be updated when retrieved from cache
    },
  };
  
  const pattern = generateAgentPattern(cacheKey.agentType, cacheKey.context);
  
  await setHierarchicalCache(
    cacheKey.decision,
    cachedResponse,
    {
      agentType: cacheKey.agentType,
      ...cacheKey.context,
    },
    pattern
  );
  
  console.log(`[CACHE] Stored agent response for ${cacheKey.agentType}`, {
    responseLength: response.length,
    processingTime,
    estimatedCost: costEstimate.total,
  });
}

/**
 * Get multiple agent responses from cache
 */
export async function getCachedAgentResponses(
  decision: string,
  agentTypes: string[],
  context?: AgentCacheKey["context"]
): Promise<Map<string, CachedAgentResponse>> {
  const results = new Map<string, CachedAgentResponse>();
  
  await Promise.all(
    agentTypes.map(async (agentType) => {
      const cacheResult = await getCachedAgentResponse({
        decision,
        agentType,
        context,
      });
      
      if (cacheResult.hit && cacheResult.data) {
        // Update metadata with actual cache source
        cacheResult.data.metadata.cacheSource = cacheResult.source;
        results.set(agentType, cacheResult.data);
      }
    })
  );
  
  return results;
}

/**
 * Agent-specific cache configuration
 */
export const AGENT_CACHE_CONFIG = {
  // TTL overrides for different agent types
  TTL_OVERRIDES: {
    law: 7 * 24 * 60 * 60,         // 7 days (legal frameworks change slowly)
    environment: 30 * 24 * 60 * 60, // 30 days (environmental standards are stable)
    economist: 3 * 24 * 60 * 60,    // 3 days (economic conditions change)
    prAndReputation: 1 * 24 * 60 * 60, // 1 day (reputation is context-sensitive)
    dei: 14 * 24 * 60 * 60,        // 14 days (DEI principles are relatively stable)
    publicHealth: 2 * 24 * 60 * 60, // 2 days (health guidelines can change)
    aiRisk: 7 * 24 * 60 * 60,      // 7 days (AI regulations evolving)
  },
  
  // Similarity thresholds by agent type
  SIMILARITY_THRESHOLDS: {
    law: 0.9,           // High precision for legal advice
    environment: 0.85,  // High precision for environmental impact
    economist: 0.8,     // Moderate precision for economic analysis
    prAndReputation: 0.75, // Lower precision for PR (more contextual)
    dei: 0.9,          // High precision for DEI considerations
    publicHealth: 0.85, // High precision for health advice
    aiRisk: 0.9,       // High precision for AI risk assessment
  },
  
  // Cache priority (higher = more important to cache)
  CACHE_PRIORITY: {
    law: 10,           // Highest priority (expensive and stable)
    environment: 9,    // Very high priority
    aiRisk: 8,         // High priority (uses RAG)
    economist: 7,      // High priority
    dei: 6,           // Medium-high priority
    publicHealth: 5,   // Medium priority
    prAndReputation: 4, // Lower priority (context-dependent)
  },
} as const;

/**
 * Get agent-specific cache configuration
 */
export function getAgentCacheConfig(agentType: string) {
  return {
    ttl: AGENT_CACHE_CONFIG.TTL_OVERRIDES[agentType as keyof typeof AGENT_CACHE_CONFIG.TTL_OVERRIDES] 
      || CACHE_CONFIG.TTL.SEMANTIC,
    threshold: AGENT_CACHE_CONFIG.SIMILARITY_THRESHOLDS[agentType as keyof typeof AGENT_CACHE_CONFIG.SIMILARITY_THRESHOLDS] 
      || CACHE_CONFIG.SIMILARITY.MEDIUM,
    priority: AGENT_CACHE_CONFIG.CACHE_PRIORITY[agentType as keyof typeof AGENT_CACHE_CONFIG.CACHE_PRIORITY] 
      || 5,
  };
}

/**
 * Invalidate cache for specific agent type
 */
export async function invalidateAgentCache(agentType: string): Promise<void> {
  // This would require a more sophisticated implementation
  // For now, we'll just log the invalidation request
  console.log(`[CACHE] Invalidation requested for agent: ${agentType}`);
  
  // In a full implementation, you would:
  // 1. Find all cache keys containing this agent type
  // 2. Delete them from Redis
  // 3. Update cache metrics
}

/**
 * Warm up cache with common scenarios
 */
export async function warmupAgentCache(commonScenarios: AgentCacheKey[]): Promise<void> {
  console.log(`[CACHE] Warming up cache with ${commonScenarios.length} scenarios`);
  
  for (const scenario of commonScenarios) {
    try {
      // Check if already cached
      const cached = await getCachedAgentResponse(scenario);
      if (!cached.hit) {
        console.log(`[CACHE] Scenario not cached, would need to generate: ${scenario.agentType}`);
        // In practice, you would generate and cache the response here
      }
    } catch (error) {
      console.warn(`[CACHE] Warmup error for ${scenario.agentType}:`, error);
    }
  }
}

/**
 * Calculate cache effectiveness for agents
 */
export interface AgentCacheStats {
  agentType: string;
  hitRate: number;
  averageCostSaved: number;
  totalCostSaved: number;
  averageResponseTime: number;
  cacheSize: number;
}

export async function getAgentCacheStats(): Promise<AgentCacheStats[]> {
  // This would require more sophisticated metrics tracking
  // For now, return a placeholder implementation
  
  const agentTypes = ['law', 'environment', 'economist', 'prAndReputation', 'dei', 'publicHealth', 'aiRisk'];
  
  return agentTypes.map(agentType => ({
    agentType,
    hitRate: 0.0, // Would be calculated from actual metrics
    averageCostSaved: 0.0,
    totalCostSaved: 0.0,
    averageResponseTime: 0,
    cacheSize: 0,
  }));
}