import type { UIMessage } from "ai";

export type AgentData = {
  tool: string;
  output?: string;
  status: "running" | "done";
};

export type SynthesisData = {
  summary: string;
  agentsUsed: string[];
  confidence: number;
};

export type MoralMessage = UIMessage<
  never,
  {
    agent: AgentData;
    synthesis: SynthesisData;
  }
>;
