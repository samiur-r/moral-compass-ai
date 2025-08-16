import { NextRequest } from "next/server";
import { 
  getComprehensiveCacheMetrics,
  analyzeCacheHealth,
  generateCacheReport,
  getCacheDashboard,
  getCacheOptimizationSuggestions,
  exportCacheData,
} from "@/lib/cacheMonitoring";
import { createSecureResponse } from "@/lib/security";

export const maxDuration = 30; // Cache stats can take a bit of time

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const format = searchParams.get("format") || "json";
    const type = searchParams.get("type") || "metrics";

    // Basic security check - in production you might want auth
    const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(",") || [];
    const origin = req.headers.get("origin");
    
    if (process.env.NODE_ENV === "production" && origin && !allowedOrigins.includes(origin)) {
      return createSecureResponse(
        JSON.stringify({ error: "Access denied" }),
        { status: 403 }
      );
    }

    let data: unknown;
    let contentType = "application/json";

    switch (type) {
      case "metrics":
        data = await getComprehensiveCacheMetrics();
        break;
        
      case "health":
        data = await analyzeCacheHealth();
        break;
        
      case "dashboard":
        data = await getCacheDashboard();
        break;
        
      case "suggestions":
        data = {
          suggestions: await getCacheOptimizationSuggestions(),
          timestamp: Date.now(),
        };
        break;
        
      case "export":
        data = await exportCacheData();
        break;
        
      case "report":
        if (format === "text") {
          data = await generateCacheReport();
          contentType = "text/plain";
        } else {
          data = {
            report: await generateCacheReport(),
            timestamp: Date.now(),
          };
        }
        break;
        
      default:
        return createSecureResponse(
          JSON.stringify({ 
            error: "Invalid type parameter",
            available: ["metrics", "health", "dashboard", "suggestions", "export", "report"] 
          }),
          { status: 400 }
        );
    }

    const responseBody = contentType === "application/json" 
      ? JSON.stringify(data, null, 2)
      : String(data);

    return createSecureResponse(
      responseBody,
      { 
        status: 200,
        headers: {
          "Content-Type": contentType,
          "Cache-Control": "no-cache, no-store, must-revalidate",
        }
      }
    );

  } catch (error) {
    console.error("[CACHE_API] Error:", error);
    
    return createSecureResponse(
      JSON.stringify({ 
        error: "Internal server error",
        message: error instanceof Error ? error.message : "Unknown error"
      }),
      { status: 500 }
    );
  }
}