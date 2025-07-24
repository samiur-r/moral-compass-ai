import { tool } from "ai";
import { z } from "zod";

export const environmentTool = tool({
  description: "Environmental ethics expert. Analyze environmental impact.",
  parameters: z.object({
    decision: z.string(),
  }),
  execute: async ({ decision }) => {
    return `Environmental agent analysis for: ${decision}`;
    // later: call GPT or RAG here
  },
});
