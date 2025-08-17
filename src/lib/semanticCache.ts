import { embed } from "ai";
import { openai } from "@ai-sdk/openai";
import { Pinecone } from "@pinecone-database/pinecone";
import crypto from "crypto";

const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY! });
const cacheIndex = pc
  .index(process.env.PINECONE_INDEX || "moral-compass-ai")
  .namespace("cache");


export class SemanticCache {
  private similarityThreshold = 0.85; // Cosine similarity threshold

  async get(input: string): Promise<unknown | null> {
    // Generate embedding for input
    const { embedding } = await embed({
      model: openai.embedding("text-embedding-3-small"),
      value: input,
    });

    // Query Pinecone for similar cached queries
    const queryResult = await cacheIndex.query({
      vector: embedding,
      topK: 1,
      includeMetadata: true,
    });

    if (queryResult.matches && queryResult.matches.length > 0) {
      const match = queryResult.matches[0];
      const similarity = match.score || 0;
      
      if (similarity >= this.similarityThreshold) {
        const metadata = match.metadata;
        
        console.log(`🎯 SEMANTIC CACHE HIT: similarity ${similarity.toFixed(3)} for "${input.slice(0, 50)}..."`);
        console.log(`   Original query: "${(metadata?.input as string)?.slice(0, 50)}..."`);
        
        try {
          return JSON.parse(metadata?.result as string);
        } catch (e) {
          console.warn(`Failed to parse cached result: ${e}`);
          return null;
        }
      }
    }
    
    console.log(`❌ SEMANTIC CACHE MISS: No similar queries found for "${input.slice(0, 50)}..."`);
    return null;
  }

  async set(input: string, result: unknown): Promise<void> {
    // Generate embedding for input
    const { embedding } = await embed({
      model: openai.embedding("text-embedding-3-small"),
      value: input,
    });

    // Create a unique ID for this cache entry
    const id = crypto.createHash('sha256').update(input + Date.now()).digest('hex').slice(0, 16);

    const metadata = {
      input,
      result: JSON.stringify(result),
      timestamp: Date.now(),
    };

    // Store in Pinecone cache namespace
    await cacheIndex.upsert([{
      id: `cache-${id}`,
      values: embedding,
      metadata,
    }]);
    
    console.log(`💾 SEMANTIC CACHE SET: Cached result for "${input.slice(0, 50)}..."`);
  }
}

export const semanticCache = new SemanticCache();