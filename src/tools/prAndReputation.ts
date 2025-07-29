import { tool } from "ai";
import { z } from "zod";

export const prAndReputationTool = tool({
  description:
    "Public Relations & Brand Strategist. Evaluates how the decision may be perceived by the public, media, and stakeholders.",
  parameters: z.object({
    decision: z.string(),
  }),
  execute: async ({ decision }) => {
    return `
📣 PR & Reputation Analysis of: "${decision}"

- How might the general public, customers, media, or investors interpret this decision?
- Are there risks of reputational damage, public backlash, or misalignment with brand values?
- Does this decision support or contradict public commitments (e.g., ESG, diversity, transparency)?
- Would this require a communication plan or proactive press strategy?

🧭 Recommendation: Proceed with clear messaging if aligned, or prepare a PR mitigation plan.
    `.trim();
  },
});
