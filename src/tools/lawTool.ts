import { openai } from "@ai-sdk/openai";
import { generateText, tool } from "ai";
import z from "zod";

export const lawTool = tool({
  description:
    "A legal expert agent. Assesses regulatory, labor, and legal compliance issues in the decision.",
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
            "You are a legal analyst AI. Given a business decision, analyze the relevant legal concerns. Be concise and practical. Do not use Markdown.",
        },
        {
          role: "user",
          content: `
Decision: "${decision}"

Respond with:
- Potential legal risks (e.g. zoning, contracts, international trade)
- Labor law issues
- Risk of litigation
- Any regulations that may apply
- Recommend whether legal review is needed
- Overall <= 180 words
          `.trim(),
        },
      ],
    });

    return text;
  },
});
