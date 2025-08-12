import { tool } from "ai";
import { z } from "zod";
import { createPdfToken } from "@/lib/pdfToken";

const Synthesis = z.object({
  summary: z.string().optional(),
  agentsUsed: z.array(z.string()).optional(),
  confidence: z.number().min(0).max(1).optional(),
});

export const generatePdfLogTool = tool({
  description: "Generate a downloadable PDF report link (stateless).",
  inputSchema: z.object({
    decision: z.string(),
    agentResults: z.any(),
    synthesis: Synthesis.optional(),
    timestamp: z.string().optional(),
  }),
  execute: async (input) => {
    const token = createPdfToken({
      ...input,
      timestamp: input.timestamp ?? new Date().toISOString(),
    });
    // Your UI only checks startsWith("/api/log-pdf"), so this works.
    return `/api/log-pdf/${token}`;
  },
});
