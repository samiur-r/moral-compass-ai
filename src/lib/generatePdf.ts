import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

export async function buildMoralCompassPdf(input: {
  decision: string;
  agentResults?: Record<string, string>;
  synthesis?: { summary?: string; agentsUsed?: string[]; confidence?: number };
  timestamp?: string;
}) {
  const doc = await PDFDocument.create();
  const pageSize: [number, number] = [612, 792];
  const margin = 48;
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const bodySize = 11;

  let page = doc.addPage(pageSize);
  let { width, height } = page.getSize();
  let y = height - margin;

  const newPage = () => {
    page = doc.addPage(pageSize);
    ({ width, height } = page.getSize());
    y = height - margin;
  };
  const draw = (t: string, size = bodySize, f = font) => {
    if (y < margin + 16) newPage();
    page.drawText(t, { x: margin, y, size, font: f });
    y -= 16;
  };
  const wrap = (text: string, size: number) => {
    const maxWidth = width - margin * 2;
    const words = text.split(/\s+/);
    let line = "";
    const lines: string[] = [];
    for (const w of words) {
      const t = line ? line + " " + w : w;
      if (font.widthOfTextAtSize(t, size) > maxWidth) {
        if (line) lines.push(line);
        line = w;
      } else {
        line = t;
      }
    }
    if (line) lines.push(line);
    return lines;
  };
  const drawWrapped = (t: string, size = bodySize) => {
    for (const ln of wrap(t, size)) draw(ln, size);
  };

  // Header
  draw("Moral Compass AI — Analysis Report", 20, bold);
  page.drawText(
    `Generated: ${new Date(input.timestamp ?? Date.now()).toISOString()}`,
    {
      x: margin,
      y,
      size: 10,
      font,
      color: rgb(0.4, 0.4, 0.4),
    }
  );
  y -= 18;

  // Decision
  draw("Decision Under Analysis", 14, bold);
  drawWrapped(input.decision);

  // Agent results
  if (input.agentResults && Object.keys(input.agentResults).length) {
    draw("Agent Analysis", 14, bold);
    for (const [agent, result] of Object.entries(input.agentResults)) {
      const nice = agent
        .replace(/([A-Z])/g, " $1")
        .replace(/^./, (s) => s.toUpperCase());
      draw(`${nice}:`, 12, bold);
      drawWrapped(result, 10);
    }
  }

  // Synthesis
  const syn = input.synthesis ?? {};
  draw("Synthesis & Recommendation", 14, bold);
  drawWrapped(syn.summary ?? "No synthesis provided.");
  draw(`Confidence: ${Math.round((syn.confidence ?? 0.5) * 100)}%`, 10);
  draw(`Agents Consulted: ${(syn.agentsUsed ?? []).join(", ") || "—"}`, 10);

  const bytes = await doc.save();
  return new Uint8Array(bytes);
}
