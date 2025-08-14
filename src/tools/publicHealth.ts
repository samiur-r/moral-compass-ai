import { openai } from "@ai-sdk/openai";
import { generateText, tool } from "ai";
import { z } from "zod";

export const publicHealthTool = tool({
  description:
    "Public health advocate. Evaluates impacts on worker and community health.",
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
            "You are a public health ethics analyst AI. Assess the public and occupational health implications of a given decision. Be concise and practical. Do not use Markdown.",
        },
        {
          role: "user",
          content: `
Decision: "${decision}"

Analyze:
- Potential risks to worker health (physical or mental)
- Community-level health effects (e.g., pollution, access to care, disease exposure)
- Implications for long-term well-being, health equity, or infrastructure
- If any formal Health Impact Assessment (HIA) is recommended
- Provide a brief, structured analysis
- Overall <= 180 words
          `.trim(),
        },
      ],
    });

    return text;
  },
});
