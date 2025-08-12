import { randomUUID } from "crypto";

const pdfStore = new Map<string, Uint8Array>();

export function savePdf(bytes: Uint8Array): string {
  const id = randomUUID();
  pdfStore.set(id, bytes);
  return id;
}

export function getPdf(id: string): Uint8Array | null {
  return pdfStore.get(id) ?? null;
}

export function deletePdf(id: string) {
  pdfStore.delete(id);
}
