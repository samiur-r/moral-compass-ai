"use client";

import { useState } from "react";
// If you’re on AI SDK v5:
import { useCompletion } from "@ai-sdk/react";
// If you haven’t migrated yet, the old path "ai/react" still works on older versions.

export default function MoralCompassPage() {
  const [inputPrompt, setInputPrompt] = useState("");

  const { completion, complete, isLoading, error } = useCompletion({
    api: "/api/decision",
    // (optional) streamProtocol: 'text' // defaults are fine for most cases
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await complete(inputPrompt); // streams back into `completion`
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
          disabled={isLoading}
        >
          {isLoading ? "Analyzing..." : "Run Moral Compass"}
        </button>
      </form>

      {/* Streamed text appears here */}
      {completion && (
        <div className="mt-10 space-y-6">
          <h2 className="text-xl font-semibold text-green-700">
            ✅ Final Recommendation
          </h2>
          <div className="bg-green-50 border border-green-200 p-4 rounded whitespace-pre-wrap">
            {completion}
          </div>
        </div>
      )}

      {error && (
        <p className="mt-6 text-red-600">
          Something went wrong: {String(error)}
        </p>
      )}
    </main>
  );
}
