import { streamText } from "ai";
import { openai } from "@ai-sdk/openai";

import {
  environmentTool,
  lawTool,
  deiTool,
  economistTool,
  prAndReputationTool,
  publicHealthTool,
  aiRiskTool,
  synthesisTool,
} from "@/tools";

export async function POST(req: Request) {
  const { prompt } = await req.json();

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
      synthesis: synthesisTool,
    },
    maxSteps: 8,
    system: `
      You are a Moral Compass AI that helps organizations evaluate ethical decisions.
      You can consult specialized tools (lens agents) to simulate different perspectives.

      Your task:
      1. Read the decision
      2. Call only relevant tools based on context
      3. Use their outputs to synthesize a final recommendation
      4. Finish by calling the 'synthesis' tool with:
         - a 'summary' of the ethical findings,
         - 'agentsUsed' as an ARRAY of tool names (e.g., ["law", "environment"]),
         - 'confidence' as a number between 0 and 1

      DO NOT hallucinate tool names. Only use tools provided.
    `,
    prompt: `Decision to evaluate: ${prompt}`,
  });

  (async () => {
    for await (const part of result.fullStream) {
      switch (part.type) {
        case "start-step":
          console.log("→ step:start", { request: part.request });
          break;
        case "tool-call":
          console.log("🔧 tool-call", {
            id: part.toolCallId,
            tool: part.toolName,
            input: part.args,
          });
          break;
        case "tool-result":
          console.log("✅ tool-result", {
            id: part.toolCallId,
            tool: part.toolName,
            output: part.result,
          });
          break;
        case "finish-step":
          console.log("✓ step:finish", {
            usage: part.usage,
            finishReason: part.finishReason,
          });
          break;
        case "error":
          console.error("⛔ stream error:", part.error);
          break;
      }
    }
  })().catch((e) => console.error("stream logger failed:", e));

  // --- STRUCTURED SUMMARY (after finish) ---
  result.steps
    .then((steps) => {
      console.log("—— steps summary ——");
      steps.forEach((s, i) => {
        console.log(`Step #${i + 1} [${s.stepType}]`, {
          text: s.text,
          toolCalls:
            s.toolCalls?.map((tc) => ({
              tool: tc.toolName,
              input: tc.args,
            })) ?? [],
          toolResults:
            s.toolResults?.map((tr) => ({
              tool: tr.toolName,
              output: tr.result,
            })) ?? [],
          finishReason: s.finishReason,
          usage: s.usage,
        });
      });
    })
    .catch((e) => console.error("failed to read steps:", e));

  // Stream the assistant message to the client (works with useCompletion).
  return result.toDataStreamResponse();
}
