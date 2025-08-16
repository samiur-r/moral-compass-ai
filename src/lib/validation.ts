import { z } from "zod";

// Configuration constants
export const VALIDATION_LIMITS = {
  MAX_REQUEST_SIZE: 100_000, // 100KB
  MAX_MESSAGE_LENGTH: 5_000, // Reduced from 20K
  MAX_MESSAGES_COUNT: 10,
  MAX_TOTAL_TEXT_LENGTH: 10_000,
} as const;

// Prompt injection patterns to detect
const PROMPT_INJECTION_PATTERNS = [
  /ignore\s+previous\s+instructions/i,
  /act\s+as\s+a\s+different\s+(character|person|ai)/i,
  /system\s*:\s*/i,
  /\[INST\]|\[\/INST\]/i,
  /<\|im_start\|>|<\|im_end\|>/i,
  /forget\s+everything\s+(above|before)/i,
  /new\s+instructions?\s*:/i,
  /override\s+your\s+instructions/i,
  /disregard\s+your\s+programming/i,
  /you\s+are\s+now\s+a\s+different/i,
  /pretend\s+to\s+be/i,
  /role\s*:\s*(user|assistant|system)/i,
  /###\s*INSTRUCTION/i,
] as const;

// Zod schema for request validation
export const RequestSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant", "system"]),
        content: z.union([
          z.string(),
          z.array(
            z.object({
              type: z.string(),
              text: z.string().optional(),
            })
          ),
        ]),
        parts: z
          .array(
            z.object({
              type: z.string(),
              text: z.string().optional(),
            })
          )
          .optional(),
      })
    )
    .max(VALIDATION_LIMITS.MAX_MESSAGES_COUNT, "Too many messages"),
});

export interface ValidationResult {
  isValid: boolean;
  error?: string;
  details?: {
    requestSize?: number;
    messageCount?: number;
    totalTextLength?: number;
    suspiciousPatterns?: string[];
  };
}

export interface SecurityFlags {
  promptInjection: boolean;
  suspiciousPatterns: string[];
  riskLevel: "low" | "medium" | "high";
}

/**
 * Detect potential prompt injection attempts
 */
export function detectPromptInjection(text: string): SecurityFlags {
  const suspiciousPatterns: string[] = [];
  
  for (const pattern of PROMPT_INJECTION_PATTERNS) {
    if (pattern.test(text)) {
      suspiciousPatterns.push(pattern.source);
    }
  }

  const promptInjection = suspiciousPatterns.length > 0;
  let riskLevel: "low" | "medium" | "high" = "low";

  if (suspiciousPatterns.length >= 3) {
    riskLevel = "high";
  } else if (suspiciousPatterns.length >= 1) {
    riskLevel = "medium";
  }

  return {
    promptInjection,
    suspiciousPatterns,
    riskLevel,
  };
}

/**
 * Extract all text content from messages for analysis
 */
export function extractAllText(messages: unknown[]): string {
  const textParts: string[] = [];

  for (const message of messages) {
    if (typeof message !== "object" || !message) continue;
    
    const msg = message as Record<string, unknown>;
    
    // Handle content field
    if (typeof msg.content === "string") {
      textParts.push(msg.content);
    } else if (Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (typeof part === "object" && part && "text" in part && typeof part.text === "string") {
          textParts.push(part.text);
        }
      }
    }

    // Handle parts field
    if (Array.isArray(msg.parts)) {
      for (const part of msg.parts) {
        if (typeof part === "object" && part && "text" in part && typeof part.text === "string") {
          textParts.push(part.text);
        }
      }
    }
  }

  return textParts.join("\n");
}

/**
 * Validate request size in bytes
 */
export function validateRequestSize(request: Request): boolean {
  const contentLength = request.headers.get("content-length");
  if (contentLength) {
    const size = parseInt(contentLength, 10);
    return size <= VALIDATION_LIMITS.MAX_REQUEST_SIZE;
  }
  return true; // If no content-length header, allow it through
}

/**
 * Comprehensive request validation
 */
export async function validateRequest(req: Request): Promise<ValidationResult> {
  try {
    // Check request size
    if (!validateRequestSize(req)) {
      return {
        isValid: false,
        error: "Request size exceeds maximum allowed limit",
        details: { requestSize: parseInt(req.headers.get("content-length") || "0") },
      };
    }

    // Parse and validate JSON structure
    const body = await req.json();
    const parseResult = RequestSchema.safeParse(body);
    
    if (!parseResult.success) {
      return {
        isValid: false,
        error: "Invalid request format",
        details: { requestSize: JSON.stringify(body).length },
      };
    }

    const { messages } = parseResult.data;
    
    // Extract all text for analysis
    const allText = extractAllText(messages);
    
    // Check total text length
    if (allText.length > VALIDATION_LIMITS.MAX_TOTAL_TEXT_LENGTH) {
      return {
        isValid: false,
        error: "Total text content exceeds maximum allowed length",
        details: {
          totalTextLength: allText.length,
          messageCount: messages.length,
        },
      };
    }

    // Check for prompt injection
    const securityFlags = detectPromptInjection(allText);
    
    if (securityFlags.promptInjection && securityFlags.riskLevel === "high") {
      return {
        isValid: false,
        error: "Request contains potentially malicious content",
        details: {
          suspiciousPatterns: securityFlags.suspiciousPatterns,
          totalTextLength: allText.length,
          messageCount: messages.length,
        },
      };
    }

    // Validation passed
    return {
      isValid: true,
      details: {
        messageCount: messages.length,
        totalTextLength: allText.length,
        suspiciousPatterns: securityFlags.suspiciousPatterns,
      },
    };
  } catch {
    return {
      isValid: false,
      error: "Failed to parse request body",
    };
  }
}

/**
 * Sanitize text by removing potential injection attempts
 */
export function sanitizeText(text: string): string {
  let sanitized = text;
  
  // Remove common injection patterns
  for (const pattern of PROMPT_INJECTION_PATTERNS) {
    sanitized = sanitized.replace(pattern, "[REDACTED]");
  }
  
  return sanitized;
}

/**
 * Log security events for monitoring
 */
export function logSecurityEvent(
  type: "prompt_injection" | "size_limit" | "rate_limit" | "validation_error",
  details: Record<string, unknown>,
  clientId: string
) {
  const event = {
    timestamp: new Date().toISOString(),
    type,
    clientId,
    details,
  };
  
  console.warn(`[SECURITY] ${type.toUpperCase()}:`, event);
  
  // In production, you might want to send this to a security monitoring service
  // await sendToSecurityMonitoring(event);
}