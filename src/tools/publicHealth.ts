import { tool } from "ai";
import { z } from "zod";

export const publicHealthTool = tool({
  description:
    "Public health advocate. Evaluates impacts on worker and community health.",
  parameters: z.object({
    decision: z.string(),
  }),
  execute: async ({ decision }) => {
    return `Public Health Perspective on: "${decision}"\n\n- Consider occupational exposure, mental health, and community disease risk.\n- Recommend health impact assessment if needed.`;
  },
});
