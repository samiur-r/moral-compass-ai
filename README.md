# 🧭 Moral Compass AI

A multi-agent AI that evaluates tough organizational decisions from **legal, ethical, economic, reputational, environmental, public health, and AI risk** perspectives — then synthesizes these into a clear recommendation.

---

## 📜 Overview

**Moral Compass AI** runs multiple specialized “agents” in parallel, each with its own expertise and prompt template. Agents return concise findings, which are merged by a **Synthesis Agent** into a unified summary with confidence scoring. Optionally, a PDF log can be generated.

---

## 🛠 Agents

| Agent Name            | Purpose                                                                                                | Example Questions It Handles                                         |
| --------------------- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| `lawTool`             | Identifies legal risks, compliance issues, labor laws, contracts, notification requirements.           | “What laws apply if we lay off remote employees in multiple states?” |
| `economistTool`       | Economic and financial impact analysis, ROI, cost-benefit tradeoffs.                                   | “Will moving production offshore reduce costs in the long run?”      |
| `prAndReputationTool` | Public relations, brand risk, and stakeholder perception.                                              | “Will this decision trigger negative media coverage?”                |
| `environmentTool`     | Environmental impact, regulatory risks, sustainability alignment.                                      | “What is the ecological cost of switching to coal power?”            |
| `deiTool`             | Diversity, equity, and inclusion risks, bias mitigation.                                               | “Will this disproportionately impact a protected group?”             |
| `publicHealthTool`    | Public safety and health implications, relevant public health laws.                                    | “What’s the risk of reopening schools during an outbreak?”           |
| `aiRiskTool`          | AI/automation bias, transparency, AI law compliance. Uses **RAG** from Pinecone for grounded evidence. | “Does our chatbot training process risk violating GDPR?”             |
| `synthesisTool`       | Merges all agent findings into a single recommendation, listing agents used and confidence score.      | N/A — always run at the end.                                         |
| `generatePdfLogTool`  | Produces a PDF report of the decision log.                                                             | N/A — optional post-synthesis step.                                  |

---

## 📈 Flow

1. **User prompt** → Sent to `/api/decision`.
2. **Moderation & Guardrails**
   - `moderateText()` — blocks unsafe prompts.
   - `redactPII()` — removes personal identifiers.
3. **Rate limiting**
   - `limitChat()` uses IP-based keys to prevent abuse (configurable in `/lib/rateLimit`).
4. **Tool orchestration** (`streamText`)
   - Relevant agents run in parallel based on prompt content.
   - AI model: `gpt-4.1-nano` (configurable).
5. **Synthesis Agent** combines results.
6. **PDF log** (optional).
7. **Streaming UI** updates agent cards as results arrive.

---

## 🔒 Guardrails

- **Safety moderation** via `moderateText()` before any LLM call.
- **PII redaction** before tool execution.
- **No hallucinated tools** — enforced in system prompt.
- **Max step count**: stops after 10 orchestration steps to prevent runaway calls.
- **Output limits**: most tools use `maxOutputTokens: 250` to keep responses concise.

---

## 📚 Retrieval-Augmented Generation (RAG)

The **AI Risk Agent (`aiRiskTool`)** uses RAG with [Pinecone](https://www.pinecone.io/) to ground outputs in stored evidence.

**Process:**

1. `retrieveEvidence(decision, 5)` fetches top-5 semantically relevant chunks.
2. Evidence is injected into the system prompt as a context block.
3. Model **must** base recommendations only on that evidence.
4. This mitigates hallucination and anchors advice in verified sources.

---

## ⏳ Rate Limits

- Configurable in `/lib/rateLimit`.
- Defaults:
  - **Per-IP limit**: defined by `limitChat` (e.g., X requests per minute/hour).
  - On limit breach → HTTP 429 with `Rate-Limit-*` headers.

---

## 🚀 Example Prompt

We plan to replace customer support agents with an AI chatbot trained on customer conversations without explicit consent. How risky is this legally, ethically, and reputationally?

---

## 📦 Tech Stack

- **Framework:** Next.js (frontend + backend API routes in a single app)
- **Styling:** Tailwind CSS (utility-first)
- **Orchestration:** `@ai-sdk` for multi-agent streaming
- **LLM Provider:** OpenAI `gpt-4.1-nano` (configurable)
- **Vector Store:** Pinecone (RAG for AI Risk Agent)
- **Rate Limiting:** Upstash Redis (via `/lib/rateLimit`)
- **PDF Generation:** `generatePdfLogTool` for downloadable decision reports

---

## 📄 License

MIT © 2025
