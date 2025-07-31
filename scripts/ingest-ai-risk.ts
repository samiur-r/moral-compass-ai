import { embedMany } from "ai";
import { openai } from "@ai-sdk/openai";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import fs from "node:fs/promises";
import path from "node:path";
import pdfParse from "pdf-parse";
import { Pinecone } from "@pinecone-database/pinecone";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "../.env.local") });

const DATA_DIR = path.join(process.cwd(), "data");
const INDEX_NAME = "moral-compass-ai";
const NAMESPACE = "__default__";

// Chunking targets: ~900 tokens ~= ~3.6–4.0k characters (English)
// We do sentence packing to keep coherent chunks.
const CHUNK_TARGET_CHARS = 3800;
const CHUNK_OVERLAP_SENTENCES = 2;

// Batch sizes
const EMBED_SLICE_SIZE = 64; // values per embedMany call (AI SDK will also auto-split if needed)
const UPSERT_BATCH_SIZE = 150;

// Minimum useful text lengths (skip tiny fragments)
const MIN_SECTION_CHARS = 120;
const MIN_CHUNK_CHARS = 120;

type Meta = {
  domain: "aiRisk";
  title: string;
  publisher?: string;
  url?: string;
  date?: string;
  jurisdiction?: string;
  doc_id: string;
};

// ---------------------------
// Helpers: PDF, cleaning, sectioning
// ---------------------------
async function readPdfText(filePath: string) {
  const buf = await fs.readFile(filePath);
  const parsed = await pdfParse(buf);
  return parsed.text;
}

function normalize(text: string) {
  return text
    .replace(/\r/g, "")
    .replace(/-\n(?=[a-z])/g, "") // de-hyphenate mid-word line breaks
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function stripLikelyFrontMatter(fullText: string) {
  // crude heuristic to skip cover/TOC/acknowledgments
  const idx = fullText.search(/\n(Introduction|Executive Summary|Scope)\b/i);
  return idx > 0 ? fullText.slice(idx) : fullText;
}

function tagSections(text: string, docId: string) {
  // lightweight section splitting on lines that look like headings
  const parts = text.split(/\n(?=[A-Z][A-Za-z0-9 ,:;()\/-]{3,100}\n)/g);
  return parts.map((p, i) => ({
    section: `sec-${i + 1}`,
    text: p.trim(),
    docId,
  }));
}

// ---------------------------
// Chunking (sentence-pack with overlap)
// ---------------------------
function splitSentences(s: string) {
  return s
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+(?=[A-Z(“"0-9])/)
    .map((x) => x.trim())
    .filter(Boolean);
}

function chunkBySentences(
  text: string,
  targetChars = CHUNK_TARGET_CHARS,
  overlapSentences = CHUNK_OVERLAP_SENTENCES
) {
  const sents = splitSentences(text);
  const chunks: string[] = [];
  let buf: string[] = [];

  for (const sent of sents) {
    const next = (buf.join(" ") + " " + sent).trim();
    if (next.length > targetChars && buf.length) {
      chunks.push(buf.join(" ").trim());
      // carry overlap
      buf = buf.slice(-overlapSentences);
    }
    buf.push(sent);
  }
  if (buf.length) chunks.push(buf.join(" ").trim());
  return chunks;
}

// ---------------------------
// Embeddings via Vercel AI SDK
// ---------------------------
async function embedBatch(texts: string[]) {
  const { embeddings } = await embedMany({
    model: openai.embedding("text-embedding-3-small"), // 512-D
    values: texts,
  });
  return embeddings;
}

// ---------------------------
// Ingest pipeline for one PDF
// ---------------------------
async function readWithMeta(
  fullPdfPath: string
): Promise<{ text: string; meta: Meta }> {
  const metaPath = fullPdfPath + ".meta.json";
  const meta = JSON.parse(await fs.readFile(metaPath, "utf8")) as Meta;
  const text = await readPdfText(fullPdfPath);
  return { text, meta };
}

async function upsertDoc(
  pdfPath: string,
  index: ReturnType<Pinecone["index"]>
) {
  const base = path.basename(pdfPath);
  const { text, meta } = await readWithMeta(pdfPath);

  // 1) clean
  const cleaned = normalize(stripLikelyFrontMatter(text));

  // 2) section hinting
  const sections = tagSections(cleaned, meta.doc_id);

  // 3) chunk -> embed -> upsert
  let gid = 0;
  const pending: {
    id: string;
    values: number[];
    metadata: Record<string, any>;
  }[] = [];

  for (const s of sections) {
    if (s.text.length < MIN_SECTION_CHARS) continue;

    const chunks = chunkBySentences(
      s.text,
      CHUNK_TARGET_CHARS,
      CHUNK_OVERLAP_SENTENCES
    ).filter((c) => c.trim().length > MIN_CHUNK_CHARS);

    // embed in slices (predictable memory) — embedMany also auto-chunks internally
    for (let i = 0; i < chunks.length; i += EMBED_SLICE_SIZE) {
      const slice = chunks.slice(i, i + EMBED_SLICE_SIZE);
      const vecs = await embedBatch(slice);

      vecs.forEach((v, k) => {
        gid += 1;
        pending.push({
          id: `${meta.doc_id}:${gid}`,
          values: v,
          metadata: {
            ...meta, // domain, title, url, date, jurisdiction, doc_id
            section: s.section,
            text: slice[k],
            source_file: base,
          },
        });
      });
    }
  }

  // 4) Pinecone upsert in batches
  for (let i = 0; i < pending.length; i += UPSERT_BATCH_SIZE) {
    const batch = pending.slice(i, i + UPSERT_BATCH_SIZE);
    await index.upsert(batch);
  }

  console.log(`Upserted ${pending.length} vectors from ${base}`);
}

// ---------------------------
// Main
// ---------------------------
async function main() {
  if (!INDEX_NAME) {
    throw new Error("PINECONE_INDEX is required");
  }
  if (!process.env.PINECONE_API_KEY) {
    throw new Error("PINECONE_API_KEY is required");
  }
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is required");
  }

  const pc = new Pinecone({
    apiKey: process.env.PINECONE_API_KEY!,
  });
  const index = pc.index(INDEX_NAME).namespace(NAMESPACE);

  const files = (await fs.readdir(DATA_DIR))
    .filter((f) => f.endsWith(".pdf"))
    .map((f) => path.join(DATA_DIR, f));

  if (files.length === 0) {
    console.warn(`No PDFs found in ${DATA_DIR}`);
    return;
  }

  for (const f of files) {
    try {
      await upsertDoc(f, index);
    } catch (err) {
      console.error(`Failed to ingest ${path.basename(f)}:`, err);
    }
  }

  console.log("Ingestion complete.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
