"use client";

import { useMemo, useState, useCallback } from "react";
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

  const isBusy = status === "submitted" || status === "streaming";

  const onSubmit = useCallback(
    async (e?: React.FormEvent) => {
      if (e) e.preventDefault();
      if (!input.trim() || isBusy) return;
      await sendMessage({ text: input.trim() });
      setInput("");
    },
    [input, isBusy, sendMessage]
  );

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      void onSubmit();
    }
  };

  const formatToolName = (tool: string) =>
    tool.replace(/([A-Z])/g, " $1").replace(/^./, (s) => s.toUpperCase());

  return (
    <main className="max-w-3xl mx-auto py-10 px-4 md:px-6">
      <section className="relative overflow-hidden rounded-2xl border bg-gradient-to-r from-blue-600 via-indigo-600 to-violet-600 text-white shadow-sm">
        <div className="p-6 md:p-7">
          <div className="flex items-center gap-3">
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-white/10 ring-1 ring-white/20">
              <span className="text-xl">🧭</span>
            </span>
            <div>
              <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">
                Moral Compass AI
              </h1>
              <p className="mt-1 text-white/80 text-sm">
                A calmer, clearer way to reason about tough decisions.
              </p>
            </div>
          </div>
        </div>
      </section>
      <section className="mt-8">
        <div className="rounded-2xl border bg-white shadow-sm dark:bg-neutral-900 dark:border-neutral-800">
          <div className="px-5 pt-5 pb-3 flex items-center justify-between">
            <h2 className="text-sm font-medium text-neutral-700 dark:text-neutral-200">
              New prompt
            </h2>
            <kbd className="rounded bg-neutral-100 dark:bg-neutral-800 px-2 py-1 text-xs text-neutral-500">
              ⌘ / Ctrl + Enter
            </kbd>
          </div>
          <div className="px-5 pb-5">
            <form onSubmit={onSubmit} className="space-y-3" aria-live="polite">
              <textarea
                placeholder="e.g. We are shifting part of our supply chain to a country with lower labor costs but weaker labor rights protections. What should we consider before making the move?"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onKeyDown}
                disabled={isBusy}
                rows={5}
                className="w-full resize-y rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-3.5 text-sm text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-60"
              />
              <div className="flex items-center justify-between">
                <p className="text-xs text-neutral-500">
                  Be specific about constraints, stakeholders, and risks.
                </p>
                <button
                  type="submit"
                  disabled={isBusy || !input.trim()}
                  className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-white shadow-sm transition hover:bg-indigo-700 disabled:opacity-60 disabled:hover:bg-indigo-600"
                >
                  {isBusy ? (
                    <>
                      <Spinner className="h-4 w-4" />
                      <span>Analyzing…</span>
                    </>
                  ) : (
                    <>
                      <span>▶</span>
                      <span>Run Moral Compass</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      </section>
      {error && (
        <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 p-4 text-red-900">
          <div className="flex items-start gap-3">
            <span className="text-lg">⚠️</span>
            <div>
              <div className="font-semibold">Something went wrong</div>
              <div className="mt-1 text-sm break-words">{String(error)}</div>
            </div>
          </div>
        </div>
      )}
      {!error &&
        agentParts.length === 0 &&
        !synthesis &&
        !synthesisIsRunning && (
          <div className="mt-10 rounded-2xl border border-dashed bg-white p-10 text-center text-neutral-500 shadow-sm dark:bg-neutral-900 dark:border-neutral-800">
            <div className="text-2xl mb-2">🤖</div>
            <p className="text-sm">
              Start by describing your situation. We’ll spin up specialist
              agents and combine their perspectives.
            </p>
          </div>
        )}
      {agentParts.length > 0 && (
        <section className="mt-8">
          <div className="mb-3 flex items-center gap-2">
            <h3 className="text-xs font-semibold tracking-wide text-neutral-500 uppercase">
              Agents
            </h3>
            <div className="h-px flex-1 bg-neutral-200 dark:bg-neutral-800" />
          </div>
          <div className="space-y-4">
            {agentParts.map((agent) => (
              <AgentCard
                key={agent.tool}
                agent={agent}
                formatToolName={formatToolName}
              />
            ))}
          </div>
        </section>
      )}
      {synthesisIsRunning && (
        <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-900">
          <div className="flex items-center gap-2">
            <Spinner className="h-4 w-4" />
            <div className="font-medium">Synthesis agent is running…</div>
          </div>
          <p className="mt-1 text-sm">
            We’re merging perspectives into a single recommendation.
          </p>
        </div>
      )}
      {synthesis && (
        <section className="mt-8">
          <div className="rounded-2xl border border-green-200 bg-white p-5 shadow-sm dark:bg-neutral-900 dark:border-green-900/40">
            <div className="flex items-center gap-2">
              <span className="text-green-600">✨</span>
              <h3 className="text-base font-semibold">Synthesis</h3>
              <span className="ml-auto inline-flex items-center rounded-full border border-green-200 bg-green-50 px-2 py-0.5 text-xs text-green-700">
                ✓ Ready
              </span>
            </div>
            <p className="mt-3 whitespace-pre-wrap leading-relaxed text-neutral-800 dark:text-neutral-200">
              {synthesis.summary}
            </p>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div>
                <div className="text-xs text-neutral-500 mb-1">Agents used</div>
                <div className="flex flex-wrap gap-1.5">
                  {synthesis.agentsUsed.map((a) => (
                    <span
                      key={a}
                      className="inline-flex items-center rounded-full border bg-white dark:bg-neutral-900 border-neutral-200 dark:border-neutral-700 px-2 py-0.5 text-xs text-neutral-700 dark:text-neutral-300"
                    >
                      {a}
                    </span>
                  ))}
                </div>
              </div>
              <div>
                <div className="text-xs text-neutral-500 mb-1">Confidence</div>
                <ProgressBar value={Math.round(synthesis.confidence * 100)} />
              </div>
            </div>
          </div>
        </section>
      )}

      <footer className="mt-10 text-center text-xs text-neutral-500">
        Built with ✦ care. Your prompts are processed securely.
      </footer>
    </main>
  );
}

function AgentCard({
  agent,
  formatToolName,
}: {
  agent: AgentData;
  formatToolName: (tool: string) => string;
}) {
  const running = agent.status === "running";
  const hasOutput = Boolean(agent.output && String(agent.output).length > 0);
  const isPdfLink =
    hasOutput &&
    agent.tool === "generatePdfLog" &&
    typeof agent.output === "string" &&
    agent.output.startsWith("/api/log-pdf");

  return (
    <div
      className={[
        "rounded-2xl border bg-white p-4 shadow-sm dark:bg-neutral-900 dark:border-neutral-800",
        running ? "border-amber-200 bg-amber-50/40 dark:bg-amber-950/20" : "",
      ].join(" ")}
    >
      <div className="flex items-center gap-2">
        <span className="text-neutral-500">📄</span>
        <h4 className="text-base font-semibold text-neutral-800 dark:text-neutral-100">
          {formatToolName(agent.tool)} agent
        </h4>
        <div className="ml-auto">
          <StatusBadge status={agent.status} />
        </div>
      </div>
      <div className="mt-2">
        {hasOutput ? (
          isPdfLink ? (
            <a
              href={String(agent.output)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-indigo-600 underline underline-offset-4 hover:text-indigo-700"
            >
              <span>📄</span>
              <span>Download Decision Log (PDF)</span>
            </a>
          ) : (
            <OutputBlock text={String(agent.output)} />
          )
        ) : (
          <p className="text-sm text-neutral-500">No output yet.</p>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: AgentData["status"] }) {
  if (status === "running")
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900 ring-1 ring-amber-200">
        <Spinner className="h-3.5 w-3.5" /> running
      </span>
    );
  if (status === "error")
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-900 ring-1 ring-red-200">
        ⚠️ error
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-700 ring-1 ring-neutral-200">
      ✓ done
    </span>
  );
}

function OutputBlock({ text }: { text: string }) {
  const [raw, setRaw] = useState(false);

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {}
  };

  const html = markdownToHtmlSafe(text);

  return (
    <div className="group relative">
      <div className="flex items-center justify-end gap-2 mb-2">
        <button
          onClick={() => setRaw((v) => !v)}
          className="rounded-lg border border-neutral-200 bg-white px-2 py-1 text-xs text-neutral-700 shadow-sm hover:bg-neutral-50 dark:bg-neutral-900 dark:border-neutral-700 dark:text-neutral-300"
        >
          {raw ? "Rendered" : "Raw"}
        </button>
        <button
          onClick={onCopy}
          className="rounded-lg border border-neutral-200 bg-white px-2 py-1 text-xs text-neutral-700 shadow-sm hover:bg-neutral-50 dark:bg-neutral-900 dark:border-neutral-700 dark:text-neutral-300"
        >
          Copy
        </button>
      </div>

      {raw ? (
        <pre className="whitespace-pre-wrap rounded-xl bg-neutral-50 dark:bg-neutral-800 p-3 text-sm leading-relaxed text-neutral-800 dark:text-neutral-100 break-words">
          {text}
        </pre>
      ) : (
        <div
          className="max-w-none text-[15px] leading-relaxed text-neutral-800 dark:text-neutral-100 break-words space-y-3"
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: html }}
        />
      )}
    </div>
  );
}

function markdownToHtmlSafe(md: string): string {
  if (!md) return "";

  let s = md.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  s = s.replace(/```([\s\S]*?)```/g, function (_match, code) {
    return (
      '<pre class="rounded-xl bg-neutral-50 dark:bg-neutral-800 p-3 overflow-x-auto"><code>' +
      String(code)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;") +
      "</code></pre>"
    );
  });

  s = s.replace(
    /`([^`]+)`/g,
    '<code class="rounded bg-neutral-100 dark:bg-neutral-800 px-1">$1</code>'
  );

  s = s.replace(/(\*\*|__)(.*?)\1/g, "<strong>$2</strong>");
  s = s.replace(/(\*|_)(.*?)\1/g, "<em>$2</em>");

  s = s.replace(
    /^######\s+(.+)$/gm,
    '<h6 class="mt-4 mb-1 font-semibold">$1</h6>'
  );
  s = s.replace(
    /^#####\s+(.+)$/gm,
    '<h5 class="mt-4 mb-1 font-semibold">$1</h5>'
  );
  s = s.replace(
    /^####\s+(.+)$/gm,
    '<h4 class="mt-4 mb-1 font-semibold">$1</h4>'
  );
  s = s.replace(
    /^###\s+(.+)$/gm,
    '<h3 class="mt-4 mb-1 font-semibold">$1</h3>'
  );
  s = s.replace(/^##\s+(.+)$/gm, '<h2 class="mt-4 mb-1 font-semibold">$1</h2>');
  s = s.replace(/^#\s+(.+)$/gm, '<h1 class="mt-4 mb-1 font-semibold">$1</h1>');

  s = s
    .split(/\n\n+/)
    .map(function (block) {
      if (/^(\s*[-*+]\s+)/.test(block)) {
        const items = block
          .split(/\n/)
          .map(function (l) {
            return l.replace(/^\s*[-*+]\s+/, "").trim();
          })
          .filter(Boolean)
          .map(function (t) {
            return '<li class="my-1">' + t + "</li>";
          })
          .join("");
        return '<ul class="list-disc pl-5">' + items + "</ul>";
      }
      if (/^(\s*\d+[\.\])]\s+)/.test(block)) {
        const items2 = block
          .split(/\n/)
          .map(function (l) {
            return l.replace(/^\s*\d+[\.\)]\s+/, "").trim();
          })
          .filter(Boolean)
          .map(function (t) {
            return '<li class="my-1">' + t + "</li>";
          })
          .join("");
        return '<ol class="list-decimal pl-5">' + items2 + "</ol>";
      }
      return (
        '<p class="leading-relaxed">' + block.replace(/\n/g, "<br/>") + "</p>"
      );
    })
    .join("\n");

  return s;
}

function ProgressBar({ value }: { value: number }) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div>
      <div className="relative h-2 w-full overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
        <div
          className="h-full rounded-full bg-green-500 transition-[width]"
          style={{ width: pct + "%" }}
        />
      </div>
      <div className="mt-2 text-sm font-medium tabular-nums text-neutral-800 dark:text-neutral-200">
        {pct}%
      </div>
    </div>
  );
}

function Spinner({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      className={["animate-spin", className].join(" ")}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      ></circle>
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
      ></path>
    </svg>
  );
}
