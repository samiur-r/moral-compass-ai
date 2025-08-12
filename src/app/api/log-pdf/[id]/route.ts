import { NextRequest } from "next/server";
import { verifyPdfToken } from "@/lib/pdfToken";
import { buildMoralCompassPdf } from "@/lib/generatePdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { id: string };

export async function GET(_req: NextRequest, ctx: { params: Promise<Params> }) {
  const { id } = await ctx.params; // token
  const payload = verifyPdfToken(id);
  if (!payload) {
    return new Response("Not found or expired", { status: 404 });
  }

  const bytes = await buildMoralCompassPdf(payload);

  return new Response(bytes, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="moral-compass.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
