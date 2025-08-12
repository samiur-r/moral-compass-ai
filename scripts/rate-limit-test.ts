import { createPdfToken } from "../src/lib/pdfToken.js";

const token = createPdfToken({
  decision: "Test decision",
  synthesis: {
    summary: "Test summary",
    confidence: 0.7,
    agentsUsed: ["environment"],
  },
  timestamp: new Date().toISOString(),
});
console.log(`/api/log-pdf/${token}`);
