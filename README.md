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
4. **Semantic caching** 
   - Checks for similar queries using vector similarity (0.85 threshold).
   - **Cache hit**: Returns cached results in ~2-3 seconds.
   - **Cache miss**: Proceeds to full processing.
5. **Tool orchestration** (`streamText`)
   - Relevant agents run in parallel based on prompt content.
   - AI model: `gpt-4.1-nano` (configurable).
6. **Synthesis Agent** combines results and caches complete conversation flow.
7. **PDF log** (optional).
8. **Streaming UI** updates agent cards as results arrive.

---

## 🔒 Content Guardrails

- **Safety moderation** via OpenAI moderation API before any LLM call
- **PII redaction** removes emails, phones, credit cards before processing
- **No hallucinated tools** — enforced in system prompt
- **Max step count**: 10 orchestration steps to prevent runaway calls
- **Output limits**: 250 tokens per tool to keep responses concise

---

## 📚 Retrieval-Augmented Generation (RAG)

The **AI Risk Agent (`aiRiskTool`)** uses RAG with [Pinecone](https://www.pinecone.io/) to ground outputs in stored evidence.

**Process:**

1. `retrieveEvidence(decision, 5)` fetches top-5 semantically relevant chunks.
2. Evidence is injected into the system prompt as a context block.
3. Model **must** base recommendations only on that evidence.
4. This mitigates hallucination and anchors advice in verified sources.

---

## ⚡ Semantic Caching

**Intelligent caching system that dramatically improves response times for similar decision queries using vector similarity.**

**How it works:**
1. **Vector Embedding**: User input is converted to embeddings using `text-embedding-3-small`
2. **Similarity Search**: Pinecone searches the `cache` namespace for semantically similar queries
3. **Smart Matching**: Queries with ≥85% similarity return cached results instantly
4. **Full Replay**: Cached responses include complete agent conversation flow

**Performance:**
- **Cache Hit**: ~2-3 seconds (85%+ faster)
- **Cache Miss**: ~15-20 seconds (normal processing + caching for future)
- **Storage**: Vector-based indexing in existing Pinecone infrastructure

**Example Similarity Matching:**
- Original: *"AI hiring system with facial recognition"*
- Similar: *"Automated recruitment AI using facial analysis"* ← **Cache Hit**
- Different: *"Environmental impact of solar panels"* ← **Cache Miss**

**📖 Detailed documentation**: See `.docs/semantic-caching.md`

---

## 🔒 Security

**Multi-layered security implementation designed for test app usage:**

### Rate Limiting (Very Restrictive)
- **5 requests per day** (primary limit for test environment)
- **3 requests per 10 minutes** (burst protection)
- **2 PDF generations per day**
- Enhanced client identification (IP + browser fingerprinting)

### Input Validation
- **Max payload**: 20KB per request
- **Max messages**: 3 messages per request  
- **Max text**: 1,500 characters total
- Prevents resource exhaustion attacks

### Prompt Injection Protection
- **5 detection patterns**: ignore instructions, role confusion, system injection, template injection, safety bypass
- **Risk-based handling**: HIGH risk blocked, MEDIUM/LOW sanitized
- **Security logging**: All injection attempts tracked

### Security Headers
- **XSS Protection**: `X-XSS-Protection: 1; mode=block`
- **Clickjacking Prevention**: `X-Frame-Options: DENY`
- **MIME Protection**: `X-Content-Type-Options: nosniff`
- **Privacy**: `Referrer-Policy: no-referrer`
- **API Security**: Strict CSP and no-cache headers

### Monitoring & Logging
Real-time security event tracking with emoji prefixes for easy filtering:
- 🔍 `REQUEST` - All attempts
- 🚫 `RATE_LIMIT` - Rate violations  
- ❌ `VALIDATION` - Input failures
- 🚨 `HIGH_RISK_INJECTION` - Attack attempts
- ✅ `SUCCESS` - Valid requests

**📖 Complete documentation**: See `.docs/SECURITY.md` for detailed implementation, testing instructions, and troubleshooting guide.

---

## 🚀 Example Prompt

We plan to replace customer support agents with an AI chatbot trained on customer conversations without explicit consent. How risky is this legally, ethically, and reputationally?

---

## 📦 Tech Stack

- **Framework:** Next.js (frontend + backend API routes in a single app)
- **Styling:** Tailwind CSS (utility-first)
- **Orchestration:** `@ai-sdk` for multi-agent streaming
- **LLM Provider:** OpenAI `gpt-4.1-nano` (configurable)
- **Vector Store:** Pinecone (RAG for AI Risk Agent + semantic caching)
- **Caching:** Semantic similarity caching with vector embeddings
- **Rate Limiting:** Upstash Redis (via `/lib/rateLimit`)
- **PDF Generation:** `generatePdfLogTool` for downloadable decision reports

---

## 📄 License

MIT © 2025
