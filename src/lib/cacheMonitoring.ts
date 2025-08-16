import { getCacheStats } from "./caching";
import { getAgentCacheStats } from "./agentCache";
import { getPineconeCacheStats } from "./cachedPinecone";

// Comprehensive cache monitoring and metrics
export interface CacheMetrics {
  overall: {
    hitRate: number;
    totalRequests: number;
    totalHits: number;
    totalMisses: number;
    costSavings: number;
    averageResponseTime: number;
  };
  byType: {
    exact: {
      hits: number;
      hitRate: number;
    };
    semantic: {
      hits: number;
      hitRate: number;
      averageSimilarity: number;
    };
    partial: {
      hits: number;
      hitRate: number;
    };
  };
  agents: {
    [agentType: string]: {
      hitRate: number;
      costSaved: number;
      averageResponseTime: number;
      cacheSize: number;
    };
  };
  pinecone: {
    hitRate: number;
    averageQueryTime: number;
    costSaved: number;
    totalQueries: number;
  };
  performance: {
    cacheSize: number;
    oldestEntry: number;
    newestEntry: number;
    memoryUsage?: number;
  };
  trends: {
    hourly: CacheTrendPoint[];
    daily: CacheTrendPoint[];
  };
}

export interface CacheTrendPoint {
  timestamp: number;
  hitRate: number;
  requests: number;
  costSavings: number;
}

export interface CacheHealth {
  status: "healthy" | "warning" | "critical";
  issues: string[];
  recommendations: string[];
  score: number; // 0-100
}

/**
 * Get comprehensive cache metrics
 */
export async function getComprehensiveCacheMetrics(): Promise<CacheMetrics> {
  try {
    const [generalStats, agentStats, pineconeStats] = await Promise.all([
      getCacheStats(),
      getAgentCacheStats(),
      getPineconeCacheStats(),
    ]);

    // Calculate overall metrics
    const totalRequests = generalStats.totalHits + generalStats.totalMisses;
    const overallHitRate = totalRequests > 0 ? generalStats.totalHits / totalRequests : 0;

    // Process agent statistics
    const agentMetrics: CacheMetrics["agents"] = {};
    for (const agent of agentStats) {
      agentMetrics[agent.agentType] = {
        hitRate: agent.hitRate,
        costSaved: agent.totalCostSaved,
        averageResponseTime: agent.averageResponseTime,
        cacheSize: agent.cacheSize,
      };
    }

    // Calculate total cost savings
    const totalCostSavings = agentStats.reduce((sum, agent) => sum + agent.totalCostSaved, 0) + 
                            pineconeStats.totalCostSaved;

    return {
      overall: {
        hitRate: overallHitRate,
        totalRequests,
        totalHits: generalStats.totalHits,
        totalMisses: generalStats.totalMisses,
        costSavings: totalCostSavings,
        averageResponseTime: 0, // Would need to implement tracking
      },
      byType: {
        exact: {
          hits: generalStats.exactHits,
          hitRate: generalStats.totalHits > 0 ? generalStats.exactHits / generalStats.totalHits : 0,
        },
        semantic: {
          hits: generalStats.semanticHits,
          hitRate: generalStats.totalHits > 0 ? generalStats.semanticHits / generalStats.totalHits : 0,
          averageSimilarity: generalStats.averageSimilarity,
        },
        partial: {
          hits: generalStats.partialHits,
          hitRate: generalStats.totalHits > 0 ? generalStats.partialHits / generalStats.totalHits : 0,
        },
      },
      agents: agentMetrics,
      pinecone: {
        hitRate: pineconeStats.hitRate,
        averageQueryTime: pineconeStats.averageQueryTime,
        costSaved: pineconeStats.totalCostSaved,
        totalQueries: pineconeStats.totalQueries,
      },
      performance: {
        cacheSize: generalStats.cacheSize,
        oldestEntry: generalStats.oldestEntry,
        newestEntry: generalStats.newestEntry,
      },
      trends: {
        hourly: [], // Would need historical data
        daily: [],  // Would need historical data
      },
    };
  } catch (error) {
    console.error("[CACHE_MONITORING] Error getting metrics:", error);
    // Return empty metrics on error
    return {
      overall: { hitRate: 0, totalRequests: 0, totalHits: 0, totalMisses: 0, costSavings: 0, averageResponseTime: 0 },
      byType: { 
        exact: { hits: 0, hitRate: 0 },
        semantic: { hits: 0, hitRate: 0, averageSimilarity: 0 },
        partial: { hits: 0, hitRate: 0 }
      },
      agents: {},
      pinecone: { hitRate: 0, averageQueryTime: 0, costSaved: 0, totalQueries: 0 },
      performance: { cacheSize: 0, oldestEntry: 0, newestEntry: 0 },
      trends: { hourly: [], daily: [] },
    };
  }
}

/**
 * Analyze cache health and provide recommendations
 */
export async function analyzeCacheHealth(): Promise<CacheHealth> {
  const metrics = await getComprehensiveCacheMetrics();
  const issues: string[] = [];
  const recommendations: string[] = [];
  let score = 100;

  // Check hit rates
  if (metrics.overall.hitRate < 0.3) {
    issues.push("Low overall cache hit rate");
    recommendations.push("Review cache configuration and TTL settings");
    score -= 20;
  } else if (metrics.overall.hitRate < 0.5) {
    issues.push("Moderate cache hit rate");
    recommendations.push("Consider cache warming for common scenarios");
    score -= 10;
  }

  // Check Pinecone performance
  if (metrics.pinecone.hitRate < 0.4) {
    issues.push("Low Pinecone cache hit rate");
    recommendations.push("Implement query optimization and cache warming");
    score -= 15;
  }

  // Check agent performance
  const lowPerformingAgents = Object.entries(metrics.agents)
    .filter(([, stats]) => stats.hitRate < 0.4)
    .map(([agent]) => agent);

  if (lowPerformingAgents.length > 0) {
    issues.push(`Low cache performance for agents: ${lowPerformingAgents.join(", ")}`);
    recommendations.push("Review similarity thresholds and cache TTL for underperforming agents");
    score -= 10;
  }

  // Check cache size
  if (metrics.performance.cacheSize > 50000) {
    issues.push("Large cache size may impact performance");
    recommendations.push("Consider implementing cache cleanup policies");
    score -= 5;
  }

  // Check semantic similarity
  if (metrics.byType.semantic.averageSimilarity < 0.8) {
    issues.push("Low semantic similarity in cache hits");
    recommendations.push("Review similarity thresholds for semantic caching");
    score -= 5;
  }

  // Determine overall status
  let status: CacheHealth["status"] = "healthy";
  if (score < 70) {
    status = "critical";
  } else if (score < 85) {
    status = "warning";
  }

  return {
    status,
    issues,
    recommendations,
    score: Math.max(0, score),
  };
}

/**
 * Generate cache performance report
 */
export async function generateCacheReport(): Promise<string> {
  const [metrics, health] = await Promise.all([
    getComprehensiveCacheMetrics(),
    analyzeCacheHealth(),
  ]);

  const report = `
CACHE PERFORMANCE REPORT
========================

Overall Performance:
- Hit Rate: ${(metrics.overall.hitRate * 100).toFixed(1)}%
- Total Requests: ${metrics.overall.totalRequests.toLocaleString()}
- Cost Savings: $${metrics.overall.costSavings.toFixed(2)}

Cache Types:
- Exact Match: ${metrics.byType.exact.hits} hits (${(metrics.byType.exact.hitRate * 100).toFixed(1)}%)
- Semantic: ${metrics.byType.semantic.hits} hits (${(metrics.byType.semantic.hitRate * 100).toFixed(1)}%, avg similarity: ${(metrics.byType.semantic.averageSimilarity * 100).toFixed(1)}%)
- Partial Context: ${metrics.byType.partial.hits} hits (${(metrics.byType.partial.hitRate * 100).toFixed(1)}%)

Agent Performance:
${Object.entries(metrics.agents).map(([agent, stats]) => 
  `- ${agent}: ${(stats.hitRate * 100).toFixed(1)}% hit rate, $${stats.costSaved.toFixed(2)} saved`
).join('\n')}

Pinecone Performance:
- Hit Rate: ${(metrics.pinecone.hitRate * 100).toFixed(1)}%
- Average Query Time: ${metrics.pinecone.averageQueryTime}ms
- Cost Saved: $${metrics.pinecone.costSaved.toFixed(2)}

System Health: ${health.status.toUpperCase()} (Score: ${health.score}/100)

${health.issues.length > 0 ? `Issues:\n${health.issues.map(issue => `- ${issue}`).join('\n')}\n` : ''}
${health.recommendations.length > 0 ? `Recommendations:\n${health.recommendations.map(rec => `- ${rec}`).join('\n')}` : ''}
  `.trim();

  return report;
}

/**
 * Real-time cache monitoring dashboard data
 */
export interface CacheDashboard {
  currentMetrics: CacheMetrics;
  health: CacheHealth;
  realTimeStats: {
    requestsPerMinute: number;
    hitRateLastHour: number;
    averageResponseTime: number;
    activeConnections: number;
  };
  alerts: Array<{
    level: "info" | "warning" | "critical";
    message: string;
    timestamp: number;
  }>;
}

/**
 * Get real-time cache dashboard data
 */
export async function getCacheDashboard(): Promise<CacheDashboard> {
  const [metrics, health] = await Promise.all([
    getComprehensiveCacheMetrics(),
    analyzeCacheHealth(),
  ]);

  // Generate alerts based on health issues
  const alerts = health.issues.map(issue => ({
    level: health.status === "critical" ? "critical" as const : "warning" as const,
    message: issue,
    timestamp: Date.now(),
  }));

  // Add info alerts for good performance
  if (metrics.overall.hitRate > 0.8) {
    alerts.push({
      level: "info",
      message: `Excellent cache performance: ${(metrics.overall.hitRate * 100).toFixed(1)}% hit rate`,
      timestamp: Date.now(),
    });
  }

  if (metrics.overall.costSavings > 1.0) {
    alerts.push({
      level: "info",
      message: `Significant cost savings: $${metrics.overall.costSavings.toFixed(2)}`,
      timestamp: Date.now(),
    });
  }

  return {
    currentMetrics: metrics,
    health,
    realTimeStats: {
      requestsPerMinute: 0, // Would need real-time tracking
      hitRateLastHour: metrics.overall.hitRate,
      averageResponseTime: metrics.overall.averageResponseTime,
      activeConnections: 0, // Would need connection tracking
    },
    alerts,
  };
}

/**
 * Cache optimization suggestions
 */
export async function getCacheOptimizationSuggestions(): Promise<string[]> {
  const metrics = await getComprehensiveCacheMetrics();
  const suggestions: string[] = [];

  // Hit rate optimizations
  if (metrics.overall.hitRate < 0.5) {
    suggestions.push("Implement cache warming for common decision patterns");
    suggestions.push("Increase TTL values for stable content types (legal, environmental)");
    suggestions.push("Lower similarity thresholds for semantic caching");
  }

  // Agent-specific optimizations
  const underperformingAgents = Object.entries(metrics.agents)
    .filter(([, stats]) => stats.hitRate < 0.4);

  if (underperformingAgents.length > 0) {
    suggestions.push(`Focus cache optimization on: ${underperformingAgents.map(([agent]) => agent).join(", ")}`);
    suggestions.push("Review and adjust agent-specific similarity thresholds");
  }

  // Pinecone optimizations
  if (metrics.pinecone.hitRate < 0.6) {
    suggestions.push("Implement Pinecone query optimization");
    suggestions.push("Pre-cache common AI risk queries");
    suggestions.push("Increase Pinecone cache TTL for stable regulatory content");
  }

  // Performance optimizations
  if (metrics.performance.cacheSize > 20000) {
    suggestions.push("Implement automated cache cleanup");
    suggestions.push("Consider cache size limits with LRU eviction");
  }

  // Cost optimization
  if (metrics.overall.costSavings < 0.1) {
    suggestions.push("Focus on caching expensive operations (AI risk, legal analysis)");
    suggestions.push("Implement batch processing for similar queries");
  }

  return suggestions;
}

/**
 * Export cache data for analysis
 */
export async function exportCacheData(): Promise<{
  metrics: CacheMetrics;
  health: CacheHealth;
  timestamp: number;
  version: string;
}> {
  const [metrics, health] = await Promise.all([
    getComprehensiveCacheMetrics(),
    analyzeCacheHealth(),
  ]);

  return {
    metrics,
    health,
    timestamp: Date.now(),
    version: "1.0.0",
  };
}