import { openai } from "@ai-sdk/openai";
import { generateText, tool } from "ai";
import { z } from "zod";

const AllowedTools = [
  "environment",
  "law",
  "dei",
  "economist",
  "prAndReputation",
  "publicHealth",
  "aiRisk",
] as const;

export const synthesisTool = tool({
  description: "Final structured recommendation after all analysis.",
  inputSchema: z.object({
    summary: z.string(),
    agentsUsed: z.preprocess((v) => {
      if (Array.isArray(v)) return v;
      if (typeof v === "string") {
        try {
          const parsed = JSON.parse(v);
          if (Array.isArray(parsed)) return parsed;
        } catch {}
        return v.split(/[,\s]+/).filter(Boolean);
      }
      return [];
    }, z.array(z.enum(AllowedTools)).default([])),
    confidence: z.number().min(0).max(1),
  }),
  execute: async ({ summary, agentsUsed, confidence }) => {
    const { text } = await generateText({
      model: openai("gpt-4.1-nano"),
      maxOutputTokens: 300,
      temperature: 0.5,
      messages: [
        {
          role: "system",
          content:
            "You are a decision ethics synthesizer AI. Your job is to summarize the final recommendation from multiple expert agent perspectives.",
        },
        {
          role: "user",
          content: `
Summary of findings:
"${summary}"

Agents consulted:
${agentsUsed.map((a) => `- ${a}`).join("\n")}

Confidence in recommendation: ${confidence * 100}%

Please synthesize a brief, actionable recommendation that reflects multi-perspective analysis and the ethical implications.
          `.trim(),
        },
      ],
    });

    return {
      summary: text,
      agentsUsed,
      confidence,
    };
  },
});
