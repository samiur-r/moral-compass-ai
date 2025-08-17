# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

- **Development server**: `pnpm dev` or `npm run dev` (uses Turbopack for faster builds)
- **Build**: `pnpm build` or `npm run build`
- **Production server**: `pnpm start` or `npm run start`
- **Linting**: `pnpm lint` or `npm run lint`
- **Type checking**: Use TypeScript compiler directly with `npx tsc --noEmit`

## Architecture Overview

This is a **multi-agent AI decision analysis system** built as a Next.js application that evaluates organizational decisions from multiple perspectives.

### Core Flow
1. User submits decision query to `/api/decision`
2. Safety moderation and PII redaction via `src/lib/safety.ts`
3. Rate limiting enforcement via `src/lib/rateLimit.ts` 
4. AI orchestration using `@ai-sdk` with specialized tools
5. Parallel execution of relevant agent tools
6. Synthesis of results into unified recommendation
7. Optional PDF report generation

### Agent Tools (`src/tools/`)
Each tool represents a specialized advisor:
- **lawTool**: Legal compliance and risk analysis
- **economistTool**: Economic and financial impact assessment
- **prAndReputationTool**: Public relations and brand risk evaluation
- **environmentTool**: Environmental impact and sustainability analysis
- **deiTool**: Diversity, equity, and inclusion considerations
- **publicHealthTool**: Public safety and health implications
- **aiRiskTool**: AI/automation bias and regulatory compliance (uses RAG)
- **synthesisTool**: Merges all findings into final recommendation
- **generatePdfLogTool**: Creates downloadable decision report

### Key Technical Components

**RAG System**: The `aiRiskTool` uses Pinecone vector database for retrieval-augmented generation:
- Evidence retrieval via `src/lib/pinecone.ts`
- Semantic search with OpenAI embeddings (`text-embedding-3-small`)
- Grounded responses using filtered evidence from `aiRisk` namespace

**Safety System** (`src/lib/safety.ts`):
- OpenAI moderation API (`omni-moderation-latest`) for input validation
- PII redaction for emails, phones, credit cards
- Output safety enforcement for synthesis results

**Rate Limiting** (`src/lib/rateLimit.ts`):
- Upstash Redis for production rate limiting
- In-memory fallback for local development
- Configurable limits: 20 requests/10min for chat, 5 requests/1min for PDF

**Model Configuration**:
- Primary model: `gpt-4.1-nano` (configurable in route.ts:84)
- Max tool output tokens: 250 (keeps responses concise)
- Step limit: 10 to prevent runaway tool calls
- Tool choice: "auto" for intelligent agent selection

### Environment Variables Required
- `OPENAI_API_KEY`: OpenAI API access
- `PINECONE_API_KEY`: Vector database access
- `PINECONE_INDEX`: Index name (defaults to "moral-compass-ai")
- `UPSTASH_REDIS_REST_URL` / `KV_REST_API_URL`: Redis for rate limiting
- `UPSTASH_REDIS_REST_TOKEN` / `KV_REST_API_TOKEN`: Redis auth token

### Type Definitions
- `src/types/ai.ts`: Core types for agent data and synthesis results
- UI message streaming types from `@ai-sdk/react`
- Agent tools return string outputs, synthesis returns structured data

### File Paths
- API routes: `src/app/api/`
- Shared utilities: `src/lib/`
- Agent implementations: `src/tools/`
- Type definitions: `src/types/`
- Configuration: Root level (`tsconfig.json`, `next.config.ts`, etc.)