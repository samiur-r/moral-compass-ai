"use client";

import { useEffect, useMemo, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import type { MoralMessage, AgentData, SynthesisData } from "@/types/ai";

export default function MoralCompassPage() {
  const [input, setInput] = useState("");

  const { messages, sendMessage, status, error } = useChat<MoralMessage>({
    transport: new DefaultChatTransport({ api: "/api/decision" }),
  });

  const lastAi = useMemo(
    () => [...messages].reverse().find((m) => m.role === "assistant"),
    [messages]
  );

  const agentParts = useMemo(() => {
    const parts = (lastAi?.parts ?? []).filter(
      (p): p is { type: "data-agent"; data: AgentData } =>
        p.type === "data-agent" && p.data?.tool !== "synthesis"
    );

    const agentMap = new Map<string, AgentData>();
    for (const part of parts) {
      agentMap.set(part.data.tool, part.data);
    }

    return Array.from(agentMap.values());
  }, [lastAi]);

  const synthesis =
    (
      lastAi?.parts.find((p) => p.type === "data-synthesis") as
        | { type: "data-synthesis"; data: SynthesisData }
        | undefined
    )?.data ?? null;

  const synthesisIsRunning = useMemo(() => {
    const parts = lastAi?.parts ?? [];

    const isRunning = parts.some(
      (p) =>
        p.type === "data-agent" &&
        p.data?.tool === "synthesis" &&
        p.data.status === "running"
    );

    const isDone = parts.some((p) => p.type === "data-synthesis");

    return isRunning && !isDone;
  }, [lastAi]);

  const textParts =
    (lastAi?.parts.filter((p) => p.type === "text") as Array<{
      type: "text";
      text: string;
    }>) ?? [];

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    await sendMessage({ text: input });
    setInput("");
  };

  const isBusy = status === "submitted" || status === "streaming";

  const formatToolName = (tool: string) =>
    tool.replace(/([A-Z])/g, " $1").replace(/^./, (s) => s.toUpperCase());

  return (
    <main className="max-w-3xl mx-auto py-12 px-4">
      <h1 className="text-3xl font-bold mb-6">🧭 Moral Compass AI</h1>

      <form onSubmit={onSubmit} className="space-y-4">
        <textarea
          className="w-full p-3 border rounded"
          rows={4}
          placeholder="Enter your decision prompt. e.g. We are running low on budget. Thinking to layoff some members of the tech team"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={isBusy}
        />
        <button
          type="submit"
          className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          disabled={isBusy}
        >
          {isBusy ? "Analyzing..." : "Run Moral Compass"}
        </button>
      </form>

      {error && <p className="mt-6 text-red-600">{String(error)}</p>}

      {agentParts.length > 0 && (
        <div className="mt-10 space-y-4">
          {agentParts.map((agent) => (
            <div key={agent.tool} className="border rounded p-4 bg-white">
              <div className="text-sm uppercase tracking-wide text-gray-500">
                {formatToolName(agent.tool)} agent{" "}
                {agent.status === "running" ? "• running…" : ""}
              </div>
              {agent.output && (
                <pre className="whitespace-pre-wrap mt-2">{agent.output}</pre>
              )}
            </div>
          ))}
        </div>
      )}

      {synthesisIsRunning && (
        <div className="mt-6 border rounded p-4 bg-yellow-50 text-yellow-800">
          <strong>Synthesis agent</strong> is running...
        </div>
      )}

      {synthesis && (
        <div className="mt-6 border rounded p-4 bg-green-50">
          <h2 className="text-lg font-semibold">Synthesis</h2>
          <p className="mt-2 whitespace-pre-wrap">{synthesis.summary}</p>
          <div className="mt-2 text-sm text-gray-600">
            Agents used: {synthesis.agentsUsed.join(", ")} · Confidence:{" "}
            <strong>{Math.round(synthesis.confidence * 100)}%</strong>
          </div>
        </div>
      )}

      {textParts.length > 0 && (
        <div className="mt-10 bg-green-50 border border-green-200 p-4 rounded whitespace-pre-wrap">
          {textParts.map((p, i) => (
            <span key={i}>{p.text}</span>
          ))}
        </div>
      )}
    </main>
  );
}
