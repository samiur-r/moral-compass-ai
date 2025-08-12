import { openai } from "@ai-sdk/openai";
import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  streamText,
  convertToModelMessages,
  hasToolCall,
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
import type { MoralMessage, AgentData, SynthesisData } from "@/types/ai";

export const maxDuration = 60;

export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json();

  const stream = createUIMessageStream<MoralMessage>({
    execute: async ({ writer }) => {
      const result = streamText({
        model: openai("gpt-4.1-nano"),
        tools: {
          environment: environmentTool,
          law: lawTool,
          // dei: deiTool,
          // economist: economistTool,
          // prAndReputation: prAndReputationTool,
          // publicHealth: publicHealthTool,
          // aiRisk: aiRiskTool,
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
        // stopWhen: [hasToolCall("synthesis"), stepCountIs(6)],
        stopWhen: [stepCountIs(5)],
        toolChoice: "auto",
        onError({ error }) {
          console.error("stream error:", error);
        },
      });

      writer.merge(result.toUIMessageStream());

      (async () => {
        for await (const part of result.fullStream) {
          // console.log(`part`, part);
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

  return createUIMessageStreamResponse({ stream });
}
