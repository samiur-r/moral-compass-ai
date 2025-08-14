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
import { getClientId, limitChat, rateHeaders } from "@/lib/rateLimit";
import { extractUserText, moderateText, redactPII } from "@/lib/safety";
import type { MoralMessage, AgentData, SynthesisData } from "@/types/ai";

export const maxDuration = 60;

export async function POST(req: Request) {
  const key = `ip:${getClientId(req)}`;
  const rl = await limitChat(key);
  if (!rl.success) {
    const res = new Response(
      JSON.stringify({ error: "Rate limit exceeded. Try again soon." }),
      {
        status: 429,
        headers: rateHeaders(rl),
      }
    );
    return res;
  }

  const { messages }: { messages: UIMessage[] } = await req.json();

  const rawUser = extractUserText(messages);
  const userOk = await moderateText(rawUser);
  if (!userOk.allowed) {
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

  const sanitized = redactPII(rawUser);
  if (sanitized !== rawUser) {
    const newMessages = [...messages];
    for (let i = newMessages.length - 1; i >= 0; i--) {
      const m = newMessages[i];
      if (m.role === "user" && Array.isArray(m.content)) {
        newMessages[i] = {
          ...m,
          content: m.content.map((p: any) =>
            p.type === "text" ? { ...p, text: redactPII(p.text || "") } : p
          ),
        };
        break;
      }
    }
    (messages as any) = newMessages;
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
            const toolResult: unknown =
              (part as any).output ?? (part as any).result;

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

  const res = createUIMessageStreamResponse({ stream });
  rateHeaders(rl).forEach((v, k) => res.headers.set(k, v));
  return res;
}
