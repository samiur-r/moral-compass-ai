import { NextRequest } from "next/server";
import { verifyPdfToken } from "@/lib/pdfToken";
import { buildMoralCompassPdf } from "@/lib/generatePdf";
import { getClientId, limitPdf, rateHeaders } from "@/lib/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { id: string };

export async function GET(req: NextRequest, ctx: { params: Promise<Params> }) {
  const key = `ip:${getClientId(req)}`;
  const info = await limitPdf(key);
  if (!info.success) {
    return new Response("Too many downloads. Please try again later.", {
      status: 429,
      headers: rateHeaders(info),
    });
  }

  const { id } = await ctx.params; // token
  const payload = verifyPdfToken(id);
  if (!payload) {
    return new Response("Not found or expired", { status: 404 });
  }

  const bytes = await buildMoralCompassPdf(payload);

  const res = new Response(bytes, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="moral-compass.pdf"`,
      "Cache-Control": "no-store",
    },
  });
  rateHeaders(info).forEach((v, k) => res.headers.set(k, v));
  return res;
}
