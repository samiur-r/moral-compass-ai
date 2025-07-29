import { generateText } from "ai";
import { openai } from "@ai-sdk/openai";
import { NextResponse } from "next/server";

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

  const { steps, toolCalls } = await generateText({
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
      4. Finish by calling the 'synthesis' tool

      DO NOT hallucinate tool names. Only use tools provided.
      `,
    prompt: `Decision to evaluate: ${prompt}`,
  });

  return NextResponse.json({ steps, toolCalls });
}
