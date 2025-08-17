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
import { getClientId, checkMultipleLimits, rateHeaders } from "@/lib/rateLimit";
import {
  extractUserText,
  moderateText,
  redactPII,
  validateInput,
  detectPromptInjection,
} from "@/lib/safety";
import type { MoralMessage, AgentData, SynthesisData } from "@/types/ai";
import { semanticCache } from "@/lib/semanticCache";

export const maxDuration = 60;

export async function POST(req: Request) {
  const clientId = getClientId(req);
  const timestamp = new Date().toISOString();

  // Log request attempt
  console.log(
    `🔍 REQUEST: ${timestamp} | Client: ${clientId} | IP: ${
      req.headers.get("x-forwarded-for") || "unknown"
    }`
  );

  const rl = await checkMultipleLimits(clientId, "chat");

  if (!rl.success) {
    const limitType = rl.limits.daily.success ? "short-term" : "daily";

    // Log rate limit violation
    console.warn(
      `🚫 RATE_LIMIT: ${timestamp} | Client: ${clientId} | Type: ${limitType} | Short: ${rl.limits.shortTerm.remaining}/${rl.limits.shortTerm.limit} | Daily: ${rl.limits.daily.remaining}/${rl.limits.daily.limit}`
    );

    const res = new Response(
      JSON.stringify({
        error: `Rate limit exceeded (${limitType}). Please try again later.`,
        limits: {
          shortTerm: `${rl.limits.shortTerm.remaining}/${rl.limits.shortTerm.limit} remaining`,
          daily: `${rl.limits.daily.remaining}/${rl.limits.daily.limit} remaining`,
        },
      }),
      {
        status: 429,
        headers: rateHeaders(rl),
      }
    );
    return res;
  }

  const { messages }: { messages: UIMessage[] } = await req.json();

  // Validate input size and structure for test app
  const validation = validateInput(req, messages);
  if (!validation.valid) {
    // Log validation failure
    console.warn(
      `❌ VALIDATION: ${timestamp} | Client: ${clientId} | Error: ${
        validation.error
      } | Details: ${JSON.stringify(validation.details)}`
    );

    const res = new Response(
      JSON.stringify({
        error: validation.error,
        details: validation.details,
      }),
      { status: 400 }
    );
    rateHeaders(rl).forEach((v, k) => res.headers.set(k, v));
    return res;
  }

  const rawUser = extractUserText(messages);

  // Check for prompt injection attempts
  const injectionCheck = detectPromptInjection(rawUser);
  if (injectionCheck.detected && injectionCheck.riskLevel === "high") {
    // Log high-risk injection attempt (additional logging)
    console.error(
      `🚨 HIGH_RISK_INJECTION: ${timestamp} | Client: ${clientId} | Patterns: ${injectionCheck.patterns?.join(
        ", "
      )} | Text: "${rawUser.slice(0, 100)}..."`
    );

    const res = new Response(
      JSON.stringify({
        error:
          "Your prompt contains suspicious patterns that may be attempting to manipulate the AI. Please rephrase your question.",
        patterns: injectionCheck.patterns,
        riskLevel: injectionCheck.riskLevel,
      }),
      { status: 400 }
    );
    rateHeaders(rl).forEach((v, k) => res.headers.set(k, v));
    return res;
  }

  // Use sanitized text if injection was detected but not high risk
  const textToModerate = injectionCheck.sanitizedText || rawUser;
  const userOk = await moderateText(textToModerate);
  if (!userOk.allowed) {
    // Log moderation failure
    console.warn(
      `⚠️ MODERATION: ${timestamp} | Client: ${clientId} | Categories: ${JSON.stringify(
        userOk.categories
      )} | Text: "${textToModerate.slice(0, 100)}..."`
    );

    const res = new Response(
      JSON.stringify({
        error:
          "Your prompt appears to violate our safety policy. Please rephrase and avoid harmful, illegal, or highly sensitive content.",
        categories: userOk.categories ?? null,
      }),
      { status: 400 }
    );
    rateHeaders(rl).forEach((v, k) => res.headers.set(k, v));
    return res;
  }

  // Apply PII redaction to the text (could be sanitized from injection detection)
  const finalText = injectionCheck.sanitizedText || rawUser;
  const sanitized = redactPII(finalText);

  const isTextPart = (p: {
    type: string;
  }): p is { type: "text"; text: string } => p.type === "text";

  // Update messages if either injection sanitization or PII redaction changed the text
  if (sanitized !== rawUser || injectionCheck.sanitizedText) {
    const newMessages = [...messages];
    for (let i = newMessages.length - 1; i >= 0; i--) {
      const m = newMessages[i];
      if (m.role === "user") {
        newMessages[i] = {
          ...m,
          parts: m.parts.map((p) =>
            isTextPart(p) ? { ...p, text: sanitized } : p
          ),
        };
        break;
      }
    }
    (messages as unknown as UIMessage[]) = newMessages;
  }

  // Check semantic cache for similar decisions
  const cachedFlow = await semanticCache.get(sanitized);
  if (cachedFlow) {
    console.log(
      `⚡ CACHE: Returning cached conversation flow for similar query`
    );

    // Return cached full conversation flow as a stream
    const stream = createUIMessageStream<MoralMessage>({
      execute: async ({ writer }) => {
        // Replay all agent outputs from cache
        for (const agentData of cachedFlow.agentOutputs || []) {
          writer.write({
            type: "data-agent",
            id: agentData.tool,
            data: agentData,
          });
        }

        // Write the cached synthesis data
        if (cachedFlow.synthesis) {
          writer.write({
            type: "data-synthesis",
            id: "synthesis",
            data: cachedFlow.synthesis,
          });
        }
      },
    });

    const res = createUIMessageStreamResponse({ stream });
    rateHeaders(rl).forEach((v, k) => res.headers.set(k, v));
    return res;
  }

  const stream = createUIMessageStream<MoralMessage>({
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
        const agentOutputs: AgentData[] = [];
        let synthesis: SynthesisData | null = null;

        for await (const part of result.fullStream) {
          if (part.type === "tool-call") {
            const agentData: AgentData = {
              tool: part.toolName,
              status: "running",
            };

            writer.write({
              type: "data-agent",
              id: part.toolName,
              data: agentData,
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

              synthesis = synth;

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

              const agentData: AgentData = {
                tool: part.toolName,
                output: out,
                status: "done",
              };

              agentOutputs.push(agentData);

              writer.write({
                type: "data-agent",
                id: part.toolName,
                data: agentData,
              });
            }
          }
        }

        // Cache the complete conversation flow
        if (synthesis) {
          const conversationFlow = {
            agentOutputs,
            synthesis,
          };
          await semanticCache.set(sanitized, conversationFlow);
        }
      })().catch(console.error);
    },
  });

  // Log successful request processing
  console.log(
    `✅ SUCCESS: ${timestamp} | Client: ${clientId} | Text length: ${
      rawUser.length
    } | Injection: ${
      injectionCheck.detected ? injectionCheck.riskLevel : "none"
    }`
  );

  const res = createUIMessageStreamResponse({ stream });
  rateHeaders(rl).forEach((v, k) => res.headers.set(k, v));
  return res;
}
