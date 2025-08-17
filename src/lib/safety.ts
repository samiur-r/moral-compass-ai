import OpenAI from "openai";
import type { UIMessage } from "ai";

// Create client (safe at module scope in serverless)
const oa = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Input validation limits
const INPUT_LIMITS = {
  MAX_PAYLOAD_SIZE: 20 * 1024, // 20KB (single prompt + metadata)
  MAX_MESSAGE_COUNT: 3,
  MAX_TEXT_LENGTH: 1500,
} as const;

/** Very light PII redaction to reduce accidental leakage. */
export function redactPII(text: string): string {
  if (!text) return text;
  return (
    text
      // Emails
      .replace(
        /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
        "[redacted-email]"
      )
      // US/EU-ish phone numbers
      .replace(
        /(?:\+?\d{1,3}[\s-]?)?(?:\(?\d{2,4}\)?[\s-]?)?\d{3,4}[\s-]?\d{3,4}\b/g,
        "[redacted-phone]"
      )
      // Credit cards (very rough)
      .replace(/\b(?:\d[ -]*?){13,19}\b/g, "[redacted-card]")
  );
}

export type ModerationCategories = Record<string, boolean>;

/** Run OpenAI moderation on text. Returns { allowed, categories }. */
export async function moderateText(
  text: string
): Promise<{ allowed: boolean; categories?: ModerationCategories }> {
  // Empty/short text: allow
  if (!text || !text.trim()) return { allowed: true };

  // "omni-moderation-latest" is the general moderation model
  const res = await oa.moderations.create({
    model: "omni-moderation-latest",
    input: text.slice(0, 20_000), // keep costs bounded
  });

  const result = res.results?.[0];
  const flagged = result?.flagged ?? false;

  const categories: ModerationCategories | undefined =
    result &&
    typeof result.categories === "object" &&
    result.categories !== null
      ? (result.categories as unknown as Record<string, boolean>)
      : undefined;

  return { allowed: !flagged, categories };
}

/** Decide what to do when moderation flags synthesis output. */
export async function enforceSafeOutput(summary: string): Promise<string> {
  const { allowed } = await moderateText(summary);
  if (allowed) return redactPII(summary);

  // Replace with a safe, generic message if flagged
  return "⚠️ Parts of the analysis were withheld due to safety policy. Please revise the prompt or consult a human reviewer.";
}

/** Build a short text blob of the latest user content for input moderation. */
export function extractUserText(
  messages: Array<{
    role: string;
    parts?: Array<{ type: string; text?: string }>;
  }>
): string {
  // Grab the last user message's plain text parts
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  if (!lastUser) return "";

  // UIMessage uses `parts` array, not `content`
  const parts = lastUser.parts ?? [];
  const text = parts
    .filter((p) => p.type === "text")
    .map((p) => p.text ?? "")
    .join("\n")
    .trim();
  return text;
}

export interface ValidationResult {
  valid: boolean;
  error?: string;
  details?: {
    payloadSize?: number;
    messageCount?: number;
    textLength?: number;
  };
}

export interface InjectionResult {
  detected: boolean;
  patterns?: string[];
  riskLevel: "low" | "medium" | "high";
  sanitizedText?: string;
}

// Common prompt injection patterns for basic detection
const INJECTION_PATTERNS = [
  {
    pattern: /ignore\s+(?:all\s+)?previous\s+instructions/i,
    name: "ignore_instructions",
    risk: "high" as const,
  },
  {
    pattern:
      /(?:act|behave|respond)\s+as\s+(?:a\s+different|an?)\s+(?:ai|assistant|character|person)/i,
    name: "role_confusion",
    risk: "high" as const,
  },
  {
    pattern: /(?:system|user|assistant)\s*:\s*/i,
    name: "role_injection",
    risk: "medium" as const,
  },
  {
    pattern: /\[(?:INST|\/INST)\]|\{\{.*?\}\}/i,
    name: "template_injection",
    risk: "medium" as const,
  },
  {
    pattern:
      /(?:override|bypass|disable|turn\s+off)\s+(?:safety|security|filter|guard)/i,
    name: "safety_bypass",
    risk: "high" as const,
  },
] as const;

/** Validate request input size and structure for app limits */
export function validateInput(
  request: Request,
  messages: UIMessage[]
): ValidationResult {
  const details: ValidationResult["details"] = {};

  // Check payload size (estimate from request headers)
  const contentLength = request.headers.get("content-length");
  if (contentLength) {
    const payloadSize = parseInt(contentLength, 10);
    details.payloadSize = payloadSize;

    if (payloadSize > INPUT_LIMITS.MAX_PAYLOAD_SIZE) {
      return {
        valid: false,
        error: `Request too large. Maximum ${
          INPUT_LIMITS.MAX_PAYLOAD_SIZE / 1024
        }KB allowed, got ${Math.round(payloadSize / 1024)}KB.`,
        details,
      };
    }
  }

  // Check message count
  details.messageCount = messages.length;
  if (messages.length > INPUT_LIMITS.MAX_MESSAGE_COUNT) {
    return {
      valid: false,
      error: `Too many messages. Maximum ${INPUT_LIMITS.MAX_MESSAGE_COUNT} allowed, got ${messages.length}.`,
      details,
    };
  }

  // Check total text length
  const totalText = messages
    .map((msg) => {
      if (Array.isArray(msg.parts)) {
        return msg.parts
          .filter(
            (part: { type: string; text?: string }) => part.type === "text"
          )
          .map((part: { type: string; text?: string }) => part.text || "")
          .join(" ");
      }
      return "";
    })
    .join(" ");

  details.textLength = totalText.length;
  if (totalText.length > INPUT_LIMITS.MAX_TEXT_LENGTH) {
    return {
      valid: false,
      error: `Text too long. Maximum ${INPUT_LIMITS.MAX_TEXT_LENGTH} characters allowed, got ${totalText.length}.`,
      details,
    };
  }

  return { valid: true, details };
}

/** Detect basic prompt injection patterns */
export function detectPromptInjection(text: string): InjectionResult {
  if (!text?.trim()) {
    return { detected: false, riskLevel: "low" };
  }

  const detectedPatterns: string[] = [];
  let highestRisk: "low" | "medium" | "high" = "low";
  let sanitizedText = text;

  for (const { pattern, name, risk } of INJECTION_PATTERNS) {
    if (pattern.test(text)) {
      detectedPatterns.push(name);

      // Update highest risk level
      if (risk === "high" || (risk === "medium" && highestRisk === "low")) {
        highestRisk = risk;
      }

      // Sanitize by replacing with [REDACTED]
      sanitizedText = sanitizedText.replace(pattern, "[REDACTED]");
    }
  }

  const detected = detectedPatterns.length > 0;

  // Log suspicious activity for monitoring
  if (detected) {
    console.warn("🚨 SECURITY: Prompt injection detected", {
      patterns: detectedPatterns,
      riskLevel: highestRisk,
      textLength: text.length,
      timestamp: new Date().toISOString(),
    });
  }

  return {
    detected,
    patterns: detected ? detectedPatterns : undefined,
    riskLevel: highestRisk,
    sanitizedText: detected ? sanitizedText : undefined,
  };
}
