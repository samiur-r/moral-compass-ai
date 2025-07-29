import { openai } from "@ai-sdk/openai";
import { generateText, tool } from "ai";
import z from "zod";

export const aiRiskTool = tool({
  description:
    "AI risk advisor. Assesses automation, algorithmic bias, and explainability in tech decisions.",
  parameters: z.object({
    decision: z.string(),
  }),
  execute: async ({ decision }) => {
    const { text } = await generateText({
      model: openai("gpt-4.1-nano"),
      maxTokens: 500,
      temperature: 0.5,
      messages: [
        {
          role: "system",
          content:
            "You are an AI Risk Advisor. Analyze the following decision from the perspective of automation, AI ethics, and regulatory concerns.",
        },
        {
          role: "user",
          content: `
Decision: "${decision}"

Respond with:
- Ethical risks in automation or AI-driven decision-making
- Potential for algorithmic bias or discrimination
- Transparency and explainability concerns
- Relevant regulations (e.g., EU AI Act, GDPR, FTC guidance)
- Whether external AI audit or risk mitigation is advised
          `.trim(),
        },
      ],
    });

    return text;
  },
});
