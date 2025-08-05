import { retrieveEvidence } from "@/lib/pinecone";
import { openai } from "@ai-sdk/openai";
import { generateText, tool } from "ai";
import z from "zod";

export const aiRiskTool = tool({
  description:
    "Use this tool if the decision involves AI, algorithms, automation, or digital systems that may create risks around bias, explainability, fairness, or regulation.",
  inputSchema: z.object({
    decision: z.string(),
  }),
  execute: async ({ decision }) => {
    const evidence = await retrieveEvidence(decision, 5);
    const contextText = evidence.map((e) => `${e.id} ${e.text}`).join("\n\n");

    const { text } = await generateText({
      model: openai("gpt-4.1-nano"),
      maxOutputTokens: 250,
      temperature: 0.5,
      messages: [
        {
          role: "system",
          content: `
            You are an AI Risk Advisor. Use ONLY the provided evidence
            to ground your answer.

            --- evidence ---
            ${contextText}
            --- end evidence ---
                      `.trim(),
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
