import { validateRequest, logSecurityEvent, ValidationResult } from "./validation";
import { getEnhancedClientId, checkMultiTierLimits, MultiTierLimitResult } from "./rateLimit";
import { estimateRequestCost, checkCostLimits, CostLimitResult } from "./costTracking";
import { areQueuesOverloaded, getQueueStats } from "./requestQueue";
import { extractUserText } from "./safety";

/**
 * Security check result
 */
export interface SecurityCheckResult {
  allowed: boolean;
  reason?: string;
  clientId: string;
  validationResult: ValidationResult;
  rateLimitResult: MultiTierLimitResult;
  costLimitResult: CostLimitResult;
  queueStatus: ReturnType<typeof getQueueStats>;
  headers: Headers;
}

/**
 * CSRF/Origin validation
 */
function validateOrigin(req: Request): { valid: boolean; reason?: string } {
  // Skip origin validation for development
  if (process.env.NODE_ENV === "development") {
    return { valid: true };
  }
  
  const origin = req.headers.get("origin");
  const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(",") || [];
  
  // If no origins configured, allow all (but log warning)
  if (allowedOrigins.length === 0 || allowedOrigins[0] === "") {
    console.warn("[SECURITY] No ALLOWED_ORIGINS configured - allowing all origins");
    return { valid: true };
  }
  
  if (!origin) {
    return { valid: false, reason: "Missing origin header" };
  }
  
  if (!allowedOrigins.includes(origin)) {
    return { valid: false, reason: `Origin ${origin} not allowed` };
  }
  
  return { valid: true };
}

/**
 * Check for suspicious user agents or automated traffic
 */
function validateUserAgent(req: Request): { valid: boolean; reason?: string } {
  const ua = req.headers.get("user-agent") || "";
  
  // Block obviously suspicious user agents
  const suspiciousPatterns = [
    /bot/i,
    /crawler/i,
    /scraper/i,
    /spider/i,
    /curl/i,
    /wget/i,
    /python-requests/i,
    /headless/i,
  ];
  
  // Allow legitimate bots and crawlers if needed
  const allowedBots = process.env.ALLOWED_BOTS?.split(",") || [];
  
  for (const pattern of suspiciousPatterns) {
    if (pattern.test(ua)) {
      // Check if it's in allowed list
      const isAllowed = allowedBots.some(allowed => ua.toLowerCase().includes(allowed.toLowerCase()));
      if (!isAllowed) {
        return { valid: false, reason: "Automated traffic not allowed" };
      }
    }
  }
  
  // Require reasonable user agent length
  if (ua.length < 10 || ua.length > 500) {
    return { valid: false, reason: "Invalid user agent" };
  }
  
  return { valid: true };
}

/**
 * Generate security headers
 */
function generateSecurityHeaders(): Headers {
  const headers = new Headers();
  
  // Prevent XSS
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("X-XSS-Protection", "1; mode=block");
  
  // CSP for API endpoints
  headers.set(
    "Content-Security-Policy",
    "default-src 'none'; frame-ancestors 'none';"
  );
  
  // HSTS if in production
  if (process.env.NODE_ENV === "production") {
    headers.set(
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains"
    );
  }
  
  // Prevent referrer leakage
  headers.set("Referrer-Policy", "no-referrer");
  
  // Server identification
  headers.set("Server", "Moral Compass AI");
  
  return headers;
}

/**
 * Extract request metadata for logging
 */
function extractRequestMetadata(req: Request) {
  return {
    method: req.method,
    url: req.url,
    userAgent: req.headers.get("user-agent"),
    origin: req.headers.get("origin"),
    referer: req.headers.get("referer"),
    contentLength: req.headers.get("content-length"),
    contentType: req.headers.get("content-type"),
    timestamp: new Date().toISOString(),
  };
}

/**
 * Log security events with context
 */
function logSecurityEventWithContext(
  type: "blocked" | "allowed" | "suspicious",
  reason: string,
  clientId: string,
  req: Request,
  additionalData?: Record<string, unknown>
) {
  const metadata = extractRequestMetadata(req);
  
  console.log(`[SECURITY] ${type.toUpperCase()}: ${reason}`, {
    clientId,
    ...metadata,
    ...additionalData,
  });
  
  // In production, you might want to send to a SIEM or security monitoring service
  if (process.env.NODE_ENV === "production" && type === "blocked") {
    // await sendToSecurityMonitoring({ type, reason, clientId, metadata, additionalData });
  }
}

/**
 * Comprehensive security check for incoming requests
 */
export async function performSecurityCheck(req: Request): Promise<SecurityCheckResult> {
  const clientId = getEnhancedClientId(req);
  const securityHeaders = generateSecurityHeaders();
  
  try {
    // 1. Basic request validation
    const originCheck = validateOrigin(req);
    if (!originCheck.valid) {
      logSecurityEventWithContext("blocked", `Origin validation failed: ${originCheck.reason}`, clientId, req);
      return {
        allowed: false,
        reason: "Request origin not allowed",
        clientId,
        validationResult: { isValid: false, error: originCheck.reason },
        rateLimitResult: { success: false, limit: 0, remaining: 0, reset: 0, tier: "basic" },
        costLimitResult: { allowed: false, estimatedCost: 0, currentUsage: { daily: 0, hourly: 0, monthly: 0 }, limits: { daily: 0, hourly: 0, monthly: 0 } },
        queueStatus: getQueueStats(),
        headers: securityHeaders,
      };
    }
    
    // 2. User agent validation
    const uaCheck = validateUserAgent(req);
    if (!uaCheck.valid) {
      logSecurityEventWithContext("blocked", `User agent validation failed: ${uaCheck.reason}`, clientId, req);
      return {
        allowed: false,
        reason: "Invalid user agent",
        clientId,
        validationResult: { isValid: false, error: uaCheck.reason },
        rateLimitResult: { success: false, limit: 0, remaining: 0, reset: 0, tier: "basic" },
        costLimitResult: { allowed: false, estimatedCost: 0, currentUsage: { daily: 0, hourly: 0, monthly: 0 }, limits: { daily: 0, hourly: 0, monthly: 0 } },
        queueStatus: getQueueStats(),
        headers: securityHeaders,
      };
    }
    
    // 3. Check if queues are overloaded
    const queueOverload = areQueuesOverloaded();
    if (queueOverload.overloaded) {
      logSecurityEventWithContext("blocked", "System overloaded", clientId, req, { queueStatus: queueOverload.details });
      return {
        allowed: false,
        reason: "System is currently overloaded. Please try again in a few minutes.",
        clientId,
        validationResult: { isValid: false, error: "System overloaded" },
        rateLimitResult: { success: false, limit: 0, remaining: 0, reset: 0, tier: "basic" },
        costLimitResult: { allowed: false, estimatedCost: 0, currentUsage: { daily: 0, hourly: 0, monthly: 0 }, limits: { daily: 0, hourly: 0, monthly: 0 } },
        queueStatus: getQueueStats(),
        headers: securityHeaders,
      };
    }
    
    // 4. Request content validation
    const validationResult = await validateRequest(req);
    if (!validationResult.isValid) {
      logSecurityEventWithContext("blocked", `Validation failed: ${validationResult.error}`, clientId, req, validationResult.details);
      
      // Log suspicious patterns separately
      if (validationResult.details?.suspiciousPatterns?.length) {
        logSecurityEvent("prompt_injection", {
          patterns: validationResult.details.suspiciousPatterns,
          textLength: validationResult.details.totalTextLength,
        }, clientId);
      }
      
      return {
        allowed: false,
        reason: validationResult.error || "Request validation failed",
        clientId,
        validationResult,
        rateLimitResult: { success: false, limit: 0, remaining: 0, reset: 0, tier: "basic" },
        costLimitResult: { allowed: false, estimatedCost: 0, currentUsage: { daily: 0, hourly: 0, monthly: 0 }, limits: { daily: 0, hourly: 0, monthly: 0 } },
        queueStatus: getQueueStats(),
        headers: securityHeaders,
      };
    }
    
    // 5. Rate limiting check
    const rateLimitResult = await checkMultiTierLimits(clientId);
    if (!rateLimitResult.success) {
      logSecurityEventWithContext("blocked", `Rate limit exceeded: ${rateLimitResult.tier}`, clientId, req, {
        tier: rateLimitResult.tier,
        remaining: rateLimitResult.remaining,
        reset: rateLimitResult.reset,
      });
      
      // Add rate limit headers
      if (rateLimitResult.message) {
        securityHeaders.set("X-RateLimit-Message", rateLimitResult.message);
      }
      securityHeaders.set("RateLimit-Limit", String(rateLimitResult.limit));
      securityHeaders.set("RateLimit-Remaining", String(rateLimitResult.remaining));
      securityHeaders.set("RateLimit-Reset", String(rateLimitResult.reset));
      
      return {
        allowed: false,
        reason: rateLimitResult.message || "Rate limit exceeded",
        clientId,
        validationResult,
        rateLimitResult,
        costLimitResult: { allowed: false, estimatedCost: 0, currentUsage: { daily: 0, hourly: 0, monthly: 0 }, limits: { daily: 0, hourly: 0, monthly: 0 } },
        queueStatus: getQueueStats(),
        headers: securityHeaders,
      };
    }
    
    // 6. Cost estimation and limits check
    const requestBody = await req.clone().json().catch(() => ({ messages: [] }));
    const userText = extractUserText(requestBody.messages || []);
    const estimatedCost = estimateRequestCost(userText, 8, false); // Estimate for 8 agents
    
    const costLimitResult = await checkCostLimits(clientId, estimatedCost.total);
    if (!costLimitResult.allowed) {
      logSecurityEventWithContext("blocked", `Cost limit exceeded: ${costLimitResult.reason}`, clientId, req, {
        estimatedCost: estimatedCost.total,
        currentUsage: costLimitResult.currentUsage,
        limits: costLimitResult.limits,
      });
      
      return {
        allowed: false,
        reason: costLimitResult.reason || "Cost limit exceeded",
        clientId,
        validationResult,
        rateLimitResult,
        costLimitResult,
        queueStatus: getQueueStats(),
        headers: securityHeaders,
      };
    }
    
    // 7. All checks passed
    logSecurityEventWithContext("allowed", "Request passed all security checks", clientId, req, {
      estimatedCost: estimatedCost.total,
      messageCount: validationResult.details?.messageCount,
      textLength: validationResult.details?.totalTextLength,
    });
    
    // Add security headers for successful requests
    securityHeaders.set("RateLimit-Limit", String(rateLimitResult.limit));
    securityHeaders.set("RateLimit-Remaining", String(rateLimitResult.remaining));
    securityHeaders.set("RateLimit-Reset", String(rateLimitResult.reset));
    securityHeaders.set("X-Cost-Estimate", estimatedCost.total.toFixed(6));
    
    return {
      allowed: true,
      clientId,
      validationResult,
      rateLimitResult,
      costLimitResult,
      queueStatus: getQueueStats(),
      headers: securityHeaders,
    };
    
  } catch (error) {
    // Security check itself failed - allow but log error
    console.error("[SECURITY] Security check failed:", error);
    logSecurityEventWithContext("suspicious", `Security check error: ${error}`, clientId, req);
    
    return {
      allowed: true, // Fail open for availability
      reason: "Security check error",
      clientId,
      validationResult: { isValid: true },
      rateLimitResult: { success: true, limit: 1, remaining: 1, reset: 0, tier: "basic" },
      costLimitResult: { allowed: true, estimatedCost: 0, currentUsage: { daily: 0, hourly: 0, monthly: 0 }, limits: { daily: 5, hourly: 1, monthly: 50 } },
      queueStatus: getQueueStats(),
      headers: securityHeaders,
    };
  }
}

/**
 * Create a Response with security headers
 */
export function createSecureResponse(
  body: BodyInit | null,
  init: ResponseInit = {},
  securityHeaders?: Headers
): Response {
  const response = new Response(body, init);
  
  // Add default security headers
  const headers = generateSecurityHeaders();
  
  // Add custom security headers if provided
  if (securityHeaders) {
    securityHeaders.forEach((value, key) => {
      headers.set(key, value);
    });
  }
  
  // Add existing response headers
  if (init.headers) {
    const existingHeaders = new Headers(init.headers);
    existingHeaders.forEach((value, key) => {
      headers.set(key, value);
    });
  }
  
  // Apply all headers to response
  headers.forEach((value, key) => {
    response.headers.set(key, value);
  });
  
  return response;
}

/**
 * Middleware wrapper for API routes
 */
export function withSecurity<T extends Request[]>(
  handler: (...args: T) => Promise<Response>
) {
  return async (...args: T): Promise<Response> => {
    const req = args[0];
    
    // Perform security check
    const securityResult = await performSecurityCheck(req);
    
    if (!securityResult.allowed) {
      return createSecureResponse(
        JSON.stringify({
          error: securityResult.reason,
          code: "SECURITY_CHECK_FAILED",
        }),
        {
          status: securityResult.reason?.includes("overloaded") ? 503 :
                  securityResult.reason?.includes("rate limit") || securityResult.reason?.includes("cost limit") ? 429 : 400,
        },
        securityResult.headers
      );
    }
    
    // Call the original handler
    try {
      const response = await handler(...args);
      
      // Add security headers to successful responses
      securityResult.headers.forEach((value, key) => {
        response.headers.set(key, value);
      });
      
      return response;
    } catch (error) {
      console.error("[SECURITY] Handler error:", error);
      
      return createSecureResponse(
        JSON.stringify({
          error: "Internal server error",
          code: "HANDLER_ERROR",
        }),
        { status: 500 },
        securityResult.headers
      );
    }
  };
}