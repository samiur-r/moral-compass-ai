import { openai } from "@ai-sdk/openai";
import { generateText, tool } from "ai";
import { z } from "zod";

export const prAndReputationTool = tool({
  description:
    "Public Relations & Brand Strategist. Evaluates how the decision may be perceived by the public, media, and stakeholders.",
  inputSchema: z.object({
    decision: z.string(),
  }),
  execute: async ({ decision }) => {
    const { text } = await generateText({
      model: openai("gpt-4.1-nano"),
      maxOutputTokens: 250,
      temperature: 0.5,
      messages: [
        {
          role: "system",
          content:
            "You are a PR & reputation strategist AI. Analyze public, media, and stakeholder perception of business decisions.",
        },
        {
          role: "user",
          content: `
Decision: "${decision}"

Analyze:
- How the public, media, customers, and investors might interpret this decision
- Any potential for reputational damage, backlash, or value misalignment
- Whether this contradicts prior public commitments (e.g., ESG, diversity, transparency)
- If it requires a PR mitigation or communication plan
- Provide a recommendation
          `.trim(),
        },
      ],
    });

    return text;
  },
});
