import { openai } from "@ai-sdk/openai";
import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  streamText,
  convertToModelMessages,
  stepCountIs,
  type UIMessage,
} from "ai";
import {
  environmentTool,
  lawTool,
  deiTool,
  economistTool,
  prAndReputationTool,
  publicHealthTool,
  aiRiskTool,
  synthesisTool,
  generatePdfLogTool,
} from "@/tools";
import { performSecurityCheck, createSecureResponse } from "@/lib/security";
import { queueDecisionOperation } from "@/lib/requestQueue";
import { recordCost } from "@/lib/costTracking";
import { extractUserText, moderateText, redactPII } from "@/lib/safety";
import type { MoralMessage, AgentData, SynthesisData } from "@/types/ai";

export const maxDuration = 60;

export async function POST(req: Request) {
  // Perform comprehensive security check
  const securityResult = await performSecurityCheck(req);
  
  if (!securityResult.allowed) {
    const statusCode = securityResult.reason?.includes("overloaded") ? 503 :
                      securityResult.reason?.includes("rate limit") || 
                      securityResult.reason?.includes("cost limit") ? 429 : 400;
    
    return createSecureResponse(
      JSON.stringify({
        error: securityResult.reason,
        code: "SECURITY_CHECK_FAILED",
      }),
      { status: statusCode },
      securityResult.headers
    );
  }

  // Parse request body - security check already validated it
  const { messages }: { messages: UIMessage[] } = await req.json();
  const clientId = securityResult.clientId;

  // Extract and sanitize user text
  const rawUser = extractUserText(messages);
  const userOk = await moderateText(rawUser);
  if (!userOk.allowed) {
    return createSecureResponse(
      JSON.stringify({
        error: "Your prompt appears to violate our safety policy. Please rephrase and avoid harmful, illegal, or highly sensitive content.",
        categories: userOk.categories ?? null,
        code: "MODERATION_FAILED",
      }),
      { status: 400 },
      securityResult.headers
    );
  }

  const sanitized = redactPII(rawUser);

  const isTextPart = (p: {
    type: string;
  }): p is { type: "text"; text: string } => p.type === "text";

  if (sanitized !== rawUser) {
    const newMessages = [...messages];
    for (let i = newMessages.length - 1; i >= 0; i--) {
      const m = newMessages[i];
      if (m.role === "user") {
        newMessages[i] = {
          ...m,
          parts: m.parts.map((p) =>
            isTextPart(p) ? { ...p, text: redactPII(p.text || "") } : p
          ),
        };
        break;
      }
    }
    (messages as unknown as UIMessage[]) = newMessages;
  }

  // Queue the decision processing operation
  const queueResult = await queueDecisionOperation(async () => {
    return createUIMessageStream<MoralMessage>({
      execute: async ({ writer }) => {
        const result = streamText({
          model: openai("gpt-4.1-nano"),
          tools: {
            environment: environmentTool,
            law: lawTool,
            dei: deiTool,
            economist: economistTool,
            prAndReputation: prAndReputationTool,
            publicHealth: publicHealthTool,
            aiRisk: aiRiskTool,
            generatePdfLog: generatePdfLogTool,
            synthesis: synthesisTool,
          },
          system: `
            You are a Moral Compass AI that helps organizations evaluate ethical decisions.
            Call only relevant tools based on the decision context.
            You MUST finish by calling the 'synthesis' tool with { summary, agentsUsed, confidence }
            After synthesis is complete, you SHOULD call the 'generatePdfLog' tool to create a downloadable report.
            Do NOT hallucinate tool names.
          `,
          messages: convertToModelMessages(messages),
          stopWhen: [stepCountIs(10)],
          toolChoice: "auto",
          onError({ error }) {
            console.error("stream error:", error);
          },
        });

        writer.merge(result.toUIMessageStream());

        (async () => {
          for await (const part of result.fullStream) {
            if (part.type === "tool-call") {
              writer.write({
                type: "data-agent",
                id: part.toolName,
                data: {
                  tool: part.toolName,
                  status: "running",
                } satisfies AgentData,
              });
            } else if (part.type === "tool-result") {
              type ToolResultPart = {
                output?: unknown;
                result?: unknown;
                toolName: string;
              };

              const toolResult: unknown =
                (part as ToolResultPart).output ??
                (part as ToolResultPart).result;

              if (part.toolName === "synthesis") {
                const synth: SynthesisData =
                  typeof toolResult === "string"
                    ? { summary: toolResult, agentsUsed: [], confidence: 0 }
                    : (toolResult as SynthesisData);

                writer.write({
                  type: "data-synthesis",
                  id: "synthesis",
                  data: synth,
                });
              } else {
                const out =
                  typeof toolResult === "string"
                    ? toolResult
                    : JSON.stringify(toolResult);

                writer.write({
                  type: "data-agent",
                  id: part.toolName,
                  data: {
                    tool: part.toolName,
                    output: out,
                    status: "done",
                  } satisfies AgentData,
                });
              }
            }
          }
        })().catch(console.error);
      },
    });
  }, clientId);

  // Handle queue result
  if (!queueResult.success) {
    console.error(`[API] Queue operation failed:`, queueResult.error);
    return createSecureResponse(
      JSON.stringify({
        error: queueResult.error || "Processing failed",
        code: "QUEUE_ERROR",
      }),
      { status: 500 },
      securityResult.headers
    );
  }

  // Record estimated cost
  try {
    await recordCost(clientId, securityResult.costLimitResult.estimatedCost);
  } catch (error) {
    console.warn(`[API] Failed to record cost:`, error);
  }

  // Create response with security headers
  const res = createUIMessageStreamResponse({ stream: queueResult.data! });
  
  // Add additional headers
  securityResult.headers.forEach((value, key) => {
    res.headers.set(key, value);
  });
  
  return res;
}
