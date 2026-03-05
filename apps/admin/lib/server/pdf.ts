import type { ReactElement } from "react";
import { renderToBuffer } from "@react-pdf/renderer";

/**
 * Sanitize a filename for use in Content-Disposition headers.
 * Strips path separators, control characters, and quotes to prevent
 * header injection and path traversal attacks.
 */
function sanitizeFilename(raw: string): string {
  return String(raw || "document.pdf")
    // Strip path separators and traversal
    .replace(/[/\\]/g, "_")
    // Strip control characters (U+0000-U+001F, U+007F) and quotes
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1f\x7f"]/g, "")
    .trim() || "document.pdf";
}

export async function pdfResponse(opts: { element: ReactElement; filename: string; inline?: boolean }) {
  const buf = await renderToBuffer(opts.element);
  // Buffer isn't part of the DOM `BodyInit` type; wrap it in a Uint8Array for Response.
  const body = new Uint8Array(buf);
  const safeFilename = sanitizeFilename(opts.filename);
  const disposition = `${opts.inline ? "inline" : "attachment"}; filename="${safeFilename}"`;
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": disposition,
      "Cache-Control": "private, no-store"
    }
  });
}
