import { tool } from "ai";
import { z } from "zod";

export const answerTool = tool({
  description: "Final structured recommendation after all analysis.",
  parameters: z.object({
    summary: z.string(),
    agentsUsed: z.array(z.string()),
    confidence: z.number().min(0).max(1),
  }),
});
