import { openai } from "@ai-sdk/openai";
import { generateText, tool } from "ai";
import { z } from "zod";

export const environmentTool = tool({
  description: "Environmental ethics expert. Analyze environmental impact.",
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
            "You are an environmental ethics agent assessing the ecological consequences of business decisions. Be concise and practical. Do not use Markdown.",
        },
        {
          role: "user",
          content: `
Evaluate the environmental impact of the following decision:

Decision: "${decision}"

Include:
- Ecological risks (e.g. deforestation, pollution, habitat loss)
- Regulatory or conservation conflicts
- Long-term sustainability concerns
- Alignment with environmental ethics or ESG goals
- Recommendation on environmental viability
- Overall <= 180 words
        `.trim(),
        },
      ],
    });

    return text;
  },
});
