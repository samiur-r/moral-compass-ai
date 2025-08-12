import { createHmac, timingSafeEqual } from "crypto";
import { deflateSync, inflateSync } from "zlib";

const SECRET = process.env.PDF_TOKEN_SECRET || "dev-only-insecure-secret";

const b64url = (buf: Buffer) =>
  buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
const fromB64url = (s: string) =>
  Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");

export type PdfPayload = {
  decision: string;
  agentResults?: Record<string, string>;
  synthesis?: { summary?: string; agentsUsed?: string[]; confidence?: number };
  timestamp?: string;
  exp?: number; // seconds since epoch
};

export function createPdfToken(
  data: Omit<PdfPayload, "exp">,
  ttlSec = 60 * 60
) {
  const payload: PdfPayload = {
    ...data,
    exp: Math.floor(Date.now() / 1000) + ttlSec,
  };
  const json = Buffer.from(JSON.stringify(payload));
  const compressed = deflateSync(json);
  const body = b64url(compressed);
  const sig = b64url(createHmac("sha256", SECRET).update(body).digest());
  return `${body}.${sig}`;
}

export function verifyPdfToken(token: string): PdfPayload | null {
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = b64url(createHmac("sha256", SECRET).update(body).digest());
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  const json = inflateSync(fromB64url(body)).toString("utf8");
  const payload = JSON.parse(json) as PdfPayload;
  if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}
