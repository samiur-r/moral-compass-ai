import OpenAI from "openai";

// Create client (safe at module scope in serverless)
const oa = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

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

/** Run OpenAI moderation on text. Returns { allowed, categories }. */
export async function moderateText(
  text: string
): Promise<{ allowed: boolean; categories?: any }> {
  // Empty/short text: allow
  if (!text || !text.trim()) return { allowed: true };

  // "omni-moderation-latest" is the general moderation model
  const res = await oa.moderations.create({
    model: "omni-moderation-latest",
    input: text.slice(0, 20_000), // keep costs bounded
  });

  const result = res.results?.[0];
  const flagged = result?.flagged ?? false;
  return { allowed: !flagged, categories: result?.categories };
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
  messages: Array<{ role: string; content?: any }>
): string {
  // Grab the last user message’s plain text parts
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  if (!lastUser) return "";
  // Vercel AI SDK messages often have `content` as an array of parts
  const parts: Array<{ type: string; text?: string }> = Array.isArray(
    lastUser.content
  )
    ? lastUser.content
    : [];
  const text = parts
    .filter((p) => p.type === "text")
    .map((p) => p.text ?? "")
    .join("\n")
    .trim();
  return text;
}
