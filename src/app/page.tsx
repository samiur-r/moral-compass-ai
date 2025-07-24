"use client";

import { useCompletion } from "ai/react";
import { useState } from "react";

export default function MoralCompassPage() {
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [inputPrompt, setInputPrompt] = useState("");

  const { complete } = useCompletion({
    api: "/api/decision",
    onResponse: async (response) => {
      const data = await response.json();
      setResult(data);
    },
    onError: (err) => {
      console.error("Error:", err);
      alert("Something went wrong.");
    },
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setResult(null);

    await complete(inputPrompt);
    setLoading(false);
  };

  return (
    <main className="max-w-3xl mx-auto py-12 px-4">
      <h1 className="text-3xl font-bold mb-6">🧭 Moral Compass AI</h1>

      <form onSubmit={handleSubmit} className="space-y-4">
        <textarea
          className="w-full p-3 border rounded"
          rows={4}
          placeholder="Enter your decision prompt (e.g. 'Should we open a factory in Brazil?')"
          value={inputPrompt}
          onChange={(e) => setInputPrompt(e.target.value)}
        />

        <button
          type="submit"
          className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          disabled={loading}
        >
          {loading ? "Analyzing..." : "Run Moral Compass"}
        </button>
      </form>

      {result && (
        <div className="mt-10 space-y-6">
          <h2 className="text-xl font-semibold">🔍 Tool Calls</h2>
          <ul className="list-disc pl-5 space-y-2">
            {result.toolCalls?.map((tool: any, idx: number) => (
              <li key={idx}>
                <strong>{tool.tool}:</strong>{" "}
                {tool.input?.decision || "[structured output]"}
              </li>
            ))}
          </ul>

          <h2 className="text-xl font-semibold">🧠 Reasoning Steps</h2>
          <pre className="bg-gray-100 p-4 rounded text-sm overflow-x-auto whitespace-pre-wrap">
            {JSON.stringify(result.steps, null, 2)}
          </pre>
        </div>
      )}
    </main>
  );
}
