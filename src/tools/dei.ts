import { openai } from "@ai-sdk/openai";
import { generateText, tool } from "ai";
import { z } from "zod";

export const deiTool = tool({
  description:
    "A Diversity, Equity & Inclusion expert agent. Evaluates how the decision impacts marginalized groups, workplace equity, and inclusive growth.",
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
            "You are a DEI (Diversity, Equity & Inclusion) advisor analyzing the ethical and social impact of business decisions on marginalized groups and workplace equity. Be concise and practical. Do not use Markdown.",
        },
        {
          role: "user",
          content: `
Decision: "${decision}"

Provide an assessment covering:
- Impact on marginalized or underrepresented groups
- Risks of exclusion, bias, or inequitable outcomes
- Opportunities to promote inclusive hiring or leadership
- Cultural sensitivity concerns
- Whether a DEI review or stakeholder consultation is recommended
- Overall <= 180 words
          `.trim(),
        },
      ],
    });

    return text;
  },
});
