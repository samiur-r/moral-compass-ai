import { embed } from "ai";
import { openai } from "@ai-sdk/openai";
import { Pinecone } from "@pinecone-database/pinecone";
const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY! });
const index = pc
  .index(process.env.PINECONE_INDEX || "moral-compass-ai")
  .namespace("__default__");

export async function retrieveEvidence(query: string, topK = 5) {
  const { embedding } = await embed({
    model: openai.embedding("text-embedding-3-small"),
    value: query,
  });

  const res = await index.query({
    vector: embedding,
    topK,
    includeMetadata: true,
    filter: { domain: "aiRisk" },
  });

  return (res.matches ?? []).map((m, i) => {
    const md: any = m.metadata;
    return {
      id: `[#${i + 1}]`,
      text: md.text as string,
      source: md.url || md.doc_id,
    };
  });
}
