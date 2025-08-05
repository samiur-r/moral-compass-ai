import { openai } from "@ai-sdk/openai";
import { generateText, tool } from "ai";
import { z } from "zod";

export const economistTool = tool({
  description:
    "An economic analyst agent. Considers cost-benefit, market conditions, local economic impact, and long-term ROI.",
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
            "You are an economist agent evaluating the financial and economic viability of business decisions.",
        },
        {
          role: "user",
          content: `
Decision: "${decision}"

Assess the following:
- Capital and operational cost estimates
- ROI potential in the short and long term
- Market conditions and risks
- Impact on local economy and job creation
- Currency, inflation, or trade-related factors
- Overall economic feasibility and strategic recommendation
        `.trim(),
        },
      ],
    });

    return text;
  },
});
