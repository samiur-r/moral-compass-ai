import { retrieveEvidence } from "@/lib/cachedPinecone";
import { getCachedAgentResponse, setCachedAgentResponse } from "@/lib/agentCache";
import { openai } from "@ai-sdk/openai";
import { generateText, tool } from "ai";
import z from "zod";

export const aiRiskTool = tool({
  description:
    "Use this tool if the decision involves AI, algorithms, automation, or digital systems that may create risks around bias, explainability, fairness, or regulation.",
  inputSchema: z.object({
    decision: z.string(),
    clientId: z.string().optional(),
  }),
  execute: async ({ decision, clientId }) => {
    const startTime = Date.now();
    
    // Try to get cached response first
    const cachedResponse = await getCachedAgentResponse({
      decision,
      agentType: "aiRisk",
    });
    
    if (cachedResponse.hit && cachedResponse.data) {
      console.log(`[AI_RISK] Cache hit, saved ${cachedResponse.data.costSaved.toFixed(4)} USD`);
      return cachedResponse.data.response;
    }
    
    // Cache miss - retrieve evidence and generate response
    const evidenceResult = await retrieveEvidence(decision, 5, "aiRisk", clientId);
    const contextText = evidenceResult.results.map((e) => `${e.id} ${e.text}`).join("\n\n");

    const { text } = await generateText({
      model: openai("gpt-4.1-nano"),
      maxOutputTokens: 250,
      temperature: 0.5,
      messages: [
        {
          role: "system",
          content: `
            You are an AI Risk Advisor. Use ONLY the provided evidence
            to ground your answer. Be concise and practical. Do not use Markdown.

            --- evidence ---
            ${contextText}
            --- end evidence ---
            
            Evidence source: ${evidenceResult.cached ? 'cached' : 'fresh'} (${evidenceResult.queryTime}ms)
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
- Overall <= 180 words
          `.trim(),
        },
      ],
    });

    // Cache the response for future use
    const processingTime = Date.now() - startTime;
    await setCachedAgentResponse(
      {
        decision,
        agentType: "aiRisk",
      },
      text,
      processingTime
    );

    return text;
  },
});
