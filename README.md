# 🧭 Moral Compass AI

A multi-agent AI system that simulates ethical decision-making from different stakeholder perspectives — powered by the Vercel AI SDK and OpenAI function calling.

---

## 🔍 What It Does

Given a decision (e.g., "Should we open a factory in Brazil?"), the app:

1. Lets the LLM decide which ethical lens agents to activate.
2. Each agent analyzes the decision (law, DEI, environment, economics, etc.).
3. The LLM calls those agents as tools.
4. Ends with a structured summary using the `answer` tool.

All orchestrated with multi-step reasoning via the Vercel AI SDK.

---

## ⚙️ Features

- ✅ Multi-agent architecture (each "agent" is a tool)
- 🧠 LLM decides which agents to use dynamically
- 🔁 Multi-step reasoning with `maxSteps`
- 📦 Uses OpenAI GPT-4o
- 🧩 Modular agent design (e.g., `lawTool`, `environmentTool`)
- 💡 UI built with React + Tailwind (WIP)
- 🧪 Agent outputs + decision reasoning trace

---

## 🏗 Tech Stack

| Layer    | Tool                           |
| -------- | ------------------------------ |
| Frontend | Next.js (App Router), Tailwind |
| Backend  | Edge API Routes via Vercel     |
| AI       | Vercel AI SDK + OpenAI GPT     |
| Tools    | Zod + custom agent modules     |

---

## 🚀 Quick Start

1. **Clone the repo**

```
git clone https://github.com/samiur-r/moral-compass-ai.git
cd moral-compass-ai
```

2. **Install dependencies**

```
yarn install
```

3. **Set environment variables**

Create `.env.local`:

```
OPENAI_API_KEY=your-openai-api-key
```

4. **Run the dev server**

```
yarn dev
```

---

## 🧠 Example Prompts

- "Should we open a factory in Brazil?"
- "Is it ethical to replace cashiers with self-checkout kiosks?"
- "Should we use AI for hiring decisions?"

---

## 📁 Folder Structure

```
/tools         → All agent tools (lawTool, environmentTool, etc.)
/app/api       → Edge functions (main logic in api/decision)
/app/page.tsx  → Frontend form + display
```

---

## 📄 License

MIT License.
