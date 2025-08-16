import { NextRequest } from "next/server";
import { cleanupCache, clearAllCache } from "@/lib/caching";
import { warmupPineconeCache, clearPineconeCache } from "@/lib/cachedPinecone";
import { invalidateAgentCache } from "@/lib/agentCache";
import { createSecureResponse } from "@/lib/security";

export const maxDuration = 60; // Cache operations can take time

export async function POST(req: NextRequest) {
  try {
    // Security check - only allow cache management from localhost in development
    const origin = req.headers.get("origin");
    const isLocalhost = origin?.includes("localhost") || origin?.includes("127.0.0.1");
    
    if (process.env.NODE_ENV === "production" || !isLocalhost) {
      return createSecureResponse(
        JSON.stringify({ error: "Cache management only available in development from localhost" }),
        { status: 403 }
      );
    }

    const body = await req.json();
    const { action, target, agentType } = body;

    let result: unknown;

    switch (action) {
      case "cleanup":
        console.log("[CACHE_MANAGE] Starting cache cleanup...");
        result = await cleanupCache();
        console.log("[CACHE_MANAGE] Cleanup completed:", result);
        break;

      case "clear":
        if (target === "all") {
          console.log("[CACHE_MANAGE] Clearing all cache...");
          await clearAllCache();
          result = { message: "All cache cleared" };
        } else if (target === "pinecone") {
          console.log("[CACHE_MANAGE] Clearing Pinecone cache...");
          await clearPineconeCache();
          result = { message: "Pinecone cache cleared" };
        } else if (target === "agent" && agentType) {
          console.log(`[CACHE_MANAGE] Invalidating cache for agent: ${agentType}`);
          await invalidateAgentCache(agentType);
          result = { message: `Agent cache invalidated: ${agentType}` };
        } else {
          return createSecureResponse(
            JSON.stringify({ 
              error: "Invalid clear target",
              available: ["all", "pinecone", "agent"] 
            }),
            { status: 400 }
          );
        }
        break;

      case "warmup":
        if (target === "pinecone") {
          console.log("[CACHE_MANAGE] Starting Pinecone cache warmup...");
          await warmupPineconeCache();
          result = { message: "Pinecone cache warmup completed" };
        } else {
          return createSecureResponse(
            JSON.stringify({ 
              error: "Invalid warmup target",
              available: ["pinecone"] 
            }),
            { status: 400 }
          );
        }
        break;

      default:
        return createSecureResponse(
          JSON.stringify({ 
            error: "Invalid action",
            available: ["cleanup", "clear", "warmup"] 
          }),
          { status: 400 }
        );
    }

    return createSecureResponse(
      JSON.stringify({
        success: true,
        action,
        target,
        result,
        timestamp: Date.now(),
      }),
      { status: 200 }
    );

  } catch (error) {
    console.error("[CACHE_MANAGE] Error:", error);
    
    return createSecureResponse(
      JSON.stringify({ 
        error: "Cache management failed",
        message: error instanceof Error ? error.message : "Unknown error"
      }),
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  // Return available cache management operations
  return createSecureResponse(
    JSON.stringify({
      available_actions: {
        cleanup: {
          description: "Clean up expired cache entries",
          method: "POST",
          body: { action: "cleanup" }
        },
        clear: {
          description: "Clear cache entries",
          method: "POST",
          targets: ["all", "pinecone", "agent"],
          body: { 
            action: "clear", 
            target: "all|pinecone|agent",
            agentType: "required for agent target"
          }
        },
        warmup: {
          description: "Pre-populate cache with common queries",
          method: "POST",
          targets: ["pinecone"],
          body: { action: "warmup", target: "pinecone" }
        }
      },
      note: "Cache management is only available in development from localhost"
    }),
    { status: 200 }
  );
}