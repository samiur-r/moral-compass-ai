import { tool } from "ai";
import { z } from "zod";
import { getCachedAgentResponse, setCachedAgentResponse, getAgentCacheConfig } from "./agentCache";

// Generic cached tool wrapper
export interface CachedToolConfig {
  agentType: string;
  description: string;
  systemPrompt: string;
  userPromptTemplate: string;
  maxOutputTokens?: number;
  temperature?: number;
  useRAG?: boolean;
}

/**
 * Create a cached version of an agent tool
 */
export function createCachedTool(config: CachedToolConfig) {
  const cacheConfig = getAgentCacheConfig(config.agentType);
  
  return tool({
    description: config.description,
    inputSchema: z.object({
      decision: z.string(),
      clientId: z.string().optional(),
      context: z.object({
        industry: z.string().optional(),
        urgency: z.enum(["low", "medium", "high"]).optional(),
        companySize: z.enum(["startup", "small", "medium", "large"]).optional(),
        geography: z.string().optional(),
      }).optional(),
    }),
    execute: async ({ decision, clientId, context }) => {
      const startTime = Date.now();
      
      // Try to get cached response first
      const cachedResponse = await getCachedAgentResponse({
        decision,
        agentType: config.agentType,
        context,
      });
      
      if (cachedResponse.hit && cachedResponse.data) {
        console.log(`[${config.agentType.toUpperCase()}] Cache hit (${cachedResponse.source}), saved ${cachedResponse.data.costSaved.toFixed(4)} USD`);
        return cachedResponse.data.response;
      }
      
      // Cache miss - generate new response
      console.log(`[${config.agentType.toUpperCase()}] Cache miss, generating new response`);
      
      // Import the AI generate function here to avoid circular dependencies
      const { openai } = await import("@ai-sdk/openai");
      const { generateText } = await import("ai");
      
      const { text } = await generateText({
        model: openai("gpt-4.1-nano"),
        maxOutputTokens: config.maxOutputTokens || 250,
        temperature: config.temperature || 0.5,
        messages: [
          {
            role: "system",
            content: config.systemPrompt,
          },
          {
            role: "user",
            content: config.userPromptTemplate.replace("{decision}", decision),
          },
        ],
      });

      // Cache the response for future use
      const processingTime = Date.now() - startTime;
      await setCachedAgentResponse(
        {
          decision,
          agentType: config.agentType,
          context,
        },
        text,
        processingTime
      );

      console.log(`[${config.agentType.toUpperCase()}] Response generated and cached (${processingTime}ms)`);
      return text;
    },
  });
}

// Predefined tool configurations
export const TOOL_CONFIGS: Record<string, CachedToolConfig> = {
  law: {
    agentType: "law",
    description: "A legal expert agent. Assesses regulatory, labor, and legal compliance issues in the decision.",
    systemPrompt: "You are a legal analyst AI. Given a business decision, analyze the relevant legal concerns. Be concise and practical. Do not use Markdown.",
    userPromptTemplate: `
Decision: "{decision}"

Respond with:
- Potential legal risks (e.g. zoning, contracts, international trade)
- Labor law issues
- Risk of litigation
- Any regulations that may apply
- Recommend whether legal review is needed
- Overall <= 180 words
    `.trim(),
  },
  
  environment: {
    agentType: "environment",
    description: "Environmental ethics expert. Analyze environmental impact.",
    systemPrompt: "You are an environmental ethics agent assessing the ecological consequences of business decisions. Be concise and practical. Do not use Markdown.",
    userPromptTemplate: `
Evaluate the environmental impact of the following decision:

Decision: "{decision}"

Include:
- Ecological risks (e.g. deforestation, pollution, habitat loss)
- Regulatory or conservation conflicts
- Long-term sustainability concerns
- Alignment with environmental ethics or ESG goals
- Recommendation on environmental viability
- Overall <= 180 words
    `.trim(),
  },
  
  economist: {
    agentType: "economist",
    description: "An economic analyst agent. Considers cost-benefit, market conditions, local economic impact, and long-term ROI.",
    systemPrompt: "You are an economist agent evaluating the financial and economic viability of business decisions. Be concise and practical. Do not use Markdown.",
    userPromptTemplate: `
Decision: "{decision}"

Assess the following:
- Capital and operational cost estimates
- ROI potential in the short and long term
- Market conditions and risks
- Impact on local economy and job creation
- Currency, inflation, or trade-related factors
- Overall economic feasibility and strategic recommendation
- Overall <= 180 words
    `.trim(),
  },
  
  dei: {
    agentType: "dei",
    description: "A Diversity, Equity & Inclusion expert agent. Evaluates how the decision impacts marginalized groups, workplace equity, and inclusive growth.",
    systemPrompt: "You are a DEI (Diversity, Equity & Inclusion) advisor analyzing the ethical and social impact of business decisions on marginalized groups and workplace equity. Be concise and practical. Do not use Markdown.",
    userPromptTemplate: `
Decision: "{decision}"

Provide an assessment covering:
- Impact on marginalized or underrepresented groups
- Risks of exclusion, bias, or inequitable outcomes
- Opportunities to promote inclusive hiring or leadership
- Cultural sensitivity concerns
- Whether a DEI review or stakeholder consultation is recommended
- Overall <= 180 words
    `.trim(),
  },
  
  prAndReputation: {
    agentType: "prAndReputation",
    description: "Public Relations & Brand Strategist. Evaluates how the decision may be perceived by the public, media, and stakeholders.",
    systemPrompt: "You are a PR & reputation strategist AI. Analyze public, media, and stakeholder perception of business decisions. Be concise and practical. Do not use Markdown.",
    userPromptTemplate: `
Decision: "{decision}"

Analyze:
- How the public, media, customers, and investors might interpret this decision
- Any potential for reputational damage, backlash, or value misalignment
- Whether this contradicts prior public commitments (e.g., ESG, diversity, transparency)
- If it requires a PR mitigation or communication plan
- Provide a recommendation
- Overall <= 180 words
    `.trim(),
  },
  
  publicHealth: {
    agentType: "publicHealth",
    description: "Public health advocate. Evaluates impacts on worker and community health.",
    systemPrompt: "You are a public health ethics analyst AI. Assess the public and occupational health implications of a given decision. Be concise and practical. Do not use Markdown.",
    userPromptTemplate: `
Decision: "{decision}"

Analyze:
- Potential risks to worker health (physical or mental)
- Community-level health effects (e.g., pollution, access to care, disease exposure)
- Implications for long-term well-being, health equity, or infrastructure
- If any formal Health Impact Assessment (HIA) is recommended
- Provide a brief, structured analysis
- Overall <= 180 words
    `.trim(),
  },
};

// Export cached tools
export const cachedLawTool = createCachedTool(TOOL_CONFIGS.law);
export const cachedEnvironmentTool = createCachedTool(TOOL_CONFIGS.environment);
export const cachedEconomistTool = createCachedTool(TOOL_CONFIGS.economist);
export const cachedDeiTool = createCachedTool(TOOL_CONFIGS.dei);
export const cachedPrAndReputationTool = createCachedTool(TOOL_CONFIGS.prAndReputation);
export const cachedPublicHealthTool = createCachedTool(TOOL_CONFIGS.publicHealth);

/**
 * Batch process multiple agents with caching
 */
export async function batchProcessAgents(
  decision: string,
  agentTypes: string[],
  clientId?: string,
  context?: {
    industry?: string;
    urgency?: "low" | "medium" | "high";
    companySize?: "startup" | "small" | "medium" | "large";
    geography?: string;
  }
): Promise<Map<string, string>> {
  const results = new Map<string, string>();
  
  // Process agents in parallel
  const promises = agentTypes.map(async (agentType) => {
    try {
      const config = TOOL_CONFIGS[agentType];
      if (!config) {
        console.warn(`[BATCH] Unknown agent type: ${agentType}`);
        return;
      }
      
      const tool = createCachedTool(config);
      const result = await tool.execute({ decision, clientId, context });
      results.set(agentType, result);
    } catch (error) {
      console.error(`[BATCH] Error processing ${agentType}:`, error);
      results.set(agentType, `Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  });
  
  await Promise.all(promises);
  return results;
}