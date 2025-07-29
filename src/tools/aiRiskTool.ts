import { tool } from "ai";
import { z } from "zod";

export const aiRiskTool = tool({
  description:
    "AI risk advisor. Assesses automation, algorithmic bias, and explainability in tech decisions.",
  parameters: z.object({
    decision: z.string(),
  }),
  execute: async ({ decision }) => {
    return `AI Risk Analysis of: "${decision}"\n\n- Identify ethical risks in automation, surveillance, or AI-based decision-making.\n- Evaluate bias, transparency, and regulatory risks (e.g., AI Act, GDPR).`;
  },
});
